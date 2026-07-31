import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import {
  invoiceLines,
  invoices,
  items,
  projectionCustomerBalance,
  projectionStockLevel,
} from '@erp/db';
import type { ErpDatabase } from '@erp/db';

// CRM-ROADMAP Phase 1, Feature 5 — ERP-Native Integration Layer. Per AR-2: ONE shared
// read-composition module, not duplicated per consumer. Customer 360 (Feature 3) is the first
// consumer; Phase 2's Opportunity line items are meant to reuse this same module rather than
// re-implementing the balance/stock aggregation a second time (00-CODEBASE-AUDIT.md §6's
// documented recurring bug class). Read-only — never a new source of truth, never a stale
// cached copy: every call reads `projection_customer_balance`/`projection_stock_level`
// directly, live, at request time.
//
// No cross-service HTTP call needed here despite the name "cross-service integration" in the
// roadmap doc's framing — sales-service already has direct query access to these projection
// tables in the same physical Postgres instance (confirmed by InvoiceService.ts already
// writing projectionStockLevel directly), so this stays a sales-service-local module rather
// than living in packages/platform-sdk.

export interface FinancialSnapshot {
  currentBalance: number;
  totalInvoiced: number;
  totalPaid: number;
  overdueAmount: number;
  creditLimit: number;
  creditLimitEnabled: boolean;
  // null when no limit is configured — never a divide-by-zero/nonsensical percentage
  // (Feature 3's stated edge case, reused verbatim here).
  creditHeadroom: number | null;
  isOverLimit: boolean;
  lastInvoiceAt: Date | null;
  lastPaymentAt: Date | null;
}

export interface RecentItemStock {
  itemId: number;
  itemCode: string | null;
  itemName: string;
  // Summed across every warehouse — never just the first/last warehouse row found
  // (Feature 5's stated edge case: an item split across multiple warehouses must aggregate
  // correctly, not misleadingly show only one).
  totalAvailableQty: number;
  warehouseCount: number;
}

export class CustomerFinancialSnapshotService {
  static async getFinancial(
    db: ErpDatabase,
    tenantId: number,
    customerId: number,
    customer: { creditLimit: string | number; creditLimitEnabled: boolean }
  ): Promise<FinancialSnapshot> {
    const [balance] = await db
      .select()
      .from(projectionCustomerBalance)
      .where(
        and(
          eq(projectionCustomerBalance.customerId, customerId),
          eq(projectionCustomerBalance.tenantId, tenantId)
        )
      );

    const creditLimit = parseFloat(String(customer.creditLimit ?? 0));
    const currentBalance = parseFloat(String(balance?.currentBalance ?? 0));
    const creditLimitConfigured = customer.creditLimitEnabled && creditLimit > 0;

    return {
      currentBalance,
      totalInvoiced: parseFloat(String(balance?.totalInvoiced ?? 0)),
      totalPaid: parseFloat(String(balance?.totalPaid ?? 0)),
      overdueAmount: parseFloat(String(balance?.overdueAmount ?? 0)),
      creditLimit,
      creditLimitEnabled: customer.creditLimitEnabled,
      creditHeadroom: creditLimitConfigured ? Math.max(0, creditLimit - currentBalance) : null,
      isOverLimit: creditLimitConfigured && currentBalance > creditLimit,
      lastInvoiceAt: balance?.lastInvoiceAt ?? null,
      lastPaymentAt: balance?.lastPaymentAt ?? null,
    };
  }

  /**
   * Live stock relevance for the customer's most recently purchased distinct items — "you
   * might want to restock these" context, aggregated across every warehouse per item (not
   * just the first one found).
   */
  static async getRecentItemsStock(
    db: ErpDatabase,
    tenantId: number,
    customerId: number,
    limit = 5
  ): Promise<RecentItemStock[]> {
    // Ordered newest-first, then deduped in JS (keeping each item's most recent occurrence) —
    // simpler and more portable than relying on Postgres's DISTINCT ON semantics for a query
    // this small (capped by the LIMIT below, not the full purchase history).
    const recentLines = await db
      .select({ itemId: invoiceLines.itemId, invoiceDate: invoices.invoiceDate })
      .from(invoiceLines)
      .innerJoin(invoices, eq(invoiceLines.invoiceId, invoices.id))
      .where(and(eq(invoices.tenantId, tenantId), eq(invoices.customerId, customerId)))
      .orderBy(desc(invoices.invoiceDate))
      .limit(200);

    const itemIds: number[] = [];
    for (const line of recentLines) {
      if (!itemIds.includes(line.itemId)) itemIds.push(line.itemId);
      if (itemIds.length >= limit) break;
    }
    if (itemIds.length === 0) return [];

    return CustomerFinancialSnapshotService.getStockForItems(db, tenantId, itemIds);
  }

  /**
   * Batched (one query, not N) live stock lookup for an arbitrary set of item IDs — the
   * itemIds-keyed aggregation `getRecentItemsStock` above already did internally, extracted so
   * Phase 2's Opportunity line items can reuse it too (AR-2: one implementation, not a second
   * hand-rolled aggregation per consumer). Summed across every warehouse per item, never just
   * the first one found.
   */
  static async getStockForItems(
    db: ErpDatabase,
    tenantId: number,
    itemIds: number[]
  ): Promise<RecentItemStock[]> {
    if (itemIds.length === 0) return [];

    const [itemRows, stockRows] = await Promise.all([
      db
        .select({ id: items.id, itemCode: items.itemCode, name: items.name })
        .from(items)
        .where(and(eq(items.tenantId, tenantId), inArray(items.id, itemIds))),
      db
        .select({
          itemId: projectionStockLevel.itemId,
          totalAvailableQty: sql<string>`sum(${projectionStockLevel.availableQty})`,
          warehouseCount: sql<number>`count(distinct ${projectionStockLevel.warehouseId})::int`,
        })
        .from(projectionStockLevel)
        .where(
          and(
            eq(projectionStockLevel.tenantId, tenantId),
            inArray(projectionStockLevel.itemId, itemIds)
          )
        )
        .groupBy(projectionStockLevel.itemId),
    ]);

    const stockByItem = new Map(stockRows.map((r) => [r.itemId, r]));
    return itemIds.map((itemId) => {
      const item = itemRows.find((i) => i.id === itemId);
      const stock = stockByItem.get(itemId);
      return {
        itemId,
        itemCode: item?.itemCode ?? null,
        itemName: item?.name ?? `Item #${itemId}`,
        totalAvailableQty: parseFloat(stock?.totalAvailableQty ?? '0'),
        warehouseCount: stock?.warehouseCount ?? 0,
      };
    });
  }
}
