/* global crypto */
import type { FastifyInstance } from 'fastify';
import type { PlatformContextFactory } from '@erp/sdk';
import { tenantScopedHandler, withTenantConnection, DuplicateOperationError } from '@erp/sdk';
import { payments, customers } from '@erp/db';
import { and, desc, eq, sql, getTableColumns } from 'drizzle-orm';
import { z } from 'zod';
import { PERMISSIONS } from '@erp/types';
import { authenticate } from '../middleware/authenticate.js';
import { requirePermission, requireAnyPermission } from '../middleware/authorize.js';
import { PaymentService } from '../domain/PaymentService.js';
import { PaymentNotificationService } from '../domain/PaymentNotificationService.js';
import { sendError } from './http-errors.js';

const CreatePaymentSchema = z.object({
  customerId: z.number().int().positive(),
  branchId: z.number().int().positive(),
  paymentDate: z.string().datetime(),
  paymentMode: z.enum(['CASH', 'CARD', 'UPI', 'CHEQUE', 'NEFT', 'RTGS', 'CREDIT_NOTE', 'ADVANCE']),
  amount: z.number().positive(),
  chequeNumber: z.string().max(30).optional(),
  chequeBankName: z.string().max(100).optional(),
  chequeDate: z.string().datetime().optional(),
  transactionReference: z.string().max(100).optional(),
  notes: z.string().max(1000).optional(),
  // M-8: client-generated idempotency key, same convention as CreateInvoiceSchema.operationId.
  operationId: z.string().max(100).optional(),
});

const AllocateSchema = z.object({
  allocations: z
    .array(
      z.object({
        invoiceId: z.number().int().positive(),
        amount: z.number().positive(),
      })
    )
    .min(1),
});

const BounceSchema = z.object({
  reason: z.string().min(1).max(500),
});

