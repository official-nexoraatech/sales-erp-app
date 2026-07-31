import type { FastifyInstance } from 'fastify';
import type { PlatformContextFactory } from '@erp/sdk';
import { z } from 'zod';
import { PERMISSIONS, ValidationError } from '@erp/types';
import { authenticate } from '../middleware/authenticate.js';
import { requirePermission } from '../middleware/authorize.js';
import { ReferralService } from '../domain/ReferralService.js';

type AuthedRequest = {
  auth: { tenantId: number; userId: number; permissions: string[]; branchIds: number[] };
};

const RejectSchema = z.object({
  reason: z.string().min(1).max(500),
});

export async function referralRoutes(
  fastify: FastifyInstance,
  ctxFactory: PlatformContextFactory
): Promise<void> {
  fastify.addHook('preHandler', authenticate);

  // Get-or-create the customer's own shareable referral code (also used by the POS receipt QR).
  fastify.get<{ Params: { customerId: string } }>(
    '/referral-codes/:customerId',
    { preHandler: requirePermission(PERMISSIONS.REFERRAL_VIEW) },
    async (request, reply) => {
      const { tenantId, userId } = (request as unknown as AuthedRequest).auth;
      const ctx = ctxFactory.create({
        tenantId,
        userId,
        correlationId: (request.headers['x-correlation-id'] as string) ?? crypto.randomUUID(),
      });
      const customerId = parseInt(request.params.customerId, 10);
      const code = await ReferralService.getOrCreateCode(ctx.db.raw, tenantId, customerId);
      return reply.send({ data: code });
    }
  );

  fastify.get(
    '/referral/funnel',
    { preHandler: requirePermission(PERMISSIONS.REFERRAL_VIEW) },
    async (request, reply) => {
      const { tenantId, userId } = (request as unknown as AuthedRequest).auth;
      const ctx = ctxFactory.create({
        tenantId,
        userId,
        correlationId: (request.headers['x-correlation-id'] as string) ?? crypto.randomUUID(),
      });
      const stats = await ReferralService.getFunnelStats(ctx.db.raw, tenantId);
      return reply.send({ data: stats });
    }
  );

  fastify.get(
    '/referral/rewards',
    { preHandler: requirePermission(PERMISSIONS.REFERRAL_VIEW) },
    async (request, reply) => {
      const { tenantId, userId } = (request as unknown as AuthedRequest).auth;
      const ctx = ctxFactory.create({
        tenantId,
        userId,
        correlationId: (request.headers['x-correlation-id'] as string) ?? crypto.randomUUID(),
      });
      const query = request.query as { status?: 'PENDING' | 'FLAGGED' | 'PAID' | 'REJECTED' };
      const rewards = await ReferralService.listRewards(ctx.db.raw, tenantId, query.status);
      return reply.send({ data: { content: rewards, totalElements: rewards.length } });
    }
  );

  // FLAGGED (device/address correlation) reward review — the roadmap's own required
  // abuse-review path, distinct from the automatic payout path.
  fastify.post<{ Params: { id: string } }>(
    '/referral/rewards/:id/approve',
    { preHandler: requirePermission(PERMISSIONS.REFERRAL_CONFIGURE) },
    async (request, reply) => {
      const { tenantId } = (request as unknown as AuthedRequest).auth;
      const rewardId = parseInt(request.params.id, 10);
      const ctx = ctxFactory.create({
        tenantId,
        userId: (request as unknown as AuthedRequest).auth.userId,
        correlationId: (request.headers['x-correlation-id'] as string) ?? crypto.randomUUID(),
      });
      const reward = await ReferralService.approveFlagged(ctx.db.raw, tenantId, rewardId);
      return reply.send({ data: reward });
    }
  );

  fastify.post<{ Params: { id: string } }>(
    '/referral/rewards/:id/reject',
    { preHandler: requirePermission(PERMISSIONS.REFERRAL_CONFIGURE) },
    async (request, reply) => {
      const { tenantId } = (request as unknown as AuthedRequest).auth;
      const rewardId = parseInt(request.params.id, 10);
      const body = RejectSchema.safeParse(request.body);
      if (!body.success)
        throw new ValidationError(body.error.errors.map((e) => e.message).join('; '));
      const ctx = ctxFactory.create({
        tenantId,
        userId: (request as unknown as AuthedRequest).auth.userId,
        correlationId: (request.headers['x-correlation-id'] as string) ?? crypto.randomUUID(),
      });
      const reward = await ReferralService.rejectFlagged(
        ctx.db.raw,
        tenantId,
        rewardId,
        body.data.reason
      );
      return reply.send({ data: reward });
    }
  );
}
