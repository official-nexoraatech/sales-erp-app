import type { FastifyInstance } from 'fastify';
import { PERMISSIONS } from '@erp/types';
import { z } from 'zod';
import type { SearchEngine, SearchEntity } from '../domain/SearchEngine.js';
import { authenticate } from '../middleware/authenticate.js';

type AuthedRequest = { auth: { tenantId: number; userId?: number; permissions: string[] } };

function hasPermission(request: unknown, perm: string): boolean {
  return ((request as AuthedRequest).auth?.permissions ?? []).includes(perm);
}

const VALID_ENTITIES: SearchEntity[] = [
  'customer', 'supplier', 'item', 'invoice', 'purchase_order', 'stock', 'employee',
];

const SearchQuerySchema = z.object({
  q: z.string().min(1).max(200),
  entity: z.enum(['customer', 'supplier', 'item', 'invoice', 'purchase_order', 'stock', 'employee']).optional(),
  size: z.coerce.number().int().min(1).max(100).optional(),
  from: z.coerce.number().int().min(0).optional(),
  fuzziness: z.enum(['AUTO', '0', '1', '2']).optional(),
});

export async function searchRoutes(fastify: FastifyInstance, engine: SearchEngine): Promise<void> {
  // ── GET /search — Global fuzzy search ────────────────────────────────────
  fastify.get('/search', { preHandler: [authenticate] }, async (request, reply) => {
    if (!hasPermission(request, PERMISSIONS.SEARCH_GLOBAL)) {
      return reply.code(403).send({ error: { code: 'PERMISSION_DENIED', message: 'Missing permission: SEARCH_GLOBAL' } });
    }

    const { tenantId } = (request as unknown as AuthedRequest).auth;
    const params = SearchQuerySchema.parse(request.query);

    const result = await engine.search(tenantId, params.q, {
      ...(params.entity !== undefined ? { entity: params.entity } : {}),
      size: params.size ?? 20,
      from: params.from ?? 0,
      fuzziness: params.fuzziness ?? 'AUTO',
    });

    return reply.code(200).send({
      data: {
        hits: result.hits,
        total: result.total,
        took: result.took,
        query: params.q,
      },
    });
  });

  // ── POST /admin/search/reindex/:tenantId/:entity ──────────────────────────
  fastify.post<{ Params: { tenantId: string; entity: string } }>(
    '/admin/search/reindex/:tenantId/:entity',
    { preHandler: [authenticate] },
    async (request, reply) => {
      if (!hasPermission(request, PERMISSIONS.SEARCH_REINDEX)) {
        return reply.code(403).send({ error: { code: 'PERMISSION_DENIED', message: 'Missing permission: SEARCH_REINDEX' } });
      }

      const tenantId = parseInt(request.params.tenantId, 10);
      const entity = request.params.entity as SearchEntity;

      if (!VALID_ENTITIES.includes(entity)) {
        return reply.code(422).send({ error: { code: 'INVALID_ENTITY', message: `Unknown entity: ${entity}` } });
      }

      // Reindex with empty dataset — real data sync happens via incremental-sync job
      const result = await engine.fullReindex(tenantId, entity, async () => []);

      return reply.code(200).send({
        data: { message: 'Reindex complete', tenantId, entity, ...result },
      });
    }
  );

  // ── POST /admin/search/indices/:tenantId — Create all indices for tenant ─
  fastify.post<{ Params: { tenantId: string } }>(
    '/admin/search/indices/:tenantId',
    { preHandler: [authenticate] },
    async (request, reply) => {
      if (!hasPermission(request, PERMISSIONS.SEARCH_REINDEX)) {
        return reply.code(403).send({ error: { code: 'PERMISSION_DENIED', message: 'Missing permission: SEARCH_REINDEX' } });
      }

      const tenantId = parseInt(request.params.tenantId, 10);
      await engine.createTenantIndices(tenantId);
      return reply.code(201).send({ data: { message: 'Indices created', tenantId } });
    }
  );

  // ── DELETE /admin/search/indices/:tenantId — Remove all tenant indices ───
  fastify.delete<{ Params: { tenantId: string } }>(
    '/admin/search/indices/:tenantId',
    { preHandler: [authenticate] },
    async (request, reply) => {
      if (!hasPermission(request, PERMISSIONS.SEARCH_REINDEX)) {
        return reply.code(403).send({ error: { code: 'PERMISSION_DENIED', message: 'Missing permission: SEARCH_REINDEX' } });
      }

      const tenantId = parseInt(request.params.tenantId, 10);
      await engine.deleteTenantIndices(tenantId);
      return reply.code(200).send({ data: { message: 'Tenant indices deleted', tenantId } });
    }
  );

  // ── GET /admin/search/stats/:tenantId/:entity ─────────────────────────────
  fastify.get<{ Params: { tenantId: string; entity: string } }>(
    '/admin/search/stats/:tenantId/:entity',
    { preHandler: [authenticate] },
    async (request, reply) => {
      if (!hasPermission(request, PERMISSIONS.SEARCH_REINDEX)) {
        return reply.code(403).send({ error: { code: 'PERMISSION_DENIED', message: 'Missing permission: SEARCH_REINDEX' } });
      }

      const tenantId = parseInt(request.params.tenantId, 10);
      const entity = request.params.entity as SearchEntity;
      if (!VALID_ENTITIES.includes(entity)) {
        return reply.code(422).send({ error: { code: 'INVALID_ENTITY', message: `Unknown entity: ${entity}` } });
      }

      const stats = await engine.getIndexStats(tenantId, entity);
      return reply.code(200).send({ data: stats });
    }
  );

  // ── POST /search/index — Index single document (called internally) ────────
  fastify.post<{
    Body: { entity: SearchEntity; id: string; document: Record<string, unknown> };
  }>('/search/index', { preHandler: [authenticate] }, async (request, reply) => {
    const { tenantId } = (request as unknown as AuthedRequest).auth;
    const { entity, id, document } = request.body;

    if (!VALID_ENTITIES.includes(entity)) {
      return reply.code(422).send({ error: { code: 'INVALID_ENTITY', message: `Unknown entity: ${entity}` } });
    }

    await engine.index(tenantId, entity, id, document);
    return reply.code(200).send({ data: { message: 'Document indexed' } });
  });

  // ── DELETE /search/index/:entity/:id — Delete document from index ────────
  fastify.delete<{ Params: { entity: string; id: string } }>(
    '/search/index/:entity/:id',
    { preHandler: [authenticate] },
    async (request, reply) => {
      const { tenantId } = (request as unknown as AuthedRequest).auth;
      const entity = request.params.entity as SearchEntity;
      if (!VALID_ENTITIES.includes(entity)) {
        return reply.code(422).send({ error: { code: 'INVALID_ENTITY', message: `Unknown entity: ${entity}` } });
      }

      await engine.delete(tenantId, entity, request.params.id);
      return reply.code(200).send({ data: { message: 'Document removed from index' } });
    }
  );
}
