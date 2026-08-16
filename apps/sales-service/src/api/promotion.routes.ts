import type { FastifyInstance } from 'fastify';
import type { PlatformContextFactory } from '@erp/sdk';
import { z } from 'zod';
import { ValidationError } from '@erp/types';
import { PERMISSIONS } from '@erp/types';
import { authenticate } from '../middleware/authenticate.js';
import { requirePermission, requireAnyPermission } from '../middleware/authorize.js';
import { PromotionService } from '../domain/PromotionService.js';
import { PromotionEngine } from '../domain/PromotionEngine.js';

// Multi-vertical platform audit 2026-08-16, Phase 2 — multi-buy/BOGO pricing promotions.
// PROMOTION_MANAGE gates authoring (SALES_MANAGER/ADMIN/OWNER); PROMOTION_VIEW gates read-only
// access (also held by CASHIER, per role-defaults.ts); the checkout-time evaluate endpoint is
// gated on POS_ACCESS/POS_MANAGE instead, since it's part of the checkout flow itself, not
// promotion configuration — same "cashier-permitted, not cashier-configurable" split
// LOYALTY_REDEEM/REFERRAL_VIEW already use.

const PromotionCreateSchema = z
  .object({
    name: z.string().min(2).max(200),
    promotionType: z.enum(['BUY_X_GET_Y_FREE', 'BUY_X_GET_Y_PERCENT_OFF']),
    itemId: z.number().int().positive().optional(),
    categoryId: z.number().int().positive().optional(),
    buyQuantity: z.number().int().positive(),
    getQuantity: z.number().int().positive(),
    getDiscountPct: z.number().positive().max(100).optional(),
    startDate: z.string().datetime(),
    endDate: z.string().datetime(),
  })
  .refine((v) => !!v.itemId !== !!v.categoryId, {
    message: 'Exactly one of itemId or categoryId must be set',
  });

const PromotionUpdateSchema = z.object({
  version: z.number().int().min(0),
  name: z.string().min(2).max(200).optional(),
  buyQuantity: z.number().int().positive().optional(),
  getQuantity: z.number().int().positive().optional(),
  getDiscountPct: z.number().positive().max(100).optional(),
  startDate: z.string().datetime().optional(),
  endDate: z.string().datetime().optional(),
  isActive: z.boolean().optional(),
});

const EvaluateCartSchema = z.object({
  lines: z
    .array(
      z.object({
        itemId: z.number().int().positive(),
        categoryId: z.number().int().positive().optional(),
        quantity: z.number().positive(),
        unitPrice: z.number().positive(),
      })
    )
    .min(1),
});

type AuthedRequest = { auth: { tenantId: number; userId: number } };

export async function promotionRoutes(
  fastify: FastifyInstance,
  ctxFactory: PlatformContextFactory
): Promise<void> {
  fastify.get(
    '/promotions',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.PROMOTION_VIEW)] },
    async (request, reply) => {
      const { tenantId } = (request as unknown as AuthedRequest).auth;
      const ctx = ctxFactory.create({
        tenantId,
        userId: 0,
        correlationId: (request.headers['x-correlation-id'] as string) ?? crypto.randomUUID(),
      });
      const rows = await PromotionService.list(ctx.db.raw, tenantId);
      return reply.code(200).send({ data: { content: rows, totalElements: rows.length } });
    }
  );

  fastify.post(
    '/promotions',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.PROMOTION_MANAGE)] },
    async (request, reply) => {
      const { tenantId, userId } = (request as unknown as AuthedRequest).auth;
      const ctx = ctxFactory.create({
        tenantId,
        userId,
        correlationId: (request.headers['x-correlation-id'] as string) ?? crypto.randomUUID(),
      });

      const body = PromotionCreateSchema.safeParse(request.body);
      if (!body.success)
        throw new ValidationError(body.error.errors.map((e) => e.message).join('; '));

      const created = await PromotionService.create(ctx.db.raw, tenantId, userId, {
        ...body.data,
        startDate: new Date(body.data.startDate),
        endDate: new Date(body.data.endDate),
      });

      await ctx.audit.log({
        action: 'CREATE',
        entityType: 'pricing_promotion',
        entityId: created.id,
        after: created as unknown as Record<string, unknown>,
      });
      return reply.code(201).send({ data: created });
    }
  );

  fastify.put<{ Params: { id: string } }>(
    '/promotions/:id',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.PROMOTION_MANAGE)] },
    async (request, reply) => {
      const { tenantId, userId } = (request as unknown as AuthedRequest).auth;
      const ctx = ctxFactory.create({
        tenantId,
        userId,
        correlationId: (request.headers['x-correlation-id'] as string) ?? crypto.randomUUID(),
      });
      const id = parseInt(request.params.id, 10);

      const body = PromotionUpdateSchema.safeParse(request.body);
      if (!body.success)
        throw new ValidationError(body.error.errors.map((e) => e.message).join('; '));

      const { startDate, endDate, ...rest } = body.data;
      const updated = await PromotionService.update(ctx.db.raw, tenantId, id, {
        ...rest,
        ...(startDate !== undefined ? { startDate: new Date(startDate) } : {}),
        ...(endDate !== undefined ? { endDate: new Date(endDate) } : {}),
      });

      await ctx.audit.log({
        action: 'UPDATE',
        entityType: 'pricing_promotion',
        entityId: id,
        after: updated as unknown as Record<string, unknown>,
      });
      return reply.code(200).send({ data: updated });
    }
  );

  // POST /pos/promotions/evaluate — checkout-time evaluation. Returns per-line discount
  // applications the caller applies as ordinary discountAmount on the line (reusing
  // GSTCalculator's existing discount handling), rather than this endpoint computing tax or
  // creating any record itself — a pure read, safe to call repeatedly as a cart changes.
  fastify.post(
    '/pos/promotions/evaluate',
    {
      preHandler: [
        authenticate,
        requireAnyPermission([PERMISSIONS.POS_MANAGE, PERMISSIONS.POS_ACCESS]),
      ],
    },
    async (request, reply) => {
      const { tenantId } = (request as unknown as AuthedRequest).auth;
      const ctx = ctxFactory.create({
        tenantId,
        userId: 0,
        correlationId: (request.headers['x-correlation-id'] as string) ?? crypto.randomUUID(),
      });

      const body = EvaluateCartSchema.safeParse(request.body);
      if (!body.success)
        throw new ValidationError(body.error.errors.map((e) => e.message).join('; '));

      const applications = await PromotionEngine.evaluateCart(
        ctx.db.raw,
        tenantId,
        body.data.lines
      );
      return reply.code(200).send({ data: { applications } });
    }
  );
}
