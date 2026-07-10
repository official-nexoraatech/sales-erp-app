import type { FastifyInstance } from 'fastify';
import type { PlatformContextFactory } from '@erp/sdk';
import { brands } from '@erp/db';
import { and, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { NotFoundError, OptimisticLockError, ValidationError } from '@erp/types';
import { PERMISSIONS } from '@erp/types';
import { authenticate } from '../middleware/authenticate.js';
import { requirePermission } from '../middleware/authorize.js';

const BrandSchema = z.object({
  name: z.string().min(2).max(200),
  code: z.string().max(30).optional(),
  logoUrl: z.string().url().optional().or(z.literal('')),
  description: z.string().max(2000).optional(),
  isActive: z.boolean().default(true),
});

const BrandUpdateSchema = BrandSchema.extend({
  version: z.number().int().min(0),
});

type AuthedRequest = { auth: { tenantId: number; userId: number } };

export async function brandRoutes(
  fastify: FastifyInstance,
  ctxFactory: PlatformContextFactory
): Promise<void> {
  fastify.get('/brands', { preHandler: [authenticate, requirePermission(PERMISSIONS.BRAND_VIEW)] }, async (request, reply) => {
    const { tenantId, userId } = (request as unknown as AuthedRequest).auth;
    const ctx = ctxFactory.create({
      tenantId,
      userId,
      correlationId: (request.headers['x-correlation-id'] as string) ?? crypto.randomUUID(),
    });
    const rows = await ctx.db.raw
      .select()
      .from(brands)
      .where(and(eq(brands.tenantId, tenantId), isNull(brands.deletedAt)));
    return reply.code(200).send({ data: { content: rows, totalElements: rows.length } });
  });

  fastify.get<{ Params: { id: string } }>('/brands/:id', { preHandler: [authenticate, requirePermission(PERMISSIONS.BRAND_VIEW)] }, async (request, reply) => {
    const { tenantId, userId } = (request as unknown as AuthedRequest).auth;
    const ctx = ctxFactory.create({
      tenantId,
      userId,
      correlationId: (request.headers['x-correlation-id'] as string) ?? crypto.randomUUID(),
    });
    const id = parseInt(request.params.id, 10);
    const [brand] = await ctx.db.raw
      .select()
      .from(brands)
      .where(and(eq(brands.id, id), eq(brands.tenantId, tenantId), isNull(brands.deletedAt)));
    if (!brand) throw new NotFoundError('Brand', id);
    return reply.code(200).send({ data: brand });
  });

  fastify.post('/brands', { preHandler: [authenticate, requirePermission(PERMISSIONS.BRAND_CREATE)] }, async (request, reply) => {
    const { tenantId, userId } = (request as unknown as AuthedRequest).auth;
    const ctx = ctxFactory.create({
      tenantId,
      userId,
      correlationId: (request.headers['x-correlation-id'] as string) ?? crypto.randomUUID(),
    });
    const body = BrandSchema.safeParse(request.body);
    if (!body.success) throw new ValidationError(body.error.errors.map((e) => e.message).join('; '));
    const [created] = await ctx.db.raw
      .insert(brands)
      .values({ tenantId, createdBy: userId, ...body.data })
      .returning();
    if (!created) throw new Error('Brand creation failed');

    await ctx.events.publish('brand', created.id, 'BRAND_CREATED', created as unknown as Record<string, unknown>);
    await ctx.audit.log({ action: 'CREATE', entityType: 'brand', entityId: created.id, after: created as unknown as Record<string, unknown> });

    return reply.code(201).send({ data: created });
  });

  fastify.put<{ Params: { id: string } }>('/brands/:id', { preHandler: [authenticate, requirePermission(PERMISSIONS.BRAND_UPDATE)] }, async (request, reply) => {
    const { tenantId, userId } = (request as unknown as AuthedRequest).auth;
    const ctx = ctxFactory.create({
      tenantId,
      userId,
      correlationId: (request.headers['x-correlation-id'] as string) ?? crypto.randomUUID(),
    });
    const id = parseInt(request.params.id, 10);
    const body = BrandUpdateSchema.safeParse(request.body);
    if (!body.success) throw new ValidationError(body.error.errors.map((e) => e.message).join('; '));
    const [existing] = await ctx.db.raw
      .select()
      .from(brands)
      .where(and(eq(brands.id, id), eq(brands.tenantId, tenantId), isNull(brands.deletedAt)));
    if (!existing) throw new NotFoundError('Brand', id);

    const result = await ctx.db.raw
      .update(brands)
      .set({ ...body.data, updatedAt: new Date(), version: existing.version + 1 })
      .where(and(
        eq(brands.id, id),
        eq(brands.tenantId, tenantId),
        eq(brands.version, body.data.version)
      ))
      .returning();

    if (result.length === 0) {
      throw new OptimisticLockError('Brand');
    }

    const updated = result[0];
    if (!updated) throw new Error('Brand update failed');

    await ctx.events.publish('brand', updated.id, 'BRAND_UPDATED', updated as unknown as Record<string, unknown>);
    await ctx.audit.log({ action: 'UPDATE', entityType: 'brand', entityId: id, before: existing as unknown as Record<string, unknown>, after: updated as unknown as Record<string, unknown> });

    return reply.code(200).send({ data: updated });
  });

  fastify.delete<{ Params: { id: string } }>('/brands/:id', { preHandler: [authenticate, requirePermission(PERMISSIONS.BRAND_UPDATE)] }, async (request, reply) => {
    const { tenantId, userId } = (request as unknown as AuthedRequest).auth;
    const ctx = ctxFactory.create({
      tenantId,
      userId,
      correlationId: (request.headers['x-correlation-id'] as string) ?? crypto.randomUUID(),
    });
    const id = parseInt(request.params.id, 10);
    const [existing] = await ctx.db.raw
      .select()
      .from(brands)
      .where(and(eq(brands.id, id), eq(brands.tenantId, tenantId), isNull(brands.deletedAt)));
    if (!existing) throw new NotFoundError('Brand', id);
    await ctx.db.raw
      .update(brands)
      .set({ deletedAt: new Date(), isActive: false })
      .where(eq(brands.id, id));

    await ctx.audit.log({ action: 'DELETE', entityType: 'brand', entityId: id, before: existing });
    await ctx.events.publish('brand', id, 'BRAND_DELETED', { id });

    return reply.code(200).send({ data: { message: 'Brand deleted', id } });
  });
}
