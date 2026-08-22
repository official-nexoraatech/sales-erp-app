import type { FastifyInstance } from 'fastify';
import type { PlatformContextFactory } from '@erp/sdk';
import { getBranchScope, tenantScopedHandler } from '@erp/sdk';
import { purchaseOrders, grns, projectionSupplierBalance, suppliers } from '@erp/db';
import { and, eq, gte, inArray, sql } from 'drizzle-orm';
import { PERMISSIONS } from '@erp/types';
import { authenticate } from '../middleware/authenticate.js';
import { requirePermission } from '../middleware/authorize.js';

// Purchase audit 2026-07-21 gap-fix: no purpose-built purchase KPI dashboard existed anywhere
// (only the pull-style PurchaseAnalytics report page) — this is a single lightweight
// aggregation endpoint for a live "at a glance" dashboard, not a new reporting subsystem.
// Phase 9 GUC-per-request rollout — migrated 2026-08-21. No external I/O.
export async function dashboardRoutes(
  fastify: FastifyInstance,
  ctxFactory: PlatformContextFactory
): Promise<void> {
  fastify.addHook('preHandler', authenticate);

  fastify.get('/purchase-orders-dashboard-summary', {
    preHandler: requirePermission(PERMISSIONS.PO_VIEW),
    handler: tenantScopedHandler(ctxFactory, async (req, reply, ctx) => {
      const tenantId = ctx.tenant.tenantId;
      const branchScope = getBranchScope(req.auth);
      const branchCondition =
        branchScope === 'all' ? undefined : inArray(purchaseOrders.branchId, branchScope);

      const startOfMonth = new Date();
      startOfMonth.setDate(1);
      startOfMonth.setHours(0, 0, 0, 0);

      const [pendingPO] = await ctx.db.raw
        .select({
          count: sql<number>`count(*)::int`,
          value: sql<string>`coalesce(sum(${purchaseOrders.grandTotal}), 0)`,
        })
        .from(purchaseOrders)
        .where(
          and(
            eq(purchaseOrders.tenantId, tenantId),
            sql`${purchaseOrders.status} IN ('DRAFT', 'SUBMITTED', 'PENDING_APPROVAL')`,
            branchCondition
          )
        );

      const [pendingGRN] = await ctx.db.raw
        .select({ count: sql<number>`count(*)::int` })
        .from(grns)
        .where(
          and(
            eq(grns.tenantId, tenantId),
            sql`${grns.status} IN ('DRAFT', 'PENDING_APPROVAL')`,
            branchScope === 'all' ? undefined : inArray(grns.branchId, branchScope)
          )
        );

      const [monthPurchases] = await ctx.db.raw
        .select({ total: sql<string>`coalesce(sum(${purchaseOrders.grandTotal}), 0)` })
        .from(purchaseOrders)
        .where(
          and(
            eq(purchaseOrders.tenantId, tenantId),
            gte(purchaseOrders.poDate, startOfMonth),
            sql`${purchaseOrders.status} NOT IN ('DRAFT', 'CANCELLED')`,
            branchCondition
          )
        );

      const [outstanding] = await ctx.db.raw
        .select({
          total: sql<string>`coalesce(sum(${projectionSupplierBalance.currentBalance}), 0)`,
        })
        .from(projectionSupplierBalance)
        .where(eq(projectionSupplierBalance.tenantId, tenantId));

      const topSuppliers = await ctx.db.raw
        .select({
          supplierId: purchaseOrders.supplierId,
          supplierName: suppliers.displayName,
          total: sql<string>`sum(${purchaseOrders.grandTotal})`,
        })
        .from(purchaseOrders)
        .leftJoin(suppliers, eq(purchaseOrders.supplierId, suppliers.id))
        .where(
          and(
            eq(purchaseOrders.tenantId, tenantId),
            sql`${purchaseOrders.status} NOT IN ('DRAFT', 'CANCELLED')`,
            branchCondition
          )
        )
        .groupBy(purchaseOrders.supplierId, suppliers.displayName)
        .orderBy(sql`sum(${purchaseOrders.grandTotal}) DESC`)
        .limit(5);

      return reply.send({
        data: {
          pendingPOCount: pendingPO?.count ?? 0,
          pendingPOValue: pendingPO?.value ?? '0',
          pendingGRNCount: pendingGRN?.count ?? 0,
          thisMonthPurchaseTotal: monthPurchases?.total ?? '0',
          supplierOutstanding: outstanding?.total ?? '0',
          topSuppliers,
        },
      });
    }),
  });
}
