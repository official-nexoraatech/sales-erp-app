import type { FastifyInstance } from 'fastify';
import type { PlatformContextFactory, SagaOrchestrator } from '@erp/sdk';
import { sagaLog } from '@erp/db';
import { and, eq, sql, desc } from 'drizzle-orm';
import { z } from 'zod';
import { PERMISSIONS } from '@erp/types';
import { authenticate } from '../middleware/authenticate.js';
import { requirePermission } from '../middleware/authorize.js';

const SagaListSchema = z.object({
  status: z.enum(['STARTED', 'COMPLETED', 'COMPENSATING', 'COMPENSATED', 'FAILED']).optional(),
  sagaType: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  size: z.coerce.number().int().min(1).max(200).default(50),
});

export async function sagaRoutes(
  fastify: FastifyInstance,
  ctxFactory: PlatformContextFactory,
  registeredOrchestrator: SagaOrchestrator
): Promise<void> {
  fastify.addHook('preHandler', authenticate);

  // GET /admin/sagas/summary — counts by status and type
  fastify.get('/admin/sagas/summary', {
    preHandler: requirePermission(PERMISSIONS.SAGA_VIEW),
    handler: async (request, reply) => {
      const ctx = ctxFactory.create({
        tenantId: request.auth.tenantId,
        userId: request.auth.userId,
        correlationId: (request.headers['x-correlation-id'] as string) ?? 'system',
      });
      const db = ctx.db.raw;

      const statusCounts = await db.execute(
        sql`SELECT status, COUNT(*) as count FROM saga_log WHERE tenant_id = ${request.auth.tenantId} GROUP BY status`
      );

      const typeCounts = await db.execute(
        sql`SELECT saga_type, COUNT(*) as count FROM saga_log WHERE tenant_id = ${request.auth.tenantId} GROUP BY saga_type ORDER BY count DESC`
      );

      // Stalled: IN_PROGRESS for > 30 minutes
      const stalledRows = await db.execute(
        sql`SELECT COUNT(*) as count FROM saga_log WHERE tenant_id = ${request.auth.tenantId} AND status = 'STARTED' AND created_at < NOW() - INTERVAL '30 minutes'`
      );

      // Completed in last 24h
      const recentRows = await db.execute(
        sql`SELECT COUNT(*) as count, AVG(EXTRACT(EPOCH FROM (updated_at - created_at)) * 1000)::integer as avg_duration_ms FROM saga_log WHERE tenant_id = ${request.auth.tenantId} AND status = 'COMPLETED' AND updated_at > NOW() - INTERVAL '24 hours'`
      );

      const byStatus: Record<string, number> = {};
      for (const row of statusCounts as unknown as Array<{ status: string; count: string }>) {
        byStatus[row.status] = parseInt(row.count, 10);
      }

      const byType = (typeCounts as unknown as Array<{ saga_type: string; count: string }>).map(
        (r) => ({
          sagaType: r.saga_type,
          count: parseInt(r.count, 10),
        })
      );

      const stalled = parseInt((stalledRows[0] as { count: string }).count, 10);
      const recent = recentRows[0] as { count: string; avg_duration_ms: number | null };

      return reply.code(200).send({
        data: {
          byStatus,
          byType,
          stalled,
          completedLast24h: parseInt(recent.count, 10),
          avgDurationMs: recent.avg_duration_ms ?? 0,
        },
      });
    },
  });

  // GET /admin/sagas — list sagas with optional status filter
  fastify.get('/admin/sagas', {
    preHandler: requirePermission(PERMISSIONS.SAGA_VIEW),
    handler: async (request, reply) => {
      const parsed = SagaListSchema.safeParse(request.query);
      if (!parsed.success) {
        return reply.code(400).send({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid query params',
            details: parsed.error.flatten(),
          },
        });
      }

      const { status, sagaType, page, size } = parsed.data;
      const ctx = ctxFactory.create({
        tenantId: request.auth.tenantId,
        userId: request.auth.userId,
        correlationId: (request.headers['x-correlation-id'] as string) ?? 'system',
      });
      const db = ctx.db.raw;

      const conditions = [eq(sagaLog.tenantId, request.auth.tenantId)];
      if (status) conditions.push(eq(sagaLog.status, status));
      if (sagaType) conditions.push(eq(sagaLog.sagaType, sagaType));

      const rows = await db
        .select()
        .from(sagaLog)
        .where(and(...conditions))
        .orderBy(desc(sagaLog.updatedAt), desc(sagaLog.id))
        .limit(size)
        .offset((page - 1) * size);

      const totalRows = await db.execute(
        sql`SELECT COUNT(*) as count FROM saga_log WHERE tenant_id = ${request.auth.tenantId} ${status ? sql`AND status = ${status}` : sql``}`
      );
      const total = parseInt((totalRows[0] as { count: string }).count, 10);

      return reply.code(200).send({
        data: rows,
        meta: { page, size, total, totalPages: Math.ceil(total / size) },
      });
    },
  });

  // GET /admin/sagas/:id — full saga step history
  fastify.get<{ Params: { id: string } }>('/admin/sagas/:id', {
    preHandler: requirePermission(PERMISSIONS.SAGA_VIEW),
    handler: async (request, reply) => {
      const { id } = request.params;
      const ctx = ctxFactory.create({
        tenantId: request.auth.tenantId,
        userId: request.auth.userId,
        correlationId: (request.headers['x-correlation-id'] as string) ?? 'system',
      });
      const db = ctx.db.raw;

      const rows = await db
        .select()
        .from(sagaLog)
        .where(and(eq(sagaLog.sagaId, id), eq(sagaLog.tenantId, request.auth.tenantId)))
        .limit(1);

      if (!rows[0]) {
        return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Saga not found' } });
      }

      return reply.code(200).send({ data: rows[0] });
    },
  });

  // POST /admin/sagas/:id/retry — retry from last failed step
  // ES-24 [H3]: previously just flipped saga_log.status to STARTED without re-running
  // anything. Now genuinely calls SagaOrchestrator.retry(), which reconstructs the step
  // list from the saga's registered step factory and resumes execution from the step
  // that failed. Only succeeds for saga types whose factory is registered in THIS
  // process — event-service doesn't own domain logic for sagas like INVOICE_CREATION
  // (that lives in sales-service), so retrying those from here surfaces a clear
  // SAGA_TYPE_NOT_REGISTERED error instead of a silent no-op that used to look like success.
  fastify.post<{ Params: { id: string } }>('/admin/sagas/:id/retry', {
    preHandler: requirePermission(PERMISSIONS.SAGA_MANAGE),
    handler: async (request, reply) => {
      const { id } = request.params;
      const result = await registeredOrchestrator.retry(id, request.auth.tenantId);

      return reply.code(200).send({
        data: { ...result, message: `Saga retry completed with status: ${result.status}` },
      });
    },
  });

  // POST /admin/sagas/:id/compensate — manually trigger compensation
  fastify.post<{ Params: { id: string } }>('/admin/sagas/:id/compensate', {
    preHandler: requirePermission(PERMISSIONS.SAGA_MANAGE),
    handler: async (request, reply) => {
      const { id } = request.params;
      const result = await registeredOrchestrator.compensate(id, request.auth.tenantId);

      return reply.code(200).send({ data: { ...result, message: 'Compensation completed' } });
    },
  });
}
