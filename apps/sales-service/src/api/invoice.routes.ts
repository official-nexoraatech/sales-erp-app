import type { FastifyInstance } from 'fastify';
import type { PlatformContextFactory } from '@erp/sdk';
import { invoices, invoiceHistory } from '@erp/db';
import { and, desc, eq, ilike, sql } from 'drizzle-orm';
import { z } from 'zod';
import { PERMISSIONS } from '@erp/types';
import { authenticate } from '../middleware/authenticate.js';
import { requirePermission } from '../middleware/authorize.js';
import { InvoiceService } from '../domain/InvoiceService.js';
import type { InvoiceLineInput } from '../domain/InvoiceService.js';

const InvoiceLineSchema = z.object({
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
  warehouseId: z.number().int().positive().optional(),
});

const CreateInvoiceSchema = z.object({
  customerId: z.number().int().positive(),
  branchId: z.number().int().positive(),
  warehouseId: z.number().int().positive(),
  quotationId: z.number().int().positive().optional(),
  deliveryChallanId: z.number().int().positive().optional(),
  placeOfSupply: z.string().length(2),
  sellerStateCode: z.string().length(2),
  invoiceDate: z.string().datetime(),
  dueDate: z.string().datetime(),
  paymentTerms: z.string().max(50).optional(),
  lines: z.array(InvoiceLineSchema).min(1),
  notes: z.string().max(2000).optional(),
  deliveryDate: z.string().datetime().optional(),
  deliveryAddress: z.object({}).passthrough().optional(),
  overrideCreditLimit: z.boolean().default(false),
  overridePriceFloor: z.boolean().default(false),
});

const ConfirmSchema = z.object({
  invoiceNumber: z.string().min(1).max(50),
});

const CancelSchema = z.object({
  reason: z.string().min(1).max(500),
});

