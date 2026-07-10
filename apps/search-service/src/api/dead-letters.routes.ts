import type { FastifyInstance } from 'fastify';
import type { ErpDatabase } from '@erp/db';
import { dlqItems } from '@erp/db';
import { and, count, desc, eq, sql } from 'drizzle-orm';
import type { ERPEventPayload } from '@erp/types';
import { PERMISSIONS, NotFoundError, BusinessError } from '@erp/types';
import { authenticate } from '../middleware/authenticate.js';
import type { SearchEngine } from '../domain/SearchEngine.js';
import { syncSearchIndex } from '../consumers/SearchSyncConsumer.js';

type AuthedRequest = { auth: { tenantId: number; permissions: string[] } };

function hasPermission(request: unknown, perm: string): boolean {
  return ((request as AuthedRequest).auth?.permissions ?? []).includes(perm);
}

// dlq_items is shared across the platform (OutboxPublisher writes to it too, for
// cross-service Kafka publish failures) — every query here is scoped to this consumer's own
// marker (see main.ts's eventDispatcher) so this view never shows another service's entries.
const SEARCH_CONSUMER_FILTER = sql`${dlqItems.headers}->>'consumer' = 'search-service'`;

export async function deadLettersRoutes(fastify: FastifyInstance, db: ErpDatabase, engine: SearchEngine): Promise<void> {
  fastify.get('/admin/search/dead-letters', { preHandler: [authenticate] }, async (request, reply) => {
    if (!hasPermission(request, PERMISSIONS.SEARCH_REINDEX)) {
      return reply.code(403).send({ error: { code: 'PERMISSION_DENIED', message: 'Missing permission: SEARCH_REINDEX' } });
    }
    const { tenantId } = (request as unknown as AuthedRequest).auth;
    const q = request.query as { page?: string; size?: string; status?: string };
    const page = Math.max(0, parseInt(q.page ?? '0', 10));
    const size = Math.min(parseInt(q.size ?? '50', 10), 100);
    const status = q.status ?? 'PENDING';

    const whereClause = and(eq(dlqItems.tenantId, tenantId), eq(dlqItems.status, status as 'PENDING' | 'REPLAYED' | 'DISCARDED'), SEARCH_CONSUMER_FILTER);

    const [rows, totalRows] = await Promise.all([
      db
        .select()
        .from(dlqItems)
        .where(whereClause)
        .orderBy(desc(dlqItems.createdAt))
        .limit(size)
        .offset(page * size),
      db.select({ total: count() }).from(dlqItems).where(whereClause),
    ]);

    return reply.code(200).send({ data: { content: rows, totalElements: totalRows[0]?.total ?? 0, page, size } });
  });

  fastify.post<{ Params: { id: string } }>('/admin/search/dead-letters/:id/retry', { preHandler: [authenticate] }, async (request, reply) => {
    if (!hasPermission(request, PERMISSIONS.SEARCH_REINDEX)) {
      return reply.code(403).send({ error: { code: 'PERMISSION_DENIED', message: 'Missing permission: SEARCH_REINDEX' } });
    }
    const { tenantId } = (request as unknown as AuthedRequest).auth;
    const id = parseInt(request.params.id, 10);

    const [item] = await db
      .select()
      .from(dlqItems)
      .where(and(eq(dlqItems.id, id), eq(dlqItems.tenantId, tenantId), SEARCH_CONSUMER_FILTER));
    if (!item) throw new NotFoundError('Dead-letter item', id);
    if (item.status !== 'PENDING') {
      throw new BusinessError('ALREADY_RESOLVED', `Dead-letter item ${id} is already ${item.status.toLowerCase()}`);
    }

    try {
      await syncSearchIndex(item.payload as unknown as ERPEventPayload, engine);
      await db.update(dlqItems).set({ status: 'REPLAYED', lastRetriedAt: new Date() }).where(eq(dlqItems.id, id));
      return reply.code(200).send({ data: { message: 'Retry succeeded', id } });
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      await db.update(dlqItems).set({ retryCount: item.retryCount + 1, lastRetriedAt: new Date(), errorMessage: errMsg }).where(eq(dlqItems.id, id));
      return reply.code(502).send({ error: { code: 'RETRY_FAILED', message: errMsg } });
    }
  });

  fastify.post<{ Params: { id: string } }>('/admin/search/dead-letters/:id/discard', { preHandler: [authenticate] }, async (request, reply) => {
    if (!hasPermission(request, PERMISSIONS.SEARCH_REINDEX)) {
      return reply.code(403).send({ error: { code: 'PERMISSION_DENIED', message: 'Missing permission: SEARCH_REINDEX' } });
    }
    const { tenantId } = (request as unknown as AuthedRequest).auth;
    const id = parseInt(request.params.id, 10);

    const [item] = await db
      .select()
      .from(dlqItems)
      .where(and(eq(dlqItems.id, id), eq(dlqItems.tenantId, tenantId), SEARCH_CONSUMER_FILTER));
    if (!item) throw new NotFoundError('Dead-letter item', id);

    await db.update(dlqItems).set({ status: 'DISCARDED' }).where(eq(dlqItems.id, id));
    return reply.code(200).send({ data: { message: 'Discarded', id } });
  });
}
