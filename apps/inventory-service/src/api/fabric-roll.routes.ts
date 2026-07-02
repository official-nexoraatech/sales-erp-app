import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { eq, and, desc } from 'drizzle-orm';
import { fabricRolls } from '@erp/db';
import { PERMISSIONS } from '@erp/types';
import type { PlatformContextFactory } from '@erp/sdk';
import { authenticate } from '../middleware/authenticate.js';
import { requirePermission } from '../middleware/authorize.js';
import { FabricRollService } from '../domain/FabricRollService.js';

const ReceiveRollSchema = z.object({
  rollNumber: z.string().min(1).max(50),
  itemId: z.number().int().positive(),
  warehouseId: z.number().int().positive(),
  meters: z.number().positive(),
  width: z.number().positive().optional(),
  grnReference: z.string().max(50).optional(),
  notes: z.string().max(500).optional(),
});

const CutSchema = z.object({
  meters: z.number().positive(),
  purpose: z.string().max(100).optional(),
  referenceType: z.string().max(50).optional(),
  referenceId: z.number().int().positive().optional(),
  notes: z.string().max(500).optional(),
});

export async function fabricRollRoutes(
  fastify: FastifyInstance,
  ctxFactory: PlatformContextFactory
): Promise<void> {
  // GET /fabric-rolls?itemId=X
  fastify.get(
    '/fabric-rolls',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.ITEM_VIEW)] },
    async (request, reply) => {
      const ctx = ctxFactory.create({
        tenantId: request.auth.tenantId,
        userId: request.auth.userId,
        correlationId: request.id,
      });

      const { itemId } = request.query as { itemId?: string };

      if (!itemId) {
        const rows = await ctx.db.raw
          .select()
          .from(fabricRolls)
          .where(eq(fabricRolls.tenantId, request.auth.tenantId))
          .orderBy(desc(fabricRolls.receivedAt));
        return reply.code(200).send({ data: rows });
      }

      const svc = new FabricRollService(ctx.db.raw);
      const rolls = await svc.getAvailableRolls(parseInt(itemId, 10), request.auth.tenantId);
      return reply.code(200).send({ data: rolls });
    }
  );

  // POST /fabric-rolls — receive a new roll
  fastify.post(
    '/fabric-rolls',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.ITEM_EDIT)] },
    async (request, reply) => {
      const ctx = ctxFactory.create({
        tenantId: request.auth.tenantId,
        userId: request.auth.userId,
        correlationId: request.id,
      });
      const body = ReceiveRollSchema.parse(
        (request.body as { data?: unknown })?.data ?? request.body
      );
      const svc = new FabricRollService(ctx.db.raw);
      const roll = await svc.receiveRoll({
        tenantId: request.auth.tenantId,
        rollNumber: body.rollNumber,
        itemId: body.itemId,
        warehouseId: body.warehouseId,
        meters: body.meters,
        ...(body.width !== undefined ? { width: body.width } : {}),
        ...(body.grnReference !== undefined ? { grnReference: body.grnReference } : {}),
        ...(body.notes !== undefined ? { notes: body.notes } : {}),
        createdBy: request.auth.userId,
      });
      return reply.code(201).send({ data: roll });
    }
  );

  // POST /fabric-rolls/:id/cut
  fastify.post(
    '/fabric-rolls/:id/cut',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.ITEM_EDIT)] },
    async (request, reply) => {
      const ctx = ctxFactory.create({
        tenantId: request.auth.tenantId,
        userId: request.auth.userId,
        correlationId: request.id,
      });
      const { id } = request.params as { id: string };
      const body = CutSchema.parse((request.body as { data?: unknown })?.data ?? request.body);
      const svc = new FabricRollService(ctx.db.raw);
      const result = await svc.cut({
        tenantId: request.auth.tenantId,
        rollId: parseInt(id, 10),
        meters: body.meters,
        ...(body.purpose !== undefined ? { purpose: body.purpose } : {}),
        ...(body.referenceType !== undefined ? { referenceType: body.referenceType } : {}),
        ...(body.referenceId !== undefined ? { referenceId: body.referenceId } : {}),
        ...(body.notes !== undefined ? { notes: body.notes } : {}),
        createdBy: request.auth.userId,
      });
      return reply.code(201).send({ data: result });
    }
  );

  // GET /fabric-rolls/:id/cuts — cut history for a roll
  fastify.get(
    '/fabric-rolls/:id/cuts',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.ITEM_VIEW)] },
    async (request, reply) => {
      const ctx = ctxFactory.create({
        tenantId: request.auth.tenantId,
        userId: request.auth.userId,
        correlationId: request.id,
      });
      const { id } = request.params as { id: string };
      const svc = new FabricRollService(ctx.db.raw);
      const result = await svc.getCutHistory(parseInt(id, 10), request.auth.tenantId);
      return reply.code(200).send({ data: result });
    }
  );
}
