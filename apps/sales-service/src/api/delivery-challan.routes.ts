import type { FastifyInstance } from 'fastify';
import type { PlatformContextFactory } from '@erp/sdk';
import { deliveryChallans, customers } from '@erp/db';
import { and, desc, eq, sql, getTableColumns } from 'drizzle-orm';
import { z } from 'zod';
import { PERMISSIONS } from '@erp/types';
import { authenticate } from '../middleware/authenticate.js';
import { requirePermission } from '../middleware/authorize.js';
import { DeliveryChallanService } from '../domain/DeliveryChallanService.js';
import type { ChallanLineInput } from '../domain/DeliveryChallanService.js';

const ChallanLineSchema = z.object({
  itemId: z.number().int().positive(),
  variantId: z.number().int().positive().optional(),
  description: z.string().max(500).optional(),
  quantity: z.number().positive(),
  unitId: z.number().int().positive().optional(),
  unitPrice: z.number().nonnegative().optional(),
  hsnCode: z.string().max(20).optional(),
});

const CancelChallanSchema = z.object({
  reason: z.string().min(1).max(500),
});

const CreateChallanSchema = z.object({
  customerId: z.number().int().positive(),
  branchId: z.number().int().positive(),
  warehouseId: z.number().int().positive(),
  challanDate: z.string().datetime(),
  deliveryAddress: z.object({}).passthrough().optional(),
  lines: z.array(ChallanLineSchema).min(1),
  notes: z.string().max(2000).optional(),
});

