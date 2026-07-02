import type { FastifyInstance } from 'fastify';
import type { ErpDatabase } from '@erp/db';
import { branches } from '@erp/db';
import { and, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { BusinessError, NotFoundError, ValidationError } from '@erp/types';
import { PERMISSIONS } from '@erp/types';
import { authenticate } from '../middleware/authenticate.js';
import { requirePermission } from '../middleware/authorize.js';

const GSTIN_REGEX = /^\d{2}[A-Z]{5}\d{4}[A-Z]{1}[A-Z\d]{1}[Z]{1}[A-Z\d]{1}$/;

const BranchSchema = z.object({
  name: z.string().min(2).max(200),
  code: z.string().min(1).max(20).toUpperCase(),
  address: z
    .object({
      line1: z.string().min(1),
      line2: z.string().optional(),
      city: z.string().min(1),
      state: z.string().min(1),
      pincode: z.string().regex(/^\d{6}$/, 'Pincode must be 6 digits'),
    })
    .optional(),
  phone: z.string().max(20).optional(),
  email: z.string().email().optional().or(z.literal('')),
  gstin: z
    .string()
    .regex(GSTIN_REGEX, 'Invalid GSTIN format')
    .optional()
    .or(z.literal('')),
  isHeadOffice: z.boolean().default(false),
  isActive: z.boolean().default(true),
  version: z.number().int().min(0).optional(),
});

export async function branchRoutes(
  fastify: FastifyInstance,
  db: ErpDatabase
): Promise<void> {
  // ── GET /branches ─────────────────────────────────────────────────────────
  fastify.get('/branches', { preHandler: [authenticate] }, async (request, reply) => {
    const { tenantId } = request.auth;

    const rows = await db
      .select()
      .from(branches)
      .where(and(eq(branches.tenantId, tenantId), isNull(branches.deletedAt)));

    return reply.code(200).send({
      data: { content: rows, totalElements: rows.length },
    });
  });

  // ── GET /branches/:id ─────────────────────────────────────────────────────
  fastify.get<{ Params: { id: string } }>('/branches/:id', { preHandler: [authenticate] }, async (request, reply) => {
    const { tenantId } = request.auth;
    const id = parseInt(request.params.id, 10);

    const [branch] = await db
      .select()
      .from(branches)
      .where(and(eq(branches.id, id), eq(branches.tenantId, tenantId), isNull(branches.deletedAt)));

    if (!branch) throw new NotFoundError('Branch', id);
    return reply.code(200).send({ data: branch });
  });

  // ── POST /branches ────────────────────────────────────────────────────────
  fastify.post('/branches', { preHandler: [authenticate, requirePermission(PERMISSIONS.BRANCH_MANAGE)] }, async (request, reply) => {
    const { tenantId, userId } = request.auth;

    const body = BranchSchema.safeParse(request.body);
    if (!body.success) {
      throw new ValidationError(body.error.errors.map((e) => e.message).join('; '));
    }

    if (body.data.isHeadOffice) {
      await db
        .update(branches)
        .set({ isHeadOffice: false, updatedAt: new Date() })
        .where(and(eq(branches.tenantId, tenantId), eq(branches.isHeadOffice, true)));
    }

    const [created] = await db
      .insert(branches)
      .values({ tenantId, createdBy: userId, ...body.data } as unknown as typeof branches.$inferInsert)
      .returning();

    return reply.code(201).send({ data: created });
  });

  // ── PUT /branches/:id ─────────────────────────────────────────────────────
  fastify.put<{ Params: { id: string } }>('/branches/:id', { preHandler: [authenticate, requirePermission(PERMISSIONS.BRANCH_MANAGE)] }, async (request, reply) => {
    const { tenantId } = request.auth;
    const id = parseInt(request.params.id, 10);

    const body = BranchSchema.safeParse(request.body);
    if (!body.success) {
      throw new ValidationError(body.error.errors.map((e) => e.message).join('; '));
    }

    const [existing] = await db
      .select()
      .from(branches)
      .where(and(eq(branches.id, id), eq(branches.tenantId, tenantId), isNull(branches.deletedAt)));

    if (!existing) throw new NotFoundError('Branch', id);

    if (body.data.version !== undefined && existing.version !== body.data.version) {
      const { OptimisticLockError } = await import('@erp/types');
      throw new OptimisticLockError('Branch');
    }

    if (body.data.isHeadOffice && !existing.isHeadOffice) {
      await db
        .update(branches)
        .set({ isHeadOffice: false, updatedAt: new Date() })
        .where(
          and(
            eq(branches.tenantId, tenantId),
            eq(branches.isHeadOffice, true)
          )
        );
    }

    const [updated] = await db
      .update(branches)
      .set({
        ...body.data,
        updatedAt: new Date(),
        version: existing.version + 1,
      } as unknown as Partial<typeof branches.$inferInsert>)
      .where(eq(branches.id, id))
      .returning();

    return reply.code(200).send({ data: updated });
  });

  // ── DELETE /branches/:id ──────────────────────────────────────────────────
  fastify.delete<{ Params: { id: string } }>('/branches/:id', { preHandler: [authenticate, requirePermission(PERMISSIONS.BRANCH_MANAGE)] }, async (request, reply) => {
    const { tenantId, userId } = request.auth;
    const id = parseInt(request.params.id, 10);

    const [existing] = await db
      .select()
      .from(branches)
      .where(and(eq(branches.id, id), eq(branches.tenantId, tenantId), isNull(branches.deletedAt)));

    if (!existing) throw new NotFoundError('Branch', id);
    if (existing.isHeadOffice) {
      throw new BusinessError('CANNOT_DELETE_HEAD_OFFICE', 'Cannot delete the head office branch');
    }

    await db
      .update(branches)
      .set({ deletedAt: new Date(), deletedBy: userId, isActive: false })
      .where(eq(branches.id, id));

    return reply.code(200).send({ data: { message: 'Branch deleted', id } });
  });
}
