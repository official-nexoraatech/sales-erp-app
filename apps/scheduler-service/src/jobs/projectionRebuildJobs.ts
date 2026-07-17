import { sql, eq } from 'drizzle-orm';
import {
  projectionStockLevel,
  projectionCustomerBalance,
  projectionSupplierBalance,
  projectionDashboardDaily,
  projectionMetadata,
} from '@erp/db';
import type { ErpDatabase } from '@erp/db';
import { createLogger } from '@erp/logger';
import type { JobRegistry } from '../JobRegistry.js';

const logger = createLogger({ serviceName: 'scheduler-service' });

// PG-008: BullMQ queue name per projection. event-service's projections.routes.ts
// enqueues onto these exact queue names over the same shared Redis connection —
// keep both maps in sync.
export const PROJECTION_QUEUE_NAMES: Record<string, string> = {
  projection_stock_level: 'projection-rebuild-stock-level',
  projection_dashboard_daily: 'projection-rebuild-dashboard-daily',
  projection_customer_balance: 'projection-rebuild-customer-balance',
  projection_supplier_balance: 'projection-rebuild-supplier-balance',
};

async function markResult(db: ErpDatabase, projectionName: string, err: unknown): Promise<void> {
  if (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    await db
      .update(projectionMetadata)
      .set({ status: 'ERROR', errorMessage: errMsg, updatedAt: new Date() })
      .where(eq(projectionMetadata.projectionName, projectionName));
    return;
  }

  // No tenantId filter — matches the existing GET/rebuild/heartbeat routes in
  // event-service's projections.routes.ts, which track one metadata row per
  // projection name across the whole deployment, not per tenant.
  await db
    .update(projectionMetadata)
    .set({
      status: 'UP_TO_DATE',
      errorMessage: null,
      lastUpdatedAt: new Date(),
      rebuildCompletedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(projectionMetadata.projectionName, projectionName));
}

// db.execute() returns raw postgres.js rows — timestamp columns come back as wire-format
// strings (e.g. "2026-07-14 00:00:00+00"), not JS Date instances, unlike drizzle's
// schema-aware typed .select(). Passing that raw string straight into a drizzle `timestamp`
// column crashes with "value.toISOString is not a function" (found in live QA 2026-07-17 —
// both projection_dashboard_daily and projection_customer_balance were stuck in ERROR since
// 2026-07-12; projection_supplier_balance has the same latent bug, just never rebuilt yet).
function toDateOrUndefined(value: Date | string | null): Date | undefined {
  return value == null ? undefined : new Date(value);
}

// Ledger sum reused/extended from apps/inventory-service/src/jobs/reconciliation.job.ts
// (duplicated deliberately — see PG-008's Backend section for why this isn't pulled into
// a shared package). Extended with variant_id (projection_stock_level's real unique key
// includes it) and a parallel active-reservation sum, since reservations shift
// available/reserved qty without ever writing an inventory_ledger row.
async function rebuildStockLevel(db: ErpDatabase, tenantId: number): Promise<void> {
  const result = await db.execute<{
    item_id: number;
    warehouse_id: number;
    variant_id: number | null;
    ledger_sum: string;
    reserved_sum: string;
  }>(sql`
    WITH ledger AS (
      SELECT item_id, warehouse_id, variant_id,
        SUM(
          CASE
            WHEN movement_type IN ('STOCK_IN', 'TRANSFER_IN', 'OPENING', 'RESERVATION_RELEASE', 'ADJUSTMENT')
              THEN quantity
            WHEN movement_type IN ('STOCK_OUT', 'TRANSFER_OUT', 'RESERVATION')
              THEN -quantity
            ELSE 0
          END
        ) AS ledger_sum
      FROM inventory_ledger
      WHERE tenant_id = ${tenantId}
      GROUP BY item_id, warehouse_id, variant_id
    ),
    reserved AS (
      SELECT item_id, warehouse_id, variant_id, SUM(quantity) AS reserved_sum
      FROM stock_reservations
      WHERE tenant_id = ${tenantId} AND status = 'ACTIVE'
      GROUP BY item_id, warehouse_id, variant_id
    )
    SELECT
      COALESCE(ledger.item_id, reserved.item_id) AS item_id,
      COALESCE(ledger.warehouse_id, reserved.warehouse_id) AS warehouse_id,
      COALESCE(ledger.variant_id, reserved.variant_id) AS variant_id,
      COALESCE(ledger.ledger_sum, 0) AS ledger_sum,
      COALESCE(reserved.reserved_sum, 0) AS reserved_sum
    FROM ledger
    FULL OUTER JOIN reserved
      ON reserved.item_id = ledger.item_id
      AND reserved.warehouse_id = ledger.warehouse_id
      AND reserved.variant_id IS NOT DISTINCT FROM ledger.variant_id
  `);
  const rows = result as Array<{
    item_id: number;
    warehouse_id: number;
    variant_id: number | null;
    ledger_sum: string;
    reserved_sum: string;
  }>;

  for (const row of rows) {
    const reservedQty = parseFloat(row.reserved_sum ?? '0');
    const availableQty = parseFloat(row.ledger_sum ?? '0') - reservedQty;

    await db
      .insert(projectionStockLevel)
      .values({
        tenantId,
        itemId: row.item_id,
        variantId: row.variant_id ?? undefined,
        warehouseId: row.warehouse_id,
        availableQty: String(availableQty),
        reservedQty: String(reservedQty),
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
          availableQty: String(availableQty),
          reservedQty: String(reservedQty),
          lastMovementAt: new Date(),
          updatedAt: new Date(),
        },
      });
  }

  logger.info({ tenantId, rows: rows.length }, 'Stock level projection rebuilt');
}

