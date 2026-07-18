import { eq, and, sql, inArray, getTableColumns } from 'drizzle-orm';
import { aliasedTable } from 'drizzle-orm/alias';
import { stockTransfers, stockTransferLines, warehouses, items } from '@erp/db';
import { ERPError } from '@erp/types';
import type { ErpDatabase } from '@erp/db';
import { InventoryLedgerService } from './InventoryLedgerService.js';

type TransferStatus = (typeof stockTransfers.$inferSelect)['status'];

function nextTransferNumber(tenantId: number): string {
  return `TRF-${tenantId}-${Date.now()}`;
}

export class StockTransferService {
  private readonly ledger: InventoryLedgerService;

  constructor(private readonly db: ErpDatabase) {
    this.ledger = new InventoryLedgerService(db);
  }

  async create(params: {
    tenantId: number;
    fromWarehouseId: number;
    toWarehouseId: number;
    lines: Array<{
      itemId: number;
      variantId?: number;
      requestedQty: number;
      unitCost?: number;
      notes?: string;
    }>;
    notes?: string;
    createdBy: number;
  }) {
    return this.db.transaction(async (trx) => {
      const [transfer] = await trx
        .insert(stockTransfers)
        .values({
          tenantId: params.tenantId,
          transferNumber: nextTransferNumber(params.tenantId),
          fromWarehouseId: params.fromWarehouseId,
          toWarehouseId: params.toWarehouseId,
          status: 'DRAFT',
          notes: params.notes,
          requestedBy: params.createdBy,
          createdBy: params.createdBy,
        })
        .returning();

      const lineRows = params.lines.map((l) => ({
        tenantId: params.tenantId,
        transferId: transfer!.id,
        itemId: l.itemId,
        ...(l.variantId !== undefined ? { variantId: l.variantId } : {}),
        requestedQty: String(l.requestedQty),
        ...(l.unitCost !== undefined ? { unitCost: String(l.unitCost) } : {}),
        ...(l.notes !== undefined ? { notes: l.notes } : {}),
      }));

      await trx.insert(stockTransferLines).values(lineRows);
      return transfer!;
    });
  }

  async update(
    id: number,
    tenantId: number,
    params: {
      lines?: Array<{
        itemId: number;
        variantId?: number;
        requestedQty: number;
        unitCost?: number;
        notes?: string;
      }>;
      notes?: string;
    }
  ) {
    const transfer = await this.get(id, tenantId);
    if (transfer.status !== 'DRAFT') {
      throw new ERPError('INVALID_STATUS', 'Transfer must be DRAFT to update', 409);
    }

    return this.db.transaction(async (trx) => {
      const db = trx as unknown as ErpDatabase;

      if (params.notes !== undefined) {
        await db
          .update(stockTransfers)
          .set({
            notes: params.notes,
            version: sql`${stockTransfers.version} + 1`,
            updatedAt: new Date(),
          })
          .where(and(eq(stockTransfers.id, id), eq(stockTransfers.tenantId, tenantId)));
      }

      if (params.lines !== undefined) {
        await db.delete(stockTransferLines).where(eq(stockTransferLines.transferId, id));

        const lineRows = params.lines.map((l) => ({
          tenantId,
          transferId: id,
          itemId: l.itemId,
          ...(l.variantId !== undefined ? { variantId: l.variantId } : {}),
          requestedQty: String(l.requestedQty),
          ...(l.unitCost !== undefined ? { unitCost: String(l.unitCost) } : {}),
          ...(l.notes !== undefined ? { notes: l.notes } : {}),
        }));

        await db.insert(stockTransferLines).values(lineRows);
      }

      return this.get(id, tenantId);
    });
  }

  async submit(id: number, tenantId: number, _userId: number) {
    return this.transitionStatus(id, tenantId, 'DRAFT', 'SUBMITTED', {});
  }

  async approve(id: number, tenantId: number, userId: number) {
    return this.transitionStatus(id, tenantId, 'SUBMITTED', 'APPROVED', {
      approvedBy: userId,
      approvedAt: new Date(),
    });
  }

