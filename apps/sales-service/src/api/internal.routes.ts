import type { FastifyInstance } from 'fastify';
import type { PlatformContextFactory } from '@erp/sdk';
import { createCircuitBreaker } from '@erp/sdk';
import { timingSafeEqual } from 'node:crypto';
import { invoices, tenants, customers, customerInteractions, projectionCustomerBalance } from '@erp/db';
import { and, eq, inArray, isNull, lt, lte, sql } from 'drizzle-orm';
import { QuotationService } from '../domain/QuotationService.js';
import { LoyaltyService } from '../domain/LoyaltyService.js';
import { HealthScoringService } from '../domain/HealthScoringService.js';
import { CampaignService } from '../domain/CampaignService.js';
import { PaymentReminderService, shouldSendChannel } from '../domain/PaymentReminderService.js';

// ES-16/ES-18: same notification-service circuit breaker pattern as campaigns —
// a downed notification-service should fail fast for every remaining customer.
async function sendRawNotification(
  notificationUrl: string,
  internalKey: string,
  body: string
): Promise<{ ok: boolean }> {
  const res = await fetch(`${notificationUrl}/notifications/send-raw-internal`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-internal-key': internalKey },
    body,
  });
  const json = (await res.json()) as { data?: { status?: string } };
  return { ok: res.ok && json.data?.status === 'SENT' };
}

const paymentReminderBreaker = createCircuitBreaker(sendRawNotification, 'notification-service');

// ES-16: same notification-service circuit breaker pattern as CampaignService —
// a downed notification-service should fail fast for every remaining customer.
async function sendBirthdayNotification(
  notificationUrl: string,
  internalKey: string,
  body: string
): Promise<{ data?: { results?: Array<{ status: string }> } }> {
  const res = await fetch(`${notificationUrl}/notifications/send-internal`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-internal-key': internalKey },
    body,
  });
  return res.json() as Promise<{ data?: { results?: Array<{ status: string }> } }>;
}

const birthdayNotificationBreaker = createCircuitBreaker(sendBirthdayNotification, 'notification-service');

