import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { eq, and, desc, sql, inArray } from 'drizzle-orm';
import { stockAdjustments } from '@erp/db';
import type { ErpDatabase } from '@erp/db';
import { PERMISSIONS, NotFoundError, BusinessError } from '@erp/types';
import type { PlatformContextFactory } from '@erp/sdk';
import { tenantScopedHandler } from '@erp/sdk';
import { authenticate } from '../middleware/authenticate.js';
import { requireAnyPermission } from '../middleware/authorize.js';
import { StockAdjustmentService } from '../domain/StockAdjustmentService.js';
import { assertWarehouseInScope, getWarehouseScope } from '../domain/WarehouseBranchScope.js';

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

// GET/submit/approve/cancel act on an existing adjustment — its warehouseId has to be looked
// up before the scope check can run (unlike create, which has it directly in the request body).
async function assertAdjustmentInScope(
  ctxDb: ErpDatabase,
  tenantId: number,
  id: number,
  auth: { permissions: string[]; branchIds: number[] }
): Promise<void> {
  const [adj] = await ctxDb
    .select({ warehouseId: stockAdjustments.warehouseId })
    .from(stockAdjustments)
    .where(and(eq(stockAdjustments.id, id), eq(stockAdjustments.tenantId, tenantId)));
  if (!adj) throw new NotFoundError('StockAdjustment', id);
  await assertWarehouseInScope(ctxDb, tenantId, adj.warehouseId, auth);
}

