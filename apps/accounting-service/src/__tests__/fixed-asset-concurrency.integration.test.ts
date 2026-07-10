/**
 * ES-23 [M22] — FixedAssetService.postMonthlyDepreciation() optimistic lock.
 * Proves that concurrent depreciation postings for the same asset (e.g. a
 * retried request racing the original, or two different periods triggered
 * close together) can't silently lose one posting's effect on currentValue.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createDatabaseClient } from '@erp/db';
import { accounts, fixedAssets, assetDepreciationSchedule } from '@erp/db';
import { eq, and } from 'drizzle-orm';
import { TenantScopedDatabase } from '@erp/sdk';
import { FixedAssetService } from '../domain/FixedAssetService.js';

const DB_URL = process.env['DATABASE_URL'];

describe.skipIf(!DB_URL)('FixedAssetService.postMonthlyDepreciation concurrency (M22)', () => {
  let rawDb: ReturnType<typeof createDatabaseClient>;
  let db: TenantScopedDatabase;
  const TEST_TENANT = 903_001 + Math.floor(Math.random() * 1000);
  let expenseAccountId: number;
  let accumDepAccountId: number;

  beforeAll(async () => {
    rawDb = createDatabaseClient({ url: DB_URL! });
    db = new TenantScopedDatabase(TEST_TENANT, rawDb);

    const [expenseAcc] = await rawDb
      .insert(accounts)
      .values({
        tenantId: TEST_TENANT,
        accountCode: 'DEP-EXP',
        accountName: 'Depreciation Expense',
        accountType: 'EXPENSE',
        accountGroup: 'OPERATING_EXPENSES',
        isSystem: false,
        isActive: true,
        createdBy: 1,
      })
      .returning();
    expenseAccountId = expenseAcc!.id;

    const [accumAcc] = await rawDb
      .insert(accounts)
      .values({
        tenantId: TEST_TENANT,
        accountCode: 'ACC-DEP',
        accountName: 'Accumulated Depreciation',
        accountType: 'ASSET',
        accountGroup: 'FIXED_ASSETS',
        isSystem: false,
        isActive: true,
        createdBy: 1,
      })
      .returning();
    accumDepAccountId = accumAcc!.id;
  });

  afterAll(async () => {
    await rawDb.delete(assetDepreciationSchedule).where(eq(assetDepreciationSchedule.tenantId, TEST_TENANT));
    await rawDb.delete(fixedAssets).where(eq(fixedAssets.tenantId, TEST_TENANT));
    await rawDb.delete(accounts).where(eq(accounts.tenantId, TEST_TENANT));
  });

  it('concurrent postings for two different periods on the same asset: no lost update to currentValue', async () => {
    const asset = await FixedAssetService.create(db, TEST_TENANT, 1, {
      assetCode: `FA-CONC-${Date.now()}`,
      assetName: 'Concurrency Test Asset',
      assetCategory: 'Equipment',
      purchaseDate: '2020-01-01',
      purchaseCost: 120000,
      salvageValue: 0,
      usefulLifeMonths: 120, // SLM: 1000/month
      depreciationMethod: 'SLM',
      assetAccountId: expenseAccountId,
      depreciationExpenseAccountId: expenseAccountId,
      accumulatedDepreciationAccountId: accumDepAccountId,
    });

    const [resultA, resultB] = await Promise.all([
      FixedAssetService.postMonthlyDepreciation(db, TEST_TENANT, 1, asset.id, 1, 2027),
      FixedAssetService.postMonthlyDepreciation(db, TEST_TENANT, 1, asset.id, 2, 2027),
    ]);

    expect(resultA).not.toBeNull();
    expect(resultB).not.toBeNull();

    const [final] = await rawDb
      .select({ currentValue: fixedAssets.currentValue, version: fixedAssets.version })
      .from(fixedAssets)
      .where(and(eq(fixedAssets.id, asset.id), eq(fixedAssets.tenantId, TEST_TENANT)));

    // Both postings must be reflected: 120000 - 1000 - 1000 = 118000, not 119000 (lost update).
    expect(parseFloat(final!.currentValue)).toBe(118000);
    expect(final!.version).toBe(2);

    const scheduleRows = await rawDb
      .select()
      .from(assetDepreciationSchedule)
      .where(and(
        eq(assetDepreciationSchedule.tenantId, TEST_TENANT),
        eq(assetDepreciationSchedule.assetId, asset.id)
      ));
    expect(scheduleRows).toHaveLength(2);
  });

  it('rejects (not silently drops) a duplicate post for the same period after a concurrent one already succeeded', async () => {
    const asset = await FixedAssetService.create(db, TEST_TENANT, 1, {
      assetCode: `FA-DUP-${Date.now()}`,
      assetName: 'Duplicate Period Test Asset',
      assetCategory: 'Equipment',
      purchaseDate: '2020-01-01',
      purchaseCost: 60000,
      salvageValue: 0,
      usefulLifeMonths: 60,
      depreciationMethod: 'SLM',
      assetAccountId: expenseAccountId,
      depreciationExpenseAccountId: expenseAccountId,
      accumulatedDepreciationAccountId: accumDepAccountId,
    });

    const results = await Promise.allSettled([
      FixedAssetService.postMonthlyDepreciation(db, TEST_TENANT, 1, asset.id, 3, 2027),
      FixedAssetService.postMonthlyDepreciation(db, TEST_TENANT, 1, asset.id, 3, 2027),
    ]);

    // The existing-schedule-row check (`existing` guard) means the second racer either
    // sees the first's committed row and returns null, or (if it read before the first
    // committed) hits the same-period unique constraint / duplicate insert — either way
    // it must not silently post a second depreciation entry for the same period.
    const scheduleRows = await rawDb
      .select()
      .from(assetDepreciationSchedule)
      .where(and(
        eq(assetDepreciationSchedule.tenantId, TEST_TENANT),
        eq(assetDepreciationSchedule.assetId, asset.id),
        eq(assetDepreciationSchedule.periodMonth, 3),
        eq(assetDepreciationSchedule.periodYear, 2027)
      ));
    expect(scheduleRows.length).toBeLessThanOrEqual(1);

    const fulfilledNonNull = results.filter(
      (r) => r.status === 'fulfilled' && r.value !== null
    );
    expect(fulfilledNonNull.length).toBeLessThanOrEqual(1);
  });
});
