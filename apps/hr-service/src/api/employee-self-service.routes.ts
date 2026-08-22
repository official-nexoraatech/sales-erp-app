import type { FastifyInstance } from 'fastify';
import type { PlatformContextFactory, TenantScopedDatabase } from '@erp/sdk';
import { tenantScopedHandler } from '@erp/sdk';
import { employees, attendance, employeeLeaveBalance, payrollSlips, payrollRuns } from '@erp/db';
import { and, desc, eq, gte, lte } from 'drizzle-orm';
import { z } from 'zod';
import { NotFoundError, ValidationError } from '@erp/types';
import { decryptField } from '@erp/utils/server';
import { requireEnv } from '@erp/config';
import { authenticate } from '../middleware/authenticate.js';

const MonthQuerySchema = z.object({
  month: z
    .string()
    .regex(/^\d{4}-\d{2}$/)
    .optional(),
});

// Resolves "the calling user's own employee record" via employees.userId — the self-service
// link added alongside these routes (2026-07-20 HR audit). No cross-service JWT claim
// involved; this is a plain hr-service-local lookup.
async function resolveOwnEmployeeId(
  db: TenantScopedDatabase,
  tenantId: number,
  userId: number
): Promise<number> {
  const [emp] = await db.raw
    .select({ id: employees.id })
    .from(employees)
    .where(and(eq(employees.tenantId, tenantId), eq(employees.userId, userId)));
  if (!emp) {
    throw new NotFoundError(
      'EmployeeSelfServiceLink',
      'Your login is not linked to an employee record — ask HR to link your account'
    );
  }
  return emp.id;
}

// Phase 9 GUC-per-request rollout — migrated 2026-08-21. No external I/O — decryptField is a
// local, synchronous crypto helper.
export async function employeeSelfServiceRoutes(
  fastify: FastifyInstance,
  ctxFactory: PlatformContextFactory
): Promise<void> {
  // ── My Attendance ─────────────────────────────────────────────────────────
  fastify.get(
    '/me/attendance',
    { preHandler: [authenticate] },
    tenantScopedHandler(ctxFactory, async (request, reply, ctx) => {
      const { tenantId, userId } = ctx.tenant;
      const employeeId = await resolveOwnEmployeeId(ctx.db, tenantId, userId);

      const query = MonthQuerySchema.safeParse(request.query);
      if (!query.success)
        throw new ValidationError(query.error.errors.map((e) => e.message).join('; '));

      const conditions = [eq(attendance.tenantId, tenantId), eq(attendance.employeeId, employeeId)];
      if (query.data.month) {
        const [year, month] = query.data.month.split('-').map(Number) as [number, number];
        const startDate = `${year}-${String(month).padStart(2, '0')}-01`;
        const lastDay = new Date(year, month, 0).getDate();
        const endDate = `${year}-${String(month).padStart(2, '0')}-${lastDay}`;
        conditions.push(gte(attendance.attendanceDate, startDate));
        conditions.push(lte(attendance.attendanceDate, endDate));
      }

      const rows = await ctx.db.raw
        .select()
        .from(attendance)
        .where(and(...conditions));
      return reply.code(200).send({ data: { content: rows, totalElements: rows.length } });
    })
  );

  // ── My Leave Balance ──────────────────────────────────────────────────────
  fastify.get(
    '/me/leave-balance',
    { preHandler: [authenticate] },
    tenantScopedHandler(ctxFactory, async (request, reply, ctx) => {
      const { tenantId, userId } = ctx.tenant;
      const employeeId = await resolveOwnEmployeeId(ctx.db, tenantId, userId);

      const rows = await ctx.db.raw
        .select()
        .from(employeeLeaveBalance)
        .where(
          and(
            eq(employeeLeaveBalance.tenantId, tenantId),
            eq(employeeLeaveBalance.employeeId, employeeId)
          )
        );
      return reply
        .code(200)
        .send({ data: { content: rows, totalElements: rows.length, employeeId } });
    })
  );

  // ── My Payslips ───────────────────────────────────────────────────────────
  fastify.get(
    '/me/payroll-slips',
    { preHandler: [authenticate] },
    tenantScopedHandler(ctxFactory, async (request, reply, ctx) => {
      const { tenantId, userId } = ctx.tenant;
      const employeeId = await resolveOwnEmployeeId(ctx.db, tenantId, userId);

      const slips = await ctx.db.raw
        .select({
          id: payrollSlips.id,
          periodMonth: payrollRuns.periodMonth,
          periodYear: payrollRuns.periodYear,
          grossSalary: payrollSlips.grossSalary,
          netSalary: payrollSlips.netSalary,
          status: payrollSlips.status,
        })
        .from(payrollSlips)
        .innerJoin(payrollRuns, eq(payrollRuns.id, payrollSlips.payrollRunId))
        .where(and(eq(payrollSlips.tenantId, tenantId), eq(payrollSlips.employeeId, employeeId)))
        .orderBy(desc(payrollRuns.periodYear), desc(payrollRuns.periodMonth));

      const encKey = requireEnv('FIELD_ENCRYPTION_KEY');
      const content = slips.map((s) => ({
        id: s.id,
        periodMonth: s.periodMonth,
        periodYear: s.periodYear,
        status: s.status,
        grossSalary: parseFloat(decryptField(s.grossSalary, encKey)),
        netSalary: parseFloat(decryptField(s.netSalary, encKey)),
      }));

      return reply.code(200).send({ data: { content, totalElements: content.length } });
    })
  );
}
