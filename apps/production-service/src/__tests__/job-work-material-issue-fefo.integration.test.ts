/**
 * Phase 2B closure review (41-phase-2b-closure-review.md, §5, F2 gap): JobWorkOrderService
 * .issueMaterials() calls the shared ValuationService.consumeForStockOut identically to
 * inventory-service's InventoryLedgerService.deductStock (already FEFO-proven by
 * fefo-consumption-flows.integration.test.ts) — but had zero dedicated test proving FEFO
 * ordering actually holds at this specific call site (the existing job-work-order-valuation
 * .integration.test.ts uses single-cost-pool WACC items with no FIFO layers at all, so it
 * structurally cannot exercise FEFO ordering). Follows the FEFO test's exact template: real
 * Postgres, two layers per raw-material item (one received-first/expires-later, one
 * received-second/expires-sooner), assert the sooner-expiring layer drains first, plus a
 * fefoEnabled:false regression case proving today's FIFO-by-receivedAt behavior is unchanged.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createDatabaseClient, type ErpDatabase } from '@erp/db';
import {
  items,
  warehouses,
  branches,
  suppliers,
  jobWorkOrders,
  jobWorkOrderMaterials,
  jobWorkOrderHistory,
  inventoryFifoLayers,
  inventoryLedger,
  projectionStockLevel,
  outboxEvents,
} from '@erp/db';
import { eq, and } from 'drizzle-orm';
import { JobWorkOrderService } from '../domain/JobWorkOrderService.js';

const DB_URL = process.env['DATABASE_URL'];

describe.skipIf(!DB_URL)(
  'JobWorkOrderService.issueMaterials — FEFO consumption, real Postgres',
  () => {
    let db: ErpDatabase;
    const TENANT = 900_401 + Math.floor(Math.random() * 1000);
    let branchId: number;
    let warehouseId: number;
    let supplierId: number;
    let outputItemId: number;
    let fefoMaterialId: number;
    let fifoMaterialId: number;

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
          displayName: 'Test Job Worker',
          phone: '9999999999',
          createdBy: 1,
        })
        .returning();
      supplierId = supplier!.id;

      const baseItem = {
        tenantId: TENANT,
        unitId: 1,
        hsnCode: '5208',
        gstRate: '5.00',
        salePrice: '0',
        purchasePrice: '50.00',
        costingMethod: 'FIFO' as const,
        availableQty: '100.000',
        createdBy: 1,
      };
      const [fefoMaterial] = await db
        .insert(items)
        .values({
          ...baseItem,
          name: 'FEFO Raw Material',
          itemCode: `JWF-${TENANT}`,
          fefoEnabled: true,
        })
        .returning();
      fefoMaterialId = fefoMaterial!.id;

      const [fifoMaterial] = await db
        .insert(items)
        .values({
          ...baseItem,
          name: 'FIFO Raw Material',
          itemCode: `JWR-${TENANT}`,
          fefoEnabled: false,
        })
        .returning();
      fifoMaterialId = fifoMaterial!.id;

      const [outItem] = await db
        .insert(items)
        .values({
          tenantId: TENANT,
          name: 'Finished Good',
          itemCode: `JWO-${TENANT}`,
          salePrice: '500.00',
          purchasePrice: '0',
          gstRate: '5.00',
          unitId: 1,
          hsnCode: '6103',
          availableQty: '0',
          createdBy: 1,
        })
        .returning();
      outputItemId = outItem!.id;

      const now = Date.now();
      const DAY = 24 * 60 * 60 * 1000;
      await db.insert(inventoryFifoLayers).values([
        {
          tenantId: TENANT,
          itemId: fefoMaterialId,
          warehouseId,
          receivedAt: new Date(now - 10 * DAY), // received first
          originalQty: '50.000',
          remainingQty: '50.000',
          unitCost: '10.00',
          sourceLedgerId: 999701,
          batchNumber: `BATCH-A-fefo`,
          expiryDate: new Date(now + 60 * DAY), // expires later
        },
        {
          tenantId: TENANT,
          itemId: fefoMaterialId,
          warehouseId,
          receivedAt: new Date(now - 2 * DAY), // received second (more recent)
          originalQty: '50.000',
          remainingQty: '50.000',
          unitCost: '12.00',
          sourceLedgerId: 999702,
          batchNumber: `BATCH-B-fefo`,
          expiryDate: new Date(now + 5 * DAY), // expires sooner — FEFO should pick this first
        },
        {
          tenantId: TENANT,
          itemId: fifoMaterialId,
          warehouseId,
          receivedAt: new Date(now - 10 * DAY),
          originalQty: '50.000',
          remainingQty: '50.000',
          unitCost: '10.00',
          sourceLedgerId: 999703,
          batchNumber: `BATCH-A-fifo`,
        },
        {
          tenantId: TENANT,
          itemId: fifoMaterialId,
          warehouseId,
          receivedAt: new Date(now - 2 * DAY),
          originalQty: '50.000',
          remainingQty: '50.000',
          unitCost: '12.00',
          sourceLedgerId: 999704,
          batchNumber: `BATCH-B-fifo`,
        },
      ]);
    });

    afterAll(async () => {
      await db.delete(inventoryLedger).where(eq(inventoryLedger.tenantId, TENANT));
      await db.delete(projectionStockLevel).where(eq(projectionStockLevel.tenantId, TENANT));
      await db.delete(outboxEvents).where(eq(outboxEvents.tenantId, TENANT));
      await db.delete(jobWorkOrderHistory).where(eq(jobWorkOrderHistory.tenantId, TENANT));
      await db.delete(jobWorkOrderMaterials).where(eq(jobWorkOrderMaterials.tenantId, TENANT));
      await db.delete(jobWorkOrders).where(eq(jobWorkOrders.tenantId, TENANT));
      await db.delete(inventoryFifoLayers).where(eq(inventoryFifoLayers.tenantId, TENANT));
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

    it('fefoEnabled material: issueMaterials() consumes the soonest-to-expire layer first, not the earliest-received one', async () => {
      const svc = new JobWorkOrderService(db);
      const orderId = await svc.create({
        tenantId: TENANT,
        orderNumber: `JWO-FEFO-${TENANT}`,
        supplierId,
        branchId,
        warehouseId,
        outputItemId,
        orderedQty: 10,
        jobWorkRate: 20,
        orderDate: new Date(),
        materials: [{ itemId: fefoMaterialId, requiredQty: 20, unitCost: 10, warehouseId }],
        createdBy: 1,
      });

      await svc.issueMaterials(orderId, TENANT, 1);

      expect(await layerRemaining(fefoMaterialId, 'BATCH-B-fefo')).toBe(30); // earlier expiry, drawn down
      expect(await layerRemaining(fefoMaterialId, 'BATCH-A-fefo')).toBe(50); // later expiry, untouched
    });

    it('regression: fefoEnabled: false material still consumes strictly in receipt order (FIFO), unaffected', async () => {
      const svc = new JobWorkOrderService(db);
      const orderId = await svc.create({
        tenantId: TENANT,
        orderNumber: `JWO-FIFO-${TENANT}`,
        supplierId,
        branchId,
        warehouseId,
        outputItemId,
        orderedQty: 10,
        jobWorkRate: 20,
        orderDate: new Date(),
        materials: [{ itemId: fifoMaterialId, requiredQty: 20, unitCost: 10, warehouseId }],
        createdBy: 1,
      });

      await svc.issueMaterials(orderId, TENANT, 1);

      expect(await layerRemaining(fifoMaterialId, 'BATCH-A-fifo')).toBe(30); // earliest-received, drawn down first
      expect(await layerRemaining(fifoMaterialId, 'BATCH-B-fifo')).toBe(50); // later-received, untouched
    });
  }
);
