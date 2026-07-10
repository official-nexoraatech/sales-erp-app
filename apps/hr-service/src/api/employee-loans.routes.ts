import type { FastifyInstance } from 'fastify';
import type { PlatformContextFactory } from '@erp/sdk';
import { z } from 'zod';
import { ValidationError } from '@erp/types';
import { PERMISSIONS } from '@erp/types';
import { authenticate } from '../middleware/authenticate.js';
import { requirePermission } from '../middleware/authorize.js';
import { EmployeeLoanService } from '../domain/EmployeeLoanService.js';

type AuthedRequest = { auth: { tenantId: number; userId: number } };

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

export async function employeeLoanRoutes(
  fastify: FastifyInstance,
  ctxFactory: PlatformContextFactory
): Promise<void> {
  fastify.post('/employee-loans', { preHandler: [authenticate, requirePermission(PERMISSIONS.EMPLOYEE_LOAN_MANAGE)] }, async (request, reply) => {
    const { tenantId, userId } = (request as unknown as AuthedRequest).auth;
    const ctx = ctxFactory.create({ tenantId, userId, correlationId: (request.headers['x-correlation-id'] as string) ?? crypto.randomUUID() });
    const body = CreateLoanSchema.safeParse(request.body);
    if (!body.success) throw new ValidationError(body.error.errors.map((e) => e.message).join('; '));

    const loan = await EmployeeLoanService.create(ctx.db, tenantId, userId, body.data);

    await ctx.events.publish('employee_loan', loan.id, 'EMPLOYEE_LOAN_DISBURSED', {
      employeeLoanId: loan.id,
      employeeId: loan.employeeId,
      tenantId,
      principalAmount: loan.principalAmount,
      disbursedAmount: loan.disbursedAmount,
    });
    await ctx.audit.log({ action: 'CREATE', entityType: 'employee_loan', entityId: loan.id, metadata: { employeeId: loan.employeeId } });

    return reply.code(201).send({ data: loan });
  });

  fastify.get('/employee-loans', { preHandler: [authenticate, requirePermission(PERMISSIONS.EMPLOYEE_LOAN_MANAGE)] }, async (request, reply) => {
    const { tenantId, userId } = (request as unknown as AuthedRequest).auth;
    const ctx = ctxFactory.create({ tenantId, userId, correlationId: (request.headers['x-correlation-id'] as string) ?? crypto.randomUUID() });
    const query = ListLoansQuerySchema.safeParse(request.query);
    if (!query.success) throw new ValidationError(query.error.errors.map((e) => e.message).join('; '));

    const loans = await EmployeeLoanService.list(ctx.db, tenantId, query.data.employeeId);
    return reply.code(200).send({ data: loans });
  });

  fastify.get<{ Params: { id: string } }>('/employee-loans/:id', { preHandler: [authenticate, requirePermission(PERMISSIONS.EMPLOYEE_LOAN_MANAGE)] }, async (request, reply) => {
    const { tenantId, userId } = (request as unknown as AuthedRequest).auth;
    const ctx = ctxFactory.create({ tenantId, userId, correlationId: (request.headers['x-correlation-id'] as string) ?? crypto.randomUUID() });
    const id = parseInt(request.params.id, 10);

    const { loan, history } = await EmployeeLoanService.getById(ctx.db, tenantId, id);
    return reply.code(200).send({ data: { ...loan, history } });
  });

  fastify.patch<{ Params: { id: string } }>('/employee-loans/:id', { preHandler: [authenticate, requirePermission(PERMISSIONS.EMPLOYEE_LOAN_MANAGE)] }, async (request, reply) => {
    const { tenantId, userId } = (request as unknown as AuthedRequest).auth;
    const ctx = ctxFactory.create({ tenantId, userId, correlationId: (request.headers['x-correlation-id'] as string) ?? crypto.randomUUID() });
    const id = parseInt(request.params.id, 10);
    const body = UpdateLoanStatusSchema.safeParse(request.body);
    if (!body.success) throw new ValidationError(body.error.errors.map((e) => e.message).join('; '));

    const loan = await EmployeeLoanService.updateStatus(ctx.db, tenantId, id, body.data.status);
    await ctx.audit.log({ action: 'UPDATE', entityType: 'employee_loan', entityId: id, metadata: { action: body.data.status } });

    return reply.code(200).send({ data: loan });
  });
}
