/* global crypto, process, fetch, Buffer */
import type { FastifyInstance } from 'fastify';
import type { PlatformContextFactory } from '@erp/sdk';
import { tenantScopedHandler, withTenantConnection } from '@erp/sdk';
import {
  invoices,
  invoiceHistory,
  invoiceLines,
  customers,
  organizationSettings,
  einvoiceData,
  items,
} from '@erp/db';
import { and, desc, eq, ilike, inArray, sql, getTableColumns } from 'drizzle-orm';
import { z } from 'zod';
import QRCode from 'qrcode';
import { PERMISSIONS, BusinessError } from '@erp/types';
import { getBranchScope } from '@erp/sdk';
import { authenticate } from '../middleware/authenticate.js';
import { requirePermission } from '../middleware/authorize.js';
import { InvoiceService, DuplicateOperationError } from '../domain/InvoiceService.js';
import { InvoiceNotificationService } from '../domain/InvoiceNotificationService.js';
import { sendError } from './http-errors.js';
import { MAX_CASHIER_DISCOUNT_PCT } from '../domain/discount-policy.js';

const InvoiceLineSchema = z
  .object({
    itemId: z.number().int().positive(),
    variantId: z.number().int().positive().optional(),
    description: z.string().max(500).optional(),
    quantity: z.number().positive(),
    unitId: z.number().int().positive().optional(),
    unitPrice: z.number().nonnegative().optional(),
    discountPct: z.number().min(0).max(100).default(0),
    discountAmount: z.number().min(0).default(0),
    gstRate: z.number().min(0).max(100),
    cessRate: z.number().min(0).max(100).default(0),
    hsnCode: z.string().max(20).optional(),
    warehouseId: z.number().int().positive().optional(),
  })
  .refine((line) => !(line.discountPct > 0 && line.discountAmount > 0), {
    message: 'Provide either a flat discount amount or a percentage discount for a line, not both',
    path: ['discountAmount'],
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
  // Optional client-generated idempotency key, same mechanism POS sales already use
  // (invoices.clientOperationId, nullable + unique per tenant — omitting it behaves
  // exactly as before). A network-timeout retry of this route with the same operationId
  // returns the original invoice instead of creating a duplicate DRAFT.
  operationId: z.string().max(100).optional(),
});

const CancelSchema = z.object({
  reason: z.string().min(1).max(500),
});

