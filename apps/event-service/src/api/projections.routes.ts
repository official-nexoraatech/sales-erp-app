import type { FastifyInstance } from 'fastify';
import type { PlatformContextFactory } from '@erp/sdk';
import { projectionMetadata } from '@erp/db';
import { and, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { Queue } from 'bullmq';
import { PERMISSIONS } from '@erp/types';
import { authenticate } from '../middleware/authenticate.js';
import { requirePermission } from '../middleware/authorize.js';

// PG-008: BullMQ queue name per projection — must match
// PROJECTION_QUEUE_NAMES in apps/scheduler-service/src/jobs/projectionRebuildJobs.ts
// exactly. event-service enqueues here; scheduler-service's JobRegistry Worker
// (registerProjectionRebuildJobs) is the only consumer — no HTTP call, no
// duplicated business logic, just a shared Redis connection and an agreed queue name.
const PROJECTION_QUEUE_NAMES: Record<string, string> = {
  projection_stock_level: 'projection-rebuild-stock-level',
  projection_dashboard_daily: 'projection-rebuild-dashboard-daily',
  projection_customer_balance: 'projection-rebuild-customer-balance',
  projection_supplier_balance: 'projection-rebuild-supplier-balance',
};

const STALE_TOLERANCE_MS: Record<string, number> = {
  projection_dashboard_daily: 120_000,   // 2 minutes
  projection_customer_balance: 5_000,    // 5 seconds
  projection_stock_level: 5_000,         // 5 seconds
  projection_customer_aging: 3_600_000,  // 1 hour
};

function computeProjectionMeta(row: typeof projectionMetadata.$inferSelect): {
  lastUpdatedAt: string;
  lagMs: number;
  isStale: boolean;
  staleTolerance: number;
} {
  const now = Date.now();
  const lastUpdatedAt = row.lastUpdatedAt.toISOString();
  const lagMs = row.lastEventOccurredAt
    ? now - row.lastEventOccurredAt.getTime()
    : now - row.lastUpdatedAt.getTime();
  const staleTolerance = STALE_TOLERANCE_MS[row.projectionName] ?? 120_000;
  const isStale = lagMs > staleTolerance;

  return { lastUpdatedAt, lagMs, isStale, staleTolerance };
}

export async function projectionRoutes(
  fastify: FastifyInstance,
  ctxFactory: PlatformContextFactory
): Promise<void> {
  fastify.addHook('preHandler', authenticate);

  // Created once at route-registration time (not per-request), reusing the same
  // ioredis connection ctxFactory already holds for rate-limiting. BullMQ treats an
  // externally-supplied connection as shared — it will not be closed by these Queue
  // instances.
  const rebuildQueues: Record<string, Queue> = Object.fromEntries(
    Object.entries(PROJECTION_QUEUE_NAMES).map(([projectionName, queueName]) => [
      projectionName,
      new Queue(queueName, { connection: ctxFactory.getRedis() }),
    ])
  );

  // GET /admin/projections — list all projections with metadata
  fastify.get('/admin/projections', {
    preHandler: requirePermission(PERMISSIONS.PROJECTION_VIEW),
    handler: async (request, reply) => {
      const ctx = ctxFactory.create({ tenantId: request.auth.tenantId, userId: request.auth.userId, correlationId: (request.headers['x-correlation-id'] as string) ?? 'system' });
      const db = ctx.db.raw;

      const rows = await db.select().from(projectionMetadata);

      const result = rows.map((row) => ({
        ...row,
        _projection: computeProjectionMeta(row),
      }));

      return reply.code(200).send({ data: result });
    },
  });

  // GET /admin/projections/:name — single projection metadata
  fastify.get<{ Params: { name: string } }>('/admin/projections/:name', {
    preHandler: requirePermission(PERMISSIONS.PROJECTION_VIEW),
    handler: async (request, reply) => {
      const { name } = request.params;
      const ctx = ctxFactory.create({ tenantId: request.auth.tenantId, userId: request.auth.userId, correlationId: (request.headers['x-correlation-id'] as string) ?? 'system' });
      const db = ctx.db.raw;

      const rows = await db
        .select()
        .from(projectionMetadata)
        .where(eq(projectionMetadata.projectionName, name))
        .limit(1);

      if (!rows[0]) {
        return reply.code(404).send({ error: { code: 'NOT_FOUND', message: `Projection '${name}' not found` } });
      }

      return reply.code(200).send({
        data: { ...rows[0], _projection: computeProjectionMeta(rows[0]) },
      });
    },
  });

  // POST /admin/projections/:name/rebuild — trigger projection rebuild
  fastify.post<{ Params: { name: string } }>('/admin/projections/:name/rebuild', {
    preHandler: requirePermission(PERMISSIONS.PROJECTION_MANAGE),
    handler: async (request, reply) => {
      const { name } = request.params;
      const ctx = ctxFactory.create({ tenantId: request.auth.tenantId, userId: request.auth.userId, correlationId: (request.headers['x-correlation-id'] as string) ?? 'system' });
      const db = ctx.db.raw;

      const rows = await db
        .select()
        .from(projectionMetadata)
        .where(eq(projectionMetadata.projectionName, name))
        .limit(1);

      if (!rows[0]) {
        return reply.code(404).send({ error: { code: 'NOT_FOUND', message: `Projection '${name}' not found` } });
      }

      if (rows[0].status === 'REBUILDING') {
        return reply.code(422).send({ error: { code: 'REBUILD_IN_PROGRESS', message: `Projection '${name}' is already being rebuilt` } });
      }

      const queue = rebuildQueues[name];
      if (!queue) {
        return reply.code(400).send({ error: { code: 'UNSUPPORTED_PROJECTION', message: `No rebuild job registered for '${name}'` } });
      }

      // Mark as REBUILDING
      await db
        .update(projectionMetadata)
        .set({ status: 'REBUILDING', rebuildStartedAt: new Date(), updatedAt: new Date() })
        .where(eq(projectionMetadata.projectionName, name));

      // Enqueue onto scheduler-service's JobRegistry Worker — see PG-008.
      try {
        await queue.add(name, { tenantId: request.auth.tenantId });
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        await db
          .update(projectionMetadata)
          .set({ status: 'ERROR', errorMessage: errMsg, updatedAt: new Date() })
          .where(eq(projectionMetadata.projectionName, name));
        return reply.code(500).send({ error: { code: 'REBUILD_ENQUEUE_FAILED', message: 'Failed to enqueue rebuild job' } });
      }

      return reply.code(202).send({
        data: { projectionName: name, status: 'REBUILDING', message: 'Rebuild initiated' },
      });
    },
  });

  // POST /admin/projections/:name/heartbeat — update projection lag (called by projection workers)
  fastify.post<{ Params: { name: string } }>('/admin/projections/:name/heartbeat', {
    preHandler: requirePermission(PERMISSIONS.PROJECTION_MANAGE),
    handler: async (request, reply) => {
      const { name } = request.params;
      const body = request.body as { lastEventId?: string; lastEventOccurredAt?: string };
      const ctx = ctxFactory.create({ tenantId: request.auth.tenantId, userId: request.auth.userId, correlationId: (request.headers['x-correlation-id'] as string) ?? 'system' });
      const db = ctx.db.raw;

      await db
        .update(projectionMetadata)
        .set({
          lastEventId: body.lastEventId,
          lastEventOccurredAt: body.lastEventOccurredAt ? new Date(body.lastEventOccurredAt) : undefined,
          lastUpdatedAt: new Date(),
          status: 'UP_TO_DATE',
          updatedAt: new Date(),
        })
        .where(eq(projectionMetadata.projectionName, name));

      return reply.code(200).send({ data: { updated: true } });
    },
  });
}
