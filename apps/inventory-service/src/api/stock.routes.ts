import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { eq, and, gte, sql, desc, lt } from 'drizzle-orm';
import { items, warehouses, inventoryLedger, projectionStockLevel } from '@erp/db';
import { PERMISSIONS } from '@erp/types';
import type { PlatformContextFactory } from '@erp/sdk';
import { timingSafeEqual } from 'node:crypto';
import { authenticate } from '../middleware/authenticate.js';
import { requirePermission } from '../middleware/authorize.js';
import { createDatabaseClient } from '@erp/db';
import { runReconciliation } from '../jobs/reconciliation.job.js';

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
    const matches = !!expected && keyBuffer.length === expectedBuffer.length && timingSafeEqual(keyBuffer, expectedBuffer);
    if (!matches) {
      return reply.code(401).send({ error: { code: 'UNAUTHORIZED', message: 'Invalid internal API key' } });
    }
    const dbUrl = process.env['DATABASE_URL'];
    if (!dbUrl) return reply.code(500).send({ error: { code: 'NO_DB', message: 'No DATABASE_URL' } });
    const db = createDatabaseClient({ url: dbUrl });
    const result = await runReconciliation(db);
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
        .innerJoin(items, and(eq(items.id, projectionStockLevel.itemId), eq(items.tenantId, projectionStockLevel.tenantId)))
        .innerJoin(warehouses, eq(warehouses.id, projectionStockLevel.warehouseId))
        .where(eq(projectionStockLevel.tenantId, request.auth.tenantId))
        .$dynamic();

      if (query.warehouseId) {
        baseQuery = baseQuery.where(eq(projectionStockLevel.warehouseId, query.warehouseId)) as typeof baseQuery;
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
        .innerJoin(items, and(eq(items.id, projectionStockLevel.itemId), eq(items.tenantId, projectionStockLevel.tenantId)))
        .innerJoin(warehouses, eq(warehouses.id, projectionStockLevel.warehouseId))
        .where(eq(projectionStockLevel.tenantId, request.auth.tenantId))
        .$dynamic();

      if (query.warehouseId) {
        countQuery = countQuery.where(eq(projectionStockLevel.warehouseId, query.warehouseId)) as typeof countQuery;
      }
      if (query.belowReorder) {
        countQuery = countQuery.where(sql`${projectionStockLevel.availableQty} <= ${items.reorderLevel}`) as typeof countQuery;
      }

      const [countRow] = await countQuery;

      return reply.code(200).send({ data: { content: rows, totalElements: countRow?.count ?? 0, page, limit } });
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
        .where(
          and(
            eq(projectionStockLevel.itemId, id),
            eq(projectionStockLevel.tenantId, request.auth.tenantId)
          )
        );

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
      const { page = 1, limit = 50, warehouseId } = request.query as {
        page?: number;
        limit?: number;
        warehouseId?: number;
      };
      const offset = (page - 1) * limit;

      let q = ctx.db.raw
        .select()
        .from(inventoryLedger)
        .where(
          and(
            eq(inventoryLedger.itemId, id),
            eq(inventoryLedger.tenantId, request.auth.tenantId)
          )
        )
        .orderBy(desc(inventoryLedger.createdAt))
        .$dynamic();

      if (warehouseId) {
        q = q.where(eq(inventoryLedger.warehouseId, warehouseId)) as typeof q;
      }

      const entries = await q.limit(limit).offset(offset);
      return reply.code(200).send({ data: entries, meta: { page, limit } });
    }
  );
}
