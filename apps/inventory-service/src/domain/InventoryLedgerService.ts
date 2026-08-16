import { eq, and, sql } from 'drizzle-orm';
import { items, inventoryLedger, projectionStockLevel, outboxEvents, warehouses } from '@erp/db';
import { ERPError } from '@erp/types';
import type { ErpDatabase } from '@erp/db';
import { ulid } from 'ulid';
import { ValuationService } from '@erp/sdk';

export interface StockMovementParams {
  tenantId: number;
  itemId: number;
  variantId?: number;
  warehouseId: number;
  quantity: number;
  referenceType?: string;
  referenceId?: number;
  referenceLineId?: number;
  unitCost?: number;
  notes?: string;
  createdBy: number;
}

export class InsufficientStockError extends ERPError {
  constructor(
    public readonly available: number,
    public readonly itemId?: number,
    public readonly requested?: number
  ) {
    super('INSUFFICIENT_STOCK', `Insufficient stock. Available: ${available}`, 409, {
      available,
      itemId,
      requested,
    });
  }
}

export class InventoryLedgerService {
  constructor(private readonly db: ErpDatabase) {}

  async addStock(params: StockMovementParams, trx?: ErpDatabase): Promise<void> {
    const db = trx ?? this.db;
    const { tenantId, itemId, variantId, warehouseId, quantity } = params;

    // Atomic increment: single UPDATE, before/after derived from the returned row
    const result = await db
      .update(items)
      .set({
        availableQty: sql`${items.availableQty} + ${quantity}`,
        version: sql`${items.version} + 1`,
        updatedAt: new Date(),
      })
      .where(and(eq(items.id, itemId), eq(items.tenantId, tenantId)))
      .returning({ availableQty: items.availableQty });

    if (result.length === 0) throw new ERPError('ITEM_NOT_FOUND', 'Item not found', 404);

    const after = parseFloat(result[0]!.availableQty ?? '0');
    const before = after - quantity;

    const ledgerId = await this.writeLedger(db, 'STOCK_IN', before, after, params);
    await ValuationService.applyStockIn(db, {
      tenantId,
      itemId,
      variantId,
      warehouseId,
      quantity,
      unitCost: params.unitCost ?? 0,
      qtyBeforeStockIn: before,
      sourceLedgerId: ledgerId,
    });
    await this.upsertProjection(db, params, quantity, 0);
  }

  async deductStock(params: StockMovementParams, trx?: ErpDatabase): Promise<void> {
    const db = trx ?? this.db;
    const { tenantId, itemId, warehouseId, quantity } = params;

    // Atomic check-and-deduct: single UPDATE with WHERE available_qty >= qty
    const result = await db
      .update(items)
      .set({
        availableQty: sql`${items.availableQty} - ${quantity}`,
        version: sql`${items.version} + 1`,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(items.id, itemId),
          eq(items.tenantId, tenantId),
          sql`${items.availableQty} >= ${quantity}`
        )
      )
      .returning({ availableQty: items.availableQty });

    if (result.length === 0) {
      const [current] = await db
        .select({ availableQty: items.availableQty })
        .from(items)
        .where(and(eq(items.id, itemId), eq(items.tenantId, tenantId)));
      throw new InsufficientStockError(parseFloat(current?.availableQty ?? '0'), itemId, quantity);
    }

    const after = parseFloat(result[0]!.availableQty ?? '0');
    const before = after + quantity;
    const totalCogs = await ValuationService.consumeForStockOut(db, {
      tenantId,
      itemId,
      variantId: params.variantId,
      warehouseId,
      quantity,
    });
    const cogsPerUnit = quantity > 0 ? Math.round((totalCogs / quantity) * 100) / 100 : 0;
    await this.writeLedger(db, 'STOCK_OUT', before, after, params, cogsPerUnit);
    await this.upsertProjection(db, params, -quantity, 0);
  }

