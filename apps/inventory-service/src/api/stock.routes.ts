import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { eq, and, sql, desc, inArray, isNotNull, lte } from 'drizzle-orm';
import {
  items,
  warehouses,
  inventoryLedger,
  projectionStockLevel,
  inventoryFifoLayers,
} from '@erp/db';
import { PERMISSIONS } from '@erp/types';
import type { PlatformContextFactory } from '@erp/sdk';
import { requireCapability, tenantScopedHandler } from '@erp/sdk';
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

const NearExpiryStockQuery = z.object({
  warehouseId: z.coerce.number().int().positive().optional(),
  thresholdDays: z.coerce.number().int().min(1).max(365).default(30),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

// Phase 9 GUC-per-request rollout — migrated 2026-08-21. The two internal-key-guarded
// reconcile/near-expiry-alert routes below are deliberately left unmigrated (caveat 4e) —
// runReconciliation/runNearExpiryAlert both operate across every tenant in one query
// (grouped by tenant_id, no filter), a genuine cross-tenant batch job that doesn't fit
// the single-tenant GUC wrapper. The 4 authenticated stock/ledger routes are migrated.
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
    tenantScopedHandler(ctxFactory, async (request, reply, ctx) => {
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
        .where(eq(projectionStockLevel.tenantId, ctx.tenant.tenantId))
        .$dynamic();

      const warehouseScope = await getWarehouseScope(ctx.db.raw, ctx.tenant.tenantId, {
        permissions: request.auth.permissions,
        branchIds: request.auth.branchIds,
      });
      if (query.warehouseId) {
        await assertWarehouseInScope(ctx.db.raw, ctx.tenant.tenantId, query.warehouseId, {
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
        .where(eq(projectionStockLevel.tenantId, ctx.tenant.tenantId))
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
    })
  );

  // GET /inventory/stock/:itemId — stock by warehouse for a specific item
  fastify.get(
    '/inventory/stock/:itemId',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.ITEM_VIEW)] },
    tenantScopedHandler(ctxFactory, async (request, reply, ctx) => {
      const { itemId } = request.params as { itemId: string };
      const id = parseInt(itemId, 10);

      const warehouseScope = await getWarehouseScope(ctx.db.raw, ctx.tenant.tenantId, {
        permissions: request.auth.permissions,
        branchIds: request.auth.branchIds,
      });
      if (warehouseScope !== 'all' && warehouseScope.length === 0) {
        return reply.code(200).send({ data: [] });
      }

      let whereClause = and(
        eq(projectionStockLevel.itemId, id),
        eq(projectionStockLevel.tenantId, ctx.tenant.tenantId)
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
    })
  );

  // GET /inventory/ledger/:itemId — paginated ledger entries
  fastify.get(
    '/inventory/ledger/:itemId',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.ITEM_VIEW)] },
    tenantScopedHandler(ctxFactory, async (request, reply, ctx) => {
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
          and(eq(inventoryLedger.itemId, id), eq(inventoryLedger.tenantId, ctx.tenant.tenantId))
        )
        .orderBy(desc(inventoryLedger.createdAt), desc(inventoryLedger.id))
        .$dynamic();

      if (warehouseId) {
        q = q.where(eq(inventoryLedger.warehouseId, warehouseId)) as typeof q;
      }

      const entries = await q.limit(limit).offset(offset);
      return reply.code(200).send({ data: entries, meta: { page, limit } });
    })
  );

  // GET /inventory/near-expiry-stock — Phase 2B (INVENTORY_BATCH capability). Visibility only:
  // lists FIFO layers expiring within thresholdDays (including already-expired remaining
  // stock, sorted soonest-first) so an operator can act on it manually. Does NOT block sale,
  // transfer, or adjustment of any listed stock — expiry enforcement is deferred (D2).
  fastify.get(
    '/inventory/near-expiry-stock',
    {
      preHandler: [
        authenticate,
        requireCapability('INVENTORY_BATCH', ctxFactory.rawDb, ctxFactory.getRedis()),
        requirePermission(PERMISSIONS.BATCH_VIEW),
      ],
    },
    tenantScopedHandler(ctxFactory, async (request, reply, ctx) => {
      const query = NearExpiryStockQuery.parse(request.query);
      const { page, limit } = query;
      const offset = (page - 1) * limit;
      const cutoff = new Date(Date.now() + query.thresholdDays * 24 * 60 * 60 * 1000);

      const warehouseScope = await getWarehouseScope(ctx.db.raw, ctx.tenant.tenantId, {
        permissions: request.auth.permissions,
        branchIds: request.auth.branchIds,
      });
      if (warehouseScope !== 'all' && warehouseScope.length === 0) {
        return reply.code(200).send({ data: { content: [], totalElements: 0, page, limit } });
      }
      if (query.warehouseId) {
        await assertWarehouseInScope(ctx.db.raw, ctx.tenant.tenantId, query.warehouseId, {
          permissions: request.auth.permissions,
          branchIds: request.auth.branchIds,
        });
      }

      let whereClause = and(
        eq(inventoryFifoLayers.tenantId, ctx.tenant.tenantId),
        sql`${inventoryFifoLayers.remainingQty} > 0`,
        isNotNull(inventoryFifoLayers.expiryDate),
        lte(inventoryFifoLayers.expiryDate, cutoff)
      );
      if (query.warehouseId) {
        whereClause = and(whereClause, eq(inventoryFifoLayers.warehouseId, query.warehouseId));
      } else if (warehouseScope !== 'all') {
        whereClause = and(whereClause, inArray(inventoryFifoLayers.warehouseId, warehouseScope));
      }

      const baseSelect = () =>
        ctx.db.raw
          .select({
            layerId: inventoryFifoLayers.id,
            itemId: inventoryFifoLayers.itemId,
            itemName: items.name,
            itemCode: items.itemCode,
            warehouseId: inventoryFifoLayers.warehouseId,
            warehouseName: warehouses.name,
            batchNumber: inventoryFifoLayers.batchNumber,
            expiryDate: inventoryFifoLayers.expiryDate,
            remainingQty: inventoryFifoLayers.remainingQty,
          })
          .from(inventoryFifoLayers)
          .innerJoin(
            items,
            and(
              eq(items.id, inventoryFifoLayers.itemId),
              eq(items.tenantId, inventoryFifoLayers.tenantId)
            )
          )
          .innerJoin(warehouses, eq(warehouses.id, inventoryFifoLayers.warehouseId))
          .where(whereClause);

      const rows = await baseSelect()
        .orderBy(inventoryFifoLayers.expiryDate)
        .limit(limit)
        .offset(offset);

      const [countRow] = await ctx.db.raw
        .select({ count: sql<number>`count(*)::int` })
        .from(inventoryFifoLayers)
        .where(whereClause);

      const now = Date.now();
      const content = rows.map((row) => ({
        ...row,
        isExpired: row.expiryDate !== null && row.expiryDate.getTime() < now,
      }));

      return reply.code(200).send({
        data: { content, totalElements: countRow?.count ?? 0, page, limit },
      });
    })
  );
}
