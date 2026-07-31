import type { FastifyInstance } from 'fastify';
import type { ErpDatabase } from '@erp/db';
import { exportSchedules, exportRunHistory } from '@erp/db';
import { eq, and, desc } from 'drizzle-orm';
import { PERMISSIONS } from '@erp/types';
import { NotFoundError, ValidationError } from '@erp/types';
import { z } from 'zod';
import { authenticate } from '../middleware/authenticate.js';

type AuthedRequest = { auth: { tenantId: number; userId: number; permissions: string[] } };

function hasPermission(request: unknown, perm: string): boolean {
  return ((request as AuthedRequest).auth?.permissions ?? []).includes(perm);
}

// CRM-ROADMAP Phase 4, Feature 8 — Public CRM API & BI/Data-Warehouse Export. Reuses the
// pre-existing EXPORT_GENERATE/EXPORT_VIEW permissions rather than inventing new ones — a
// recurring export schedule is the same underlying action class as the existing one-shot
// POST /exports/generate (see export.routes.ts), just dispatched on a cron instead of once.
const ExportScheduleCreateSchema = z.object({
  entityType: z.enum([
    'customer',
    'supplier',
    'item',
    'invoice',
    'payment',
    'ledger',
    'stock',
    'employee',
    'lead',
    'opportunity',
    'account',
    'contact',
  ]),
  format: z.enum(['CSV', 'XLSX']).default('XLSX'),
  filters: z.record(z.unknown()).optional(),
  cronExpression: z.string().min(1),
  recipients: z.array(z.string().email()).default([]),
});

const ExportScheduleUpdateSchema = z.object({
  cronExpression: z.string().min(1).optional(),
  recipients: z.array(z.string().email()).optional(),
  active: z.boolean().optional(),
});

export async function exportScheduleRoutes(
  fastify: FastifyInstance,
  db: ErpDatabase
): Promise<void> {
  fastify.get('/export-schedules', { preHandler: authenticate }, async (request, reply) => {
    if (!hasPermission(request, PERMISSIONS.EXPORT_VIEW)) {
      return reply
        .code(403)
        .send({ error: { code: 'PERMISSION_DENIED', message: 'Missing permission: EXPORT_VIEW' } });
    }
    const { tenantId } = (request as unknown as AuthedRequest).auth;
    const rows = await db
      .select()
      .from(exportSchedules)
      .where(eq(exportSchedules.tenantId, tenantId))
      .orderBy(desc(exportSchedules.createdAt));
    return reply.code(200).send({ data: { content: rows, totalElements: rows.length } });
  });

  fastify.post('/export-schedules', { preHandler: authenticate }, async (request, reply) => {
    if (!hasPermission(request, PERMISSIONS.EXPORT_GENERATE)) {
      return reply.code(403).send({
        error: { code: 'PERMISSION_DENIED', message: 'Missing permission: EXPORT_GENERATE' },
      });
    }
    const { tenantId, userId } = (request as unknown as AuthedRequest).auth;
    const body = ExportScheduleCreateSchema.safeParse(request.body);
    if (!body.success)
      throw new ValidationError(body.error.errors.map((e) => e.message).join('; '));

    const [created] = await db
      .insert(exportSchedules)
      .values({
        tenantId,
        entityType: body.data.entityType,
        format: body.data.format,
        filters: body.data.filters ?? {},
        cronExpression: body.data.cronExpression,
        recipients: body.data.recipients,
        createdBy: userId,
      })
      .returning();
    return reply.code(201).send({ data: created });
  });

  fastify.put<{ Params: { id: string } }>(
    '/export-schedules/:id',
    { preHandler: authenticate },
    async (request, reply) => {
      if (!hasPermission(request, PERMISSIONS.EXPORT_GENERATE)) {
        return reply.code(403).send({
          error: { code: 'PERMISSION_DENIED', message: 'Missing permission: EXPORT_GENERATE' },
        });
      }
      const { tenantId } = (request as unknown as AuthedRequest).auth;
      const id = parseInt(request.params.id, 10);
      const body = ExportScheduleUpdateSchema.safeParse(request.body);
      if (!body.success)
        throw new ValidationError(body.error.errors.map((e) => e.message).join('; '));

      const [updated] = await db
        .update(exportSchedules)
        .set({
          ...(body.data.cronExpression !== undefined
            ? { cronExpression: body.data.cronExpression }
            : {}),
          ...(body.data.recipients !== undefined ? { recipients: body.data.recipients } : {}),
          ...(body.data.active !== undefined ? { active: body.data.active ? 1 : 0 } : {}),
          updatedAt: new Date(),
        })
        .where(and(eq(exportSchedules.id, id), eq(exportSchedules.tenantId, tenantId)))
        .returning();
      if (!updated) throw new NotFoundError('ExportSchedule', id);
      return reply.code(200).send({ data: updated });
    }
  );

  fastify.delete<{ Params: { id: string } }>(
    '/export-schedules/:id',
    { preHandler: authenticate },
    async (request, reply) => {
      if (!hasPermission(request, PERMISSIONS.EXPORT_GENERATE)) {
        return reply.code(403).send({
          error: { code: 'PERMISSION_DENIED', message: 'Missing permission: EXPORT_GENERATE' },
        });
      }
      const { tenantId } = (request as unknown as AuthedRequest).auth;
      const id = parseInt(request.params.id, 10);
      const [updated] = await db
        .update(exportSchedules)
        .set({ active: 0, updatedAt: new Date() })
        .where(and(eq(exportSchedules.id, id), eq(exportSchedules.tenantId, tenantId)))
        .returning({ id: exportSchedules.id });
      if (!updated) throw new NotFoundError('ExportSchedule', id);
      return reply.code(200).send({ data: { message: 'Export schedule deactivated' } });
    }
  );

  fastify.get<{ Params: { id: string } }>(
    '/export-schedules/:id/history',
    { preHandler: authenticate },
    async (request, reply) => {
      if (!hasPermission(request, PERMISSIONS.EXPORT_VIEW)) {
        return reply.code(403).send({
          error: { code: 'PERMISSION_DENIED', message: 'Missing permission: EXPORT_VIEW' },
        });
      }
      const { tenantId } = (request as unknown as AuthedRequest).auth;
      const id = parseInt(request.params.id, 10);
      const rows = await db
        .select()
        .from(exportRunHistory)
        .where(and(eq(exportRunHistory.scheduleId, id), eq(exportRunHistory.tenantId, tenantId)))
        .orderBy(desc(exportRunHistory.createdAt))
        .limit(50);
      return reply.code(200).send({ data: { content: rows, totalElements: rows.length } });
    }
  );
}
