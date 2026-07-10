/* global process, crypto */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { PlatformContextFactory } from '@erp/sdk';
import { purchaseOrders, grns, purchaseReturns, supplierPayments } from '@erp/db';
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
export async function searchSyncInternalRoutes(fastify: FastifyInstance, ctxFactory: PlatformContextFactory): Promise<void> {
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
      const db = ctxFactory.create({ tenantId, userId: 0, correlationId: crypto.randomUUID() }).db.raw;

      let content: SearchSyncDoc[] = [];

      if (entity === 'purchase_order') {
        const conditions = [eq(purchaseOrders.tenantId, tenantId)];
        if (modifiedSince) conditions.push(gte(purchaseOrders.updatedAt, modifiedSince));
        const rows = await db.select().from(purchaseOrders).where(and(...conditions)).limit(size).offset(offset);
        content = rows.map((r) => ({
          id: String(r.id),
          doc: { poNumber: r.poNumber, supplierId: r.supplierId, amount: r.grandTotal, status: r.status, poDate: r.poDate, branchId: r.branchId, tenantId },
        }));
      } else if (entity === 'grn') {
        const conditions = [eq(grns.tenantId, tenantId)];
        if (modifiedSince) conditions.push(gte(grns.updatedAt, modifiedSince));
        const rows = await db.select().from(grns).where(and(...conditions)).limit(size).offset(offset);
        content = rows.map((r) => ({
          id: String(r.id),
          doc: { grnNumber: r.grnNumber, supplierId: r.supplierId, status: r.status, grnDate: r.grnDate, branchId: r.branchId, tenantId },
        }));
      } else if (entity === 'purchase_return') {
        const conditions = [eq(purchaseReturns.tenantId, tenantId)];
        if (modifiedSince) conditions.push(gte(purchaseReturns.updatedAt, modifiedSince));
        const rows = await db.select().from(purchaseReturns).where(and(...conditions)).limit(size).offset(offset);
        content = rows.map((r) => ({
          id: String(r.id),
          doc: { returnNumber: r.returnNumber, supplierId: r.supplierId, status: r.status, returnDate: r.returnDate, branchId: r.branchId, tenantId },
        }));
      } else if (entity === 'payment') {
        const conditions = [eq(supplierPayments.tenantId, tenantId)];
        if (modifiedSince) conditions.push(gte(supplierPayments.updatedAt, modifiedSince));
        const rows = await db.select().from(supplierPayments).where(and(...conditions)).limit(size).offset(offset);
        // 'out-' prefix matches SearchSyncConsumer's idPrefix for SUPPLIER_PAYMENT_MADE —
        // this entity is also fed by sales-service's customer payments (idPrefix 'in-').
        content = rows.map((r) => ({
          id: `out-${r.id}`,
          doc: { paymentNumber: r.paymentNumber, supplierId: r.supplierId, amount: r.amount, paymentMode: r.paymentMode, paymentDate: r.paymentDate, branchId: r.branchId, tenantId },
        }));
      } else {
        return reply.code(422).send({ error: { code: 'INVALID_ENTITY', message: `purchase-service does not own entity: ${entity}` } });
      }

      return reply.code(200).send({ data: { content, totalElements: content.length, hasMore: content.length === size } });
    }
  );
}
