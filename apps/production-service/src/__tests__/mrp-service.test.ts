// Manufacturing vertical — MRPService tests against a real Postgres DB, mirroring
// bom-service.test.ts's own real-DB/tenant/item-provisioning pattern. Each scenario uses its own
// dedicated items so mutable state (stock, open POs, open production orders) never leaks between
// tests sharing a fixture.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createDatabaseClient, type ErpDatabase } from '@erp/db';
import {
  items,
  branches,
  warehouses,
  suppliers,
  boms,
  bomLines,
  productionOrders,
  purchaseOrders,
  purchaseOrderLines,
  purchaseRequisitions,
  purchaseRequisitionLines,
} from '@erp/db';
import { eq } from 'drizzle-orm';
import { BusinessError } from '@erp/types';
import { MRPService } from '../domain/MRPService.js';
import { BOMService } from '../domain/BOMService.js';

const DB_URL = process.env['DATABASE_URL'];

describe.skipIf(!DB_URL)('MRPService — real Postgres', () => {
  let db: ErpDatabase;
  const TENANT = 908_001 + Math.floor(Math.random() * 1000);
  let branchId: number;
  let warehouseId: number;
  let supplierId: number;

  async function makeItem(name: string, availableQty = '0'): Promise<number> {
    const [row] = await db
      .insert(items)
      .values({
        tenantId: TENANT,
        name,
        itemCode: `${name.replace(/\s+/g, '-')}-${Date.now()}-${Math.floor(Math.random() * 10000)}`,
        salePrice: '100.00',
        purchasePrice: '10.00',
        gstRate: '18.00',
        unitId: 1,
        hsnCode: '3926',
        availableQty,
        createdBy: 1,
      })
      .returning();
    return row!.id;
  }

  async function makeBom(
    finishedItemId: number,
    lines: Array<{ componentItemId: number; qty: number }>
  ): Promise<void> {
    const svc = new BOMService(db);
    await svc.create({
      tenantId: TENANT,
      name: `BOM for ${finishedItemId}`,
      finishedItemId,
      lines: lines.map((l) => ({ componentItemId: l.componentItemId, quantityPerOutput: l.qty })),
      createdBy: 1,
    });
  }

  beforeAll(async () => {
    db = createDatabaseClient({ url: DB_URL! });

    const [branch] = await db
      .insert(branches)
      .values({
        tenantId: TENANT,
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
        tenantId: TENANT,
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
        tenantId: TENANT,
        branchId,
        displayName: 'Test Supplier',
        phone: '9999999999',
        createdBy: 1,
      })
      .returning();
    supplierId = supplier!.id;
  });

  afterAll(async () => {
    await db.delete(purchaseRequisitionLines).where(eq(purchaseRequisitionLines.tenantId, TENANT));
    await db.delete(purchaseRequisitions).where(eq(purchaseRequisitions.tenantId, TENANT));
    await db.delete(purchaseOrderLines).where(eq(purchaseOrderLines.tenantId, TENANT));
    await db.delete(purchaseOrders).where(eq(purchaseOrders.tenantId, TENANT));
    await db.delete(productionOrders).where(eq(productionOrders.tenantId, TENANT));
    await db.delete(bomLines).where(eq(bomLines.tenantId, TENANT));
    await db.delete(boms).where(eq(boms.tenantId, TENANT));
    await db.delete(suppliers).where(eq(suppliers.tenantId, TENANT));
    await db.delete(items).where(eq(items.tenantId, TENANT));
    await db.delete(warehouses).where(eq(warehouses.tenantId, TENANT));
    await db.delete(branches).where(eq(branches.tenantId, TENANT));
  });

  it('nets a leaf (no-BOM) item against on-hand stock and an open PO — lands in toPurchase', async () => {
    const rawLeaf = await makeItem('Raw Leaf', '20');

    const [po] = await db
      .insert(purchaseOrders)
      .values({
        tenantId: TENANT,
        branchId,
        warehouseId,
        supplierId,
        status: 'APPROVED',
        poDate: new Date(),
        placeOfSupply: '27',
        sellerStateCode: '27',
        subtotal: '0',
        discountAmount: '0',
        taxableAmount: '0',
        cgstAmount: '0',
        sgstAmount: '0',
        igstAmount: '0',
        grandTotal: '0',
        receivedAmount: '0',
        createdBy: 1,
      })
      .returning();
    await db.insert(purchaseOrderLines).values({
      purchaseOrderId: po!.id,
      tenantId: TENANT,
      lineNumber: 1,
      itemId: rawLeaf,
      orderedQty: '15',
      unitPrice: '10',
      receivedQty: '5',
      lineTotal: '150',
    });

    const svc = new MRPService(db);
    const result = await svc.computeRequirements(TENANT, [{ itemId: rawLeaf, requiredQty: 100 }]);

    expect(result.toProduce).toHaveLength(0);
    expect(result.toPurchase).toHaveLength(1);
    expect(result.toPurchase[0]).toMatchObject({
      itemId: rawLeaf,
      onHandQty: 20,
      onOrderQty: 10,
      netQty: 70,
    });
  });

  it('explodes a 2-level BOM, aggregating shortages into toProduce (sub-assembly) and toPurchase (raw materials)', async () => {
    const rawUnderSub = await makeItem('Raw Under Sub');
    const subItem = await makeItem('Sub Item');
    const rawDirect = await makeItem('Raw Direct');
    const finishedItem = await makeItem('Finished Item');

    await makeBom(subItem, [{ componentItemId: rawUnderSub, qty: 4 }]);
    await makeBom(finishedItem, [
      { componentItemId: subItem, qty: 2 },
      { componentItemId: rawDirect, qty: 1 },
    ]);

    const svc = new MRPService(db);
    const result = await svc.computeRequirements(TENANT, [
      { itemId: finishedItem, requiredQty: 5 },
    ]);

    expect(result.toProduce).toHaveLength(2);
    expect(result.toProduce.find((l) => l.itemId === finishedItem)).toMatchObject({ netQty: 5 });
    expect(result.toProduce.find((l) => l.itemId === subItem)).toMatchObject({ netQty: 10 });

    expect(result.toPurchase).toHaveLength(2);
    expect(result.toPurchase.find((l) => l.itemId === rawUnderSub)).toMatchObject({ netQty: 40 });
    expect(result.toPurchase.find((l) => l.itemId === rawDirect)).toMatchObject({ netQty: 5 });
  });

  it('a fully-covered top-level item produces zero shortages and does not descend into its BOM', async () => {
    const rawX = await makeItem('Raw X (should not appear)');
    const finishedCovered = await makeItem('Finished Covered', '10');
    await makeBom(finishedCovered, [{ componentItemId: rawX, qty: 3 }]);

    const svc = new MRPService(db);
    const result = await svc.computeRequirements(TENANT, [
      { itemId: finishedCovered, requiredQty: 5 },
    ]);

    expect(result.toProduce).toHaveLength(0);
    expect(result.toPurchase).toHaveLength(0);
  });

  it('excludes a CANCELLED production order from on-order quantity for a produced item', async () => {
    const rawY = await makeItem('Raw Y');
    const finishedCancelledPO = await makeItem('Finished With Cancelled PO');
    await makeBom(finishedCancelledPO, [{ componentItemId: rawY, qty: 1 }]);

    await db.insert(productionOrders).values({
      tenantId: TENANT,
      branchId,
      warehouseId,
      outputItemId: finishedCancelledPO,
      orderedQty: '5',
      receivedQty: '0',
      status: 'CANCELLED',
      orderDate: new Date(),
      createdBy: 1,
    });

    const svc = new MRPService(db);
    const result = await svc.computeRequirements(TENANT, [
      { itemId: finishedCancelledPO, requiredQty: 5 },
    ]);

    expect(result.toProduce).toHaveLength(1);
    expect(result.toProduce[0]).toMatchObject({
      itemId: finishedCancelledPO,
      onOrderQty: 0,
      netQty: 5,
    });
  });

  it('rejects a demand line for an item that does not belong to this tenant', async () => {
    const svc = new MRPService(db);
    await expect(
      svc.computeRequirements(TENANT, [{ itemId: 999_999_999, requiredQty: 1 }])
    ).rejects.toThrow(BusinessError);
  });

  it('createRequisitionFromShortages persists a DRAFT requisition with the given lines', async () => {
    const rawA = await makeItem('Req Raw A');
    const rawB = await makeItem('Req Raw B');

    const svc = new MRPService(db);
    const reqId = await svc.createRequisitionFromShortages({
      tenantId: TENANT,
      branchId,
      lines: [
        { itemId: rawA, qty: 25 },
        { itemId: rawB, qty: 8, estimatedUnitPrice: 12 },
      ],
      requestedBy: 1,
    });

    const [req] = await db
      .select()
      .from(purchaseRequisitions)
      .where(eq(purchaseRequisitions.id, reqId));
    expect(req).toMatchObject({ status: 'DRAFT', notes: 'Auto-created from MRP run' });

    const lines = await db
      .select()
      .from(purchaseRequisitionLines)
      .where(eq(purchaseRequisitionLines.requisitionId, reqId));
    expect(lines).toHaveLength(2);
    expect(lines.find((l) => l.itemId === rawB)?.requestedQty).toBe('8.000');
  });

  it('createRequisitionFromShortages rejects a line for an item that does not belong to this tenant', async () => {
    const svc = new MRPService(db);
    await expect(
      svc.createRequisitionFromShortages({
        tenantId: TENANT,
        branchId,
        lines: [{ itemId: 999_999_999, qty: 1 }],
        requestedBy: 1,
      })
    ).rejects.toThrow(BusinessError);
  });
});