// Mirrors exactly what InvoiceService.confirm/cancel, PaymentService.allocate, and
// SaleReturnService.create's incremental deltas were supposed to produce — see
// PG-008's Architecture section. overdueAmount is never touched by any incremental
// delta today, so it's rebuilt to 0 to match that (not "fixed" — mirrored).
async function rebuildCustomerBalance(db: ErpDatabase, tenantId: number): Promise<void> {
  const result = await db.execute<{
    customer_id: number;
    total_invoiced: string;
    total_paid: string;
    total_returned: string;
    last_invoice_at: string | null;
    last_payment_at: string | null;
  }>(sql`
    WITH invoiced AS (
      SELECT customer_id, SUM(grand_total) AS total_invoiced, MAX(invoice_date) AS last_invoice_at
      FROM invoices
      WHERE tenant_id = ${tenantId} AND status IN ('CONFIRMED', 'PARTIALLY_PAID', 'PAID', 'OVERDUE')
      GROUP BY customer_id
    ),
    paid AS (
      SELECT i.customer_id AS customer_id, SUM(pa.amount) AS total_paid, MAX(pa.allocated_at) AS last_payment_at
      FROM payment_allocations pa
      JOIN invoices i ON i.id = pa.invoice_id
      WHERE pa.tenant_id = ${tenantId}
      GROUP BY i.customer_id
    ),
    returned AS (
      SELECT customer_id, SUM(total_amount) AS total_returned
      FROM sale_returns
      WHERE tenant_id = ${tenantId} AND status = 'APPROVED'
      GROUP BY customer_id
    )
    SELECT
      COALESCE(invoiced.customer_id, paid.customer_id, returned.customer_id) AS customer_id,
      COALESCE(invoiced.total_invoiced, 0) AS total_invoiced,
      COALESCE(paid.total_paid, 0) AS total_paid,
      COALESCE(returned.total_returned, 0) AS total_returned,
      invoiced.last_invoice_at AS last_invoice_at,
      paid.last_payment_at AS last_payment_at
    FROM invoiced
    FULL OUTER JOIN paid ON paid.customer_id = invoiced.customer_id
    FULL OUTER JOIN returned ON returned.customer_id = COALESCE(invoiced.customer_id, paid.customer_id)
  `);
  const rows = result as Array<{
    customer_id: number;
    total_invoiced: string;
    total_paid: string;
    total_returned: string;
    last_invoice_at: string | null;
    last_payment_at: string | null;
  }>;

  for (const row of rows) {
    const totalInvoiced = parseFloat(row.total_invoiced ?? '0');
    const totalPaid = parseFloat(row.total_paid ?? '0');
    const totalReturned = parseFloat(row.total_returned ?? '0');
    const currentBalance = totalInvoiced - totalPaid - totalReturned;

    const lastInvoiceAt = toDateOrUndefined(row.last_invoice_at);
    const lastPaymentAt = toDateOrUndefined(row.last_payment_at);

    await db
      .insert(projectionCustomerBalance)
      .values({
        tenantId,
        customerId: row.customer_id,
        currentBalance: String(currentBalance),
        totalInvoiced: String(totalInvoiced),
        totalPaid: String(totalPaid),
        overdueAmount: '0',
        lastInvoiceAt,
        lastPaymentAt,
      })
      .onConflictDoUpdate({
        target: [projectionCustomerBalance.tenantId, projectionCustomerBalance.customerId],
        set: {
          currentBalance: String(currentBalance),
          totalInvoiced: String(totalInvoiced),
          totalPaid: String(totalPaid),
          overdueAmount: '0',
          lastInvoiceAt,
          lastPaymentAt,
          updatedAt: new Date(),
        },
      });
  }

  logger.info({ tenantId, rows: rows.length }, 'Customer balance projection rebuilt');
}

