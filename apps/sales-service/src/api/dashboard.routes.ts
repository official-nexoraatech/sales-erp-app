import type { FastifyInstance } from 'fastify';
import type { PlatformContextFactory } from '@erp/sdk';
import { invoices, quotations, payments } from '@erp/db';
import { and, count, eq, gte, lt, sql } from 'drizzle-orm';
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
        correlationId: (req.headers['x-correlation-id'] as string | undefined) ?? crypto.randomUUID(),
      });
      const tenantId = req.auth.tenantId;
      const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);

      const [pendingQuotations] = await ctx.db.raw
        .select({ count: count() })
        .from(quotations)
        .where(and(
          eq(quotations.tenantId, tenantId),
          eq(quotations.status, 'SENT'),
          lt(quotations.createdAt, threeDaysAgo)
        ));

      const [overdueInvoices] = await ctx.db.raw
        .select({ count: count() })
        .from(invoices)
        .where(and(
          eq(invoices.tenantId, tenantId),
          eq(invoices.status, 'OVERDUE')
        ));

      const [collectedToday] = await ctx.db.raw
        .select({ total: sql<string>`COALESCE(SUM(amount), 0)` })
        .from(payments)
        .where(and(
          eq(payments.tenantId, tenantId),
          gte(payments.paymentDate, todayStart)
        ));

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
