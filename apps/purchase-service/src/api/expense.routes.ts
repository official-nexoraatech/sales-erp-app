import type { FastifyInstance } from 'fastify';
import type { PlatformContextFactory } from '@erp/sdk';
import { getBranchScope, tenantScopedHandler } from '@erp/sdk';
import { expenses, type ErpDatabase } from '@erp/db';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import { PERMISSIONS, ERPError } from '@erp/types';
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
  expenseType: z.enum([
    'RENT',
    'ELECTRICITY',
    'SALARY',
    'FREIGHT',
    'MARKETING',
    'MAINTENANCE',
    'MISC',
  ]),
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

// Purchase audit 2026-07-21 gap-fix (systemic pass, part 3): same lightweight-lookup pattern as
// purchase-order.routes.ts's assertPoBranchInScope.
async function assertExpenseBranchInScope(
  db: ErpDatabase,
  id: number,
  tenantId: number,
  auth: { permissions: string[]; branchIds: number[] }
): Promise<void> {
  const branchScope = getBranchScope(auth);
  if (branchScope === 'all') return;
  const [expense] = await db
    .select({ branchId: expenses.branchId })
    .from(expenses)
    .where(and(eq(expenses.id, id), eq(expenses.tenantId, tenantId)));
  if (expense && !branchScope.includes(expense.branchId)) {
    throw new ERPError('EXPENSE_OUT_OF_SCOPE', 'Expense is outside your assigned branch(es)', 403);
  }
}

