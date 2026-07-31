import { eq, and, lt, sql } from 'drizzle-orm';
import { items, stockReservations, projectionStockLevel } from '@erp/db';
import { ERPError } from '@erp/types';
import type { ErpDatabase } from '@erp/db';
import { InsufficientStockError } from './InventoryLedgerService.js';

export interface ReserveParams {
  tenantId: number;
  itemId: number;
  variantId?: number;
  warehouseId: number;
  quantity: number;
  referenceType: string;
  referenceId: number;
  expiresAt: Date;
  createdBy: number;
}

export class ReservationEngine {
  constructor(private readonly db: ErpDatabase) {}

  async reserve(params: ReserveParams, trx?: ErpDatabase): Promise<number> {
    const db = trx ?? this.db;
    const { tenantId, itemId, quantity } = params;

    // Atomic: deduct available, add to reserved
    const result = await db
      .update(items)
      .set({
        availableQty: sql`${items.availableQty} - ${quantity}`,
        reservedQty: sql`${items.reservedQty} + ${quantity}`,
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

    const [reservation] = await db
      .insert(stockReservations)
      .values({
        tenantId: params.tenantId,
        itemId: params.itemId,
        variantId: params.variantId,
        warehouseId: params.warehouseId,
        quantity: String(params.quantity),
        status: 'ACTIVE',
        referenceType: params.referenceType,
        referenceId: params.referenceId,
        expiresAt: params.expiresAt,
        createdBy: params.createdBy,
      })
      .returning({ id: stockReservations.id });

    // Update projection
    await this.shiftProjection(
      db,
      params.tenantId,
      params.itemId,
      params.variantId,
      params.warehouseId,
      -quantity,
      quantity
    );

    return reservation!.id;
  }

  async fulfill(reservationId: number, tenantId: number, trx?: ErpDatabase): Promise<void> {
    const db = trx ?? this.db;

    // Atomically claim the row: this UPDATE only matches (and thus only takes effect) if the
    // reservation is still ACTIVE. Two concurrent fulfill()/release() calls on the same
    // reservation (retry, double-click, or an expireStale() run racing a real fulfill) serialize
    // on Postgres's row lock; whichever commits second finds the WHERE no longer matches and
    // claims nothing — previously this used a plain SELECT-then-UPDATE with no status guard in
    // the WHERE clause, so both could pass the check and both double-apply the reservedQty
    // shift (same race class fixed elsewhere in StockAdjustmentService/StockTransferService).
    const [claimed] = await db
      .update(stockReservations)
      .set({ status: 'FULFILLED', fulfilledAt: new Date(), updatedAt: new Date() })
      .where(
        and(
          eq(stockReservations.id, reservationId),
          eq(stockReservations.tenantId, tenantId),
          eq(stockReservations.status, 'ACTIVE')
        )
      )
      .returning();

    if (!claimed) {
      const [current] = await db
        .select()
        .from(stockReservations)
        .where(
          and(eq(stockReservations.id, reservationId), eq(stockReservations.tenantId, tenantId))
        );
      if (!current) throw new ERPError('RESERVATION_NOT_FOUND', 'Reservation not found', 404);
      throw new ERPError('RESERVATION_NOT_ACTIVE', `Reservation is ${current.status}`, 409);
    }

    const qty = parseFloat(claimed.quantity);

    await db
      .update(items)
      .set({
        reservedQty: sql`${items.reservedQty} - ${qty}`,
        version: sql`${items.version} + 1`,
        updatedAt: new Date(),
      })
      .where(and(eq(items.id, claimed.itemId), eq(items.tenantId, tenantId)));

    await this.shiftProjection(
      db,
      tenantId,
      claimed.itemId,
      claimed.variantId ?? undefined,
      claimed.warehouseId,
      0,
      -qty
    );
  }

  async release(
    reservationId: number,
    tenantId: number,
    reason: string,
    trx?: ErpDatabase
  ): Promise<void> {
    const db = trx ?? this.db;

    // Same atomic-claim pattern as fulfill() above.
    const [claimed] = await db
      .update(stockReservations)
      .set({
        status: 'RELEASED',
        releasedAt: new Date(),
        releaseReason: reason,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(stockReservations.id, reservationId),
          eq(stockReservations.tenantId, tenantId),
          eq(stockReservations.status, 'ACTIVE')
        )
      )
      .returning();

    if (!claimed) {
      const [current] = await db
        .select()
        .from(stockReservations)
        .where(
          and(eq(stockReservations.id, reservationId), eq(stockReservations.tenantId, tenantId))
        );
      if (!current) throw new ERPError('RESERVATION_NOT_FOUND', 'Reservation not found', 404);
      throw new ERPError('RESERVATION_NOT_ACTIVE', `Reservation is ${current.status}`, 409);
    }

    const qty = parseFloat(claimed.quantity);

    // Restore available_qty, decrease reserved_qty
    await db
      .update(items)
      .set({
        availableQty: sql`${items.availableQty} + ${qty}`,
        reservedQty: sql`${items.reservedQty} - ${qty}`,
        version: sql`${items.version} + 1`,
        updatedAt: new Date(),
      })
      .where(and(eq(items.id, claimed.itemId), eq(items.tenantId, tenantId)));

    await this.shiftProjection(
      db,
      tenantId,
      claimed.itemId,
      claimed.variantId ?? undefined,
      claimed.warehouseId,
      qty,
      -qty
    );
  }

  async expireStale(db: ErpDatabase): Promise<number> {
    const now = new Date();
    const expiredReservations = await db
      .select()
      .from(stockReservations)
      .where(and(eq(stockReservations.status, 'ACTIVE'), lt(stockReservations.expiresAt, now)));

    for (const r of expiredReservations) {
      await this.release(r.id, r.tenantId, 'EXPIRED', db);
      await db
        .update(stockReservations)
        .set({ status: 'EXPIRED' })
        .where(eq(stockReservations.id, r.id));
    }

    return expiredReservations.length;
  }

  private async shiftProjection(
    db: ErpDatabase,
    tenantId: number,
    itemId: number,
    variantId: number | undefined,
    warehouseId: number,
    availableDelta: number,
    reservedDelta: number
  ): Promise<void> {
    await db
      .update(projectionStockLevel)
      .set({
        availableQty: sql`${projectionStockLevel.availableQty} + ${availableDelta}`,
        reservedQty: sql`${projectionStockLevel.reservedQty} + ${reservedDelta}`,
        lastMovementAt: new Date(),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(projectionStockLevel.tenantId, tenantId),
          eq(projectionStockLevel.itemId, itemId),
          eq(projectionStockLevel.warehouseId, warehouseId)
        )
      );
  }
}
