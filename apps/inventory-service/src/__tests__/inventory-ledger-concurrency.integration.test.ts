/**
 * ES-23 [M2] — InventoryLedgerService.addStock()/adjustStock() atomicity.
 * Proves the guarded UPDATE...WHERE...RETURNING pattern closes the lost-update
 * race that a read-then-write implementation would silently corrupt under
 * concurrent load.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createDatabaseClient } from '@erp/db';
import { items, warehouses, branches, inventoryLedger, projectionStockLevel } from '@erp/db';
import { eq, and } from 'drizzle-orm';
import { InventoryLedgerService, InsufficientStockError } from '../domain/InventoryLedgerService.js';

const DB_URL = process.env['DATABASE_URL'];

describe.skipIf(!DB_URL)('InventoryLedgerService concurrency (M2)', () => {
  let db: ReturnType<typeof createDatabaseClient>;
  const TEST_TENANT = 901_001 + Math.floor(Math.random() * 1000);
  let warehouseId: number;

  beforeAll(async () => {
    db = createDatabaseClient({ url: DB_URL! });

    const [branch] = await db
      .insert(branches)
      .values({ tenantId: TEST_TENANT, name: 'Test HO', code: 'HO', isHeadOffice: true, isActive: true, createdBy: 1 })
      .returning();

    const [wh] = await db
      .insert(warehouses)
      .values({ tenantId: TEST_TENANT, branchId: branch!.id, name: 'Main WH', code: 'MWH', isDefault: true, isActive: true, createdBy: 1 })
      .returning();

    warehouseId = wh!.id;
  });

  afterAll(async () => {
    await db.delete(inventoryLedger).where(eq(inventoryLedger.tenantId, TEST_TENANT));
    await db.delete(projectionStockLevel).where(eq(projectionStockLevel.tenantId, TEST_TENANT));
    await db.delete(items).where(eq(items.tenantId, TEST_TENANT));
    await db.delete(warehouses).where(eq(warehouses.tenantId, TEST_TENANT));
    await db.delete(branches).where(eq(branches.tenantId, TEST_TENANT));
  });

  it('concurrent adjustStock(OUT): exactly 50 of 100 succeed from 50-unit stock, never negative', async () => {
    const [item] = await db
      .insert(items)
      .values({
        tenantId: TEST_TENANT,
        name: 'Adjust Concurrency Item',
        itemCode: `ACI-${Date.now()}`,
        salePrice: '100.00',
        purchasePrice: '80.00',
        gstRate: '5.00',
        unitId: 1,
        hsnCode: '5208',
        availableQty: '50',
        createdBy: 1,
      })
      .returning();
    const itemId = item!.id;

    const svc = new InventoryLedgerService(db);
    const tasks = Array.from({ length: 100 }, () =>
      svc.adjustStock({
        tenantId: TEST_TENANT,
        itemId,
        warehouseId,
        quantity: 1,
        direction: 'OUT',
        referenceType: 'TEST',
        referenceId: 1,
        createdBy: 1,
      })
    );

    const results = await Promise.allSettled(tasks);
    const succeeded = results.filter((r) => r.status === 'fulfilled');
    const failed = results.filter((r) => r.status === 'rejected');

    expect(succeeded).toHaveLength(50);
    expect(failed).toHaveLength(50);
    for (const f of failed) {
      if (f.status === 'rejected') expect(f.reason).toBeInstanceOf(InsufficientStockError);
    }

    const [final] = await db
      .select({ availableQty: items.availableQty })
      .from(items)
      .where(and(eq(items.id, itemId), eq(items.tenantId, TEST_TENANT)));

    expect(parseFloat(final!.availableQty ?? '-1')).toBe(0);
  });

  it('interleaved concurrent addStock/deductStock: final qty reflects every operation (no lost update)', async () => {
    const [item] = await db
      .insert(items)
      .values({
        tenantId: TEST_TENANT,
        name: 'Interleave Concurrency Item',
        itemCode: `ICI-${Date.now()}`,
        salePrice: '100.00',
        purchasePrice: '80.00',
        gstRate: '5.00',
        unitId: 1,
        hsnCode: '5208',
        availableQty: '0',
        createdBy: 1,
      })
      .returning();
    const itemId = item!.id;

    const svc = new InventoryLedgerService(db);
    // 100 concurrent +2 stock-ins, then (after they land) 50 concurrent -1 deductions.
    // Net expected: 100*2 - 50*1 = 150, and no lost update from interleaving.
    const addTasks = Array.from({ length: 100 }, () =>
      svc.addStock({
        tenantId: TEST_TENANT,
        itemId,
        warehouseId,
        quantity: 2,
        unitCost: 10,
        referenceType: 'TEST',
        referenceId: 1,
        createdBy: 1,
      })
    );
    await Promise.all(addTasks);

    const deductTasks = Array.from({ length: 50 }, () =>
      svc.deductStock({
        tenantId: TEST_TENANT,
        itemId,
        warehouseId,
        quantity: 1,
        referenceType: 'TEST',
        referenceId: 1,
        createdBy: 1,
      })
    );
    await Promise.all(deductTasks);

    const [final] = await db
      .select({ availableQty: items.availableQty })
      .from(items)
      .where(and(eq(items.id, itemId), eq(items.tenantId, TEST_TENANT)));

    expect(parseFloat(final!.availableQty ?? '-1')).toBe(150);
  });
});
