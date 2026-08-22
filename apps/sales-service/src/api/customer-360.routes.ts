import type { FastifyInstance } from 'fastify';
import type { PlatformContextFactory } from '@erp/sdk';
import { createCircuitBreaker, withTenantConnection } from '@erp/sdk';
import {
  customers,
  crmAccounts,
  type CrmChurnPrediction,
  type CrmNextBestAction,
  type CrmProductRecommendation,
} from '@erp/db';
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

// CRM/O2C split — getPredictionsForCustomer and recordFeedback moved to crm-service
// (domain/HealthScoringService.ts's header comment explains why); this composition endpoint
// reaches them over HTTP now, same x-internal-key + circuit-breaker pattern already used by
// internal.routes.ts's sendRawNotification for sales-service -> notification-service calls.
// A failed/circuit-open call rejects, which the existing Promise.allSettled/settle() below
// already treats as a degraded section — no new error-handling shape needed.
interface HealthPredictions {
  churn: CrmChurnPrediction | null;
  nextBestAction: CrmNextBestAction | null;
  productRecommendations: Array<CrmProductRecommendation & { itemName: string }>;
}

async function fetchHealthPredictions(
  crmServiceUrl: string,
  internalKey: string,
  tenantId: number,
  customerId: number
): Promise<HealthPredictions> {
  const res = await fetch(
    `${crmServiceUrl}/api/v2/internal/customers/${customerId}/health-predictions?tenantId=${tenantId}`,
    { headers: { 'x-internal-key': internalKey } }
  );
  if (!res.ok) throw new Error(`crm-service health-predictions call failed: ${res.status}`);
  const json = (await res.json()) as { data: HealthPredictions };
  return json.data;
}
const healthPredictionsBreaker = createCircuitBreaker(fetchHealthPredictions, 'crm-service');

async function postRecommendationFeedback(
  crmServiceUrl: string,
  internalKey: string,
  tenantId: number,
  id: number,
  recommendationType: 'NEXT_BEST_ACTION' | 'PRODUCT_RECOMMENDATION',
  action: 'DISMISS' | 'ACCEPT'
): Promise<{ updated: boolean }> {
  const res = await fetch(`${crmServiceUrl}/api/v2/internal/recommendations/${id}/feedback`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-internal-key': internalKey },
    body: JSON.stringify({ tenantId, recommendationType, action }),
  });
  if (!res.ok) throw new Error(`crm-service recommendation-feedback call failed: ${res.status}`);
  const json = (await res.json()) as { data: { updated: boolean } };
  return json.data;
}
const recommendationFeedbackBreaker = createCircuitBreaker(
  postRecommendationFeedback,
  'crm-service'
);

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

// Phase 9 GUC-per-request rollout — migrated 2026-08-22 (RLS-readiness follow-up).
// GET /customers/:id/360 was originally left unmigrated because it runs a real fetch() to
// crm-service (healthPredictionsBreaker.fire()) concurrently with its own DB reads inside one
// Promise.allSettled — a real audit found this to be an everyday production call site, not a
// niche batch job, so it needed fixing before RLS could go live on the tables it touches.
// Restructured into two withTenantConnection wraps around the fetch (not wrapping the whole
// handler, which would hold a transaction open for the crm-service round trip — checklist
// caveat 4): a small existence-check wrap first (preserves the original "404 before ever
// firing the crm-service call" behavior), then the predictions fetch and the main DB batch are
// started together and awaited together, preserving the original wall-clock parallelism
// (07-PERFORMANCE-PLAN.md §1) even though the DB batch now runs inside its own wrap.
// POST /recommendations/:id/feedback remains deliberately NOT migrated — pure external I/O
// with no DB work of its own, nothing to scope.
export async function customer360Routes(
  fastify: FastifyInstance,
  ctxFactory: PlatformContextFactory
): Promise<void> {
  fastify.get<{ Params: { id: string } }>(
    '/customers/:id/360',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.CRM_360_VIEW)] },
    async (request, reply) => {
      const { tenantId, userId } = (request as unknown as AuthedRequest).auth;
      const correlationId = (request.headers['x-correlation-id'] as string) ?? crypto.randomUUID();
      const id = parseInt(request.params.id, 10);
      const crmServiceUrl = process.env['CRM_SERVICE_URL'] ?? 'http://localhost:3026';
      const internalKey = process.env['INTERNAL_API_KEY'] ?? '';

      const customer = await withTenantConnection(ctxFactory.rawDb, tenantId, async (scopedDb) => {
        const [row] = await scopedDb
          .select()
          .from(customers)
          .where(
            and(eq(customers.id, id), eq(customers.tenantId, tenantId), isNull(customers.deletedAt))
          );
        if (!row) throw new NotFoundError('Customer', id);
        return row;
      });

      // Mandatory parallel fetch (07-PERFORMANCE-PLAN.md §1) — started alongside the DB batch
      // below rather than serialized after it, so wrapping the DB work doesn't add latency.
      // CRM-ROADMAP Phase 3, Feature 1 — reads whatever the last nightly batch cached; never
      // computed on-demand here (07-PERFORMANCE-PLAN.md §3). Now a crm-service call (CRM/O2C
      // split) — a circuit-open/failed call rejects here and degrades this section below, same
      // as any other allSettled slot.
      const predictionsPromise = healthPredictionsBreaker.fire(
        crmServiceUrl,
        internalKey,
        tenantId,
        id
      );

      const [healthResult, timelineResult, financialResult, stockResult, accountResult] =
        await withTenantConnection(ctxFactory.rawDb, tenantId, async (scopedDb) => {
          const ctx = ctxFactory.create({ tenantId, userId, correlationId }, scopedDb);
          // Promise.allSettled, not Promise.all, so one slow/failed sub-service degrades its
          // own section instead of 500ing the whole page.
          return Promise.allSettled([
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
          ]);
        });

      const [predictionsResult] = await Promise.allSettled([predictionsPromise]);

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
      const { tenantId } = (request as unknown as AuthedRequest).auth;
      const id = parseInt(request.params.id, 10);
      const body = FeedbackSchema.safeParse(request.body);
      if (!body.success)
        throw new ValidationError(body.error.errors.map((e) => e.message).join('; '));

      const crmServiceUrl = process.env['CRM_SERVICE_URL'] ?? 'http://localhost:3026';
      const internalKey = process.env['INTERNAL_API_KEY'] ?? '';
      const { updated } = await recommendationFeedbackBreaker.fire(
        crmServiceUrl,
        internalKey,
        tenantId,
        id,
        body.data.recommendationType,
        body.data.action
      );
      if (!updated) throw new NotFoundError('Recommendation', id);

      return reply.code(200).send({ data: { message: 'Feedback recorded' } });
    }
  );
}
