/* global crypto */
import type { FastifyInstance } from 'fastify';
import type { PlatformContextFactory } from '@erp/sdk';
import { items, priceListItems } from '@erp/db';
import { and, asc, eq, gte, isNull, sql } from 'drizzle-orm';
import { PERMISSIONS } from '@erp/types';
import { authenticate } from '../middleware/authenticate.js';
import { requirePermission } from '../middleware/authorize.js';

type AuthedRequest = { auth: { tenantId: number; userId: number } };

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
// modifiedSince+pagination+{content,totalElements,hasMore} contract, for POS/offline
// clients pulling reference data directly rather than search-service's Elasticsearch
// index. Deliberately NOT sharing a handler with the internal route: that route is
// guarded by x-internal-key only and its totalElements is an approximation
// (content.length) which is fine for its backfill-job consumers but not for a client
// resuming a paginated pull, so this recomputes an accurate count instead. The internal
// route and its consumers (search-service, tenant-service) are untouched.
export async function syncRoutes(fastify: FastifyInstance, ctxFactory: PlatformContextFactory): Promise<void> {
  // ── GET /sync/items ─────────────────────────────────────────────────────────
  fastify.get('/sync/items', { preHandler: [authenticate, requirePermission(PERMISSIONS.ITEM_VIEW)] }, async (request, reply) => {
    const { tenantId, userId } = (request as unknown as AuthedRequest).auth;
    const ctx = ctxFactory.create({
      tenantId,
      userId,
      correlationId: (request.headers['x-correlation-id'] as string) ?? crypto.randomUUID(),
    });
    const { size, offset, modifiedSince } = parsePaging(request.query as SyncQuery);

    const conditions = [eq(items.tenantId, tenantId), isNull(items.deletedAt)];
    if (modifiedSince) conditions.push(gte(items.updatedAt, modifiedSince));
    const whereClause = and(...conditions);

    const rows = await ctx.db.raw
      .select()
      .from(items)
      .where(whereClause)
      .orderBy(asc(items.updatedAt), asc(items.id))
      .limit(size)
      .offset(offset);

    const [countRow] = await ctx.db.raw.select({ count: sql<number>`count(*)::int` }).from(items).where(whereClause);
    const totalElements = countRow?.count ?? 0;

    const content = rows.map((r) => ({
      id: r.id,
      tenantId: r.tenantId,
      itemCode: r.itemCode ?? undefined,
      name: r.name,
      barcode: r.barcode ?? undefined,
      hsnCode: r.hsnCode,
      gstRate: Number(r.gstRate),
      cessRate: Number(r.cessRate),
      mrp: r.mrp ? Number(r.mrp) : undefined,
      salePrice: Number(r.salePrice),
      unitId: r.unitId,
      categoryId: r.categoryId ?? undefined,
      brandId: r.brandId ?? undefined,
      status: r.status,
      updatedAt: r.updatedAt.toISOString(),
    }));

    return reply.code(200).send({ data: { content, totalElements, hasMore: offset + content.length < totalElements } });
  });

  // ── GET /sync/price-list-items ────────────────────────────────────────────────
  fastify.get(
    '/sync/price-list-items',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.PRICE_LIST_VIEW)] },
    async (request, reply) => {
      const { tenantId, userId } = (request as unknown as AuthedRequest).auth;
      const ctx = ctxFactory.create({
        tenantId,
        userId,
        correlationId: (request.headers['x-correlation-id'] as string) ?? crypto.randomUUID(),
      });
      const { size, offset, modifiedSince } = parsePaging(request.query as SyncQuery);

      const conditions = [eq(priceListItems.tenantId, tenantId)];
      if (modifiedSince) conditions.push(gte(priceListItems.updatedAt, modifiedSince));
      const whereClause = and(...conditions);

      const rows = await ctx.db.raw
        .select()
        .from(priceListItems)
        .where(whereClause)
        .orderBy(asc(priceListItems.updatedAt), asc(priceListItems.id))
        .limit(size)
        .offset(offset);

      const [countRow] = await ctx.db.raw.select({ count: sql<number>`count(*)::int` }).from(priceListItems).where(whereClause);
      const totalElements = countRow?.count ?? 0;

      const content = rows.map((r) => ({
        id: r.id,
        tenantId: r.tenantId,
        priceListId: r.priceListId,
        itemId: r.itemId,
        variantId: r.variantId ?? undefined,
        salePrice: Number(r.salePrice),
        minQty: Number(r.minQty),
        discountPercent: Number(r.discountPercent),
        updatedAt: r.updatedAt.toISOString(),
      }));

      return reply.code(200).send({ data: { content, totalElements, hasMore: offset + content.length < totalElements } });
    }
  );

  // ── GET /sync/tax-rates ────────────────────────────────────────────────────────
  // There's no dedicated tax-rate master (see search-sync's item mapping and
  // pos-frontend's db.ts CachedTaxRate comment) — GST/cess rates live on `items`,
  // keyed by hsnCode. Multiple items can share an hsnCode; this collapses them to one
  // row per hsnCode (most-recently-updated wins) in application code rather than a SQL
  // DISTINCT ON, since the realistic number of distinct HSN codes per tenant is small
  // (tens, not thousands) — see OFFLINE-04 completion notes for the scale assumption.
  fastify.get('/sync/tax-rates', { preHandler: [authenticate, requirePermission(PERMISSIONS.ITEM_VIEW)] }, async (request, reply) => {
    const { tenantId, userId } = (request as unknown as AuthedRequest).auth;
    const ctx = ctxFactory.create({
      tenantId,
      userId,
      correlationId: (request.headers['x-correlation-id'] as string) ?? crypto.randomUUID(),
    });
    const { size, offset, modifiedSince } = parsePaging(request.query as SyncQuery);

    const conditions = [eq(items.tenantId, tenantId), isNull(items.deletedAt)];
    if (modifiedSince) conditions.push(gte(items.updatedAt, modifiedSince));

    const rows = await ctx.db.raw
      .select({ hsnCode: items.hsnCode, gstRate: items.gstRate, cessRate: items.cessRate, updatedAt: items.updatedAt })
      .from(items)
      .where(and(...conditions))
      .orderBy(asc(items.hsnCode), sql`${items.updatedAt} desc`)
      .limit(5000);

    const byHsn = new Map<string, { hsnCode: string; gstRate: number; cessRate: number; updatedAt: string }>();
    for (const r of rows) {
      if (!byHsn.has(r.hsnCode)) {
        byHsn.set(r.hsnCode, { hsnCode: r.hsnCode, gstRate: Number(r.gstRate), cessRate: Number(r.cessRate), updatedAt: r.updatedAt.toISOString() });
      }
    }
    const deduped = Array.from(byHsn.values());
    const totalElements = deduped.length;
    const content = deduped.slice(offset, offset + size).map((r) => ({ ...r, tenantId }));

    return reply.code(200).send({ data: { content, totalElements, hasMore: offset + content.length < totalElements } });
  });
}
