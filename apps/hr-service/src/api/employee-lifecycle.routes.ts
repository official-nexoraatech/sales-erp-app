import type { FastifyInstance } from 'fastify';
import type { PlatformContextFactory } from '@erp/sdk';
import { tenantScopedHandler } from '@erp/sdk';
import {
  employeeNominees,
  employeeExits,
  employeeHistory,
  employees,
  employeeSalaries,
  employeeLeaveBalance,
  leaveTypes,
} from '@erp/db';
import { and, eq, desc } from 'drizzle-orm';
import { z } from 'zod';
import { BusinessError, NotFoundError, ValidationError } from '@erp/types';
import { PERMISSIONS } from '@erp/types';
import { decryptField } from '@erp/utils/server';
import { requireEnv } from '@erp/config';
import { authenticate } from '../middleware/authenticate.js';
import { requirePermission } from '../middleware/authorize.js';
import { EmployeeLoanService } from '../domain/EmployeeLoanService.js';

const NomineeSchema = z.object({
  name: z.string().min(1).max(200),
  relationship: z.enum(['SPOUSE', 'PARENT', 'CHILD', 'SIBLING', 'OTHER']),
  dateOfBirth: z.string().max(10).optional(),
  contactNumber: z.string().max(20).optional(),
  address: z.string().max(2000).optional(),
  sharePercentage: z.number().min(0).max(100).default(100),
  isPrimary: z.boolean().default(false),
});

const ExitWorkflowSchema = z.object({
  resignationDate: z.string().max(10),
  lastWorkingDate: z.string().max(10),
  noticePeriodDays: z.number().int().min(0).max(180).default(30),
  exitReason: z.string().max(2000).optional(),
});

