import type { FastifyInstance } from 'fastify';
import type { PlatformContextFactory } from '@erp/sdk';
import { z } from 'zod';
import { PERMISSIONS } from '@erp/types';
import { authenticate } from '../middleware/authenticate.js';
import { requirePermission } from '../middleware/authorize.js';
import { ReorderService } from '../domain/ReorderService.js';

const CreatePOsSchema = z.object({
  branchId: z.number().int().positive(),
  warehouseId: z.number().int().positive(),
  placeOfSupply: z.string().length(2),
  items: z.array(z.object({
    itemId: z.number().int().positive(),
    supplierId: z.number().int().positive(),
    quantity: z.number().positive(),
    unitPrice: z.number().nonnegative(),
  })).min(1),
});

export async function reorderRoutes(
  fastify: FastifyInstance,
  ctxFactory: PlatformContextFactory
): Promise<void> {
  fastify.addHook('preHandler', authenticate);

  fastify.get('/inventory/reorder-required', {
    preHandler: requirePermission(PERMISSIONS.REORDER_VIEW),
    handler: async (req, reply) => {
      const q = req.query as { warehouseId?: string };
      const ctx = ctxFactory.create({
        tenantId: req.auth.tenantId,
        userId: req.auth.userId,
        correlationId: (req.headers['x-correlation-id'] as string | undefined) ?? crypto.randomUUID(),
      });
      const svc = new ReorderService(ctx.db.raw);
      const data = await svc.getReorderRequired(
        req.auth.tenantId,
        q.warehouseId ? parseInt(q.warehouseId, 10) : undefined
      );
      return reply.send({ data });
    },
  });

  fastify.post('/inventory/reorder/create-pos', {
    preHandler: requirePermission(PERMISSIONS.REORDER_CREATE_PO),
    handler: async (req, reply) => {
      const body = CreatePOsSchema.parse(req.body);
      const ctx = ctxFactory.create({
        tenantId: req.auth.tenantId,
        userId: req.auth.userId,
        correlationId: (req.headers['x-correlation-id'] as string | undefined) ?? crypto.randomUUID(),
      });
      const svc = new ReorderService(ctx.db.raw);
      const poIds = await svc.createPOsFromReorder({
        tenantId: req.auth.tenantId,
        branchId: body.branchId,
        warehouseId: body.warehouseId,
        placeOfSupply: body.placeOfSupply,
        items: body.items,
        createdBy: req.auth.userId,
      });
      return reply.code(201).send({ data: { poIds } });
    },
  });
}
