// CRM-ROADMAP Phase 1, Feature 8 (CRM Dashboards & KPI Tracking) — CrmDashboardService
// coverage: funnel/SLA-compliance math against a hand-computed fixture (per the phase doc's own
// DoD), zero-data safety (no NaN/undefined from a zero-denominator), branch-scoping (AR-6,
// including the nullable-branch-id "unassigned rows stay visible" wrinkle every other CRM list
// route already implements), and date-range filtering.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createDatabaseClient } from '@erp/db';
import { branches, crmLeads, crmTickets, campaigns, customers } from '@erp/db';
import { eq } from 'drizzle-orm';
import { CrmDashboardService } from '../domain/CrmDashboardService.js';

const DB_URL = process.env['DATABASE_URL'];

describe.skipIf(!DB_URL)('CrmDashboardService — integration', () => {
  let db: ReturnType<typeof createDatabaseClient>;
  const TEST_TENANT = 900_701 + Math.floor(Math.random() * 1000);
  const EMPTY_TENANT = 900_801 + Math.floor(Math.random() * 1000);
  let branchA: number;
  let branchB: number;
  let customerId: number;

  beforeAll(async () => {
    db = createDatabaseClient({ url: DB_URL! });
    const [ba] = await db
      .insert(branches)
      .values({
        tenantId: TEST_TENANT,
        name: 'Branch A',
        code: 'BA',
        isHeadOffice: true,
        isActive: true,
        createdBy: 1,
      })
      .returning();
    branchA = ba!.id;
    const [bb] = await db
      .insert(branches)
      .values({
        tenantId: TEST_TENANT,
        name: 'Branch B',
        code: 'BB',
        isHeadOffice: false,
        isActive: true,
        createdBy: 1,
      })
      .returning();
    branchB = bb!.id;

    const [customer] = await db
      .insert(customers)
      .values({
        tenantId: TEST_TENANT,
        branchId: branchA,
        displayName: 'Dashboard Test Customer',
        phone: '9400001111',
        customerType: 'RETAIL',
        creditLimit: '0',
        openingBalance: '0',
        createdBy: 1,
      })
      .returning();
    customerId = customer!.id;
  });

  afterAll(async () => {
    await db.delete(crmLeads).where(eq(crmLeads.tenantId, TEST_TENANT));
    await db.delete(crmTickets).where(eq(crmTickets.tenantId, TEST_TENANT));
    await db.delete(campaigns).where(eq(campaigns.tenantId, TEST_TENANT));
    await db.delete(customers).where(eq(customers.tenantId, TEST_TENANT));
    await db.delete(branches).where(eq(branches.tenantId, TEST_TENANT));
  });

  describe('getLeadFunnel', () => {
    it('matches a hand-computed fixture: counts and percentages per stage', async () => {
      await db.insert(crmLeads).values([
        { tenantId: TEST_TENANT, phone: '9400010001', stage: 'NEW', createdBy: 1 },
        { tenantId: TEST_TENANT, phone: '9400010002', stage: 'NEW', createdBy: 1 },
        { tenantId: TEST_TENANT, phone: '9400010003', stage: 'CONTACTED', createdBy: 1 },
        { tenantId: TEST_TENANT, phone: '9400010004', stage: 'CONVERTED', createdBy: 1 },
      ]);

      const result = await CrmDashboardService.getLeadFunnel(db, TEST_TENANT, 'all');

      expect(result.total).toBe(4);
      expect(result.stages.find((s) => s.stage === 'NEW')).toEqual({
        stage: 'NEW',
        count: 2,
        percentage: 50,
      });
      expect(result.stages.find((s) => s.stage === 'CONTACTED')).toEqual({
        stage: 'CONTACTED',
        count: 1,
        percentage: 25,
      });
      expect(result.stages.find((s) => s.stage === 'QUALIFIED')).toEqual({
        stage: 'QUALIFIED',
        count: 0,
        percentage: 0,
      });
      expect(result.stages.find((s) => s.stage === 'LOST')).toEqual({
        stage: 'LOST',
        count: 0,
        percentage: 0,
      });
    });

    it('a zero-lead tenant returns 0 percentages, never NaN', async () => {
      const result = await CrmDashboardService.getLeadFunnel(db, EMPTY_TENANT, 'all');
      expect(result.total).toBe(0);
      for (const stage of result.stages) {
        expect(Number.isNaN(stage.percentage)).toBe(false);
        expect(stage.percentage).toBe(0);
      }
    });

    it("branch-scoped: excludes another branch's leads, keeps unassigned (null branch) ones visible", async () => {
      await db.insert(crmLeads).values([
        {
          tenantId: TEST_TENANT,
          phone: '9400020001',
          stage: 'NEW',
          branchId: branchA,
          createdBy: 1,
        },
        {
          tenantId: TEST_TENANT,
          phone: '9400020002',
          stage: 'NEW',
          branchId: branchB,
          createdBy: 1,
        },
        { tenantId: TEST_TENANT, phone: '9400020003', stage: 'NEW', branchId: null, createdBy: 1 },
      ]);

      const scopedToA = await CrmDashboardService.getLeadFunnel(db, TEST_TENANT, [branchA]);
      const scopedToAll = await CrmDashboardService.getLeadFunnel(db, TEST_TENANT, 'all');

      // scopedToA: the branchA lead + the null-branch (unassigned) lead, never the branchB one.
      const branchAOnlyCount = scopedToA.stages.reduce((sum, s) => sum + s.count, 0);
      const allCount = scopedToAll.stages.reduce((sum, s) => sum + s.count, 0);
      expect(allCount - branchAOnlyCount).toBe(1); // exactly the branchB-only lead is excluded
    });

    it('date-range filter excludes leads created outside the window', async () => {
      const [oldLead] = await db
        .insert(crmLeads)
        .values({ tenantId: TEST_TENANT, phone: '9400030001', stage: 'NEW', createdBy: 1 })
        .returning();
      await db
        .update(crmLeads)
        .set({ createdAt: new Date('2020-01-01T00:00:00.000Z') })
        .where(eq(crmLeads.id, oldLead!.id));

      const inRange = await CrmDashboardService.getLeadFunnel(db, TEST_TENANT, 'all', {
        from: new Date('2026-01-01T00:00:00.000Z'),
      });
      const noFilter = await CrmDashboardService.getLeadFunnel(db, TEST_TENANT, 'all');

      const inRangeCount = inRange.stages.reduce((sum, s) => sum + s.count, 0);
      const noFilterCount = noFilter.stages.reduce((sum, s) => sum + s.count, 0);
      expect(noFilterCount - inRangeCount).toBe(1); // exactly the 2020 lead is excluded
    });
  });

  describe('getTicketSlaCompliance', () => {
    it('matches a hand-computed fixture: on-time + no-rule count compliant, late does not', async () => {
      const now = Date.now();
      await db.insert(crmTickets).values([
        {
          tenantId: TEST_TENANT,
          ticketNumber: 'TKT-DASH-1',
          customerId,
          subject: 'Resolved on time',
          slaDueAt: new Date(now + 3_600_000),
          resolvedAt: new Date(now),
          createdBy: 1,
        },
        {
          tenantId: TEST_TENANT,
          ticketNumber: 'TKT-DASH-2',
          customerId,
          subject: 'Resolved late',
          slaDueAt: new Date(now - 3_600_000),
          resolvedAt: new Date(now),
          createdBy: 1,
        },
        {
          tenantId: TEST_TENANT,
          ticketNumber: 'TKT-DASH-3',
          customerId,
          subject: 'Resolved, no SLA rule ever matched',
          slaDueAt: null,
          resolvedAt: new Date(now),
          createdBy: 1,
        },
        {
          tenantId: TEST_TENANT,
          ticketNumber: 'TKT-DASH-4',
          customerId,
          subject: 'Still open — must not count toward resolvedCount',
          slaDueAt: new Date(now + 3_600_000),
          resolvedAt: null,
          createdBy: 1,
        },
      ]);

      const result = await CrmDashboardService.getTicketSlaCompliance(db, TEST_TENANT, 'all');

      expect(result.resolvedCount).toBe(3);
      expect(result.compliantCount).toBe(2); // on-time + no-rule; late is not compliant
      expect(result.complianceRate).toBeCloseTo(66.7, 1);
    });

    it('a tenant with zero resolved tickets returns a null rate, never NaN or 0-as-if-0%-compliant', async () => {
      const result = await CrmDashboardService.getTicketSlaCompliance(db, EMPTY_TENANT, 'all');
      expect(result.resolvedCount).toBe(0);
      expect(result.complianceRate).toBeNull();
    });
  });

  describe('getCampaignPerformance', () => {
    it('sums pre-aggregated counters across SENT campaigns, excludes DRAFT', async () => {
      await db.insert(campaigns).values([
        {
          tenantId: TEST_TENANT,
          name: 'Diwali Sale',
          channel: 'SMS',
          messageTemplate: 'Sale!',
          status: 'SENT',
          totalRecipients: 100,
          sentCount: 100,
          deliveredCount: 90,
          failedCount: 10,
          createdBy: 1,
        },
        {
          tenantId: TEST_TENANT,
          name: 'New Year Sale',
          channel: 'SMS',
          messageTemplate: 'Happy New Year!',
          status: 'SENT',
          totalRecipients: 50,
          sentCount: 50,
          deliveredCount: 45,
          failedCount: 5,
          createdBy: 1,
        },
        {
          tenantId: TEST_TENANT,
          name: 'Unlaunched Draft',
          channel: 'SMS',
          messageTemplate: 'Draft content',
          status: 'DRAFT',
          totalRecipients: 999,
          sentCount: 999,
          deliveredCount: 999,
          failedCount: 999,
          createdBy: 1,
        },
      ]);

      const result = await CrmDashboardService.getCampaignPerformance(db, TEST_TENANT, 'all');

      expect(result.campaignCount).toBe(2); // draft excluded
      expect(result.totalRecipients).toBe(150);
      expect(result.deliveredCount).toBe(135);
      expect(result.failedCount).toBe(15);
      expect(result.deliveryRate).toBeCloseTo(90, 1);
    });

    it('a tenant with zero sent campaigns returns a null delivery rate', async () => {
      const result = await CrmDashboardService.getCampaignPerformance(db, EMPTY_TENANT, 'all');
      expect(result.campaignCount).toBe(0);
      expect(result.totalRecipients).toBe(0);
      expect(result.deliveryRate).toBeNull();
    });
  });
});
