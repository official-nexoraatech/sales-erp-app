import { and, eq, isNull, sql } from 'drizzle-orm';
import { customers } from '@erp/db';
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

/**
 * Weekly batch job (M9.2): scores every active customer 0–100 across 5 weighted factors,
 * then classifies into CHAMPION/LOYAL/AT_RISK/LOST. Run per-tenant via the scheduler.
 */
export class HealthScoringService {
  static async computeForTenant(db: ErpDatabase, tenantId: number): Promise<HealthScoreBreakdown[]> {
    const activeCustomers = await db
      .select({ id: customers.id })
      .from(customers)
      .where(and(eq(customers.tenantId, tenantId), isNull(customers.deletedAt), eq(customers.status, 'ACTIVE')));

    const results: HealthScoreBreakdown[] = [];

    for (const customer of activeCustomers) {
      const breakdown = await HealthScoringService.scoreCustomer(db, tenantId, customer.id);
      results.push(breakdown);

      await db
        .update(customers)
        .set({ healthScore: breakdown.totalScore, healthSegment: breakdown.segment, scoredAt: new Date() })
        .where(and(eq(customers.id, customer.id), eq(customers.tenantId, tenantId)));
    }

    return results;
  }

  static async scoreCustomer(db: ErpDatabase, tenantId: number, customerId: number): Promise<HealthScoreBreakdown> {
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
    const avgDaysToPay = timeliness?.avg_days === null || timeliness?.avg_days === undefined ? null : parseFloat(timeliness.avg_days);
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
      purchaseFrequencyScore + avgOrderValueScore + paymentTimelinessScore + returnRateScore + loyaltyEngagementScore
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

  static async segmentCounts(db: ErpDatabase, tenantId: number): Promise<{ champion: number; loyal: number; atRisk: number; lost: number; unscored: number }> {
    const rows = await db
      .select({ healthSegment: customers.healthSegment, count: sql<number>`count(*)::int` })
      .from(customers)
      .where(and(eq(customers.tenantId, tenantId), isNull(customers.deletedAt)))
      .groupBy(customers.healthSegment);

    const counts = { champion: 0, loyal: 0, atRisk: 0, lost: 0, unscored: 0 };
    for (const row of rows) {
      switch (row.healthSegment) {
        case 'CHAMPION': counts.champion = row.count; break;
        case 'LOYAL': counts.loyal = row.count; break;
        case 'AT_RISK': counts.atRisk = row.count; break;
        case 'LOST': counts.lost = row.count; break;
        default: counts.unscored += row.count;
      }
    }
    return counts;
  }
}
