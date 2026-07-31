// CRM-ROADMAP Phase 4, Feature 3 — Festival Intelligence AI.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createDatabaseClient } from '@erp/db';
import { branches, invoices, businessSeasons, crmFestivalSuggestions } from '@erp/db';
import { eq } from 'drizzle-orm';
import { BusinessError, NotFoundError } from '@erp/types';
import { FestivalIntelligenceService } from '../domain/FestivalIntelligenceService.js';

const DB_URL = process.env['DATABASE_URL'];

describe.skipIf(!DB_URL)('FestivalIntelligenceService', () => {
  let db: ReturnType<typeof createDatabaseClient>;
  const TEST_TENANT = 906_601 + Math.floor(Math.random() * 1000);
  let branchId: number;

  beforeAll(async () => {
    db = createDatabaseClient({ url: DB_URL! });
    const [branch] = await db
      .insert(branches)
      .values({
        tenantId: TEST_TENANT,
        name: 'Festival Branch',
        code: 'FB',
        isHeadOffice: true,
        isActive: true,
        createdBy: 1,
      })
      .returning();
    branchId = branch!.id;
  });

  afterAll(async () => {
    await db.delete(crmFestivalSuggestions).where(eq(crmFestivalSuggestions.tenantId, TEST_TENANT));
    await db.delete(invoices).where(eq(invoices.tenantId, TEST_TENANT));
    await db.delete(businessSeasons).where(eq(businessSeasons.tenantId, TEST_TENANT));
    await db.delete(branches).where(eq(branches.tenantId, TEST_TENANT));
  });

  it('skips a seasonType entirely (writes no row) when no prior season of that type exists', async () => {
    const result = await FestivalIntelligenceService.computeAndCacheSuggestions(db, TEST_TENANT);
    expect(result.suggestionsWritten).toBe(0);
    const rows = await FestivalIntelligenceService.list(db, TEST_TENANT);
    expect(rows.length).toBe(0);
  });

  it('writes an INSUFFICIENT_DATA suggestion when a prior season exists but had too few orders', async () => {
    const start = new Date(Date.UTC(2025, 9, 1)); // 2025-10-01
    const end = new Date(Date.UTC(2025, 10, 15)); // 2025-11-15
    await db.insert(businessSeasons).values({
      tenantId: TEST_TENANT,
      name: 'Diwali 2025',
      seasonType: 'FESTIVAL_SEASON',
      startDate: start,
      endDate: end,
      stockMultiplier: '2',
      loyaltyMultiplier: '1.5',
      createdBy: 1,
    });
    // Only 2 orders during the season window — below MIN_PRIOR_SEASON_ORDERS (5).
    await db.insert(invoices).values([
      {
        tenantId: TEST_TENANT,
        branchId,
        warehouseId: 1,
        customerId: 1,
        placeOfSupply: '27',
        invoiceDate: new Date(Date.UTC(2025, 9, 10)),
        dueDate: end,
        grandTotal: '1000',
        createdBy: 1,
      } as unknown as typeof invoices.$inferInsert,
      {
        tenantId: TEST_TENANT,
        branchId,
        warehouseId: 1,
        customerId: 1,
        placeOfSupply: '27',
        invoiceDate: new Date(Date.UTC(2025, 9, 20)),
        dueDate: end,
        grandTotal: '1500',
        createdBy: 1,
      } as unknown as typeof invoices.$inferInsert,
    ]);

    const result = await FestivalIntelligenceService.computeAndCacheSuggestions(db, TEST_TENANT);
    expect(result.suggestionsWritten).toBe(1);

    const rows = await FestivalIntelligenceService.list(db, TEST_TENANT);
    const row = rows.find((r) => r.seasonType === 'FESTIVAL_SEASON')!;
    expect(row.status).toBe('INSUFFICIENT_DATA');
    expect(row.suggestedStockMultiplier).toBeNull();
    expect(row.suggestedYear).toBe(2026);
    expect(row.reason).toMatch(/Only 2 orders/);
  });

  it('computes a PENDING suggestion with a stock multiplier derived from season-vs-baseline revenue', async () => {
    const start = new Date(Date.UTC(2025, 0, 1)); // 2025-01-01
    const end = new Date(Date.UTC(2025, 0, 31)); // 2025-01-31 (30-day window)
    await db.insert(businessSeasons).values({
      tenantId: TEST_TENANT,
      name: 'Year End Sale 2025',
      seasonType: 'YEAR_END_SALE',
      startDate: start,
      endDate: end,
      stockMultiplier: '2',
      loyaltyMultiplier: '1.75',
      createdBy: 1,
    });

    // Baseline (Dec 2024, the 30 days before the season): 1 order/day-ish, low revenue.
    const baselineInvoices = Array.from({ length: 6 }, (_, i) => ({
      tenantId: TEST_TENANT,
      branchId,
      warehouseId: 1,
      customerId: 1,
      placeOfSupply: '27',
      invoiceDate: new Date(Date.UTC(2024, 11, 5 + i)),
      dueDate: end,
      grandTotal: '1000',
      createdBy: 1,
    })) as unknown as (typeof invoices.$inferInsert)[];
    // Season window: much higher revenue per order.
    const seasonInvoices = Array.from({ length: 10 }, (_, i) => ({
      tenantId: TEST_TENANT,
      branchId,
      warehouseId: 1,
      customerId: 1,
      placeOfSupply: '27',
      invoiceDate: new Date(Date.UTC(2025, 0, 2 + i)),
      dueDate: end,
      grandTotal: '3000',
      createdBy: 1,
    })) as unknown as (typeof invoices.$inferInsert)[];
    await db.insert(invoices).values([...baselineInvoices, ...seasonInvoices]);

    // Not asserting the exact suggestionsWritten count here — the FESTIVAL_SEASON
    // INSUFFICIENT_DATA suggestion from the previous test is also eligible for recompute (only
    // APPROVED/REJECTED suggestions are left alone), so this run legitimately writes 2 rows.
    await FestivalIntelligenceService.computeAndCacheSuggestions(db, TEST_TENANT);

    const rows = await FestivalIntelligenceService.list(db, TEST_TENANT);
    const row = rows.find((r) => r.seasonType === 'YEAR_END_SALE')!;
    expect(row.status).toBe('PENDING');
    expect(row.suggestedYear).toBe(2026);
    expect(parseFloat(row.suggestedStockMultiplier!)).toBeGreaterThan(1);
    // Loyalty multiplier is a straight carry-forward of last year's actual configured value.
    expect(parseFloat(row.suggestedLoyaltyMultiplier!)).toBe(1.75);
    expect(row.suggestedStartDate).not.toBeNull();
    expect(new Date(row.suggestedStartDate!).getUTCFullYear()).toBe(2026);
  });

  it('does not overwrite a suggestion a merchandiser already approved or rejected', async () => {
    const rows = await FestivalIntelligenceService.list(db, TEST_TENANT, { status: 'PENDING' });
    const pending = rows.find((r) => r.seasonType === 'YEAR_END_SALE')!;
    await FestivalIntelligenceService.reject(db, TEST_TENANT, 1, pending.id);

    // Re-run compute — must not flip the rejected suggestion back to PENDING.
    await FestivalIntelligenceService.computeAndCacheSuggestions(db, TEST_TENANT);
    const [after] = await db
      .select()
      .from(crmFestivalSuggestions)
      .where(eq(crmFestivalSuggestions.id, pending.id));
    expect(after!.status).toBe('REJECTED');
  });

  describe('approve', () => {
    it('creates a real businessSeasons row from a PENDING suggestion using suggested values by default', async () => {
      const start = new Date(Date.UTC(2025, 5, 1));
      const end = new Date(Date.UTC(2025, 5, 30));
      await db.insert(businessSeasons).values({
        tenantId: TEST_TENANT,
        name: 'Summer 2025',
        seasonType: 'SUMMER_COLLECTION',
        startDate: start,
        endDate: end,
        stockMultiplier: '1.5',
        loyaltyMultiplier: '1.2',
        createdBy: 1,
      });
      const seasonInvoices = Array.from({ length: 8 }, (_, i) => ({
        tenantId: TEST_TENANT,
        branchId,
        warehouseId: 1,
        customerId: 1,
        placeOfSupply: '27',
        invoiceDate: new Date(Date.UTC(2025, 5, 2 + i)),
        dueDate: end,
        grandTotal: '2000',
        createdBy: 1,
      })) as unknown as (typeof invoices.$inferInsert)[];
      await db.insert(invoices).values(seasonInvoices);

      await FestivalIntelligenceService.computeAndCacheSuggestions(db, TEST_TENANT);
      const rows = await FestivalIntelligenceService.list(db, TEST_TENANT, { status: 'PENDING' });
      const suggestion = rows.find((r) => r.seasonType === 'SUMMER_COLLECTION')!;

      const result = await FestivalIntelligenceService.approve(db, TEST_TENANT, 1, suggestion.id, {
        name: 'Summer 2026',
      });
      expect(result.suggestion.status).toBe('APPROVED');
      expect(result.seasonId).toBeGreaterThan(0);

      const [season] = await db
        .select()
        .from(businessSeasons)
        .where(eq(businessSeasons.id, result.seasonId));
      expect(season!.name).toBe('Summer 2026');
      expect(season!.seasonType).toBe('SUMMER_COLLECTION');
    });

    it('rejects approving a suggestion that is not PENDING', async () => {
      const rows = await FestivalIntelligenceService.list(db, TEST_TENANT, { status: 'APPROVED' });
      const approved = rows[0]!;
      await expect(
        FestivalIntelligenceService.approve(db, TEST_TENANT, 1, approved.id, {
          name: 'Should Fail',
        })
      ).rejects.toThrow(BusinessError);
    });

    it('throws NotFoundError for an unknown suggestion id', async () => {
      await expect(
        FestivalIntelligenceService.approve(db, TEST_TENANT, 1, 999999999, { name: 'Nope' })
      ).rejects.toThrow(NotFoundError);
    });
  });
});
