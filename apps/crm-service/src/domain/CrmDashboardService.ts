import { and, eq, gte, inArray, isNull, isNotNull, lte, notInArray, or, sql } from 'drizzle-orm';
import { crmLeads, crmTickets, campaigns } from '@erp/db';
import type { ErpDatabase } from '@erp/db';
import type { BranchScope } from '@erp/sdk';
import { QuotaService, type QuotaAttainmentResult } from './QuotaService.js';

// CRM-ROADMAP Phase 1, Feature 8 — CRM Dashboards & KPI Tracking. Aggregation queries only (no
// new tables, per AR-8/the phase doc's "measure before projecting" discipline already applied
// to Customer 360 in Feature 3) — every function here is branch-scope-aware (AR-6) and
// zero-data-safe (returns 0/null rather than NaN/undefined when a denominator is empty).

const LEAD_STAGES = ['NEW', 'CONTACTED', 'QUALIFIED', 'CONVERTED', 'LOST'] as const;

export interface LeadFunnelStage {
  stage: (typeof LEAD_STAGES)[number];
  count: number;
  percentage: number;
}

export interface LeadFunnelResult {
  total: number;
  stages: LeadFunnelStage[];
}

export interface TicketSlaComplianceResult {
  resolvedCount: number;
  compliantCount: number;
  // null (not 0/NaN) when no tickets were resolved in the period — a zero-denominator
  // compliance rate is "no data", not "0% compliant".
  complianceRate: number | null;
}

export interface CampaignPerformanceResult {
  campaignCount: number;
  totalRecipients: number;
  sentCount: number;
  deliveredCount: number;
  failedCount: number;
  deliveryRate: number | null;
}

interface DateRange {
  from?: Date | undefined;
  to?: Date | undefined;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

export class CrmDashboardService {
  /** Lead counts per pipeline stage, with percentages of the branch-scoped total. */
  static async getLeadFunnel(
    db: ErpDatabase,
    tenantId: number,
    branchScope: BranchScope,
    range: DateRange = {}
  ): Promise<LeadFunnelResult> {
    const conditions = [eq(crmLeads.tenantId, tenantId)];
    if (branchScope !== 'all') {
      conditions.push(or(isNull(crmLeads.branchId), inArray(crmLeads.branchId, branchScope))!);
    }
    if (range.from) conditions.push(gte(crmLeads.createdAt, range.from));
    if (range.to) conditions.push(lte(crmLeads.createdAt, range.to));

    const rows = await db
      .select({ stage: crmLeads.stage, count: sql<number>`count(*)::int` })
      .from(crmLeads)
      .where(and(...conditions))
      .groupBy(crmLeads.stage);

    const countByStage = new Map(rows.map((r) => [r.stage, r.count]));
    const total = rows.reduce((sum, r) => sum + r.count, 0);
    const stages: LeadFunnelStage[] = LEAD_STAGES.map((stage) => {
      const count = countByStage.get(stage) ?? 0;
      return { stage, count, percentage: total === 0 ? 0 : round1((count / total) * 100) };
    });

    return { total, stages };
  }

  /**
   * % of tickets RESOLVED in the period that met their SLA — checked directly against
   * resolvedAt <= slaDueAt, not the `slaBreached` flag (that flag is only ever set by the
   * periodic sweep job for tickets still open past due; a ticket resolved late but before the
   * next sweep run would never have it set, so relying on it here would undercount breaches).
   * A ticket with no applicable SLA rule (slaDueAt null) counts as compliant — nothing to breach.
   */
  static async getTicketSlaCompliance(
    db: ErpDatabase,
    tenantId: number,
    branchScope: BranchScope,
    range: DateRange = {}
  ): Promise<TicketSlaComplianceResult> {
    const conditions = [eq(crmTickets.tenantId, tenantId), isNotNull(crmTickets.resolvedAt)];
    if (branchScope !== 'all') {
      conditions.push(or(isNull(crmTickets.branchId), inArray(crmTickets.branchId, branchScope))!);
    }
    if (range.from) conditions.push(gte(crmTickets.resolvedAt, range.from));
    if (range.to) conditions.push(lte(crmTickets.resolvedAt, range.to));

    const rows = await db
      .select({ resolvedAt: crmTickets.resolvedAt, slaDueAt: crmTickets.slaDueAt })
      .from(crmTickets)
      .where(and(...conditions));

    const resolvedCount = rows.length;
    const compliantCount = rows.filter(
      (r) => !r.slaDueAt || (r.resolvedAt && r.resolvedAt <= r.slaDueAt)
    ).length;

    return {
      resolvedCount,
      compliantCount,
      complianceRate: resolvedCount === 0 ? null : round1((compliantCount / resolvedCount) * 100),
    };
  }

  /**
   * Tenant/branch-wide rollup using campaigns' own pre-aggregated counters
   * (totalRecipients/sentCount/deliveredCount/failedCount) rather than re-deriving them from a
   * campaign_recipients GROUP BY — those columns are already the source of truth CampaignService
   * maintains per-send, so summing them avoids a second, potentially-drifting aggregation path.
   * Excludes DRAFT campaigns (never launched, nothing to report on).
   */
  static async getCampaignPerformance(
    db: ErpDatabase,
    tenantId: number,
    branchScope: BranchScope,
    range: DateRange = {}
  ): Promise<CampaignPerformanceResult> {
    const conditions = [eq(campaigns.tenantId, tenantId), notInArray(campaigns.status, ['DRAFT'])];
    if (branchScope !== 'all') {
      conditions.push(or(isNull(campaigns.branchId), inArray(campaigns.branchId, branchScope))!);
    }
    if (range.from) conditions.push(gte(campaigns.sentAt, range.from));
    if (range.to) conditions.push(lte(campaigns.sentAt, range.to));

    const [row] = await db
      .select({
        campaignCount: sql<number>`count(*)::int`,
        totalRecipients: sql<number>`COALESCE(SUM(total_recipients), 0)::int`,
        sentCount: sql<number>`COALESCE(SUM(sent_count), 0)::int`,
        deliveredCount: sql<number>`COALESCE(SUM(delivered_count), 0)::int`,
        failedCount: sql<number>`COALESCE(SUM(failed_count), 0)::int`,
      })
      .from(campaigns)
      .where(and(...conditions));

    const totalRecipients = row?.totalRecipients ?? 0;
    const deliveredCount = row?.deliveredCount ?? 0;

    return {
      campaignCount: row?.campaignCount ?? 0,
      totalRecipients,
      sentCount: row?.sentCount ?? 0,
      deliveredCount,
      failedCount: row?.failedCount ?? 0,
      deliveryRate: totalRecipients === 0 ? null : round1((deliveredCount / totalRecipients) * 100),
    };
  }

  /**
   * CRM-ROADMAP Phase 4, Feature 5 — thin delegate to QuotaService.getAttainment. Deliberately
   * NOT branch-scope-filtered like the three methods above: quotas are scoped by their own
   * subject (a rep or a territory), not by the caller's branch assignment, and only
   * QUOTA_MANAGE holders (Sales Ops admins — see quota.routes.ts) can reach this section at
   * all, so a tenant-wide view is the correct default rather than an additional filter.
   */
  static async getQuotaAttainment(
    db: ErpDatabase,
    tenantId: number,
    periodYear: number,
    periodMonth: number
  ): Promise<QuotaAttainmentResult> {
    return QuotaService.getAttainment(db, tenantId, periodYear, periodMonth);
  }
}
