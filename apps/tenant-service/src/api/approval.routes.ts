import type { FastifyInstance } from 'fastify';
import type { ErpDatabase } from '@erp/db';
import { z } from 'zod';
import { ValidationError } from '@erp/types';
import { WorkflowEngine, withTenantConnection } from '@erp/sdk';
import { authenticate } from '../middleware/authenticate.js';

const ApproveSchema = z.object({
  nodeId: z.string().min(1).max(100),
  comment: z.string().max(1000).optional(),
});

const RejectSchema = z.object({
  nodeId: z.string().min(1).max(100),
  comment: z.string().min(5).max(1000),
});

// Phase 9 GUC-per-request rollout — migrated 2026-08-21. No PlatformContextFactory in this
// service (plain db passed in), so each route uses withTenantConnection directly.
// WorkflowEngine.notifyUser() is always called as `void this.notifyUser(...)` at every call
// site (fire-and-forget, caveat 4c) — safe to migrate despite the fetch() inside it.
export async function approvalRoutes(fastify: FastifyInstance, db: ErpDatabase): Promise<void> {
  // ── GET /approvals/pending — Pending approvals for current user ──────────
  fastify.get('/approvals/pending', { preHandler: [authenticate] }, async (request, reply) => {
    const { tenantId, userId } = request.auth;
    const items = await withTenantConnection(db, tenantId, async (scopedDb) => {
      const engine = new WorkflowEngine(scopedDb, tenantId, userId, 'n/a');
      return engine.getPendingForApprover(userId);
    });
    return reply.code(200).send({ data: { content: items, totalElements: items.length } });
  });

  // ── GET /approvals/:id/status — Get workflow instance status ─────────────
  fastify.get<{ Params: { id: string } }>(
    '/approvals/:id/status',
    { preHandler: [authenticate] },
    async (request, reply) => {
      const { tenantId, userId } = request.auth;
      const instanceId = parseInt(request.params.id, 10);
      const status = await withTenantConnection(db, tenantId, async (scopedDb) => {
        const engine = new WorkflowEngine(scopedDb, tenantId, userId, 'n/a');
        return engine.getStatus(instanceId);
      });
      return reply.code(200).send({ data: status });
    }
  );

  // ── POST /approvals/:id/approve ──────────────────────────────────────────
  fastify.post<{ Params: { id: string } }>(
    '/approvals/:id/approve',
    { preHandler: [authenticate] },
    async (request, reply) => {
      const { tenantId, userId } = request.auth;
      const instanceId = parseInt(request.params.id, 10);

      const body = ApproveSchema.safeParse(request.body);
      if (!body.success)
        throw new ValidationError(body.error.errors.map((e) => e.message).join('; '));

      await withTenantConnection(db, tenantId, async (scopedDb) => {
        const engine = new WorkflowEngine(scopedDb, tenantId, userId, 'n/a');
        await engine.approve({
          instanceId,
          nodeId: body.data.nodeId,
          userId,
          ...(body.data.comment !== undefined ? { comment: body.data.comment } : {}),
        });
      });
      return reply.code(200).send({ data: { message: 'Approved', instanceId } });
    }
  );

  // ── POST /approvals/:id/reject ───────────────────────────────────────────
  fastify.post<{ Params: { id: string } }>(
    '/approvals/:id/reject',
    { preHandler: [authenticate] },
    async (request, reply) => {
      const { tenantId, userId } = request.auth;
      const instanceId = parseInt(request.params.id, 10);

      const body = RejectSchema.safeParse(request.body);
      if (!body.success)
        throw new ValidationError(body.error.errors.map((e) => e.message).join('; '));

      await withTenantConnection(db, tenantId, async (scopedDb) => {
        const engine = new WorkflowEngine(scopedDb, tenantId, userId, 'n/a');
        await engine.reject({
          instanceId,
          nodeId: body.data.nodeId,
          userId,
          comment: body.data.comment,
        });
      });
      return reply.code(200).send({ data: { message: 'Rejected', instanceId } });
    }
  );
}
