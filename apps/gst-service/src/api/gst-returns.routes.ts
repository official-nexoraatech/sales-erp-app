import type { FastifyInstance } from 'fastify';
import type { PlatformContextFactory } from '@erp/sdk';
import { z } from 'zod';
import { ValidationError } from '@erp/types';
import { PERMISSIONS } from '@erp/types';
import { authenticate } from '../middleware/authenticate.js';
import { requirePermission } from '../middleware/authorize.js';
import { GstReturnTrackerService } from '../domain/GstReturnTrackerService.js';

type AuthedRequest = { auth: { tenantId: number; userId: number } };
const PERIOD_REGEX = /^\d{4}-\d{2}$/;
const FY_REGEX = /^\d{4}-\d{2}$/;
const RETURN_TYPES = ['GSTR1', 'GSTR3B', 'GSTR9', 'GSTR9C'] as const;

export async function gstReturnsRoutes(
  fastify: FastifyInstance,
  ctxFactory: PlatformContextFactory
): Promise<void> {
  // GET /gst/returns/calendar?fy=2025-26
  fastify.get('/gst/returns/calendar', {
    preHandler: [authenticate, requirePermission(PERMISSIONS.GST_VIEW)],
  }, async (request, reply) => {
    const { tenantId, userId } = (request as unknown as AuthedRequest).auth;
    const ctx = ctxFactory.create({
      tenantId, userId,
      correlationId: (request.headers['x-correlation-id'] as string) ?? crypto.randomUUID(),
    });

    const QuerySchema = z.object({
      fy: z.string().regex(FY_REGEX, 'FY must be YYYY-YY format (e.g. 2025-26)'),
    });
    const q = QuerySchema.safeParse(request.query);
    if (!q.success) throw new ValidationError(q.error.errors.map((e) => e.message).join('; '));

    const calendar = await GstReturnTrackerService.getCalendar(ctx.db, tenantId, q.data.fy);
    return reply.code(200).send({ data: { fy: q.data.fy, calendar } });
  });

  // POST /gst/returns/:returnType/mark-filed
  fastify.post<{ Params: { returnType: string } }>('/gst/returns/:returnType/mark-filed', {
    preHandler: [authenticate, requirePermission(PERMISSIONS.GST_FILE)],
  }, async (request, reply) => {
    const { tenantId, userId } = (request as unknown as AuthedRequest).auth;
    const ctx = ctxFactory.create({
      tenantId, userId,
      correlationId: (request.headers['x-correlation-id'] as string) ?? crypto.randomUUID(),
    });

    const returnType = request.params.returnType as typeof RETURN_TYPES[number];
    if (!RETURN_TYPES.includes(returnType)) {
      throw new ValidationError(`Invalid return type. Must be one of: ${RETURN_TYPES.join(', ')}`);
    }

    const BodySchema = z.object({
      period: z.string().regex(PERIOD_REGEX, 'Period must be YYYY-MM'),
      referenceNumber: z.string().max(100).optional(),
    });
    const body = BodySchema.safeParse(request.body);
    if (!body.success) throw new ValidationError(body.error.errors.map((e) => e.message).join('; '));

    await GstReturnTrackerService.markFiled(ctx.db, tenantId, userId, returnType, body.data.period, body.data.referenceNumber);

    await ctx.audit.log({
      action: 'GST_RETURN_FILED',
      entityType: 'GST_RETURN',
      entityId: tenantId,
      after: { returnType, period: body.data.period, referenceNumber: body.data.referenceNumber } as Record<string, unknown>,
    });

    return reply.code(200).send({ data: { message: `${returnType} for ${body.data.period} marked as filed` } });
  });

  // GET /gst/returns/status
  fastify.get('/gst/returns/status', {
    preHandler: [authenticate, requirePermission(PERMISSIONS.GST_VIEW)],
  }, async (request, reply) => {
    const { tenantId, userId } = (request as unknown as AuthedRequest).auth;
    const ctx = ctxFactory.create({
      tenantId, userId,
      correlationId: (request.headers['x-correlation-id'] as string) ?? crypto.randomUUID(),
    });

    const status = await GstReturnTrackerService.getStatus(ctx.db, tenantId);
    return reply.code(200).send({ data: status });
  });
}
