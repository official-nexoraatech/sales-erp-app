import type { FastifyInstance } from 'fastify';
import type { ErpDatabase } from '@erp/db';
import { tenants, tenantInvoices, users, branches } from '@erp/db';
import { and, count, eq } from 'drizzle-orm';
import { NotFoundError, ValidationError, BusinessError, PERMISSIONS } from '@erp/types';
import { withTenantConnection } from '@erp/sdk';
import { authenticate } from '../middleware/authenticate.js';
import { requirePermission } from '../middleware/authorize.js';
import { ChangePlanSchema } from './tenant.schemas.js';
import { BillingService } from '../domain/BillingService.js';
import { createConfiguredGatewayAdapter } from '../domain/RazorpayGatewayAdapter.js';

const PLATFORM_ADMIN: [typeof authenticate, ReturnType<typeof requirePermission>] = [
  authenticate,
  requirePermission(PERMISSIONS.PLATFORM_TENANT_MANAGE),
];

// PG-027 Session 3: platform-operator-facing billing admin routes — view a tenant's plan/
// entitlement usage, change plan, view invoice history, manually retry a failed payment. The
// automated daily cycle (billing-internal.routes.ts) is unaffected by anything here; this file
// only adds a human-operated surface on top of BillingService methods that already exist.
//
// Phase 9 GUC-per-request rollout — migrated 2026-08-21. The first 3 routes are single-tenant
// lookups by :id (tenantId comes from the URL param, not the caller's own req.auth.tenantId — a
// platform admin's JWT tenant is irrelevant here), migrated via withTenantConnection(db, id, ...)
// directly. retry-payment deliberately left unmigrated — chargeInvoice() makes a real Razorpay
// gateway call interleaved with DB reads/writes (caveat 4), same as billing-internal.routes.ts's
// cycle job.
export async function billingRoutes(fastify: FastifyInstance, db: ErpDatabase): Promise<void> {
  // ── GET /admin/tenants/:id/billing ──────────────────────────────────────
  fastify.get<{ Params: { id: string } }>(
    '/admin/tenants/:id/billing',
    { preHandler: PLATFORM_ADMIN },
    async (request, reply) => {
      const id = parseInt(request.params.id, 10);
      const data = await withTenantConnection(db, id, async (scopedDb) => {
        const [tenant] = await scopedDb.select().from(tenants).where(eq(tenants.id, id));
        if (!tenant) throw new NotFoundError('Tenant', id);

        // Live counts, not the monthly usage_summary rollup (PG-028) — an operator checking
        // "is this tenant over their cap right now" needs the current headcount, not last period's.
        const [userCountRow] = await scopedDb
          .select({ value: count() })
          .from(users)
          .where(and(eq(users.tenantId, id), eq(users.isActive, true)));
        const [branchCountRow] = await scopedDb
          .select({ value: count() })
          .from(branches)
          .where(and(eq(branches.tenantId, id), eq(branches.isActive, true)));

        return {
          plan: tenant.plan,
          entitlements: {
            maxUsers: tenant.settings?.maxUsers ?? null,
            currentUsers: userCountRow?.value ?? 0,
            maxBranches: tenant.settings?.maxBranches ?? null,
            currentBranches: branchCountRow?.value ?? 0,
          },
          nextBillingDate: tenant.nextBillingDate,
          dunningStartedAt: tenant.dunningStartedAt,
        };
      });

      return reply.code(200).send({ data });
    }
  );

  // ── PATCH /admin/tenants/:id/plan ───────────────────────────────────────
  fastify.patch<{ Params: { id: string } }>(
    '/admin/tenants/:id/plan',
    { preHandler: PLATFORM_ADMIN },
    async (request, reply) => {
      const id = parseInt(request.params.id, 10);
      const body = ChangePlanSchema.safeParse(request.body);
      if (!body.success) {
        throw new ValidationError(body.error.errors.map((e) => e.message).join('; '));
      }

      await withTenantConnection(db, id, async (scopedDb) => {
        const [tenant] = await scopedDb.select().from(tenants).where(eq(tenants.id, id));
        if (!tenant) throw new NotFoundError('Tenant', id);

        await new BillingService(scopedDb).assignPlanEntitlements(id, body.data.plan);
      });
      return reply
        .code(200)
        .send({ data: { message: 'Plan updated', tenantId: id, plan: body.data.plan } });
    }
  );

  // ── GET /admin/tenants/:id/invoices?page=&pageSize= ─────────────────────
  fastify.get<{ Params: { id: string }; Querystring: { page?: string; pageSize?: string } }>(
    '/admin/tenants/:id/invoices',
    { preHandler: PLATFORM_ADMIN },
    async (request, reply) => {
      const id = parseInt(request.params.id, 10);
      const page = Math.max(parseInt(request.query.page ?? '0', 10), 0);
      const pageSize = Math.min(parseInt(request.query.pageSize ?? '20', 10), 100);

      const data = await withTenantConnection(db, id, async (scopedDb) => {
        const [tenant] = await scopedDb.select().from(tenants).where(eq(tenants.id, id));
        if (!tenant) throw new NotFoundError('Tenant', id);

        const [totalRow] = await scopedDb
          .select({ value: count() })
          .from(tenantInvoices)
          .where(eq(tenantInvoices.tenantId, id));
        const content = await scopedDb
          .select()
          .from(tenantInvoices)
          .where(eq(tenantInvoices.tenantId, id))
          .orderBy(tenantInvoices.createdAt)
          .limit(pageSize)
          .offset(page * pageSize);

        return { content, totalElements: totalRow?.value ?? 0 };
      });

      return reply.code(200).send({ data });
    }
  );

  // ── POST /admin/tenants/:id/invoices/:invoiceId/retry-payment ───────────
  fastify.post<{ Params: { id: string; invoiceId: string } }>(
    '/admin/tenants/:id/invoices/:invoiceId/retry-payment',
    { preHandler: PLATFORM_ADMIN },
    async (request, reply) => {
      const id = parseInt(request.params.id, 10);
      const invoiceId = parseInt(request.params.invoiceId, 10);

      const [tenant] = await db.select().from(tenants).where(eq(tenants.id, id));
      if (!tenant) throw new NotFoundError('Tenant', id);

      const [invoice] = await db
        .select()
        .from(tenantInvoices)
        .where(and(eq(tenantInvoices.id, invoiceId), eq(tenantInvoices.tenantId, id)));
      if (!invoice) throw new NotFoundError('TenantInvoice', invoiceId);
      if (invoice.status === 'PAID') {
        throw new BusinessError('INVOICE_ALREADY_PAID', 'Invoice has already been paid');
      }
      // Live-verification finding: chargeInvoice() silently no-ops (SKIPPED_NO_GATEWAY_REF,
      // invoice left untouched) when the tenant has no saved payment method — collapsing that
      // into the same "FAILED" response as a real charge attempt would misreport an untouched
      // PENDING invoice as if a charge had actually been attempted. Caught this by live-testing
      // the route against a real tenant with no saved method, not just by reading the code.
      if (!tenant.paymentGatewayCustomerRef) {
        throw new BusinessError(
          'NO_SAVED_PAYMENT_METHOD',
          'This tenant has no saved payment method on file — nothing to retry'
        );
      }

      const outcome = await new BillingService(db).chargeInvoice(
        invoiceId,
        createConfiguredGatewayAdapter()
      );
      const [updated] = await db
        .select()
        .from(tenantInvoices)
        .where(eq(tenantInvoices.id, invoiceId));

      return reply.code(200).send({
        data: {
          status: outcome === 'PAID' ? 'PAID' : 'FAILED',
          gatewayRef: updated?.paymentGatewayRef ?? undefined,
        },
      });
    }
  );
}
