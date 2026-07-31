import { and, desc, eq, gte, lt, sql } from 'drizzle-orm';
import { businessSeasons, crmFestivalSuggestions, invoices } from '@erp/db';
import type { ErpDatabase, CrmFestivalSuggestion } from '@erp/db';
import { BusinessError, NotFoundError } from '@erp/types';

const SEASON_TYPES = [
  'FESTIVAL_SEASON',
  'WEDDING_SEASON',
  'SUMMER_COLLECTION',
  'YEAR_END_SALE',
] as const;

// Below this many orders during last year's season window, the suggestion is INSUFFICIENT_DATA
// rather than a fabricated confident number — same discipline as HealthScoringService's
// MIN_PURCHASES_FOR_CHURN_PREDICTION.
const MIN_PRIOR_SEASON_ORDERS = 5;
const BASELINE_WINDOW_DAYS = 30;
// Clamped so a near-zero baseline (e.g. a brand-new tenant's only-ever season) can't produce an
// absurd ratio — same "don't let thin data imply false precision" reasoning as the threshold
// above, just applied to the output range instead of a go/no-go gate.
const MIN_STOCK_MULTIPLIER = 1;
const MAX_STOCK_MULTIPLIER = 5;

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function addYears(date: Date, years: number): Date {
  const d = new Date(date.getTime());
  d.setUTCFullYear(d.getUTCFullYear() + years);
  return d;
}

/**
 * CRM-ROADMAP Phase 4, Feature 3 — Festival Intelligence AI. Statistical, not ML/vendor (same
 * discipline as Phase 3's HealthScoringService): a nightly job compares last year's same-
 * seasonType businessSeasons window's invoice volume against the 30 days immediately before it,
 * and proposes next year's stock/loyalty multipliers and dates from that — never auto-applied,
 * always reviewed by a merchandiser (SALES_MANAGER role) before becoming a real season.
 */
