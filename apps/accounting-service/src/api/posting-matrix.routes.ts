import type { FastifyInstance } from 'fastify';
import type { PlatformContextFactory } from '@erp/sdk';
import { tenantScopedHandler } from '@erp/sdk';
import { z } from 'zod';
import { eq, and } from 'drizzle-orm';
import { postingMatrix } from '@erp/db';
import { NotFoundError, ValidationError } from '@erp/types';
import { PERMISSIONS } from '@erp/types';
import { authenticate } from '../middleware/authenticate.js';
import { requirePermission } from '../middleware/authorize.js';
import { PostingMatrixService } from '../domain/PostingMatrixService.js';

const CreateRuleSchema = z.object({
  eventType: z.string().min(1).max(100),
  lineLabel: z.string().max(100).optional(),
  debitAccountCode: z.string().min(1).max(30),
  creditAccountCode: z.string().min(1).max(30),
  description: z.string().max(500).optional(),
  sortOrder: z.number().int().min(0).default(0),
});

// Phase 9 GUC-per-request rollout — migrated 2026-08-21. No post-hoc side effects, no external
// I/O.
export async function postingMatrixRoutes(
  fastify: FastifyInstance,
  ctxFactory: PlatformContextFactory
): Promise<void> {
  // ── GET /posting-matrix ───────────────────────────────────────────────────
  fastify.get(
    '/posting-matrix',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.POSTING_MATRIX_VIEW)] },
    tenantScopedHandler(ctxFactory, async (_request, reply, ctx) => {
      const rows = await ctx.db.raw
        .select()
        .from(postingMatrix)
        .where(eq(postingMatrix.tenantId, ctx.tenant.tenantId));

      return reply.code(200).send({ data: { content: rows, totalElements: rows.length } });
    })
  );

  // ── POST /posting-matrix ──────────────────────────────────────────────────
  fastify.post(
    '/posting-matrix',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.POSTING_MATRIX_UPDATE)] },
    tenantScopedHandler(ctxFactory, async (request, reply, ctx) => {
      const body = CreateRuleSchema.safeParse(request.body);
      if (!body.success)
        throw new ValidationError(body.error.errors.map((e) => e.message).join('; '));

      const [created] = await ctx.db.raw
        .insert(postingMatrix)
        .values({
          tenantId: ctx.tenant.tenantId,
          eventType: body.data.eventType,
          lineLabel: body.data.lineLabel,
          debitAccountCode: body.data.debitAccountCode,
          creditAccountCode: body.data.creditAccountCode,
          description: body.data.description,
          sortOrder: body.data.sortOrder,
          isActive: true,
          createdBy: ctx.tenant.userId,
        } as typeof postingMatrix.$inferInsert)
        .returning();

      return reply.code(201).send({ data: created });
    })
  );

  // ── PUT /posting-matrix/:id ───────────────────────────────────────────────
  fastify.put<{ Params: { id: string } }>(
    '/posting-matrix/:id',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.POSTING_MATRIX_UPDATE)] },
    tenantScopedHandler(ctxFactory, async (request, reply, ctx) => {
      const { id: idParam } = request.params as { id: string };
      const id = parseInt(idParam, 10);

      const body = CreateRuleSchema.safeParse(request.body);
      if (!body.success)
        throw new ValidationError(body.error.errors.map((e) => e.message).join('; '));

      const [updated] = await ctx.db.raw
        .update(postingMatrix)
        .set({
          eventType: body.data.eventType,
          lineLabel: body.data.lineLabel,
          debitAccountCode: body.data.debitAccountCode,
          creditAccountCode: body.data.creditAccountCode,
          description: body.data.description,
          sortOrder: body.data.sortOrder,
        })
        .where(and(eq(postingMatrix.id, id), eq(postingMatrix.tenantId, ctx.tenant.tenantId)))
        .returning();

      if (!updated) throw new NotFoundError('PostingMatrix', id);
      return reply.code(200).send({ data: updated });
    })
  );

  // ── DELETE /posting-matrix/:id (soft delete — deactivate) ─────────────────
  fastify.delete<{ Params: { id: string } }>(
    '/posting-matrix/:id',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.POSTING_MATRIX_UPDATE)] },
    tenantScopedHandler(ctxFactory, async (request, reply, ctx) => {
      const { id: idParam } = request.params as { id: string };
      const id = parseInt(idParam, 10);

      const [deleted] = await ctx.db.raw
        .update(postingMatrix)
        .set({ isActive: false })
        .where(and(eq(postingMatrix.id, id), eq(postingMatrix.tenantId, ctx.tenant.tenantId)))
        .returning();

      if (!deleted) throw new NotFoundError('PostingMatrix', id);
      return reply.code(200).send({ data: { message: 'Rule deactivated', id } });
    })
  );

  // ── POST /posting-matrix/seed ─────────────────────────────────────────────
  fastify.post(
    '/posting-matrix/seed',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.POSTING_MATRIX_UPDATE)] },
    tenantScopedHandler(ctxFactory, async (_request, reply, ctx) => {
      const count = await PostingMatrixService.seedDefaults(
        ctx.db,
        ctx.tenant.tenantId,
        ctx.tenant.userId
      );
      return reply.code(200).send({ data: { message: 'Default posting rules seeded', count } });
    })
  );
}
