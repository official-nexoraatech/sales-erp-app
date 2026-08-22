import type { FastifyInstance } from 'fastify';
import type { PlatformContextFactory } from '@erp/sdk';
import { createCircuitBreaker, withTenantConnection } from '@erp/sdk';
import { timingSafeEqual } from 'node:crypto';
import {
  createDatabaseClient,
  tenants,
  customers,
  customerSegments,
  campaigns,
  campaignAutomationRules,
} from '@erp/db';
import { and, eq, lte } from 'drizzle-orm';
import { HealthScoringService } from '../domain/HealthScoringService.js';
import { LoyaltyService, EXPIRY_WARNING_WINDOW_DAYS } from '../domain/LoyaltyService.js';
import { FestivalIntelligenceService } from '../domain/FestivalIntelligenceService.js';
import { SegmentService, type SegmentFilterDefinition } from '../domain/SegmentService.js';
import { CampaignService } from '../domain/CampaignService.js';
import { JourneyService } from '../domain/JourneyService.js';
import { ReferralService } from '../domain/ReferralService.js';
import { TicketService } from '../domain/TicketService.js';

// ES-16: same notification-service circuit breaker pattern used by sales-service's own
// internal.routes.ts for its birthday-greetings jobs — copied verbatim since crm-service now
// calls notification-service directly for the loyalty-expiry-warning job (CRM/O2C split).
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

// CRM/O2C split — service-to-service endpoints for sales-service's customer-360.routes.ts,
// which can no longer import HealthScoringService's getPredictionsForCustomer/recordFeedback
// directly now that they live here. Same x-internal-key convention as sales-service's own
// internal.routes.ts (requireInternalKey copied verbatim from there).
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

// CRM/O2C split (migration 12) — copied verbatim from sales-service's own internal.routes.ts,
// same precedent as sendBirthdayNotification above: the ticket SLA-breach sweep needs it here
// now that TicketService lives in this service, and it posts to a different notification-service
// endpoint (send-raw-internal) than sendBirthdayNotification does (send-internal), so it isn't a
// simple reuse of that existing helper.
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

