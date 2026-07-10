import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { eq, and } from 'drizzle-orm';
import { stockReservations } from '@erp/db';
import { PERMISSIONS } from '@erp/types';
import type { PlatformContextFactory } from '@erp/sdk';
import { timingSafeEqual } from 'node:crypto';
import { authenticate } from '../middleware/authenticate.js';
import { requirePermission } from '../middleware/authorize.js';
import { ReservationEngine } from '../domain/ReservationEngine.js';

const CreateReservationSchema = z.object({
  itemId: z.number().int().positive(),
  variantId: z.number().int().positive().optional(),
  warehouseId: z.number().int().positive(),
  quantity: z.number().positive(),
  referenceType: z.string().min(1).max(50),
  referenceId: z.number().int().positive(),
  expiresAt: z.string().datetime(),
});

const ReleaseSchema = z.object({
  reason: z.string().min(1).max(500).default('Manual release'),
});

export async function reservationRoutes(
  fastify: FastifyInstance,
  ctxFactory: PlatformContextFactory
): Promise<void> {
  // POST /inventory/reservations/expire — internal trigger (scheduler calls this)
  fastify.post(
    '/inventory/reservations/expire',
    async (request, reply) => {
      const apiKey = (request.headers['x-internal-key'] as string | undefined) ?? '';
      const expected = process.env['INTERNAL_API_KEY'] ?? '';
      const keyBuffer = Buffer.from(apiKey);
      const expectedBuffer = Buffer.from(expected);
      const matches = !!expected && keyBuffer.length === expectedBuffer.length && timingSafeEqual(keyBuffer, expectedBuffer);
      if (!matches) {
        return reply.code(401).send({ error: { code: 'UNAUTHORIZED', message: 'Invalid internal API key' } });
      }

      const dbUrl = process.env['DATABASE_URL'];
      if (!dbUrl) return reply.code(500).send({ error: { code: 'NO_DB', message: 'No DATABASE_URL' } });

      const { createDatabaseClient } = await import('@erp/db');
      const db = createDatabaseClient({ url: dbUrl });
      const engine = new ReservationEngine(db);
      const expired = await engine.expireStale(db);

      return reply.code(200).send({ data: { expiredCount: expired } });
    }
  );

  // POST /inventory/reservations
  fastify.post(
    '/inventory/reservations',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.ITEM_EDIT)] },
    async (request, reply) => {
      const ctx = ctxFactory.create({
        tenantId: request.auth.tenantId,
        userId: request.auth.userId,
        correlationId: request.id,
      });

      const body = CreateReservationSchema.parse((request.body as { data?: unknown })?.data ?? request.body);
      const engine = new ReservationEngine(ctx.db.raw);

      const reservationId = await engine.reserve({
        tenantId: request.auth.tenantId,
        itemId: body.itemId,
        ...(body.variantId !== undefined ? { variantId: body.variantId } : {}),
        warehouseId: body.warehouseId,
        quantity: body.quantity,
        referenceType: body.referenceType,
        referenceId: body.referenceId,
        expiresAt: new Date(body.expiresAt),
        createdBy: request.auth.userId,
      } as Parameters<typeof engine.reserve>[0]);

      return reply.code(201).send({ data: { id: reservationId } });
    }
  );

  // GET /inventory/reservations — active only
  fastify.get(
    '/inventory/reservations',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.ITEM_VIEW)] },
    async (request, reply) => {
      const ctx = ctxFactory.create({
        tenantId: request.auth.tenantId,
        userId: request.auth.userId,
        correlationId: request.id,
      });

      const active = await ctx.db.raw
        .select()
        .from(stockReservations)
        .where(
          and(
            eq(stockReservations.tenantId, request.auth.tenantId),
            eq(stockReservations.status, 'ACTIVE')
          )
        );

      return reply.code(200).send({ data: active });
    }
  );

  // DELETE /inventory/reservations/:id — release
  fastify.delete(
    '/inventory/reservations/:id',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.ITEM_EDIT)] },
    async (request, reply) => {
      const ctx = ctxFactory.create({
        tenantId: request.auth.tenantId,
        userId: request.auth.userId,
        correlationId: request.id,
      });

      const { id } = request.params as { id: string };
      const body = ReleaseSchema.parse((request.body as { data?: unknown })?.data ?? request.body ?? {});
      const engine = new ReservationEngine(ctx.db.raw);

      await engine.release(parseInt(id, 10), request.auth.tenantId, body.reason);

      return reply.code(200).send({ data: { message: 'Reservation released' } });
    }
  );
}
