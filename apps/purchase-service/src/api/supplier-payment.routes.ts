/* global process, fetch */
import type { FastifyInstance } from 'fastify';
import type { PlatformContextFactory } from '@erp/sdk';
import { getBranchScope } from '@erp/sdk';
import {
  supplierPayments,
  supplierPaymentAllocations,
  suppliers,
  grns,
  organizationSettings,
  type ErpDatabase,
} from '@erp/db';
import { and, desc, eq, inArray, sql, getTableColumns } from 'drizzle-orm';
import { z } from 'zod';
import { PERMISSIONS, BusinessError, ERPError } from '@erp/types';
import { authenticate } from '../middleware/authenticate.js';
import { requirePermission } from '../middleware/authorize.js';
import { SupplierPaymentService } from '../domain/SupplierPaymentService.js';

const CreateSupplierPaymentSchema = z.object({
  supplierId: z.number().int().positive(),
  branchId: z.number().int().positive(),
  paymentDate: z.string().datetime(),
  paymentMode: z.enum(['CASH', 'CHEQUE', 'NEFT', 'RTGS', 'UPI', 'ADVANCE']),
  amount: z.number().positive(),
  chequeNumber: z.string().max(50).optional(),
  chequeBankName: z.string().max(200).optional(),
  chequeDate: z.string().datetime().optional(),
  isPdc: z.boolean().default(false),
  pdcClearingDate: z.string().datetime().optional(),
  transactionReference: z.string().max(100).optional(),
  notes: z.string().max(2000).optional(),
});

const AllocateSchema = z.object({
  allocations: z
    .array(z.object({ grnId: z.number().int().positive(), amount: z.number().positive() }))
    .min(1),
});

const BounceSchema = z.object({
  reason: z.string().min(1).max(500),
});

// Purchase audit 2026-07-21 gap-fix (systemic pass, part 3): same lightweight-lookup pattern as
// purchase-order.routes.ts's assertPoBranchInScope, for the mutating actions (allocate/bounce/
// voucher) that don't already have the payment row in hand.
async function assertSupplierPaymentBranchInScope(
  ctx: { db: { raw: ErpDatabase } },
  id: number,
  tenantId: number,
  auth: { permissions: string[]; branchIds: number[] }
): Promise<void> {
  const branchScope = getBranchScope(auth);
  if (branchScope === 'all') return;
  const [payment] = await ctx.db.raw
    .select({ branchId: supplierPayments.branchId })
    .from(supplierPayments)
    .where(and(eq(supplierPayments.id, id), eq(supplierPayments.tenantId, tenantId)));
  if (payment && !branchScope.includes(payment.branchId)) {
    throw new ERPError(
      'SUPPLIER_PAYMENT_OUT_OF_SCOPE',
      'Supplier payment is outside your assigned branch(es)',
      403
    );
  }
}

