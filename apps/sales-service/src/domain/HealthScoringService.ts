import { and, eq, isNull, sql } from 'drizzle-orm';
import {
  customers,
  items,
  crmChurnPredictions,
  crmNextBestActions,
  crmProductRecommendations,
} from '@erp/db';
import type { ErpDatabase } from '@erp/db';

export type HealthSegment = 'CHAMPION' | 'LOYAL' | 'AT_RISK' | 'LOST';

export interface HealthScoreBreakdown {
  customerId: number;
  purchaseFrequencyScore: number;
  avgOrderValueScore: number;
  paymentTimelinessScore: number;
  returnRateScore: number;
  loyaltyEngagementScore: number;
  totalScore: number;
  segment: HealthSegment;
}

function segmentFor(score: number): HealthSegment {
  if (score >= 80) return 'CHAMPION';
  if (score >= 60) return 'LOYAL';
  if (score >= 40) return 'AT_RISK';
  return 'LOST';
}

// CRM-ROADMAP Phase 3, Feature 1 (AI & Predictive Intelligence Suite).
export type ChurnRiskLevel = 'LOW' | 'MEDIUM' | 'HIGH' | 'INSUFFICIENT_DATA';

export interface ChurnPrediction {
  customerId: number;
  riskLevel: ChurnRiskLevel;
  // Null exactly when riskLevel is INSUFFICIENT_DATA — a number next to "not enough data yet"
  // would misleadingly imply a confidence the model doesn't have (a stated roadmap edge case).
  riskScore: number | null;
  reason: string;
}

export interface NextBestAction {
  actionType: string;
  actionText: string;
  reason: string;
}

export interface ProductRecommendation {
  itemId: number;
  reason: string;
  rank: number;
}

const MIN_PURCHASES_FOR_CHURN_PREDICTION = 2;

/**
 * Weekly batch job (M9.2): scores every active customer 0–100 across 5 weighted factors,
 * then classifies into CHAMPION/LOYAL/AT_RISK/LOST. Run per-tenant via the scheduler.
 */
export class HealthScoringService {
  static async computeForTenant(
    db: ErpDatabase,
    tenantId: number
  ): Promise<HealthScoreBreakdown[]> {
    const activeCustomers = await db
      .select({ id: customers.id })
      .from(customers)
      .where(
        and(
          eq(customers.tenantId, tenantId),
          isNull(customers.deletedAt),
          eq(customers.status, 'ACTIVE')
        )
      );

    const results: HealthScoreBreakdown[] = [];

    for (const customer of activeCustomers) {
      const breakdown = await HealthScoringService.scoreCustomer(db, tenantId, customer.id);
      results.push(breakdown);

      await db
        .update(customers)
        .set({
          healthScore: breakdown.totalScore,
          healthSegment: breakdown.segment,
          scoredAt: new Date(),
        })
        .where(and(eq(customers.id, customer.id), eq(customers.tenantId, tenantId)));
    }

    return results;
  }

