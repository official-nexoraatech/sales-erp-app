import type { FastifyInstance } from 'fastify';
import type { PlatformContextFactory } from '@erp/sdk';
import { tenantScopedHandler } from '@erp/sdk';
import { z } from 'zod';
import { PERMISSIONS } from '@erp/types';
import { authenticate } from '../middleware/authenticate.js';
import { requirePermission } from '../middleware/authorize.js';
import { ProductionOrderService } from '../domain/ProductionOrderService.js';

const MaterialSchema = z.object({
  itemId: z.number().int().positive(),
  variantId: z.number().int().positive().optional(),
  requiredQty: z.number().positive(),
  unitCost: z.number().nonnegative(),
  warehouseId: z.number().int().positive(),
});

const CreateProductionOrderSchema = z
  .object({
    branchId: z.number().int().positive(),
    warehouseId: z.number().int().positive(),
    outputItemId: z.number().int().positive(),
    outputVariantId: z.number().int().positive().optional(),
    workCenterId: z.number().int().positive().optional(),
    orderedQty: z.number().positive(),
    laborCost: z.number().nonnegative().default(0),
    overheadCost: z.number().nonnegative().default(0),
    orderDate: z.string().datetime(),
    expectedDate: z.string().datetime().optional(),
    // Either materials (hand-entered) or bomId (auto-populated via BOMService.explode()) —
    // bomId takes precedence when both are sent.
    materials: z.array(MaterialSchema).optional(),
    bomId: z.number().int().positive().optional(),
    routingId: z.number().int().positive().optional(),
    notes: z.string().max(2000).optional(),
  })
  .refine((data) => data.bomId !== undefined || data.materials !== undefined, {
    message: 'Either materials or bomId must be provided',
  });

const QualityCheckSchema = z.object({
  entries: z
    .array(
      z.object({
        pieceNumber: z.number().int().positive(),
        result: z.enum(['PASS', 'FAIL', 'REWORK']),
        defectNotes: z.string().max(500).optional(),
      })
    )
    .min(1),
});

const CompleteSchema = z.object({
  receivedQty: z.number().nonnegative(),
  rejectedQty: z.number().nonnegative(),
  scrapQty: z.number().nonnegative(),
});

const CancelSchema = z.object({
  reason: z.string().min(1).max(500),
});

