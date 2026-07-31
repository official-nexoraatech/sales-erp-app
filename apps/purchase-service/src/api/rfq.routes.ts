import type { FastifyInstance } from 'fastify';
import type { PlatformContextFactory } from '@erp/sdk';
import { getBranchScope } from '@erp/sdk';
import { rfqs, supplierQuotations } from '@erp/db';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { PERMISSIONS, ERPError } from '@erp/types';
import { authenticate } from '../middleware/authenticate.js';
import { requirePermission } from '../middleware/authorize.js';
import { RfqService } from '../domain/RfqService.js';

const RfqLineSchema = z.object({
  itemId: z.number().int().positive(),
  description: z.string().max(500).optional(),
  qty: z.number().positive(),
  unitId: z.number().int().positive().optional(),
});

const CreateRfqSchema = z.object({
  branchId: z.number().int().positive(),
  dueDate: z.string().datetime().optional(),
  lines: z.array(RfqLineSchema).min(1),
  supplierIds: z.array(z.number().int().positive()).default([]),
  notes: z.string().max(2000).optional(),
  requisitionId: z.number().int().positive().optional(),
});

const QuotationLineSchema = z.object({
  rfqLineId: z.number().int().positive(),
  itemId: z.number().int().positive(),
  qty: z.number().positive(),
  unitPrice: z.number().nonnegative(),
  gstRate: z.number().min(0).max(100).optional(),
  deliveryDays: z.number().int().positive().optional(),
});

const RecordQuotationSchema = z.object({
  supplierId: z.number().int().positive(),
  quotationNumber: z.string().max(100).optional(),
  validTill: z.string().datetime().optional(),
  lines: z.array(QuotationLineSchema).min(1),
  notes: z.string().max(2000).optional(),
});

const SelectQuotationSchema = z.object({
  branchId: z.number().int().positive(),
  warehouseId: z.number().int().positive(),
  poDate: z.string().datetime(),
  placeOfSupply: z.string().length(2),
  sellerStateCode: z.string().length(2).optional(),
  hsnByItem: z.record(z.string(), z.string()).optional(),
});

