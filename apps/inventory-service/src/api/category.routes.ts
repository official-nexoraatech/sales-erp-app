import type { FastifyInstance } from 'fastify';
import type { PlatformContextFactory } from '@erp/sdk';
import { categories } from '@erp/db';
import { and, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { NotFoundError, OptimisticLockError, ValidationError } from '@erp/types';
import { PERMISSIONS } from '@erp/types';
import { authenticate } from '../middleware/authenticate.js';
import { requirePermission } from '../middleware/authorize.js';

const CategorySchema = z.object({
  name: z.string().min(2).max(200),
  code: z.string().max(30).optional(),
  parentId: z.number().int().positive().optional(),
  description: z.string().max(2000).optional(),
  imageUrl: z.string().url().optional().or(z.literal('')),
  sortOrder: z.number().int().default(0),
  isActive: z.boolean().default(true),
});

const CategoryUpdateSchema = CategorySchema.extend({
  version: z.number().int().min(0),
});

type AuthedRequest = { auth: { tenantId: number; userId: number } };

export async function categoryRoutes(
  fastify: FastifyInstance,
  ctxFactory: PlatformContextFactory
): Promise<void> {
  fastify.get('/categories', { preHandler: [authenticate, requirePermission(PERMISSIONS.CATEGORY_VIEW)] }, async (request, reply) => {
    const { tenantId, userId } = (request as unknown as AuthedRequest).auth;
    const ctx = ctxFactory.create({
      tenantId,
      userId,
      correlationId: (request.headers['x-correlation-id'] as string) ?? crypto.randomUUID(),
    });
    const rows = await ctx.db.raw
      .select()
      .from(categories)
      .where(and(eq(categories.tenantId, tenantId), isNull(categories.deletedAt)));
    return reply.code(200).send({ data: { content: rows, totalElements: rows.length } });
  });

  fastify.get<{ Params: { id: string } }>('/categories/:id', { preHandler: [authenticate, requirePermission(PERMISSIONS.CATEGORY_VIEW)] }, async (request, reply) => {
    const { tenantId, userId } = (request as unknown as AuthedRequest).auth;
    const ctx = ctxFactory.create({
      tenantId,
      userId,
      correlationId: (request.headers['x-correlation-id'] as string) ?? crypto.randomUUID(),
    });
    const id = parseInt(request.params.id, 10);
    const [cat] = await ctx.db.raw
      .select()
      .from(categories)
      .where(and(eq(categories.id, id), eq(categories.tenantId, tenantId), isNull(categories.deletedAt)));
    if (!cat) throw new NotFoundError('Category', id);
    return reply.code(200).send({ data: cat });
  });

  fastify.post('/categories', { preHandler: [authenticate, requirePermission(PERMISSIONS.CATEGORY_CREATE)] }, async (request, reply) => {
    const { tenantId, userId } = (request as unknown as AuthedRequest).auth;
    const ctx = ctxFactory.create({
      tenantId,
      userId,
      correlationId: (request.headers['x-correlation-id'] as string) ?? crypto.randomUUID(),
    });
    const body = CategorySchema.safeParse(request.body);
    if (!body.success) throw new ValidationError(body.error.errors.map((e) => e.message).join('; '));
    const [created] = await ctx.db.raw
      .insert(categories)
      .values({ tenantId, createdBy: userId, ...body.data })
      .returning();
    if (!created) throw new Error('Category creation failed');

    await ctx.events.publish('category', created.id, 'CATEGORY_CREATED', created as unknown as Record<string, unknown>);
    await ctx.audit.log({ action: 'CREATE', entityType: 'category', entityId: created.id, after: created as unknown as Record<string, unknown> });

    return reply.code(201).send({ data: created });
  });

  fastify.put<{ Params: { id: string } }>('/categories/:id', { preHandler: [authenticate, requirePermission(PERMISSIONS.CATEGORY_UPDATE)] }, async (request, reply) => {
    const { tenantId, userId } = (request as unknown as AuthedRequest).auth;
    const ctx = ctxFactory.create({
      tenantId,
      userId,
      correlationId: (request.headers['x-correlation-id'] as string) ?? crypto.randomUUID(),
    });
    const id = parseInt(request.params.id, 10);
    const body = CategoryUpdateSchema.safeParse(request.body);
    if (!body.success) throw new ValidationError(body.error.errors.map((e) => e.message).join('; '));
    const [existing] = await ctx.db.raw
      .select()
      .from(categories)
      .where(and(eq(categories.id, id), eq(categories.tenantId, tenantId), isNull(categories.deletedAt)));
    if (!existing) throw new NotFoundError('Category', id);

    const result = await ctx.db.raw
      .update(categories)
      .set({ ...body.data, updatedAt: new Date(), version: existing.version + 1 })
      .where(and(
        eq(categories.id, id),
        eq(categories.tenantId, tenantId),
        eq(categories.version, body.data.version)
      ))
      .returning();

    if (result.length === 0) {
      throw new OptimisticLockError('Category');
    }

    const updated = result[0];
    if (!updated) throw new Error('Category update failed');

    await ctx.events.publish('category', updated.id, 'CATEGORY_UPDATED', updated as unknown as Record<string, unknown>);
    await ctx.audit.log({ action: 'UPDATE', entityType: 'category', entityId: id, before: existing as unknown as Record<string, unknown>, after: updated as unknown as Record<string, unknown> });

    return reply.code(200).send({ data: updated });
  });

  fastify.delete<{ Params: { id: string } }>('/categories/:id', { preHandler: [authenticate, requirePermission(PERMISSIONS.CATEGORY_DELETE)] }, async (request, reply) => {
    const { tenantId, userId } = (request as unknown as AuthedRequest).auth;
    const ctx = ctxFactory.create({
      tenantId,
      userId,
      correlationId: (request.headers['x-correlation-id'] as string) ?? crypto.randomUUID(),
    });
    const id = parseInt(request.params.id, 10);
    const [existing] = await ctx.db.raw
      .select()
      .from(categories)
      .where(and(eq(categories.id, id), eq(categories.tenantId, tenantId), isNull(categories.deletedAt)));
    if (!existing) throw new NotFoundError('Category', id);
    await ctx.db.raw
      .update(categories)
      .set({ deletedAt: new Date(), isActive: false })
      .where(eq(categories.id, id));

    await ctx.audit.log({ action: 'DELETE', entityType: 'category', entityId: id, before: existing });

    return reply.code(200).send({ data: { message: 'Category deleted', id } });
  });
}
