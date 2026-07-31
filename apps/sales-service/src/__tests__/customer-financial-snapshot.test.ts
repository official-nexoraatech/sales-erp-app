// CRM-ROADMAP Phase 1, Feature 5 (ERP-Native Integration Layer) — CustomerFinancialSnapshotService
// coverage: multi-warehouse stock aggregation (never just the first warehouse row found),
// real-time reflection (a stock adjustment is visible on the next call, no caching), the
// over-limit flag, and the no-limit-configured edge case (never a divide-by-zero/nonsensical
// percentage).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createDatabaseClient } from '@erp/db';
import {
  branches,
  customers,
  invoices,
  invoiceLines,
  items,
  projectionCustomerBalance,
  projectionStockLevel,
} from '@erp/db';
import { eq } from 'drizzle-orm';
import { CustomerFinancialSnapshotService } from '../domain/CustomerFinancialSnapshotService.js';

const DB_URL = process.env['DATABASE_URL'];

describe.skipIf(!DB_URL)('CustomerFinancialSnapshotService — integration', () => {
  let db: ReturnType<typeof createDatabaseClient>;
  const TEST_TENANT = 900_701 + Math.floor(Math.random() * 1000);
  let branchId: number;
  let warehouseId2: number;
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
    warehouseId2 = branchId + 500000; // synthetic second "warehouse" id — no real FK enforced

    const [customer] = await db
      .insert(customers)
      .values({
        tenantId: TEST_TENANT,
        branchId,
        displayName: 'Snapshot Test Customer',
        phone: '9400001111',
        customerType: 'RETAIL',
        creditLimit: '5000',
        creditLimitEnabled: true,
        openingBalance: '0',
        createdBy: 1,
      })
      .returning();
    customerId = customer!.id;
  });

  afterAll(async () => {
    await db.delete(invoiceLines).where(eq(invoiceLines.tenantId, TEST_TENANT));
    await db.delete(invoices).where(eq(invoices.tenantId, TEST_TENANT));
    await db.delete(projectionStockLevel).where(eq(projectionStockLevel.tenantId, TEST_TENANT));
    await db
      .delete(projectionCustomerBalance)
      .where(eq(projectionCustomerBalance.tenantId, TEST_TENANT));
    await db.delete(items).where(eq(items.tenantId, TEST_TENANT));
    await db.delete(customers).where(eq(customers.tenantId, TEST_TENANT));
    await db.delete(branches).where(eq(branches.tenantId, TEST_TENANT));
  });

  describe('getFinancial', () => {
    it('flags isOverLimit when currentBalance exceeds the configured limit', async () => {
      await db.insert(projectionCustomerBalance).values({
        tenantId: TEST_TENANT,
        customerId,
        currentBalance: '7500',
        totalInvoiced: '7500',
        totalPaid: '0',
        overdueAmount: '0',
      });

      const snapshot = await CustomerFinancialSnapshotService.getFinancial(
        db,
        TEST_TENANT,
        customerId,
        {
          creditLimit: '5000',
          creditLimitEnabled: true,
        }
      );

      expect(snapshot.isOverLimit).toBe(true);
      expect(snapshot.creditHeadroom).toBe(0);
      expect(snapshot.currentBalance).toBe(7500);
    });

    it('never divides by zero or shows a nonsensical headroom when no limit is configured', async () => {
      const snapshot = await CustomerFinancialSnapshotService.getFinancial(
        db,
        TEST_TENANT,
        customerId,
        {
          creditLimit: '0',
          creditLimitEnabled: false,
        }
      );

      expect(snapshot.creditHeadroom).toBeNull();
      expect(snapshot.isOverLimit).toBe(false);
    });

    it('reflects a payment recorded against the balance projection immediately (no caching)', async () => {
      await db
        .update(projectionCustomerBalance)
        .set({ currentBalance: '1000', totalPaid: '6500' })
        .where(eq(projectionCustomerBalance.customerId, customerId));

      const snapshot = await CustomerFinancialSnapshotService.getFinancial(
        db,
        TEST_TENANT,
        customerId,
        {
          creditLimit: '5000',
          creditLimitEnabled: true,
        }
      );

      expect(snapshot.currentBalance).toBe(1000);
      expect(snapshot.isOverLimit).toBe(false);
      expect(snapshot.creditHeadroom).toBe(4000);
    });
  });

  describe('getRecentItemsStock', () => {
    it('aggregates available quantity across every warehouse, not just the first one found', async () => {
      const [item] = await db
        .insert(items)
        .values({
          tenantId: TEST_TENANT,
          name: 'Multi-Warehouse Test Item',
          itemCode: 'MWI-001',
          unitId: 1,
          hsnCode: '6109',
          createdBy: 1,
        })
        .returning();

      const [invoice] = await db
        .insert(invoices)
        .values({
          tenantId: TEST_TENANT,
          branchId,
          warehouseId: branchId,
          customerId,
          invoiceNumber: `SNAP-TEST-${Date.now()}`,
          placeOfSupply: '27',
          invoiceDate: new Date(),
          dueDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
          status: 'CONFIRMED',
          subtotal: '500',
          taxableAmount: '500',
          grandTotal: '500',
          paidAmount: '0',
          createdBy: 1,
        } as unknown as typeof invoices.$inferInsert)
        .returning();

      await db.insert(invoiceLines).values({
        invoiceId: invoice!.id,
        tenantId: TEST_TENANT,
        lineNumber: 1,
        itemId: item!.id,
        quantity: '2',
        unitPrice: '250',
        taxableAmount: '500',
        lineTotal: '500',
      } as unknown as typeof invoiceLines.$inferInsert);

      // Stock for the same item split across two different warehouses.
      await db.insert(projectionStockLevel).values([
        { tenantId: TEST_TENANT, itemId: item!.id, warehouseId: branchId, availableQty: '7' },
        { tenantId: TEST_TENANT, itemId: item!.id, warehouseId: warehouseId2, availableQty: '5' },
      ]);

      const stock = await CustomerFinancialSnapshotService.getRecentItemsStock(
        db,
        TEST_TENANT,
        customerId
      );
      const entry = stock.find((s) => s.itemId === item!.id);

      expect(entry).toBeDefined();
      // Must be the SUM across both warehouses (12), never just one (7 or 5).
      expect(entry!.totalAvailableQty).toBe(12);
      expect(entry!.warehouseCount).toBe(2);
      expect(entry!.itemName).toBe('Multi-Warehouse Test Item');
    });

    it('reflects a stock adjustment on the next call, without a service restart', async () => {
      const [item] = await db
        .insert(items)
        .values({
          tenantId: TEST_TENANT,
          name: 'Restock Reflection Item',
          unitId: 1,
          hsnCode: '6109',
          createdBy: 1,
        })
        .returning();

      const [invoice] = await db
        .insert(invoices)
        .values({
          tenantId: TEST_TENANT,
          branchId,
          warehouseId: branchId,
          customerId,
          invoiceNumber: `SNAP-TEST-2-${Date.now()}`,
          placeOfSupply: '27',
          invoiceDate: new Date(),
          dueDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
          status: 'CONFIRMED',
          subtotal: '100',
          taxableAmount: '100',
          grandTotal: '100',
          paidAmount: '0',
          createdBy: 1,
        } as unknown as typeof invoices.$inferInsert)
        .returning();

      await db.insert(invoiceLines).values({
        invoiceId: invoice!.id,
        tenantId: TEST_TENANT,
        lineNumber: 1,
        itemId: item!.id,
        quantity: '1',
        unitPrice: '100',
        taxableAmount: '100',
        lineTotal: '100',
      } as unknown as typeof invoiceLines.$inferInsert);

      await db.insert(projectionStockLevel).values({
        tenantId: TEST_TENANT,
        itemId: item!.id,
        warehouseId: branchId,
        availableQty: '0',
      });

      const before = await CustomerFinancialSnapshotService.getRecentItemsStock(
        db,
        TEST_TENANT,
        customerId
      );
      expect(before.find((s) => s.itemId === item!.id)?.totalAvailableQty).toBe(0);

      await db
        .update(projectionStockLevel)
        .set({ availableQty: '25' })
        .where(eq(projectionStockLevel.itemId, item!.id));

      const after = await CustomerFinancialSnapshotService.getRecentItemsStock(
        db,
        TEST_TENANT,
        customerId
      );
      expect(after.find((s) => s.itemId === item!.id)?.totalAvailableQty).toBe(25);
    });
  });
});
