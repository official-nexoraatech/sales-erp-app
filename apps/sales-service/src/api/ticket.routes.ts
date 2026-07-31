import type { FastifyInstance } from 'fastify';
import type { PlatformContextFactory } from '@erp/sdk';
import { getBranchScope } from '@erp/sdk';
import { crmCsatResponses, crmTicketMessages, crmTickets } from '@erp/db';
import { and, desc, eq, inArray, isNull, or } from 'drizzle-orm';
import { z } from 'zod';
import { BusinessError, NotFoundError, OptimisticLockError, ValidationError } from '@erp/types';
import { PERMISSIONS } from '@erp/types';
import { authenticate } from '../middleware/authenticate.js';
import { requirePermission } from '../middleware/authorize.js';
import { TicketService } from '../domain/TicketService.js';

// CRM-ROADMAP Phase 1, Feature 4 — Support & Ticketing.

const TICKET_TYPES = ['COMPLAINT', 'INQUIRY', 'RETURN_REQUEST', 'OTHER'] as const;
const PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'] as const;
const STATUSES = ['OPEN', 'IN_PROGRESS', 'WAITING_ON_CUSTOMER', 'RESOLVED', 'CLOSED'] as const;

const TicketCreateSchema = z.object({
  customerId: z.number().int().positive(),
  subject: z.string().min(2).max(300),
  description: z.string().max(5000).optional(),
  ticketType: z.enum(TICKET_TYPES).default('OTHER'),
  priority: z.enum(PRIORITIES).default('MEDIUM'),
  branchId: z.number().int().positive().optional(),
  linkedInvoiceId: z.number().int().positive().optional(),
});

const TicketUpdateSchema = z.object({
  version: z.number().int().min(0),
  subject: z.string().min(2).max(300).optional(),
  description: z.string().max(5000).optional(),
  ticketType: z.enum(TICKET_TYPES).optional(),
  priority: z.enum(PRIORITIES).optional(),
  status: z.enum(STATUSES).optional(),
  branchId: z.number().int().positive().optional(),
});

const AssignSchema = z.object({ userId: z.number().int().positive() });

// The critical security/privacy boundary in this feature — every message must explicitly
// declare visibility, never inferred/defaulted, so an internal note can never accidentally
// leak into the customer-visible thread.
const MessageSchema = z.object({
  visibility: z.enum(['INTERNAL', 'CUSTOMER_VISIBLE']),
  body: z.string().min(1).max(5000),
});

const CsatSchema = z.object({
  rating: z.number().int().min(1).max(5),
  comment: z.string().max(2000).optional(),
});

type AuthedRequest = {
  auth: {
    tenantId: number;
    userId: number;
    email: string;
    permissions: string[];
    branchIds: number[];
  };
};

function branchInScope(
  auth: { permissions: string[]; branchIds: number[] },
  branchId: number
): boolean {
  const scope = getBranchScope(auth);
  return scope === 'all' || scope.includes(branchId);
}

