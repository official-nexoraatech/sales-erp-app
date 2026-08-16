import type { FastifyInstance } from 'fastify';
import type { PlatformContextFactory } from '@erp/sdk';
import { getBranchScope } from '@erp/sdk';
import { z } from 'zod';
import { ValidationError } from '@erp/types';
import { PERMISSIONS } from '@erp/types';
import { authenticate } from '../middleware/authenticate.js';
import { requirePermission } from '../middleware/authorize.js';
import { DayEndSettlementService } from '../domain/DayEndSettlementService.js';
import { sendError } from './http-errors.js';

// Multi-vertical platform audit 2026-08-16, Phase 3 — store-wide Z-report/day-end settlement,
// one level up from a single till's POS_CLOSE_SHIFT. POS_ZREPORT_GENERATE gates the
// once-per-branch-per-day generation (a real Z-reading, not a re-runnable report);
// POS_ZREPORT_VIEW gates read-only access to already-generated settlements.

const GenerateSchema = z.object({
  branchId: z.number().int().positive(),
  businessDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'businessDate must be YYYY-MM-DD'),
});

type AuthedRequest = {
  auth: { tenantId: number; userId: number; permissions: string[]; branchIds: number[] };
};

export async function dayEndRoutes(
  fastify: FastifyInstance,
  ctxFactory: PlatformContextFactory
): Promise<void> {
  fastify.post(
    '/pos/day-end/generate',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.POS_ZREPORT_GENERATE)] },
    async (request, reply) => {
      const { tenantId, userId, ...auth } = (request as unknown as AuthedRequest).auth;
      const body = GenerateSchema.safeParse(request.body);
      if (!body.success)
        throw new ValidationError(body.error.errors.map((e) => e.message).join('; '));

      const scope = getBranchScope(auth);
      if (scope !== 'all' && !scope.includes(body.data.branchId)) {
        return sendError(reply, 403, 'BRANCH_ACCESS_DENIED', 'You are not assigned to this branch');
      }

      const ctx = ctxFactory.create({
        tenantId,
        userId,
        correlationId: (request.headers['x-correlation-id'] as string) ?? crypto.randomUUID(),
      });

      const settlement = await DayEndSettlementService.generate(
        ctx.db.raw,
        tenantId,
        body.data.branchId,
        body.data.businessDate,
        userId
      );

      await ctx.audit.log({
        action: 'CREATE',
        entityType: 'pos_day_end_settlement',
        entityId: settlement.id,
        after: settlement as unknown as Record<string, unknown>,
      });
      return reply.code(201).send({ data: settlement });
    }
  );

  fastify.get(
    '/pos/day-end',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.POS_ZREPORT_VIEW)] },
    async (request, reply) => {
      const { tenantId, ...auth } = (request as unknown as AuthedRequest).auth;
      const ctx = ctxFactory.create({
        tenantId,
        userId: 0,
        correlationId: (request.headers['x-correlation-id'] as string) ?? crypto.randomUUID(),
      });
      const q = request.query as { page?: string; pageSize?: string };
      const page = Math.max(1, parseInt(q.page ?? '1', 10));
      const pageSize = Math.min(100, parseInt(q.pageSize ?? '20', 10));

      const branchScope = getBranchScope(auth);
      const result = await DayEndSettlementService.list(
        ctx.db.raw,
        tenantId,
        branchScope,
        page,
        pageSize
      );
      return reply.code(200).send({ data: { ...result, page, pageSize } });
    }
  );
}
