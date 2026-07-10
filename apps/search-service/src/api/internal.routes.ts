/* global process */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { timingSafeEqual } from 'node:crypto';
import type { SearchEngine, SearchEntity } from '../domain/SearchEngine.js';
import { ALL_SEARCH_ENTITIES } from '../domain/SearchEngine.js';

async function checkInternalKey(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  const key = req.headers['x-internal-key'];
  const expected = process.env['INTERNAL_API_KEY'];
  const keyBuffer = Buffer.from(typeof key === 'string' ? key : '');
  const expectedBuffer = Buffer.from(expected ?? '');
  const matches =
    !!expected &&
    keyBuffer.length === expectedBuffer.length &&
    timingSafeEqual(keyBuffer, expectedBuffer);
  if (!matches) {
    await reply.code(401).send({ error: { code: 'UNAUTHENTICATED', message: 'Invalid internal API key' } });
  }
}

interface SearchSyncDocument {
  id: string;
  doc: Record<string, unknown>;
}

// scheduler-service's search.full-reindex / search.incremental-sync jobs (Phase 4) have no
// user JWT to present — they're system cron jobs, not acting on behalf of a logged-in user.
// The /admin/search/* routes in search.routes.ts stay JWT+SEARCH_REINDEX-gated for
// human/admin-triggered use; these are the internal-key-gated equivalents for scheduler-service,
// same convention every other service's internal.routes.ts already uses. `tenantId` comes from
// the request body instead of a JWT claim since there's no token to derive it from.
export async function internalRoutes(fastify: FastifyInstance, engine: SearchEngine): Promise<void> {
  fastify.post<{ Params: { entity: string }; Body: { tenantId: number; documents?: SearchSyncDocument[] } }>(
    '/internal/search/reindex/:entity',
    { preHandler: checkInternalKey },
    async (request, reply) => {
      const entity = request.params.entity as SearchEntity;
      if (!ALL_SEARCH_ENTITIES.includes(entity)) {
        return reply.code(422).send({ error: { code: 'INVALID_ENTITY', message: `Unknown entity: ${entity}` } });
      }
      const { tenantId, documents } = request.body;
      const result = await engine.fullReindex(tenantId, entity, async () => documents ?? []);
      return reply.code(200).send({ data: { message: 'Reindex complete', tenantId, entity, ...result } });
    }
  );

  fastify.post<{ Body: { tenantId: number; entity: SearchEntity; documents: SearchSyncDocument[] } }>(
    '/internal/search/bulk-index',
    { preHandler: checkInternalKey },
    async (request, reply) => {
      const { tenantId, entity, documents } = request.body;
      if (!ALL_SEARCH_ENTITIES.includes(entity)) {
        return reply.code(422).send({ error: { code: 'INVALID_ENTITY', message: `Unknown entity: ${entity}` } });
      }
      const result = await engine.bulkIndex(tenantId, entity, documents ?? []);
      return reply.code(200).send({ data: { message: 'Bulk index complete', tenantId, entity, ...result } });
    }
  );
}
