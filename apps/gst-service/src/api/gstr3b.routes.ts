import type { FastifyInstance } from 'fastify';
import type { PlatformContextFactory } from '@erp/sdk';
import { z } from 'zod';
import { ValidationError } from '@erp/types';
import { PERMISSIONS } from '@erp/types';
import { authenticate } from '../middleware/authenticate.js';
import { requirePermission } from '../middleware/authorize.js';
import { Gstr3bService } from '../domain/Gstr3bService.js';

type AuthedRequest = { auth: { tenantId: number; userId: number } };
const PERIOD_REGEX = /^\d{4}-\d{2}$/;

export async function gstr3bRoutes(
  fastify: FastifyInstance,
  ctxFactory: PlatformContextFactory
): Promise<void> {
  // GET /gst/gstr3b?period=2025-06
  fastify.get('/gst/gstr3b', {
    preHandler: [authenticate, requirePermission(PERMISSIONS.GSTR3B_VIEW)],
  }, async (request, reply) => {
    const { tenantId, userId } = (request as unknown as AuthedRequest).auth;
    const ctx = ctxFactory.create({
      tenantId, userId,
      correlationId: (request.headers['x-correlation-id'] as string) ?? crypto.randomUUID(),
    });

    const QuerySchema = z.object({
      period: z.string().regex(PERIOD_REGEX, 'Period must be YYYY-MM'),
    });
    const q = QuerySchema.safeParse(request.query);
    if (!q.success) throw new ValidationError(q.error.errors.map((e) => e.message).join('; '));

    const result = await Gstr3bService.compute(ctx.db, tenantId, q.data.period);
    return reply.code(200).send({ data: result });
  });

  // POST /gst/gstr3b/export?period=2025-06
  fastify.post('/gst/gstr3b/export', {
    preHandler: [authenticate, requirePermission(PERMISSIONS.GSTR3B_FILE)],
  }, async (request, reply) => {
    const { tenantId, userId } = (request as unknown as AuthedRequest).auth;
    const ctx = ctxFactory.create({
      tenantId, userId,
      correlationId: (request.headers['x-correlation-id'] as string) ?? crypto.randomUUID(),
    });

    const QuerySchema = z.object({
      period: z.string().regex(PERIOD_REGEX, 'Period must be YYYY-MM'),
    });
    const q = QuerySchema.safeParse(request.query);
    if (!q.success) throw new ValidationError(q.error.errors.map((e) => e.message).join('; '));

    const result = await Gstr3bService.compute(ctx.db, tenantId, q.data.period);

    await ctx.audit.log({
      action: 'GSTR3B_EXPORTED',
      entityType: 'GSTR3B',
      entityId: tenantId,
      after: { period: q.data.period } as Record<string, unknown>,
    });

    return reply.code(200).send({
      data: {
        ...result,
        exportedAt: new Date().toISOString(),
      },
    });
  });
}
