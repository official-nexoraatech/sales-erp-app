import type { FastifyInstance } from 'fastify';
import type { PlatformContextFactory } from '@erp/sdk';
import { tenantScopedHandler } from '@erp/sdk';
import { z } from 'zod';
import { PERMISSIONS } from '@erp/types';
import { authenticate } from '../middleware/authenticate.js';
import { requirePermission } from '../middleware/authorize.js';
import { BOMService } from '../domain/BOMService.js';

const BomLineSchema = z.object({
  componentItemId: z.number().int().positive(),
  componentVariantId: z.number().int().positive().optional(),
  quantityPerOutput: z.number().positive(),
  scrapPercent: z.number().min(0).max(100).optional(),
});

const CreateBomSchema = z.object({
  name: z.string().min(1).max(200),
  finishedItemId: z.number().int().positive(),
  finishedVariantId: z.number().int().positive().optional(),
  outputQty: z.number().positive().optional(),
  lines: z.array(BomLineSchema).min(1),
});

const ExplodeQuerySchema = z.object({
  qty: z.coerce.number().positive(),
});

// Manufacturing vertical, Phase A — Bill of Materials CRUD + explode.
// Phase 9 GUC-per-request pilot: each handler is wrapped in tenantScopedHandler (@erp/sdk) so its
// entire body runs inside one real Postgres transaction with app.current_tenant_id correctly set
// — see packages/platform-sdk/src/tenantConnection.ts for why this is the correct shape (a
// reserved-connection approach was tried first and doesn't support nested transactions, which
// BOMService.create() needs).
export async function bomRoutes(
  fastify: FastifyInstance,
  ctxFactory: PlatformContextFactory
): Promise<void> {
  fastify.addHook('preHandler', authenticate);

  fastify.post('/boms', {
    preHandler: requirePermission(PERMISSIONS.BOM_CREATE),
    handler: tenantScopedHandler(ctxFactory, async (req, reply, ctx) => {
      const body = CreateBomSchema.parse(req.body);
      const svc = new BOMService(ctx.db.raw);
      const id = await svc.create({
        tenantId: ctx.tenant.tenantId,
        name: body.name,
        finishedItemId: body.finishedItemId,
        finishedVariantId: body.finishedVariantId,
        outputQty: body.outputQty,
        lines: body.lines,
        createdBy: ctx.tenant.userId,
      });
      return reply.code(201).send({ data: { id } });
    }),
  });

  fastify.get('/boms/for-item/:itemId', {
    preHandler: requirePermission(PERMISSIONS.BOM_VIEW),
    handler: tenantScopedHandler(ctxFactory, async (req, reply, ctx) => {
      const { itemId } = req.params as { itemId: string };
      const svc = new BOMService(ctx.db.raw);
      const rows = await svc.listForItem(parseInt(itemId, 10), ctx.tenant.tenantId);
      return reply.send({ data: rows });
    }),
  });

  fastify.get('/boms/:id', {
    preHandler: requirePermission(PERMISSIONS.BOM_VIEW),
    handler: tenantScopedHandler(ctxFactory, async (req, reply, ctx) => {
      const { id } = req.params as { id: string };
      const svc = new BOMService(ctx.db.raw);
      const result = await svc.getById(parseInt(id, 10), ctx.tenant.tenantId);
      if (!result)
        return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'BOM not found' } });
      return reply.send({ data: result });
    }),
  });

  fastify.get('/boms/:id/explode', {
    preHandler: requirePermission(PERMISSIONS.BOM_VIEW),
    handler: tenantScopedHandler(ctxFactory, async (req, reply, ctx) => {
      const { id } = req.params as { id: string };
      const query = ExplodeQuerySchema.parse(req.query);
      const svc = new BOMService(ctx.db.raw);
      const lines = await svc.explode(parseInt(id, 10), ctx.tenant.tenantId, query.qty);
      return reply.send({ data: { lines } });
    }),
  });

  // Multi-level BOM extension — nested (indented) view for display, unlike /explode's flat,
  // aggregated leaf-level requirements list.
  fastify.get('/boms/:id/tree', {
    preHandler: requirePermission(PERMISSIONS.BOM_VIEW),
    handler: tenantScopedHandler(ctxFactory, async (req, reply, ctx) => {
      const { id } = req.params as { id: string };
      const query = ExplodeQuerySchema.parse(req.query);
      const svc = new BOMService(ctx.db.raw);
      const tree = await svc.explodeTree(parseInt(id, 10), ctx.tenant.tenantId, query.qty);
      return reply.send({ data: { tree } });
    }),
  });

  // Restricted to non-active BOMs — see BOMService.delete()'s own header comment.
  fastify.delete('/boms/:id', {
    preHandler: requirePermission(PERMISSIONS.BOM_DELETE),
    handler: tenantScopedHandler(ctxFactory, async (req, reply, ctx) => {
      const { id } = req.params as { id: string };
      const svc = new BOMService(ctx.db.raw);
      await svc.delete(parseInt(id, 10), ctx.tenant.tenantId);
      return reply.code(204).send();
    }),
  });
}
