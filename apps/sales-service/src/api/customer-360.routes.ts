import type { FastifyInstance } from 'fastify';
import type { PlatformContextFactory } from '@erp/sdk';
import { customers, crmAccounts } from '@erp/db';
import { and, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { NotFoundError, ValidationError, PERMISSIONS } from '@erp/types';
import { authenticate } from '../middleware/authenticate.js';
import { requirePermission } from '../middleware/authorize.js';
import { HealthScoringService, type HealthScoreBreakdown } from '../domain/HealthScoringService.js';
import { ActivityTimelineService, type ActivityItem } from '../domain/ActivityTimelineService.js';
import {
  CustomerFinancialSnapshotService,
  type FinancialSnapshot,
  type RecentItemStock,
} from '../domain/CustomerFinancialSnapshotService.js';

// CRM-ROADMAP Phase 1, Feature 3 — Customer 360 Command Center. Thin composition layer only:
// no new source of truth, no new writes. Composes HealthScoringService + ActivityTimelineService
// (both already exist server-side with no frontend, per 00-CODEBASE-AUDIT.md §3) plus
// CustomerFinancialSnapshotService (Feature 5 — ERP-Native Integration Layer) for the AR/credit
// and live-stock-relevance sections, per AR-2: that's the one shared module, not duplicated
// composition logic living inline in this route.

type AuthedRequest = { auth: { tenantId: number; userId: number } };

async function settle<T>(
  result: PromiseSettledResult<T>,
  label: string,
  fallback: T,
  degraded: string[]
): Promise<T> {
  if (result.status === 'fulfilled') return result.value;
  degraded.push(label);
  return fallback;
}

export async function customer360Routes(
  fastify: FastifyInstance,
  ctxFactory: PlatformContextFactory
): Promise<void> {
  fastify.get<{ Params: { id: string } }>(
    '/customers/:id/360',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.CRM_360_VIEW)] },
    async (request, reply) => {
      const { tenantId, userId } = (request as unknown as AuthedRequest).auth;
      const ctx = ctxFactory.create({
        tenantId,
        userId,
        correlationId: (request.headers['x-correlation-id'] as string) ?? crypto.randomUUID(),
      });
      const id = parseInt(request.params.id, 10);

      const [customer] = await ctx.db.raw
        .select()
        .from(customers)
        .where(
          and(eq(customers.id, id), eq(customers.tenantId, tenantId), isNull(customers.deletedAt))
        );
      if (!customer) throw new NotFoundError('Customer', id);

      // Mandatory parallel fetch (07-PERFORMANCE-PLAN.md §1) — Promise.allSettled, not
      // Promise.all, so one slow/failed sub-service degrades its own section instead of
      // 500ing the whole page.
      const [
        healthResult,
        timelineResult,
        financialResult,
        stockResult,
        accountResult,
        predictionsResult,
      ] = await Promise.allSettled([
        HealthScoringService.scoreCustomer(ctx.db.raw, tenantId, id),
        ActivityTimelineService.build(ctx.db.raw, tenantId, id, 0, 20),
        CustomerFinancialSnapshotService.getFinancial(ctx.db.raw, tenantId, id, customer),
        CustomerFinancialSnapshotService.getRecentItemsStock(ctx.db.raw, tenantId, id),
        customer.accountId
          ? ctx.db.raw
              .select()
              .from(crmAccounts)
              .where(
                and(eq(crmAccounts.id, customer.accountId), eq(crmAccounts.tenantId, tenantId))
              )
          : Promise.resolve([]),
        // CRM-ROADMAP Phase 3, Feature 1 — reads whatever the last nightly batch cached; never
        // computed on-demand here (07-PERFORMANCE-PLAN.md §3).
        HealthScoringService.getPredictionsForCustomer(ctx.db.raw, tenantId, id),
      ]);

      const degraded: string[] = [];
      const health = await settle<HealthScoreBreakdown | null>(
        healthResult,
        'health',
        null,
        degraded
      );
      const timeline = await settle<{ items: ActivityItem[]; total: number }>(
        timelineResult,
        'timeline',
        { items: [], total: 0 },
        degraded
      );
      const financial = await settle<FinancialSnapshot | null>(
        financialResult,
        'financial',
        null,
        degraded
      );
      const recentItemsStock = await settle<RecentItemStock[]>(stockResult, 'stock', [], degraded);
      const [account] = await settle(accountResult, 'account', [], degraded);
      const predictions = await settle(
        predictionsResult,
        'predictions',
        { churn: null, nextBestAction: null, productRecommendations: [] },
        degraded
      );

      return reply.code(200).send({
        data: {
          customerId: id,
          health,
          timeline: timeline.items,
          timelineTotal: timeline.total,
          financial,
          recentItemsStock,
          loyalty: {
            points: customer.loyaltyPoints,
            cardNumber: customer.loyaltyCardNumber,
          },
          account: account
            ? { id: account.id, name: account.name, accountType: account.accountType }
            : null,
          churn: predictions.churn,
          nextBestAction: predictions.nextBestAction,
          productRecommendations: predictions.productRecommendations,
          degraded,
        },
      });
    }
  );

  // CRM-ROADMAP Phase 3, Feature 1 — dismiss/accept feedback on a cached prediction. No new
  // attack surface: gated on the same CRM_360_VIEW permission as viewing the customer whose
  // recommendation this is (if you can see it, you can act on it) — the roadmap's own explicit
  // "no new attack surface" instruction for this feature.
  const FeedbackSchema = z.object({
    recommendationType: z.enum(['NEXT_BEST_ACTION', 'PRODUCT_RECOMMENDATION']),
    action: z.enum(['DISMISS', 'ACCEPT']),
  });
  fastify.post<{ Params: { id: string } }>(
    '/recommendations/:id/feedback',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.CRM_360_VIEW)] },
    async (request, reply) => {
      const { tenantId, userId } = (request as unknown as AuthedRequest).auth;
      const ctx = ctxFactory.create({
        tenantId,
        userId,
        correlationId: (request.headers['x-correlation-id'] as string) ?? crypto.randomUUID(),
      });
      const id = parseInt(request.params.id, 10);
      const body = FeedbackSchema.safeParse(request.body);
      if (!body.success)
        throw new ValidationError(body.error.errors.map((e) => e.message).join('; '));

      const updated = await HealthScoringService.recordFeedback(
        ctx.db.raw,
        tenantId,
        body.data.recommendationType,
        id,
        body.data.action
      );
      if (!updated) throw new NotFoundError('Recommendation', id);

      return reply.code(200).send({ data: { message: 'Feedback recorded' } });
    }
  );
}
