import type { FastifyInstance } from 'fastify';
import type { PlatformContextFactory, TenantScopedDatabase } from '@erp/sdk';
import { statutoryChallanFilings } from '@erp/db';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { ValidationError } from '@erp/types';
import { PERMISSIONS } from '@erp/types';
import { authenticate } from '../middleware/authenticate.js';
import { requirePermission } from '../middleware/authorize.js';
import { PFChallanService } from '../domain/PFChallanService.js';
import { ESIChallanService } from '../domain/ESIChallanService.js';
import { Form16Service } from '../domain/Form16Service.js';

type AuthedRequest = { auth: { tenantId: number; userId: number } };

const PeriodQuerySchema = z.object({
  month: z.coerce.number().int().min(1).max(12),
  year: z.coerce.number().int().min(2000).max(2100),
});

const MarkFiledSchema = z.object({
  month: z.number().int().min(1).max(12),
  year: z.number().int().min(2000).max(2100),
});

function toCSV(header: string[], rows: (string | number)[][]): string {
  const escape = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`;
  return [header, ...rows].map((r) => r.map(escape).join(',')).join('\r\n');
}

async function getFiling(
  db: TenantScopedDatabase,
  tenantId: number,
  challanType: 'PF' | 'ESI',
  periodMonth: number,
  periodYear: number
) {
  const [filing] = await db.raw
    .select()
    .from(statutoryChallanFilings)
    .where(and(
      eq(statutoryChallanFilings.tenantId, tenantId),
      eq(statutoryChallanFilings.challanType, challanType),
      eq(statutoryChallanFilings.periodMonth, periodMonth),
      eq(statutoryChallanFilings.periodYear, periodYear),
    ));
  return filing ?? null;
}

export async function statutoryRoutes(
  fastify: FastifyInstance,
  ctxFactory: PlatformContextFactory
): Promise<void> {
  // ── PF Challan ────────────────────────────────────────────────────────────
  fastify.get<{ Querystring: { month?: string; year?: string } }>(
    '/pf-challans',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.HR_STATUTORY)] },
    async (request, reply) => {
      const { tenantId, userId } = (request as unknown as AuthedRequest).auth;
      const ctx = ctxFactory.create({ tenantId, userId, correlationId: (request.headers['x-correlation-id'] as string) ?? crypto.randomUUID() });
      const query = PeriodQuerySchema.safeParse(request.query);
      if (!query.success) throw new ValidationError(query.error.errors.map((e) => e.message).join('; '));

      const challan = await PFChallanService.generateChallan(ctx.db, tenantId, query.data.month, query.data.year);
      const filing = await getFiling(ctx.db, tenantId, 'PF', query.data.month, query.data.year);

      return reply.code(200).send({ data: { ...challan, filedAt: filing?.filedAt ?? null } });
    }
  );

  fastify.get<{ Querystring: { month?: string; year?: string; format?: string } }>(
    '/pf-challans/export',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.HR_STATUTORY)] },
    async (request, reply) => {
      const { tenantId, userId } = (request as unknown as AuthedRequest).auth;
      const ctx = ctxFactory.create({ tenantId, userId, correlationId: (request.headers['x-correlation-id'] as string) ?? crypto.randomUUID() });
      const query = PeriodQuerySchema.safeParse(request.query);
      if (!query.success) throw new ValidationError(query.error.errors.map((e) => e.message).join('; '));

      const challan = await PFChallanService.generateChallan(ctx.db, tenantId, query.data.month, query.data.year);
      const header = ['UAN', 'Employee Name', 'Basic Salary', 'EPF Employee', 'EPF Employer', 'EPS Amount'];
      const rows = challan.rows.map((r) => [r.uan ?? '', r.employeeName, r.basicSalary, r.epfEmployee, r.epfEmployer, r.epsAmount]);
      const csv = toCSV(header, rows);

      reply.header('Content-Type', 'text/csv; charset=utf-8');
      reply.header('Content-Disposition', `attachment; filename="pf-challan-${query.data.year}-${String(query.data.month).padStart(2, '0')}.csv"`);
      return reply.code(200).send(csv);
    }
  );

  fastify.post(
    '/pf-challans/mark-filed',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.HR_STATUTORY)] },
    async (request, reply) => {
      const { tenantId, userId } = (request as unknown as AuthedRequest).auth;
      const ctx = ctxFactory.create({ tenantId, userId, correlationId: (request.headers['x-correlation-id'] as string) ?? crypto.randomUUID() });
      const body = MarkFiledSchema.safeParse(request.body);
      if (!body.success) throw new ValidationError(body.error.errors.map((e) => e.message).join('; '));

      const existing = await getFiling(ctx.db, tenantId, 'PF', body.data.month, body.data.year);
      if (existing) {
        await ctx.db.raw.update(statutoryChallanFilings).set({ filedAt: new Date(), filedBy: userId }).where(eq(statutoryChallanFilings.id, existing.id));
      } else {
        await ctx.db.raw.insert(statutoryChallanFilings).values({
          tenantId,
          challanType: 'PF',
          periodMonth: body.data.month,
          periodYear: body.data.year,
          filedAt: new Date(),
          filedBy: userId,
        } as typeof statutoryChallanFilings.$inferInsert);
      }

      await ctx.audit.log({ action: 'UPDATE', entityType: 'pf_challan', metadata: { action: 'MARK_FILED', ...body.data } });
      return reply.code(200).send({ data: { message: 'PF challan marked as filed', ...body.data } });
    }
  );

  // ── ESI Challan ───────────────────────────────────────────────────────────
  fastify.get<{ Querystring: { month?: string; year?: string } }>(
    '/esi-challans',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.HR_STATUTORY)] },
    async (request, reply) => {
      const { tenantId, userId } = (request as unknown as AuthedRequest).auth;
      const ctx = ctxFactory.create({ tenantId, userId, correlationId: (request.headers['x-correlation-id'] as string) ?? crypto.randomUUID() });
      const query = PeriodQuerySchema.safeParse(request.query);
      if (!query.success) throw new ValidationError(query.error.errors.map((e) => e.message).join('; '));

      const challan = await ESIChallanService.generateChallan(ctx.db, tenantId, query.data.month, query.data.year);
      const filing = await getFiling(ctx.db, tenantId, 'ESI', query.data.month, query.data.year);

      return reply.code(200).send({ data: { ...challan, filedAt: filing?.filedAt ?? null } });
    }
  );

  fastify.get<{ Querystring: { month?: string; year?: string; format?: string } }>(
    '/esi-challans/export',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.HR_STATUTORY)] },
    async (request, reply) => {
      const { tenantId, userId } = (request as unknown as AuthedRequest).auth;
      const ctx = ctxFactory.create({ tenantId, userId, correlationId: (request.headers['x-correlation-id'] as string) ?? crypto.randomUUID() });
      const query = PeriodQuerySchema.safeParse(request.query);
      if (!query.success) throw new ValidationError(query.error.errors.map((e) => e.message).join('; '));

      const challan = await ESIChallanService.generateChallan(ctx.db, tenantId, query.data.month, query.data.year);
      const header = ['ESI Number', 'Employee Name', 'Gross Salary', 'ESI Employee', 'ESI Employer'];
      const rows = challan.rows.map((r) => [r.esiNumber ?? '', r.employeeName, r.grossSalary, r.esiEmployee, r.esiEmployer]);
      const csv = toCSV(header, rows);

      reply.header('Content-Type', 'text/csv; charset=utf-8');
      reply.header('Content-Disposition', `attachment; filename="esi-challan-${query.data.year}-${String(query.data.month).padStart(2, '0')}.csv"`);
      return reply.code(200).send(csv);
    }
  );

  fastify.post(
    '/esi-challans/mark-filed',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.HR_STATUTORY)] },
    async (request, reply) => {
      const { tenantId, userId } = (request as unknown as AuthedRequest).auth;
      const ctx = ctxFactory.create({ tenantId, userId, correlationId: (request.headers['x-correlation-id'] as string) ?? crypto.randomUUID() });
      const body = MarkFiledSchema.safeParse(request.body);
      if (!body.success) throw new ValidationError(body.error.errors.map((e) => e.message).join('; '));

      const existing = await getFiling(ctx.db, tenantId, 'ESI', body.data.month, body.data.year);
      if (existing) {
        await ctx.db.raw.update(statutoryChallanFilings).set({ filedAt: new Date(), filedBy: userId }).where(eq(statutoryChallanFilings.id, existing.id));
      } else {
        await ctx.db.raw.insert(statutoryChallanFilings).values({
          tenantId,
          challanType: 'ESI',
          periodMonth: body.data.month,
          periodYear: body.data.year,
          filedAt: new Date(),
          filedBy: userId,
        } as typeof statutoryChallanFilings.$inferInsert);
      }

      await ctx.audit.log({ action: 'UPDATE', entityType: 'esi_challan', metadata: { action: 'MARK_FILED', ...body.data } });
      return reply.code(200).send({ data: { message: 'ESI challan marked as filed', ...body.data } });
    }
  );

  // ── Form 16 ───────────────────────────────────────────────────────────────
  fastify.get<{ Params: { id: string }; Querystring: { year?: string } }>(
    '/employees/:id/form16',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.VIEW_SALARY_DETAILS)] },
    async (request, reply) => {
      const { tenantId, userId } = (request as unknown as AuthedRequest).auth;
      const ctx = ctxFactory.create({ tenantId, userId, correlationId: (request.headers['x-correlation-id'] as string) ?? crypto.randomUUID() });
      const employeeId = parseInt(request.params.id, 10);
      const financialYear = request.query.year;
      if (!financialYear) throw new ValidationError('year query parameter is required, e.g. ?year=2025-26');

      const data = await Form16Service.generateForm16Data(ctx.db, tenantId, employeeId, financialYear);
      return reply.code(200).send({ data });
    }
  );
}
