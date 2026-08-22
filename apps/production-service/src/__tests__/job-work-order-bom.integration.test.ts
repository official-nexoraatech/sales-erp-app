// Manufacturing vertical, Phase A — proves JobWorkOrderService.create({ bomId, orderedQty })
// auto-populates materials from BOMService.explode(), and that passing materials directly
// (the pre-existing, unaffected path) still works unchanged.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createDatabaseClient } from '@erp/db';
import {
  items,
  warehouses,
  branches,
  suppliers,
  boms,
  bomLines,
  jobWorkOrders,
  jobWorkOrderMaterials,
  jobWorkOrderHistory,
} from '@erp/db';
import { eq } from 'drizzle-orm';
import { BOMService } from '../domain/BOMService.js';
import { JobWorkOrderService } from '../domain/JobWorkOrderService.js';

const DB_URL = process.env['DATABASE_URL'];

describe.skipIf(!DB_URL)('JobWorkOrderService + BOMService — real Postgres', () => {
  let db: ReturnType<typeof createDatabaseClient>;
  const TEST_TENANT = 905_001 + Math.floor(Math.random() * 1000);
  let warehouseId: number;
  let branchId: number;
  let supplierId: number;
  let outputItemId: number;
  let componentItemId: number;
  let bomId: number;

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
    branchId = branch!.id;

    const [wh] = await db
      .insert(warehouses)
      .values({
        tenantId: TEST_TENANT,
        branchId,
        name: 'Main WH',
        code: 'MWH',
        isDefault: true,
        isActive: true,
        createdBy: 1,
      })
      .returning();
    warehouseId = wh!.id;

    const [supplier] = await db
      .insert(suppliers)
      .values({
        tenantId: TEST_TENANT,
        branchId,
        displayName: 'Test Job Worker',
        phone: '9999999999',
        createdBy: 1,
      })
      .returning();
    supplierId = supplier!.id;

    const [outItem] = await db
      .insert(items)
      .values({
        tenantId: TEST_TENANT,
        name: 'Finished Good',
        itemCode: `FG-${Date.now()}`,
        salePrice: '200.00',
        purchasePrice: '0',
        gstRate: '5.00',
        unitId: 1,
        hsnCode: '6108',
        availableQty: '0',
        createdBy: 1,
      })
      .returning();
    outputItemId = outItem!.id;

    const [component] = await db
      .insert(items)
      .values({
        tenantId: TEST_TENANT,
        name: 'Fabric Roll',
        itemCode: `FR-${Date.now()}`,
        salePrice: '0',
        purchasePrice: '30.00',
        gstRate: '5.00',
        unitId: 1,
        hsnCode: '5208',
        availableQty: '0',
        createdBy: 1,
      })
      .returning();
    componentItemId = component!.id;

    const bomService = new BOMService(db);
    bomId = await bomService.create({
      tenantId: TEST_TENANT,
      name: 'Finished Good BOM',
      finishedItemId: outputItemId,
      outputQty: 1,
      lines: [{ componentItemId, quantityPerOutput: 3, scrapPercent: 0 }],
      createdBy: 1,
    });
  });

  afterAll(async () => {
    await db.delete(jobWorkOrderHistory).where(eq(jobWorkOrderHistory.tenantId, TEST_TENANT));
    await db.delete(jobWorkOrderMaterials).where(eq(jobWorkOrderMaterials.tenantId, TEST_TENANT));
    await db.delete(jobWorkOrders).where(eq(jobWorkOrders.tenantId, TEST_TENANT));
    await db.delete(bomLines).where(eq(bomLines.tenantId, TEST_TENANT));
    await db.delete(boms).where(eq(boms.tenantId, TEST_TENANT));
    await db.delete(items).where(eq(items.tenantId, TEST_TENANT));
    await db.delete(suppliers).where(eq(suppliers.tenantId, TEST_TENANT));
    await db.delete(warehouses).where(eq(warehouses.tenantId, TEST_TENANT));
    await db.delete(branches).where(eq(branches.tenantId, TEST_TENANT));
  });

  it('create({ bomId, orderedQty }) populates materials matching BOMService.explode()', async () => {
    const bomService = new BOMService(db);
    const expected = await bomService.explode(bomId, TEST_TENANT, 5);

    const svc = new JobWorkOrderService(db);
    const orderId = await svc.create({
      tenantId: TEST_TENANT,
      orderNumber: `JWO-BOM-${Date.now()}`,
      supplierId,
      branchId,
      warehouseId,
      outputItemId,
      orderedQty: 5,
      jobWorkRate: 20,
      orderDate: new Date(),
      bomId,
      createdBy: 1,
    });

    const materials = await db
      .select()
      .from(jobWorkOrderMaterials)
      .where(eq(jobWorkOrderMaterials.jobWorkOrderId, orderId));

    expect(materials).toHaveLength(expected.length);
    const material = materials[0]!;
    const expectedLine = expected[0]!;
    expect(material.itemId).toBe(expectedLine.componentItemId);
    expect(parseFloat(material.requiredQty)).toBe(expectedLine.requiredQty);
    // unitCost is estimated from items.purchasePrice (30.00) since the caller supplied no cost.
    expect(parseFloat(material.unitCost)).toBe(30);
    expect(material.warehouseId).toBe(warehouseId);
  });

  it('create({ materials }) without bomId still works unchanged (backward compatible)', async () => {
    const svc = new JobWorkOrderService(db);
    const orderId = await svc.create({
      tenantId: TEST_TENANT,
      orderNumber: `JWO-MAT-${Date.now()}`,
      supplierId,
      branchId,
      warehouseId,
      outputItemId,
      orderedQty: 2,
      jobWorkRate: 20,
      orderDate: new Date(),
      materials: [{ itemId: componentItemId, requiredQty: 6, unitCost: 30, warehouseId }],
      createdBy: 1,
    });

    const materials = await db
      .select()
      .from(jobWorkOrderMaterials)
      .where(eq(jobWorkOrderMaterials.jobWorkOrderId, orderId));
    expect(materials).toHaveLength(1);
    expect(parseFloat(materials[0]!.requiredQty)).toBe(6);
  });
});
