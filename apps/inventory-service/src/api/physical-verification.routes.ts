import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { eq, desc, sql } from 'drizzle-orm';
import { physicalVerifications } from '@erp/db';
import { PERMISSIONS } from '@erp/types';
import type { PlatformContextFactory } from '@erp/sdk';
import { authenticate } from '../middleware/authenticate.js';
import { requirePermission } from '../middleware/authorize.js';
import { PhysicalVerificationService } from '../domain/PhysicalVerificationService.js';

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

export async function physicalVerificationRoutes(
  fastify: FastifyInstance,
  ctxFactory: PlatformContextFactory
): Promise<void> {
  // GET /physical-verifications
  fastify.get(
    '/physical-verifications',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.WAREHOUSE_MANAGE)] },
    async (request, reply) => {
      const ctx = ctxFactory.create({
        tenantId: request.auth.tenantId,
        userId: request.auth.userId,
        correlationId: request.id,
      });
      const { page = 1, limit = 50 } = request.query as { page?: number; limit?: number };
      const offset = ((page as number) - 1) * (limit as number);
      const rows = await ctx.db.raw
        .select()
        .from(physicalVerifications)
        .where(eq(physicalVerifications.tenantId, request.auth.tenantId))
        .orderBy(desc(physicalVerifications.createdAt), desc(physicalVerifications.id))
        .limit(limit as number)
        .offset(offset);
      const [countRow] = await ctx.db.raw
        .select({ count: sql<number>`count(*)::int` })
        .from(physicalVerifications)
        .where(eq(physicalVerifications.tenantId, request.auth.tenantId));
      return reply
        .code(200)
        .send({ data: { content: rows, totalElements: countRow?.count ?? 0, page, limit } });
    }
  );

  // POST /physical-verifications
  fastify.post(
    '/physical-verifications',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.WAREHOUSE_MANAGE)] },
    async (request, reply) => {
      const ctx = ctxFactory.create({
        tenantId: request.auth.tenantId,
        userId: request.auth.userId,
        correlationId: request.id,
      });
      const body = CreateSchema.parse((request.body as { data?: unknown })?.data ?? request.body);
      const svc = new PhysicalVerificationService(ctx.db.raw);
      const verif = await svc.create({
        tenantId: request.auth.tenantId,
        ...body,
        createdBy: request.auth.userId,
      } as Parameters<typeof svc.create>[0]);
      return reply.code(201).send({ data: verif });
    }
  );

  // GET /physical-verifications/:id
  fastify.get(
    '/physical-verifications/:id',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.WAREHOUSE_MANAGE)] },
    async (request, reply) => {
      const ctx = ctxFactory.create({
        tenantId: request.auth.tenantId,
        userId: request.auth.userId,
        correlationId: request.id,
      });
      const { id } = request.params as { id: string };
      const svc = new PhysicalVerificationService(ctx.db.raw);
      const verif = await svc.get(parseInt(id, 10), request.auth.tenantId);
      return reply.code(200).send({ data: verif });
    }
  );

  // POST /physical-verifications/:id/start-counting
  fastify.post(
    '/physical-verifications/:id/start-counting',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.WAREHOUSE_MANAGE)] },
    async (request, reply) => {
      const ctx = ctxFactory.create({
        tenantId: request.auth.tenantId,
        userId: request.auth.userId,
        correlationId: request.id,
      });
      const { id } = request.params as { id: string };
      const svc = new PhysicalVerificationService(ctx.db.raw);
      const verif = await svc.startCounting(
        parseInt(id, 10),
        request.auth.tenantId,
        request.auth.userId
      );
      return reply.code(200).send({ data: verif });
    }
  );

  // PUT /physical-verifications/:id/counts — batch update counted quantities
  fastify.put(
    '/physical-verifications/:id/counts',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.WAREHOUSE_MANAGE)] },
    async (request, reply) => {
      const ctx = ctxFactory.create({
        tenantId: request.auth.tenantId,
        userId: request.auth.userId,
        correlationId: request.id,
      });
      const { id } = request.params as { id: string };
      const { counts } = CountUpdateSchema.parse(
        (request.body as { data?: unknown })?.data ?? request.body
      );
      const svc = new PhysicalVerificationService(ctx.db.raw);
      await svc.updateCounts(parseInt(id, 10), request.auth.tenantId, counts);
      return reply.code(200).send({ data: { message: 'Counts updated' } });
    }
  );

  // GET /physical-verifications/:id/variances
  fastify.get(
    '/physical-verifications/:id/variances',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.WAREHOUSE_MANAGE)] },
    async (request, reply) => {
      const ctx = ctxFactory.create({
        tenantId: request.auth.tenantId,
        userId: request.auth.userId,
        correlationId: request.id,
      });
      const { id } = request.params as { id: string };
      const svc = new PhysicalVerificationService(ctx.db.raw);
      const variances = await svc.getVariances(parseInt(id, 10), request.auth.tenantId);
      return reply.code(200).send({ data: variances });
    }
  );

  // POST /physical-verifications/:id/approve
  fastify.post(
    '/physical-verifications/:id/approve',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.WAREHOUSE_MANAGE)] },
    async (request, reply) => {
      const ctx = ctxFactory.create({
        tenantId: request.auth.tenantId,
        userId: request.auth.userId,
        correlationId: request.id,
      });
      const { id } = request.params as { id: string };
      const svc = new PhysicalVerificationService(ctx.db.raw);
      const verif = await svc.approve(parseInt(id, 10), request.auth.tenantId, request.auth.userId);
      return reply.code(200).send({ data: verif });
    }
  );
}
