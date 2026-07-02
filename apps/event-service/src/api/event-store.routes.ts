import type { FastifyInstance } from 'fastify';
import type { PlatformContextFactory } from '@erp/sdk';
import { EventStoreService } from '@erp/sdk';
import { z } from 'zod';
import { PERMISSIONS } from '@erp/types';
import { authenticate } from '../middleware/authenticate.js';
import { requirePermission } from '../middleware/authorize.js';

const EventStoreQuerySchema = z.object({
  aggregateType: z.string().optional(),
  aggregateId: z.string().optional(),
  eventType: z.string().optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
  offset: z.coerce.number().int().min(0).default(0),
});

export async function eventStoreRoutes(
  fastify: FastifyInstance,
  ctxFactory: PlatformContextFactory
): Promise<void> {
  fastify.addHook('preHandler', authenticate);

  // GET /admin/events/store — query event store
  fastify.get('/admin/events/store', {
    preHandler: requirePermission(PERMISSIONS.AUDIT_LOG_VIEW),
    handler: async (request, reply) => {
      const parsed = EventStoreQuerySchema.safeParse(request.query);
      if (!parsed.success) {
        return reply.code(400).send({ error: { code: 'VALIDATION_ERROR', message: 'Invalid query parameters', details: parsed.error.flatten() } });
      }

      const q = parsed.data;
      const ctx = ctxFactory.create({ tenantId: request.auth.tenantId, userId: request.auth.userId, correlationId: (request.headers['x-correlation-id'] as string) ?? 'system' });

      const svc = new EventStoreService(ctx.db, request.auth.tenantId);
      const queryParams: Parameters<typeof svc.query>[0] = {
        limit: q.limit,
        offset: q.offset,
      };
      if (q.aggregateType) queryParams.aggregateType = q.aggregateType;
      if (q.aggregateId) queryParams.aggregateId = q.aggregateId;
      if (q.eventType) queryParams.eventType = q.eventType;
      if (q.from) queryParams.from = new Date(q.from);
      if (q.to) queryParams.to = new Date(q.to);
      const events = await svc.query(queryParams);

      return reply.code(200).send({ data: events });
    },
  });

  // POST /admin/events/replay/:aggregateType/:aggregateId — rebuild aggregate state
  fastify.post<{ Params: { aggregateType: string; aggregateId: string } }>(
    '/admin/events/replay/:aggregateType/:aggregateId',
    {
      preHandler: requirePermission(PERMISSIONS.AUDIT_LOG_VIEW),
      handler: async (request, reply) => {
        const { aggregateType, aggregateId } = request.params;
        if (!aggregateType || !aggregateId) {
          return reply.code(400).send({ error: { code: 'VALIDATION_ERROR', message: 'aggregateType and aggregateId are required' } });
        }

        const ctx = ctxFactory.create({ tenantId: request.auth.tenantId, userId: request.auth.userId, correlationId: (request.headers['x-correlation-id'] as string) ?? 'system' });
        const svc = new EventStoreService(ctx.db, request.auth.tenantId);
        const state = await svc.rebuild(aggregateType, aggregateId);

        return reply.code(200).send({ data: state });
      },
    }
  );
}
