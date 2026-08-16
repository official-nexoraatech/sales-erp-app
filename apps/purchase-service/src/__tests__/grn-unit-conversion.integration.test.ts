/**
 * Multi-vertical platform audit 2026-08-16, Phase 1: items had exactly one unit — no way to
 * represent "buy a case of 24, stock/sell by the piece," a structural gap Grocery cannot launch
 * without. This proves the fix end-to-end against a real database: a GRN line received in an
 * item's configured purchase unit (a case of 24) converts to base-unit (piece) stock on approval,
 * while the PO-vs-GRN received-qty ceiling check keeps comparing in the ordering unit.
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
  inventoryLedger,
  projectionSupplierBalance,
  projectionStockLevel,
} from '@erp/db';
import { eq, and } from 'drizzle-orm';
import { GRNService } from '../domain/GRNService.js';

const DB_URL = process.env['DATABASE_URL'];
const BASE_UNIT_ID = 1; // "Piece" — the item's stock/sale unit
const CASE_UNIT_ID = 9001; // synthetic; no FK enforced on items.purchaseUnitId/grnLines.unitId

describe.skipIf(!DB_URL)('GRNService.approve — purchase-unit to base-unit conversion', () => {
  let db: ReturnType<typeof createDatabaseClient>;
  const TEST_TENANT = 906_001 + Math.floor(Math.random() * 1000);
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
        displayName: 'Test Case-Goods Supplier',
        phone: '9999999999',
        createdBy: 1,
      })
      .returning();
    supplierId = supplier!.id;

    // Sold/stocked by the piece, but purchased by the case of 24.
    const [item] = await db
      .insert(items)
      .values({
        tenantId: TEST_TENANT,
        name: 'Canned Goods (case of 24)',
        itemCode: `CASE24-${Date.now()}`,
        salePrice: '20.00',
        purchasePrice: '15.00',
        gstRate: '5.00',
        unitId: BASE_UNIT_ID,
        hsnCode: '2005',
        costingMethod: 'FIFO',
        availableQty: '0',
        purchaseUnitId: CASE_UNIT_ID,
        purchaseUnitConversionFactor: '24',
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

    // Ordered 3 cases (in the case unit) — orderedQty stays in the ordering unit.
    const [poLine] = await db
      .insert(purchaseOrderLines)
      .values({
        purchaseOrderId: poId,
        tenantId: TEST_TENANT,
        lineNumber: 1,
        itemId,
        unitId: CASE_UNIT_ID,
        orderedQty: '3',
        unitPrice: '300.00',
        lineTotal: '900.00',
      })
      .returning();
    poLineId = poLine!.id;
  });

  afterAll(async () => {
    await db.delete(inventoryLedger).where(eq(inventoryLedger.tenantId, TEST_TENANT));
    await db.delete(projectionStockLevel).where(eq(projectionStockLevel.tenantId, TEST_TENANT));
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

  it('receiving 2 cases (unit = purchase unit) stocks 48 pieces (unit = base unit), not 2', async () => {
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
        grandTotal: '600.00',
        createdBy: 1,
      })
      .returning();
    const grnId = grn!.id;

    // Received 2 cases — receivedQty is in the case unit, matching the PO line's unit.
    await db.insert(grnLines).values({
      grnId,
      tenantId: TEST_TENANT,
      lineNumber: 1,
      itemId,
      purchaseOrderLineId: poLineId,
      unitId: CASE_UNIT_ID,
      orderedQty: '3',
      receivedQty: '2',
      grnRate: '300.00',
      lineTotal: '600.00',
      qcStatus: 'PASSED',
    });

    const svc = new GRNService(db);
    await svc.approve(grnId, TEST_TENANT, 1, `GRN-${Date.now()}`);

    // Stock is in the item's base unit (pieces): 2 cases * 24 = 48 pieces, not 2.
    const [updatedItem] = await db.select().from(items).where(eq(items.id, itemId));
    expect(parseFloat(updatedItem!.availableQty)).toBe(48);

    const [ledgerRow] = await db
      .select()
      .from(inventoryLedger)
      .where(
        and(
          eq(inventoryLedger.tenantId, TEST_TENANT),
          eq(inventoryLedger.referenceType, 'GRN'),
          eq(inventoryLedger.referenceId, grnId)
        )
      );
    expect(parseFloat(ledgerRow!.quantity)).toBe(48);

    const [grnLineRow] = await db
      .select()
      .from(grnLines)
      .where(and(eq(grnLines.tenantId, TEST_TENANT), eq(grnLines.grnId, grnId)));
    expect(parseFloat(String(grnLineRow!.receivedQtyBaseUnit))).toBe(48);
    // receivedQty itself is untouched — still 2 cases, so the PO-vs-GRN ceiling check
    // (which compares against purchaseOrderLines.orderedQty, also in cases) stays correct.
    expect(parseFloat(grnLineRow!.receivedQty)).toBe(2);

    // The PO line's own receivedQty accumulator is also in the ordering unit (cases), not
    // the converted base-unit quantity — confirms the ceiling guard wasn't broken by this.
    const [poLineRow] = await db
      .select()
      .from(purchaseOrderLines)
      .where(eq(purchaseOrderLines.id, poLineId));
    expect(parseFloat(poLineRow!.receivedQty)).toBe(2);
  });
});