export class FestivalIntelligenceService {
  /**
   * Nightly batch across all seasonType values for one tenant. Skips a seasonType entirely
   * (no row written) when the tenant has never run a season of that type at all — there is
   * nothing to suggest against yet, a fundamentally different case from "ran one but it didn't
   * have enough orders" (which DOES write an INSUFFICIENT_DATA row, same as
   * HealthScoringService's distinction between "no purchases" and "too few purchases").
   * Never overwrites a suggestion a merchandiser has already reviewed (APPROVED/REJECTED) —
   * same "don't silently resurface/recompute over a human decision" discipline as the dismiss-
   * aware merge in HealthScoringService.computeAndCachePredictions.
   */
  static async computeAndCacheSuggestions(
    db: ErpDatabase,
    tenantId: number
  ): Promise<{ suggestionsWritten: number }> {
    let suggestionsWritten = 0;

    for (const seasonType of SEASON_TYPES) {
      const [priorSeason] = await db
        .select()
        .from(businessSeasons)
        .where(
          and(
            eq(businessSeasons.tenantId, tenantId),
            eq(businessSeasons.seasonType, seasonType),
            lt(businessSeasons.endDate, new Date())
          )
        )
        .orderBy(desc(businessSeasons.startDate))
        .limit(1);
      if (!priorSeason) continue;

      const suggestedYear = addYears(priorSeason.startDate, 1).getUTCFullYear();

      const [existing] = await db
        .select({ id: crmFestivalSuggestions.id, status: crmFestivalSuggestions.status })
        .from(crmFestivalSuggestions)
        .where(
          and(
            eq(crmFestivalSuggestions.tenantId, tenantId),
            eq(crmFestivalSuggestions.seasonType, seasonType),
            eq(crmFestivalSuggestions.suggestedYear, suggestedYear)
          )
        );
      if (existing && existing.status !== 'PENDING' && existing.status !== 'INSUFFICIENT_DATA') {
        continue;
      }

      const baselineStart = new Date(
        priorSeason.startDate.getTime() - BASELINE_WINDOW_DAYS * 86_400_000
      );

      const [seasonAgg] = await db
        .select({
          count: sql<number>`count(*)::int`,
          revenue: sql<string>`COALESCE(SUM(${invoices.grandTotal}), 0)`,
        })
        .from(invoices)
        .where(
          and(
            eq(invoices.tenantId, tenantId),
            sql`${invoices.status} != 'CANCELLED'`,
            gte(invoices.invoiceDate, priorSeason.startDate),
            lt(invoices.invoiceDate, priorSeason.endDate)
          )
        );
      const [baselineAgg] = await db
        .select({
          count: sql<number>`count(*)::int`,
          revenue: sql<string>`COALESCE(SUM(${invoices.grandTotal}), 0)`,
        })
        .from(invoices)
        .where(
          and(
            eq(invoices.tenantId, tenantId),
            sql`${invoices.status} != 'CANCELLED'`,
            gte(invoices.invoiceDate, baselineStart),
            lt(invoices.invoiceDate, priorSeason.startDate)
          )
        );

      const seasonOrderCount = seasonAgg?.count ?? 0;
      const seasonRevenue = parseFloat(seasonAgg?.revenue ?? '0');
      const baselineRevenue = parseFloat(baselineAgg?.revenue ?? '0');

      const values: Partial<typeof crmFestivalSuggestions.$inferInsert> = {
        tenantId,
        seasonType,
        suggestedYear,
        computedAt: new Date(),
      };

      if (seasonOrderCount < MIN_PRIOR_SEASON_ORDERS) {
        values.status = 'INSUFFICIENT_DATA';
        values.reason = `Only ${seasonOrderCount} order${seasonOrderCount === 1 ? '' : 's'} during last year's "${priorSeason.name}" season window — not enough history yet for a confident suggestion.`;
        values.priorYearOrderCount = seasonOrderCount;
        values.priorYearRevenue = String(seasonRevenue);
      } else {
        const seasonWindowDays = Math.max(
          1,
          Math.round((priorSeason.endDate.getTime() - priorSeason.startDate.getTime()) / 86_400_000)
        );
        const seasonAvgDaily = seasonRevenue / seasonWindowDays;
        const baselineAvgDaily = baselineRevenue / BASELINE_WINDOW_DAYS;
        const ratio = seasonAvgDaily / Math.max(baselineAvgDaily, 1);
        const suggestedStockMultiplier = Math.min(
          MAX_STOCK_MULTIPLIER,
          Math.max(MIN_STOCK_MULTIPLIER, round2(ratio))
        );

        values.status = 'PENDING';
        values.suggestedStartDate = addYears(priorSeason.startDate, 1);
        values.suggestedEndDate = addYears(priorSeason.endDate, 1);
        values.suggestedStockMultiplier = String(suggestedStockMultiplier);
        // Carry forward last year's actual configured loyalty multiplier as the starting
        // suggestion — the most directly defensible "prior-year based" signal, not a derived
        // statistic that could be wrong in a new way of its own.
        values.suggestedLoyaltyMultiplier = priorSeason.loyaltyMultiplier;
        values.reason = `Based on "${priorSeason.name}" (${priorSeason.startDate.getUTCFullYear()}): ${seasonOrderCount} orders totaling ₹${round2(seasonRevenue)} during the season window, vs ₹${round2(baselineRevenue)} in the preceding ${BASELINE_WINDOW_DAYS} days.`;
        values.priorYearOrderCount = seasonOrderCount;
        values.priorYearRevenue = String(seasonRevenue);
      }

      await db
        .insert(crmFestivalSuggestions)
        .values(values as typeof crmFestivalSuggestions.$inferInsert)
        .onConflictDoUpdate({
          target: [
            crmFestivalSuggestions.tenantId,
            crmFestivalSuggestions.seasonType,
            crmFestivalSuggestions.suggestedYear,
          ],
          set: values,
        });
      suggestionsWritten++;
    }

    return { suggestionsWritten };
  }

