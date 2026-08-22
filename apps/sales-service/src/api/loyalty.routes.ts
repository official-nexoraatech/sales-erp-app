import type { FastifyInstance } from 'fastify';
import type { PlatformContextFactory } from '@erp/sdk';
import { tenantScopedHandler } from '@erp/sdk';
import { z } from 'zod';
import { PERMISSIONS } from '@erp/types';
import { authenticate } from '../middleware/authenticate.js';
import { requirePermission } from '../middleware/authorize.js';
import { LoyaltyService } from '../domain/LoyaltyService.js';

// CRM/O2C split — the 6 admin/read endpoints (balance, tiers, redemption catalog) moved to
// apps/crm-service/src/api/loyalty.routes.ts. Only the 2 POS-redeem endpoints stay here — they
// call the transactional half of LoyaltyService (see domain/LoyaltyService.ts's header comment).

const RedeemSchema = z.object({
  customerId: z.number().int().positive(),
  points: z.number().int().positive(),
  referenceType: z.string().max(50),
  referenceId: z.number().int().positive(),
});

const RedeemCatalogSchema = z.object({
  customerId: z.number().int().positive(),
  catalogItemId: z.number().int().positive(),
  referenceType: z.string().max(50),
  referenceId: z.number().int().positive(),
});

// Phase 9 GUC-per-request rollout — migrated 2026-08-21. No external I/O — LoyaltyService's
// redeemPoints()/redeemCatalogItem() have no fetch() calls.
export async function loyaltyRoutes(
  fastify: FastifyInstance,
  ctxFactory: PlatformContextFactory
): Promise<void> {
  fastify.addHook('preHandler', authenticate);

  // CRM-ROADMAP Phase 2, Feature 3: real gap fixed — this route was gated on POS_MANAGE, which
  // CASHIER never held (see role-defaults.ts's own comment on why), making loyalty redemption at
  // checkout a supervisor-only action despite the roadmap's explicit "cashier-permitted"
  // requirement. LOYALTY_REDEEM is now granted to CASHIER/SALES_MANAGER/OWNER/ADMIN/SUPER_ADMIN.
  fastify.post(
    '/pos/loyalty/redeem',
    { preHandler: requirePermission(PERMISSIONS.LOYALTY_REDEEM) },
    tenantScopedHandler(ctxFactory, async (request, reply, ctx) => {
      const body = RedeemSchema.parse(request.body);
      const svc = new LoyaltyService(ctx.db.raw);
      const redemptionValue = await svc.redeemPoints(
        ctx.tenant.tenantId,
        body.customerId,
        body.points,
        body.referenceType,
        body.referenceId,
        ctx.tenant.userId
      );
      return reply.send({ data: { redemptionValue } });
    })
  );

  // Redeem a specific catalog reward (e.g. "10% Off Voucher") rather than a raw points->currency
  // amount — still posts through the same loyaltyTransactions ledger (see
  // LoyaltyService.redeemCatalogItem's own comment).
  fastify.post(
    '/pos/loyalty/redeem-catalog',
    { preHandler: requirePermission(PERMISSIONS.LOYALTY_REDEEM) },
    tenantScopedHandler(ctxFactory, async (request, reply, ctx) => {
      const body = RedeemCatalogSchema.parse(request.body);
      const svc = new LoyaltyService(ctx.db.raw);
      const reward = await svc.redeemCatalogItem(
        ctx.tenant.tenantId,
        body.customerId,
        body.catalogItemId,
        body.referenceType,
        body.referenceId,
        ctx.tenant.userId
      );
      return reply.code(201).send({ data: reward });
    })
  );
}
