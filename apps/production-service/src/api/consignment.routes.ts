import type { FastifyInstance } from 'fastify';
import type { PlatformContextFactory } from '@erp/sdk';
import { tenantScopedHandler } from '@erp/sdk';
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

// Phase 9 GUC-per-request rollout — migrated 2026-08-21. Every write method on
// ConsignmentService (receive/returnToSupplier/settle/createSettlement) already wraps in one
// internal this.db.transaction() — see 23-guc-per-request-rollout-checklist.md step 3.
// recordSale() (row-locked FIFO consumption, covered by consignment-concurrency.integration.
// test.ts) isn't called from any route here, unaffected by this migration either way.
export async function consignmentRoutes(
  fastify: FastifyInstance,
  ctxFactory: PlatformContextFactory
): Promise<void> {
  fastify.addHook('preHandler', authenticate);

  fastify.post('/consignment/receive', {
    preHandler: requirePermission(PERMISSIONS.CONSIGNMENT_RECEIVE),
    handler: tenantScopedHandler(ctxFactory, async (req, reply, ctx) => {
      const body = ReceiveSchema.parse(req.body);
      const svc = new ConsignmentService(ctx.db.raw);
      const id = await svc.receive({
        tenantId: ctx.tenant.tenantId,
        supplierId: body.supplierId,
        itemId: body.itemId,
        variantId: body.variantId,
        warehouseId: body.warehouseId,
        receivedQty: body.receivedQty,
        agreedRate: body.agreedRate,
        receivedDate: new Date(body.receivedDate),
        referenceNumber: body.referenceNumber,
        notes: body.notes,
        createdBy: ctx.tenant.userId,
      });
      return reply.code(201).send({ data: { id } });
    }),
  });

  fastify.get('/consignment/stock', {
    preHandler: requirePermission(PERMISSIONS.CONSIGNMENT_VIEW),
    handler: tenantScopedHandler(ctxFactory, async (req, reply, ctx) => {
      const q = req.query as { supplierId?: string };
      const svc = new ConsignmentService(ctx.db.raw);
      const data = await svc.listStock(
        ctx.tenant.tenantId,
        q.supplierId ? parseInt(q.supplierId, 10) : undefined
      );
      return reply.send({ data });
    }),
  });

  fastify.get('/consignment/settlements', {
    preHandler: requirePermission(PERMISSIONS.CONSIGNMENT_VIEW),
    handler: tenantScopedHandler(ctxFactory, async (req, reply, ctx) => {
      const q = req.query as { supplierId?: string };
      const svc = new ConsignmentService(ctx.db.raw);
      const data = await svc.listSettlements(
        ctx.tenant.tenantId,
        q.supplierId ? parseInt(q.supplierId, 10) : undefined
      );
      return reply.send({ data });
    }),
  });

  fastify.post('/consignment/settlements', {
    preHandler: requirePermission(PERMISSIONS.CONSIGNMENT_SETTLE),
    handler: tenantScopedHandler(ctxFactory, async (req, reply, ctx) => {
      const body = CreateSettlementSchema.parse(req.body);
      const svc = new ConsignmentService(ctx.db.raw);
      // Same auto-numbering convention as job-work/invoice/quotation routes — settlementNumber
      // was never set anywhere, so every settlement was permanently blank in the list.
      const settlementNumber = `CS-${ctx.tenant.tenantId}-${Date.now()}`;
      const id = await svc.createSettlement(
        ctx.tenant.tenantId,
        settlementNumber,
        body.supplierId,
        new Date(body.periodFrom),
        new Date(body.periodTo),
        ctx.tenant.userId
      );
      return reply.code(201).send({ data: { id, settlementNumber } });
    }),
  });

  fastify.post('/consignment/settle/:id', {
    preHandler: requirePermission(PERMISSIONS.CONSIGNMENT_SETTLE),
    handler: tenantScopedHandler(ctxFactory, async (req, reply, ctx) => {
      const { id } = req.params as { id: string };
      const body = SettleSchema.parse(req.body);
      const svc = new ConsignmentService(ctx.db.raw);
      await svc.settle(
        parseInt(id, 10),
        ctx.tenant.tenantId,
        body.paymentReference,
        ctx.tenant.userId
      );
      return reply.send({ data: { success: true } });
    }),
  });

  fastify.post('/consignment/return/:id', {
    preHandler: requirePermission(PERMISSIONS.CONSIGNMENT_RETURN),
    handler: tenantScopedHandler(ctxFactory, async (req, reply, ctx) => {
      const { id } = req.params as { id: string };
      const body = ReturnSchema.parse(req.body);
      const svc = new ConsignmentService(ctx.db.raw);
      await svc.returnToSupplier(
        parseInt(id, 10),
        ctx.tenant.tenantId,
        body.returnQty,
        ctx.tenant.userId
      );
      return reply.send({ data: { success: true } });
    }),
  });
}