  static async list(
    db: ErpDatabase,
    tenantId: number,
    filters: { status?: CrmFestivalSuggestion['status'] | undefined } = {}
  ): Promise<CrmFestivalSuggestion[]> {
    const conditions = [eq(crmFestivalSuggestions.tenantId, tenantId)];
    if (filters.status) conditions.push(eq(crmFestivalSuggestions.status, filters.status));
    return db
      .select()
      .from(crmFestivalSuggestions)
      .where(and(...conditions))
      .orderBy(desc(crmFestivalSuggestions.computedAt));
  }

  /**
   * Creates a real businessSeasons row from a PENDING suggestion — the one point where a
   * merchandiser's explicit action, not this feature's own math, puts a season into effect.
   * `overrides` lets the merchandiser adjust any suggested value before approving (the roadmap's
   * own "reviewed and approved... not auto-applied" requirement means the suggestion is a
   * starting point, not a mandate).
   */
  static async approve(
    db: ErpDatabase,
    tenantId: number,
    userId: number,
    suggestionId: number,
    overrides: {
      name: string;
      startDate?: Date | undefined;
      endDate?: Date | undefined;
      stockMultiplier?: number | undefined;
      loyaltyMultiplier?: number | undefined;
    }
  ): Promise<{ suggestion: CrmFestivalSuggestion; seasonId: number }> {
    const [suggestion] = await db
      .select()
      .from(crmFestivalSuggestions)
      .where(
        and(
          eq(crmFestivalSuggestions.id, suggestionId),
          eq(crmFestivalSuggestions.tenantId, tenantId)
        )
      );
    if (!suggestion) throw new NotFoundError('Festival suggestion', suggestionId);
    if (suggestion.status !== 'PENDING') {
      throw new BusinessError(
        'SUGGESTION_NOT_PENDING',
        'Only a PENDING suggestion can be approved'
      );
    }

    const startDate = overrides.startDate ?? suggestion.suggestedStartDate;
    const endDate = overrides.endDate ?? suggestion.suggestedEndDate;
    if (!startDate || !endDate) {
      throw new BusinessError('MISSING_DATES', 'This suggestion has no proposed dates to approve');
    }

    const [season] = await db
      .insert(businessSeasons)
      .values({
        tenantId,
        name: overrides.name,
        seasonType: suggestion.seasonType,
        startDate,
        endDate,
        stockMultiplier: String(
          overrides.stockMultiplier ?? suggestion.suggestedStockMultiplier ?? '1'
        ),
        loyaltyMultiplier: String(
          overrides.loyaltyMultiplier ?? suggestion.suggestedLoyaltyMultiplier ?? '1'
        ),
        createdBy: userId,
      })
      .returning();
    if (!season) throw new Error('Season creation from suggestion failed unexpectedly');

    const [updated] = await db
      .update(crmFestivalSuggestions)
      .set({
        status: 'APPROVED',
        reviewedBy: userId,
        reviewedAt: new Date(),
        createdSeasonId: season.id,
      })
      .where(eq(crmFestivalSuggestions.id, suggestionId))
      .returning();
    if (!updated) throw new Error('Suggestion update failed unexpectedly');

    return { suggestion: updated, seasonId: season.id };
  }

  static async reject(
    db: ErpDatabase,
    tenantId: number,
    userId: number,
    suggestionId: number
  ): Promise<CrmFestivalSuggestion> {
    const [suggestion] = await db
      .select()
      .from(crmFestivalSuggestions)
      .where(
        and(
          eq(crmFestivalSuggestions.id, suggestionId),
          eq(crmFestivalSuggestions.tenantId, tenantId)
        )
      );
    if (!suggestion) throw new NotFoundError('Festival suggestion', suggestionId);
    if (suggestion.status !== 'PENDING') {
      throw new BusinessError(
        'SUGGESTION_NOT_PENDING',
        'Only a PENDING suggestion can be rejected'
      );
    }

    const [updated] = await db
      .update(crmFestivalSuggestions)
      .set({ status: 'REJECTED', reviewedBy: userId, reviewedAt: new Date() })
      .where(eq(crmFestivalSuggestions.id, suggestionId))
      .returning();
    if (!updated) throw new Error('Suggestion update failed unexpectedly');
    return updated;
  }
}
