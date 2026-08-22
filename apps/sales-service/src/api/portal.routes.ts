import type { FastifyInstance } from 'fastify';
import { and, desc, eq } from 'drizzle-orm';
import type { ErpDatabase } from '@erp/db';
import { customers, invoices, invoiceLines, customerCommunicationPreferences } from '@erp/db';
import { z } from 'zod';
import { createCircuitBreaker, withTenantConnection } from '@erp/sdk';
import { NotFoundError, ValidationError } from '@erp/types';
import { requirePortalAuth } from '../middleware/portal-auth.js';

// CRM/O2C split — getBalance moved to crm-service; this helper reaches it over HTTP, mirroring
// customer-360.routes.ts's fetchHealthPredictions.
async function fetchLoyaltyBalance(
  crmServiceUrl: string,
  internalKey: string,
  tenantId: number,
  customerId: number
): Promise<unknown> {
  const res = await fetch(
    `${crmServiceUrl}/api/v2/internal/customers/${customerId}/loyalty-balance?tenantId=${tenantId}`,
    { headers: { 'x-internal-key': internalKey } }
  );
  if (!res.ok) throw new Error(`crm-service loyalty-balance call failed: ${res.status}`);
  const json = (await res.json()) as { data: unknown };
  return json.data;
}
const loyaltyBalanceBreaker = createCircuitBreaker(fetchLoyaltyBalance, 'crm-service');

// CRM-ROADMAP Phase 3, Feature 2 (Self-Service Customer Portal).
//
// Finding 3 (from planning): these routes deliberately use the raw ErpDatabase handle passed
// in here, never PlatformContextFactory/PlatformContext — that factory feeds `userId` straight
// into PlatformAuditLogger/PlatformEventBus as "the actor", and there's no portal-account
// concept there. A ticket's authorName snapshot already gives staff enough visibility into
// "this came from the customer" (see TicketService), so portal writes skip ctx.audit.log/
// ctx.events.publish entirely rather than force a numeric portal-account id through an
// employee-shaped audit/event path, which would silently mis-attribute it.
//
// Every route below filters customerId/tenantId ONLY from the verified JWT claim
// (request.portalAuth), never a URL/body field of the same name. An ownership mismatch on a
// customer-scoped row always returns 404 (NotFoundError), never 403 — a 403 would confirm the
// row exists for a different customer, which is itself a cross-customer information leak.
//
// Phase 9 GUC-per-request rollout — migrated 2026-08-21 (all but one route). No
// PlatformContextFactory here (identity comes from request.portalAuth, not req.auth) — uses
// withTenantConnection(db, tenantId, ...) directly per route, same pattern as ai-copilot-service.
// GET /portal/loyalty is deliberately NOT migrated: it makes a real fetch() call to crm-service
// (checklist caveat 4).

const PreferencesSchema = z.object({
  preferences: z
    .array(
      z.object({
        channel: z.enum(['SMS', 'WHATSAPP', 'EMAIL', 'IN_APP']),
        category: z.enum(['PROMOTIONAL', 'TRANSACTIONAL']),
        consented: z.boolean(),
      })
    )
    .min(1),
});

