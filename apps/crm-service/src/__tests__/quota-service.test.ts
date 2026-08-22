// CRM-ROADMAP Phase 4, Feature 5 — Sales Forecasting & Quota Management.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createDatabaseClient } from '@erp/db';
import {
  branches,
  users,
  crmOpportunities,
  crmTerritories,
  crmTerritoryBranches,
  crmSalesQuotas,
  invoices,
  quotations,
} from '@erp/db';
import { eq } from 'drizzle-orm';
import { BusinessError, NotFoundError, OptimisticLockError } from '@erp/types';
import { QuotaService } from '../domain/QuotaService.js';

const DB_URL = process.env['DATABASE_URL'];

describe.skipIf(!DB_URL)('QuotaService', () => {
  let db: ReturnType<typeof createDatabaseClient>;
  const TEST_TENANT = 905_501 + Math.floor(Math.random() * 1000);
  let branchA: number;
  let repX: number;
  let repY: number;
  let territoryId: number;

  beforeAll(async () => {
    db = createDatabaseClient({ url: DB_URL! });

    const [branch] = await db
      .insert(branches)
      .values({
        tenantId: TEST_TENANT,
        name: 'Quota Branch A',
        code: 'QA',
        isHeadOffice: true,
        isActive: true,
        createdBy: 1,
      })
      .returning();
    branchA = branch!.id;

    const userRows = await db
      .insert(users)
      .values([
        {
          tenantId: TEST_TENANT,
          email: `quotarepx-${TEST_TENANT}@test.local`,
          passwordHash: 'x',
          firstName: 'Quota',
          lastName: 'RepX',
        },
        {
          tenantId: TEST_TENANT,
          email: `quotarepy-${TEST_TENANT}@test.local`,
          passwordHash: 'x',
          firstName: 'Quota',
          lastName: 'RepY',
        },
      ])
      .returning();
    [repX, repY] = userRows.map((u) => u.id) as [number, number];

    const [territory] = await db
      .insert(crmTerritories)
      .values({ tenantId: TEST_TENANT, name: 'Quota Test Territory', createdBy: 1 })
      .returning();
    territoryId = territory!.id;
    await db
      .insert(crmTerritoryBranches)
      .values({ tenantId: TEST_TENANT, territoryId, branchId: branchA });
  });

  afterAll(async () => {
    await db.delete(crmSalesQuotas).where(eq(crmSalesQuotas.tenantId, TEST_TENANT));
    await db.delete(crmTerritoryBranches).where(eq(crmTerritoryBranches.tenantId, TEST_TENANT));
    await db.delete(crmTerritories).where(eq(crmTerritories.tenantId, TEST_TENANT));
    await db.delete(crmOpportunities).where(eq(crmOpportunities.tenantId, TEST_TENANT));
    await db.delete(invoices).where(eq(invoices.tenantId, TEST_TENANT));
    await db.delete(quotations).where(eq(quotations.tenantId, TEST_TENANT));
    await db.delete(users).where(eq(users.tenantId, TEST_TENANT));
    await db.delete(branches).where(eq(branches.tenantId, TEST_TENANT));
  });

  it('creates a REP quota', async () => {
    const q = await QuotaService.create(db, TEST_TENANT, 1, {
      subjectType: 'REP',
      subjectUserId: repX,
      periodYear: 2026,
      periodMonth: 1,
      quotaAmount: 100000,
    });
    expect(q.subjectType).toBe('REP');
    expect(q.subjectUserId).toBe(repX);
    expect(parseFloat(q.quotaAmount)).toBe(100000);
  });

  it('rejects a REP quota for a userId outside the tenant', async () => {
    await expect(
      QuotaService.create(db, TEST_TENANT, 1, {
        subjectType: 'REP',
        subjectUserId: 999999999,
        periodYear: 2026,
        periodMonth: 2,
        quotaAmount: 1000,
      })
    ).rejects.toThrow(NotFoundError);
  });

  it('rejects a duplicate quota for the same subject and period', async () => {
    await QuotaService.create(db, TEST_TENANT, 1, {
      subjectType: 'REP',
      subjectUserId: repY,
      periodYear: 2026,
      periodMonth: 3,
      quotaAmount: 5000,
    });
    await expect(
      QuotaService.create(db, TEST_TENANT, 1, {
        subjectType: 'REP',
        subjectUserId: repY,
        periodYear: 2026,
        periodMonth: 3,
        quotaAmount: 9999,
      })
    ).rejects.toThrow(BusinessError);
  });

  it('creates a TERRITORY quota', async () => {
    const q = await QuotaService.create(db, TEST_TENANT, 1, {
      subjectType: 'TERRITORY',
      subjectTerritoryId: territoryId,
      periodYear: 2026,
      periodMonth: 4,
      quotaAmount: 200000,
    });
    expect(q.subjectType).toBe('TERRITORY');
    expect(q.subjectTerritoryId).toBe(territoryId);
  });

  it('rejects a TERRITORY quota for a territoryId outside the tenant', async () => {
    await expect(
      QuotaService.create(db, TEST_TENANT, 1, {
        subjectType: 'TERRITORY',
        subjectTerritoryId: 999999999,
        periodYear: 2026,
        periodMonth: 5,
        quotaAmount: 1000,
      })
    ).rejects.toThrow(NotFoundError);
  });

  it('update rejects a stale version with OptimisticLockError', async () => {
    const q = await QuotaService.create(db, TEST_TENANT, 1, {
      subjectType: 'REP',
      subjectUserId: repX,
      periodYear: 2026,
      periodMonth: 6,
      quotaAmount: 1000,
    });
    await QuotaService.update(db, TEST_TENANT, q.id, { quotaAmount: 2000, version: q.version });
    await expect(
      QuotaService.update(db, TEST_TENANT, q.id, { quotaAmount: 3000, version: q.version })
    ).rejects.toThrow(OptimisticLockError);
  });

  it('list resolves subjectName for both REP and TERRITORY quotas', async () => {
    const rows = await QuotaService.list(db, TEST_TENANT, { periodYear: 2026, periodMonth: 4 });
    expect(rows.length).toBe(1);
    expect(rows[0]!.subjectName).toBe('Quota Test Territory');
  });

  describe('getAttainment', () => {
    it('computes actual revenue for a REP quota from won opportunities only, ignoring open/lost ones', async () => {
      const q = await QuotaService.create(db, TEST_TENANT, 1, {
        subjectType: 'REP',
        subjectUserId: repX,
        periodYear: 2027,
        periodMonth: 1,
        quotaAmount: 10000,
      });

      const wonAt = new Date(Date.UTC(2027, 0, 15));
      await db.insert(crmOpportunities).values([
        {
          tenantId: TEST_TENANT,
          name: 'Won Deal',
          assignedTo: repX,
          value: '4000',
          stage: 'WON',
          wonAt,
          createdBy: 1,
        } as unknown as typeof crmOpportunities.$inferInsert,
        {
          tenantId: TEST_TENANT,
          name: 'Open Deal',
          assignedTo: repX,
          value: '9999',
          stage: 'NEW',
          createdBy: 1,
        } as unknown as typeof crmOpportunities.$inferInsert,
        {
          tenantId: TEST_TENANT,
          name: 'Won Outside Period',
          assignedTo: repX,
          value: '5000',
          stage: 'WON',
          wonAt: new Date(Date.UTC(2027, 1, 1)),
          createdBy: 1,
        } as unknown as typeof crmOpportunities.$inferInsert,
      ]);

      const result = await QuotaService.getAttainment(db, TEST_TENANT, 2027, 1);
      const row = result.rows.find((r) => r.quotaId === q.id)!;
      expect(row.actualAmount).toBe(4000);
      expect(row.attainmentPct).toBe(40);
    });

    it('computes actual revenue for a TERRITORY quota as the sum across every branch in the territory', async () => {
      const q = await QuotaService.create(db, TEST_TENANT, 1, {
        subjectType: 'TERRITORY',
        subjectTerritoryId: territoryId,
        periodYear: 2027,
        periodMonth: 2,
        quotaAmount: 1000,
      });

      const wonAt = new Date(Date.UTC(2027, 1, 10));
      await db.insert(crmOpportunities).values({
        tenantId: TEST_TENANT,
        name: 'Territory Won Deal',
        branchId: branchA,
        value: '2500',
        stage: 'WON',
        wonAt,
        createdBy: 1,
      } as unknown as typeof crmOpportunities.$inferInsert);

      const result = await QuotaService.getAttainment(db, TEST_TENANT, 2027, 2);
      const row = result.rows.find((r) => r.quotaId === q.id)!;
      expect(row.actualAmount).toBe(2500);
      expect(row.attainmentPct).toBe(250);
    });

    it('returns null attainmentPct (not a divide-by-zero) when quotaAmount is 0', async () => {
      const q = await QuotaService.create(db, TEST_TENANT, 1, {
        subjectType: 'REP',
        subjectUserId: repY,
        periodYear: 2027,
        periodMonth: 3,
        quotaAmount: 0,
      });
      const result = await QuotaService.getAttainment(db, TEST_TENANT, 2027, 3);
      const row = result.rows.find((r) => r.quotaId === q.id)!;
      expect(row.attainmentPct).toBeNull();
    });

    // Multi-vertical platform audit 2026-08-16, Phase 3 — walk-in/POS revenue now counts.
    it('adds walk-in invoice revenue (createdBy = rep, no quotation) on top of won-opportunity value for a REP quota', async () => {
      const q = await QuotaService.create(db, TEST_TENANT, 1, {
        subjectType: 'REP',
        subjectUserId: repX,
        periodYear: 2027,
        periodMonth: 4,
        quotaAmount: 10000,
      });
      const invoiceDate = new Date(Date.UTC(2027, 3, 10));

      await db.insert(crmOpportunities).values({
        tenantId: TEST_TENANT,
        name: 'CRM Deal (Rep X, Apr 2027)',
        assignedTo: repX,
        value: '3000',
        stage: 'WON',
        wonAt: invoiceDate,
        createdBy: 1,
      } as unknown as typeof crmOpportunities.$inferInsert);

      // Walk-in POS sale — no quotationId, createdBy is the cashier/rep directly.
      await db.insert(invoices).values({
        tenantId: TEST_TENANT,
        branchId: branchA,
        warehouseId: branchA,
        status: 'PAID',
        customerId: 1,
        placeOfSupply: '27',
        invoiceDate,
        dueDate: invoiceDate,
        grandTotal: '1500',
        createdBy: repX,
      });
      // Same rep, but DRAFT — must not count.
      await db.insert(invoices).values({
        tenantId: TEST_TENANT,
        branchId: branchA,
        warehouseId: branchA,
        status: 'DRAFT',
        customerId: 1,
        placeOfSupply: '27',
        invoiceDate,
        dueDate: invoiceDate,
        grandTotal: '9999',
        createdBy: repX,
      });
      // A different rep's invoice in the same period — must not count toward repX's actual.
      await db.insert(invoices).values({
        tenantId: TEST_TENANT,
        branchId: branchA,
        warehouseId: branchA,
        status: 'PAID',
        customerId: 1,
        placeOfSupply: '27',
        invoiceDate,
        dueDate: invoiceDate,
        grandTotal: '777',
        createdBy: repY,
      });

      const result = await QuotaService.getAttainment(db, TEST_TENANT, 2027, 4);
      const row = result.rows.find((r) => r.quotaId === q.id)!;
      expect(row.actualAmount).toBe(4500); // 3000 (won opp) + 1500 (walk-in invoice)
    });

    it('excludes an invoice already counted via its originating WON opportunity, avoiding double-count', async () => {
      const q = await QuotaService.create(db, TEST_TENANT, 1, {
        subjectType: 'REP',
        subjectUserId: repX,
        periodYear: 2027,
        periodMonth: 5,
        quotaAmount: 10000,
      });
      const invoiceDate = new Date(Date.UTC(2027, 4, 10));

      const [quotation] = await db
        .insert(quotations)
        .values({
          tenantId: TEST_TENANT,
          branchId: branchA,
          quotationNumber: `QUOTA-TEST-Q-${TEST_TENANT}`,
          customerId: 1,
          validUntil: invoiceDate,
          placeOfSupply: '27',
          grandTotal: '6000',
          createdBy: repX,
        })
        .returning();

      await db.insert(crmOpportunities).values({
        tenantId: TEST_TENANT,
        name: 'Deal Converted To Invoice',
        assignedTo: repX,
        value: '6000',
        stage: 'WON',
        wonAt: invoiceDate,
        convertedQuotationId: quotation!.id,
        createdBy: 1,
      } as unknown as typeof crmOpportunities.$inferInsert);

      // The quotation converted into this invoice — its value is already counted via the
      // opportunity above, so it must NOT also be summed as invoice revenue.
      await db.insert(invoices).values({
        tenantId: TEST_TENANT,
        branchId: branchA,
        warehouseId: branchA,
        status: 'PAID',
        customerId: 1,
        quotationId: quotation!.id,
        placeOfSupply: '27',
        invoiceDate,
        dueDate: invoiceDate,
        grandTotal: '6000',
        createdBy: repX,
      });

      const result = await QuotaService.getAttainment(db, TEST_TENANT, 2027, 5);
      const row = result.rows.find((r) => r.quotaId === q.id)!;
      expect(row.actualAmount).toBe(6000); // not 12000 — the invoice is excluded, not added
    });

    it('adds invoice revenue for a TERRITORY quota via invoices.branchId', async () => {
      const q = await QuotaService.create(db, TEST_TENANT, 1, {
        subjectType: 'TERRITORY',
        subjectTerritoryId: territoryId,
        periodYear: 2027,
        periodMonth: 6,
        quotaAmount: 1000,
      });
      const invoiceDate = new Date(Date.UTC(2027, 5, 10));

      await db.insert(invoices).values({
        tenantId: TEST_TENANT,
        branchId: branchA,
        warehouseId: branchA,
        status: 'CONFIRMED',
        customerId: 1,
        placeOfSupply: '27',
        invoiceDate,
        dueDate: invoiceDate,
        grandTotal: '850',
        createdBy: repX,
      });

      const result = await QuotaService.getAttainment(db, TEST_TENANT, 2027, 6);
      const row = result.rows.find((r) => r.quotaId === q.id)!;
      expect(row.actualAmount).toBe(850);
    });
  });
});
