import type { FastifyInstance } from 'fastify';
import type { ErpDatabase } from '@erp/db';
import { PERMISSIONS, ValidationError } from '@erp/types';
import { z } from 'zod';
import { authenticate } from '../middleware/authenticate.js';
import { requirePermission } from '../middleware/authorize.js';
import { ConversationService } from '../domain/ConversationService.js';
import type { ClaudeOrchestrator } from '../domain/ClaudeOrchestrator.js';

const SendMessageSchema = z.object({
  message: z.string().min(1).max(4000),
});

export async function copilotRoutes(
  fastify: FastifyInstance,
  db: ErpDatabase,
  orchestrator: ClaudeOrchestrator
): Promise<void> {
  const conversations = new ConversationService(db);

  fastify.addHook('preHandler', authenticate);

  // Identity-scoped to the caller's own conversations, gated by COPILOT_VIEW to access the
  // feature at all — same "who can use it" vs "what can it read" split documented in
  // ToolRegistry.ts's header comment.
  fastify.get('/copilot/conversations', {
    preHandler: requirePermission(PERMISSIONS.COPILOT_VIEW),
    handler: async (req, reply) => {
      const rows = await conversations.listForUser(req.auth.tenantId, req.auth.userId);
      return reply.send({ data: { content: rows, totalElements: rows.length } });
    },
  });

  fastify.get<{ Params: { id: string } }>('/copilot/conversations/:id/messages', {
    preHandler: requirePermission(PERMISSIONS.COPILOT_VIEW),
    handler: async (req, reply) => {
      const conversationId = Number(req.params.id);
      await conversations.getOrCreate(req.auth.tenantId, req.auth.userId, conversationId); // 404s if not the caller's own
      const rows = await conversations.getHistory(conversationId, req.auth.tenantId);
      return reply.send({ data: { content: rows, totalElements: rows.length } });
    },
  });

  // POST /copilot/conversations/:id/messages — :id may be "new" to start a fresh conversation.
  fastify.post<{ Params: { id: string }; Body: { message: string } }>(
    '/copilot/conversations/:id/messages',
    {
      preHandler: requirePermission(PERMISSIONS.COPILOT_USE),
      handler: async (req, reply) => {
        const body = SendMessageSchema.safeParse(req.body);
        if (!body.success)
          throw new ValidationError(body.error.errors.map((e) => e.message).join('; '));

        const conversation = await conversations.getOrCreate(
          req.auth.tenantId,
          req.auth.userId,
          req.params.id === 'new' ? undefined : Number(req.params.id)
        );

        const authHeader = req.headers.authorization;
        const userJwt = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : '';

        const result = await orchestrator.sendMessage({
          tenantId: req.auth.tenantId,
          userId: req.auth.userId,
          userJwt,
          conversationId: conversation.id,
          userMessage: body.data.message,
        });

        return reply.send({ data: result });
      },
    }
  );
}
