import type { FastifyInstance } from 'fastify';
import type { PlatformContextFactory } from '@erp/sdk';
import { payments } from '@erp/db';
import { and, desc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { PERMISSIONS } from '@erp/types';
import { authenticate } from '../middleware/authenticate.js';
import { requirePermission, requireAnyPermission } from '../middleware/authorize.js';
import { PaymentService } from '../domain/PaymentService.js';
import { sendError } from './http-errors.js';

const CreatePaymentSchema = z.object({
  customerId: z.number().int().positive(),
  branchId: z.number().int().positive(),
  paymentDate: z.string().datetime(),
  paymentMode: z.enum(['CASH', 'CARD', 'UPI', 'CHEQUE', 'NEFT', 'RTGS', 'CREDIT_NOTE', 'ADVANCE']),
  amount: z.number().positive(),
  chequeNumber: z.string().max(30).optional(),
  chequeBankName: z.string().max(100).optional(),
  chequeDate: z.string().datetime().optional(),
  transactionReference: z.string().max(100).optional(),
  notes: z.string().max(1000).optional(),
});

const AllocateSchema = z.object({
  allocations: z
    .array(
      z.object({
        invoiceId: z.number().int().positive(),
        amount: z.number().positive(),
      })
    )
    .min(1),
});

const BounceSchema = z.object({
  reason: z.string().min(1).max(500),
});

export async function paymentRoutes(
  fastify: FastifyInstance,
  ctxFactory: PlatformContextFactory
): Promise<void> {
  fastify.addHook('preHandler', authenticate);

  fastify.get('/payments', {
    preHandler: requireAnyPermission([PERMISSIONS.PAYMENT_VIEW, PERMISSIONS.PAYMENT_IN_VIEW]),
    handler: async (req, reply) => {
      const ctx = ctxFactory.create({
        tenantId: req.auth.tenantId,
        userId: req.auth.userId,
        correlationId:
          (req.headers['x-correlation-id'] as string | undefined) ?? crypto.randomUUID(),
      });
      const q = req.query as {
        customerId?: string;
        status?: string;
        page?: string;
        pageSize?: string;
      };
      const page = Math.max(1, parseInt(q.page ?? '1', 10));
      const pageSize = Math.min(100, parseInt(q.pageSize ?? '20', 10));

      const conditions = [eq(payments.tenantId, req.auth.tenantId)];
      if (q.status) conditions.push(eq(payments.status, q.status as never));
      if (q.customerId) conditions.push(eq(payments.customerId, parseInt(q.customerId, 10)));

      const rows = await ctx.db.raw
        .select()
        .from(payments)
        .where(and(...conditions))
        .orderBy(desc(payments.paymentDate))
        .limit(pageSize)
        .offset((page - 1) * pageSize);

      const [countRow] = await ctx.db.raw
        .select({ count: sql<number>`count(*)::int` })
        .from(payments)
        .where(and(...conditions));

      return reply.send({
        data: { content: rows, totalElements: countRow?.count ?? 0, page, pageSize },
      });
    },
  });

  fastify.post('/payments', {
    preHandler: requirePermission(PERMISSIONS.PAYMENT_CREATE),
    handler: async (req, reply) => {
      const body = CreatePaymentSchema.parse(req.body);
      const ctx = ctxFactory.create({
        tenantId: req.auth.tenantId,
        userId: req.auth.userId,
        correlationId:
          (req.headers['x-correlation-id'] as string | undefined) ?? crypto.randomUUID(),
      });
      const svc = new PaymentService(ctx.db.raw);
      const paymentNumber = `PAY-${req.auth.tenantId}-${Date.now()}`;

      const id = await svc.create({
        tenantId: req.auth.tenantId,
        branchId: body.branchId,
        customerId: body.customerId,
        paymentNumber,
        paymentDate: new Date(body.paymentDate),
        paymentMode: body.paymentMode,
        amount: body.amount,
        chequeNumber: body.chequeNumber,
        chequeBankName: body.chequeBankName,
        chequeDate: body.chequeDate ? new Date(body.chequeDate) : undefined,
        transactionReference: body.transactionReference,
        notes: body.notes,
        createdBy: req.auth.userId,
      } as Parameters<typeof svc.create>[0]);

      return reply.code(201).send({ data: { id, paymentNumber } });
    },
  });

  fastify.get('/payments/:id', {
    preHandler: requireAnyPermission([PERMISSIONS.PAYMENT_VIEW, PERMISSIONS.PAYMENT_IN_VIEW]),
    handler: async (req, reply) => {
      const { id } = req.params as { id: string };
      const ctx = ctxFactory.create({
        tenantId: req.auth.tenantId,
        userId: req.auth.userId,
        correlationId:
          (req.headers['x-correlation-id'] as string | undefined) ?? crypto.randomUUID(),
      });
      const [row] = await ctx.db.raw
        .select()
        .from(payments)
        .where(and(eq(payments.id, parseInt(id, 10)), eq(payments.tenantId, req.auth.tenantId)));
      if (!row) return sendError(reply, 404, 'NOT_FOUND', 'Payment not found');
      return reply.send({ data: row });
    },
  });

  fastify.post('/payments/:id/allocate', {
    preHandler: requirePermission(PERMISSIONS.PAYMENT_CREATE),
    handler: async (req, reply) => {
      const { id } = req.params as { id: string };
      const body = AllocateSchema.parse(req.body);
      const ctx = ctxFactory.create({
        tenantId: req.auth.tenantId,
        userId: req.auth.userId,
        correlationId:
          (req.headers['x-correlation-id'] as string | undefined) ?? crypto.randomUUID(),
      });
      const svc = new PaymentService(ctx.db.raw);
      await svc.allocate(parseInt(id, 10), req.auth.tenantId, body.allocations, req.auth.userId);
      return reply.send({ success: true });
    },
  });

  fastify.post('/payments/:id/bounce', {
    preHandler: requirePermission(PERMISSIONS.PAYMENT_CREATE),
    handler: async (req, reply) => {
      const { id } = req.params as { id: string };
      const body = BounceSchema.parse(req.body);
      const ctx = ctxFactory.create({
        tenantId: req.auth.tenantId,
        userId: req.auth.userId,
        correlationId:
          (req.headers['x-correlation-id'] as string | undefined) ?? crypto.randomUUID(),
      });
      const svc = new PaymentService(ctx.db.raw);
      await svc.bounceCheque(parseInt(id, 10), req.auth.tenantId, body.reason);
      return reply.send({ success: true });
    },
  });
}