export async function rfqRoutes(
  fastify: FastifyInstance,
  ctxFactory: PlatformContextFactory
): Promise<void> {
  fastify.addHook('preHandler', authenticate);

  function makeCtx(req: Parameters<typeof authenticate>[0]) {
    return ctxFactory.create({
      tenantId: req.auth.tenantId,
      userId: req.auth.userId,
      correlationId: (req.headers['x-correlation-id'] as string | undefined) ?? crypto.randomUUID(),
    });
  }

  // Purchase audit 2026-07-21 gap-fix (systemic pass, part 3): same lightweight-lookup pattern
  // as purchase-order.routes.ts's assertPoBranchInScope.
  async function assertRfqBranchInScope(
    ctx: ReturnType<typeof makeCtx>,
    rfqId: number,
    tenantId: number,
    auth: { permissions: string[]; branchIds: number[] }
  ): Promise<void> {
    const branchScope = getBranchScope(auth);
    if (branchScope === 'all') return;
    const [row] = await ctx.db.raw
      .select({ branchId: rfqs.branchId })
      .from(rfqs)
      .where(and(eq(rfqs.id, rfqId), eq(rfqs.tenantId, tenantId)));
    if (row && !branchScope.includes(row.branchId)) {
      throw new ERPError('RFQ_OUT_OF_SCOPE', 'RFQ is outside your assigned branch(es)', 403);
    }
  }

  // supplierQuotations has no branchId of its own — resolve through its parent RFQ.
  async function assertQuotationBranchInScope(
    ctx: ReturnType<typeof makeCtx>,
    quotationId: number,
    tenantId: number,
    auth: { permissions: string[]; branchIds: number[] }
  ): Promise<void> {
    const branchScope = getBranchScope(auth);
    if (branchScope === 'all') return;
    const [row] = await ctx.db.raw
      .select({ branchId: rfqs.branchId })
      .from(supplierQuotations)
      .leftJoin(rfqs, eq(supplierQuotations.rfqId, rfqs.id))
      .where(
        and(eq(supplierQuotations.id, quotationId), eq(supplierQuotations.tenantId, tenantId))
      );
    if (row?.branchId && !branchScope.includes(row.branchId)) {
      throw new ERPError(
        'SUPPLIER_QUOTATION_OUT_OF_SCOPE',
        'Quotation is outside your assigned branch(es)',
        403
      );
    }
  }

  fastify.get('/rfqs', {
    preHandler: requirePermission(PERMISSIONS.RFQ_VIEW),
    handler: async (req, reply) => {
      const q = req.query as { status?: string };
      const ctx = makeCtx(req);
      const svc = new RfqService(ctx.db.raw);
      const branchScope = getBranchScope(req.auth);
      if (branchScope !== 'all' && branchScope.length === 0) {
        return reply.send({ data: { content: [], totalElements: 0 } });
      }
      const rows = await svc.list(
        req.auth.tenantId,
        q.status,
        branchScope === 'all' ? undefined : branchScope
      );
      return reply.send({ data: { content: rows, totalElements: rows.length } });
    },
  });

  fastify.post('/rfqs', {
    preHandler: requirePermission(PERMISSIONS.RFQ_CREATE),
    handler: async (req, reply) => {
      const body = CreateRfqSchema.parse(req.body);

      const createScope = getBranchScope(req.auth);
      if (createScope !== 'all' && !createScope.includes(body.branchId)) {
        throw new ERPError(
          'RFQ_OUT_OF_SCOPE',
          'Cannot create an RFQ outside your assigned branch(es)',
          403
        );
      }

      const ctx = makeCtx(req);
      const svc = new RfqService(ctx.db.raw);
      const id = await svc.create({
        tenantId: req.auth.tenantId,
        branchId: body.branchId,
        dueDate: body.dueDate ? new Date(body.dueDate) : undefined,
        lines: body.lines,
        supplierIds: body.supplierIds,
        notes: body.notes,
        requisitionId: body.requisitionId,
        createdBy: req.auth.userId,
      });
      return reply.code(201).send({ data: { id } });
    },
  });

  fastify.get('/rfqs/:id/compare', {
    preHandler: requirePermission(PERMISSIONS.RFQ_VIEW),
    handler: async (req, reply) => {
      const { id } = req.params as { id: string };
      const ctx = makeCtx(req);
      const svc = new RfqService(ctx.db.raw);
      const data = await svc.compare(parseInt(id, 10), req.auth.tenantId);

      const branchScope = getBranchScope(req.auth);
      if (branchScope !== 'all' && !branchScope.includes(data.rfq.branchId)) {
        throw new ERPError('RFQ_OUT_OF_SCOPE', 'RFQ is outside your assigned branch(es)', 403);
      }

      return reply.send({ data });
    },
  });

  fastify.post('/rfqs/:id/quotations', {
    preHandler: requirePermission(PERMISSIONS.SUPPLIER_QUOTATION_CREATE),
    handler: async (req, reply) => {
      const { id } = req.params as { id: string };
      const body = RecordQuotationSchema.parse(req.body);
      const ctx = makeCtx(req);
      await assertRfqBranchInScope(ctx, parseInt(id, 10), req.auth.tenantId, req.auth);
      const svc = new RfqService(ctx.db.raw);
      const quotationId = await svc.recordQuotation({
        tenantId: req.auth.tenantId,
        rfqId: parseInt(id, 10),
        supplierId: body.supplierId,
        quotationNumber: body.quotationNumber,
        validTill: body.validTill ? new Date(body.validTill) : undefined,
        lines: body.lines,
        notes: body.notes,
        createdBy: req.auth.userId,
      });
      return reply.code(201).send({ data: { id: quotationId } });
    },
  });

  fastify.post('/quotations/:id/select', {
    preHandler: requirePermission(PERMISSIONS.SUPPLIER_QUOTATION_COMPARE),
    handler: async (req, reply) => {
      const { id } = req.params as { id: string };
      const body = SelectQuotationSchema.parse(req.body);
      const ctx = makeCtx(req);
      await assertQuotationBranchInScope(ctx, parseInt(id, 10), req.auth.tenantId, req.auth);
      const selectScope = getBranchScope(req.auth);
      if (selectScope !== 'all' && !selectScope.includes(body.branchId)) {
        throw new ERPError(
          'PO_OUT_OF_SCOPE',
          'Cannot create the resulting PO outside your assigned branch(es)',
          403
        );
      }
      const svc = new RfqService(ctx.db.raw);
      const poId = await svc.selectQuotation(parseInt(id, 10), req.auth.tenantId, req.auth.userId, {
        branchId: body.branchId,
        warehouseId: body.warehouseId,
        poDate: new Date(body.poDate),
        placeOfSupply: body.placeOfSupply,
        sellerStateCode: body.sellerStateCode,
        hsnByItem: body.hsnByItem
          ? Object.fromEntries(Object.entries(body.hsnByItem).map(([k, v]) => [Number(k), v]))
          : undefined,
      });
      return reply.code(201).send({ data: { poId } });
    },
  });
}
