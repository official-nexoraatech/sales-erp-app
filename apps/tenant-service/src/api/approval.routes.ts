import type { FastifyInstance } from 'fastify';
import type { ErpDatabase } from '@erp/db';
import { z } from 'zod';
import { ValidationError } from '@erp/types';
import { WorkflowEngine } from '@erp/sdk';
import { authenticate } from '../middleware/authenticate.js';

const ApproveSchema = z.object({
  comment: z.string().max(1000).optional(),
});

const RejectSchema = z.object({
  comment: z.string().min(5).max(1000),
});

export async function approvalRoutes(
  fastify: FastifyInstance,
  db: ErpDatabase
): Promise<void> {
  function getEngine(tenantId: number, userId: number, correlationId: string): WorkflowEngine {
    return new WorkflowEngine(db, tenantId, userId, correlationId);
  }

  // ── GET /approvals/pending — Pending approvals for current user ──────────
  fastify.get('/approvals/pending', { preHandler: [authenticate] }, async (request, reply) => {
    const { tenantId, userId } = request.auth;
    const engine = getEngine(tenantId, userId, 'n/a');
    const items = await engine.getPendingForApprover(userId);
    return reply.code(200).send({ data: { content: items, totalElements: items.length } });
  });

  // ── GET /approvals/:id/status — Get workflow instance status ─────────────
  fastify.get<{ Params: { id: string } }>('/approvals/:id/status', { preHandler: [authenticate] }, async (request, reply) => {
    const { tenantId, userId } = request.auth;
    const instanceId = parseInt(request.params.id, 10);
    const engine = getEngine(tenantId, userId, 'n/a');
    const status = await engine.getStatus(instanceId);
    return reply.code(200).send({ data: status });
  });

  // ── POST /approvals/:id/approve ──────────────────────────────────────────
  fastify.post<{ Params: { id: string } }>('/approvals/:id/approve', { preHandler: [authenticate] }, async (request, reply) => {
    const { tenantId, userId } = request.auth;
    const instanceId = parseInt(request.params.id, 10);

    const body = ApproveSchema.safeParse(request.body);
    if (!body.success) throw new ValidationError(body.error.errors.map((e) => e.message).join('; '));

    const reqBody = request.body as { nodeId?: string };
    const nodeId = reqBody.nodeId ?? 'node_1';

    const engine = getEngine(tenantId, userId, 'n/a');
    await engine.approve({ instanceId, nodeId, userId, ...(body.data.comment !== undefined ? { comment: body.data.comment } : {}) });
    return reply.code(200).send({ data: { message: 'Approved', instanceId } });
  });

  // ── POST /approvals/:id/reject ───────────────────────────────────────────
  fastify.post<{ Params: { id: string } }>('/approvals/:id/reject', { preHandler: [authenticate] }, async (request, reply) => {
    const { tenantId, userId } = request.auth;
    const instanceId = parseInt(request.params.id, 10);

    const body = RejectSchema.safeParse(request.body);
    if (!body.success) throw new ValidationError(body.error.errors.map((e) => e.message).join('; '));

    const reqBody = request.body as { nodeId?: string };
    const nodeId = reqBody.nodeId ?? 'node_1';

    const engine = getEngine(tenantId, userId, 'n/a');
    await engine.reject({ instanceId, nodeId, userId, comment: body.data.comment });
    return reply.code(200).send({ data: { message: 'Rejected', instanceId } });
  });
}
