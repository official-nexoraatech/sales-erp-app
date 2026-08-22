import type { FastifyInstance } from 'fastify';
import type { ErpDatabase } from '@erp/db';
import { tenants, usageSummary } from '@erp/db';
import { eq, and, desc } from 'drizzle-orm';
import { NotFoundError, ValidationError, PERMISSIONS } from '@erp/types';
import { withTenantConnection } from '@erp/sdk';
import { authenticate } from '../middleware/authenticate.js';
import { requirePermission } from '../middleware/authorize.js';
import { UsagePeriodQuerySchema } from './tenant.schemas.js';

const PLATFORM_ADMIN: [typeof authenticate, ReturnType<typeof requirePermission>] = [
  authenticate,
  requirePermission(PERMISSIONS.PLATFORM_TENANT_MANAGE),
];

function currentPeriod(): string {
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
}

// PG-028: usage_summary is the only table these routes read from — it's the pre-aggregated
// rollup, never the raw usage_events table (see Performance section of the gap-prompt).
//
// Phase 9 GUC-per-request rollout — migrated 2026-08-21. GET /admin/tenants/:id/usage is a
// platform-admin lookup of a SPECIFIC tenant (the tenantId comes from the :id param, not the
// caller's own req.auth.tenantId — a platform admin's JWT tenantId is irrelevant here), so it
// uses withTenantConnection(db, id, ...) directly, same shape as caveat 5b. GET
// /admin/tenants/usage-overview is deliberately left unmigrated — its own comment already
// documents it as "the one legitimate all-tenants query," a genuine cross-tenant read
// (caveat 4e), not fixable with a single tenantId.
export async function usageRoutes(fastify: FastifyInstance, db: ErpDatabase): Promise<void> {
  // ── GET /admin/tenants/:id/usage?period=YYYY-MM ─────────────────────────
  fastify.get<{ Params: { id: string }; Querystring: { period?: string } }>(
    '/admin/tenants/:id/usage',
    { preHandler: PLATFORM_ADMIN },
    async (request, reply) => {
      const id = parseInt(request.params.id, 10);
      const parsedQuery = UsagePeriodQuerySchema.safeParse(request.query);
      if (!parsedQuery.success) {
        throw new ValidationError('Invalid period — expected YYYY-MM');
      }
      const period = parsedQuery.data.period ?? currentPeriod();
      const periodStart = `${period}-01`;

      const data = await withTenantConnection(db, id, async (scopedDb) => {
        const [tenant] = await scopedDb.select().from(tenants).where(eq(tenants.id, id));
        if (!tenant) throw new NotFoundError('Tenant', id);

        const [summary] = await scopedDb
          .select()
          .from(usageSummary)
          .where(and(eq(usageSummary.tenantId, id), eq(usageSummary.periodStart, periodStart)));

        return {
          period,
          invoiceCount: summary?.invoiceCount ?? 0,
          activeUserCount: summary?.activeUserCount ?? 0,
          storageBytes: summary?.storageBytes ?? 0,
          apiCallCount: summary?.apiCallCount ?? 0,
          entitlements: {
            maxUsers: tenant.settings?.maxUsers ?? null,
            maxBranches: tenant.settings?.maxBranches ?? null,
          },
        };
      });

      return reply.code(200).send({ data });
    }
  );

  // ── GET /admin/tenants/usage-overview?period=YYYY-MM ────────────────────
  // Cross-tenant read — the one legitimate all-tenants query in this package, matching
  // GET /admin/tenants' own no-tenant-filter pattern for the same platform-operator-only reason.
  fastify.get<{ Querystring: { period?: string } }>(
    '/admin/tenants/usage-overview',
    { preHandler: PLATFORM_ADMIN },
    async (request, reply) => {
      const parsedQuery = UsagePeriodQuerySchema.safeParse(request.query);
      if (!parsedQuery.success) {
        throw new ValidationError('Invalid period — expected YYYY-MM');
      }
      const period = parsedQuery.data.period ?? currentPeriod();
      const periodStart = `${period}-01`;

      const allTenants = await db.select({ id: tenants.id, name: tenants.name }).from(tenants);
      const summaries = await db
        .select()
        .from(usageSummary)
        .where(eq(usageSummary.periodStart, periodStart))
        .orderBy(desc(usageSummary.tenantId));

      const summaryByTenant = new Map(summaries.map((s) => [s.tenantId, s]));

      const content = allTenants.map((t) => {
        const s = summaryByTenant.get(t.id);
        return {
          tenantId: t.id,
          tenantName: t.name,
          invoiceCount: s?.invoiceCount ?? 0,
          activeUserCount: s?.activeUserCount ?? 0,
          storageBytes: s?.storageBytes ?? 0,
          apiCallCount: s?.apiCallCount ?? 0,
        };
      });

      return reply.code(200).send({ data: { content } });
    }
  );
}
