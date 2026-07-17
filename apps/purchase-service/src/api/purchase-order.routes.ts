import type { FastifyInstance } from 'fastify';
import type { PlatformContextFactory } from '@erp/sdk';
import { purchaseOrders, purchaseOrderHistory, suppliers } from '@erp/db';
import { and, desc, eq, ilike, sql, getTableColumns } from 'drizzle-orm';
import { z } from 'zod';
import { PERMISSIONS } from '@erp/types';
import { authenticate } from '../middleware/authenticate.js';
import { requirePermission } from '../middleware/authorize.js';
import { PurchaseOrderService } from '../domain/PurchaseOrderService.js';

const POLineSchema = z.object({
  itemId: z.number().int().positive(),
  variantId: z.number().int().positive().optional(),
  description: z.string().max(500).optional(),
  orderedQty: z.number().positive(),
  unitId: z.number().int().positive().optional(),
  unitPrice: z.number().nonnegative(),
  discountPct: z.number().min(0).max(100).default(0),
  discountAmount: z.number().min(0).default(0),
  gstRate: z.number().min(0).max(100),
  hsnCode: z.string().max(20).optional(),
});

const CreatePOSchema = z.object({
  supplierId: z.number().int().positive(),
  branchId: z.number().int().positive(),
  warehouseId: z.number().int().positive(),
  poDate: z.string().datetime(),
  expectedDeliveryDate: z.string().datetime().optional(),
  placeOfSupply: z.string().length(2),
  sellerStateCode: z.string().length(2).optional(),
  lines: z.array(POLineSchema).min(1),
  notes: z.string().max(2000).optional(),
  termsAndConditions: z.string().max(5000).optional(),
});

const ApproveSchema = z.object({
  poNumber: z.string().min(1).max(50),
  overrideCreditLimit: z.boolean().default(false),
});

const AmendSchema = z.object({
  amendments: z.record(z.string(), z.unknown()),
  reason: z.string().min(1).max(500),
});

const CancelSchema = z.object({
  reason: z.string().min(1).max(500),
});

const UpdatePOSchema = z.object({
  notes: z.string().max(2000).optional(),
  expectedDeliveryDate: z.string().datetime().optional(),
});