// Mirrors GRNService.approve/SupplierPaymentService.create+bounceCheque/
// PurchaseReturnService.approve's incremental deltas. Supplier totalPaid tracks the
// whole payment amount (not per-GRN-allocation, unlike the sales side) — see
// SupplierPaymentService.create/bounceCheque.
async function rebuildSupplierBalance(db: ErpDatabase, tenantId: number): Promise<void> {
  const result = await db.execute<{
    supplier_id: number;
    total_purchased: string;
    total_paid: string;
    total_returned: string;
    last_grn_at: string | null;
    last_payment_at: string | null;
  }>(sql`
    WITH purchased AS (
      SELECT supplier_id, SUM(grand_total) AS total_purchased, MAX(grn_date) AS last_grn_at
      FROM grns
      WHERE tenant_id = ${tenantId} AND status = 'APPROVED'
      GROUP BY supplier_id
    ),
    paid AS (
      SELECT supplier_id, SUM(amount) AS total_paid, MAX(payment_date) AS last_payment_at
      FROM supplier_payments
      WHERE tenant_id = ${tenantId} AND status != 'BOUNCED'
      GROUP BY supplier_id
    ),
    returned AS (
      SELECT supplier_id, SUM(grand_total) AS total_returned
      FROM purchase_returns
      WHERE tenant_id = ${tenantId} AND status = 'APPROVED'
      GROUP BY supplier_id
    )
    SELECT
      COALESCE(purchased.supplier_id, paid.supplier_id, returned.supplier_id) AS supplier_id,
      COALESCE(purchased.total_purchased, 0) AS total_purchased,
      COALESCE(paid.total_paid, 0) AS total_paid,
      COALESCE(returned.total_returned, 0) AS total_returned,
      purchased.last_grn_at AS last_grn_at,
      paid.last_payment_at AS last_payment_at
    FROM purchased
    FULL OUTER JOIN paid ON paid.supplier_id = purchased.supplier_id
    FULL OUTER JOIN returned ON returned.supplier_id = COALESCE(purchased.supplier_id, paid.supplier_id)
  `);
  const rows = result as Array<{
    supplier_id: number;
    total_purchased: string;
    total_paid: string;
    total_returned: string;
    last_grn_at: string | null;
    last_payment_at: string | null;
  }>;

  for (const row of rows) {
    const totalPurchased = parseFloat(row.total_purchased ?? '0');
    const totalPaid = parseFloat(row.total_paid ?? '0');
    const totalReturned = parseFloat(row.total_returned ?? '0');
    const currentBalance = totalPurchased - totalPaid - totalReturned;

    const lastGrnAt = toDateOrUndefined(row.last_grn_at);
    const lastPaymentAt = toDateOrUndefined(row.last_payment_at);

    await db
      .insert(projectionSupplierBalance)
      .values({
        tenantId,
        supplierId: row.supplier_id,
        currentBalance: String(currentBalance),
        totalPurchased: String(totalPurchased),
        totalPaid: String(totalPaid),
        totalReturns: String(totalReturned),
        overdueAmount: '0',
        lastGrnAt,
        lastPaymentAt,
      })
      .onConflictDoUpdate({
        target: [projectionSupplierBalance.tenantId, projectionSupplierBalance.supplierId],
        set: {
          currentBalance: String(currentBalance),
          totalPurchased: String(totalPurchased),
          totalPaid: String(totalPaid),
          totalReturns: String(totalReturned),
          overdueAmount: '0',
          lastGrnAt,
          lastPaymentAt,
          updatedAt: new Date(),
        },
      });
  }

  logger.info({ tenantId, rows: rows.length }, 'Supplier balance projection rebuilt');
}

