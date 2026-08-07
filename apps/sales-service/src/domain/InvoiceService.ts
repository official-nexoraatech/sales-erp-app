import { and, eq, sql, getTableColumns, inArray, desc } from 'drizzle-orm';
import {
  invoices,
  invoiceLines,
  invoiceHistory,
  customers,
  items,
  outboxEvents,
  projectionDashboardDaily,
  projectionCustomerBalance,
  quotations,
  deliveryChallans,
  inventoryLedger,
  projectionStockLevel,
  workflowInstances,
} from '@erp/db';
import type { ErpDatabase } from '@erp/db';
import { BusinessError, NotFoundError, ERPError } from '@erp/types';
import {
  SagaOrchestrator,
  SagaExecutionError,
  DuplicateOperationError,
  isUniqueConstraintViolation,
  EventStoreService,
  TenantScopedDatabase,
  WorkflowEngine,
  RuleEngine,
} from '@erp/sdk';
import { GSTCalculator } from '@erp/utils';
import { createLogger } from '@erp/logger';
import { NumberSeriesEngine } from './NumberSeriesEngine.js';
import { ValuationService } from './ValuationService.js';
import { enqueueWebhookDeliveries } from './WebhookService.js';
import { CommissionService } from './CommissionService.js';
import { ulid } from 'ulid';

const logger = createLogger({ serviceName: 'sales-service' });

export class InsufficientStockError extends ERPError {
  constructor(
    public itemId: number,
    public available: number,
    public requested: number
  ) {
    super('INSUFFICIENT_STOCK', `Item ${itemId} has only ${available} units available`, 422, {
      itemId,
      available,
      requested,
    });
  }
}

export class CreditLimitExceededError extends ERPError {
  constructor(
    public limit: number,
    public newBalance: number
  ) {
    super(
      'CREDIT_LIMIT_EXCEEDED',
      `Invoice would exceed credit limit. Limit: ${limit}, New balance: ${newBalance}`,
      422,
      { limit, newBalance }
    );
  }
}

export class PriceFloorViolationError extends ERPError {
  constructor(
    public itemId: number,
    public minPrice: number,
    public offered: number
  ) {
    super(
      'PRICE_FLOOR_VIOLATION',
      `Item ${itemId} min sale price is ${minPrice}, offered ${offered}`,
      422,
      { itemId, minPrice, offered }
    );
  }
}

// OFFLINE-02: thrown when create()'s insert collides on (tenantId, clientOperationId) —
// i.e. this is a retried offline POS-sale sync, not a genuinely new sale. The caller
// (pos.routes.ts) catches this and returns the already-committed original result instead
// of propagating a 500 or creating a duplicate invoice/stock deduction/payment.
// PG-011: DuplicateOperationError/isUniqueConstraintViolation now live in @erp/sdk's
// idempotency.ts (re-exported here so existing imports from this module keep working) —
// see ERP_MASTER_SPEC.md §4.10 for the three-pillar distributed-consistency story.
export { DuplicateOperationError };

export interface InvoiceLineInput {
  itemId: number;
  variantId?: number;
  description?: string;
  quantity: number;
  unitId?: number;
  unitPrice: number;
  discountPct?: number;
  discountAmount?: number;
  gstRate: number;
  cessRate?: number;
  hsnCode?: string;
  warehouseId?: number;
}

export interface CreateInvoiceParams {
  tenantId: number;
  branchId: number;
  warehouseId: number;
  customerId: number;
  quotationId?: number;
  deliveryChallanId?: number;
  placeOfSupply: string;
  sellerStateCode: string;
  invoiceDate: Date;
  dueDate: Date;
  paymentTerms?: string;
  lines: InvoiceLineInput[];
  notes?: string;
  deliveryDate?: Date;
  deliveryAddress?: object;
  createdBy: number;
  overrideCreditLimit?: boolean;
  overridePriceFloor?: boolean;
  // OFFLINE-02: client-generated idempotency key for offline-queued POS sales (undefined
  // for every other invoice-creation path — unique constraint only fires on non-null values).
  clientOperationId?: string;
}

export class InvoiceService {
  constructor(private db: ErpDatabase) {}

  async create(params: CreateInvoiceParams): Promise<number> {
    try {
      return await this.createInTransaction(params);
    } catch (err) {
      if (isUniqueConstraintViolation(err, 'invoices_tenant_client_operation_id')) {
        throw new DuplicateOperationError(params.clientOperationId!);
      }
      throw err;
    }
  }

