import type { FastifyInstance } from 'fastify';
import type { PlatformContextFactory } from '@erp/sdk';
import { getBranchScope, tenantScopedHandler } from '@erp/sdk';
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

// Phase 9 GUC-per-request rollout — migrated 2026-08-21. No external I/O —
// LandedCostService has no fetch() calls.
export async function landedCostRoutes(
  fastify: FastifyInstance,
  ctxFactory: PlatformContextFactory
): Promise<void> {
  fastify.addHook('preHandler', authenticate);

  // Purchase audit 2026-07-21 gap-fix (systemic pass, part 3): landedCosts has no branchId of
  // its own — every route here acts on a GRN by id, so resolve through grns.branch_id.
  async function assertGrnBranchInScope(
    db: ErpDatabase,
    grnId: number,
    tenantId: number,
    auth: { permissions: string[]; branchIds: number[] }
  ): Promise<void> {
    const branchScope = getBranchScope(auth);
    if (branchScope === 'all') return;
    const [row] = await db
      .select({ branchId: grns.branchId })
      .from(grns)
      .where(and(eq(grns.id, grnId), eq(grns.tenantId, tenantId)));
    if (row && !branchScope.includes(row.branchId)) {
      throw new ERPError('GRN_OUT_OF_SCOPE', 'GRN is outside your assigned branch(es)', 403);
    }
  }

  fastify.post('/grns/:id/landed-costs', {
    preHandler: requirePermission(PERMISSIONS.GRN_APPROVE),
    handler: tenantScopedHandler(ctxFactory, async (req, reply, ctx) => {
      const { id } = req.params as { id: string };
      const body = AddLandedCostSchema.parse(req.body);
      await assertGrnBranchInScope(ctx.db.raw, parseInt(id, 10), ctx.tenant.tenantId, req.auth);
      const svc = new LandedCostService(ctx.db.raw);
      const costId = await svc.addCost({
        tenantId: ctx.tenant.tenantId,
        grnId: parseInt(id, 10),
        costType: body.costType,
        description: body.description,
        amount: body.amount,
        allocationMethod: body.allocationMethod,
        createdBy: ctx.tenant.userId,
      });
      return reply.code(201).send({ data: { id: costId } });
    }),
  });

  fastify.post('/grns/:id/allocate', {
    preHandler: requirePermission(PERMISSIONS.GRN_APPROVE),
    handler: tenantScopedHandler(ctxFactory, async (req, reply, ctx) => {
      const { id } = req.params as { id: string };
      await assertGrnBranchInScope(ctx.db.raw, parseInt(id, 10), ctx.tenant.tenantId, req.auth);
      const svc = new LandedCostService(ctx.db.raw);
      await svc.allocate(parseInt(id, 10), ctx.tenant.tenantId);
      return reply.send({ success: true });
    }),
  });

  fastify.get('/grns/:id/landed-costs', {
    preHandler: requirePermission(PERMISSIONS.GRN_VIEW),
    handler: tenantScopedHandler(ctxFactory, async (req, reply, ctx) => {
      const { id } = req.params as { id: string };
      await assertGrnBranchInScope(ctx.db.raw, parseInt(id, 10), ctx.tenant.tenantId, req.auth);
      const svc = new LandedCostService(ctx.db.raw);
      const data = await svc.getForGrn(parseInt(id, 10), ctx.tenant.tenantId);
      return reply.send({ data });
    }),
  });
}
