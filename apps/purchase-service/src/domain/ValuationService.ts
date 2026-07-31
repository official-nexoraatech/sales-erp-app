import { and, eq, asc, isNull, sql } from 'drizzle-orm';
import { items, inventoryFifoLayers, inventoryLedger, inventoryWarehouseValuation } from '@erp/db';
import { StockInsufficientForCostingError } from '@erp/types';
import type { ErpDatabase } from '@erp/db';

export interface LandedCostValuationParams {
  tenantId: number;
  itemId: number;
  grnId: number;
  grnLineId: number;
  // Rupee value being added to this line's cost basis — NOT a per-unit cost.
  additionalValue: number;
}

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

export interface StockOutValuationParams {
  tenantId: number;
  itemId: number;
  variantId?: number | undefined;
  warehouseId: number;
  quantity: number;
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
    const { tenantId, itemId, warehouseId, quantity, unitCost, qtyBeforeStockIn, sourceLedgerId } =
      params;
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
    } else {
      // PG-032: same warehouse-scoped WACC row inventory-service's own applyStockIn keeps —
      // previously GRN receipt (this method) never touched it, so it was progressively
      // understated/never-populated for the warehouse that receives the most stock in the
      // whole system, while sales-service's stock-out correctly (now) deducts from it.
      await ValuationService.upsertWarehouseWaccOnStockIn(
        db,
        tenantId,
        itemId,
        params.variantId,
        warehouseId,
        quantity,
        unitCost
      );
    }
  }

  private static warehouseValuationWhere(
    tenantId: number,
    itemId: number,
    variantId: number | undefined,
    warehouseId: number
  ) {
    return variantId === undefined
      ? and(
          eq(inventoryWarehouseValuation.tenantId, tenantId),
          eq(inventoryWarehouseValuation.itemId, itemId),
          eq(inventoryWarehouseValuation.warehouseId, warehouseId),
          isNull(inventoryWarehouseValuation.variantId)
        )
      : and(
          eq(inventoryWarehouseValuation.tenantId, tenantId),
          eq(inventoryWarehouseValuation.itemId, itemId),
          eq(inventoryWarehouseValuation.warehouseId, warehouseId),
          eq(inventoryWarehouseValuation.variantId, variantId)
        );
  }

  private static async upsertWarehouseWaccOnStockIn(
    db: ErpDatabase,
    tenantId: number,
    itemId: number,
    variantId: number | undefined,
    warehouseId: number,
    quantity: number,
    unitCost: number
  ): Promise<void> {
    const [existing] = await db
      .select()
      .from(inventoryWarehouseValuation)
      .where(ValuationService.warehouseValuationWhere(tenantId, itemId, variantId, warehouseId))
      .for('update');

    const priorValue = existing ? parseFloat(String(existing.stockValue)) : 0;
    const priorCost = existing ? parseFloat(String(existing.waccCost)) : 0;
    const priorQty = priorCost > 0 ? priorValue / priorCost : 0;

    const newValue = priorValue + quantity * unitCost;
    const newQty = priorQty + quantity;
    const newWacc = newQty > 0 ? Math.round((newValue / newQty) * 100) / 100 : 0;

    if (existing) {
      await db
        .update(inventoryWarehouseValuation)
        .set({ waccCost: String(newWacc), stockValue: String(newValue), updatedAt: new Date() })
        .where(eq(inventoryWarehouseValuation.id, existing.id));
    } else {
      await db.insert(inventoryWarehouseValuation).values({
        tenantId,
        itemId,
        variantId,
        warehouseId,
        waccCost: String(newWacc),
        stockValue: String(newValue),
      });
    }
  }

  private static async deductWarehouseWaccOnStockOut(
    db: ErpDatabase,
    tenantId: number,
    itemId: number,
    variantId: number | undefined,
    warehouseId: number,
    quantity: number
  ): Promise<void> {
    const [existing] = await db
      .select()
      .from(inventoryWarehouseValuation)
      .where(ValuationService.warehouseValuationWhere(tenantId, itemId, variantId, warehouseId))
      .for('update');
    if (!existing) return;

    const waccCost = parseFloat(String(existing.waccCost));
    const totalCogs = Math.round(quantity * waccCost * 100) / 100;
    const currentValue = parseFloat(String(existing.stockValue));
    await db
      .update(inventoryWarehouseValuation)
      .set({ stockValue: String(Math.max(0, currentValue - totalCogs)), updatedAt: new Date() })
      .where(eq(inventoryWarehouseValuation.id, existing.id));
  }

  // Used by PurchaseReturnService.approve() — goods physically leave to go back to the
  // supplier, so this needs the same COGS-style valuation decrement a sale would apply
  // (previously purchase-service had no STOCK_OUT valuation path at all, so a purchase
  // return silently left waccCost/currentStockValue/FIFO layers untouched forever).
  static async consumeForStockOut(
    db: ErpDatabase,
    params: StockOutValuationParams
  ): Promise<number> {
    const { tenantId, itemId, warehouseId, quantity } = params;
    const variantId = params.variantId;

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

    await ValuationService.deductWarehouseWaccOnStockOut(
      db,
      tenantId,
      itemId,
      variantId,
      warehouseId,
      quantity
    );

    return totalCogs;
  }

  private static async consumeFifoLayers(
    db: ErpDatabase,
    tenantId: number,
    itemId: number,
    warehouseId: number,
    quantity: number
  ): Promise<number> {
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
      throw new StockInsufficientForCostingError(
        itemId,
        warehouseId,
        quantity,
        quantity - remainingToConsume
      );
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

  // LandedCostService.allocate() runs after a GRN is already approved — applyStockIn
  // above has already updated items.waccCost/currentStockValue and created any FIFO
  // layer using only the GRN rate. Without this, a landed cost (freight/customs/etc)
  // allocated afterwards updates grnLines.effectiveUnitCost for display purposes only —
  // the item's actual costing (WACC average, FIFO layer) never reflects it, so COGS and
  // stock valuation understate true cost by the landed cost amount.
  static async applyLandedCostAdjustment(
    db: ErpDatabase,
    params: LandedCostValuationParams
  ): Promise<void> {
    const { tenantId, itemId, grnId, grnLineId, additionalValue } = params;
    if (additionalValue <= 0) return;

    const [item] = await db
      .select({
        costingMethod: items.costingMethod,
        currentStockValue: items.currentStockValue,
        availableQty: items.availableQty,
      })
      .from(items)
      .where(and(eq(items.id, itemId), eq(items.tenantId, tenantId)))
      .for('update');
    if (!item) return;

    const newTotalValue = parseFloat(String(item.currentStockValue)) + additionalValue;
    const availableQty = parseFloat(String(item.availableQty));
    const newWacc = availableQty > 0 ? Math.round((newTotalValue / availableQty) * 100) / 100 : 0;

    await db
      .update(items)
      .set({ waccCost: String(newWacc), currentStockValue: String(newTotalValue) })
      .where(and(eq(items.id, itemId), eq(items.tenantId, tenantId)));

    if (item.costingMethod === 'FIFO') {
      const [ledgerRow] = await db
        .select({ id: inventoryLedger.id })
        .from(inventoryLedger)
        .where(
          and(
            eq(inventoryLedger.tenantId, tenantId),
            eq(inventoryLedger.referenceType, 'GRN'),
            eq(inventoryLedger.referenceId, grnId),
            eq(inventoryLedger.referenceLineId, grnLineId)
          )
        );
      if (!ledgerRow) return;

      const [layer] = await db
        .select({
          id: inventoryFifoLayers.id,
          originalQty: inventoryFifoLayers.originalQty,
          unitCost: inventoryFifoLayers.unitCost,
        })
        .from(inventoryFifoLayers)
        .where(
          and(
            eq(inventoryFifoLayers.tenantId, tenantId),
            eq(inventoryFifoLayers.sourceLedgerId, ledgerRow.id)
          )
        )
        .for('update');
      if (!layer) return;

      const originalQty = parseFloat(String(layer.originalQty));
      if (originalQty <= 0) return;
      const newUnitCost =
        Math.round((parseFloat(String(layer.unitCost)) + additionalValue / originalQty) * 10000) /
        10000;

      await db
        .update(inventoryFifoLayers)
        .set({ unitCost: String(newUnitCost) })
        .where(eq(inventoryFifoLayers.id, layer.id));
    }
  }
}
