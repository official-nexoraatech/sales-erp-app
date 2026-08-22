import type { FastifyInstance } from 'fastify';
import type { PlatformContextFactory } from '@erp/sdk';
import { tenantScopedHandler } from '@erp/sdk';
import { z } from 'zod';
import { PERMISSIONS } from '@erp/types';
import { authenticate } from '../middleware/authenticate.js';
import { requirePermission } from '../middleware/authorize.js';
import { JobWorkOrderService } from '../domain/JobWorkOrderService.js';

const MaterialSchema = z.object({
  itemId: z.number().int().positive(),
  variantId: z.number().int().positive().optional(),
  requiredQty: z.number().positive(),
  unitCost: z.number().nonnegative(),
  warehouseId: z.number().int().positive(),
});

const CreateJobWorkSchema = z
  .object({
    supplierId: z.number().int().positive(),
    branchId: z.number().int().positive(),
    warehouseId: z.number().int().positive(),
    outputItemId: z.number().int().positive(),
    outputVariantId: z.number().int().positive().optional(),
    workCenterId: z.number().int().positive().optional(),
    orderedQty: z.number().positive(),
    jobWorkRate: z.number().nonnegative(),
    orderDate: z.string().datetime(),
    expectedDate: z.string().datetime().optional(),
    // Either materials (hand-entered) or bomId (auto-populated via BOMService.explode()) —
    // bomId takes precedence when both are sent.
    materials: z.array(MaterialSchema).optional(),
    bomId: z.number().int().positive().optional(),
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

// Phase 9 GUC-per-request rollout — migrated 2026-08-21. Every write method on
// JobWorkOrderService (create/issueMaterials/startQualityCheck/submitQualityChecks/complete/
// cancel) already wraps its own work in one internal this.db.transaction() call, so wrapping the
// whole handler in tenantScopedHandler's outer transaction (a savepoint around each one) changes
// no existing atomicity behavior — see 23-guc-per-request-rollout-checklist.md step 3.
export async function jobWorkRoutes(
  fastify: FastifyInstance,
  ctxFactory: PlatformContextFactory
): Promise<void> {
  fastify.addHook('preHandler', authenticate);

  fastify.get('/job-work-orders', {
    preHandler: requirePermission(PERMISSIONS.JOB_WORK_VIEW),
    handler: tenantScopedHandler(ctxFactory, async (req, reply, ctx) => {
      const q = req.query as {
        status?: string;
        supplierId?: string;
        page?: string;
        pageSize?: string;
      };
      const svc = new JobWorkOrderService(ctx.db.raw);
      const listParams: { status?: string; supplierId?: number; page: number; pageSize: number } = {
        page: Math.max(1, parseInt(q.page ?? '1', 10)),
        pageSize: Math.min(100, parseInt(q.pageSize ?? '20', 10)),
      };
      if (q.status) listParams.status = q.status;
      if (q.supplierId) listParams.supplierId = parseInt(q.supplierId, 10);
      const rows = await svc.list(ctx.tenant.tenantId, listParams);
      return reply.send({ data: rows });
    }),
  });

  fastify.get('/job-work-orders/in-progress', {
    preHandler: requirePermission(PERMISSIONS.JOB_WORK_VIEW),
    handler: tenantScopedHandler(ctxFactory, async (_req, reply, ctx) => {
      const svc = new JobWorkOrderService(ctx.db.raw);
      const rows = await svc.listInProgress(ctx.tenant.tenantId);
      return reply.send({ data: rows });
    }),
  });

  fastify.get('/job-work-orders/dashboard', {
    preHandler: requirePermission(PERMISSIONS.JOB_WORK_VIEW),
    handler: tenantScopedHandler(ctxFactory, async (_req, reply, ctx) => {
      const svc = new JobWorkOrderService(ctx.db.raw);
      const stats = await svc.getDashboardStats(ctx.tenant.tenantId);
      return reply.send({ data: stats });
    }),
  });

  fastify.post('/job-work-orders', {
    preHandler: requirePermission(PERMISSIONS.JOB_WORK_CREATE),
    handler: tenantScopedHandler(ctxFactory, async (req, reply, ctx) => {
      const body = CreateJobWorkSchema.parse(req.body);
      const svc = new JobWorkOrderService(ctx.db.raw);
      // Same auto-numbering convention as invoice/quotation routes (INV-/QT-{tenantId}-{ts}) —
      // orderNumber was never set anywhere in the create path, so every job work order was
      // permanently blank in the list, detail, and QC pages.
      const orderNumber = `JWO-${ctx.tenant.tenantId}-${Date.now()}`;
      const id = await svc.create({
        tenantId: ctx.tenant.tenantId,
        orderNumber,
        supplierId: body.supplierId,
        branchId: body.branchId,
        warehouseId: body.warehouseId,
        outputItemId: body.outputItemId,
        outputVariantId: body.outputVariantId,
        workCenterId: body.workCenterId,
        orderedQty: body.orderedQty,
        jobWorkRate: body.jobWorkRate,
        orderDate: new Date(body.orderDate),
        expectedDate: body.expectedDate ? new Date(body.expectedDate) : undefined,
        materials: body.materials,
        bomId: body.bomId,
        notes: body.notes,
        createdBy: ctx.tenant.userId,
      });
      return reply.code(201).send({ data: { id, orderNumber } });
    }),
  });

  fastify.get('/job-work-orders/:id', {
    preHandler: requirePermission(PERMISSIONS.JOB_WORK_VIEW),
    handler: tenantScopedHandler(ctxFactory, async (req, reply, ctx) => {
      const { id } = req.params as { id: string };
      const svc = new JobWorkOrderService(ctx.db.raw);
      const data = await svc.getWithDetails(parseInt(id, 10), ctx.tenant.tenantId);
      return reply.send({ data });
    }),
  });

  fastify.post('/job-work-orders/:id/issue-materials', {
    preHandler: requirePermission(PERMISSIONS.JOB_WORK_ISSUE_MATERIALS),
    handler: tenantScopedHandler(ctxFactory, async (req, reply, ctx) => {
      const { id } = req.params as { id: string };
      const svc = new JobWorkOrderService(ctx.db.raw);
      await svc.issueMaterials(parseInt(id, 10), ctx.tenant.tenantId, ctx.tenant.userId);
      return reply.send({ data: { success: true } });
    }),
  });

  fastify.post('/job-work-orders/:id/start-quality-check', {
    preHandler: requirePermission(PERMISSIONS.JOB_WORK_QUALITY_CHECK),
    handler: tenantScopedHandler(ctxFactory, async (req, reply, ctx) => {
      const { id } = req.params as { id: string };
      const svc = new JobWorkOrderService(ctx.db.raw);
      await svc.startQualityCheck(parseInt(id, 10), ctx.tenant.tenantId, ctx.tenant.userId);
      return reply.send({ data: { success: true } });
    }),
  });

  fastify.post('/job-work-orders/:id/quality-checks', {
    preHandler: requirePermission(PERMISSIONS.JOB_WORK_QUALITY_CHECK),
    handler: tenantScopedHandler(ctxFactory, async (req, reply, ctx) => {
      const { id } = req.params as { id: string };
      const body = QualityCheckSchema.parse(req.body);
      const svc = new JobWorkOrderService(ctx.db.raw);
      await svc.submitQualityChecks(
        parseInt(id, 10),
        ctx.tenant.tenantId,
        ctx.tenant.userId,
        body.entries
      );
      return reply.send({ data: { success: true } });
    }),
  });

  fastify.post('/job-work-orders/:id/complete', {
    preHandler: requirePermission(PERMISSIONS.JOB_WORK_COMPLETE),
    handler: tenantScopedHandler(ctxFactory, async (req, reply, ctx) => {
      const { id } = req.params as { id: string };
      const body = CompleteSchema.parse(req.body);
      const svc = new JobWorkOrderService(ctx.db.raw);
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

  fastify.post('/job-work-orders/:id/cancel', {
    preHandler: requirePermission(PERMISSIONS.JOB_WORK_CANCEL),
    handler: tenantScopedHandler(ctxFactory, async (req, reply, ctx) => {
      const { id } = req.params as { id: string };
      const body = CancelSchema.parse(req.body);
      const svc = new JobWorkOrderService(ctx.db.raw);
      await svc.cancel(parseInt(id, 10), ctx.tenant.tenantId, ctx.tenant.userId, body.reason);
      return reply.send({ data: { success: true } });
    }),
  });
}
