/* global process */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { ErpDatabase } from '@erp/db';
import { users, roles, rolePermissions } from '@erp/db';
import { and, eq, gte } from 'drizzle-orm';
import { timingSafeEqual } from 'node:crypto';

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

// GET /internal/search-sync/:entity — see tenant-service's copy of this file for the full
// rationale (Phase 4 backfill/incremental-sync jobs). NOT protected by JWT — internal-only,
// guarded by x-internal-key.
export async function searchSyncInternalRoutes(fastify: FastifyInstance, db: ErpDatabase): Promise<void> {
  fastify.get<{ Params: { entity: string }; Querystring: SearchSyncQuery }>(
    '/internal/search-sync/:entity',
    { preHandler: checkInternalKey },
    async (request, reply) => {
      const { entity } = request.params;
      const tenantId = parseInt(request.query.tenantId, 10);
      const page = parseInt(request.query.page ?? '0', 10);
      const size = Math.min(parseInt(request.query.size ?? '500', 10), 500);
      const offset = page * size;
      const modifiedSince = request.query.modifiedSince ? new Date(request.query.modifiedSince) : undefined;

      let content: SearchSyncDoc[] = [];

      if (entity === 'user') {
        const conditions = [eq(users.tenantId, tenantId)];
        if (modifiedSince) conditions.push(gte(users.updatedAt, modifiedSince));
        const rows = await db.select().from(users).where(and(...conditions)).limit(size).offset(offset);
        content = rows.map((r) => ({
          id: String(r.id),
          doc: { name: `${r.firstName} ${r.lastName}`, email: r.email, tenantId },
        }));
      } else if (entity === 'role') {
        const conditions = [eq(roles.tenantId, tenantId)];
        if (modifiedSince) conditions.push(gte(roles.updatedAt, modifiedSince));
        const rows = await db.select().from(roles).where(and(...conditions)).limit(size).offset(offset);
        content = await Promise.all(
          rows.map(async (r) => {
            const perms = await db.select({ permission: rolePermissions.permission }).from(rolePermissions).where(eq(rolePermissions.roleId, r.id));
            return { id: String(r.id), doc: { name: r.name, permissions: perms.map((p) => p.permission), tenantId } };
          })
        );
      } else {
        return reply.code(422).send({ error: { code: 'INVALID_ENTITY', message: `auth-service does not own entity: ${entity}` } });
      }

      return reply.code(200).send({ data: { content, totalElements: content.length, hasMore: content.length === size } });
    }
  );
}