  private async createInTransaction(params: CreateInvoiceParams): Promise<number> {
    return this.db.transaction(async (trx) => {
      // Compute line totals first for credit check
      const computedLines = params.lines.map((l, i) => {
        const gst = GSTCalculator.computeLine({
          unitPrice: l.unitPrice,
          quantity: l.quantity,
          discountPct: l.discountPct ?? 0,
          discountAmount: l.discountAmount ?? 0,
          gstRate: l.gstRate,
          cessRate: l.cessRate ?? 0,
          sellerStateCode: params.sellerStateCode,
          placeOfSupply: params.placeOfSupply,
        });
        return { ...l, ...gst, lineNumber: i + 1 };
      });
      // computedLines already carries every GSTLineResult field (subtotal/discountAmount/
      // taxableAmount/etc.) via the ...gst spread above — no need to reconstruct a
      // discount-input-plus-result shape the way the old per-service sumTotals required.
      const totals = GSTCalculator.sumTotals(computedLines);

      // Step 1 — Validate credit limit. Skipped for walk-in sales: customerId 0 is a
      // deliberate "no customer selected" sentinel stored in the NOT NULL column (see
      // report-service's COALESCE(c.display_name, 'Walk-in')), not a real customer row,
      // and there's no persistent customer to check credit against.
      if (params.customerId > 0) {
        const [customer] = await trx
          .select({
            creditLimit: customers.creditLimit,
            creditLimitEnabled: customers.creditLimitEnabled,
            status: customers.status,
          })
          .from(customers)
          .where(and(eq(customers.id, params.customerId), eq(customers.tenantId, params.tenantId)));
        if (!customer) throw new NotFoundError('Customer not found');

        // H-3 fix: customers.status='BLOCKED'/'INACTIVE' were schema-valid but nothing ever
        // checked them at the point a real transaction gets created — a blocked or inactive
        // customer could still be invoiced.
        if (customer.status === 'BLOCKED') {
          throw new BusinessError(
            'CUSTOMER_BLOCKED',
            `Customer ${params.customerId} is blocked and cannot be invoiced`
          );
        }
        if (customer.status === 'INACTIVE') {
          throw new BusinessError(
            'CUSTOMER_INACTIVE',
            `Customer ${params.customerId} is inactive and cannot be invoiced`
          );
        }

        // Load current balance from projection table
        const [balanceRow] = await trx
          .select({ currentBalance: projectionCustomerBalance.currentBalance })
          .from(projectionCustomerBalance)
          .where(
            and(
              eq(projectionCustomerBalance.customerId, params.customerId),
              eq(projectionCustomerBalance.tenantId, params.tenantId)
            )
          );

        if (customer.creditLimitEnabled && !params.overrideCreditLimit) {
          const newBalance =
            parseFloat(String(balanceRow?.currentBalance ?? 0)) + totals.grandTotal;
          const limit = parseFloat(String(customer.creditLimit ?? 0));
          const isOverCreditLimit = limit > 0 && newBalance > limit;

          // Business Rules Engine wiring: the block/warn/notify decision is now
          // tenant-configurable via business_rules (RuleEngine.evaluate), seeded by default
          // with the "Block sale above credit limit" system template. isOverCreditLimit is
          // pre-computed here rather than left to the generic condition evaluator, since
          // RuleCondition only compares a data field against a literal value, not another
          // data field — see rule-engine.ts's SYSTEM_RULE_TEMPLATES comment.
          const ruleResult = await new RuleEngine(trx).evaluate({
            tenantId: params.tenantId,
            userId: params.createdBy,
            entityType: 'SALE',
            eventType: 'SALE_CREATE',
            data: {
              customer: {
                id: params.customerId,
                creditLimitEnabled: customer.creditLimitEnabled,
                creditLimit: limit,
                outstandingAmount: newBalance,
              },
              isOverCreditLimit,
            },
          });
          if (ruleResult.blocked) {
            throw new CreditLimitExceededError(limit, newBalance);
          }
        }
      }

      // Step 2 — Validate price floor
      if (!params.overridePriceFloor) {
        for (const l of params.lines) {
          const [item] = await trx
            .select({ minSalePrice: items.minSalePrice, trackInventory: items.trackInventory })
            .from(items)
            .where(and(eq(items.id, l.itemId), eq(items.tenantId, params.tenantId)));
          if (item?.minSalePrice) {
            const minPrice = parseFloat(String(item.minSalePrice));
            if (l.unitPrice < minPrice) {
              throw new PriceFloorViolationError(l.itemId, minPrice, l.unitPrice);
            }
          }
        }
      }

      // Step 3 — Create invoice record (DRAFT — number assigned at confirm)
      const [row] = await trx
        .insert(invoices)
        .values({
          tenantId: params.tenantId,
          branchId: params.branchId,
          warehouseId: params.warehouseId,
          customerId: params.customerId,
          quotationId: params.quotationId,
          deliveryChallanId: params.deliveryChallanId,
          status: 'DRAFT',
          placeOfSupply: params.placeOfSupply,
          invoiceDate: params.invoiceDate,
          dueDate: params.dueDate,
          paymentTerms: params.paymentTerms,
          subtotal: String(totals.subtotal),
          discountAmount: String(totals.discountAmount),
          taxableAmount: String(totals.taxableAmount),
          cgstAmount: String(totals.cgstAmount),
          sgstAmount: String(totals.sgstAmount),
          igstAmount: String(totals.igstAmount),
          cessAmount: String(totals.cessAmount),
          grandTotal: String(totals.grandTotal),
          balanceDue: String(totals.grandTotal),
          notes: params.notes,
          deliveryDate: params.deliveryDate,
          deliveryAddress: params.deliveryAddress,
          createdBy: params.createdBy,
          clientOperationId: params.clientOperationId,
        })
        .returning({ id: invoices.id });

      if (!row) throw new BusinessError('INVOICE_CREATE_FAILED', 'Failed to create invoice');
      const invoiceId = row.id;

      await trx.insert(invoiceLines).values(
        computedLines.map((l) => ({
          invoiceId,
          tenantId: params.tenantId,
          lineNumber: l.lineNumber,
          itemId: l.itemId,
          variantId: l.variantId,
          description: l.description,
          quantity: String(l.quantity),
          unitId: l.unitId,
          unitPrice: String(l.unitPrice),
          discountPct: String(l.discountPct ?? 0),
          discountAmount: String(l.discountAmount ?? 0),
          taxableAmount: String(l.taxableAmount),
          gstRate: String(l.gstRate),
          cgstRate: String(l.cgstRate),
          sgstRate: String(l.sgstRate),
          igstRate: String(l.igstRate),
          cgstAmount: String(l.cgstAmount),
          sgstAmount: String(l.sgstAmount),
          igstAmount: String(l.igstAmount),
          cessRate: String(l.cessRate),
          cessAmount: String(l.cessAmount),
          lineTotal: String(l.lineTotal),
          hsnCode: l.hsnCode,
          warehouseId: l.warehouseId ?? params.warehouseId,
        }))
      );

      await trx.insert(invoiceHistory).values({
        invoiceId,
        tenantId: params.tenantId,
        action: 'INVOICE_CREATED',
        toStatus: 'DRAFT',
        performedBy: params.createdBy,
      });

      // Enterprise approval chain: WorkflowEngine's seeded "Sale Invoice — High Value
      // Approval" system definition (INVOICE_CREATE, grandTotal > 50000, routes to
      // SALES_MANAGER, 24h escalation) existed since tenant provisioning but was never
      // triggered by anything — trigger() itself resolves whether an active definition's
      // condition matches; a no-op (returns null) for the overwhelming majority of invoices
      // that fall under the threshold or when the tenant has deactivated the definition.
      // confirmInTransaction below blocks confirming while a triggered instance is PENDING.
      await new WorkflowEngine(trx, params.tenantId, params.createdBy, ulid()).trigger({
        event: 'INVOICE_CREATE',
        entityType: 'Invoice',
        entityId: invoiceId,
        userId: params.createdBy,
        correlationId: ulid(),
        payload: { grandTotal: totals.grandTotal },
      });

      // Search-service sync: DRAFT invoices have no invoiceNumber yet (assigned at
      // confirm()) — the INVOICE_CONFIRMED event above already carries the full payload,
      // this just gets a DRAFT invoice indexed as soon as it exists.
      await trx.insert(outboxEvents).values({
        eventId: ulid(),
        eventType: 'INVOICE_CREATED',
        aggregateType: 'Invoice',
        aggregateId: invoiceId,
        tenantId: params.tenantId,
        payload: {
          invoiceId,
          customerId: params.customerId,
          status: 'DRAFT',
          grandTotal: String(totals.grandTotal),
          invoiceDate: params.invoiceDate,
          branchId: params.branchId,
        },
        published: false,
      });

      // Event Store (event-sourcing replay/audit for the Invoice aggregate — see
      // packages/platform-sdk/src/event-store.ts's applyEvent switch). Separate from the
      // outbox insert above: outbox is for cross-service Kafka delivery, this is the
      // append-only replay log the Distributed Systems admin pages read from.
      await new EventStoreService(
        new TenantScopedDatabase(params.tenantId, trx),
        params.tenantId
      ).append({
        eventId: ulid(),
        eventType: 'INVOICE_CREATED',
        aggregateType: 'Invoice',
        aggregateId: String(invoiceId),
        payload: {
          invoiceId,
          customerId: params.customerId,
          status: 'DRAFT',
          grandTotal: String(totals.grandTotal),
        },
        userId: params.createdBy,
      });

      await enqueueWebhookDeliveries(
        trx,
        params.tenantId,
        'Invoice',
        invoiceId,
        'INVOICE_CREATED',
        {
          invoiceId,
          customerId: params.customerId,
          status: 'DRAFT',
          grandTotal: String(totals.grandTotal),
          invoiceDate: params.invoiceDate,
          branchId: params.branchId,
        }
      );

      // Mark quotation as converted if linked
      // C-5 fix: this used to unconditionally force-set the quotation to CONVERTED with no
      // status check at all — bypassing QuotationService.convert()'s own guard (status must
      // be ACCEPTED) entirely. An invoice could be created from a DRAFT, SENT, REJECTED, or
      // EXPIRED quotation and silently stamp it CONVERTED. The WHERE clause now requires
      // ACCEPTED atomically (no separate read-then-write race), matching the guarded-update
      // pattern already used elsewhere in this method (stock deduction, credit checks).
      if (params.quotationId) {
        const [updatedQuotation] = await trx
          .update(quotations)
          .set({ status: 'CONVERTED', convertedInvoiceId: invoiceId, convertedAt: new Date() })
          .where(
            and(
              eq(quotations.id, params.quotationId),
              eq(quotations.tenantId, params.tenantId),
              eq(quotations.status, 'ACCEPTED')
            )
          )
          .returning({ id: quotations.id });

        if (!updatedQuotation) {
          throw new BusinessError(
            'INVALID_QUOTATION_STATUS',
            `Quotation ${params.quotationId} must be ACCEPTED to convert to an invoice`
          );
        }
      }

      // Mark delivery challan as converted if linked
      if (params.deliveryChallanId) {
        await trx
          .update(deliveryChallans)
          .set({ status: 'CONVERTED', convertedInvoiceId: invoiceId, convertedAt: new Date() })
          .where(
            and(
              eq(deliveryChallans.id, params.deliveryChallanId),
              eq(deliveryChallans.tenantId, params.tenantId)
            )
          );
      }

      return invoiceId;
    });
  }