  static async scoreCustomer(
    db: ErpDatabase,
    tenantId: number,
    customerId: number
  ): Promise<HealthScoreBreakdown> {
    const [purchaseFreq] = (await db.execute(sql`
      SELECT COUNT(*)::int AS count FROM invoices
      WHERE customer_id = ${customerId} AND tenant_id = ${tenantId}
        AND status NOT IN ('DRAFT', 'CANCELLED') AND invoice_date >= NOW() - INTERVAL '90 days'
    `)) as Array<{ count: number }>;
    const purchaseFrequencyScore = Math.min(30, (purchaseFreq?.count ?? 0) * 5);

    const [aov] = (await db.execute(sql`
      SELECT AVG(grand_total) AS avg FROM invoices
      WHERE customer_id = ${customerId} AND tenant_id = ${tenantId}
        AND status NOT IN ('DRAFT', 'CANCELLED') AND invoice_date >= NOW() - INTERVAL '365 days'
    `)) as Array<{ avg: string | null }>;
    const avgOrderValue = parseFloat(aov?.avg ?? '0');
    const avgOrderValueScore = Math.min(20, Math.max(0, (avgOrderValue / 5000) * 20));

    const [timeliness] = (await db.execute(sql`
      SELECT AVG(EXTRACT(EPOCH FROM (p.payment_date - i.invoice_date)) / 86400) AS avg_days
      FROM payment_allocations pa
      JOIN payments p ON p.id = pa.payment_id
      JOIN invoices i ON i.id = pa.invoice_id
      WHERE i.customer_id = ${customerId} AND i.tenant_id = ${tenantId}
    `)) as Array<{ avg_days: string | null }>;
    const avgDaysToPay =
      timeliness?.avg_days === null || timeliness?.avg_days === undefined
        ? null
        : parseFloat(timeliness.avg_days);
    let paymentTimelinessScore: number;
    if (avgDaysToPay === null) {
      paymentTimelinessScore = 10; // no payment history yet — neutral mid-score
    } else if (avgDaysToPay <= 7) {
      paymentTimelinessScore = 20;
    } else if (avgDaysToPay >= 60) {
      paymentTimelinessScore = 0;
    } else {
      paymentTimelinessScore = 20 - ((avgDaysToPay - 7) / (60 - 7)) * 20;
    }

    const [invoiceCountRow] = (await db.execute(sql`
      SELECT COUNT(*)::int AS count FROM invoices
      WHERE customer_id = ${customerId} AND tenant_id = ${tenantId} AND status NOT IN ('DRAFT', 'CANCELLED')
    `)) as Array<{ count: number }>;
    const [returnCountRow] = (await db.execute(sql`
      SELECT COUNT(*)::int AS count FROM sale_returns
      WHERE customer_id = ${customerId} AND tenant_id = ${tenantId} AND status = 'APPROVED'
    `)) as Array<{ count: number }>;
    const totalInvoices = invoiceCountRow?.count ?? 0;
    const totalReturns = returnCountRow?.count ?? 0;
    const returnRate = totalInvoices > 0 ? totalReturns / totalInvoices : 0;
    const returnRateScore = Math.max(0, 15 * (1 - returnRate));

    const [loyaltyRow] = (await db.execute(sql`
      SELECT COUNT(*)::int AS count FROM loyalty_transactions
      WHERE customer_id = ${customerId} AND tenant_id = ${tenantId} AND type = 'EARN' AND created_at >= NOW() - INTERVAL '90 days'
    `)) as Array<{ count: number }>;
    const loyaltyEngagementScore = (loyaltyRow?.count ?? 0) > 0 ? 15 : 0;

    const totalScore = Math.round(
      purchaseFrequencyScore +
        avgOrderValueScore +
        paymentTimelinessScore +
        returnRateScore +
        loyaltyEngagementScore
    );

    return {
      customerId,
      purchaseFrequencyScore,
      avgOrderValueScore: Math.round(avgOrderValueScore),
      paymentTimelinessScore: Math.round(paymentTimelinessScore),
      returnRateScore: Math.round(returnRateScore),
      loyaltyEngagementScore,
      totalScore: Math.min(100, Math.max(0, totalScore)),
      segment: segmentFor(Math.min(100, Math.max(0, totalScore))),
    };
  }

  static async segmentCounts(
    db: ErpDatabase,
    tenantId: number
  ): Promise<{ champion: number; loyal: number; atRisk: number; lost: number; unscored: number }> {
    const rows = await db
      .select({ healthSegment: customers.healthSegment, count: sql<number>`count(*)::int` })
      .from(customers)
      .where(and(eq(customers.tenantId, tenantId), isNull(customers.deletedAt)))
      .groupBy(customers.healthSegment);

    const counts = { champion: 0, loyal: 0, atRisk: 0, lost: 0, unscored: 0 };
    for (const row of rows) {
      switch (row.healthSegment) {
        case 'CHAMPION':
          counts.champion = row.count;
          break;
        case 'LOYAL':
          counts.loyal = row.count;
          break;
        case 'AT_RISK':
          counts.atRisk = row.count;
          break;
        case 'LOST':
          counts.lost = row.count;
          break;
        default:
          counts.unscored += row.count;
      }
    }
    return counts;
  }

