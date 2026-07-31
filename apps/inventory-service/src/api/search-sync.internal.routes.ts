/* global process, crypto */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { PlatformContextFactory } from '@erp/sdk';
import {
  items,
  categories,
  brands,
  units,
  warehouses,
  stockTransfers,
  stockAdjustments,
  projectionStockLevel,
} from '@erp/db';
import { and, eq, gte, isNull } from 'drizzle-orm';
import { timingSafeEqual } from 'node:crypto';

async function checkInternalKey(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  const key = req.headers['x-internal-key'];
  const expected = process.env['INTERNAL_API_KEY'];
  const keyBuffer = Buffer.from(typeof key === 'string' ? key : '');
  const expectedBuffer = Buffer.from(expected ?? '');
  const matches =
    !!expected &&
    keyBuffer.length === expectedBuffer.length &&
    timingSafeEqual(keyBuffer, expectedBuffer);
  if (!matches) {
    await reply
      .code(401)
      .send({ error: { code: 'UNAUTHENTICATED', message: 'Invalid internal API key' } });
  }
}

interface SearchSyncDoc {
  id: string;
  doc: Record<string, unknown>;
}

interface SearchSyncQuery {
  tenantId: string;
  page?: string;
  size?: string;
  modifiedSince?: string;
}

// GET /internal/search-sync/:entity — see tenant-service's copy of this file for the full
// rationale (Phase 4 backfill/incremental-sync jobs). NOT protected by JWT — internal-only,
// guarded by x-internal-key. 'stock' (live per-warehouse quantity) pages `projection_stock_level`
// — it IS a discrete row per (item, warehouse, variant), updated in place by
// InventoryLedgerService.upsertProjection() on every movement, which is also what publishes
// the real-time STOCK_LEVEL_CHANGED event this same row-set backs (see eventEntityMap.ts).
// This backfill is the catch-up safety net for anything the Kafka consumer missed.
export async function searchSyncInternalRoutes(
  fastify: FastifyInstance,
  ctxFactory: PlatformContextFactory
): Promise<void> {
  fastify.get<{ Params: { entity: string }; Querystring: SearchSyncQuery }>(
    '/internal/search-sync/:entity',
    { preHandler: checkInternalKey },
    async (request, reply) => {
      const { entity } = request.params;
      const tenantId = parseInt(request.query.tenantId, 10);
      const page = parseInt(request.query.page ?? '0', 10);
      const size = Math.min(parseInt(request.query.size ?? '500', 10), 500);
      const offset = page * size;
      const modifiedSince = request.query.modifiedSince
        ? new Date(request.query.modifiedSince)
        : undefined;
      const db = ctxFactory.create({ tenantId, userId: 0, correlationId: crypto.randomUUID() }).db
        .raw;

      let content: SearchSyncDoc[] = [];

      if (entity === 'item') {
        const conditions = [eq(items.tenantId, tenantId), isNull(items.deletedAt)];
        if (modifiedSince) conditions.push(gte(items.updatedAt, modifiedSince));
        const rows = await db
          .select()
          .from(items)
          .where(and(...conditions))
          .limit(size)
          .offset(offset);
        content = rows.map((r) => ({
          id: String(r.id),
          doc: {
            name: r.name,
            sku: r.itemCode,
            barcode: r.barcode,
            salePrice: r.salePrice,
            tenantId,
          },
        }));
      } else if (entity === 'category') {
        const conditions = [eq(categories.tenantId, tenantId), isNull(categories.deletedAt)];
        if (modifiedSince) conditions.push(gte(categories.updatedAt, modifiedSince));
        const rows = await db
          .select()
          .from(categories)
          .where(and(...conditions))
          .limit(size)
          .offset(offset);
        content = rows.map((r) => ({
          id: String(r.id),
          doc: { name: r.name, code: r.code, tenantId },
        }));
      } else if (entity === 'brand') {
        const conditions = [eq(brands.tenantId, tenantId), isNull(brands.deletedAt)];
        if (modifiedSince) conditions.push(gte(brands.updatedAt, modifiedSince));
        const rows = await db
          .select()
          .from(brands)
          .where(and(...conditions))
          .limit(size)
          .offset(offset);
        content = rows.map((r) => ({
          id: String(r.id),
          doc: { name: r.name, code: r.code, tenantId },
        }));
      } else if (entity === 'unit') {
        const conditions = [eq(units.tenantId, tenantId)];
        if (modifiedSince) conditions.push(gte(units.updatedAt, modifiedSince));
        const rows = await db
          .select()
          .from(units)
          .where(and(...conditions))
          .limit(size)
          .offset(offset);
        content = rows.map((r) => ({
          id: String(r.id),
          doc: { name: r.name, abbreviation: r.abbreviation, tenantId },
        }));
      } else if (entity === 'warehouse') {
        const conditions = [eq(warehouses.tenantId, tenantId), isNull(warehouses.deletedAt)];
        if (modifiedSince) conditions.push(gte(warehouses.updatedAt, modifiedSince));
        const rows = await db
          .select()
          .from(warehouses)
          .where(and(...conditions))
          .limit(size)
          .offset(offset);
        content = rows.map((r) => ({
          id: String(r.id),
          doc: { name: r.name, code: r.code, branchId: r.branchId, tenantId },
        }));
      } else if (entity === 'stock_transfer') {
        const conditions = [eq(stockTransfers.tenantId, tenantId)];
        if (modifiedSince) conditions.push(gte(stockTransfers.updatedAt, modifiedSince));
        const rows = await db
          .select()
          .from(stockTransfers)
          .where(and(...conditions))
          .limit(size)
          .offset(offset);
        content = rows.map((r) => ({
          id: String(r.id),
          doc: {
            transferNumber: r.transferNumber,
            fromWarehouseId: r.fromWarehouseId,
            toWarehouseId: r.toWarehouseId,
            status: r.status,
            tenantId,
          },
        }));
      } else if (entity === 'stock_adjustment') {
        const conditions = [eq(stockAdjustments.tenantId, tenantId)];
        if (modifiedSince) conditions.push(gte(stockAdjustments.updatedAt, modifiedSince));
        const rows = await db
          .select()
          .from(stockAdjustments)
          .where(and(...conditions))
          .limit(size)
          .offset(offset);
        content = rows.map((r) => ({
          id: String(r.id),
          doc: {
            adjustmentNumber: r.adjustmentNumber,
            warehouseId: r.warehouseId,
            adjustmentType: r.adjustmentType,
            tenantId,
          },
        }));
      } else if (entity === 'stock') {
        const conditions = [eq(projectionStockLevel.tenantId, tenantId)];
        if (modifiedSince) conditions.push(gte(projectionStockLevel.updatedAt, modifiedSince));
        const rows = await db
          .select({
            itemId: projectionStockLevel.itemId,
            warehouseId: projectionStockLevel.warehouseId,
            variantId: projectionStockLevel.variantId,
            availableQty: projectionStockLevel.availableQty,
            itemName: items.name,
            sku: items.itemCode,
            warehouseName: warehouses.name,
          })
          .from(projectionStockLevel)
          .innerJoin(items, eq(items.id, projectionStockLevel.itemId))
          .innerJoin(warehouses, eq(warehouses.id, projectionStockLevel.warehouseId))
          .where(and(...conditions))
          .limit(size)
          .offset(offset);
        content = rows.map((r) => ({
          id: `${r.itemId}-${r.warehouseId}-${r.variantId ?? 0}`,
          doc: {
            itemId: r.itemId,
            warehouseId: r.warehouseId,
            variantId: r.variantId,
            itemName: r.itemName,
            sku: r.sku,
            warehouse: r.warehouseName,
            quantity: parseFloat(r.availableQty),
            tenantId,
          },
        }));
      } else {
        return reply.code(422).send({
          error: {
            code: 'INVALID_ENTITY',
            message: `inventory-service does not own entity: ${entity}`,
          },
        });
      }

      return reply.code(200).send({
        data: { content, totalElements: content.length, hasMore: content.length === size },
      });
    }
  );
}
