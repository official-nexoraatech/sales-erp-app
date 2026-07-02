import { eq, and, sql } from 'drizzle-orm';
import { stockAdjustments, stockAdjustmentLines, items } from '@erp/db';
import { ERPError } from '@erp/types';
import type { ErpDatabase } from '@erp/db';
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
    adjustmentType: typeof stockAdjustments.$inferInsert['adjustmentType'];
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
          .select({ purchasePrice: items.purchasePrice })
          .from(items)
          .where(and(eq(items.id, l.itemId), eq(items.tenantId, params.tenantId)));

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
    const adj = await this.get(id, tenantId);
    if (!['SUBMITTED', 'PENDING_APPROVAL'].includes(adj.status)) {
      throw new ERPError('INVALID_STATUS', `Adjustment cannot be approved in status ${adj.status}`, 409);
    }

    const lines = await this.db
      .select()
      .from(stockAdjustmentLines)
      .where(eq(stockAdjustmentLines.adjustmentId, id));

    const ledger = new InventoryLedgerService(this.db);

    await this.db.transaction(async (trx) => {
      const db = trx as unknown as ErpDatabase;
      const ledgerTrx = new InventoryLedgerService(db);

      for (const line of lines) {
        await ledgerTrx.adjustStock(
          {
            tenantId,
            itemId: line.itemId,
            ...(line.variantId != null ? { variantId: line.variantId } : {}),
            warehouseId: adj.warehouseId,
            quantity: parseFloat(line.quantity),
            direction: line.direction,
            referenceType: 'STOCK_ADJUSTMENT',
            referenceId: id,
            referenceLineId: line.id,
            ...(line.unitCost ? { unitCost: parseFloat(line.unitCost) } : {}),
            createdBy: userId,
            notes: `Adj ${adj.adjustmentNumber}: ${adj.adjustmentType}`,
          },
          db
        );
      }

      await db
        .update(stockAdjustments)
        .set({
          status: 'APPROVED',
          approvedBy: userId,
          approvedAt: new Date(),
          version: sql`${stockAdjustments.version} + 1`,
          updatedAt: new Date(),
        })
        .where(eq(stockAdjustments.id, id));
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
}
