import { and, eq, sql } from 'drizzle-orm';
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
} from '@erp/db';
import type { ErpDatabase } from '@erp/db';
import { BusinessError, NotFoundError, ERPError } from '@erp/types';
import { GSTCalculator } from './GSTCalculator.js';
import { ulid } from 'ulid';

export class InsufficientStockError extends ERPError {
  constructor(public itemId: number, public available: number) {
    super('INSUFFICIENT_STOCK', `Item ${itemId} has only ${available} units available`, 422);
  }
}

export class CreditLimitExceededError extends ERPError {
  constructor(public limit: number, public newBalance: number) {
    super('CREDIT_LIMIT_EXCEEDED', `Invoice would exceed credit limit. Limit: ${limit}, New balance: ${newBalance}`, 422);
  }
}

export class PriceFloorViolationError extends ERPError {
  constructor(public itemId: number, public minPrice: number, public offered: number) {
    super('PRICE_FLOOR_VIOLATION', `Item ${itemId} min sale price is ${minPrice}, offered ${offered}`, 422);
  }
}

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
}

export class InvoiceService {
  constructor(private db: ErpDatabase) {}

  async create(params: CreateInvoiceParams): Promise<number> {
    return this.db.transaction(async (trx) => {
      // Step 1 — Validate credit limit
      const [customer] = await trx
        .select({ creditLimit: customers.creditLimit, creditLimitEnabled: customers.creditLimitEnabled })
        .from(customers)
        .where(and(eq(customers.id, params.customerId), eq(customers.tenantId, params.tenantId)));
      if (!customer) throw new NotFoundError('Customer not found');

      // Load current balance from projection table
      const [balanceRow] = await trx
        .select({ currentBalance: projectionCustomerBalance.currentBalance })
        .from(projectionCustomerBalance)
        .where(and(eq(projectionCustomerBalance.customerId, params.customerId), eq(projectionCustomerBalance.tenantId, params.tenantId)));

      // Compute line totals first for credit check
      const computedLines = params.lines.map((l, i) => {
        const gst = GSTCalculator.computeLine({
          unitPrice: l.unitPrice,
          quantity: l.quantity,
          discountPct: l.discountPct ?? 0,
          discountAmount: l.discountAmount ?? 0,
          gstRate: l.gstRate,
          sellerStateCode: params.sellerStateCode,
          placeOfSupply: params.placeOfSupply,
        });
        return { ...l, ...gst, lineNumber: i + 1 };
      });
      const totals = GSTCalculator.sumTotals(
        computedLines.map((l) => ({
          discountPct: l.discountPct ?? 0,
          discountAmount: l.discountAmount ?? 0,
          ...l,
        }))
      );

      if (customer.creditLimitEnabled && !params.overrideCreditLimit) {
        const newBalance = parseFloat(String(balanceRow?.currentBalance ?? 0)) + totals.grandTotal;
        const limit = parseFloat(String(customer.creditLimit ?? 0));
        if (limit > 0 && newBalance > limit) {
          throw new CreditLimitExceededError(limit, newBalance);
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
          grandTotal: String(totals.grandTotal),
          balanceDue: String(totals.grandTotal),
          notes: params.notes,
          deliveryDate: params.deliveryDate,
          deliveryAddress: params.deliveryAddress,
          createdBy: params.createdBy,
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

      // Mark quotation as converted if linked
      if (params.quotationId) {
        await trx
          .update(quotations)
          .set({ status: 'CONVERTED', convertedInvoiceId: invoiceId, convertedAt: new Date() })
          .where(and(eq(quotations.id, params.quotationId), eq(quotations.tenantId, params.tenantId)));
      }

      return invoiceId;
    });
  }

  async confirm(
    id: number,
    tenantId: number,
    invoiceNumber: string,
    userId: number
  ): Promise<void> {
    await this.db.transaction(async (trx) => {
      const [invoice] = await trx
        .select()
        .from(invoices)
        .where(and(eq(invoices.id, id), eq(invoices.tenantId, tenantId)));
      if (!invoice) throw new NotFoundError('Invoice not found');
      if (invoice.status !== 'DRAFT')
        throw new BusinessError('INVALID_STATUS', `Cannot confirm invoice in status ${invoice.status}`);

      const lines = await trx
        .select()
        .from(invoiceLines)
        .where(eq(invoiceLines.invoiceId, id));

      // Step — Deduct stock atomically per line
      for (const line of lines) {
        const lineQty = parseFloat(String(line.quantity));
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
          .returning({ id: items.id });

        if (result.length === 0) {
          const [itemRow] = await trx
            .select({ availableQty: items.availableQty })
            .from(items)
            .where(and(eq(items.id, line.itemId), eq(items.tenantId, tenantId)));
          throw new InsufficientStockError(
            line.itemId,
            parseFloat(String(itemRow?.availableQty ?? 0))
          );
        }
      }

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
          target: [projectionDashboardDaily.tenantId, projectionDashboardDaily.branchId, projectionDashboardDaily.date],
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
      await trx.insert(outboxEvents).values({
        eventId: ulid(),
        eventType: 'INVOICE_CONFIRMED',
        aggregateType: 'Invoice',
        aggregateId: id,
        tenantId,
        payload: { invoiceId: id, invoiceNumber, customerId: invoice.customerId, grandTotal: invoice.grandTotal },
        published: false,
      });

      await trx.insert(invoiceHistory).values({
        invoiceId: id,
        tenantId,
        action: 'INVOICE_CONFIRMED',
        fromStatus: 'DRAFT',
        toStatus: 'CONFIRMED',
        performedBy: userId,
      });
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
        throw new BusinessError('INVALID_STATUS', `Cannot cancel invoice in status ${invoice.status}`);

      // Restore stock if confirmed
      if (invoice.status === 'CONFIRMED') {
        const lines = await trx
          .select()
          .from(invoiceLines)
          .where(eq(invoiceLines.invoiceId, id));

        for (const line of lines) {
          await trx
            .update(items)
            .set({
              availableQty: sql`${items.availableQty} + ${parseFloat(String(line.quantity))}`,
              version: sql`${items.version} + 1`,
            })
            .where(and(eq(items.id, line.itemId), eq(items.tenantId, tenantId)));
        }

        // Update projections
        await trx
          .update(projectionCustomerBalance)
          .set({
            currentBalance: sql`${projectionCustomerBalance.currentBalance} - ${parseFloat(String(invoice.grandTotal))}`,
            totalInvoiced: sql`${projectionCustomerBalance.totalInvoiced} - ${parseFloat(String(invoice.grandTotal))}`,
            updatedAt: new Date(),
          })
          .where(and(
            eq(projectionCustomerBalance.tenantId, tenantId),
            eq(projectionCustomerBalance.customerId, invoice.customerId)
          ));

        // Outbox: INVOICE_CANCELLED
        await trx.insert(outboxEvents).values({
          eventId: ulid(),
          eventType: 'INVOICE_CANCELLED',
          aggregateType: 'Invoice',
          aggregateId: id,
          tenantId,
          payload: { invoiceId: id, customerId: invoice.customerId, grandTotal: invoice.grandTotal, reason },
          published: false,
        });
      }

      await trx
        .update(invoices)
        .set({ status: 'CANCELLED', cancelledAt: new Date(), cancellationReason: reason, updatedBy: userId, updatedAt: new Date() })
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

  async duplicate(id: number, tenantId: number, userId: number, invoiceNumber: string): Promise<number> {
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
      .select()
      .from(invoices)
      .where(and(eq(invoices.id, id), eq(invoices.tenantId, tenantId)));
    if (!invoice) throw new NotFoundError('Invoice not found');

    const lines = await this.db
      .select()
      .from(invoiceLines)
      .where(eq(invoiceLines.invoiceId, id));

    return { ...invoice, lines };
  }
}
