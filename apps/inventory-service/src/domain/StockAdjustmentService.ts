import { eq, and, sql, inArray, getTableColumns } from 'drizzle-orm';
import { stockAdjustments, stockAdjustmentLines, items, outboxEvents, warehouses } from '@erp/db';
import { ERPError, BusinessError } from '@erp/types';
import type { ErpDatabase } from '@erp/db';
import { ulid } from 'ulid';
import { InventoryLedgerService } from './InventoryLedgerService.js';

const APPROVAL_THRESHOLD = 50_000; // ₹ — adjustments above this require approval

function nextAdjNumber(tenantId: number): string {
  return `ADJ-${tenantId}-${Date.now()}`;
}

export class StockAdjustmentService {
  constructor(private readonly db: ErpDatabase) {}

  async create(params: {
    tenantId: number;
    warehouseId: number;
    adjustmentType: (typeof stockAdjustments.$inferInsert)['adjustmentType'];
    lines: Array<{
      itemId: number;
      variantId?: number;
      direction: 'IN' | 'OUT';
      quantity: number;
      unitCost?: number;
      reason?: string;
    }>;
    notes?: string;
    createdBy: number;
  }) {
    return this.db.transaction(async (trx) => {
      const db = trx as unknown as ErpDatabase;

      let totalValue = 0;
      const lineRows = [];

      for (const l of params.lines) {
        const [item] = await db
          .select({
            purchasePrice: items.purchasePrice,
            status: items.status,
            deletedAt: items.deletedAt,
          })
          .from(items)
          .where(and(eq(items.id, l.itemId), eq(items.tenantId, params.tenantId)));

        // Previously unchecked anywhere — a DISCONTINUED or soft-deleted item could still be
        // adjusted, undermining the whole point of discontinuing/deleting it.
        if (!item || item.deletedAt || item.status === 'DISCONTINUED') {
          throw new BusinessError(
            'ITEM_NOT_TRANSACTABLE',
            `Item ${l.itemId} is discontinued or deleted and cannot be adjusted`
          );
        }

        const [currentStock] = await db
          .select({ availableQty: items.availableQty })
          .from(items)
          .where(and(eq(items.id, l.itemId), eq(items.tenantId, params.tenantId)));

        const cost = l.unitCost ?? parseFloat(item?.purchasePrice ?? '0');
        const lineValue = cost * l.quantity;
        totalValue += lineValue;

        lineRows.push({
          tenantId: params.tenantId,
          adjustmentId: 0, // filled after insert below
          itemId: l.itemId,
          ...(l.variantId !== undefined ? { variantId: l.variantId } : {}),
          direction: l.direction,
          quantity: String(l.quantity),
          systemQty: currentStock?.availableQty ?? '0',
          unitCost: String(cost),
          lineValue: String(lineValue),
          ...(l.reason !== undefined ? { reason: l.reason } : {}),
        });
      }

      const [adj] = await db
        .insert(stockAdjustments)
        .values({
          tenantId: params.tenantId,
          adjustmentNumber: nextAdjNumber(params.tenantId),
          warehouseId: params.warehouseId,
          adjustmentType: params.adjustmentType,
          status: 'DRAFT',
          totalValue: String(totalValue),
          notes: params.notes,
          createdBy: params.createdBy,
        })
        .returning();

      await db
        .insert(stockAdjustmentLines)
        .values(lineRows.map((r) => ({ ...r, adjustmentId: adj!.id })));

      return adj!;
    });
  }

  async submit(id: number, tenantId: number, userId: number) {
    const adj = await this.get(id, tenantId);
    if (adj.status !== 'DRAFT') {
      throw new ERPError('INVALID_STATUS', `Adjustment must be DRAFT to submit`, 409);
    }

    const needsApproval = parseFloat(adj.totalValue) > APPROVAL_THRESHOLD;

    await this.db
      .update(stockAdjustments)
      .set({
        status: needsApproval ? 'PENDING_APPROVAL' : 'SUBMITTED',
        submittedBy: userId,
        submittedAt: new Date(),
        version: sql`${stockAdjustments.version} + 1`,
        updatedAt: new Date(),
      })
      .where(and(eq(stockAdjustments.id, id), eq(stockAdjustments.tenantId, tenantId)));

    return this.get(id, tenantId);
  }

