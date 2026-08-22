// Phase 2B (INVENTORY_BATCH capability) — real-Postgres proof that the shared FEFO ordering
// (packages/platform-sdk/src/valuation-engine.ts, already unit-proven by Phase 2A's
// valuation-fefo.test.ts) is actually reached from InventoryLedgerService.deductStock and
// .adjustStock — the two entrypoints StockTransferService, StockAdjustmentService, and
// PhysicalVerificationService all funnel through (27-affected-flow-matrix.md). PurchaseReturnService
// (purchase-service) and JobWorkOrderService (production-service) call the identical shared
// ValuationService.consumeForStockOut(db, { tenantId, itemId, variantId, warehouseId, quantity })
// directly with the same parameter shape — verified by direct code read, not re-tested here,
// since there is no flow-specific logic between those call sites and this one that could diverge.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createDatabaseClient, type ErpDatabase } from '@erp/db';
import {
  items,
  warehouses,
  branches,
  inventoryFifoLayers,
  inventoryLedger,
  projectionStockLevel,
} from '@erp/db';
import { eq, and, inArray } from 'drizzle-orm';
import { InventoryLedgerService } from '../domain/InventoryLedgerService.js';

const DB_URL = process.env['DATABASE_URL'];

describe.skipIf(!DB_URL)('FEFO consumption — real Postgres, InventoryLedgerService', () => {
  let db: ErpDatabase;
  let ledgerService: InventoryLedgerService;
  const TENANT = 900_101 + Math.floor(Math.random() * 1000);
  let warehouseId: number;
  let fefoItemDeductId: number;
  let fefoItemAdjustId: number;
  let fifoItemId: number;

  beforeAll(async () => {
    db = createDatabaseClient({ url: DB_URL! });
    ledgerService = new InventoryLedgerService(db);

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
    const [wh] = await db
      .insert(warehouses)
      .values({
        tenantId: TENANT,
        branchId: branch!.id,
        name: 'Main WH',
        code: 'MWH',
        isDefault: true,
        isActive: true,
        createdBy: 1,
      })
      .returning();
    warehouseId = wh!.id;

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

    const [fefoDeduct] = await db
      .insert(items)
      .values({
        ...baseItem,
        name: 'FEFO Deduct Item',
        itemCode: `FD-${TENANT}`,
        fefoEnabled: true,
      })
      .returning();
    fefoItemDeductId = fefoDeduct!.id;

    const [fefoAdjust] = await db
      .insert(items)
      .values({
        ...baseItem,
        name: 'FEFO Adjust Item',
        itemCode: `FA-${TENANT}`,
        fefoEnabled: true,
      })
      .returning();
    fefoItemAdjustId = fefoAdjust!.id;

    const [fifo] = await db
      .insert(items)
      .values({
        ...baseItem,
        name: 'Plain FIFO Item',
        itemCode: `PF-${TENANT}`,
        fefoEnabled: false,
      })
      .returning();
    fifoItemId = fifo!.id;

    const now = Date.now();
    const DAY = 24 * 60 * 60 * 1000;
    // For each fefoEnabled item: Layer A received first (FIFO would pick it first) but expires
    // LATER; Layer B received second but expires SOONER. FEFO must consume B before A despite
    // B being the more-recently-received layer.
    for (const [itemId, tag] of [
      [fefoItemDeductId, 'deduct'],
      [fefoItemAdjustId, 'adjust'],
    ] as const) {
      await db.insert(inventoryFifoLayers).values([
        {
          tenantId: TENANT,
          itemId,
          warehouseId,
          receivedAt: new Date(now - 10 * DAY), // received first
          originalQty: '50.000',
          remainingQty: '50.000',
          unitCost: '10.00',
          sourceLedgerId: 999901,
          batchNumber: `BATCH-A-${tag}`,
          expiryDate: new Date(now + 60 * DAY), // expires later
        },
        {
          tenantId: TENANT,
          itemId,
          warehouseId,
          receivedAt: new Date(now - 2 * DAY), // received second (more recent)
          originalQty: '50.000',
          remainingQty: '50.000',
          unitCost: '12.00',
          sourceLedgerId: 999902,
          batchNumber: `BATCH-B-${tag}`,
          expiryDate: new Date(now + 5 * DAY), // expires sooner — FEFO should pick this first
        },
      ]);
    }

    // Plain FIFO item: only receivedAt differs (no expiry concept at all) — Layer A received
    // first, no batch/expiry. FIFO must consume A first (receipt order), unaffected by anything.
    await db.insert(inventoryFifoLayers).values([
      {
        tenantId: TENANT,
        itemId: fifoItemId,
        warehouseId,
        receivedAt: new Date(now - 10 * DAY),
        originalQty: '50.000',
        remainingQty: '50.000',
        unitCost: '10.00',
        sourceLedgerId: 999903,
      },
      {
        tenantId: TENANT,
        itemId: fifoItemId,
        warehouseId,
        receivedAt: new Date(now - 2 * DAY),
        originalQty: '50.000',
        remainingQty: '50.000',
        unitCost: '12.00',
        sourceLedgerId: 999904,
      },
    ]);
  });

  afterAll(async () => {
    const itemIds = [fefoItemDeductId, fefoItemAdjustId, fifoItemId];
    await db.delete(inventoryLedger).where(eq(inventoryLedger.tenantId, TENANT));
    await db.delete(projectionStockLevel).where(eq(projectionStockLevel.tenantId, TENANT));
    await db.delete(inventoryFifoLayers).where(inArray(inventoryFifoLayers.itemId, itemIds));
    await db.delete(items).where(eq(items.tenantId, TENANT));
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

  it('deductStock (StockTransferService dispatch path): fefoEnabled item consumes the soonest-to-expire layer first, not the earliest-received one', async () => {
    await ledgerService.deductStock({
      tenantId: TENANT,
      itemId: fefoItemDeductId,
      warehouseId,
      quantity: 20,
      createdBy: 1,
    });

    expect(await layerRemaining(fefoItemDeductId, 'BATCH-B-deduct')).toBe(30); // earlier expiry, drawn down
    expect(await layerRemaining(fefoItemDeductId, 'BATCH-A-deduct')).toBe(50); // later expiry, untouched
  });

  it('adjustStock direction OUT (StockAdjustmentService / PhysicalVerificationService shared path): same FEFO ordering', async () => {
    await ledgerService.adjustStock({
      tenantId: TENANT,
      itemId: fefoItemAdjustId,
      warehouseId,
      quantity: 15,
      direction: 'OUT',
      createdBy: 1,
    });

    expect(await layerRemaining(fefoItemAdjustId, 'BATCH-B-adjust')).toBe(35); // earlier expiry, drawn down
    expect(await layerRemaining(fefoItemAdjustId, 'BATCH-A-adjust')).toBe(50); // later expiry, untouched
  });

  it('regression: fefoEnabled: false item still consumes strictly in receipt order (FIFO), unaffected by this phase', async () => {
    const [layerA] = await db
      .select({ id: inventoryFifoLayers.id })
      .from(inventoryFifoLayers)
      .where(
        and(eq(inventoryFifoLayers.itemId, fifoItemId), eq(inventoryFifoLayers.unitCost, '10.00'))
      );
    const [layerB] = await db
      .select({ id: inventoryFifoLayers.id })
      .from(inventoryFifoLayers)
      .where(
        and(eq(inventoryFifoLayers.itemId, fifoItemId), eq(inventoryFifoLayers.unitCost, '12.00'))
      );

    await ledgerService.deductStock({
      tenantId: TENANT,
      itemId: fifoItemId,
      warehouseId,
      quantity: 20,
      createdBy: 1,
    });

    const [remA] = await db
      .select({ remainingQty: inventoryFifoLayers.remainingQty })
      .from(inventoryFifoLayers)
      .where(eq(inventoryFifoLayers.id, layerA!.id));
    const [remB] = await db
      .select({ remainingQty: inventoryFifoLayers.remainingQty })
      .from(inventoryFifoLayers)
      .where(eq(inventoryFifoLayers.id, layerB!.id));

    expect(parseFloat(remA!.remainingQty)).toBe(30); // earliest-received, drawn down first (FIFO)
    expect(parseFloat(remB!.remainingQty)).toBe(50); // later-received, untouched
  });
});
