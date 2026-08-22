import type { FastifyInstance } from 'fastify';
import type { PlatformContextFactory } from '@erp/sdk';
import { getBranchScope, tenantScopedHandler } from '@erp/sdk';
import { purchaseInvoices } from '@erp/db';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { PERMISSIONS, ERPError } from '@erp/types';
import { authenticate } from '../middleware/authenticate.js';
import { requirePermission } from '../middleware/authorize.js';
import { PurchaseInvoiceService } from '../domain/PurchaseInvoiceService.js';

const InvoiceLineSchema = z.object({
  grnLineId: z.number().int().positive(),
  invoicedQty: z.number().positive(),
  invoicedRate: z.number().nonnegative(),
});

const CreatePurchaseInvoiceSchema = z.object({
  branchId: z.number().int().positive(),
  supplierInvoiceNumber: z.string().min(1).max(100),
  supplierId: z.number().int().positive(),
  purchaseOrderId: z.number().int().positive(),
  grnId: z.number().int().positive(),
  invoiceDate: z.string().datetime(),
  lines: z.array(InvoiceLineSchema).min(1),
  notes: z.string().max(2000).optional(),
});

// Phase 9 GUC-per-request rollout — migrated 2026-08-21. No external I/O —
// PurchaseInvoiceService has no fetch() calls.
export async function purchaseInvoiceRoutes(
  fastify: FastifyInstance,
  ctxFactory: PlatformContextFactory
): Promise<void> {
  fastify.addHook('preHandler', authenticate);

  fastify.get('/purchase-invoices', {
    preHandler: requirePermission(PERMISSIONS.PURCHASE_INVOICE_VIEW),
    handler: tenantScopedHandler(ctxFactory, async (req, reply, ctx) => {
      const q = req.query as { status?: string };
      const svc = new PurchaseInvoiceService(ctx.db.raw);
      const branchScope = getBranchScope(req.auth);
      if (branchScope !== 'all' && branchScope.length === 0) {
        return reply.send({ data: { content: [], totalElements: 0 } });
      }
      const rows = await svc.list(
        ctx.tenant.tenantId,
        q.status,
        branchScope === 'all' ? undefined : branchScope
      );
      return reply.send({ data: { content: rows, totalElements: rows.length } });
    }),
  });

  fastify.post('/purchase-invoices', {
    preHandler: requirePermission(PERMISSIONS.PURCHASE_INVOICE_CREATE),
    handler: tenantScopedHandler(ctxFactory, async (req, reply, ctx) => {
      const body = CreatePurchaseInvoiceSchema.parse(req.body);

      const createScope = getBranchScope(req.auth);
      if (createScope !== 'all' && !createScope.includes(body.branchId)) {
        throw new ERPError(
          'PURCHASE_INVOICE_OUT_OF_SCOPE',
          'Cannot record a purchase invoice outside your assigned branch(es)',
          403
        );
      }

      const svc = new PurchaseInvoiceService(ctx.db.raw);
      const id = await svc.create({
        tenantId: ctx.tenant.tenantId,
        branchId: body.branchId,
        supplierInvoiceNumber: body.supplierInvoiceNumber,
        supplierId: body.supplierId,
        purchaseOrderId: body.purchaseOrderId,
        grnId: body.grnId,
        invoiceDate: new Date(body.invoiceDate),
        lines: body.lines,
        notes: body.notes,
        createdBy: ctx.tenant.userId,
      });
      return reply.code(201).send({ data: { id } });
    }),
  });

  fastify.get('/purchase-invoices/:id', {
    preHandler: requirePermission(PERMISSIONS.PURCHASE_INVOICE_VIEW),
    handler: tenantScopedHandler(ctxFactory, async (req, reply, ctx) => {
      const { id } = req.params as { id: string };
      const svc = new PurchaseInvoiceService(ctx.db.raw);
      const data = await svc.getWithLines(parseInt(id, 10), ctx.tenant.tenantId);

      const branchScope = getBranchScope(req.auth);
      if (branchScope !== 'all' && !branchScope.includes(data.branchId)) {
        throw new ERPError(
          'PURCHASE_INVOICE_OUT_OF_SCOPE',
          'Purchase invoice is outside your assigned branch(es)',
          403
        );
      }

      return reply.send({ data });
    }),
  });

  fastify.post('/purchase-invoices/:id/approve', {
    preHandler: requirePermission(PERMISSIONS.PURCHASE_INVOICE_APPROVE),
    handler: tenantScopedHandler(ctxFactory, async (req, reply, ctx) => {
      const { id } = req.params as { id: string };
      const approveScope = getBranchScope(req.auth);
      if (approveScope !== 'all') {
        const invoiceId = parseInt(id, 10);
        const [row] = await ctx.db.raw
          .select({ branchId: purchaseInvoices.branchId })
          .from(purchaseInvoices)
          .where(
            and(
              eq(purchaseInvoices.id, invoiceId),
              eq(purchaseInvoices.tenantId, ctx.tenant.tenantId)
            )
          );
        if (row && !approveScope.includes(row.branchId)) {
          throw new ERPError(
            'PURCHASE_INVOICE_OUT_OF_SCOPE',
            'Purchase invoice is outside your assigned branch(es)',
            403
          );
        }
      }
      const svc = new PurchaseInvoiceService(ctx.db.raw);
      await svc.approve(parseInt(id, 10), ctx.tenant.tenantId, ctx.tenant.userId);
      return reply.send({ success: true });
    }),
  });
}
