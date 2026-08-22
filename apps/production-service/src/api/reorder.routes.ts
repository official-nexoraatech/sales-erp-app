import type { FastifyInstance } from 'fastify';
import type { PlatformContextFactory } from '@erp/sdk';
import { tenantScopedHandler } from '@erp/sdk';
import { z } from 'zod';
import { PERMISSIONS } from '@erp/types';
import { authenticate } from '../middleware/authenticate.js';
import { requirePermission } from '../middleware/authorize.js';
import { ReorderService } from '../domain/ReorderService.js';

const CreatePOsSchema = z.object({
  branchId: z.number().int().positive(),
  warehouseId: z.number().int().positive(),
  placeOfSupply: z.string().length(2),
  items: z
    .array(
      z.object({
        itemId: z.number().int().positive(),
        supplierId: z.number().int().positive(),
        quantity: z.number().positive(),
        unitPrice: z.number().nonnegative(),
      })
    )
    .min(1),
});

export async function reorderRoutes(
  fastify: FastifyInstance,
  ctxFactory: PlatformContextFactory
): Promise<void> {
  fastify.addHook('preHandler', authenticate);

  // Phase 9 GUC-per-request rollout — migrated 2026-08-21. createPOsFromReorder() already wraps
  // all its PO creation in one this.db.transaction() internally (all POs succeed or none do), so
  // wrapping the whole handler in tenantScopedHandler's outer transaction changes nothing about
  // this file's existing atomicity — see 23-guc-per-request-rollout-checklist.md step 3.
  fastify.get('/inventory/reorder-required', {
    preHandler: requirePermission(PERMISSIONS.REORDER_VIEW),
    handler: tenantScopedHandler(ctxFactory, async (req, reply, ctx) => {
      const q = req.query as { warehouseId?: string };
      const svc = new ReorderService(ctx.db.raw);
      const data = await svc.getReorderRequired(
        ctx.tenant.tenantId,
        q.warehouseId ? parseInt(q.warehouseId, 10) : undefined
      );
      return reply.send({ data });
    }),
  });

  fastify.post('/inventory/reorder/create-pos', {
    preHandler: requirePermission(PERMISSIONS.REORDER_CREATE_PO),
    handler: tenantScopedHandler(ctxFactory, async (req, reply, ctx) => {
      const body = CreatePOsSchema.parse(req.body);
      const svc = new ReorderService(ctx.db.raw);
      const poIds = await svc.createPOsFromReorder({
        tenantId: ctx.tenant.tenantId,
        branchId: body.branchId,
        warehouseId: body.warehouseId,
        placeOfSupply: body.placeOfSupply,
        items: body.items,
        createdBy: ctx.tenant.userId,
      });
      return reply.code(201).send({ data: { poIds } });
    }),
  });
}
