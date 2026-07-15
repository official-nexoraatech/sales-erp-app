/* global crypto, process, fetch, Buffer */
import type { FastifyInstance } from 'fastify';
import type { PlatformContextFactory } from '@erp/sdk';
import {
  invoices,
  invoiceHistory,
  customers,
  organizationSettings,
  einvoiceData,
  items,
} from '@erp/db';
import { and, desc, eq, ilike, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import QRCode from 'qrcode';
import { PERMISSIONS, BusinessError } from '@erp/types';
import { getBranchScope } from '@erp/sdk';
import { authenticate } from '../middleware/authenticate.js';
import { requirePermission } from '../middleware/authorize.js';
import { InvoiceService } from '../domain/InvoiceService.js';
import { InvoiceNotificationService } from '../domain/InvoiceNotificationService.js';
import { sendError } from './http-errors.js';

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
  cessRate: z.number().min(0).max(100).default(0),
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
  invoiceDate: z
    .string()
    .datetime()
    .refine((val) => new Date(val).getTime() <= Date.now(), 'Invoice date cannot be in the future'),
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
      const ctx = ctxFactory.create({
        tenantId: req.auth.tenantId,
        userId: req.auth.userId,
        correlationId:
          (req.headers['x-correlation-id'] as string | undefined) ?? crypto.randomUUID(),
      });
      const q = req.query as {
        search?: string;
        status?: string;
        customerId?: string;
        page?: string;
        pageSize?: string;
      };
      const page = Math.max(1, parseInt(q.page ?? '1', 10));
      const pageSize = Math.min(100, parseInt(q.pageSize ?? '20', 10));
      const offset = (page - 1) * pageSize;

      const conditions = [eq(invoices.tenantId, req.auth.tenantId)];
      if (q.status) conditions.push(eq(invoices.status, q.status as never));
      if (q.customerId) conditions.push(eq(invoices.customerId, parseInt(q.customerId, 10)));
      if (q.search) conditions.push(ilike(invoices.invoiceNumber, `%${q.search}%`));

      // ES-31 — restrict to the caller's assigned branches unless they hold
      // BRANCH_SCOPE_BYPASS or have no branch assignments (see getBranchScope docstring).
      const branchScope = getBranchScope(req.auth);
      if (branchScope !== 'all') conditions.push(inArray(invoices.branchId, branchScope));

      const rows = await ctx.db.raw
        .select()
        .from(invoices)
        .where(and(...conditions))
        // invoiceDate alone ties for every invoice created the same day (the common case once
        // daily volume exceeds one page) — Postgres doesn't guarantee stable ordering among
        // ties, so without a secondary key the newest invoice can unpredictably land past page 1.
        .orderBy(desc(invoices.invoiceDate), desc(invoices.id))
        .limit(pageSize)
        .offset(offset);

      const [countRow] = await ctx.db.raw
        .select({ count: sql<number>`count(*)::int` })
        .from(invoices)
        .where(and(...conditions));

      return reply.send({
        data: { content: rows, totalElements: countRow?.count ?? 0, page, pageSize },
      });
    },
  });

  fastify.post('/invoices', {
    preHandler: requirePermission(PERMISSIONS.INVOICE_CREATE),
    handler: async (req, reply) => {
      const body = CreateInvoiceSchema.parse(req.body);

      if (
        body.overrideCreditLimit &&
        !req.auth.permissions.includes(PERMISSIONS.CREDIT_LIMIT_OVERRIDE)
      ) {
        return sendError(
          reply,
          403,
          'PERMISSION_DENIED',
          `Forbidden — missing permission: ${PERMISSIONS.CREDIT_LIMIT_OVERRIDE}`
        );
      }
      if (
        body.overridePriceFloor &&
        !req.auth.permissions.includes(PERMISSIONS.PRICE_FLOOR_OVERRIDE)
      ) {
        return sendError(
          reply,
          403,
          'PERMISSION_DENIED',
          `Forbidden — missing permission: ${PERMISSIONS.PRICE_FLOOR_OVERRIDE}`
        );
      }

      const ctx = ctxFactory.create({
        tenantId: req.auth.tenantId,
        userId: req.auth.userId,
        correlationId:
          (req.headers['x-correlation-id'] as string | undefined) ?? crypto.randomUUID(),
      });
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

      await ctx.audit.log({
        action: 'CREATE',
        entityType: 'invoice',
        entityId: id,
        after: { customerId: body.customerId, lines: body.lines.length },
        actorEmail: req.auth.email,
        ipAddress: req.ip,
      });

      // PG-028: durable usage-metering event, alongside the existing erp_invoice_create_total
      // Prometheus counter (main.ts onResponse hook) — that counter is the real-time ops view,
      // this event feeds the durable per-tenant usage_events/usage_summary rollup.
      await ctx.events.publish('invoice', id, 'USAGE_INVOICE_CREATED', {
        invoiceId: id,
        customerId: body.customerId,
      });

      return reply.code(201).send({ data: { id } });
    },
  });

  fastify.get('/invoices/:id', {
    preHandler: requirePermission(PERMISSIONS.INVOICE_VIEW),
    handler: async (req, reply) => {
      const { id } = req.params as { id: string };
      const ctx = ctxFactory.create({
        tenantId: req.auth.tenantId,
        userId: req.auth.userId,
        correlationId:
          (req.headers['x-correlation-id'] as string | undefined) ?? crypto.randomUUID(),
      });
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
      const ctx = ctxFactory.create({
        tenantId: req.auth.tenantId,
        userId: req.auth.userId,
        correlationId:
          (req.headers['x-correlation-id'] as string | undefined) ?? crypto.randomUUID(),
      });
      const svc = new InvoiceService(ctx.db.raw);
      await svc.confirm(parseInt(id, 10), req.auth.tenantId, body.invoiceNumber, req.auth.userId);
      await ctx.audit.log({
        action: 'STATUS_CHANGE',
        entityType: 'invoice',
        entityId: parseInt(id, 10),
        before: { status: 'DRAFT' },
        after: { status: 'CONFIRMED', invoiceNumber: body.invoiceNumber },
        changedFields: ['status', 'invoiceNumber'],
        actorEmail: req.auth.email,
        ipAddress: req.ip,
      });
      await InvoiceNotificationService.notifyInvoiceConfirmed(ctx, parseInt(id, 10));
      return reply.send({ success: true });
    },
  });

  fastify.post('/invoices/:id/cancel', {
    preHandler: requirePermission(PERMISSIONS.INVOICE_CANCEL),
    handler: async (req, reply) => {
      const { id } = req.params as { id: string };
      const body = CancelSchema.parse(req.body);
      const ctx = ctxFactory.create({
        tenantId: req.auth.tenantId,
        userId: req.auth.userId,
        correlationId:
          (req.headers['x-correlation-id'] as string | undefined) ?? crypto.randomUUID(),
      });
      const svc = new InvoiceService(ctx.db.raw);
      await svc.cancel(parseInt(id, 10), req.auth.tenantId, req.auth.userId, body.reason);
      await ctx.audit.log({
        action: 'STATUS_CHANGE',
        entityType: 'invoice',
        entityId: parseInt(id, 10),
        after: { status: 'CANCELLED', reason: body.reason },
        changedFields: ['status'],
        actorEmail: req.auth.email,
        ipAddress: req.ip,
      });
      return reply.send({ success: true });
    },
  });

  fastify.get('/invoices/:id/pdf', {
    preHandler: requirePermission(PERMISSIONS.INVOICE_VIEW),
    handler: async (req, reply) => {
      const { id } = req.params as { id: string };
      const invoiceId = parseInt(id, 10);
      const ctx = ctxFactory.create({
        tenantId: req.auth.tenantId,
        userId: req.auth.userId,
        correlationId:
          (req.headers['x-correlation-id'] as string | undefined) ?? crypto.randomUUID(),
      });
      const svc = new InvoiceService(ctx.db.raw);
      const invoice = await svc.getWithLines(invoiceId, req.auth.tenantId);

      const [customer] = await ctx.db.raw
        .select()
        .from(customers)
        .where(
          and(eq(customers.id, invoice.customerId), eq(customers.tenantId, req.auth.tenantId))
        );
      const [org] = await ctx.db.raw
        .select()
        .from(organizationSettings)
        .where(eq(organizationSettings.tenantId, req.auth.tenantId));
      const [einvoice] = await ctx.db.raw
        .select()
        .from(einvoiceData)
        .where(
          and(eq(einvoiceData.invoiceId, invoiceId), eq(einvoiceData.tenantId, req.auth.tenantId))
        );

      const itemIds = [...new Set(invoice.lines.map((l) => l.itemId))];
      const itemRows = itemIds.length
        ? await ctx.db.raw
            .select({ id: items.id, name: items.name })
            .from(items)
            .where(inArray(items.id, itemIds))
        : [];
      const itemNameById = new Map(itemRows.map((i) => [i.id, i.name]));

      let qrCodeDataUri: string | undefined;
      if (einvoice?.signedQrCode) {
        qrCodeDataUri = await QRCode.toDataURL(einvoice.signedQrCode);
      }

      const isInterstate = Number(invoice.igstAmount) > 0;

      const data = {
        org: {
          name: org?.orgName,
          gstin: org?.gstin,
          pan: org?.pan,
          address: org?.address,
          bankDetails: org?.bankDetails,
          termsAndConditions: org?.termsAndConditions,
          logoUrl: org?.logoUrl,
        },
        invoiceNumber: invoice.invoiceNumber,
        invoiceDate: invoice.invoiceDate,
        dueDate: invoice.dueDate,
        placeOfSupply: invoice.placeOfSupply,
        customer: customer && {
          name: customer.displayName,
          address: customer.billingAddress,
          gstin: customer.gstin,
          phone: customer.phone,
        },
        deliveryAddress: invoice.deliveryAddress,
        isInterstate,
        lines: invoice.lines.map((l) => ({
          itemName: itemNameById.get(l.itemId) ?? '',
          description: l.description,
          hsnCode: l.hsnCode,
          qty: l.quantity,
          unit: '',
          rate: l.unitPrice,
          discountPercent: l.discountPct,
          taxableAmount: l.taxableAmount,
          cgstRate: l.cgstRate,
          cgstAmount: l.cgstAmount,
          sgstRate: l.sgstRate,
          sgstAmount: l.sgstAmount,
          igstRate: l.igstRate,
          igstAmount: l.igstAmount,
          lineTotal: l.lineTotal,
        })),
        subTotal: invoice.subtotal,
        totalCgst: invoice.cgstAmount,
        totalSgst: invoice.sgstAmount,
        totalIgst: invoice.igstAmount,
        grandTotal: invoice.grandTotal,
        roundingAdjustment: invoice.roundingAmount,
        notes: invoice.notes,
        irn: einvoice?.irn ?? undefined,
        ackNumber: einvoice?.ackNumber ?? undefined,
        qrCodeDataUri,
      };

      const reportUrl = process.env['REPORT_SERVICE_URL'] ?? 'http://localhost:3015';
      const internalKey = process.env['INTERNAL_API_KEY'] ?? '';
      const res = await fetch(`${reportUrl}/reports/pdf`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-internal-key': internalKey },
        body: JSON.stringify({ documentType: 'TAX_INVOICE', data }),
      });
      if (!res.ok)
        throw new BusinessError('PDF_GENERATION_FAILED', 'Failed to generate invoice PDF');
      const buffer = Buffer.from(await res.arrayBuffer());

      return reply
        .code(200)
        .header('Content-Type', 'application/pdf')
        .header('Content-Disposition', `inline; filename="invoice-${invoice.invoiceNumber}.pdf"`)
        .send(buffer);
    },
  });

  fastify.post('/invoices/:id/duplicate', {
    preHandler: requirePermission(PERMISSIONS.INVOICE_CREATE),
    handler: async (req, reply) => {
      const { id } = req.params as { id: string };
      const ctx = ctxFactory.create({
        tenantId: req.auth.tenantId,
        userId: req.auth.userId,
        correlationId:
          (req.headers['x-correlation-id'] as string | undefined) ?? crypto.randomUUID(),
      });
      const svc = new InvoiceService(ctx.db.raw);
      const invoiceNumber = `INV-${req.auth.tenantId}-${Date.now()}`;
      const newId = await svc.duplicate(
        parseInt(id, 10),
        req.auth.tenantId,
        req.auth.userId,
        invoiceNumber
      );
      return reply.code(201).send({ data: { id: newId } });
    },
  });

  fastify.get('/invoices/:id/activity', {
    preHandler: requirePermission(PERMISSIONS.INVOICE_VIEW),
    handler: async (req, reply) => {
      const { id } = req.params as { id: string };
      const ctx = ctxFactory.create({
        tenantId: req.auth.tenantId,
        userId: req.auth.userId,
        correlationId:
          (req.headers['x-correlation-id'] as string | undefined) ?? crypto.randomUUID(),
      });
      const history = await ctx.db.raw
        .select()
        .from(invoiceHistory)
        .where(
          and(
            eq(invoiceHistory.invoiceId, parseInt(id, 10)),
            eq(invoiceHistory.tenantId, req.auth.tenantId)
          )
        )
        .orderBy(desc(invoiceHistory.createdAt));
      return reply.send({ data: history });
    },
  });
}
