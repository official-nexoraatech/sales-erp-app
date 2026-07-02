import { eq, and, sql } from 'drizzle-orm';
import { items, inventoryLedger, projectionStockLevel } from '@erp/db';
import { ERPError } from '@erp/types';
import type { ErpDatabase } from '@erp/db';

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
  constructor(public readonly available: number) {
    super('INSUFFICIENT_STOCK', `Insufficient stock. Available: ${available}`, 409);
  }
}

export class InventoryLedgerService {
  constructor(private readonly db: ErpDatabase) {}

  async addStock(params: StockMovementParams, trx?: ErpDatabase): Promise<void> {
    const db = trx ?? this.db;
    const { tenantId, itemId, variantId, warehouseId, quantity } = params;

    const [current] = await db
      .select({ availableQty: items.availableQty })
      .from(items)
      .where(and(eq(items.id, itemId), eq(items.tenantId, tenantId)));

    if (!current) throw new ERPError('ITEM_NOT_FOUND', 'Item not found', 404);

    const before = parseFloat(current.availableQty ?? '0');
    const after = before + quantity;

    await db
      .update(items)
      .set({
        availableQty: String(after),
        version: sql`${items.version} + 1`,
        updatedAt: new Date(),
      })
      .where(and(eq(items.id, itemId), eq(items.tenantId, tenantId)));

    await this.writeLedger(db, 'STOCK_IN', before, after, params);
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
      throw new InsufficientStockError(parseFloat(current?.availableQty ?? '0'));
    }

    const after = parseFloat(result[0]!.availableQty ?? '0');
    const before = after + quantity;
    await this.writeLedger(db, 'STOCK_OUT', before, after, params);
    await this.upsertProjection(db, params, -quantity, 0);
  }

  async adjustStock(
    params: StockMovementParams & { direction: 'IN' | 'OUT' },
    trx?: ErpDatabase
  ): Promise<void> {
    const db = trx ?? this.db;
    const { tenantId, itemId, quantity, direction } = params;
    const delta = direction === 'IN' ? quantity : -quantity;

    const [current] = await db
      .select({ availableQty: items.availableQty })
      .from(items)
      .where(and(eq(items.id, itemId), eq(items.tenantId, tenantId)));

    if (!current) throw new ERPError('ITEM_NOT_FOUND', 'Item not found', 404);

    const before = parseFloat(current.availableQty ?? '0');
    const after = before + delta;

    if (after < 0) throw new InsufficientStockError(before);

    await db
      .update(items)
      .set({
        availableQty: String(after),
        version: sql`${items.version} + 1`,
        updatedAt: new Date(),
      })
      .where(and(eq(items.id, itemId), eq(items.tenantId, tenantId)));

    await this.writeLedger(db, 'ADJUSTMENT', before, after, params);
    await this.upsertProjection(db, params, delta, 0);
  }

  async transferStock(
    fromParams: StockMovementParams,
    toWarehouseId: number,
    trx?: ErpDatabase
  ): Promise<void> {
    const db = trx ?? this.db;
    const { tenantId, itemId, variantId, quantity, referenceType, referenceId, createdBy } =
      fromParams;

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
      throw new InsufficientStockError(parseFloat(current?.availableQty ?? '0'));
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
    movementType: typeof inventoryLedger.$inferInsert['movementType'],
    quantityBefore: number,
    quantityAfter: number,
    params: StockMovementParams
  ): Promise<void> {
    await db.insert(inventoryLedger).values({
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
      notes: params.notes,
      createdBy: params.createdBy,
    });
  }

  private async upsertProjection(
    db: ErpDatabase,
    params: StockMovementParams,
    availableDelta: number,
    reservedDelta: number
  ): Promise<void> {
    await db
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
      });
  }
}
