// Manufacturing vertical — RoutingService tests against a real Postgres DB, mirroring
// bom-service.test.ts's own real-DB/tenant/item-provisioning pattern.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createDatabaseClient } from '@erp/db';
import {
  items,
  workCenters,
  routings,
  routingOperations,
  branches,
  warehouses,
  productionOrders,
} from '@erp/db';
import { eq } from 'drizzle-orm';
import { BusinessError, NotFoundError } from '@erp/types';
import { RoutingService } from '../domain/RoutingService.js';
import { ProductionOrderService } from '../domain/ProductionOrderService.js';

const DB_URL = process.env['DATABASE_URL'];

describe.skipIf(!DB_URL)('RoutingService — real Postgres', () => {
  let db: ReturnType<typeof createDatabaseClient>;
  const TEST_TENANT = 906_001 + Math.floor(Math.random() * 1000);
  let finishedItemId: number;
  let workCenterId: number;
  let branchId: number;
  let warehouseId: number;

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

    const [finished] = await db
      .insert(items)
      .values({
        tenantId: TEST_TENANT,
        name: 'Routed Widget',
        itemCode: `RW-${Date.now()}`,
        salePrice: '500.00',
        purchasePrice: '0',
        gstRate: '18.00',
        unitId: 1,
        hsnCode: '8501',
        availableQty: '0',
        createdBy: 1,
      })
      .returning();
    finishedItemId = finished!.id;

    const [wc] = await db
      .insert(workCenters)
      .values({
        tenantId: TEST_TENANT,
        name: 'Cutting Station',
        code: `CUT-${Date.now()}`,
        capacityPerDay: '100',
        createdBy: 1,
      })
      .returning();
    workCenterId = wc!.id;
  });

  afterAll(async () => {
    await db.delete(productionOrders).where(eq(productionOrders.tenantId, TEST_TENANT));
    await db.delete(routingOperations).where(eq(routingOperations.tenantId, TEST_TENANT));
    await db.delete(routings).where(eq(routings.tenantId, TEST_TENANT));
    await db.delete(workCenters).where(eq(workCenters.tenantId, TEST_TENANT));
    await db.delete(items).where(eq(items.tenantId, TEST_TENANT));
    await db.delete(warehouses).where(eq(warehouses.tenantId, TEST_TENANT));
    await db.delete(branches).where(eq(branches.tenantId, TEST_TENANT));
  });

  it('create() rejects an empty operations list', async () => {
    const svc = new RoutingService(db);
    await expect(
      svc.create({
        tenantId: TEST_TENANT,
        name: 'Empty Routing',
        finishedItemId,
        operations: [],
        createdBy: 1,
      })
    ).rejects.toThrow(BusinessError);
  });

  it('create() rejects duplicate sequence numbers', async () => {
    const svc = new RoutingService(db);
    await expect(
      svc.create({
        tenantId: TEST_TENANT,
        name: 'Duplicate Seq Routing',
        finishedItemId,
        operations: [
          { sequenceNo: 1, operationName: 'Cut' },
          { sequenceNo: 1, operationName: 'Stitch' },
        ],
        createdBy: 1,
      })
    ).rejects.toThrow(BusinessError);
  });

  it('create() rejects a workCenterId that does not belong to this tenant', async () => {
    const svc = new RoutingService(db);
    await expect(
      svc.create({
        tenantId: TEST_TENANT,
        name: 'Bad WC Routing',
        finishedItemId,
        operations: [{ sequenceNo: 1, operationName: 'Cut', workCenterId: 999_999_999 }],
        createdBy: 1,
      })
    ).rejects.toThrow(NotFoundError);
  });

  it('create() persists ordered operations, retrievable via getById()', async () => {
    const svc = new RoutingService(db);
    const routingId = await svc.create({
      tenantId: TEST_TENANT,
      name: 'Widget Routing v1',
      finishedItemId,
      operations: [
        { sequenceNo: 2, operationName: 'Stitch', standardTimeMinutes: 15 },
        { sequenceNo: 1, operationName: 'Cut', workCenterId, standardTimeMinutes: 10 },
        { sequenceNo: 3, operationName: 'Pack', standardTimeMinutes: 5 },
      ],
      createdBy: 1,
    });

    const result = await svc.getById(routingId, TEST_TENANT);
    expect(result).not.toBeNull();
    expect(result!.routing.isActive).toBe(true);
    expect(result!.operations.map((o) => o.operationName)).toEqual(['Cut', 'Stitch', 'Pack']);
    expect(result!.operations[0]!.workCenterId).toBe(workCenterId);
  });

  it('create() deactivates the previous active routing for the same finished item', async () => {
    const svc = new RoutingService(db);
    const firstId = await svc.create({
      tenantId: TEST_TENANT,
      name: 'Guard Routing v1',
      finishedItemId,
      operations: [{ sequenceNo: 1, operationName: 'Cut' }],
      createdBy: 1,
    });
    const secondId = await svc.create({
      tenantId: TEST_TENANT,
      name: 'Guard Routing v2',
      finishedItemId,
      operations: [
        { sequenceNo: 1, operationName: 'Cut' },
        { sequenceNo: 2, operationName: 'Stitch' },
      ],
      createdBy: 1,
    });

    const first = await svc.getById(firstId, TEST_TENANT);
    const second = await svc.getById(secondId, TEST_TENANT);
    expect(first!.routing.isActive).toBe(false);
    expect(second!.routing.isActive).toBe(true);
  });

  describe('delete()', () => {
    it('rejects deleting the currently active routing', async () => {
      const svc = new RoutingService(db);
      const id = await svc.create({
        tenantId: TEST_TENANT,
        name: 'Active Routing',
        finishedItemId,
        operations: [{ sequenceNo: 1, operationName: 'Cut' }],
        createdBy: 1,
      });
      await expect(svc.delete(id, TEST_TENANT)).rejects.toThrow(BusinessError);
    });

    it('deletes a deactivated (non-active) routing, and its operations, once a replacement supersedes it', async () => {
      const svc = new RoutingService(db);
      const firstId = await svc.create({
        tenantId: TEST_TENANT,
        name: 'Guard Delete v1',
        finishedItemId,
        operations: [{ sequenceNo: 1, operationName: 'Cut' }],
        createdBy: 1,
      });
      await svc.create({
        tenantId: TEST_TENANT,
        name: 'Guard Delete v2',
        finishedItemId,
        operations: [
          { sequenceNo: 1, operationName: 'Cut' },
          { sequenceNo: 2, operationName: 'Stitch' },
        ],
        createdBy: 1,
      });

      await svc.delete(firstId, TEST_TENANT);

      expect(await svc.getById(firstId, TEST_TENANT)).toBeNull();
      const remainingOps = await db
        .select()
        .from(routingOperations)
        .where(eq(routingOperations.routingId, firstId));
      expect(remainingOps).toHaveLength(0);
    });

    it('rejects deleting a routing that does not exist', async () => {
      const svc = new RoutingService(db);
      await expect(svc.delete(999_999_999, TEST_TENANT)).rejects.toThrow(NotFoundError);
    });

    it('rejects deleting a deactivated routing still referenced by a production order', async () => {
      const svc = new RoutingService(db);
      const firstId = await svc.create({
        tenantId: TEST_TENANT,
        name: 'Referenced Routing v1',
        finishedItemId,
        operations: [{ sequenceNo: 1, operationName: 'Cut' }],
        createdBy: 1,
      });

      const poSvc = new ProductionOrderService(db);
      await poSvc.create({
        tenantId: TEST_TENANT,
        orderNumber: `PO-ROUTE-DEL-${Date.now()}`,
        branchId,
        warehouseId,
        outputItemId: finishedItemId,
        orderedQty: 1,
        laborCost: 0,
        overheadCost: 0,
        orderDate: new Date(),
        materials: [],
        routingId: firstId,
        createdBy: 1,
      });

      // Supersede so firstId is no longer active — the only remaining block should be the
      // in-use (referenced-by-a-production-order) guard.
      await svc.create({
        tenantId: TEST_TENANT,
        name: 'Referenced Routing v2',
        finishedItemId,
        operations: [{ sequenceNo: 1, operationName: 'Cut' }],
        createdBy: 1,
      });

      await expect(svc.delete(firstId, TEST_TENANT)).rejects.toThrow(BusinessError);
    });
  });
});