  // CRM-ROADMAP Phase 3, Feature 1 — recency-decay churn model. Statistical, not a black-box
  // model, per the roadmap's own instruction ("this is where a statistical model is easier to
  // test than a black-box one — exploit that"): compares how long it's been since the
  // customer's last purchase against their OWN historical average interval between purchases.
  // A customer with fewer than 2 purchases has no interval to compute at all — INSUFFICIENT_DATA,
  // never a confident-looking score off two data points (a stated edge case, not a nicety).
  static async predictChurn(
    db: ErpDatabase,
    tenantId: number,
    customerId: number
  ): Promise<ChurnPrediction> {
    const rows = (await db.execute(sql`
      SELECT invoice_date FROM invoices
      WHERE customer_id = ${customerId} AND tenant_id = ${tenantId}
        AND status NOT IN ('DRAFT', 'CANCELLED')
      ORDER BY invoice_date ASC
    `)) as Array<{ invoice_date: string | Date }>;

    if (rows.length < MIN_PURCHASES_FOR_CHURN_PREDICTION) {
      return {
        customerId,
        riskLevel: 'INSUFFICIENT_DATA',
        riskScore: null,
        reason: `Only ${rows.length} purchase${rows.length === 1 ? '' : 's'} on record — not enough history yet to predict churn risk.`,
      };
    }

    const dates = rows.map((r) => new Date(r.invoice_date).getTime());
    let totalIntervalMs = 0;
    for (let i = 1; i < dates.length; i++) {
      totalIntervalMs += dates[i]! - dates[i - 1]!;
    }
    const avgIntervalDays = Math.max(1, totalIntervalMs / (dates.length - 1) / 86_400_000);
    const daysSinceLastPurchase = Math.max(0, (Date.now() - dates[dates.length - 1]!) / 86_400_000);
    const ratio = daysSinceLastPurchase / avgIntervalDays;
    const riskScore = Math.min(100, Math.max(0, Math.round(ratio * 50)));
    const riskLevel: ChurnRiskLevel = riskScore >= 70 ? 'HIGH' : riskScore >= 40 ? 'MEDIUM' : 'LOW';

    const roundedDays = Math.round(daysSinceLastPurchase);
    const roundedInterval = Math.round(avgIntervalDays);
    const reason =
      riskLevel === 'LOW'
        ? `Last purchase was ${roundedDays} days ago, in line with a typical ${roundedInterval}-day interval between purchases.`
        : `Last purchase was ${roundedDays} days ago vs a typical ${roundedInterval}-day interval between purchases — ${riskLevel === 'HIGH' ? 'significantly' : 'somewhat'} overdue.`;

    return { customerId, riskLevel, riskScore, reason };
  }

  // Simple rule cascade, not a black-box classifier — each branch has one explicit, testable
  // trigger and ships its own reason string. Returns null when nothing applies (no forced
  // generic filler action) — the DoD requires every SURFACED prediction to have a real
  // explanation, not that one always exists.
  static computeNextBestAction(
    churn: ChurnPrediction,
    health: Pick<HealthScoreBreakdown, 'segment'>
  ): NextBestAction | null {
    if (churn.riskLevel === 'HIGH') {
      return {
        actionType: 'WIN_BACK_OFFER',
        actionText: 'Send a win-back offer before this customer churns',
        reason: churn.reason,
      };
    }
    if (health.segment === 'CHAMPION') {
      return {
        actionType: 'LOYALTY_UPSELL',
        actionText: 'Offer an exclusive loyalty perk or early access',
        reason: 'Customer is in the CHAMPION segment — a top spender worth rewarding.',
      };
    }
    if (churn.riskLevel === 'MEDIUM') {
      return {
        actionType: 'RE_ENGAGEMENT',
        actionText: 'Send a re-engagement message',
        reason: churn.reason,
      };
    }
    return null;
  }

