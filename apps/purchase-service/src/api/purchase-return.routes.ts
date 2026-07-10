import type { FastifyInstance } from 'fastify';
import type { PlatformContextFactory } from '@erp/sdk';
import { purchaseReturns, debitNotes, suppliers } from '@erp/db';
import { and, desc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { PERMISSIONS } from '@erp/types';
import { authenticate } from '../middleware/authenticate.js';
import { requirePermission } from '../middleware/authorize.js';
import { PurchaseReturnService } from '../domain/PurchaseReturnService.js';

const ReturnLineSchema = z.object({
  grnLineId: z.number().int().positive(),
  itemId: z.number().int().positive(),
  variantId: z.number().int().positive().optional(),
  returnQty: z.number().positive(),
  unitPrice: z.number().nonnegative(),
  gstRate: z.number().min(0).max(100),
});

const CreateReturnSchema = z.object({
  grnId: z.number().int().positive(),
  supplierId: z.number().int().positive(),
  branchId: z.number().int().positive(),
  warehouseId: z.number().int().positive(),
  returnDate: z.string().datetime(),
  reason: z.enum(['QUALITY_ISSUE', 'WRONG_ITEM', 'EXCESS_QUANTITY', 'DAMAGED', 'OTHER']),
  returnNotes: z.string().max(2000).optional(),
  lines: z.array(ReturnLineSchema).min(1),
});

export async function purchaseReturnRoutes(
  fastify: FastifyInstance,
  ctxFactory: PlatformContextFactory
): Promise<void> {
  fastify.addHook('preHandler', authenticate);

  fastify.get('/purchase-returns', {
    preHandler: requirePermission(PERMISSIONS.PURCHASE_RETURN_VIEW),
    handler: async (req, reply) => {
      const ctx = ctxFactory.create({
        tenantId: req.auth.tenantId,
        userId: req.auth.userId,
        correlationId: (req.headers['x-correlation-id'] as string | undefined) ?? crypto.randomUUID(),
      });
      const q = req.query as { status?: string; supplierId?: string; page?: string; pageSize?: string };
      const page = Math.max(1, parseInt(q.page ?? '1', 10));
      const pageSize = Math.min(100, parseInt(q.pageSize ?? '20', 10));
      const offset = (page - 1) * pageSize;

      const conditions = [eq(purchaseReturns.tenantId, req.auth.tenantId)];
      if (q.status) conditions.push(eq(purchaseReturns.status, q.status as never));
      if (q.supplierId) conditions.push(eq(purchaseReturns.supplierId, parseInt(q.supplierId, 10)));

      const rows = await ctx.db.raw
        .select()
        .from(purchaseReturns)
        .where(and(...conditions))
        .orderBy(desc(purchaseReturns.returnDate))
        .limit(pageSize)
        .offset(offset);

      const [countRow] = await ctx.db.raw
        .select({ count: sql<number>`count(*)::int` })
        .from(purchaseReturns)
        .where(and(...conditions));

      return reply.send({ data: { content: rows, totalElements: countRow?.count ?? 0, page, pageSize } });
    },
  });

  fastify.post('/purchase-returns', {
    preHandler: requirePermission(PERMISSIONS.PURCHASE_RETURN_CREATE),
    handler: async (req, reply) => {
      const body = CreateReturnSchema.parse(req.body);
      const ctx = ctxFactory.create({
        tenantId: req.auth.tenantId,
        userId: req.auth.userId,
        correlationId: (req.headers['x-correlation-id'] as string | undefined) ?? crypto.randomUUID(),
      });
      const svc = new PurchaseReturnService(ctx.db.raw);
      const id = await svc.create({
        tenantId: req.auth.tenantId,
        branchId: body.branchId,
        grnId: body.grnId,
        supplierId: body.supplierId,
        warehouseId: body.warehouseId,
        returnDate: new Date(body.returnDate),
        reason: body.reason,
        returnNotes: body.returnNotes,
        lines: body.lines,
        createdBy: req.auth.userId,
      });
      // returnNumber is generated inside svc.create() (not returned — its contract is just
      // the numeric id) so it's re-read here rather than duplicated/guessed at this layer.
      const [createdReturn] = await ctx.db.raw
        .select({ returnNumber: purchaseReturns.returnNumber })
        .from(purchaseReturns)
        .where(eq(purchaseReturns.id, id));
      const [supplier] = await ctx.db.raw
        .select({ displayName: suppliers.displayName })
        .from(suppliers)
        .where(and(eq(suppliers.id, body.supplierId), eq(suppliers.tenantId, req.auth.tenantId)));
      await ctx.events.publish('purchase_return', id, 'PURCHASE_RETURN_CREATED', {
        returnId: id,
        returnNumber: createdReturn?.returnNumber,
        supplierId: body.supplierId,
        supplierName: supplier?.displayName,
        grnId: body.grnId,
        branchId: body.branchId,
        returnDate: body.returnDate,
        status: 'DRAFT',
      });
      return reply.code(201).send({ data: { id } });
    },
  });

  fastify.post('/purchase-returns/:id/approve', {
    preHandler: requirePermission(PERMISSIONS.PURCHASE_RETURN_APPROVE),
    handler: async (req, reply) => {
      const { id } = req.params as { id: string };
      const ctx = ctxFactory.create({
        tenantId: req.auth.tenantId,
        userId: req.auth.userId,
        correlationId: (req.headers['x-correlation-id'] as string | undefined) ?? crypto.randomUUID(),
      });
      const svc = new PurchaseReturnService(ctx.db.raw);
      const debitNoteId = await svc.approve(parseInt(id, 10), req.auth.tenantId, req.auth.userId);
      return reply.send({ success: true, data: { debitNoteId } });
    },
  });

  fastify.get('/debit-notes', {
    preHandler: requirePermission(PERMISSIONS.PURCHASE_RETURN_VIEW),
    handler: async (req, reply) => {
      const ctx = ctxFactory.create({
        tenantId: req.auth.tenantId,
        userId: req.auth.userId,
        correlationId: (req.headers['x-correlation-id'] as string | undefined) ?? crypto.randomUUID(),
      });
      const q = req.query as { supplierId?: string; status?: string; page?: string; pageSize?: string };
      const page = Math.max(1, parseInt(q.page ?? '1', 10));
      const pageSize = Math.min(100, parseInt(q.pageSize ?? '20', 10));
      const offset = (page - 1) * pageSize;

      const conditions = [eq(debitNotes.tenantId, req.auth.tenantId)];
      if (q.supplierId) conditions.push(eq(debitNotes.supplierId, parseInt(q.supplierId, 10)));
      if (q.status) conditions.push(eq(debitNotes.status, q.status as never));

      const rows = await ctx.db.raw
        .select()
        .from(debitNotes)
        .where(and(...conditions))
        .orderBy(desc(debitNotes.issueDate))
        .limit(pageSize)
        .offset(offset);

      const [countRow] = await ctx.db.raw
        .select({ count: sql<number>`count(*)::int` })
        .from(debitNotes)
        .where(and(...conditions));

      return reply.send({ data: { content: rows, totalElements: countRow?.count ?? 0, page, pageSize } });
    },
  });
}
