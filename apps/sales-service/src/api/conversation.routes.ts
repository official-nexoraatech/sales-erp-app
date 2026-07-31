import type { FastifyInstance } from 'fastify';
import type { PlatformContextFactory } from '@erp/sdk';
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
  channel: z.enum(['WHATSAPP', 'SMS', 'EMAIL']).optional(),
});

export async function conversationRoutes(
  fastify: FastifyInstance,
  ctxFactory: PlatformContextFactory
): Promise<void> {
  fastify.addHook('preHandler', authenticate);

  fastify.get(
    '/conversations',
    { preHandler: requirePermission(PERMISSIONS.CONVERSATION_VIEW) },
    async (request, reply) => {
      const { tenantId, userId } = (request as unknown as AuthedRequest).auth;
      const ctx = ctxFactory.create({
        tenantId,
        userId,
        correlationId: (request.headers['x-correlation-id'] as string) ?? crypto.randomUUID(),
      });
      const query = request.query as { status?: 'OPEN' | 'ASSIGNED' | 'CLOSED'; mine?: string };
      const conversations = await ConversationService.listConversations(ctx.db.raw, tenantId, {
        status: query.status,
        assignedTo: query.mine === 'true' ? userId : undefined,
      });
      return reply.send({ data: { content: conversations, totalElements: conversations.length } });
    }
  );

  fastify.get<{ Params: { id: string } }>(
    '/conversations/:id',
    { preHandler: requirePermission(PERMISSIONS.CONVERSATION_VIEW) },
    async (request, reply) => {
      const { tenantId, userId } = (request as unknown as AuthedRequest).auth;
      const ctx = ctxFactory.create({
        tenantId,
        userId,
        correlationId: (request.headers['x-correlation-id'] as string) ?? crypto.randomUUID(),
      });
      const conversationId = parseInt(request.params.id, 10);
      const conversation = await ConversationService.getConversation(
        ctx.db.raw,
        tenantId,
        conversationId
      );
      const messages = await ConversationService.listMessages(ctx.db.raw, tenantId, conversationId);
      await ConversationService.markRead(ctx.db.raw, tenantId, conversationId);
      return reply.send({ data: { ...conversation, messages } });
    }
  );

  fastify.post<{ Params: { id: string } }>(
    '/conversations/:id/messages',
    { preHandler: requirePermission(PERMISSIONS.CONVERSATION_REPLY) },
    async (request, reply) => {
      const { tenantId, userId } = (request as unknown as AuthedRequest).auth;
      const conversationId = parseInt(request.params.id, 10);
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
    }
  );

  fastify.post<{ Params: { id: string } }>(
    '/conversations/:id/assign',
    { preHandler: requirePermission(PERMISSIONS.CONVERSATION_ASSIGN) },
    async (request, reply) => {
      const { tenantId, userId } = (request as unknown as AuthedRequest).auth;
      const conversationId = parseInt(request.params.id, 10);
      const body = AssignSchema.safeParse(request.body);
      if (!body.success)
        throw new ValidationError(body.error.errors.map((e) => e.message).join('; '));
      const ctx = ctxFactory.create({
        tenantId,
        userId,
        correlationId: (request.headers['x-correlation-id'] as string) ?? crypto.randomUUID(),
      });
      const conversation = await ConversationService.assign(
        ctx.db.raw,
        tenantId,
        conversationId,
        body.data.userId
      );
      return reply.send({ data: conversation });
    }
  );

  fastify.post<{ Params: { id: string } }>(
    '/conversations/:id/close',
    { preHandler: requirePermission(PERMISSIONS.CONVERSATION_ASSIGN) },
    async (request, reply) => {
      const { tenantId, userId } = (request as unknown as AuthedRequest).auth;
      const conversationId = parseInt(request.params.id, 10);
      const ctx = ctxFactory.create({
        tenantId,
        userId,
        correlationId: (request.headers['x-correlation-id'] as string) ?? crypto.randomUUID(),
      });
      const conversation = await ConversationService.close(ctx.db.raw, tenantId, conversationId);
      return reply.send({ data: conversation });
    }
  );

  fastify.get(
    '/canned-responses',
    { preHandler: requirePermission(PERMISSIONS.CONVERSATION_REPLY) },
    async (request, reply) => {
      const { tenantId, userId } = (request as unknown as AuthedRequest).auth;
      const ctx = ctxFactory.create({
        tenantId,
        userId,
        correlationId: (request.headers['x-correlation-id'] as string) ?? crypto.randomUUID(),
      });
      const responses = await ConversationService.listCannedResponses(ctx.db.raw, tenantId);
      return reply.send({ data: { content: responses, totalElements: responses.length } });
    }
  );

  fastify.post(
    '/canned-responses',
    { preHandler: requirePermission(PERMISSIONS.CONVERSATION_REPLY) },
    async (request, reply) => {
      const { tenantId, userId } = (request as unknown as AuthedRequest).auth;
      const body = CannedResponseCreateSchema.safeParse(request.body);
      if (!body.success)
        throw new ValidationError(body.error.errors.map((e) => e.message).join('; '));
      const ctx = ctxFactory.create({
        tenantId,
        userId,
        correlationId: (request.headers['x-correlation-id'] as string) ?? crypto.randomUUID(),
      });
      const response = await ConversationService.createCannedResponse(
        ctx.db.raw,
        tenantId,
        userId,
        body.data
      );
      return reply.code(201).send({ data: response });
    }
  );
}
