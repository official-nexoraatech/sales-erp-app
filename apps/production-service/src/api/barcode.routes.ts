import type { FastifyInstance } from 'fastify';
import type { PlatformContextFactory } from '@erp/sdk';
import { tenantScopedHandler } from '@erp/sdk';
import { z } from 'zod';
import { PERMISSIONS } from '@erp/types';
import { authenticate } from '../middleware/authenticate.js';
import { requirePermission } from '../middleware/authorize.js';
import { BarcodeService } from '../domain/BarcodeService.js';

const GenerateSchema = z.object({
  itemId: z.number().int().positive(),
  variantId: z.number().int().positive().optional(),
  quantity: z.number().int().positive().max(1000),
  format: z.enum(['EAN13', 'CODE128', 'QR']),
  printFormat: z.enum(['A4_SHEET', 'LABEL_40x25', 'LABEL_60x40', 'LABEL_50x25', 'LABEL_100x50']),
});

// Phase 9 GUC-per-request rollout — migrated 2026-08-21. generate() already wraps in one
// internal this.db.transaction(); deactivate() is a single select+update, one logical unit
// today either way — see 23-guc-per-request-rollout-checklist.md step 3.
export async function barcodeRoutes(
  fastify: FastifyInstance,
  ctxFactory: PlatformContextFactory
): Promise<void> {
  fastify.addHook('preHandler', authenticate);

  fastify.post('/barcodes/generate', {
    preHandler: requirePermission(PERMISSIONS.BARCODE_GENERATE),
    handler: tenantScopedHandler(ctxFactory, async (req, reply, ctx) => {
      const body = GenerateSchema.parse(req.body);
      const svc = new BarcodeService(ctx.db.raw, ctx.cache);
      const protocol = req.headers['x-forwarded-proto'] ?? 'http';
      const host = req.headers.host ?? 'localhost:3021';
      const baseUrl = `${String(protocol)}://${String(host)}`;

      const result = await svc.generate({
        tenantId: ctx.tenant.tenantId,
        itemId: body.itemId,
        variantId: body.variantId,
        quantity: body.quantity,
        format: body.format,
        printFormat: body.printFormat,
        createdBy: ctx.tenant.userId,
        baseUrl,
      });
      return reply.code(201).send({ data: result });
    }),
  });

  fastify.get('/barcodes/print/:batchId', {
    preHandler: requirePermission(PERMISSIONS.BARCODE_PRINT),
    handler: tenantScopedHandler(ctxFactory, async (req, reply, ctx) => {
      const { batchId } = req.params as { batchId: string };
      const svc = new BarcodeService(ctx.db.raw, ctx.cache);
      const data = await svc.getPrintData(parseInt(batchId, 10), ctx.tenant.tenantId);
      return reply.send({ data });
    }),
  });

  fastify.post('/barcodes/:id/deactivate', {
    preHandler: requirePermission(PERMISSIONS.BARCODE_GENERATE),
    handler: tenantScopedHandler(ctxFactory, async (req, reply, ctx) => {
      const { id } = req.params as { id: string };
      const svc = new BarcodeService(ctx.db.raw, ctx.cache);
      await svc.deactivate(parseInt(id, 10), ctx.tenant.tenantId, ctx.tenant.userId);
      return reply.send({ data: { success: true } });
    }),
  });

  // Fast barcode lookup — Redis-cached, < 50ms
  fastify.get('/items/by-barcode/:value', {
    preHandler: requirePermission(PERMISSIONS.ITEM_VIEW),
    handler: tenantScopedHandler(ctxFactory, async (req, reply, ctx) => {
      const { value } = req.params as { value: string };
      const svc = new BarcodeService(ctx.db.raw, ctx.cache);
      const data = await svc.lookupByValue(value, ctx.tenant.tenantId);
      return reply.send({ data });
    }),
  });

  fastify.get('/barcodes/batches', {
    preHandler: requirePermission(PERMISSIONS.BARCODE_VIEW),
    handler: tenantScopedHandler(ctxFactory, async (req, reply, ctx) => {
      const q = req.query as { itemId?: string };
      const svc = new BarcodeService(ctx.db.raw, ctx.cache);
      const data = await svc.listBatches(
        ctx.tenant.tenantId,
        q.itemId ? parseInt(q.itemId, 10) : undefined
      );
      return reply.send({ data });
    }),
  });
}