export async function purchaseOrderRoutes(
  fastify: FastifyInstance,
  ctxFactory: PlatformContextFactory
): Promise<void> {
  fastify.addHook('preHandler', authenticate);

  fastify.get('/purchase-orders', {
    preHandler: requirePermission(PERMISSIONS.PO_VIEW),
    handler: async (req, reply) => {
      const ctx = ctxFactory.create({
        tenantId: req.auth.tenantId,
        userId: req.auth.userId,
        correlationId:
          (req.headers['x-correlation-id'] as string | undefined) ?? crypto.randomUUID(),
      });
      const q = req.query as {
        search?: string;
        status?: string;
        supplierId?: string;
        page?: string;
        pageSize?: string;
      };
      const page = Math.max(1, parseInt(q.page ?? '1', 10));
      const pageSize = Math.min(100, parseInt(q.pageSize ?? '20', 10));
      const offset = (page - 1) * pageSize;

      const conditions = [eq(purchaseOrders.tenantId, req.auth.tenantId)];
      if (q.status) conditions.push(eq(purchaseOrders.status, q.status as never));
      if (q.supplierId) conditions.push(eq(purchaseOrders.supplierId, parseInt(q.supplierId, 10)));
      if (q.search) conditions.push(ilike(purchaseOrders.poNumber, `%${q.search}%`));

      const rows = await ctx.db.raw
        .select({ ...getTableColumns(purchaseOrders), supplierName: suppliers.displayName })
        .from(purchaseOrders)
        .leftJoin(suppliers, eq(purchaseOrders.supplierId, suppliers.id))
        .where(and(...conditions))
        .orderBy(desc(purchaseOrders.poDate), desc(purchaseOrders.id))
        .limit(pageSize)
        .offset(offset);

      const [countRow] = await ctx.db.raw
        .select({ count: sql<number>`count(*)::int` })
        .from(purchaseOrders)
        .where(and(...conditions));

      return reply.send({
        data: { content: rows, totalElements: countRow?.count ?? 0, page, pageSize },
      });
    },
  });

  fastify.post('/purchase-orders', {
    preHandler: requirePermission(PERMISSIONS.PO_CREATE),
    handler: async (req, reply) => {
      const body = CreatePOSchema.parse(req.body);
      const ctx = ctxFactory.create({
        tenantId: req.auth.tenantId,
        userId: req.auth.userId,
        correlationId:
          (req.headers['x-correlation-id'] as string | undefined) ?? crypto.randomUUID(),
      });
      const svc = new PurchaseOrderService(ctx.db.raw);
      const id = await svc.create({
        tenantId: req.auth.tenantId,
        branchId: body.branchId,
        warehouseId: body.warehouseId,
        supplierId: body.supplierId,
        poDate: new Date(body.poDate),
        expectedDeliveryDate: body.expectedDeliveryDate
          ? new Date(body.expectedDeliveryDate)
          : undefined,
        placeOfSupply: body.placeOfSupply,
        sellerStateCode: body.sellerStateCode,
        lines: body.lines,
        notes: body.notes,
        termsAndConditions: body.termsAndConditions,
        createdBy: req.auth.userId,
      });
      return reply.code(201).send({ data: { id } });
    },
  });

  fastify.get('/purchase-orders/pending-delivery', {
    preHandler: requirePermission(PERMISSIONS.PO_VIEW),
    handler: async (req, reply) => {
      const ctx = ctxFactory.create({
        tenantId: req.auth.tenantId,
        userId: req.auth.userId,
        correlationId:
          (req.headers['x-correlation-id'] as string | undefined) ?? crypto.randomUUID(),
      });
      const svc = new PurchaseOrderService(ctx.db.raw);
      const rows = await svc.getPendingDelivery(req.auth.tenantId);
      return reply.send({ data: rows });
    },
  });

  fastify.get('/purchase-orders/:id', {
    preHandler: requirePermission(PERMISSIONS.PO_VIEW),
    handler: async (req, reply) => {
      const { id } = req.params as { id: string };
      const ctx = ctxFactory.create({
        tenantId: req.auth.tenantId,
        userId: req.auth.userId,
        correlationId:
          (req.headers['x-correlation-id'] as string | undefined) ?? crypto.randomUUID(),
      });
      const svc = new PurchaseOrderService(ctx.db.raw);
      const data = await svc.getWithLines(parseInt(id, 10), req.auth.tenantId);
      return reply.send({ data });
    },
  });

  fastify.put('/purchase-orders/:id', {
    preHandler: requirePermission(PERMISSIONS.PO_UPDATE),
    handler: async (req, reply) => {
      const { id } = req.params as { id: string };
      const body = UpdatePOSchema.parse(req.body);
      const ctx = ctxFactory.create({
        tenantId: req.auth.tenantId,
        userId: req.auth.userId,
        correlationId:
          (req.headers['x-correlation-id'] as string | undefined) ?? crypto.randomUUID(),
      });
      const svc = new PurchaseOrderService(ctx.db.raw);
      await svc.update(parseInt(id, 10), req.auth.tenantId, req.auth.userId, {
        notes: body.notes,
        expectedDeliveryDate: body.expectedDeliveryDate
          ? new Date(body.expectedDeliveryDate)
          : undefined,
      });
      return reply.send({ success: true });
    },
  });

  fastify.post('/purchase-orders/:id/submit', {
    preHandler: requirePermission(PERMISSIONS.PO_CREATE),
    handler: async (req, reply) => {
      const { id } = req.params as { id: string };
      const ctx = ctxFactory.create({
        tenantId: req.auth.tenantId,
        userId: req.auth.userId,
        correlationId:
          (req.headers['x-correlation-id'] as string | undefined) ?? crypto.randomUUID(),
      });
      const svc = new PurchaseOrderService(ctx.db.raw);
      await svc.submit(parseInt(id, 10), req.auth.tenantId, req.auth.userId);
      return reply.send({ success: true });
    },
  });

  fastify.post('/purchase-orders/:id/approve', {
    preHandler: requirePermission(PERMISSIONS.PO_APPROVE),
    handler: async (req, reply) => {
      const { id } = req.params as { id: string };
      const body = ApproveSchema.parse(req.body);

      if (
        body.overrideCreditLimit &&
        !req.auth.permissions.includes(PERMISSIONS.CREDIT_LIMIT_OVERRIDE)
      ) {
        return reply
          .code(403)
          .send({ error: `Forbidden — missing permission: ${PERMISSIONS.CREDIT_LIMIT_OVERRIDE}` });
      }

      const ctx = ctxFactory.create({
        tenantId: req.auth.tenantId,
        userId: req.auth.userId,
        correlationId:
          (req.headers['x-correlation-id'] as string | undefined) ?? crypto.randomUUID(),
      });
      const svc = new PurchaseOrderService(ctx.db.raw);
      await svc.approve(
        parseInt(id, 10),
        req.auth.tenantId,
        req.auth.userId,
        body.poNumber,
        body.overrideCreditLimit
      );
      return reply.send({ success: true });
    },
  });

  fastify.post('/purchase-orders/:id/amend', {
    preHandler: requirePermission(PERMISSIONS.PO_AMEND),
    handler: async (req, reply) => {
      const { id } = req.params as { id: string };
      const body = AmendSchema.parse(req.body);
      const ctx = ctxFactory.create({
        tenantId: req.auth.tenantId,
        userId: req.auth.userId,
        correlationId:
          (req.headers['x-correlation-id'] as string | undefined) ?? crypto.randomUUID(),
      });
      const svc = new PurchaseOrderService(ctx.db.raw);
      await svc.amend(
        parseInt(id, 10),
        req.auth.tenantId,
        req.auth.userId,
        body.amendments,
        body.reason
      );
      return reply.send({ success: true });
    },
  });

  fastify.post('/purchase-orders/:id/cancel', {
    preHandler: requirePermission(PERMISSIONS.PO_CANCEL),
    handler: async (req, reply) => {
      const { id } = req.params as { id: string };
      const body = CancelSchema.parse(req.body);
      const ctx = ctxFactory.create({
        tenantId: req.auth.tenantId,
        userId: req.auth.userId,
        correlationId:
          (req.headers['x-correlation-id'] as string | undefined) ?? crypto.randomUUID(),
      });
      const svc = new PurchaseOrderService(ctx.db.raw);
      await svc.cancel(parseInt(id, 10), req.auth.tenantId, req.auth.userId, body.reason);
      return reply.send({ success: true });
    },
  });

  fastify.post('/purchase-orders/:id/duplicate', {
    preHandler: requirePermission(PERMISSIONS.PO_CREATE),
    handler: async (req, reply) => {
      const { id } = req.params as { id: string };
      const ctx = ctxFactory.create({
        tenantId: req.auth.tenantId,
        userId: req.auth.userId,
        correlationId:
          (req.headers['x-correlation-id'] as string | undefined) ?? crypto.randomUUID(),
      });
      const svc = new PurchaseOrderService(ctx.db.raw);
      const newId = await svc.duplicate(parseInt(id, 10), req.auth.tenantId, req.auth.userId);
      return reply.code(201).send({ data: { id: newId } });
    },
  });

  fastify.get('/purchase-orders/:id/pdf', {
    preHandler: requirePermission(PERMISSIONS.PO_VIEW),
    handler: async (req, reply) => {
      const { id } = req.params as { id: string };
      const ctx = ctxFactory.create({
        tenantId: req.auth.tenantId,
        userId: req.auth.userId,
        correlationId:
          (req.headers['x-correlation-id'] as string | undefined) ?? crypto.randomUUID(),
      });
      const [po] = await ctx.db.raw
        .select({ pdfUrl: purchaseOrders.pdfUrl })
        .from(purchaseOrders)
        .where(
          and(
            eq(purchaseOrders.id, parseInt(id, 10)),
            eq(purchaseOrders.tenantId, req.auth.tenantId)
          )
        );
      if (!po)
        return reply
          .code(404)
          .send({ error: { code: 'NOT_FOUND', message: 'Purchase order not found' } });
      return reply.send({ data: { pdfUrl: po.pdfUrl ?? null } });
    },
  });

  fastify.get('/purchase-orders/:id/activity', {
    preHandler: requirePermission(PERMISSIONS.PO_VIEW),
    handler: async (req, reply) => {
      const { id } = req.params as { id: string };
      const ctx = ctxFactory.create({
        tenantId: req.auth.tenantId,
        userId: req.auth.userId,
        correlationId:
          (req.headers['x-correlation-id'] as string | undefined) ?? crypto.randomUUID(),
      });
      const history = await ctx.db.raw
        .select()
        .from(purchaseOrderHistory)
        .where(
          and(
            eq(purchaseOrderHistory.purchaseOrderId, parseInt(id, 10)),
            eq(purchaseOrderHistory.tenantId, req.auth.tenantId)
          )
        )
        .orderBy(desc(purchaseOrderHistory.createdAt));
      return reply.send({ data: history });
    },
  });
}
