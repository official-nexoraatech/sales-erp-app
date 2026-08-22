import type { FastifyInstance } from 'fastify';
import type { PlatformContextFactory } from '@erp/sdk';
import { tenantScopedHandler } from '@erp/sdk';
import { z } from 'zod';
import { PERMISSIONS, ValidationError } from '@erp/types';
import { authenticate } from '../middleware/authenticate.js';
import { requirePermission } from '../middleware/authorize.js';
import { ReferralService } from '../domain/ReferralService.js';

const RejectSchema = z.object({
  reason: z.string().min(1).max(500),
});

// CRM/O2C split — converted from a single file-level fastify.addHook('preHandler', authenticate)
// to per-route [authenticate, requirePermission(...)] arrays, matching conversation.routes.ts's
// and opportunity.routes.ts's identical conversion for the same reason (no file-level hook on
// crm-service's shared `sub`, so an addHook here would leak onto every sibling route registered
// after this one).
//
// Phase 9 GUC-per-request rollout — migrated 2026-08-21. No external I/O in any of these 5 routes
// — ReferralService's fetch() call (crediting loyalty points via sales-service) lives in a
// different, scheduler-driven attribution function, not called from here.
export async function referralRoutes(
  fastify: FastifyInstance,
  ctxFactory: PlatformContextFactory
): Promise<void> {
  // Get-or-create the customer's own shareable referral code (also used by the POS receipt QR).
  fastify.get(
    '/referral-codes/:customerId',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.REFERRAL_VIEW)] },
    tenantScopedHandler(ctxFactory, async (request, reply, ctx) => {
      const { customerId: customerIdParam } = request.params as { customerId: string };
      const customerId = parseInt(customerIdParam, 10);
      const code = await ReferralService.getOrCreateCode(
        ctx.db.raw,
        ctx.tenant.tenantId,
        customerId
      );
      return reply.send({ data: code });
    })
  );

  fastify.get(
    '/referral/funnel',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.REFERRAL_VIEW)] },
    tenantScopedHandler(ctxFactory, async (request, reply, ctx) => {
      const stats = await ReferralService.getFunnelStats(ctx.db.raw, ctx.tenant.tenantId);
      return reply.send({ data: stats });
    })
  );

  fastify.get(
    '/referral/rewards',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.REFERRAL_VIEW)] },
    tenantScopedHandler(ctxFactory, async (request, reply, ctx) => {
      const query = request.query as { status?: 'PENDING' | 'FLAGGED' | 'PAID' | 'REJECTED' };
      const rewards = await ReferralService.listRewards(
        ctx.db.raw,
        ctx.tenant.tenantId,
        query.status
      );
      return reply.send({ data: { content: rewards, totalElements: rewards.length } });
    })
  );

  // FLAGGED (device/address correlation) reward review — the roadmap's own required
  // abuse-review path, distinct from the automatic payout path.
  fastify.post(
    '/referral/rewards/:id/approve',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.REFERRAL_CONFIGURE)] },
    tenantScopedHandler(ctxFactory, async (request, reply, ctx) => {
      const { id: idParam } = request.params as { id: string };
      const rewardId = parseInt(idParam, 10);
      const reward = await ReferralService.approveFlagged(
        ctx.db.raw,
        ctx.tenant.tenantId,
        rewardId
      );
      return reply.send({ data: reward });
    })
  );

  fastify.post(
    '/referral/rewards/:id/reject',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.REFERRAL_CONFIGURE)] },
    tenantScopedHandler(ctxFactory, async (request, reply, ctx) => {
      const { id: idParam } = request.params as { id: string };
      const rewardId = parseInt(idParam, 10);
      const body = RejectSchema.safeParse(request.body);
      if (!body.success)
        throw new ValidationError(body.error.errors.map((e) => e.message).join('; '));
      const reward = await ReferralService.rejectFlagged(
        ctx.db.raw,
        ctx.tenant.tenantId,
        rewardId,
        body.data.reason
      );
      return reply.send({ data: reward });
    })
  );
}
