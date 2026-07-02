/* global process */
import type { FastifyInstance } from 'fastify';
import type { PlatformContextFactory } from '@erp/sdk';
import { holidayCalendars } from '@erp/db';
import { and, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { BusinessError, NotFoundError, ValidationError } from '@erp/types';
import { PERMISSIONS } from '@erp/types';
import { authenticate } from '../middleware/authenticate.js';
import { requirePermission } from '../middleware/authorize.js';

type AuthedRequest = { auth: { tenantId: number; userId: number } };

const CreateHolidaySchema = z.object({
  name: z.string().min(1).max(100),
  holidayDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  holidayType: z.enum(['NATIONAL', 'STATE', 'OPTIONAL']),
  branchId: z.number().int().positive().optional(),
});

const NATIONAL_HOLIDAYS_2026_27: Array<{ name: string; holidayDate: string; holidayType: 'NATIONAL' }> = [
  { name: 'Republic Day', holidayDate: '2027-01-26', holidayType: 'NATIONAL' },
  { name: 'Independence Day', holidayDate: '2026-08-15', holidayType: 'NATIONAL' },
  { name: 'Gandhi Jayanti', holidayDate: '2026-10-02', holidayType: 'NATIONAL' },
  { name: 'Diwali', holidayDate: '2026-10-20', holidayType: 'NATIONAL' },
  { name: 'Christmas', holidayDate: '2026-12-25', holidayType: 'NATIONAL' },
  { name: 'New Year', holidayDate: '2027-01-01', holidayType: 'NATIONAL' },
  { name: 'Holi', holidayDate: '2026-03-04', holidayType: 'NATIONAL' },
  { name: 'Ram Navami', holidayDate: '2026-03-28', holidayType: 'NATIONAL' },
  { name: 'Eid ul-Fitr', holidayDate: '2026-03-31', holidayType: 'NATIONAL' },
  { name: 'Eid ul-Adha', holidayDate: '2026-06-07', holidayType: 'NATIONAL' },
  { name: 'Janmashtami', holidayDate: '2026-08-23', holidayType: 'NATIONAL' },
  { name: 'Navratri / Dussehra', holidayDate: '2026-10-11', holidayType: 'NATIONAL' },
];

export async function holidayRoutes(
  fastify: FastifyInstance,
  ctxFactory: PlatformContextFactory
): Promise<void> {
  fastify.get<{ Querystring: { year?: string } }>(
    '/holidays',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.HR_MANAGE)] },
    async (request, reply) => {
      const { tenantId, userId } = (request as unknown as AuthedRequest).auth;
      const ctx = ctxFactory.create({ tenantId, userId, correlationId: (request.headers['x-correlation-id'] as string) ?? crypto.randomUUID() });
      const year = request.query.year ? parseInt(request.query.year, 10) : undefined;

      const rows = await ctx.db.raw
        .select()
        .from(holidayCalendars)
        .where(
          year
            ? and(
                eq(holidayCalendars.tenantId, tenantId),
                sql`EXTRACT(YEAR FROM ${holidayCalendars.holidayDate}) = ${year}`
              )
            : eq(holidayCalendars.tenantId, tenantId)
        )
        .orderBy(holidayCalendars.holidayDate);

      return reply.code(200).send({ data: { content: rows, totalElements: rows.length } });
    }
  );

  fastify.post(
    '/holidays',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.HR_MANAGE)] },
    async (request, reply) => {
      const { tenantId, userId } = (request as unknown as AuthedRequest).auth;
      const ctx = ctxFactory.create({ tenantId, userId, correlationId: (request.headers['x-correlation-id'] as string) ?? crypto.randomUUID() });
      const body = CreateHolidaySchema.safeParse(request.body);
      if (!body.success) throw new ValidationError(body.error.errors.map((e) => e.message).join('; '));

      const [existing] = await ctx.db.raw
        .select({ id: holidayCalendars.id })
        .from(holidayCalendars)
        .where(
          and(
            eq(holidayCalendars.tenantId, tenantId),
            eq(holidayCalendars.name, body.data.name),
            eq(holidayCalendars.holidayDate, body.data.holidayDate)
          )
        );
      if (existing) throw new BusinessError('HR_HOLIDAY_DUPLICATE', `Holiday "${body.data.name}" on ${body.data.holidayDate} already exists`);

      const [created] = await ctx.db.raw
        .insert(holidayCalendars)
        .values({
          tenantId,
          name: body.data.name,
          holidayDate: body.data.holidayDate,
          holidayType: body.data.holidayType,
          branchId: body.data.branchId ?? null,
        } as typeof holidayCalendars.$inferInsert)
        .returning();

      if (!created) throw new Error('Holiday insert failed');
      return reply.code(201).send({ data: created });
    }
  );

  fastify.delete<{ Params: { id: string } }>(
    '/holidays/:id',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.HR_MANAGE)] },
    async (request, reply) => {
      const { tenantId, userId } = (request as unknown as AuthedRequest).auth;
      const ctx = ctxFactory.create({ tenantId, userId, correlationId: (request.headers['x-correlation-id'] as string) ?? crypto.randomUUID() });
      const id = request.params.id;

      const [existing] = await ctx.db.raw
        .select({ id: holidayCalendars.id })
        .from(holidayCalendars)
        .where(and(eq(holidayCalendars.id, id), eq(holidayCalendars.tenantId, tenantId)));
      if (!existing) throw new NotFoundError('Holiday', id);

      await ctx.db.raw
        .delete(holidayCalendars)
        .where(and(eq(holidayCalendars.id, id), eq(holidayCalendars.tenantId, tenantId)));

      return reply.code(204).send();
    }
  );

  fastify.post(
    '/holidays/seed',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.HR_MANAGE)] },
    async (request, reply) => {
      const { tenantId, userId } = (request as unknown as AuthedRequest).auth;
      const ctx = ctxFactory.create({ tenantId, userId, correlationId: (request.headers['x-correlation-id'] as string) ?? crypto.randomUUID() });

      let seeded = 0;
      for (const holiday of NATIONAL_HOLIDAYS_2026_27) {
        const [existing] = await ctx.db.raw
          .select({ id: holidayCalendars.id })
          .from(holidayCalendars)
          .where(
            and(
              eq(holidayCalendars.tenantId, tenantId),
              eq(holidayCalendars.name, holiday.name),
              eq(holidayCalendars.holidayDate, holiday.holidayDate)
            )
          );
        if (!existing) {
          await ctx.db.raw.insert(holidayCalendars).values({
            tenantId,
            name: holiday.name,
            holidayDate: holiday.holidayDate,
            holidayType: holiday.holidayType,
            branchId: null,
          } as typeof holidayCalendars.$inferInsert);
          seeded++;
        }
      }

      return reply.code(200).send({ data: { message: `Seeded ${seeded} holidays for 2026-27`, seeded } });
    }
  );
}
