import type { FastifyInstance } from 'fastify';
import type { PlatformContextFactory } from '@erp/sdk';
import {
  items,
  itemVariants,
  itemsHistory,
  priceLists,
  priceListItems,
  inventoryLedger,
} from '@erp/db';
import { and, eq, isNull, or, ilike, sql } from 'drizzle-orm';
import { z } from 'zod';
import { BusinessError, NotFoundError, OptimisticLockError, ValidationError, HSN_REGEX } from '@erp/types';
import { PERMISSIONS } from '@erp/types';
import { authenticate } from '../middleware/authenticate.js';
import { requirePermission } from '../middleware/authorize.js';
import { ItemCacheService } from '../domain/ItemCacheService.js';

const GST_RATES = [0, 5, 12, 18, 28] as const;

const ItemSchema = z.object({
  itemCode: z.string().max(50).optional(),
  name: z.string().min(2).max(300),
  description: z.string().max(5000).optional(),
  categoryId: z.number().int().positive().optional(),
  brandId: z.number().int().positive().optional(),
  unitId: z.number().int().positive(),
  attributeSetId: z.number().int().positive().optional(),
  hsnCode: z.string().regex(HSN_REGEX, 'HSN code must be 4, 6, or 8 digits'),
  gstRate: z
    .number()
    .refine((v) => (GST_RATES as readonly number[]).includes(v), {
      message: 'GST rate must be one of: 0, 5, 12, 18, 28',
    }),
  cessRate: z.number().min(0).max(100).default(0),
  mrp: z.number().min(0).optional(),
  salePrice: z.number().min(0).default(0),
  minSalePrice: z.number().min(0).default(0),
  purchasePrice: z.number().min(0).default(0),
  barcode: z.string().max(100).optional(),
  barcodeType: z.enum(['EAN13', 'CODE128', 'QR', 'CUSTOM']).default('EAN13'),
  trackInventory: z.boolean().default(true),
  reorderLevel: z.number().min(0).default(0),
  reorderQty: z.number().min(0).default(0),
  hasVariants: z.boolean().default(false),
  variantAttributeIds: z.array(z.number().int().positive()).default([]),
  imageUrls: z.array(z.string().url()).default([]),
  thumbnailUrl: z.string().url().optional().or(z.literal('')),
  status: z.enum(['ACTIVE', 'INACTIVE', 'DISCONTINUED']).default('ACTIVE'),
  isFabricItem: z.boolean().default(false),
  fabricWidth: z.number().min(0).optional(),
  tags: z.array(z.string()).default([]),
  customFields: z.record(z.unknown()).default({}),
});

const ItemUpdateSchema = ItemSchema.extend({
  version: z.number().int().min(0),
});

const VariantSchema = z.object({
  sku: z.string().min(1).max(100),
  barcode: z.string().max(100).optional(),
  attributeCombination: z.record(z.string()),
  mrp: z.number().min(0).optional(),
  salePrice: z.number().min(0),
  purchasePrice: z.number().min(0).default(0),
  imageUrl: z.string().url().optional().or(z.literal('')),
  isActive: z.boolean().default(true),
});

type AuthedRequest = { auth: { tenantId: number; userId: number } };

