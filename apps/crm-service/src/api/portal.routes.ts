import type { FastifyInstance } from 'fastify';
import { and, desc, eq } from 'drizzle-orm';
import type { ErpDatabase } from '@erp/db';
import { customers, crmTickets, crmTicketMessages, crmReferralRewards } from '@erp/db';
import { z } from 'zod';
import { NotFoundError, ValidationError } from '@erp/types';
import { requirePortalAuth } from '../middleware/portal-auth.js';
import { TicketService } from '../domain/TicketService.js';
import { ReferralService } from '../domain/ReferralService.js';

// CRM-ROADMAP Phase 3, Feature 2 (Self-Service Customer Portal) — CRM/O2C split, migration 12:
// the Ticket/Referral half of sales-service's original portal.routes.ts. The O2C half (me,
// orders, preferences, and the loyalty-balance HTTP bridge) stays in sales-service.
//
// Same "raw ErpDatabase handle, never PlatformContextFactory" discipline as the original file —
// see its own header comment (portal writes have no portal-account-shaped audit/event actor to
// attribute to). Every route filters customerId/tenantId ONLY from the verified JWT claim
// (request.portalAuth), never a URL/body field of the same name — an ownership mismatch always
// 404s, never 403s (a 403 would itself leak that the row exists for a different customer).

const TicketCreateSchema = z.object({
  subject: z.string().min(2).max(300),
  description: z.string().max(5000).optional(),
  ticketType: z.enum(['COMPLAINT', 'INQUIRY', 'RETURN_REQUEST', 'OTHER']).default('OTHER'),
});

const TicketMessageSchema = z.object({
  body: z.string().min(1).max(5000),
});

export async function portalRoutes(fastify: FastifyInstance, db: ErpDatabase): Promise<void> {
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
}
