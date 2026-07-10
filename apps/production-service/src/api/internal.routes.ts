/* global process */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { PlatformContextFactory } from '@erp/sdk';
import { timingSafeEqual } from 'node:crypto';
import { ReorderService } from '../domain/ReorderService.js';
import { JobWorkOrderService } from '../domain/JobWorkOrderService.js';

async function checkInternalKey(req: FastifyRequest, reply: FastifyReply): Promise<boolean> {
  const key = req.headers['x-internal-key'];
  const expected = process.env['INTERNAL_API_KEY'];
  const keyBuffer = Buffer.from(typeof key === 'string' ? key : '');
  const expectedBuffer = Buffer.from(expected ?? '');
  const matches =
    !!expected &&
    keyBuffer.length === expectedBuffer.length &&
    timingSafeEqual(keyBuffer, expectedBuffer);
  if (!matches) {
    await reply.code(401).send({ error: { code: 'UNAUTHENTICATED', message: 'Invalid internal API key' } });
  }
  return matches;
}

// PG-026: internal-key-guarded equivalents of two JWT-only routes
// (reorder.routes.ts's GET /inventory/reorder-required, job-work.routes.ts's
// GET /job-work-orders/in-progress). scheduler-service's production.reorder-report
// and production.job-work-overdue-alert jobs were calling those JWT-protected
// routes with only an x-internal-key header — every call 401'd, and since neither
// job checked res.ok before res.json(), the error body's missing `.data` silently
// resolved to a count of 0 every day instead of surfacing the failure. Both jobs
// (and the new inventory.low-stock-alert job, which reuses reorder-required) are
// repointed at these real, internal-key-guarded routes.
export async function schedulerInternalRoutes(
  fastify: FastifyInstance,
  ctxFactory: PlatformContextFactory
): Promise<void> {
  fastify.get('/internal/inventory/reorder-required', { preHandler: checkInternalKey }, async (request, reply) => {
    const tenantId = parseInt((request.query as { tenantId?: string }).tenantId ?? '', 10);
    if (!tenantId) return reply.code(400).send({ error: { code: 'MISSING_TENANT_ID', message: 'tenantId query param required' } });

    const ctx = ctxFactory.create({ tenantId, userId: 0, correlationId: 'system' });
    const svc = new ReorderService(ctx.db.raw);
    const data = await svc.getReorderRequired(tenantId);
    return reply.code(200).send({ data });
  });

  fastify.get('/internal/job-work-orders/in-progress', { preHandler: checkInternalKey }, async (request, reply) => {
    const tenantId = parseInt((request.query as { tenantId?: string }).tenantId ?? '', 10);
    if (!tenantId) return reply.code(400).send({ error: { code: 'MISSING_TENANT_ID', message: 'tenantId query param required' } });

    const ctx = ctxFactory.create({ tenantId, userId: 0, correlationId: 'system' });
    const svc = new JobWorkOrderService(ctx.db.raw);
    const data = await svc.listInProgress(tenantId);
    return reply.code(200).send({ data });
  });
}