  async approve(id: number, tenantId: number, userId: number) {
    const lines = await this.db
      .select()
      .from(stockAdjustmentLines)
      .where(eq(stockAdjustmentLines.adjustmentId, id));

    await this.db.transaction(async (trx) => {
      const db = trx as unknown as ErpDatabase;

      // Atomically claim the row: this UPDATE only matches (and thus only takes effect) if
      // the adjustment is still in an approvable status. Two concurrent approve() calls on
      // the same adjustment serialize on Postgres's row lock; whichever commits second finds
      // the WHERE no longer matches and claims nothing — this closes a check-then-act race
      // the previous get()-then-update() pattern had, which could double-apply the ledger
      // lines below for one physical adjustment.
      const [claimed] = await db
        .update(stockAdjustments)
        .set({
          status: 'APPROVED',
          approvedBy: userId,
          approvedAt: new Date(),
          version: sql`${stockAdjustments.version} + 1`,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(stockAdjustments.id, id),
            eq(stockAdjustments.tenantId, tenantId),
            inArray(stockAdjustments.status, ['SUBMITTED', 'PENDING_APPROVAL'])
          )
        )
        .returning();

      if (!claimed) {
        const [current] = await db
          .select()
          .from(stockAdjustments)
          .where(and(eq(stockAdjustments.id, id), eq(stockAdjustments.tenantId, tenantId)));
        if (!current) throw new ERPError('ADJUSTMENT_NOT_FOUND', 'Adjustment not found', 404);
        throw new ERPError(
          'INVALID_STATUS',
          `Adjustment cannot be approved in status ${current.status}`,
          409
        );
      }

      const ledgerTrx = new InventoryLedgerService(db);
      let netCostImpact = 0;
      for (const line of lines) {
        const { costImpact } = await ledgerTrx.adjustStock(
          {
            tenantId,
            itemId: line.itemId,
            ...(line.variantId != null ? { variantId: line.variantId } : {}),
            warehouseId: claimed.warehouseId,
            quantity: parseFloat(line.quantity),
            direction: line.direction,
            referenceType: 'STOCK_ADJUSTMENT',
            referenceId: id,
            referenceLineId: line.id,
            ...(line.unitCost ? { unitCost: parseFloat(line.unitCost) } : {}),
            createdBy: userId,
            notes: `Adj ${claimed.adjustmentNumber}: ${claimed.adjustmentType}`,
          },
          db
        );
        netCostImpact += costImpact;
      }

      // Post the net stock write-off/write-on to accounting — previously a Stock Adjustment
      // approval never emitted any event at all, so damage/shortage/excess never reached the
      // P&L or reduced the Inventory Asset account (PostingMatrixService's STOCK_ADJUSTMENT_LOSS
      // rule existed but nothing ever triggered it).
      if (Math.abs(netCostImpact) > 0.001) {
        await db.insert(outboxEvents).values({
          eventId: ulid(),
          eventType: 'STOCK_ADJUSTMENT_POSTED',
          aggregateType: 'StockAdjustment',
          aggregateId: id,
          tenantId,
          payload: {
            adjustmentId: id,
            adjustmentNumber: claimed.adjustmentNumber,
            adjustmentType: claimed.adjustmentType,
            warehouseId: claimed.warehouseId,
            netValue: String(Math.abs(netCostImpact)),
            direction: netCostImpact < 0 ? 'LOSS' : 'GAIN',
            createdBy: userId,
          },
          published: false,
        });
      }
    });

    return this.get(id, tenantId);
  }

  async cancel(id: number, tenantId: number, userId: number, reason: string) {
    const adj = await this.get(id, tenantId);
    if (adj.status === 'APPROVED' || adj.status === 'CANCELLED') {
      throw new ERPError('INVALID_STATUS', `Cannot cancel adjustment in status ${adj.status}`, 409);
    }

    await this.db
      .update(stockAdjustments)
      .set({
        status: 'CANCELLED',
        cancelledBy: userId,
        cancelledAt: new Date(),
        cancellationReason: reason,
        version: sql`${stockAdjustments.version} + 1`,
        updatedAt: new Date(),
      })
      .where(and(eq(stockAdjustments.id, id), eq(stockAdjustments.tenantId, tenantId)));

    return this.get(id, tenantId);
  }

  async get(id: number, tenantId: number) {
    const [adj] = await this.db
      .select()
      .from(stockAdjustments)
      .where(and(eq(stockAdjustments.id, id), eq(stockAdjustments.tenantId, tenantId)));
    if (!adj) throw new ERPError('ADJUSTMENT_NOT_FOUND', 'Adjustment not found', 404);
    return adj;
  }

  // Stock Adjustments previously had no detail page at all, so this never mattered — now that
  // one exists, resolve warehouse/item names rather than showing raw ids (same "raw ID instead
  // of name" gap already fixed for stock transfers).
  async getWithLines(id: number, tenantId: number) {
    const adj = await this.get(id, tenantId);

    const [warehouse] = await this.db
      .select({ name: warehouses.name })
      .from(warehouses)
      .where(and(eq(warehouses.id, adj.warehouseId), eq(warehouses.tenantId, tenantId)));

    const lines = await this.db
      .select({ ...getTableColumns(stockAdjustmentLines), itemName: items.name })
      .from(stockAdjustmentLines)
      .leftJoin(items, eq(stockAdjustmentLines.itemId, items.id))
      .where(eq(stockAdjustmentLines.adjustmentId, id));

    return { ...adj, warehouseName: warehouse?.name, lines };
  }
}
