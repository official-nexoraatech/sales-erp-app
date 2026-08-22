/**
 * Phase 2B closure review (41-phase-2b-closure-review.md, §5, F2 gap): PurchaseReturnService
 * .approve() calls the shared ValuationService.consumeForStockOut identically to
 * inventory-service's InventoryLedgerService.deductStock (already FEFO-proven by
 * fefo-consumption-flows.integration.test.ts) — but had zero dedicated test proving FEFO
 * ordering actually holds at this specific call site. Follows that same file's exact template:
 * real Postgres, two layers per item (one received-first/expires-later, one received-second/
 * expires-sooner), assert the sooner-expiring layer drains first, plus a fefoEnabled:false
 * regression case proving today's FIFO-by-receivedAt behavior is unchanged.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createDatabaseClient, type ErpDatabase } from '@erp/db';
import {
  items,
  warehouses,
  branches,
  suppliers,
  purchaseOrders,
  grns,
  grnLines,
  inventoryFifoLayers,
  inventoryLedger,
  purchaseReturns,
  purchaseReturnLines,
  debitNotes,
  projectionStockLevel,
  projectionSupplierBalance,
} from '@erp/db';
import { eq, and } from 'drizzle-orm';
import { PurchaseReturnService } from '../domain/PurchaseReturnService.js';

const DB_URL = process.env['DATABASE_URL'];

describe.skipIf(!DB_URL)('PurchaseReturnService.approve — FEFO consumption, real Postgres', () => {
  let db: ErpDatabase;
  const TENANT = 900_301 + Math.floor(Math.random() * 1000);
  let branchId: number;
  let warehouseId: number;
  let supplierId: number;
  let poId: number;
  let fefoItemId: number;
  let fifoItemId: number;
  let grnId: number;
  let fefoGrnLineId: number;
  let fifoGrnLineId: number;

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
        createdBy: 1,
      })
      .returning();
    poId = po!.id;

    const baseItem = {
      tenantId: TENANT,
      unitId: 1,
      hsnCode: '1234',
      gstRate: '5.00',
      salePrice: '100.00',
      purchasePrice: '50.00',
      costingMethod: 'FIFO' as const,
      availableQty: '100.000',
      createdBy: 1,
    };
    const [fefoItem] = await db
      .insert(items)
      .values({
        ...baseItem,
        name: 'FEFO Return Item',
        itemCode: `PRF-${TENANT}`,
        fefoEnabled: true,
      })
      .returning();
    fefoItemId = fefoItem!.id;

    const [fifoItem] = await db
      .insert(items)
      .values({
        ...baseItem,
        name: 'FIFO Return Item',
        itemCode: `PRR-${TENANT}`,
        fefoEnabled: false,
      })
      .returning();
    fifoItemId = fifoItem!.id;

    // Deliberately skip GRNService.approve() — inserting the GRN/grnLine rows directly (status
    // APPROVED, receivedQty set) so PurchaseReturnService.create()'s validation is satisfied,
    // without GRN approval creating its own FIFO layer — this test controls the layers directly.
    const [grn] = await db
      .insert(grns)
      .values({
        tenantId: TENANT,
        branchId,
        warehouseId,
        purchaseOrderId: poId,
        supplierId,
        status: 'APPROVED',
        grnDate: new Date(),
        grandTotal: '10000.00',
        createdBy: 1,
      })
      .returning();
    grnId = grn!.id;

    const [fefoGrnLine] = await db
      .insert(grnLines)
      .values({
        grnId,
        tenantId: TENANT,
        lineNumber: 1,
        itemId: fefoItemId,
        orderedQty: '100',
        receivedQty: '100',
        grnRate: '50.00',
        lineTotal: '5000.00',
      })
      .returning();
    fefoGrnLineId = fefoGrnLine!.id;

    const [fifoGrnLine] = await db
      .insert(grnLines)
      .values({
        grnId,
        tenantId: TENANT,
        lineNumber: 2,
        itemId: fifoItemId,
        orderedQty: '100',
        receivedQty: '100',
        grnRate: '50.00',
        lineTotal: '5000.00',
      })
      .returning();
    fifoGrnLineId = fifoGrnLine!.id;

    const now = Date.now();
    const DAY = 24 * 60 * 60 * 1000;
    await db.insert(inventoryFifoLayers).values([
      {
        tenantId: TENANT,
        itemId: fefoItemId,
        warehouseId,
        receivedAt: new Date(now - 10 * DAY), // received first
        originalQty: '50.000',
        remainingQty: '50.000',
        unitCost: '10.00',
        sourceLedgerId: 999801,
        batchNumber: `BATCH-A-fefo`,
        expiryDate: new Date(now + 60 * DAY), // expires later
      },
      {
        tenantId: TENANT,
        itemId: fefoItemId,
        warehouseId,
        receivedAt: new Date(now - 2 * DAY), // received second (more recent)
        originalQty: '50.000',
        remainingQty: '50.000',
        unitCost: '12.00',
        sourceLedgerId: 999802,
        batchNumber: `BATCH-B-fefo`,
        expiryDate: new Date(now + 5 * DAY), // expires sooner — FEFO should pick this first
      },
      {
        tenantId: TENANT,
        itemId: fifoItemId,
        warehouseId,
        receivedAt: new Date(now - 10 * DAY),
        originalQty: '50.000',
        remainingQty: '50.000',
        unitCost: '10.00',
        sourceLedgerId: 999803,
        batchNumber: `BATCH-A-fifo`,
      },
      {
        tenantId: TENANT,
        itemId: fifoItemId,
        warehouseId,
        receivedAt: new Date(now - 2 * DAY),
        originalQty: '50.000',
        remainingQty: '50.000',
        unitCost: '12.00',
        sourceLedgerId: 999804,
        batchNumber: `BATCH-B-fifo`,
      },
    ]);
  });

  afterAll(async () => {
    await db.delete(inventoryLedger).where(eq(inventoryLedger.tenantId, TENANT));
    await db.delete(projectionStockLevel).where(eq(projectionStockLevel.tenantId, TENANT));
    await db.delete(debitNotes).where(eq(debitNotes.tenantId, TENANT));
    await db.delete(purchaseReturnLines).where(eq(purchaseReturnLines.tenantId, TENANT));
    await db.delete(purchaseReturns).where(eq(purchaseReturns.tenantId, TENANT));
    await db.delete(inventoryFifoLayers).where(eq(inventoryFifoLayers.tenantId, TENANT));
    await db.delete(grnLines).where(eq(grnLines.tenantId, TENANT));
    await db.delete(grns).where(eq(grns.tenantId, TENANT));
    await db.delete(purchaseOrders).where(eq(purchaseOrders.tenantId, TENANT));
    await db
      .delete(projectionSupplierBalance)
      .where(eq(projectionSupplierBalance.tenantId, TENANT));
    await db.delete(items).where(eq(items.tenantId, TENANT));
    await db.delete(suppliers).where(eq(suppliers.tenantId, TENANT));
    await db.delete(warehouses).where(eq(warehouses.tenantId, TENANT));
    await db.delete(branches).where(eq(branches.tenantId, TENANT));
  });

  async function layerRemaining(itemId: number, batchNumber: string): Promise<number> {
    const [row] = await db
      .select({ remainingQty: inventoryFifoLayers.remainingQty })
      .from(inventoryFifoLayers)
      .where(
        and(
          eq(inventoryFifoLayers.itemId, itemId),
          eq(inventoryFifoLayers.batchNumber, batchNumber)
        )
      );
    return parseFloat(row!.remainingQty);
  }

  it('fefoEnabled item: approve() consumes the soonest-to-expire layer first, not the earliest-received one', async () => {
    const svc = new PurchaseReturnService(db);
    const returnId = await svc.create({
      tenantId: TENANT,
      branchId,
      grnId,
      supplierId,
      warehouseId,
      returnDate: new Date(),
      reason: 'QUALITY_ISSUE',
      lines: [
        { grnLineId: fefoGrnLineId, itemId: fefoItemId, returnQty: 20, unitPrice: 50, gstRate: 5 },
      ],
      createdBy: 1,
    });

    await svc.approve(returnId, TENANT, 1);

    expect(await layerRemaining(fefoItemId, 'BATCH-B-fefo')).toBe(30); // earlier expiry, drawn down
    expect(await layerRemaining(fefoItemId, 'BATCH-A-fefo')).toBe(50); // later expiry, untouched
  });

  it('regression: fefoEnabled: false item still consumes strictly in receipt order (FIFO), unaffected', async () => {
    const svc = new PurchaseReturnService(db);
    const returnId = await svc.create({
      tenantId: TENANT,
      branchId,
      grnId,
      supplierId,
      warehouseId,
      returnDate: new Date(),
      reason: 'QUALITY_ISSUE',
      lines: [
        { grnLineId: fifoGrnLineId, itemId: fifoItemId, returnQty: 20, unitPrice: 50, gstRate: 5 },
      ],
      createdBy: 1,
    });
    await svc.approve(returnId, TENANT, 1);

    expect(await layerRemaining(fifoItemId, 'BATCH-A-fifo')).toBe(30); // earliest-received, drawn down first
    expect(await layerRemaining(fifoItemId, 'BATCH-B-fifo')).toBe(50); // later-received, untouched
  });
});
