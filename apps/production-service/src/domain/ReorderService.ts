import { and, eq, sql, lte, inArray, desc } from 'drizzle-orm';
import {
  items,
  projectionStockLevel,
  purchaseOrders,
  purchaseOrderLines,
  suppliers,
  outboxEvents,
} from '@erp/db';
import type { ErpDatabase } from '@erp/db';
import { BusinessError } from '@erp/types';
import { ulid } from 'ulid';
import { GSTCalculator } from './GSTCalculator.js';

export interface ReorderItem {
  itemId: number;
  itemCode: string | null;
  itemName: string;
  currentQty: number;
  reorderLevel: number;
  reorderQty: number;
  defaultSupplierId?: number | undefined;
  supplierName?: string | undefined;
  lastPurchasePrice?: number | undefined;
}

export interface CreatePOsFromReorderParams {
  tenantId: number;
  branchId: number;
  warehouseId: number;
  placeOfSupply: string;
  items: Array<{ itemId: number; supplierId: number; quantity: number; unitPrice: number }>;
  createdBy: number;
}

export class ReorderService {
  constructor(private db: ErpDatabase) {}

  async getReorderRequired(tenantId: number, warehouseId?: number): Promise<ReorderItem[]> {
    // items.availableQty is a tenant-wide total with no warehouse dimension — the warehouseId
    // param was accepted but silently never applied to any filter. When a specific warehouse
    // is requested, compare that warehouse's own projected stock (projectionStockLevel, which
    // IS warehouse-scoped) against the item's reorder level instead.
    const rows = warehouseId
      ? await this.db
          .select({
            id: items.id,
            itemCode: items.itemCode,
            name: items.name,
            availableQty: projectionStockLevel.availableQty,
            reorderLevel: items.reorderLevel,
            reorderQty: items.reorderQty,
          })
          .from(projectionStockLevel)
          .innerJoin(items, eq(projectionStockLevel.itemId, items.id))
          .where(
            and(
              eq(items.tenantId, tenantId),
              eq(items.trackInventory, true),
              sql`${items.status} = 'ACTIVE'`,
              eq(projectionStockLevel.tenantId, tenantId),
              eq(projectionStockLevel.warehouseId, warehouseId),
              lte(projectionStockLevel.availableQty, items.reorderLevel)
            )
          )
      : await this.db
          .select({
            id: items.id,
            itemCode: items.itemCode,
            name: items.name,
            availableQty: items.availableQty,
            reorderLevel: items.reorderLevel,
            reorderQty: items.reorderQty,
          })
          .from(items)
          .where(
            and(
              eq(items.tenantId, tenantId),
              eq(items.trackInventory, true),
              sql`${items.status} = 'ACTIVE'`,
              lte(items.availableQty, items.reorderLevel)
            )
          );

    if (rows.length === 0) return [];

    // Items have no stored "default supplier" FK — infer one from purchase history (most
    // recent PO line for that item) instead. Without this, defaultSupplierId/lastPurchasePrice
    // were always undefined, "Create POs" always filtered every item out, and the one-click
    // reorder-to-PO feature never actually created anything.
    const itemIds = rows.map((r) => r.id);
    const purchaseHistory = await this.db
      .select({
        itemId: purchaseOrderLines.itemId,
        supplierId: purchaseOrders.supplierId,
        supplierName: suppliers.displayName,
        unitPrice: purchaseOrderLines.unitPrice,
      })
      .from(purchaseOrderLines)
      .innerJoin(purchaseOrders, eq(purchaseOrderLines.purchaseOrderId, purchaseOrders.id))
      .leftJoin(suppliers, eq(purchaseOrders.supplierId, suppliers.id))
      .where(
        and(eq(purchaseOrders.tenantId, tenantId), inArray(purchaseOrderLines.itemId, itemIds))
      )
      .orderBy(desc(purchaseOrders.poDate));

    const lastPurchaseByItem = new Map<number, (typeof purchaseHistory)[number]>();
    for (const p of purchaseHistory) {
      if (!lastPurchaseByItem.has(p.itemId)) lastPurchaseByItem.set(p.itemId, p);
    }

    return rows.map((row) => {
      const lastPurchase = lastPurchaseByItem.get(row.id);
      return {
        itemId: row.id,
        itemCode: row.itemCode,
        itemName: row.name,
        currentQty: parseFloat(String(row.availableQty)),
        reorderLevel: parseFloat(String(row.reorderLevel)),
        reorderQty: parseFloat(String(row.reorderQty)),
        defaultSupplierId: lastPurchase?.supplierId,
        supplierName: lastPurchase?.supplierName ?? undefined,
        lastPurchasePrice: lastPurchase ? parseFloat(String(lastPurchase.unitPrice)) : undefined,
      };
    });
  }

