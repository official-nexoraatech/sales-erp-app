import { and, eq, gt, isNotNull, lte, sql } from 'drizzle-orm';
import { inventoryFifoLayers, items, outboxEvents } from '@erp/db';
import { EventTypes } from '@erp/types';
import { createLogger } from '@erp/logger';
import type { ErpDatabase } from '@erp/db';
import { ulid } from 'ulid';

const logger = createLogger({ serviceName: 'inventory-service', level: 'info' });

const DEFAULT_THRESHOLD_DAYS = 3;

/**
 * Multi-vertical platform audit 2026-08-16, Phase 1: batch/expiry data reaching
 * inventory_fifo_layers (see GRNService.approve()) was the missing prerequisite for this —
 * without it, expiry alerting was structurally impossible for any tenant. Publishes one
 * STOCK_NEAR_EXPIRY outbox event per FIFO layer with remaining stock expiring within
 * thresholdDays, for any tenant-authored (or system-seeded) EVENT-triggered
 * workflow_definition to react to via automation-service — no automation-service code
 * changes needed, it already subscribes to every EventTypes topic.
 *
 * Safe to run multiple times a day: idempotency is intentionally left to the consumer side
 * (a NOTIFICATION node's message doesn't need de-duplicating the way a financial posting
 * would), matching this codebase's existing best-effort alerting jobs (e.g.
 * inventory.low-stock-alert) rather than adding dedup-tracking machinery for a low-stakes
 * notification.
 */
export async function runNearExpiryAlert(
  db: ErpDatabase,
  thresholdDays = DEFAULT_THRESHOLD_DAYS
): Promise<{ checked: number; alertsPublished: number }> {
  logger.info({ thresholdDays }, 'Starting near-expiry stock check');

  const cutoff = new Date(Date.now() + thresholdDays * 24 * 60 * 60 * 1000);

  const rows = await db
    .select({
      layerId: inventoryFifoLayers.id,
      tenantId: inventoryFifoLayers.tenantId,
      itemId: inventoryFifoLayers.itemId,
      warehouseId: inventoryFifoLayers.warehouseId,
      remainingQty: inventoryFifoLayers.remainingQty,
      batchNumber: inventoryFifoLayers.batchNumber,
      expiryDate: inventoryFifoLayers.expiryDate,
      itemName: items.name,
    })
    .from(inventoryFifoLayers)
    .innerJoin(
      items,
      and(
        eq(items.id, inventoryFifoLayers.itemId),
        eq(items.tenantId, inventoryFifoLayers.tenantId)
      )
    )
    .where(
      and(
        sql`${inventoryFifoLayers.remainingQty} > 0`,
        isNotNull(inventoryFifoLayers.expiryDate),
        lte(inventoryFifoLayers.expiryDate, cutoff),
        gt(inventoryFifoLayers.expiryDate, new Date())
      )
    );

  let alertsPublished = 0;
  for (const row of rows) {
    const daysToExpiry = Math.ceil(
      (row.expiryDate!.getTime() - Date.now()) / (24 * 60 * 60 * 1000)
    );

    await db.insert(outboxEvents).values({
      eventId: ulid(),
      eventType: EventTypes.STOCK_NEAR_EXPIRY,
      aggregateType: 'InventoryFifoLayer',
      aggregateId: row.layerId,
      tenantId: row.tenantId,
      payload: {
        itemId: row.itemId,
        itemName: row.itemName,
        warehouseId: row.warehouseId,
        batchNumber: row.batchNumber,
        expiryDate: row.expiryDate!.toISOString(),
        remainingQty: parseFloat(String(row.remainingQty)),
        daysToExpiry,
      },
    });
    alertsPublished++;
  }

  logger.info({ checked: rows.length, alertsPublished }, 'Near-expiry stock check complete');
  return { checked: rows.length, alertsPublished };
}
