import type { FastifyInstance } from 'fastify';
import type { PlatformContextFactory } from '@erp/sdk';
import { createCircuitBreaker } from '@erp/sdk';
import { timingSafeEqual } from 'node:crypto';
import {
  invoices,
  tenants,
  customers,
  customerInteractions,
  customerSegments,
  projectionCustomerBalance,
} from '@erp/db';
import { and, eq, inArray, isNull, lt, lte, sql } from 'drizzle-orm';
import { QuotationService } from '../domain/QuotationService.js';
import { LoyaltyService, EXPIRY_WARNING_WINDOW_DAYS } from '../domain/LoyaltyService.js';
import { HealthScoringService } from '../domain/HealthScoringService.js';
import { CampaignService } from '../domain/CampaignService.js';
import { PaymentReminderService, shouldSendChannel } from '../domain/PaymentReminderService.js';
import { SegmentService, type SegmentFilterDefinition } from '../domain/SegmentService.js';
import { JourneyService } from '../domain/JourneyService.js';
import { ReferralService } from '../domain/ReferralService.js';
import { FestivalIntelligenceService } from '../domain/FestivalIntelligenceService.js';

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

const birthdayNotificationBreaker = createCircuitBreaker(
  sendBirthdayNotification,
  'notification-service'
);

function requireInternalKey(
  req: { headers: Record<string, string | string[] | undefined> },
  reply: { code: (n: number) => { send: (b: unknown) => void } }
): boolean {
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

  // ── CRM-ROADMAP Phase 2, Feature 3 — Point-expiry-warning notification (all active tenants) ─
  // Only meaningful now that earnPoints() actually sets expiry_date (see LoyaltyService.ts's own
  // comment on the pipeline that never fired before this feature).
  fastify.post('/loyalty/expiry-warnings/send', {
    handler: async (req, reply) => {
      if (!requireInternalKey(req as never, reply as never)) return;
      const { createDatabaseClient } = await import('@erp/db');
      const db = createDatabaseClient({ url: process.env['DATABASE_URL']! });
      const notificationUrl = process.env['NOTIFICATION_SERVICE_URL'] ?? 'http://localhost:3014';
      const internalKey = process.env['INTERNAL_API_KEY'] ?? '';

      const activeTenants = await db
        .select({ id: tenants.id })
        .from(tenants)
        .where(eq(tenants.status, 'ACTIVE'));

      let candidateCount = 0;
      let sent = 0;
      for (const tenant of activeTenants) {
        const svc = new LoyaltyService(db);
        const expiring = await svc.getExpiringPoints(tenant.id, EXPIRY_WARNING_WINDOW_DAYS);
        candidateCount += expiring.length;

        for (const row of expiring) {
          const [customer] = await db
            .select({
              displayName: customers.displayName,
              phone: customers.phone,
              optOutWhatsapp: customers.optOutWhatsapp,
              optOutSms: customers.optOutSms,
            })
            .from(customers)
            .where(and(eq(customers.id, row.customerId), eq(customers.tenantId, tenant.id)));
          if (!customer || (customer.optOutWhatsapp && customer.optOutSms)) continue;

          try {
            const channels = customer.optOutWhatsapp ? ['SMS'] : ['WHATSAPP'];
            const json = await birthdayNotificationBreaker.fire(
              notificationUrl,
              internalKey,
              JSON.stringify({
                tenantId: tenant.id,
                eventType: 'LOYALTY_POINTS_EXPIRING',
                recipientPhone: customer.phone,
                templateData: {
                  customerName: customer.displayName,
                  points: row.expiringPoints,
                  expiryDate: row.expiryDate.toISOString().slice(0, 10),
                },
                channels,
              })
            );
            if (json.data?.results?.[0]?.status === 'SENT') sent++;
          } catch {
            // best-effort — continue to next customer (includes circuit-open ServiceUnavailableError)
          }
        }
      }

      return reply.send({ data: { tenantsProcessed: activeTenants.length, candidateCount, sent } });
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
        .where(
          and(
            inArray(invoices.status, ['CONFIRMED', 'PARTIALLY_PAID']),
            lt(invoices.dueDate, new Date())
          )
        )
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

      const activeTenants = await db
        .select({ id: tenants.id })
        .from(tenants)
        .where(eq(tenants.status, 'ACTIVE'));
      let scored = 0;
      for (const tenant of activeTenants) {
        const results = await HealthScoringService.computeForTenant(db, tenant.id);
        scored += results.length;
      }
      return reply.send({
        data: { tenantsProcessed: activeTenants.length, customersScored: scored },
      });
    },
  });

  // ── CRM-ROADMAP Phase 3, Feature 1 — Nightly AI predictions (churn/next-best-action/
  // product recommendations), all active tenants. Never computed synchronously on page load —
  // 07-PERFORMANCE-PLAN.md §3 is explicit that this is a hard requirement.
  fastify.post('/crm/predictions/compute', {
    handler: async (req, reply) => {
      if (!requireInternalKey(req as never, reply as never)) return;
      const { createDatabaseClient } = await import('@erp/db');
      const db = createDatabaseClient({ url: process.env['DATABASE_URL']! });

      const activeTenants = await db
        .select({ id: tenants.id })
        .from(tenants)
        .where(eq(tenants.status, 'ACTIVE'));

      let customersProcessed = 0;
      for (const tenant of activeTenants) {
        const result = await HealthScoringService.computeAndCachePredictions(db, tenant.id);
        customersProcessed += result.customersProcessed;
      }
      return reply.send({ data: { tenantsProcessed: activeTenants.length, customersProcessed } });
    },
  });

  // ── CRM-ROADMAP Phase 4, Feature 3 — Nightly Festival Intelligence suggestions, all active
  // tenants. Cheap to run nightly even though seasons themselves are infrequent — the compute
  // logic itself only ever writes a row when a tenant has a completed prior-year season of that
  // type to compare against, same reasoning as the AI-predictions job's own always-nightly cadence.
  fastify.post('/crm/festival-suggestions/compute', {
    handler: async (req, reply) => {
      if (!requireInternalKey(req as never, reply as never)) return;
      const { createDatabaseClient } = await import('@erp/db');
      const db = createDatabaseClient({ url: process.env['DATABASE_URL']! });

      const activeTenants = await db
        .select({ id: tenants.id })
        .from(tenants)
        .where(eq(tenants.status, 'ACTIVE'));

      let suggestionsWritten = 0;
      for (const tenant of activeTenants) {
        const result = await FestivalIntelligenceService.computeAndCacheSuggestions(db, tenant.id);
        suggestionsWritten += result.suggestionsWritten;
      }
      return reply.send({ data: { tenantsProcessed: activeTenants.length, suggestionsWritten } });
    },
  });

  // ── CRM-ROADMAP Phase 2, Feature 7 — Nightly segment-membership-cache refresh ───
  // (all active tenants, every behavioral-operator segment). Static-field-only segments are
  // skipped entirely — they're cheap enough to always compute live (SegmentService.
  // needsMembershipCache).
  fastify.post('/crm/segment-membership/refresh', {
    handler: async (req, reply) => {
      if (!requireInternalKey(req as never, reply as never)) return;
      const { createDatabaseClient } = await import('@erp/db');
      const db = createDatabaseClient({ url: process.env['DATABASE_URL']! });

      const activeTenants = await db
        .select({ id: tenants.id })
        .from(tenants)
        .where(eq(tenants.status, 'ACTIVE'));

      let segmentsRefreshed = 0;
      let customersCached = 0;
      for (const tenant of activeTenants) {
        const segments = await db
          .select()
          .from(customerSegments)
          .where(eq(customerSegments.tenantId, tenant.id));
        for (const segment of segments) {
          const filterDefinition = segment.filterDefinition as SegmentFilterDefinition | null;
          if (!SegmentService.needsMembershipCache(filterDefinition)) continue;
          const where = SegmentService.customWhere(tenant.id, filterDefinition!);
          const count = await SegmentService.refreshMembershipCache(
            db,
            tenant.id,
            segment.id,
            where
          );
          segmentsRefreshed++;
          customersCached += count;
        }
      }
      return reply.send({
        data: { tenantsProcessed: activeTenants.length, segmentsRefreshed, customersCached },
      });
    },
  });

  // ── CRM-ROADMAP Phase 2, Feature 6 — Nightly campaign-conversion attribution ─────
  // (all active tenants). "Converted" means the recipient's customer made a qualifying
  // purchase after the send, within the attribution window — not tied to whether they clicked
  // the tracked link (see CampaignService.attributeConversions' own doc comment for why).
  fastify.post('/crm/campaign-conversions/attribute', {
    handler: async (req, reply) => {
      if (!requireInternalKey(req as never, reply as never)) return;
      const { createDatabaseClient } = await import('@erp/db');
      const db = createDatabaseClient({ url: process.env['DATABASE_URL']! });

      const activeTenants = await db
        .select({ id: tenants.id })
        .from(tenants)
        .where(eq(tenants.status, 'ACTIVE'));

      let totalConverted = 0;
      for (const tenant of activeTenants) {
        totalConverted += await CampaignService.attributeConversions(db, tenant.id);
      }
      return reply.send({ data: { tenantsProcessed: activeTenants.length, totalConverted } });
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
        .select({
          id: customers.id,
          tenantId: customers.tenantId,
          displayName: customers.displayName,
          phone: customers.phone,
          optOutWhatsapp: customers.optOutWhatsapp,
          optOutSms: customers.optOutSms,
        })
        .from(customers)
        .where(
          and(
            isNull(customers.deletedAt),
            eq(customers.status, 'ACTIVE'),
            sql`${customers.dateOfBirth} IS NOT NULL AND SUBSTRING(${customers.dateOfBirth} FROM 6 FOR 5) = ${todayMonthDay}`
          )
        );

      let sent = 0;
      for (const customer of birthdayCustomers) {
        if (customer.optOutWhatsapp && customer.optOutSms) continue;
        try {
          // Prefer WhatsApp, fall back to SMS if WhatsApp is skipped/unconfigured — each
          // attempt gated by the customer's own opt-out flag for that channel.
          const waSent = customer.optOutWhatsapp
            ? false
            : (
                await birthdayNotificationBreaker.fire(
                  notificationUrl,
                  internalKey,
                  JSON.stringify({
                    tenantId: customer.tenantId,
                    eventType: 'BIRTHDAY_GREETING',
                    recipientPhone: customer.phone,
                    templateData: { customerName: customer.displayName },
                    channels: ['WHATSAPP'],
                  })
                )
              ).data?.results?.[0]?.status === 'SENT';

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

      const activeTenants = await db
        .select({ id: tenants.id })
        .from(tenants)
        .where(eq(tenants.status, 'ACTIVE'));

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
                JSON.stringify({
                  tenantId: tenant.id,
                  eventType: 'PAYMENT_REMINDER',
                  channel: 'WHATSAPP',
                  recipientPhone: c.phone,
                  body,
                })
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
                JSON.stringify({
                  tenantId: tenant.id,
                  eventType: 'PAYMENT_REMINDER',
                  channel: 'SMS',
                  recipientPhone: c.phone,
                  body,
                })
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
                JSON.stringify({
                  tenantId: tenant.id,
                  eventType: 'PAYMENT_REMINDER',
                  channel: 'EMAIL',
                  recipientEmail: c.email,
                  subject: 'Payment Reminder',
                  body,
                })
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
  // CP-5: a due campaign with recurrenceRule set is a recurring DEFINITION, not a one-time send —
  // dispatchRecurringOccurrence() creates+sends a concrete occurrence and reschedules the
  // definition to its next fire date, instead of send()'ing the definition row directly (which
  // would turn it into a one-shot SENT campaign and end the series after a single firing).
  fastify.post('/crm/campaigns/dispatch-scheduled', {
    handler: async (req, reply) => {
      if (!requireInternalKey(req as never, reply as never)) return;
      const { createDatabaseClient, campaigns } = await import('@erp/db');
      const db = createDatabaseClient({ url: process.env['DATABASE_URL']! });

      const due = await db
        .select({
          id: campaigns.id,
          tenantId: campaigns.tenantId,
          recurrenceRule: campaigns.recurrenceRule,
        })
        .from(campaigns)
        .where(and(eq(campaigns.status, 'SCHEDULED'), lte(campaigns.scheduledAt, new Date())));

      let dispatched = 0;
      let failed = 0;
      let recurred = 0;
      for (const campaign of due) {
        try {
          const ctx = ctxFactory.create({
            tenantId: campaign.tenantId,
            userId: 0,
            correlationId: `scheduler-${campaign.id}`,
          });
          if (campaign.recurrenceRule) {
            await CampaignService.dispatchRecurringOccurrence(ctx, campaign.id);
            recurred++;
          } else {
            await CampaignService.send(ctx, campaign.id);
            dispatched++;
          }
        } catch {
          failed++;
        }
      }

      return reply.send({ data: { due: due.length, dispatched, recurred, failed } });
    },
  });

  // ── CP-5 — Fire enabled campaign automation rules not already fired today ─
  fastify.post('/crm/automation-rules/dispatch-due', {
    handler: async (req, reply) => {
      if (!requireInternalKey(req as never, reply as never)) return;
      const { createDatabaseClient, campaignAutomationRules } = await import('@erp/db');
      const db = createDatabaseClient({ url: process.env['DATABASE_URL']! });

      const rules = await db
        .select({ id: campaignAutomationRules.id, tenantId: campaignAutomationRules.tenantId })
        .from(campaignAutomationRules)
        .where(eq(campaignAutomationRules.enabled, true));

      let fired = 0;
      let skipped = 0;
      let failed = 0;
      for (const rule of rules) {
        try {
          const ctx = ctxFactory.create({
            tenantId: rule.tenantId,
            userId: 0,
            correlationId: `automation-${rule.id}`,
          });
          const result = await CampaignService.fireAutomationRule(ctx, rule.id);
          if (result) fired++;
          else skipped++;
        } catch {
          failed++;
        }
      }

      return reply.send({ data: { evaluated: rules.length, fired, skipped, failed } });
    },
  });

  // ── CRM-ROADMAP Phase 2, Feature 2 — Journey engine tick (all active tenants) ─
  // Per-tenant: enroll new segment matches, then evaluate every ACTIVE enrollment whose
  // nextEvaluationAt is due. JourneyService.evaluateDueEnrollments checks the
  // crm.journey_engine.enabled feature flag itself and no-ops per-tenant when disabled.
  fastify.post('/crm/journeys/evaluate-due', {
    handler: async (req, reply) => {
      if (!requireInternalKey(req as never, reply as never)) return;
      const { createDatabaseClient } = await import('@erp/db');
      const db = createDatabaseClient({ url: process.env['DATABASE_URL']! });

      const activeTenants = await db
        .select({ id: tenants.id })
        .from(tenants)
        .where(eq(tenants.status, 'ACTIVE'));

      let enrolled = 0;
      let evaluated = 0;
      let failed = 0;
      for (const tenant of activeTenants) {
        try {
          const ctx = ctxFactory.create({
            tenantId: tenant.id,
            userId: 0,
            correlationId: `journey-tick-${tenant.id}`,
          });
          const result = await JourneyService.evaluateDueEnrollments(ctx);
          enrolled += result.enrolled;
          evaluated += result.evaluated;
        } catch {
          failed++;
        }
      }

      return reply.send({
        data: { tenantsProcessed: activeTenants.length, enrolled, evaluated, failed },
      });
    },
  });

  // ── CRM-ROADMAP Phase 2, Feature 4 — Referral payout attribution (all active tenants) ─
  // For every PENDING reward, checks whether the referee now resolves to a real customer with
  // a qualifying purchase, and pays out both parties if so. FLAGGED rewards are skipped
  // entirely — they wait for a REFERRAL_CONFIGURE reviewer to approve or reject them first.
  fastify.post('/referral/attribute-purchases', {
    handler: async (req, reply) => {
      if (!requireInternalKey(req as never, reply as never)) return;
      const { createDatabaseClient } = await import('@erp/db');
      const db = createDatabaseClient({ url: process.env['DATABASE_URL']! });

      const activeTenants = await db
        .select({ id: tenants.id })
        .from(tenants)
        .where(eq(tenants.status, 'ACTIVE'));

      let totalPaid = 0;
      for (const tenant of activeTenants) {
        totalPaid += await ReferralService.attributeQualifyingPurchases(db, tenant.id);
      }

      return reply.send({ data: { tenantsProcessed: activeTenants.length, totalPaid } });
    },
  });

  // ── PG-026 — Weekly credit-limit review (single tenant, tenantScoped job) ─
  // Customers whose current running balance (projection_customer_balance) has
  // reached or passed CREDIT_LIMIT_REVIEW_THRESHOLD (default 90%) of their limit.
  fastify.post('/crm/credit-limit-review/run', {
    handler: async (req, reply) => {
      if (!requireInternalKey(req as never, reply as never)) return;
      const tenantId = parseInt((req.query as { tenantId?: string }).tenantId ?? '', 10);
      if (!tenantId)
        return reply
          .code(400)
          .send({ error: { code: 'MISSING_TENANT_ID', message: 'tenantId query param required' } });

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
        .innerJoin(
          projectionCustomerBalance,
          and(
            eq(projectionCustomerBalance.customerId, customers.id),
            eq(projectionCustomerBalance.tenantId, tenantId)
          )
        )
        .where(
          and(
            eq(customers.tenantId, tenantId),
            eq(customers.creditLimitEnabled, true),
            isNull(customers.deletedAt)
          )
        );

      const atRisk = rows
        .map((r) => ({
          customerId: r.customerId,
          displayName: r.displayName,
          creditLimit: Number(r.creditLimit),
          currentBalance: Number(r.currentBalance),
        }))
        .filter((r) => r.creditLimit > 0 && r.currentBalance >= r.creditLimit * threshold);

      if (atRisk.length > 0) {
        const [tenant] = await db
          .select({ contactEmail: tenants.contactEmail })
          .from(tenants)
          .where(eq(tenants.id, tenantId));
        if (tenant?.contactEmail) {
          const notificationUrl =
            process.env['NOTIFICATION_SERVICE_URL'] ?? 'http://localhost:3014';
          const internalKey = process.env['INTERNAL_API_KEY'] ?? '';
          const summary = atRisk
            .map(
              (r) =>
                `${r.displayName}: Rs. ${r.currentBalance.toFixed(2)} / ${r.creditLimit.toFixed(2)}`
            )
            .join('; ');
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

  // ── CRM-ROADMAP Phase 1, Feature 4 — Ticket SLA-breach sweep ─────────────────
  // Indexed on (tenant_id, status, sla_due_at) (07-PERFORMANCE-PLAN.md §2) — never a
  // full-table scan, runs frequently by nature. Escalation notification dispatched here
  // (same shape as credit-limit-review's own notification call above), not by the scheduler
  // job itself — scheduler-service's cron jobs are thin HTTP callers, business logic (including
  // "who to notify") stays in the owning service.
  fastify.post('/crm/tickets/sla-breach-sweep', {
    handler: async (req, reply) => {
      if (!requireInternalKey(req as never, reply as never)) return;
      const tenantId = parseInt((req.query as { tenantId?: string }).tenantId ?? '', 10);
      if (!tenantId)
        return reply
          .code(400)
          .send({ error: { code: 'MISSING_TENANT_ID', message: 'tenantId query param required' } });

      const { createDatabaseClient } = await import('@erp/db');
      const db = createDatabaseClient({ url: process.env['DATABASE_URL']! });
      const { TicketService } = await import('../domain/TicketService.js');

      const breached = await TicketService.sweepSlaBreaches(db, tenantId);

      if (breached.length > 0) {
        const notificationUrl = process.env['NOTIFICATION_SERVICE_URL'] ?? 'http://localhost:3014';
        const internalKey = process.env['INTERNAL_API_KEY'] ?? '';
        for (const ticket of breached) {
          if (!ticket.assignedTo) continue;
          try {
            await sendRawNotification(
              notificationUrl,
              internalKey,
              JSON.stringify({
                tenantId,
                eventType: 'TICKET_SLA_BREACHED',
                channel: 'IN_APP',
                recipientUserId: ticket.assignedTo,
                subject: `SLA breached: ${ticket.ticketNumber}`,
                body: `Ticket ${ticket.ticketNumber} ("${ticket.subject}") has breached its SLA.`,
              })
            );
          } catch {
            // best-effort per ticket — one delivery failure doesn't block the rest; the
            // breach itself is already durably recorded (slaBreached=true + outbox event)
            // regardless of whether this notification succeeds.
          }
        }
      }

      return reply.send({ data: { breachedCount: breached.length, tickets: breached } });
    },
  });
}
