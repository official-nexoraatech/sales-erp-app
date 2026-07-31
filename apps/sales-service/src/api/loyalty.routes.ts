import type { FastifyInstance } from 'fastify';
import type { PlatformContextFactory } from '@erp/sdk';
import { z } from 'zod';
import { PERMISSIONS, ValidationError } from '@erp/types';
import { authenticate } from '../middleware/authenticate.js';
import { requirePermission, requireAnyPermission } from '../middleware/authorize.js';
import { LoyaltyService } from '../domain/LoyaltyService.js';

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

const TierCreateSchema = z.object({
  name: z.string().min(2).max(100),
  code: z.string().min(2).max(50),
  minLifetimePoints: z.number().int().min(0),
  benefits: z.string().max(2000).optional(),
});

const TierUpdateSchema = z.object({
  name: z.string().min(2).max(100).optional(),
  minLifetimePoints: z.number().int().min(0).optional(),
  benefits: z.string().max(2000).nullable().optional(),
  isActive: z.boolean().optional(),
});

const CatalogItemCreateSchema = z.object({
  name: z.string().min(2).max(200),
  description: z.string().max(2000).optional(),
  pointsCost: z.number().int().positive(),
  rewardType: z.enum(['DISCOUNT_AMOUNT', 'DISCOUNT_PERCENT']),
  rewardValue: z.number().positive(),
});