function requireInternalKey(req: { headers: Record<string, string | string[] | undefined> }, reply: { code: (n: number) => { send: (b: unknown) => void } }): boolean {
  const key = req.headers['x-internal-key'];
  const expected = process.env['INTERNAL_API_KEY'];
  const keyBuffer = Buffer.from(typeof key === 'string' ? key : '');
  const expectedBuffer = Buffer.from(expected ?? '');
  const matches =
    !!expected &&
    keyBuffer.length === expectedBuffer.length &&
    timingSafeEqual(keyBuffer, expectedBuffer);
  if (!matches) {
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
        .select({ id: customers.id, tenantId: customers.tenantId, displayName: customers.displayName, phone: customers.phone, optOutWhatsapp: customers.optOutWhatsapp, optOutSms: customers.optOutSms })
        .from(customers)
        .where(and(isNull(customers.deletedAt), eq(customers.status, 'ACTIVE'), sql`${customers.dateOfBirth} IS NOT NULL AND SUBSTRING(${customers.dateOfBirth} FROM 6 FOR 5) = ${todayMonthDay}`));

      let sent = 0;
      for (const customer of birthdayCustomers) {
        if (customer.optOutWhatsapp && customer.optOutSms) continue;
        try {
          // Prefer WhatsApp, fall back to SMS if WhatsApp is skipped/unconfigured — each
          // attempt gated by the customer's own opt-out flag for that channel.
          const waSent = customer.optOutWhatsapp ? false : (await birthdayNotificationBreaker.fire(
            notificationUrl,
            internalKey,
            JSON.stringify({
              tenantId: customer.tenantId,
              eventType: 'BIRTHDAY_GREETING',
              recipientPhone: customer.phone,
              templateData: { customerName: customer.displayName },
              channels: ['WHATSAPP'],
            })
          )).data?.results?.[0]?.status === 'SENT';

          if (!waSent) {
            if (customer.optOutSms) continue;
            const smsJson = await birthdayNotificationBreaker.fire(
              notificationUrl,
              internalKey,
              JSON.stringify({
                tenantId: customer.tenantId,
                eventType: 'BIRTHDAY_GREETING',
                recipientPhone: customer.phone,
                templateData: { customerName: customer.displayName },
                channels: ['SMS'],
              })
            );
            if (smsJson.data?.results?.[0]?.status === 'SENT') sent++;
          } else {
            sent++;
          }
        } catch {
          // best-effort — continue to next customer (includes circuit-open ServiceUnavailableError)
        }
      }

      return reply.send({ data: { candidates: birthdayCustomers.length, sent } });
    },
  });

  // ── ES-18 — Overdue payment reminders (all active tenants) ───────────────
  fastify.post('/crm/payment-reminders/send', {
    handler: async (req, reply) => {
      if (!requireInternalKey(req as never, reply as never)) return;
      const { createDatabaseClient } = await import('@erp/db');
      const db = createDatabaseClient({ url: process.env['DATABASE_URL']! });
      const notificationUrl = process.env['NOTIFICATION_SERVICE_URL'] ?? 'http://localhost:3014';
      const internalKey = process.env['INTERNAL_API_KEY'] ?? '';

      const activeTenants = await db.select({ id: tenants.id }).from(tenants).where(eq(tenants.status, 'ACTIVE'));

      let candidateCount = 0;
      let remindedCount = 0;

      for (const tenant of activeTenants) {
        const candidates = await PaymentReminderService.findCandidates(db, tenant.id);
        candidateCount += candidates.length;

        for (const c of candidates) {
          const body = `Hi ${c.displayName}, you have an overdue balance of Rs. ${c.overdueTotal.toFixed(2)} across ${c.invoiceCount} invoice(s). Please pay at your earliest convenience.`;
          let sent = false;

          if (c.phone && shouldSendChannel(c, 'WHATSAPP')) {
            try {
              const { ok } = await paymentReminderBreaker.fire(
                notificationUrl,
                internalKey,
                JSON.stringify({ tenantId: tenant.id, eventType: 'PAYMENT_REMINDER', channel: 'WHATSAPP', recipientPhone: c.phone, body })
              );
              sent = sent || ok;
            } catch {
              // best-effort — fall through to SMS
            }
          }
          if (!sent && c.phone && shouldSendChannel(c, 'SMS')) {
            try {
              const { ok } = await paymentReminderBreaker.fire(
                notificationUrl,
                internalKey,
                JSON.stringify({ tenantId: tenant.id, eventType: 'PAYMENT_REMINDER', channel: 'SMS', recipientPhone: c.phone, body })
              );
              sent = sent || ok;
            } catch {
              // best-effort — continue
            }
          }
          if (c.email && shouldSendChannel(c, 'EMAIL')) {
            try {
              const { ok } = await paymentReminderBreaker.fire(
                notificationUrl,
                internalKey,
                JSON.stringify({ tenantId: tenant.id, eventType: 'PAYMENT_REMINDER', channel: 'EMAIL', recipientEmail: c.email, subject: 'Payment Reminder', body })
              );
              sent = sent || ok;
            } catch {
              // best-effort — continue
            }
          }

          // Dedup marker regardless of delivery outcome — ES-18: don't reprocess this
          // customer again today even if every channel was opted out or failed.
          await db.insert(customerInteractions).values({
            tenantId: tenant.id,
            customerId: c.customerId,
            type: 'SYSTEM',
            notes: `Payment reminder ${sent ? 'sent' : 'attempted'} — overdue balance Rs. ${c.overdueTotal.toFixed(2)} across ${c.invoiceCount} invoice(s)`,
            createdBy: 0,
          });
          if (sent) remindedCount++;
        }
      }

      return reply.send({ data: { candidates: candidateCount, reminded: remindedCount } });
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

  // ── PG-026 — Weekly credit-limit review (single tenant, tenantScoped job) ─
  // Customers whose current running balance (projection_customer_balance) has
  // reached or passed CREDIT_LIMIT_REVIEW_THRESHOLD (default 90%) of their limit.
  fastify.post('/crm/credit-limit-review/run', {
    handler: async (req, reply) => {
      if (!requireInternalKey(req as never, reply as never)) return;
      const tenantId = parseInt((req.query as { tenantId?: string }).tenantId ?? '', 10);
      if (!tenantId) return reply.code(400).send({ error: { code: 'MISSING_TENANT_ID', message: 'tenantId query param required' } });

      const threshold = Number(process.env['CREDIT_LIMIT_REVIEW_THRESHOLD'] ?? '0.9');
      const { createDatabaseClient } = await import('@erp/db');
      const db = createDatabaseClient({ url: process.env['DATABASE_URL']! });

      const rows = await db
        .select({
          customerId: customers.id,
          displayName: customers.displayName,
          creditLimit: customers.creditLimit,
          currentBalance: projectionCustomerBalance.currentBalance,
        })
        .from(customers)
        .innerJoin(projectionCustomerBalance, and(eq(projectionCustomerBalance.customerId, customers.id), eq(projectionCustomerBalance.tenantId, tenantId)))
        .where(and(eq(customers.tenantId, tenantId), eq(customers.creditLimitEnabled, true), isNull(customers.deletedAt)));

      const atRisk = rows
        .map((r) => ({
          customerId: r.customerId,
          displayName: r.displayName,
          creditLimit: Number(r.creditLimit),
          currentBalance: Number(r.currentBalance),
        }))
        .filter((r) => r.creditLimit > 0 && r.currentBalance >= r.creditLimit * threshold);

      if (atRisk.length > 0) {
        const [tenant] = await db.select({ contactEmail: tenants.contactEmail }).from(tenants).where(eq(tenants.id, tenantId));
        if (tenant?.contactEmail) {
          const notificationUrl = process.env['NOTIFICATION_SERVICE_URL'] ?? 'http://localhost:3014';
          const internalKey = process.env['INTERNAL_API_KEY'] ?? '';
          const summary = atRisk.map((r) => `${r.displayName}: Rs. ${r.currentBalance.toFixed(2)} / ${r.creditLimit.toFixed(2)}`).join('; ');
          try {
            await sendRawNotification(
              notificationUrl,
              internalKey,
              JSON.stringify({
                tenantId,
                eventType: 'CREDIT_LIMIT_REVIEW',
                channel: 'EMAIL',
                recipientEmail: tenant.contactEmail,
                subject: `${atRisk.length} customer(s) at/near credit limit`,
                body: `The following customers are at or near their credit limit: ${summary}`,
              })
            );
          } catch {
            // best-effort — the response below still reports the real list either way
          }
        }
      }

      return reply.send({ data: { atRiskCount: atRisk.length, customers: atRisk } });
    },
  });
}
