/* global crypto, process, fetch, Buffer */
import type { FastifyInstance } from 'fastify';
import type { PlatformContextFactory } from '@erp/sdk';
import {
  payrollRuns,
  payrollSlips,
  employees,
  employeeSalaries,
  salaryStructures,
  designations,
  departments,
  organizationSettings,
} from '@erp/db';
import { and, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { timingSafeEqual } from 'node:crypto';
import { BusinessError, NotFoundError, ValidationError } from '@erp/types';
import { PERMISSIONS } from '@erp/types';
import { encryptField, decryptField } from '@erp/utils/server';
import { requireEnv } from '@erp/config';
import { authenticate } from '../middleware/authenticate.js';
import { requirePermission } from '../middleware/authorize.js';
import { PayrollEngine } from '../domain/PayrollEngine.js';
import { EmployeeLoanService } from '../domain/EmployeeLoanService.js';

type AuthedRequest = { auth: { tenantId: number; userId: number } };

function requireInternalKey(
  req: { headers: Record<string, string | string[] | undefined> },
  reply: { code: (n: number) => { send: (b: unknown) => void } }
): boolean {
  const key = req.headers['x-internal-key'];
  const expected = process.env['INTERNAL_API_KEY'];
  const keyBuffer = Buffer.from(typeof key === 'string' ? key : '');
  const expectedBuffer = Buffer.from(expected ?? '');
  const matches =
    !!expected &&
    keyBuffer.length === expectedBuffer.length &&
    timingSafeEqual(keyBuffer, expectedBuffer);
  if (!matches) {
    reply.code(401).send({ error: 'Unauthorized' });
    return false;
  }
  return true;
}

const CreatePayrollRunSchema = z.object({
  periodMonth: z.number().int().min(1).max(12),
  periodYear: z.number().int().min(2000).max(2100),
  workingDays: z.number().int().min(1).max(31).default(26),
});

const SalaryStructureSchema = z.object({
  name: z.string().min(1).max(200),
  code: z.string().min(1).max(30),
  basicPercent: z.number().min(0).max(100).default(50),
  hraPercent: z.number().min(0).max(100).default(20),
  daPercent: z.number().min(0).max(100).default(10),
  allowances: z.array(z.object({ name: z.string(), amount: z.number() })).default([]),
});

const EmployeeSalarySchema = z.object({
  employeeId: z.number().int().positive(),
  salaryStructureId: z.number().int().positive().optional(),
  ctc: z.number().positive(),
  basic: z.number().positive(),
  hra: z.number().min(0).default(0),
  da: z.number().min(0).default(0),
  gross: z.number().positive(),
  effectiveFrom: z.string().max(10),
});

export async function payrollRoutes(
  fastify: FastifyInstance,
  ctxFactory: PlatformContextFactory
): Promise<void> {
  // ── Salary Structures ────────────────────────────────────────────────────
  fastify.get(
    '/salary-structures',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.PAYROLL_VIEW)] },
    async (request, reply) => {
      const { tenantId, userId } = (request as unknown as AuthedRequest).auth;
      const ctx = ctxFactory.create({
        tenantId,
        userId,
        correlationId: (request.headers['x-correlation-id'] as string) ?? crypto.randomUUID(),
      });
      const rows = await ctx.db.raw
        .select()
        .from(salaryStructures)
        .where(and(eq(salaryStructures.tenantId, tenantId), eq(salaryStructures.isActive, true)));
      return reply.code(200).send({ data: { content: rows, totalElements: rows.length } });
    }
  );

  fastify.post(
    '/salary-structures',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.PAYROLL_PROCESS)] },
    async (request, reply) => {
      const { tenantId, userId } = (request as unknown as AuthedRequest).auth;
      const ctx = ctxFactory.create({
        tenantId,
        userId,
        correlationId: (request.headers['x-correlation-id'] as string) ?? crypto.randomUUID(),
      });
      const body = SalaryStructureSchema.safeParse(request.body);
      if (!body.success)
        throw new ValidationError(body.error.errors.map((e) => e.message).join('; '));
      const [created] = await ctx.db.raw
        .insert(salaryStructures)
        .values({
          tenantId,
          createdBy: userId,
          name: body.data.name,
          code: body.data.code,
          basicPercent: String(body.data.basicPercent),
          hraPercent: String(body.data.hraPercent),
          daPercent: String(body.data.daPercent),
          allowances: body.data.allowances,
        } as typeof salaryStructures.$inferInsert)
        .returning();
      if (!created) throw new Error('Salary structure insert failed');
      return reply.code(201).send({ data: created });
    }
  );

  // ── Employee Salary Assignment (encrypted — never returned in list) ─────
  fastify.post(
    '/employee-salaries',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.PAYROLL_PROCESS)] },
    async (request, reply) => {
      const { tenantId, userId } = (request as unknown as AuthedRequest).auth;
      const ctx = ctxFactory.create({
        tenantId,
        userId,
        correlationId: (request.headers['x-correlation-id'] as string) ?? crypto.randomUUID(),
      });
      const body = EmployeeSalarySchema.safeParse(request.body);
      if (!body.success)
        throw new ValidationError(body.error.errors.map((e) => e.message).join('; '));

      const [emp] = await ctx.db.raw
        .select({ id: employees.id })
        .from(employees)
        .where(
          and(
            eq(employees.id, body.data.employeeId),
            eq(employees.tenantId, tenantId),
            isNull(employees.deletedAt)
          )
        );
      if (!emp) throw new NotFoundError('Employee', body.data.employeeId);

      const encKey = requireEnv('FIELD_ENCRYPTION_KEY');

      // Deactivate prior active salary
      await ctx.db.raw
        .update(employeeSalaries)
        .set({ isActive: false, effectiveTo: body.data.effectiveFrom })
        .where(
          and(
            eq(employeeSalaries.tenantId, tenantId),
            eq(employeeSalaries.employeeId, body.data.employeeId),
            eq(employeeSalaries.isActive, true)
          )
        );

      const [created] = await ctx.db.raw
        .insert(employeeSalaries)
        .values({
          tenantId,
          createdBy: userId,
          employeeId: body.data.employeeId,
          salaryStructureId: body.data.salaryStructureId,
          ctcEncrypted: encryptField(String(body.data.ctc), encKey),
          basicEncrypted: encryptField(String(body.data.basic), encKey),
          hraEncrypted: encryptField(String(body.data.hra), encKey),
          daEncrypted: encryptField(String(body.data.da), encKey),
          grossEncrypted: encryptField(String(body.data.gross), encKey),
          effectiveFrom: body.data.effectiveFrom,
          isActive: true,
        } as typeof employeeSalaries.$inferInsert)
        .returning({
          id: employeeSalaries.id,
          employeeId: employeeSalaries.employeeId,
          effectiveFrom: employeeSalaries.effectiveFrom,
        });

      if (!created) throw new Error('Employee salary insert failed');

      await ctx.audit.log({
        action: 'CREATE',
        entityType: 'employee_salary',
        entityId: created.id,
        metadata: { employeeId: body.data.employeeId },
      });
      // NEVER log or return decrypted salary figures
      return reply.code(201).send({ data: created });
    }
  );

  // ── Payroll Runs ─────────────────────────────────────────────────────────
  fastify.post(
    '/payroll-runs',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.PAYROLL_PROCESS)] },
    async (request, reply) => {
      const { tenantId, userId } = (request as unknown as AuthedRequest).auth;
      const ctx = ctxFactory.create({
        tenantId,
        userId,
        correlationId: (request.headers['x-correlation-id'] as string) ?? crypto.randomUUID(),
      });
      const body = CreatePayrollRunSchema.safeParse(request.body);
      if (!body.success)
        throw new ValidationError(body.error.errors.map((e) => e.message).join('; '));

      const [existing] = await ctx.db.raw
        .select({ id: payrollRuns.id })
        .from(payrollRuns)
        .where(
          and(
            eq(payrollRuns.tenantId, tenantId),
            eq(payrollRuns.periodMonth, body.data.periodMonth),
            eq(payrollRuns.periodYear, body.data.periodYear)
          )
        );
      if (existing)
        throw new BusinessError(
          'PAYROLL_RUN_EXISTS',
          `Payroll run already exists for ${body.data.periodMonth}/${body.data.periodYear}`
        );

      const [created] = await ctx.db.raw
        .insert(payrollRuns)
        .values({
          tenantId,
          createdBy: userId,
          periodMonth: body.data.periodMonth,
          periodYear: body.data.periodYear,
          workingDays: body.data.workingDays,
          status: 'DRAFT',
        } as typeof payrollRuns.$inferInsert)
        .returning();

      if (!created) throw new Error('Payroll run insert failed');
      await ctx.audit.log({ action: 'CREATE', entityType: 'payroll_run', entityId: created.id });
      return reply.code(201).send({ data: created });
    }
  );

  fastify.get(
    '/payroll-runs',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.PAYROLL_VIEW)] },
    async (request, reply) => {
      const { tenantId, userId } = (request as unknown as AuthedRequest).auth;
      const ctx = ctxFactory.create({
        tenantId,
        userId,
        correlationId: (request.headers['x-correlation-id'] as string) ?? crypto.randomUUID(),
      });
      const rows = await ctx.db.raw
        .select()
        .from(payrollRuns)
        .where(eq(payrollRuns.tenantId, tenantId));
      return reply.code(200).send({ data: { content: rows, totalElements: rows.length } });
    }
  );

  fastify.get<{ Params: { id: string } }>(
    '/payroll-runs/:id',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.PAYROLL_VIEW)] },
    async (request, reply) => {
      const { tenantId, userId } = (request as unknown as AuthedRequest).auth;
      const ctx = ctxFactory.create({
        tenantId,
        userId,
        correlationId: (request.headers['x-correlation-id'] as string) ?? crypto.randomUUID(),
      });
      const id = parseInt(request.params.id, 10);
      const [run] = await ctx.db.raw
        .select()
        .from(payrollRuns)
        .where(and(eq(payrollRuns.id, id), eq(payrollRuns.tenantId, tenantId)));
      if (!run) throw new NotFoundError('PayrollRun', id);
      const slips = await ctx.db.raw
        .select()
        .from(payrollSlips)
        .where(and(eq(payrollSlips.payrollRunId, id), eq(payrollSlips.tenantId, tenantId)));
      return reply.code(200).send({ data: { ...run, slips } });
    }
  );

  fastify.post<{ Params: { id: string } }>(
    '/payroll-runs/:id/calculate',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.PAYROLL_PROCESS)] },
    async (request, reply) => {
      const { tenantId, userId } = (request as unknown as AuthedRequest).auth;
      const ctx = ctxFactory.create({
        tenantId,
        userId,
        correlationId: (request.headers['x-correlation-id'] as string) ?? crypto.randomUUID(),
      });
      const id = parseInt(request.params.id, 10);

      const [run] = await ctx.db.raw
        .select()
        .from(payrollRuns)
        .where(and(eq(payrollRuns.id, id), eq(payrollRuns.tenantId, tenantId)));
      if (!run) throw new NotFoundError('PayrollRun', id);
      if (run.status === 'APPROVED' || run.status === 'DISBURSED') {
        throw new BusinessError(
          'PAYROLL_RUN_LOCKED',
          `Payroll run is ${run.status} and cannot be recalculated`
        );
      }

      await ctx.db.raw
        .update(payrollRuns)
        .set({ status: 'CALCULATING', updatedAt: new Date() })
        .where(eq(payrollRuns.id, id));

      const activeEmployees = await ctx.db.raw
        .select({ id: employees.id })
        .from(employees)
        .where(
          and(
            eq(employees.tenantId, tenantId),
            eq(employees.status, 'ACTIVE'),
            isNull(employees.deletedAt)
          )
        );

      let totalGross = 0;
      let totalDeductions = 0;
      let totalNet = 0;
      const ptStateCache = new Map<number | null, string | null>();
      // One employee missing a salary structure (very realistic — a new hire not yet set up)
      // used to throw out of the loop entirely, aborting every other employee's slip and
      // leaving the run stuck in CALCULATING forever with no UI path to retry (Calculate only
      // shows for DRAFT/CALCULATED). Skip-and-report instead, same as any real bulk-process UX.
      const skipped: Array<{ employeeId: number; reason: string }> = [];

      for (const emp of activeEmployees) {
        try {
          const slip = await PayrollEngine.computeSlip(
            ctx.db,
            tenantId,
            emp.id,
            run.periodMonth,
            run.periodYear,
            run.workingDays,
            ptStateCache
          );
          await PayrollEngine.upsertSlip(ctx.db, tenantId, id, slip);
          totalGross += slip.grossSalary;
          totalDeductions += slip.totalDeductions;
          totalNet += slip.netSalary;
        } catch (err) {
          skipped.push({
            employeeId: emp.id,
            reason: err instanceof Error ? err.message : 'Unknown error',
          });
        }
      }

      const processedCount = activeEmployees.length - skipped.length;
      const notes =
        skipped.length > 0
          ? `Skipped ${skipped.length} employee(s): ${skipped.map((s) => `#${s.employeeId} (${s.reason})`).join('; ')}`
          : undefined;

      await ctx.db.raw
        .update(payrollRuns)
        .set({
          status: 'CALCULATED',
          totalEmployees: processedCount,
          totalGross: String(Math.round(totalGross * 100) / 100),
          totalDeductions: String(Math.round(totalDeductions * 100) / 100),
          totalNet: String(Math.round(totalNet * 100) / 100),
          notes,
          updatedAt: new Date(),
        })
        .where(eq(payrollRuns.id, id));

      await ctx.audit.log({
        action: 'UPDATE',
        entityType: 'payroll_run',
        entityId: id,
        metadata: {
          action: 'CALCULATE',
          employeeCount: processedCount,
          skippedCount: skipped.length,
        },
      });

      return reply.code(200).send({
        data: {
          message:
            skipped.length > 0
              ? `Payroll calculated — ${skipped.length} employee(s) skipped (see notes)`
              : 'Payroll calculated',
          payrollRunId: id,
          employeeCount: processedCount,
          skipped,
          totalNet,
        },
      });
    }
  );

  fastify.post<{ Params: { id: string } }>(
    '/payroll-runs/:id/approve',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.PAYROLL_APPROVE)] },
    async (request, reply) => {
      const { tenantId, userId } = (request as unknown as AuthedRequest).auth;
      const ctx = ctxFactory.create({
        tenantId,
        userId,
        correlationId: (request.headers['x-correlation-id'] as string) ?? crypto.randomUUID(),
      });
      const id = parseInt(request.params.id, 10);

      const [run] = await ctx.db.raw
        .select()
        .from(payrollRuns)
        .where(and(eq(payrollRuns.id, id), eq(payrollRuns.tenantId, tenantId)));
      if (!run) throw new NotFoundError('PayrollRun', id);
      if (run.status !== 'CALCULATED')
        throw new BusinessError(
          'PAYROLL_NOT_CALCULATED',
          'Payroll must be calculated before approval'
        );

      await ctx.db.raw
        .update(payrollRuns)
        .set({
          status: 'APPROVED',
          approvedBy: userId,
          approvedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(payrollRuns.id, id));
      await ctx.db.raw
        .update(payrollSlips)
        .set({ status: 'APPROVED', updatedAt: new Date() })
        .where(and(eq(payrollSlips.payrollRunId, id), eq(payrollSlips.tenantId, tenantId)));

      // Loan EMI (PG-045): decrement outstandingBalance + record history exactly once per
      // approval — computeSlip only ever read loan balances, never mutated them, precisely
      // to avoid double-decrementing on repeated DRAFT recalculation.
      const approvedSlips = await ctx.db.raw
        .select({
          id: payrollSlips.id,
          employeeId: payrollSlips.employeeId,
          loanDeduction: payrollSlips.loanDeduction,
        })
        .from(payrollSlips)
        .where(and(eq(payrollSlips.payrollRunId, id), eq(payrollSlips.tenantId, tenantId)));
      for (const slip of approvedSlips) {
        if (parseFloat(slip.loanDeduction) > 0) {
          await EmployeeLoanService.applyMonthlyDeduction(
            ctx.db,
            tenantId,
            slip.employeeId,
            slip.id,
            run.periodMonth,
            run.periodYear
          );
        }
      }

      // Publish event for accounting-service to post salary payable journal (DR Salary Expense / CR Salary Payable)
      await ctx.events.publish('payroll_run', id, 'PAYROLL_RUN_APPROVED', {
        payrollRunId: id,
        tenantId,
        periodMonth: run.periodMonth,
        periodYear: run.periodYear,
        totalGross: run.totalGross,
        totalDeductions: run.totalDeductions,
        totalNet: run.totalNet,
      });
      await ctx.audit.log({
        action: 'UPDATE',
        entityType: 'payroll_run',
        entityId: id,
        metadata: { action: 'APPROVE' },
      });

      return reply.code(200).send({ data: { message: 'Payroll approved', payrollRunId: id } });
    }
  );

  fastify.post<{ Params: { id: string } }>(
    '/payroll-runs/:id/disburse',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.PAYROLL_APPROVE)] },
    async (request, reply) => {
      const { tenantId, userId } = (request as unknown as AuthedRequest).auth;
      const ctx = ctxFactory.create({
        tenantId,
        userId,
        correlationId: (request.headers['x-correlation-id'] as string) ?? crypto.randomUUID(),
      });
      const id = parseInt(request.params.id, 10);

      const [run] = await ctx.db.raw
        .select()
        .from(payrollRuns)
        .where(and(eq(payrollRuns.id, id), eq(payrollRuns.tenantId, tenantId)));
      if (!run) throw new NotFoundError('PayrollRun', id);
      if (run.status !== 'APPROVED')
        throw new BusinessError(
          'PAYROLL_NOT_APPROVED',
          'Payroll must be approved before disbursal'
        );

      await ctx.db.raw
        .update(payrollRuns)
        .set({ status: 'DISBURSED', disbursedAt: new Date(), updatedAt: new Date() })
        .where(eq(payrollRuns.id, id));
      await ctx.db.raw
        .update(payrollSlips)
        .set({ status: 'PAID', updatedAt: new Date() })
        .where(and(eq(payrollSlips.payrollRunId, id), eq(payrollSlips.tenantId, tenantId)));

      // Publish event for accounting-service to post disbursal journal (DR Salary Payable / CR Bank)
      await ctx.events.publish('payroll_run', id, 'PAYROLL_RUN_DISBURSED', {
        payrollRunId: id,
        tenantId,
        totalNet: run.totalNet,
      });
      await ctx.audit.log({
        action: 'UPDATE',
        entityType: 'payroll_run',
        entityId: id,
        metadata: { action: 'DISBURSE' },
      });

      return reply.code(200).send({ data: { message: 'Payroll disbursed', payrollRunId: id } });
    }
  );

  fastify.get<{ Params: { id: string } }>(
    '/payroll-slips/:id',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.VIEW_SALARY_DETAILS)] },
    async (request, reply) => {
      const { tenantId, userId } = (request as unknown as AuthedRequest).auth;
      const ctx = ctxFactory.create({
        tenantId,
        userId,
        correlationId: (request.headers['x-correlation-id'] as string) ?? crypto.randomUUID(),
      });
      const id = parseInt(request.params.id, 10);

      const [slip] = await ctx.db.raw
        .select()
        .from(payrollSlips)
        .where(and(eq(payrollSlips.id, id), eq(payrollSlips.tenantId, tenantId)));
      if (!slip) throw new NotFoundError('PayrollSlip', id);

      const [emp] = await ctx.db.raw
        .select({
          displayName: employees.displayName,
          designationId: employees.designationId,
        })
        .from(employees)
        .where(and(eq(employees.id, slip.employeeId), eq(employees.tenantId, tenantId)));

      let designationName: string | null = null;
      if (emp?.designationId) {
        const [desig] = await ctx.db.raw
          .select({ name: designations.name })
          .from(designations)
          .where(and(eq(designations.id, emp.designationId), eq(designations.tenantId, tenantId)));
        designationName = desig?.name ?? null;
      }

      const encKey = requireEnv('FIELD_ENCRYPTION_KEY');
      const grossSalary = parseFloat(decryptField(slip.grossSalary, encKey));
      const netSalary = parseFloat(decryptField(slip.netSalary, encKey));

      const [run] = await ctx.db.raw
        .select({ periodMonth: payrollRuns.periodMonth, periodYear: payrollRuns.periodYear })
        .from(payrollRuns)
        .where(and(eq(payrollRuns.id, slip.payrollRunId), eq(payrollRuns.tenantId, tenantId)));

      return reply.code(200).send({
        data: {
          id: slip.id,
          employeeId: slip.employeeId,
          employeeName: emp?.displayName ?? null,
          designation: designationName,
          payPeriod: run ? `${String(run.periodMonth).padStart(2, '0')}/${run.periodYear}` : null,
          presentDays: parseFloat(String(slip.presentDays)),
          paidLeaveDays: parseFloat(String(slip.paidLeaveDays)),
          lopDays: parseFloat(String(slip.lopDays)),
          workingDays: slip.workingDays,
          earnings: {
            basicSalary: parseFloat(String(slip.basicSalary)),
            hraAmount: parseFloat(String(slip.hraAmount)),
            daAmount: parseFloat(String(slip.daAmount)),
            otherAllowances: parseFloat(String(slip.otherAllowances)),
            pieceRateAmount: parseFloat(String(slip.pieceRateAmount)),
          },
          grossSalary,
          deductions: {
            pfEmployee: parseFloat(String(slip.pfEmployee)),
            esiEmployee: parseFloat(String(slip.esiEmployee)),
            professionalTax: parseFloat(String(slip.professionalTax)),
            loanDeduction: parseFloat(String(slip.loanDeduction)),
            tdsDeduction: parseFloat(String(slip.tdsDeduction)),
            totalDeductions: parseFloat(String(slip.totalDeductions)),
          },
          pfEmployer: parseFloat(String(slip.pfEmployer)),
          epsAmount: parseFloat(String(slip.epsAmount)),
          esiEmployer: parseFloat(String(slip.esiEmployer)),
          netSalary,
          status: slip.status,
        },
      });
    }
  );

  fastify.get<{ Params: { id: string } }>(
    '/payroll-slips/:id/pdf',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.SALARY_SLIP_PRINT)] },
    async (request, reply) => {
      const { tenantId, userId } = (request as unknown as AuthedRequest).auth;
      const ctx = ctxFactory.create({
        tenantId,
        userId,
        correlationId: (request.headers['x-correlation-id'] as string) ?? crypto.randomUUID(),
      });
      const id = parseInt(request.params.id, 10);
      const [slip] = await ctx.db.raw
        .select()
        .from(payrollSlips)
        .where(and(eq(payrollSlips.id, id), eq(payrollSlips.tenantId, tenantId)));
      if (!slip) throw new NotFoundError('PayrollSlip', id);

      const [emp] = await ctx.db.raw
        .select({
          displayName: employees.displayName,
          employeeCode: employees.employeeCode,
          joiningDate: employees.joiningDate,
          designationId: employees.designationId,
          departmentId: employees.departmentId,
          bankAccountNoEncrypted: employees.bankAccountNoEncrypted,
        })
        .from(employees)
        .where(and(eq(employees.id, slip.employeeId), eq(employees.tenantId, tenantId)));

      const [desig] = emp?.designationId
        ? await ctx.db.raw
            .select({ name: designations.name })
            .from(designations)
            .where(and(eq(designations.id, emp.designationId), eq(designations.tenantId, tenantId)))
        : [];
      const [dept] = emp?.departmentId
        ? await ctx.db.raw
            .select({ name: departments.name })
            .from(departments)
            .where(and(eq(departments.id, emp.departmentId), eq(departments.tenantId, tenantId)))
        : [];
      const [org] = await ctx.db.raw
        .select()
        .from(organizationSettings)
        .where(eq(organizationSettings.tenantId, tenantId));
      const [run] = await ctx.db.raw
        .select({ periodMonth: payrollRuns.periodMonth, periodYear: payrollRuns.periodYear })
        .from(payrollRuns)
        .where(and(eq(payrollRuns.id, slip.payrollRunId), eq(payrollRuns.tenantId, tenantId)));

      const encKey = requireEnv('FIELD_ENCRYPTION_KEY');
      const bankAccount = emp?.bankAccountNoEncrypted
        ? decryptField(emp.bankAccountNoEncrypted, encKey)
        : null;
      const monthNames = [
        'January',
        'February',
        'March',
        'April',
        'May',
        'June',
        'July',
        'August',
        'September',
        'October',
        'November',
        'December',
      ];

      const data = {
        org: { name: org?.orgName, address: org?.address },
        monthName: run ? monthNames[run.periodMonth - 1] : '',
        year: run?.periodYear,
        employee: {
          name: emp?.displayName,
          designation: desig?.name,
          department: dept?.name,
          code: emp?.employeeCode,
          joinDate: emp?.joiningDate,
          bankAccount,
        },
        earnings: [
          { component: 'Basic Salary', amount: slip.basicSalary },
          { component: 'HRA', amount: slip.hraAmount },
          { component: 'DA', amount: slip.daAmount },
          { component: 'Other Allowances', amount: slip.otherAllowances },
          { component: 'Piece Rate', amount: slip.pieceRateAmount },
        ],
        grossSalary: decryptField(slip.grossSalary, encKey),
        deductions: [
          { component: 'PF (Employee)', amount: slip.pfEmployee },
          { component: 'ESI (Employee)', amount: slip.esiEmployee },
          { component: 'Professional Tax', amount: slip.professionalTax },
          { component: 'Loan Deduction', amount: slip.loanDeduction },
          { component: 'TDS', amount: slip.tdsDeduction },
        ],
        totalDeductions: slip.totalDeductions,
        netPay: decryptField(slip.netSalary, encKey),
        workingDays: slip.workingDays,
        totalDays: slip.workingDays,
        lopDays: slip.lopDays,
      };

      const reportUrl = process.env['REPORT_SERVICE_URL'] ?? 'http://localhost:3015';
      const internalKey = process.env['INTERNAL_API_KEY'] ?? '';
      const res = await fetch(`${reportUrl}/reports/pdf`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-internal-key': internalKey },
        body: JSON.stringify({ documentType: 'SALARY_SLIP', data }),
      });
      if (!res.ok)
        throw new BusinessError('PDF_GENERATION_FAILED', 'Failed to generate payslip PDF');
      const buffer = Buffer.from(await res.arrayBuffer());

      return reply
        .code(200)
        .header('Content-Type', 'application/pdf')
        .header('Content-Disposition', `inline; filename="payslip-${id}.pdf"`)
        .send(buffer);
    }
  );

  fastify.post<{ Params: { id: string } }>(
    '/payroll-runs/:id/bulk-send',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.PAYROLL_APPROVE)] },
    async (request, reply) => {
      const { tenantId, userId } = (request as unknown as AuthedRequest).auth;
      const ctx = ctxFactory.create({
        tenantId,
        userId,
        correlationId: (request.headers['x-correlation-id'] as string) ?? crypto.randomUUID(),
      });
      const id = parseInt(request.params.id, 10);
      const [run] = await ctx.db.raw
        .select({ id: payrollRuns.id })
        .from(payrollRuns)
        .where(and(eq(payrollRuns.id, id), eq(payrollRuns.tenantId, tenantId)));
      if (!run) throw new NotFoundError('PayrollRun', id);

      const slips = await ctx.db.raw
        .select({ id: payrollSlips.id, employeeId: payrollSlips.employeeId })
        .from(payrollSlips)
        .where(and(eq(payrollSlips.payrollRunId, id), eq(payrollSlips.tenantId, tenantId)));
      for (const slip of slips) {
        await ctx.events.publish('payroll_slip', slip.id, 'SALARY_SLIP_READY', {
          payrollSlipId: slip.id,
          employeeId: slip.employeeId,
          tenantId,
        });
      }
      await ctx.db.raw
        .update(payrollSlips)
        .set({ slipSentAt: new Date() })
        .where(and(eq(payrollSlips.payrollRunId, id), eq(payrollSlips.tenantId, tenantId)));

      return reply
        .code(200)
        .send({ data: { message: 'Salary slips queued for sending', count: slips.length } });
    }
  );

  // ── POST /internal/payroll/prepare?tenantId=... — PG-026, scheduler-triggered ──
  // Find-or-create this month's payroll run, then run the same calculate logic
  // /payroll-runs/:id/calculate uses, against every active employee.
  fastify.post('/internal/payroll/prepare', async (request, reply) => {
    if (!requireInternalKey(request as never, reply as never)) return;
    const tenantId = parseInt((request.query as { tenantId?: string }).tenantId ?? '', 10);
    if (!tenantId)
      return reply
        .code(400)
        .send({ error: { code: 'MISSING_TENANT_ID', message: 'tenantId query param required' } });

    const ctx = ctxFactory.create({ tenantId, userId: 0, correlationId: crypto.randomUUID() });
    const now = new Date();
    const periodMonth = now.getUTCMonth() + 1;
    const periodYear = now.getUTCFullYear();

    let [run] = await ctx.db.raw
      .select()
      .from(payrollRuns)
      .where(
        and(
          eq(payrollRuns.tenantId, tenantId),
          eq(payrollRuns.periodMonth, periodMonth),
          eq(payrollRuns.periodYear, periodYear)
        )
      );
    if (!run) {
      const [created] = await ctx.db.raw
        .insert(payrollRuns)
        .values({
          tenantId,
          createdBy: 0,
          periodMonth,
          periodYear,
          workingDays: 26,
          status: 'DRAFT',
        } as typeof payrollRuns.$inferInsert)
        .returning();
      if (!created) throw new Error('Payroll run insert failed');
      run = created;
    }

    if (run.status === 'APPROVED' || run.status === 'DISBURSED') {
      return reply.code(200).send({
        data: {
          message: 'Payroll run already finalized — skipped',
          payrollRunId: run.id,
          status: run.status,
        },
      });
    }

    await ctx.db.raw
      .update(payrollRuns)
      .set({ status: 'CALCULATING', updatedAt: new Date() })
      .where(eq(payrollRuns.id, run.id));

    const activeEmployees = await ctx.db.raw
      .select({ id: employees.id })
      .from(employees)
      .where(
        and(
          eq(employees.tenantId, tenantId),
          eq(employees.status, 'ACTIVE'),
          isNull(employees.deletedAt)
        )
      );

    let totalGross = 0;
    let totalDeductions = 0;
    let totalNet = 0;
    const ptStateCache = new Map<number | null, string | null>();
    for (const emp of activeEmployees) {
      const slip = await PayrollEngine.computeSlip(
        ctx.db,
        tenantId,
        emp.id,
        run.periodMonth,
        run.periodYear,
        run.workingDays,
        ptStateCache
      );
      await PayrollEngine.upsertSlip(ctx.db, tenantId, run.id, slip);
      totalGross += slip.grossSalary;
      totalDeductions += slip.totalDeductions;
      totalNet += slip.netSalary;
    }

    await ctx.db.raw
      .update(payrollRuns)
      .set({
        status: 'CALCULATED',
        totalEmployees: activeEmployees.length,
        totalGross: String(Math.round(totalGross * 100) / 100),
        totalDeductions: String(Math.round(totalDeductions * 100) / 100),
        totalNet: String(Math.round(totalNet * 100) / 100),
        updatedAt: new Date(),
      })
      .where(eq(payrollRuns.id, run.id));

    await ctx.audit.log({
      action: 'UPDATE',
      entityType: 'payroll_run',
      entityId: run.id,
      metadata: { action: 'AUTO_PREPARE', employeeCount: activeEmployees.length },
    });

    return reply
      .code(200)
      .send({ data: { payrollRunId: run.id, employeeCount: activeEmployees.length, totalNet } });
  });

  // ── POST /internal/payroll/send-slips?tenantId=... — PG-026, scheduler-triggered ──
  // Same publish-then-mark-sent logic as /payroll-runs/:id/bulk-send, but scoped to
  // this month's run and only slips not already sent (idempotent across cron runs).
  fastify.post('/internal/payroll/send-slips', async (request, reply) => {
    if (!requireInternalKey(request as never, reply as never)) return;
    const tenantId = parseInt((request.query as { tenantId?: string }).tenantId ?? '', 10);
    if (!tenantId)
      return reply
        .code(400)
        .send({ error: { code: 'MISSING_TENANT_ID', message: 'tenantId query param required' } });

    const ctx = ctxFactory.create({ tenantId, userId: 0, correlationId: crypto.randomUUID() });
    const now = new Date();
    const periodMonth = now.getUTCMonth() + 1;
    const periodYear = now.getUTCFullYear();

    const [run] = await ctx.db.raw
      .select({ id: payrollRuns.id })
      .from(payrollRuns)
      .where(
        and(
          eq(payrollRuns.tenantId, tenantId),
          eq(payrollRuns.periodMonth, periodMonth),
          eq(payrollRuns.periodYear, periodYear)
        )
      );
    if (!run)
      return reply
        .code(200)
        .send({ data: { message: 'No payroll run for this period yet — skipped', count: 0 } });

    const slips = await ctx.db.raw
      .select({ id: payrollSlips.id, employeeId: payrollSlips.employeeId })
      .from(payrollSlips)
      .where(
        and(
          eq(payrollSlips.payrollRunId, run.id),
          eq(payrollSlips.tenantId, tenantId),
          isNull(payrollSlips.slipSentAt)
        )
      );

    for (const slip of slips) {
      await ctx.events.publish('payroll_slip', slip.id, 'SALARY_SLIP_READY', {
        payrollSlipId: slip.id,
        employeeId: slip.employeeId,
        tenantId,
      });
    }
    if (slips.length > 0) {
      await ctx.db.raw
        .update(payrollSlips)
        .set({ slipSentAt: new Date() })
        .where(
          and(
            eq(payrollSlips.payrollRunId, run.id),
            eq(payrollSlips.tenantId, tenantId),
            isNull(payrollSlips.slipSentAt)
          )
        );
    }

    return reply.code(200).send({ data: { payrollRunId: run.id, count: slips.length } });
  });
}
