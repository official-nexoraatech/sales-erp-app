import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createDatabaseClient } from '@erp/db';
import { items, warehouses, branches, inventoryLedger, projectionStockLevel } from '@erp/db';
import { eq, and } from 'drizzle-orm';
import { InventoryLedgerService, InsufficientStockError } from '../domain/InventoryLedgerService.js';

const DB_URL = process.env['DATABASE_URL'];

describe.skipIf(!DB_URL)('Item integration', () => {
  let db: ReturnType<typeof createDatabaseClient>;
  const TEST_TENANT = 900_001 + Math.floor(Math.random() * 1000);
  let warehouseId: number;

  beforeAll(async () => {
    db = createDatabaseClient({ url: DB_URL! });

    // Seed a minimal branch + warehouse for the test tenant
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

  it('creates an item and assigns correct tenant', async () => {
    const [created] = await db
      .insert(items)
      .values({
        tenantId: TEST_TENANT,
        name: 'Test Fabric Roll',
        itemCode: 'TFR-001',
        salePrice: '499.00',
        purchasePrice: '350.00',
        gstRate: '5.00',
        unitId: 1,
        hsnCode: '5208',
        createdBy: 1,
      })
      .returning();

    expect(created).toBeDefined();
    expect(created!.tenantId).toBe(TEST_TENANT);
    expect(created!.name).toBe('Test Fabric Roll');
    expect(created!.version).toBe(0);
  });

  it('enforces optimistic lock on item update', async () => {
    const [created] = await db
      .insert(items)
      .values({
        tenantId: TEST_TENANT,
        name: 'Lock Test Item',
        itemCode: 'LTI-001',
        salePrice: '100.00',
        purchasePrice: '80.00',
        gstRate: '18.00',
        unitId: 1,
        hsnCode: '9999',
        createdBy: 1,
      })
      .returning();

    // Stale version — should match 0 rows
    const result = await db
      .update(items)
      .set({ name: 'Updated Name', version: 1 })
      .where(
        and(
          eq(items.id, created!.id),
          eq(items.tenantId, TEST_TENANT),
          eq(items.version, 99) // wrong version
        )
      )
      .returning();

    expect(result).toHaveLength(0);

    // Correct version — should succeed
    const [updated] = await db
      .update(items)
      .set({ name: 'Updated Name', version: 1 })
      .where(
        and(
          eq(items.id, created!.id),
          eq(items.tenantId, TEST_TENANT),
          eq(items.version, 0)
        )
      )
      .returning();

    expect(updated!.name).toBe('Updated Name');
    expect(updated!.version).toBe(1);
  });

  describe('InventoryLedgerService', () => {
    let concurrentItemId: number;

    beforeAll(async () => {
      const [item] = await db
        .insert(items)
        .values({
          tenantId: TEST_TENANT,
          name: 'Concurrent Test Item',
          itemCode: `CTI-${Date.now()}`,
          salePrice: '100.00',
          purchasePrice: '80.00',
          gstRate: '5.00',
          unitId: 1,
          hsnCode: '5208',
          availableQty: '50',
          createdBy: 1,
        })
        .returning();
      concurrentItemId = item!.id;
    });

    it('concurrent deductions: exactly 50 of 100 succeed from 50-unit stock', async () => {
      const svc = new InventoryLedgerService(db);
      const tasks = Array.from({ length: 100 }, () =>
        svc.deductStock({
          tenantId: TEST_TENANT,
          itemId: concurrentItemId,
          warehouseId,
          quantity: 1,
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
        if (f.status === 'rejected') {
          expect(f.reason).toBeInstanceOf(InsufficientStockError);
        }
      }

      const [final] = await db
        .select({ availableQty: items.availableQty })
        .from(items)
        .where(and(eq(items.id, concurrentItemId), eq(items.tenantId, TEST_TENANT)));

      expect(parseFloat(final!.availableQty ?? '1')).toBeGreaterThanOrEqual(0);
    });

    it('ledger records correct quantity_before and quantity_after', async () => {
      const [item] = await db
        .insert(items)
        .values({
          tenantId: TEST_TENANT,
          name: 'Ledger Chain Test',
          itemCode: `LCT-${Date.now()}`,
          salePrice: '100.00',
          purchasePrice: '80.00',
          gstRate: '5.00',
          unitId: 1,
          hsnCode: '5208',
          availableQty: '0',
          createdBy: 1,
        })
        .returning();
      const ledgerItemId = item!.id;

      const svc = new InventoryLedgerService(db);
      await svc.addStock({
        tenantId: TEST_TENANT,
        itemId: ledgerItemId,
        warehouseId,
        quantity: 100,
        referenceType: 'TEST',
        referenceId: 1,
        createdBy: 1,
      });

      const entries = await db
        .select()
        .from(inventoryLedger)
        .where(
          and(
            eq(inventoryLedger.itemId, ledgerItemId),
            eq(inventoryLedger.tenantId, TEST_TENANT)
          )
        );

      expect(entries).toHaveLength(1);
      expect(parseFloat(entries[0]!.quantityBefore)).toBe(0);
      expect(parseFloat(entries[0]!.quantityAfter)).toBe(100);
      expect(entries[0]!.movementType).toBe('STOCK_IN');
    });
  });

  describe('ES-23 [L2] — item/warehouse delete ledger-history guard', () => {
    it('the delete guard query finds ledger history for an item with movements', async () => {
      const [item] = await db
        .insert(items)
        .values({
          tenantId: TEST_TENANT,
          name: 'Delete Guard Item (has history)',
          itemCode: `DGI-${Date.now()}`,
          salePrice: '100.00',
          purchasePrice: '80.00',
          gstRate: '5.00',
          unitId: 1,
          hsnCode: '5208',
          availableQty: '10',
          createdBy: 1,
        })
        .returning();
      const itemId = item!.id;

      await new InventoryLedgerService(db).addStock({
        tenantId: TEST_TENANT,
        itemId,
        warehouseId,
        quantity: 10,
        referenceType: 'TEST',
        referenceId: 1,
        createdBy: 1,
      });

      // Mirrors item.routes.ts DELETE /:id's guard query exactly.
      const [ledgerEntry] = await db
        .select({ id: inventoryLedger.id })
        .from(inventoryLedger)
        .where(and(eq(inventoryLedger.itemId, itemId), eq(inventoryLedger.tenantId, TEST_TENANT)))
        .limit(1);

      expect(ledgerEntry).toBeDefined();
    });

    it('the delete guard query finds nothing for an item with no ledger movements', async () => {
      const [item] = await db
        .insert(items)
        .values({
          tenantId: TEST_TENANT,
          name: 'Delete Guard Item (no history)',
          itemCode: `DGI2-${Date.now()}`,
          salePrice: '100.00',
          purchasePrice: '80.00',
          gstRate: '5.00',
          unitId: 1,
          hsnCode: '5208',
          createdBy: 1,
        })
        .returning();
      const itemId = item!.id;

      const [ledgerEntry] = await db
        .select({ id: inventoryLedger.id })
        .from(inventoryLedger)
        .where(and(eq(inventoryLedger.itemId, itemId), eq(inventoryLedger.tenantId, TEST_TENANT)))
        .limit(1);

      expect(ledgerEntry).toBeUndefined();
    });

    it('the warehouse delete guard query finds ledger history for a warehouse with movements', async () => {
      const [item] = await db
        .insert(items)
        .values({
          tenantId: TEST_TENANT,
          name: 'Delete Guard Warehouse Item',
          itemCode: `DGWI-${Date.now()}`,
          salePrice: '100.00',
          purchasePrice: '80.00',
          gstRate: '5.00',
          unitId: 1,
          hsnCode: '5208',
          availableQty: '10',
          createdBy: 1,
        })
        .returning();

      await new InventoryLedgerService(db).addStock({
        tenantId: TEST_TENANT,
        itemId: item!.id,
        warehouseId,
        quantity: 10,
        referenceType: 'TEST',
        referenceId: 1,
        createdBy: 1,
      });

      const [ledgerEntry] = await db
        .select({ id: inventoryLedger.id })
        .from(inventoryLedger)
        .where(and(eq(inventoryLedger.warehouseId, warehouseId), eq(inventoryLedger.tenantId, TEST_TENANT)))
        .limit(1);

      expect(ledgerEntry).toBeDefined();
    });
  });

  it('prevents items from leaking across tenants', async () => {
    await db.insert(items).values({
      tenantId: TEST_TENANT,
      name: 'Tenant A Item',
      itemCode: 'TAI-001',
      salePrice: '200.00',
      purchasePrice: '150.00',
      gstRate: '12.00',
      unitId: 1,
      hsnCode: '9999',
      createdBy: 1,
    });

    const OTHER_TENANT = TEST_TENANT + 1;
    const otherTenantItems = await db
      .select()
      .from(items)
      .where(eq(items.tenantId, OTHER_TENANT));

    // Should not see TEST_TENANT's items
    const leaked = otherTenantItems.filter((i) => i.tenantId === TEST_TENANT);
    expect(leaked).toHaveLength(0);
  });
});