  // Returns costImpact: the monetary stock-value change this adjustment caused
  // (positive for a valued excess/IN, negative magnitude = COGS for a shortage/OUT) —
  // callers use this to post a net loss/gain to accounting; see StockAdjustmentService
  // and PhysicalVerificationService.
  async adjustStock(
    params: StockMovementParams & { direction: 'IN' | 'OUT' },
    trx?: ErpDatabase
  ): Promise<{ costImpact: number }> {
    const db = trx ?? this.db;
    const { tenantId, itemId, quantity, direction } = params;
    const delta = direction === 'IN' ? quantity : -quantity;

    // Atomic check-and-adjust: the "don't go negative" invariant is enforced by the
    // WHERE clause, not by an app-level check against a value read before the write.
    const result = await db
      .update(items)
      .set({
        availableQty: sql`${items.availableQty} + ${delta}`,
        version: sql`${items.version} + 1`,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(items.id, itemId),
          eq(items.tenantId, tenantId),
          sql`${items.availableQty} + ${delta} >= 0`
        )
      )
      .returning({ availableQty: items.availableQty });

    if (result.length === 0) {
      const [current] = await db
        .select({ availableQty: items.availableQty })
        .from(items)
        .where(and(eq(items.id, itemId), eq(items.tenantId, tenantId)));
      if (!current) throw new ERPError('ITEM_NOT_FOUND', 'Item not found', 404);
      throw new InsufficientStockError(parseFloat(current.availableQty ?? '0'), itemId, quantity);
    }

    const after = parseFloat(result[0]!.availableQty ?? '0');
    const before = after - delta;

    // Stock adjustments (damage/shortage/theft/excess) and Physical Verification write-offs
    // both funnel through here — previously this only moved availableQty/the ledger/the
    // projection and never touched waccCost/currentStockValue/FIFO layers, so a write-off
    // silently left the book stock value unchanged (WACC-costed items even drifted upward,
    // since the same currentStockValue then divides across a now-smaller quantity) and never
    // decremented a FIFO layer, corrupting later COGS. Excess (IN) is valued like any other
    // stock-in at the adjustment's own unitCost; shortage/damage/etc (OUT) is costed at the
    // item's existing WACC/FIFO basis, exactly like a sale, not at the adjustment's unitCost.
    let cogsPerUnit: number | undefined;
    let costImpact = 0;
    if (direction === 'OUT') {
      const totalCogs = await ValuationService.consumeForStockOut(db, {
        tenantId,
        itemId,
        variantId: params.variantId,
        warehouseId: params.warehouseId,
        quantity,
      });
      cogsPerUnit = quantity > 0 ? Math.round((totalCogs / quantity) * 100) / 100 : 0;
      costImpact = -totalCogs;
    }

    const ledgerId = await this.writeLedger(db, 'ADJUSTMENT', before, after, params, cogsPerUnit);

    if (direction === 'IN') {
      const unitCost = params.unitCost ?? 0;
      await ValuationService.applyStockIn(db, {
        tenantId,
        itemId,
        variantId: params.variantId,
        warehouseId: params.warehouseId,
        quantity,
        unitCost,
        qtyBeforeStockIn: before,
        sourceLedgerId: ledgerId,
      });
      costImpact = unitCost > 0 ? quantity * unitCost : 0;
    }

    await this.upsertProjection(db, params, delta, 0);
    return { costImpact };
  }

  async transferStock(
    fromParams: StockMovementParams,
    toWarehouseId: number,
    trx?: ErpDatabase
  ): Promise<void> {
    const db = trx ?? this.db;
    const { tenantId, itemId, quantity } = fromParams;

    // Deduct from source (atomic)
    const deductResult = await db
      .update(items)
      .set({
        availableQty: sql`${items.availableQty} - ${quantity}`,
        version: sql`${items.version} + 1`,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(items.id, itemId),
          eq(items.tenantId, tenantId),
          sql`${items.availableQty} >= ${quantity}`
        )
      )
      .returning({ availableQty: items.availableQty });

    if (deductResult.length === 0) {
      const [current] = await db
        .select({ availableQty: items.availableQty })
        .from(items)
        .where(and(eq(items.id, itemId), eq(items.tenantId, tenantId)));
      throw new InsufficientStockError(parseFloat(current?.availableQty ?? '0'), itemId, quantity);
    }

    const afterDeduct = parseFloat(deductResult[0]!.availableQty ?? '0');
    const beforeDeduct = afterDeduct + quantity;

    // Write TRANSFER_OUT to source warehouse ledger
    await this.writeLedger(db, 'TRANSFER_OUT', beforeDeduct, afterDeduct, {
      ...fromParams,
      notes: `Transfer to warehouse ${toWarehouseId}`,
    });

    // Write TRANSFER_IN to destination warehouse ledger (global qty unchanged, just warehouse moves)
    await this.writeLedger(db, 'TRANSFER_IN', afterDeduct, afterDeduct, {
      ...fromParams,
      warehouseId: toWarehouseId,
      notes: `Transfer from warehouse ${fromParams.warehouseId}`,
    });

    // Update projections
    await this.upsertProjection(db, fromParams, -quantity, 0);
    await this.upsertProjection(db, { ...fromParams, warehouseId: toWarehouseId }, quantity, 0);
  }

