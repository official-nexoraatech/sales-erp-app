import type { FastifyInstance } from 'fastify';
import type { PlatformContextFactory } from '@erp/sdk';
import { posSessions, invoices, invoiceLines, items, customers, projectionDashboardDaily } from '@erp/db';
import { and, desc, eq, ilike, sql } from 'drizzle-orm';
import { z } from 'zod';
import { PERMISSIONS } from '@erp/types';
import { authenticate } from '../middleware/authenticate.js';
import { requirePermission } from '../middleware/authorize.js';
import { GSTCalculator } from '../domain/GSTCalculator.js';
import { InvoiceService } from '../domain/InvoiceService.js';
import { randomUUID } from 'node:crypto';

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
  lines: z.array(z.object({
    itemId: z.number().int().positive(),
    variantId: z.number().int().positive().optional(),
    quantity: z.number().positive(),
    unitPrice: z.number().nonnegative(),
    discountPct: z.number().min(0).max(100).default(0),
    gstRate: z.number().min(0).max(100),
    hsnCode: z.string().max(20).optional(),
  })).min(1),
  paymentMode: z.enum(['CASH', 'CARD', 'UPI']),
  amountTendered: z.number().nonnegative(),
  loyaltyPointsRedeem: z.number().int().nonnegative().default(0),
});

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
      const ctx = ctxFactory.create({ tenantId: req.auth.tenantId, userId: req.auth.userId, correlationId: (req.headers['x-correlation-id'] as string | undefined) ?? crypto.randomUUID() });
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
      const ctx = ctxFactory.create({ tenantId: req.auth.tenantId, userId: req.auth.userId, correlationId: (req.headers['x-correlation-id'] as string | undefined) ?? crypto.randomUUID() });

      const [session] = await ctx.db.raw
        .select()
        .from(posSessions)
        .where(and(eq(posSessions.id, parseInt(id, 10)), eq(posSessions.tenantId, req.auth.tenantId)));
      if (!session) return reply.code(404).send({ error: 'Session not found' });

      const expectedCash = parseFloat(String(session.openingCash)) + parseFloat(String(session.totalSales));
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
        .where(and(eq(posSessions.id, parseInt(id, 10)), eq(posSessions.tenantId, req.auth.tenantId)));

      return reply.send({ data: { expectedCash, cashVariance } });
    },
  });

  // Session summary
  fastify.get('/pos/sessions/:id/summary', {
    preHandler: requirePermission(PERMISSIONS.POS_MANAGE),
    handler: async (req, reply) => {
      const { id } = req.params as { id: string };
      const ctx = ctxFactory.create({ tenantId: req.auth.tenantId, userId: req.auth.userId, correlationId: (req.headers['x-correlation-id'] as string | undefined) ?? crypto.randomUUID() });
      const [session] = await ctx.db.raw
        .select()
        .from(posSessions)
        .where(and(eq(posSessions.id, parseInt(id, 10)), eq(posSessions.tenantId, req.auth.tenantId)));
      if (!session) return reply.code(404).send({ error: 'Session not found' });
      return reply.send({ data: session });
    },
  });

  // Fast-path POS sale
  fastify.post('/pos/sales', {
    preHandler: requirePermission(PERMISSIONS.POS_MANAGE),
    handler: async (req, reply) => {
      const body = POSSaleSchema.parse(req.body);
      const ctx = ctxFactory.create({ tenantId: req.auth.tenantId, userId: req.auth.userId, correlationId: (req.headers['x-correlation-id'] as string | undefined) ?? crypto.randomUUID() });

      // Verify session is open
      const [session] = await ctx.db.raw
        .select()
        .from(posSessions)
        .where(and(
          eq(posSessions.id, body.sessionId),
          eq(posSessions.tenantId, req.auth.tenantId),
          eq(posSessions.status, 'OPEN')
        ));
      if (!session) return reply.code(400).send({ error: 'No open POS session found' });

      const svc = new InvoiceService(ctx.db.raw);
      const invoiceNumber = `POS-${req.auth.tenantId}-${Date.now()}`;

      const invoiceId = await svc.create({
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
      } as Parameters<typeof svc.create>[0]);

      // Immediately confirm POS sales (no draft state)
      await svc.confirm(invoiceId, req.auth.tenantId, invoiceNumber, req.auth.userId);

      // Update session totals
      const [inv] = await ctx.db.raw
        .select({ grandTotal: invoices.grandTotal })
        .from(invoices)
        .where(eq(invoices.id, invoiceId));

      await ctx.db.raw
        .update(posSessions)
        .set({
          totalSales: sql`${posSessions.totalSales} + ${parseFloat(String(inv?.grandTotal ?? 0))}`,
          totalTransactions: sql`${posSessions.totalTransactions} + 1`,
        })
        .where(eq(posSessions.id, body.sessionId));

      return reply.code(201).send({ data: { invoiceId, invoiceNumber, grandTotal: inv?.grandTotal } });
    },
  });

  // Quick items for POS (top 20 items by sales)
  fastify.get('/pos/quick-items', {
    preHandler: requirePermission(PERMISSIONS.POS_MANAGE),
    handler: async (req, reply) => {
      const ctx = ctxFactory.create({ tenantId: req.auth.tenantId, userId: req.auth.userId, correlationId: (req.headers['x-correlation-id'] as string | undefined) ?? crypto.randomUUID() });
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
      const ctx = ctxFactory.create({ tenantId: req.auth.tenantId, userId: req.auth.userId, correlationId: (req.headers['x-correlation-id'] as string | undefined) ?? crypto.randomUUID() });
      const q = req.query as { q?: string };
      if (!q.q || q.q.length < 2) return reply.send({ data: [] });

      const rows = await ctx.db.raw
        .select()
        .from(customers)
        .where(and(
          eq(customers.tenantId, req.auth.tenantId),
          eq(customers.status, 'ACTIVE'),
          sql`(${customers.displayName} ILIKE ${`%${q.q}%`} OR ${customers.phone} ILIKE ${`%${q.q}%`})`
        ))
        .limit(10);
      return reply.send({ data: rows });
    },
  });
}