// Phase 9 GUC-per-request rollout — migrated 2026-08-21. No external I/O —
// ExpenseService has no fetch() calls.
export async function expenseRoutes(
  fastify: FastifyInstance,
  ctxFactory: PlatformContextFactory
): Promise<void> {
  fastify.addHook('preHandler', authenticate);

  fastify.get('/expenses', {
    preHandler: requirePermission(PERMISSIONS.EXPENSE_VIEW),
    handler: tenantScopedHandler(ctxFactory, async (req, reply, ctx) => {
      const q = req.query as {
        status?: string;
        expenseType?: string;
        page?: string;
        pageSize?: string;
      };
      const page = Math.max(1, parseInt(q.page ?? '1', 10));
      const pageSize = Math.min(100, parseInt(q.pageSize ?? '20', 10));
      const offset = (page - 1) * pageSize;

      const conditions = [eq(expenses.tenantId, ctx.tenant.tenantId)];
      if (q.status) conditions.push(eq(expenses.status, q.status as never));
      if (q.expenseType) conditions.push(eq(expenses.expenseType, q.expenseType as never));

      // Purchase audit 2026-07-21 gap-fix (systemic pass) — see purchase-order.routes.ts.
      const branchScope = getBranchScope(req.auth);
      if (branchScope !== 'all') {
        if (branchScope.length === 0) {
          return reply.send({ data: { content: [], totalElements: 0, page, pageSize } });
        }
        conditions.push(inArray(expenses.branchId, branchScope));
      }

      const rows = await ctx.db.raw
        .select()
        .from(expenses)
        .where(and(...conditions))
        .orderBy(desc(expenses.expenseDate), desc(expenses.id))
        .limit(pageSize)
        .offset(offset);

      const [countRow] = await ctx.db.raw
        .select({ count: sql<number>`count(*)::int` })
        .from(expenses)
        .where(and(...conditions));

      return reply.send({
        data: { content: rows, totalElements: countRow?.count ?? 0, page, pageSize },
      });
    }),
  });

  fastify.post('/expenses', {
    preHandler: requirePermission(PERMISSIONS.EXPENSE_CREATE),
    handler: tenantScopedHandler(ctxFactory, async (req, reply, ctx) => {
      const body = CreateExpenseSchema.parse(req.body);

      const createScope = getBranchScope(req.auth);
      if (createScope !== 'all' && !createScope.includes(body.branchId)) {
        throw new ERPError(
          'EXPENSE_OUT_OF_SCOPE',
          'Cannot create an expense outside your assigned branch(es)',
          403
        );
      }

      const svc = new ExpenseService(ctx.db.raw);
      const id = await svc.create({
        tenantId: ctx.tenant.tenantId,
        branchId: body.branchId,
        expenseType: body.expenseType,
        supplierId: body.supplierId,
        expenseDate: new Date(body.expenseDate),
        dueDate: body.dueDate ? new Date(body.dueDate) : undefined,
        description: body.description,
        lines: body.lines,
        accountId: body.accountId,
        notes: body.notes,
        createdBy: ctx.tenant.userId,
      });
      return reply.code(201).send({ data: { id } });
    }),
  });

  fastify.get('/expenses/:id', {
    preHandler: requirePermission(PERMISSIONS.EXPENSE_VIEW),
    handler: tenantScopedHandler(ctxFactory, async (req, reply, ctx) => {
      const { id } = req.params as { id: string };
      const svc = new ExpenseService(ctx.db.raw);
      const data = await svc.getWithLines(parseInt(id, 10), ctx.tenant.tenantId);

      const branchScope = getBranchScope(req.auth);
      if (branchScope !== 'all' && !branchScope.includes(data.branchId)) {
        throw new ERPError(
          'EXPENSE_OUT_OF_SCOPE',
          'Expense is outside your assigned branch(es)',
          403
        );
      }

      return reply.send({ data });
    }),
  });

  fastify.put('/expenses/:id', {
    preHandler: requirePermission(PERMISSIONS.EXPENSE_CREATE),
    handler: tenantScopedHandler(ctxFactory, async (req, reply, ctx) => {
      const { id } = req.params as { id: string };
      const body = UpdateExpenseSchema.parse(req.body);
      await assertExpenseBranchInScope(ctx.db.raw, parseInt(id, 10), ctx.tenant.tenantId, req.auth);
      const svc = new ExpenseService(ctx.db.raw);
      await svc.update(parseInt(id, 10), ctx.tenant.tenantId, ctx.tenant.userId, {
        description: body.description,
        notes: body.notes,
        dueDate: body.dueDate ? new Date(body.dueDate) : undefined,
      });
      return reply.send({ success: true });
    }),
  });

  fastify.post('/expenses/:id/submit', {
    preHandler: requirePermission(PERMISSIONS.EXPENSE_CREATE),
    handler: tenantScopedHandler(ctxFactory, async (req, reply, ctx) => {
      const { id } = req.params as { id: string };
      await assertExpenseBranchInScope(ctx.db.raw, parseInt(id, 10), ctx.tenant.tenantId, req.auth);
      const svc = new ExpenseService(ctx.db.raw);
      await svc.submit(parseInt(id, 10), ctx.tenant.tenantId, ctx.tenant.userId);
      return reply.send({ success: true });
    }),
  });

  fastify.post('/expenses/:id/approve', {
    preHandler: requirePermission(PERMISSIONS.EXPENSE_APPROVE),
    handler: tenantScopedHandler(ctxFactory, async (req, reply, ctx) => {
      const { id } = req.params as { id: string };
      await assertExpenseBranchInScope(ctx.db.raw, parseInt(id, 10), ctx.tenant.tenantId, req.auth);
      const svc = new ExpenseService(ctx.db.raw);
      await svc.approve(parseInt(id, 10), ctx.tenant.tenantId, ctx.tenant.userId);
      return reply.send({ success: true });
    }),
  });

  fastify.post('/expenses/:id/pay', {
    preHandler: requirePermission(PERMISSIONS.EXPENSE_APPROVE),
    handler: tenantScopedHandler(ctxFactory, async (req, reply, ctx) => {
      const { id } = req.params as { id: string };
      const body = PayExpenseSchema.parse(req.body);
      await assertExpenseBranchInScope(ctx.db.raw, parseInt(id, 10), ctx.tenant.tenantId, req.auth);
      const svc = new ExpenseService(ctx.db.raw);
      await svc.pay(parseInt(id, 10), ctx.tenant.tenantId, ctx.tenant.userId, {
        paymentMode: body.paymentMode,
        paymentDate: new Date(body.paymentDate),
        paymentReference: body.paymentReference,
      });
      return reply.send({ success: true });
    }),
  });
}