  async dispatch(id: number, tenantId: number, userId: number) {
    const lines = await this.db
      .select()
      .from(stockTransferLines)
      .where(eq(stockTransferLines.transferId, id));

    await this.db.transaction(async (trx) => {
      const db = trx as unknown as ErpDatabase;

      // Atomically claim the row (see StockAdjustmentService.approve() for the same
      // pattern/rationale): a double-click or two concurrent dispatch() calls on the same
      // transfer must not both pass this check and both deduct stock from the source
      // warehouse for one physical dispatch.
      const [claimed] = await db
        .update(stockTransfers)
        .set({
          status: 'DISPATCHED',
          dispatchedBy: userId,
          dispatchedAt: new Date(),
          version: sql`${stockTransfers.version} + 1`,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(stockTransfers.id, id),
            eq(stockTransfers.tenantId, tenantId),
            eq(stockTransfers.status, 'APPROVED')
          )
        )
        .returning();

      if (!claimed) {
        const [current] = await db
          .select()
          .from(stockTransfers)
          .where(and(eq(stockTransfers.id, id), eq(stockTransfers.tenantId, tenantId)));
        if (!current) throw new ERPError('TRANSFER_NOT_FOUND', 'Transfer not found', 404);
        throw new ERPError(
          'INVALID_STATUS',
          `Cannot dispatch transfer in status ${current.status}`,
          409
        );
      }

      for (const line of lines) {
        await new InventoryLedgerService(db).deductStock({
          tenantId,
          itemId: line.itemId,
          ...(line.variantId != null ? { variantId: line.variantId } : {}),
          warehouseId: claimed.fromWarehouseId,
          quantity: parseFloat(line.requestedQty),
          referenceType: 'STOCK_TRANSFER',
          referenceId: id,
          referenceLineId: line.id,
          ...(line.unitCost ? { unitCost: parseFloat(line.unitCost) } : {}),
          createdBy: userId,
          notes: `Dispatch: transfer ${claimed.transferNumber}`,
        });

        await db
          .update(stockTransferLines)
          .set({ dispatchedQty: line.requestedQty, updatedAt: new Date() })
          .where(eq(stockTransferLines.id, line.id));
      }
    });

    return this.get(id, tenantId);
  }

  async receive(
    id: number,
    tenantId: number,
    userId: number,
    lineUpdates: Array<{ lineId: number; receivedQty: number }>
  ) {
    await this.db.transaction(async (trx) => {
      const db = trx as unknown as ErpDatabase;

      // Atomically claim the row (see StockAdjustmentService.approve() for the same
      // pattern/rationale): a double-click or two concurrent receive() calls on the same
      // transfer must not both pass this check and both credit stock into the destination
      // warehouse for one physical receipt.
      const [claimed] = await db
        .update(stockTransfers)
        .set({
          status: 'RECEIVED',
          receivedBy: userId,
          receivedAt: new Date(),
          version: sql`${stockTransfers.version} + 1`,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(stockTransfers.id, id),
            eq(stockTransfers.tenantId, tenantId),
            inArray(stockTransfers.status, ['DISPATCHED', 'IN_TRANSIT'])
          )
        )
        .returning();

      if (!claimed) {
        const [current] = await db
          .select()
          .from(stockTransfers)
          .where(and(eq(stockTransfers.id, id), eq(stockTransfers.tenantId, tenantId)));
        if (!current) throw new ERPError('TRANSFER_NOT_FOUND', 'Transfer not found', 404);
        throw new ERPError(
          'INVALID_STATUS',
          `Cannot receive transfer in status ${current.status}`,
          409
        );
      }

      for (const upd of lineUpdates) {
        const [line] = await db
          .select()
          .from(stockTransferLines)
          .where(eq(stockTransferLines.id, upd.lineId));

        if (!line || line.tenantId !== tenantId) continue;

        await new InventoryLedgerService(db).addStock({
          tenantId,
          itemId: line.itemId,
          ...(line.variantId != null ? { variantId: line.variantId } : {}),
          warehouseId: claimed.toWarehouseId,
          quantity: upd.receivedQty,
          referenceType: 'STOCK_TRANSFER',
          referenceId: id,
          referenceLineId: line.id,
          ...(line.unitCost ? { unitCost: parseFloat(line.unitCost) } : {}),
          createdBy: userId,
          notes: `Receive: transfer ${claimed.transferNumber}`,
        });

        await db
          .update(stockTransferLines)
          .set({ receivedQty: String(upd.receivedQty), updatedAt: new Date() })
          .where(eq(stockTransferLines.id, upd.lineId));
      }
    });

    return this.get(id, tenantId);
  }