// Phase 9 GUC-per-request rollout — migrated 2026-08-21 (all but one route), plus a
// RLS-readiness follow-up 2026-08-22. POST /invoices/:id/confirm was originally left
// unmigrated for the same fetch()-interleaved-with-reads reason as GET /invoices/:id/pdf below,
// but an RLS-readiness audit found it (and InvoiceNotificationService.notifyInvoiceConfirmed())
// were real, everyday production call sites that would start throwing "tenant context not set"
// the moment RLS goes live on `invoices` — fixed per caveat 4g: the route's own DB work runs in
// one withTenantConnection wrap, and notifyInvoiceConfirmed() now manages its own separate wrap
// for its own reads (see that file), with the real fetch() calls running after both have
// already committed. GET /invoices/:id/pdf is still deliberately NOT migrated (fetch() to
// report-service). Every other route here has no external I/O; InvoiceService.create()/
// confirm()/cancel() already wrap their own writes in db.transaction(); post-hoc
// ctx.audit.log()/ctx.events.publish() calls and ctx.cache.del() are safe per
// tenantConnection-nested-rollback.test.ts (nested transactions become savepoints of the outer
// one; cache.del() is a single fast Redis round trip, not the class of slow external I/O
// caveat 4 is about).
export async function invoiceRoutes(
  fastify: FastifyInstance,
  ctxFactory: PlatformContextFactory
): Promise<void> {
  fastify.addHook('preHandler', authenticate);

  fastify.get(
    '/invoices',
    { preHandler: requirePermission(PERMISSIONS.INVOICE_VIEW) },
    tenantScopedHandler(ctxFactory, async (request, reply, ctx) => {
      const q = request.query as {
        search?: string;
        status?: string;
        customerId?: string;
        page?: string;
        pageSize?: string;
      };
      const page = Math.max(1, parseInt(q.page ?? '1', 10));
      const pageSize = Math.min(100, parseInt(q.pageSize ?? '20', 10));
      const offset = (page - 1) * pageSize;

      const conditions = [eq(invoices.tenantId, ctx.tenant.tenantId)];
      if (q.status) conditions.push(eq(invoices.status, q.status as never));
      if (q.customerId) conditions.push(eq(invoices.customerId, parseInt(q.customerId, 10)));
      if (q.search) conditions.push(ilike(invoices.invoiceNumber, `%${q.search}%`));

      // ES-31 — restrict to the caller's assigned branches unless they hold
      // BRANCH_SCOPE_BYPASS or have no branch assignments (see getBranchScope docstring).
      const branchScope = getBranchScope(request.auth);
      if (branchScope !== 'all') conditions.push(inArray(invoices.branchId, branchScope));

      const rows = await ctx.db.raw
        .select({ ...getTableColumns(invoices), customerName: customers.displayName })
        .from(invoices)
        .leftJoin(customers, eq(invoices.customerId, customers.id))
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
    })
  );

  fastify.post(
    '/invoices',
    { preHandler: requirePermission(PERMISSIONS.INVOICE_CREATE) },
    tenantScopedHandler(ctxFactory, async (request, reply, ctx) => {
      const body = CreateInvoiceSchema.parse(request.body);

      if (
        body.overrideCreditLimit &&
        !request.auth.permissions.includes(PERMISSIONS.CREDIT_LIMIT_OVERRIDE)
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
        !request.auth.permissions.includes(PERMISSIONS.PRICE_FLOOR_OVERRIDE)
      ) {
        return sendError(
          reply,
          403,
          'PERMISSION_DENIED',
          `Forbidden — missing permission: ${PERMISSIONS.PRICE_FLOOR_OVERRIDE}`
        );
      }
      // H-5 fix: this ceiling was previously enforced only in POS (pos.routes.ts) — a plain
      // INVOICE_CREATE holder could apply a 100% line discount on a back-office invoice with
      // no manager approval at all, the identical action POS blocks above 10%.
      if (!request.auth.permissions.includes(PERMISSIONS.DISCOUNT_OVERRIDE)) {
        const overLimitLine = body.lines.find((l) => l.discountPct > MAX_CASHIER_DISCOUNT_PCT);
        if (overLimitLine) {
          return sendError(
            reply,
            403,
            'DISCOUNT_LIMIT_EXCEEDED',
            `Discount above ${MAX_CASHIER_DISCOUNT_PCT}% requires a manager to complete this invoice`
          );
        }
      }

      const svc = new InvoiceService(ctx.db.raw);

      let id: number;
      try {
        id = await svc.create({
          tenantId: ctx.tenant.tenantId,
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
          createdBy: ctx.tenant.userId,
          overrideCreditLimit: body.overrideCreditLimit,
          overridePriceFloor: body.overridePriceFloor,
          clientOperationId: body.operationId,
        } as Parameters<typeof svc.create>[0]);
      } catch (err) {
        // A network-timeout retry with the same operationId lands here instead of
        // creating a second DRAFT invoice — return the one that already exists.
        if (err instanceof DuplicateOperationError && body.operationId) {
          const [existing] = await ctx.db.raw
            .select({ id: invoices.id })
            .from(invoices)
            .where(
              and(
                eq(invoices.tenantId, ctx.tenant.tenantId),
                eq(invoices.clientOperationId, body.operationId)
              )
            );
          if (existing) {
            return reply.code(200).send({ data: { id: existing.id } });
          }
          return sendError(
            reply,
            409,
            'DUPLICATE_OPERATION_PROCESSING',
            'This invoice is still being created — please retry shortly'
          );
        }
        throw err;
      }

      await ctx.audit.log({
        action: 'CREATE',
        entityType: 'invoice',
        entityId: id,
        after: { customerId: body.customerId, lines: body.lines.length },
        actorEmail: request.auth.email,
        ipAddress: request.ip,
      });

      // PG-028: durable usage-metering event, alongside the existing erp_invoice_create_total
      // Prometheus counter (main.ts onResponse hook) — that counter is the real-time ops view,
      // this event feeds the durable per-tenant usage_events/usage_summary rollup.
      await ctx.events.publish('invoice', id, 'USAGE_INVOICE_CREATED', {
        invoiceId: id,
        customerId: body.customerId,
      });

      return reply.code(201).send({ data: { id } });
    })
  );

  fastify.get(
    '/invoices/:id',
    { preHandler: requirePermission(PERMISSIONS.INVOICE_VIEW) },
    tenantScopedHandler(ctxFactory, async (request, reply, ctx) => {
      const { id } = request.params as { id: string };
      const svc = new InvoiceService(ctx.db.raw);
      const data = await svc.getWithLines(parseInt(id, 10), ctx.tenant.tenantId);
      return reply.send({ data });
    })
  );

  // RLS-readiness follow-up (2026-08-22): previously deliberately unmigrated because
  // InvoiceNotificationService.notifyInvoiceConfirmed() makes real fetch() calls to
  // notification-service, interleaved after its own DB reads (checklist caveat 4). Now split
  // per caveat 4g: all the DB work below runs inside one withTenantConnection wrap (ctx built
  // inside it, same pattern as event-service/gst-service's internal routes), and
  // notifyInvoiceConfirmed — which now manages its own separate wrap for its own reads,
  // strictly outside this one — runs after this wrap has already committed.
  fastify.post('/invoices/:id/confirm', {
    preHandler: requirePermission(PERMISSIONS.INVOICE_CREATE),
    handler: async (req, reply) => {
      const { id } = req.params as { id: string };
      const invoiceId = parseInt(id, 10);
      const correlationId =
        (req.headers['x-correlation-id'] as string | undefined) ?? crypto.randomUUID();

      const invoiceNumber = await withTenantConnection(
        ctxFactory.rawDb,
        req.auth.tenantId,
        async (scopedDb) => {
          const ctx = ctxFactory.create(
            { tenantId: req.auth.tenantId, userId: req.auth.userId, correlationId },
            scopedDb
          );
          const svc = new InvoiceService(ctx.db.raw);
          // C-7 fix: invoiceNumber is now generated server-side (gap-free, FY-scoped
          // sequence) — no longer accepted from the client at all.
          const number = await svc.confirm(invoiceId, req.auth.tenantId, req.auth.userId);

          // Same cross-service item-cache gap GRN receipts had (fixed 2026-07-17) — confirming
          // an invoice writes availableQty/valuation directly to `items`, so inventory-
          // service's Redis item-cache needs the same invalidation or it serves pre-sale stock
          // for up to the full 5-minute TTL.
          const confirmedLines = await ctx.db.raw
            .select({ itemId: invoiceLines.itemId })
            .from(invoiceLines)
            .where(eq(invoiceLines.invoiceId, invoiceId));
          await Promise.all(
            [...new Set(confirmedLines.map((l) => l.itemId))].map((itemId) =>
              ctx.cache.del(`item:${itemId}`)
            )
          );

          await ctx.audit.log({
            action: 'STATUS_CHANGE',
            entityType: 'invoice',
            entityId: invoiceId,
            before: { status: 'DRAFT' },
            after: { status: 'CONFIRMED', invoiceNumber: number },
            changedFields: ['status', 'invoiceNumber'],
            actorEmail: req.auth.email,
            ipAddress: req.ip,
          });
          return number;
        }
      );

      await InvoiceNotificationService.notifyInvoiceConfirmed(
        ctxFactory.rawDb,
        req.auth.tenantId,
        invoiceId
      );
      return reply.send({ success: true, data: { invoiceNumber } });
    },
  });

  fastify.post(
    '/invoices/:id/cancel',
    { preHandler: requirePermission(PERMISSIONS.INVOICE_CANCEL) },
    tenantScopedHandler(ctxFactory, async (request, reply, ctx) => {
      const { id } = request.params as { id: string };
      const body = CancelSchema.parse(request.body);
      const svc = new InvoiceService(ctx.db.raw);
      const cancelledLines = await ctx.db.raw
        .select({ itemId: invoiceLines.itemId })
        .from(invoiceLines)
        .where(eq(invoiceLines.invoiceId, parseInt(id, 10)));
      await svc.cancel(parseInt(id, 10), ctx.tenant.tenantId, ctx.tenant.userId, body.reason);
      await Promise.all(
        [...new Set(cancelledLines.map((l) => l.itemId))].map((itemId) =>
          ctx.cache.del(`item:${itemId}`)
        )
      );
      await ctx.audit.log({
        action: 'STATUS_CHANGE',
        entityType: 'invoice',
        entityId: parseInt(id, 10),
        after: { status: 'CANCELLED', reason: body.reason },
        changedFields: ['status'],
        actorEmail: request.auth.email,
        ipAddress: request.ip,
      });
      return reply.send({ success: true });
    })
  );

  // Deliberately NOT migrated — fetch() to report-service's puppeteer-backed PDF engine,
  // interleaved after several DB reads (checklist caveat 4, same shape as accounting-service's
  // GET /reports/profit-loss/pdf).
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
          // organizationSettings.logoUrl was renamed to logoObjectKey (F14, 2026-07-23) — it
          // was never actually settable before that fix, so this has always been null/undefined
          // in practice; kept as the `logoUrl` key here since that's what report-service's PDF
          // template (`templates/index.ts`) expects, not resolved to a real URL by this fix.
          logoUrl: org?.logoObjectKey,
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

  fastify.post(
    '/invoices/:id/duplicate',
    { preHandler: requirePermission(PERMISSIONS.INVOICE_CREATE) },
    tenantScopedHandler(ctxFactory, async (request, reply, ctx) => {
      const { id } = request.params as { id: string };
      const svc = new InvoiceService(ctx.db.raw);
      const invoiceNumber = `INV-${ctx.tenant.tenantId}-${Date.now()}`;
      const newId = await svc.duplicate(
        parseInt(id, 10),
        ctx.tenant.tenantId,
        ctx.tenant.userId,
        invoiceNumber
      );
      return reply.code(201).send({ data: { id: newId } });
    })
  );

  fastify.get(
    '/invoices/:id/activity',
    { preHandler: requirePermission(PERMISSIONS.INVOICE_VIEW) },
    tenantScopedHandler(ctxFactory, async (request, reply, ctx) => {
      const { id } = request.params as { id: string };
      const history = await ctx.db.raw
        .select()
        .from(invoiceHistory)
        .where(
          and(
            eq(invoiceHistory.invoiceId, parseInt(id, 10)),
            eq(invoiceHistory.tenantId, ctx.tenant.tenantId)
          )
        )
        .orderBy(desc(invoiceHistory.createdAt));
      return reply.send({ data: history });
    })
  );
}
