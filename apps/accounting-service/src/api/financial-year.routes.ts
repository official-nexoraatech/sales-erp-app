import type { FastifyInstance } from 'fastify';
import type { PlatformContextFactory } from '@erp/sdk';
import { z } from 'zod';
import { ValidationError } from '@erp/types';
import { PERMISSIONS } from '@erp/types';
import { authenticate } from '../middleware/authenticate.js';
import { requirePermission } from '../middleware/authorize.js';
import { FinancialYearService } from '../domain/FinancialYearService.js';

type AuthedRequest = { auth: { tenantId: number; userId: number } };

const CreateFYSchema = z.object({
  yearCode: z.string().min(4).max(20),
  startDate: z.string().length(10),
  endDate: z.string().length(10),
  isCurrent: z.boolean().default(false),
});

const LockPeriodSchema = z.object({
  periodMonth: z.number().int().min(1).max(12),
  periodYear: z.number().int().min(2000).max(2100),
});

export async function financialYearRoutes(
  fastify: FastifyInstance,
  ctxFactory: PlatformContextFactory
): Promise<void> {
  // ── GET /financial-years ──────────────────────────────────────────────────
  fastify.get(
    '/financial-years',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.FINANCIAL_YEAR_VIEW)] },
    async (request, reply) => {
      const { tenantId, userId } = (request as unknown as AuthedRequest).auth;
      const ctx = ctxFactory.create({ tenantId, userId, correlationId: (request.headers['x-correlation-id'] as string) ?? crypto.randomUUID() });
      const years = await FinancialYearService.list(ctx.db, tenantId);
      return reply.code(200).send({ data: { content: years, totalElements: years.length } });
    }
  );

  // ── POST /financial-years ─────────────────────────────────────────────────
  fastify.post(
    '/financial-years',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.FINANCIAL_YEAR_OPEN)] },
    async (request, reply) => {
      const { tenantId, userId } = (request as unknown as AuthedRequest).auth;
      const ctx = ctxFactory.create({ tenantId, userId, correlationId: (request.headers['x-correlation-id'] as string) ?? crypto.randomUUID() });

      const body = CreateFYSchema.safeParse(request.body);
      if (!body.success) throw new ValidationError(body.error.errors.map((e) => e.message).join('; '));

      const fy = await FinancialYearService.create(ctx.db, tenantId, userId, body.data);
      return reply.code(201).send({ data: fy });
    }
  );

  // ── GET /financial-years/:id/close-checklist ──────────────────────────────
  fastify.get<{ Params: { id: string } }>(
    '/financial-years/:id/close-checklist',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.FINANCIAL_YEAR_CLOSE)] },
    async (request, reply) => {
      const { tenantId, userId } = (request as unknown as AuthedRequest).auth;
      const ctx = ctxFactory.create({ tenantId, userId, correlationId: (request.headers['x-correlation-id'] as string) ?? crypto.randomUUID() });
      const fyId = parseInt(request.params.id, 10);

      const checklist = await FinancialYearService.runCloseChecklist(ctx.db, tenantId, fyId);
      return reply.code(200).send({ data: checklist });
    }
  );

  // ── POST /financial-years/:id/close ──────────────────────────────────────
  fastify.post<{ Params: { id: string } }>(
    '/financial-years/:id/close',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.FINANCIAL_YEAR_CLOSE)] },
    async (request, reply) => {
      const { tenantId, userId } = (request as unknown as AuthedRequest).auth;
      const ctx = ctxFactory.create({ tenantId, userId, correlationId: (request.headers['x-correlation-id'] as string) ?? crypto.randomUUID() });
      const fyId = parseInt(request.params.id, 10);

      await FinancialYearService.closeYear(ctx.db, tenantId, userId, fyId);

      await ctx.audit.log({
        action: 'UPDATE',
        entityType: 'financial_year',
        entityId: fyId,
        metadata: { action: 'CLOSE_YEAR' },
      });

      return reply.code(200).send({ data: { message: 'Financial year closed successfully' } });
    }
  );

  // ── POST /financial-years/:id/lock-period ─────────────────────────────────
  fastify.post<{ Params: { id: string } }>(
    '/financial-years/:id/lock-period',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.FINANCIAL_YEAR_CLOSE)] },
    async (request, reply) => {
      const { tenantId, userId } = (request as unknown as AuthedRequest).auth;
      const ctx = ctxFactory.create({ tenantId, userId, correlationId: (request.headers['x-correlation-id'] as string) ?? crypto.randomUUID() });
      const fyId = parseInt(request.params.id, 10);

      const body = LockPeriodSchema.safeParse(request.body);
      if (!body.success) throw new ValidationError(body.error.errors.map((e) => e.message).join('; '));

      await FinancialYearService.lockPeriod(ctx.db, tenantId, userId, fyId, body.data.periodMonth, body.data.periodYear);

      await ctx.audit.log({
        action: 'UPDATE',
        entityType: 'financial_year',
        entityId: fyId,
        metadata: { action: 'LOCK_PERIOD', ...body.data },
      });

      return reply.code(200).send({
        data: { message: `Period ${body.data.periodMonth}/${body.data.periodYear} locked` },
      });
    }
  );
}