  private async writeLedger(
    db: ErpDatabase,
    movementType: (typeof inventoryLedger.$inferInsert)['movementType'],
    quantityBefore: number,
    quantityAfter: number,
    params: StockMovementParams,
    cogsPerUnit?: number
  ): Promise<number> {
    const [row] = await db
      .insert(inventoryLedger)
      .values({
        tenantId: params.tenantId,
        itemId: params.itemId,
        variantId: params.variantId,
        warehouseId: params.warehouseId,
        movementType,
        quantity: String(Math.abs(quantityAfter - quantityBefore)),
        quantityBefore: String(quantityBefore),
        quantityAfter: String(quantityAfter),
        referenceType: params.referenceType,
        referenceId: params.referenceId,
        referenceLineId: params.referenceLineId,
        unitCost: params.unitCost ? String(params.unitCost) : undefined,
        cogsPerUnit: cogsPerUnit !== undefined ? String(cogsPerUnit) : undefined,
        notes: params.notes,
        createdBy: params.createdBy,
      })
      .returning({ id: inventoryLedger.id });
    return row!.id;
  }

  private async upsertProjection(
    db: ErpDatabase,
    params: StockMovementParams,
    availableDelta: number,
    reservedDelta: number
  ): Promise<void> {
    const [row] = await db
      .insert(projectionStockLevel)
      .values({
        tenantId: params.tenantId,
        itemId: params.itemId,
        variantId: params.variantId,
        warehouseId: params.warehouseId,
        availableQty: String(Math.max(0, availableDelta)),
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
          availableQty: sql`projection_stock_level.available_qty + ${availableDelta}`,
          reservedQty: sql`projection_stock_level.reserved_qty + ${reservedDelta}`,
          lastMovementAt: new Date(),
          updatedAt: new Date(),
        },
      })
      .returning({ availableQty: projectionStockLevel.availableQty });

    await this.publishStockLevelChanged(db, params, parseFloat(row!.availableQty));
  }

  // Feeds search-service's 'stock' entity (per-warehouse stock level). Every stock movement
  // funnels through upsertProjection, so this is the one place that needs to publish an event
  // rather than every GRN/invoice/adjustment/transfer route doing it individually — see
  // eventEntityMap.ts's STOCK_LEVEL_CHANGED mapping for the consumer side.
  private async publishStockLevelChanged(
    db: ErpDatabase,
    params: StockMovementParams,
    quantity: number
  ): Promise<void> {
    const [item] = await db
      .select({ name: items.name, itemCode: items.itemCode })
      .from(items)
      .where(and(eq(items.id, params.itemId), eq(items.tenantId, params.tenantId)));
    const [warehouse] = await db
      .select({ name: warehouses.name })
      .from(warehouses)
      .where(and(eq(warehouses.id, params.warehouseId), eq(warehouses.tenantId, params.tenantId)));

    await db.insert(outboxEvents).values({
      eventId: ulid(),
      eventType: 'STOCK_LEVEL_CHANGED',
      aggregateType: 'Stock',
      aggregateId: params.itemId,
      tenantId: params.tenantId,
      payload: {
        itemId: params.itemId,
        warehouseId: params.warehouseId,
        variantId: params.variantId,
        itemName: item?.name,
        sku: item?.itemCode,
        warehouse: warehouse?.name,
        quantity,
      },
    });
  }
}
