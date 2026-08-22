/**
 * Phase 2A (D1): sales-service migrated off its local, stale `ValuationService.ts` duplicate
 * onto the shared `@erp/sdk` engine (`packages/platform-sdk/src/valuation-engine.ts`), which
 * already proves FEFO consumption ordering at the engine level
 * (`valuation-engine-fefo.test.ts`). This suite proves the same ordering through the real
 * `InvoiceService.confirm()` call path (sales-service's actual consumption entry point,
 * shared by POS checkout via `pos.routes.ts`) — not just the underlying engine in isolation.
 *
 * `fefoEnabled` cannot be set `true` on any tenant's item before Phase 2B ships the write
 * path, so this scenario is not reachable in production yet; this suite exists to prove the
 * migrated engine is correctly wired end-to-end ahead of that phase, mirroring the same
 * two-layer scenario `valuation-engine-fefo.test.ts` already proves at the engine level.
 *
 * Requires a real Postgres via DATABASE_URL — mocked-db unit tests cannot prove actual
 * ORDER BY execution (drizzle-orm and @erp/db are unmocked here), so this intentionally
 * follows the same live-DB pattern as `valuation-engine-fefo.test.ts` rather than a fragile
 * hand-scripted mock.
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
} from '@erp/db';
import { eq } from 'drizzle-orm';
import { InvoiceService } from '../domain/InvoiceService.js';

const DB_URL = process.env['DATABASE_URL'];

describe.skipIf(!DB_URL)('InvoiceService.confirm — FEFO consumption ordering (Phase 2A)', () => {
  let db: ReturnType<typeof createDatabaseClient>;
  const TEST_TENANT = 905_001 + Math.floor(Math.random() * 1000);
  let branchId: number;
  let warehouseId: number;
  let customerId: number;

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
        displayName: 'FEFO Test Customer',
        phone: '9876543210',
        creditLimit: '0',
        openingBalance: '0',
        createdBy: 1,
      })
      .returning();
    customerId = customer!.id;
  });

  afterAll(async () => {
    await db.delete(invoiceLines).where(eq(invoiceLines.tenantId, TEST_TENANT));
    await db.delete(invoices).where(eq(invoices.tenantId, TEST_TENANT));
    await db.delete(inventoryLedger).where(eq(inventoryLedger.tenantId, TEST_TENANT));
    await db.delete(inventoryFifoLayers).where(eq(inventoryFifoLayers.tenantId, TEST_TENANT));
    await db.delete(items).where(eq(items.tenantId, TEST_TENANT));
    await db.delete(customers).where(eq(customers.tenantId, TEST_TENANT));
    await db.delete(warehouses).where(eq(warehouses.tenantId, TEST_TENANT));
    await db.delete(branches).where(eq(branches.tenantId, TEST_TENANT));
  });

  async function seedItemWithTwoLayers(fefoEnabled: boolean): Promise<number> {
    const [item] = await db
      .insert(items)
      .values({
        tenantId: TEST_TENANT,
        name: `${fefoEnabled ? 'FEFO' : 'FIFO'} Invoice Test Item`,
        itemCode: `${fefoEnabled ? 'FEFO' : 'FIFO'}-INV-${Date.now()}-${Math.random()}`,
        salePrice: '100.00',
        purchasePrice: '5.00',
        gstRate: '0.00',
        unitId: 1,
        hsnCode: '0401',
        costingMethod: 'FIFO',
        fefoEnabled,
        availableQty: '20',
        createdBy: 1,
      })
      .returning();
    const itemId = item!.id;

    // Layer A: received first, expires LATER, cheaper (cost 10/unit).
    // Layer B: received second, expires SOONER, pricier (cost 20/unit).
    await db.insert(inventoryFifoLayers).values([
      {
        tenantId: TEST_TENANT,
        itemId,
        warehouseId,
        receivedAt: new Date('2026-01-01T00:00:00Z'),
        originalQty: '10',
        remainingQty: '10',
        unitCost: '10.00',
        sourceLedgerId: 0,
        batchNumber: 'BATCH-A',
        expiryDate: new Date('2026-12-31T00:00:00Z'),
      },
      {
        tenantId: TEST_TENANT,
        itemId,
        warehouseId,
        receivedAt: new Date('2026-02-01T00:00:00Z'),
        originalQty: '10',
        remainingQty: '10',
        unitCost: '20.00',
        sourceLedgerId: 0,
        batchNumber: 'BATCH-B',
        expiryDate: new Date('2026-03-01T00:00:00Z'),
      },
    ]);

    return itemId;
  }

  async function createDraftInvoice(itemId: number, quantity: number): Promise<number> {
    const [invoice] = await db
      .insert(invoices)
      .values({
        tenantId: TEST_TENANT,
        branchId,
        warehouseId,
        customerId,
        placeOfSupply: '27',
        invoiceDate: new Date(),
        dueDate: new Date(),
        grandTotal: String(quantity * 100),
        createdBy: 1,
      })
      .returning();
    const invoiceId = invoice!.id;

    await db.insert(invoiceLines).values({
      invoiceId,
      tenantId: TEST_TENANT,
      lineNumber: 1,
      itemId,
      quantity: String(quantity),
      unitPrice: '100.00',
      lineTotal: String(quantity * 100),
    });

    return invoiceId;
  }

  it('fefoEnabled=true consumes the soonest-expiring layer first through InvoiceService.confirm()', async () => {
    const itemId = await seedItemWithTwoLayers(true);
    const invoiceId = await createDraftInvoice(itemId, 5);

    const svc = new InvoiceService(db as never);
    await svc.confirm(invoiceId, TEST_TENANT, 1);

    const layers = await db
      .select()
      .from(inventoryFifoLayers)
      .where(eq(inventoryFifoLayers.itemId, itemId));
    const batchA = layers.find((l) => l.batchNumber === 'BATCH-A');
    const batchB = layers.find((l) => l.batchNumber === 'BATCH-B');
    // Batch B (soonest-expiring, received second) should be consumed, not Batch A.
    expect(parseFloat(batchA!.remainingQty)).toBe(10); // untouched
    expect(parseFloat(batchB!.remainingQty)).toBe(5); // 10 - 5 consumed

    const [ledgerRow] = await db
      .select({ cogsPerUnit: inventoryLedger.cogsPerUnit })
      .from(inventoryLedger)
      .where(eq(inventoryLedger.referenceId, invoiceId));
    expect(parseFloat(String(ledgerRow!.cogsPerUnit))).toBe(20); // Batch B's cost, not Batch A's
  });

  it('fefoEnabled=false still consumes strictly in receipt order through InvoiceService.confirm()', async () => {
    const itemId = await seedItemWithTwoLayers(false);
    const invoiceId = await createDraftInvoice(itemId, 5);

    const svc = new InvoiceService(db as never);
    await svc.confirm(invoiceId, TEST_TENANT, 1);

    const layers = await db
      .select()
      .from(inventoryFifoLayers)
      .where(eq(inventoryFifoLayers.itemId, itemId));
    const batchA = layers.find((l) => l.batchNumber === 'BATCH-A');
    const batchB = layers.find((l) => l.batchNumber === 'BATCH-B');
    // Batch A (received first) should be consumed, even though Batch B expires sooner.
    expect(parseFloat(batchA!.remainingQty)).toBe(5); // 10 - 5 consumed
    expect(parseFloat(batchB!.remainingQty)).toBe(10); // untouched

    const [ledgerRow] = await db
      .select({ cogsPerUnit: inventoryLedger.cogsPerUnit })
      .from(inventoryLedger)
      .where(eq(inventoryLedger.referenceId, invoiceId));
    expect(parseFloat(String(ledgerRow!.cogsPerUnit))).toBe(10); // Batch A's cost, not Batch B's
  });
});
