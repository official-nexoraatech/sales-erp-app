import type { FastifyInstance } from 'fastify';
import type { PlatformContextFactory } from '@erp/sdk';
import { z } from 'zod';
import { ValidationError } from '@erp/types';
import { PERMISSIONS } from '@erp/types';
import { authenticate } from '../middleware/authenticate.js';
import { requirePermission } from '../middleware/authorize.js';
import { GstLedgerService } from '../domain/GstLedgerService.js';

type AuthedRequest = { auth: { tenantId: number; userId: number } };

const PERIOD_REGEX = /^\d{4}-\d{2}$/;

export async function gstRegisterRoutes(
  fastify: FastifyInstance,
  ctxFactory: PlatformContextFactory
): Promise<void> {
  // GET /gst/register?period=2025-06&type=SALES|PURCHASE|ALL
  fastify.get('/gst/register', {
    preHandler: [authenticate, requirePermission(PERMISSIONS.GST_VIEW)],
  }, async (request, reply) => {
    const { tenantId, userId } = (request as unknown as AuthedRequest).auth;
    const ctx = ctxFactory.create({
      tenantId, userId,
      correlationId: (request.headers['x-correlation-id'] as string) ?? crypto.randomUUID(),
    });

    const QuerySchema = z.object({
      period: z.string().regex(PERIOD_REGEX, 'Period must be YYYY-MM'),
      type: z.enum(['SALES', 'PURCHASE', 'ALL']).default('ALL'),
    });
    const q = QuerySchema.safeParse(request.query);
    if (!q.success) throw new ValidationError(q.error.errors.map((e) => e.message).join('; '));

    const entries = await GstLedgerService.getRegister(ctx.db, tenantId, q.data.period, q.data.type);
    return reply.code(200).send({ data: { content: entries, totalElements: entries.length, period: q.data.period } });
  });

  // GET /gst/summary?period=2025-06
  fastify.get('/gst/summary', {
    preHandler: [authenticate, requirePermission(PERMISSIONS.GST_VIEW)],
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

    const summary = await GstLedgerService.getSummary(ctx.db, tenantId, q.data.period);
    return reply.code(200).send({ data: { ...summary, period: q.data.period } });
  });
}