// Bounded to a trailing 90-day window (dashboard staleness tolerance is 2 minutes —
// see STALE_TOLERANCE_MS in event-service's projections.routes.ts — so 90 days of
// history is far more than any realistic drift scenario needs). salesCount/salesAmount
// mirror InvoiceService.confirm (never reversed on cancel — status != 'DRAFT' matches
// that). collectedAmount mirrors PaymentService.allocate. returnCount/returnAmount have
// no incremental writer anywhere today (SaleReturnService never touches this table) —
// this rebuild is what first populates them, per PG-008's Architecture section.
async function rebuildDashboardDaily(db: ErpDatabase, tenantId: number): Promise<void> {
  const result = await db.execute<{
    branch_id: number;
    date_key: string;
    sales_count: string;
    sales_amount: string;
    collected_amount: string;
    return_count: string;
    return_amount: string;
  }>(sql`
    WITH sales AS (
      SELECT branch_id, date_trunc('day', invoice_date) AS date_key,
        COUNT(*) AS sales_count, SUM(grand_total) AS sales_amount
      FROM invoices
      WHERE tenant_id = ${tenantId} AND status != 'DRAFT' AND invoice_date >= NOW() - INTERVAL '90 days'
      GROUP BY branch_id, date_trunc('day', invoice_date)
    ),
    collected AS (
      SELECT p.branch_id AS branch_id, date_trunc('day', p.payment_date) AS date_key,
        SUM(pa.amount) AS collected_amount
      FROM payment_allocations pa
      JOIN payments p ON p.id = pa.payment_id
      WHERE p.tenant_id = ${tenantId} AND p.payment_date >= NOW() - INTERVAL '90 days'
      GROUP BY p.branch_id, date_trunc('day', p.payment_date)
    ),
    returns AS (
      SELECT branch_id, date_trunc('day', return_date) AS date_key,
        COUNT(*) AS return_count, SUM(total_amount) AS return_amount
      FROM sale_returns
      WHERE tenant_id = ${tenantId} AND status = 'APPROVED' AND return_date >= NOW() - INTERVAL '90 days'
      GROUP BY branch_id, date_trunc('day', return_date)
    )
    SELECT
      COALESCE(sales.branch_id, collected.branch_id, returns.branch_id) AS branch_id,
      COALESCE(sales.date_key, collected.date_key, returns.date_key) AS date_key,
      COALESCE(sales.sales_count, 0) AS sales_count,
      COALESCE(sales.sales_amount, 0) AS sales_amount,
      COALESCE(collected.collected_amount, 0) AS collected_amount,
      COALESCE(returns.return_count, 0) AS return_count,
      COALESCE(returns.return_amount, 0) AS return_amount
    FROM sales
    FULL OUTER JOIN collected ON collected.branch_id = sales.branch_id AND collected.date_key = sales.date_key
    FULL OUTER JOIN returns
      ON returns.branch_id = COALESCE(sales.branch_id, collected.branch_id)
      AND returns.date_key = COALESCE(sales.date_key, collected.date_key)
  `);
  const rows = result as Array<{
    branch_id: number;
    date_key: string;
    sales_count: string;
    sales_amount: string;
    collected_amount: string;
    return_count: string;
    return_amount: string;
  }>;

  for (const row of rows) {
    const salesCount = parseInt(row.sales_count, 10) || 0;
    const salesAmount = parseFloat(row.sales_amount ?? '0');
    const collectedAmount = parseFloat(row.collected_amount ?? '0');
    const returnCount = parseInt(row.return_count, 10) || 0;
    const returnAmount = parseFloat(row.return_amount ?? '0');

    const dateKey = toDateOrUndefined(row.date_key);
    if (!dateKey) continue;

    await db
      .insert(projectionDashboardDaily)
      .values({
        tenantId,
        branchId: row.branch_id,
        date: dateKey,
        salesCount,
        salesAmount: String(salesAmount),
        collectedAmount: String(collectedAmount),
        returnCount,
        returnAmount: String(returnAmount),
      })
      .onConflictDoUpdate({
        target: [
          projectionDashboardDaily.tenantId,
          projectionDashboardDaily.branchId,
          projectionDashboardDaily.date,
        ],
        set: {
          salesCount,
          salesAmount: String(salesAmount),
          collectedAmount: String(collectedAmount),
          returnCount,
          returnAmount: String(returnAmount),
          updatedAt: new Date(),
        },
      });
  }

  logger.info({ tenantId, rows: rows.length }, 'Dashboard daily projection rebuilt');
}

const REBUILDS: Array<{
  projectionName: string;
  run: (db: ErpDatabase, tenantId: number) => Promise<void>;
}> = [
  { projectionName: 'projection_stock_level', run: rebuildStockLevel },
  { projectionName: 'projection_dashboard_daily', run: rebuildDashboardDaily },
  { projectionName: 'projection_customer_balance', run: rebuildCustomerBalance },
  { projectionName: 'projection_supplier_balance', run: rebuildSupplierBalance },
];

export function registerProjectionRebuildJobs(registry: JobRegistry, db: ErpDatabase): void {
  for (const { projectionName, run } of REBUILDS) {
    const queueName = PROJECTION_QUEUE_NAMES[projectionName]!;

    registry.register(
      queueName,
      {
        cron: 'manual-only',
        description: `On-demand full recompute of ${projectionName} from its source-of-truth tables`,
        tenantScoped: true,
        manualOnly: true,
      },
      async (_job, tenantId) => {
        if (tenantId === undefined) {
          logger.warn(
            { projectionName },
            'Projection rebuild triggered without a tenantId — skipping'
          );
          return;
        }

        try {
          await run(db, tenantId);
          await markResult(db, projectionName, undefined);
        } catch (err) {
          await markResult(db, projectionName, err);
          throw err;
        }
      }
    );
  }
}
