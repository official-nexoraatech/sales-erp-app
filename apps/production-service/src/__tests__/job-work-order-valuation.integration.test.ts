/**
 * Multi-vertical platform audit 2026-08-16, Phase 1 consolidation: issueMaterials()/complete()
 * used to move items.availableQty and write an inventory_ledger row with placeholder
 * quantityBefore/After ('0'/'0') without ever calling ValuationService — job-work stock
 * movements never touched waccCost/currentStockValue/FIFO layers (COGS silently ignored
 * job-work material usage), and projection_stock_level (the per-warehouse Stock Levels read
 * model) was never updated. This suite proves the fix end-to-end against a real database:
 * both legs now share the same ValuationService GRN/sales/adjustments already use, with real
 * ledger before/after and a projection update.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createDatabaseClient } from '@erp/db';
import {
  items,
  warehouses,
  branches,
  suppliers,
  jobWorkOrders,
  jobWorkOrderMaterials,
  jobWorkOrderHistory,
  inventoryLedger,
  projectionStockLevel,
  outboxEvents,
} from '@erp/db';
import { eq, and } from 'drizzle-orm';
import { JobWorkOrderService } from '../domain/JobWorkOrderService.js';

const DB_URL = process.env['DATABASE_URL'];

describe.skipIf(!DB_URL)('JobWorkOrderService — valuation & projection integration', () => {
  let db: ReturnType<typeof createDatabaseClient>;
  const TEST_TENANT = 903_001 + Math.floor(Math.random() * 1000);
  let warehouseId: number;
  let branchId: number;
  let supplierId: number;
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
    await db.delete(jobWorkOrderHistory).where(eq(jobWorkOrderHistory.tenantId, TEST_TENANT));
    await db.delete(jobWorkOrderMaterials).where(eq(jobWorkOrderMaterials.tenantId, TEST_TENANT));
    await db.delete(jobWorkOrders).where(eq(jobWorkOrders.tenantId, TEST_TENANT));
    await db.delete(inventoryLedger).where(eq(inventoryLedger.tenantId, TEST_TENANT));
    await db.delete(projectionStockLevel).where(eq(projectionStockLevel.tenantId, TEST_TENANT));
    await db.delete(outboxEvents).where(eq(outboxEvents.tenantId, TEST_TENANT));
    await db.delete(items).where(eq(items.tenantId, TEST_TENANT));
    await db.delete(suppliers).where(eq(suppliers.tenantId, TEST_TENANT));
    await db.delete(warehouses).where(eq(warehouses.tenantId, TEST_TENANT));
    await db.delete(branches).where(eq(branches.tenantId, TEST_TENANT));
  });

  it('issueMaterials() deducts stock through ValuationService with real ledger before/after and a projection row', async () => {
    const svc = new JobWorkOrderService(db);
    const orderId = await svc.create({
      tenantId: TEST_TENANT,
      orderNumber: `JWO-${Date.now()}`,
      supplierId,
      branchId,
      warehouseId,
      outputItemId,
      orderedQty: 10,
      jobWorkRate: 20,
      orderDate: new Date(),
      materials: [{ itemId: rawMaterialItemId, requiredQty: 10, unitCost: 50, warehouseId }],
      createdBy: 1,
    });

    await svc.issueMaterials(orderId, TEST_TENANT, 1);

    // Stock deducted
    const [rawItem] = await db.select().from(items).where(eq(items.id, rawMaterialItemId));
    expect(parseFloat(rawItem!.availableQty)).toBe(90);
    // ValuationService.consumeForStockOut must have decremented currentStockValue by
    // qty * waccCost (10 * 50 = 500) — this was silently skipped before the fix.
    expect(parseFloat(rawItem!.currentStockValue)).toBe(4500);

    // Ledger row has real before/after, not placeholder '0'/'0'
    const [ledgerRow] = await db
      .select()
      .from(inventoryLedger)
      .where(
        and(
          eq(inventoryLedger.tenantId, TEST_TENANT),
          eq(inventoryLedger.referenceType, 'JOB_WORK_ORDER'),
          eq(inventoryLedger.referenceId, orderId),
          eq(inventoryLedger.movementType, 'STOCK_OUT')
        )
      );
    expect(ledgerRow!.movementType).toBe('STOCK_OUT');
    expect(parseFloat(ledgerRow!.quantityBefore)).toBe(100);
    expect(parseFloat(ledgerRow!.quantityAfter)).toBe(90);

    // Projection row was created — previously job-work never touched this table at all
    const [projectionRow] = await db
      .select()
      .from(projectionStockLevel)
      .where(eq(projectionStockLevel.itemId, rawMaterialItemId));
    expect(projectionRow).toBeDefined();
    expect(parseFloat(projectionRow!.availableQty)).toBe(0); // clamped: delta was -10 on an insert-only row
  });

  it('complete() adds finished-goods stock through ValuationService with real ledger before/after and a projection row', async () => {
    const svc = new JobWorkOrderService(db);
    const orderId = await svc.create({
      tenantId: TEST_TENANT,
      orderNumber: `JWO-COMPLETE-${Date.now()}`,
      supplierId,
      branchId,
      warehouseId,
      outputItemId,
      orderedQty: 5,
      jobWorkRate: 30,
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

    // materialsCost (5*50=250) + jobWorkCharges (5*30=150) = 400 / receivedQty 5 = 80/unit
    const [outItem] = await db.select().from(items).where(eq(items.id, outputItemId));
    expect(parseFloat(outItem!.availableQty)).toBe(5);
    expect(parseFloat(outItem!.currentStockValue)).toBe(400);
    expect(parseFloat(outItem!.waccCost)).toBe(80);

    const [ledgerRow] = await db
      .select()
      .from(inventoryLedger)
      .where(
        and(
          eq(inventoryLedger.tenantId, TEST_TENANT),
          eq(inventoryLedger.referenceType, 'JOB_WORK_ORDER'),
          eq(inventoryLedger.referenceId, orderId),
          eq(inventoryLedger.movementType, 'STOCK_IN')
        )
      );
    expect(ledgerRow!.movementType).toBe('STOCK_IN');
    expect(parseFloat(ledgerRow!.quantityBefore)).toBe(0);
    expect(parseFloat(ledgerRow!.quantityAfter)).toBe(5);

    const [projectionRow] = await db
      .select()
      .from(projectionStockLevel)
      .where(eq(projectionStockLevel.itemId, outputItemId));
    expect(projectionRow).toBeDefined();
    expect(parseFloat(projectionRow!.availableQty)).toBe(5);
  });
});
