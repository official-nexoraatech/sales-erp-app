import type { FastifyInstance } from 'fastify';
import type { PlatformContextFactory } from '@erp/sdk';
import { dlqItems } from '@erp/db';
import { and, eq, sql, desc } from 'drizzle-orm';
import { z } from 'zod';
import { PERMISSIONS } from '@erp/types';
import { authenticate } from '../middleware/authenticate.js';
import { requirePermission } from '../middleware/authorize.js';

const PaginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  size: z.coerce.number().int().min(1).max(200).default(50),
});

export async function dlqRoutes(
  fastify: FastifyInstance,
  ctxFactory: PlatformContextFactory
): Promise<void> {
  fastify.addHook('preHandler', authenticate);

  // GET /admin/dlq/summary — all topics with depth counts
  fastify.get('/admin/dlq/summary', {
    preHandler: requirePermission(PERMISSIONS.AUDIT_LOG_VIEW),
    handler: async (request, reply) => {
      const ctx = ctxFactory.create({ tenantId: request.auth.tenantId, userId: request.auth.userId, correlationId: (request.headers['x-correlation-id'] as string) ?? 'system' });
      const db = ctx.db.raw;

      const rows = await db.execute(
        sql`SELECT topic, status, COUNT(*) as count FROM dlq_items GROUP BY topic, status ORDER BY topic, status`
      );

      const topics: Record<string, Record<string, number>> = {};
      for (const row of rows as unknown as Array<{ topic: string; status: string; count: string }>) {
        if (!topics[row.topic]) topics[row.topic] = {};
        topics[row.topic]![row.status] = parseInt(row.count, 10);
      }

      const summary = Object.entries(topics).map(([topic, counts]) => ({
        topic,
        pending: counts['PENDING'] ?? 0,
        replayed: counts['REPLAYED'] ?? 0,
        discarded: counts['DISCARDED'] ?? 0,
        total: Object.values(counts).reduce((a, b) => a + b, 0),
      }));

      return reply.code(200).send({ data: summary });
    },
  });

  // GET /admin/dlq/:topic — messages in DLQ (paginated)
  fastify.get<{ Params: { topic: string } }>('/admin/dlq/:topic', {
    preHandler: requirePermission(PERMISSIONS.AUDIT_LOG_VIEW),
    handler: async (request, reply) => {
      const parsed = PaginationSchema.safeParse(request.query);
      if (!parsed.success) {
        return reply.code(400).send({ error: { code: 'VALIDATION_ERROR', message: 'Invalid query params', details: parsed.error.flatten() } });
      }

      const { topic } = request.params;
      const { page, size } = parsed.data;
      const ctx = ctxFactory.create({ tenantId: request.auth.tenantId, userId: request.auth.userId, correlationId: (request.headers['x-correlation-id'] as string) ?? 'system' });
      const db = ctx.db.raw;

      const rows = await db
        .select()
        .from(dlqItems)
        .where(eq(dlqItems.topic, topic))
        .orderBy(desc(dlqItems.createdAt))
        .limit(size)
        .offset((page - 1) * size);

      const totalRows = await db.execute(
        sql`SELECT COUNT(*) as count FROM dlq_items WHERE topic = ${topic}`
      );
      const total = parseInt((totalRows[0] as { count: string }).count, 10);

      return reply.code(200).send({
        data: rows,
        meta: { page, size, total, totalPages: Math.ceil(total / size) },
      });
    },
  });

  // GET /admin/dlq/:topic/:id — single message detail
  fastify.get<{ Params: { topic: string; id: string } }>('/admin/dlq/:topic/:id', {
    preHandler: requirePermission(PERMISSIONS.AUDIT_LOG_VIEW),
    handler: async (request, reply) => {
      const id = parseInt(request.params.id, 10);
      if (isNaN(id)) {
        return reply.code(400).send({ error: { code: 'VALIDATION_ERROR', message: 'Invalid id' } });
      }

      const ctx = ctxFactory.create({ tenantId: request.auth.tenantId, userId: request.auth.userId, correlationId: (request.headers['x-correlation-id'] as string) ?? 'system' });
      const db = ctx.db.raw;

      const rows = await db
        .select()
        .from(dlqItems)
        .where(and(eq(dlqItems.id, id), eq(dlqItems.topic, request.params.topic)))
        .limit(1);

      if (!rows[0]) {
        return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'DLQ item not found' } });
      }

      return reply.code(200).send({ data: rows[0] });
    },
  });

  // POST /admin/dlq/:topic/replay — replay all PENDING messages for a topic
  fastify.post<{ Params: { topic: string } }>('/admin/dlq/:topic/replay', {
    preHandler: requirePermission(PERMISSIONS.AUDIT_LOG_VIEW),
    handler: async (request, reply) => {
      const { topic } = request.params;
      const ctx = ctxFactory.create({ tenantId: request.auth.tenantId, userId: request.auth.userId, correlationId: (request.headers['x-correlation-id'] as string) ?? 'system' });
      const db = ctx.db.raw;

      const pending = await db
        .select()
        .from(dlqItems)
        .where(and(eq(dlqItems.topic, topic), eq(dlqItems.status, 'PENDING')));

      // Mark as REPLAYED (in a real system, would re-publish to Kafka)
      if (pending.length > 0) {
        await db
          .update(dlqItems)
          .set({ status: 'REPLAYED', lastRetriedAt: new Date(), updatedAt: new Date() })
          .where(and(eq(dlqItems.topic, topic), eq(dlqItems.status, 'PENDING')));
      }

      return reply.code(200).send({
        data: { replayed: pending.length, topic },
      });
    },
  });

  // POST /admin/dlq/:id/discard — discard a message after investigation
  fastify.post<{ Params: { id: string } }>('/admin/dlq/:id/discard', {
    preHandler: requirePermission(PERMISSIONS.AUDIT_LOG_VIEW),
    handler: async (request, reply) => {
      const id = parseInt(request.params.id, 10);
      if (isNaN(id)) {
        return reply.code(400).send({ error: { code: 'VALIDATION_ERROR', message: 'Invalid id' } });
      }

      const ctx = ctxFactory.create({ tenantId: request.auth.tenantId, userId: request.auth.userId, correlationId: (request.headers['x-correlation-id'] as string) ?? 'system' });
      const db = ctx.db.raw;

      const rows = await db.select().from(dlqItems).where(eq(dlqItems.id, id)).limit(1);
      if (!rows[0]) {
        return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'DLQ item not found' } });
      }

      await db
        .update(dlqItems)
        .set({ status: 'DISCARDED', updatedAt: new Date() })
        .where(eq(dlqItems.id, id));

      return reply.code(200).send({ data: { id, status: 'DISCARDED' } });
    },
  });
}