export async function deliveryChallanRoutes(
  fastify: FastifyInstance,
  ctxFactory: PlatformContextFactory
): Promise<void> {
  fastify.addHook('preHandler', authenticate);

  fastify.get('/delivery-challans', {
    preHandler: requirePermission(PERMISSIONS.INVOICE_VIEW),
    handler: async (req, reply) => {
      const ctx = ctxFactory.create({
        tenantId: req.auth.tenantId,
        userId: req.auth.userId,
        correlationId:
          (req.headers['x-correlation-id'] as string | undefined) ?? crypto.randomUUID(),
      });
      const q = req.query as {
        status?: string;
        customerId?: string;
        page?: string;
        pageSize?: string;
      };
      const page = Math.max(1, parseInt(q.page ?? '1', 10));
      const pageSize = Math.min(100, parseInt(q.pageSize ?? '20', 10));

      const conditions = [eq(deliveryChallans.tenantId, req.auth.tenantId)];
      if (q.status) conditions.push(eq(deliveryChallans.status, q.status as never));
      if (q.customerId)
        conditions.push(eq(deliveryChallans.customerId, parseInt(q.customerId, 10)));

      const rows = await ctx.db.raw
        .select({ ...getTableColumns(deliveryChallans), customerName: customers.displayName })
        .from(deliveryChallans)
        .leftJoin(customers, eq(deliveryChallans.customerId, customers.id))
        .where(and(...conditions))
        .orderBy(desc(deliveryChallans.challanDate), desc(deliveryChallans.id))
        .limit(pageSize)
        .offset((page - 1) * pageSize);

      const [countRow] = await ctx.db.raw
        .select({ count: sql<number>`count(*)::int` })
        .from(deliveryChallans)
        .where(and(...conditions));

      return reply.send({
        data: { content: rows, totalElements: countRow?.count ?? 0, page, pageSize },
      });
    },
  });

  fastify.post('/delivery-challans', {
    preHandler: requirePermission(PERMISSIONS.INVOICE_CREATE),
    handler: async (req, reply) => {
      const body = CreateChallanSchema.parse(req.body);
      const ctx = ctxFactory.create({
        tenantId: req.auth.tenantId,
        userId: req.auth.userId,
        correlationId:
          (req.headers['x-correlation-id'] as string | undefined) ?? crypto.randomUUID(),
      });
      const svc = new DeliveryChallanService(ctx.db.raw);
      const challanNumber = `DC-${req.auth.tenantId}-${Date.now()}`;

      const id = await svc.create({
        tenantId: req.auth.tenantId,
        branchId: body.branchId,
        warehouseId: body.warehouseId,
        customerId: body.customerId,
        challanNumber,
        challanDate: new Date(body.challanDate),
        deliveryAddress: body.deliveryAddress,
        lines: body.lines as ChallanLineInput[],
        notes: body.notes,
        createdBy: req.auth.userId,
      } as Parameters<typeof svc.create>[0]);

      // M-16 fix: no route in this file wrote to the audit log at all.
      await ctx.audit.log({
        action: 'CREATE',
        entityType: 'delivery_challan',
        entityId: id,
        after: { challanNumber, customerId: body.customerId, status: 'DRAFT' },
        actorEmail: req.auth.email,
        ipAddress: req.ip,
      });

      return reply.code(201).send({ data: { id, challanNumber } });
    },
  });

  fastify.get('/delivery-challans/:id', {
    preHandler: requirePermission(PERMISSIONS.INVOICE_VIEW),
    handler: async (req, reply) => {
      const { id } = req.params as { id: string };
      const ctx = ctxFactory.create({
        tenantId: req.auth.tenantId,
        userId: req.auth.userId,
        correlationId:
          (req.headers['x-correlation-id'] as string | undefined) ?? crypto.randomUUID(),
      });
      const svc = new DeliveryChallanService(ctx.db.raw);
      const data = await svc.getWithLines(parseInt(id, 10), req.auth.tenantId);
      return reply.send({ data });
    },
  });

  fastify.post('/delivery-challans/:id/dispatch', {
    preHandler: requirePermission(PERMISSIONS.INVOICE_CREATE),
    handler: async (req, reply) => {
      const { id } = req.params as { id: string };
      const ctx = ctxFactory.create({
        tenantId: req.auth.tenantId,
        userId: req.auth.userId,
        correlationId:
          (req.headers['x-correlation-id'] as string | undefined) ?? crypto.randomUUID(),
      });
      const svc = new DeliveryChallanService(ctx.db.raw);
      await svc.dispatch(parseInt(id, 10), req.auth.tenantId, req.auth.userId);
      await ctx.audit.log({
        action: 'STATUS_CHANGE',
        entityType: 'delivery_challan',
        entityId: parseInt(id, 10),
        after: { status: 'DISPATCHED' },
        actorEmail: req.auth.email,
        ipAddress: req.ip,
      });
      return reply.send({ success: true });
    },
  });

  // M-6 fix: no cancel route existed at all despite CANCELLED being a valid status.
  fastify.post('/delivery-challans/:id/cancel', {
    preHandler: requirePermission(PERMISSIONS.INVOICE_CANCEL),
    handler: async (req, reply) => {
      const { id } = req.params as { id: string };
      const body = CancelChallanSchema.parse(req.body);
      const ctx = ctxFactory.create({
        tenantId: req.auth.tenantId,
        userId: req.auth.userId,
        correlationId:
          (req.headers['x-correlation-id'] as string | undefined) ?? crypto.randomUUID(),
      });
      const svc = new DeliveryChallanService(ctx.db.raw);
      await svc.cancel(parseInt(id, 10), req.auth.tenantId, req.auth.userId, body.reason);
      await ctx.audit.log({
        action: 'STATUS_CHANGE',
        entityType: 'delivery_challan',
        entityId: parseInt(id, 10),
        after: { status: 'CANCELLED', reason: body.reason },
        actorEmail: req.auth.email,
        ipAddress: req.ip,
      });
      return reply.send({ success: true });
    },
  });

  fastify.post('/delivery-challans/:id/convert-to-invoice', {
    preHandler: requirePermission(PERMISSIONS.INVOICE_CREATE),
    handler: async (req, reply) => {
      const { id } = req.params as { id: string };
      const ctx = ctxFactory.create({
        tenantId: req.auth.tenantId,
        userId: req.auth.userId,
        correlationId:
          (req.headers['x-correlation-id'] as string | undefined) ?? crypto.randomUUID(),
      });
      const svc = new DeliveryChallanService(ctx.db.raw);
      const result = await svc.convertToInvoice(parseInt(id, 10), req.auth.tenantId);
      // Returns challan lines as invoice creation seed data — caller handles invoice creation
      return reply.send({ data: result });
    },
  });
}
