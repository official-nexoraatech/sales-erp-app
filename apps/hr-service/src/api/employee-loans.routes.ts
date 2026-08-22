import type { FastifyInstance } from 'fastify';
import type { PlatformContextFactory } from '@erp/sdk';
import { PlatformEventBus, tenantScopedHandler } from '@erp/sdk';
import { z } from 'zod';
import { ValidationError } from '@erp/types';
import { PERMISSIONS } from '@erp/types';
import { authenticate } from '../middleware/authenticate.js';
import { requirePermission } from '../middleware/authorize.js';
import { EmployeeLoanService } from '../domain/EmployeeLoanService.js';

const CreateLoanSchema = z.object({
  employeeId: z.number().int().positive(),
  loanType: z.enum(['SALARY_ADVANCE', 'FESTIVAL_ADVANCE', 'GENERAL']),
  principalAmount: z.number().positive(),
  tenureMonths: z.number().int().positive(),
  disbursedDate: z.string().max(10),
});

const UpdateLoanStatusSchema = z.object({
  status: z.enum(['CANCELLED', 'CLOSED']),
});

const ListLoansQuerySchema = z.object({
  employeeId: z.coerce.number().int().positive(),
});

// Phase 9 GUC-per-request rollout — migrated 2026-08-21. No external I/O —
// EmployeeLoanService has no fetch() calls.
export async function employeeLoanRoutes(
  fastify: FastifyInstance,
  ctxFactory: PlatformContextFactory
): Promise<void> {
  fastify.post(
    '/employee-loans',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.EMPLOYEE_LOAN_MANAGE)] },
    tenantScopedHandler(ctxFactory, async (request, reply, ctx) => {
      const { tenantId, userId } = ctx.tenant;
      const body = CreateLoanSchema.safeParse(request.body);
      if (!body.success)
        throw new ValidationError(body.error.errors.map((e) => e.message).join('; '));

      const loan = await ctx.db.transaction(async (trx) => {
        const created = await EmployeeLoanService.create(trx, tenantId, userId, body.data);
        const eventBus = new PlatformEventBus(trx, tenantId, userId, ctx.tenant.correlationId);
        await eventBus.publishInTransaction(
          'employee_loan',
          created.id,
          'EMPLOYEE_LOAN_DISBURSED',
          {
            employeeLoanId: created.id,
            employeeId: created.employeeId,
            tenantId,
            principalAmount: created.principalAmount,
            disbursedAmount: created.disbursedAmount,
          }
        );
        return created;
      });
      await ctx.audit.log({
        action: 'CREATE',
        entityType: 'employee_loan',
        entityId: loan.id,
        metadata: { employeeId: loan.employeeId },
      });

      return reply.code(201).send({ data: loan });
    })
  );

  fastify.get(
    '/employee-loans',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.EMPLOYEE_LOAN_MANAGE)] },
    tenantScopedHandler(ctxFactory, async (request, reply, ctx) => {
      const { tenantId } = ctx.tenant;
      const query = ListLoansQuerySchema.safeParse(request.query);
      if (!query.success)
        throw new ValidationError(query.error.errors.map((e) => e.message).join('; '));

      const loans = await EmployeeLoanService.list(ctx.db, tenantId, query.data.employeeId);
      return reply.code(200).send({ data: loans });
    })
  );

  fastify.get(
    '/employee-loans/:id',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.EMPLOYEE_LOAN_MANAGE)] },
    tenantScopedHandler(ctxFactory, async (request, reply, ctx) => {
      const { tenantId } = ctx.tenant;
      const id = parseInt((request.params as { id: string }).id, 10);

      const { loan, history } = await EmployeeLoanService.getById(ctx.db, tenantId, id);
      return reply.code(200).send({ data: { ...loan, history } });
    })
  );

  fastify.patch(
    '/employee-loans/:id',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.EMPLOYEE_LOAN_MANAGE)] },
    tenantScopedHandler(ctxFactory, async (request, reply, ctx) => {
      const { tenantId } = ctx.tenant;
      const id = parseInt((request.params as { id: string }).id, 10);
      const body = UpdateLoanStatusSchema.safeParse(request.body);
      if (!body.success)
        throw new ValidationError(body.error.errors.map((e) => e.message).join('; '));

      const loan = await EmployeeLoanService.updateStatus(ctx.db, tenantId, id, body.data.status);
      await ctx.audit.log({
        action: 'UPDATE',
        entityType: 'employee_loan',
        entityId: id,
        metadata: { action: body.data.status },
      });

      return reply.code(200).send({ data: loan });
    })
  );
}
