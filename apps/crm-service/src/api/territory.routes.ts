import type { FastifyInstance } from 'fastify';
import type { PlatformContextFactory } from '@erp/sdk';
import { tenantScopedHandler } from '@erp/sdk';
import { z } from 'zod';
import { ValidationError } from '@erp/types';
import { PERMISSIONS } from '@erp/types';
import { authenticate } from '../middleware/authenticate.js';
import { requirePermission } from '../middleware/authorize.js';
import { TerritoryService } from '../domain/TerritoryService.js';

// CRM-ROADMAP Phase 4, Feature 4 — Territory Management. A single permission
// (TERRITORY_MANAGE) gates every route here — this is a Sales Ops admin configuration surface,
// not a customer-facing entity needing granular view/create/update splits (same precedent as
// LOYALTY_TIER_MANAGE gating all of tier configuration).
//
// CRM/O2C split — second migrated file (after dlt-template.routes.ts). Verified zero code
// coupling to anything else in sales-service before moving.
//
// Phase 9 GUC-per-request rollout — migrated 2026-08-21. No external I/O — TerritoryService has
// no fetch() calls. Post-hoc ctx.audit.log() calls are safe per caveat 4b.

const TerritoryCreateSchema = z.object({
  name: z.string().min(2).max(200),
  description: z.string().max(2000).optional(),
});

const TerritoryUpdateSchema = z.object({
  version: z.number().int().min(0),
  name: z.string().min(2).max(200).optional(),
  description: z.string().max(2000).nullable().optional(),
  isActive: z.boolean().optional(),
});

const BranchIdsSchema = z.object({
  branchIds: z.array(z.number().int().positive()),
});

const UserIdsSchema = z.object({
  userIds: z.array(z.number().int().positive()),
});

export async function territoryRoutes(
  fastify: FastifyInstance,
  ctxFactory: PlatformContextFactory
): Promise<void> {
  fastify.get(
    '/territories',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.TERRITORY_MANAGE)] },
    tenantScopedHandler(ctxFactory, async (request, reply, ctx) => {
      const rows = await TerritoryService.list(ctx.db.raw, ctx.tenant.tenantId);
      return reply.code(200).send({ data: { content: rows, totalElements: rows.length } });
    })
  );

  fastify.post(
    '/territories',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.TERRITORY_MANAGE)] },
    tenantScopedHandler(ctxFactory, async (request, reply, ctx) => {
      const body = TerritoryCreateSchema.safeParse(request.body);
      if (!body.success)
        throw new ValidationError(body.error.errors.map((e) => e.message).join('; '));

      const created = await TerritoryService.create(
        ctx.db.raw,
        ctx.tenant.tenantId,
        ctx.tenant.userId,
        body.data
      );

      await ctx.audit.log({
        action: 'CREATE',
        entityType: 'crm_territory',
        entityId: created.id,
        after: created as unknown as Record<string, unknown>,
      });
      return reply.code(201).send({ data: created });
    })
  );

  fastify.put(
    '/territories/:id',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.TERRITORY_MANAGE)] },
    tenantScopedHandler(ctxFactory, async (request, reply, ctx) => {
      const { id: idParam } = request.params as { id: string };
      const id = parseInt(idParam, 10);

      const body = TerritoryUpdateSchema.safeParse(request.body);
      if (!body.success)
        throw new ValidationError(body.error.errors.map((e) => e.message).join('; '));

      const updated = await TerritoryService.update(ctx.db.raw, ctx.tenant.tenantId, id, body.data);

      await ctx.audit.log({
        action: 'UPDATE',
        entityType: 'crm_territory',
        entityId: id,
        after: updated as unknown as Record<string, unknown>,
      });
      return reply.code(200).send({ data: updated });
    })
  );

  fastify.put(
    '/territories/:id/branches',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.TERRITORY_MANAGE)] },
    tenantScopedHandler(ctxFactory, async (request, reply, ctx) => {
      const { id: idParam } = request.params as { id: string };
      const id = parseInt(idParam, 10);

      const body = BranchIdsSchema.safeParse(request.body);
      if (!body.success)
        throw new ValidationError(body.error.errors.map((e) => e.message).join('; '));

      await TerritoryService.setBranches(ctx.db.raw, ctx.tenant.tenantId, id, body.data.branchIds);

      await ctx.audit.log({
        action: 'UPDATE',
        entityType: 'crm_territory_branches',
        entityId: id,
        after: { branchIds: body.data.branchIds },
      });
      return reply
        .code(200)
        .send({ data: { message: 'Branches updated', branchIds: body.data.branchIds } });
    })
  );

  fastify.put(
    '/territories/:id/users',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.TERRITORY_MANAGE)] },
    tenantScopedHandler(ctxFactory, async (request, reply, ctx) => {
      const { id: idParam } = request.params as { id: string };
      const id = parseInt(idParam, 10);

      const body = UserIdsSchema.safeParse(request.body);
      if (!body.success)
        throw new ValidationError(body.error.errors.map((e) => e.message).join('; '));

      await TerritoryService.setUsers(ctx.db.raw, ctx.tenant.tenantId, id, body.data.userIds);

      await ctx.audit.log({
        action: 'UPDATE',
        entityType: 'crm_territory_users',
        entityId: id,
        after: { userIds: body.data.userIds },
      });
      return reply
        .code(200)
        .send({ data: { message: 'Users updated', userIds: body.data.userIds } });
    })
  );

  fastify.get(
    '/territories/:id/coverage',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.TERRITORY_MANAGE)] },
    tenantScopedHandler(ctxFactory, async (request, reply, ctx) => {
      const { id: idParam } = request.params as { id: string };
      const id = parseInt(idParam, 10);

      const coverage = await TerritoryService.getCoverage(ctx.db.raw, ctx.tenant.tenantId, id);
      return reply.code(200).send({ data: coverage });
    })
  );
}
