import type { FastifyInstance } from 'fastify';
import type { PlatformContextFactory } from '@erp/sdk';
import { invoices, tenants, customers } from '@erp/db';
import { and, eq, inArray, isNull, lt, lte, sql } from 'drizzle-orm';
import { QuotationService } from '../domain/QuotationService.js';
import { LoyaltyService } from '../domain/LoyaltyService.js';
import { HealthScoringService } from '../domain/HealthScoringService.js';
import { CampaignService } from '../domain/CampaignService.js';

function requireInternalKey(req: { headers: Record<string, string | string[] | undefined> }, reply: { code: (n: number) => { send: (b: unknown) => void } }): boolean {
  const key = req.headers['x-internal-key'];
  const expected = process.env['INTERNAL_API_KEY'];
  if (!expected || key !== expected) {
    reply.code(401).send({ error: 'Unauthorized' });
    return false;
  }
  return true;
}

export async function internalRoutes(
  fastify: FastifyInstance,
  ctxFactory: PlatformContextFactory
): Promise<void> {
  // Expire stale quotations
  fastify.post('/quotations/expire-stale', {
    handler: async (req, reply) => {
      if (!requireInternalKey(req as never, reply as never)) return;
      const { createDatabaseClient } = await import('@erp/db');
      const db = createDatabaseClient({ url: process.env['DATABASE_URL']! });
      const svc = new QuotationService(db);
      const expiredCount = await svc.expireStale(db);
      return reply.send({ data: { expiredCount } });
    },
  });

  // Expire loyalty points
  fastify.post('/loyalty/expire-points', {
    handler: async (req, reply) => {
      if (!requireInternalKey(req as never, reply as never)) return;
      const { createDatabaseClient } = await import('@erp/db');
      const db = createDatabaseClient({ url: process.env['DATABASE_URL']! });
      const svc = new LoyaltyService(db);
      const expiredCount = await svc.expirePoints(db);
      return reply.send({ data: { expiredCount } });
    },
  });

  // Mark overdue invoices
  fastify.post('/invoices/mark-overdue', {
    handler: async (req, reply) => {
      if (!requireInternalKey(req as never, reply as never)) return;
      const { createDatabaseClient } = await import('@erp/db');
      const db = createDatabaseClient({ url: process.env['DATABASE_URL']! });
      const rows = await db
        .update(invoices)
        .set({ status: 'OVERDUE', updatedAt: new Date() })
        .where(and(
          inArray(invoices.status, ['CONFIRMED', 'PARTIALLY_PAID']),
          lt(invoices.dueDate, new Date())
        ))
        .returning({ id: invoices.id });
      return reply.send({ data: { updatedCount: rows.length } });
    },
  });

  // ── M9.2 — Weekly customer health score computation (all active tenants) ─
  fastify.post('/crm/health-score/compute', {
    handler: async (req, reply) => {
      if (!requireInternalKey(req as never, reply as never)) return;
      const { createDatabaseClient } = await import('@erp/db');
      const db = createDatabaseClient({ url: process.env['DATABASE_URL']! });

      const activeTenants = await db.select({ id: tenants.id }).from(tenants).where(eq(tenants.status, 'ACTIVE'));
      let scored = 0;
      for (const tenant of activeTenants) {
        const results = await HealthScoringService.computeForTenant(db, tenant.id);
        scored += results.length;
      }
      return reply.send({ data: { tenantsProcessed: activeTenants.length, customersScored: scored } });
    },
  });

  // ── M9.6 — Daily birthday greeting dispatch (all active tenants) ─────────
  fastify.post('/crm/birthday-greetings/send', {
    handler: async (req, reply) => {
      if (!requireInternalKey(req as never, reply as never)) return;
      const { createDatabaseClient } = await import('@erp/db');
      const db = createDatabaseClient({ url: process.env['DATABASE_URL']! });
      const notificationUrl = process.env['NOTIFICATION_SERVICE_URL'] ?? 'http://localhost:3014';
      const internalKey = process.env['INTERNAL_API_KEY'] ?? '';
      const todayMonthDay = new Date().toISOString().slice(5, 10); // 'MM-DD'

      const birthdayCustomers = await db
        .select({ id: customers.id, tenantId: customers.tenantId, displayName: customers.displayName, phone: customers.phone })
        .from(customers)
        .where(and(isNull(customers.deletedAt), eq(customers.status, 'ACTIVE'), sql`${customers.dateOfBirth} IS NOT NULL AND SUBSTRING(${customers.dateOfBirth} FROM 6 FOR 5) = ${todayMonthDay}`));

      let sent = 0;
      for (const customer of birthdayCustomers) {
        try {
          // Prefer WhatsApp, fall back to SMS if WhatsApp is skipped/unconfigured
          const waRes = await fetch(`${notificationUrl}/api/v2/notifications/send-internal`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-internal-key': internalKey },
            body: JSON.stringify({
              tenantId: customer.tenantId,
              eventType: 'BIRTHDAY_GREETING',
              recipientPhone: customer.phone,
              templateData: { customerName: customer.displayName },
              channels: ['WHATSAPP'],
            }),
          });
          const waJson = (await waRes.json()) as { data?: { results?: Array<{ status: string }> } };
          const waSent = waJson.data?.results?.[0]?.status === 'SENT';

          if (!waSent) {
            const smsRes = await fetch(`${notificationUrl}/api/v2/notifications/send-internal`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'x-internal-key': internalKey },
              body: JSON.stringify({
                tenantId: customer.tenantId,
                eventType: 'BIRTHDAY_GREETING',
                recipientPhone: customer.phone,
                templateData: { customerName: customer.displayName },
                channels: ['SMS'],
              }),
            });
            const smsJson = (await smsRes.json()) as { data?: { results?: Array<{ status: string }> } };
            if (smsJson.data?.results?.[0]?.status === 'SENT') sent++;
          } else {
            sent++;
          }
        } catch {
          // best-effort — continue to next customer
        }
      }

      return reply.send({ data: { candidates: birthdayCustomers.length, sent } });
    },
  });

  // ── M9.5 — Dispatch SCHEDULED campaigns whose scheduledAt has passed ─────
  fastify.post('/crm/campaigns/dispatch-scheduled', {
    handler: async (req, reply) => {
      if (!requireInternalKey(req as never, reply as never)) return;
      const { createDatabaseClient, campaigns } = await import('@erp/db');
      const db = createDatabaseClient({ url: process.env['DATABASE_URL']! });

      const due = await db
        .select({ id: campaigns.id, tenantId: campaigns.tenantId })
        .from(campaigns)
        .where(and(eq(campaigns.status, 'SCHEDULED'), lte(campaigns.scheduledAt, new Date())));

      let dispatched = 0;
      let failed = 0;
      for (const campaign of due) {
        try {
          const ctx = ctxFactory.create({ tenantId: campaign.tenantId, userId: 0, correlationId: `scheduler-${campaign.id}` });
          await CampaignService.send(ctx, campaign.id);
          dispatched++;
        } catch {
          failed++;
        }
      }

      return reply.send({ data: { due: due.length, dispatched, failed } });
    },
  });
}
