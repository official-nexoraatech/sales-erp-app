import type { FastifyInstance } from 'fastify';
import type { PlatformContextFactory } from '@erp/sdk';
import { tailorWorkLog, employees } from '@erp/db';
import { and, eq, gte, lte, sql } from 'drizzle-orm';
import { z } from 'zod';
import { BusinessError, NotFoundError, ValidationError } from '@erp/types';
import { PERMISSIONS } from '@erp/types';
import { authenticate } from '../middleware/authenticate.js';
import { requirePermission } from '../middleware/authorize.js';

type AuthedRequest = { auth: { tenantId: number; userId: number } };

const CreateWorkLogSchema = z.object({
  employeeId: z.number().int().positive(),
  alterationOrderId: z.number().int().positive().optional(),
  workDate: z.string().max(10),
  taskDescription: z.string().min(1).max(500),
  units: z.number().positive().default(1),
  ratePerUnit: z.number().min(0),
  note: z.string().max(500).optional(),
});

const WorkLogQuerySchema = z.object({
  employeeId: z.coerce.number().int().positive(),
  month: z.string().regex(/^\d{4}-\d{2}$/).optional(),
});

const SummaryQuerySchema = z.object({
  month: z.string().regex(/^\d{4}-\d{2}$/),
});

export async function tailorWorkLogRoutes(
  fastify: FastifyInstance,
  ctxFactory: PlatformContextFactory
): Promise<void> {
  fastify.post('/tailor-work-log', { preHandler: [authenticate, requirePermission(PERMISSIONS.ALTERATION_UPDATE)] }, async (request, reply) => {
    const { tenantId, userId } = (request as unknown as AuthedRequest).auth;
    const ctx = ctxFactory.create({ tenantId, userId, correlationId: (request.headers['x-correlation-id'] as string) ?? crypto.randomUUID() });

    const tailoringEnabled = await ctx.features.isEnabled('hr.tailoring.enabled');
    if (!tailoringEnabled) {
      throw new BusinessError('FEATURE_DISABLED', 'Tailor work log feature (hr.tailoring.enabled) is disabled for this tenant');
    }

    const body = CreateWorkLogSchema.safeParse(request.body);
    if (!body.success) throw new ValidationError(body.error.errors.map((e) => e.message).join('; '));

    const [emp] = await ctx.db.raw.select({ id: employees.id }).from(employees).where(and(eq(employees.id, body.data.employeeId), eq(employees.tenantId, tenantId)));
    if (!emp) throw new NotFoundError('Employee', body.data.employeeId);

    const amount = body.data.units * body.data.ratePerUnit;

    const [created] = await ctx.db.raw
      .insert(tailorWorkLog)
      .values({
        tenantId,
        createdBy: userId,
        employeeId: body.data.employeeId,
        alterationOrderId: body.data.alterationOrderId,
        workDate: body.data.workDate,
        taskDescription: body.data.taskDescription,
        units: String(body.data.units),
        ratePerUnit: String(body.data.ratePerUnit),
        amount: String(amount),
        note: body.data.note,
      } as typeof tailorWorkLog.$inferInsert)
      .returning();

    if (!created) throw new Error('Tailor work log insert failed');
    await ctx.audit.log({ action: 'CREATE', entityType: 'tailor_work_log', entityId: created.id });

    return reply.code(201).send({ data: created });
  });

  fastify.get('/tailor-work-log', { preHandler: [authenticate, requirePermission(PERMISSIONS.ALTERATION_VIEW)] }, async (request, reply) => {
    const { tenantId, userId } = (request as unknown as AuthedRequest).auth;
    const ctx = ctxFactory.create({ tenantId, userId, correlationId: (request.headers['x-correlation-id'] as string) ?? crypto.randomUUID() });
    const query = WorkLogQuerySchema.safeParse(request.query);
    if (!query.success) throw new ValidationError(query.error.errors.map((e) => e.message).join('; '));

    const conditions = [eq(tailorWorkLog.tenantId, tenantId), eq(tailorWorkLog.employeeId, query.data.employeeId)];
    if (query.data.month) {
      const [year, month] = query.data.month.split('-').map(Number) as [number, number];
      const startDate = `${year}-${String(month).padStart(2, '0')}-01`;
      const lastDay = new Date(year, month, 0).getDate();
      const endDate = `${year}-${String(month).padStart(2, '0')}-${lastDay}`;
      conditions.push(gte(tailorWorkLog.workDate, startDate));
      conditions.push(lte(tailorWorkLog.workDate, endDate));
    }

    const rows = await ctx.db.raw.select().from(tailorWorkLog).where(and(...conditions));
    return reply.code(200).send({ data: { content: rows, totalElements: rows.length } });
  });

  fastify.get('/tailor-work-log/summary', { preHandler: [authenticate, requirePermission(PERMISSIONS.ALTERATION_VIEW)] }, async (request, reply) => {
    const { tenantId, userId } = (request as unknown as AuthedRequest).auth;
    const ctx = ctxFactory.create({ tenantId, userId, correlationId: (request.headers['x-correlation-id'] as string) ?? crypto.randomUUID() });
    const query = SummaryQuerySchema.safeParse(request.query);
    if (!query.success) throw new ValidationError(query.error.errors.map((e) => e.message).join('; '));

    const [year, month] = query.data.month.split('-').map(Number) as [number, number];
    const startDate = `${year}-${String(month).padStart(2, '0')}-01`;
    const lastDay = new Date(year, month, 0).getDate();
    const endDate = `${year}-${String(month).padStart(2, '0')}-${lastDay}`;

    const rows = await ctx.db.raw
      .select({
        employeeId: tailorWorkLog.employeeId,
        totalAmount: sql<string>`SUM(${tailorWorkLog.amount})`,
        totalUnits: sql<string>`SUM(${tailorWorkLog.units})`,
        entryCount: sql<string>`COUNT(*)`,
      })
      .from(tailorWorkLog)
      .where(and(eq(tailorWorkLog.tenantId, tenantId), gte(tailorWorkLog.workDate, startDate), lte(tailorWorkLog.workDate, endDate)))
      .groupBy(tailorWorkLog.employeeId);

    return reply.code(200).send({ data: { content: rows, month: query.data.month } });
  });
}