export async function supplierPaymentRoutes(
  fastify: FastifyInstance,
  ctxFactory: PlatformContextFactory
): Promise<void> {
  fastify.addHook('preHandler', authenticate);

  fastify.get('/supplier-payments', {
    preHandler: requirePermission(PERMISSIONS.PAYMENT_OUT_VIEW),
    handler: async (req, reply) => {
      const ctx = ctxFactory.create({
        tenantId: req.auth.tenantId,
        userId: req.auth.userId,
        correlationId:
          (req.headers['x-correlation-id'] as string | undefined) ?? crypto.randomUUID(),
      });
      const q = req.query as {
        supplierId?: string;
        status?: string;
        page?: string;
        pageSize?: string;
      };
      const page = Math.max(1, parseInt(q.page ?? '1', 10));
      const pageSize = Math.min(100, parseInt(q.pageSize ?? '20', 10));
      const offset = (page - 1) * pageSize;

      const conditions = [eq(supplierPayments.tenantId, req.auth.tenantId)];
      if (q.supplierId)
        conditions.push(eq(supplierPayments.supplierId, parseInt(q.supplierId, 10)));
      if (q.status) conditions.push(eq(supplierPayments.status, q.status as never));

      // Purchase audit 2026-07-21 gap-fix (systemic pass): see purchase-order.routes.ts's
      // original fix — the same branch-scoping gap exists across every branch-carrying
      // purchase-service entity, not just POs.
      const branchScope = getBranchScope(req.auth);
      if (branchScope !== 'all') {
        if (branchScope.length === 0) {
          return reply.send({ data: { content: [], totalElements: 0, page, pageSize } });
        }
        conditions.push(inArray(supplierPayments.branchId, branchScope));
      }

      const rows = await ctx.db.raw
        .select({ ...getTableColumns(supplierPayments), supplierName: suppliers.displayName })
        .from(supplierPayments)
        .leftJoin(suppliers, eq(supplierPayments.supplierId, suppliers.id))
        .where(and(...conditions))
        .orderBy(desc(supplierPayments.paymentDate), desc(supplierPayments.id))
        .limit(pageSize)
        .offset(offset);

      const [countRow] = await ctx.db.raw
        .select({ count: sql<number>`count(*)::int` })
        .from(supplierPayments)
        .where(and(...conditions));

      return reply.send({
        data: { content: rows, totalElements: countRow?.count ?? 0, page, pageSize },
      });
    },
  });

  fastify.get('/supplier-payments/:id', {
    preHandler: requirePermission(PERMISSIONS.PAYMENT_OUT_VIEW),
    handler: async (req, reply) => {
      const { id } = req.params as { id: string };
      const ctx = ctxFactory.create({
        tenantId: req.auth.tenantId,
        userId: req.auth.userId,
        correlationId:
          (req.headers['x-correlation-id'] as string | undefined) ?? crypto.randomUUID(),
      });
      const paymentId = parseInt(id, 10);
      const [payment] = await ctx.db.raw
        .select({ ...getTableColumns(supplierPayments), supplierName: suppliers.displayName })
        .from(supplierPayments)
        .leftJoin(suppliers, eq(supplierPayments.supplierId, suppliers.id))
        .where(
          and(eq(supplierPayments.id, paymentId), eq(supplierPayments.tenantId, req.auth.tenantId))
        );
      if (!payment)
        return reply
          .code(404)
          .send({ error: { code: 'NOT_FOUND', message: 'Supplier payment not found' } });

      const branchScope = getBranchScope(req.auth);
      if (branchScope !== 'all' && !branchScope.includes(payment.branchId)) {
        throw new ERPError(
          'SUPPLIER_PAYMENT_OUT_OF_SCOPE',
          'Supplier payment is outside your assigned branch(es)',
          403
        );
      }

      const allocations = await ctx.db.raw
        .select({ ...getTableColumns(supplierPaymentAllocations), grnNumber: grns.grnNumber })
        .from(supplierPaymentAllocations)
        .leftJoin(grns, eq(supplierPaymentAllocations.grnId, grns.id))
        .where(eq(supplierPaymentAllocations.paymentId, paymentId));

      return reply.send({ data: { ...payment, allocations } });
    },
  });

  // Payment voucher PDF — generated on-demand via report-service's PdfEngine, same pattern
  // as purchase-order.routes.ts's GET /purchase-orders/:id/pdf and sales-service's invoice
  // PDF route. Was entirely absent before (no voucher/receipt document existed anywhere in
  // the purchase workflow — audit finding "Payment voucher generation: Absent").
  fastify.get('/supplier-payments/:id/voucher', {
    preHandler: requirePermission(PERMISSIONS.PAYMENT_OUT_VIEW),
    handler: async (req, reply) => {
      const { id } = req.params as { id: string };
      const paymentId = parseInt(id, 10);
      const ctx = ctxFactory.create({
        tenantId: req.auth.tenantId,
        userId: req.auth.userId,
        correlationId:
          (req.headers['x-correlation-id'] as string | undefined) ?? crypto.randomUUID(),
      });
      const [payment] = await ctx.db.raw
        .select()
        .from(supplierPayments)
        .where(
          and(eq(supplierPayments.id, paymentId), eq(supplierPayments.tenantId, req.auth.tenantId))
        );
      if (!payment)
        return reply
          .code(404)
          .send({ error: { code: 'NOT_FOUND', message: 'Supplier payment not found' } });

      const voucherScope = getBranchScope(req.auth);
      if (voucherScope !== 'all' && !voucherScope.includes(payment.branchId)) {
        throw new ERPError(
          'SUPPLIER_PAYMENT_OUT_OF_SCOPE',
          'Supplier payment is outside your assigned branch(es)',
          403
        );
      }

      const [supplier] = await ctx.db.raw
        .select({ displayName: suppliers.displayName })
        .from(suppliers)
        .where(
          and(eq(suppliers.id, payment.supplierId), eq(suppliers.tenantId, req.auth.tenantId))
        );
      const [org] = await ctx.db.raw
        .select()
        .from(organizationSettings)
        .where(eq(organizationSettings.tenantId, req.auth.tenantId));

      const data = {
        org: { name: org?.orgName, address: org?.address },
        voucherNumber: payment.paymentNumber,
        voucherDate: payment.paymentDate,
        supplier: { name: supplier?.displayName ?? `Supplier ${payment.supplierId}` },
        paymentMode: payment.paymentMode,
        chequeNumber: payment.chequeNumber ?? undefined,
        chequeBank: payment.chequeBankName ?? undefined,
        transactionReference: payment.transactionReference ?? undefined,
        amount: payment.amount,
      };

      const reportUrl = process.env['REPORT_SERVICE_URL'] ?? 'http://localhost:3015';
      const internalKey = process.env['INTERNAL_API_KEY'] ?? '';
      const res = await fetch(`${reportUrl}/reports/pdf`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-internal-key': internalKey },
        body: JSON.stringify({ documentType: 'PAYMENT_VOUCHER', data }),
      });
      if (!res.ok)
        throw new BusinessError('PDF_GENERATION_FAILED', 'Failed to generate payment voucher PDF');
      const buffer = Buffer.from(await res.arrayBuffer());

      return reply
        .code(200)
        .header('Content-Type', 'application/pdf')
        .header('Content-Disposition', `inline; filename="${payment.paymentNumber}.pdf"`)
        .send(buffer);
    },
  });

  fastify.post('/supplier-payments', {
    preHandler: requirePermission(PERMISSIONS.PAYMENT_OUT_CREATE),
    handler: async (req, reply) => {
      const body = CreateSupplierPaymentSchema.parse(req.body);

      const createScope = getBranchScope(req.auth);
      if (createScope !== 'all' && !createScope.includes(body.branchId)) {
        throw new ERPError(
          'SUPPLIER_PAYMENT_OUT_OF_SCOPE',
          'Cannot create a supplier payment outside your assigned branch(es)',
          403
        );
      }

      const ctx = ctxFactory.create({
        tenantId: req.auth.tenantId,
        userId: req.auth.userId,
        correlationId:
          (req.headers['x-correlation-id'] as string | undefined) ?? crypto.randomUUID(),
      });
      const svc = new SupplierPaymentService(ctx.db.raw);
      const id = await svc.create({
        tenantId: req.auth.tenantId,
        branchId: body.branchId,
        supplierId: body.supplierId,
        paymentDate: new Date(body.paymentDate),
        paymentMode: body.paymentMode,
        amount: body.amount,
        chequeNumber: body.chequeNumber,
        chequeBankName: body.chequeBankName,
        chequeDate: body.chequeDate ? new Date(body.chequeDate) : undefined,
        isPdc: body.isPdc,
        pdcClearingDate: body.pdcClearingDate ? new Date(body.pdcClearingDate) : undefined,
        transactionReference: body.transactionReference,
        notes: body.notes,
        createdBy: req.auth.userId,
      });
      return reply.code(201).send({ data: { id } });
    },
  });

  fastify.post('/supplier-payments/:id/allocate', {
    preHandler: requirePermission(PERMISSIONS.PAYMENT_OUT_CREATE),
    handler: async (req, reply) => {
      const { id } = req.params as { id: string };
      const body = AllocateSchema.parse(req.body);
      const ctx = ctxFactory.create({
        tenantId: req.auth.tenantId,
        userId: req.auth.userId,
        correlationId:
          (req.headers['x-correlation-id'] as string | undefined) ?? crypto.randomUUID(),
      });
      await assertSupplierPaymentBranchInScope(ctx, parseInt(id, 10), req.auth.tenantId, req.auth);
      const svc = new SupplierPaymentService(ctx.db.raw);
      await svc.allocate(parseInt(id, 10), req.auth.tenantId, body.allocations, req.auth.userId);
      return reply.send({ success: true });
    },
  });

  fastify.post('/supplier-payments/:id/bounce', {
    preHandler: requirePermission(PERMISSIONS.PAYMENT_OUT_CREATE),
    handler: async (req, reply) => {
      const { id } = req.params as { id: string };
      const body = BounceSchema.parse(req.body);
      const ctx = ctxFactory.create({
        tenantId: req.auth.tenantId,
        userId: req.auth.userId,
        correlationId:
          (req.headers['x-correlation-id'] as string | undefined) ?? crypto.randomUUID(),
      });
      await assertSupplierPaymentBranchInScope(ctx, parseInt(id, 10), req.auth.tenantId, req.auth);
      const svc = new SupplierPaymentService(ctx.db.raw);
      await svc.bounceCheque(parseInt(id, 10), req.auth.tenantId, body.reason);
      return reply.send({ success: true });
    },
  });

  fastify.get('/suppliers/:id/outstanding', {
    preHandler: requirePermission(PERMISSIONS.SUPPLIER_STATEMENT_VIEW),
    handler: async (req, reply) => {
      const { id } = req.params as { id: string };
      const ctx = ctxFactory.create({
        tenantId: req.auth.tenantId,
        userId: req.auth.userId,
        correlationId:
          (req.headers['x-correlation-id'] as string | undefined) ?? crypto.randomUUID(),
      });
      const svc = new SupplierPaymentService(ctx.db.raw);
      const data = await svc.getOutstanding(parseInt(id, 10), req.auth.tenantId);
      return reply.send({ data });
    },
  });

  fastify.get('/suppliers/:id/statement', {
    preHandler: requirePermission(PERMISSIONS.SUPPLIER_STATEMENT_VIEW),
    handler: async (req, reply) => {
      const { id } = req.params as { id: string };
      const ctx = ctxFactory.create({
        tenantId: req.auth.tenantId,
        userId: req.auth.userId,
        correlationId:
          (req.headers['x-correlation-id'] as string | undefined) ?? crypto.randomUUID(),
      });
      const svc = new SupplierPaymentService(ctx.db.raw);
      const data = await svc.getStatement(parseInt(id, 10), req.auth.tenantId);
      return reply.send({ data });
    },
  });
}
