/* global process */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { ErpDatabase } from '@erp/db';
import { accounts, journals } from '@erp/db';
import { and, eq, gte, isNull } from 'drizzle-orm';
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

      if (entity === 'account') {
        const conditions = [eq(accounts.tenantId, tenantId), isNull(accounts.deletedAt)];
        if (modifiedSince) conditions.push(gte(accounts.updatedAt, modifiedSince));
        const rows = await db.select().from(accounts).where(and(...conditions)).limit(size).offset(offset);
        content = rows.map((r) => ({
          id: String(r.id),
          doc: { name: r.name, accountCode: r.accountCode, accountType: r.accountType, tenantId },
        }));
      } else if (entity === 'journal_entry') {
        const conditions = [eq(journals.tenantId, tenantId)];
        if (modifiedSince) conditions.push(gte(journals.createdAt, modifiedSince));
        const rows = await db.select().from(journals).where(and(...conditions)).limit(size).offset(offset);
        content = rows.map((r) => ({
          id: String(r.id),
          doc: { journalId: r.journalId, description: r.description, referenceType: r.referenceType, tenantId },
        }));
      } else {
        return reply.code(422).send({ error: { code: 'INVALID_ENTITY', message: `accounting-service does not own entity: ${entity}` } });
      }

      return reply.code(200).send({ data: { content, totalElements: content.length, hasMore: content.length === size } });
    }
  );
}
