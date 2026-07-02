import type { FastifyInstance } from 'fastify';
import type { PlatformContextFactory } from '@erp/sdk';
import { z } from 'zod';
import { PERMISSIONS } from '@erp/types';
import Redis from 'ioredis';
import { authenticate } from '../middleware/authenticate.js';
import { requirePermission } from '../middleware/authorize.js';
import { BarcodeService } from '../domain/BarcodeService.js';

const GenerateSchema = z.object({
  itemId: z.number().int().positive(),
  variantId: z.number().int().positive().optional(),
  quantity: z.number().int().positive().max(1000),
  format: z.enum(['EAN13', 'CODE128', 'QR']),
  printFormat: z.enum(['A4_SHEET', 'LABEL_40x25', 'LABEL_60x40']),
});

export async function barcodeRoutes(
  fastify: FastifyInstance,
  ctxFactory: PlatformContextFactory,
  redis: Redis
): Promise<void> {
  fastify.addHook('preHandler', authenticate);

  fastify.post('/barcodes/generate', {
    preHandler: requirePermission(PERMISSIONS.BARCODE_GENERATE),
    handler: async (req, reply) => {
      const body = GenerateSchema.parse(req.body);
      const ctx = ctxFactory.create({
        tenantId: req.auth.tenantId,
        userId: req.auth.userId,
        correlationId: (req.headers['x-correlation-id'] as string | undefined) ?? crypto.randomUUID(),
      });
      const svc = new BarcodeService(ctx.db.raw, redis);
      const protocol = req.headers['x-forwarded-proto'] ?? 'http';
      const host = req.headers.host ?? 'localhost:3021';
      const baseUrl = `${String(protocol)}://${String(host)}`;

      const result = await svc.generate({
        tenantId: req.auth.tenantId,
        itemId: body.itemId,
        variantId: body.variantId,
        quantity: body.quantity,
        format: body.format,
        printFormat: body.printFormat,
        createdBy: req.auth.userId,
        baseUrl,
      });
      return reply.code(201).send({ data: result });
    },
  });

  fastify.get('/barcodes/print/:batchId', {
    preHandler: requirePermission(PERMISSIONS.BARCODE_PRINT),
    handler: async (req, reply) => {
      const { batchId } = req.params as { batchId: string };
      const ctx = ctxFactory.create({
        tenantId: req.auth.tenantId,
        userId: req.auth.userId,
        correlationId: (req.headers['x-correlation-id'] as string | undefined) ?? crypto.randomUUID(),
      });
      const svc = new BarcodeService(ctx.db.raw, redis);
      const data = await svc.getPrintData(parseInt(batchId, 10), req.auth.tenantId);
      return reply.send({ data });
    },
  });

  fastify.post('/barcodes/:id/deactivate', {
    preHandler: requirePermission(PERMISSIONS.BARCODE_GENERATE),
    handler: async (req, reply) => {
      const { id } = req.params as { id: string };
      const ctx = ctxFactory.create({
        tenantId: req.auth.tenantId,
        userId: req.auth.userId,
        correlationId: (req.headers['x-correlation-id'] as string | undefined) ?? crypto.randomUUID(),
      });
      const svc = new BarcodeService(ctx.db.raw, redis);
      await svc.deactivate(parseInt(id, 10), req.auth.tenantId, req.auth.userId);
      return reply.send({ data: { success: true } });
    },
  });

  // Fast barcode lookup — Redis-cached, < 50ms
  fastify.get('/items/by-barcode/:value', {
    preHandler: requirePermission(PERMISSIONS.ITEM_VIEW),
    handler: async (req, reply) => {
      const { value } = req.params as { value: string };
      const ctx = ctxFactory.create({
        tenantId: req.auth.tenantId,
        userId: req.auth.userId,
        correlationId: (req.headers['x-correlation-id'] as string | undefined) ?? crypto.randomUUID(),
      });
      const svc = new BarcodeService(ctx.db.raw, redis);
      const data = await svc.lookupByValue(value, req.auth.tenantId);
      return reply.send({ data });
    },
  });

  fastify.get('/barcodes/batches', {
    preHandler: requirePermission(PERMISSIONS.BARCODE_VIEW),
    handler: async (req, reply) => {
      const q = req.query as { itemId?: string };
      const ctx = ctxFactory.create({
        tenantId: req.auth.tenantId,
        userId: req.auth.userId,
        correlationId: (req.headers['x-correlation-id'] as string | undefined) ?? crypto.randomUUID(),
      });
      const svc = new BarcodeService(ctx.db.raw, redis);
      const data = await svc.listBatches(req.auth.tenantId, q.itemId ? parseInt(q.itemId, 10) : undefined);
      return reply.send({ data });
    },
  });
}
