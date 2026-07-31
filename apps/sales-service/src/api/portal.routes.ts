import type { FastifyInstance } from 'fastify';
import { and, desc, eq } from 'drizzle-orm';
import type { ErpDatabase } from '@erp/db';
import {
  customers,
  invoices,
  invoiceLines,
  crmTickets,
  crmTicketMessages,
  crmReferralRewards,
  customerCommunicationPreferences,
} from '@erp/db';
import { z } from 'zod';
import { NotFoundError, ValidationError } from '@erp/types';
import { requirePortalAuth } from '../middleware/portal-auth.js';
import { TicketService } from '../domain/TicketService.js';
import { LoyaltyService } from '../domain/LoyaltyService.js';
import { ReferralService } from '../domain/ReferralService.js';

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

const TicketCreateSchema = z.object({
  subject: z.string().min(2).max(300),
  description: z.string().max(5000).optional(),
  ticketType: z.enum(['COMPLAINT', 'INQUIRY', 'RETURN_REQUEST', 'OTHER']).default('OTHER'),
});

const TicketMessageSchema = z.object({
  body: z.string().min(1).max(5000),
});

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
    const [customer] = await db
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
    if (!customer) throw new NotFoundError('Customer', customerId);
    return reply.code(200).send({ data: customer });
  });

  // ── GET /portal/orders ───────────────────────────────────────────────────
  fastify.get('/portal/orders', { preHandler: [requirePortalAuth] }, async (request, reply) => {
    const { tenantId, customerId } = request.portalAuth;
    const rows = await db
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
      .limit(100);
    return reply.code(200).send({ data: { content: rows, totalElements: rows.length } });
  });

  // ── GET /portal/orders/:id ────────────────────────────────────────────────
  fastify.get<{ Params: { id: string } }>(
    '/portal/orders/:id',
    { preHandler: [requirePortalAuth] },
    async (request, reply) => {
      const { tenantId, customerId } = request.portalAuth;
      const id = parseInt(request.params.id, 10);

      const [invoice] = await db
        .select()
        .from(invoices)
        .where(
          and(
            eq(invoices.id, id),
            eq(invoices.tenantId, tenantId),
            eq(invoices.customerId, customerId)
          )
        );
      if (!invoice) throw new NotFoundError('Order', id);

      const lines = await db.select().from(invoiceLines).where(eq(invoiceLines.invoiceId, id));

      return reply.code(200).send({ data: { ...invoice, lines } });
    }
  );

  // ── GET /portal/tickets ───────────────────────────────────────────────────
  fastify.get('/portal/tickets', { preHandler: [requirePortalAuth] }, async (request, reply) => {
    const { tenantId, customerId } = request.portalAuth;
    const rows = await db
      .select()
      .from(crmTickets)
      .where(and(eq(crmTickets.customerId, customerId), eq(crmTickets.tenantId, tenantId)))
      .orderBy(desc(crmTickets.createdAt))
      .limit(100);
    return reply.code(200).send({ data: { content: rows, totalElements: rows.length } });
  });

  // ── POST /portal/tickets ──────────────────────────────────────────────────
  fastify.post('/portal/tickets', { preHandler: [requirePortalAuth] }, async (request, reply) => {
    const { tenantId, customerId, sub } = request.portalAuth;

    const body = TicketCreateSchema.safeParse(request.body);
    if (!body.success)
      throw new ValidationError(body.error.errors.map((e) => e.message).join('; '));

    const created = await TicketService.create(db, {
      tenantId,
      customerId,
      createdByPortalAccountId: parseInt(sub, 10),
      subject: body.data.subject,
      description: body.data.description,
      ticketType: body.data.ticketType,
    });

    return reply.code(201).send({ data: created });
  });

  // ── GET /portal/tickets/:id ────────────────────────────────────────────────
  fastify.get<{ Params: { id: string } }>(
    '/portal/tickets/:id',
    { preHandler: [requirePortalAuth] },
    async (request, reply) => {
      const { tenantId, customerId } = request.portalAuth;
      const id = parseInt(request.params.id, 10);

      const [ticket] = await db
        .select()
        .from(crmTickets)
        .where(
          and(
            eq(crmTickets.id, id),
            eq(crmTickets.tenantId, tenantId),
            eq(crmTickets.customerId, customerId)
          )
        );
      if (!ticket) throw new NotFoundError('Ticket', id);

      return reply.code(200).send({ data: ticket });
    }
  );

  // ── GET /portal/tickets/:id/messages ─────────────────────────────────────
  // Filtered to CUSTOMER_VISIBLE only — internal staff notes on the same ticket must never
  // reach this endpoint, whatever the caller sends.
  fastify.get<{ Params: { id: string } }>(
    '/portal/tickets/:id/messages',
    { preHandler: [requirePortalAuth] },
    async (request, reply) => {
      const { tenantId, customerId } = request.portalAuth;
      const id = parseInt(request.params.id, 10);

      const [ticket] = await db
        .select({ id: crmTickets.id })
        .from(crmTickets)
        .where(
          and(
            eq(crmTickets.id, id),
            eq(crmTickets.tenantId, tenantId),
            eq(crmTickets.customerId, customerId)
          )
        );
      if (!ticket) throw new NotFoundError('Ticket', id);

      const rows = await db
        .select()
        .from(crmTicketMessages)
        .where(
          and(
            eq(crmTicketMessages.ticketId, id),
            eq(crmTicketMessages.tenantId, tenantId),
            eq(crmTicketMessages.visibility, 'CUSTOMER_VISIBLE')
          )
        )
        .orderBy(crmTicketMessages.createdAt);

      return reply.code(200).send({ data: { content: rows, totalElements: rows.length } });
    }
  );

  // ── POST /portal/tickets/:id/messages ────────────────────────────────────
  fastify.post<{ Params: { id: string } }>(
    '/portal/tickets/:id/messages',
    { preHandler: [requirePortalAuth] },
    async (request, reply) => {
      const { tenantId, customerId } = request.portalAuth;
      const id = parseInt(request.params.id, 10);

      const body = TicketMessageSchema.safeParse(request.body);
      if (!body.success)
        throw new ValidationError(body.error.errors.map((e) => e.message).join('; '));

      const [ticket] = await db
        .select({ id: crmTickets.id })
        .from(crmTickets)
        .where(
          and(
            eq(crmTickets.id, id),
            eq(crmTickets.tenantId, tenantId),
            eq(crmTickets.customerId, customerId)
          )
        );
      if (!ticket) throw new NotFoundError('Ticket', id);

      const [customer] = await db
        .select({ displayName: customers.displayName })
        .from(customers)
        .where(and(eq(customers.id, customerId), eq(customers.tenantId, tenantId)));

      const created = await TicketService.addMessage(
        db,
        tenantId,
        id,
        null,
        customer?.displayName ?? 'Customer',
        'CUSTOMER_VISIBLE',
        body.data.body
      );

      return reply.code(201).send({ data: created });
    }
  );

  // ── GET /portal/loyalty ───────────────────────────────────────────────────
  fastify.get('/portal/loyalty', { preHandler: [requirePortalAuth] }, async (request, reply) => {
    const { tenantId, customerId } = request.portalAuth;
    const loyaltyService = new LoyaltyService(db);
    const balance = await loyaltyService.getBalance(customerId, tenantId);
    return reply.code(200).send({ data: balance });
  });

  // ── GET /portal/referral ──────────────────────────────────────────────────
  fastify.get('/portal/referral', { preHandler: [requirePortalAuth] }, async (request, reply) => {
    const { tenantId, customerId } = request.portalAuth;
    const code = await ReferralService.getOrCreateCode(db, tenantId, customerId);
    const rewards = await db
      .select()
      .from(crmReferralRewards)
      .where(
        and(
          eq(crmReferralRewards.referrerCustomerId, customerId),
          eq(crmReferralRewards.tenantId, tenantId)
        )
      )
      .orderBy(desc(crmReferralRewards.createdAt));
    return reply.code(200).send({ data: { code: code.code, rewards } });
  });

  // ── GET /portal/preferences ───────────────────────────────────────────────
  fastify.get(
    '/portal/preferences',
    { preHandler: [requirePortalAuth] },
    async (request, reply) => {
      const { tenantId, customerId } = request.portalAuth;
      const rows = await db
        .select()
        .from(customerCommunicationPreferences)
        .where(
          and(
            eq(customerCommunicationPreferences.customerId, customerId),
            eq(customerCommunicationPreferences.tenantId, tenantId)
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

      const saved = await Promise.all(
        body.data.preferences.map(async (pref) => {
          const [row] = await db
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
      );

      return reply.code(200).send({ data: { content: saved, totalElements: saved.length } });
    }
  );
}
