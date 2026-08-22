/**
 * Phase 2A (D1): documents a known, NOT-fixed gap carried over from the pre-migration local
 * `ValuationService.ts` — `SaleReturnService.create()`'s restock call site
 * (`SaleReturnService.ts:233`) does not pass `batchNumber`/`expiryDate` to `applyStockIn`, so a
 * returned unit's batch/expiry identity is lost on restock regardless of which engine performs
 * the stock-in. The shared `@erp/sdk` engine *supports* carrying those fields through
 * (`27-affected-flow-matrix.md` #10) — threading them from the original sale's layer is out of
 * Phase 2A's scope (no production code change beyond the import migration). This test pins the
 * current behavior explicitly so a future session doesn't assume the gap is already closed.
 *
 * Requires a real Postgres via DATABASE_URL — proving what actually lands in
 * `inventory_fifo_layers` needs a real insert, not a mocked query builder.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createDatabaseClient } from '@erp/db';
import {
  items,
  inventoryFifoLayers,
  inventoryLedger,
  invoices,
  invoiceLines,
  customers,
  warehouses,
  branches,
  saleReturns,
  saleReturnLines,
  creditNotes,
} from '@erp/db';
import { eq } from 'drizzle-orm';
import { SaleReturnService } from '../domain/SaleReturnService.js';

const DB_URL = process.env['DATABASE_URL'];

describe.skipIf(!DB_URL)('SaleReturnService.create — batch/expiry traceability (Phase 2A)', () => {
  let db: ReturnType<typeof createDatabaseClient>;
  const TEST_TENANT = 906_001 + Math.floor(Math.random() * 1000);
  let branchId: number;
  let warehouseId: number;
  let customerId: number;
  let itemId: number;
  let invoiceId: number;
  let invoiceLineId: number;

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

    const [customer] = await db
      .insert(customers)
      .values({
        tenantId: TEST_TENANT,
        branchId,
        displayName: 'Return Traceability Test Customer',
        phone: '9876500099',
        creditLimit: '0',
        openingBalance: '0',
        createdBy: 1,
      })
      .returning();
    customerId = customer!.id;

    const [item] = await db
      .insert(items)
      .values({
        tenantId: TEST_TENANT,
        name: 'Sale Return Traceability Test Item',
        itemCode: `RET-TRACE-${Date.now()}`,
        salePrice: '100.00',
        purchasePrice: '5.00',
        gstRate: '0.00',
        unitId: 1,
        hsnCode: '0401',
        costingMethod: 'FIFO',
        availableQty: '10',
        createdBy: 1,
      })
      .returning();
    itemId = item!.id;

    // A CONFIRMED invoice with a matching STOCK_OUT ledger row (cogsPerUnit set) — the
    // precondition SaleReturnService.create() reads to compute the restock's reversalUnitCost.
    const [invoice] = await db
      .insert(invoices)
      .values({
        tenantId: TEST_TENANT,
        branchId,
        warehouseId,
        customerId,
        status: 'CONFIRMED',
        placeOfSupply: '27',
        invoiceDate: new Date(),
        dueDate: new Date(),
        grandTotal: '500.00',
        createdBy: 1,
      })
      .returning();
    invoiceId = invoice!.id;

    const [line] = await db
      .insert(invoiceLines)
      .values({
        invoiceId,
        tenantId: TEST_TENANT,
        lineNumber: 1,
        itemId,
        quantity: '5.000',
        unitPrice: '100.00',
        lineTotal: '500.00',
      })
      .returning();
    invoiceLineId = line!.id;

    await db.insert(inventoryLedger).values({
      tenantId: TEST_TENANT,
      itemId,
      warehouseId,
      movementType: 'STOCK_OUT',
      quantity: '5.000',
      quantityBefore: '10.000',
      quantityAfter: '5.000',
      referenceType: 'INVOICE',
      referenceId: invoiceId,
      referenceLineId: invoiceLineId,
      unitCost: '0',
      cogsPerUnit: '15.00',
      createdBy: 1,
    });
  });

  afterAll(async () => {
    await db.delete(saleReturnLines).where(eq(saleReturnLines.tenantId, TEST_TENANT));
    await db.delete(creditNotes).where(eq(creditNotes.tenantId, TEST_TENANT));
    await db.delete(saleReturns).where(eq(saleReturns.tenantId, TEST_TENANT));
    await db.delete(invoiceLines).where(eq(invoiceLines.tenantId, TEST_TENANT));
    await db.delete(invoices).where(eq(invoices.tenantId, TEST_TENANT));
    await db.delete(inventoryLedger).where(eq(inventoryLedger.tenantId, TEST_TENANT));
    await db.delete(inventoryFifoLayers).where(eq(inventoryFifoLayers.tenantId, TEST_TENANT));
    await db.delete(items).where(eq(items.tenantId, TEST_TENANT));
    await db.delete(customers).where(eq(customers.tenantId, TEST_TENANT));
    await db.delete(warehouses).where(eq(warehouses.tenantId, TEST_TENANT));
    await db.delete(branches).where(eq(branches.tenantId, TEST_TENANT));
  });

  it('restocks via the shared engine but does not carry batch/expiry onto the new FIFO layer (known, not fixed in Phase 2A)', async () => {
    const svc = new SaleReturnService(db as never);
    const { returnId } = await svc.create({
      tenantId: TEST_TENANT,
      branchId,
      returnNumber: 'RET-TRACE-001',
      invoiceId,
      customerId,
      returnDate: new Date(),
      reason: 'DEFECTIVE',
      isPhysicalReturn: true,
      warehouseId,
      lines: [{ invoiceLineId, itemId, returnQty: 3 }],
      creditNoteNumber: 'CN-TRACE-001',
      createdBy: 1,
    });
    expect(returnId).toBeGreaterThan(0);

    const [restockedLayer] = await db
      .select()
      .from(inventoryFifoLayers)
      .where(eq(inventoryFifoLayers.itemId, itemId));

    expect(restockedLayer).toBeDefined();
    expect(parseFloat(restockedLayer!.remainingQty)).toBe(3);
    expect(parseFloat(restockedLayer!.unitCost)).toBe(15); // reversalUnitCost from the original sale
    // The gap this test pins down: no batch/expiry identity survives the return.
    expect(restockedLayer!.batchNumber).toBeNull();
    expect(restockedLayer!.expiryDate).toBeNull();
  });
});
