import type { FastifyInstance } from 'fastify';
import type { PlatformContextFactory } from '@erp/sdk';
import { supplierPayments } from '@erp/db';
import { and, desc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { PERMISSIONS } from '@erp/types';
import { authenticate } from '../middleware/authenticate.js';
import { requirePermission } from '../middleware/authorize.js';
import { SupplierPaymentService } from '../domain/SupplierPaymentService.js';

const CreateSupplierPaymentSchema = z.object({
  supplierId: z.number().int().positive(),
  branchId: z.number().int().positive(),
  paymentDate: z.string().datetime(),
  paymentMode: z.enum(['CASH', 'CHEQUE', 'NEFT', 'RTGS', 'UPI', 'ADVANCE']),
  amount: z.number().positive(),
  chequeNumber: z.string().max(50).optional(),
  chequeBankName: z.string().max(200).optional(),
  chequeDate: z.string().datetime().optional(),
  isPdc: z.boolean().default(false),
  pdcClearingDate: z.string().datetime().optional(),
  transactionReference: z.string().max(100).optional(),
  notes: z.string().max(2000).optional(),
});

const AllocateSchema = z.object({
  allocations: z.array(
    z.object({ grnId: z.number().int().positive(), amount: z.number().positive() })
  ).min(1),
});

const BounceSchema = z.object({
  reason: z.string().min(1).max(500),
});

export async function supplierPaymentRoutes(
  fastify: FastifyInstance,
  ctxFactory: PlatformContextFactory
): Promise<void> {
  fastify.addHook('preHandler', authenticate);

  fastify.get('/supplier-payments', {
    preHandler: requirePermission(PERMISSIONS.PAYMENT_OUT_VIEW),
    handler: async (req, reply) => {
      const ctx = ctxFactory.create({
        tenantId: req.auth.tenantId,
        userId: req.auth.userId,
        correlationId: (req.headers['x-correlation-id'] as string | undefined) ?? crypto.randomUUID(),
      });
      const q = req.query as { supplierId?: string; status?: string; page?: string; pageSize?: string };
      const page = Math.max(1, parseInt(q.page ?? '1', 10));
      const pageSize = Math.min(100, parseInt(q.pageSize ?? '20', 10));
      const offset = (page - 1) * pageSize;

      const conditions = [eq(supplierPayments.tenantId, req.auth.tenantId)];
      if (q.supplierId) conditions.push(eq(supplierPayments.supplierId, parseInt(q.supplierId, 10)));
      if (q.status) conditions.push(eq(supplierPayments.status, q.status as never));

      const rows = await ctx.db.raw
        .select()
        .from(supplierPayments)
        .where(and(...conditions))
        .orderBy(desc(supplierPayments.paymentDate))
        .limit(pageSize)
        .offset(offset);

      const [countRow] = await ctx.db.raw
        .select({ count: sql<number>`count(*)::int` })
        .from(supplierPayments)
        .where(and(...conditions));

      return reply.send({ data: { content: rows, totalElements: countRow?.count ?? 0, page, pageSize } });
    },
  });

  fastify.post('/supplier-payments', {
    preHandler: requirePermission(PERMISSIONS.PAYMENT_OUT_CREATE),
    handler: async (req, reply) => {
      const body = CreateSupplierPaymentSchema.parse(req.body);
      const ctx = ctxFactory.create({
        tenantId: req.auth.tenantId,
        userId: req.auth.userId,
        correlationId: (req.headers['x-correlation-id'] as string | undefined) ?? crypto.randomUUID(),
      });
      const svc = new SupplierPaymentService(ctx.db.raw);
      const id = await svc.create({
        tenantId: req.auth.tenantId,
        branchId: body.branchId,
        supplierId: body.supplierId,
        paymentDate: new Date(body.paymentDate),
        paymentMode: body.paymentMode,
        amount: body.amount,
        chequeNumber: body.chequeNumber,
        chequeBankName: body.chequeBankName,
        chequeDate: body.chequeDate ? new Date(body.chequeDate) : undefined,
        isPdc: body.isPdc,
        pdcClearingDate: body.pdcClearingDate ? new Date(body.pdcClearingDate) : undefined,
        transactionReference: body.transactionReference,
        notes: body.notes,
        createdBy: req.auth.userId,
      });
      return reply.code(201).send({ data: { id } });
    },
  });

  fastify.post('/supplier-payments/:id/allocate', {
    preHandler: requirePermission(PERMISSIONS.PAYMENT_OUT_CREATE),
    handler: async (req, reply) => {
      const { id } = req.params as { id: string };
      const body = AllocateSchema.parse(req.body);
      const ctx = ctxFactory.create({
        tenantId: req.auth.tenantId,
        userId: req.auth.userId,
        correlationId: (req.headers['x-correlation-id'] as string | undefined) ?? crypto.randomUUID(),
      });
      const svc = new SupplierPaymentService(ctx.db.raw);
      await svc.allocate(parseInt(id, 10), req.auth.tenantId, body.allocations, req.auth.userId);
      return reply.send({ success: true });
    },
  });

  fastify.post('/supplier-payments/:id/bounce', {
    preHandler: requirePermission(PERMISSIONS.PAYMENT_OUT_CREATE),
    handler: async (req, reply) => {
      const { id } = req.params as { id: string };
      const body = BounceSchema.parse(req.body);
      const ctx = ctxFactory.create({
        tenantId: req.auth.tenantId,
        userId: req.auth.userId,
        correlationId: (req.headers['x-correlation-id'] as string | undefined) ?? crypto.randomUUID(),
      });
      const svc = new SupplierPaymentService(ctx.db.raw);
      await svc.bounceCheque(parseInt(id, 10), req.auth.tenantId, body.reason);
      return reply.send({ success: true });
    },
  });

  fastify.get('/suppliers/:id/outstanding', {
    preHandler: requirePermission(PERMISSIONS.SUPPLIER_STATEMENT_VIEW),
    handler: async (req, reply) => {
      const { id } = req.params as { id: string };
      const ctx = ctxFactory.create({
        tenantId: req.auth.tenantId,
        userId: req.auth.userId,
        correlationId: (req.headers['x-correlation-id'] as string | undefined) ?? crypto.randomUUID(),
      });
      const svc = new SupplierPaymentService(ctx.db.raw);
      const data = await svc.getOutstanding(parseInt(id, 10), req.auth.tenantId);
      return reply.send({ data });
    },
  });

  fastify.get('/suppliers/:id/statement', {
    preHandler: requirePermission(PERMISSIONS.SUPPLIER_STATEMENT_VIEW),
    handler: async (req, reply) => {
      const { id } = req.params as { id: string };
      const ctx = ctxFactory.create({
        tenantId: req.auth.tenantId,
        userId: req.auth.userId,
        correlationId: (req.headers['x-correlation-id'] as string | undefined) ?? crypto.randomUUID(),
      });
      const svc = new SupplierPaymentService(ctx.db.raw);
      const data = await svc.getStatement(parseInt(id, 10), req.auth.tenantId);
      return reply.send({ data });
    },
  });
}
