import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { eq, and, sql, desc, inArray } from 'drizzle-orm';
import { items, warehouses, inventoryLedger, projectionStockLevel } from '@erp/db';
import { PERMISSIONS } from '@erp/types';
import type { PlatformContextFactory } from '@erp/sdk';
import { timingSafeEqual } from 'node:crypto';
import { authenticate } from '../middleware/authenticate.js';
import { requirePermission } from '../middleware/authorize.js';
import { createDatabaseClient } from '@erp/db';
import { runReconciliation } from '../jobs/reconciliation.job.js';
import { runNearExpiryAlert } from '../jobs/nearExpiryAlert.job.js';
import { assertWarehouseInScope, getWarehouseScope } from '../domain/WarehouseBranchScope.js';

const StockListQuery = z.object({
  warehouseId: z.coerce.number().int().positive().optional(),
  belowReorder: z.coerce.boolean().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export async function stockRoutes(
  fastify: FastifyInstance,
  ctxFactory: PlatformContextFactory
): Promise<void> {
  // POST /inventory/reconcile — internal trigger (scheduler calls this)
  fastify.post('/inventory/reconcile', async (request, reply) => {
    const apiKey = (request.headers['x-internal-key'] as string | undefined) ?? '';
    const expected = process.env['INTERNAL_API_KEY'] ?? '';
    const keyBuffer = Buffer.from(apiKey);
    const expectedBuffer = Buffer.from(expected);
    const matches =
      !!expected &&
      keyBuffer.length === expectedBuffer.length &&
      timingSafeEqual(keyBuffer, expectedBuffer);
    if (!matches) {
      return reply
        .code(401)
        .send({ error: { code: 'UNAUTHORIZED', message: 'Invalid internal API key' } });
    }
    const dbUrl = process.env['DATABASE_URL'];
    if (!dbUrl)
      return reply.code(500).send({ error: { code: 'NO_DB', message: 'No DATABASE_URL' } });
    const db = createDatabaseClient({ url: dbUrl });
    const result = await runReconciliation(db);
    return reply.code(200).send({ data: result });
  });

  // POST /inventory/near-expiry-alert — internal trigger (scheduler calls this).
  // Multi-vertical platform audit 2026-08-16: publishes one STOCK_NEAR_EXPIRY outbox event per
  // FIFO layer expiring within thresholdDays — see jobs/nearExpiryAlert.job.ts.
  fastify.post('/inventory/near-expiry-alert', async (request, reply) => {
    const apiKey = (request.headers['x-internal-key'] as string | undefined) ?? '';
    const expected = process.env['INTERNAL_API_KEY'] ?? '';
    const keyBuffer = Buffer.from(apiKey);
    const expectedBuffer = Buffer.from(expected);
    const matches =
      !!expected &&
      keyBuffer.length === expectedBuffer.length &&
      timingSafeEqual(keyBuffer, expectedBuffer);
    if (!matches) {
      return reply
        .code(401)
        .send({ error: { code: 'UNAUTHORIZED', message: 'Invalid internal API key' } });
    }
    const dbUrl = process.env['DATABASE_URL'];
    if (!dbUrl)
      return reply.code(500).send({ error: { code: 'NO_DB', message: 'No DATABASE_URL' } });
    const db = createDatabaseClient({ url: dbUrl });
    const thresholdDaysRaw = (request.query as { thresholdDays?: string }).thresholdDays;
    const thresholdDays = thresholdDaysRaw ? parseInt(thresholdDaysRaw, 10) : undefined;
    const result = await runNearExpiryAlert(db, thresholdDays);
    return reply.code(200).send({ data: result });
  });

  // GET /inventory/stock — list stock levels
  fastify.get(
    '/inventory/stock',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.ITEM_VIEW)] },
    async (request, reply) => {
      const ctx = ctxFactory.create({
        tenantId: request.auth.tenantId,
        userId: request.auth.userId,
        correlationId: request.id,
      });

      const query = StockListQuery.parse(request.query);
      const { page, limit } = query;
      const offset = (page - 1) * limit;

      let baseQuery = ctx.db.raw
        .select({
          itemId: projectionStockLevel.itemId,
          warehouseId: projectionStockLevel.warehouseId,
          availableQty: projectionStockLevel.availableQty,
          reservedQty: projectionStockLevel.reservedQty,
          lastMovementAt: projectionStockLevel.lastMovementAt,
          itemName: items.name,
          itemCode: items.itemCode,
          reorderLevel: items.reorderLevel,
          warehouseName: warehouses.name,
        })
        .from(projectionStockLevel)
        .innerJoin(
          items,
          and(
            eq(items.id, projectionStockLevel.itemId),
            eq(items.tenantId, projectionStockLevel.tenantId)
          )
        )
        .innerJoin(warehouses, eq(warehouses.id, projectionStockLevel.warehouseId))
        .where(eq(projectionStockLevel.tenantId, request.auth.tenantId))
        .$dynamic();

      const warehouseScope = await getWarehouseScope(ctx.db.raw, request.auth.tenantId, {
        permissions: request.auth.permissions,
        branchIds: request.auth.branchIds,
      });
      if (query.warehouseId) {
        await assertWarehouseInScope(ctx.db.raw, request.auth.tenantId, query.warehouseId, {
          permissions: request.auth.permissions,
          branchIds: request.auth.branchIds,
        });
        baseQuery = baseQuery.where(
          eq(projectionStockLevel.warehouseId, query.warehouseId)
        ) as typeof baseQuery;
      } else if (warehouseScope !== 'all') {
        if (warehouseScope.length === 0) {
          return reply.code(200).send({ data: { content: [], totalElements: 0, page, limit } });
        }
        baseQuery = baseQuery.where(
          inArray(projectionStockLevel.warehouseId, warehouseScope)
        ) as typeof baseQuery;
      }

      if (query.belowReorder) {
        baseQuery = baseQuery.where(
          sql`${projectionStockLevel.availableQty} <= ${items.reorderLevel}`
        ) as typeof baseQuery;
      }

      const rows = await baseQuery.limit(limit).offset(offset);

      let countQuery = ctx.db.raw
        .select({ count: sql<number>`count(*)::int` })
        .from(projectionStockLevel)
        .innerJoin(
          items,
          and(
            eq(items.id, projectionStockLevel.itemId),
            eq(items.tenantId, projectionStockLevel.tenantId)
          )
        )
        .innerJoin(warehouses, eq(warehouses.id, projectionStockLevel.warehouseId))
        .where(eq(projectionStockLevel.tenantId, request.auth.tenantId))
        .$dynamic();

      if (query.warehouseId) {
        countQuery = countQuery.where(
          eq(projectionStockLevel.warehouseId, query.warehouseId)
        ) as typeof countQuery;
      } else if (warehouseScope !== 'all' && warehouseScope.length > 0) {
        countQuery = countQuery.where(
          inArray(projectionStockLevel.warehouseId, warehouseScope)
        ) as typeof countQuery;
      }
      if (query.belowReorder) {
        countQuery = countQuery.where(
          sql`${projectionStockLevel.availableQty} <= ${items.reorderLevel}`
        ) as typeof countQuery;
      }

      const [countRow] = await countQuery;

      return reply
        .code(200)
        .send({ data: { content: rows, totalElements: countRow?.count ?? 0, page, limit } });
    }
  );

  // GET /inventory/stock/:itemId — stock by warehouse for a specific item
  fastify.get(
    '/inventory/stock/:itemId',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.ITEM_VIEW)] },
    async (request, reply) => {
      const ctx = ctxFactory.create({
        tenantId: request.auth.tenantId,
        userId: request.auth.userId,
        correlationId: request.id,
      });

      const { itemId } = request.params as { itemId: string };
      const id = parseInt(itemId, 10);

      const warehouseScope = await getWarehouseScope(ctx.db.raw, request.auth.tenantId, {
        permissions: request.auth.permissions,
        branchIds: request.auth.branchIds,
      });
      if (warehouseScope !== 'all' && warehouseScope.length === 0) {
        return reply.code(200).send({ data: [] });
      }

      let whereClause = and(
        eq(projectionStockLevel.itemId, id),
        eq(projectionStockLevel.tenantId, request.auth.tenantId)
      );
      if (warehouseScope !== 'all') {
        whereClause = and(whereClause, inArray(projectionStockLevel.warehouseId, warehouseScope));
      }

      const stock = await ctx.db.raw
        .select({
          warehouseId: projectionStockLevel.warehouseId,
          warehouseName: warehouses.name,
          availableQty: projectionStockLevel.availableQty,
          reservedQty: projectionStockLevel.reservedQty,
          lastMovementAt: projectionStockLevel.lastMovementAt,
        })
        .from(projectionStockLevel)
        .innerJoin(warehouses, eq(warehouses.id, projectionStockLevel.warehouseId))
        .where(whereClause);

      return reply.code(200).send({ data: stock });
    }
  );

  // GET /inventory/ledger/:itemId — paginated ledger entries
  fastify.get(
    '/inventory/ledger/:itemId',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.ITEM_VIEW)] },
    async (request, reply) => {
      const ctx = ctxFactory.create({
        tenantId: request.auth.tenantId,
        userId: request.auth.userId,
        correlationId: request.id,
      });

      const { itemId } = request.params as { itemId: string };
      const id = parseInt(itemId, 10);
      const {
        page = 1,
        limit = 50,
        warehouseId,
      } = request.query as {
        page?: number;
        limit?: number;
        warehouseId?: number;
      };
      const offset = (page - 1) * limit;

      let q = ctx.db.raw
        .select()
        .from(inventoryLedger)
        .where(
          and(eq(inventoryLedger.itemId, id), eq(inventoryLedger.tenantId, request.auth.tenantId))
        )
        .orderBy(desc(inventoryLedger.createdAt), desc(inventoryLedger.id))
        .$dynamic();

      if (warehouseId) {
        q = q.where(eq(inventoryLedger.warehouseId, warehouseId)) as typeof q;
      }

      const entries = await q.limit(limit).offset(offset);
      return reply.code(200).send({ data: entries, meta: { page, limit } });
    }
  );
}