// Phase 9 GUC-per-request rollout — migrated 2026-08-21. No external I/O —
// StockAdjustmentService has no fetch() calls.
export async function adjustmentRoutes(
  fastify: FastifyInstance,
  ctxFactory: PlatformContextFactory
): Promise<void> {
  // GET /stock-adjustments
  fastify.get(
    '/stock-adjustments',
    {
      preHandler: [
        authenticate,
        requireAnyPermission([PERMISSIONS.STOCK_ADJUST, PERMISSIONS.WAREHOUSE_MANAGE]),
      ],
    },
    tenantScopedHandler(ctxFactory, async (request, reply, ctx) => {
      const {
        page = 1,
        limit = 50,
        status,
      } = request.query as {
        page?: number;
        limit?: number;
        status?: string;
      };
      const offset = ((page as number) - 1) * (limit as number);

      let whereClause = status
        ? and(
            eq(stockAdjustments.tenantId, ctx.tenant.tenantId),
            eq(stockAdjustments.status, status as (typeof stockAdjustments.$inferSelect)['status'])
          )
        : eq(stockAdjustments.tenantId, ctx.tenant.tenantId);

      // Inventory module audit 2026-07-21: previously unfiltered — any user with STOCK_ADJUST/
      // WAREHOUSE_MANAGE saw every branch's adjustments, not just their own warehouse(s).
      const warehouseScope = await getWarehouseScope(ctx.db.raw, ctx.tenant.tenantId, {
        permissions: request.auth.permissions,
        branchIds: request.auth.branchIds,
      });
      if (warehouseScope !== 'all') {
        if (warehouseScope.length === 0) {
          return reply.code(200).send({ data: { content: [], totalElements: 0, page, limit } });
        }
        whereClause = and(whereClause, inArray(stockAdjustments.warehouseId, warehouseScope));
      }

      const rows = await ctx.db.raw
        .select()
        .from(stockAdjustments)
        .where(whereClause)
        .orderBy(desc(stockAdjustments.createdAt), desc(stockAdjustments.id))
        .limit(limit as number)
        .offset(offset);

      const [countRow] = await ctx.db.raw
        .select({ count: sql<number>`count(*)::int` })
        .from(stockAdjustments)
        .where(whereClause);

      return reply
        .code(200)
        .send({ data: { content: rows, totalElements: countRow?.count ?? 0, page, limit } });
    })
  );

  // POST /stock-adjustments
  fastify.post(
    '/stock-adjustments',
    {
      preHandler: [
        authenticate,
        requireAnyPermission([PERMISSIONS.STOCK_ADJUST, PERMISSIONS.WAREHOUSE_MANAGE]),
      ],
    },
    tenantScopedHandler(ctxFactory, async (request, reply, ctx) => {
      const body = CreateAdjSchema.parse(
        (request.body as { data?: unknown })?.data ?? request.body
      );
      await assertWarehouseInScope(ctx.db.raw, ctx.tenant.tenantId, body.warehouseId, {
        permissions: request.auth.permissions,
        branchIds: request.auth.branchIds,
      });
      const svc = new StockAdjustmentService(ctx.db.raw);
      const adj = await svc.create({
        tenantId: ctx.tenant.tenantId,
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
        createdBy: ctx.tenant.userId,
      });

      await ctx.audit.log({
        action: 'STOCK_ADJUSTMENT_CREATED',
        entityType: 'STOCK_ADJUSTMENT',
        entityId: adj.id,
        after: adj,
      });
      await ctx.events.publish(
        'stock_adjustment',
        adj.id,
        'STOCK_ADJUSTMENT_CREATED',
        adj as unknown as Record<string, unknown>
      );

      return reply.code(201).send({ data: adj });
    })
  );

  // GET /stock-adjustments/:id
  fastify.get(
    '/stock-adjustments/:id',
    {
      preHandler: [
        authenticate,
        requireAnyPermission([PERMISSIONS.STOCK_ADJUST, PERMISSIONS.WAREHOUSE_MANAGE]),
      ],
    },
    tenantScopedHandler(ctxFactory, async (request, reply, ctx) => {
      const { id } = request.params as { id: string };
      await assertAdjustmentInScope(ctx.db.raw, ctx.tenant.tenantId, parseInt(id, 10), {
        permissions: request.auth.permissions,
        branchIds: request.auth.branchIds,
      });
      const svc = new StockAdjustmentService(ctx.db.raw);
      const adj = await svc.getWithLines(parseInt(id, 10), ctx.tenant.tenantId);
      return reply.code(200).send({ data: adj });
    })
  );

  // POST /stock-adjustments/:id/submit
  fastify.post(
    '/stock-adjustments/:id/submit',
    {
      preHandler: [
        authenticate,
        requireAnyPermission([PERMISSIONS.STOCK_ADJUST, PERMISSIONS.WAREHOUSE_MANAGE]),
      ],
    },
    tenantScopedHandler(ctxFactory, async (request, reply, ctx) => {
      const { id } = request.params as { id: string };
      await assertAdjustmentInScope(ctx.db.raw, ctx.tenant.tenantId, parseInt(id, 10), {
        permissions: request.auth.permissions,
        branchIds: request.auth.branchIds,
      });
      const svc = new StockAdjustmentService(ctx.db.raw);
      const adj = await svc.submit(parseInt(id, 10), ctx.tenant.tenantId, ctx.tenant.userId);
      return reply.code(200).send({ data: adj });
    })
  );

  // POST /stock-adjustments/:id/approve
  fastify.post(
    '/stock-adjustments/:id/approve',
    {
      preHandler: [
        authenticate,
        requireAnyPermission([PERMISSIONS.STOCK_ADJUST, PERMISSIONS.WAREHOUSE_MANAGE]),
      ],
    },
    tenantScopedHandler(ctxFactory, async (request, reply, ctx) => {
      const { id } = request.params as { id: string };
      await assertAdjustmentInScope(ctx.db.raw, ctx.tenant.tenantId, parseInt(id, 10), {
        permissions: request.auth.permissions,
        branchIds: request.auth.branchIds,
      });
      const svc = new StockAdjustmentService(ctx.db.raw);

      // Inventory module audit 2026-07-21: PENDING_APPROVAL (value above
      // StockAdjustmentService's APPROVAL_THRESHOLD) previously required the exact same
      // permission as any other approval — the dedicated STOCK_ADJUST_APPROVE constant existed
      // but nothing ever checked it, so a single user holding only STOCK_ADJUST could create,
      // submit, and immediately approve their own high-value adjustment with no real
      // maker-checker segregation. Below-threshold (SUBMITTED) adjustments are unaffected.
      const current = await svc.get(parseInt(id, 10), ctx.tenant.tenantId);
      if (
        current.status === 'PENDING_APPROVAL' &&
        !request.auth.permissions.includes(PERMISSIONS.STOCK_ADJUST_APPROVE)
      ) {
        throw new BusinessError(
          'HIGH_VALUE_APPROVAL_REQUIRED',
          'This adjustment exceeds the approval threshold and requires STOCK_ADJUST_APPROVE permission'
        );
      }

      const adj = await svc.approve(parseInt(id, 10), ctx.tenant.tenantId, ctx.tenant.userId);
      await ctx.events.publish(
        'stock_adjustment',
        adj.id,
        'STOCK_ADJUSTMENT_UPDATED',
        adj as unknown as Record<string, unknown>
      );
      return reply.code(200).send({ data: adj });
    })
  );

  // POST /stock-adjustments/:id/cancel
  fastify.post(
    '/stock-adjustments/:id/cancel',
    {
      preHandler: [
        authenticate,
        requireAnyPermission([PERMISSIONS.STOCK_ADJUST, PERMISSIONS.WAREHOUSE_MANAGE]),
      ],
    },
    tenantScopedHandler(ctxFactory, async (request, reply, ctx) => {
      const { id } = request.params as { id: string };
      const { reason } = CancelSchema.parse(
        (request.body as { data?: unknown })?.data ?? request.body
      );
      await assertAdjustmentInScope(ctx.db.raw, ctx.tenant.tenantId, parseInt(id, 10), {
        permissions: request.auth.permissions,
        branchIds: request.auth.branchIds,
      });
      const svc = new StockAdjustmentService(ctx.db.raw);
      const adj = await svc.cancel(
        parseInt(id, 10),
        ctx.tenant.tenantId,
        ctx.tenant.userId,
        reason
      );
      await ctx.events.publish(
        'stock_adjustment',
        adj.id,
        'STOCK_ADJUSTMENT_UPDATED',
        adj as unknown as Record<string, unknown>
      );
      return reply.code(200).send({ data: adj });
    })
  );
}
