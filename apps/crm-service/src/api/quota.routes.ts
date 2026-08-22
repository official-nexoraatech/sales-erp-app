import type { FastifyInstance } from 'fastify';
import type { PlatformContextFactory } from '@erp/sdk';
import {
  tenantScopedHandler,
  omitFieldsFromListWithoutPermission,
  omitFieldsWithoutPermission,
} from '@erp/sdk';
import { z } from 'zod';
import { ValidationError } from '@erp/types';
import { PERMISSIONS } from '@erp/types';
import { authenticate } from '../middleware/authenticate.js';
import { requirePermission } from '../middleware/authorize.js';
import { QuotaService } from '../domain/QuotaService.js';

// CRM-ROADMAP Phase 4, Feature 5 — Sales Forecasting & Quota Management. QUOTA_MANAGE gates
// every CRUD route here (Sales Ops admin configuration, same single-permission precedent as
// territory.routes.ts). QUOTA_VALUE_VIEW additionally gates the $ amount/attainment fields
// within GET /quotas and GET /quotas/attainment specifically — a caller who can list which
// quotas exist (QUOTA_MANAGE) does not automatically see the commercially sensitive figures
// (same layering as OPPORTUNITY_VIEW vs OPPORTUNITY_VALUE_VIEW).
//
// Phase 9 GUC-per-request rollout — migrated 2026-08-21. No external I/O — QuotaService has no
// fetch() calls. Post-hoc ctx.audit.log() calls are safe per caveat 4b.

const QuotaCreateSchema = z.object({
  subjectType: z.enum(['REP', 'TERRITORY']),
  subjectUserId: z.number().int().positive().optional(),
  subjectTerritoryId: z.number().int().positive().optional(),
  periodYear: z.number().int().min(2000).max(2100),
  periodMonth: z.number().int().min(1).max(12),
  quotaAmount: z.number().min(0),
});

const QuotaUpdateSchema = z.object({
  quotaAmount: z.number().min(0),
  version: z.number().int().min(0),
});

const QUOTA_VALUE_FIELDS = ['quotaAmount', 'actualAmount', 'attainmentPct'] as const;

export async function quotaRoutes(
  fastify: FastifyInstance,
  ctxFactory: PlatformContextFactory
): Promise<void> {
  fastify.get(
    '/quotas',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.QUOTA_MANAGE)] },
    tenantScopedHandler(ctxFactory, async (request, reply, ctx) => {
      const { permissions } = request.auth;
      const query = request.query as { periodYear?: string; periodMonth?: string };

      const rows = await QuotaService.list(ctx.db.raw, ctx.tenant.tenantId, {
        periodYear: query.periodYear ? parseInt(query.periodYear, 10) : undefined,
        periodMonth: query.periodMonth ? parseInt(query.periodMonth, 10) : undefined,
      });

      const content = omitFieldsFromListWithoutPermission(
        rows,
        ['quotaAmount'],
        permissions,
        PERMISSIONS.QUOTA_VALUE_VIEW
      );
      return reply.code(200).send({ data: { content, totalElements: content.length } });
    })
  );

  fastify.post(
    '/quotas',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.QUOTA_MANAGE)] },
    tenantScopedHandler(ctxFactory, async (request, reply, ctx) => {
      const body = QuotaCreateSchema.safeParse(request.body);
      if (!body.success)
        throw new ValidationError(body.error.errors.map((e) => e.message).join('; '));
      if (body.data.subjectType === 'REP' && !body.data.subjectUserId) {
        throw new ValidationError('subjectUserId is required when subjectType is REP');
      }
      if (body.data.subjectType === 'TERRITORY' && !body.data.subjectTerritoryId) {
        throw new ValidationError('subjectTerritoryId is required when subjectType is TERRITORY');
      }

      const created = await QuotaService.create(
        ctx.db.raw,
        ctx.tenant.tenantId,
        ctx.tenant.userId,
        body.data
      );

      await ctx.audit.log({
        action: 'CREATE',
        entityType: 'crm_sales_quota',
        entityId: created.id,
        after: created as unknown as Record<string, unknown>,
      });
      return reply.code(201).send({ data: created });
    })
  );

  fastify.put(
    '/quotas/:id',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.QUOTA_MANAGE)] },
    tenantScopedHandler(ctxFactory, async (request, reply, ctx) => {
      const { id: idParam } = request.params as { id: string };
      const id = parseInt(idParam, 10);

      const body = QuotaUpdateSchema.safeParse(request.body);
      if (!body.success)
        throw new ValidationError(body.error.errors.map((e) => e.message).join('; '));

      const updated = await QuotaService.update(ctx.db.raw, ctx.tenant.tenantId, id, body.data);

      await ctx.audit.log({
        action: 'UPDATE',
        entityType: 'crm_sales_quota',
        entityId: id,
        after: updated as unknown as Record<string, unknown>,
      });
      return reply.code(200).send({ data: updated });
    })
  );

  fastify.get(
    '/quotas/attainment',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.QUOTA_MANAGE)] },
    tenantScopedHandler(ctxFactory, async (request, reply, ctx) => {
      const { permissions } = request.auth;
      const query = request.query as { periodYear?: string; periodMonth?: string };
      const periodYear = query.periodYear
        ? parseInt(query.periodYear, 10)
        : new Date().getUTCFullYear();
      const periodMonth = query.periodMonth
        ? parseInt(query.periodMonth, 10)
        : new Date().getUTCMonth() + 1;

      const result = await QuotaService.getAttainment(
        ctx.db.raw,
        ctx.tenant.tenantId,
        periodYear,
        periodMonth
      );

      // The computed attainment/actual figures carry the same sensitivity as the raw quota
      // amount they're derived from — same "a derived aggregate can leak the same information
      // as the field it's computed from" reasoning as GET /opportunities/forecast.
      const rows = omitFieldsFromListWithoutPermission(
        result.rows,
        [...QUOTA_VALUE_FIELDS],
        permissions,
        PERMISSIONS.QUOTA_VALUE_VIEW
      );
      const totals = omitFieldsWithoutPermission(
        {
          totalQuota: result.totalQuota,
          totalActual: result.totalActual,
          totalAttainmentPct: result.totalAttainmentPct,
        },
        ['totalQuota', 'totalActual', 'totalAttainmentPct'],
        permissions,
        PERMISSIONS.QUOTA_VALUE_VIEW
      );

      return reply.code(200).send({
        data: { periodYear: result.periodYear, periodMonth: result.periodMonth, rows, ...totals },
      });
    })
  );
}
