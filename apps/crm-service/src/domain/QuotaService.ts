import { and, eq, gte, inArray, isNull, lt, notInArray, or, sql } from 'drizzle-orm';
import {
  crmSalesQuotas,
  crmTerritories,
  crmTerritoryBranches,
  crmOpportunities,
  invoices,
  users,
} from '@erp/db';
import type { ErpDatabase, CrmSalesQuota } from '@erp/db';
import { BusinessError, NotFoundError, OptimisticLockError, ValidationError } from '@erp/types';

export interface QuotaWithSubjectName extends CrmSalesQuota {
  subjectName: string;
}

export interface QuotaAttainmentRow {
  quotaId: number;
  subjectType: 'REP' | 'TERRITORY';
  subjectId: number;
  subjectName: string;
  quotaAmount: number;
  actualAmount: number;
  // null (not 0) when quotaAmount is 0 — an unset/zero target has no meaningful "% of target"
  // to report, same zero-denominator discipline as CrmDashboardService's other rates.
  attainmentPct: number | null;
}

export interface QuotaAttainmentResult {
  periodYear: number;
  periodMonth: number;
  rows: QuotaAttainmentRow[];
  totalQuota: number;
  totalActual: number;
  totalAttainmentPct: number | null;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function periodBounds(periodYear: number, periodMonth: number): { start: Date; end: Date } {
  const start = new Date(Date.UTC(periodYear, periodMonth - 1, 1));
  const end = new Date(Date.UTC(periodYear, periodMonth, 1));
  return { start, end };
}

/**
 * CRM-ROADMAP Phase 4, Feature 5 — Sales Forecasting & Quota Management.
 *
 * Multi-vertical platform audit 2026-08-16, Phase 3: "Actual" revenue was computed from WON
 * opportunities only — a walk-in/POS sale (grocery's dominant sales pattern, never tracked as
 * a CRM Opportunity) never counted toward quota attainment. Actuals are now the sum of two
 * non-overlapping sources: WON opportunity value (crmOpportunities.value, wonAt in period), and
 * invoiced revenue attributed via invoices.createdBy (REP) / invoices.branchId (TERRITORY) —
 * the same attribution CommissionService already uses for invoice->rep. Overlap is prevented at
 * the source: an invoice whose quotationId is any opportunity's convertedQuotationId (the "mark
 * Won auto-creates quotation" link — see crmOpportunities.convertedQuotationId) is excluded from
 * the invoice sum, since that deal's value is already counted via the opportunity. Every other
 * invoice — walk-in/POS with no quotation, or a manually quoted sale outside the CRM pipeline —
 * is new coverage this fix adds.
 */
export class QuotaService {
  static async create(
    db: ErpDatabase,
    tenantId: number,
    userId: number,
    params: {
      subjectType: 'REP' | 'TERRITORY';
      subjectUserId?: number | undefined;
      subjectTerritoryId?: number | undefined;
      periodYear: number;
      periodMonth: number;
      quotaAmount: number;
    }
  ): Promise<CrmSalesQuota> {
    if (params.subjectType === 'REP') {
      if (!params.subjectUserId)
        throw new ValidationError('subjectUserId is required for a REP quota');
      const [user] = await db
        .select({ id: users.id })
        .from(users)
        .where(and(eq(users.id, params.subjectUserId), eq(users.tenantId, tenantId)));
      if (!user) throw new NotFoundError('User', params.subjectUserId);
    } else {
      if (!params.subjectTerritoryId)
        throw new ValidationError('subjectTerritoryId is required for a TERRITORY quota');
      const [territory] = await db
        .select({ id: crmTerritories.id })
        .from(crmTerritories)
        .where(
          and(
            eq(crmTerritories.id, params.subjectTerritoryId),
            eq(crmTerritories.tenantId, tenantId)
          )
        );
      if (!territory) throw new NotFoundError('Territory', params.subjectTerritoryId);
    }

    const [existing] = await db
      .select({ id: crmSalesQuotas.id })
      .from(crmSalesQuotas)
      .where(
        and(
          eq(crmSalesQuotas.tenantId, tenantId),
          eq(crmSalesQuotas.subjectType, params.subjectType),
          params.subjectType === 'REP'
            ? eq(crmSalesQuotas.subjectUserId, params.subjectUserId!)
            : eq(crmSalesQuotas.subjectTerritoryId, params.subjectTerritoryId!),
          eq(crmSalesQuotas.periodYear, params.periodYear),
          eq(crmSalesQuotas.periodMonth, params.periodMonth)
        )
      );
    if (existing) {
      throw new BusinessError(
        'QUOTA_ALREADY_EXISTS',
        'A quota for this subject and period already exists — edit it instead of creating a duplicate'
      );
    }

    const [created] = await db
      .insert(crmSalesQuotas)
      .values({
        tenantId,
        subjectType: params.subjectType,
        subjectUserId: params.subjectType === 'REP' ? params.subjectUserId : undefined,
        subjectTerritoryId:
          params.subjectType === 'TERRITORY' ? params.subjectTerritoryId : undefined,
        periodYear: params.periodYear,
        periodMonth: params.periodMonth,
        quotaAmount: String(params.quotaAmount),
        createdBy: userId,
      })
      .returning();
    if (!created) throw new Error('Quota creation failed unexpectedly');
    return created;
  }

