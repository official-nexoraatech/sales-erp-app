import { eq, and, sql } from 'drizzle-orm';
import {
  physicalVerifications,
  physicalVerificationLines,
  projectionStockLevel,
  stockAdjustments,
  stockAdjustmentLines,
  items,
} from '@erp/db';
import { ERPError } from '@erp/types';
import type { ErpDatabase } from '@erp/db';
import { InventoryLedgerService } from './InventoryLedgerService.js';

function nextVerifNumber(tenantId: number): string {
  return `PV-${tenantId}-${Date.now()}`;
}

function nextAdjNumber(tenantId: number): string {
  return `ADJ-${tenantId}-${Date.now()}-pv`;
}

export class PhysicalVerificationService {
  constructor(private readonly db: ErpDatabase) {}

  async create(params: {
    tenantId: number;
    warehouseId: number;
    notes?: string;
    createdBy: number;
  }) {
    const [verif] = await this.db
      .insert(physicalVerifications)
      .values({
        tenantId: params.tenantId,
        verificationNumber: nextVerifNumber(params.tenantId),
        warehouseId: params.warehouseId,
        status: 'DRAFT',
        notes: params.notes,
        createdBy: params.createdBy,
      })
      .returning();
    return verif!;
  }

  async startCounting(id: number, tenantId: number, userId: number) {
    const verif = await this.get(id, tenantId);
    if (verif.status !== 'DRAFT') {
      throw new ERPError('INVALID_STATUS', 'Verification must be DRAFT to start counting', 409);
    }

    // Take system quantity snapshot for all items in the warehouse
    const stockSnapshot = await this.db
      .select({
        itemId: projectionStockLevel.itemId,
        variantId: projectionStockLevel.variantId,
        availableQty: projectionStockLevel.availableQty,
      })
      .from(projectionStockLevel)
      .where(
        and(
          eq(projectionStockLevel.tenantId, tenantId),
          eq(projectionStockLevel.warehouseId, verif.warehouseId)
        )
      );

    await this.db.transaction(async (trx) => {
      const db = trx as unknown as ErpDatabase;

      if (stockSnapshot.length > 0) {
        await db.insert(physicalVerificationLines).values(
          stockSnapshot.map((s) => ({
            tenantId,
            verificationId: id,
            itemId: s.itemId,
            variantId: s.variantId,
            systemQty: s.availableQty,
          }))
        );
      }

      await db
        .update(physicalVerifications)
        .set({
          status: 'COUNTING',
          snapshotTakenAt: new Date(),
          countingStartedAt: new Date(),
          version: sql`${physicalVerifications.version} + 1`,
          updatedAt: new Date(),
        })
        .where(eq(physicalVerifications.id, id));
    });

    return this.get(id, tenantId);
  }

  async updateCounts(
    id: number,
    tenantId: number,
    counts: Array<{ lineId: number; physicalQty: number }>
  ) {
    const verif = await this.get(id, tenantId);
    if (verif.status !== 'COUNTING') {
      throw new ERPError('INVALID_STATUS', 'Verification must be in COUNTING status to update counts', 409);
    }

    for (const c of counts) {
      await this.db
        .update(physicalVerificationLines)
        .set({
          physicalQty: String(c.physicalQty),
          variance: sql`${c.physicalQty} - ${physicalVerificationLines.systemQty}`,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(physicalVerificationLines.id, c.lineId),
            eq(physicalVerificationLines.tenantId, tenantId)
          )
        );
    }
  }

  async getVariances(id: number, tenantId: number) {
    await this.get(id, tenantId);
    return this.db
      .select()
      .from(physicalVerificationLines)
      .where(
        and(
          eq(physicalVerificationLines.verificationId, id),
          eq(physicalVerificationLines.tenantId, tenantId),
          sql`${physicalVerificationLines.physicalQty} IS NOT NULL`
        )
      );
  }

  async approve(id: number, tenantId: number, userId: number) {
    const verif = await this.get(id, tenantId);
    if (verif.status !== 'COUNTING') {
      throw new ERPError('INVALID_STATUS', 'Verification must be in COUNTING status to approve', 409);
    }

    const lines = await this.db
      .select()
      .from(physicalVerificationLines)
      .where(
        and(
          eq(physicalVerificationLines.verificationId, id),
          eq(physicalVerificationLines.tenantId, tenantId),
          sql`${physicalVerificationLines.variance} != 0 AND ${physicalVerificationLines.physicalQty} IS NOT NULL`
        )
      );

    await this.db.transaction(async (trx) => {
      const db = trx as unknown as ErpDatabase;
      let adjustmentId: number | null = null;

      if (lines.length > 0) {
        const [adj] = await db
          .insert(stockAdjustments)
          .values({
            tenantId,
            adjustmentNumber: nextAdjNumber(tenantId),
            warehouseId: verif.warehouseId,
            adjustmentType: 'SHORTAGE',
            status: 'APPROVED',
            totalValue: '0',
            notes: `Auto-generated from physical verification ${verif.verificationNumber}`,
            approvedBy: userId,
            approvedAt: new Date(),
            createdBy: userId,
          })
          .returning();

        adjustmentId = adj!.id;

        const adjLines = lines.map((l) => {
          const variance = parseFloat(l.variance ?? '0');
          return {
            tenantId,
            adjustmentId: adj!.id,
            itemId: l.itemId,
            variantId: l.variantId,
            direction: (variance >= 0 ? 'IN' : 'OUT') as 'IN' | 'OUT',
            quantity: String(Math.abs(variance)),
            systemQty: l.systemQty,
            lineValue: '0',
          };
        });

        await db.insert(stockAdjustmentLines).values(adjLines);

        // Apply each variance to the inventory ledger in the same transaction
        const ledger = new InventoryLedgerService(db);
        for (const l of lines) {
          const variance = parseFloat(l.variance ?? '0');
          if (variance === 0) continue;
          await ledger.adjustStock({
            tenantId,
            itemId: l.itemId,
            ...(l.variantId != null ? { variantId: l.variantId } : {}),
            warehouseId: verif.warehouseId,
            quantity: Math.abs(variance),
            direction: variance >= 0 ? 'IN' : 'OUT',
            referenceType: 'PHYSICAL_VERIFICATION',
            referenceId: id,
            notes: `PV ${verif.verificationNumber}`,
            createdBy: userId,
          });
        }
      }

      await db
        .update(physicalVerifications)
        .set({
          status: 'APPROVED',
          approvedAt: new Date(),
          approvedBy: userId,
          adjustmentId: adjustmentId ?? undefined,
          version: sql`${physicalVerifications.version} + 1`,
          updatedAt: new Date(),
        })
        .where(eq(physicalVerifications.id, id));
    });

    return this.get(id, tenantId);
  }

  async get(id: number, tenantId: number) {
    const [verif] = await this.db
      .select()
      .from(physicalVerifications)
      .where(
        and(eq(physicalVerifications.id, id), eq(physicalVerifications.tenantId, tenantId))
      );
    if (!verif) throw new ERPError('VERIFICATION_NOT_FOUND', 'Verification not found', 404);
    return verif;
  }
}
