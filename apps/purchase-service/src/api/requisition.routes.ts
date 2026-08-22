import type { FastifyInstance } from 'fastify';
import type { PlatformContextFactory } from '@erp/sdk';
import { getBranchScope, tenantScopedHandler } from '@erp/sdk';
import { purchaseRequisitions, type ErpDatabase } from '@erp/db';
import { and, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { PERMISSIONS, ERPError } from '@erp/types';
import { authenticate } from '../middleware/authenticate.js';
import { requirePermission } from '../middleware/authorize.js';
import { RequisitionService } from '../domain/RequisitionService.js';

const RequisitionLineSchema = z.object({
  itemId: z.number().int().positive(),
  description: z.string().max(500).optional(),
  requestedQty: z.number().positive(),
  unitId: z.number().int().positive().optional(),
  estimatedUnitPrice: z.number().nonnegative().optional(),
});

const CreateRequisitionSchema = z.object({
  branchId: z.number().int().positive(),
  department: z.string().max(100).optional(),
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']).default('MEDIUM'),
  requiredByDate: z.string().datetime().optional(),
  lines: z.array(RequisitionLineSchema).min(1),
  notes: z.string().max(2000).optional(),
});

const RejectSchema = z.object({ reason: z.string().min(1).max(500) });

const ConvertSchema = z.object({
  supplierId: z.number().int().positive(),
  branchId: z.number().int().positive(),
  warehouseId: z.number().int().positive(),
  poDate: z.string().datetime(),
  placeOfSupply: z.string().length(2),
  sellerStateCode: z.string().length(2).optional(),
  lineOverrides: z
    .array(
      z.object({
        itemId: z.number().int().positive(),
        unitPrice: z.number().nonnegative(),
        gstRate: z.number().min(0).max(100),
        hsnCode: z.string().max(20).optional(),
      })
    )
    .min(1),
});

// Phase 9 GUC-per-request rollout — migrated 2026-08-21. No external I/O —
// RequisitionService has no fetch() calls.
export async function requisitionRoutes(
  fastify: FastifyInstance,
  ctxFactory: PlatformContextFactory
): Promise<void> {
  fastify.addHook('preHandler', authenticate);

  // Purchase audit 2026-07-21 gap-fix (systemic pass, part 3): same lightweight-lookup pattern
  // as purchase-order.routes.ts's assertPoBranchInScope.
  async function assertRequisitionBranchInScope(
    db: ErpDatabase,
    id: number,
    tenantId: number,
    auth: { permissions: string[]; branchIds: number[] }
  ): Promise<void> {
    const branchScope = getBranchScope(auth);
    if (branchScope === 'all') return;
    const [row] = await db
      .select({ branchId: purchaseRequisitions.branchId })
      .from(purchaseRequisitions)
      .where(and(eq(purchaseRequisitions.id, id), eq(purchaseRequisitions.tenantId, tenantId)));
    if (row && !branchScope.includes(row.branchId)) {
      throw new ERPError(
        'REQUISITION_OUT_OF_SCOPE',
        'Requisition is outside your assigned branch(es)',
        403
      );
    }
  }

  fastify.get('/requisitions', {
    preHandler: requirePermission(PERMISSIONS.REQUISITION_VIEW),
    handler: tenantScopedHandler(ctxFactory, async (req, reply, ctx) => {
      const q = req.query as { status?: string };
      const svc = new RequisitionService(ctx.db.raw);
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

  fastify.post('/requisitions', {
    preHandler: requirePermission(PERMISSIONS.REQUISITION_CREATE),
    handler: tenantScopedHandler(ctxFactory, async (req, reply, ctx) => {
      const body = CreateRequisitionSchema.parse(req.body);

      const createScope = getBranchScope(req.auth);
      if (createScope !== 'all' && !createScope.includes(body.branchId)) {
        throw new ERPError(
          'REQUISITION_OUT_OF_SCOPE',
          'Cannot create a requisition outside your assigned branch(es)',
          403
        );
      }

      const svc = new RequisitionService(ctx.db.raw);
      const id = await svc.create({
        tenantId: ctx.tenant.tenantId,
        branchId: body.branchId,
        department: body.department,
        priority: body.priority,
        requiredByDate: body.requiredByDate ? new Date(body.requiredByDate) : undefined,
        lines: body.lines,
        notes: body.notes,
        requestedBy: ctx.tenant.userId,
      });
      return reply.code(201).send({ data: { id } });
    }),
  });

  fastify.get('/requisitions/:id', {
    preHandler: requirePermission(PERMISSIONS.REQUISITION_VIEW),
    handler: tenantScopedHandler(ctxFactory, async (req, reply, ctx) => {
      const { id } = req.params as { id: string };
      const svc = new RequisitionService(ctx.db.raw);
      const data = await svc.getWithLines(parseInt(id, 10), ctx.tenant.tenantId);

      const branchScope = getBranchScope(req.auth);
      if (branchScope !== 'all' && !branchScope.includes(data.branchId)) {
        throw new ERPError(
          'REQUISITION_OUT_OF_SCOPE',
          'Requisition is outside your assigned branch(es)',
          403
        );
      }

      return reply.send({ data });
    }),
  });

  fastify.post('/requisitions/:id/submit', {
    preHandler: requirePermission(PERMISSIONS.REQUISITION_CREATE),
    handler: tenantScopedHandler(ctxFactory, async (req, reply, ctx) => {
      const { id } = req.params as { id: string };
      await assertRequisitionBranchInScope(
        ctx.db.raw,
        parseInt(id, 10),
        ctx.tenant.tenantId,
        req.auth
      );
      const svc = new RequisitionService(ctx.db.raw);
      await svc.submit(parseInt(id, 10), ctx.tenant.tenantId, ctx.tenant.userId);
      return reply.send({ success: true });
    }),
  });

  fastify.post('/requisitions/:id/approve', {
    preHandler: requirePermission(PERMISSIONS.REQUISITION_APPROVE),
    handler: tenantScopedHandler(ctxFactory, async (req, reply, ctx) => {
      const { id } = req.params as { id: string };
      await assertRequisitionBranchInScope(
        ctx.db.raw,
        parseInt(id, 10),
        ctx.tenant.tenantId,
        req.auth
      );
      const svc = new RequisitionService(ctx.db.raw);
      await svc.approve(parseInt(id, 10), ctx.tenant.tenantId, ctx.tenant.userId);
      return reply.send({ success: true });
    }),
  });

  fastify.post('/requisitions/:id/reject', {
    preHandler: requirePermission(PERMISSIONS.REQUISITION_APPROVE),
    handler: tenantScopedHandler(ctxFactory, async (req, reply, ctx) => {
      const { id } = req.params as { id: string };
      const body = RejectSchema.parse(req.body);
      await assertRequisitionBranchInScope(
        ctx.db.raw,
        parseInt(id, 10),
        ctx.tenant.tenantId,
        req.auth
      );
      const svc = new RequisitionService(ctx.db.raw);
      await svc.reject(parseInt(id, 10), ctx.tenant.tenantId, ctx.tenant.userId, body.reason);
      return reply.send({ success: true });
    }),
  });

  fastify.post('/requisitions/:id/convert-to-po', {
    preHandler: requirePermission(PERMISSIONS.REQUISITION_CONVERT),
    handler: tenantScopedHandler(ctxFactory, async (req, reply, ctx) => {
      const { id } = req.params as { id: string };
      const body = ConvertSchema.parse(req.body);
      await assertRequisitionBranchInScope(
        ctx.db.raw,
        parseInt(id, 10),
        ctx.tenant.tenantId,
        req.auth
      );
      const convertScope = getBranchScope(req.auth);
      if (convertScope !== 'all' && !convertScope.includes(body.branchId)) {
        throw new ERPError(
          'PO_OUT_OF_SCOPE',
          'Cannot create the resulting PO outside your assigned branch(es)',
          403
        );
      }
      const svc = new RequisitionService(ctx.db.raw);
      const poId = await svc.convertToPO(parseInt(id, 10), ctx.tenant.tenantId, ctx.tenant.userId, {
        supplierId: body.supplierId,
        branchId: body.branchId,
        warehouseId: body.warehouseId,
        poDate: new Date(body.poDate),
        placeOfSupply: body.placeOfSupply,
        sellerStateCode: body.sellerStateCode,
        lineOverrides: body.lineOverrides,
      });
      return reply.code(201).send({ data: { poId } });
    }),
  });

  fastify.get('/requisitions/pending-approval-count', {
    preHandler: requirePermission(PERMISSIONS.REQUISITION_VIEW),
    handler: tenantScopedHandler(ctxFactory, async (req, reply, ctx) => {
      const [row] = await ctx.db.raw
        .select({ count: sql<number>`count(*)::int` })
        .from(purchaseRequisitions)
        .where(
          and(
            eq(purchaseRequisitions.tenantId, ctx.tenant.tenantId),
            eq(purchaseRequisitions.status, 'SUBMITTED')
          )
        );
      return reply.send({ data: { count: row?.count ?? 0 } });
    }),
  });
}