// Phase 9 GUC-per-request rollout, 2026-08-21 — the four single-tenant routes (tenantId known
// upfront from the query/body) are migrated to withTenantConnection(ctxFactory.rawDb, tenantId,
// ...), same as any other internal-key-guarded route (caveat 5b). RLS-readiness follow-up
// (2026-08-22): every cross-tenant scheduler-driven batch job (`for (const tenant of
// activeTenants)`) is now closed too, with a per-tenant-iteration withTenantConnection call
// inside each loop instead of one wrap around the whole request. A few routes' SOURCE query
// (finding which tenants/rows are due) stays a genuinely cross-tenant, unscoped read by design —
// documented inline at each one — since what matters for GUC safety is the per-tenant work done
// with the result, not the read that discovers it.
export async function internalRoutes(
  fastify: FastifyInstance,
  ctxFactory: PlatformContextFactory
): Promise<void> {
  fastify.get<{ Params: { id: string }; Querystring: { tenantId: string } }>(
    '/internal/customers/:id/health-predictions',
    {
      handler: async (req, reply) => {
        if (!requireInternalKey(req as never, reply as never)) return;
        const tenantId = parseInt(req.query.tenantId, 10);
        const customerId = parseInt(req.params.id, 10);
        const predictions = await withTenantConnection(ctxFactory.rawDb, tenantId, (db) =>
          HealthScoringService.getPredictionsForCustomer(db, tenantId, customerId)
        );
        return reply.send({ data: predictions });
      },
    }
  );

  fastify.post<{
    Params: { id: string };
    Body: {
      tenantId: number;
      recommendationType: 'NEXT_BEST_ACTION' | 'PRODUCT_RECOMMENDATION';
      action: 'DISMISS' | 'ACCEPT';
    };
  }>('/internal/recommendations/:id/feedback', {
    handler: async (req, reply) => {
      if (!requireInternalKey(req as never, reply as never)) return;
      const { tenantId, recommendationType, action } = req.body;
      const id = parseInt(req.params.id, 10);
      const updated = await withTenantConnection(ctxFactory.rawDb, tenantId, (db) =>
        HealthScoringService.recordFeedback(db, tenantId, recommendationType, id, action)
      );
      return reply.send({ data: { updated } });
    },
  });

  // Loyalty expire-points/expiry-warnings-send jobs, moved verbatim from sales-service's
  // internal.routes.ts (CRM/O2C split — both call the moved half of LoyaltyService).
  fastify.post('/loyalty/expire-points', {
    handler: async (req, reply) => {
      if (!requireInternalKey(req as never, reply as never)) return;
      const db = createDatabaseClient({ url: process.env['DATABASE_URL']! });
      const svc = new LoyaltyService(db);
      const expiredCount = await svc.expirePoints(db);
      return reply.send({ data: { expiredCount } });
    },
  });

  fastify.post('/loyalty/expiry-warnings/send', {
    handler: async (req, reply) => {
      if (!requireInternalKey(req as never, reply as never)) return;
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
        const expiring = await withTenantConnection(db, tenant.id, (scopedDb) =>
          new LoyaltyService(scopedDb).getExpiringPoints(tenant.id, EXPIRY_WARNING_WINDOW_DAYS)
        );
        candidateCount += expiring.length;

        for (const row of expiring) {
          const [customer] = await withTenantConnection(db, tenant.id, (scopedDb) =>
            scopedDb
              .select({
                displayName: customers.displayName,
                phone: customers.phone,
                optOutWhatsapp: customers.optOutWhatsapp,
                optOutSms: customers.optOutSms,
              })
              .from(customers)
              .where(and(eq(customers.id, row.customerId), eq(customers.tenantId, tenant.id)))
          );
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

  // For portal.routes.ts's GET /portal/loyalty (sales-service), which can no longer import
  // LoyaltyService.getBalance directly now that it lives here (CRM/O2C split).
  fastify.get<{ Params: { id: string }; Querystring: { tenantId: string } }>(
    '/internal/customers/:id/loyalty-balance',
    {
      handler: async (req, reply) => {
        if (!requireInternalKey(req as never, reply as never)) return;
        const tenantId = parseInt(req.query.tenantId, 10);
        const customerId = parseInt(req.params.id, 10);
        const balance = await withTenantConnection(ctxFactory.rawDb, tenantId, (db) => {
          const svc = new LoyaltyService(db);
          return svc.getBalance(customerId, tenantId);
        });
        return reply.send({ data: balance });
      },
    }
  );

  // Nightly Festival Intelligence suggestions, moved verbatim from sales-service's
  // internal.routes.ts (CRM/O2C split).
  fastify.post('/crm/festival-suggestions/compute', {
    handler: async (req, reply) => {
      if (!requireInternalKey(req as never, reply as never)) return;
      const db = createDatabaseClient({ url: process.env['DATABASE_URL']! });

      const activeTenants = await db
        .select({ id: tenants.id })
        .from(tenants)
        .where(eq(tenants.status, 'ACTIVE'));

      let suggestionsWritten = 0;
      for (const tenant of activeTenants) {
        const result = await withTenantConnection(db, tenant.id, (scopedDb) =>
          FestivalIntelligenceService.computeAndCacheSuggestions(scopedDb, tenant.id)
        );
        suggestionsWritten += result.suggestionsWritten;
      }
      return reply.send({ data: { tenantsProcessed: activeTenants.length, suggestionsWritten } });
    },
  });

  // Segment-membership/refresh, campaign-conversions/attribute, campaigns/dispatch-scheduled,
  // automation-rules/dispatch-due, and journeys/evaluate-due jobs, moved verbatim from
  // sales-service's internal.routes.ts (CRM/O2C split, migration 7).

  // ── CRM-ROADMAP Phase 2, Feature 7 — Nightly segment-membership-cache refresh ───
  // (all active tenants, every behavioral-operator segment). Static-field-only segments are
  // skipped entirely — they're cheap enough to always compute live (SegmentService.
  // needsMembershipCache).
  fastify.post('/crm/segment-membership/refresh', {
    handler: async (req, reply) => {
      if (!requireInternalKey(req as never, reply as never)) return;
      const db = createDatabaseClient({ url: process.env['DATABASE_URL']! });

      const activeTenants = await db
        .select({ id: tenants.id })
        .from(tenants)
        .where(eq(tenants.status, 'ACTIVE'));

      let segmentsRefreshed = 0;
      let customersCached = 0;
      for (const tenant of activeTenants) {
        const segments = await withTenantConnection(db, tenant.id, (scopedDb) =>
          scopedDb.select().from(customerSegments).where(eq(customerSegments.tenantId, tenant.id))
        );
        for (const segment of segments) {
          const filterDefinition = segment.filterDefinition as SegmentFilterDefinition | null;
          if (!SegmentService.needsMembershipCache(filterDefinition)) continue;
          const where = SegmentService.customWhere(tenant.id, filterDefinition!);
          const count = await withTenantConnection(db, tenant.id, (scopedDb) =>
            SegmentService.refreshMembershipCache(scopedDb, tenant.id, segment.id, where)
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
      const db = createDatabaseClient({ url: process.env['DATABASE_URL']! });

      const activeTenants = await db
        .select({ id: tenants.id })
        .from(tenants)
        .where(eq(tenants.status, 'ACTIVE'));

      let totalConverted = 0;
      for (const tenant of activeTenants) {
        totalConverted += await withTenantConnection(db, tenant.id, (scopedDb) =>
          CampaignService.attributeConversions(scopedDb, tenant.id)
        );
      }
      return reply.send({ data: { tenantsProcessed: activeTenants.length, totalConverted } });
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
      const db = createDatabaseClient({ url: process.env['DATABASE_URL']! });

      // Genuinely cross-tenant by design — must find every tenant's due campaigns in one pass.
      // Read-only; the per-campaign dispatch below is what actually matters for GUC safety.
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
          // RLS-readiness follow-up (2026-08-22): ctx used to be built without a dbOverride at
          // all — fully GUC-unsafe. send()/dispatchRecurringOccurrence() do real per-recipient
          // notification-service calls, but those are fast BullMQ-enqueue calls (not a slow
          // external API like gst-service's NIC calls), so wrapping the whole call is an
          // acceptable simplification rather than a full caveat-4g split.
          await withTenantConnection(ctxFactory.rawDb, campaign.tenantId, async (scopedDb) => {
            const ctx = ctxFactory.create(
              { tenantId: campaign.tenantId, userId: 0, correlationId: `scheduler-${campaign.id}` },
              scopedDb
            );
            if (campaign.recurrenceRule) {
              await CampaignService.dispatchRecurringOccurrence(ctx, campaign.id);
              recurred++;
            } else {
              await CampaignService.send(ctx, campaign.id);
              dispatched++;
            }
          });
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
      const db = createDatabaseClient({ url: process.env['DATABASE_URL']! });

      // Genuinely cross-tenant by design — must find every tenant's enabled rules in one pass.
      // Read-only; the per-rule firing below is what actually matters for GUC safety.
      const rules = await db
        .select({ id: campaignAutomationRules.id, tenantId: campaignAutomationRules.tenantId })
        .from(campaignAutomationRules)
        .where(eq(campaignAutomationRules.enabled, true));

      let fired = 0;
      let skipped = 0;
      let failed = 0;
      for (const rule of rules) {
        try {
          const result = await withTenantConnection(ctxFactory.rawDb, rule.tenantId, (scopedDb) => {
            const ctx = ctxFactory.create(
              { tenantId: rule.tenantId, userId: 0, correlationId: `automation-${rule.id}` },
              scopedDb
            );
            return CampaignService.fireAutomationRule(ctx, rule.id);
          });
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
          const result = await withTenantConnection(ctxFactory.rawDb, tenant.id, (scopedDb) => {
            const ctx = ctxFactory.create(
              { tenantId: tenant.id, userId: 0, correlationId: `journey-tick-${tenant.id}` },
              scopedDb
            );
            return JourneyService.evaluateDueEnrollments(ctx);
          });
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
  // Moved here from sales-service (CRM/O2C split, migration 12) — the loyalty-points side of
  // the payout reaches back to sales-service's /internal/loyalty/credit-points endpoint (see
  // ReferralService.attributeQualifyingPurchases's own comment).
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
        totalPaid += await withTenantConnection(db, tenant.id, (scopedDb) =>
          ReferralService.attributeQualifyingPurchases(scopedDb, tenant.id)
        );
      }

      return reply.send({ data: { tenantsProcessed: activeTenants.length, totalPaid } });
    },
  });

  // ── CRM-ROADMAP Phase 1, Feature 4 — Ticket SLA-breach sweep ─────────────────
  // Indexed on (tenant_id, status, sla_due_at) (07-PERFORMANCE-PLAN.md §2) — never a
  // full-table scan, runs frequently by nature. Escalation notification dispatched here
  // (same shape as credit-limit-review's own notification call in sales-service), not by the
  // scheduler job itself — scheduler-service's cron jobs are thin HTTP callers, business logic
  // (including "who to notify") stays in the owning service. Moved here from sales-service
  // (CRM/O2C split, migration 12).
  fastify.post('/crm/tickets/sla-breach-sweep', {
    handler: async (req, reply) => {
      if (!requireInternalKey(req as never, reply as never)) return;
      const tenantId = parseInt((req.query as { tenantId?: string }).tenantId ?? '', 10);
      if (!tenantId)
        return reply
          .code(400)
          .send({ error: { code: 'MISSING_TENANT_ID', message: 'tenantId query param required' } });

      const breached = await withTenantConnection(ctxFactory.rawDb, tenantId, (db) =>
        TicketService.sweepSlaBreaches(db, tenantId)
      );

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
