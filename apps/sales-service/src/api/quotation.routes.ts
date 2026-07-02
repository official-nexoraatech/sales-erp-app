import type { FastifyInstance } from 'fastify';
import type { PlatformContextFactory } from '@erp/sdk';
import { quotations, quotationLines } from '@erp/db';
import { and, desc, eq, ilike, or } from 'drizzle-orm';
import { z } from 'zod';
import { PERMISSIONS } from '@erp/types';
import { authenticate } from '../middleware/authenticate.js';
import { requirePermission } from '../middleware/authorize.js';
import { QuotationService } from '../domain/QuotationService.js';

const QuotationLineSchema = z.object({
  itemId: z.number().int().positive(),
  variantId: z.number().int().positive().optional(),
  description: z.string().max(500).optional(),
  quantity: z.number().positive(),
  unitId: z.number().int().positive().optional(),
  unitPrice: z.number().nonnegative(),
  discountPct: z.number().min(0).max(100).default(0),
  discountAmount: z.number().min(0).default(0),
  gstRate: z.number().min(0).max(100),
  hsnCode: z.string().max(20).optional(),
});

const CreateQuotationSchema = z.object({
  customerId: z.number().int().positive(),
  branchId: z.number().int().positive(),
  placeOfSupply: z.string().length(2),
  sellerStateCode: z.string().length(2),
  validUntil: z.string().datetime(),
  lines: z.array(QuotationLineSchema).min(1),
  notes: z.string().max(2000).optional(),
  termsAndConditions: z.string().max(5000).optional(),
});

export async function quotationRoutes(
  fastify: FastifyInstance,
  ctxFactory: PlatformContextFactory
): Promise<void> {
  fastify.addHook('preHandler', authenticate);

  fastify.get('/quotations', {
    preHandler: requirePermission(PERMISSIONS.INVOICE_VIEW),
    handler: async (req, reply) => {
      const ctx = ctxFactory.create({ tenantId: req.auth.tenantId, userId: req.auth.userId, correlationId: (req.headers['x-correlation-id'] as string | undefined) ?? crypto.randomUUID() });
      const q = req.query as { search?: string; status?: string; customerId?: string; page?: string; pageSize?: string };
      const page = Math.max(1, parseInt(q.page ?? '1', 10));
      const pageSize = Math.min(100, parseInt(q.pageSize ?? '20', 10));
      const offset = (page - 1) * pageSize;

      const conditions = [eq(quotations.tenantId, req.auth.tenantId)];
      if (q.status) conditions.push(eq(quotations.status, q.status as never));
      if (q.customerId) conditions.push(eq(quotations.customerId, parseInt(q.customerId, 10)));
      if (q.search) conditions.push(ilike(quotations.quotationNumber, `%${q.search}%`));

      const rows = await ctx.db.raw
        .select()
        .from(quotations)
        .where(and(...conditions))
        .orderBy(desc(quotations.createdAt))
        .limit(pageSize)
        .offset(offset);

      return reply.send({ data: rows, page, pageSize });
    },
  });

  fastify.post('/quotations', {
    preHandler: requirePermission(PERMISSIONS.INVOICE_CREATE),
    handler: async (req, reply) => {
      const body = CreateQuotationSchema.parse(req.body);
      const ctx = ctxFactory.create({ tenantId: req.auth.tenantId, userId: req.auth.userId, correlationId: (req.headers['x-correlation-id'] as string | undefined) ?? crypto.randomUUID() });
      const svc = new QuotationService(ctx.db.raw);

      const quotationNumber = `QT-${req.auth.tenantId}-${Date.now()}`;

      const id = await svc.create({
        tenantId: req.auth.tenantId,
        branchId: body.branchId,
        customerId: body.customerId,
        quotationNumber,
        placeOfSupply: body.placeOfSupply,
        sellerStateCode: body.sellerStateCode,
        validUntil: new Date(body.validUntil),
        lines: body.lines,
        notes: body.notes,
        termsAndConditions: body.termsAndConditions,
        createdBy: req.auth.userId,
      } as Parameters<typeof svc.create>[0]);

      return reply.code(201).send({ data: { id, quotationNumber } });
    },
  });

  fastify.get('/quotations/:id', {
    preHandler: requirePermission(PERMISSIONS.INVOICE_VIEW),
    handler: async (req, reply) => {
      const { id } = req.params as { id: string };
      const ctx = ctxFactory.create({ tenantId: req.auth.tenantId, userId: req.auth.userId, correlationId: (req.headers['x-correlation-id'] as string | undefined) ?? crypto.randomUUID() });
      const svc = new QuotationService(ctx.db.raw);
      const data = await svc.getWithLines(parseInt(id, 10), req.auth.tenantId);
      return reply.send({ data });
    },
  });

  fastify.post('/quotations/:id/send', {
    preHandler: requirePermission(PERMISSIONS.INVOICE_CREATE),
    handler: async (req, reply) => {
      const { id } = req.params as { id: string };
      const ctx = ctxFactory.create({ tenantId: req.auth.tenantId, userId: req.auth.userId, correlationId: (req.headers['x-correlation-id'] as string | undefined) ?? crypto.randomUUID() });
      const svc = new QuotationService(ctx.db.raw);
      await svc.send(parseInt(id, 10), req.auth.tenantId, req.auth.userId);
      return reply.send({ success: true });
    },
  });

  fastify.post('/quotations/:id/convert', {
    preHandler: requirePermission(PERMISSIONS.QUOTATION_CONVERT),
    handler: async (req, reply) => {
      const { id } = req.params as { id: string };
      const ctx = ctxFactory.create({ tenantId: req.auth.tenantId, userId: req.auth.userId, correlationId: (req.headers['x-correlation-id'] as string | undefined) ?? crypto.randomUUID() });
      const svc = new QuotationService(ctx.db.raw);
      const result = await svc.convert(parseInt(id, 10), req.auth.tenantId, req.auth.userId);
      return reply.send({ data: result });
    },
  });

  fastify.post('/quotations/:id/expire', {
    preHandler: requirePermission(PERMISSIONS.INVOICE_CREATE),
    handler: async (req, reply) => {
      const { id } = req.params as { id: string };
      const ctx = ctxFactory.create({ tenantId: req.auth.tenantId, userId: req.auth.userId, correlationId: (req.headers['x-correlation-id'] as string | undefined) ?? crypto.randomUUID() });
      await ctx.db.raw
        .update(quotations)
        .set({ status: 'EXPIRED', updatedAt: new Date() })
        .where(and(eq(quotations.id, parseInt(id, 10)), eq(quotations.tenantId, req.auth.tenantId)));
      return reply.send({ success: true });
    },
  });
}
