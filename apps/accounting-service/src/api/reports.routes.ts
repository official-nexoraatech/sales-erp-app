/* global crypto, process, fetch, Buffer */
import type { FastifyInstance } from 'fastify';
import type { PlatformContextFactory } from '@erp/sdk';
import { organizationSettings } from '@erp/db';
import { eq } from 'drizzle-orm';
import { ValidationError, BusinessError } from '@erp/types';
import { PERMISSIONS } from '@erp/types';
import { authenticate } from '../middleware/authenticate.js';
import { requirePermission } from '../middleware/authorize.js';
import { ReportsEngine } from '../domain/ReportsEngine.js';

type AuthedRequest = { auth: { tenantId: number; userId: number } };

export async function reportsRoutes(
  fastify: FastifyInstance,
  ctxFactory: PlatformContextFactory
): Promise<void> {
  // ── GET /reports/trial-balance ────────────────────────────────────────────
  fastify.get(
    '/reports/trial-balance',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.TRIAL_BALANCE_VIEW)] },
    async (request, reply) => {
      const { tenantId, userId } = (request as unknown as AuthedRequest).auth;
      const ctx = ctxFactory.create({ tenantId, userId, correlationId: (request.headers['x-correlation-id'] as string) ?? crypto.randomUUID() });
      const query = request.query as { asOfDate?: string };
      const asOfDate = query.asOfDate ?? new Date().toISOString().substring(0, 10);
      const data = await ReportsEngine.getTrialBalance(ctx.db, tenantId, asOfDate);
      return reply.code(200).send({ data });
    }
  );

  // ── GET /reports/profit-loss ──────────────────────────────────────────────
  fastify.get(
    '/reports/profit-loss',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.PROFIT_LOSS_VIEW)] },
    async (request, reply) => {
      const { tenantId, userId } = (request as unknown as AuthedRequest).auth;
      const ctx = ctxFactory.create({ tenantId, userId, correlationId: (request.headers['x-correlation-id'] as string) ?? crypto.randomUUID() });
      const query = request.query as { fromDate?: string; toDate?: string };

      if (!query.fromDate || !query.toDate) {
        throw new ValidationError('fromDate and toDate query parameters are required');
      }

      const data = await ReportsEngine.getProfitLoss(ctx.db, tenantId, query.fromDate, query.toDate);
      return reply.code(200).send({ data });
    }
  );

  // ── GET /reports/profit-loss/pdf ──────────────────────────────────────────
  fastify.get(
    '/reports/profit-loss/pdf',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.PROFIT_LOSS_VIEW)] },
    async (request, reply) => {
      const { tenantId, userId } = (request as unknown as AuthedRequest).auth;
      const ctx = ctxFactory.create({ tenantId, userId, correlationId: (request.headers['x-correlation-id'] as string) ?? crypto.randomUUID() });
      const query = request.query as { fromDate?: string; toDate?: string };

      if (!query.fromDate || !query.toDate) {
        throw new ValidationError('fromDate and toDate query parameters are required');
      }

      const report = await ReportsEngine.getProfitLoss(ctx.db, tenantId, query.fromDate, query.toDate);
      const [org] = await ctx.db.raw.select().from(organizationSettings).where(eq(organizationSettings.tenantId, tenantId));

      const reportUrl = process.env['REPORT_SERVICE_URL'] ?? 'http://localhost:3015';
      const internalKey = process.env['INTERNAL_API_KEY'] ?? '';
      const res = await fetch(`${reportUrl}/reports/pdf`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-internal-key': internalKey },
        body: JSON.stringify({ documentType: 'PROFIT_LOSS', data: { ...report, org: { name: org?.orgName } } }),
      });
      if (!res.ok) throw new BusinessError('PDF_GENERATION_FAILED', 'Failed to generate P&L PDF');
      const buffer = Buffer.from(await res.arrayBuffer());

      return reply
        .code(200)
        .header('Content-Type', 'application/pdf')
        .header('Content-Disposition', `inline; filename="profit-loss-${query.fromDate}-to-${query.toDate}.pdf"`)
        .send(buffer);
    }
  );

  // ── GET /reports/balance-sheet ────────────────────────────────────────────
  fastify.get(
    '/reports/balance-sheet',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.BALANCE_SHEET_VIEW)] },
    async (request, reply) => {
      const { tenantId, userId } = (request as unknown as AuthedRequest).auth;
      const ctx = ctxFactory.create({ tenantId, userId, correlationId: (request.headers['x-correlation-id'] as string) ?? crypto.randomUUID() });
      const query = request.query as { asOfDate?: string };
      const asOfDate = query.asOfDate ?? new Date().toISOString().substring(0, 10);
      const data = await ReportsEngine.getBalanceSheet(ctx.db, tenantId, asOfDate);
      return reply.code(200).send({ data });
    }
  );

  // ── GET /reports/cash-flow ────────────────────────────────────────────────
  fastify.get(
    '/reports/cash-flow',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.CASH_FLOW_VIEW)] },
    async (request, reply) => {
      const { tenantId, userId } = (request as unknown as AuthedRequest).auth;
      const ctx = ctxFactory.create({ tenantId, userId, correlationId: (request.headers['x-correlation-id'] as string) ?? crypto.randomUUID() });
      const query = request.query as { fromDate?: string; toDate?: string };

      if (!query.fromDate || !query.toDate) {
        throw new ValidationError('fromDate and toDate query parameters are required');
      }

      const data = await ReportsEngine.getCashFlow(ctx.db, tenantId, query.fromDate, query.toDate);
      return reply.code(200).send({ data });
    }
  );
}
