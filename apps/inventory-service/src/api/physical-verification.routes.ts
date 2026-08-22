import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { eq, and, desc, sql, inArray } from 'drizzle-orm';
import { physicalVerifications } from '@erp/db';
import type { ErpDatabase } from '@erp/db';
import { PERMISSIONS, NotFoundError } from '@erp/types';
import type { PlatformContextFactory } from '@erp/sdk';
import { tenantScopedHandler } from '@erp/sdk';
import { authenticate } from '../middleware/authenticate.js';
import { requirePermission } from '../middleware/authorize.js';
import { PhysicalVerificationService } from '../domain/PhysicalVerificationService.js';
import { assertWarehouseInScope, getWarehouseScope } from '../domain/WarehouseBranchScope.js';

const CreateSchema = z.object({
  warehouseId: z.number().int().positive(),
  notes: z.string().max(1000).optional(),
});

const CountUpdateSchema = z.object({
  counts: z
    .array(
      z.object({
        lineId: z.number().int().positive(),
        physicalQty: z.number().nonnegative(),
      })
    )
    .min(1),
});

// GET/start-counting/counts/variances/approve act on an existing verification whose
// warehouseId isn't in the request — look it up first.
async function assertVerificationInScope(
  ctxDb: ErpDatabase,
  tenantId: number,
  id: number,
  auth: { permissions: string[]; branchIds: number[] }
): Promise<void> {
  const [verif] = await ctxDb
    .select({ warehouseId: physicalVerifications.warehouseId })
    .from(physicalVerifications)
    .where(and(eq(physicalVerifications.id, id), eq(physicalVerifications.tenantId, tenantId)));
  if (!verif) throw new NotFoundError('PhysicalVerification', id);
  await assertWarehouseInScope(ctxDb, tenantId, verif.warehouseId, auth);
}

