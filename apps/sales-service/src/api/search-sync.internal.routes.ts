/* global process, crypto */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { PlatformContextFactory } from '@erp/sdk';
import { customers, suppliers, invoices, quotations, customerInteractions, customerSegments, campaigns, payments } from '@erp/db';
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
// guarded by x-internal-key. This service's main.ts only exposes a PlatformContextFactory
// (no standalone raw db handle), so this builds a per-request ctx the same way every other
// route in this service already does — `userId: 0` is a placeholder since there's no acting
// user for a system/internal read, and only ctx.db.raw is actually used below.
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

      if (entity === 'customer') {
        const conditions = [eq(customers.tenantId, tenantId), isNull(customers.deletedAt)];
        if (modifiedSince) conditions.push(gte(customers.updatedAt, modifiedSince));
        const rows = await db.select().from(customers).where(and(...conditions)).limit(size).offset(offset);
        content = rows.map((r) => ({
          id: String(r.id),
          doc: { name: r.displayName, phone: r.phone, email: r.email, gstin: r.gstin, creditLimit: r.creditLimit, tenantId },
        }));
      } else if (entity === 'supplier') {
        const conditions = [eq(suppliers.tenantId, tenantId), isNull(suppliers.deletedAt)];
        if (modifiedSince) conditions.push(gte(suppliers.updatedAt, modifiedSince));
        const rows = await db.select().from(suppliers).where(and(...conditions)).limit(size).offset(offset);
        content = rows.map((r) => ({
          id: String(r.id),
          doc: { name: r.displayName, phone: r.phone, email: r.email, gstin: r.gstin, tenantId },
        }));
      } else if (entity === 'invoice') {
        const conditions = [eq(invoices.tenantId, tenantId)];
        if (modifiedSince) conditions.push(gte(invoices.updatedAt, modifiedSince));
        const rows = await db.select().from(invoices).where(and(...conditions)).limit(size).offset(offset);
        content = rows.map((r) => ({
          id: String(r.id),
          doc: {
            invoiceNumber: r.invoiceNumber, customerId: r.customerId, amount: r.grandTotal,
            status: r.status, invoiceDate: r.invoiceDate, branchId: r.branchId, tenantId,
          },
        }));
      } else if (entity === 'quotation') {
        const conditions = [eq(quotations.tenantId, tenantId)];
        if (modifiedSince) conditions.push(gte(quotations.updatedAt, modifiedSince));
        const rows = await db.select().from(quotations).where(and(...conditions)).limit(size).offset(offset);
        content = rows.map((r) => ({
          id: String(r.id),
          doc: {
            quotationNumber: r.quotationNumber, customerId: r.customerId, amount: r.grandTotal,
            status: r.status, quotationDate: r.validUntil, branchId: r.branchId, tenantId,
          },
        }));
      } else if (entity === 'crm_interaction') {
        const conditions = [eq(customerInteractions.tenantId, tenantId)];
        if (modifiedSince) conditions.push(gte(customerInteractions.createdAt, modifiedSince));
        const rows = await db.select().from(customerInteractions).where(and(...conditions)).limit(size).offset(offset);
        content = rows.map((r) => ({
          id: String(r.id),
          doc: { customerId: r.customerId, type: r.type, notes: r.notes, interactionDate: r.createdAt, tenantId },
        }));
      } else if (entity === 'crm_segment') {
        const rows = await db.select().from(customerSegments).where(eq(customerSegments.tenantId, tenantId)).limit(size).offset(offset);
        content = rows.map((r) => ({ id: String(r.id), doc: { name: r.name, code: r.code, tenantId } }));
      } else if (entity === 'crm_campaign') {
        const conditions = [eq(campaigns.tenantId, tenantId)];
        if (modifiedSince) conditions.push(gte(campaigns.updatedAt, modifiedSince));
        const rows = await db.select().from(campaigns).where(and(...conditions)).limit(size).offset(offset);
        content = rows.map((r) => ({ id: String(r.id), doc: { name: r.name, channel: r.channel, status: r.status, tenantId } }));
      } else if (entity === 'payment') {
        const conditions = [eq(payments.tenantId, tenantId)];
        if (modifiedSince) conditions.push(gte(payments.updatedAt, modifiedSince));
        const rows = await db.select().from(payments).where(and(...conditions)).limit(size).offset(offset);
        // 'in-' prefix matches SearchSyncConsumer's idPrefix for PAYMENT_RECEIVED — this
        // entity is also fed by purchase-service's supplier payments (idPrefix 'out-'), and
        // the two must not collide on the same doc id.
        content = rows.map((r) => ({
          id: `in-${r.id}`,
          doc: { paymentNumber: r.paymentNumber, customerId: r.customerId, amount: r.amount, paymentMode: r.paymentMode, paymentDate: r.paymentDate, branchId: r.branchId, tenantId },
        }));
      } else {
        return reply.code(422).send({ error: { code: 'INVALID_ENTITY', message: `sales-service does not own entity: ${entity}` } });
      }

      return reply.code(200).send({ data: { content, totalElements: content.length, hasMore: content.length === size } });
    }
  );
}
