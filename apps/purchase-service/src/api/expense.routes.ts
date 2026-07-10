import type { FastifyInstance } from 'fastify';
import type { PlatformContextFactory } from '@erp/sdk';
import { expenses } from '@erp/db';
import { and, desc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { PERMISSIONS } from '@erp/types';
import { authenticate } from '../middleware/authenticate.js';
import { requirePermission } from '../middleware/authorize.js';
import { ExpenseService } from '../domain/ExpenseService.js';

const ExpenseLineSchema = z.object({
  description: z.string().min(1).max(500),
  amount: z.number().positive(),
  gstRate: z.number().min(0).max(100).default(0),
  accountId: z.number().int().positive().optional(),
});

const CreateExpenseSchema = z.object({
  expenseType: z.enum(['RENT', 'ELECTRICITY', 'SALARY', 'FREIGHT', 'MARKETING', 'MAINTENANCE', 'MISC']),
  supplierId: z.number().int().positive().optional(),
  branchId: z.number().int().positive(),
  expenseDate: z.string().datetime(),
  dueDate: z.string().datetime().optional(),
  description: z.string().max(2000).optional(),
  lines: z.array(ExpenseLineSchema).min(1),
  accountId: z.number().int().positive().optional(),
  notes: z.string().max(2000).optional(),
});

const UpdateExpenseSchema = z.object({
  description: z.string().max(2000).optional(),
  notes: z.string().max(2000).optional(),
  dueDate: z.string().datetime().optional(),
});

const PayExpenseSchema = z.object({
  paymentMode: z.enum(['CASH', 'CHEQUE', 'NEFT', 'RTGS', 'UPI']),
  paymentDate: z.string().datetime(),
  paymentReference: z.string().max(100).optional(),
});

export async function expenseRoutes(
  fastify: FastifyInstance,
  ctxFactory: PlatformContextFactory
): Promise<void> {
  fastify.addHook('preHandler', authenticate);

  fastify.get('/expenses', {
    preHandler: requirePermission(PERMISSIONS.EXPENSE_VIEW),
    handler: async (req, reply) => {
      const ctx = ctxFactory.create({
        tenantId: req.auth.tenantId,
        userId: req.auth.userId,
        correlationId: (req.headers['x-correlation-id'] as string | undefined) ?? crypto.randomUUID(),
      });
      const q = req.query as { status?: string; expenseType?: string; page?: string; pageSize?: string };
      const page = Math.max(1, parseInt(q.page ?? '1', 10));
      const pageSize = Math.min(100, parseInt(q.pageSize ?? '20', 10));
      const offset = (page - 1) * pageSize;

      const conditions = [eq(expenses.tenantId, req.auth.tenantId)];
      if (q.status) conditions.push(eq(expenses.status, q.status as never));
      if (q.expenseType) conditions.push(eq(expenses.expenseType, q.expenseType as never));

      const rows = await ctx.db.raw
        .select()
        .from(expenses)
        .where(and(...conditions))
        .orderBy(desc(expenses.expenseDate))
        .limit(pageSize)
        .offset(offset);

      const [countRow] = await ctx.db.raw
        .select({ count: sql<number>`count(*)::int` })
        .from(expenses)
        .where(and(...conditions));

      return reply.send({ data: { content: rows, totalElements: countRow?.count ?? 0, page, pageSize } });
    },
  });

  fastify.post('/expenses', {
    preHandler: requirePermission(PERMISSIONS.EXPENSE_CREATE),
    handler: async (req, reply) => {
      const body = CreateExpenseSchema.parse(req.body);
      const ctx = ctxFactory.create({
        tenantId: req.auth.tenantId,
        userId: req.auth.userId,
        correlationId: (req.headers['x-correlation-id'] as string | undefined) ?? crypto.randomUUID(),
      });
      const svc = new ExpenseService(ctx.db.raw);
      const id = await svc.create({
        tenantId: req.auth.tenantId,
        branchId: body.branchId,
        expenseType: body.expenseType,
        supplierId: body.supplierId,
        expenseDate: new Date(body.expenseDate),
        dueDate: body.dueDate ? new Date(body.dueDate) : undefined,
        description: body.description,
        lines: body.lines,
        accountId: body.accountId,
        notes: body.notes,
        createdBy: req.auth.userId,
      });
      return reply.code(201).send({ data: { id } });
    },
  });

  fastify.get('/expenses/:id', {
    preHandler: requirePermission(PERMISSIONS.EXPENSE_VIEW),
    handler: async (req, reply) => {
      const { id } = req.params as { id: string };
      const ctx = ctxFactory.create({
        tenantId: req.auth.tenantId,
        userId: req.auth.userId,
        correlationId: (req.headers['x-correlation-id'] as string | undefined) ?? crypto.randomUUID(),
      });
      const svc = new ExpenseService(ctx.db.raw);
      const data = await svc.getWithLines(parseInt(id, 10), req.auth.tenantId);
      return reply.send({ data });
    },
  });

  fastify.put('/expenses/:id', {
    preHandler: requirePermission(PERMISSIONS.EXPENSE_CREATE),
    handler: async (req, reply) => {
      const { id } = req.params as { id: string };
      const body = UpdateExpenseSchema.parse(req.body);
      const ctx = ctxFactory.create({
        tenantId: req.auth.tenantId,
        userId: req.auth.userId,
        correlationId: (req.headers['x-correlation-id'] as string | undefined) ?? crypto.randomUUID(),
      });
      const svc = new ExpenseService(ctx.db.raw);
      await svc.update(parseInt(id, 10), req.auth.tenantId, req.auth.userId, {
        description: body.description,
        notes: body.notes,
        dueDate: body.dueDate ? new Date(body.dueDate) : undefined,
      });
      return reply.send({ success: true });
    },
  });

  fastify.post('/expenses/:id/submit', {
    preHandler: requirePermission(PERMISSIONS.EXPENSE_CREATE),
    handler: async (req, reply) => {
      const { id } = req.params as { id: string };
      const ctx = ctxFactory.create({
        tenantId: req.auth.tenantId,
        userId: req.auth.userId,
        correlationId: (req.headers['x-correlation-id'] as string | undefined) ?? crypto.randomUUID(),
      });
      const svc = new ExpenseService(ctx.db.raw);
      await svc.submit(parseInt(id, 10), req.auth.tenantId, req.auth.userId);
      return reply.send({ success: true });
    },
  });

  fastify.post('/expenses/:id/approve', {
    preHandler: requirePermission(PERMISSIONS.EXPENSE_APPROVE),
    handler: async (req, reply) => {
      const { id } = req.params as { id: string };
      const ctx = ctxFactory.create({
        tenantId: req.auth.tenantId,
        userId: req.auth.userId,
        correlationId: (req.headers['x-correlation-id'] as string | undefined) ?? crypto.randomUUID(),
      });
      const svc = new ExpenseService(ctx.db.raw);
      await svc.approve(parseInt(id, 10), req.auth.tenantId, req.auth.userId);
      return reply.send({ success: true });
    },
  });

  fastify.post('/expenses/:id/pay', {
    preHandler: requirePermission(PERMISSIONS.EXPENSE_APPROVE),
    handler: async (req, reply) => {
      const { id } = req.params as { id: string };
      const body = PayExpenseSchema.parse(req.body);
      const ctx = ctxFactory.create({
        tenantId: req.auth.tenantId,
        userId: req.auth.userId,
        correlationId: (req.headers['x-correlation-id'] as string | undefined) ?? crypto.randomUUID(),
      });
      const svc = new ExpenseService(ctx.db.raw);
      await svc.pay(parseInt(id, 10), req.auth.tenantId, req.auth.userId, {
        paymentMode: body.paymentMode,
        paymentDate: new Date(body.paymentDate),
        paymentReference: body.paymentReference,
      });
      return reply.send({ success: true });
    },
  });
}