// Phase 9 GUC-per-request rollout — migrated 2026-08-21. No external I/O —
// PhysicalVerificationService has no fetch() calls.
export async function physicalVerificationRoutes(
  fastify: FastifyInstance,
  ctxFactory: PlatformContextFactory
): Promise<void> {
  // GET /physical-verifications
  fastify.get(
    '/physical-verifications',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.WAREHOUSE_MANAGE)] },
    tenantScopedHandler(ctxFactory, async (request, reply, ctx) => {
      const { page = 1, limit = 50 } = request.query as { page?: number; limit?: number };
      const offset = ((page as number) - 1) * (limit as number);

      let whereClause = eq(physicalVerifications.tenantId, ctx.tenant.tenantId);
      // Inventory module audit 2026-07-21: previously unfiltered — any user with
      // WAREHOUSE_MANAGE saw every branch's physical verifications.
      const warehouseScope = await getWarehouseScope(ctx.db.raw, ctx.tenant.tenantId, {
        permissions: request.auth.permissions,
        branchIds: request.auth.branchIds,
      });
      if (warehouseScope !== 'all') {
        if (warehouseScope.length === 0) {
          return reply.code(200).send({ data: { content: [], totalElements: 0, page, limit } });
        }
        whereClause = and(whereClause, inArray(physicalVerifications.warehouseId, warehouseScope))!;
      }

      const rows = await ctx.db.raw
        .select()
        .from(physicalVerifications)
        .where(whereClause)
        .orderBy(desc(physicalVerifications.createdAt), desc(physicalVerifications.id))
        .limit(limit as number)
        .offset(offset);
      const [countRow] = await ctx.db.raw
        .select({ count: sql<number>`count(*)::int` })
        .from(physicalVerifications)
        .where(whereClause);
      return reply
        .code(200)
        .send({ data: { content: rows, totalElements: countRow?.count ?? 0, page, limit } });
    })
  );

  // POST /physical-verifications
  fastify.post(
    '/physical-verifications',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.WAREHOUSE_MANAGE)] },
    tenantScopedHandler(ctxFactory, async (request, reply, ctx) => {
      const body = CreateSchema.parse((request.body as { data?: unknown })?.data ?? request.body);
      await assertWarehouseInScope(ctx.db.raw, ctx.tenant.tenantId, body.warehouseId, {
        permissions: request.auth.permissions,
        branchIds: request.auth.branchIds,
      });
      const svc = new PhysicalVerificationService(ctx.db.raw);
      const verif = await svc.create({
        tenantId: ctx.tenant.tenantId,
        ...body,
        createdBy: ctx.tenant.userId,
      } as Parameters<typeof svc.create>[0]);
      return reply.code(201).send({ data: verif });
    })
  );

  // GET /physical-verifications/:id
  fastify.get(
    '/physical-verifications/:id',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.WAREHOUSE_MANAGE)] },
    tenantScopedHandler(ctxFactory, async (request, reply, ctx) => {
      const { id } = request.params as { id: string };
      await assertVerificationInScope(ctx.db.raw, ctx.tenant.tenantId, parseInt(id, 10), {
        permissions: request.auth.permissions,
        branchIds: request.auth.branchIds,
      });
      const svc = new PhysicalVerificationService(ctx.db.raw);
      const verif = await svc.get(parseInt(id, 10), ctx.tenant.tenantId);
      return reply.code(200).send({ data: verif });
    })
  );

  // POST /physical-verifications/:id/start-counting
  fastify.post(
    '/physical-verifications/:id/start-counting',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.WAREHOUSE_MANAGE)] },
    tenantScopedHandler(ctxFactory, async (request, reply, ctx) => {
      const { id } = request.params as { id: string };
      await assertVerificationInScope(ctx.db.raw, ctx.tenant.tenantId, parseInt(id, 10), {
        permissions: request.auth.permissions,
        branchIds: request.auth.branchIds,
      });
      const svc = new PhysicalVerificationService(ctx.db.raw);
      const verif = await svc.startCounting(
        parseInt(id, 10),
        ctx.tenant.tenantId,
        ctx.tenant.userId
      );
      return reply.code(200).send({ data: verif });
    })
  );

  // PUT /physical-verifications/:id/counts — batch update counted quantities
  fastify.put(
    '/physical-verifications/:id/counts',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.WAREHOUSE_MANAGE)] },
    tenantScopedHandler(ctxFactory, async (request, reply, ctx) => {
      const { id } = request.params as { id: string };
      const { counts } = CountUpdateSchema.parse(
        (request.body as { data?: unknown })?.data ?? request.body
      );
      await assertVerificationInScope(ctx.db.raw, ctx.tenant.tenantId, parseInt(id, 10), {
        permissions: request.auth.permissions,
        branchIds: request.auth.branchIds,
      });
      const svc = new PhysicalVerificationService(ctx.db.raw);
      await svc.updateCounts(parseInt(id, 10), ctx.tenant.tenantId, counts);
      return reply.code(200).send({ data: { message: 'Counts updated' } });
    })
  );

  // GET /physical-verifications/:id/variances
  fastify.get(
    '/physical-verifications/:id/variances',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.WAREHOUSE_MANAGE)] },
    tenantScopedHandler(ctxFactory, async (request, reply, ctx) => {
      const { id } = request.params as { id: string };
      await assertVerificationInScope(ctx.db.raw, ctx.tenant.tenantId, parseInt(id, 10), {
        permissions: request.auth.permissions,
        branchIds: request.auth.branchIds,
      });
      const svc = new PhysicalVerificationService(ctx.db.raw);
      const variances = await svc.getVariances(parseInt(id, 10), ctx.tenant.tenantId);
      return reply.code(200).send({ data: variances });
    })
  );

  // POST /physical-verifications/:id/approve
  fastify.post(
    '/physical-verifications/:id/approve',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.WAREHOUSE_MANAGE)] },
    tenantScopedHandler(ctxFactory, async (request, reply, ctx) => {
      const { id } = request.params as { id: string };
      await assertVerificationInScope(ctx.db.raw, ctx.tenant.tenantId, parseInt(id, 10), {
        permissions: request.auth.permissions,
        branchIds: request.auth.branchIds,
      });
      const svc = new PhysicalVerificationService(ctx.db.raw);
      const verif = await svc.approve(parseInt(id, 10), ctx.tenant.tenantId, ctx.tenant.userId);
      return reply.code(200).send({ data: verif });
    })
  );
}
