import type { FastifyInstance } from 'fastify';
import type { PlatformContextFactory } from '@erp/sdk';
import { performanceProfiles } from '@erp/db';
import { desc, sql } from 'drizzle-orm';
import { z } from 'zod';
import { PERMISSIONS } from '@erp/types';
import { authenticate } from '../middleware/authenticate.js';
import { requirePermission } from '../middleware/authorize.js';

// Target P95 latency benchmarks per endpoint (M12.7)
const TARGETS: Record<string, number> = {
  'POST /api/v2/invoices/confirm': 500,
  'GET /api/v2/dashboard/kpis': 200,
  'GET /api/v2/items/by-barcode': 50,
  'GET /api/v2/customers/search': 200,
};

const RecordSampleBody = z.object({
  endpoint: z.string().min(1).max(200),
  method: z.string().min(1).max(10),
  durationMs: z.number().int().min(0),
});

export async function performanceRoutes(
  fastify: FastifyInstance,
  ctxFactory: PlatformContextFactory
): Promise<void> {
  fastify.addHook('preHandler', authenticate);

  // GET /admin/performance/baselines — list all recorded baselines
  fastify.get('/admin/performance/baselines', {
    preHandler: requirePermission(PERMISSIONS.AUDIT_LOG_VIEW),
    handler: async (request, reply) => {
      const ctx = ctxFactory.create({ tenantId: request.auth.tenantId, userId: request.auth.userId, correlationId: (request.headers['x-correlation-id'] as string) ?? 'system' });
      const db = ctx.db.raw;

      // Get latest measurement per endpoint
      const rows = await db.execute(
        sql`SELECT DISTINCT ON (endpoint, method) endpoint, method, p50_ms, p95_ms, p99_ms, sample_count, target_p95_ms, measured_at FROM performance_profiles ORDER BY endpoint, method, measured_at DESC`
      );

      const result = (rows as unknown as Array<{
        endpoint: string;
        method: string;
        p50_ms: number | null;
        p95_ms: number | null;
        p99_ms: number | null;
        sample_count: number;
        target_p95_ms: number | null;
        measured_at: string;
      }>).map((r) => ({
        endpoint: r.endpoint,
        method: r.method,
        p50Ms: r.p50_ms,
        p95Ms: r.p95_ms,
        p99Ms: r.p99_ms,
        sampleCount: r.sample_count,
        targetP95Ms: r.target_p95_ms ?? TARGETS[`${r.method} ${r.endpoint}`] ?? null,
        measuredAt: r.measured_at,
        meetsTarget:
          r.p95_ms !== null && r.target_p95_ms !== null
            ? r.p95_ms <= r.target_p95_ms
            : null,
      }));

      return reply.code(200).send({ data: result });
    },
  });

  // GET /admin/performance/targets — list targets for key endpoints
  fastify.get('/admin/performance/targets', {
    preHandler: requirePermission(PERMISSIONS.AUDIT_LOG_VIEW),
    handler: async (_request, reply) => {
      const targets = Object.entries(TARGETS).map(([endpoint, targetP95Ms]) => {
        const [method, ...pathParts] = endpoint.split(' ');
        return { endpoint: pathParts.join(' '), method, targetP95Ms };
      });
      return reply.code(200).send({ data: targets });
    },
  });

  // POST /admin/performance/samples — record a latency sample (called by services)
  fastify.post('/admin/performance/samples', {
    preHandler: requirePermission(PERMISSIONS.AUDIT_LOG_VIEW),
    handler: async (request, reply) => {
      const parsed = RecordSampleBody.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: { code: 'VALIDATION_ERROR', message: 'Invalid request body', details: parsed.error.flatten() } });
      }

      const { endpoint, method, durationMs } = parsed.data;
      const endpointKey = `${method} ${endpoint}`;
      const targetP95Ms = TARGETS[endpointKey] ?? null;

      const ctx = ctxFactory.create({ tenantId: request.auth.tenantId, userId: request.auth.userId, correlationId: (request.headers['x-correlation-id'] as string) ?? 'system' });
      const db = ctx.db.raw;

      await db.insert(performanceProfiles).values({
        endpoint,
        method,
        p95Ms: durationMs,
        sampleCount: 1,
        targetP95Ms,
        measuredAt: new Date(),
      });

      return reply.code(201).send({ data: { recorded: true, endpoint, method, durationMs } });
    },
  });
}
