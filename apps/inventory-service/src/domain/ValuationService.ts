import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import { items, inventoryFifoLayers, inventoryWarehouseValuation } from '@erp/db';
import { StockInsufficientForCostingError } from '@erp/types';
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

export interface StockOutValuationParams {
  tenantId: number;
  itemId: number;
  variantId?: number | undefined;
  warehouseId: number;
  quantity: number;
}

// ES-13: FIFO / WACC costing. Called from within the same DB transaction that
// writes the STOCK_IN/STOCK_OUT inventory_ledger row, right after items.available_qty
// is updated — never as a separate cross-service call (see ES-03 completion report
// on why inventory writes must share the caller's transaction for atomicity).
export class ValuationService {
  static async applyStockIn(db: ErpDatabase, params: StockInValuationParams): Promise<void> {
    const { tenantId, itemId, warehouseId, quantity, unitCost, qtyBeforeStockIn, sourceLedgerId } =
      params;
    if (unitCost <= 0) return; // no real cost data (e.g. reversal STOCK_IN) — nothing to value

    // SELECT ... FOR UPDATE: this was ES-13's original intended design (see
    // ERP-PLANNING/audit-phase-prompts/ES-13-INVENTORY-VALUATION-FIFO-WACC.md) but
    // was dropped during implementation. Without it, two concurrent stock-ins on the
    // same item read the same stale currentStockValue and the second write clobbers
    // the first's WACC update. The row lock is held until the enclosing transaction
    // commits, so it also protects the UPDATE below.
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
      // PG-032: FIFO already gets a warehouse dimension for free via inventory_fifo_layers.warehouse_id
      // (see above). WACC has none — mirror the same recompute, scoped to this warehouse only.
      // items.waccCost above stays the tenant-wide figure; this row tracks per-warehouse divergence.
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

  // Returns the total COGS for `quantity` units, decrementing FIFO layers / the
  // item's running stock value. Caller writes cogsTotal / quantity onto the
  // inventory_ledger row's cogs_per_unit.
  static async consumeForStockOut(
    db: ErpDatabase,
    params: StockOutValuationParams
  ): Promise<number> {
    const { tenantId, itemId, warehouseId, quantity } = params;
    const variantId = params.variantId;

    // SELECT ... FOR UPDATE — see applyStockIn() above for why.
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

    // PG-032: deduct from this warehouse's own tracked WACC row (its own cost basis, which may
    // have diverged from the tenant-wide waccCost above) — not from the tenant-wide figure.
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

  // PG-032: same WACC-recompute formula as applyStockIn's items.waccCost update above, scoped to
  // (item_id, warehouse_id). This table has no independent qty counter — the warehouse's implied
  // qty-before is derived from stockValue / waccCost, since stock_value == qty * wacc_cost by
  // construction after every prior write here (mirrors how items.availableQty / items.waccCost
  // relate, just without a separate qty column since projectionStockLevel already owns qty).
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

  // PG-032: mirrors consumeForStockOut's tenant-wide COGS deduction, using this warehouse's own
  // waccCost instead of items.waccCost. If no per-warehouse row exists yet (pre-backfill, or a
  // stock-out reaching a warehouse with no recorded stock-in) there's nothing to deduct from —
  // the valuation report falls back to the ratio estimate for that combination instead of erroring.
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
      throw new StockInsufficientForCostingError(
        itemId,
        warehouseId,
        quantity,
        quantity - remainingToConsume
      );
    }

    totalCogs = Math.round(totalCogs * 100) / 100;

    // The caller (consumeForStockOut) already holds a FOR UPDATE lock on this same
    // items row from its own read, so this read-then-write is safe within this trx.
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