// Phase 9 GUC-per-request rollout — migrated 2026-08-21. No external I/O.
export async function employeeLifecycleRoutes(
  fastify: FastifyInstance,
  ctxFactory: PlatformContextFactory
): Promise<void> {
  // ── Nominees ──────────────────────────────────────────────────────────────
  fastify.get(
    '/employees/:id/nominees',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.EMPLOYEE_VIEW)] },
    tenantScopedHandler(ctxFactory, async (request, reply, ctx) => {
      const { tenantId } = ctx.tenant;
      const employeeId = parseInt((request.params as { id: string }).id, 10);
      const rows = await ctx.db.raw
        .select()
        .from(employeeNominees)
        .where(
          and(eq(employeeNominees.tenantId, tenantId), eq(employeeNominees.employeeId, employeeId))
        );
      return reply.code(200).send({ data: { content: rows, totalElements: rows.length } });
    })
  );

  fastify.post(
    '/employees/:id/nominees',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.EMPLOYEE_UPDATE)] },
    tenantScopedHandler(ctxFactory, async (request, reply, ctx) => {
      const { tenantId, userId } = ctx.tenant;
      const employeeId = parseInt((request.params as { id: string }).id, 10);
      const body = NomineeSchema.safeParse(request.body);
      if (!body.success)
        throw new ValidationError(body.error.errors.map((e) => e.message).join('; '));

      const [emp] = await ctx.db.raw
        .select({ id: employees.id })
        .from(employees)
        .where(and(eq(employees.id, employeeId), eq(employees.tenantId, tenantId)));
      if (!emp) throw new NotFoundError('Employee', employeeId);

      const existing = await ctx.db.raw
        .select({ sharePercentage: employeeNominees.sharePercentage })
        .from(employeeNominees)
        .where(
          and(eq(employeeNominees.tenantId, tenantId), eq(employeeNominees.employeeId, employeeId))
        );
      const existingTotal = existing.reduce((sum, r) => sum + parseFloat(r.sharePercentage), 0);
      if (existingTotal + body.data.sharePercentage > 100) {
        throw new BusinessError(
          'NOMINEE_SHARE_EXCEEDS_100',
          `Total nominee share would exceed 100% (existing: ${existingTotal}%, adding: ${body.data.sharePercentage}%)`
        );
      }

      const [created] = await ctx.db.raw
        .insert(employeeNominees)
        .values({
          tenantId,
          employeeId,
          createdBy: userId,
          name: body.data.name,
          relationship: body.data.relationship,
          dateOfBirth: body.data.dateOfBirth,
          contactNumber: body.data.contactNumber,
          address: body.data.address,
          sharePercentage: String(body.data.sharePercentage),
          isPrimary: body.data.isPrimary,
        } as typeof employeeNominees.$inferInsert)
        .returning();
      if (!created) throw new Error('Nominee insert failed');

      await ctx.audit.log({
        action: 'CREATE',
        entityType: 'employee_nominee',
        entityId: created.id,
        metadata: { employeeId },
      });
      return reply.code(201).send({ data: created });
    })
  );

  fastify.put(
    '/employees/:id/nominees/:nomineeId',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.EMPLOYEE_UPDATE)] },
    tenantScopedHandler(ctxFactory, async (request, reply, ctx) => {
      const { tenantId } = ctx.tenant;
      const nomineeId = parseInt((request.params as { nomineeId: string }).nomineeId, 10);
      const body = NomineeSchema.safeParse(request.body);
      if (!body.success)
        throw new ValidationError(body.error.errors.map((e) => e.message).join('; '));

      const [existing] = await ctx.db.raw
        .select()
        .from(employeeNominees)
        .where(and(eq(employeeNominees.id, nomineeId), eq(employeeNominees.tenantId, tenantId)));
      if (!existing) throw new NotFoundError('EmployeeNominee', nomineeId);

      const [updated] = await ctx.db.raw
        .update(employeeNominees)
        .set({
          name: body.data.name,
          relationship: body.data.relationship,
          dateOfBirth: body.data.dateOfBirth,
          contactNumber: body.data.contactNumber,
          address: body.data.address,
          sharePercentage: String(body.data.sharePercentage),
          isPrimary: body.data.isPrimary,
          updatedAt: new Date(),
        } as Partial<typeof employeeNominees.$inferInsert>)
        .where(eq(employeeNominees.id, nomineeId))
        .returning();

      await ctx.audit.log({
        action: 'UPDATE',
        entityType: 'employee_nominee',
        entityId: nomineeId,
      });
      return reply.code(200).send({ data: updated });
    })
  );

  fastify.delete(
    '/employees/:id/nominees/:nomineeId',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.EMPLOYEE_UPDATE)] },
    tenantScopedHandler(ctxFactory, async (request, reply, ctx) => {
      const { tenantId } = ctx.tenant;
      const nomineeId = parseInt((request.params as { nomineeId: string }).nomineeId, 10);

      const [existing] = await ctx.db.raw
        .select({ id: employeeNominees.id })
        .from(employeeNominees)
        .where(and(eq(employeeNominees.id, nomineeId), eq(employeeNominees.tenantId, tenantId)));
      if (!existing) throw new NotFoundError('EmployeeNominee', nomineeId);

      await ctx.db.raw.delete(employeeNominees).where(eq(employeeNominees.id, nomineeId));
      await ctx.audit.log({
        action: 'DELETE',
        entityType: 'employee_nominee',
        entityId: nomineeId,
      });
      return reply.code(204).send();
    })
  );

  // ── History (increment/promotion/transfer) — read-only here; written by employee.routes.ts's
  // update route when department/designation/branch/manager change ──────────────────────────
  fastify.get(
    '/employees/:id/history',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.EMPLOYEE_VIEW)] },
    tenantScopedHandler(ctxFactory, async (request, reply, ctx) => {
      const { tenantId } = ctx.tenant;
      const employeeId = parseInt((request.params as { id: string }).id, 10);
      const rows = await ctx.db.raw
        .select()
        .from(employeeHistory)
        .where(
          and(eq(employeeHistory.tenantId, tenantId), eq(employeeHistory.employeeId, employeeId))
        )
        .orderBy(desc(employeeHistory.effectiveDate), desc(employeeHistory.id));
      return reply.code(200).send({ data: { content: rows, totalElements: rows.length } });
    })
  );

  // ── Exit workflow: notice period + clearance + Full & Final settlement ──────────────────
  fastify.get(
    '/employees/:id/exit-workflow',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.EMPLOYEE_VIEW)] },
    tenantScopedHandler(ctxFactory, async (request, reply, ctx) => {
      const { tenantId } = ctx.tenant;
      const employeeId = parseInt((request.params as { id: string }).id, 10);
      const [row] = await ctx.db.raw
        .select()
        .from(employeeExits)
        .where(and(eq(employeeExits.tenantId, tenantId), eq(employeeExits.employeeId, employeeId)));
      return reply.code(200).send({ data: row ?? null });
    })
  );

  fastify.post(
    '/employees/:id/exit-workflow',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.EMPLOYEE_UPDATE)] },
    tenantScopedHandler(ctxFactory, async (request, reply, ctx) => {
      const { tenantId, userId } = ctx.tenant;
      const employeeId = parseInt((request.params as { id: string }).id, 10);
      const body = ExitWorkflowSchema.safeParse(request.body);
      if (!body.success)
        throw new ValidationError(body.error.errors.map((e) => e.message).join('; '));

      const [emp] = await ctx.db.raw
        .select({ id: employees.id })
        .from(employees)
        .where(and(eq(employees.id, employeeId), eq(employees.tenantId, tenantId)));
      if (!emp) throw new NotFoundError('Employee', employeeId);

      const [existing] = await ctx.db.raw
        .select({ id: employeeExits.id })
        .from(employeeExits)
        .where(and(eq(employeeExits.tenantId, tenantId), eq(employeeExits.employeeId, employeeId)));

      const values = {
        resignationDate: body.data.resignationDate,
        lastWorkingDate: body.data.lastWorkingDate,
        noticePeriodDays: body.data.noticePeriodDays,
        exitReason: body.data.exitReason,
        updatedAt: new Date(),
      };

      const [saved] = existing
        ? await ctx.db.raw
            .update(employeeExits)
            .set(values as Partial<typeof employeeExits.$inferInsert>)
            .where(eq(employeeExits.id, existing.id))
            .returning()
        : await ctx.db.raw
            .insert(employeeExits)
            .values({
              tenantId,
              employeeId,
              createdBy: userId,
              ...values,
            } as typeof employeeExits.$inferInsert)
            .returning();
      if (!saved) throw new Error('Employee exit workflow save failed');

      await ctx.audit.log({
        action: existing ? 'UPDATE' : 'CREATE',
        entityType: 'employee_exit',
        entityId: saved.id,
        metadata: { employeeId },
      });
      return reply.code(existing ? 200 : 201).send({ data: saved });
    })
  );

  fastify.post(
    '/employees/:id/exit-workflow/clear',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.EMPLOYEE_UPDATE)] },
    tenantScopedHandler(ctxFactory, async (request, reply, ctx) => {
      const { tenantId, userId } = ctx.tenant;
      const employeeId = parseInt((request.params as { id: string }).id, 10);

      const [existing] = await ctx.db.raw
        .select({ id: employeeExits.id })
        .from(employeeExits)
        .where(and(eq(employeeExits.tenantId, tenantId), eq(employeeExits.employeeId, employeeId)));
      if (!existing) throw new NotFoundError('EmployeeExit', employeeId);

      const [updated] = await ctx.db.raw
        .update(employeeExits)
        .set({
          clearanceStatus: 'CLEARED',
          clearedBy: userId,
          clearedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(employeeExits.id, existing.id))
        .returning();

      await ctx.audit.log({
        action: 'UPDATE',
        entityType: 'employee_exit',
        entityId: existing.id,
        metadata: { action: 'CLEAR' },
      });
      return reply.code(200).send({ data: updated });
    })
  );

  // Computes the F&F breakup from real data (last-drawn pro-rated salary to LWD, unused
  // paid-leave-balance encashment at the same per-day rate, minus outstanding loan recovery)
  // — a preview only, does not persist until /settle is called.
  fastify.get(
    '/employees/:id/exit-workflow/compute-fnf',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.EMPLOYEE_UPDATE)] },
    tenantScopedHandler(ctxFactory, async (request, reply, ctx) => {
      const { tenantId } = ctx.tenant;
      const employeeId = parseInt((request.params as { id: string }).id, 10);

      const [exit] = await ctx.db.raw
        .select()
        .from(employeeExits)
        .where(and(eq(employeeExits.tenantId, tenantId), eq(employeeExits.employeeId, employeeId)));
      if (!exit) throw new NotFoundError('EmployeeExit', employeeId);

      const [salRow] = await ctx.db.raw
        .select({ grossEncrypted: employeeSalaries.grossEncrypted })
        .from(employeeSalaries)
        .where(
          and(
            eq(employeeSalaries.tenantId, tenantId),
            eq(employeeSalaries.employeeId, employeeId),
            eq(employeeSalaries.isActive, true)
          )
        );
      const encKey = requireEnv('FIELD_ENCRYPTION_KEY');
      const monthlyGross = salRow ? parseFloat(decryptField(salRow.grossEncrypted, encKey)) : 0;
      const perDayRate = monthlyGross / 30;

      const lwd = new Date(exit.lastWorkingDate);
      const daysWorkedInFinalMonth = lwd.getDate();
      const proRatedSalaryAmount = Math.round(perDayRate * daysWorkedInFinalMonth * 100) / 100;

      const year = lwd.getFullYear();
      const balances = await ctx.db.raw
        .select({
          totalDays: employeeLeaveBalance.totalDays,
          carriedForwardDays: employeeLeaveBalance.carriedForwardDays,
          usedDays: employeeLeaveBalance.usedDays,
          pendingDays: employeeLeaveBalance.pendingDays,
          leaveTypeId: employeeLeaveBalance.leaveTypeId,
        })
        .from(employeeLeaveBalance)
        .where(
          and(
            eq(employeeLeaveBalance.tenantId, tenantId),
            eq(employeeLeaveBalance.employeeId, employeeId),
            eq(employeeLeaveBalance.year, year)
          )
        );
      const paidLeaveTypeIds = new Set(
        (
          await ctx.db.raw
            .select({ id: leaveTypes.id })
            .from(leaveTypes)
            .where(and(eq(leaveTypes.tenantId, tenantId), eq(leaveTypes.isPaidLeave, true)))
        ).map((r) => r.id)
      );
      const unusedPaidLeaveDays = balances
        .filter((b) => paidLeaveTypeIds.has(b.leaveTypeId))
        .reduce(
          (sum, b) =>
            sum +
            Math.max(
              0,
              parseFloat(b.totalDays) +
                parseFloat(b.carriedForwardDays) -
                parseFloat(b.usedDays) -
                parseFloat(b.pendingDays)
            ),
          0
        );
      const leaveEncashmentAmount = Math.round(unusedPaidLeaveDays * perDayRate * 100) / 100;

      const activeLoans = await EmployeeLoanService.getActiveLoansForEmployee(
        ctx.db,
        tenantId,
        employeeId
      );
      const loanRecoveryAmount =
        Math.round(activeLoans.reduce((sum, l) => sum + l.outstandingBalance, 0) * 100) / 100;

      const fnfTotalAmount =
        Math.round((proRatedSalaryAmount + leaveEncashmentAmount - loanRecoveryAmount) * 100) / 100;

      return reply.code(200).send({
        data: {
          proRatedSalaryAmount,
          leaveEncashmentAmount,
          loanRecoveryAmount,
          unusedPaidLeaveDays,
          fnfTotalAmount,
        },
      });
    })
  );

  fastify.post(
    '/employees/:id/exit-workflow/settle',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.EMPLOYEE_UPDATE)] },
    tenantScopedHandler(ctxFactory, async (request, reply, ctx) => {
      const { tenantId, userId } = ctx.tenant;
      const employeeId = parseInt((request.params as { id: string }).id, 10);
      const body = z
        .object({
          proRatedSalaryAmount: z.number(),
          leaveEncashmentAmount: z.number(),
          loanRecoveryAmount: z.number(),
          fnfTotalAmount: z.number(),
        })
        .safeParse(request.body);
      if (!body.success)
        throw new ValidationError(body.error.errors.map((e) => e.message).join('; '));

      const [existing] = await ctx.db.raw
        .select({ id: employeeExits.id, clearanceStatus: employeeExits.clearanceStatus })
        .from(employeeExits)
        .where(and(eq(employeeExits.tenantId, tenantId), eq(employeeExits.employeeId, employeeId)));
      if (!existing) throw new NotFoundError('EmployeeExit', employeeId);
      if (existing.clearanceStatus !== 'CLEARED') {
        throw new BusinessError(
          'EXIT_NOT_CLEARED',
          'Employee clearance must be completed before Full & Final settlement'
        );
      }

      const [updated] = await ctx.db.raw
        .update(employeeExits)
        .set({
          proRatedSalaryAmount: String(body.data.proRatedSalaryAmount),
          leaveEncashmentAmount: String(body.data.leaveEncashmentAmount),
          loanRecoveryAmount: String(body.data.loanRecoveryAmount),
          fnfTotalAmount: String(body.data.fnfTotalAmount),
          fnfStatus: 'SETTLED',
          fnfSettledBy: userId,
          fnfSettledAt: new Date(),
          updatedAt: new Date(),
        } as Partial<typeof employeeExits.$inferInsert>)
        .where(eq(employeeExits.id, existing.id))
        .returning();

      await ctx.audit.log({
        action: 'UPDATE',
        entityType: 'employee_exit',
        entityId: existing.id,
        metadata: { action: 'FNF_SETTLE', fnfTotalAmount: body.data.fnfTotalAmount },
      });
      return reply.code(200).send({ data: updated });
    })
  );
}