  // ES-24 [H3]: proof-of-concept INVOICE_CREATION saga. `confirmInTransaction()` below is
  // unchanged and still runs as ONE atomic Postgres transaction (per ES-03's architecture
  // notes: everything it touches — stock deduction, ledger, invoice status, outbox events —
  // lives in this same database, so a single transaction already gives it a stronger
  // guarantee than saga-style compensation could: on any failure, Postgres guarantees zero
  // partial writes, so there is nothing for a compensate() step to undo. Wrapping it in
  // SagaOrchestrator.run() as a single RETRYABLE step still gets confirm() genuine saga_log
  // tracking (visible in the admin saga viewer, retriable via the admin API) without
  // fabricating step boundaries that don't correspond to anything real in this flow, or
  // trading away the transaction's atomicity for a false sense of "compensation" safety.
  // The orchestrator's actual multi-step compensation mechanism (a later, genuinely
  // independent step failing and triggering rollback of an earlier COMPENSATABLE step) is
  // exercised directly in packages/platform-sdk/src/__tests__/saga.test.ts.
  async confirm(id: number, tenantId: number, userId: number): Promise<string> {
    const orchestrator = new SagaOrchestrator(this.db);
    // SagaOrchestrator's step `execute` returns void (packages/platform-sdk/src/saga.ts) — it
    // doesn't plumb a step's return value back out, so the generated number is captured via
    // closure instead. A RETRYABLE step's earlier failed attempt(s), if any, ran (and rolled
    // back) inside their own transaction, so only the attempt that actually commits keeps its
    // number — retries can't leak a gap into the sequence.
    let invoiceNumber = '';
    try {
      await orchestrator.run({
        sagaType: 'INVOICE_CREATION',
        tenantId,
        correlationId: ulid(),
        payload: { invoiceId: id, userId },
        context: { id, tenantId, userId },
        steps: [
          {
            name: 'confirmInvoiceTransaction',
            type: 'RETRYABLE',
            execute: async (ctx: { id: number; tenantId: number; userId: number }) => {
              invoiceNumber = await this.confirmInTransaction(ctx.id, ctx.tenantId, ctx.userId);
            },
          },
        ],
      });

      // Commission engine: deliberately outside the confirm transaction/saga and non-fatal —
      // a commission-calculation bug must never block a legitimate sale from being confirmed.
      // No-ops if the invoice's creator/branch has no active commission assignment.
      try {
        await new CommissionService(this.db).computeForInvoice(id, tenantId);
      } catch (err) {
        logger.warn({ err, invoiceId: id, tenantId }, 'Commission computation failed (non-fatal)');
      }

      return invoiceNumber;
    } catch (err) {
      const cause = err instanceof SagaExecutionError ? err.cause : err;
      // Defensive backstop only — the server-generated number is unique by construction, but
      // the DB unique index (invoices_tenant_number) is kept as the last line of defense.
      if (isUniqueConstraintViolation(cause, 'invoices_tenant_number')) {
        throw new BusinessError(
          'INVOICE_NUMBER_DUPLICATE',
          'Generated invoice number collided with an existing invoice — please retry'
        );
      }
      throw cause;
    }
  }

