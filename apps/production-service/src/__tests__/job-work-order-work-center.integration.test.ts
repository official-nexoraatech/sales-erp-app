// Manufacturing vertical, Phase B — proves JobWorkOrderService.create({ workCenterId }) persists
// the reference, and rejects a cross-tenant/unknown one (mirrors the existing supplierId/
// outputItemId tenant-scoping checks in the same file).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createDatabaseClient } from '@erp/db';
import {
  items,
  warehouses,
  branches,
  suppliers,
  workCenters,
  jobWorkOrders,
  jobWorkOrderMaterials,
  jobWorkOrderHistory,
} from '@erp/db';
import { eq } from 'drizzle-orm';
import { NotFoundError } from '@erp/types';
import { WorkCenterService } from '../domain/WorkCenterService.js';
import { JobWorkOrderService } from '../domain/JobWorkOrderService.js';

const DB_URL = process.env['DATABASE_URL'];

describe.skipIf(!DB_URL)('JobWorkOrderService + WorkCenterService — real Postgres', () => {
  let db: ReturnType<typeof createDatabaseClient>;
  const TEST_TENANT = 907_001 + Math.floor(Math.random() * 1000);
  let warehouseId: number;
  let branchId: number;
  let supplierId: number;
  let outputItemId: number;
  let workCenterId: number;

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

    const wcService = new WorkCenterService(db);
    workCenterId = await wcService.create({
      tenantId: TEST_TENANT,
      name: 'Assembly Line 1',
      code: 'ASM-1',
      createdBy: 1,
    });
  });

  afterAll(async () => {
    await db.delete(jobWorkOrderHistory).where(eq(jobWorkOrderHistory.tenantId, TEST_TENANT));
    await db.delete(jobWorkOrderMaterials).where(eq(jobWorkOrderMaterials.tenantId, TEST_TENANT));
    await db.delete(jobWorkOrders).where(eq(jobWorkOrders.tenantId, TEST_TENANT));
    await db.delete(workCenters).where(eq(workCenters.tenantId, TEST_TENANT));
    await db.delete(items).where(eq(items.tenantId, TEST_TENANT));
    await db.delete(suppliers).where(eq(suppliers.tenantId, TEST_TENANT));
    await db.delete(warehouses).where(eq(warehouses.tenantId, TEST_TENANT));
    await db.delete(branches).where(eq(branches.tenantId, TEST_TENANT));
  });

  it('create({ workCenterId }) persists the reference', async () => {
    const svc = new JobWorkOrderService(db);
    const orderId = await svc.create({
      tenantId: TEST_TENANT,
      orderNumber: `JWO-WC-${Date.now()}`,
      supplierId,
      branchId,
      warehouseId,
      outputItemId,
      workCenterId,
      orderedQty: 5,
      jobWorkRate: 10,
      orderDate: new Date(),
      materials: [],
      createdBy: 1,
    });

    const [order] = await db.select().from(jobWorkOrders).where(eq(jobWorkOrders.id, orderId));
    expect(order!.workCenterId).toBe(workCenterId);
  });

  it('create({ workCenterId: <unknown/cross-tenant> }) rejects with NotFoundError', async () => {
    const svc = new JobWorkOrderService(db);
    await expect(
      svc.create({
        tenantId: TEST_TENANT,
        orderNumber: `JWO-WC-BAD-${Date.now()}`,
        supplierId,
        branchId,
        warehouseId,
        outputItemId,
        workCenterId: 999_999_999,
        orderedQty: 5,
        jobWorkRate: 10,
        orderDate: new Date(),
        materials: [],
        createdBy: 1,
      })
    ).rejects.toThrow(NotFoundError);
  });

  it('create() without workCenterId still works unchanged (backward compatible)', async () => {
    const svc = new JobWorkOrderService(db);
    const orderId = await svc.create({
      tenantId: TEST_TENANT,
      orderNumber: `JWO-NOWC-${Date.now()}`,
      supplierId,
      branchId,
      warehouseId,
      outputItemId,
      orderedQty: 3,
      jobWorkRate: 10,
      orderDate: new Date(),
      materials: [],
      createdBy: 1,
    });
    const [order] = await db.select().from(jobWorkOrders).where(eq(jobWorkOrders.id, orderId));
    expect(order!.workCenterId).toBeNull();
  });
});
