import type { FastifyInstance } from 'fastify';
import type { PlatformContextFactory } from '@erp/sdk';
import { getBranchScope } from '@erp/sdk';
import {
  posSessions,
  posHeldSales,
  invoices,
  items,
  customers,
  organizationSettings,
  paymentAllocations,
} from '@erp/db';
import { and, desc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { PERMISSIONS } from '@erp/types';
import { authenticate } from '../middleware/authenticate.js';
import { requirePermission } from '../middleware/authorize.js';
import {
  InvoiceService,
  DuplicateOperationError,
  InsufficientStockError,
} from '../domain/InvoiceService.js';
import { PaymentService } from '../domain/PaymentService.js';
import { LoyaltyService } from '../domain/LoyaltyService.js';
import { sendError } from './http-errors.js';

// Cashiers can discount up to this without approval; anything higher requires a user
// whose role carries DISCOUNT_OVERRIDE (SALES_MANAGER/ADMIN/OWNER by default) — reuses
// the existing RBAC permission rather than a new PIN/approval subsystem.
const MAX_CASHIER_DISCOUNT_PCT = 10;

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// OFFLINE-01 — a POS request submits its own branchId in the body (unlike invoice.routes.ts,
// which scopes reads via query filters); this rejects a branchId outside the caller's JWT
// branchIds instead of trusting whatever the client sends, mirroring getBranchScope's use
// in invoice.routes.ts:84.
function branchInScope(
  auth: { permissions: string[]; branchIds: number[] },
  branchId: number
): boolean {
  const scope = getBranchScope(auth);
  return scope === 'all' || scope.includes(branchId);
}

const OpenSessionSchema = z.object({
  branchId: z.number().int().positive(),
  warehouseId: z.number().int().positive(),
  openingCash: z.number().nonnegative(),
});

const CloseSessionSchema = z.object({
  closingCash: z.number().nonnegative(),
});

const POSSaleSchema = z.object({
  sessionId: z.number().int().positive(),
  customerId: z.number().int().positive().optional(),
  branchId: z.number().int().positive(),
  warehouseId: z.number().int().positive(),
  placeOfSupply: z.string().length(2),
  sellerStateCode: z.string().length(2),
  lines: z
    .array(
      z.object({
        itemId: z.number().int().positive(),
        variantId: z.number().int().positive().optional(),
        quantity: z.number().positive(),
        unitPrice: z.number().nonnegative(),
        discountPct: z.number().min(0).max(100).default(0),
        gstRate: z.number().min(0).max(100),
        cessRate: z.number().min(0).max(100).default(0),
        hsnCode: z.string().max(20).optional(),
      })
    )
    .min(1),
  paymentMode: z.enum(['CASH', 'CARD', 'UPI']),
  amountTendered: z.number().nonnegative(),
  loyaltyPointsRedeem: z.number().int().nonnegative().default(0),
  // Split payment — when provided, overrides paymentMode/amountTendered above (which
  // remain for backward compatibility with a single-mode sale).
  payments: z
    .array(
      z.object({
        mode: z.enum(['CASH', 'CARD', 'UPI']),
        amount: z.number().positive(),
      })
    )
    .optional(),
  // OFFLINE-02: client-generated idempotency key, attached at offline-queue time — optional
  // so non-offline/legacy callers that don't send one are unaffected (no dedup for them,
  // same behavior as before this field existed).
  operationId: z.string().uuid().optional(),
});

// OFFLINE-02: on a retried request (same operationId, unique-constraint conflict at
// create()), the winning request may still be mid-flight — polls briefly for the invoice
// to leave DRAFT (i.e. confirm() has committed) before returning its result, instead of
// racing a partial/pre-confirm row back to the client.
async function waitForOperationResult(
  ctx: ReturnType<PlatformContextFactory['create']>,
  tenantId: number,
  operationId: string
): Promise<{
  invoiceId: number;
  invoiceNumber: string;
  grandTotal: string;
  loyaltyPointsEarned: number;
  loyaltyRedemptionValue: string;
} | null> {
  for (let attempt = 0; attempt < 10; attempt++) {
    const [inv] = await ctx.db.raw
      .select({
        id: invoices.id,
        invoiceNumber: invoices.invoiceNumber,
        status: invoices.status,
        grandTotal: invoices.grandTotal,
        loyaltyPointsEarned: invoices.loyaltyPointsEarned,
        loyaltyRedemptionValue: invoices.loyaltyRedemptionValue,
      })
      .from(invoices)
      .where(and(eq(invoices.tenantId, tenantId), eq(invoices.clientOperationId, operationId)));
    if (inv && inv.status !== 'DRAFT' && inv.invoiceNumber) {
      return {
        invoiceId: inv.id,
        invoiceNumber: inv.invoiceNumber,
        grandTotal: inv.grandTotal,
        loyaltyPointsEarned: inv.loyaltyPointsEarned,
        loyaltyRedemptionValue: inv.loyaltyRedemptionValue,
      };
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  return null;
}

export async function posRoutes(
  fastify: FastifyInstance,
  ctxFactory: PlatformContextFactory
): Promise<void> {
  fastify.addHook('preHandler', authenticate);

  // Open POS session
  fastify.post('/pos/sessions/open', {
    preHandler: requirePermission(PERMISSIONS.POS_MANAGE),
    handler: async (req, reply) => {
      const body = OpenSessionSchema.parse(req.body);
      if (!branchInScope(req.auth, body.branchId)) {
        return sendError(reply, 403, 'BRANCH_ACCESS_DENIED', 'You are not assigned to this branch');
      }
      const ctx = ctxFactory.create({
        tenantId: req.auth.tenantId,
        userId: req.auth.userId,
        correlationId:
          (req.headers['x-correlation-id'] as string | undefined) ?? crypto.randomUUID(),
      });
      const sessionNumber = `POS-${req.auth.tenantId}-${Date.now()}`;

      const [row] = await ctx.db.raw
        .insert(posSessions)
        .values({
          tenantId: req.auth.tenantId,
          branchId: body.branchId,
          warehouseId: body.warehouseId,
          sessionNumber,
          status: 'OPEN',
          openedBy: req.auth.userId,
          openingCash: String(body.openingCash),
          totalSales: '0',
          totalTransactions: 0,
        })
        .returning({ id: posSessions.id });

      return reply.code(201).send({ data: { id: row?.id, sessionNumber } });
    },
  });

  // Close POS session
  fastify.post('/pos/sessions/:id/close', {
    preHandler: requirePermission(PERMISSIONS.POS_MANAGE),
    handler: async (req, reply) => {
      const { id } = req.params as { id: string };
      const body = CloseSessionSchema.parse(req.body);
      const ctx = ctxFactory.create({
        tenantId: req.auth.tenantId,
        userId: req.auth.userId,
        correlationId:
          (req.headers['x-correlation-id'] as string | undefined) ?? crypto.randomUUID(),
      });

      const [session] = await ctx.db.raw
        .select()
        .from(posSessions)
        .where(
          and(eq(posSessions.id, parseInt(id, 10)), eq(posSessions.tenantId, req.auth.tenantId))
        );
      if (!session) return sendError(reply, 404, 'NOT_FOUND', 'Session not found');

      const expectedCash =
        parseFloat(String(session.openingCash)) + parseFloat(String(session.totalSales));
      const cashVariance = body.closingCash - expectedCash;

      await ctx.db.raw
        .update(posSessions)
        .set({
          status: 'CLOSED',
          closedBy: req.auth.userId,
          closingCash: String(body.closingCash),
          expectedCash: String(expectedCash),
          cashVariance: String(cashVariance),
          closedAt: new Date(),
        })
        .where(
          and(eq(posSessions.id, parseInt(id, 10)), eq(posSessions.tenantId, req.auth.tenantId))
        );

      return reply.send({ data: { expectedCash, cashVariance } });
    },
  });

  // Active session for the caller — lets the frontend recover "is there an open session"
  // after a page reload, since the only other lookup is by numeric :id.
  fastify.get('/pos/sessions/active', {
    preHandler: requirePermission(PERMISSIONS.POS_MANAGE),
    handler: async (req, reply) => {
      const ctx = ctxFactory.create({
        tenantId: req.auth.tenantId,
        userId: req.auth.userId,
        correlationId:
          (req.headers['x-correlation-id'] as string | undefined) ?? crypto.randomUUID(),
      });
      const [session] = await ctx.db.raw
        .select()
        .from(posSessions)
        .where(
          and(
            eq(posSessions.tenantId, req.auth.tenantId),
            eq(posSessions.openedBy, req.auth.userId),
            eq(posSessions.status, 'OPEN')
          )
        )
        .orderBy(desc(posSessions.openedAt))
        .limit(1);
      return reply.send({ data: session ?? null });
    },
  });

  // Session summary
  fastify.get('/pos/sessions/:id/summary', {
    preHandler: requirePermission(PERMISSIONS.POS_MANAGE),
    handler: async (req, reply) => {
      const { id } = req.params as { id: string };
      const ctx = ctxFactory.create({
        tenantId: req.auth.tenantId,
        userId: req.auth.userId,
        correlationId:
          (req.headers['x-correlation-id'] as string | undefined) ?? crypto.randomUUID(),
      });
      const [session] = await ctx.db.raw
        .select()
        .from(posSessions)
        .where(
          and(eq(posSessions.id, parseInt(id, 10)), eq(posSessions.tenantId, req.auth.tenantId))
        );
      if (!session) return sendError(reply, 404, 'NOT_FOUND', 'Session not found');
      return reply.send({ data: session });
    },
  });

  // Fast-path POS sale
  fastify.post('/pos/sales', {
    preHandler: requirePermission(PERMISSIONS.POS_MANAGE),
    handler: async (req, reply) => {
      const body = POSSaleSchema.parse(req.body);
      if (!branchInScope(req.auth, body.branchId)) {
        return sendError(reply, 403, 'BRANCH_ACCESS_DENIED', 'You are not assigned to this branch');
      }
      const ctx = ctxFactory.create({
        tenantId: req.auth.tenantId,
        userId: req.auth.userId,
        correlationId:
          (req.headers['x-correlation-id'] as string | undefined) ?? crypto.randomUUID(),
      });

      if (!req.auth.permissions.includes(PERMISSIONS.DISCOUNT_OVERRIDE)) {
        const overLimitLine = body.lines.find((l) => l.discountPct > MAX_CASHIER_DISCOUNT_PCT);
        if (overLimitLine) {
          return sendError(
            reply,
            403,
            'DISCOUNT_LIMIT_EXCEEDED',
            `Discount above ${MAX_CASHIER_DISCOUNT_PCT}% requires a manager to complete this sale`
          );
        }
      }

      // Verify session is open
      const [session] = await ctx.db.raw
        .select()
        .from(posSessions)
        .where(
          and(
            eq(posSessions.id, body.sessionId),
            eq(posSessions.tenantId, req.auth.tenantId),
            eq(posSessions.status, 'OPEN')
          )
        );
      if (!session) return sendError(reply, 400, 'NO_OPEN_SESSION', 'No open POS session found');

      const svc = new InvoiceService(ctx.db.raw);
      const invoiceNumber = `POS-${req.auth.tenantId}-${Date.now()}`;

      let invoiceId: number;
      try {
        invoiceId = await svc.create({
          tenantId: req.auth.tenantId,
          branchId: body.branchId,
          warehouseId: body.warehouseId,
          customerId: body.customerId ?? 0,
          placeOfSupply: body.placeOfSupply,
          sellerStateCode: body.sellerStateCode,
          invoiceDate: new Date(),
          dueDate: new Date(),
          lines: body.lines.map((l) => ({ ...l, discountAmount: 0 })),
          createdBy: req.auth.userId,
          clientOperationId: body.operationId,
        } as Parameters<typeof svc.create>[0]);
      } catch (err) {
        // OFFLINE-02: this operationId was already claimed by a prior (or concurrent)
        // request — this is a retried offline-sale sync, not a new sale. Return the
        // already-committed original result instead of creating a duplicate invoice.
        if (err instanceof DuplicateOperationError && body.operationId) {
          const existing = await waitForOperationResult(ctx, req.auth.tenantId, body.operationId);
          if (!existing) {
            return sendError(
              reply,
              409,
              'DUPLICATE_OPERATION_PROCESSING',
              'This sale is still being processed — please retry shortly'
            );
          }
          const paymentRows = await ctx.db.raw
            .selectDistinct({ paymentId: paymentAllocations.paymentId })
            .from(paymentAllocations)
            .where(
              and(
                eq(paymentAllocations.invoiceId, existing.invoiceId),
                eq(paymentAllocations.tenantId, req.auth.tenantId)
              )
            );
          return reply.code(200).send({
            data: {
              invoiceId: existing.invoiceId,
              invoiceNumber: existing.invoiceNumber,
              grandTotal: existing.grandTotal,
              paymentIds: paymentRows.map((p) => p.paymentId),
              loyaltyPointsEarned: existing.loyaltyPointsEarned,
              loyaltyRedemptionValue: existing.loyaltyRedemptionValue,
            },
          });
        }
        throw err;
      }

      // Immediately confirm POS sales (no draft state)
      try {
        await svc.confirm(invoiceId, req.auth.tenantId, invoiceNumber, req.auth.userId);
      } catch (err) {
        if (err instanceof InsufficientStockError) {
          // OFFLINE-07: create() already committed a DRAFT invoice (its own transaction,
          // separate from confirm()'s) — left un-voided, that orphan would permanently
          // block any retry under the same operationId (unique constraint) while never
          // itself reaching a resolvable state. Void it now so the cashier's adjust/cancel
          // resolution (offline sync stuck-item UI) can resubmit cleanly under a new one.
          await svc.cancel(
            invoiceId,
            req.auth.tenantId,
            req.auth.userId,
            `Stock conflict at sync: ${err.message}`
          );
          return sendError(reply, 422, 'INSUFFICIENT_STOCK', err.message, {
            itemId: err.itemId,
            available: err.available,
            requested: err.requested,
          });
        }
        throw err;
      }

      const [inv] = await ctx.db.raw
        .select({ grandTotal: invoices.grandTotal })
        .from(invoices)
        .where(eq(invoices.id, invoiceId));
      const grandTotal = parseFloat(String(inv?.grandTotal ?? 0));

      const paymentSvc = new PaymentService(ctx.db.raw);
      const loyaltySvc = new LoyaltyService(ctx.db.raw);
      const paymentIds: number[] = [];

      // Loyalty redemption reduces the amount due before cash/card/UPI is collected —
      // recorded as its own Payment row (paymentMode LOYALTY) so it shows in reconciliation.
      let redemptionValue = 0;
      if (body.loyaltyPointsRedeem > 0 && body.customerId) {
        redemptionValue = await loyaltySvc.redeemPoints(
          req.auth.tenantId,
          body.customerId,
          body.loyaltyPointsRedeem,
          'POS_SALE',
          invoiceId,
          req.auth.userId
        );
        if (redemptionValue > 0) {
          const loyaltyPaymentId = await paymentSvc.create({
            tenantId: req.auth.tenantId,
            branchId: body.branchId,
            customerId: body.customerId,
            paymentNumber: `PAY-${req.auth.tenantId}-${Date.now()}-0`,
            paymentDate: new Date(),
            paymentMode: 'LOYALTY',
            amount: redemptionValue,
            posSessionId: body.sessionId,
            createdBy: req.auth.userId,
          });
          await paymentSvc.allocate(
            loyaltyPaymentId,
            req.auth.tenantId,
            [{ invoiceId, amount: redemptionValue }],
            req.auth.userId
          );
          paymentIds.push(loyaltyPaymentId);
        }
      }

      // Record and allocate the payment(s) taken at the till — without this, a POS sale
      // left invoices.balanceDue permanently equal to grandTotal, i.e. every counter
      // sale (even cash paid in full) looked unpaid in the books forever. Supports a
      // single mode (paymentMode/amountTendered) or a split across multiple modes.
      const amountDue = round2(grandTotal - redemptionValue);
      const paymentLines =
        body.payments && body.payments.length > 0
          ? body.payments
          : [{ mode: body.paymentMode, amount: amountDue }];

      const paymentsSum = round2(paymentLines.reduce((s, p) => s + p.amount, 0));
      if (Math.abs(paymentsSum - amountDue) > 0.02) {
        return sendError(
          reply,
          400,
          'PAYMENT_MISMATCH',
          `Payments total ₹${paymentsSum} does not match amount due ₹${amountDue}`
        );
      }

      for (const p of paymentLines) {
        const paymentId = await paymentSvc.create({
          tenantId: req.auth.tenantId,
          branchId: body.branchId,
          customerId: body.customerId ?? 0,
          paymentNumber: `PAY-${req.auth.tenantId}-${Date.now()}-${paymentIds.length + 1}`,
          paymentDate: new Date(),
          paymentMode: p.mode,
          amount: p.amount,
          posSessionId: body.sessionId,
          createdBy: req.auth.userId,
        });
        await paymentSvc.allocate(
          paymentId,
          req.auth.tenantId,
          [{ invoiceId, amount: p.amount }],
          req.auth.userId
        );
        paymentIds.push(paymentId);
      }

      // Earn loyalty points on the sale total (best-effort — no-op if the feature flag
      // is off or there's no real customer on the sale).
      let loyaltyPointsEarned = 0;
      if (body.customerId) {
        loyaltyPointsEarned = await loyaltySvc.earnPoints(
          req.auth.tenantId,
          body.customerId,
          grandTotal,
          'POS_SALE',
          invoiceId,
          req.auth.userId
        );
      }

      // Update session totals
      await ctx.db.raw
        .update(posSessions)
        .set({
          totalSales: sql`${posSessions.totalSales} + ${grandTotal}`,
          totalTransactions: sql`${posSessions.totalTransactions} + 1`,
        })
        .where(eq(posSessions.id, body.sessionId));

      return reply.code(201).send({
        data: {
          invoiceId,
          invoiceNumber,
          grandTotal: inv?.grandTotal,
          paymentIds,
          loyaltyPointsEarned,
          loyaltyRedemptionValue: redemptionValue,
        },
      });
    },
  });

  // Quick items for POS (top 20 items by sales)
  fastify.get('/pos/quick-items', {
    preHandler: requirePermission(PERMISSIONS.POS_MANAGE),
    handler: async (req, reply) => {
      const ctx = ctxFactory.create({
        tenantId: req.auth.tenantId,
        userId: req.auth.userId,
        correlationId:
          (req.headers['x-correlation-id'] as string | undefined) ?? crypto.randomUUID(),
      });
      const rows = await ctx.db.raw
        .select()
        .from(items)
        .where(and(eq(items.tenantId, req.auth.tenantId), eq(items.status, 'ACTIVE')))
        .limit(20);
      return reply.send({ data: rows });
    },
  });

  // Optimized customer search for POS
  fastify.get('/pos/customer-search', {
    preHandler: requirePermission(PERMISSIONS.POS_MANAGE),
    handler: async (req, reply) => {
      const ctx = ctxFactory.create({
        tenantId: req.auth.tenantId,
        userId: req.auth.userId,
        correlationId:
          (req.headers['x-correlation-id'] as string | undefined) ?? crypto.randomUUID(),
      });
      const q = req.query as { q?: string };
      if (!q.q || q.q.length < 2) return reply.send({ data: [] });

      const rows = await ctx.db.raw
        .select()
        .from(customers)
        .where(
          and(
            eq(customers.tenantId, req.auth.tenantId),
            eq(customers.status, 'ACTIVE'),
            sql`(${customers.displayName} ILIKE ${`%${q.q}%`} OR ${customers.phone} ILIKE ${`%${q.q}%`})`
          )
        )
        .limit(10);
      return reply.send({ data: rows });
    },
  });

  // Park an in-progress cart (e.g. customer steps away mid-sale) for later resume.
  fastify.post('/pos/held-sales', {
    preHandler: requirePermission(PERMISSIONS.POS_MANAGE),
    handler: async (req, reply) => {
      const body = z
        .object({
          sessionId: z.number().int().positive(),
          customerId: z.number().int().positive().optional(),
          label: z.string().max(100).optional(),
          cart: z.array(z.record(z.unknown())).min(1),
        })
        .parse(req.body);
      const ctx = ctxFactory.create({
        tenantId: req.auth.tenantId,
        userId: req.auth.userId,
        correlationId:
          (req.headers['x-correlation-id'] as string | undefined) ?? crypto.randomUUID(),
      });

      const [row] = await ctx.db.raw
        .insert(posHeldSales)
        .values({
          tenantId: req.auth.tenantId,
          sessionId: body.sessionId,
          customerId: body.customerId,
          label: body.label,
          cart: body.cart,
          createdBy: req.auth.userId,
        })
        .returning({ id: posHeldSales.id });

      return reply.code(201).send({ data: { id: row?.id } });
    },
  });

  // List held sales for the current session (most recent first).
  fastify.get('/pos/held-sales', {
    preHandler: requirePermission(PERMISSIONS.POS_MANAGE),
    handler: async (req, reply) => {
      const ctx = ctxFactory.create({
        tenantId: req.auth.tenantId,
        userId: req.auth.userId,
        correlationId:
          (req.headers['x-correlation-id'] as string | undefined) ?? crypto.randomUUID(),
      });
      const rows = await ctx.db.raw
        .select()
        .from(posHeldSales)
        .where(eq(posHeldSales.tenantId, req.auth.tenantId))
        .orderBy(desc(posHeldSales.createdAt))
        .limit(20);
      return reply.send({ data: rows });
    },
  });

  // Resume a held sale — returns the parked cart and removes the hold (one-time use).
  fastify.post<{ Params: { id: string } }>('/pos/held-sales/:id/resume', {
    preHandler: requirePermission(PERMISSIONS.POS_MANAGE),
    handler: async (req, reply) => {
      const id = parseInt(req.params.id, 10);
      const ctx = ctxFactory.create({
        tenantId: req.auth.tenantId,
        userId: req.auth.userId,
        correlationId:
          (req.headers['x-correlation-id'] as string | undefined) ?? crypto.randomUUID(),
      });

      const [held] = await ctx.db.raw
        .select()
        .from(posHeldSales)
        .where(and(eq(posHeldSales.id, id), eq(posHeldSales.tenantId, req.auth.tenantId)));
      if (!held) return sendError(reply, 404, 'NOT_FOUND', 'Held sale not found');

      await ctx.db.raw
        .delete(posHeldSales)
        .where(and(eq(posHeldSales.id, id), eq(posHeldSales.tenantId, req.auth.tenantId)));

      return reply.send({ data: { cart: held.cart, customerId: held.customerId } });
    },
  });

  // Discard a held sale without resuming it.
  fastify.delete<{ Params: { id: string } }>('/pos/held-sales/:id', {
    preHandler: requirePermission(PERMISSIONS.POS_MANAGE),
    handler: async (req, reply) => {
      const id = parseInt(req.params.id, 10);
      const ctx = ctxFactory.create({
        tenantId: req.auth.tenantId,
        userId: req.auth.userId,
        correlationId:
          (req.headers['x-correlation-id'] as string | undefined) ?? crypto.randomUUID(),
      });
      await ctx.db.raw
        .delete(posHeldSales)
        .where(and(eq(posHeldSales.id, id), eq(posHeldSales.tenantId, req.auth.tenantId)));
      return reply.send({ data: { success: true } });
    },
  });

  // UPI VPA for the checkout QR code — organizationSettings is owned by tenant-service but
  // already read directly from other sales-service domain code (e.g. CampaignService), so
  // this follows the same established cross-service-read-of-shared-tables pattern.
  fastify.get('/pos/upi-vpa', {
    preHandler: requirePermission(PERMISSIONS.POS_MANAGE),
    handler: async (req, reply) => {
      const ctx = ctxFactory.create({
        tenantId: req.auth.tenantId,
        userId: req.auth.userId,
        correlationId:
          (req.headers['x-correlation-id'] as string | undefined) ?? crypto.randomUUID(),
      });
      const [org] = await ctx.db.raw
        .select({
          orgName: organizationSettings.orgName,
          bankDetails: organizationSettings.bankDetails,
        })
        .from(organizationSettings)
        .where(eq(organizationSettings.tenantId, req.auth.tenantId));
      return reply.send({
        data: { upiVpa: org?.bankDetails?.upiVpa ?? null, payeeName: org?.orgName ?? 'Store' },
      });
    },
  });

  // Send the receipt for a completed POS sale via WhatsApp or Email — reuses the same
  // notification-service send-raw-internal pathway CampaignService/InvoiceNotificationService
  // already use, rather than a new integration.
  fastify.post<{ Params: { id: string }; Body: { channel: 'WHATSAPP' | 'EMAIL' } }>(
    '/pos/sales/:id/send-receipt',
    {
      preHandler: requirePermission(PERMISSIONS.POS_MANAGE),
      handler: async (req, reply) => {
        const invoiceId = parseInt(req.params.id, 10);
        const { channel } = z.object({ channel: z.enum(['WHATSAPP', 'EMAIL']) }).parse(req.body);
        const ctx = ctxFactory.create({
          tenantId: req.auth.tenantId,
          userId: req.auth.userId,
          correlationId:
            (req.headers['x-correlation-id'] as string | undefined) ?? crypto.randomUUID(),
        });

        const [invoice] = await ctx.db.raw
          .select({
            invoiceNumber: invoices.invoiceNumber,
            grandTotal: invoices.grandTotal,
            customerId: invoices.customerId,
          })
          .from(invoices)
          .where(and(eq(invoices.id, invoiceId), eq(invoices.tenantId, req.auth.tenantId)));
        if (!invoice) return sendError(reply, 404, 'NOT_FOUND', 'Sale not found');

        const [customer] = await ctx.db.raw
          .select({
            displayName: customers.displayName,
            phone: customers.phone,
            email: customers.email,
            optOutWhatsapp: customers.optOutWhatsapp,
            optOutEmail: customers.optOutEmail,
          })
          .from(customers)
          .where(
            and(eq(customers.id, invoice.customerId), eq(customers.tenantId, req.auth.tenantId))
          );
        if (!customer)
          return sendError(
            reply,
            400,
            'NO_CUSTOMER',
            'This sale has no customer to send a receipt to'
          );
        if (channel === 'WHATSAPP' && (customer.optOutWhatsapp || !customer.phone))
          return sendError(
            reply,
            400,
            'CANNOT_SEND',
            'Customer has no phone on file or has opted out of WhatsApp'
          );
        if (channel === 'EMAIL' && (customer.optOutEmail || !customer.email))
          return sendError(
            reply,
            400,
            'CANNOT_SEND',
            'Customer has no email on file or has opted out of Email'
          );

        const notificationUrl = process.env['NOTIFICATION_SERVICE_URL'] ?? 'http://localhost:3014';
        const internalKey = process.env['INTERNAL_API_KEY'] ?? '';
        const message = `Hi ${customer.displayName}, thank you for your purchase! Receipt ${invoice.invoiceNumber}: Rs. ${invoice.grandTotal}.`;

        const res = await fetch(`${notificationUrl}/notifications/send-raw-internal`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-internal-key': internalKey },
          body: JSON.stringify({
            tenantId: req.auth.tenantId,
            eventType: 'POS_RECEIPT',
            channel,
            body: message,
            ...(channel === 'WHATSAPP'
              ? { recipientPhone: customer.phone }
              : { recipientEmail: customer.email, subject: `Receipt ${invoice.invoiceNumber}` }),
          }),
        });
        if (!res.ok)
          return sendError(
            reply,
            502,
            'NOTIFICATION_FAILED',
            'Could not send the receipt right now'
          );

        return reply.send({ data: { sent: true } });
      },
    }
  );
}
