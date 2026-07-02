import type { FastifyInstance } from 'fastify';
import type { PlatformContextFactory } from '@erp/sdk';
import { warehouses } from '@erp/db';
import { and, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { BusinessError, NotFoundError, OptimisticLockError, ValidationError } from '@erp/types';
import { PERMISSIONS } from '@erp/types';
import { authenticate } from '../middleware/authenticate.js';
import { requirePermission } from '../middleware/authorize.js';

const WarehouseSchema = z.object({
  name: z.string().min(2).max(200),
  code: z.string().min(1).max(20).toUpperCase(),
  branchId: z.number().int().positive(),
  address: z
    .object({
      line1: z.string().min(1),
      line2: z.string().optional(),
      city: z.string().min(1),
      state: z.string().min(1),
      pincode: z.string().regex(/^\d{6}$/, 'Pincode must be 6 digits'),
    })
    .optional(),
  isDefault: z.boolean().default(false),
  isActive: z.boolean().default(true),
});

const WarehouseUpdateSchema = WarehouseSchema.extend({
  version: z.number().int().min(0),
});

type AuthedRequest = {
  auth: { tenantId: number; userId: number };
};

export async function warehouseRoutes(
  fastify: FastifyInstance,
  ctxFactory: PlatformContextFactory
): Promise<void> {
  // ── GET /warehouses ───────────────────────────────────────────────────────
  fastify.get('/warehouses', { preHandler: [authenticate, requirePermission(PERMISSIONS.WAREHOUSE_VIEW)] }, async (request, reply) => {
    const { tenantId } = (request as unknown as AuthedRequest).auth;
    const ctx = ctxFactory.create({
      tenantId,
      userId: (request as unknown as AuthedRequest).auth.userId,
      correlationId: (request.headers['x-correlation-id'] as string) ?? crypto.randomUUID(),
    });
    const query = request.query as { branchId?: string };

    let whereClause = and(eq(warehouses.tenantId, tenantId), isNull(warehouses.deletedAt));
    if (query.branchId) {
      const bId = parseInt(query.branchId, 10);
      whereClause = and(whereClause, eq(warehouses.branchId, bId));
    }

    const rows = await ctx.db.raw.select().from(warehouses).where(whereClause);
    return reply.code(200).send({ data: { content: rows, totalElements: rows.length } });
  });

  // ── GET /warehouses/:id ───────────────────────────────────────────────────
  fastify.get<{ Params: { id: string } }>('/warehouses/:id', { preHandler: [authenticate, requirePermission(PERMISSIONS.WAREHOUSE_VIEW)] }, async (request, reply) => {
    const { tenantId } = (request as unknown as AuthedRequest).auth;
    const ctx = ctxFactory.create({
      tenantId,
      userId: (request as unknown as AuthedRequest).auth.userId,
      correlationId: (request.headers['x-correlation-id'] as string) ?? crypto.randomUUID(),
    });
    const id = parseInt(request.params.id, 10);

    const [wh] = await ctx.db.raw
      .select()
      .from(warehouses)
      .where(and(eq(warehouses.id, id), eq(warehouses.tenantId, tenantId), isNull(warehouses.deletedAt)));

    if (!wh) throw new NotFoundError('Warehouse', id);
    return reply.code(200).send({ data: wh });
  });

  // ── POST /warehouses ──────────────────────────────────────────────────────
  fastify.post('/warehouses', { preHandler: [authenticate, requirePermission(PERMISSIONS.WAREHOUSE_MANAGE)] }, async (request, reply) => {
    const { tenantId, userId } = (request as unknown as AuthedRequest).auth;
    const ctx = ctxFactory.create({
      tenantId,
      userId,
      correlationId: (request.headers['x-correlation-id'] as string) ?? crypto.randomUUID(),
    });

    const body = WarehouseSchema.safeParse(request.body);
    if (!body.success) throw new ValidationError(body.error.errors.map((e) => e.message).join('; '));

    if (body.data.isDefault) {
      await ctx.db.raw
        .update(warehouses)
        .set({ isDefault: false, updatedAt: new Date() })
        .where(
          and(eq(warehouses.tenantId, tenantId), eq(warehouses.branchId, body.data.branchId), eq(warehouses.isDefault, true))
        );
    }

    const [created] = await ctx.db.raw
      .insert(warehouses)
      .values({ tenantId, createdBy: userId, ...body.data } as unknown as typeof warehouses.$inferInsert)
      .returning();
    if (!created) throw new Error('Warehouse creation failed');

    await ctx.events.publish('warehouse', created.id, 'WAREHOUSE_CREATED', created as unknown as Record<string, unknown>);
    await ctx.audit.log({ action: 'CREATE', entityType: 'warehouse', entityId: created.id, after: created as unknown as Record<string, unknown> });

    return reply.code(201).send({ data: created });
  });

  // ── PUT /warehouses/:id ───────────────────────────────────────────────────
  fastify.put<{ Params: { id: string } }>('/warehouses/:id', { preHandler: [authenticate, requirePermission(PERMISSIONS.WAREHOUSE_MANAGE)] }, async (request, reply) => {
    const { tenantId, userId } = (request as unknown as AuthedRequest).auth;
    const ctx = ctxFactory.create({
      tenantId,
      userId,
      correlationId: (request.headers['x-correlation-id'] as string) ?? crypto.randomUUID(),
    });
    const id = parseInt(request.params.id, 10);

    const body = WarehouseUpdateSchema.safeParse(request.body);
    if (!body.success) throw new ValidationError(body.error.errors.map((e) => e.message).join('; '));

    const [existing] = await ctx.db.raw
      .select()
      .from(warehouses)
      .where(and(eq(warehouses.id, id), eq(warehouses.tenantId, tenantId), isNull(warehouses.deletedAt)));

    if (!existing) throw new NotFoundError('Warehouse', id);

    if (body.data.isDefault && !existing.isDefault) {
      await ctx.db.raw
        .update(warehouses)
        .set({ isDefault: false, updatedAt: new Date() })
        .where(
          and(eq(warehouses.tenantId, tenantId), eq(warehouses.branchId, existing.branchId), eq(warehouses.isDefault, true))
        );
    }

    const result = await ctx.db.raw
      .update(warehouses)
      .set({ ...body.data, updatedAt: new Date(), version: existing.version + 1 } as unknown as Partial<typeof warehouses.$inferInsert>)
      .where(and(
        eq(warehouses.id, id),
        eq(warehouses.tenantId, tenantId),
        eq(warehouses.version, body.data.version)
      ))
      .returning();

    if (result.length === 0) {
      throw new OptimisticLockError('Warehouse');
    }

    const updated = result[0];
    if (!updated) throw new Error('Warehouse update failed');

    await ctx.events.publish('warehouse', updated.id, 'WAREHOUSE_UPDATED', updated as unknown as Record<string, unknown>);
    await ctx.audit.log({ action: 'UPDATE', entityType: 'warehouse', entityId: id, before: existing as unknown as Record<string, unknown>, after: updated as unknown as Record<string, unknown> });

    return reply.code(200).send({ data: updated });
  });

  // ── DELETE /warehouses/:id ────────────────────────────────────────────────
  // Guard: cannot delete warehouse that has stock
  fastify.delete<{ Params: { id: string } }>('/warehouses/:id', { preHandler: [authenticate, requirePermission(PERMISSIONS.WAREHOUSE_MANAGE)] }, async (request, reply) => {
    const { tenantId, userId } = (request as unknown as AuthedRequest).auth;
    const ctx = ctxFactory.create({
      tenantId,
      userId,
      correlationId: (request.headers['x-correlation-id'] as string) ?? crypto.randomUUID(),
    });
    const id = parseInt(request.params.id, 10);

    const [existing] = await ctx.db.raw
      .select()
      .from(warehouses)
      .where(and(eq(warehouses.id, id), eq(warehouses.tenantId, tenantId), isNull(warehouses.deletedAt)));

    if (!existing) throw new NotFoundError('Warehouse', id);
    if (existing.isDefault) {
      throw new BusinessError('CANNOT_DELETE_DEFAULT_WAREHOUSE', 'Cannot delete the default warehouse');
    }

    // TODO Phase 4: check inventory_ledger for stock in this warehouse

    await ctx.db.raw
      .update(warehouses)
      .set({ deletedAt: new Date(), deletedBy: userId, isActive: false })
      .where(eq(warehouses.id, id));

    await ctx.audit.log({ action: 'DELETE', entityType: 'warehouse', entityId: id, before: existing });

    return reply.code(200).send({ data: { message: 'Warehouse deleted', id } });
  });
}
