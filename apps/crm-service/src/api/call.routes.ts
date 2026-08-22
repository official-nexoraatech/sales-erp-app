/* global crypto */
import type { FastifyInstance } from 'fastify';
import type { PlatformContextFactory } from '@erp/sdk';
import { tenantScopedHandler } from '@erp/sdk';
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

// Phase 9 GUC-per-request rollout — migrated 2026-08-21 (all but one route).
// POST /calls/initiate is deliberately NOT migrated: CallService.initiateCall() makes a real
// fetch() call to Twilio's REST API, interleaved with its own DB insert (checklist caveat 4).
// GET /calls (listCalls) and PUT /calls/:id/notes (addNotes) have no external I/O.
export async function callRoutes(
  fastify: FastifyInstance,
  ctxFactory: PlatformContextFactory
): Promise<void> {
  // Deliberately NOT migrated — CallService.initiateCall() fetches Twilio's REST API.
  fastify.post('/calls/initiate', {
    preHandler: [authenticate, requirePermission(PERMISSIONS.CALL_INITIATE)],
    handler: async (request, reply) => {
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
    },
  });

  fastify.get(
    '/calls',
    {
      preHandler: [
        authenticate,
        requireAnyPermission([PERMISSIONS.CALL_INITIATE, PERMISSIONS.CALL_LOG_VIEW]),
      ],
    },
    tenantScopedHandler(ctxFactory, async (request, reply, ctx) => {
      const { permissions } = (request as unknown as AuthedRequest).auth;
      const query = request.query as { customerId?: string };
      const rows = await CallService.listCalls(
        ctx.db.raw,
        ctx.tenant.tenantId,
        { canViewAll: canViewAll(permissions), callerId: ctx.tenant.userId },
        { ...(query.customerId ? { customerId: parseInt(query.customerId, 10) } : {}) }
      );
      return reply.code(200).send({ data: { content: rows, totalElements: rows.length } });
    })
  );

  fastify.put(
    '/calls/:id/notes',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.CALL_INITIATE)] },
    tenantScopedHandler(ctxFactory, async (request, reply, ctx) => {
      const { id: idParam } = request.params as { id: string };
      const id = parseInt(idParam, 10);
      const body = NotesSchema.safeParse(request.body);
      if (!body.success)
        throw new ValidationError(body.error.errors.map((e) => e.message).join('; '));

      const updated = await CallService.addNotes(
        ctx.db.raw,
        ctx.tenant.tenantId,
        ctx.tenant.userId,
        id,
        body.data.notes
      );
      return reply.code(200).send({ data: updated });
    })
  );
}
