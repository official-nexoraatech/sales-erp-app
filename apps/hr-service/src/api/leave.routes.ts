import type { FastifyInstance } from 'fastify';
import type { PlatformContextFactory } from '@erp/sdk';
import { leaveTypes, employeeLeaveBalance, leaveApplications, employees, attendance } from '@erp/db';
import { and, eq, gte, lte } from 'drizzle-orm';
import { z } from 'zod';
import { BusinessError, NotFoundError, ValidationError } from '@erp/types';
import { PERMISSIONS } from '@erp/types';
import { authenticate } from '../middleware/authenticate.js';
import { requirePermission } from '../middleware/authorize.js';

type AuthedRequest = { auth: { tenantId: number; userId: number } };

const ApplyLeaveSchema = z.object({
  employeeId: z.number().int().positive(),
  leaveTypeId: z.number().int().positive(),
  startDate: z.string().max(10),
  endDate: z.string().max(10),
  reason: z.string().max(1000).optional(),
  documentUrl: z.string().max(500).optional(),
});

const RejectLeaveSchema = z.object({
  rejectionReason: z.string().min(1).max(1000),
});

function daysBetween(start: string, end: string): number {
  const s = new Date(start);
  const e = new Date(end);
  return Math.round((e.getTime() - s.getTime()) / 86400000) + 1;
}

