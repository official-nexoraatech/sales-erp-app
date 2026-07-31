import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { eq, and, desc, sql, ilike, or, inArray } from 'drizzle-orm';
import { stockTransfers } from '@erp/db';
import type { ErpDatabase } from '@erp/db';
import { PERMISSIONS, NotFoundError } from '@erp/types';
import type { PlatformContextFactory } from '@erp/sdk';
import { authenticate } from '../middleware/authenticate.js';
import { requireAnyPermission } from '../middleware/authorize.js';
import { StockTransferService } from '../domain/StockTransferService.js';
import { assertWarehouseInScope, getWarehouseScope } from '../domain/WarehouseBranchScope.js';

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

// Update/submit/approve/dispatch/receive/cancel act on an existing transfer whose
// from/toWarehouseId aren't in the request — look them up first. A branch-restricted user
// needs scope over at least one endpoint (source OR destination) to manage the transfer;
// see create's own stricter check (both endpoints) below.
async function assertTransferInScope(
  ctxDb: ErpDatabase,
  tenantId: number,
  id: number,
  auth: { permissions: string[]; branchIds: number[] }
): Promise<void> {
  const [transfer] = await ctxDb
    .select({
      fromWarehouseId: stockTransfers.fromWarehouseId,
      toWarehouseId: stockTransfers.toWarehouseId,
    })
    .from(stockTransfers)
    .where(and(eq(stockTransfers.id, id), eq(stockTransfers.tenantId, tenantId)));
  if (!transfer) throw new NotFoundError('StockTransfer', id);

  const scope = await getWarehouseScope(ctxDb, tenantId, auth);
  if (scope === 'all') return;
  if (!scope.includes(transfer.fromWarehouseId) && !scope.includes(transfer.toWarehouseId)) {
    await assertWarehouseInScope(ctxDb, tenantId, transfer.fromWarehouseId, auth);
  }
}

