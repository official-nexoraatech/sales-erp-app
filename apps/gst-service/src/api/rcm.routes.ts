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

export async function rcmRoutes(
  fastify: FastifyInstance,
  ctxFactory: PlatformContextFactory
): Promise<void> {
  // GET /gst/rcm-register?period=2025-06 — all RCM (reverse-charge) transactions for a period
  fastify.get('/gst/rcm-register', {
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

    const entries = await GstLedgerService.getRcmRegister(ctx.db, tenantId, q.data.period);
    return reply.code(200).send({ data: { content: entries, totalElements: entries.length, period: q.data.period } });
  });
}
