import type { FastifyInstance } from 'fastify';
import type { PlatformContextFactory } from '@erp/sdk';
import { z } from 'zod';
import { ValidationError } from '@erp/types';
import { PERMISSIONS } from '@erp/types';
import { authenticate } from '../middleware/authenticate.js';
import { requirePermission } from '../middleware/authorize.js';
import { CostCenterService } from '../domain/CostCenterService.js';

type AuthedRequest = { auth: { tenantId: number; userId: number } };

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

export async function costCenterRoutes(
  fastify: FastifyInstance,
  ctxFactory: PlatformContextFactory
): Promise<void> {
  // ── GET /cost-centers ────────────────────────────────────────────────────
  fastify.get(
    '/cost-centers',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.COST_CENTER_VIEW)] },
    async (request, reply) => {
      const { tenantId, userId } = (request as unknown as AuthedRequest).auth;
      const ctx = ctxFactory.create({
        tenantId,
        userId,
        correlationId: (request.headers['x-correlation-id'] as string) ?? crypto.randomUUID(),
      });
      const rows = await CostCenterService.list(ctx.db, tenantId);
      return reply.code(200).send({ data: rows });
    }
  );

  // ── POST /cost-centers ───────────────────────────────────────────────────
  fastify.post(
    '/cost-centers',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.COST_CENTER_MANAGE)] },
    async (request, reply) => {
      const { tenantId, userId } = (request as unknown as AuthedRequest).auth;
      const ctx = ctxFactory.create({
        tenantId,
        userId,
        correlationId: (request.headers['x-correlation-id'] as string) ?? crypto.randomUUID(),
      });
      const body = CostCenterCreateSchema.safeParse(request.body);
      if (!body.success)
        throw new ValidationError(body.error.errors.map((e) => e.message).join('; '));

      const created = await CostCenterService.create(ctx.db, tenantId, userId, body.data);
      await ctx.audit.log({
        action: 'CREATE',
        entityType: 'cost_center',
        entityId: created.id,
        after: created as unknown as Record<string, unknown>,
      });

      return reply.code(201).send({ data: created });
    }
  );

  // ── PATCH /cost-centers/:id ──────────────────────────────────────────────
  fastify.patch<{ Params: { id: string } }>(
    '/cost-centers/:id',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.COST_CENTER_MANAGE)] },
    async (request, reply) => {
      const { tenantId, userId } = (request as unknown as AuthedRequest).auth;
      const ctx = ctxFactory.create({
        tenantId,
        userId,
        correlationId: (request.headers['x-correlation-id'] as string) ?? crypto.randomUUID(),
      });
      const id = parseInt(request.params.id, 10);
      const body = CostCenterUpdateSchema.safeParse(request.body);
      if (!body.success)
        throw new ValidationError(body.error.errors.map((e) => e.message).join('; '));

      const before = await CostCenterService.getById(ctx.db, tenantId, id);
      const updated = await CostCenterService.update(ctx.db, tenantId, id, body.data);
      await ctx.audit.log({
        action: 'UPDATE',
        entityType: 'cost_center',
        entityId: id,
        before: before as unknown as Record<string, unknown>,
        after: updated as unknown as Record<string, unknown>,
      });

      return reply.code(200).send({ data: updated });
    }
  );

  // ── DELETE /cost-centers/:id — soft-delete ───────────────────────────────
  fastify.delete<{ Params: { id: string } }>(
    '/cost-centers/:id',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.COST_CENTER_MANAGE)] },
    async (request, reply) => {
      const { tenantId, userId } = (request as unknown as AuthedRequest).auth;
      const ctx = ctxFactory.create({
        tenantId,
        userId,
        correlationId: (request.headers['x-correlation-id'] as string) ?? crypto.randomUUID(),
      });
      const id = parseInt(request.params.id, 10);
      const before = await CostCenterService.getById(ctx.db, tenantId, id);
      await CostCenterService.softDelete(ctx.db, tenantId, id);
      await ctx.audit.log({
        action: 'DELETE',
        entityType: 'cost_center',
        entityId: id,
        before: before as unknown as Record<string, unknown>,
      });

      return reply.code(204).send();
    }
  );
}
