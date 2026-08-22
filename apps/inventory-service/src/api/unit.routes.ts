import type { FastifyInstance } from 'fastify';
import type { PlatformContextFactory } from '@erp/sdk';
import { tenantScopedHandler } from '@erp/sdk';
import { units } from '@erp/db';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { NotFoundError, OptimisticLockError, ValidationError } from '@erp/types';
import { PERMISSIONS } from '@erp/types';
import { authenticate } from '../middleware/authenticate.js';
import { requirePermission } from '../middleware/authorize.js';

const UnitSchema = z.object({
  name: z.string().min(1).max(100),
  abbreviation: z.string().min(1).max(20),
  type: z.enum(['QUANTITY', 'LENGTH', 'WEIGHT', 'AREA', 'VOLUME']).default('QUANTITY'),
  isActive: z.boolean().default(true),
});

const UnitUpdateSchema = UnitSchema.extend({
  version: z.number().int().min(0),
});

// Phase 9 GUC-per-request rollout — migrated 2026-08-21. No external I/O.
export async function unitRoutes(
  fastify: FastifyInstance,
  ctxFactory: PlatformContextFactory
): Promise<void> {
  fastify.get(
    '/units',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.UNIT_VIEW)] },
    tenantScopedHandler(ctxFactory, async (request, reply, ctx) => {
      const rows = await ctx.db.raw
        .select()
        .from(units)
        .where(eq(units.tenantId, ctx.tenant.tenantId));
      return reply.code(200).send({ data: { content: rows, totalElements: rows.length } });
    })
  );

  fastify.post(
    '/units',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.UNIT_CREATE)] },
    tenantScopedHandler(ctxFactory, async (request, reply, ctx) => {
      const body = UnitSchema.safeParse(request.body);
      if (!body.success)
        throw new ValidationError(body.error.errors.map((e) => e.message).join('; '));
      const [created] = await ctx.db.raw
        .insert(units)
        .values({ tenantId: ctx.tenant.tenantId, createdBy: ctx.tenant.userId, ...body.data })
        .returning();
      if (!created) throw new Error('Unit creation failed');

      await ctx.events.publish(
        'unit',
        created.id,
        'UNIT_CREATED',
        created as unknown as Record<string, unknown>
      );
      await ctx.audit.log({
        action: 'CREATE',
        entityType: 'unit',
        entityId: created.id,
        after: created as unknown as Record<string, unknown>,
      });

      return reply.code(201).send({ data: created });
    })
  );

  fastify.put(
    '/units/:id',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.UNIT_UPDATE)] },
    tenantScopedHandler(ctxFactory, async (request, reply, ctx) => {
      const { id: idParam } = request.params as { id: string };
      const id = parseInt(idParam, 10);
      const body = UnitUpdateSchema.safeParse(request.body);
      if (!body.success)
        throw new ValidationError(body.error.errors.map((e) => e.message).join('; '));
      const [existing] = await ctx.db.raw
        .select()
        .from(units)
        .where(and(eq(units.id, id), eq(units.tenantId, ctx.tenant.tenantId)));
      if (!existing) throw new NotFoundError('Unit', id);

      const result = await ctx.db.raw
        .update(units)
        .set({ ...body.data, updatedAt: new Date(), version: existing.version + 1 })
        .where(
          and(
            eq(units.id, id),
            eq(units.tenantId, ctx.tenant.tenantId),
            eq(units.version, body.data.version)
          )
        )
        .returning();

      if (result.length === 0) {
        throw new OptimisticLockError('Unit');
      }

      const updated = result[0];
      if (!updated) throw new Error('Unit update failed');

      await ctx.events.publish(
        'unit',
        updated.id,
        'UNIT_UPDATED',
        updated as unknown as Record<string, unknown>
      );
      await ctx.audit.log({
        action: 'UPDATE',
        entityType: 'unit',
        entityId: id,
        before: existing as unknown as Record<string, unknown>,
        after: updated as unknown as Record<string, unknown>,
      });

      return reply.code(200).send({ data: updated });
    })
  );
}