  private async confirmInTransaction(
    id: number,
    tenantId: number,
    userId: number
  ): Promise<string> {
    return this.db.transaction(async (trx) => {
      const [invoice] = await trx
        .select()
        .from(invoices)
        .where(and(eq(invoices.id, id), eq(invoices.tenantId, tenantId)));
      if (!invoice) throw new NotFoundError('Invoice not found');
      if (invoice.status !== 'DRAFT')
        throw new BusinessError(
          'INVALID_STATUS',
          `Cannot confirm invoice in status ${invoice.status}`
        );

      // Enterprise approval chain: block confirming a DRAFT invoice while its triggered
      // WorkflowEngine approval instance (see createInTransaction's trigger() call above) is
      // still PENDING, or was REJECTED outright. No instance exists at all for invoices that
      // never matched an active definition's condition, so this is a no-op for most invoices.
      const [blockingInstance] = await trx
        .select({ status: workflowInstances.status })
        .from(workflowInstances)
        .where(
          and(
            eq(workflowInstances.tenantId, tenantId),
            eq(workflowInstances.entityType, 'Invoice'),
            eq(workflowInstances.entityId, id),
            inArray(workflowInstances.status, ['PENDING', 'REJECTED'])
          )
        )
        .orderBy(desc(workflowInstances.createdAt))
        .limit(1);
      if (blockingInstance) {
        throw new BusinessError(
          blockingInstance.status === 'PENDING' ? 'APPROVAL_PENDING' : 'APPROVAL_REJECTED',
          blockingInstance.status === 'PENDING'
            ? 'This invoice requires manager approval before it can be confirmed'
            : 'This invoice was rejected during approval and cannot be confirmed'
        );
      }

      // C-7 fix: server-generated, gap-free, FY-scoped sequential number — replaces the old
      // client-supplied invoiceNumber + proactive duplicate check. Called with this same
      // `trx`, so a rolled-back confirm (e.g. insufficient stock below) never burns a number.
      const invoiceNumber = await new NumberSeriesEngine(trx).next(tenantId, 'INVOICE');

      // ES-14: period closure guard — cannot confirm (post) an invoice dated
      // inside an accounting period the tenant has already closed. Queries the
      // shared `period_closures` table directly (same pattern as
      // JournalEngine.checkPeriodOpen in accounting-service — duplicated here
      // rather than imported, since sales-service doesn't call into
      // accounting-service's domain classes; see ES-03's architecture notes).
      const invoiceDate = new Date(invoice.invoiceDate);
      const [closure] = (await trx.execute(
        sql`SELECT status FROM period_closures
            WHERE tenant_id = ${tenantId}
              AND period_month = ${invoiceDate.getMonth() + 1}
              AND period_year = ${invoiceDate.getFullYear()}
            LIMIT 1`
      )) as { status: string }[];
      if (closure?.status === 'CLOSED') {
        throw new BusinessError(
          'PERIOD_CLOSED',
          'Cannot confirm an invoice dated in a closed accounting period'
        );
      }

      const lines = await trx.select().from(invoiceLines).where(eq(invoiceLines.invoiceId, id));

      // Step — Deduct stock atomically per line
      // ES-03: inventory_ledger row is written via a direct insert on the shared
      // @erp/db schema (not an HTTP call to inventory-service) so the ledger write
      // is inside this same Drizzle transaction and rolls back with it if anything
      // fails. A cross-process HTTP call to POST /internal/ledger cannot be undone
      // if this transaction later aborts, so it would break the atomicity this
      // phase requires (see ERP-PLANNING/audit-phase-prompts/ES-03 Architecture
      // Rule #3, Option B). unit_cost is written as 0 (sale price, not cost basis,
      // lives on the invoice line) — ES-13's FIFO/WACC engine populates the real
      // cost basis on cogs_per_unit below.
      let invoiceCogsTotal = 0;
      for (const line of lines) {
        const lineQty = parseFloat(String(line.quantity));
        const lineWarehouseId = line.warehouseId ?? invoice.warehouseId;
        const result = await trx
          .update(items)
          .set({
            availableQty: sql`${items.availableQty} - ${lineQty}`,
            version: sql`${items.version} + 1`,
          })
          .where(
            and(
              eq(items.id, line.itemId),
              eq(items.tenantId, tenantId),
              sql`${items.availableQty} >= ${lineQty}`
            )
          )
          .returning({ id: items.id, availableQty: items.availableQty });

        if (result.length === 0) {
          const [itemRow] = await trx
            .select({ availableQty: items.availableQty })
            .from(items)
            .where(and(eq(items.id, line.itemId), eq(items.tenantId, tenantId)));
          throw new InsufficientStockError(
            line.itemId,
            parseFloat(String(itemRow?.availableQty ?? 0)),
            lineQty
          );
        }

        const afterQty = parseFloat(String(result[0]!.availableQty ?? '0'));
        const beforeQty = afterQty + lineQty;
        const lineCogs = await ValuationService.consumeForStockOut(trx, {
          tenantId,
          itemId: line.itemId,
          variantId: line.variantId ?? undefined,
          warehouseId: lineWarehouseId,
          quantity: lineQty,
        });
        invoiceCogsTotal += lineCogs;
        const cogsPerUnit = lineQty > 0 ? Math.round((lineCogs / lineQty) * 100) / 100 : 0;

        // Sales/POS checkout only ever updated the item's global availableQty above, never
        // the per-warehouse projection_stock_level row — the same class of bug found for GRN
        // receipts (2026-07-17 QA), just on the stock-out side. Left the Stock Levels page and
        // Physical Verification's snapshot wrong for any warehouse with real sales activity.
        await trx
          .insert(projectionStockLevel)
          .values({
            tenantId,
            itemId: line.itemId,
            variantId: line.variantId ?? undefined,
            warehouseId: lineWarehouseId,
            availableQty: '0',
            reservedQty: '0',
            lastMovementAt: new Date(),
          })
          .onConflictDoUpdate({
            target: [
              projectionStockLevel.tenantId,
              projectionStockLevel.itemId,
              projectionStockLevel.warehouseId,
              projectionStockLevel.variantId,
            ],
            set: {
              availableQty: sql`GREATEST(0, projection_stock_level.available_qty - ${lineQty})`,
              lastMovementAt: new Date(),
              updatedAt: new Date(),
            },
          });

        await trx.insert(inventoryLedger).values({
          tenantId,
          itemId: line.itemId,
          variantId: line.variantId ?? undefined,
          warehouseId: lineWarehouseId,
          movementType: 'STOCK_OUT',
          quantity: String(lineQty),
          quantityBefore: String(beforeQty),
          quantityAfter: String(afterQty),
          referenceType: 'INVOICE',
          referenceId: id,
          referenceLineId: line.id,
          unitCost: '0',
          cogsPerUnit: String(cogsPerUnit),
          createdBy: userId,
        });
      }
      invoiceCogsTotal = Math.round(invoiceCogsTotal * 100) / 100;

      // Step — Assign invoice number + confirm
      await trx
        .update(invoices)
        .set({
          status: 'CONFIRMED',
          invoiceNumber,
          confirmedAt: new Date(),
          updatedBy: userId,
          updatedAt: new Date(),
          version: sql`${invoices.version} + 1`,
        })
        .where(and(eq(invoices.id, id), eq(invoices.tenantId, tenantId)));

      // Step — CQRS projection: dashboard daily
      const dateKey = new Date(invoice.invoiceDate);
      dateKey.setHours(0, 0, 0, 0);
      await trx
        .insert(projectionDashboardDaily)
        .values({
          tenantId,
          branchId: invoice.branchId,
          date: dateKey,
          salesCount: 1,
          salesAmount: invoice.grandTotal,
          collectedAmount: '0',
        })
        .onConflictDoUpdate({
          target: [
            projectionDashboardDaily.tenantId,
            projectionDashboardDaily.branchId,
            projectionDashboardDaily.date,
          ],
          set: {
            salesCount: sql`${projectionDashboardDaily.salesCount} + 1`,
            salesAmount: sql`${projectionDashboardDaily.salesAmount} + ${parseFloat(String(invoice.grandTotal))}`,
            updatedAt: new Date(),
          },
        });

      // Step — CQRS projection: customer balance
      await trx
        .insert(projectionCustomerBalance)
        .values({
          tenantId,
          customerId: invoice.customerId,
          currentBalance: invoice.grandTotal,
          totalInvoiced: invoice.grandTotal,
          totalPaid: '0',
          overdueAmount: '0',
          lastInvoiceAt: new Date(),
        })
        .onConflictDoUpdate({
          target: [projectionCustomerBalance.tenantId, projectionCustomerBalance.customerId],
          set: {
            currentBalance: sql`${projectionCustomerBalance.currentBalance} + ${parseFloat(String(invoice.grandTotal))}`,
            totalInvoiced: sql`${projectionCustomerBalance.totalInvoiced} + ${parseFloat(String(invoice.grandTotal))}`,
            lastInvoiceAt: new Date(),
            updatedAt: new Date(),
          },
        });

      // Step — Write INVOICE_CONFIRMED to outbox (IRREVERSIBLE — last step)
      // ES-10: previously this payload only carried {invoiceId, invoiceNumber, customerId,
      // grandTotal} — the gst-service consumer (InvoiceGstConsumer) reads taxableAmount/
      // cgstAmount/sgstAmount/igstAmount/customerGstin/placeOfSupply etc from the payload,
      // so every GST ledger entry for every sales invoice was silently recorded with zero
      // tax amounts. Fixed by carrying the full breakdown already computed on `invoice`.
      const [customer] = await trx
        .select({ displayName: customers.displayName, gstin: customers.gstin })
        .from(customers)
        .where(and(eq(customers.id, invoice.customerId), eq(customers.tenantId, tenantId)));

      await trx.insert(outboxEvents).values({
        eventId: ulid(),
        eventType: 'INVOICE_CONFIRMED',
        aggregateType: 'Invoice',
        aggregateId: id,
        tenantId,
        payload: {
          invoiceId: id,
          invoiceNumber,
          invoiceDate: invoice.invoiceDate,
          customerId: invoice.customerId,
          customerName: customer?.displayName ?? null,
          customerGstin: customer?.gstin ?? null,
          placeOfSupply: invoice.placeOfSupply,
          taxableAmount: invoice.taxableAmount,
          cgstAmount: invoice.cgstAmount,
          sgstAmount: invoice.sgstAmount,
          igstAmount: invoice.igstAmount,
          cessAmount: invoice.cessAmount,
          grandTotal: invoice.grandTotal,
          isInterstate: parseFloat(String(invoice.igstAmount)) > 0,
          branchId: invoice.branchId,
        },
        published: false,
      });

      await new EventStoreService(new TenantScopedDatabase(tenantId, trx), tenantId).append({
        eventId: ulid(),
        eventType: 'INVOICE_CONFIRMED',
        aggregateType: 'Invoice',
        aggregateId: String(id),
        payload: { invoiceId: id, invoiceNumber, grandTotal: invoice.grandTotal },
        userId,
      });

      await enqueueWebhookDeliveries(trx, tenantId, 'Invoice', id, 'INVOICE_CONFIRMED', {
        invoiceId: id,
        invoiceNumber,
        invoiceDate: invoice.invoiceDate,
        customerId: invoice.customerId,
        customerName: customer?.displayName ?? null,
        grandTotal: invoice.grandTotal,
        branchId: invoice.branchId,
      });

      // ES-13: COGS journal (DR Cost of Goods Sold / CR Inventory) is a separate
      // journal entry from the revenue recognition above — accounting-service posts
      // it on COGS_CALCULATED, independently of INVOICE_CONFIRMED.
      if (invoiceCogsTotal > 0) {
        await trx.insert(outboxEvents).values({
          eventId: ulid(),
          eventType: 'COGS_CALCULATED',
          aggregateType: 'Invoice',
          aggregateId: id,
          tenantId,
          payload: {
            invoiceId: id,
            invoiceNumber,
            cogsTotal: String(invoiceCogsTotal),
            branchId: invoice.branchId,
          },
          published: false,
        });
      }

      await trx.insert(invoiceHistory).values({
        invoiceId: id,
        tenantId,
        action: 'INVOICE_CONFIRMED',
        fromStatus: 'DRAFT',
        toStatus: 'CONFIRMED',
        performedBy: userId,
      });

      return invoiceNumber;
    });
  }

