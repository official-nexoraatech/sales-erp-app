import type { FastifyInstance } from 'fastify';
import type { PlatformContextFactory } from '@erp/sdk';
import { invoices, quotations, payments } from '@erp/db';
import { and, count, eq, gt, gte, lt, notInArray, sql } from 'drizzle-orm';
import { PERMISSIONS } from '@erp/types';
import { authenticate } from '../middleware/authenticate.js';
import { requirePermission } from '../middleware/authorize.js';

export async function dashboardRoutes(
  fastify: FastifyInstance,
  ctxFactory: PlatformContextFactory
): Promise<void> {
  fastify.addHook('preHandler', authenticate);

  fastify.get('/dashboard/sales-summary', {
    preHandler: requirePermission(PERMISSIONS.INVOICE_VIEW),
    handler: async (req, reply) => {
      const ctx = ctxFactory.create({
        tenantId: req.auth.tenantId,
        userId: req.auth.userId,
        correlationId:
          (req.headers['x-correlation-id'] as string | undefined) ?? crypto.randomUUID(),
      });
      const tenantId = req.auth.tenantId;
      const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);

      const [pendingQuotations] = await ctx.db.raw
        .select({ count: count() })
        .from(quotations)
        .where(
          and(
            eq(quotations.tenantId, tenantId),
            eq(quotations.status, 'SENT'),
            lt(quotations.createdAt, threeDaysAgo)
          )
        );

      // Computed live from due_date/balance rather than the `status = 'OVERDUE'` column —
      // that status is only flipped by a nightly batch job (scheduler-service's
      // sales.overdue-invoice-update, cron '0 1 * * *'), so it can lag up to 24h behind an
      // invoice actually crossing its due date. Matches report-service's /dashboard/alerts
      // overdue-receivables query so the two dashboard widgets stop disagreeing (found in
      // live QA 2026-07-17: "0 overdue" here, "1 overdue" there, same tenant, same load).
      const [overdueInvoices] = await ctx.db.raw
        .select({ count: count() })
        .from(invoices)
        .where(
          and(
            eq(invoices.tenantId, tenantId),
            lt(invoices.dueDate, todayStart),
            gt(invoices.balanceDue, '0'),
            notInArray(invoices.status, ['CANCELLED', 'PAID'])
          )
        );

      const [collectedToday] = await ctx.db.raw
        .select({ total: sql<string>`COALESCE(SUM(amount), 0)` })
        .from(payments)
        .where(and(eq(payments.tenantId, tenantId), gte(payments.paymentDate, todayStart)));

      return reply.send({
        data: {
          pendingQuotations: pendingQuotations?.count ?? 0,
          overdueInvoices: overdueInvoices?.count ?? 0,
          collectedToday: parseFloat(collectedToday?.total ?? '0'),
        },
      });
    },
  });
}
