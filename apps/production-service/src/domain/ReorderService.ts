import { and, eq, sql, lte } from 'drizzle-orm';
import {
  items,
  projectionStockLevel,
  purchaseOrders,
  purchaseOrderLines,
  outboxEvents,
} from '@erp/db';
import type { ErpDatabase } from '@erp/db';
import { BusinessError } from '@erp/types';
import { ulid } from 'ulid';

export interface ReorderItem {
  itemId: number;
  itemCode: string | null;
  itemName: string;
  currentQty: number;
  reorderLevel: number;
  reorderQty: number;
  preferredSupplierId?: number | undefined;
  lastPurchaseRate?: number | undefined;
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
    const conditions = [
      eq(items.tenantId, tenantId),
      eq(items.trackInventory, true),
      sql`${items.status} = 'ACTIVE'`,
      lte(items.availableQty, items.reorderLevel),
    ];

    const rows = await this.db
      .select({
        id: items.id,
        itemCode: items.itemCode,
        name: items.name,
        availableQty: items.availableQty,
        reorderLevel: items.reorderLevel,
        reorderQty: items.reorderQty,
      })
      .from(items)
      .where(and(...conditions));

    return rows.map((row) => ({
      itemId: row.id,
      itemCode: row.itemCode,
      itemName: row.name,
      currentQty: parseFloat(String(row.availableQty)),
      reorderLevel: parseFloat(String(row.reorderLevel)),
      reorderQty: parseFloat(String(row.reorderQty)),
    }));
  }

  async createPOsFromReorder(params: CreatePOsFromReorderParams): Promise<number[]> {
    // Group items by supplier
    const bySupplier = new Map<number, typeof params.items>();
    for (const item of params.items) {
      const existing = bySupplier.get(item.supplierId) ?? [];
      existing.push(item);
      bySupplier.set(item.supplierId, existing);
    }

    const poIds: number[] = [];

    await this.db.transaction(async (trx) => {
      for (const [supplierId, supplierItems] of bySupplier) {
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
            subtotal: '0',
            taxableAmount: '0',
            cgstAmount: '0',
            sgstAmount: '0',
            igstAmount: '0',
            grandTotal: '0',
            receivedAmount: '0',
            notes: 'Auto-created from reorder report',
            createdBy: params.createdBy,
          })
          .returning({ id: purchaseOrders.id });

        if (!row) throw new BusinessError('PO_CREATE_FAILED', 'Failed to create purchase order from reorder');
        const poId = row.id;
        poIds.push(poId);

        let grandTotal = 0;
        for (let i = 0; i < supplierItems.length; i++) {
          const item = supplierItems[i];
          if (!item) continue;
          const lineTotal = item.quantity * item.unitPrice;
          grandTotal += lineTotal;

          await trx.insert(purchaseOrderLines).values({
            purchaseOrderId: poId,
            tenantId: params.tenantId,
            lineNumber: i + 1,
            itemId: item.itemId,
            orderedQty: String(item.quantity),
            unitPrice: String(item.unitPrice),
            discountPct: '0',
            discountAmount: '0',
            gstRate: '18',
            cgstRate: '9',
            sgstRate: '9',
            igstRate: '0',
            taxableAmount: String(lineTotal),
            cgstAmount: String(lineTotal * 0.09),
            sgstAmount: String(lineTotal * 0.09),
            igstAmount: '0',
            lineTotal: String(lineTotal * 1.18),
            receivedQty: '0',
          });
        }

        await trx
          .update(purchaseOrders)
          .set({ grandTotal: String(grandTotal * 1.18) })
          .where(eq(purchaseOrders.id, poId));

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
