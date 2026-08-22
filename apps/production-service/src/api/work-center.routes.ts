import type { FastifyInstance } from 'fastify';
import type { PlatformContextFactory } from '@erp/sdk';
import { tenantScopedHandler } from '@erp/sdk';
import { z } from 'zod';
import { PERMISSIONS } from '@erp/types';
import { authenticate } from '../middleware/authenticate.js';
import { requirePermission } from '../middleware/authorize.js';
import { WorkCenterService } from '../domain/WorkCenterService.js';

const CreateWorkCenterSchema = z.object({
  name: z.string().min(1).max(200),
  code: z.string().min(1).max(30),
  description: z.string().max(2000).optional(),
  capacityPerDay: z.number().nonnegative().optional(),
});

const UpdateWorkCenterSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(2000).optional(),
  capacityPerDay: z.number().nonnegative().optional(),
  isActive: z.boolean().optional(),
});

// Manufacturing vertical, Phase B — Work Centers CRUD.
// Phase 9 GUC-per-request pilot: wraps each handler in tenantScopedHandler, same as
// bom.routes.ts — see packages/platform-sdk/src/tenantConnection.ts.
export async function workCenterRoutes(
  fastify: FastifyInstance,
  ctxFactory: PlatformContextFactory
): Promise<void> {
  fastify.addHook('preHandler', authenticate);

  fastify.post('/work-centers', {
    preHandler: requirePermission(PERMISSIONS.WORK_CENTER_CREATE),
    handler: tenantScopedHandler(ctxFactory, async (req, reply, ctx) => {
      const body = CreateWorkCenterSchema.parse(req.body);
      const svc = new WorkCenterService(ctx.db.raw);
      const id = await svc.create({
        tenantId: ctx.tenant.tenantId,
        name: body.name,
        code: body.code,
        description: body.description,
        capacityPerDay: body.capacityPerDay,
        createdBy: ctx.tenant.userId,
      });
      return reply.code(201).send({ data: { id } });
    }),
  });

  fastify.get('/work-centers', {
    preHandler: requirePermission(PERMISSIONS.WORK_CENTER_VIEW),
    handler: tenantScopedHandler(ctxFactory, async (_req, reply, ctx) => {
      const svc = new WorkCenterService(ctx.db.raw);
      const rows = await svc.list(ctx.tenant.tenantId);
      return reply.send({ data: rows });
    }),
  });

  fastify.get('/work-centers/:id', {
    preHandler: requirePermission(PERMISSIONS.WORK_CENTER_VIEW),
    handler: tenantScopedHandler(ctxFactory, async (req, reply, ctx) => {
      const { id } = req.params as { id: string };
      const svc = new WorkCenterService(ctx.db.raw);
      const row = await svc.getById(parseInt(id, 10), ctx.tenant.tenantId);
      if (!row)
        return reply
          .code(404)
          .send({ error: { code: 'NOT_FOUND', message: 'Work center not found' } });
      return reply.send({ data: row });
    }),
  });

  fastify.put('/work-centers/:id', {
    preHandler: requirePermission(PERMISSIONS.WORK_CENTER_UPDATE),
    handler: tenantScopedHandler(ctxFactory, async (req, reply, ctx) => {
      const { id } = req.params as { id: string };
      const body = UpdateWorkCenterSchema.parse(req.body);
      const svc = new WorkCenterService(ctx.db.raw);
      await svc.update(parseInt(id, 10), ctx.tenant.tenantId, body);
      return reply.send({ data: { id: parseInt(id, 10) } });
    }),
  });
}