  /**
   * Only quotaAmount is editable — subject/period are the record's identity (changing either
   * is a new quota, not an edit). This is also why a quota change is never a silent historical
   * rewrite (the roadmap's own flagged edge case): the version bump + ctx.audit.log's before/
   * after (wired at the route layer) is the explicit trail a mid-period amount change leaves,
   * and each period is its own row, so amending March's target can never retroactively alter
   * what April's target was.
   */
  static async update(
    db: ErpDatabase,
    tenantId: number,
    quotaId: number,
    patch: { quotaAmount: number; version: number }
  ): Promise<CrmSalesQuota> {
    const [updated] = await db
      .update(crmSalesQuotas)
      .set({
        quotaAmount: String(patch.quotaAmount),
        updatedAt: new Date(),
        version: sql`${crmSalesQuotas.version} + 1`,
      })
      .where(
        and(
          eq(crmSalesQuotas.id, quotaId),
          eq(crmSalesQuotas.tenantId, tenantId),
          eq(crmSalesQuotas.version, patch.version)
        )
      )
      .returning();
    if (!updated) {
      const [existing] = await db
        .select({ id: crmSalesQuotas.id })
        .from(crmSalesQuotas)
        .where(and(eq(crmSalesQuotas.id, quotaId), eq(crmSalesQuotas.tenantId, tenantId)));
      throw existing ? new OptimisticLockError('Quota') : new NotFoundError('Quota', quotaId);
    }
    return updated;
  }

  static async list(
    db: ErpDatabase,
    tenantId: number,
    filters: { periodYear?: number | undefined; periodMonth?: number | undefined } = {}
  ): Promise<QuotaWithSubjectName[]> {
    const conditions = [eq(crmSalesQuotas.tenantId, tenantId)];
    if (filters.periodYear !== undefined)
      conditions.push(eq(crmSalesQuotas.periodYear, filters.periodYear));
    if (filters.periodMonth !== undefined)
      conditions.push(eq(crmSalesQuotas.periodMonth, filters.periodMonth));

    const rows = await db
      .select()
      .from(crmSalesQuotas)
      .where(and(...conditions))
      .orderBy(crmSalesQuotas.periodYear, crmSalesQuotas.periodMonth);

    return QuotaService.attachSubjectNames(db, tenantId, rows);
  }

  private static async attachSubjectNames(
    db: ErpDatabase,
    tenantId: number,
    rows: CrmSalesQuota[]
  ): Promise<QuotaWithSubjectName[]> {
    if (rows.length === 0) return [];

    const userIds = rows.filter((r) => r.subjectType === 'REP').map((r) => r.subjectUserId!);
    const territoryIds = rows
      .filter((r) => r.subjectType === 'TERRITORY')
      .map((r) => r.subjectTerritoryId!);

    const userRows =
      userIds.length > 0
        ? await db
            .select({ id: users.id, firstName: users.firstName, lastName: users.lastName })
            .from(users)
            .where(and(inArray(users.id, userIds), eq(users.tenantId, tenantId)))
        : [];
    const territoryRows =
      territoryIds.length > 0
        ? await db
            .select({ id: crmTerritories.id, name: crmTerritories.name })
            .from(crmTerritories)
            .where(
              and(inArray(crmTerritories.id, territoryIds), eq(crmTerritories.tenantId, tenantId))
            )
        : [];

    const userNameById = new Map(userRows.map((u) => [u.id, `${u.firstName} ${u.lastName}`]));
    const territoryNameById = new Map(territoryRows.map((t) => [t.id, t.name]));

    return rows.map((r) => ({
      ...r,
      subjectName:
        r.subjectType === 'REP'
          ? (userNameById.get(r.subjectUserId!) ?? `User #${r.subjectUserId}`)
          : (territoryNameById.get(r.subjectTerritoryId!) ?? `Territory #${r.subjectTerritoryId}`),
    }));
  }

