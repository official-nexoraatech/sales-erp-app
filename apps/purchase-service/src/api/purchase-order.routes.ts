/* global process, fetch */
import type { FastifyInstance } from 'fastify';
import type { PlatformContextFactory } from '@erp/sdk';
import { getBranchScope } from '@erp/sdk';
import {
  purchaseOrders,
  purchaseOrderHistory,
  suppliers,
  organizationSettings,
  type ErpDatabase,
} from '@erp/db';
import { and, desc, eq, ilike, inArray, sql, getTableColumns } from 'drizzle-orm';
import { z } from 'zod';
import { PERMISSIONS, BusinessError, ERPError } from '@erp/types';
import { authenticate } from '../middleware/authenticate.js';
import { requirePermission } from '../middleware/authorize.js';
import { PurchaseOrderService } from '../domain/PurchaseOrderService.js';

const POLineSchema = z
  .object({
    itemId: z.number().int().positive(),
    variantId: z.number().int().positive().optional(),
    description: z.string().max(500).optional(),
    orderedQty: z.number().positive(),
    unitId: z.number().int().positive().optional(),
    unitPrice: z.number().nonnegative(),
    discountPct: z.number().min(0).max(100).default(0),
    discountAmount: z.number().min(0).default(0),
    gstRate: z.number().min(0).max(100),
    hsnCode: z.string().max(20).optional(),
  })
  .refine((line) => !(line.discountPct > 0 && line.discountAmount > 0), {
    message: 'Provide either a flat discount amount or a percentage discount for a line, not both',
    path: ['discountAmount'],
  });

const CreatePOSchema = z.object({
  supplierId: z.number().int().positive(),
  branchId: z.number().int().positive(),
  warehouseId: z.number().int().positive(),
  poDate: z.string().datetime(),
  expectedDeliveryDate: z.string().datetime().optional(),
  placeOfSupply: z.string().length(2),
  sellerStateCode: z.string().length(2).optional(),
  lines: z.array(POLineSchema).min(1),
  notes: z.string().max(2000).optional(),
  termsAndConditions: z.string().max(5000).optional(),
  poType: z.enum(['STANDARD', 'BLANKET', 'RATE_CONTRACT']).default('STANDARD'),
  contractValidFrom: z.string().datetime().optional(),
  contractValidTill: z.string().datetime().optional(),
  requisitionId: z.number().int().positive().optional(),
});

const ApproveSchema = z.object({
  poNumber: z.string().min(1).max(50),
  overrideCreditLimit: z.boolean().default(false),
});

const AmendSchema = z.object({
  amendments: z.record(z.string(), z.unknown()),
  reason: z.string().min(1).max(500),
});

const CancelSchema = z.object({
  reason: z.string().min(1).max(500),
});

const UpdatePOSchema = z.object({
  notes: z.string().max(2000).optional(),
  expectedDeliveryDate: z.string().datetime().optional(),
});

// Purchase audit 2026-07-21 gap-fix (systemic pass, part 2): the list/detail branch-scope fix
// only covered GET routes. A branch-restricted caller could still submit/approve/amend/cancel/
// duplicate a PO outside their branch scope by id — same underlying gap, different surface.
// Small lookup (not the full PO) so every mutating handler below can check scope up front
// without duplicating the service's own tenant-scoped fetch.
async function assertPoBranchInScope(
  ctx: { db: { raw: ErpDatabase } },
  id: number,
  tenantId: number,
  auth: { permissions: string[]; branchIds: number[] }
): Promise<void> {
  const branchScope = getBranchScope(auth);
  if (branchScope === 'all') return;
  const [po] = await ctx.db.raw
    .select({ branchId: purchaseOrders.branchId })
    .from(purchaseOrders)
    .where(and(eq(purchaseOrders.id, id), eq(purchaseOrders.tenantId, tenantId)));
  if (po && !branchScope.includes(po.branchId)) {
    throw new ERPError(
      'PO_OUT_OF_SCOPE',
      'Purchase order is outside your assigned branch(es)',
      403
    );
  }
}

