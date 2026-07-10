import { and, asc, eq, sql } from 'drizzle-orm';
import { items, inventoryFifoLayers } from '@erp/db';
import { StockInsufficientForCostingError } from '@erp/types';
import type { ErpDatabase } from '@erp/db';

export interface StockOutValuationParams {
  tenantId: number;
  itemId: number;
  warehouseId: number;
  quantity: number;
}

// ES-13: FIFO / WACC COGS lookup for STOCK_OUT movements. sales-service writes
// invoice stock-outs directly to the shared @erp/db schema inside its own
// transaction (see ES-03 completion report), so this is duplicated from
// inventory-service's ValuationService rather than imported across the service
// boundary — matching how GSTCalculator is duplicated per-service already.
export class ValuationService {
  static async consumeForStockOut(db: ErpDatabase, params: StockOutValuationParams): Promise<number> {
    const { tenantId, itemId, warehouseId, quantity } = params;

    // SELECT ... FOR UPDATE: this was ES-13's original intended design (see
    // ERP-PLANNING/audit-phase-prompts/ES-13-INVENTORY-VALUATION-FIFO-WACC.md) but
    // was dropped during implementation. Without it, two concurrent stock-outs on
    // the same item read the same stale currentStockValue/waccCost and the second
    // write clobbers the first's update. The row lock is held until the enclosing
    // transaction commits, so it also protects any UPDATE below (this method's own
    // or the caller's atomic items.availableQty decrement).
    const [item] = await db
      .select({
        costingMethod: items.costingMethod,
        waccCost: items.waccCost,
        currentStockValue: items.currentStockValue,
      })
      .from(items)
      .where(and(eq(items.id, itemId), eq(items.tenantId, tenantId)))
      .for('update');
    if (!item) return 0;

    if (item.costingMethod === 'FIFO') {
      return ValuationService.consumeFifoLayers(db, tenantId, itemId, warehouseId, quantity);
    }

    const waccCost = parseFloat(String(item.waccCost));
    const totalCogs = Math.round(quantity * waccCost * 100) / 100;
    const currentValue = parseFloat(String(item.currentStockValue));
    await db
      .update(items)
      .set({ currentStockValue: String(Math.max(0, currentValue - totalCogs)) })
      .where(and(eq(items.id, itemId), eq(items.tenantId, tenantId)));
    return totalCogs;
  }

  private static async consumeFifoLayers(
    db: ErpDatabase,
    tenantId: number,
    itemId: number,
    warehouseId: number,
    quantity: number
  ): Promise<number> {
    // FOR UPDATE: locks every candidate layer row up front so a concurrent consumer
    // targeting the same layers can't select the same stale remainingQty snapshot —
    // it blocks here until this transaction commits, then re-reads the real values.
    const layers = await db
      .select()
      .from(inventoryFifoLayers)
      .where(
        and(
          eq(inventoryFifoLayers.tenantId, tenantId),
          eq(inventoryFifoLayers.itemId, itemId),
          eq(inventoryFifoLayers.warehouseId, warehouseId),
          sql`${inventoryFifoLayers.remainingQty} > 0`
        )
      )
      .orderBy(asc(inventoryFifoLayers.receivedAt))
      .for('update');

    let remainingToConsume = quantity;
    let totalCogs = 0;

    for (const layer of layers) {
      if (remainingToConsume <= 0) break;
      const layerRemaining = parseFloat(String(layer.remainingQty));
      const unitCost = parseFloat(String(layer.unitCost));
      const consume = Math.min(layerRemaining, remainingToConsume);

      await db
        .update(inventoryFifoLayers)
        .set({ remainingQty: String(layerRemaining - consume) })
        .where(eq(inventoryFifoLayers.id, layer.id));

      totalCogs += consume * unitCost;
      remainingToConsume -= consume;
    }

    if (remainingToConsume > 0.0001) {
      throw new StockInsufficientForCostingError(itemId, warehouseId, quantity, quantity - remainingToConsume);
    }

    totalCogs = Math.round(totalCogs * 100) / 100;

    const [item] = await db
      .select({ currentStockValue: items.currentStockValue })
      .from(items)
      .where(and(eq(items.id, itemId), eq(items.tenantId, tenantId)));
    const currentValue = parseFloat(String(item?.currentStockValue ?? '0'));
    await db
      .update(items)
      .set({ currentStockValue: String(Math.max(0, currentValue - totalCogs)) })
      .where(and(eq(items.id, itemId), eq(items.tenantId, tenantId)));

    return totalCogs;
  }
}