// Phase 9 GUC-per-request rollout — migrated 2026-08-21. POST /payments migrated separately
// 2026-08-22 (RLS-readiness follow-up for the `payments` table, caveat 4g — see its own comment
// below). Every other route here has no external I/O (PaymentService has no fetch() calls);
// post-hoc ctx.audit.log() calls are safe per caveat 4b.
export async function paymentRoutes(
  fastify: FastifyInstance,
  ctxFactory: PlatformContextFactory
): Promise<void> {
  fastify.addHook('preHandler', authenticate);

  fastify.get(
    '/payments',
    { preHandler: requireAnyPermission([PERMISSIONS.PAYMENT_VIEW, PERMISSIONS.PAYMENT_IN_VIEW]) },
    tenantScopedHandler(ctxFactory, async (request, reply, ctx) => {
      const q = request.query as {
        customerId?: string;
        status?: string;
        page?: string;
        pageSize?: string;
      };
      const page = Math.max(1, parseInt(q.page ?? '1', 10));
      const pageSize = Math.min(100, parseInt(q.pageSize ?? '20', 10));

      const conditions = [eq(payments.tenantId, ctx.tenant.tenantId)];
      if (q.status) conditions.push(eq(payments.status, q.status as never));
      if (q.customerId) conditions.push(eq(payments.customerId, parseInt(q.customerId, 10)));

      const rows = await ctx.db.raw
        .select({ ...getTableColumns(payments), customerName: customers.displayName })
        .from(payments)
        .leftJoin(customers, eq(payments.customerId, customers.id))
        .where(and(...conditions))
        .orderBy(desc(payments.paymentDate), desc(payments.id))
        .limit(pageSize)
        .offset((page - 1) * pageSize);

      const [countRow] = await ctx.db.raw
        .select({ count: sql<number>`count(*)::int` })
        .from(payments)
        .where(and(...conditions));

      return reply.send({
        data: { content: rows, totalElements: countRow?.count ?? 0, page, pageSize },
      });
    })
  );

  // RLS-readiness follow-up (2026-08-22): previously deliberately unmigrated because
  // PaymentNotificationService.notifyPaymentReceived() makes real fetch() calls to
  // notification-service, interleaved after its own DB reads (checklist caveat 4). Now split
  // per caveat 4g, same shape as invoice.routes.ts's POST /invoices/:id/confirm: all the DB work
  // below (including the DuplicateOperationError existing-row lookup) runs inside one
  // withTenantConnection wrap (ctx built inside it), and notifyPaymentReceived — which now
  // manages its own separate wrap for its own reads, strictly outside this one — runs after this
  // wrap has already committed.
  fastify.post('/payments', {
    preHandler: requirePermission(PERMISSIONS.PAYMENT_CREATE),
    handler: async (req, reply) => {
      const body = CreatePaymentSchema.parse(req.body);
      const correlationId =
        (req.headers['x-correlation-id'] as string | undefined) ?? crypto.randomUUID();
      const paymentNumber = `PAY-${req.auth.tenantId}-${Date.now()}`;

      const result = await withTenantConnection(
        ctxFactory.rawDb,
        req.auth.tenantId,
        async (scopedDb) => {
          const ctx = ctxFactory.create(
            { tenantId: req.auth.tenantId, userId: req.auth.userId, correlationId },
            scopedDb
          );
          const svc = new PaymentService(ctx.db.raw);

          let id: number;
          try {
            id = await svc.create({
              tenantId: req.auth.tenantId,
              branchId: body.branchId,
              customerId: body.customerId,
              paymentNumber,
              paymentDate: new Date(body.paymentDate),
              paymentMode: body.paymentMode,
              amount: body.amount,
              chequeNumber: body.chequeNumber,
              chequeBankName: body.chequeBankName,
              chequeDate: body.chequeDate ? new Date(body.chequeDate) : undefined,
              transactionReference: body.transactionReference,
              notes: body.notes,
              createdBy: req.auth.userId,
              clientOperationId: body.operationId,
            } as Parameters<typeof svc.create>[0]);
          } catch (err) {
            // M-8: a network-timeout retry with the same operationId lands here instead of
            // creating a duplicate Payment row — return the one that already exists.
            if (err instanceof DuplicateOperationError && body.operationId) {
              const [existing] = await ctx.db.raw
                .select({ id: payments.id })
                .from(payments)
                .where(
                  and(
                    eq(payments.tenantId, req.auth.tenantId),
                    eq(payments.clientOperationId, body.operationId)
                  )
                );
              if (existing) {
                return { kind: 'duplicate' as const, id: existing.id };
              }
              return { kind: 'duplicate-in-progress' as const };
            }
            throw err;
          }

          // M-16 fix: no route in this file wrote to the audit log at all despite mutating
          // financial state.
          await ctx.audit.log({
            action: 'CREATE',
            entityType: 'payment',
            entityId: id,
            after: {
              paymentNumber,
              customerId: body.customerId,
              amount: body.amount,
              paymentMode: body.paymentMode,
            },
            actorEmail: req.auth.email,
            ipAddress: req.ip,
          });

          return { kind: 'created' as const, id };
        }
      );

      if (result.kind === 'duplicate-in-progress') {
        return sendError(
          reply,
          409,
          'DUPLICATE_OPERATION_PROCESSING',
          'This payment is still being recorded — please retry shortly'
        );
      }
      if (result.kind === 'duplicate') {
        return reply.code(200).send({ data: { id: result.id, paymentNumber } });
      }

      // H-9 fix: payment creation previously only enqueued a tenant-configured outbound
      // webhook — no customer-facing acknowledgment at all.
      await PaymentNotificationService.notifyPaymentReceived(
        ctxFactory.rawDb,
        req.auth.tenantId,
        result.id
      );

      return reply.code(201).send({ data: { id: result.id, paymentNumber } });
    },
  });

  fastify.get(
    '/payments/:id',
    { preHandler: requireAnyPermission([PERMISSIONS.PAYMENT_VIEW, PERMISSIONS.PAYMENT_IN_VIEW]) },
    tenantScopedHandler(ctxFactory, async (request, reply, ctx) => {
      const { id } = request.params as { id: string };
      const [row] = await ctx.db.raw
        .select()
        .from(payments)
        .where(and(eq(payments.id, parseInt(id, 10)), eq(payments.tenantId, ctx.tenant.tenantId)));
      if (!row) return sendError(reply, 404, 'NOT_FOUND', 'Payment not found');
      return reply.send({ data: row });
    })
  );

  fastify.post(
    '/payments/:id/allocate',
    { preHandler: requirePermission(PERMISSIONS.PAYMENT_CREATE) },
    tenantScopedHandler(ctxFactory, async (request, reply, ctx) => {
      const { id } = request.params as { id: string };
      const body = AllocateSchema.parse(request.body);
      const svc = new PaymentService(ctx.db.raw);
      await svc.allocate(
        parseInt(id, 10),
        ctx.tenant.tenantId,
        body.allocations,
        ctx.tenant.userId
      );
      await ctx.audit.log({
        action: 'UPDATE',
        entityType: 'payment',
        entityId: parseInt(id, 10),
        after: { allocations: body.allocations },
        actorEmail: request.auth.email,
        ipAddress: request.ip,
      });
      return reply.send({ success: true });
    })
  );

  fastify.post(
    '/payments/:id/bounce',
    { preHandler: requirePermission(PERMISSIONS.PAYMENT_CREATE) },
    tenantScopedHandler(ctxFactory, async (request, reply, ctx) => {
      const { id } = request.params as { id: string };
      const body = BounceSchema.parse(request.body);
      const svc = new PaymentService(ctx.db.raw);
      await svc.bounceCheque(parseInt(id, 10), ctx.tenant.tenantId, body.reason);
      await ctx.audit.log({
        action: 'STATUS_CHANGE',
        entityType: 'payment',
        entityId: parseInt(id, 10),
        after: { status: 'BOUNCED', reason: body.reason },
        actorEmail: request.auth.email,
        ipAddress: request.ip,
      });
      return reply.send({ success: true });
    })
  );
}
