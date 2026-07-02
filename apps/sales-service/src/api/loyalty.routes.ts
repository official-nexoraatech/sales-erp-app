import type { FastifyInstance } from 'fastify';
import type { PlatformContextFactory } from '@erp/sdk';
import { z } from 'zod';
import { PERMISSIONS } from '@erp/types';
import { authenticate } from '../middleware/authenticate.js';
import { requirePermission } from '../middleware/authorize.js';
import { LoyaltyService } from '../domain/LoyaltyService.js';

const RedeemSchema = z.object({
  customerId: z.number().int().positive(),
  points: z.number().int().positive(),
  referenceType: z.string().max(50),
  referenceId: z.number().int().positive(),
});

export async function loyaltyRoutes(
  fastify: FastifyInstance,
  ctxFactory: PlatformContextFactory
): Promise<void> {
  fastify.addHook('preHandler', authenticate);

  fastify.get('/customers/:customerId/loyalty', {
    preHandler: requirePermission(PERMISSIONS.CUSTOMER_VIEW),
    handler: async (req, reply) => {
      const { customerId } = req.params as { customerId: string };
      const ctx = ctxFactory.create({ tenantId: req.auth.tenantId, userId: req.auth.userId, correlationId: (req.headers['x-correlation-id'] as string | undefined) ?? crypto.randomUUID() });
      const svc = new LoyaltyService(ctx.db.raw);
      const data = await svc.getBalance(parseInt(customerId, 10), req.auth.tenantId);
      return reply.send({ data });
    },
  });

  fastify.post('/pos/loyalty/redeem', {
    preHandler: requirePermission(PERMISSIONS.POS_MANAGE),
    handler: async (req, reply) => {
      const body = RedeemSchema.parse(req.body);
      const ctx = ctxFactory.create({ tenantId: req.auth.tenantId, userId: req.auth.userId, correlationId: (req.headers['x-correlation-id'] as string | undefined) ?? crypto.randomUUID() });
      const svc = new LoyaltyService(ctx.db.raw);
      const redemptionValue = await svc.redeemPoints(
        req.auth.tenantId,
        body.customerId,
        body.points,
        body.referenceType,
        body.referenceId,
        req.auth.userId
      );
      return reply.send({ data: { redemptionValue } });
    },
  });
}
