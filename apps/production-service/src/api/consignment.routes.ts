import type { FastifyInstance } from 'fastify';
import type { PlatformContextFactory } from '@erp/sdk';
import { z } from 'zod';
import { PERMISSIONS } from '@erp/types';
import { authenticate } from '../middleware/authenticate.js';
import { requirePermission } from '../middleware/authorize.js';
import { ConsignmentService } from '../domain/ConsignmentService.js';

const ReceiveSchema = z.object({
  supplierId: z.number().int().positive(),
  itemId: z.number().int().positive(),
  variantId: z.number().int().positive().optional(),
  warehouseId: z.number().int().positive(),
  receivedQty: z.number().positive(),
  agreedRate: z.number().nonnegative(),
  receivedDate: z.string().datetime(),
  referenceNumber: z.string().max(100).optional(),
  notes: z.string().max(2000).optional(),
});

const ReturnSchema = z.object({
  returnQty: z.number().positive(),
});

const SettleSchema = z.object({
  paymentReference: z.string().min(1).max(100),
});

const CreateSettlementSchema = z.object({
  supplierId: z.number().int().positive(),
  periodFrom: z.string().datetime(),
  periodTo: z.string().datetime(),
});

export async function consignmentRoutes(
  fastify: FastifyInstance,
  ctxFactory: PlatformContextFactory
): Promise<void> {
  fastify.addHook('preHandler', authenticate);

  fastify.post('/consignment/receive', {
    preHandler: requirePermission(PERMISSIONS.CONSIGNMENT_RECEIVE),
    handler: async (req, reply) => {
      const body = ReceiveSchema.parse(req.body);
      const ctx = ctxFactory.create({
        tenantId: req.auth.tenantId,
        userId: req.auth.userId,
        correlationId:
          (req.headers['x-correlation-id'] as string | undefined) ?? crypto.randomUUID(),
      });
      const svc = new ConsignmentService(ctx.db.raw);
      const id = await svc.receive({
        tenantId: req.auth.tenantId,
        supplierId: body.supplierId,
        itemId: body.itemId,
        variantId: body.variantId,
        warehouseId: body.warehouseId,
        receivedQty: body.receivedQty,
        agreedRate: body.agreedRate,
        receivedDate: new Date(body.receivedDate),
        referenceNumber: body.referenceNumber,
        notes: body.notes,
        createdBy: req.auth.userId,
      });
      return reply.code(201).send({ data: { id } });
    },
  });

  fastify.get('/consignment/stock', {
    preHandler: requirePermission(PERMISSIONS.CONSIGNMENT_VIEW),
    handler: async (req, reply) => {
      const q = req.query as { supplierId?: string };
      const ctx = ctxFactory.create({
        tenantId: req.auth.tenantId,
        userId: req.auth.userId,
        correlationId:
          (req.headers['x-correlation-id'] as string | undefined) ?? crypto.randomUUID(),
      });
      const svc = new ConsignmentService(ctx.db.raw);
      const data = await svc.listStock(
        req.auth.tenantId,
        q.supplierId ? parseInt(q.supplierId, 10) : undefined
      );
      return reply.send({ data });
    },
  });

  fastify.get('/consignment/settlements', {
    preHandler: requirePermission(PERMISSIONS.CONSIGNMENT_VIEW),
    handler: async (req, reply) => {
      const q = req.query as { supplierId?: string };
      const ctx = ctxFactory.create({
        tenantId: req.auth.tenantId,
        userId: req.auth.userId,
        correlationId:
          (req.headers['x-correlation-id'] as string | undefined) ?? crypto.randomUUID(),
      });
      const svc = new ConsignmentService(ctx.db.raw);
      const data = await svc.listSettlements(
        req.auth.tenantId,
        q.supplierId ? parseInt(q.supplierId, 10) : undefined
      );
      return reply.send({ data });
    },
  });

  fastify.post('/consignment/settlements', {
    preHandler: requirePermission(PERMISSIONS.CONSIGNMENT_SETTLE),
    handler: async (req, reply) => {
      const body = CreateSettlementSchema.parse(req.body);
      const ctx = ctxFactory.create({
        tenantId: req.auth.tenantId,
        userId: req.auth.userId,
        correlationId:
          (req.headers['x-correlation-id'] as string | undefined) ?? crypto.randomUUID(),
      });
      const svc = new ConsignmentService(ctx.db.raw);
      // Same auto-numbering convention as job-work/invoice/quotation routes — settlementNumber
      // was never set anywhere, so every settlement was permanently blank in the list.
      const settlementNumber = `CS-${req.auth.tenantId}-${Date.now()}`;
      const id = await svc.createSettlement(
        req.auth.tenantId,
        settlementNumber,
        body.supplierId,
        new Date(body.periodFrom),
        new Date(body.periodTo),
        req.auth.userId
      );
      return reply.code(201).send({ data: { id, settlementNumber } });
    },
  });

  fastify.post('/consignment/settle/:id', {
    preHandler: requirePermission(PERMISSIONS.CONSIGNMENT_SETTLE),
    handler: async (req, reply) => {
      const { id } = req.params as { id: string };
      const body = SettleSchema.parse(req.body);
      const ctx = ctxFactory.create({
        tenantId: req.auth.tenantId,
        userId: req.auth.userId,
        correlationId:
          (req.headers['x-correlation-id'] as string | undefined) ?? crypto.randomUUID(),
      });
      const svc = new ConsignmentService(ctx.db.raw);
      await svc.settle(parseInt(id, 10), req.auth.tenantId, body.paymentReference, req.auth.userId);
      return reply.send({ data: { success: true } });
    },
  });

  fastify.post('/consignment/return/:id', {
    preHandler: requirePermission(PERMISSIONS.CONSIGNMENT_RETURN),
    handler: async (req, reply) => {
      const { id } = req.params as { id: string };
      const body = ReturnSchema.parse(req.body);
      const ctx = ctxFactory.create({
        tenantId: req.auth.tenantId,
        userId: req.auth.userId,
        correlationId:
          (req.headers['x-correlation-id'] as string | undefined) ?? crypto.randomUUID(),
      });
      const svc = new ConsignmentService(ctx.db.raw);
      await svc.returnToSupplier(
        parseInt(id, 10),
        req.auth.tenantId,
        body.returnQty,
        req.auth.userId
      );
      return reply.send({ data: { success: true } });
    },
  });
}