  async createPOsFromReorder(params: CreatePOsFromReorderParams): Promise<number[]> {
    // Group items by supplier
    const bySupplier = new Map<number, typeof params.items>();
    for (const item of params.items) {
      const existing = bySupplier.get(item.supplierId) ?? [];
      existing.push(item);
      bySupplier.set(item.supplierId, existing);
    }

    const itemIds = [...new Set(params.items.map((i) => i.itemId))];
    const supplierIds = [...bySupplier.keys()];

    const itemRows = await this.db
      .select({
        id: items.id,
        gstRate: items.gstRate,
        hsnCode: items.hsnCode,
        cessRate: items.cessRate,
      })
      .from(items)
      .where(and(eq(items.tenantId, params.tenantId), inArray(items.id, itemIds)));
    const itemGstById = new Map(itemRows.map((r) => [r.id, r]));

    const supplierRows = await this.db
      .select({ id: suppliers.id, billingAddress: suppliers.billingAddress })
      .from(suppliers)
      .where(and(eq(suppliers.tenantId, params.tenantId), inArray(suppliers.id, supplierIds)));
    const supplierStateById = new Map(supplierRows.map((r) => [r.id, r.billingAddress?.stateCode]));

    const poIds: number[] = [];

    await this.db.transaction(async (trx) => {
      for (const [supplierId, supplierItems] of bySupplier) {
        // Supplier's registered state resolves intrastate vs interstate for CGST/SGST vs IGST.
        // Falls back to placeOfSupply (intrastate) only if the supplier master has no state on file.
        const sellerStateCode = supplierStateById.get(supplierId) ?? params.placeOfSupply;

        const computedLines = supplierItems.map((item) => {
          const itemGst = itemGstById.get(item.itemId);
          const gst = GSTCalculator.computeLine({
            unitPrice: item.unitPrice,
            quantity: item.quantity,
            discountPct: 0,
            discountAmount: 0,
            gstRate: parseFloat(String(itemGst?.gstRate ?? '18')),
            cessRate: parseFloat(String(itemGst?.cessRate ?? '0')),
            sellerStateCode,
            placeOfSupply: params.placeOfSupply,
          });
          return {
            itemId: item.itemId,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            hsnCode: itemGst?.hsnCode,
            ...gst,
          };
        });
        const totals = GSTCalculator.sumTotals(computedLines);

        const [row] = await trx
          .insert(purchaseOrders)
          .values({
            tenantId: params.tenantId,
            branchId: params.branchId,
            warehouseId: params.warehouseId,
            supplierId,
            status: 'DRAFT',
            poDate: new Date(),
            placeOfSupply: params.placeOfSupply,
            sellerStateCode,
            subtotal: String(totals.subtotal),
            discountAmount: String(totals.discountAmount),
            taxableAmount: String(totals.taxableAmount),
            cgstAmount: String(totals.cgstAmount),
            sgstAmount: String(totals.sgstAmount),
            igstAmount: String(totals.igstAmount),
            grandTotal: String(totals.grandTotal),
            receivedAmount: '0',
            notes: 'Auto-created from reorder report',
            createdBy: params.createdBy,
          })
          .returning({ id: purchaseOrders.id });

        if (!row)
          throw new BusinessError(
            'PO_CREATE_FAILED',
            'Failed to create purchase order from reorder'
          );
        const poId = row.id;
        poIds.push(poId);

        for (let i = 0; i < computedLines.length; i++) {
          const line = computedLines[i];
          if (!line) continue;

          await trx.insert(purchaseOrderLines).values({
            purchaseOrderId: poId,
            tenantId: params.tenantId,
            lineNumber: i + 1,
            itemId: line.itemId,
            orderedQty: String(line.quantity),
            unitPrice: String(line.unitPrice),
            discountPct: '0',
            discountAmount: String(line.discountAmount),
            gstRate: String(line.gstRate),
            cgstRate: String(line.cgstRate),
            sgstRate: String(line.sgstRate),
            igstRate: String(line.igstRate),
            taxableAmount: String(line.taxableAmount),
            cgstAmount: String(line.cgstAmount),
            sgstAmount: String(line.sgstAmount),
            igstAmount: String(line.igstAmount),
            lineTotal: String(line.lineTotal),
            hsnCode: line.hsnCode,
            receivedQty: '0',
          });
        }

        await trx.insert(outboxEvents).values({
          eventId: ulid(),
          eventType: 'REORDER_PO_CREATED',
          aggregateType: 'PURCHASE_ORDER',
          aggregateId: poId,
          tenantId: params.tenantId,
          payload: { poId, supplierId, itemCount: supplierItems.length },
          published: false,
        });
      }
    });

    return poIds;
  }
}