  // Market-basket / co-occurrence recommendation: items frequently bought by OTHER customers
  // who share at least one item with this customer's own purchase history, excluding items this
  // customer already has. A customer with zero purchase history gets zero recommendations —
  // empty, not an error, and never a fabricated guess.
  static async computeProductRecommendations(
    db: ErpDatabase,
    tenantId: number,
    customerId: number,
    limit = 5
  ): Promise<ProductRecommendation[]> {
    const rows = (await db.execute(sql`
      WITH my_items AS (
        SELECT DISTINCT il.item_id FROM invoice_lines il
        JOIN invoices i ON i.id = il.invoice_id
        WHERE i.customer_id = ${customerId} AND i.tenant_id = ${tenantId}
          AND i.status NOT IN ('DRAFT', 'CANCELLED')
      ),
      co_customers AS (
        SELECT DISTINCT i.customer_id FROM invoices i
        JOIN invoice_lines il ON il.invoice_id = i.id
        WHERE il.item_id IN (SELECT item_id FROM my_items)
          AND i.tenant_id = ${tenantId} AND i.customer_id != ${customerId}
          AND i.status NOT IN ('DRAFT', 'CANCELLED')
      )
      SELECT il.item_id, COUNT(DISTINCT i.customer_id)::int AS co_count
      FROM invoices i
      JOIN invoice_lines il ON il.invoice_id = i.id
      WHERE i.customer_id IN (SELECT customer_id FROM co_customers)
        AND i.tenant_id = ${tenantId}
        AND il.item_id NOT IN (SELECT item_id FROM my_items)
        AND i.status NOT IN ('DRAFT', 'CANCELLED')
      GROUP BY il.item_id
      ORDER BY co_count DESC, il.item_id ASC
      LIMIT ${limit}
    `)) as Array<{ item_id: number; co_count: number }>;

    return rows.map((r, i) => ({
      itemId: r.item_id,
      rank: i + 1,
      reason: `Frequently purchased alongside items you've already bought, by ${r.co_count} other customer${r.co_count === 1 ? '' : 's'}.`,
    }));
  }

  /**
   * Nightly batch (never synchronous — 07-PERFORMANCE-PLAN.md §3): churn + next-best-action +
   * product recommendations for every active customer in a tenant, upserted with a dismiss-aware
   * merge — a caller's earlier POST /recommendations/:id/feedback dismissal isn't silently
   * undone by the next run for the identical suggestion (same trigger/actionType, or same
   * itemId), matching the roadmap's own stated Playwright scenario.
   */
  static async computeAndCachePredictions(
    db: ErpDatabase,
    tenantId: number
  ): Promise<{ customersProcessed: number }> {
    const activeCustomers = await db
      .select({ id: customers.id })
      .from(customers)
      .where(
        and(
          eq(customers.tenantId, tenantId),
          isNull(customers.deletedAt),
          eq(customers.status, 'ACTIVE')
        )
      );

    for (const customer of activeCustomers) {
      const health = await HealthScoringService.scoreCustomer(db, tenantId, customer.id);
      const churn = await HealthScoringService.predictChurn(db, tenantId, customer.id);

      await db
        .insert(crmChurnPredictions)
        .values({
          tenantId,
          customerId: customer.id,
          riskLevel: churn.riskLevel,
          riskScore: churn.riskScore,
          reason: churn.reason,
        })
        .onConflictDoUpdate({
          target: [crmChurnPredictions.tenantId, crmChurnPredictions.customerId],
          set: {
            riskLevel: churn.riskLevel,
            riskScore: churn.riskScore,
            reason: churn.reason,
            computedAt: new Date(),
          },
        });

      const nextAction = HealthScoringService.computeNextBestAction(churn, health);
      const [existingAction] = await db
        .select()
        .from(crmNextBestActions)
        .where(
          and(
            eq(crmNextBestActions.tenantId, tenantId),
            eq(crmNextBestActions.customerId, customer.id)
          )
        );

      if (!nextAction) {
        if (existingAction) {
          await db.delete(crmNextBestActions).where(eq(crmNextBestActions.id, existingAction.id));
        }
      } else if (existingAction?.dismissed && existingAction.actionType === nextAction.actionType) {
        // Same suggestion the caller already dismissed — leave it dismissed, don't resurface it.
      } else {
        await db
          .insert(crmNextBestActions)
          .values({
            tenantId,
            customerId: customer.id,
            actionType: nextAction.actionType,
            actionText: nextAction.actionText,
            reason: nextAction.reason,
            dismissed: false,
            dismissedAt: null,
          })
          .onConflictDoUpdate({
            target: [crmNextBestActions.tenantId, crmNextBestActions.customerId],
            set: {
              actionType: nextAction.actionType,
              actionText: nextAction.actionText,
              reason: nextAction.reason,
              dismissed: false,
              dismissedAt: null,
              computedAt: new Date(),
            },
          });
      }

      const recommendations = await HealthScoringService.computeProductRecommendations(
        db,
        tenantId,
        customer.id
      );
      const dismissedRows = await db
        .select({ itemId: crmProductRecommendations.itemId })
        .from(crmProductRecommendations)
        .where(
          and(
            eq(crmProductRecommendations.tenantId, tenantId),
            eq(crmProductRecommendations.customerId, customer.id),
            eq(crmProductRecommendations.dismissed, true)
          )
        );
      const dismissedItemIds = new Set(dismissedRows.map((r) => r.itemId));

      await db
        .delete(crmProductRecommendations)
        .where(
          and(
            eq(crmProductRecommendations.tenantId, tenantId),
            eq(crmProductRecommendations.customerId, customer.id),
            eq(crmProductRecommendations.dismissed, false)
          )
        );
      const toInsert = recommendations.filter((r) => !dismissedItemIds.has(r.itemId));
      if (toInsert.length > 0) {
        await db.insert(crmProductRecommendations).values(
          toInsert.map((r) => ({
            tenantId,
            customerId: customer.id,
            itemId: r.itemId,
            reason: r.reason,
            rank: r.rank,
            dismissed: false,
          }))
        );
      }
    }

    return { customersProcessed: activeCustomers.length };
  }

