import type { FastifyInstance } from 'fastify';
import type { PlatformContextFactory } from '@erp/sdk';
import { grns, suppliers } from '@erp/db';
import { and, desc, eq, ilike, sql } from 'drizzle-orm';
import { z } from 'zod';
import { PERMISSIONS } from '@erp/types';
import { authenticate } from '../middleware/authenticate.js';
import { requirePermission } from '../middleware/authorize.js';
import { GRNService } from '../domain/GRNService.js';

const GRNLineSchema = z.object({
  purchaseOrderLineId: z.number().int().positive(),
  itemId: z.number().int().positive(),
  variantId: z.number().int().positive().optional(),
  description: z.string().max(500).optional(),
  receivedQty: z.number().positive(),
  unitId: z.number().int().positive().optional(),
  grnRate: z.number().nonnegative(),
  gstRate: z.number().min(0).max(100),
  cessRate: z.number().min(0).max(100).default(0),
  hsnCode: z.string().max(20).optional(),
  warehouseId: z.number().int().positive().optional(),
});

const CreateGRNSchema = z.object({
  purchaseOrderId: z.number().int().positive(),
  supplierId: z.number().int().positive(),
  branchId: z.number().int().positive(),
  warehouseId: z.number().int().positive(),
  grnDate: z.string().datetime(),
  supplierInvoiceNumber: z.string().max(100).optional(),
  supplierInvoiceDate: z.string().datetime().optional(),
  lines: z.array(GRNLineSchema).min(1),
  notes: z.string().max(2000).optional(),
});

const ApproveGRNSchema = z.object({
  grnNumber: z.string().min(1).max(50),
});

const RejectGRNSchema = z.object({
  reason: z.string().min(1).max(500),
});

export async function grnRoutes(
  fastify: FastifyInstance,
  ctxFactory: PlatformContextFactory
): Promise<void> {
  fastify.addHook('preHandler', authenticate);

  fastify.get('/grns', {
    preHandler: requirePermission(PERMISSIONS.GRN_VIEW),
    handler: async (req, reply) => {
      const ctx = ctxFactory.create({
        tenantId: req.auth.tenantId,
        userId: req.auth.userId,
        correlationId: (req.headers['x-correlation-id'] as string | undefined) ?? crypto.randomUUID(),
      });
      const q = req.query as { status?: string; supplierId?: string; poId?: string; search?: string; page?: string; pageSize?: string };
      const page = Math.max(1, parseInt(q.page ?? '1', 10));
      const pageSize = Math.min(100, parseInt(q.pageSize ?? '20', 10));
      const offset = (page - 1) * pageSize;

      const conditions = [eq(grns.tenantId, req.auth.tenantId)];
      if (q.status) conditions.push(eq(grns.status, q.status as never));
      if (q.supplierId) conditions.push(eq(grns.supplierId, parseInt(q.supplierId, 10)));
      if (q.poId) conditions.push(eq(grns.purchaseOrderId, parseInt(q.poId, 10)));
      if (q.search) conditions.push(ilike(grns.grnNumber, `%${q.search}%`));

      const rows = await ctx.db.raw
        .select()
        .from(grns)
        .where(and(...conditions))
        .orderBy(desc(grns.grnDate))
        .limit(pageSize)
        .offset(offset);

      const [countRow] = await ctx.db.raw
        .select({ count: sql<number>`count(*)::int` })
        .from(grns)
        .where(and(...conditions));

      return reply.send({ data: { content: rows, totalElements: countRow?.count ?? 0, page, pageSize } });
    },
  });

  fastify.post('/grns', {
    preHandler: requirePermission(PERMISSIONS.GRN_CREATE),
    handler: async (req, reply) => {
      const body = CreateGRNSchema.parse(req.body);
      const ctx = ctxFactory.create({
        tenantId: req.auth.tenantId,
        userId: req.auth.userId,
        correlationId: (req.headers['x-correlation-id'] as string | undefined) ?? crypto.randomUUID(),
      });
      const svc = new GRNService(ctx.db.raw);
      const id = await svc.create({
        tenantId: req.auth.tenantId,
        branchId: body.branchId,
        warehouseId: body.warehouseId,
        purchaseOrderId: body.purchaseOrderId,
        supplierId: body.supplierId,
        grnDate: new Date(body.grnDate),
        supplierInvoiceNumber: body.supplierInvoiceNumber,
        supplierInvoiceDate: body.supplierInvoiceDate ? new Date(body.supplierInvoiceDate) : undefined,
        lines: body.lines,
        notes: body.notes,
        createdBy: req.auth.userId,
      });
      // grnNumber genuinely doesn't exist yet — it's assigned at approval (see grn.routes.ts
      // ApproveGRNSchema / GRNService.approve), not a bug to fix here. supplierName/grnDate
      // are denormalized now so the DRAFT-window search result at least shows the supplier
      // and date instead of a bare fallback string (see searchEntityConfig.ts's title fallback).
      const [supplier] = await ctx.db.raw
        .select({ displayName: suppliers.displayName })
        .from(suppliers)
        .where(and(eq(suppliers.id, body.supplierId), eq(suppliers.tenantId, req.auth.tenantId)));
      await ctx.events.publish('grn', id, 'GRN_CREATED', {
        grnId: id,
        supplierId: body.supplierId,
        supplierName: supplier?.displayName,
        purchaseOrderId: body.purchaseOrderId,
        branchId: body.branchId,
        grnDate: body.grnDate,
        status: 'DRAFT',
      });
      return reply.code(201).send({ data: { id } });
    },
  });

  fastify.get('/grns/:id', {
    preHandler: requirePermission(PERMISSIONS.GRN_VIEW),
    handler: async (req, reply) => {
      const { id } = req.params as { id: string };
      const ctx = ctxFactory.create({
        tenantId: req.auth.tenantId,
        userId: req.auth.userId,
        correlationId: (req.headers['x-correlation-id'] as string | undefined) ?? crypto.randomUUID(),
      });
      const svc = new GRNService(ctx.db.raw);
      const data = await svc.getWithLines(parseInt(id, 10), req.auth.tenantId);
      return reply.send({ data });
    },
  });

  fastify.post('/grns/:id/approve', {
    preHandler: requirePermission(PERMISSIONS.GRN_APPROVE),
    handler: async (req, reply) => {
      const { id } = req.params as { id: string };
      const body = ApproveGRNSchema.parse(req.body);
      const ctx = ctxFactory.create({
        tenantId: req.auth.tenantId,
        userId: req.auth.userId,
        correlationId: (req.headers['x-correlation-id'] as string | undefined) ?? crypto.randomUUID(),
      });
      const svc = new GRNService(ctx.db.raw);
      await svc.approve(parseInt(id, 10), req.auth.tenantId, req.auth.userId, body.grnNumber);
      return reply.send({ success: true });
    },
  });

  fastify.post('/grns/:id/reject', {
    preHandler: requirePermission(PERMISSIONS.GRN_APPROVE),
    handler: async (req, reply) => {
      const { id } = req.params as { id: string };
      const body = RejectGRNSchema.parse(req.body);
      const ctx = ctxFactory.create({
        tenantId: req.auth.tenantId,
        userId: req.auth.userId,
        correlationId: (req.headers['x-correlation-id'] as string | undefined) ?? crypto.randomUUID(),
      });
      const svc = new GRNService(ctx.db.raw);
      await svc.reject(parseInt(id, 10), req.auth.tenantId, req.auth.userId, body.reason);
      return reply.send({ success: true });
    },
  });
}
