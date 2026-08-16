/**
 * Multi-vertical platform audit 2026-08-16, Phase 1: proves runNearExpiryAlert correctly
 * selects FIFO layers expiring within the threshold (and only those) and publishes a
 * STOCK_NEAR_EXPIRY outbox event with the right payload — the "near-expiry automation
 * trigger" the audit roadmap called for, closing the loop opened by threading batch/expiry
 * from GRN through to inventory_fifo_layers.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createDatabaseClient } from '@erp/db';
import { items, warehouses, branches, inventoryFifoLayers, outboxEvents } from '@erp/db';
import { eq, and } from 'drizzle-orm';
import { runNearExpiryAlert } from '../jobs/nearExpiryAlert.job.js';

const DB_URL = process.env['DATABASE_URL'];

describe.skipIf(!DB_URL)('runNearExpiryAlert', () => {
  let db: ReturnType<typeof createDatabaseClient>;
  const TEST_TENANT = 907_001 + Math.floor(Math.random() * 1000);
  let warehouseId: number;
  let itemId: number;

  beforeAll(async () => {
    db = createDatabaseClient({ url: DB_URL! });

    const [branch] = await db
      .insert(branches)
      .values({
        tenantId: TEST_TENANT,
        name: 'Test HO',
        code: 'HO',
        isHeadOffice: true,
        isActive: true,
        createdBy: 1,
      })
      .returning();

    const [wh] = await db
      .insert(warehouses)
      .values({
        tenantId: TEST_TENANT,
        branchId: branch!.id,
        name: 'Main WH',
        code: 'MWH',
        isDefault: true,
        isActive: true,
        createdBy: 1,
      })
      .returning();
    warehouseId = wh!.id;

    const [item] = await db
      .insert(items)
      .values({
        tenantId: TEST_TENANT,
        name: 'Near-Expiry Test Item',
        itemCode: `NEARX-${Date.now()}`,
        salePrice: '10.00',
        purchasePrice: '5.00',
        gstRate: '5.00',
        unitId: 1,
        hsnCode: '0401',
        costingMethod: 'FIFO',
        availableQty: '0',
        createdBy: 1,
      })
      .returning();
    itemId = item!.id;

    const inTwoDays = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000);
    const inTenDays = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000);
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);

    await db.insert(inventoryFifoLayers).values([
      // Expires in 2 days, has remaining stock — should be alerted.
      {
        tenantId: TEST_TENANT,
        itemId,
        warehouseId,
        receivedAt: new Date(),
        originalQty: '10',
        remainingQty: '10',
        unitCost: '5.00',
        sourceLedgerId: 0,
        batchNumber: 'LOT-SOON',
        expiryDate: inTwoDays,
      },
      // Expires in 10 days, beyond the 3-day threshold — should NOT be alerted.
      {
        tenantId: TEST_TENANT,
        itemId,
        warehouseId,
        receivedAt: new Date(),
        originalQty: '10',
        remainingQty: '10',
        unitCost: '5.00',
        sourceLedgerId: 0,
        batchNumber: 'LOT-LATER',
        expiryDate: inTenDays,
      },
      // Expires in 2 days but fully consumed (remainingQty=0) — should NOT be alerted.
      {
        tenantId: TEST_TENANT,
        itemId,
        warehouseId,
        receivedAt: new Date(),
        originalQty: '10',
        remainingQty: '0',
        unitCost: '5.00',
        sourceLedgerId: 0,
        batchNumber: 'LOT-CONSUMED',
        expiryDate: inTwoDays,
      },
      // Already expired yesterday — should NOT be alerted (that's a write-off concern, not
      // an advance warning).
      {
        tenantId: TEST_TENANT,
        itemId,
        warehouseId,
        receivedAt: new Date(),
        originalQty: '10',
        remainingQty: '10',
        unitCost: '5.00',
        sourceLedgerId: 0,
        batchNumber: 'LOT-EXPIRED',
        expiryDate: yesterday,
      },
      // No expiry date at all (cloth-retail FIFO items) — should NOT be alerted.
      {
        tenantId: TEST_TENANT,
        itemId,
        warehouseId,
        receivedAt: new Date(),
        originalQty: '10',
        remainingQty: '10',
        unitCost: '5.00',
        sourceLedgerId: 0,
      },
    ]);
  });

  afterAll(async () => {
    await db.delete(inventoryFifoLayers).where(eq(inventoryFifoLayers.tenantId, TEST_TENANT));
    await db.delete(outboxEvents).where(eq(outboxEvents.tenantId, TEST_TENANT));
    await db.delete(items).where(eq(items.tenantId, TEST_TENANT));
    await db.delete(warehouses).where(eq(warehouses.tenantId, TEST_TENANT));
    await db.delete(branches).where(eq(branches.tenantId, TEST_TENANT));
  });

  it('publishes STOCK_NEAR_EXPIRY only for the one layer within threshold with remaining stock', async () => {
    const result = await runNearExpiryAlert(db, 3);
    expect(result.alertsPublished).toBe(1);

    const events = await db
      .select()
      .from(outboxEvents)
      .where(
        and(eq(outboxEvents.tenantId, TEST_TENANT), eq(outboxEvents.eventType, 'STOCK_NEAR_EXPIRY'))
      );
    expect(events).toHaveLength(1);

    const payload = events[0]!.payload as {
      itemId: number;
      itemName: string;
      warehouseId: number;
      batchNumber: string;
      remainingQty: number;
      daysToExpiry: number;
    };
    expect(payload.itemId).toBe(itemId);
    expect(payload.itemName).toBe('Near-Expiry Test Item');
    expect(payload.warehouseId).toBe(warehouseId);
    expect(payload.batchNumber).toBe('LOT-SOON');
    expect(payload.remainingQty).toBe(10);
    expect(payload.daysToExpiry).toBeLessThanOrEqual(2);
    expect(payload.daysToExpiry).toBeGreaterThanOrEqual(1);
  });
});