export async function invoiceRoutes(
  fastify: FastifyInstance,
  ctxFactory: PlatformContextFactory
): Promise<void> {
  fastify.addHook('preHandler', authenticate);

  fastify.get('/invoices', {
    preHandler: requirePermission(PERMISSIONS.INVOICE_VIEW),
    handler: async (req, reply) => {
      const ctx = ctxFactory.create({ tenantId: req.auth.tenantId, userId: req.auth.userId, correlationId: (req.headers['x-correlation-id'] as string | undefined) ?? crypto.randomUUID() });
      const q = req.query as { search?: string; status?: string; customerId?: string; page?: string; pageSize?: string };
      const page = Math.max(1, parseInt(q.page ?? '1', 10));
      const pageSize = Math.min(100, parseInt(q.pageSize ?? '20', 10));
      const offset = (page - 1) * pageSize;

      const conditions = [eq(invoices.tenantId, req.auth.tenantId)];
      if (q.status) conditions.push(eq(invoices.status, q.status as never));
      if (q.customerId) conditions.push(eq(invoices.customerId, parseInt(q.customerId, 10)));
      if (q.search) conditions.push(ilike(invoices.invoiceNumber, `%${q.search}%`));

      const rows = await ctx.db.raw
        .select()
        .from(invoices)
        .where(and(...conditions))
        .orderBy(desc(invoices.invoiceDate))
        .limit(pageSize)
        .offset(offset);

      return reply.send({ data: rows, page, pageSize });
    },
  });

  fastify.post('/invoices', {
    preHandler: requirePermission(PERMISSIONS.INVOICE_CREATE),
    handler: async (req, reply) => {
      const body = CreateInvoiceSchema.parse(req.body);

      if (body.overrideCreditLimit && !req.auth.permissions.includes(PERMISSIONS.CREDIT_LIMIT_OVERRIDE)) {
        return reply.code(403).send({ error: `Forbidden — missing permission: ${PERMISSIONS.CREDIT_LIMIT_OVERRIDE}` });
      }
      if (body.overridePriceFloor && !req.auth.permissions.includes(PERMISSIONS.PRICE_FLOOR_OVERRIDE)) {
        return reply.code(403).send({ error: `Forbidden — missing permission: ${PERMISSIONS.PRICE_FLOOR_OVERRIDE}` });
      }

      const ctx = ctxFactory.create({ tenantId: req.auth.tenantId, userId: req.auth.userId, correlationId: (req.headers['x-correlation-id'] as string | undefined) ?? crypto.randomUUID() });
      const svc = new InvoiceService(ctx.db.raw);

      const id = await svc.create({
        tenantId: req.auth.tenantId,
        branchId: body.branchId,
        warehouseId: body.warehouseId,
        customerId: body.customerId,
        quotationId: body.quotationId,
        deliveryChallanId: body.deliveryChallanId,
        placeOfSupply: body.placeOfSupply,
        sellerStateCode: body.sellerStateCode,
        invoiceDate: new Date(body.invoiceDate),
        dueDate: new Date(body.dueDate),
        paymentTerms: body.paymentTerms,
        lines: body.lines,
        notes: body.notes,
        deliveryDate: body.deliveryDate ? new Date(body.deliveryDate) : undefined,
        deliveryAddress: body.deliveryAddress,
        createdBy: req.auth.userId,
        overrideCreditLimit: body.overrideCreditLimit,
        overridePriceFloor: body.overridePriceFloor,
      } as Parameters<typeof svc.create>[0]);

      return reply.code(201).send({ data: { id } });
    },
  });

  fastify.get('/invoices/:id', {
    preHandler: requirePermission(PERMISSIONS.INVOICE_VIEW),
    handler: async (req, reply) => {
      const { id } = req.params as { id: string };
      const ctx = ctxFactory.create({ tenantId: req.auth.tenantId, userId: req.auth.userId, correlationId: (req.headers['x-correlation-id'] as string | undefined) ?? crypto.randomUUID() });
      const svc = new InvoiceService(ctx.db.raw);
      const data = await svc.getWithLines(parseInt(id, 10), req.auth.tenantId);
      return reply.send({ data });
    },
  });

  fastify.post('/invoices/:id/confirm', {
    preHandler: requirePermission(PERMISSIONS.INVOICE_CREATE),
    handler: async (req, reply) => {
      const { id } = req.params as { id: string };
      const body = ConfirmSchema.parse(req.body);
      const ctx = ctxFactory.create({ tenantId: req.auth.tenantId, userId: req.auth.userId, correlationId: (req.headers['x-correlation-id'] as string | undefined) ?? crypto.randomUUID() });
      const svc = new InvoiceService(ctx.db.raw);
      await svc.confirm(parseInt(id, 10), req.auth.tenantId, body.invoiceNumber, req.auth.userId);
      return reply.send({ success: true });
    },
  });

  fastify.post('/invoices/:id/cancel', {
    preHandler: requirePermission(PERMISSIONS.INVOICE_CANCEL),
    handler: async (req, reply) => {
      const { id } = req.params as { id: string };
      const body = CancelSchema.parse(req.body);
      const ctx = ctxFactory.create({ tenantId: req.auth.tenantId, userId: req.auth.userId, correlationId: (req.headers['x-correlation-id'] as string | undefined) ?? crypto.randomUUID() });
      const svc = new InvoiceService(ctx.db.raw);
      await svc.cancel(parseInt(id, 10), req.auth.tenantId, req.auth.userId, body.reason);
      return reply.send({ success: true });
    },
  });

  fastify.post('/invoices/:id/duplicate', {
    preHandler: requirePermission(PERMISSIONS.INVOICE_CREATE),
    handler: async (req, reply) => {
      const { id } = req.params as { id: string };
      const ctx = ctxFactory.create({ tenantId: req.auth.tenantId, userId: req.auth.userId, correlationId: (req.headers['x-correlation-id'] as string | undefined) ?? crypto.randomUUID() });
      const svc = new InvoiceService(ctx.db.raw);
      const invoiceNumber = `INV-${req.auth.tenantId}-${Date.now()}`;
      const newId = await svc.duplicate(parseInt(id, 10), req.auth.tenantId, req.auth.userId, invoiceNumber);
      return reply.code(201).send({ data: { id: newId } });
    },
  });

  fastify.get('/invoices/:id/activity', {
    preHandler: requirePermission(PERMISSIONS.INVOICE_VIEW),
    handler: async (req, reply) => {
      const { id } = req.params as { id: string };
      const ctx = ctxFactory.create({ tenantId: req.auth.tenantId, userId: req.auth.userId, correlationId: (req.headers['x-correlation-id'] as string | undefined) ?? crypto.randomUUID() });
      const history = await ctx.db.raw
        .select()
        .from(invoiceHistory)
        .where(and(eq(invoiceHistory.invoiceId, parseInt(id, 10)), eq(invoiceHistory.tenantId, req.auth.tenantId)))
        .orderBy(desc(invoiceHistory.createdAt));
      return reply.send({ data: history });
    },
  });

  fastify.get('/invoices/:id/pdf', {
    preHandler: requirePermission(PERMISSIONS.INVOICE_VIEW),
    handler: async (req, reply) => {
      const { id } = req.params as { id: string };
      const ctx = ctxFactory.create({ tenantId: req.auth.tenantId, userId: req.auth.userId, correlationId: (req.headers['x-correlation-id'] as string | undefined) ?? crypto.randomUUID() });
      const [invoice] = await ctx.db.raw
        .select({ pdfUrl: invoices.pdfUrl })
        .from(invoices)
        .where(and(eq(invoices.id, parseInt(id, 10)), eq(invoices.tenantId, req.auth.tenantId)));
      if (!invoice) return reply.code(404).send({ error: 'Invoice not found' });
      return reply.send({ data: { pdfUrl: invoice.pdfUrl ?? null } });
    },
  });
}
