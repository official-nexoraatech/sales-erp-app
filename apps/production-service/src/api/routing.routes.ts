import type { FastifyInstance } from 'fastify';
import type { PlatformContextFactory } from '@erp/sdk';
import { tenantScopedHandler } from '@erp/sdk';
import { z } from 'zod';
import { PERMISSIONS } from '@erp/types';
import { authenticate } from '../middleware/authenticate.js';
import { requirePermission } from '../middleware/authorize.js';
import { RoutingService } from '../domain/RoutingService.js';

const OperationSchema = z.object({
  sequenceNo: z.number().int().positive(),
  operationName: z.string().min(1).max(200),
  workCenterId: z.number().int().positive().optional(),
  standardTimeMinutes: z.number().nonnegative().optional(),
});

const CreateRoutingSchema = z.object({
  name: z.string().min(1).max(200),
  finishedItemId: z.number().int().positive(),
  finishedVariantId: z.number().int().positive().optional(),
  operations: z.array(OperationSchema).min(1),
});

// Manufacturing vertical — Routing CRUD, built with tenantScopedHandler from day one, same
// pattern as bom.routes.ts/work-center.routes.ts.
export async function routingRoutes(
  fastify: FastifyInstance,
  ctxFactory: PlatformContextFactory
): Promise<void> {
  fastify.addHook('preHandler', authenticate);

  fastify.post('/routings', {
    preHandler: requirePermission(PERMISSIONS.ROUTING_CREATE),
    handler: tenantScopedHandler(ctxFactory, async (req, reply, ctx) => {
      const body = CreateRoutingSchema.parse(req.body);
      const svc = new RoutingService(ctx.db.raw);
      const id = await svc.create({
        tenantId: ctx.tenant.tenantId,
        name: body.name,
        finishedItemId: body.finishedItemId,
        finishedVariantId: body.finishedVariantId,
        operations: body.operations,
        createdBy: ctx.tenant.userId,
      });
      return reply.code(201).send({ data: { id } });
    }),
  });

  fastify.get('/routings/for-item/:itemId', {
    preHandler: requirePermission(PERMISSIONS.ROUTING_VIEW),
    handler: tenantScopedHandler(ctxFactory, async (req, reply, ctx) => {
      const { itemId } = req.params as { itemId: string };
      const svc = new RoutingService(ctx.db.raw);
      const rows = await svc.listForItem(parseInt(itemId, 10), ctx.tenant.tenantId);
      return reply.send({ data: rows });
    }),
  });

  fastify.get('/routings/:id', {
    preHandler: requirePermission(PERMISSIONS.ROUTING_VIEW),
    handler: tenantScopedHandler(ctxFactory, async (req, reply, ctx) => {
      const { id } = req.params as { id: string };
      const svc = new RoutingService(ctx.db.raw);
      const result = await svc.getById(parseInt(id, 10), ctx.tenant.tenantId);
      if (!result)
        return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Routing not found' } });
      return reply.send({ data: result });
    }),
  });

  // Restricted to non-active, unreferenced routings — see RoutingService.delete()'s own header
  // comment.
  fastify.delete('/routings/:id', {
    preHandler: requirePermission(PERMISSIONS.ROUTING_DELETE),
    handler: tenantScopedHandler(ctxFactory, async (req, reply, ctx) => {
      const { id } = req.params as { id: string };
      const svc = new RoutingService(ctx.db.raw);
      await svc.delete(parseInt(id, 10), ctx.tenant.tenantId);
      return reply.code(204).send();
    }),
  });
}
