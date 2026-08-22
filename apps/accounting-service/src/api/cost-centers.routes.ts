import type { FastifyInstance } from 'fastify';
import type { PlatformContextFactory } from '@erp/sdk';
import { tenantScopedHandler } from '@erp/sdk';
import { z } from 'zod';
import { ValidationError } from '@erp/types';
import { PERMISSIONS } from '@erp/types';
import { authenticate } from '../middleware/authenticate.js';
import { requirePermission } from '../middleware/authorize.js';
import { CostCenterService } from '../domain/CostCenterService.js';

const CostCenterCreateSchema = z.object({
  code: z.string().min(1).max(30),
  name: z.string().min(1).max(300),
  parentId: z.number().int().positive().optional(),
});

const CostCenterUpdateSchema = z.object({
  name: z.string().min(1).max(300).optional(),
  parentId: z.number().int().positive().optional(),
  isActive: z.boolean().optional(),
});

// Phase 9 GUC-per-request rollout — migrated 2026-08-21. Every write route here calls
// ctx.audit.log() after the CostCenterService call — proven safe (not left unmigrated): once
// wrapped in tenantScopedHandler, the service's own internal transaction becomes a savepoint of
// the outer one, so the audit log write and the real operation now succeed or fail together
// automatically. See tenantConnection-nested-rollback.test.ts (platform-sdk) and
// 23-guc-per-request-rollout-checklist.md's "post-hoc audit log" caveat for the proof.
export async function costCenterRoutes(
  fastify: FastifyInstance,
  ctxFactory: PlatformContextFactory
): Promise<void> {
  // ── GET /cost-centers ────────────────────────────────────────────────────
  fastify.get(
    '/cost-centers',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.COST_CENTER_VIEW)] },
    tenantScopedHandler(ctxFactory, async (_request, reply, ctx) => {
      const rows = await CostCenterService.list(ctx.db, ctx.tenant.tenantId);
      return reply.code(200).send({ data: rows });
    })
  );

  // ── POST /cost-centers ───────────────────────────────────────────────────
  fastify.post(
    '/cost-centers',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.COST_CENTER_MANAGE)] },
    tenantScopedHandler(ctxFactory, async (request, reply, ctx) => {
      const body = CostCenterCreateSchema.safeParse(request.body);
      if (!body.success)
        throw new ValidationError(body.error.errors.map((e) => e.message).join('; '));

      const created = await CostCenterService.create(
        ctx.db,
        ctx.tenant.tenantId,
        ctx.tenant.userId,
        body.data
      );
      await ctx.audit.log({
        action: 'CREATE',
        entityType: 'cost_center',
        entityId: created.id,
        after: created as unknown as Record<string, unknown>,
      });

      return reply.code(201).send({ data: created });
    })
  );

  // ── PATCH /cost-centers/:id ──────────────────────────────────────────────
  fastify.patch<{ Params: { id: string } }>(
    '/cost-centers/:id',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.COST_CENTER_MANAGE)] },
    tenantScopedHandler(ctxFactory, async (request, reply, ctx) => {
      const { id: idParam } = request.params as { id: string };
      const id = parseInt(idParam, 10);
      const body = CostCenterUpdateSchema.safeParse(request.body);
      if (!body.success)
        throw new ValidationError(body.error.errors.map((e) => e.message).join('; '));

      const before = await CostCenterService.getById(ctx.db, ctx.tenant.tenantId, id);
      const updated = await CostCenterService.update(ctx.db, ctx.tenant.tenantId, id, body.data);
      await ctx.audit.log({
        action: 'UPDATE',
        entityType: 'cost_center',
        entityId: id,
        before: before as unknown as Record<string, unknown>,
        after: updated as unknown as Record<string, unknown>,
      });

      return reply.code(200).send({ data: updated });
    })
  );

  // ── DELETE /cost-centers/:id — soft-delete ───────────────────────────────
  fastify.delete<{ Params: { id: string } }>(
    '/cost-centers/:id',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.COST_CENTER_MANAGE)] },
    tenantScopedHandler(ctxFactory, async (request, reply, ctx) => {
      const { id: idParam } = request.params as { id: string };
      const id = parseInt(idParam, 10);
      const before = await CostCenterService.getById(ctx.db, ctx.tenant.tenantId, id);
      await CostCenterService.softDelete(ctx.db, ctx.tenant.tenantId, id);
      await ctx.audit.log({
        action: 'DELETE',
        entityType: 'cost_center',
        entityId: id,
        before: before as unknown as Record<string, unknown>,
      });

      return reply.code(204).send();
    })
  );
}
