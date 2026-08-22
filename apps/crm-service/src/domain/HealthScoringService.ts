import { and, eq, isNull, sql } from 'drizzle-orm';
import {
  customers,
  items,
  crmChurnPredictions,
  crmNextBestActions,
  crmProductRecommendations,
} from '@erp/db';
import type { ErpDatabase } from '@erp/db';

// CRM/O2C split — this is half of a split class. The other half (computeForTenant,
// scoreCustomer, predictChurn, computeProductRecommendations, computeAndCachePredictions)
// stays at apps/sales-service/src/domain/HealthScoringService.ts because it reads
// invoices/payments/sale_returns/invoice_lines directly via raw SQL — genuinely O2C-coupled.
// That sales-service half writes its results into the same crmChurnPredictions/
// crmNextBestActions/crmProductRecommendations/customers.healthScore tables this half reads,
// via a direct cross-service Postgres write (documented exception, mirrors the shared-table
// read precedent already used for customers/branches in earlier CRM/O2C migrations).
export class HealthScoringService {
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
