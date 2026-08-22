import type { FastifyInstance } from 'fastify';
import type { PlatformContextFactory } from '@erp/sdk';
import { tenantScopedHandler } from '@erp/sdk';
import { PERMISSIONS, ValidationError } from '@erp/types';
import { z } from 'zod';
import { authenticate } from '../middleware/authenticate.js';
import { requirePermission } from '../middleware/authorize.js';
import { CommissionService } from '../domain/CommissionService.js';

const CreatePlanSchema = z.object({
  name: z.string().min(1).max(200),
  calculationBasis: z.enum(['PERCENTAGE', 'FLAT_PER_UNIT', 'TIERED']),
  ratePct: z.number().min(0).max(100).optional(),
  flatAmount: z.number().nonnegative().optional(),
  tierSlabs: z
    .array(z.object({ uptoAmount: z.number().positive(), ratePct: z.number().min(0).max(100) }))
    .optional(),
  effectiveFrom: z.string().datetime(),
  effectiveTill: z.string().datetime().optional(),
});

const CreateAssignmentSchema = z.object({
  planId: z.number().int().positive(),
  userId: z.number().int().positive().optional(),
  roleName: z.string().min(1).max(100).optional(),
  branchId: z.number().int().positive().optional(),
});

// Phase 9 GUC-per-request rollout — migrated 2026-08-21. No external I/O — CommissionService has
// no fetch() calls.
export async function commissionRoutes(
  fastify: FastifyInstance,
  ctxFactory: PlatformContextFactory
): Promise<void> {
  fastify.addHook('preHandler', authenticate);

  // Identity-scoped to the caller's own earned commissions, not permission-gated for the
  // "view mine" case — same design as apps/tenant-service/src/api/approval.routes.ts.
  fastify.get(
    '/commissions/mine',
    tenantScopedHandler(ctxFactory, async (request, reply, ctx) => {
      const svc = new CommissionService(ctx.db.raw);
      const rows = await svc.listForUser(ctx.tenant.tenantId, ctx.tenant.userId);
      return reply.send({ data: { content: rows, totalElements: rows.length } });
    })
  );

  fastify.post(
    '/commissions/:id/approve',
    { preHandler: requirePermission(PERMISSIONS.COMMISSION_APPROVE) },
    tenantScopedHandler(ctxFactory, async (request, reply, ctx) => {
      const { id } = request.params as { id: string };
      const svc = new CommissionService(ctx.db.raw);
      await svc.approve(Number(id), ctx.tenant.tenantId, ctx.tenant.userId);
      return reply.send({ data: { message: 'Commission approved' } });
    })
  );

  // Plan/assignment authoring — see CommissionService.ts's header comment on why these exist
  // (without them, no tenant could ever configure a commission plan at all).
  fastify.get(
    '/commission-plans',
    { preHandler: requirePermission(PERMISSIONS.COMMISSION_VIEW) },
    tenantScopedHandler(ctxFactory, async (request, reply, ctx) => {
      const svc = new CommissionService(ctx.db.raw);
      const rows = await svc.listPlans(ctx.tenant.tenantId);
      return reply.send({ data: { content: rows, totalElements: rows.length } });
    })
  );

  fastify.post(
    '/commission-plans',
    { preHandler: requirePermission(PERMISSIONS.COMMISSION_MANAGE) },
    tenantScopedHandler(ctxFactory, async (request, reply, ctx) => {
      const body = CreatePlanSchema.safeParse(request.body);
      if (!body.success)
        throw new ValidationError(body.error.errors.map((e) => e.message).join('; '));
      const svc = new CommissionService(ctx.db.raw);
      const row = await svc.createPlan(ctx.tenant.tenantId, ctx.tenant.userId, {
        name: body.data.name,
        calculationBasis: body.data.calculationBasis,
        effectiveFrom: new Date(body.data.effectiveFrom),
        ...(body.data.ratePct !== undefined ? { ratePct: body.data.ratePct } : {}),
        ...(body.data.flatAmount !== undefined ? { flatAmount: body.data.flatAmount } : {}),
        ...(body.data.tierSlabs !== undefined ? { tierSlabs: body.data.tierSlabs } : {}),
        ...(body.data.effectiveTill !== undefined
          ? { effectiveTill: new Date(body.data.effectiveTill) }
          : {}),
      });
      return reply.code(201).send({ data: row });
    })
  );

  fastify.get(
    '/commission-assignments',
    { preHandler: requirePermission(PERMISSIONS.COMMISSION_VIEW) },
    tenantScopedHandler(ctxFactory, async (request, reply, ctx) => {
      const svc = new CommissionService(ctx.db.raw);
      const rows = await svc.listAssignments(ctx.tenant.tenantId);
      return reply.send({ data: { content: rows, totalElements: rows.length } });
    })
  );

  fastify.post(
    '/commission-assignments',
    { preHandler: requirePermission(PERMISSIONS.COMMISSION_MANAGE) },
    tenantScopedHandler(ctxFactory, async (request, reply, ctx) => {
      const body = CreateAssignmentSchema.safeParse(request.body);
      if (!body.success)
        throw new ValidationError(body.error.errors.map((e) => e.message).join('; '));
      const svc = new CommissionService(ctx.db.raw);
      const row = await svc.createAssignment(ctx.tenant.tenantId, ctx.tenant.userId, {
        planId: body.data.planId,
        ...(body.data.userId !== undefined ? { userId: body.data.userId } : {}),
        ...(body.data.roleName !== undefined ? { roleName: body.data.roleName } : {}),
        ...(body.data.branchId !== undefined ? { branchId: body.data.branchId } : {}),
      });
      return reply.code(201).send({ data: row });
    })
  );
}
