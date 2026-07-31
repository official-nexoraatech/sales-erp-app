import type { FastifyInstance } from 'fastify';
import type { PlatformContextFactory } from '@erp/sdk';
import { z } from 'zod';
import { ValidationError } from '@erp/types';
import { PERMISSIONS } from '@erp/types';
import { authenticate } from '../middleware/authenticate.js';
import { requirePermission, requireAnyPermission } from '../middleware/authorize.js';
import { CallService } from '../domain/CallService.js';

// CRM-ROADMAP Phase 4, Feature 7 — CTI / Call Center Integration. CALL_INITIATE gates a rep
// dialing out; CALL_LOG_VIEW gates viewing call history (including any recording URL) — split
// the same way QUOTA_VALUE_VIEW is split from QUOTA_MANAGE, since a recording is materially more
// sensitive than "a call happened."

const InitiateCallSchema = z.object({
  customerId: z.number().int().positive().optional(),
  toNumber: z.string().min(6).max(20),
});

const NotesSchema = z.object({ notes: z.string().max(2000) });

type AuthedRequest = { auth: { tenantId: number; userId: number; permissions: string[] } };

function canViewAll(permissions: string[]): boolean {
  return permissions.includes(PERMISSIONS.CALL_LOG_VIEW);
}

export async function callRoutes(
  fastify: FastifyInstance,
  ctxFactory: PlatformContextFactory
): Promise<void> {
  fastify.post(
    '/calls/initiate',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.CALL_INITIATE)] },
    async (request, reply) => {
      const { tenantId, userId } = (request as unknown as AuthedRequest).auth;
      const ctx = ctxFactory.create({
        tenantId,
        userId,
        correlationId: (request.headers['x-correlation-id'] as string) ?? crypto.randomUUID(),
      });
      const body = InitiateCallSchema.safeParse(request.body);
      if (!body.success)
        throw new ValidationError(body.error.errors.map((e) => e.message).join('; '));

      const call = await CallService.initiateCall(ctx.db.raw, tenantId, userId, body.data);

      await ctx.audit.log({
        action: 'CREATE',
        entityType: 'crm_call_log',
        entityId: call.id,
        after: call as unknown as Record<string, unknown>,
      });
      return reply.code(201).send({ data: call });
    }
  );

  fastify.get(
    '/calls',
    {
      preHandler: [
        authenticate,
        requireAnyPermission([PERMISSIONS.CALL_INITIATE, PERMISSIONS.CALL_LOG_VIEW]),
      ],
    },
    async (request, reply) => {
      const { tenantId, userId, permissions } = (request as unknown as AuthedRequest).auth;
      const ctx = ctxFactory.create({
        tenantId,
        userId: 0,
        correlationId: (request.headers['x-correlation-id'] as string) ?? crypto.randomUUID(),
      });
      const query = request.query as { customerId?: string };
      const rows = await CallService.listCalls(
        ctx.db.raw,
        tenantId,
        { canViewAll: canViewAll(permissions), callerId: userId },
        { ...(query.customerId ? { customerId: parseInt(query.customerId, 10) } : {}) }
      );
      return reply.code(200).send({ data: { content: rows, totalElements: rows.length } });
    }
  );

  fastify.put<{ Params: { id: string } }>(
    '/calls/:id/notes',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.CALL_INITIATE)] },
    async (request, reply) => {
      const { tenantId, userId } = (request as unknown as AuthedRequest).auth;
      const ctx = ctxFactory.create({
        tenantId,
        userId,
        correlationId: (request.headers['x-correlation-id'] as string) ?? crypto.randomUUID(),
      });
      const id = parseInt(request.params.id, 10);
      const body = NotesSchema.safeParse(request.body);
      if (!body.success)
        throw new ValidationError(body.error.errors.map((e) => e.message).join('; '));

      const updated = await CallService.addNotes(ctx.db.raw, tenantId, userId, id, body.data.notes);
      return reply.code(200).send({ data: updated });
    }
  );
}