  /** GET /customers/:id/360's read of the 3 cached prediction types for one customer. */
  static async getPredictionsForCustomer(
    db: ErpDatabase,
    tenantId: number,
    customerId: number
  ): Promise<{
    churn: typeof crmChurnPredictions.$inferSelect | null;
    nextBestAction: typeof crmNextBestActions.$inferSelect | null;
    productRecommendations: Array<
      typeof crmProductRecommendations.$inferSelect & { itemName: string }
    >;
  }> {
    const [churn] = await db
      .select()
      .from(crmChurnPredictions)
      .where(
        and(
          eq(crmChurnPredictions.tenantId, tenantId),
          eq(crmChurnPredictions.customerId, customerId)
        )
      );

    const [nextBestAction] = await db
      .select()
      .from(crmNextBestActions)
      .where(
        and(
          eq(crmNextBestActions.tenantId, tenantId),
          eq(crmNextBestActions.customerId, customerId),
          eq(crmNextBestActions.dismissed, false)
        )
      );

    const productRecommendations = await db
      .select({
        id: crmProductRecommendations.id,
        tenantId: crmProductRecommendations.tenantId,
        customerId: crmProductRecommendations.customerId,
        itemId: crmProductRecommendations.itemId,
        reason: crmProductRecommendations.reason,
        rank: crmProductRecommendations.rank,
        dismissed: crmProductRecommendations.dismissed,
        dismissedAt: crmProductRecommendations.dismissedAt,
        computedAt: crmProductRecommendations.computedAt,
        itemName: items.name,
      })
      .from(crmProductRecommendations)
      .innerJoin(items, eq(items.id, crmProductRecommendations.itemId))
      .where(
        and(
          eq(crmProductRecommendations.tenantId, tenantId),
          eq(crmProductRecommendations.customerId, customerId),
          eq(crmProductRecommendations.dismissed, false)
        )
      )
      .orderBy(crmProductRecommendations.rank);

    return { churn: churn ?? null, nextBestAction: nextBestAction ?? null, productRecommendations };
  }

  /** POST /recommendations/:id/feedback — dismiss or (re-)accept one recommendation. */
  static async recordFeedback(
    db: ErpDatabase,
    tenantId: number,
    recommendationType: 'NEXT_BEST_ACTION' | 'PRODUCT_RECOMMENDATION',
    id: number,
    action: 'DISMISS' | 'ACCEPT'
  ): Promise<boolean> {
    const dismissed = action === 'DISMISS';
    const dismissedAt = dismissed ? new Date() : null;
    const table =
      recommendationType === 'NEXT_BEST_ACTION' ? crmNextBestActions : crmProductRecommendations;
    const [updated] = await db
      .update(table)
      .set({ dismissed, dismissedAt })
      .where(and(eq(table.id, id), eq(table.tenantId, tenantId)))
      .returning({ id: table.id });
    return !!updated;
  }
}