export async function purchaseOrderRoutes(
  fastify: FastifyInstance,
  ctxFactory: PlatformContextFactory
): Promise<void> {
  fastify.addHook('preHandler', authenticate);

  fastify.get('/purchase-orders', {
    preHandler: requirePermission(PERMISSIONS.PO_VIEW),
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
        supplierId?: string;
        page?: string;
        pageSize?: string;
      };
      const page = Math.max(1, parseInt(q.page ?? '1', 10));
      const pageSize = Math.min(100, parseInt(q.pageSize ?? '20', 10));
      const offset = (page - 1) * pageSize;

      const conditions = [eq(purchaseOrders.tenantId, req.auth.tenantId)];
      if (q.status) conditions.push(eq(purchaseOrders.status, q.status as never));
      if (q.supplierId) conditions.push(eq(purchaseOrders.supplierId, parseInt(q.supplierId, 10)));
      if (q.search) conditions.push(ilike(purchaseOrders.poNumber, `%${q.search}%`));

      // Purchase audit 2026-07-21 gap-fix: purchaseOrders.branchId was stored but never
      // enforced — any caller with PO_VIEW saw every branch's POs, not just their own (same
      // class of gap as the Inventory module's warehouse-scoping fix earlier the same day).
      const branchScope = getBranchScope(req.auth);
      if (branchScope !== 'all') {
        if (branchScope.length === 0) {
          return reply.send({ data: { content: [], totalElements: 0, page, pageSize } });
        }
        conditions.push(inArray(purchaseOrders.branchId, branchScope));
      }

      const rows = await ctx.db.raw
        .select({ ...getTableColumns(purchaseOrders), supplierName: suppliers.displayName })
        .from(purchaseOrders)
        .leftJoin(suppliers, eq(purchaseOrders.supplierId, suppliers.id))
        .where(and(...conditions))
        .orderBy(desc(purchaseOrders.poDate), desc(purchaseOrders.id))
        .limit(pageSize)
        .offset(offset);

      const [countRow] = await ctx.db.raw
        .select({ count: sql<number>`count(*)::int` })
        .from(purchaseOrders)
        .where(and(...conditions));

      return reply.send({
        data: { content: rows, totalElements: countRow?.count ?? 0, page, pageSize },
      });
    },
  });

  fastify.post('/purchase-orders', {
    preHandler: requirePermission(PERMISSIONS.PO_CREATE),
    handler: async (req, reply) => {
      const body = CreatePOSchema.parse(req.body);

      // Purchase audit 2026-07-21 gap-fix (systemic pass, part 3): a branch-restricted caller
      // could POST a PO naming a branchId outside their own scope — the read-side fix (§14/§15)
      // didn't stop them from creating one there in the first place.
      const createScope = getBranchScope(req.auth);
      if (createScope !== 'all' && !createScope.includes(body.branchId)) {
        throw new ERPError(
          'PO_OUT_OF_SCOPE',
          'Cannot create a PO outside your assigned branch(es)',
          403
        );
      }

      const ctx = ctxFactory.create({
        tenantId: req.auth.tenantId,
        userId: req.auth.userId,
        correlationId:
          (req.headers['x-correlation-id'] as string | undefined) ?? crypto.randomUUID(),
      });
      const svc = new PurchaseOrderService(ctx.db.raw);
      const id = await svc.create({
        tenantId: req.auth.tenantId,
        branchId: body.branchId,
        warehouseId: body.warehouseId,
        supplierId: body.supplierId,
        poDate: new Date(body.poDate),
        expectedDeliveryDate: body.expectedDeliveryDate
          ? new Date(body.expectedDeliveryDate)
          : undefined,
        placeOfSupply: body.placeOfSupply,
        sellerStateCode: body.sellerStateCode,
        lines: body.lines,
        notes: body.notes,
        termsAndConditions: body.termsAndConditions,
        createdBy: req.auth.userId,
        poType: body.poType,
        contractValidFrom: body.contractValidFrom ? new Date(body.contractValidFrom) : undefined,
        contractValidTill: body.contractValidTill ? new Date(body.contractValidTill) : undefined,
        requisitionId: body.requisitionId,
      });
      return reply.code(201).send({ data: { id } });
    },
  });

  fastify.get('/purchase-orders/pending-delivery', {
    preHandler: requirePermission(PERMISSIONS.PO_VIEW),
    handler: async (req, reply) => {
      const ctx = ctxFactory.create({
        tenantId: req.auth.tenantId,
        userId: req.auth.userId,
        correlationId:
          (req.headers['x-correlation-id'] as string | undefined) ?? crypto.randomUUID(),
      });
      const svc = new PurchaseOrderService(ctx.db.raw);
      const rows = await svc.getPendingDelivery(req.auth.tenantId);
      return reply.send({ data: rows });
    },
  });

  fastify.get('/purchase-orders/:id', {
    preHandler: requirePermission(PERMISSIONS.PO_VIEW),
    handler: async (req, reply) => {
      const { id } = req.params as { id: string };
      const ctx = ctxFactory.create({
        tenantId: req.auth.tenantId,
        userId: req.auth.userId,
        correlationId:
          (req.headers['x-correlation-id'] as string | undefined) ?? crypto.randomUUID(),
      });
      const svc = new PurchaseOrderService(ctx.db.raw);
      const data = await svc.getWithLines(parseInt(id, 10), req.auth.tenantId);

      const branchScope = getBranchScope(req.auth);
      if (branchScope !== 'all' && !branchScope.includes(data.branchId)) {
        throw new ERPError(
          'PO_OUT_OF_SCOPE',
          'Purchase order is outside your assigned branch(es)',
          403
        );
      }

      return reply.send({ data });
    },
  });

  fastify.put('/purchase-orders/:id', {
    preHandler: requirePermission(PERMISSIONS.PO_UPDATE),
    handler: async (req, reply) => {
      const { id } = req.params as { id: string };
      const body = UpdatePOSchema.parse(req.body);
      const ctx = ctxFactory.create({
        tenantId: req.auth.tenantId,
        userId: req.auth.userId,
        correlationId:
          (req.headers['x-correlation-id'] as string | undefined) ?? crypto.randomUUID(),
      });
      await assertPoBranchInScope(ctx, parseInt(id, 10), req.auth.tenantId, req.auth);
      const svc = new PurchaseOrderService(ctx.db.raw);
      await svc.update(parseInt(id, 10), req.auth.tenantId, req.auth.userId, {
        notes: body.notes,
        expectedDeliveryDate: body.expectedDeliveryDate
          ? new Date(body.expectedDeliveryDate)
          : undefined,
      });
      return reply.send({ success: true });
    },
  });

  fastify.post('/purchase-orders/:id/submit', {
    preHandler: requirePermission(PERMISSIONS.PO_CREATE),
    handler: async (req, reply) => {
      const { id } = req.params as { id: string };
      const ctx = ctxFactory.create({
        tenantId: req.auth.tenantId,
        userId: req.auth.userId,
        correlationId:
          (req.headers['x-correlation-id'] as string | undefined) ?? crypto.randomUUID(),
      });
      await assertPoBranchInScope(ctx, parseInt(id, 10), req.auth.tenantId, req.auth);
      const svc = new PurchaseOrderService(ctx.db.raw);
      await svc.submit(parseInt(id, 10), req.auth.tenantId, req.auth.userId);
      return reply.send({ success: true });
    },
  });

  fastify.post('/purchase-orders/:id/approve', {
    preHandler: requirePermission(PERMISSIONS.PO_APPROVE),
    handler: async (req, reply) => {
      const { id } = req.params as { id: string };
      const body = ApproveSchema.parse(req.body);

      if (
        body.overrideCreditLimit &&
        !req.auth.permissions.includes(PERMISSIONS.CREDIT_LIMIT_OVERRIDE)
      ) {
        return reply
          .code(403)
          .send({ error: `Forbidden — missing permission: ${PERMISSIONS.CREDIT_LIMIT_OVERRIDE}` });
      }

      const ctx = ctxFactory.create({
        tenantId: req.auth.tenantId,
        userId: req.auth.userId,
        correlationId:
          (req.headers['x-correlation-id'] as string | undefined) ?? crypto.randomUUID(),
      });
      await assertPoBranchInScope(ctx, parseInt(id, 10), req.auth.tenantId, req.auth);
      const svc = new PurchaseOrderService(ctx.db.raw);
      await svc.approve(
        parseInt(id, 10),
        req.auth.tenantId,
        req.auth.userId,
        body.poNumber,
        body.overrideCreditLimit,
        // Unlike overrideCreditLimit, this isn't an opt-in request flag — a caller either
        // holds PO_APPROVE_HIGH_VALUE or doesn't, and the threshold check applies
        // automatically either way (tiered approval should be transparent, not something a
        // client can accidentally omit and slip a high-value PO through).
        req.auth.permissions.includes(PERMISSIONS.PO_APPROVE_HIGH_VALUE)
      );
      return reply.send({ success: true });
    },
  });

  fastify.post('/purchase-orders/:id/amend', {
    preHandler: requirePermission(PERMISSIONS.PO_AMEND),
    handler: async (req, reply) => {
      const { id } = req.params as { id: string };
      const body = AmendSchema.parse(req.body);
      const ctx = ctxFactory.create({
        tenantId: req.auth.tenantId,
        userId: req.auth.userId,
        correlationId:
          (req.headers['x-correlation-id'] as string | undefined) ?? crypto.randomUUID(),
      });
      await assertPoBranchInScope(ctx, parseInt(id, 10), req.auth.tenantId, req.auth);
      const svc = new PurchaseOrderService(ctx.db.raw);
      await svc.amend(
        parseInt(id, 10),
        req.auth.tenantId,
        req.auth.userId,
        body.amendments,
        body.reason
      );
      return reply.send({ success: true });
    },
  });

  fastify.post('/purchase-orders/:id/cancel', {
    preHandler: requirePermission(PERMISSIONS.PO_CANCEL),
    handler: async (req, reply) => {
      const { id } = req.params as { id: string };
      const body = CancelSchema.parse(req.body);
      const ctx = ctxFactory.create({
        tenantId: req.auth.tenantId,
        userId: req.auth.userId,
        correlationId:
          (req.headers['x-correlation-id'] as string | undefined) ?? crypto.randomUUID(),
      });
      await assertPoBranchInScope(ctx, parseInt(id, 10), req.auth.tenantId, req.auth);
      const svc = new PurchaseOrderService(ctx.db.raw);
      await svc.cancel(parseInt(id, 10), req.auth.tenantId, req.auth.userId, body.reason);
      return reply.send({ success: true });
    },
  });

  fastify.post('/purchase-orders/:id/duplicate', {
    preHandler: requirePermission(PERMISSIONS.PO_CREATE),
    handler: async (req, reply) => {
      const { id } = req.params as { id: string };
      const ctx = ctxFactory.create({
        tenantId: req.auth.tenantId,
        userId: req.auth.userId,
        correlationId:
          (req.headers['x-correlation-id'] as string | undefined) ?? crypto.randomUUID(),
      });
      await assertPoBranchInScope(ctx, parseInt(id, 10), req.auth.tenantId, req.auth);
      const svc = new PurchaseOrderService(ctx.db.raw);
      const newId = await svc.duplicate(parseInt(id, 10), req.auth.tenantId, req.auth.userId);
      return reply.code(201).send({ data: { id: newId } });
    },
  });

  // Was a dead stub — `pdfUrl` was never written by any code path, so this always returned
  // null. report-service's PdfEngine already has a full PURCHASE_ORDER Handlebars template
  // (apps/report-service/src/templates/index.ts) and an internal-key-guarded generation
  // endpoint (POST /reports/pdf), used the same way sales-service generates invoice PDFs
  // on-demand (apps/sales-service/src/api/invoice.routes.ts's GET /invoices/:id/pdf) —
  // nothing persists a PDF file/URL, it's generated fresh on each request and streamed back.
  fastify.get('/purchase-orders/:id/pdf', {
    preHandler: requirePermission(PERMISSIONS.PO_VIEW),
    handler: async (req, reply) => {
      const { id } = req.params as { id: string };
      const poId = parseInt(id, 10);
      const ctx = ctxFactory.create({
        tenantId: req.auth.tenantId,
        userId: req.auth.userId,
        correlationId:
          (req.headers['x-correlation-id'] as string | undefined) ?? crypto.randomUUID(),
      });
      const svc = new PurchaseOrderService(ctx.db.raw);
      const po = await svc.getWithLines(poId, req.auth.tenantId);

      const branchScope = getBranchScope(req.auth);
      if (branchScope !== 'all' && !branchScope.includes(po.branchId)) {
        throw new ERPError(
          'PO_OUT_OF_SCOPE',
          'Purchase order is outside your assigned branch(es)',
          403
        );
      }

      const [supplier] = await ctx.db.raw
        .select()
        .from(suppliers)
        .where(and(eq(suppliers.id, po.supplierId), eq(suppliers.tenantId, req.auth.tenantId)));
      const [org] = await ctx.db.raw
        .select()
        .from(organizationSettings)
        .where(eq(organizationSettings.tenantId, req.auth.tenantId));

      const data = {
        org: {
          name: org?.orgName,
          gstin: org?.gstin,
          address: org?.address,
        },
        poNumber: po.poNumber ?? `Draft-${po.id}`,
        poDate: po.poDate,
        expectedDelivery: po.expectedDeliveryDate,
        supplier: {
          name: supplier?.displayName,
          gstin: supplier?.gstin,
          phone: supplier?.phone,
          address: supplier?.billingAddress,
        },
        lines: po.lines.map((l) => ({
          itemName: l.itemName ?? `Item ${l.itemId}`,
          hsnCode: l.hsnCode,
          qty: l.orderedQty,
          unit: '',
          rate: l.unitPrice,
          gstRate: l.gstRate,
          lineTotal: l.lineTotal,
        })),
        grandTotal: po.grandTotal,
        paymentTerms: po.termsAndConditions ?? undefined,
        notes: po.notes ?? undefined,
      };

      const reportUrl = process.env['REPORT_SERVICE_URL'] ?? 'http://localhost:3015';
      const internalKey = process.env['INTERNAL_API_KEY'] ?? '';
      const res = await fetch(`${reportUrl}/reports/pdf`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-internal-key': internalKey },
        body: JSON.stringify({ documentType: 'PURCHASE_ORDER', data }),
      });
      if (!res.ok) throw new BusinessError('PDF_GENERATION_FAILED', 'Failed to generate PO PDF');
      const buffer = Buffer.from(await res.arrayBuffer());

      return reply
        .code(200)
        .header('Content-Type', 'application/pdf')
        .header('Content-Disposition', `inline; filename="${data.poNumber}.pdf"`)
        .send(buffer);
    },
  });

  fastify.get('/purchase-orders/:id/activity', {
    preHandler: requirePermission(PERMISSIONS.PO_VIEW),
    handler: async (req, reply) => {
      const { id } = req.params as { id: string };
      const ctx = ctxFactory.create({
        tenantId: req.auth.tenantId,
        userId: req.auth.userId,
        correlationId:
          (req.headers['x-correlation-id'] as string | undefined) ?? crypto.randomUUID(),
      });
      await assertPoBranchInScope(ctx, parseInt(id, 10), req.auth.tenantId, req.auth);
      const history = await ctx.db.raw
        .select()
        .from(purchaseOrderHistory)
        .where(
          and(
            eq(purchaseOrderHistory.purchaseOrderId, parseInt(id, 10)),
            eq(purchaseOrderHistory.tenantId, req.auth.tenantId)
          )
        )
        .orderBy(desc(purchaseOrderHistory.createdAt));
      return reply.send({ data: history });
    },
  });
}
