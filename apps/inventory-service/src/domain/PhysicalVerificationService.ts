import { eq, and, sql, getTableColumns } from 'drizzle-orm';
import {
  physicalVerifications,
  physicalVerificationLines,
  projectionStockLevel,
  stockAdjustments,
  stockAdjustmentLines,
  items,
  outboxEvents,
} from '@erp/db';
import { ERPError } from '@erp/types';
import type { ErpDatabase } from '@erp/db';
import { ulid } from 'ulid';
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

  async startCounting(id: number, tenantId: number, _userId: number) {
    const verif = await this.get(id, tenantId);

    await this.db.transaction(async (trx) => {
      const db = trx as unknown as ErpDatabase;

      // Atomically claim the row: this UPDATE only matches (and thus only takes effect) if
      // the verification is still DRAFT. Two concurrent startCounting() calls on the same
      // verification serialize on Postgres's row lock; whichever commits second finds the
      // WHERE no longer matches and claims nothing — closes the check-then-act race the
      // previous get()-then-update() pattern had, which could double-insert the snapshot
      // lines for one physical verification (same race class as 51c911b's fix for
      // StockAdjustmentService/StockTransferService, not applied here at the time).
      const [claimed] = await db
        .update(physicalVerifications)
        .set({
          status: 'COUNTING',
          snapshotTakenAt: new Date(),
          countingStartedAt: new Date(),
          version: sql`${physicalVerifications.version} + 1`,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(physicalVerifications.id, id),
            eq(physicalVerifications.tenantId, tenantId),
            eq(physicalVerifications.status, 'DRAFT')
          )
        )
        .returning();

      if (!claimed) {
        const [current] = await db
          .select()
          .from(physicalVerifications)
          .where(
            and(eq(physicalVerifications.id, id), eq(physicalVerifications.tenantId, tenantId))
          );
        if (!current) throw new ERPError('VERIFICATION_NOT_FOUND', 'Verification not found', 404);
        throw new ERPError('INVALID_STATUS', 'Verification must be DRAFT to start counting', 409);
      }

      // Take system quantity snapshot for all items in the warehouse, inside the same
      // transaction that claimed the row (not before it, so the snapshot can't be taken
      // twice for one verification either).
      const stockSnapshot = await db
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
      throw new ERPError(
        'INVALID_STATUS',
        'Verification must be in COUNTING status to update counts',
        409
      );
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

  // There is no separate "list lines to count" endpoint — this is the only route the frontend's
  // COUNTING-stage table has to populate itself with (see PhysicalVerificationDetailPage.tsx).
  // Filtering to physicalQty IS NOT NULL made it a real chicken-and-egg bug: a fresh
  // verification has every line's physicalQty NULL until counted, so the table rendered zero
  // rows and there was no way to ever enter a count in the first place. approve()'s own query
  // (which genuinely only needs counted, non-zero-variance lines to build an adjustment) has
  // its own separate filter and is unaffected by this change.
  async getVariances(id: number, tenantId: number) {
    await this.get(id, tenantId);
    return this.db
      .select({ ...getTableColumns(physicalVerificationLines), itemName: items.name })
      .from(physicalVerificationLines)
      .leftJoin(items, eq(physicalVerificationLines.itemId, items.id))
      .where(
        and(
          eq(physicalVerificationLines.verificationId, id),
          eq(physicalVerificationLines.tenantId, tenantId)
        )
      );
  }

  async approve(id: number, tenantId: number, userId: number) {
    const verif = await this.get(id, tenantId);

    await this.db.transaction(async (trx) => {
      const db = trx as unknown as ErpDatabase;

      // Atomically claim the row: this UPDATE only matches (and thus only takes effect) if
      // the verification is still COUNTING. Two concurrent approve() calls on the same
      // verification serialize on Postgres's row lock; whichever commits second finds the
      // WHERE no longer matches and claims nothing — closes the check-then-act race the
      // previous get()-then-update() pattern had, which could double-create the auto-generated
      // stock adjustment and double-apply the ledger variance for one physical verification
      // (same race class as 51c911b's fix for StockAdjustmentService/StockTransferService,
      // not applied here at the time).
      const [claimed] = await db
        .update(physicalVerifications)
        .set({
          status: 'APPROVED',
          approvedAt: new Date(),
          approvedBy: userId,
          version: sql`${physicalVerifications.version} + 1`,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(physicalVerifications.id, id),
            eq(physicalVerifications.tenantId, tenantId),
            eq(physicalVerifications.status, 'COUNTING')
          )
        )
        .returning();

      if (!claimed) {
        const [current] = await db
          .select()
          .from(physicalVerifications)
          .where(
            and(eq(physicalVerifications.id, id), eq(physicalVerifications.tenantId, tenantId))
          );
        if (!current) throw new ERPError('VERIFICATION_NOT_FOUND', 'Verification not found', 404);
        throw new ERPError(
          'INVALID_STATUS',
          'Verification must be in COUNTING status to approve',
          409
        );
      }

      const lines = await db
        .select()
        .from(physicalVerificationLines)
        .where(
          and(
            eq(physicalVerificationLines.verificationId, id),
            eq(physicalVerificationLines.tenantId, tenantId),
            sql`${physicalVerificationLines.variance} != 0 AND ${physicalVerificationLines.physicalQty} IS NOT NULL`
          )
        );

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
        let netCostImpact = 0;
        for (const l of lines) {
          const variance = parseFloat(l.variance ?? '0');
          if (variance === 0) continue;

          // Excess found during counting has no real acquisition cost — value it at the
          // item's own current WACC (a shortage doesn't need this: adjustStock's OUT path
          // costs at the item's existing WACC/FIFO basis regardless of what's passed here).
          let unitCost: number | undefined;
          if (variance > 0) {
            const [item] = await db
              .select({ waccCost: items.waccCost })
              .from(items)
              .where(and(eq(items.id, l.itemId), eq(items.tenantId, tenantId)));
            unitCost = parseFloat(item?.waccCost ?? '0');
          }

          const { costImpact } = await ledger.adjustStock({
            tenantId,
            itemId: l.itemId,
            ...(l.variantId != null ? { variantId: l.variantId } : {}),
            warehouseId: verif.warehouseId,
            quantity: Math.abs(variance),
            direction: variance >= 0 ? 'IN' : 'OUT',
            ...(unitCost !== undefined ? { unitCost } : {}),
            referenceType: 'PHYSICAL_VERIFICATION',
            referenceId: id,
            notes: `PV ${verif.verificationNumber}`,
            createdBy: userId,
          });
          netCostImpact += costImpact;
        }

        // Same accounting gap as StockAdjustmentService.approve(): a physical-verification
        // write-off previously never posted anything to the books.
        if (Math.abs(netCostImpact) > 0.001) {
          await db.insert(outboxEvents).values({
            eventId: ulid(),
            eventType: 'STOCK_ADJUSTMENT_POSTED',
            aggregateType: 'StockAdjustment',
            aggregateId: adjustmentId!,
            tenantId,
            payload: {
              adjustmentId,
              adjustmentNumber: adj!.adjustmentNumber,
              adjustmentType: 'SHORTAGE',
              warehouseId: verif.warehouseId,
              netValue: String(Math.abs(netCostImpact)),
              direction: netCostImpact < 0 ? 'LOSS' : 'GAIN',
              createdBy: userId,
            },
            published: false,
          });
        }
      }

      // Status/approvedAt/approvedBy were already set by the atomic claim above; this only
      // needs to backfill adjustmentId once the auto-generated adjustment (if any) exists.
      if (adjustmentId !== null) {
        await db
          .update(physicalVerifications)
          .set({ adjustmentId })
          .where(eq(physicalVerifications.id, id));
      }
    });

    return this.get(id, tenantId);
  }

  async get(id: number, tenantId: number) {
    const [verif] = await this.db
      .select()
      .from(physicalVerifications)
      .where(and(eq(physicalVerifications.id, id), eq(physicalVerifications.tenantId, tenantId)));
    if (!verif) throw new ERPError('VERIFICATION_NOT_FOUND', 'Verification not found', 404);
    return verif;
  }
}