export async function ticketRoutes(
  fastify: FastifyInstance,
  ctxFactory: PlatformContextFactory
): Promise<void> {
  // ── GET /tickets — inbox list ────────────────────────────────────────────────
  fastify.get(
    '/tickets',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.TICKET_VIEW)] },
    async (request, reply) => {
      const { tenantId, userId, permissions, branchIds } = (request as unknown as AuthedRequest)
        .auth;
      const ctx = ctxFactory.create({
        tenantId,
        userId,
        correlationId: (request.headers['x-correlation-id'] as string) ?? crypto.randomUUID(),
      });
      const query = request.query as { status?: string; mine?: string; customerId?: string };

      let whereClause = eq(crmTickets.tenantId, tenantId);
      if (query.status) {
        whereClause = and(
          whereClause,
          eq(crmTickets.status, query.status as (typeof STATUSES)[number])
        )!;
      }
      if (query.mine === 'true') {
        whereClause = and(whereClause, eq(crmTickets.assignedTo, userId))!;
      }
      if (query.customerId) {
        whereClause = and(whereClause, eq(crmTickets.customerId, parseInt(query.customerId, 10)))!;
      }

      const branchScope = getBranchScope({ permissions, branchIds });
      if (branchScope !== 'all') {
        whereClause = and(
          whereClause,
          or(isNull(crmTickets.branchId), inArray(crmTickets.branchId, branchScope))
        )!;
      }

      const rows = await ctx.db.raw
        .select()
        .from(crmTickets)
        .where(whereClause)
        .orderBy(desc(crmTickets.createdAt));
      return reply.code(200).send({ data: { content: rows, totalElements: rows.length } });
    }
  );

  // ── GET /tickets/:id ─────────────────────────────────────────────────────────
  fastify.get<{ Params: { id: string } }>(
    '/tickets/:id',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.TICKET_VIEW)] },
    async (request, reply) => {
      const { tenantId, userId } = (request as unknown as AuthedRequest).auth;
      const ctx = ctxFactory.create({
        tenantId,
        userId,
        correlationId: (request.headers['x-correlation-id'] as string) ?? crypto.randomUUID(),
      });
      const id = parseInt(request.params.id, 10);
      const [ticket] = await ctx.db.raw
        .select()
        .from(crmTickets)
        .where(and(eq(crmTickets.id, id), eq(crmTickets.tenantId, tenantId)));
      if (!ticket) throw new NotFoundError('CrmTicket', id);
      return reply.code(200).send({ data: ticket });
    }
  );

  // ── POST /tickets ────────────────────────────────────────────────────────────
  fastify.post(
    '/tickets',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.TICKET_CREATE)] },
    async (request, reply) => {
      const { tenantId, userId, permissions, branchIds } = (request as unknown as AuthedRequest)
        .auth;
      const ctx = ctxFactory.create({
        tenantId,
        userId,
        correlationId: (request.headers['x-correlation-id'] as string) ?? crypto.randomUUID(),
      });
      const body = TicketCreateSchema.safeParse(request.body);
      if (!body.success)
        throw new ValidationError(body.error.errors.map((e) => e.message).join('; '));

      if (body.data.branchId && !branchInScope({ permissions, branchIds }, body.data.branchId)) {
        throw new BusinessError('BRANCH_OUT_OF_SCOPE', 'Cannot create a ticket for that branch');
      }

      const created = await TicketService.create(ctx.db.raw, {
        tenantId,
        createdBy: userId,
        ...body.data,
      });

      await ctx.audit.log({
        action: 'CREATE',
        entityType: 'crm_ticket',
        entityId: created.id,
        after: created as unknown as Record<string, unknown>,
      });
      await ctx.events.publish(
        'crm_ticket',
        created.id,
        'TICKET_CREATED',
        created as unknown as Record<string, unknown>
      );

      return reply.code(201).send({ data: created });
    }
  );

  // ── PUT /tickets/:id ─────────────────────────────────────────────────────────
  fastify.put<{ Params: { id: string } }>(
    '/tickets/:id',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.TICKET_UPDATE)] },
    async (request, reply) => {
      const { tenantId, userId } = (request as unknown as AuthedRequest).auth;
      const ctx = ctxFactory.create({
        tenantId,
        userId,
        correlationId: (request.headers['x-correlation-id'] as string) ?? crypto.randomUUID(),
      });
      const id = parseInt(request.params.id, 10);
      const body = TicketUpdateSchema.safeParse(request.body);
      if (!body.success)
        throw new ValidationError(body.error.errors.map((e) => e.message).join('; '));

      const [existing] = await ctx.db.raw
        .select()
        .from(crmTickets)
        .where(and(eq(crmTickets.id, id), eq(crmTickets.tenantId, tenantId)));
      if (!existing) throw new NotFoundError('CrmTicket', id);
      if (existing.status === 'CLOSED') {
        throw new BusinessError(
          'TICKET_CLOSED',
          'A Closed ticket cannot be edited — reopen it first'
        );
      }
      if (body.data.status === 'CLOSED' && existing.status !== 'RESOLVED') {
        throw new BusinessError(
          'MUST_RESOLVE_FIRST',
          'A ticket must be Resolved before it can be Closed'
        );
      }

      const now = new Date();
      const [updated] = await ctx.db.raw
        .update(crmTickets)
        .set({
          subject: body.data.subject,
          description: body.data.description,
          ticketType: body.data.ticketType,
          priority: body.data.priority,
          branchId: body.data.branchId,
          status: body.data.status,
          resolvedAt: body.data.status === 'RESOLVED' ? now : undefined,
          closedAt: body.data.status === 'CLOSED' ? now : undefined,
          updatedAt: now,
          version: existing.version + 1,
        } as unknown as Partial<typeof crmTickets.$inferInsert>)
        .where(
          and(
            eq(crmTickets.id, id),
            eq(crmTickets.tenantId, tenantId),
            eq(crmTickets.version, body.data.version)
          )
        )
        .returning();
      if (!updated) throw new OptimisticLockError('CrmTicket');

      await ctx.audit.log({
        action: 'UPDATE',
        entityType: 'crm_ticket',
        entityId: id,
        before: existing as unknown as Record<string, unknown>,
        after: updated as unknown as Record<string, unknown>,
        actorEmail: (request as unknown as AuthedRequest).auth.email,
      });
      if (body.data.status === 'RESOLVED') {
        await ctx.events.publish(
          'crm_ticket',
          id,
          'TICKET_RESOLVED',
          updated as unknown as Record<string, unknown>
        );
      }

      return reply.code(200).send({ data: updated });
    }
  );

  // ── POST /tickets/:id/assign ───────────────────────────────────────────────
  fastify.post<{ Params: { id: string } }>(
    '/tickets/:id/assign',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.TICKET_ASSIGN)] },
    async (request, reply) => {
      const { tenantId, userId } = (request as unknown as AuthedRequest).auth;
      const ctx = ctxFactory.create({
        tenantId,
        userId,
        correlationId: (request.headers['x-correlation-id'] as string) ?? crypto.randomUUID(),
      });
      const id = parseInt(request.params.id, 10);
      const body = AssignSchema.safeParse(request.body);
      if (!body.success)
        throw new ValidationError(body.error.errors.map((e) => e.message).join('; '));

      const [existing] = await ctx.db.raw
        .select()
        .from(crmTickets)
        .where(and(eq(crmTickets.id, id), eq(crmTickets.tenantId, tenantId)));
      if (!existing) throw new NotFoundError('CrmTicket', id);

      const [updated] = await ctx.db.raw
        .update(crmTickets)
        .set({ assignedTo: body.data.userId, updatedAt: new Date() })
        .where(eq(crmTickets.id, id))
        .returning();

      await ctx.audit.log({
        action: 'UPDATE',
        entityType: 'crm_ticket',
        entityId: id,
        before: { assignedTo: existing.assignedTo },
        after: { assignedTo: body.data.userId },
        changedFields: ['assignedTo'],
      });
      await ctx.events.publish('crm_ticket', id, 'TICKET_ASSIGNED', {
        ticketId: id,
        assignedTo: body.data.userId,
      });

      return reply.code(200).send({ data: updated });
    }
  );

  // ── POST /tickets/:id/reopen ───────────────────────────────────────────────
  fastify.post<{ Params: { id: string } }>(
    '/tickets/:id/reopen',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.TICKET_UPDATE)] },
    async (request, reply) => {
      const { tenantId, userId, email } = (request as unknown as AuthedRequest).auth;
      const ctx = ctxFactory.create({
        tenantId,
        userId,
        correlationId: (request.headers['x-correlation-id'] as string) ?? crypto.randomUUID(),
      });
      const id = parseInt(request.params.id, 10);
      const updated = await TicketService.reopen(ctx.db.raw, tenantId, id, userId, email);

      await ctx.audit.log({
        action: 'UPDATE',
        entityType: 'crm_ticket',
        entityId: id,
        after: { status: updated.status, reopenedCount: updated.reopenedCount },
      });

      return reply.code(200).send({ data: updated });
    }
  );

  // ── Ticket Messages ────────────────────────────────────────────────────────
  fastify.get<{ Params: { id: string } }>(
    '/tickets/:id/messages',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.TICKET_VIEW)] },
    async (request, reply) => {
      const { tenantId, userId } = (request as unknown as AuthedRequest).auth;
      const ctx = ctxFactory.create({
        tenantId,
        userId,
        correlationId: (request.headers['x-correlation-id'] as string) ?? crypto.randomUUID(),
      });
      const id = parseInt(request.params.id, 10);
      const rows = await ctx.db.raw
        .select()
        .from(crmTicketMessages)
        .where(and(eq(crmTicketMessages.ticketId, id), eq(crmTicketMessages.tenantId, tenantId)))
        .orderBy(crmTicketMessages.createdAt);
      return reply.code(200).send({ data: { content: rows, totalElements: rows.length } });
    }
  );

  fastify.post<{ Params: { id: string } }>(
    '/tickets/:id/messages',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.TICKET_UPDATE)] },
    async (request, reply) => {
      const { tenantId, userId, email } = (request as unknown as AuthedRequest).auth;
      const ctx = ctxFactory.create({
        tenantId,
        userId,
        correlationId: (request.headers['x-correlation-id'] as string) ?? crypto.randomUUID(),
      });
      const id = parseInt(request.params.id, 10);
      const body = MessageSchema.safeParse(request.body);
      if (!body.success)
        throw new ValidationError(body.error.errors.map((e) => e.message).join('; '));

      const [existing] = await ctx.db.raw
        .select({ id: crmTickets.id })
        .from(crmTickets)
        .where(and(eq(crmTickets.id, id), eq(crmTickets.tenantId, tenantId)));
      if (!existing) throw new NotFoundError('CrmTicket', id);

      const created = await TicketService.addMessage(
        ctx.db.raw,
        tenantId,
        id,
        userId,
        email,
        body.data.visibility,
        body.data.body
      );

      return reply.code(201).send({ data: created });
    }
  );

  // ── POST /tickets/:id/csat ───────────────────────────────────────────────────
  fastify.post<{ Params: { id: string } }>(
    '/tickets/:id/csat',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.TICKET_RESOLVE)] },
    async (request, reply) => {
      const { tenantId, userId } = (request as unknown as AuthedRequest).auth;
      const ctx = ctxFactory.create({
        tenantId,
        userId,
        correlationId: (request.headers['x-correlation-id'] as string) ?? crypto.randomUUID(),
      });
      const id = parseInt(request.params.id, 10);
      const body = CsatSchema.safeParse(request.body);
      if (!body.success)
        throw new ValidationError(body.error.errors.map((e) => e.message).join('; '));

      const [existing] = await ctx.db.raw
        .select({ id: crmTickets.id })
        .from(crmTickets)
        .where(and(eq(crmTickets.id, id), eq(crmTickets.tenantId, tenantId)));
      if (!existing) throw new NotFoundError('CrmTicket', id);

      const [alreadyRecorded] = await ctx.db.raw
        .select({ id: crmCsatResponses.id })
        .from(crmCsatResponses)
        .where(eq(crmCsatResponses.ticketId, id));
      if (alreadyRecorded) {
        throw new BusinessError(
          'CSAT_ALREADY_RECORDED',
          'CSAT has already been recorded for this ticket'
        );
      }

      const created = await TicketService.recordCsat(
        ctx.db.raw,
        tenantId,
        id,
        userId,
        body.data.rating,
        body.data.comment
      );

      return reply.code(201).send({ data: created });
    }
  );
}
