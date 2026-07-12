import type { FastifyInstance } from 'fastify';
import type { PlatformContextFactory } from '@erp/sdk';
import { saleReturns, creditNotes } from '@erp/db';
import { and, desc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { PERMISSIONS } from '@erp/types';
import { authenticate } from '../middleware/authenticate.js';
import { requireAnyPermission } from '../middleware/authorize.js';
import { SaleReturnService } from '../domain/SaleReturnService.js';
import { sendError } from './http-errors.js';

const CreateReturnSchema = z.object({
  invoiceId: z.number().int().positive(),
  customerId: z.number().int().positive(),
  branchId: z.number().int().positive(),
  returnDate: z.string().datetime(),
  reason: z.enum(['DEFECTIVE', 'WRONG_ITEM', 'CUSTOMER_CHANGE_MIND', 'QUALITY_ISSUE', 'OTHER']),
  isPhysicalReturn: z.boolean().default(true),
  warehouseId: z.number().int().positive().optional(),
  lines: z
    .array(
      z.object({
        invoiceLineId: z.number().int().positive(),
        itemId: z.number().int().positive(),
        variantId: z.number().int().positive().optional(),
        returnQty: z.number().positive(),
      })
    )
    .min(1),
  notes: z.string().max(1000).optional(),
});

const ApplyCNSchema = z.object({
  invoiceId: z.number().int().positive(),
});

export async function saleReturnRoutes(
  fastify: FastifyInstance,
  ctxFactory: PlatformContextFactory
): Promise<void> {
  fastify.addHook('preHandler', authenticate);

  fastify.get('/sale-returns', {
    preHandler: requireAnyPermission([PERMISSIONS.SALE_RETURN_VIEW, PERMISSIONS.INVOICE_VIEW]),
    handler: async (req, reply) => {
      const ctx = ctxFactory.create({
        tenantId: req.auth.tenantId,
        userId: req.auth.userId,
        correlationId:
          (req.headers['x-correlation-id'] as string | undefined) ?? crypto.randomUUID(),
      });
      const q = req.query as { page?: string; pageSize?: string };
      const page = Math.max(1, parseInt(q.page ?? '1', 10));
      const pageSize = Math.min(100, parseInt(q.pageSize ?? '20', 10));

      const rows = await ctx.db.raw
        .select()
        .from(saleReturns)
        .where(eq(saleReturns.tenantId, req.auth.tenantId))
        .orderBy(desc(saleReturns.returnDate))
        .limit(pageSize)
        .offset((page - 1) * pageSize);

      const [countRow] = await ctx.db.raw
        .select({ count: sql<number>`count(*)::int` })
        .from(saleReturns)
        .where(eq(saleReturns.tenantId, req.auth.tenantId));

      return reply.send({
        data: { content: rows, totalElements: countRow?.count ?? 0, page, pageSize },
      });
    },
  });

  fastify.post('/sale-returns', {
    preHandler: requireAnyPermission([PERMISSIONS.SALE_RETURN_CREATE, PERMISSIONS.INVOICE_CANCEL]),
    handler: async (req, reply) => {
      const body = CreateReturnSchema.parse(req.body);
      const ctx = ctxFactory.create({
        tenantId: req.auth.tenantId,
        userId: req.auth.userId,
        correlationId:
          (req.headers['x-correlation-id'] as string | undefined) ?? crypto.randomUUID(),
      });
      const svc = new SaleReturnService(ctx.db.raw);

      const returnNumber = `RTN-${req.auth.tenantId}-${Date.now()}`;
      const creditNoteNumber = `CN-${req.auth.tenantId}-${Date.now()}`;

      const result = await svc.create({
        tenantId: req.auth.tenantId,
        branchId: body.branchId,
        returnNumber,
        invoiceId: body.invoiceId,
        customerId: body.customerId,
        returnDate: new Date(body.returnDate),
        reason: body.reason,
        isPhysicalReturn: body.isPhysicalReturn,
        warehouseId: body.warehouseId,
        lines: body.lines,
        notes: body.notes,
        creditNoteNumber,
        createdBy: req.auth.userId,
      } as Parameters<typeof svc.create>[0]);

      await ctx.audit.log({
        action: 'CREATE',
        entityType: 'sales_return',
        entityId: result.returnId,
        after: { invoiceId: body.invoiceId, returnNumber, creditNoteId: result.creditNoteId },
        actorEmail: req.auth.email,
        ipAddress: req.ip,
      });

      return reply.code(201).send({ data: result });
    },
  });

  fastify.get('/sale-returns/:id', {
    preHandler: requireAnyPermission([PERMISSIONS.SALE_RETURN_VIEW, PERMISSIONS.INVOICE_VIEW]),
    handler: async (req, reply) => {
      const { id } = req.params as { id: string };
      const ctx = ctxFactory.create({
        tenantId: req.auth.tenantId,
        userId: req.auth.userId,
        correlationId:
          (req.headers['x-correlation-id'] as string | undefined) ?? crypto.randomUUID(),
      });
      const [row] = await ctx.db.raw
        .select()
        .from(saleReturns)
        .where(
          and(eq(saleReturns.id, parseInt(id, 10)), eq(saleReturns.tenantId, req.auth.tenantId))
        );
      if (!row) return sendError(reply, 404, 'NOT_FOUND', 'Sale return not found');
      return reply.send({ data: row });
    },
  });

  fastify.post('/credit-notes/:id/apply', {
    preHandler: requireAnyPermission([PERMISSIONS.CREDIT_NOTE_ADJUST, PERMISSIONS.PAYMENT_CREATE]),
    handler: async (req, reply) => {
      const { id } = req.params as { id: string };
      const body = ApplyCNSchema.parse(req.body);
      const ctx = ctxFactory.create({
        tenantId: req.auth.tenantId,
        userId: req.auth.userId,
        correlationId:
          (req.headers['x-correlation-id'] as string | undefined) ?? crypto.randomUUID(),
      });
      const svc = new SaleReturnService(ctx.db.raw);
      await svc.applyCreditNote(
        parseInt(id, 10),
        body.invoiceId,
        req.auth.tenantId,
        req.auth.userId
      );
      return reply.send({ success: true });
    },
  });

  fastify.post('/credit-notes/:id/refund', {
    preHandler: requireAnyPermission([PERMISSIONS.CREDIT_NOTE_ADJUST, PERMISSIONS.PAYMENT_CREATE]),
    handler: async (req, reply) => {
      const { id } = req.params as { id: string };
      const ctx = ctxFactory.create({
        tenantId: req.auth.tenantId,
        userId: req.auth.userId,
        correlationId:
          (req.headers['x-correlation-id'] as string | undefined) ?? crypto.randomUUID(),
      });
      await ctx.db.raw
        .update(creditNotes)
        .set({
          status: 'REFUNDED',
          usedAmount: creditNotes.amount,
          remainingAmount: '0',
          updatedAt: new Date(),
        })
        .where(
          and(eq(creditNotes.id, parseInt(id, 10)), eq(creditNotes.tenantId, req.auth.tenantId))
        );
      return reply.send({ success: true });
    },
  });
}