export async function portalRoutes(fastify: FastifyInstance, db: ErpDatabase): Promise<void> {
  // ── GET /portal/me ────────────────────────────────────────────────────────
  fastify.get('/portal/me', { preHandler: [requirePortalAuth] }, async (request, reply) => {
    const { tenantId, customerId } = request.portalAuth;
    const customer = await withTenantConnection(db, tenantId, async (scopedDb) => {
      const [row] = await scopedDb
        .select({
          id: customers.id,
          displayName: customers.displayName,
          phone: customers.phone,
          email: customers.email,
          customerType: customers.customerType,
          loyaltyPoints: customers.loyaltyPoints,
        })
        .from(customers)
        .where(and(eq(customers.id, customerId), eq(customers.tenantId, tenantId)));
      return row;
    });
    if (!customer) throw new NotFoundError('Customer', customerId);
    return reply.code(200).send({ data: customer });
  });

  // ── GET /portal/orders ───────────────────────────────────────────────────
  fastify.get('/portal/orders', { preHandler: [requirePortalAuth] }, async (request, reply) => {
    const { tenantId, customerId } = request.portalAuth;
    const rows = await withTenantConnection(db, tenantId, (scopedDb) =>
      scopedDb
        .select({
          id: invoices.id,
          invoiceNumber: invoices.invoiceNumber,
          invoiceDate: invoices.invoiceDate,
          status: invoices.status,
          grandTotal: invoices.grandTotal,
          balanceDue: invoices.balanceDue,
        })
        .from(invoices)
        .where(and(eq(invoices.customerId, customerId), eq(invoices.tenantId, tenantId)))
        .orderBy(desc(invoices.invoiceDate))
        .limit(100)
    );
    return reply.code(200).send({ data: { content: rows, totalElements: rows.length } });
  });

  // ── GET /portal/orders/:id ────────────────────────────────────────────────
  fastify.get<{ Params: { id: string } }>(
    '/portal/orders/:id',
    { preHandler: [requirePortalAuth] },
    async (request, reply) => {
      const { tenantId, customerId } = request.portalAuth;
      const id = parseInt(request.params.id, 10);

      const result = await withTenantConnection(db, tenantId, async (scopedDb) => {
        const [invoice] = await scopedDb
          .select()
          .from(invoices)
          .where(
            and(
              eq(invoices.id, id),
              eq(invoices.tenantId, tenantId),
              eq(invoices.customerId, customerId)
            )
          );
        if (!invoice) return null;

        const lines = await scopedDb
          .select()
          .from(invoiceLines)
          .where(eq(invoiceLines.invoiceId, id));
        return { ...invoice, lines };
      });
      if (!result) throw new NotFoundError('Order', id);

      return reply.code(200).send({ data: result });
    }
  );

  // Ticket routes (/portal/tickets*) moved to crm-service's own portal.routes.ts — CRM/O2C
  // split, migration 12.

  // ── GET /portal/loyalty ───────────────────────────────────────────────────
  // CRM/O2C split — getBalance moved to crm-service; reaches it over HTTP now, same
  // x-internal-key + circuit-breaker pattern as customer-360.routes.ts's fetchHealthPredictions.
  // Not part of a Promise.allSettled composition (this is a single-purpose endpoint), so a
  // failed/circuit-open call propagates as a normal error response instead of degrading.
  fastify.get('/portal/loyalty', { preHandler: [requirePortalAuth] }, async (request, reply) => {
    const { tenantId, customerId } = request.portalAuth;
    const crmServiceUrl = process.env['CRM_SERVICE_URL'] ?? 'http://localhost:3026';
    const internalKey = process.env['INTERNAL_API_KEY'] ?? '';
    const balance = await loyaltyBalanceBreaker.fire(
      crmServiceUrl,
      internalKey,
      tenantId,
      customerId
    );
    return reply.code(200).send({ data: balance });
  });

  // Referral routes (/portal/referral) moved to crm-service's own portal.routes.ts —
  // CRM/O2C split, migration 12.

  // ── GET /portal/preferences ───────────────────────────────────────────────
  fastify.get(
    '/portal/preferences',
    { preHandler: [requirePortalAuth] },
    async (request, reply) => {
      const { tenantId, customerId } = request.portalAuth;
      const rows = await withTenantConnection(db, tenantId, (scopedDb) =>
        scopedDb
          .select()
          .from(customerCommunicationPreferences)
          .where(
            and(
              eq(customerCommunicationPreferences.customerId, customerId),
              eq(customerCommunicationPreferences.tenantId, tenantId)
            )
          )
      );
      return reply.code(200).send({ data: { content: rows, totalElements: rows.length } });
    }
  );

  // ── PUT /portal/preferences ───────────────────────────────────────────────
  fastify.put(
    '/portal/preferences',
    { preHandler: [requirePortalAuth] },
    async (request, reply) => {
      const { tenantId, customerId } = request.portalAuth;

      const body = PreferencesSchema.safeParse(request.body);
      if (!body.success)
        throw new ValidationError(body.error.errors.map((e) => e.message).join('; '));

      const saved = await withTenantConnection(db, tenantId, (scopedDb) =>
        Promise.all(
          body.data.preferences.map(async (pref) => {
            const [row] = await scopedDb
              .insert(customerCommunicationPreferences)
              .values({
                tenantId,
                customerId,
                channel: pref.channel,
                category: pref.category,
                consented: pref.consented,
                consentSource: 'CUSTOMER_PORTAL',
                consentRecordedAt: new Date(),
                updatedAt: new Date(),
              })
              .onConflictDoUpdate({
                target: [
                  customerCommunicationPreferences.tenantId,
                  customerCommunicationPreferences.customerId,
                  customerCommunicationPreferences.channel,
                  customerCommunicationPreferences.category,
                ],
                set: {
                  consented: pref.consented,
                  consentSource: 'CUSTOMER_PORTAL',
                  consentRecordedAt: new Date(),
                  updatedAt: new Date(),
                },
              })
              .returning();
            return row;
          })
        )
      );

      return reply.code(200).send({ data: { content: saved, totalElements: saved.length } });
    }
  );
}
