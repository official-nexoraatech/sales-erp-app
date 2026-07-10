import type { FastifyInstance } from 'fastify';
import { branches } from '@erp/db';
import { and, eq, isNull, or, ilike, sql } from 'drizzle-orm';
import { z } from 'zod';
import { BusinessError, NotFoundError, ValidationError } from '@erp/types';
import { PERMISSIONS, OptionalGSTINSchema } from '@erp/types';
import type { PlatformContextFactory } from '@erp/sdk';
import { authenticate } from '../middleware/authenticate.js';
import { requirePermission } from '../middleware/authorize.js';

const BranchSchema = z.object({
  name: z.string().min(2).max(200),
  code: z.string().min(1).max(20).toUpperCase(),
  address: z
    .object({
      line1: z.string().min(1),
      line2: z.string().optional(),
      city: z.string().min(1),
      state: z.string().min(1),
      pincode: z.string().regex(/^[1-9][0-9]{5}$/, 'Pincode must be 6 digits'),
    })
    .optional(),
  phone: z.string().max(20).optional(),
  email: z.string().email().optional().or(z.literal('')),
  gstin: OptionalGSTINSchema,
  isHeadOffice: z.boolean().default(false),
  isActive: z.boolean().default(true),
  version: z.number().int().min(0).optional(),
});

