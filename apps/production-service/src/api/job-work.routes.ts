import type { FastifyInstance } from 'fastify';
import type { PlatformContextFactory } from '@erp/sdk';
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

const CreateJobWorkSchema = z.object({
  supplierId: z.number().int().positive(),
  branchId: z.number().int().positive(),
  warehouseId: z.number().int().positive(),
  outputItemId: z.number().int().positive(),
  outputVariantId: z.number().int().positive().optional(),
  orderedQty: z.number().positive(),
  jobWorkRate: z.number().nonnegative(),
  orderDate: z.string().datetime(),
  expectedDate: z.string().datetime().optional(),
  materials: z.array(MaterialSchema),
  notes: z.string().max(2000).optional(),
});

const QualityCheckSchema = z.object({
  entries: z.array(z.object({
    pieceNumber: z.number().int().positive(),
    result: z.enum(['PASS', 'FAIL', 'REWORK']),
    defectNotes: z.string().max(500).optional(),
  })).min(1),
});

const CompleteSchema = z.object({
  receivedQty: z.number().nonnegative(),
  rejectedQty: z.number().nonnegative(),
  scrapQty: z.number().nonnegative(),
});

const CancelSchema = z.object({
  reason: z.string().min(1).max(500),
});

export async function jobWorkRoutes(
  fastify: FastifyInstance,
  ctxFactory: PlatformContextFactory
): Promise<void> {
  fastify.addHook('preHandler', authenticate);

  fastify.get('/job-work-orders', {
    preHandler: requirePermission(PERMISSIONS.JOB_WORK_VIEW),
    handler: async (req, reply) => {
      const q = req.query as { status?: string; supplierId?: string; page?: string; pageSize?: string };
      const ctx = ctxFactory.create({
        tenantId: req.auth.tenantId,
        userId: req.auth.userId,
        correlationId: (req.headers['x-correlation-id'] as string | undefined) ?? crypto.randomUUID(),
      });
      const svc = new JobWorkOrderService(ctx.db.raw);
      const listParams: { status?: string; supplierId?: number; page: number; pageSize: number } = {
        page: Math.max(1, parseInt(q.page ?? '1', 10)),
        pageSize: Math.min(100, parseInt(q.pageSize ?? '20', 10)),
      };
      if (q.status) listParams.status = q.status;
      if (q.supplierId) listParams.supplierId = parseInt(q.supplierId, 10);
      const rows = await svc.list(req.auth.tenantId, listParams);
      return reply.send({ data: rows });
    },
  });

  fastify.get('/job-work-orders/in-progress', {
    preHandler: requirePermission(PERMISSIONS.JOB_WORK_VIEW),
    handler: async (req, reply) => {
      const ctx = ctxFactory.create({
        tenantId: req.auth.tenantId,
        userId: req.auth.userId,
        correlationId: (req.headers['x-correlation-id'] as string | undefined) ?? crypto.randomUUID(),
      });
      const svc = new JobWorkOrderService(ctx.db.raw);
      const rows = await svc.listInProgress(req.auth.tenantId);
      return reply.send({ data: rows });
    },
  });

  fastify.get('/job-work-orders/dashboard', {
    preHandler: requirePermission(PERMISSIONS.JOB_WORK_VIEW),
    handler: async (req, reply) => {
      const ctx = ctxFactory.create({
        tenantId: req.auth.tenantId,
        userId: req.auth.userId,
        correlationId: (req.headers['x-correlation-id'] as string | undefined) ?? crypto.randomUUID(),
      });
      const svc = new JobWorkOrderService(ctx.db.raw);
      const stats = await svc.getDashboardStats(req.auth.tenantId);
      return reply.send({ data: stats });
    },
  });

  fastify.post('/job-work-orders', {
    preHandler: requirePermission(PERMISSIONS.JOB_WORK_CREATE),
    handler: async (req, reply) => {
      const body = CreateJobWorkSchema.parse(req.body);
      const ctx = ctxFactory.create({
        tenantId: req.auth.tenantId,
        userId: req.auth.userId,
        correlationId: (req.headers['x-correlation-id'] as string | undefined) ?? crypto.randomUUID(),
      });
      const svc = new JobWorkOrderService(ctx.db.raw);
      const id = await svc.create({
        tenantId: req.auth.tenantId,
        supplierId: body.supplierId,
        branchId: body.branchId,
        warehouseId: body.warehouseId,
        outputItemId: body.outputItemId,
        outputVariantId: body.outputVariantId,
        orderedQty: body.orderedQty,
        jobWorkRate: body.jobWorkRate,
        orderDate: new Date(body.orderDate),
        expectedDate: body.expectedDate ? new Date(body.expectedDate) : undefined,
        materials: body.materials,
        notes: body.notes,
        createdBy: req.auth.userId,
      });
      return reply.code(201).send({ data: { id } });
    },
  });

  fastify.get('/job-work-orders/:id', {
    preHandler: requirePermission(PERMISSIONS.JOB_WORK_VIEW),
    handler: async (req, reply) => {
      const { id } = req.params as { id: string };
      const ctx = ctxFactory.create({
        tenantId: req.auth.tenantId,
        userId: req.auth.userId,
        correlationId: (req.headers['x-correlation-id'] as string | undefined) ?? crypto.randomUUID(),
      });
      const svc = new JobWorkOrderService(ctx.db.raw);
      const data = await svc.getWithDetails(parseInt(id, 10), req.auth.tenantId);
      return reply.send({ data });
    },
  });

  fastify.post('/job-work-orders/:id/issue-materials', {
    preHandler: requirePermission(PERMISSIONS.JOB_WORK_ISSUE_MATERIALS),
    handler: async (req, reply) => {
      const { id } = req.params as { id: string };
      const ctx = ctxFactory.create({
        tenantId: req.auth.tenantId,
        userId: req.auth.userId,
        correlationId: (req.headers['x-correlation-id'] as string | undefined) ?? crypto.randomUUID(),
      });
      const svc = new JobWorkOrderService(ctx.db.raw);
      await svc.issueMaterials(parseInt(id, 10), req.auth.tenantId, req.auth.userId);
      return reply.send({ data: { success: true } });
    },
  });

  fastify.post('/job-work-orders/:id/start-quality-check', {
    preHandler: requirePermission(PERMISSIONS.JOB_WORK_QUALITY_CHECK),
    handler: async (req, reply) => {
      const { id } = req.params as { id: string };
      const ctx = ctxFactory.create({
        tenantId: req.auth.tenantId,
        userId: req.auth.userId,
        correlationId: (req.headers['x-correlation-id'] as string | undefined) ?? crypto.randomUUID(),
      });
      const svc = new JobWorkOrderService(ctx.db.raw);
      await svc.startQualityCheck(parseInt(id, 10), req.auth.tenantId, req.auth.userId);
      return reply.send({ data: { success: true } });
    },
  });

  fastify.post('/job-work-orders/:id/quality-checks', {
    preHandler: requirePermission(PERMISSIONS.JOB_WORK_QUALITY_CHECK),
    handler: async (req, reply) => {
      const { id } = req.params as { id: string };
      const body = QualityCheckSchema.parse(req.body);
      const ctx = ctxFactory.create({
        tenantId: req.auth.tenantId,
        userId: req.auth.userId,
        correlationId: (req.headers['x-correlation-id'] as string | undefined) ?? crypto.randomUUID(),
      });
      const svc = new JobWorkOrderService(ctx.db.raw);
      await svc.submitQualityChecks(parseInt(id, 10), req.auth.tenantId, req.auth.userId, body.entries);
      return reply.send({ data: { success: true } });
    },
  });

  fastify.post('/job-work-orders/:id/complete', {
    preHandler: requirePermission(PERMISSIONS.JOB_WORK_COMPLETE),
    handler: async (req, reply) => {
      const { id } = req.params as { id: string };
      const body = CompleteSchema.parse(req.body);
      const ctx = ctxFactory.create({
        tenantId: req.auth.tenantId,
        userId: req.auth.userId,
        correlationId: (req.headers['x-correlation-id'] as string | undefined) ?? crypto.randomUUID(),
      });
      const svc = new JobWorkOrderService(ctx.db.raw);
      await svc.complete(parseInt(id, 10), req.auth.tenantId, {
        tenantId: req.auth.tenantId,
        receivedQty: body.receivedQty,
        rejectedQty: body.rejectedQty,
        scrapQty: body.scrapQty,
        userId: req.auth.userId,
      });
      return reply.send({ data: { success: true } });
    },
  });

  fastify.post('/job-work-orders/:id/cancel', {
    preHandler: requirePermission(PERMISSIONS.JOB_WORK_CANCEL),
    handler: async (req, reply) => {
      const { id } = req.params as { id: string };
      const body = CancelSchema.parse(req.body);
      const ctx = ctxFactory.create({
        tenantId: req.auth.tenantId,
        userId: req.auth.userId,
        correlationId: (req.headers['x-correlation-id'] as string | undefined) ?? crypto.randomUUID(),
      });
      const svc = new JobWorkOrderService(ctx.db.raw);
      await svc.cancel(parseInt(id, 10), req.auth.tenantId, req.auth.userId, body.reason);
      return reply.send({ data: { success: true } });
    },
  });
}
