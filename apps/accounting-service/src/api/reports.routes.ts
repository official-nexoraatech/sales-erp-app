/* global crypto, process, fetch, Buffer */
import type { FastifyInstance } from 'fastify';
import type { PlatformContextFactory } from '@erp/sdk';
import { tenantScopedHandler } from '@erp/sdk';
import { organizationSettings } from '@erp/db';
import { eq } from 'drizzle-orm';
import { ValidationError, BusinessError } from '@erp/types';
import { PERMISSIONS } from '@erp/types';
import { authenticate } from '../middleware/authenticate.js';
import { requirePermission } from '../middleware/authorize.js';
import { ReportsEngine } from '../domain/ReportsEngine.js';

type AuthedRequest = { auth: { tenantId: number; userId: number } };

// Phase 9 GUC-per-request rollout — migrated 2026-08-21 (all but one route). Every plain report
// query is safe (pure DB reads, no side effects). /reports/profit-loss/pdf is deliberately NOT
// migrated: it makes a real HTTP call to report-service's PDF engine (puppeteer-backed,
// potentially several seconds) — wrapping it would hold a transaction/connection open for that
// entire external call. See 23-guc-per-request-rollout-checklist.md's "external I/O mid-handler"
// caveat.
export async function reportsRoutes(
  fastify: FastifyInstance,
  ctxFactory: PlatformContextFactory
): Promise<void> {
  // ── GET /reports/trial-balance ────────────────────────────────────────────
  fastify.get(
    '/reports/trial-balance',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.TRIAL_BALANCE_VIEW)] },
    tenantScopedHandler(ctxFactory, async (request, reply, ctx) => {
      const query = request.query as { asOfDate?: string };
      const asOfDate = query.asOfDate ?? new Date().toISOString().substring(0, 10);
      const data = await ReportsEngine.getTrialBalance(ctx.db, ctx.tenant.tenantId, asOfDate);
      return reply.code(200).send({ data });
    })
  );

  // ── GET /reports/profit-loss ──────────────────────────────────────────────
  fastify.get(
    '/reports/profit-loss',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.PROFIT_LOSS_VIEW)] },
    tenantScopedHandler(ctxFactory, async (request, reply, ctx) => {
      const query = request.query as { fromDate?: string; toDate?: string };

      if (!query.fromDate || !query.toDate) {
        throw new ValidationError('fromDate and toDate query parameters are required');
      }

      const data = await ReportsEngine.getProfitLoss(
        ctx.db,
        ctx.tenant.tenantId,
        query.fromDate,
        query.toDate
      );
      return reply.code(200).send({ data });
    })
  );

  // ── GET /reports/profit-loss/pdf ──────────────────────────────────────────
  fastify.get(
    '/reports/profit-loss/pdf',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.PROFIT_LOSS_VIEW)] },
    async (request, reply) => {
      const { tenantId, userId } = (request as unknown as AuthedRequest).auth;
      const ctx = ctxFactory.create({
        tenantId,
        userId,
        correlationId: (request.headers['x-correlation-id'] as string) ?? crypto.randomUUID(),
      });
      const query = request.query as { fromDate?: string; toDate?: string };

      if (!query.fromDate || !query.toDate) {
        throw new ValidationError('fromDate and toDate query parameters are required');
      }

      const report = await ReportsEngine.getProfitLoss(
        ctx.db,
        tenantId,
        query.fromDate,
        query.toDate
      );
      const [org] = await ctx.db.raw
        .select()
        .from(organizationSettings)
        .where(eq(organizationSettings.tenantId, tenantId));

      const reportUrl = process.env['REPORT_SERVICE_URL'] ?? 'http://localhost:3015';
      const internalKey = process.env['INTERNAL_API_KEY'] ?? '';
      const res = await fetch(`${reportUrl}/reports/pdf`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-internal-key': internalKey },
        body: JSON.stringify({
          documentType: 'PROFIT_LOSS',
          data: { ...report, org: { name: org?.orgName } },
        }),
      });
      if (!res.ok) throw new BusinessError('PDF_GENERATION_FAILED', 'Failed to generate P&L PDF');
      const buffer = Buffer.from(await res.arrayBuffer());

      return reply
        .code(200)
        .header('Content-Type', 'application/pdf')
        .header(
          'Content-Disposition',
          `inline; filename="profit-loss-${query.fromDate}-to-${query.toDate}.pdf"`
        )
        .send(buffer);
    }
  );

  // ── GET /reports/pnl-by-cost-center — PG-037, additive alongside profit-loss ──
  fastify.get(
    '/reports/pnl-by-cost-center',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.PROFIT_LOSS_VIEW)] },
    tenantScopedHandler(ctxFactory, async (request, reply, ctx) => {
      const query = request.query as { fromDate?: string; toDate?: string; costCenterId?: string };

      if (!query.fromDate || !query.toDate) {
        throw new ValidationError('fromDate and toDate query parameters are required');
      }

      const costCenterId = query.costCenterId ? parseInt(query.costCenterId, 10) : undefined;
      const data = await ReportsEngine.getPnLByCostCenter(
        ctx.db,
        ctx.tenant.tenantId,
        query.fromDate,
        query.toDate,
        costCenterId
      );
      return reply.code(200).send({ data });
    })
  );

  // ── GET /reports/balance-sheet ────────────────────────────────────────────
  fastify.get(
    '/reports/balance-sheet',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.BALANCE_SHEET_VIEW)] },
    tenantScopedHandler(ctxFactory, async (request, reply, ctx) => {
      const query = request.query as { asOfDate?: string };
      const asOfDate = query.asOfDate ?? new Date().toISOString().substring(0, 10);
      const data = await ReportsEngine.getBalanceSheet(ctx.db, ctx.tenant.tenantId, asOfDate);
      return reply.code(200).send({ data });
    })
  );

  // ── GET /reports/cash-flow ────────────────────────────────────────────────
  fastify.get(
    '/reports/cash-flow',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.CASH_FLOW_VIEW)] },
    tenantScopedHandler(ctxFactory, async (request, reply, ctx) => {
      const query = request.query as { fromDate?: string; toDate?: string };

      if (!query.fromDate || !query.toDate) {
        throw new ValidationError('fromDate and toDate query parameters are required');
      }

      const data = await ReportsEngine.getCashFlow(
        ctx.db,
        ctx.tenant.tenantId,
        query.fromDate,
        query.toDate
      );
      return reply.code(200).send({ data });
    })
  );
}
