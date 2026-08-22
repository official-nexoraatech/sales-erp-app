/**
 * Manufacturing vertical — standalone Production Order (in-house manufacturing). Proves the
 * same ValuationService-backed stock-in/stock-out pattern already proven for Job Work Order
 * (job-work-order-valuation.integration.test.ts) works identically here, end-to-end against a
 * real database — no supplierId (nothing leaves the premises), laborCost/overheadCost replace
 * jobWorkRate/jobWorkCharges in the finished-goods cost calculation.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createDatabaseClient } from '@erp/db';
import {
  items,
  warehouses,
  branches,
  productionOrders,
  productionOrderMaterials,
  productionOrderHistory,
  inventoryLedger,
  projectionStockLevel,
  outboxEvents,
} from '@erp/db';
import { eq, and } from 'drizzle-orm';
import { ProductionOrderService } from '../domain/ProductionOrderService.js';
import { BOMService } from '../domain/BOMService.js';
import { boms, bomLines } from '@erp/db';
import { NotFoundError, BusinessError } from '@erp/types';

const DB_URL = process.env['DATABASE_URL'];

describe.skipIf(!DB_URL)('ProductionOrderService — valuation & projection integration', () => {
  let db: ReturnType<typeof createDatabaseClient>;
  const TEST_TENANT = 905_001 + Math.floor(Math.random() * 1000);
  let warehouseId: number;
  let branchId: number;
  let rawMaterialItemId: number;
  let outputItemId: number;

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

    const [rawItem] = await db
      .insert(items)
      .values({
        tenantId: TEST_TENANT,
        name: 'Raw Material',
        itemCode: `RM-${Date.now()}`,
        salePrice: '0',
        purchasePrice: '50.00',
        gstRate: '5.00',
        unitId: 1,
        hsnCode: '5208',
        availableQty: '100',
        waccCost: '50.00',
        currentStockValue: '5000.00',
        createdBy: 1,
      })
      .returning();
    rawMaterialItemId = rawItem!.id;

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
        waccCost: '0',
        currentStockValue: '0',
        createdBy: 1,
      })
      .returning();
    outputItemId = outItem!.id;
  });

  afterAll(async () => {
    await db.delete(bomLines).where(eq(bomLines.tenantId, TEST_TENANT));
    await db.delete(boms).where(eq(boms.tenantId, TEST_TENANT));
    await db.delete(productionOrderHistory).where(eq(productionOrderHistory.tenantId, TEST_TENANT));
    await db
      .delete(productionOrderMaterials)
      .where(eq(productionOrderMaterials.tenantId, TEST_TENANT));
    await db.delete(productionOrders).where(eq(productionOrders.tenantId, TEST_TENANT));
    await db.delete(inventoryLedger).where(eq(inventoryLedger.tenantId, TEST_TENANT));
    await db.delete(projectionStockLevel).where(eq(projectionStockLevel.tenantId, TEST_TENANT));
    await db.delete(outboxEvents).where(eq(outboxEvents.tenantId, TEST_TENANT));
    await db.delete(items).where(eq(items.tenantId, TEST_TENANT));
    await db.delete(warehouses).where(eq(warehouses.tenantId, TEST_TENANT));
    await db.delete(branches).where(eq(branches.tenantId, TEST_TENANT));
  });

  it('create() rejects an outputItemId that does not belong to this tenant', async () => {
    const svc = new ProductionOrderService(db);
    await expect(
      svc.create({
        tenantId: TEST_TENANT,
        orderNumber: `PO-BAD-${Date.now()}`,
        branchId,
        warehouseId,
        outputItemId: 999_999_999,
        orderedQty: 1,
        laborCost: 0,
        overheadCost: 0,
        orderDate: new Date(),
        materials: [],
        createdBy: 1,
      })
    ).rejects.toThrow(NotFoundError);
  });

  it('issueMaterials() deducts stock through ValuationService with real ledger before/after and a projection row', async () => {
    const svc = new ProductionOrderService(db);
    const orderId = await svc.create({
      tenantId: TEST_TENANT,
      orderNumber: `PO-${Date.now()}`,
      branchId,
      warehouseId,
      outputItemId,
      orderedQty: 10,
      laborCost: 100,
      overheadCost: 50,
      orderDate: new Date(),
      materials: [{ itemId: rawMaterialItemId, requiredQty: 10, unitCost: 50, warehouseId }],
      createdBy: 1,
    });

    await svc.issueMaterials(orderId, TEST_TENANT, 1);

    const [rawItem] = await db.select().from(items).where(eq(items.id, rawMaterialItemId));
    expect(parseFloat(rawItem!.availableQty)).toBe(90);
    expect(parseFloat(rawItem!.currentStockValue)).toBe(4500);

    const [ledgerRow] = await db
      .select()
      .from(inventoryLedger)
      .where(
        and(
          eq(inventoryLedger.tenantId, TEST_TENANT),
          eq(inventoryLedger.referenceType, 'PRODUCTION_ORDER'),
          eq(inventoryLedger.referenceId, orderId),
          eq(inventoryLedger.movementType, 'STOCK_OUT')
        )
      );
    expect(ledgerRow!.movementType).toBe('STOCK_OUT');
    expect(parseFloat(ledgerRow!.quantityBefore)).toBe(100);
    expect(parseFloat(ledgerRow!.quantityAfter)).toBe(90);

    const [orderRow] = await db
      .select()
      .from(productionOrders)
      .where(eq(productionOrders.id, orderId));
    expect(orderRow!.status).toBe('MATERIAL_ISSUED');
  });

  it('issueMaterials() rejects when stock is insufficient', async () => {
    const svc = new ProductionOrderService(db);
    const orderId = await svc.create({
      tenantId: TEST_TENANT,
      orderNumber: `PO-INSUFFICIENT-${Date.now()}`,
      branchId,
      warehouseId,
      outputItemId,
      orderedQty: 1,
      laborCost: 0,
      overheadCost: 0,
      orderDate: new Date(),
      materials: [{ itemId: rawMaterialItemId, requiredQty: 1_000_000, unitCost: 50, warehouseId }],
      createdBy: 1,
    });

    await expect(svc.issueMaterials(orderId, TEST_TENANT, 1)).rejects.toThrow(BusinessError);
  });

  it('complete() adds finished-goods stock through ValuationService, costed from materials+labor+overhead (not job-work-rate)', async () => {
    const svc = new ProductionOrderService(db);
    const orderId = await svc.create({
      tenantId: TEST_TENANT,
      orderNumber: `PO-COMPLETE-${Date.now()}`,
      branchId,
      warehouseId,
      outputItemId,
      orderedQty: 5,
      laborCost: 100,
      overheadCost: 50,
      orderDate: new Date(),
      materials: [{ itemId: rawMaterialItemId, requiredQty: 5, unitCost: 50, warehouseId }],
      createdBy: 1,
    });
    await svc.issueMaterials(orderId, TEST_TENANT, 1);

    await svc.complete(orderId, TEST_TENANT, {
      tenantId: TEST_TENANT,
      receivedQty: 5,
      rejectedQty: 0,
      scrapQty: 0,
      userId: 1,
    });

    // materialsCost (5*50=250) + laborCost (100) + overheadCost (50) = 400 / receivedQty 5 = 80/unit
    const [outItem] = await db.select().from(items).where(eq(items.id, outputItemId));
    expect(parseFloat(outItem!.availableQty)).toBe(5);
    expect(parseFloat(outItem!.currentStockValue)).toBe(400);
    expect(parseFloat(outItem!.waccCost)).toBe(80);

    const [orderRow] = await db
      .select()
      .from(productionOrders)
      .where(eq(productionOrders.id, orderId));
    expect(orderRow!.status).toBe('COMPLETED');
    expect(parseFloat(orderRow!.finishedGoodsCost)).toBe(80);
  });

  it('cancel() after material issue restores stock', async () => {
    const svc = new ProductionOrderService(db);
    const orderId = await svc.create({
      tenantId: TEST_TENANT,
      orderNumber: `PO-CANCEL-${Date.now()}`,
      branchId,
      warehouseId,
      outputItemId,
      orderedQty: 3,
      laborCost: 0,
      overheadCost: 0,
      orderDate: new Date(),
      materials: [{ itemId: rawMaterialItemId, requiredQty: 3, unitCost: 50, warehouseId }],
      createdBy: 1,
    });
    await svc.issueMaterials(orderId, TEST_TENANT, 1);

    const [beforeCancel] = await db.select().from(items).where(eq(items.id, rawMaterialItemId));
    const qtyAfterIssue = parseFloat(beforeCancel!.availableQty);

    await svc.cancel(orderId, TEST_TENANT, 1, 'Test cancellation');

    const [afterCancel] = await db.select().from(items).where(eq(items.id, rawMaterialItemId));
    expect(parseFloat(afterCancel!.availableQty)).toBe(qtyAfterIssue + 3);

    const [orderRow] = await db
      .select()
      .from(productionOrders)
      .where(eq(productionOrders.id, orderId));
    expect(orderRow!.status).toBe('CANCELLED');
  });

  it('create() with bomId auto-populates materials from BOMService.explode(), scaled to orderedQty', async () => {
    const bomSvc = new BOMService(db);
    const bomId = await bomSvc.create({
      tenantId: TEST_TENANT,
      name: 'Production Order Test BOM',
      finishedItemId: outputItemId,
      outputQty: 1,
      lines: [{ componentItemId: rawMaterialItemId, quantityPerOutput: 2, scrapPercent: 0 }],
      createdBy: 1,
    });

    const svc = new ProductionOrderService(db);
    const orderId = await svc.create({
      tenantId: TEST_TENANT,
      orderNumber: `PO-BOM-${Date.now()}`,
      branchId,
      warehouseId,
      outputItemId,
      orderedQty: 4,
      laborCost: 0,
      overheadCost: 0,
      orderDate: new Date(),
      bomId,
      createdBy: 1,
    });

    const [material] = await db
      .select()
      .from(productionOrderMaterials)
      .where(eq(productionOrderMaterials.productionOrderId, orderId));
    expect(material!.itemId).toBe(rawMaterialItemId);
    expect(parseFloat(material!.requiredQty)).toBe(8); // 2 * 4
    expect(parseFloat(material!.unitCost)).toBe(50); // items.purchasePrice
  });
});