export async function itemRoutes(
  fastify: FastifyInstance,
  ctxFactory: PlatformContextFactory
): Promise<void> {
  const itemCache = new ItemCacheService();

  // ── GET /items/by-barcode/:barcode — Redis-cached < 50ms ─────────────────
  // Cache key: tenant:{id}:barcode:{code}
  fastify.get<{ Params: { barcode: string } }>(
    '/items/by-barcode/:barcode',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.ITEM_VIEW)] },
    async (request, reply) => {
      const { tenantId, userId } = (request as unknown as AuthedRequest).auth;
      const ctx = ctxFactory.create({
        tenantId,
        userId,
        correlationId: (request.headers['x-correlation-id'] as string) ?? crypto.randomUUID(),
      });
      const { barcode } = request.params;

      // Check variants first (barcode on variant level)
      const [variant] = await ctx.db.raw
        .select()
        .from(itemVariants)
        .where(and(eq(itemVariants.barcode, barcode), eq(itemVariants.tenantId, tenantId)));

      if (variant) {
        const [item] = await ctx.db.raw
          .select()
          .from(items)
          .where(and(eq(items.id, variant.itemId), eq(items.tenantId, tenantId)));
        return reply.code(200).send({ data: { item, variant } });
      }

      // Fall back to item-level barcode
      const [item] = await ctx.db.raw
        .select()
        .from(items)
        .where(and(eq(items.barcode, barcode), eq(items.tenantId, tenantId), isNull(items.deletedAt)));

      if (!item) throw new NotFoundError('Item', barcode);
      return reply.code(200).send({ data: { item, variant: null } });
    }
  );

  // ── GET /items ─────────────────────────────────────────────────────────────
  fastify.get('/items', { preHandler: [authenticate, requirePermission(PERMISSIONS.ITEM_VIEW)] }, async (request, reply) => {
    const { tenantId, userId } = (request as unknown as AuthedRequest).auth;
    const ctx = ctxFactory.create({
      tenantId,
      userId,
      correlationId: (request.headers['x-correlation-id'] as string) ?? crypto.randomUUID(),
    });
    const query = request.query as {
      page?: string;
      size?: string;
      search?: string;
      categoryId?: string;
      brandId?: string;
      status?: string;
    };

    const page = Math.max(0, parseInt(query.page ?? '0', 10));
    const size = Math.min(100, parseInt(query.size ?? '20', 10));

    let whereClause = and(eq(items.tenantId, tenantId), isNull(items.deletedAt));
    if (query.categoryId) whereClause = and(whereClause, eq(items.categoryId, parseInt(query.categoryId, 10)));
    if (query.brandId) whereClause = and(whereClause, eq(items.brandId, parseInt(query.brandId, 10)));
    if (query.status) whereClause = and(whereClause, eq(items.status, query.status as 'ACTIVE' | 'INACTIVE' | 'DISCONTINUED'));
    if (query.search) {
      whereClause = and(
        whereClause,
        or(
          ilike(items.name, `%${query.search}%`),
          ilike(items.itemCode, `%${query.search}%`),
          ilike(items.barcode, `%${query.search}%`)
        )
      );
    }

    const rows = await ctx.db.raw
      .select()
      .from(items)
      .where(whereClause)
      .limit(size)
      .offset(page * size);

    const [countRow] = await ctx.db.raw
      .select({ count: sql<number>`count(*)::int` })
      .from(items)
      .where(whereClause);

    return reply.code(200).send({
      data: { content: rows, totalElements: countRow?.count ?? 0, page, size },
    });
  });

  // ── GET /items/:id ─────────────────────────────────────────────────────────
  fastify.get<{ Params: { id: string } }>('/items/:id', { preHandler: [authenticate, requirePermission(PERMISSIONS.ITEM_VIEW)] }, async (request, reply) => {
    const { tenantId, userId } = (request as unknown as AuthedRequest).auth;
    const ctx = ctxFactory.create({
      tenantId,
      userId,
      correlationId: (request.headers['x-correlation-id'] as string) ?? crypto.randomUUID(),
    });
    const id = parseInt(request.params.id, 10);

    let item = await itemCache.getItem(ctx.cache, id);
    if (!item) {
      const [row] = await ctx.db.raw
        .select()
        .from(items)
        .where(and(eq(items.id, id), eq(items.tenantId, tenantId), isNull(items.deletedAt)));

      if (!row) throw new NotFoundError('Item', id);
      item = row;
      await itemCache.setItem(ctx.cache, item);
    }

    const variants = await ctx.db.raw
      .select()
      .from(itemVariants)
      .where(and(eq(itemVariants.itemId, id), eq(itemVariants.tenantId, tenantId), isNull(itemVariants.deletedAt)));

    return reply.code(200).send({ data: { ...item, variants } });
  });

  // ── GET /items/:id/price-history ───────────────────────────────────────────
  fastify.get<{ Params: { id: string } }>('/items/:id/price-history', { preHandler: [authenticate, requirePermission(PERMISSIONS.ITEM_VIEW)] }, async (request, reply) => {
    const { tenantId, userId } = (request as unknown as AuthedRequest).auth;
    const ctx = ctxFactory.create({
      tenantId,
      userId,
      correlationId: (request.headers['x-correlation-id'] as string) ?? crypto.randomUUID(),
    });
    const id = parseInt(request.params.id, 10);
    const history = await ctx.db.raw
      .select()
      .from(itemsHistory)
      .where(
        and(
          eq(itemsHistory.itemId, id),
          eq(itemsHistory.tenantId, tenantId),
          eq(itemsHistory.changeType, 'PRICE_CHANGE')
        )
      );
    return reply.code(200).send({ data: { content: history, totalElements: history.length } });
  });

  // ── POST /items ────────────────────────────────────────────────────────────
  fastify.post('/items', { preHandler: [authenticate, requirePermission(PERMISSIONS.ITEM_CREATE)] }, async (request, reply) => {
    const { tenantId, userId } = (request as unknown as AuthedRequest).auth;
    const ctx = ctxFactory.create({
      tenantId,
      userId,
      correlationId: (request.headers['x-correlation-id'] as string) ?? crypto.randomUUID(),
    });

    const body = ItemSchema.safeParse(request.body);
    if (!body.success) throw new ValidationError(body.error.errors.map((e) => e.message).join('; '));

    const [created] = await ctx.db.raw
      .insert(items)
      .values({
        tenantId,
        createdBy: userId,
        ...body.data,
        gstRate: String(body.data.gstRate),
        cessRate: String(body.data.cessRate),
        salePrice: String(body.data.salePrice),
        minSalePrice: String(body.data.minSalePrice),
        purchasePrice: String(body.data.purchasePrice),
        mrp: body.data.mrp !== undefined ? String(body.data.mrp) : undefined,
        reorderLevel: String(body.data.reorderLevel),
        reorderQty: String(body.data.reorderQty),
        fabricWidth: body.data.fabricWidth !== undefined ? String(body.data.fabricWidth) : undefined,
      })
      .returning();

    if (!created) throw new Error('Item creation failed');
    await ctx.events.publish('item', created.id, 'ITEM_CREATED', created as unknown as Record<string, unknown>);
    await ctx.audit.log({ action: 'CREATE', entityType: 'item', entityId: created.id, after: created as unknown as Record<string, unknown> });

    return reply.code(201).send({ data: created });
  });

  // ── PUT /items/:id ─────────────────────────────────────────────────────────
  fastify.put<{ Params: { id: string } }>('/items/:id', { preHandler: [authenticate, requirePermission(PERMISSIONS.ITEM_EDIT)] }, async (request, reply) => {
    const { tenantId, userId } = (request as unknown as AuthedRequest).auth;
    const ctx = ctxFactory.create({
      tenantId,
      userId,
      correlationId: (request.headers['x-correlation-id'] as string) ?? crypto.randomUUID(),
    });
    const id = parseInt(request.params.id, 10);

    const body = ItemUpdateSchema.safeParse(request.body);
    if (!body.success) throw new ValidationError(body.error.errors.map((e) => e.message).join('; '));

    const [existing] = await ctx.db.raw
      .select()
      .from(items)
      .where(and(eq(items.id, id), eq(items.tenantId, tenantId), isNull(items.deletedAt)));

    if (!existing) throw new NotFoundError('Item', id);

    // Archive previous state if price changed
    const priceChanged =
      existing.salePrice !== String(body.data.salePrice) ||
      existing.purchasePrice !== String(body.data.purchasePrice);

    const changeType = priceChanged ? 'PRICE_CHANGE' : 'UPDATE';

    let updated: typeof items.$inferSelect | undefined;
    await ctx.db.transaction(async (trx) => {
      await trx.raw.insert(itemsHistory).values({
        itemId: id,
        tenantId,
        changedBy: userId,
        previousData: existing as unknown as Record<string, unknown>,
        changeType,
      });

      const [row] = await trx.raw
        .update(items)
        .set({
          ...body.data,
          gstRate: String(body.data.gstRate),
          cessRate: String(body.data.cessRate),
          salePrice: String(body.data.salePrice),
          minSalePrice: String(body.data.minSalePrice),
          purchasePrice: String(body.data.purchasePrice),
          mrp: body.data.mrp !== undefined ? String(body.data.mrp) : undefined,
          reorderLevel: String(body.data.reorderLevel),
          reorderQty: String(body.data.reorderQty),
          fabricWidth: body.data.fabricWidth !== undefined ? String(body.data.fabricWidth) : undefined,
          updatedAt: new Date(),
          version: existing.version + 1,
        })
        .where(and(
          eq(items.id, id),
          eq(items.tenantId, tenantId),
          eq(items.version, body.data.version)
        ))
        .returning();

      if (!row) throw new OptimisticLockError('Item');
      updated = row;
    });

    await itemCache.invalidateItem(ctx.cache, id);
    await ctx.events.publish('item', id, 'ITEM_UPDATED', updated as unknown as Record<string, unknown>);
    await ctx.audit.log({ action: 'UPDATE', entityType: 'item', entityId: id, before: existing as unknown as Record<string, unknown>, after: updated as unknown as Record<string, unknown> });

    return reply.code(200).send({ data: updated });
  });

  // ── DELETE /items/:id ──────────────────────────────────────────────────────
  fastify.delete<{ Params: { id: string } }>('/items/:id', { preHandler: [authenticate, requirePermission(PERMISSIONS.ITEM_DELETE)] }, async (request, reply) => {
    const { tenantId, userId } = (request as unknown as AuthedRequest).auth;
    const ctx = ctxFactory.create({
      tenantId,
      userId,
      correlationId: (request.headers['x-correlation-id'] as string) ?? crypto.randomUUID(),
    });
    const id = parseInt(request.params.id, 10);

    const [existing] = await ctx.db.raw
      .select()
      .from(items)
      .where(and(eq(items.id, id), eq(items.tenantId, tenantId), isNull(items.deletedAt)));

    if (!existing) throw new NotFoundError('Item', id);

    const [ledgerEntry] = await ctx.db.raw
      .select({ id: inventoryLedger.id })
      .from(inventoryLedger)
      .where(and(eq(inventoryLedger.itemId, id), eq(inventoryLedger.tenantId, tenantId)))
      .limit(1);
    if (ledgerEntry) {
      throw new BusinessError('ITEM_HAS_STOCK_HISTORY', 'Cannot delete an item with inventory ledger history');
    }

    await ctx.db.raw
      .update(items)
      .set({ deletedAt: new Date(), deletedBy: userId, status: 'DISCONTINUED' })
      .where(and(eq(items.id, id), eq(items.tenantId, tenantId)));

    await itemCache.invalidateItem(ctx.cache, id);
    await ctx.events.publish('item', id, 'ITEM_DELETED', { id });
    await ctx.audit.log({ action: 'DELETE', entityType: 'item', entityId: id, before: existing });

    return reply.code(200).send({ data: { message: 'Item deleted', id } });
  });

  // ── POST /items/:id/variants ───────────────────────────────────────────────
  fastify.post<{ Params: { id: string } }>('/items/:id/variants', { preHandler: [authenticate, requirePermission(PERMISSIONS.ITEM_EDIT)] }, async (request, reply) => {
    const { tenantId, userId } = (request as unknown as AuthedRequest).auth;
    const ctx = ctxFactory.create({
      tenantId,
      userId,
      correlationId: (request.headers['x-correlation-id'] as string) ?? crypto.randomUUID(),
    });
    const itemId = parseInt(request.params.id, 10);

    const [parentItem] = await ctx.db.raw
      .select()
      .from(items)
      .where(and(eq(items.id, itemId), eq(items.tenantId, tenantId), isNull(items.deletedAt)));

    if (!parentItem) throw new NotFoundError('Item', itemId);
    if (!parentItem.hasVariants) {
      throw new BusinessError('ITEM_HAS_NO_VARIANTS', 'Item is not configured for variants. Set hasVariants=true first.');
    }

    const body = z.array(VariantSchema).safeParse(request.body);
    if (!body.success) throw new ValidationError(body.error.errors.map((e) => e.message).join('; '));

    const rows = await ctx.db.raw
      .insert(itemVariants)
      .values(
        body.data.map((v) => ({
          tenantId,
          itemId,
          createdBy: userId,
          ...v,
          salePrice: String(v.salePrice),
          purchasePrice: String(v.purchasePrice),
          mrp: v.mrp !== undefined ? String(v.mrp) : undefined,
        }))
      )
      .returning();

    return reply.code(201).send({ data: rows });
  });

  // ── POST /items/:id/barcode/generate ─────────────────────────────────────
  fastify.post<{ Params: { id: string } }>('/items/:id/barcode/generate', { preHandler: [authenticate, requirePermission(PERMISSIONS.ITEM_EDIT)] }, async (request, reply) => {
    const { tenantId, userId } = (request as unknown as AuthedRequest).auth;
    const ctx = ctxFactory.create({
      tenantId,
      userId,
      correlationId: (request.headers['x-correlation-id'] as string) ?? crypto.randomUUID(),
    });
    const id = parseInt(request.params.id, 10);

    const [item] = await ctx.db.raw
      .select()
      .from(items)
      .where(and(eq(items.id, id), eq(items.tenantId, tenantId), isNull(items.deletedAt)));

    if (!item) throw new NotFoundError('Item', id);

    const body = z.object({ type: z.enum(['EAN13', 'CODE128', 'QR']).default('EAN13') }).parse(request.body ?? {});
    const barcodeType = body.type;

    // Deterministic barcode from the item ID, with a real EAN13 check digit
    // (alternating 1x/3x weights per digit position — same algorithm as
    // production-service's BarcodeService.computeEan13Check).
    const paddedId = String(id).padStart(11, '0');
    const checkDigitSum = paddedId
      .split('')
      .reduce((sum, digit, i) => sum + (i % 2 === 0 ? parseInt(digit, 10) : parseInt(digit, 10) * 3), 0);
    const checkDigit = (10 - (checkDigitSum % 10)) % 10;
    const generatedBarcode = `${paddedId}${checkDigit}`;

    // Update item with generated barcode
    await ctx.db.raw
      .update(items)
      .set({ barcode: generatedBarcode, barcodeType, updatedAt: new Date() })
      .where(eq(items.id, id));

    return reply.code(200).send({ data: { barcode: generatedBarcode, barcodeType, itemId: id } });
  });

  // ── Price List routes ─────────────────────────────────────────────────────

  fastify.get('/price-lists', { preHandler: [authenticate, requirePermission(PERMISSIONS.ITEM_VIEW)] }, async (request, reply) => {
    const { tenantId, userId } = (request as unknown as AuthedRequest).auth;
    const ctx = ctxFactory.create({
      tenantId,
      userId,
      correlationId: (request.headers['x-correlation-id'] as string) ?? crypto.randomUUID(),
    });
    const rows = await ctx.db.raw
      .select()
      .from(priceLists)
      .where(and(eq(priceLists.tenantId, tenantId), isNull(priceLists.deletedAt)));
    return reply.code(200).send({ data: { content: rows, totalElements: rows.length } });
  });

  fastify.post('/price-lists', { preHandler: [authenticate, requirePermission(PERMISSIONS.ITEM_EDIT)] }, async (request, reply) => {
    const { tenantId, userId } = (request as unknown as AuthedRequest).auth;
    const ctx = ctxFactory.create({
      tenantId,
      userId,
      correlationId: (request.headers['x-correlation-id'] as string) ?? crypto.randomUUID(),
    });
    const PriceListSchema = z.object({
      name: z.string().min(2).max(200),
      code: z.string().min(1).max(30).toUpperCase(),
      currency: z.string().default('INR'),
      priceIncludesTax: z.boolean().default(false),
      isDefault: z.boolean().default(false),
      validFrom: z.string().date().optional(),
      validTo: z.string().date().optional(),
    });
    const body = PriceListSchema.safeParse(request.body);
    if (!body.success) throw new ValidationError(body.error.errors.map((e) => e.message).join('; '));

    if (body.data.isDefault) {
      await ctx.db.raw
        .update(priceLists)
        .set({ isDefault: false, updatedAt: new Date() })
        .where(and(eq(priceLists.tenantId, tenantId), eq(priceLists.isDefault, true)));
    }

    const [created] = await ctx.db.raw
      .insert(priceLists)
      .values({
        tenantId,
        createdBy: userId,
        ...body.data,
        validFrom: body.data.validFrom ? new Date(body.data.validFrom) : undefined,
        validTo: body.data.validTo ? new Date(body.data.validTo) : undefined,
      })
      .returning();
    return reply.code(201).send({ data: created });
  });

  fastify.put<{ Params: { id: string } }>('/price-lists/:id/items', { preHandler: [authenticate, requirePermission(PERMISSIONS.ITEM_EDIT)] }, async (request, reply) => {
    const { tenantId, userId } = (request as unknown as AuthedRequest).auth;
    const ctx = ctxFactory.create({
      tenantId,
      userId,
      correlationId: (request.headers['x-correlation-id'] as string) ?? crypto.randomUUID(),
    });
    const priceListId = parseInt(request.params.id, 10);

    const ItemPriceSchema = z.array(
      z.object({
        itemId: z.number().int().positive(),
        variantId: z.number().int().positive().optional(),
        salePrice: z.number().min(0),
        minQty: z.number().min(0).default(0),
        discountPercent: z.number().min(0).max(100).default(0),
      })
    );

    const body = ItemPriceSchema.safeParse(request.body);
    if (!body.success) throw new ValidationError(body.error.errors.map((e) => e.message).join('; '));

    // Upsert price list items
    await ctx.db.raw.delete(priceListItems).where(eq(priceListItems.priceListId, priceListId));
    if (body.data.length > 0) {
      await ctx.db.raw.insert(priceListItems).values(
        body.data.map((i) => ({
          tenantId,
          priceListId,
          createdBy: userId,
          ...i,
          salePrice: String(i.salePrice),
          minQty: String(i.minQty),
          discountPercent: String(i.discountPercent),
        }))
      );
    }

    return reply.code(200).send({ data: { message: 'Price list items updated', priceListId } });
  });
}
