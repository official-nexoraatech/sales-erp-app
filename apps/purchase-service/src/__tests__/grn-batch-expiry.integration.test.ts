/**
 * Multi-vertical platform audit 2026-08-16, Phase 1: grnLines.batchNumber/expiryDate were
 * captured on receipt but GRNService.approve() discarded them before they ever reached
 * inventory_fifo_layers — the single biggest gap blocking a credible Grocery launch (no way
 * to do FEFO issuance or expiry alerting). This proves the fix end-to-end against a real
 * database: approving a GRN line with a batch/expiry now produces a FIFO layer carrying them.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createDatabaseClient } from '@erp/db';
import {
  items,
  warehouses,
  branches,
  suppliers,
  purchaseOrders,
  purchaseOrderLines,
  grns,
  grnLines,
  inventoryFifoLayers,
  inventoryLedger,
  projectionSupplierBalance,
} from '@erp/db';
import { eq, and } from 'drizzle-orm';
import { GRNService } from '../domain/GRNService.js';

const DB_URL = process.env['DATABASE_URL'];

describe.skipIf(!DB_URL)('GRNService.approve — batch/expiry threading to FIFO layers', () => {
  let db: ReturnType<typeof createDatabaseClient>;
  const TEST_TENANT = 905_001 + Math.floor(Math.random() * 1000);
  let branchId: number;
  let warehouseId: number;
  let supplierId: number;
  let itemId: number;
  let poId: number;
  let poLineId: number;

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
        displayName: 'Test Perishables Supplier',
        phone: '9999999999',
        createdBy: 1,
      })
      .returning();
    supplierId = supplier!.id;

    const [item] = await db
      .insert(items)
      .values({
        tenantId: TEST_TENANT,
        name: 'Perishable Test Item',
        itemCode: `PERISH-${Date.now()}`,
        salePrice: '20.00',
        purchasePrice: '10.00',
        gstRate: '5.00',
        unitId: 1,
        hsnCode: '0401',
        costingMethod: 'FIFO',
        availableQty: '0',
        createdBy: 1,
      })
      .returning();
    itemId = item!.id;

    const [po] = await db
      .insert(purchaseOrders)
      .values({
        tenantId: TEST_TENANT,
        branchId,
        warehouseId,
        supplierId,
        status: 'APPROVED',
        poDate: new Date(),
        placeOfSupply: '27',
        createdBy: 1,
      })
      .returning();
    poId = po!.id;

    const [poLine] = await db
      .insert(purchaseOrderLines)
      .values({
        purchaseOrderId: poId,
        tenantId: TEST_TENANT,
        lineNumber: 1,
        itemId,
        orderedQty: '10',
        unitPrice: '10.00',
        lineTotal: '100.00',
      })
      .returning();
    poLineId = poLine!.id;
  });

  afterAll(async () => {
    await db.delete(inventoryFifoLayers).where(eq(inventoryFifoLayers.tenantId, TEST_TENANT));
    await db.delete(inventoryLedger).where(eq(inventoryLedger.tenantId, TEST_TENANT));
    await db.delete(grnLines).where(eq(grnLines.tenantId, TEST_TENANT));
    await db.delete(grns).where(eq(grns.tenantId, TEST_TENANT));
    await db.delete(purchaseOrderLines).where(eq(purchaseOrderLines.tenantId, TEST_TENANT));
    await db.delete(purchaseOrders).where(eq(purchaseOrders.tenantId, TEST_TENANT));
    await db
      .delete(projectionSupplierBalance)
      .where(eq(projectionSupplierBalance.tenantId, TEST_TENANT));
    await db.delete(items).where(eq(items.tenantId, TEST_TENANT));
    await db.delete(suppliers).where(eq(suppliers.tenantId, TEST_TENANT));
    await db.delete(warehouses).where(eq(warehouses.tenantId, TEST_TENANT));
    await db.delete(branches).where(eq(branches.tenantId, TEST_TENANT));
  });

  it('approving a GRN line with batchNumber/expiryDate creates a FIFO layer carrying them', async () => {
    const expiry = new Date('2026-06-15T00:00:00Z');

    const [grn] = await db
      .insert(grns)
      .values({
        tenantId: TEST_TENANT,
        branchId,
        warehouseId,
        purchaseOrderId: poId,
        supplierId,
        status: 'DRAFT',
        grnDate: new Date(),
        grandTotal: '100.00',
        createdBy: 1,
      })
      .returning();
    const grnId = grn!.id;

    await db.insert(grnLines).values({
      grnId,
      tenantId: TEST_TENANT,
      lineNumber: 1,
      itemId,
      purchaseOrderLineId: poLineId,
      orderedQty: '10',
      receivedQty: '10',
      grnRate: '10.00',
      lineTotal: '100.00',
      batchNumber: 'LOT-2026-06',
      expiryDate: expiry,
      qcStatus: 'PASSED',
    });

    const svc = new GRNService(db);
    await svc.approve(grnId, TEST_TENANT, 1, `GRN-${Date.now()}`);

    const [layer] = await db
      .select()
      .from(inventoryFifoLayers)
      .where(
        and(eq(inventoryFifoLayers.tenantId, TEST_TENANT), eq(inventoryFifoLayers.itemId, itemId))
      );
    expect(layer).toBeDefined();
    expect(layer!.batchNumber).toBe('LOT-2026-06');
    expect(layer!.expiryDate?.toISOString()).toBe(expiry.toISOString());
    expect(parseFloat(layer!.remainingQty)).toBe(10);
  });
});
