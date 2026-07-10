/* global crypto */
import type { FastifyInstance } from 'fastify';
import type { PlatformContextFactory } from '@erp/sdk';
import { getBranchScope } from '@erp/sdk';
import { customers } from '@erp/db';
import { and, asc, eq, gte, inArray, isNull, sql } from 'drizzle-orm';
import { PERMISSIONS } from '@erp/types';
import { authenticate } from '../middleware/authenticate.js';
import { requirePermission } from '../middleware/authorize.js';

type AuthedRequest = { auth: { tenantId: number; userId: number; permissions: string[]; branchIds: number[] } };

interface SyncQuery {
  modifiedSince?: string;
  page?: string;
  size?: string;
}

function parsePaging(query: SyncQuery): { page: number; size: number; offset: number; modifiedSince: Date | undefined } {
  const page = Math.max(0, parseInt(query.page ?? '0', 10));
  const size = Math.min(500, Math.max(1, parseInt(query.size ?? '200', 10)));
  const modifiedSince = query.modifiedSince ? new Date(query.modifiedSince) : undefined;
  return { page, size, offset: page * size, modifiedSince };
}

// OFFLINE-04 — public, JWT-authenticated counterpart to search-sync.internal.routes.ts's
// 'customer' entity, for POS/offline clients. Unlike the internal route (trusted,
// internal-network-only, no branch filter — it backfills a tenant-wide search index),
// this is reachable by any authenticated device, so it additionally scopes by the
// caller's branchIds via getBranchScope, matching invoice.routes.ts's convention — a
// cashier's device should only ever receive customers from branches they're assigned to.
export async function syncRoutes(fastify: FastifyInstance, ctxFactory: PlatformContextFactory): Promise<void> {
  // ── GET /sync/customers ────────────────────────────────────────────────────────
  fastify.get('/sync/customers', { preHandler: [authenticate, requirePermission(PERMISSIONS.CUSTOMER_VIEW)] }, async (request, reply) => {
    const auth = (request as unknown as AuthedRequest).auth;
    const { tenantId, userId } = auth;
    const ctx = ctxFactory.create({
      tenantId,
      userId,
      correlationId: (request.headers['x-correlation-id'] as string) ?? crypto.randomUUID(),
    });
    const { size, offset, modifiedSince } = parsePaging(request.query as SyncQuery);

    const conditions = [eq(customers.tenantId, tenantId), isNull(customers.deletedAt)];
    if (modifiedSince) conditions.push(gte(customers.updatedAt, modifiedSince));
    const branchScope = getBranchScope(auth);
    if (branchScope !== 'all') conditions.push(inArray(customers.branchId, branchScope));
    const whereClause = and(...conditions);

    const rows = await ctx.db.raw
      .select()
      .from(customers)
      .where(whereClause)
      .orderBy(asc(customers.updatedAt), asc(customers.id))
      .limit(size)
      .offset(offset);

    const [countRow] = await ctx.db.raw.select({ count: sql<number>`count(*)::int` }).from(customers).where(whereClause);
    const totalElements = countRow?.count ?? 0;

    const content = rows.map((r) => ({
      id: r.id,
      tenantId: r.tenantId,
      branchId: r.branchId,
      displayName: r.displayName,
      phone: r.phone,
      altPhone: r.altPhone ?? undefined,
      email: r.email ?? undefined,
      customerType: r.customerType,
      updatedAt: r.updatedAt.toISOString(),
    }));

    return reply.code(200).send({ data: { content, totalElements, hasMore: offset + content.length < totalElements } });
  });
}