export async function transferRoutes(
  fastify: FastifyInstance,
  ctxFactory: PlatformContextFactory
): Promise<void> {
  // GET /stock-transfers
  fastify.get(
    '/stock-transfers',
    {
      preHandler: [
        authenticate,
        requireAnyPermission([PERMISSIONS.STOCK_TRANSFER, PERMISSIONS.WAREHOUSE_MANAGE]),
      ],
    },
    async (request, reply) => {
      const ctx = ctxFactory.create({
        tenantId: request.auth.tenantId,
        userId: request.auth.userId,
        correlationId: request.id,
      });

      const {
        page = 1,
        limit = 50,
        status,
        search,
      } = request.query as {
        page?: number;
        limit?: number;
        status?: string;
        search?: string;
      };
      const offset = ((page as number) - 1) * (limit as number);

      const conditions = [eq(stockTransfers.tenantId, request.auth.tenantId)];
      if (status)
        conditions.push(
          eq(stockTransfers.status, status as (typeof stockTransfers.$inferSelect)['status'])
        );
      if (search) conditions.push(ilike(stockTransfers.transferNumber, `%${search}%`));

      // Inventory module audit 2026-07-21: previously unfiltered — any user with
      // STOCK_TRANSFER/WAREHOUSE_MANAGE saw every branch's transfers.
      const warehouseScope = await getWarehouseScope(ctx.db.raw, request.auth.tenantId, {
        permissions: request.auth.permissions,
        branchIds: request.auth.branchIds,
      });
      if (warehouseScope !== 'all') {
        if (warehouseScope.length === 0) {
          return reply.code(200).send({ data: { content: [], totalElements: 0, page, limit } });
        }
        conditions.push(
          or(
            inArray(stockTransfers.fromWarehouseId, warehouseScope),
            inArray(stockTransfers.toWarehouseId, warehouseScope)
          )!
        );
      }
      const whereClause = and(...conditions);

      const rows = await ctx.db.raw
        .select()
        .from(stockTransfers)
        .where(whereClause)
        .orderBy(desc(stockTransfers.createdAt), desc(stockTransfers.id))
        .limit(limit as number)
        .offset(offset);

      const [countRow] = await ctx.db.raw
        .select({ count: sql<number>`count(*)::int` })
        .from(stockTransfers)
        .where(whereClause);

      return reply
        .code(200)
        .send({ data: { content: rows, totalElements: countRow?.count ?? 0, page, limit } });
    }
  );

  // POST /stock-transfers
  fastify.post(
    '/stock-transfers',
    {
      preHandler: [
        authenticate,
        requireAnyPermission([PERMISSIONS.STOCK_TRANSFER, PERMISSIONS.WAREHOUSE_MANAGE]),
      ],
    },
    async (request, reply) => {
      const ctx = ctxFactory.create({
        tenantId: request.auth.tenantId,
        userId: request.auth.userId,
        correlationId: request.id,
      });

      const body = CreateTransferSchema.parse(
        (request.body as { data?: unknown })?.data ?? request.body
      );
      const scopeAuth = {
        permissions: request.auth.permissions,
        branchIds: request.auth.branchIds,
      };
      // Creating a transfer between two warehouses requires authority over both endpoints,
      // not just one — stricter than the read/manage checks below.
      await assertWarehouseInScope(
        ctx.db.raw,
        request.auth.tenantId,
        body.fromWarehouseId,
        scopeAuth
      );
      await assertWarehouseInScope(
        ctx.db.raw,
        request.auth.tenantId,
        body.toWarehouseId,
        scopeAuth
      );
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
    {
      preHandler: [
        authenticate,
        requireAnyPermission([PERMISSIONS.STOCK_TRANSFER, PERMISSIONS.WAREHOUSE_MANAGE]),
      ],
    },
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
      await assertTransferInScope(ctx.db.raw, request.auth.tenantId, parseInt(id, 10), {
        permissions: request.auth.permissions,
        branchIds: request.auth.branchIds,
      });
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
    {
      preHandler: [
        authenticate,
        requireAnyPermission([PERMISSIONS.STOCK_TRANSFER, PERMISSIONS.WAREHOUSE_MANAGE]),
      ],
    },
    async (request, reply) => {
      const ctx = ctxFactory.create({
        tenantId: request.auth.tenantId,
        userId: request.auth.userId,
        correlationId: request.id,
      });

      const { id } = request.params as { id: string };
      await assertTransferInScope(ctx.db.raw, request.auth.tenantId, parseInt(id, 10), {
        permissions: request.auth.permissions,
        branchIds: request.auth.branchIds,
      });
      const svc = new StockTransferService(ctx.db.raw);
      const transfer = await svc.getWithLines(parseInt(id, 10), request.auth.tenantId);
      return reply.code(200).send({ data: transfer });
    }
  );

  // POST /stock-transfers/:id/submit
  fastify.post(
    '/stock-transfers/:id/submit',
    {
      preHandler: [
        authenticate,
        requireAnyPermission([PERMISSIONS.STOCK_TRANSFER, PERMISSIONS.WAREHOUSE_MANAGE]),
      ],
    },
    async (request, reply) => {
      const ctx = ctxFactory.create({
        tenantId: request.auth.tenantId,
        userId: request.auth.userId,
        correlationId: request.id,
      });
      const { id } = request.params as { id: string };
      await assertTransferInScope(ctx.db.raw, request.auth.tenantId, parseInt(id, 10), {
        permissions: request.auth.permissions,
        branchIds: request.auth.branchIds,
      });
      const svc = new StockTransferService(ctx.db.raw);
      const transfer = await svc.submit(
        parseInt(id, 10),
        request.auth.tenantId,
        request.auth.userId
      );
      return reply.code(200).send({ data: transfer });
    }
  );

  // POST /stock-transfers/:id/approve
  fastify.post(
    '/stock-transfers/:id/approve',
    {
      preHandler: [
        authenticate,
        requireAnyPermission([PERMISSIONS.STOCK_TRANSFER, PERMISSIONS.WAREHOUSE_MANAGE]),
      ],
    },
    async (request, reply) => {
      const ctx = ctxFactory.create({
        tenantId: request.auth.tenantId,
        userId: request.auth.userId,
        correlationId: request.id,
      });
      const { id } = request.params as { id: string };
      await assertTransferInScope(ctx.db.raw, request.auth.tenantId, parseInt(id, 10), {
        permissions: request.auth.permissions,
        branchIds: request.auth.branchIds,
      });
      const svc = new StockTransferService(ctx.db.raw);
      const transfer = await svc.approve(
        parseInt(id, 10),
        request.auth.tenantId,
        request.auth.userId
      );
      return reply.code(200).send({ data: transfer });
    }
  );

  // POST /stock-transfers/:id/dispatch
  fastify.post(
    '/stock-transfers/:id/dispatch',
    {
      preHandler: [
        authenticate,
        requireAnyPermission([PERMISSIONS.STOCK_TRANSFER, PERMISSIONS.WAREHOUSE_MANAGE]),
      ],
    },
    async (request, reply) => {
      const ctx = ctxFactory.create({
        tenantId: request.auth.tenantId,
        userId: request.auth.userId,
        correlationId: request.id,
      });
      const { id } = request.params as { id: string };
      await assertTransferInScope(ctx.db.raw, request.auth.tenantId, parseInt(id, 10), {
        permissions: request.auth.permissions,
        branchIds: request.auth.branchIds,
      });
      const svc = new StockTransferService(ctx.db.raw);
      const transfer = await svc.dispatch(
        parseInt(id, 10),
        request.auth.tenantId,
        request.auth.userId
      );

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
    {
      preHandler: [
        authenticate,
        requireAnyPermission([PERMISSIONS.STOCK_TRANSFER, PERMISSIONS.WAREHOUSE_MANAGE]),
      ],
    },
    async (request, reply) => {
      const ctx = ctxFactory.create({
        tenantId: request.auth.tenantId,
        userId: request.auth.userId,
        correlationId: request.id,
      });
      const { id } = request.params as { id: string };
      const bodyRaw = (request.body as { data?: unknown })?.data ?? request.body;
      const { lines } = z.object({ lines: z.array(ReceiveLineSchema).min(1) }).parse(bodyRaw);
      await assertTransferInScope(ctx.db.raw, request.auth.tenantId, parseInt(id, 10), {
        permissions: request.auth.permissions,
        branchIds: request.auth.branchIds,
      });

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
    {
      preHandler: [
        authenticate,
        requireAnyPermission([PERMISSIONS.STOCK_TRANSFER, PERMISSIONS.WAREHOUSE_MANAGE]),
      ],
    },
    async (request, reply) => {
      const ctx = ctxFactory.create({
        tenantId: request.auth.tenantId,
        userId: request.auth.userId,
        correlationId: request.id,
      });
      const { id } = request.params as { id: string };
      const { reason } = CancelSchema.parse(
        (request.body as { data?: unknown })?.data ?? request.body
      );
      await assertTransferInScope(ctx.db.raw, request.auth.tenantId, parseInt(id, 10), {
        permissions: request.auth.permissions,
        branchIds: request.auth.branchIds,
      });
      const svc = new StockTransferService(ctx.db.raw);
      const transfer = await svc.cancel(
        parseInt(id, 10),
        request.auth.tenantId,
        request.auth.userId,
        reason
      );
      return reply.code(200).send({ data: transfer });
    }
  );
}
