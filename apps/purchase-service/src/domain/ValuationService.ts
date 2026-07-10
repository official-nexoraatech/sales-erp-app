import { and, eq } from 'drizzle-orm';
import { items, inventoryFifoLayers } from '@erp/db';
import type { ErpDatabase } from '@erp/db';

export interface StockInValuationParams {
  tenantId: number;
  itemId: number;
  variantId?: number | undefined;
  warehouseId: number;
  quantity: number;
  unitCost: number;
  qtyBeforeStockIn: number;
  sourceLedgerId: number;
  receivedAt?: Date | undefined;
}

// ES-13: FIFO / WACC costing for STOCK_IN movements. purchase-service writes
// GRN stock-ins directly to the shared @erp/db schema inside its own transaction
// (see ES-03 completion report — inventory-service's own copy of this logic
// isn't reachable here without a cross-service call that couldn't roll back with
// this transaction), so the STOCK_IN-side valuation update is duplicated here
// rather than imported from inventory-service, matching how GSTCalculator is
// duplicated per-service in this codebase.
export class ValuationService {
  static async applyStockIn(db: ErpDatabase, params: StockInValuationParams): Promise<void> {
    const { tenantId, itemId, warehouseId, quantity, unitCost, qtyBeforeStockIn, sourceLedgerId } = params;
    if (unitCost <= 0) return;

    // SELECT ... FOR UPDATE: this was ES-13's original intended design (see
    // ERP-PLANNING/audit-phase-prompts/ES-13-INVENTORY-VALUATION-FIFO-WACC.md) but
    // was dropped during implementation. Without it, two concurrent GRN approvals on
    // the same item read the same stale currentStockValue and the second write
    // clobbers the first's WACC update. The row lock is held until the enclosing
    // transaction commits.
    const [item] = await db
      .select({ costingMethod: items.costingMethod, currentStockValue: items.currentStockValue })
      .from(items)
      .where(and(eq(items.id, itemId), eq(items.tenantId, tenantId)))
      .for('update');
    if (!item) return;

    const currentValue = parseFloat(String(item.currentStockValue));
    const newTotalValue = currentValue + quantity * unitCost;
    const newTotalQty = qtyBeforeStockIn + quantity;
    const newWacc = newTotalQty > 0 ? Math.round((newTotalValue / newTotalQty) * 100) / 100 : 0;

    await db
      .update(items)
      .set({ waccCost: String(newWacc), currentStockValue: String(newTotalValue) })
      .where(and(eq(items.id, itemId), eq(items.tenantId, tenantId)));

    if (item.costingMethod === 'FIFO') {
      await db.insert(inventoryFifoLayers).values({
        tenantId,
        itemId,
        variantId: params.variantId,
        warehouseId,
        receivedAt: params.receivedAt ?? new Date(),
        originalQty: String(quantity),
        remainingQty: String(quantity),
        unitCost: String(unitCost),
        sourceLedgerId,
      });
    }
  }
}