  static async getAttainment(
    db: ErpDatabase,
    tenantId: number,
    periodYear: number,
    periodMonth: number
  ): Promise<QuotaAttainmentResult> {
    const quotas = await db
      .select()
      .from(crmSalesQuotas)
      .where(
        and(
          eq(crmSalesQuotas.tenantId, tenantId),
          eq(crmSalesQuotas.periodYear, periodYear),
          eq(crmSalesQuotas.periodMonth, periodMonth)
        )
      );

    const named = await QuotaService.attachSubjectNames(db, tenantId, quotas);
    const { start, end } = periodBounds(periodYear, periodMonth);

    const rows: QuotaAttainmentRow[] = await Promise.all(
      named.map(async (q) => {
        const actualAmount = await QuotaService.computeActual(db, tenantId, q, start, end);
        const quotaAmount = parseFloat(q.quotaAmount);
        return {
          quotaId: q.id,
          subjectType: q.subjectType,
          subjectId: q.subjectType === 'REP' ? q.subjectUserId! : q.subjectTerritoryId!,
          subjectName: q.subjectName,
          quotaAmount,
          actualAmount,
          attainmentPct: quotaAmount === 0 ? null : round1((actualAmount / quotaAmount) * 100),
        };
      })
    );

    const totalQuota = rows.reduce((sum, r) => sum + r.quotaAmount, 0);
    const totalActual = rows.reduce((sum, r) => sum + r.actualAmount, 0);

    return {
      periodYear,
      periodMonth,
      rows,
      totalQuota,
      totalActual,
      totalAttainmentPct: totalQuota === 0 ? null : round1((totalActual / totalQuota) * 100),
    };
  }

  private static async computeActual(
    db: ErpDatabase,
    tenantId: number,
    quota: CrmSalesQuota,
    start: Date,
    end: Date
  ): Promise<number> {
    if (quota.subjectType === 'REP') {
      const [row] = await db
        .select({ total: sql<string>`COALESCE(SUM(${crmOpportunities.value}), 0)` })
        .from(crmOpportunities)
        .where(
          and(
            eq(crmOpportunities.tenantId, tenantId),
            eq(crmOpportunities.assignedTo, quota.subjectUserId!),
            sql`${crmOpportunities.wonAt} IS NOT NULL AND ${crmOpportunities.wonAt} >= ${start.toISOString()} AND ${crmOpportunities.wonAt} < ${end.toISOString()}`
          )
        );
      const opportunityActual = parseFloat(row?.total ?? '0');
      const invoiceActual = await QuotaService.computeInvoiceActual(
        db,
        tenantId,
        { createdBy: quota.subjectUserId! },
        start,
        end
      );
      return opportunityActual + invoiceActual;
    }

    const territoryBranchRows = await db
      .select({ branchId: crmTerritoryBranches.branchId })
      .from(crmTerritoryBranches)
      .where(eq(crmTerritoryBranches.territoryId, quota.subjectTerritoryId!));
    const branchIds = territoryBranchRows.map((r) => r.branchId);
    if (branchIds.length === 0) return 0;

    const [row] = await db
      .select({ total: sql<string>`COALESCE(SUM(${crmOpportunities.value}), 0)` })
      .from(crmOpportunities)
      .where(
        and(
          eq(crmOpportunities.tenantId, tenantId),
          inArray(crmOpportunities.branchId, branchIds),
          sql`${crmOpportunities.wonAt} IS NOT NULL AND ${crmOpportunities.wonAt} >= ${start.toISOString()} AND ${crmOpportunities.wonAt} < ${end.toISOString()}`
        )
      );
    const opportunityActual = parseFloat(row?.total ?? '0');
    const invoiceActual = await QuotaService.computeInvoiceActual(
      db,
      tenantId,
      { branchIds },
      start,
      end
    );
    return opportunityActual + invoiceActual;
  }

  // Walk-in/POS (and any other non-CRM-pipeline) invoiced revenue, attributed the same way
  // CommissionService already attributes an invoice to a rep — invoices.createdBy for REP,
  // invoices.branchId for TERRITORY. Excludes any invoice already counted via a WON
  // opportunity's auto-created quotation (crmOpportunities.convertedQuotationId), so a deal
  // never contributes to actuals twice.
  private static async computeInvoiceActual(
    db: ErpDatabase,
    tenantId: number,
    scope: { createdBy: number } | { branchIds: number[] },
    start: Date,
    end: Date
  ): Promise<number> {
    if ('branchIds' in scope && scope.branchIds.length === 0) return 0;

    const convertedRows = await db
      .select({ quotationId: crmOpportunities.convertedQuotationId })
      .from(crmOpportunities)
      .where(
        and(
          eq(crmOpportunities.tenantId, tenantId),
          sql`${crmOpportunities.convertedQuotationId} IS NOT NULL`
        )
      );
    const excludedQuotationIds = convertedRows
      .map((r) => r.quotationId)
      .filter((id): id is number => id !== null);

    const [row] = await db
      .select({ total: sql<string>`COALESCE(SUM(${invoices.grandTotal}), 0)` })
      .from(invoices)
      .where(
        and(
          eq(invoices.tenantId, tenantId),
          'createdBy' in scope
            ? eq(invoices.createdBy, scope.createdBy)
            : inArray(invoices.branchId, scope.branchIds),
          sql`${invoices.status} NOT IN ('DRAFT', 'CANCELLED')`,
          gte(invoices.invoiceDate, start),
          lt(invoices.invoiceDate, end),
          ...(excludedQuotationIds.length > 0
            ? [
                or(
                  isNull(invoices.quotationId),
                  notInArray(invoices.quotationId, excludedQuotationIds)
                )!,
              ]
            : [])
        )
      );
    return parseFloat(row?.total ?? '0');
  }
}