  async cancel(id: number, tenantId: number, userId: number, reason: string) {
    const transfer = await this.get(id, tenantId);
    if (['RECEIVED', 'CANCELLED'].includes(transfer.status)) {
      throw new ERPError(
        'INVALID_STATUS',
        `Cannot cancel transfer in status ${transfer.status}`,
        409
      );
    }

    await this.db
      .update(stockTransfers)
      .set({
        status: 'CANCELLED',
        cancelledBy: userId,
        cancelledAt: new Date(),
        cancellationReason: reason,
        version: sql`${stockTransfers.version} + 1`,
        updatedAt: new Date(),
      })
      .where(and(eq(stockTransfers.id, id), eq(stockTransfers.tenantId, tenantId)));

    return this.get(id, tenantId);
  }

  async get(id: number, tenantId: number) {
    const [transfer] = await this.db
      .select()
      .from(stockTransfers)
      .where(and(eq(stockTransfers.id, id), eq(stockTransfers.tenantId, tenantId)));

    if (!transfer) throw new ERPError('TRANSFER_NOT_FOUND', 'Transfer not found', 404);
    return transfer;
  }

  async getWithLines(id: number, tenantId: number) {
    const transfer = await this.get(id, tenantId);

    // The detail page used to render raw fromWarehouseId/toWarehouseId — same
    // "raw ID instead of name" gap found across Sales/Purchase list pages this session.
    const fromWarehouse = aliasedTable(warehouses, 'from_warehouse');
    const toWarehouse = aliasedTable(warehouses, 'to_warehouse');
    const [names] = await this.db
      .select({ fromWarehouseName: fromWarehouse.name, toWarehouseName: toWarehouse.name })
      .from(stockTransfers)
      .leftJoin(fromWarehouse, eq(stockTransfers.fromWarehouseId, fromWarehouse.id))
      .leftJoin(toWarehouse, eq(stockTransfers.toWarehouseId, toWarehouse.id))
      .where(and(eq(stockTransfers.id, id), eq(stockTransfers.tenantId, tenantId)));

    const lines = await this.db
      .select({ ...getTableColumns(stockTransferLines), itemName: items.name })
      .from(stockTransferLines)
      .leftJoin(items, eq(stockTransferLines.itemId, items.id))
      .where(eq(stockTransferLines.transferId, id));

    return { ...transfer, ...names, lines };
  }

  private async transitionStatus(
    id: number,
    tenantId: number,
    fromStatus: TransferStatus,
    toStatus: TransferStatus,
    extra: Record<string, unknown>
  ) {
    // Same guarded-UPDATE pattern as dispatch()/receive(): the WHERE's status check and the
    // transition happen in one statement, so two concurrent calls can't both pass a
    // separate pre-check and both transition the row.
    const [claimed] = await this.db
      .update(stockTransfers)
      .set({
        status: toStatus,
        ...extra,
        version: sql`${stockTransfers.version} + 1`,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(stockTransfers.id, id),
          eq(stockTransfers.tenantId, tenantId),
          eq(stockTransfers.status, fromStatus)
        )
      )
      .returning();

    if (!claimed) {
      const current = await this.get(id, tenantId);
      throw new ERPError(
        'INVALID_STATUS',
        `Transfer must be ${fromStatus} to transition to ${toStatus}, not ${current.status}`,
        409
      );
    }
    return claimed;
  }
}