  async cancel(id: number, tenantId: number, userId: number, reason: string): Promise<void> {
    await this.db.transaction(async (trx) => {
      const [invoice] = await trx
        .select()
        .from(invoices)
        .where(and(eq(invoices.id, id), eq(invoices.tenantId, tenantId)));
      if (!invoice) throw new NotFoundError('Invoice not found');
      if (!['DRAFT', 'CONFIRMED'].includes(invoice.status))
        throw new BusinessError(
          'INVALID_STATUS',
          `Cannot cancel invoice in status ${invoice.status}`
        );

      // Restore stock if confirmed
      if (invoice.status === 'CONFIRMED') {
        const lines = await trx.select().from(invoiceLines).where(eq(invoiceLines.invoiceId, id));

        for (const line of lines) {
          const lineQty = parseFloat(String(line.quantity));
          const lineWarehouseId = line.warehouseId ?? invoice.warehouseId;
          const result = await trx
            .update(items)
            .set({
              availableQty: sql`${items.availableQty} + ${lineQty}`,
              version: sql`${items.version} + 1`,
            })
            .where(and(eq(items.id, line.itemId), eq(items.tenantId, tenantId)))
            .returning({ availableQty: items.availableQty });

          const afterQty = parseFloat(String(result[0]?.availableQty ?? '0'));
          const beforeQty = afterQty - lineQty;

          // Restore the exact value that confirm()'s STOCK_OUT removed (not a fresh/unknown
          // cost) — otherwise waccCost silently dilutes on every cancelled invoice, since
          // quantity goes back up but currentStockValue previously didn't. Look up the
          // original STOCK_OUT's own recorded cogsPerUnit as this reversal's unit cost.
          const [originalOut] = await trx
            .select({ cogsPerUnit: inventoryLedger.cogsPerUnit })
            .from(inventoryLedger)
            .where(
              and(
                eq(inventoryLedger.tenantId, tenantId),
                eq(inventoryLedger.referenceType, 'INVOICE'),
                eq(inventoryLedger.referenceId, id),
                eq(inventoryLedger.referenceLineId, line.id),
                eq(inventoryLedger.movementType, 'STOCK_OUT')
              )
            );
          const reversalUnitCost = parseFloat(String(originalOut?.cogsPerUnit ?? '0'));

          const [reversalLedgerRow] = await trx
            .insert(inventoryLedger)
            .values({
              tenantId,
              itemId: line.itemId,
              variantId: line.variantId ?? undefined,
              warehouseId: lineWarehouseId,
              movementType: 'STOCK_IN',
              quantity: String(lineQty),
              quantityBefore: String(beforeQty),
              quantityAfter: String(afterQty),
              referenceType: 'INVOICE',
              referenceId: id,
              referenceLineId: line.id,
              unitCost: '0',
              notes: reason,
              createdBy: userId,
            })
            .returning({ id: inventoryLedger.id });

          if (reversalUnitCost > 0) {
            await ValuationService.applyStockIn(trx, {
              tenantId,
              itemId: line.itemId,
              variantId: line.variantId ?? undefined,
              warehouseId: lineWarehouseId,
              quantity: lineQty,
              unitCost: reversalUnitCost,
              qtyBeforeStockIn: beforeQty,
              sourceLedgerId: reversalLedgerRow!.id,
            });
          }

          // Reverse the same per-warehouse projection_stock_level deduction confirm() made.
          await trx
            .insert(projectionStockLevel)
            .values({
              tenantId,
              itemId: line.itemId,
              variantId: line.variantId ?? undefined,
              warehouseId: lineWarehouseId,
              availableQty: String(Math.max(0, lineQty)),
              reservedQty: '0',
              lastMovementAt: new Date(),
            })
            .onConflictDoUpdate({
              target: [
                projectionStockLevel.tenantId,
                projectionStockLevel.itemId,
                projectionStockLevel.warehouseId,
                projectionStockLevel.variantId,
              ],
              set: {
                availableQty: sql`projection_stock_level.available_qty + ${lineQty}`,
                lastMovementAt: new Date(),
                updatedAt: new Date(),
              },
            });
        }

        // Update projections
        await trx
          .update(projectionCustomerBalance)
          .set({
            currentBalance: sql`${projectionCustomerBalance.currentBalance} - ${parseFloat(String(invoice.grandTotal))}`,
            totalInvoiced: sql`${projectionCustomerBalance.totalInvoiced} - ${parseFloat(String(invoice.grandTotal))}`,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(projectionCustomerBalance.tenantId, tenantId),
              eq(projectionCustomerBalance.customerId, invoice.customerId)
            )
          );

        // Outbox: INVOICE_CANCELLED
        await trx.insert(outboxEvents).values({
          eventId: ulid(),
          eventType: 'INVOICE_CANCELLED',
          aggregateType: 'Invoice',
          aggregateId: id,
          tenantId,
          payload: {
            invoiceId: id,
            customerId: invoice.customerId,
            grandTotal: invoice.grandTotal,
            reason,
            // M-7 fix: this payload omitted status — search-service's partial-update/upsert
            // consumer only merges in fields that are actually present, so a cancelled
            // invoice's search document kept showing status: 'CONFIRMED' forever.
            status: 'CANCELLED',
          },
          published: false,
        });

        await new EventStoreService(new TenantScopedDatabase(tenantId, trx), tenantId).append({
          eventId: ulid(),
          eventType: 'INVOICE_CANCELLED',
          aggregateType: 'Invoice',
          aggregateId: String(id),
          payload: { invoiceId: id, customerId: invoice.customerId, reason },
          userId,
        });
      }

      await trx
        .update(invoices)
        .set({
          status: 'CANCELLED',
          cancelledAt: new Date(),
          cancellationReason: reason,
          updatedBy: userId,
          updatedAt: new Date(),
        })
        .where(and(eq(invoices.id, id), eq(invoices.tenantId, tenantId)));

      await trx.insert(invoiceHistory).values({
        invoiceId: id,
        tenantId,
        action: 'INVOICE_CANCELLED',
        fromStatus: invoice.status,
        toStatus: 'CANCELLED',
        performedBy: userId,
        notes: reason,
      });
    });
  }

