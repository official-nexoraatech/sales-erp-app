/* global process */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { ValidationError } from '@erp/types';
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
    await reply
      .code(401)
      .send({ error: { code: 'UNAUTHENTICATED', message: 'Invalid internal API key' } });
  }
}

interface SearchSyncDocument {
  id: string;
  doc: Record<string, unknown>;
}

// Unlike search.routes.ts (JWT-gated, always Zod-validated), these internal-key-gated routes
// previously took tenantId/entity/documents straight off `request.body` with no schema at
// all — a malformed/missing `tenantId` silently built an ES index name like
// `erp_undefined_item` instead of failing loudly, the same "garbage input silently accepted"
// shape that caused most of the 2026-07-19 live-ES audit's bugs. These schemas close that gap.
const SearchSyncDocumentSchema = z.object({
  id: z.string().min(1),
  doc: z.record(z.string(), z.unknown()),
});

const ReindexBodySchema = z.object({
  tenantId: z.number().int().positive(),
  documents: z.array(SearchSyncDocumentSchema).optional(),
});

const BulkIndexBodySchema = z.object({
  tenantId: z.number().int().positive(),
  entity: z.enum(ALL_SEARCH_ENTITIES as [SearchEntity, ...SearchEntity[]]),
  documents: z.array(SearchSyncDocumentSchema),
});

const CreateTenantIndicesBodySchema = z.object({
  tenantId: z.number().int().positive(),
});

// scheduler-service's search.full-reindex / search.incremental-sync jobs (Phase 4) have no
// user JWT to present — they're system cron jobs, not acting on behalf of a logged-in user.
// The /admin/search/* routes in search.routes.ts stay JWT+SEARCH_REINDEX-gated for
// human/admin-triggered use; these are the internal-key-gated equivalents for scheduler-service,
// same convention every other service's internal.routes.ts already uses. `tenantId` comes from
// the request body instead of a JWT claim since there's no token to derive it from.
export async function internalRoutes(
  fastify: FastifyInstance,
  engine: SearchEngine
): Promise<void> {
  fastify.post<{
    Params: { entity: string };
    Body: { tenantId: number; documents?: SearchSyncDocument[] };
  }>(
    '/internal/search/reindex/:entity',
    { preHandler: checkInternalKey },
    async (request, reply) => {
      const entity = request.params.entity as SearchEntity;
      if (!ALL_SEARCH_ENTITIES.includes(entity)) {
        return reply
          .code(422)
          .send({ error: { code: 'INVALID_ENTITY', message: `Unknown entity: ${entity}` } });
      }
      const body = ReindexBodySchema.safeParse(request.body);
      if (!body.success)
        throw new ValidationError(body.error.errors.map((e) => e.message).join('; '));
      const { tenantId, documents } = body.data;
      const result = await engine.fullReindex(tenantId, entity, async () => documents ?? []);
      return reply
        .code(200)
        .send({ data: { message: 'Reindex complete', tenantId, entity, ...result } });
    }
  );

  fastify.post<{
    Body: { tenantId: number; entity: SearchEntity; documents: SearchSyncDocument[] };
  }>('/internal/search/bulk-index', { preHandler: checkInternalKey }, async (request, reply) => {
    const body = BulkIndexBodySchema.safeParse(request.body);
    if (!body.success)
      throw new ValidationError(body.error.errors.map((e) => e.message).join('; '));
    const { tenantId, entity, documents } = body.data;
    const result = await engine.bulkIndex(tenantId, entity, documents ?? []);
    return reply
      .code(200)
      .send({ data: { message: 'Bulk index complete', tenantId, entity, ...result } });
  });

  // tenant-service's TenantProvisioner calls this at provisioning time (Phase 7:
  // CREATE_ES_INDICES) instead of hand-rolling its own ES index-creation calls — search-service
  // is the only owner of ENTITY_MAPPINGS/ERP_ANALYSIS_SETTINGS. Before this existed,
  // tenant-service PUT its own 5-entity, plural-named, differently-mapped indices directly
  // against Elasticsearch, which never matched the singular entity names this service actually
  // indexes into — every tenant's real search documents fell through to ES's auto-create-index
  // default (no custom analyzers, wrong field types, unwanted default replica), while the
  // provisioning-time indices sat empty and orphaned forever. See createTenantIndices() in
  // SearchEngine.ts for what this creates (all 30 entities, correct mappings, replicas: 0).
  fastify.post<{ Body: { tenantId: number } }>(
    '/internal/search/create-tenant-indices',
    { preHandler: checkInternalKey },
    async (request, reply) => {
      const body = CreateTenantIndicesBodySchema.safeParse(request.body);
      if (!body.success)
        throw new ValidationError(body.error.errors.map((e) => e.message).join('; '));
      const { tenantId } = body.data;
      await engine.createTenantIndices(tenantId);
      return reply.code(201).send({ data: { message: 'Tenant indices created', tenantId } });
    }
  );
}