const CatalogItemUpdateSchema = z.object({
  name: z.string().min(2).max(200).optional(),
  description: z.string().max(2000).nullable().optional(),
  pointsCost: z.number().int().positive().optional(),
  isActive: z.boolean().optional(),
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
      const ctx = ctxFactory.create({
        tenantId: req.auth.tenantId,
        userId: req.auth.userId,
        correlationId:
          (req.headers['x-correlation-id'] as string | undefined) ?? crypto.randomUUID(),
      });
      const svc = new LoyaltyService(ctx.db.raw);
      const data = await svc.getBalance(parseInt(customerId, 10), req.auth.tenantId);
      return reply.send({ data });
    },
  });

  // CRM-ROADMAP Phase 2, Feature 3: real gap fixed — this route was gated on POS_MANAGE, which
  // CASHIER never held (see role-defaults.ts's own comment on why), making loyalty redemption at
  // checkout a supervisor-only action despite the roadmap's explicit "cashier-permitted"
  // requirement. LOYALTY_REDEEM is now granted to CASHIER/SALES_MANAGER/OWNER/ADMIN/SUPER_ADMIN.
  fastify.post('/pos/loyalty/redeem', {
    preHandler: requirePermission(PERMISSIONS.LOYALTY_REDEEM),
    handler: async (req, reply) => {
      const body = RedeemSchema.parse(req.body);
      const ctx = ctxFactory.create({
        tenantId: req.auth.tenantId,
        userId: req.auth.userId,
        correlationId:
          (req.headers['x-correlation-id'] as string | undefined) ?? crypto.randomUUID(),
      });
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

  // Redeem a specific catalog reward (e.g. "10% Off Voucher") rather than a raw points->currency
  // amount — still posts through the same loyaltyTransactions ledger (see
  // LoyaltyService.redeemCatalogItem's own comment).
  fastify.post('/pos/loyalty/redeem-catalog', {
    preHandler: requirePermission(PERMISSIONS.LOYALTY_REDEEM),
    handler: async (req, reply) => {
      const body = RedeemCatalogSchema.parse(req.body);
      const ctx = ctxFactory.create({
        tenantId: req.auth.tenantId,
        userId: req.auth.userId,
        correlationId:
          (req.headers['x-correlation-id'] as string | undefined) ?? crypto.randomUUID(),
      });
      const svc = new LoyaltyService(ctx.db.raw);
      const reward = await svc.redeemCatalogItem(
        req.auth.tenantId,
        body.customerId,
        body.catalogItemId,
        body.referenceType,
        body.referenceId,
        req.auth.userId
      );
      return reply.code(201).send({ data: reward });
    },
  });

  // Viewable by anyone who can redeem (POS needs the list to offer a customer) or configure it.
  fastify.get('/loyalty/redemption-catalog', {
    preHandler: requireAnyPermission([PERMISSIONS.LOYALTY_REDEEM, PERMISSIONS.LOYALTY_TIER_MANAGE]),
    handler: async (req, reply) => {
      const ctx = ctxFactory.create({
        tenantId: req.auth.tenantId,
        userId: req.auth.userId,
        correlationId:
          (req.headers['x-correlation-id'] as string | undefined) ?? crypto.randomUUID(),
      });
      const svc = new LoyaltyService(ctx.db.raw);
      const items = await svc.listCatalog(req.auth.tenantId);
      return reply.send({ data: { content: items, totalElements: items.length } });
    },
  });

  fastify.post('/loyalty/redemption-catalog', {
    preHandler: requirePermission(PERMISSIONS.LOYALTY_TIER_MANAGE),
    handler: async (req, reply) => {
      const body = CatalogItemCreateSchema.safeParse(req.body);
      if (!body.success)
        throw new ValidationError(body.error.errors.map((e) => e.message).join('; '));
      const ctx = ctxFactory.create({
        tenantId: req.auth.tenantId,
        userId: req.auth.userId,
        correlationId:
          (req.headers['x-correlation-id'] as string | undefined) ?? crypto.randomUUID(),
      });
      const svc = new LoyaltyService(ctx.db.raw);
      const item = await svc.createCatalogItem(req.auth.tenantId, req.auth.userId, body.data);
      return reply.code(201).send({ data: item });
    },
  });

  fastify.put('/loyalty/redemption-catalog/:id', {
    preHandler: requirePermission(PERMISSIONS.LOYALTY_TIER_MANAGE),
    handler: async (req, reply) => {
      const { id } = req.params as { id: string };
      const body = CatalogItemUpdateSchema.safeParse(req.body);
      if (!body.success)
        throw new ValidationError(body.error.errors.map((e) => e.message).join('; '));
      const ctx = ctxFactory.create({
        tenantId: req.auth.tenantId,
        userId: req.auth.userId,
        correlationId:
          (req.headers['x-correlation-id'] as string | undefined) ?? crypto.randomUUID(),
      });
      const svc = new LoyaltyService(ctx.db.raw);
      const item = await svc.updateCatalogItem(req.auth.tenantId, parseInt(id, 10), body.data);
      return reply.send({ data: item });
    },
  });

  fastify.get('/loyalty/tiers', {
    preHandler: requirePermission(PERMISSIONS.LOYALTY_TIER_MANAGE),
    handler: async (req, reply) => {
      const ctx = ctxFactory.create({
        tenantId: req.auth.tenantId,
        userId: req.auth.userId,
        correlationId:
          (req.headers['x-correlation-id'] as string | undefined) ?? crypto.randomUUID(),
      });
      const svc = new LoyaltyService(ctx.db.raw);
      const tiers = await svc.listTiers(req.auth.tenantId);
      return reply.send({ data: { content: tiers, totalElements: tiers.length } });
    },
  });

  fastify.post('/loyalty/tiers', {
    preHandler: requirePermission(PERMISSIONS.LOYALTY_TIER_MANAGE),
    handler: async (req, reply) => {
      const body = TierCreateSchema.safeParse(req.body);
      if (!body.success)
        throw new ValidationError(body.error.errors.map((e) => e.message).join('; '));
      const ctx = ctxFactory.create({
        tenantId: req.auth.tenantId,
        userId: req.auth.userId,
        correlationId:
          (req.headers['x-correlation-id'] as string | undefined) ?? crypto.randomUUID(),
      });
      const svc = new LoyaltyService(ctx.db.raw);
      const tier = await svc.createTier(req.auth.tenantId, req.auth.userId, body.data);
      return reply.code(201).send({ data: tier });
    },
  });

  fastify.put('/loyalty/tiers/:id', {
    preHandler: requirePermission(PERMISSIONS.LOYALTY_TIER_MANAGE),
    handler: async (req, reply) => {
      const { id } = req.params as { id: string };
      const body = TierUpdateSchema.safeParse(req.body);
      if (!body.success)
        throw new ValidationError(body.error.errors.map((e) => e.message).join('; '));
      const ctx = ctxFactory.create({
        tenantId: req.auth.tenantId,
        userId: req.auth.userId,
        correlationId:
          (req.headers['x-correlation-id'] as string | undefined) ?? crypto.randomUUID(),
      });
      const svc = new LoyaltyService(ctx.db.raw);
      const tier = await svc.updateTier(req.auth.tenantId, parseInt(id, 10), body.data);
      return reply.send({ data: tier });
    },
  });
}
