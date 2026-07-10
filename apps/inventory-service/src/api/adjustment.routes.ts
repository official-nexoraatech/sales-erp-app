import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { eq, and, desc, sql } from 'drizzle-orm';
import { stockAdjustments, stockAdjustmentLines } from '@erp/db';
import { PERMISSIONS } from '@erp/types';
import type { PlatformContextFactory } from '@erp/sdk';
import { authenticate } from '../middleware/authenticate.js';
import { requirePermission } from '../middleware/authorize.js';
import { StockAdjustmentService } from '../domain/StockAdjustmentService.js';

const AdjLineSchema = z.object({
  itemId: z.number().int().positive(),
  variantId: z.number().int().positive().optional(),
  direction: z.enum(['IN', 'OUT']),
  quantity: z.number().positive(),
  unitCost: z.number().positive().optional(),
  reason: z.string().max(500).optional(),
});

const CreateAdjSchema = z.object({
  warehouseId: z.number().int().positive(),
  adjustmentType: z.enum([
    'DAMAGE',
    'EXPIRY',
    'THEFT',
    'SHORTAGE',
    'EXCESS',
    'QUALITY_ISSUE',
    'SAMPLE_ISSUED',
    'RETURN_TO_VENDOR',
  ]),
  lines: z.array(AdjLineSchema).min(1),
  notes: z.string().max(1000).optional(),
});

const CancelSchema = z.object({
  reason: z.string().min(1).max(500),
});

export async function adjustmentRoutes(
  fastify: FastifyInstance,
  ctxFactory: PlatformContextFactory
): Promise<void> {
  // GET /stock-adjustments
  fastify.get(
    '/stock-adjustments',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.WAREHOUSE_MANAGE)] },
    async (request, reply) => {
      const ctx = ctxFactory.create({
        tenantId: request.auth.tenantId,
        userId: request.auth.userId,
        correlationId: request.id,
      });
      const { page = 1, limit = 50, status } = request.query as {
        page?: number;
        limit?: number;
        status?: string;
      };
      const offset = ((page as number) - 1) * (limit as number);

      const whereClause = status
        ? and(eq(stockAdjustments.tenantId, request.auth.tenantId), eq(stockAdjustments.status, status as typeof stockAdjustments.$inferSelect['status']))
        : eq(stockAdjustments.tenantId, request.auth.tenantId);

      const rows = await ctx.db.raw
        .select()
        .from(stockAdjustments)
        .where(whereClause)
        .orderBy(desc(stockAdjustments.createdAt))
        .limit(limit as number)
        .offset(offset);

      const [countRow] = await ctx.db.raw
        .select({ count: sql<number>`count(*)::int` })
        .from(stockAdjustments)
        .where(whereClause);

      return reply.code(200).send({ data: { content: rows, totalElements: countRow?.count ?? 0, page, limit } });
    }
  );

  // POST /stock-adjustments
  fastify.post(
    '/stock-adjustments',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.WAREHOUSE_MANAGE)] },
    async (request, reply) => {
      const ctx = ctxFactory.create({
        tenantId: request.auth.tenantId,
        userId: request.auth.userId,
        correlationId: request.id,
      });
      const body = CreateAdjSchema.parse((request.body as { data?: unknown })?.data ?? request.body);
      const svc = new StockAdjustmentService(ctx.db.raw);
      const adj = await svc.create({
        tenantId: request.auth.tenantId,
        warehouseId: body.warehouseId,
        adjustmentType: body.adjustmentType,
        lines: body.lines.map((l) => ({
          itemId: l.itemId,
          direction: l.direction,
          quantity: l.quantity,
          ...(l.variantId !== undefined ? { variantId: l.variantId } : {}),
          ...(l.unitCost !== undefined ? { unitCost: l.unitCost } : {}),
          ...(l.reason !== undefined ? { reason: l.reason } : {}),
        })),
        ...(body.notes !== undefined ? { notes: body.notes } : {}),
        createdBy: request.auth.userId,
      });

      await ctx.audit.log({
        action: 'STOCK_ADJUSTMENT_CREATED',
        entityType: 'STOCK_ADJUSTMENT',
        entityId: adj.id,
        after: adj,
      });
      await ctx.events.publish('stock_adjustment', adj.id, 'STOCK_ADJUSTMENT_CREATED', adj as unknown as Record<string, unknown>);

      return reply.code(201).send({ data: adj });
    }
  );

  // GET /stock-adjustments/:id
  fastify.get(
    '/stock-adjustments/:id',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.WAREHOUSE_MANAGE)] },
    async (request, reply) => {
      const ctx = ctxFactory.create({
        tenantId: request.auth.tenantId,
        userId: request.auth.userId,
        correlationId: request.id,
      });
      const { id } = request.params as { id: string };
      const svc = new StockAdjustmentService(ctx.db.raw);
      const adj = await svc.get(parseInt(id, 10), request.auth.tenantId);
      const lines = await ctx.db.raw
        .select()
        .from(stockAdjustmentLines)
        .where(eq(stockAdjustmentLines.adjustmentId, parseInt(id, 10)));
      return reply.code(200).send({ data: { ...adj, lines } });
    }
  );

  // POST /stock-adjustments/:id/submit
  fastify.post(
    '/stock-adjustments/:id/submit',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.WAREHOUSE_MANAGE)] },
    async (request, reply) => {
      const ctx = ctxFactory.create({
        tenantId: request.auth.tenantId,
        userId: request.auth.userId,
        correlationId: request.id,
      });
      const { id } = request.params as { id: string };
      const svc = new StockAdjustmentService(ctx.db.raw);
      const adj = await svc.submit(parseInt(id, 10), request.auth.tenantId, request.auth.userId);
      return reply.code(200).send({ data: adj });
    }
  );

  // POST /stock-adjustments/:id/approve
  fastify.post(
    '/stock-adjustments/:id/approve',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.WAREHOUSE_MANAGE)] },
    async (request, reply) => {
      const ctx = ctxFactory.create({
        tenantId: request.auth.tenantId,
        userId: request.auth.userId,
        correlationId: request.id,
      });
      const { id } = request.params as { id: string };
      const svc = new StockAdjustmentService(ctx.db.raw);
      const adj = await svc.approve(parseInt(id, 10), request.auth.tenantId, request.auth.userId);
      await ctx.events.publish('stock_adjustment', adj.id, 'STOCK_ADJUSTMENT_UPDATED', adj as unknown as Record<string, unknown>);
      return reply.code(200).send({ data: adj });
    }
  );

  // POST /stock-adjustments/:id/cancel
  fastify.post(
    '/stock-adjustments/:id/cancel',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.WAREHOUSE_MANAGE)] },
    async (request, reply) => {
      const ctx = ctxFactory.create({
        tenantId: request.auth.tenantId,
        userId: request.auth.userId,
        correlationId: request.id,
      });
      const { id } = request.params as { id: string };
      const { reason } = CancelSchema.parse((request.body as { data?: unknown })?.data ?? request.body);
      const svc = new StockAdjustmentService(ctx.db.raw);
      const adj = await svc.cancel(parseInt(id, 10), request.auth.tenantId, request.auth.userId, reason);
      await ctx.events.publish('stock_adjustment', adj.id, 'STOCK_ADJUSTMENT_UPDATED', adj as unknown as Record<string, unknown>);
      return reply.code(200).send({ data: adj });
    }
  );
}