// Manufacturing vertical — standalone Production Order (in-house manufacturing, distinct from
// Job Work Order's outsourced-to-a-supplier model). Every write method on ProductionOrderService
// already wraps its own work in one internal this.db.transaction() call, so tenantScopedHandler's
// outer transaction (a savepoint around each one) changes no atomicity behavior — same shape as
// job-work.routes.ts, built with the Phase-9 GUC wrapper from day one, not retrofitted.
export async function productionOrderRoutes(
  fastify: FastifyInstance,
  ctxFactory: PlatformContextFactory
): Promise<void> {
  fastify.addHook('preHandler', authenticate);

  fastify.get('/production-orders', {
    preHandler: requirePermission(PERMISSIONS.PRODUCTION_ORDER_VIEW),
    handler: tenantScopedHandler(ctxFactory, async (req, reply, ctx) => {
      const q = req.query as { status?: string; page?: string; pageSize?: string };
      const svc = new ProductionOrderService(ctx.db.raw);
      const listParams: { status?: string; page: number; pageSize: number } = {
        page: Math.max(1, parseInt(q.page ?? '1', 10)),
        pageSize: Math.min(100, parseInt(q.pageSize ?? '20', 10)),
      };
      if (q.status) listParams.status = q.status;
      const rows = await svc.list(ctx.tenant.tenantId, listParams);
      return reply.send({ data: rows });
    }),
  });

  fastify.get('/production-orders/dashboard', {
    preHandler: requirePermission(PERMISSIONS.PRODUCTION_ORDER_VIEW),
    handler: tenantScopedHandler(ctxFactory, async (_req, reply, ctx) => {
      const svc = new ProductionOrderService(ctx.db.raw);
      const stats = await svc.getDashboardStats(ctx.tenant.tenantId);
      return reply.send({ data: stats });
    }),
  });

  fastify.post('/production-orders', {
    preHandler: requirePermission(PERMISSIONS.PRODUCTION_ORDER_CREATE),
    handler: tenantScopedHandler(ctxFactory, async (req, reply, ctx) => {
      const body = CreateProductionOrderSchema.parse(req.body);
      const svc = new ProductionOrderService(ctx.db.raw);
      const orderNumber = `PO-${ctx.tenant.tenantId}-${Date.now()}`;
      const id = await svc.create({
        tenantId: ctx.tenant.tenantId,
        orderNumber,
        branchId: body.branchId,
        warehouseId: body.warehouseId,
        outputItemId: body.outputItemId,
        outputVariantId: body.outputVariantId,
        workCenterId: body.workCenterId,
        orderedQty: body.orderedQty,
        laborCost: body.laborCost,
        overheadCost: body.overheadCost,
        orderDate: new Date(body.orderDate),
        expectedDate: body.expectedDate ? new Date(body.expectedDate) : undefined,
        materials: body.materials,
        bomId: body.bomId,
        routingId: body.routingId,
        notes: body.notes,
        createdBy: ctx.tenant.userId,
      });
      return reply.code(201).send({ data: { id, orderNumber } });
    }),
  });

  fastify.get('/production-orders/:id', {
    preHandler: requirePermission(PERMISSIONS.PRODUCTION_ORDER_VIEW),
    handler: tenantScopedHandler(ctxFactory, async (req, reply, ctx) => {
      const { id } = req.params as { id: string };
      const svc = new ProductionOrderService(ctx.db.raw);
      const data = await svc.getWithDetails(parseInt(id, 10), ctx.tenant.tenantId);
      return reply.send({ data });
    }),
  });

  fastify.post('/production-orders/:id/issue-materials', {
    preHandler: requirePermission(PERMISSIONS.PRODUCTION_ORDER_ISSUE_MATERIALS),
    handler: tenantScopedHandler(ctxFactory, async (req, reply, ctx) => {
      const { id } = req.params as { id: string };
      const svc = new ProductionOrderService(ctx.db.raw);
      await svc.issueMaterials(parseInt(id, 10), ctx.tenant.tenantId, ctx.tenant.userId);
      return reply.send({ data: { success: true } });
    }),
  });

  // Routing extension — operation-level progress tracking, independent of the order's own
  // status machine (see ProductionOrderService.startOperation's own comment). Keyed by
  // operationId (a production_order_operations row), not the order id, since these routes act
  // on one instantiated step at a time.
  fastify.post('/production-orders/operations/:operationId/start', {
    preHandler: requirePermission(PERMISSIONS.PRODUCTION_ORDER_UPDATE),
    handler: tenantScopedHandler(ctxFactory, async (req, reply, ctx) => {
      const { operationId } = req.params as { operationId: string };
      const svc = new ProductionOrderService(ctx.db.raw);
      await svc.startOperation(parseInt(operationId, 10), ctx.tenant.tenantId);
      return reply.send({ data: { success: true } });
    }),
  });

  fastify.post('/production-orders/operations/:operationId/complete', {
    preHandler: requirePermission(PERMISSIONS.PRODUCTION_ORDER_UPDATE),
    handler: tenantScopedHandler(ctxFactory, async (req, reply, ctx) => {
      const { operationId } = req.params as { operationId: string };
      const body = z.object({ actualTimeMinutes: z.number().nonnegative() }).parse(req.body);
      const svc = new ProductionOrderService(ctx.db.raw);
      await svc.completeOperation(
        parseInt(operationId, 10),
        ctx.tenant.tenantId,
        body.actualTimeMinutes
      );
      return reply.send({ data: { success: true } });
    }),
  });

  fastify.post('/production-orders/:id/start-quality-check', {
    preHandler: requirePermission(PERMISSIONS.PRODUCTION_ORDER_QUALITY_CHECK),
    handler: tenantScopedHandler(ctxFactory, async (req, reply, ctx) => {
      const { id } = req.params as { id: string };
      const svc = new ProductionOrderService(ctx.db.raw);
      await svc.startQualityCheck(parseInt(id, 10), ctx.tenant.tenantId, ctx.tenant.userId);
      return reply.send({ data: { success: true } });
    }),
  });

  fastify.post('/production-orders/:id/quality-checks', {
    preHandler: requirePermission(PERMISSIONS.PRODUCTION_ORDER_QUALITY_CHECK),
    handler: tenantScopedHandler(ctxFactory, async (req, reply, ctx) => {
      const { id } = req.params as { id: string };
      const body = QualityCheckSchema.parse(req.body);
      const svc = new ProductionOrderService(ctx.db.raw);
      await svc.submitQualityChecks(
        parseInt(id, 10),
        ctx.tenant.tenantId,
        ctx.tenant.userId,
        body.entries
      );
      return reply.send({ data: { success: true } });
    }),
  });

  fastify.post('/production-orders/:id/complete', {
    preHandler: requirePermission(PERMISSIONS.PRODUCTION_ORDER_COMPLETE),
    handler: tenantScopedHandler(ctxFactory, async (req, reply, ctx) => {
      const { id } = req.params as { id: string };
      const body = CompleteSchema.parse(req.body);
      const svc = new ProductionOrderService(ctx.db.raw);
      await svc.complete(parseInt(id, 10), ctx.tenant.tenantId, {
        tenantId: ctx.tenant.tenantId,
        receivedQty: body.receivedQty,
        rejectedQty: body.rejectedQty,
        scrapQty: body.scrapQty,
        userId: ctx.tenant.userId,
      });
      return reply.send({ data: { success: true } });
    }),
  });

  fastify.post('/production-orders/:id/cancel', {
    preHandler: requirePermission(PERMISSIONS.PRODUCTION_ORDER_CANCEL),
    handler: tenantScopedHandler(ctxFactory, async (req, reply, ctx) => {
      const { id } = req.params as { id: string };
      const body = CancelSchema.parse(req.body);
      const svc = new ProductionOrderService(ctx.db.raw);
      await svc.cancel(parseInt(id, 10), ctx.tenant.tenantId, ctx.tenant.userId, body.reason);
      return reply.send({ data: { success: true } });
    }),
  });
}