  async duplicate(
    id: number,
    tenantId: number,
    userId: number,
    _invoiceNumber: string
  ): Promise<number> {
    const [original] = await this.db
      .select()
      .from(invoices)
      .where(and(eq(invoices.id, id), eq(invoices.tenantId, tenantId)));
    if (!original) throw new NotFoundError('Invoice not found');

    const originalLines = await this.db
      .select()
      .from(invoiceLines)
      .where(eq(invoiceLines.invoiceId, id));

    const [newInvoice] = await this.db
      .insert(invoices)
      .values({
        tenantId,
        branchId: original.branchId,
        warehouseId: original.warehouseId,
        customerId: original.customerId,
        status: 'DRAFT',
        placeOfSupply: original.placeOfSupply,
        invoiceDate: new Date(),
        dueDate: original.dueDate,
        paymentTerms: original.paymentTerms,
        subtotal: original.subtotal,
        discountAmount: original.discountAmount,
        taxableAmount: original.taxableAmount,
        cgstAmount: original.cgstAmount,
        sgstAmount: original.sgstAmount,
        igstAmount: original.igstAmount,
        grandTotal: original.grandTotal,
        balanceDue: original.grandTotal,
        notes: original.notes,
        createdBy: userId,
      })
      .returning({ id: invoices.id });

    if (!newInvoice) throw new BusinessError('DUPLICATE_FAILED', 'Failed to duplicate invoice');

    await this.db.insert(invoiceLines).values(
      originalLines.map((l) => ({
        invoiceId: newInvoice.id,
        tenantId,
        lineNumber: l.lineNumber,
        itemId: l.itemId,
        variantId: l.variantId,
        description: l.description,
        quantity: l.quantity,
        unitId: l.unitId,
        unitPrice: l.unitPrice,
        discountPct: l.discountPct,
        discountAmount: l.discountAmount,
        taxableAmount: l.taxableAmount,
        gstRate: l.gstRate,
        cgstRate: l.cgstRate,
        sgstRate: l.sgstRate,
        igstRate: l.igstRate,
        cgstAmount: l.cgstAmount,
        sgstAmount: l.sgstAmount,
        igstAmount: l.igstAmount,
        lineTotal: l.lineTotal,
        hsnCode: l.hsnCode,
        warehouseId: l.warehouseId,
      }))
    );

    return newInvoice.id;
  }

  async getWithLines(id: number, tenantId: number) {
    const [invoice] = await this.db
      .select({ ...getTableColumns(invoices), customerName: customers.displayName })
      .from(invoices)
      .leftJoin(customers, eq(invoices.customerId, customers.id))
      .where(and(eq(invoices.id, id), eq(invoices.tenantId, tenantId)));
    if (!invoice) throw new NotFoundError('Invoice not found');

    const lines = await this.db
      .select({ ...getTableColumns(invoiceLines), itemName: items.name })
      .from(invoiceLines)
      .leftJoin(items, eq(invoiceLines.itemId, items.id))
      .where(eq(invoiceLines.invoiceId, id));

    return { ...invoice, lines };
  }
}
