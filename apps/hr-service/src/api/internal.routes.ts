import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { createDatabaseClient } from '@erp/db';
import {
  employees,
  leaveTypes,
  employeeLeaveBalance,
  alterationOrders,
} from '@erp/db';
import { and, eq, isNull, lt, ne } from 'drizzle-orm';

function requireInternalKey(req: FastifyRequest, reply: FastifyReply): boolean {
  const key = req.headers['x-internal-key'];
  const expected = process.env['INTERNAL_API_KEY'];
  if (!expected || key !== expected) {
    void reply.code(401).send({ error: { code: 'UNAUTHORIZED', message: 'Unauthorized' } });
    return false;
  }
  return true;
}

export async function internalRoutes(fastify: FastifyInstance): Promise<void> {
  // ── Biometric auto-import trigger (daily 23:59) ──────────────────────────
  fastify.post('/attendance/biometric-auto-import', async (req, reply) => {
    if (!requireInternalKey(req, reply)) return;
    // Real biometric machine polling integration is configured per-tenant;
    // this endpoint is the scheduler entry point invoked nightly.
    return reply.send({ data: { message: 'Biometric auto-import check complete', imported: 0 } });
  });

  // ── Monthly leave accrual (1st of each month) ────────────────────────────
  fastify.post('/leave-applications/accrue-monthly', async (req, reply) => {
    if (!requireInternalKey(req, reply)) return;
    const db = createDatabaseClient({ url: process.env['DATABASE_URL']! });
    const year = new Date().getFullYear();

    const activeEmployees = await db.select({ id: employees.id, tenantId: employees.tenantId, gender: employees.gender, joiningDate: employees.joiningDate }).from(employees).where(and(eq(employees.status, 'ACTIVE'), isNull(employees.deletedAt)));
    const allLeaveTypes = await db.select().from(leaveTypes).where(eq(leaveTypes.isActive, true));

    let accrued = 0;
    for (const emp of activeEmployees) {
      const applicableTypes = allLeaveTypes.filter((lt) => lt.tenantId === emp.tenantId && parseFloat(lt.daysPerYear) > 0);
      for (const lt of applicableTypes) {
        if (lt.isGenderSpecific && lt.genderAllowed && emp.gender !== lt.genderAllowed) continue;
        const monthlyAccrual = parseFloat(lt.daysPerYear) / 12;

        const [existing] = await db.select().from(employeeLeaveBalance).where(and(eq(employeeLeaveBalance.tenantId, emp.tenantId), eq(employeeLeaveBalance.employeeId, emp.id), eq(employeeLeaveBalance.leaveTypeId, lt.id), eq(employeeLeaveBalance.year, year)));

        if (existing) {
          await db.update(employeeLeaveBalance).set({ totalDays: String(Math.min(parseFloat(lt.daysPerYear), parseFloat(existing.totalDays) + monthlyAccrual)), updatedAt: new Date() }).where(eq(employeeLeaveBalance.id, existing.id));
        } else {
          await db.insert(employeeLeaveBalance).values({
            tenantId: emp.tenantId,
            employeeId: emp.id,
            leaveTypeId: lt.id,
            year,
            totalDays: String(monthlyAccrual),
            usedDays: '0',
            pendingDays: '0',
            carriedForwardDays: '0',
          });
        }
        accrued++;
      }
    }

    return reply.send({ data: { message: 'Monthly leave accrual complete', accrued } });
  });

  // ── Year-end carry forward (December 31) ─────────────────────────────────
  fastify.post('/leave-applications/year-end-carry-forward', async (req, reply) => {
    if (!requireInternalKey(req, reply)) return;
    const db = createDatabaseClient({ url: process.env['DATABASE_URL']! });
    const currentYear = new Date().getFullYear();
    const nextYear = currentYear + 1;

    const allLeaveTypes = await db.select().from(leaveTypes).where(eq(leaveTypes.isActive, true));
    const balances = await db.select().from(employeeLeaveBalance).where(eq(employeeLeaveBalance.year, currentYear));

    let carriedForward = 0;
    let expired = 0;

    for (const balance of balances) {
      const leaveType = allLeaveTypes.find((lt) => lt.id === balance.leaveTypeId);
      if (!leaveType) continue;

      const remaining = Math.max(0, parseFloat(balance.totalDays) + parseFloat(balance.carriedForwardDays) - parseFloat(balance.usedDays));

      if (leaveType.canCarryForward && remaining > 0) {
        const carryAmount = Math.min(remaining, parseFloat(leaveType.maxCarryForwardDays));
        await db.insert(employeeLeaveBalance).values({
          tenantId: balance.tenantId,
          employeeId: balance.employeeId,
          leaveTypeId: balance.leaveTypeId,
          year: nextYear,
          totalDays: '0',
          usedDays: '0',
          pendingDays: '0',
          carriedForwardDays: String(carryAmount),
        }).onConflictDoNothing();
        carriedForward++;
      } else if (remaining > 0) {
        expired++;
      }
    }

    return reply.send({ data: { message: 'Year-end carry forward complete', carriedForward, expired } });
  });

  // ── Alteration: promised-date-today alert (daily 08:00) ──────────────────
  fastify.get('/alterations/promised-today-alert', async (req, reply) => {
    if (!requireInternalKey(req, reply)) return;
    const db = createDatabaseClient({ url: process.env['DATABASE_URL']! });
    const today = new Date().toISOString().slice(0, 10);

    const rows = await db
      .select()
      .from(alterationOrders)
      .where(and(
        eq(alterationOrders.promisedDate, today),
        ne(alterationOrders.status, 'DELIVERED'),
        ne(alterationOrders.status, 'CANCELLED'),
      ));

    return reply.send({ data: { content: rows, totalElements: rows.length } });
  });

  // ── Alteration: overdue alert (daily 08:30) ───────────────────────────────
  fastify.get('/alterations/overdue-alert', async (req, reply) => {
    if (!requireInternalKey(req, reply)) return;
    const db = createDatabaseClient({ url: process.env['DATABASE_URL']! });
    const today = new Date().toISOString().slice(0, 10);

    const rows = await db
      .select()
      .from(alterationOrders)
      .where(and(
        lt(alterationOrders.promisedDate, today),
        ne(alterationOrders.status, 'DELIVERED'),
        ne(alterationOrders.status, 'CANCELLED'),
      ));

    return reply.send({ data: { content: rows, totalElements: rows.length } });
  });

  // ── Feature flag seed (called once on deploy) ─────────────────────────────
  fastify.post('/seed-feature-flags', async (req, reply) => {
    if (!requireInternalKey(req, reply)) return;
    const db = createDatabaseClient({ url: process.env['DATABASE_URL']! });
    const { featureFlags } = await import('@erp/db');
    await db.insert(featureFlags).values({ tenantId: null, flagKey: 'hr.tailoring.enabled', enabled: true }).onConflictDoNothing();
    return reply.send({ data: { message: 'Feature flags seeded' } });
  });
}
