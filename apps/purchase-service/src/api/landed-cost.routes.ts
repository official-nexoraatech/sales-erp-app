import type { FastifyInstance } from 'fastify';
import type { PlatformContextFactory } from '@erp/sdk';
import { getBranchScope } from '@erp/sdk';
import { grns, type ErpDatabase } from '@erp/db';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { PERMISSIONS, ERPError } from '@erp/types';
import { authenticate } from '../middleware/authenticate.js';
import { requirePermission } from '../middleware/authorize.js';
import { LandedCostService } from '../domain/LandedCostService.js';

const AddLandedCostSchema = z.object({
  costType: z.enum(['CUSTOMS_DUTY', 'FREIGHT', 'INSURANCE', 'HANDLING', 'OTHER']),
  description: z.string().max(500).optional(),
  amount: z.number().positive(),
  allocationMethod: z.enum(['BY_VALUE', 'BY_QUANTITY', 'BY_WEIGHT']).default('BY_VALUE'),
});

export async function landedCostRoutes(
  fastify: FastifyInstance,
  ctxFactory: PlatformContextFactory
): Promise<void> {
  fastify.addHook('preHandler', authenticate);

  // Purchase audit 2026-07-21 gap-fix (systemic pass, part 3): landedCosts has no branchId of
  // its own — every route here acts on a GRN by id, so resolve through grns.branch_id.
  async function assertGrnBranchInScope(
    ctx: { db: { raw: ErpDatabase } },
    grnId: number,
    tenantId: number,
    auth: { permissions: string[]; branchIds: number[] }
  ): Promise<void> {
    const branchScope = getBranchScope(auth);
    if (branchScope === 'all') return;
    const [row] = await ctx.db.raw
      .select({ branchId: grns.branchId })
      .from(grns)
      .where(and(eq(grns.id, grnId), eq(grns.tenantId, tenantId)));
    if (row && !branchScope.includes(row.branchId)) {
      throw new ERPError('GRN_OUT_OF_SCOPE', 'GRN is outside your assigned branch(es)', 403);
    }
  }

  fastify.post('/grns/:id/landed-costs', {
    preHandler: requirePermission(PERMISSIONS.GRN_APPROVE),
    handler: async (req, reply) => {
      const { id } = req.params as { id: string };
      const body = AddLandedCostSchema.parse(req.body);
      const ctx = ctxFactory.create({
        tenantId: req.auth.tenantId,
        userId: req.auth.userId,
        correlationId:
          (req.headers['x-correlation-id'] as string | undefined) ?? crypto.randomUUID(),
      });
      await assertGrnBranchInScope(ctx, parseInt(id, 10), req.auth.tenantId, req.auth);
      const svc = new LandedCostService(ctx.db.raw);
      const costId = await svc.addCost({
        tenantId: req.auth.tenantId,
        grnId: parseInt(id, 10),
        costType: body.costType,
        description: body.description,
        amount: body.amount,
        allocationMethod: body.allocationMethod,
        createdBy: req.auth.userId,
      });
      return reply.code(201).send({ data: { id: costId } });
    },
  });

  fastify.post('/grns/:id/allocate', {
    preHandler: requirePermission(PERMISSIONS.GRN_APPROVE),
    handler: async (req, reply) => {
      const { id } = req.params as { id: string };
      const ctx = ctxFactory.create({
        tenantId: req.auth.tenantId,
        userId: req.auth.userId,
        correlationId:
          (req.headers['x-correlation-id'] as string | undefined) ?? crypto.randomUUID(),
      });
      await assertGrnBranchInScope(ctx, parseInt(id, 10), req.auth.tenantId, req.auth);
      const svc = new LandedCostService(ctx.db.raw);
      await svc.allocate(parseInt(id, 10), req.auth.tenantId);
      return reply.send({ success: true });
    },
  });

  fastify.get('/grns/:id/landed-costs', {
    preHandler: requirePermission(PERMISSIONS.GRN_VIEW),
    handler: async (req, reply) => {
      const { id } = req.params as { id: string };
      const ctx = ctxFactory.create({
        tenantId: req.auth.tenantId,
        userId: req.auth.userId,
        correlationId:
          (req.headers['x-correlation-id'] as string | undefined) ?? crypto.randomUUID(),
      });
      await assertGrnBranchInScope(ctx, parseInt(id, 10), req.auth.tenantId, req.auth);
      const svc = new LandedCostService(ctx.db.raw);
      const data = await svc.getForGrn(parseInt(id, 10), req.auth.tenantId);
      return reply.send({ data });
    },
  });
}
