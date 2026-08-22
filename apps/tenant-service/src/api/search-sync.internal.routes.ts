/* global process */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { ErpDatabase } from '@erp/db';
import { branches, organizationSettings } from '@erp/db';
import { and, eq, gte, isNull } from 'drizzle-orm';
import { timingSafeEqual } from 'node:crypto';
import { BusinessError } from '@erp/types';
import { withTenantConnection } from '@erp/sdk';

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

interface SearchSyncDoc {
  id: string;
  doc: Record<string, unknown>;
}

interface SearchSyncQuery {
  tenantId: string;
  page?: string;
  size?: string;
  modifiedSince?: string;
}

// GET /internal/search-sync/:entity — paged "everything for this tenant" listing used by
// scheduler-service's search.full-reindex/search.incremental-sync jobs (Phase 4) to backfill
// and catch-up-sync Elasticsearch. NOT protected by JWT authenticate — internal-only, guarded
// by x-internal-key, same convention as every other internal.routes.ts in this codebase.
//
// Phase 9 GUC-per-request rollout — migrated 2026-08-21. No req.auth (internal-key-guarded,
// caveat 5b) — tenantId comes from the query string, so this uses withTenantConnection directly.
export async function searchSyncInternalRoutes(
  fastify: FastifyInstance,
  db: ErpDatabase
): Promise<void> {
  fastify.get<{ Params: { entity: string }; Querystring: SearchSyncQuery }>(
    '/internal/search-sync/:entity',
    { preHandler: checkInternalKey },
    async (request, reply) => {
      const { entity } = request.params;
      if (entity !== 'branch' && entity !== 'organization') {
        // F18: routed through the shared error class, matching every other route in this
        // service — the hand-rolled reply here bypassed registerErrorHandler's envelope.
        throw new BusinessError('INVALID_ENTITY', `tenant-service does not own entity: ${entity}`);
      }

      const tenantId = parseInt(request.query.tenantId, 10);
      const page = parseInt(request.query.page ?? '0', 10);
      const size = Math.min(parseInt(request.query.size ?? '500', 10), 500);
      const offset = page * size;
      const modifiedSince = request.query.modifiedSince
        ? new Date(request.query.modifiedSince)
        : undefined;

      const content: SearchSyncDoc[] = await withTenantConnection(
        db,
        tenantId,
        async (scopedDb) => {
          if (entity === 'branch') {
            const conditions = [eq(branches.tenantId, tenantId), isNull(branches.deletedAt)];
            if (modifiedSince) conditions.push(gte(branches.updatedAt, modifiedSince));
            const rows = await scopedDb
              .select()
              .from(branches)
              .where(and(...conditions))
              .limit(size)
              .offset(offset);
            return rows.map((r) => ({
              id: String(r.id),
              doc: { name: r.name, code: r.code, branchId: r.id, tenantId },
            }));
          } else {
            const rows = await scopedDb
              .select()
              .from(organizationSettings)
              .where(eq(organizationSettings.tenantId, tenantId))
              .limit(size)
              .offset(offset);
            return rows.map((r) => ({ id: String(tenantId), doc: { name: r.orgName, tenantId } }));
          }
        }
      );

      return reply.code(200).send({
        data: { content, totalElements: content.length, hasMore: content.length === size },
      });
    }
  );
}
