import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { PlatformContextFactory } from '@erp/sdk';
import { timingSafeEqual } from 'node:crypto';
import { and, eq, lt, sql } from 'drizzle-orm';
import { grns, suppliers, tenants } from '@erp/db';
import { SupplierPaymentService } from '../domain/SupplierPaymentService.js';
import { PurchaseOrderService } from '../domain/PurchaseOrderService.js';

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

export async function internalRoutes(
  fastify: FastifyInstance,
  ctxFactory: PlatformContextFactory
): Promise<void> {
  fastify.post('/purchase/pdc-alerts', {
    preHandler: checkInternalKey,
    handler: async (req, reply) => {
      const q = req.query as { tenantId?: string };
      if (!q.tenantId) {
        return reply.code(400).send({ error: { code: 'MISSING_TENANT', message: 'tenantId required' } });
      }
      const tenantId = parseInt(q.tenantId, 10);
      const ctx = ctxFactory.create({ tenantId, userId: 0, correlationId: crypto.randomUUID() });
      const svc = new SupplierPaymentService(ctx.db.raw);

      const due = await svc.getPdcDueInDays(tenantId, 3);
      for (const pdc of due) {
        await svc.markPdcAlertSent(pdc.id);
      }

      return reply.send({ data: { processed: due.length } });
    },
  });

  // ── PG-026 — Daily PO delivery reminder (single tenant, tenantScoped job) ─
  // Reuses PurchaseOrderService.getPendingDelivery (same query the user-facing
  // GET /purchase-orders/pending-delivery route uses), then emails each supplier
  // with contact info on file.
  fastify.post('/purchase/po-delivery-reminders/send', {
    preHandler: checkInternalKey,
    handler: async (req, reply) => {
      const q = req.query as { tenantId?: string };
      if (!q.tenantId) return reply.code(400).send({ error: { code: 'MISSING_TENANT', message: 'tenantId required' } });
      const tenantId = parseInt(q.tenantId, 10);
      const ctx = ctxFactory.create({ tenantId, userId: 0, correlationId: crypto.randomUUID() });
      const svc = new PurchaseOrderService(ctx.db.raw);

      const pending = await svc.getPendingDelivery(tenantId);
      const notificationUrl = process.env['NOTIFICATION_SERVICE_URL'] ?? 'http://localhost:3014';
      const apiKey = process.env['INTERNAL_API_KEY'] ?? '';
      let reminded = 0;

      for (const po of pending) {
        const [supplier] = await ctx.db.raw.select({ email: suppliers.email, displayName: suppliers.displayName }).from(suppliers).where(and(eq(suppliers.id, po.supplierId), eq(suppliers.tenantId, tenantId)));
        if (!supplier?.email) continue;
        try {
          const res = await fetch(`${notificationUrl}/notifications/send-raw-internal`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-internal-key': apiKey },
            body: JSON.stringify({
              tenantId,
              eventType: 'PO_DELIVERY_REMINDER',
              channel: 'EMAIL',
              recipientEmail: supplier.email,
              subject: `Overdue delivery — PO ${po.poNumber ?? po.id}`,
              body: `Hi ${supplier.displayName}, purchase order ${po.poNumber ?? po.id} was expected to be delivered by ${po.expectedDeliveryDate?.toISOString().slice(0, 10) ?? 'the agreed date'} and is still pending. Please provide an updated delivery status.`,
            }),
          });
          if (res.ok) reminded++;
        } catch {
          // best-effort — continue to next PO
        }
      }

      return reply.send({ data: { pendingCount: pending.length, reminded } });
    },
  });

  // ── PG-026 — Daily pending-GRN alert (single tenant, tenantScoped job) ────
  // "Pending" = stuck in DRAFT/PENDING_APPROVAL longer than GRN_PENDING_ALERT_DAYS
  // (default 3) since creation — no such concept existed anywhere in this schema.
  fastify.post('/purchase/pending-grn-alerts/run', {
    preHandler: checkInternalKey,
    handler: async (req, reply) => {
      const q = req.query as { tenantId?: string };
      if (!q.tenantId) return reply.code(400).send({ error: { code: 'MISSING_TENANT', message: 'tenantId required' } });
      const tenantId = parseInt(q.tenantId, 10);
      const days = Number(process.env['GRN_PENDING_ALERT_DAYS'] ?? '3');
      const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

      const ctx = ctxFactory.create({ tenantId, userId: 0, correlationId: crypto.randomUUID() });
      const pending = await ctx.db.raw
        .select({ id: grns.id, grnNumber: grns.grnNumber, createdAt: grns.createdAt })
        .from(grns)
        .where(and(eq(grns.tenantId, tenantId), sql`${grns.status} IN ('DRAFT', 'PENDING_APPROVAL')`, lt(grns.createdAt, cutoff)));

      if (pending.length > 0) {
        const [tenant] = await ctx.db.raw.select({ contactEmail: tenants.contactEmail }).from(tenants).where(eq(tenants.id, tenantId));
        if (tenant?.contactEmail) {
          const notificationUrl = process.env['NOTIFICATION_SERVICE_URL'] ?? 'http://localhost:3014';
          const apiKey = process.env['INTERNAL_API_KEY'] ?? '';
          try {
            await fetch(`${notificationUrl}/notifications/send-raw-internal`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'x-internal-key': apiKey },
              body: JSON.stringify({
                tenantId,
                eventType: 'PENDING_GRN_ALERT',
                channel: 'EMAIL',
                recipientEmail: tenant.contactEmail,
                subject: `${pending.length} GRN(s) pending approval beyond ${days} days`,
                body: `GRN(s) pending: ${pending.map((g) => g.grnNumber ?? g.id).join(', ')}`,
              }),
            });
          } catch {
            // best-effort
          }
        }
      }

      return reply.send({ data: { pendingCount: pending.length } });
    },
  });
}
