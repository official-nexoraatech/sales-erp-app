import type { FastifyInstance } from 'fastify';
import type { ErpDatabase } from '@erp/db';
import { withTenantConnection } from '@erp/sdk';
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
  fastify.addHook('preHandler', authenticate);

  // Phase 9 GUC-per-request rollout — migrated 2026-08-21. This service has no
  // PlatformContextFactory (main.ts passes a plain pool-level `db` straight to this route file),
  // so there's no `ctx` to build via tenantScopedHandler — withTenantConnection is used directly
  // instead, scoped per request via a real, short-lived transaction.
  //
  // Identity-scoped to the caller's own conversations, gated by COPILOT_VIEW to access the
  // feature at all — same "who can use it" vs "what can it read" split documented in
  // ToolRegistry.ts's header comment.
  fastify.get('/copilot/conversations', {
    preHandler: requirePermission(PERMISSIONS.COPILOT_VIEW),
    handler: async (req, reply) => {
      const rows = await withTenantConnection(db, req.auth.tenantId, (scopedDb) =>
        new ConversationService(scopedDb).listForUser(req.auth.tenantId, req.auth.userId)
      );
      return reply.send({ data: { content: rows, totalElements: rows.length } });
    },
  });

  fastify.get<{ Params: { id: string } }>('/copilot/conversations/:id/messages', {
    preHandler: requirePermission(PERMISSIONS.COPILOT_VIEW),
    handler: async (req, reply) => {
      const conversationId = Number(req.params.id);
      const rows = await withTenantConnection(db, req.auth.tenantId, async (scopedDb) => {
        const conversations = new ConversationService(scopedDb);
        await conversations.getOrCreate(req.auth.tenantId, req.auth.userId, conversationId); // 404s if not the caller's own
        return conversations.getHistory(conversationId, req.auth.tenantId);
      });
      return reply.send({ data: { content: rows, totalElements: rows.length } });
    },
  });

  // POST /copilot/conversations/:id/messages — :id may be "new" to start a fresh conversation.
  // Deliberately NOT wrapped in withTenantConnection/a transaction: orchestrator.sendMessage()
  // makes real, potentially multi-second (agentic tool-use loop) calls to the Anthropic API
  // between its own DB reads/writes. Holding a Postgres transaction (and its connection) open for
  // the duration of an external LLM call is a serious production risk (connection-pool
  // exhaustion, lock contention) — worse than the GUC gap this migration closes elsewhere. This
  // route's own DB calls (inside ConversationService/ClaudeOrchestrator) remain on the plain pool
  // connection for now; correctly closing the gap here needs each individual short DB call
  // scoped on its own, not the whole handler — a follow-up, not something to force in here. See
  // 23-guc-per-request-rollout-checklist.md's "external I/O mid-handler" caveat.
  fastify.post<{ Params: { id: string }; Body: { message: string } }>(
    '/copilot/conversations/:id/messages',
    {
      preHandler: requirePermission(PERMISSIONS.COPILOT_USE),
      handler: async (req, reply) => {
        const body = SendMessageSchema.safeParse(req.body);
        if (!body.success)
          throw new ValidationError(body.error.errors.map((e) => e.message).join('; '));

        const conversations = new ConversationService(db);
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
