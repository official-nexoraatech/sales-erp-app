/**
 * ES-23 [L1] — ConsignmentService.recordSale() atomic guard.
 * recordSale() has no route/caller yet (confirmed dead code); this test calls
 * the domain method directly to prove the fix closes the lost-update race
 * before it ships wired up to a route.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createDatabaseClient } from '@erp/db';
import { items, warehouses, branches, consignmentStocks, inventoryLedger } from '@erp/db';
import { eq, and } from 'drizzle-orm';
import { ConsignmentService } from '../domain/ConsignmentService.js';
import { BusinessError } from '@erp/types';

const DB_URL = process.env['DATABASE_URL'];

describe.skipIf(!DB_URL)('ConsignmentService.recordSale concurrency (L1)', () => {
  let db: ReturnType<typeof createDatabaseClient>;
  const TEST_TENANT = 902_001 + Math.floor(Math.random() * 1000);
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
    await db.delete(consignmentStocks).where(eq(consignmentStocks.tenantId, TEST_TENANT));
    await db.delete(items).where(eq(items.tenantId, TEST_TENANT));
    await db.delete(warehouses).where(eq(warehouses.tenantId, TEST_TENANT));
    await db.delete(branches).where(eq(branches.tenantId, TEST_TENANT));
  });

  it('concurrent recordSale calls against the same consignment stock never go negative', async () => {
    const [item] = await db
      .insert(items)
      .values({
        tenantId: TEST_TENANT,
        name: 'Consignment Concurrency Item',
        itemCode: `CCI-${Date.now()}`,
        salePrice: '100.00',
        purchasePrice: '80.00',
        gstRate: '5.00',
        unitId: 1,
        hsnCode: '5208',
        availableQty: '1000', // plenty of main-warehouse stock so only the consignment guard is exercised
        createdBy: 1,
      })
      .returning();
    const itemId = item!.id;

    await db.insert(consignmentStocks).values({
      tenantId: TEST_TENANT,
      supplierId: 1,
      itemId,
      warehouseId,
      receivedQty: '50',
      availableQty: '50',
      agreedRate: '80.00',
      receivedDate: new Date(),
      status: 'ACTIVE',
      createdBy: 1,
    });

    const svc = new ConsignmentService(db);
    const tasks = Array.from({ length: 100 }, () =>
      svc.recordSale(TEST_TENANT, itemId, undefined, warehouseId, 1, 1)
    );

    const results = await Promise.allSettled(tasks);
    const succeeded = results.filter((r) => r.status === 'fulfilled');
    const failed = results.filter((r) => r.status === 'rejected');

    // Every call requests exactly 1 unit against 50 available: at most 50 can succeed given
    // the atomic guard; any that lose the race are rejected rather than silently corrupting.
    expect(succeeded.length).toBeLessThanOrEqual(50);
    for (const f of failed) {
      if (f.status === 'rejected') expect(f.reason).toBeInstanceOf(BusinessError);
    }

    const [final] = await db
      .select({ availableQty: consignmentStocks.availableQty })
      .from(consignmentStocks)
      .where(and(eq(consignmentStocks.tenantId, TEST_TENANT), eq(consignmentStocks.itemId, itemId)));

    expect(parseFloat(final!.availableQty ?? '-1')).toBe(50 - succeeded.length);
    expect(parseFloat(final!.availableQty ?? '-1')).toBeGreaterThanOrEqual(0);
  });

  it('concurrent returnToSupplier calls against the same consignment stock never go negative', async () => {
    const [item] = await db
      .insert(items)
      .values({
        tenantId: TEST_TENANT,
        name: 'Consignment Return Concurrency Item',
        itemCode: `CRCI-${Date.now()}`,
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

    const [stock] = await db
      .insert(consignmentStocks)
      .values({
        tenantId: TEST_TENANT,
        supplierId: 1,
        itemId,
        warehouseId,
        receivedQty: '50',
        availableQty: '50',
        agreedRate: '80.00',
        receivedDate: new Date(),
        status: 'ACTIVE',
        createdBy: 1,
      })
      .returning();
    const stockId = stock!.id;

    const svc = new ConsignmentService(db);
    const tasks = Array.from({ length: 100 }, () => svc.returnToSupplier(stockId, TEST_TENANT, 1, 1));

    const results = await Promise.allSettled(tasks);
    const succeeded = results.filter((r) => r.status === 'fulfilled');
    const failed = results.filter((r) => r.status === 'rejected');

    // Every call returns exactly 1 unit against 50 available: at most 50 can succeed.
    // Before the fix, availableQty was read-then-written with no WHERE guard, so
    // concurrent calls could drive it below zero (a lost update).
    expect(succeeded.length).toBeLessThanOrEqual(50);
    for (const f of failed) {
      if (f.status === 'rejected') expect(f.reason).toBeInstanceOf(BusinessError);
    }

    const [final] = await db
      .select({ availableQty: consignmentStocks.availableQty })
      .from(consignmentStocks)
      .where(and(eq(consignmentStocks.tenantId, TEST_TENANT), eq(consignmentStocks.id, stockId)));

    expect(parseFloat(final!.availableQty ?? '-1')).toBe(50 - succeeded.length);
    expect(parseFloat(final!.availableQty ?? '-1')).toBeGreaterThanOrEqual(0);
  });
});