export async function leaveRoutes(
  fastify: FastifyInstance,
  ctxFactory: PlatformContextFactory
): Promise<void> {
  // ── Leave Types ──────────────────────────────────────────────────────────
  fastify.get('/leave-types', { preHandler: [authenticate, requirePermission(PERMISSIONS.LEAVE_VIEW)] }, async (request, reply) => {
    const { tenantId, userId } = (request as unknown as AuthedRequest).auth;
    const ctx = ctxFactory.create({ tenantId, userId, correlationId: (request.headers['x-correlation-id'] as string) ?? crypto.randomUUID() });
    const rows = await ctx.db.raw.select().from(leaveTypes).where(and(eq(leaveTypes.tenantId, tenantId), eq(leaveTypes.isActive, true)));
    return reply.code(200).send({ data: { content: rows, totalElements: rows.length } });
  });

  fastify.post('/leave-types/seed', { preHandler: [authenticate, requirePermission(PERMISSIONS.LEAVE_APPROVE)] }, async (request, reply) => {
    const { tenantId, userId } = (request as unknown as AuthedRequest).auth;
    const ctx = ctxFactory.create({ tenantId, userId, correlationId: (request.headers['x-correlation-id'] as string) ?? crypto.randomUUID() });
    const { DEFAULT_LEAVE_TYPES } = await import('../domain/leave-type-seed.js');

    let count = 0;
    for (const lt of DEFAULT_LEAVE_TYPES) {
      const [inserted] = await ctx.db.raw
        .insert(leaveTypes)
        .values({
          tenantId,
          createdBy: userId,
          name: lt.name,
          code: lt.code,
          daysPerYear: String(lt.daysPerYear),
          canCarryForward: lt.canCarryForward,
          maxCarryForwardDays: String(lt.maxCarryForwardDays),
          isGenderSpecific: lt.isGenderSpecific,
          genderAllowed: 'genderAllowed' in lt ? lt.genderAllowed : undefined,
          minServiceMonths: lt.minServiceMonths,
          requiresDocument: lt.requiresDocument,
          documentRequiredAfterDays: lt.documentRequiredAfterDays,
          expiryDays: lt.expiryDays,
          isPaidLeave: lt.isPaidLeave,
        } as typeof leaveTypes.$inferInsert)
        .onConflictDoNothing()
        .returning();
      if (inserted) count++;
    }

    await ctx.audit.log({ action: 'CREATE', entityType: 'leave_type', metadata: { action: 'SEED', count } });
    return reply.code(200).send({ data: { message: 'Leave types seeded', count } });
  });

  // ── Leave Balance ────────────────────────────────────────────────────────
  fastify.get<{ Params: { id: string } }>('/employees/:id/leave-balance', { preHandler: [authenticate, requirePermission(PERMISSIONS.LEAVE_VIEW)] }, async (request, reply) => {
    const { tenantId, userId } = (request as unknown as AuthedRequest).auth;
    const ctx = ctxFactory.create({ tenantId, userId, correlationId: (request.headers['x-correlation-id'] as string) ?? crypto.randomUUID() });
    const employeeId = parseInt(request.params.id, 10);
    const year = new Date().getFullYear();
    const rows = await ctx.db.raw
      .select()
      .from(employeeLeaveBalance)
      .where(and(eq(employeeLeaveBalance.tenantId, tenantId), eq(employeeLeaveBalance.employeeId, employeeId), eq(employeeLeaveBalance.year, year)));
    return reply.code(200).send({ data: { content: rows, year } });
  });

  // ── Leave Applications ───────────────────────────────────────────────────
  fastify.post('/leave-applications', { preHandler: [authenticate, requirePermission(PERMISSIONS.LEAVE_APPLY)] }, async (request, reply) => {
    const { tenantId, userId } = (request as unknown as AuthedRequest).auth;
    const ctx = ctxFactory.create({ tenantId, userId, correlationId: (request.headers['x-correlation-id'] as string) ?? crypto.randomUUID() });
    const body = ApplyLeaveSchema.safeParse(request.body);
    if (!body.success) throw new ValidationError(body.error.errors.map((e) => e.message).join('; '));

    const [emp] = await ctx.db.raw.select({ id: employees.id, displayName: employees.displayName, gender: employees.gender, joiningDate: employees.joiningDate }).from(employees).where(and(eq(employees.id, body.data.employeeId), eq(employees.tenantId, tenantId)));
    if (!emp) throw new NotFoundError('Employee', body.data.employeeId);

    const [leaveType] = await ctx.db.raw.select().from(leaveTypes).where(and(eq(leaveTypes.id, body.data.leaveTypeId), eq(leaveTypes.tenantId, tenantId)));
    if (!leaveType) throw new NotFoundError('LeaveType', body.data.leaveTypeId);

    if (leaveType.isGenderSpecific && leaveType.genderAllowed && emp.gender !== leaveType.genderAllowed) {
      throw new BusinessError('LEAVE_GENDER_RESTRICTED', `${leaveType.name} is only applicable for ${leaveType.genderAllowed} employees`);
    }

    if (leaveType.requiresDocument) {
      const days = daysBetween(body.data.startDate, body.data.endDate);
      if (days > leaveType.documentRequiredAfterDays && !body.data.documentUrl) {
        throw new ValidationError(`Document required for leave applications longer than ${leaveType.documentRequiredAfterDays} days`);
      }
    }

    const days = daysBetween(body.data.startDate, body.data.endDate);
    const year = new Date(body.data.startDate).getFullYear();

    // Check balance
    const [balance] = await ctx.db.raw
      .select()
      .from(employeeLeaveBalance)
      .where(and(eq(employeeLeaveBalance.tenantId, tenantId), eq(employeeLeaveBalance.employeeId, body.data.employeeId), eq(employeeLeaveBalance.leaveTypeId, body.data.leaveTypeId), eq(employeeLeaveBalance.year, year)));

    if (balance) {
      const available = parseFloat(balance.totalDays) + parseFloat(balance.carriedForwardDays) - parseFloat(balance.usedDays) - parseFloat(balance.pendingDays);
      if (available < days) {
        throw new BusinessError('INSUFFICIENT_LEAVE_BALANCE', `Insufficient leave balance: available ${available}, requested ${days}`);
      }
    }

    const [created] = await ctx.db.raw
      .insert(leaveApplications)
      .values({
        tenantId,
        createdBy: userId,
        employeeId: body.data.employeeId,
        leaveTypeId: body.data.leaveTypeId,
        startDate: body.data.startDate,
        endDate: body.data.endDate,
        days: String(days),
        reason: body.data.reason,
        documentUrl: body.data.documentUrl,
        status: 'PENDING',
      } as typeof leaveApplications.$inferInsert)
      .returning();

    if (!created) throw new Error('Leave application insert failed');

    // Mark days as pending in balance
    if (balance) {
      await ctx.db.raw
        .update(employeeLeaveBalance)
        .set({ pendingDays: String(parseFloat(balance.pendingDays) + days), updatedAt: new Date() })
        .where(eq(employeeLeaveBalance.id, balance.id));
    }

    await ctx.events.publish('leave_application', created.id, 'LEAVE_APPLIED', {
      leaveApplicationId: created.id,
      employeeId: body.data.employeeId,
      employeeName: emp.displayName,
      startDate: created.startDate,
      endDate: created.endDate,
      status: created.status,
      tenantId,
    });
    await ctx.audit.log({ action: 'CREATE', entityType: 'leave_application', entityId: created.id });

    return reply.code(201).send({ data: created });
  });

  fastify.post<{ Params: { id: string } }>('/leave-applications/:id/approve', { preHandler: [authenticate, requirePermission(PERMISSIONS.LEAVE_APPROVE)] }, async (request, reply) => {
    const { tenantId, userId } = (request as unknown as AuthedRequest).auth;
    const ctx = ctxFactory.create({ tenantId, userId, correlationId: (request.headers['x-correlation-id'] as string) ?? crypto.randomUUID() });
    const id = parseInt(request.params.id, 10);

    const [app] = await ctx.db.raw.select().from(leaveApplications).where(and(eq(leaveApplications.id, id), eq(leaveApplications.tenantId, tenantId)));
    if (!app) throw new NotFoundError('LeaveApplication', id);
    if (app.status !== 'PENDING') throw new BusinessError('LEAVE_NOT_PENDING', `Leave application is ${app.status}, cannot approve`);

    const days = parseFloat(app.days);
    const year = new Date(app.startDate).getFullYear();

    await ctx.db.transaction(async (trx) => {
      await trx.raw.update(leaveApplications).set({ status: 'APPROVED', approvedBy: userId, approvedAt: new Date(), updatedAt: new Date() }).where(eq(leaveApplications.id, id));

      const [balance] = await trx.raw.select().from(employeeLeaveBalance).where(and(eq(employeeLeaveBalance.tenantId, tenantId), eq(employeeLeaveBalance.employeeId, app.employeeId), eq(employeeLeaveBalance.leaveTypeId, app.leaveTypeId), eq(employeeLeaveBalance.year, year)));
      if (balance) {
        await trx.raw
          .update(employeeLeaveBalance)
          .set({
            usedDays: String(parseFloat(balance.usedDays) + days),
            pendingDays: String(Math.max(0, parseFloat(balance.pendingDays) - days)),
            updatedAt: new Date(),
          })
          .where(eq(employeeLeaveBalance.id, balance.id));
      }

      // Create attendance records for leave days
      const start = new Date(app.startDate);
      const end = new Date(app.endDate);
      for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
        const dateStr = d.toISOString().slice(0, 10);
        await trx.raw
          .insert(attendance)
          .values({
            tenantId,
            createdBy: userId,
            employeeId: app.employeeId,
            attendanceDate: dateStr,
            status: 'LEAVE',
            source: 'MANUAL',
            workHours: '0',
            overtimeHours: '0',
          } as typeof attendance.$inferInsert)
          .onConflictDoUpdate({
            target: [attendance.tenantId, attendance.employeeId, attendance.attendanceDate],
            set: { status: 'LEAVE', updatedAt: new Date() },
          });
      }
    });

    const [approvedEmp] = await ctx.db.raw.select({ displayName: employees.displayName }).from(employees).where(eq(employees.id, app.employeeId));
    await ctx.events.publish('leave_application', id, 'LEAVE_APPROVED', {
      leaveApplicationId: id,
      employeeId: app.employeeId,
      employeeName: approvedEmp?.displayName,
      startDate: app.startDate,
      endDate: app.endDate,
      status: 'APPROVED',
      tenantId,
    });
    await ctx.audit.log({ action: 'UPDATE', entityType: 'leave_application', entityId: id, metadata: { action: 'APPROVE' } });

    return reply.code(200).send({ data: { message: 'Leave approved', id } });
  });

  fastify.post<{ Params: { id: string } }>('/leave-applications/:id/reject', { preHandler: [authenticate, requirePermission(PERMISSIONS.LEAVE_REJECT)] }, async (request, reply) => {
    const { tenantId, userId } = (request as unknown as AuthedRequest).auth;
    const ctx = ctxFactory.create({ tenantId, userId, correlationId: (request.headers['x-correlation-id'] as string) ?? crypto.randomUUID() });
    const id = parseInt(request.params.id, 10);
    const body = RejectLeaveSchema.safeParse(request.body);
    if (!body.success) throw new ValidationError(body.error.errors.map((e) => e.message).join('; '));

    const [app] = await ctx.db.raw.select().from(leaveApplications).where(and(eq(leaveApplications.id, id), eq(leaveApplications.tenantId, tenantId)));
    if (!app) throw new NotFoundError('LeaveApplication', id);
    if (app.status !== 'PENDING') throw new BusinessError('LEAVE_NOT_PENDING', `Leave application is ${app.status}, cannot reject`);

    const days = parseFloat(app.days);
    const year = new Date(app.startDate).getFullYear();

    await ctx.db.raw.update(leaveApplications).set({ status: 'REJECTED', rejectedBy: userId, rejectedAt: new Date(), rejectionReason: body.data.rejectionReason, updatedAt: new Date() }).where(eq(leaveApplications.id, id));

    const [balance] = await ctx.db.raw.select().from(employeeLeaveBalance).where(and(eq(employeeLeaveBalance.tenantId, tenantId), eq(employeeLeaveBalance.employeeId, app.employeeId), eq(employeeLeaveBalance.leaveTypeId, app.leaveTypeId), eq(employeeLeaveBalance.year, year)));
    if (balance) {
      await ctx.db.raw.update(employeeLeaveBalance).set({ pendingDays: String(Math.max(0, parseFloat(balance.pendingDays) - days)), updatedAt: new Date() }).where(eq(employeeLeaveBalance.id, balance.id));
    }

    const [rejectedEmp] = await ctx.db.raw.select({ displayName: employees.displayName }).from(employees).where(eq(employees.id, app.employeeId));
    await ctx.events.publish('leave_application', id, 'LEAVE_REJECTED', {
      leaveApplicationId: id,
      employeeId: app.employeeId,
      employeeName: rejectedEmp?.displayName,
      startDate: app.startDate,
      endDate: app.endDate,
      status: 'REJECTED',
      tenantId,
    });
    await ctx.audit.log({ action: 'UPDATE', entityType: 'leave_application', entityId: id, metadata: { action: 'REJECT', reason: body.data.rejectionReason } });

    return reply.code(200).send({ data: { message: 'Leave rejected', id } });
  });

  fastify.post<{ Params: { id: string } }>('/leave-applications/:id/cancel', { preHandler: [authenticate, requirePermission(PERMISSIONS.LEAVE_APPLY)] }, async (request, reply) => {
    const { tenantId, userId } = (request as unknown as AuthedRequest).auth;
    const ctx = ctxFactory.create({ tenantId, userId, correlationId: (request.headers['x-correlation-id'] as string) ?? crypto.randomUUID() });
    const id = parseInt(request.params.id, 10);

    const [app] = await ctx.db.raw.select().from(leaveApplications).where(and(eq(leaveApplications.id, id), eq(leaveApplications.tenantId, tenantId)));
    if (!app) throw new NotFoundError('LeaveApplication', id);
    if (app.status === 'CANCELLED') throw new BusinessError('LEAVE_ALREADY_CANCELLED', 'Leave application is already cancelled');
    if (new Date(app.startDate) <= new Date()) throw new BusinessError('LEAVE_ALREADY_STARTED', 'Cannot cancel a leave that has already started');

    const days = parseFloat(app.days);
    const year = new Date(app.startDate).getFullYear();
    const wasApproved = app.status === 'APPROVED';

    await ctx.db.raw.update(leaveApplications).set({ status: 'CANCELLED', cancelledBy: userId, cancelledAt: new Date(), updatedAt: new Date() }).where(eq(leaveApplications.id, id));

    const [balance] = await ctx.db.raw.select().from(employeeLeaveBalance).where(and(eq(employeeLeaveBalance.tenantId, tenantId), eq(employeeLeaveBalance.employeeId, app.employeeId), eq(employeeLeaveBalance.leaveTypeId, app.leaveTypeId), eq(employeeLeaveBalance.year, year)));
    if (balance) {
      if (wasApproved) {
        await ctx.db.raw.update(employeeLeaveBalance).set({ usedDays: String(Math.max(0, parseFloat(balance.usedDays) - days)), updatedAt: new Date() }).where(eq(employeeLeaveBalance.id, balance.id));
      } else {
        await ctx.db.raw.update(employeeLeaveBalance).set({ pendingDays: String(Math.max(0, parseFloat(balance.pendingDays) - days)), updatedAt: new Date() }).where(eq(employeeLeaveBalance.id, balance.id));
      }
    }

    const [cancelledEmp] = await ctx.db.raw.select({ displayName: employees.displayName }).from(employees).where(eq(employees.id, app.employeeId));
    await ctx.events.publish('leave_application', id, 'LEAVE_CANCELLED', {
      leaveApplicationId: id,
      employeeId: app.employeeId,
      employeeName: cancelledEmp?.displayName,
      startDate: app.startDate,
      endDate: app.endDate,
      status: 'CANCELLED',
      tenantId,
    });
    await ctx.audit.log({ action: 'UPDATE', entityType: 'leave_application', entityId: id, metadata: { action: 'CANCEL' } });

    return reply.code(200).send({ data: { message: 'Leave cancelled', id } });
  });

  fastify.get('/approvals/leaves/pending', { preHandler: [authenticate, requirePermission(PERMISSIONS.LEAVE_APPROVE)] }, async (request, reply) => {
    const { tenantId, userId } = (request as unknown as AuthedRequest).auth;
    const ctx = ctxFactory.create({ tenantId, userId, correlationId: (request.headers['x-correlation-id'] as string) ?? crypto.randomUUID() });
    const rows = await ctx.db.raw.select().from(leaveApplications).where(and(eq(leaveApplications.tenantId, tenantId), eq(leaveApplications.status, 'PENDING')));
    return reply.code(200).send({ data: { content: rows, totalElements: rows.length } });
  });

  // ── Team leave calendar (date range query) ──────────────────────────────
  fastify.get('/leave-applications', { preHandler: [authenticate, requirePermission(PERMISSIONS.LEAVE_VIEW)] }, async (request, reply) => {
    const { tenantId, userId } = (request as unknown as AuthedRequest).auth;
    const ctx = ctxFactory.create({ tenantId, userId, correlationId: (request.headers['x-correlation-id'] as string) ?? crypto.randomUUID() });
    const q = request.query as { startDate?: string; endDate?: string; employeeId?: string };
    const conditions = [eq(leaveApplications.tenantId, tenantId)];
    if (q.employeeId) conditions.push(eq(leaveApplications.employeeId, parseInt(q.employeeId, 10)));
    if (q.startDate) conditions.push(gte(leaveApplications.endDate, q.startDate));
    if (q.endDate) conditions.push(lte(leaveApplications.startDate, q.endDate));
    const rows = await ctx.db.raw.select().from(leaveApplications).where(and(...conditions));
    return reply.code(200).send({ data: { content: rows, totalElements: rows.length } });
  });
}
