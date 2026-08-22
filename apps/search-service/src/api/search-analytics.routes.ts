import type { FastifyInstance } from 'fastify';
import type { ErpDatabase } from '@erp/db';
import { withTenantConnection } from '@erp/sdk';
import { searchAnalytics } from '@erp/db';
import { and, desc, eq, gte, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import { PERMISSIONS, ValidationError } from '@erp/types';
import { authenticate } from '../middleware/authenticate.js';

type AuthedRequest = { auth: { tenantId: number; userId?: number; permissions: string[] } };

function hasPermission(request: unknown, perm: string): boolean {
  return ((request as AuthedRequest).auth?.permissions ?? []).includes(perm);
}

const ClickSchema = z.object({
  query: z.string().min(1).max(200),
  resultId: z.string().min(1).max(100),
  resultEntity: z.string().min(1).max(50),
});

const SuggestQuerySchema = z.object({ q: z.string().min(1).max(200) });

// Analytics: every authenticated searcher can record their own click (no admin permission
// needed — SEARCH_GLOBAL is already required to have run the search in the first place).
// Summary/dashboard view is admin-only (SEARCH_REINDEX), matching the other /admin/search/*
// routes in search.routes.ts.
//
// Phase 9 GUC-per-request rollout — migrated 2026-08-21. No PlatformContextFactory in this
// service, so each route uses withTenantConnection directly. No external I/O in any route here.
export async function searchAnalyticsRoutes(
  fastify: FastifyInstance,
  db: ErpDatabase
): Promise<void> {
  fastify.post(
    '/search/analytics/click',
    { preHandler: [authenticate] },
    async (request, reply) => {
      if (!hasPermission(request, PERMISSIONS.SEARCH_GLOBAL)) {
        return reply.code(403).send({
          error: { code: 'PERMISSION_DENIED', message: 'Missing permission: SEARCH_GLOBAL' },
        });
      }
      const { tenantId, userId } = (request as unknown as AuthedRequest).auth;
      const body = ClickSchema.safeParse(request.body);
      if (!body.success)
        throw new ValidationError(body.error.errors.map((e) => e.message).join('; '));

      // Best-effort: attach this click to the caller's most recent matching, not-yet-clicked
      // search event (within the last 5 minutes) rather than requiring the frontend to thread
      // an analytics row id through the whole search->click flow.
      const recorded = await withTenantConnection(db, tenantId, async (scopedDb) => {
        const [recent] = await scopedDb
          .select({ id: searchAnalytics.id })
          .from(searchAnalytics)
          .where(
            and(
              eq(searchAnalytics.tenantId, tenantId),
              eq(searchAnalytics.userId, userId ?? 0),
              eq(searchAnalytics.query, body.data.query),
              isNull(searchAnalytics.clickedResultId),
              gte(searchAnalytics.createdAt, new Date(Date.now() - 5 * 60 * 1000))
            )
          )
          .orderBy(desc(searchAnalytics.createdAt))
          .limit(1);

        if (recent) {
          await scopedDb
            .update(searchAnalytics)
            .set({ clickedResultId: body.data.resultId, clickedEntity: body.data.resultEntity })
            .where(eq(searchAnalytics.id, recent.id));
        }
        return Boolean(recent);
      });

      return reply.code(200).send({ data: { recorded } });
    }
  );

  // Smart Search "did you mean": trigram-compares a query against this tenant's own
  // historical, result-bearing queries (search_analytics.query) — no LLM, just usage data
  // already being collected on every search. Returns null when nothing is similar enough.
  // Same route-level rate-limit override rationale as GET /search (search.routes.ts) — this
  // fires alongside every empty-result search, not just on demand.
  fastify.get(
    '/search/suggest',
    { preHandler: [authenticate], config: { rateLimit: { max: 600, timeWindow: '1 minute' } } },
    async (request, reply) => {
      if (!hasPermission(request, PERMISSIONS.SEARCH_GLOBAL)) {
        return reply.code(403).send({
          error: { code: 'PERMISSION_DENIED', message: 'Missing permission: SEARCH_GLOBAL' },
        });
      }
      const { tenantId } = (request as unknown as AuthedRequest).auth;
      const parsed = SuggestQuerySchema.safeParse(request.query);
      if (!parsed.success)
        throw new ValidationError(parsed.error.errors.map((e) => e.message).join('; '));
      const { q } = parsed.data;

      const rows = await withTenantConnection(db, tenantId, (scopedDb) =>
        scopedDb.execute(sql`
      SELECT query, similarity(query, ${q}) AS sim, count(*)::int AS freq
      FROM search_analytics
      WHERE tenant_id = ${tenantId}
        AND result_count > 0
        AND query <> ${q}
        AND similarity(query, ${q}) > 0.3
      GROUP BY query
      ORDER BY sim DESC, freq DESC
      LIMIT 1
    `)
      );
      const suggestion = (rows as unknown as Array<{ query: string }>)[0]?.query ?? null;
      return reply.code(200).send({ data: { suggestion } });
    }
  );

  fastify.get(
    '/admin/search/analytics/summary',
    { preHandler: [authenticate] },
    async (request, reply) => {
      if (!hasPermission(request, PERMISSIONS.SEARCH_REINDEX)) {
        return reply.code(403).send({
          error: { code: 'PERMISSION_DENIED', message: 'Missing permission: SEARCH_REINDEX' },
        });
      }
      const { tenantId } = (request as unknown as AuthedRequest).auth;
      const days = Math.min(parseInt((request.query as { days?: string }).days ?? '7', 10), 90);
      const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

      const { totals, popularQueries, noResultQueries } = await withTenantConnection(
        db,
        tenantId,
        async (scopedDb) => {
          const [totalsRow] = await scopedDb
            .select({
              totalSearches: sql<number>`count(*)::int`,
              noResultCount: sql<number>`count(*) filter (where ${searchAnalytics.resultCount} = 0)::int`,
              clickedCount: sql<number>`count(*) filter (where ${searchAnalytics.clickedResultId} is not null)::int`,
              avgLatencyMs: sql<number>`coalesce(avg(${searchAnalytics.latencyMs}), 0)::int`,
            })
            .from(searchAnalytics)
            .where(
              and(eq(searchAnalytics.tenantId, tenantId), gte(searchAnalytics.createdAt, since))
            );

          const popular = await scopedDb
            .select({ query: searchAnalytics.query, count: sql<number>`count(*)::int` })
            .from(searchAnalytics)
            .where(
              and(eq(searchAnalytics.tenantId, tenantId), gte(searchAnalytics.createdAt, since))
            )
            .groupBy(searchAnalytics.query)
            .orderBy(desc(sql`count(*)`))
            .limit(10);

          const noResult = await scopedDb
            .select({ query: searchAnalytics.query, count: sql<number>`count(*)::int` })
            .from(searchAnalytics)
            .where(
              and(
                eq(searchAnalytics.tenantId, tenantId),
                gte(searchAnalytics.createdAt, since),
                eq(searchAnalytics.resultCount, 0)
              )
            )
            .groupBy(searchAnalytics.query)
            .orderBy(desc(sql`count(*)`))
            .limit(10);

          return { totals: totalsRow, popularQueries: popular, noResultQueries: noResult };
        }
      );

      return reply.code(200).send({
        data: {
          days,
          totalSearches: totals?.totalSearches ?? 0,
          noResultCount: totals?.noResultCount ?? 0,
          clickedCount: totals?.clickedCount ?? 0,
          avgLatencyMs: totals?.avgLatencyMs ?? 0,
          popularQueries,
          noResultQueries,
        },
      });
    }
  );
}
