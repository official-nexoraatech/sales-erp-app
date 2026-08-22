import type { FastifyInstance } from 'fastify';
import { branches } from '@erp/db';
import { and, eq, isNull, or, ilike, sql } from 'drizzle-orm';
import { z } from 'zod';
import { BusinessError, NotFoundError, ValidationError } from '@erp/types';
import { PERMISSIONS, OptionalGSTINSchema } from '@erp/types';
import type { PlatformContextFactory } from '@erp/sdk';
import { assertUnderBranchLimit, acquireTenantLimitLock, tenantScopedHandler } from '@erp/sdk';
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

// Phase 9 GUC-per-request rollout — migrated 2026-08-21. No external I/O —
// acquireTenantLimitLock/assertUnderBranchLimit are pure DB helper functions.
export async function branchRoutes(
  fastify: FastifyInstance,
  ctxFactory: PlatformContextFactory
): Promise<void> {
  // PG-013: GET /branches used to return every field (GSTIN, address, phone, email) to
  // any authenticated user regardless of role. Several forms across the app (invoice/PO/
  // customer creation etc.) fetch this endpoint unpaginated just to populate an id/name
  // branch dropdown, gated only on each page's own feature permission, not BRANCH_VIEW —
  // so the route can't be blanket-gated without breaking those. Instead, strip the
  // sensitive fields unless the caller holds BRANCH_VIEW, mirroring the same pattern
  // already used on GET /organization.
  function projectBranch(
    branch: typeof branches.$inferSelect,
    permissions: string[]
  ): typeof branches.$inferSelect | Record<string, unknown> {
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
  fastify.get(
    '/branches',
    { preHandler: [authenticate] },
    tenantScopedHandler(ctxFactory, async (request, reply, ctx) => {
      const { tenantId } = ctx.tenant;
      const { permissions } = request.auth;
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

        const rows = await ctx.db.raw
          .select()
          .from(branches)
          .where(whereClause)
          .limit(size)
          .offset(page * size);
        const [countRow] = await ctx.db.raw
          .select({ count: sql<number>`count(*)::int` })
          .from(branches)
          .where(whereClause);

        return reply.code(200).send({
          data: {
            content: rows.map((r) => projectBranch(r, permissions)),
            totalElements: countRow?.count ?? 0,
            page,
            size,
          },
        });
      }

      const rows = await ctx.db.raw.select().from(branches).where(whereClause);
      return reply.code(200).send({
        data: {
          content: rows.map((r) => projectBranch(r, permissions)),
          totalElements: rows.length,
        },
      });
    })
  );

  // ── GET /branches/:id ─────────────────────────────────────────────────────
  fastify.get(
    '/branches/:id',
    { preHandler: [authenticate] },
    tenantScopedHandler(ctxFactory, async (request, reply, ctx) => {
      const { tenantId } = ctx.tenant;
      const { permissions } = request.auth;
      const id = parseInt((request.params as { id: string }).id, 10);

      const [branch] = await ctx.db.raw
        .select()
        .from(branches)
        .where(
          and(eq(branches.id, id), eq(branches.tenantId, tenantId), isNull(branches.deletedAt))
        );

      if (!branch) throw new NotFoundError('Branch', id);
      return reply.code(200).send({ data: projectBranch(branch, permissions) });
    })
  );

  // ── POST /branches ────────────────────────────────────────────────────────
  fastify.post(
    '/branches',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.BRANCH_MANAGE)] },
    tenantScopedHandler(ctxFactory, async (request, reply, ctx) => {
      const { tenantId, userId } = ctx.tenant;

      const body = BranchSchema.safeParse(request.body);
      if (!body.success) {
        throw new ValidationError(body.error.errors.map((e) => e.message).join('; '));
      }

      // Regression guard (TOCTOU race): the limit check and the insert must happen inside
      // the same transaction, serialized per-tenant by an advisory lock — otherwise two
      // concurrent requests can both pass the count check right at the cap and jointly
      // overshoot the plan's maxBranches limit before either insert commits.
      const created = await ctx.db.transaction(async (trx) => {
        await acquireTenantLimitLock(trx.raw, tenantId, 'maxBranches');
        await assertUnderBranchLimit(trx.raw, tenantId);

        if (body.data.isHeadOffice) {
          await trx.raw
            .update(branches)
            .set({ isHeadOffice: false, updatedAt: new Date() })
            .where(and(eq(branches.tenantId, tenantId), eq(branches.isHeadOffice, true)));
        }

        const [row] = await trx.raw
          .insert(branches)
          .values({
            tenantId,
            createdBy: userId,
            ...body.data,
          } as unknown as typeof branches.$inferInsert)
          .returning();
        return row;
      });

      if (created) {
        await ctx.events.publish(
          'branch',
          created.id,
          'BRANCH_CREATED',
          created as unknown as Record<string, unknown>
        );
        await ctx.audit.log({
          action: 'CREATE',
          entityType: 'branch',
          entityId: created.id,
          after: created as unknown as Record<string, unknown>,
          actorEmail: request.auth.email,
          ipAddress: request.ip,
        });
      }

      return reply.code(201).send({ data: created });
    })
  );

  // ── PUT /branches/:id ─────────────────────────────────────────────────────
  fastify.put(
    '/branches/:id',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.BRANCH_MANAGE)] },
    tenantScopedHandler(ctxFactory, async (request, reply, ctx) => {
      const { tenantId, userId } = ctx.tenant;
      const id = parseInt((request.params as { id: string }).id, 10);

      const body = BranchSchema.safeParse(request.body);
      if (!body.success) {
        throw new ValidationError(body.error.errors.map((e) => e.message).join('; '));
      }

      const [existing] = await ctx.db.raw
        .select()
        .from(branches)
        .where(
          and(eq(branches.id, id), eq(branches.tenantId, tenantId), isNull(branches.deletedAt))
        );

      if (!existing) throw new NotFoundError('Branch', id);

      if (body.data.version !== undefined && existing.version !== body.data.version) {
        const { OptimisticLockError } = await import('@erp/types');
        throw new OptimisticLockError('Branch');
      }

      if (body.data.isHeadOffice && !existing.isHeadOffice) {
        await ctx.db.raw
          .update(branches)
          .set({ isHeadOffice: false, updatedAt: new Date() })
          .where(and(eq(branches.tenantId, tenantId), eq(branches.isHeadOffice, true)));
      }

      const [updated] = await ctx.db.raw
        .update(branches)
        .set({
          ...body.data,
          updatedAt: new Date(),
          updatedBy: userId,
          version: existing.version + 1,
        } as unknown as Partial<typeof branches.$inferInsert>)
        // Defense-in-depth (F19): re-include tenantId in the mutating statement itself,
        // rather than relying solely on the preceding SELECT having proven ownership —
        // the write is now tenant-scoped on its own, not just via control flow.
        .where(and(eq(branches.id, id), eq(branches.tenantId, tenantId)))
        .returning();

      if (updated) {
        await ctx.events.publish(
          'branch',
          id,
          'BRANCH_UPDATED',
          updated as unknown as Record<string, unknown>
        );
        await ctx.audit.log({
          action: 'UPDATE',
          entityType: 'branch',
          entityId: id,
          before: existing as unknown as Record<string, unknown>,
          after: updated as unknown as Record<string, unknown>,
          actorEmail: request.auth.email,
          ipAddress: request.ip,
        });
      }

      return reply.code(200).send({ data: updated });
    })
  );

  // ── DELETE /branches/:id ──────────────────────────────────────────────────
  fastify.delete(
    '/branches/:id',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.BRANCH_MANAGE)] },
    tenantScopedHandler(ctxFactory, async (request, reply, ctx) => {
      const { tenantId, userId } = ctx.tenant;
      const id = parseInt((request.params as { id: string }).id, 10);

      const [existing] = await ctx.db.raw
        .select()
        .from(branches)
        .where(
          and(eq(branches.id, id), eq(branches.tenantId, tenantId), isNull(branches.deletedAt))
        );

      if (!existing) throw new NotFoundError('Branch', id);
      if (existing.isHeadOffice) {
        throw new BusinessError(
          'CANNOT_DELETE_HEAD_OFFICE',
          'Cannot delete the head office branch'
        );
      }

      await ctx.db.raw
        .update(branches)
        .set({ deletedAt: new Date(), deletedBy: userId, isActive: false })
        // Defense-in-depth (F19): see the matching comment on PUT /branches/:id above.
        .where(and(eq(branches.id, id), eq(branches.tenantId, tenantId)));

      await ctx.events.publish('branch', id, 'BRANCH_DELETED', { id });
      await ctx.audit.log({
        action: 'DELETE',
        entityType: 'branch',
        entityId: id,
        before: existing as unknown as Record<string, unknown>,
        after: { isActive: false },
        actorEmail: request.auth.email,
        ipAddress: request.ip,
      });

      return reply.code(200).send({ data: { message: 'Branch deleted', id } });
    })
  );
}
