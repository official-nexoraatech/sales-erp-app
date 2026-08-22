import type { FastifyInstance } from 'fastify';
import type { PlatformContextFactory } from '@erp/sdk';
import { tenantScopedHandler } from '@erp/sdk';
import { z } from 'zod';
import { ValidationError } from '@erp/types';
import { PERMISSIONS } from '@erp/types';
import { authenticate } from '../middleware/authenticate.js';
import { requirePermission } from '../middleware/authorize.js';
import { FinancialYearService } from '../domain/FinancialYearService.js';

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

// Phase 9 GUC-per-request rollout — migrated 2026-08-21 (all routes). /close and /lock-period
// both call ctx.audit.log() after FinancialYearService.closeYear()/lockPeriod() — proven safe to
// migrate anyway (not left unmigrated): once wrapped in tenantScopedHandler, closeYear()'s own
// internal db.transaction() becomes a savepoint of the outer transaction rather than an
// independent commit, so the audit log write and the real operation now succeed or fail
// together automatically — see tenantConnection-nested-rollback.test.ts (platform-sdk) and
// 23-guc-per-request-rollout-checklist.md's "post-hoc audit log" caveat for the proof.
export async function financialYearRoutes(
  fastify: FastifyInstance,
  ctxFactory: PlatformContextFactory
): Promise<void> {
  // ── GET /financial-years ──────────────────────────────────────────────────
  fastify.get(
    '/financial-years',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.FINANCIAL_YEAR_VIEW)] },
    tenantScopedHandler(ctxFactory, async (_request, reply, ctx) => {
      const years = await FinancialYearService.list(ctx.db, ctx.tenant.tenantId);
      return reply.code(200).send({ data: { content: years, totalElements: years.length } });
    })
  );

  // ── POST /financial-years ─────────────────────────────────────────────────
  fastify.post(
    '/financial-years',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.FINANCIAL_YEAR_OPEN)] },
    tenantScopedHandler(ctxFactory, async (request, reply, ctx) => {
      const body = CreateFYSchema.safeParse(request.body);
      if (!body.success)
        throw new ValidationError(body.error.errors.map((e) => e.message).join('; '));

      const fy = await FinancialYearService.create(
        ctx.db,
        ctx.tenant.tenantId,
        ctx.tenant.userId,
        body.data
      );
      return reply.code(201).send({ data: fy });
    })
  );

  // ── GET /financial-years/:id/close-checklist ──────────────────────────────
  fastify.get<{ Params: { id: string } }>(
    '/financial-years/:id/close-checklist',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.FINANCIAL_YEAR_CLOSE)] },
    tenantScopedHandler(ctxFactory, async (request, reply, ctx) => {
      const { id } = request.params as { id: string };
      const fyId = parseInt(id, 10);
      const checklist = await FinancialYearService.runCloseChecklist(
        ctx.db,
        ctx.tenant.tenantId,
        fyId
      );
      return reply.code(200).send({ data: checklist });
    })
  );

  // ── POST /financial-years/:id/close ──────────────────────────────────────
  fastify.post<{ Params: { id: string } }>(
    '/financial-years/:id/close',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.FINANCIAL_YEAR_CLOSE)] },
    tenantScopedHandler(ctxFactory, async (request, reply, ctx) => {
      const { id } = request.params as { id: string };
      const fyId = parseInt(id, 10);

      await FinancialYearService.closeYear(ctx.db, ctx.tenant.tenantId, ctx.tenant.userId, fyId);

      await ctx.audit.log({
        action: 'UPDATE',
        entityType: 'financial_year',
        entityId: fyId,
        metadata: { action: 'CLOSE_YEAR' },
      });

      return reply.code(200).send({ data: { message: 'Financial year closed successfully' } });
    })
  );

  // ── POST /financial-years/:id/lock-period ─────────────────────────────────
  fastify.post<{ Params: { id: string } }>(
    '/financial-years/:id/lock-period',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.FINANCIAL_YEAR_CLOSE)] },
    tenantScopedHandler(ctxFactory, async (request, reply, ctx) => {
      const { id } = request.params as { id: string };
      const fyId = parseInt(id, 10);

      const body = LockPeriodSchema.safeParse(request.body);
      if (!body.success)
        throw new ValidationError(body.error.errors.map((e) => e.message).join('; '));

      await FinancialYearService.lockPeriod(
        ctx.db,
        ctx.tenant.tenantId,
        ctx.tenant.userId,
        fyId,
        body.data.periodMonth,
        body.data.periodYear
      );

      await ctx.audit.log({
        action: 'UPDATE',
        entityType: 'financial_year',
        entityId: fyId,
        metadata: { action: 'LOCK_PERIOD', ...body.data },
      });

      return reply.code(200).send({
        data: { message: `Period ${body.data.periodMonth}/${body.data.periodYear} locked` },
      });
    })
  );
}