export async function branchRoutes(
  fastify: FastifyInstance,
  ctxFactory: PlatformContextFactory
): Promise<void> {
  function ctxFor(request: { auth: { tenantId: number; userId: number }; headers: Record<string, unknown> }): ReturnType<PlatformContextFactory['create']> {
    const correlationId = (request.headers['x-correlation-id'] as string | undefined) ?? crypto.randomUUID();
    return ctxFactory.create({ tenantId: request.auth.tenantId, userId: request.auth.userId, correlationId });
  }

  // PG-013: GET /branches used to return every field (GSTIN, address, phone, email) to
  // any authenticated user regardless of role. Several forms across the app (invoice/PO/
  // customer creation etc.) fetch this endpoint unpaginated just to populate an id/name
  // branch dropdown, gated only on each page's own feature permission, not BRANCH_VIEW —
  // so the route can't be blanket-gated without breaking those. Instead, strip the
  // sensitive fields unless the caller holds BRANCH_VIEW, mirroring the same pattern
  // already used on GET /organization.
  function projectBranch(branch: typeof branches.$inferSelect, permissions: string[]): typeof branches.$inferSelect | Record<string, unknown> {
    if (permissions.includes(PERMISSIONS.BRANCH_VIEW)) return branch;
    return {
      id: branch.id,
      tenantId: branch.tenantId,
      name: branch.name,
      code: branch.code,
      isHeadOffice: branch.isHeadOffice,
      isActive: branch.isActive,
      createdAt: branch.createdAt,
      updatedAt: branch.updatedAt,
      version: branch.version,
    };
  }

  // ── GET /branches ─────────────────────────────────────────────────────────
  // page/size/search are optional and only paginate when passed — several other
  // pages (invoice/PO/customer forms etc.) call this unpaginated to populate branch
  // dropdowns and expect the full list back.
  fastify.get('/branches', { preHandler: [authenticate] }, async (request, reply) => {
    const { tenantId, permissions } = request.auth;
    const ctx = ctxFor(request);
    const query = request.query as { page?: string; size?: string; search?: string };

    let whereClause = and(eq(branches.tenantId, tenantId), isNull(branches.deletedAt));
    if (query.search) {
      whereClause = and(
        whereClause,
        or(ilike(branches.name, `%${query.search}%`), ilike(branches.code, `%${query.search}%`))
      );
    }

    if (query.page !== undefined || query.size !== undefined) {
      const page = Math.max(0, parseInt(query.page ?? '0', 10));
      const size = Math.min(100, parseInt(query.size ?? '20', 10));

      const rows = await ctx.db.raw.select().from(branches).where(whereClause).limit(size).offset(page * size);
      const [countRow] = await ctx.db.raw.select({ count: sql<number>`count(*)::int` }).from(branches).where(whereClause);

      return reply.code(200).send({ data: { content: rows.map((r) => projectBranch(r, permissions)), totalElements: countRow?.count ?? 0, page, size } });
    }

    const rows = await ctx.db.raw.select().from(branches).where(whereClause);
    return reply.code(200).send({
      data: { content: rows.map((r) => projectBranch(r, permissions)), totalElements: rows.length },
    });
  });

  // ── GET /branches/:id ─────────────────────────────────────────────────────
  fastify.get<{ Params: { id: string } }>('/branches/:id', { preHandler: [authenticate] }, async (request, reply) => {
    const { tenantId, permissions } = request.auth;
    const ctx = ctxFor(request);
    const id = parseInt(request.params.id, 10);

    const [branch] = await ctx.db.raw
      .select()
      .from(branches)
      .where(and(eq(branches.id, id), eq(branches.tenantId, tenantId), isNull(branches.deletedAt)));

    if (!branch) throw new NotFoundError('Branch', id);
    return reply.code(200).send({ data: projectBranch(branch, permissions) });
  });

  // ── POST /branches ────────────────────────────────────────────────────────
  fastify.post('/branches', { preHandler: [authenticate, requirePermission(PERMISSIONS.BRANCH_MANAGE)] }, async (request, reply) => {
    const { tenantId, userId } = request.auth;
    const ctx = ctxFor(request);

    const body = BranchSchema.safeParse(request.body);
    if (!body.success) {
      throw new ValidationError(body.error.errors.map((e) => e.message).join('; '));
    }

    if (body.data.isHeadOffice) {
      await ctx.db.raw
        .update(branches)
        .set({ isHeadOffice: false, updatedAt: new Date() })
        .where(and(eq(branches.tenantId, tenantId), eq(branches.isHeadOffice, true)));
    }

    const [created] = await ctx.db.raw
      .insert(branches)
      .values({ tenantId, createdBy: userId, ...body.data } as unknown as typeof branches.$inferInsert)
      .returning();

    if (created) {
      await ctx.events.publish('branch', created.id, 'BRANCH_CREATED', created as unknown as Record<string, unknown>);
    }

    return reply.code(201).send({ data: created });
  });

  // ── PUT /branches/:id ─────────────────────────────────────────────────────
  fastify.put<{ Params: { id: string } }>('/branches/:id', { preHandler: [authenticate, requirePermission(PERMISSIONS.BRANCH_MANAGE)] }, async (request, reply) => {
    const { tenantId, userId } = request.auth;
    const ctx = ctxFor(request);
    const id = parseInt(request.params.id, 10);

    const body = BranchSchema.safeParse(request.body);
    if (!body.success) {
      throw new ValidationError(body.error.errors.map((e) => e.message).join('; '));
    }

    const [existing] = await ctx.db.raw
      .select()
      .from(branches)
      .where(and(eq(branches.id, id), eq(branches.tenantId, tenantId), isNull(branches.deletedAt)));

    if (!existing) throw new NotFoundError('Branch', id);

    if (body.data.version !== undefined && existing.version !== body.data.version) {
      const { OptimisticLockError } = await import('@erp/types');
      throw new OptimisticLockError('Branch');
    }

    if (body.data.isHeadOffice && !existing.isHeadOffice) {
      await ctx.db.raw
        .update(branches)
        .set({ isHeadOffice: false, updatedAt: new Date() })
        .where(
          and(
            eq(branches.tenantId, tenantId),
            eq(branches.isHeadOffice, true)
          )
        );
    }

    const [updated] = await ctx.db.raw
      .update(branches)
      .set({
        ...body.data,
        updatedAt: new Date(),
        updatedBy: userId,
        version: existing.version + 1,
      } as unknown as Partial<typeof branches.$inferInsert>)
      .where(eq(branches.id, id))
      .returning();

    if (updated) {
      await ctx.events.publish('branch', id, 'BRANCH_UPDATED', updated as unknown as Record<string, unknown>);
    }

    return reply.code(200).send({ data: updated });
  });

  // ── DELETE /branches/:id ──────────────────────────────────────────────────
  fastify.delete<{ Params: { id: string } }>('/branches/:id', { preHandler: [authenticate, requirePermission(PERMISSIONS.BRANCH_MANAGE)] }, async (request, reply) => {
    const { tenantId, userId } = request.auth;
    const ctx = ctxFor(request);
    const id = parseInt(request.params.id, 10);

    const [existing] = await ctx.db.raw
      .select()
      .from(branches)
      .where(and(eq(branches.id, id), eq(branches.tenantId, tenantId), isNull(branches.deletedAt)));

    if (!existing) throw new NotFoundError('Branch', id);
    if (existing.isHeadOffice) {
      throw new BusinessError('CANNOT_DELETE_HEAD_OFFICE', 'Cannot delete the head office branch');
    }

    await ctx.db.raw
      .update(branches)
      .set({ deletedAt: new Date(), deletedBy: userId, isActive: false })
      .where(eq(branches.id, id));

    await ctx.events.publish('branch', id, 'BRANCH_DELETED', { id });

    return reply.code(200).send({ data: { message: 'Branch deleted', id } });
  });
}
