import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { eq, and, desc } from 'drizzle-orm';
import { stockTransfers } from '@erp/db';
import { PERMISSIONS } from '@erp/types';
import type { PlatformContextFactory } from '@erp/sdk';
import { authenticate } from '../middleware/authenticate.js';
import { requirePermission } from '../middleware/authorize.js';
import { StockTransferService } from '../domain/StockTransferService.js';

const TransferLineSchema = z.object({
  itemId: z.number().int().positive(),
  variantId: z.number().int().positive().optional(),
  requestedQty: z.number().positive(),
  unitCost: z.number().positive().optional(),
  notes: z.string().max(500).optional(),
});

const CreateTransferSchema = z.object({
  fromWarehouseId: z.number().int().positive(),
  toWarehouseId: z.number().int().positive(),
  lines: z.array(TransferLineSchema).min(1),
  notes: z.string().max(1000).optional(),
});

const ReceiveLineSchema = z.object({
  lineId: z.number().int().positive(),
  receivedQty: z.number().nonnegative(),
});

const CancelSchema = z.object({
  reason: z.string().min(1).max(500),
});

const UpdateTransferSchema = z.object({
  lines: z.array(TransferLineSchema).min(1).optional(),
  notes: z.string().max(1000).optional(),
});

export async function transferRoutes(
  fastify: FastifyInstance,
  ctxFactory: PlatformContextFactory
): Promise<void> {
  // GET /stock-transfers
  fastify.get(
    '/stock-transfers',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.WAREHOUSE_MANAGE)] },
    async (request, reply) => {
      const ctx = ctxFactory.create({
        tenantId: request.auth.tenantId,
        userId: request.auth.userId,
        correlationId: request.id,
      });

      const { page = 1, limit = 50, status } = request.query as {
        page?: number;
        limit?: number;
        status?: string;
      };
      const offset = ((page as number) - 1) * (limit as number);

      let q = ctx.db.raw
        .select()
        .from(stockTransfers)
        .where(eq(stockTransfers.tenantId, request.auth.tenantId))
        .orderBy(desc(stockTransfers.createdAt))
        .$dynamic();

      if (status) {
        q = q.where(eq(stockTransfers.status, status as typeof stockTransfers.$inferSelect['status'])) as typeof q;
      }

      const rows = await q.limit(limit as number).offset(offset);
      return reply.code(200).send({ data: rows, meta: { page, limit } });
    }
  );

  // POST /stock-transfers
  fastify.post(
    '/stock-transfers',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.WAREHOUSE_MANAGE)] },
    async (request, reply) => {
      const ctx = ctxFactory.create({
        tenantId: request.auth.tenantId,
        userId: request.auth.userId,
        correlationId: request.id,
      });

      const body = CreateTransferSchema.parse((request.body as { data?: unknown })?.data ?? request.body);
      const svc = new StockTransferService(ctx.db.raw);

      const transfer = await svc.create({
        tenantId: request.auth.tenantId,
        ...body,
        createdBy: request.auth.userId,
      } as Parameters<typeof svc.create>[0]);

      await ctx.audit.log({
        action: 'STOCK_TRANSFER_CREATED',
        entityType: 'STOCK_TRANSFER',
        entityId: transfer.id,
        after: transfer,
      });

      await ctx.events.publish('STOCK_TRANSFER', transfer.id, 'TRANSFER_CREATED', {
        transferId: transfer.id,
        transferNumber: transfer.transferNumber,
        fromWarehouseId: transfer.fromWarehouseId,
        toWarehouseId: transfer.toWarehouseId,
        tenantId: transfer.tenantId,
      });

      return reply.code(201).send({ data: transfer });
    }
  );

  // PUT /stock-transfers/:id — update DRAFT transfer
  fastify.put(
    '/stock-transfers/:id',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.WAREHOUSE_MANAGE)] },
    async (request, reply) => {
      const ctx = ctxFactory.create({
        tenantId: request.auth.tenantId,
        userId: request.auth.userId,
        correlationId: request.id,
      });
      const { id } = request.params as { id: string };
      const body = UpdateTransferSchema.parse(
        (request.body as { data?: unknown })?.data ?? request.body
      );
      const svc = new StockTransferService(ctx.db.raw);
      const transfer = await svc.update(
        parseInt(id, 10),
        request.auth.tenantId,
        body as Parameters<typeof svc.update>[2]
      );
      return reply.code(200).send({ data: transfer });
    }
  );

  // GET /stock-transfers/:id
  fastify.get(
    '/stock-transfers/:id',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.WAREHOUSE_MANAGE)] },
    async (request, reply) => {
      const ctx = ctxFactory.create({
        tenantId: request.auth.tenantId,
        userId: request.auth.userId,
        correlationId: request.id,
      });

      const { id } = request.params as { id: string };
      const svc = new StockTransferService(ctx.db.raw);
      const transfer = await svc.getWithLines(parseInt(id, 10), request.auth.tenantId);
      return reply.code(200).send({ data: transfer });
    }
  );

  // POST /stock-transfers/:id/submit
  fastify.post(
    '/stock-transfers/:id/submit',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.WAREHOUSE_MANAGE)] },
    async (request, reply) => {
      const ctx = ctxFactory.create({
        tenantId: request.auth.tenantId,
        userId: request.auth.userId,
        correlationId: request.id,
      });
      const { id } = request.params as { id: string };
      const svc = new StockTransferService(ctx.db.raw);
      const transfer = await svc.submit(parseInt(id, 10), request.auth.tenantId, request.auth.userId);
      return reply.code(200).send({ data: transfer });
    }
  );

  // POST /stock-transfers/:id/approve
  fastify.post(
    '/stock-transfers/:id/approve',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.WAREHOUSE_MANAGE)] },
    async (request, reply) => {
      const ctx = ctxFactory.create({
        tenantId: request.auth.tenantId,
        userId: request.auth.userId,
        correlationId: request.id,
      });
      const { id } = request.params as { id: string };
      const svc = new StockTransferService(ctx.db.raw);
      const transfer = await svc.approve(parseInt(id, 10), request.auth.tenantId, request.auth.userId);
      return reply.code(200).send({ data: transfer });
    }
  );

  // POST /stock-transfers/:id/dispatch
  fastify.post(
    '/stock-transfers/:id/dispatch',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.WAREHOUSE_MANAGE)] },
    async (request, reply) => {
      const ctx = ctxFactory.create({
        tenantId: request.auth.tenantId,
        userId: request.auth.userId,
        correlationId: request.id,
      });
      const { id } = request.params as { id: string };
      const svc = new StockTransferService(ctx.db.raw);
      const transfer = await svc.dispatch(parseInt(id, 10), request.auth.tenantId, request.auth.userId);

      await ctx.events.publish('STOCK_TRANSFER', transfer.id, 'TRANSFER_DISPATCHED', {
        transferId: transfer.id,
        transferNumber: transfer.transferNumber,
        tenantId: transfer.tenantId,
      });

      return reply.code(200).send({ data: transfer });
    }
  );

  // POST /stock-transfers/:id/receive
  fastify.post(
    '/stock-transfers/:id/receive',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.WAREHOUSE_MANAGE)] },
    async (request, reply) => {
      const ctx = ctxFactory.create({
        tenantId: request.auth.tenantId,
        userId: request.auth.userId,
        correlationId: request.id,
      });
      const { id } = request.params as { id: string };
      const bodyRaw = (request.body as { data?: unknown })?.data ?? request.body;
      const { lines } = z
        .object({ lines: z.array(ReceiveLineSchema).min(1) })
        .parse(bodyRaw);

      const svc = new StockTransferService(ctx.db.raw);
      const transfer = await svc.receive(
        parseInt(id, 10),
        request.auth.tenantId,
        request.auth.userId,
        lines
      );

      await ctx.events.publish('STOCK_TRANSFER', transfer.id, 'TRANSFER_RECEIVED', {
        transferId: transfer.id,
        transferNumber: transfer.transferNumber,
        tenantId: transfer.tenantId,
      });

      return reply.code(200).send({ data: transfer });
    }
  );

  // POST /stock-transfers/:id/cancel
  fastify.post(
    '/stock-transfers/:id/cancel',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.WAREHOUSE_MANAGE)] },
    async (request, reply) => {
      const ctx = ctxFactory.create({
        tenantId: request.auth.tenantId,
        userId: request.auth.userId,
        correlationId: request.id,
      });
      const { id } = request.params as { id: string };
      const { reason } = CancelSchema.parse((request.body as { data?: unknown })?.data ?? request.body);
      const svc = new StockTransferService(ctx.db.raw);
      const transfer = await svc.cancel(parseInt(id, 10), request.auth.tenantId, request.auth.userId, reason);
      return reply.code(200).send({ data: transfer });
    }
  );
}
