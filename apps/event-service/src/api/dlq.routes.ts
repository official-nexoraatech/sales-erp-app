import type { FastifyInstance } from 'fastify';
import type { PlatformContextFactory } from '@erp/sdk';
import { tenantScopedHandler, withTenantConnection } from '@erp/sdk';
import { dlqItems } from '@erp/db';
import { and, eq, sql, desc } from 'drizzle-orm';
import { z } from 'zod';
import { PERMISSIONS } from '@erp/types';
import { createLogger } from '@erp/logger';
import { authenticate } from '../middleware/authenticate.js';
import { requirePermission } from '../middleware/authorize.js';
import type { OutboxRelayWorker } from '../outbox/OutboxRelayWorker.js';

const logger = createLogger({ serviceName: 'event-service' });

const PaginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  size: z.coerce.number().int().min(1).max(200).default(50),
});

export async function dlqRoutes(
  fastify: FastifyInstance,
  ctxFactory: PlatformContextFactory,
  worker: OutboxRelayWorker
): Promise<void> {
  fastify.addHook('preHandler', authenticate);

  // GET /admin/dlq/summary — all topics with depth counts
  fastify.get('/admin/dlq/summary', {
    preHandler: requirePermission(PERMISSIONS.DLQ_VIEW),
    handler: tenantScopedHandler(ctxFactory, async (request, reply, ctx) => {
      const db = ctx.db.raw;

      const rows = await db.execute(
        sql`SELECT topic, status, COUNT(*) as count FROM dlq_items WHERE tenant_id = ${ctx.tenant.tenantId} GROUP BY topic, status ORDER BY topic, status`
      );

      const topics: Record<string, Record<string, number>> = {};
      for (const row of rows as unknown as Array<{
        topic: string;
        status: string;
        count: string;
      }>) {
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
    }),
  });

  // GET /admin/dlq/:topic — messages in DLQ (paginated)
  fastify.get<{ Params: { topic: string } }>('/admin/dlq/:topic', {
    preHandler: requirePermission(PERMISSIONS.DLQ_VIEW),
    handler: tenantScopedHandler(ctxFactory, async (request, reply, ctx) => {
      const parsed = PaginationSchema.safeParse(request.query);
      if (!parsed.success) {
        return reply.code(400).send({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid query params',
            details: parsed.error.flatten(),
          },
        });
      }

      const { topic } = request.params as { topic: string };
      const { page, size } = parsed.data;
      const db = ctx.db.raw;

      const rows = await db
        .select()
        .from(dlqItems)
        .where(and(eq(dlqItems.topic, topic), eq(dlqItems.tenantId, ctx.tenant.tenantId)))
        .orderBy(desc(dlqItems.createdAt), desc(dlqItems.id))
        .limit(size)
        .offset((page - 1) * size);

      const totalRows = await db.execute(
        sql`SELECT COUNT(*) as count FROM dlq_items WHERE topic = ${topic} AND tenant_id = ${ctx.tenant.tenantId}`
      );
      const total = parseInt((totalRows[0] as { count: string }).count, 10);

      return reply.code(200).send({
        data: rows,
        meta: { page, size, total, totalPages: Math.ceil(total / size) },
      });
    }),
  });

  // GET /admin/dlq/:topic/:id — single message detail
  fastify.get<{ Params: { topic: string; id: string } }>('/admin/dlq/:topic/:id', {
    preHandler: requirePermission(PERMISSIONS.DLQ_VIEW),
    handler: tenantScopedHandler(ctxFactory, async (request, reply, ctx) => {
      const params = request.params as { topic: string; id: string };
      const id = parseInt(params.id, 10);
      if (isNaN(id)) {
        return reply.code(400).send({ error: { code: 'VALIDATION_ERROR', message: 'Invalid id' } });
      }

      const db = ctx.db.raw;

      const rows = await db
        .select()
        .from(dlqItems)
        .where(
          and(
            eq(dlqItems.id, id),
            eq(dlqItems.topic, params.topic),
            eq(dlqItems.tenantId, ctx.tenant.tenantId)
          )
        )
        .limit(1);

      if (!rows[0]) {
        return reply
          .code(404)
          .send({ error: { code: 'NOT_FOUND', message: 'DLQ item not found' } });
      }

      return reply.code(200).send({ data: rows[0] });
    }),
  });

  // POST /admin/dlq/:topic/replay — replay all PENDING messages for a topic
  //
  // Loops over N items, each doing a real Kafka publish (worker.publishRaw) followed by its own
  // DB write — the loop-shaped extension of caveat 4g: rather than one shared transaction around
  // the whole loop (which would hold a transaction open across N sequential network calls), each
  // iteration gets its own withTenantConnection wrap for its write, strictly after that item's
  // publish call resolves. Not routed through tenantScopedHandler since that wraps the entire
  // handler body in one transaction, which is exactly what this shape must avoid.
  fastify.post<{ Params: { topic: string } }>('/admin/dlq/:topic/replay', {
    preHandler: requirePermission(PERMISSIONS.DLQ_MANAGE),
    handler: async (request, reply) => {
      const { topic } = request.params;
      const tenantId = request.auth.tenantId;

      const pending = await withTenantConnection(ctxFactory.rawDb, tenantId, (db) =>
        db
          .select()
          .from(dlqItems)
          .where(
            and(
              eq(dlqItems.topic, topic),
              eq(dlqItems.status, 'PENDING'),
              eq(dlqItems.tenantId, tenantId)
            )
          )
      );

      let replayed = 0;
      let failed = 0;

      for (const row of pending) {
        try {
          await worker.publishRaw(
            row.topic,
            String(row.id),
            row.payload as Record<string, unknown>,
            row.headers as Record<string, string>
          );
          await withTenantConnection(ctxFactory.rawDb, tenantId, (db) =>
            db
              .update(dlqItems)
              .set({ status: 'REPLAYED', lastRetriedAt: new Date(), updatedAt: new Date() })
              .where(eq(dlqItems.id, row.id))
          );
          replayed += 1;
        } catch (err) {
          failed += 1;
          await withTenantConnection(ctxFactory.rawDb, tenantId, (db) =>
            db
              .update(dlqItems)
              .set({
                retryCount: row.retryCount + 1,
                lastRetriedAt: new Date(),
                updatedAt: new Date(),
              })
              .where(eq(dlqItems.id, row.id))
          );
          logger.warn(
            { id: row.id, topic: row.topic, err: err instanceof Error ? err.message : String(err) },
            'DLQ replay: failed to republish, item remains PENDING'
          );
        }
      }

      return reply.code(200).send({
        data: { replayed, failed, topic },
      });
    },
  });

  // POST /admin/dlq/:id/discard — discard a message after investigation
  fastify.post<{ Params: { id: string } }>('/admin/dlq/:id/discard', {
    preHandler: requirePermission(PERMISSIONS.DLQ_MANAGE),
    handler: tenantScopedHandler(ctxFactory, async (request, reply, ctx) => {
      const id = parseInt((request.params as { id: string }).id, 10);
      if (isNaN(id)) {
        return reply.code(400).send({ error: { code: 'VALIDATION_ERROR', message: 'Invalid id' } });
      }

      const db = ctx.db.raw;

      const rows = await db
        .select()
        .from(dlqItems)
        .where(and(eq(dlqItems.id, id), eq(dlqItems.tenantId, ctx.tenant.tenantId)))
        .limit(1);
      if (!rows[0]) {
        return reply
          .code(404)
          .send({ error: { code: 'NOT_FOUND', message: 'DLQ item not found' } });
      }

      await db
        .update(dlqItems)
        .set({ status: 'DISCARDED', updatedAt: new Date() })
        .where(and(eq(dlqItems.id, id), eq(dlqItems.tenantId, ctx.tenant.tenantId)));

      return reply.code(200).send({ data: { id, status: 'DISCARDED' } });
    }),
  });
}
