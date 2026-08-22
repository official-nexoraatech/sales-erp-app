import type { FastifyInstance } from 'fastify';
import type { PlatformContextFactory } from '@erp/sdk';
import { tenantScopedHandler } from '@erp/sdk';
import { quotations, customers } from '@erp/db';
import { and, desc, eq, ilike, sql, getTableColumns } from 'drizzle-orm';
import { z } from 'zod';
import { PERMISSIONS } from '@erp/types';
import { authenticate } from '../middleware/authenticate.js';
import { requirePermission, requireAnyPermission } from '../middleware/authorize.js';
import { QuotationService } from '../domain/QuotationService.js';
import { QuotationNotificationService } from '../domain/QuotationNotificationService.js';
import { sendError } from './http-errors.js';
import { MAX_CASHIER_DISCOUNT_PCT } from '../domain/discount-policy.js';

const QuotationLineSchema = z
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
    hsnCode: z.string().max(20).optional(),
  })
  .refine((line) => !(line.discountPct > 0 && line.discountAmount > 0), {
    message: 'Provide either a flat discount amount or a percentage discount for a line, not both',
    path: ['discountAmount'],
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

// Phase 9 GUC-per-request rollout — migrated 2026-08-21 (all but one route). /quotations/:id/send
// is deliberately NOT migrated: QuotationNotificationService.notifyQuotationSent() makes a real
// fetch() call to notification-service — wrapping it would hold a transaction/connection open for
// that external call. See 23-guc-per-request-rollout-checklist.md's "external I/O mid-handler"
// caveat. Every other route here has no external I/O (QuotationService.create()/convert() already
// wrap their own writes in db.transaction(); post-hoc ctx.audit.log()/ctx.events.publish() calls
// are safe per tenantConnection-nested-rollback.test.ts).
export async function quotationRoutes(
  fastify: FastifyInstance,
  ctxFactory: PlatformContextFactory
): Promise<void> {
  fastify.addHook('preHandler', authenticate);

  fastify.get('/quotations', {
    preHandler: requireAnyPermission([PERMISSIONS.QUOTATION_VIEW, PERMISSIONS.INVOICE_VIEW]),
    handler: tenantScopedHandler(ctxFactory, async (req, reply, ctx) => {
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

      const conditions = [eq(quotations.tenantId, ctx.tenant.tenantId)];
      if (q.status) conditions.push(eq(quotations.status, q.status as never));
      if (q.customerId) conditions.push(eq(quotations.customerId, parseInt(q.customerId, 10)));
      if (q.search) conditions.push(ilike(quotations.quotationNumber, `%${q.search}%`));

      const rows = await ctx.db.raw
        .select({ ...getTableColumns(quotations), customerName: customers.displayName })
        .from(quotations)
        .leftJoin(customers, eq(quotations.customerId, customers.id))
        .where(and(...conditions))
        .orderBy(desc(quotations.createdAt), desc(quotations.id))
        .limit(pageSize)
        .offset(offset);

      const [countRow] = await ctx.db.raw
        .select({ count: sql<number>`count(*)::int` })
        .from(quotations)
        .where(and(...conditions));

      return reply.send({
        data: { content: rows, totalElements: countRow?.count ?? 0, page, pageSize },
      });
    }),
  });

  fastify.post('/quotations', {
    preHandler: requireAnyPermission([PERMISSIONS.QUOTATION_CREATE, PERMISSIONS.INVOICE_CREATE]),
    handler: tenantScopedHandler(ctxFactory, async (req, reply, ctx) => {
      const body = CreateQuotationSchema.parse(req.body);

      // H-5 fix: this ceiling was previously enforced only in POS (pos.routes.ts) — a plain
      // QUOTATION_CREATE holder could apply a 100% line discount with no manager approval.
      if (!req.auth.permissions.includes(PERMISSIONS.DISCOUNT_OVERRIDE)) {
        const overLimitLine = body.lines.find((l) => l.discountPct > MAX_CASHIER_DISCOUNT_PCT);
        if (overLimitLine) {
          return sendError(
            reply,
            403,
            'DISCOUNT_LIMIT_EXCEEDED',
            `Discount above ${MAX_CASHIER_DISCOUNT_PCT}% requires a manager to complete this quotation`
          );
        }
      }

      const svc = new QuotationService(ctx.db.raw);

      const quotationNumber = `QT-${ctx.tenant.tenantId}-${Date.now()}`;

      const id = await svc.create({
        tenantId: ctx.tenant.tenantId,
        branchId: body.branchId,
        customerId: body.customerId,
        quotationNumber,
        placeOfSupply: body.placeOfSupply,
        sellerStateCode: body.sellerStateCode,
        validUntil: new Date(body.validUntil),
        lines: body.lines,
        notes: body.notes,
        termsAndConditions: body.termsAndConditions,
        createdBy: ctx.tenant.userId,
      } as Parameters<typeof svc.create>[0]);

      await ctx.events.publish('quotation', id, 'QUOTATION_CREATED', {
        quotationId: id,
        quotationNumber,
        customerId: body.customerId,
        branchId: body.branchId,
        status: 'DRAFT',
      });
      // M-16 fix: no route in this file wrote to the audit log at all.
      await ctx.audit.log({
        action: 'CREATE',
        entityType: 'quotation',
        entityId: id,
        after: { quotationNumber, customerId: body.customerId, status: 'DRAFT' },
        actorEmail: req.auth.email,
        ipAddress: req.ip,
      });

      return reply.code(201).send({ data: { id, quotationNumber } });
    }),
  });

  fastify.get('/quotations/:id', {
    preHandler: requireAnyPermission([PERMISSIONS.QUOTATION_VIEW, PERMISSIONS.INVOICE_VIEW]),
    handler: tenantScopedHandler(ctxFactory, async (request, reply, ctx) => {
      const { id } = request.params as { id: string };
      const svc = new QuotationService(ctx.db.raw);
      const data = await svc.getWithLines(parseInt(id, 10), ctx.tenant.tenantId);
      return reply.send({ data });
    }),
  });

  // Deliberately NOT migrated — QuotationNotificationService.notifyQuotationSent() makes a real
  // fetch() call to notification-service. See the file-level comment above.
  fastify.post('/quotations/:id/send', {
    preHandler: requireAnyPermission([PERMISSIONS.QUOTATION_UPDATE, PERMISSIONS.INVOICE_CREATE]),
    handler: async (req, reply) => {
      const { id } = req.params as { id: string };
      const ctx = ctxFactory.create({
        tenantId: req.auth.tenantId,
        userId: req.auth.userId,
        correlationId:
          (req.headers['x-correlation-id'] as string | undefined) ?? crypto.randomUUID(),
      });
      const svc = new QuotationService(ctx.db.raw);
      await svc.send(parseInt(id, 10), req.auth.tenantId, req.auth.userId);
      await ctx.events.publish('quotation', parseInt(id, 10), 'QUOTATION_UPDATED', {
        quotationId: parseInt(id, 10),
        status: 'SENT',
      });
      await ctx.audit.log({
        action: 'STATUS_CHANGE',
        entityType: 'quotation',
        entityId: parseInt(id, 10),
        after: { status: 'SENT' },
        actorEmail: req.auth.email,
        ipAddress: req.ip,
      });
      // H-9 fix: "send" previously only flipped the status column — nothing was actually
      // transmitted to the customer.
      await QuotationNotificationService.notifyQuotationSent(ctx, parseInt(id, 10));
      return reply.send({ success: true });
    },
  });

  fastify.post('/quotations/:id/accept', {
    preHandler: requireAnyPermission([PERMISSIONS.QUOTATION_UPDATE, PERMISSIONS.INVOICE_CREATE]),
    handler: tenantScopedHandler(ctxFactory, async (request, reply, ctx) => {
      const { id } = request.params as { id: string };
      const svc = new QuotationService(ctx.db.raw);
      await svc.accept(parseInt(id, 10), ctx.tenant.tenantId, ctx.tenant.userId);
      await ctx.events.publish('quotation', parseInt(id, 10), 'QUOTATION_UPDATED', {
        quotationId: parseInt(id, 10),
        status: 'ACCEPTED',
      });
      await ctx.audit.log({
        action: 'STATUS_CHANGE',
        entityType: 'quotation',
        entityId: parseInt(id, 10),
        after: { status: 'ACCEPTED' },
        actorEmail: request.auth.email,
        ipAddress: request.ip,
      });
      return reply.send({ success: true });
    }),
  });

  fastify.post('/quotations/:id/reject', {
    preHandler: requireAnyPermission([PERMISSIONS.QUOTATION_CANCEL, PERMISSIONS.INVOICE_CREATE]),
    handler: tenantScopedHandler(ctxFactory, async (request, reply, ctx) => {
      const { id } = request.params as { id: string };
      const svc = new QuotationService(ctx.db.raw);
      await svc.reject(parseInt(id, 10), ctx.tenant.tenantId, ctx.tenant.userId);
      await ctx.events.publish('quotation', parseInt(id, 10), 'QUOTATION_UPDATED', {
        quotationId: parseInt(id, 10),
        status: 'REJECTED',
      });
      await ctx.audit.log({
        action: 'STATUS_CHANGE',
        entityType: 'quotation',
        entityId: parseInt(id, 10),
        after: { status: 'REJECTED' },
        actorEmail: request.auth.email,
        ipAddress: request.ip,
      });
      return reply.send({ success: true });
    }),
  });

  fastify.post('/quotations/:id/convert', {
    preHandler: requirePermission(PERMISSIONS.QUOTATION_CONVERT),
    handler: tenantScopedHandler(ctxFactory, async (request, reply, ctx) => {
      const { id } = request.params as { id: string };
      const svc = new QuotationService(ctx.db.raw);
      // QuotationService.convert() already writes a QUOTATION_CONVERTED outbox event
      // inside its own transaction — no separate publish needed here.
      const result = await svc.convert(parseInt(id, 10), ctx.tenant.tenantId, ctx.tenant.userId);
      await ctx.audit.log({
        action: 'STATUS_CHANGE',
        entityType: 'quotation',
        entityId: parseInt(id, 10),
        after: { status: 'CONVERTED' },
        actorEmail: request.auth.email,
        ipAddress: request.ip,
      });
      return reply.send({ data: result });
    }),
  });

  fastify.post('/quotations/:id/expire', {
    preHandler: requireAnyPermission([PERMISSIONS.QUOTATION_UPDATE, PERMISSIONS.INVOICE_CREATE]),
    handler: tenantScopedHandler(ctxFactory, async (request, reply, ctx) => {
      const { id } = request.params as { id: string };
      await ctx.db.raw
        .update(quotations)
        .set({ status: 'EXPIRED', updatedAt: new Date() })
        .where(
          and(eq(quotations.id, parseInt(id, 10)), eq(quotations.tenantId, ctx.tenant.tenantId))
        );
      await ctx.events.publish('quotation', parseInt(id, 10), 'QUOTATION_UPDATED', {
        quotationId: parseInt(id, 10),
        status: 'EXPIRED',
      });
      await ctx.audit.log({
        action: 'STATUS_CHANGE',
        entityType: 'quotation',
        entityId: parseInt(id, 10),
        after: { status: 'EXPIRED' },
        actorEmail: request.auth.email,
        ipAddress: request.ip,
      });
      return reply.send({ success: true });
    }),
  });
}
