/* global crypto */
import type { FastifyInstance } from 'fastify';
import type { PlatformContextFactory } from '@erp/sdk';
import { tenantScopedHandler } from '@erp/sdk';
import { z } from 'zod';
import { PERMISSIONS, ValidationError } from '@erp/types';
import { authenticate } from '../middleware/authenticate.js';
import { requirePermission } from '../middleware/authorize.js';
import { ConversationService } from '../domain/ConversationService.js';

type AuthedRequest = {
  auth: { tenantId: number; userId: number; permissions: string[]; branchIds: number[] };
};

const ReplySchema = z.object({
  body: z.string().min(1).max(4000),
});

const AssignSchema = z.object({
  userId: z.number().int().positive(),
});

const CannedResponseCreateSchema = z.object({
  title: z.string().min(1).max(200),
  body: z.string().min(1).max(4000),
  channel: z.enum(['WHATSAPP', 'SMS', 'EMAIL', 'INSTAGRAM']).optional(),
});

// CRM/O2C split — was a single fastify.addHook('preHandler', authenticate) on the whole file in
// sales-service; converted to per-route [authenticate, requirePermission(...)] arrays here
// since crm-service registers every route file on one shared `sub` instance with no file-level
// hook of its own (unlike sales-service's main.ts) — an addHook here would leak onto every
// sibling route registered after this one in that same block, including the genuinely public
// leadRoutes/linkTrackingRoutes.
//
// Phase 9 GUC-per-request rollout — migrated 2026-08-21 (all but one route).
// POST /conversations/:id/messages is deliberately NOT migrated: ConversationService
// .sendOutboundReply() awaits a real fetch() to notification-service after its own DB writes
// (checklist caveat 4 — this one is actually awaited, unlike customer.routes.ts's fire-and-forget
// sendPortalInviteEmail(), so caveat 4c doesn't apply here). Every other route has no external
// I/O.
export async function conversationRoutes(
  fastify: FastifyInstance,
  ctxFactory: PlatformContextFactory
): Promise<void> {
  fastify.get(
    '/conversations',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.CONVERSATION_VIEW)] },
    tenantScopedHandler(ctxFactory, async (request, reply, ctx) => {
      const query = request.query as { status?: 'OPEN' | 'ASSIGNED' | 'CLOSED'; mine?: string };
      const conversations = await ConversationService.listConversations(
        ctx.db.raw,
        ctx.tenant.tenantId,
        {
          status: query.status,
          assignedTo: query.mine === 'true' ? ctx.tenant.userId : undefined,
        }
      );
      return reply.send({ data: { content: conversations, totalElements: conversations.length } });
    })
  );

  fastify.get(
    '/conversations/:id',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.CONVERSATION_VIEW)] },
    tenantScopedHandler(ctxFactory, async (request, reply, ctx) => {
      const { id: idParam } = request.params as { id: string };
      const conversationId = parseInt(idParam, 10);
      const conversation = await ConversationService.getConversation(
        ctx.db.raw,
        ctx.tenant.tenantId,
        conversationId
      );
      const messages = await ConversationService.listMessages(
        ctx.db.raw,
        ctx.tenant.tenantId,
        conversationId
      );
      await ConversationService.markRead(ctx.db.raw, ctx.tenant.tenantId, conversationId);
      return reply.send({ data: { ...conversation, messages } });
    })
  );

  // Deliberately NOT migrated — ConversationService.sendOutboundReply() awaits a real fetch()
  // call to notification-service after its own DB writes.
  fastify.post('/conversations/:id/messages', {
    preHandler: [authenticate, requirePermission(PERMISSIONS.CONVERSATION_REPLY)],
    handler: async (request, reply) => {
      const { tenantId, userId } = (request as unknown as AuthedRequest).auth;
      const conversationId = parseInt((request.params as { id: string }).id, 10);
      const body = ReplySchema.safeParse(request.body);
      if (!body.success)
        throw new ValidationError(body.error.errors.map((e) => e.message).join('; '));
      const ctx = ctxFactory.create({
        tenantId,
        userId,
        correlationId: (request.headers['x-correlation-id'] as string) ?? crypto.randomUUID(),
      });
      const message = await ConversationService.sendOutboundReply(
        ctx.db.raw,
        tenantId,
        conversationId,
        body.data.body,
        userId
      );
      return reply.code(201).send({ data: message });
    },
  });

  fastify.post(
    '/conversations/:id/assign',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.CONVERSATION_ASSIGN)] },
    tenantScopedHandler(ctxFactory, async (request, reply, ctx) => {
      const { id: idParam } = request.params as { id: string };
      const conversationId = parseInt(idParam, 10);
      const body = AssignSchema.safeParse(request.body);
      if (!body.success)
        throw new ValidationError(body.error.errors.map((e) => e.message).join('; '));
      const conversation = await ConversationService.assign(
        ctx.db.raw,
        ctx.tenant.tenantId,
        conversationId,
        body.data.userId
      );
      return reply.send({ data: conversation });
    })
  );

  fastify.post(
    '/conversations/:id/close',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.CONVERSATION_ASSIGN)] },
    tenantScopedHandler(ctxFactory, async (request, reply, ctx) => {
      const { id: idParam } = request.params as { id: string };
      const conversationId = parseInt(idParam, 10);
      const conversation = await ConversationService.close(
        ctx.db.raw,
        ctx.tenant.tenantId,
        conversationId
      );
      return reply.send({ data: conversation });
    })
  );

  fastify.get(
    '/canned-responses',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.CONVERSATION_REPLY)] },
    tenantScopedHandler(ctxFactory, async (request, reply, ctx) => {
      const responses = await ConversationService.listCannedResponses(
        ctx.db.raw,
        ctx.tenant.tenantId
      );
      return reply.send({ data: { content: responses, totalElements: responses.length } });
    })
  );

  fastify.post(
    '/canned-responses',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.CONVERSATION_REPLY)] },
    tenantScopedHandler(ctxFactory, async (request, reply, ctx) => {
      const body = CannedResponseCreateSchema.safeParse(request.body);
      if (!body.success)
        throw new ValidationError(body.error.errors.map((e) => e.message).join('; '));
      const response = await ConversationService.createCannedResponse(
        ctx.db.raw,
        ctx.tenant.tenantId,
        ctx.tenant.userId,
        body.data
      );
      return reply.code(201).send({ data: response });
    })
  );
}
