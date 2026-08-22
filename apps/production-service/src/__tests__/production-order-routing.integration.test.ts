// Manufacturing vertical — proves ProductionOrderService.create()'s routingId instantiates
// production_order_operations in sequence from the routing's own operations, and that
// startOperation()/completeOperation() track progress independently of the order's own status.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createDatabaseClient } from '@erp/db';
import {
  items,
  warehouses,
  branches,
  workCenters,
  routings,
  routingOperations,
  productionOrders,
  productionOrderMaterials,
  productionOrderOperations,
  productionOrderHistory,
  inventoryLedger,
  projectionStockLevel,
  outboxEvents,
} from '@erp/db';
import { eq } from 'drizzle-orm';
import { ProductionOrderService } from '../domain/ProductionOrderService.js';
import { RoutingService } from '../domain/RoutingService.js';
import { BusinessError } from '@erp/types';

const DB_URL = process.env['DATABASE_URL'];

describe.skipIf(!DB_URL)('ProductionOrderService — routing integration', () => {
  let db: ReturnType<typeof createDatabaseClient>;
  const TEST_TENANT = 907_001 + Math.floor(Math.random() * 1000);
  let warehouseId: number;
  let branchId: number;
  let outputItemId: number;
  let workCenterId: number;
  let routingId: number;

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

    const [outItem] = await db
      .insert(items)
      .values({
        tenantId: TEST_TENANT,
        name: 'Routed Finished Good',
        itemCode: `RFG-${Date.now()}`,
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

    const [wc] = await db
      .insert(workCenters)
      .values({
        tenantId: TEST_TENANT,
        name: 'Assembly Line',
        code: `AL-${Date.now()}`,
        capacityPerDay: '50',
        createdBy: 1,
      })
      .returning();
    workCenterId = wc!.id;

    const routingSvc = new RoutingService(db);
    routingId = await routingSvc.create({
      tenantId: TEST_TENANT,
      name: 'Finished Good Routing',
      finishedItemId: outputItemId,
      operations: [
        { sequenceNo: 1, operationName: 'Cut', workCenterId, standardTimeMinutes: 10 },
        { sequenceNo: 2, operationName: 'Assemble', standardTimeMinutes: 20 },
      ],
      createdBy: 1,
    });
  });

  afterAll(async () => {
    await db
      .delete(productionOrderOperations)
      .where(eq(productionOrderOperations.tenantId, TEST_TENANT));
    await db.delete(productionOrderHistory).where(eq(productionOrderHistory.tenantId, TEST_TENANT));
    await db
      .delete(productionOrderMaterials)
      .where(eq(productionOrderMaterials.tenantId, TEST_TENANT));
    await db.delete(productionOrders).where(eq(productionOrders.tenantId, TEST_TENANT));
    await db.delete(routingOperations).where(eq(routingOperations.tenantId, TEST_TENANT));
    await db.delete(routings).where(eq(routings.tenantId, TEST_TENANT));
    await db.delete(inventoryLedger).where(eq(inventoryLedger.tenantId, TEST_TENANT));
    await db.delete(projectionStockLevel).where(eq(projectionStockLevel.tenantId, TEST_TENANT));
    await db.delete(outboxEvents).where(eq(outboxEvents.tenantId, TEST_TENANT));
    await db.delete(workCenters).where(eq(workCenters.tenantId, TEST_TENANT));
    await db.delete(items).where(eq(items.tenantId, TEST_TENANT));
    await db.delete(warehouses).where(eq(warehouses.tenantId, TEST_TENANT));
    await db.delete(branches).where(eq(branches.tenantId, TEST_TENANT));
  });

  it('create() with routingId instantiates operations in sequence, copied from the routing', async () => {
    const svc = new ProductionOrderService(db);
    const orderId = await svc.create({
      tenantId: TEST_TENANT,
      orderNumber: `PO-ROUTE-${Date.now()}`,
      branchId,
      warehouseId,
      outputItemId,
      orderedQty: 1,
      laborCost: 0,
      overheadCost: 0,
      orderDate: new Date(),
      materials: [],
      routingId,
      createdBy: 1,
    });

    const ops = await db
      .select()
      .from(productionOrderOperations)
      .where(eq(productionOrderOperations.productionOrderId, orderId));
    expect(ops).toHaveLength(2);
    const bySeq = ops.sort((a, b) => a.sequenceNo - b.sequenceNo);
    expect(bySeq[0]).toMatchObject({ operationName: 'Cut', status: 'PENDING', workCenterId });
    expect(bySeq[1]).toMatchObject({ operationName: 'Assemble', status: 'PENDING' });

    const [orderRow] = await db
      .select()
      .from(productionOrders)
      .where(eq(productionOrders.id, orderId));
    expect(orderRow!.routingId).toBe(routingId);
  });

  it('startOperation()/completeOperation() transition an operation independently of the order status', async () => {
    const svc = new ProductionOrderService(db);
    const orderId = await svc.create({
      tenantId: TEST_TENANT,
      orderNumber: `PO-ROUTE-OPS-${Date.now()}`,
      branchId,
      warehouseId,
      outputItemId,
      orderedQty: 1,
      laborCost: 0,
      overheadCost: 0,
      orderDate: new Date(),
      materials: [],
      routingId,
      createdBy: 1,
    });

    const ops = await db
      .select()
      .from(productionOrderOperations)
      .where(eq(productionOrderOperations.productionOrderId, orderId));
    const cutOp = ops.find((o) => o.operationName === 'Cut')!;

    await svc.startOperation(cutOp.id, TEST_TENANT);
    let [reloaded] = await db
      .select()
      .from(productionOrderOperations)
      .where(eq(productionOrderOperations.id, cutOp.id));
    expect(reloaded!.status).toBe('IN_PROGRESS');
    expect(reloaded!.startedAt).not.toBeNull();

    await svc.completeOperation(cutOp.id, TEST_TENANT, 12.5);
    [reloaded] = await db
      .select()
      .from(productionOrderOperations)
      .where(eq(productionOrderOperations.id, cutOp.id));
    expect(reloaded!.status).toBe('COMPLETED');
    expect(parseFloat(reloaded!.actualTimeMinutes!)).toBe(12.5);
    expect(reloaded!.completedAt).not.toBeNull();

    // Order itself is still DRAFT — operations don't drive the order's own status machine.
    const [orderRow] = await db
      .select()
      .from(productionOrders)
      .where(eq(productionOrders.id, orderId));
    expect(orderRow!.status).toBe('DRAFT');
  });

  it('startOperation() rejects an operation not in PENDING status; completeOperation() rejects one not IN_PROGRESS', async () => {
    const svc = new ProductionOrderService(db);
    const orderId = await svc.create({
      tenantId: TEST_TENANT,
      orderNumber: `PO-ROUTE-GUARD-${Date.now()}`,
      branchId,
      warehouseId,
      outputItemId,
      orderedQty: 1,
      laborCost: 0,
      overheadCost: 0,
      orderDate: new Date(),
      materials: [],
      routingId,
      createdBy: 1,
    });
    const ops = await db
      .select()
      .from(productionOrderOperations)
      .where(eq(productionOrderOperations.productionOrderId, orderId));
    const cutOp = ops.find((o) => o.operationName === 'Cut')!;

    await expect(svc.completeOperation(cutOp.id, TEST_TENANT, 5)).rejects.toThrow(BusinessError);

    await svc.startOperation(cutOp.id, TEST_TENANT);
    await expect(svc.startOperation(cutOp.id, TEST_TENANT)).rejects.toThrow(BusinessError);
  });
});
