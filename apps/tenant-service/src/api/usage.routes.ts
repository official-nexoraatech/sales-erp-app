import type { FastifyInstance } from 'fastify';
import type { ErpDatabase } from '@erp/db';
import { tenants, usageSummary } from '@erp/db';
import { eq, and, desc } from 'drizzle-orm';
import { NotFoundError, PERMISSIONS } from '@erp/types';
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
export async function usageRoutes(fastify: FastifyInstance, db: ErpDatabase): Promise<void> {
  // ── GET /admin/tenants/:id/usage?period=YYYY-MM ─────────────────────────
  fastify.get<{ Params: { id: string }; Querystring: { period?: string } }>(
    '/admin/tenants/:id/usage',
    { preHandler: PLATFORM_ADMIN },
    async (request, reply) => {
      const id = parseInt(request.params.id, 10);
      const parsedQuery = UsagePeriodQuerySchema.safeParse(request.query);
      if (!parsedQuery.success) {
        return reply.code(400).send({ error: { code: 'VALIDATION_ERROR', message: 'Invalid period — expected YYYY-MM' } });
      }
      const period = parsedQuery.data.period ?? currentPeriod();

      const [tenant] = await db.select().from(tenants).where(eq(tenants.id, id));
      if (!tenant) throw new NotFoundError('Tenant', id);

      const periodStart = `${period}-01`;
      const [summary] = await db
        .select()
        .from(usageSummary)
        .where(and(eq(usageSummary.tenantId, id), eq(usageSummary.periodStart, periodStart)));

      return reply.code(200).send({
        data: {
          period,
          invoiceCount: summary?.invoiceCount ?? 0,
          activeUserCount: summary?.activeUserCount ?? 0,
          storageBytes: summary?.storageBytes ?? 0,
          apiCallCount: summary?.apiCallCount ?? 0,
          entitlements: {
            maxUsers: tenant.settings?.maxUsers ?? null,
            maxBranches: tenant.settings?.maxBranches ?? null,
          },
        },
      });
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
        return reply.code(400).send({ error: { code: 'VALIDATION_ERROR', message: 'Invalid period — expected YYYY-MM' } });
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
