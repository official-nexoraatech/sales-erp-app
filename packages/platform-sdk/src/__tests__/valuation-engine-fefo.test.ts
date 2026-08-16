/**
 * Multi-vertical platform audit 2026-08-16, Phase 1: grnLines.batchNumber/expiryDate were
 * captured on receipt but discarded before reaching inventory_fifo_layers, so FEFO issuance
 * was impossible — FIFO layers only ever consumed in receipt order, meaning a batch closer to
 * expiry could sit unconsumed behind an older-received-but-later-expiring one. This suite
 * proves items.fefoEnabled actually changes consumption order against a real database.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createDatabaseClient } from '@erp/db';
import { items, inventoryFifoLayers, inventoryLedger, warehouses, branches } from '@erp/db';
import { eq } from 'drizzle-orm';
import { ValuationService } from '../valuation-engine.js';

const DB_URL = process.env['DATABASE_URL'];

describe.skipIf(!DB_URL)('ValuationService — FEFO consumption ordering', () => {
  let db: ReturnType<typeof createDatabaseClient>;
  const TEST_TENANT = 904_001 + Math.floor(Math.random() * 1000);
  let warehouseId: number;
  let fefoItemId: number;
  let fifoItemId: number;

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

    const [fefoItem] = await db
      .insert(items)
      .values({
        tenantId: TEST_TENANT,
        name: 'FEFO Test Item',
        itemCode: `FEFO-${Date.now()}`,
        salePrice: '10.00',
        purchasePrice: '5.00',
        gstRate: '5.00',
        unitId: 1,
        hsnCode: '0401',
        costingMethod: 'FIFO',
        fefoEnabled: true,
        availableQty: '0',
        createdBy: 1,
      })
      .returning();
    fefoItemId = fefoItem!.id;

    const [fifoItem] = await db
      .insert(items)
      .values({
        tenantId: TEST_TENANT,
        name: 'FIFO (non-FEFO) Test Item',
        itemCode: `FIFO-${Date.now()}`,
        salePrice: '10.00',
        purchasePrice: '5.00',
        gstRate: '5.00',
        unitId: 1,
        hsnCode: '0401',
        costingMethod: 'FIFO',
        fefoEnabled: false,
        availableQty: '0',
        createdBy: 1,
      })
      .returning();
    fifoItemId = fifoItem!.id;
  });

  afterAll(async () => {
    await db.delete(inventoryFifoLayers).where(eq(inventoryFifoLayers.tenantId, TEST_TENANT));
    await db.delete(inventoryLedger).where(eq(inventoryLedger.tenantId, TEST_TENANT));
    await db.delete(items).where(eq(items.tenantId, TEST_TENANT));
    await db.delete(warehouses).where(eq(warehouses.tenantId, TEST_TENANT));
    await db.delete(branches).where(eq(branches.tenantId, TEST_TENANT));
  });

  async function seedTwoLayers(itemId: number): Promise<void> {
    // Layer A: received first (2026-01-01), expires LATER (2026-12-31), cost 10/unit.
    // Layer B: received second (2026-02-01), expires SOONER (2026-03-01), cost 20/unit.
    await db.insert(inventoryFifoLayers).values([
      {
        tenantId: TEST_TENANT,
        itemId,
        warehouseId,
        receivedAt: new Date('2026-01-01T00:00:00Z'),
        originalQty: '10',
        remainingQty: '10',
        unitCost: '10.00',
        sourceLedgerId: 0,
        batchNumber: 'BATCH-A',
        expiryDate: new Date('2026-12-31T00:00:00Z'),
      },
      {
        tenantId: TEST_TENANT,
        itemId,
        warehouseId,
        receivedAt: new Date('2026-02-01T00:00:00Z'),
        originalQty: '10',
        remainingQty: '10',
        unitCost: '20.00',
        sourceLedgerId: 0,
        batchNumber: 'BATCH-B',
        expiryDate: new Date('2026-03-01T00:00:00Z'),
      },
    ]);
    await db.update(items).set({ availableQty: '20' }).where(eq(items.id, itemId));
  }

  it('fefoEnabled=true consumes the soonest-expiring layer first, even though it was received second', async () => {
    await seedTwoLayers(fefoItemId);

    // Consume 5 units — should come entirely from Batch B (expires 2026-03-01, cost 20/unit),
    // not Batch A (received first, but expires later) — COGS proves which layer was hit.
    const cogs = await ValuationService.consumeForStockOut(db, {
      tenantId: TEST_TENANT,
      itemId: fefoItemId,
      warehouseId,
      quantity: 5,
    });
    expect(cogs).toBe(100); // 5 * 20 (Batch B's cost), not 5 * 10 (Batch A's cost)

    const layers = await db
      .select()
      .from(inventoryFifoLayers)
      .where(eq(inventoryFifoLayers.itemId, fefoItemId));
    const batchA = layers.find((l) => l.batchNumber === 'BATCH-A');
    const batchB = layers.find((l) => l.batchNumber === 'BATCH-B');
    expect(parseFloat(batchA!.remainingQty)).toBe(10); // untouched
    expect(parseFloat(batchB!.remainingQty)).toBe(5); // 10 - 5 consumed
  });

  it('fefoEnabled=false (default) still consumes strictly in receipt order regardless of expiry', async () => {
    await seedTwoLayers(fifoItemId);

    // Consume 5 units — should come from Batch A (received first, cost 10/unit) even though
    // Batch B expires sooner, proving FEFO is opt-in and existing FIFO behavior is unchanged.
    const cogs = await ValuationService.consumeForStockOut(db, {
      tenantId: TEST_TENANT,
      itemId: fifoItemId,
      warehouseId,
      quantity: 5,
    });
    expect(cogs).toBe(50); // 5 * 10 (Batch A's cost)

    const layers = await db
      .select()
      .from(inventoryFifoLayers)
      .where(eq(inventoryFifoLayers.itemId, fifoItemId));
    const batchA = layers.find((l) => l.batchNumber === 'BATCH-A');
    const batchB = layers.find((l) => l.batchNumber === 'BATCH-B');
    expect(parseFloat(batchA!.remainingQty)).toBe(5); // 10 - 5 consumed
    expect(parseFloat(batchB!.remainingQty)).toBe(10); // untouched
  });
});
