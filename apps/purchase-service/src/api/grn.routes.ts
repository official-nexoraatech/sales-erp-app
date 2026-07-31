import type { FastifyInstance } from 'fastify';
import type { PlatformContextFactory } from '@erp/sdk';
import { getBranchScope } from '@erp/sdk';
import { grns, grnHistory, suppliers, purchaseOrders } from '@erp/db';
import { and, desc, eq, ilike, inArray, sql, getTableColumns } from 'drizzle-orm';
import { z } from 'zod';
import { PERMISSIONS, ERPError } from '@erp/types';
import { authenticate } from '../middleware/authenticate.js';
import { requirePermission } from '../middleware/authorize.js';
import { GRNService, DuplicateOperationError } from '../domain/GRNService.js';

const GRNLineSchema = z.object({
  purchaseOrderLineId: z.number().int().positive(),
  itemId: z.number().int().positive(),
  variantId: z.number().int().positive().optional(),
  description: z.string().max(500).optional(),
  receivedQty: z.number().positive(),
  unitId: z.number().int().positive().optional(),
  grnRate: z.number().nonnegative(),
  gstRate: z.number().min(0).max(100),
  cessRate: z.number().min(0).max(100).default(0),
  hsnCode: z.string().max(20).optional(),
  warehouseId: z.number().int().positive().optional(),
  batchNumber: z.string().max(100).optional(),
  serialNumbers: z.array(z.string().max(100)).optional(),
  expiryDate: z.string().datetime().optional(),
  // acceptedQty defaults to receivedQty - rejectedQty - damagedQty when omitted (see
  // GRNService.createInTransaction's QC_QTY_MISMATCH validation).
  acceptedQty: z.number().nonnegative().optional(),
  rejectedQty: z.number().nonnegative().default(0),
  damagedQty: z.number().nonnegative().default(0),
  qcStatus: z.enum(['PENDING', 'PASSED', 'FAILED', 'NA']).default('NA'),
});

const CreateGRNSchema = z.object({
  purchaseOrderId: z.number().int().positive(),
  supplierId: z.number().int().positive(),
  branchId: z.number().int().positive(),
  warehouseId: z.number().int().positive(),
  grnDate: z.string().datetime(),
  supplierInvoiceNumber: z.string().max(100).optional(),
  supplierInvoiceDate: z.string().datetime().optional(),
  lines: z.array(GRNLineSchema).min(1),
  notes: z.string().max(2000).optional(),
  // Optional client-generated idempotency key (see GRNService.CreateGRNParams) — a
  // network-timeout retry with the same operationId returns the original GRN instead of
  // creating a duplicate.
  operationId: z.string().max(100).optional(),
});

const ApproveGRNSchema = z.object({
  grnNumber: z.string().min(1).max(50),
});

const RejectGRNSchema = z.object({
  reason: z.string().min(1).max(500),
});

export async function grnRoutes(
  fastify: FastifyInstance,
  ctxFactory: PlatformContextFactory
): Promise<void> {
  fastify.addHook('preHandler', authenticate);

  fastify.get('/grns', {
    preHandler: requirePermission(PERMISSIONS.GRN_VIEW),
    handler: async (req, reply) => {
      const ctx = ctxFactory.create({
        tenantId: req.auth.tenantId,
        userId: req.auth.userId,
        correlationId:
          (req.headers['x-correlation-id'] as string | undefined) ?? crypto.randomUUID(),
      });
      const q = req.query as {
        status?: string;
        supplierId?: string;
        poId?: string;
        search?: string;
        page?: string;
        pageSize?: string;
      };
      const page = Math.max(1, parseInt(q.page ?? '1', 10));
      const pageSize = Math.min(100, parseInt(q.pageSize ?? '20', 10));
      const offset = (page - 1) * pageSize;

      const conditions = [eq(grns.tenantId, req.auth.tenantId)];
      if (q.status) conditions.push(eq(grns.status, q.status as never));
      if (q.supplierId) conditions.push(eq(grns.supplierId, parseInt(q.supplierId, 10)));
      if (q.poId) conditions.push(eq(grns.purchaseOrderId, parseInt(q.poId, 10)));
      if (q.search) conditions.push(ilike(grns.grnNumber, `%${q.search}%`));

      // Purchase audit 2026-07-21 gap-fix (systemic pass): same branch-scoping gap found
      // and fixed on purchase-orders — turned out to be purchase-service-wide, not PO-only.
      const branchScope = getBranchScope(req.auth);
      if (branchScope !== 'all') {
        if (branchScope.length === 0) {
          return reply.send({ data: { content: [], totalElements: 0, page, pageSize } });
        }
        conditions.push(inArray(grns.branchId, branchScope));
      }

      const rows = await ctx.db.raw
        .select({
          ...getTableColumns(grns),
          supplierName: suppliers.displayName,
          poNumber: purchaseOrders.poNumber,
        })
        .from(grns)
        .leftJoin(suppliers, eq(grns.supplierId, suppliers.id))
        .leftJoin(purchaseOrders, eq(grns.purchaseOrderId, purchaseOrders.id))
        .where(and(...conditions))
        .orderBy(desc(grns.grnDate), desc(grns.id))
        .limit(pageSize)
        .offset(offset);

      const [countRow] = await ctx.db.raw
        .select({ count: sql<number>`count(*)::int` })
        .from(grns)
        .where(and(...conditions));

      return reply.send({
        data: { content: rows, totalElements: countRow?.count ?? 0, page, pageSize },
      });
    },
  });

  fastify.post('/grns', {
    preHandler: requirePermission(PERMISSIONS.GRN_CREATE),
    handler: async (req, reply) => {
      const body = CreateGRNSchema.parse(req.body);

      // Purchase audit 2026-07-21 gap-fix (systemic pass, part 3): see purchase-order.routes.ts.
      const createScope = getBranchScope(req.auth);
      if (createScope !== 'all' && !createScope.includes(body.branchId)) {
        throw new ERPError(
          'GRN_OUT_OF_SCOPE',
          'Cannot create a GRN outside your assigned branch(es)',
          403
        );
      }

      const ctx = ctxFactory.create({
        tenantId: req.auth.tenantId,
        userId: req.auth.userId,
        correlationId:
          (req.headers['x-correlation-id'] as string | undefined) ?? crypto.randomUUID(),
      });
      const svc = new GRNService(ctx.db.raw);
      let id: number;
      try {
        id = await svc.create({
          tenantId: req.auth.tenantId,
          branchId: body.branchId,
          warehouseId: body.warehouseId,
          purchaseOrderId: body.purchaseOrderId,
          supplierId: body.supplierId,
          grnDate: new Date(body.grnDate),
          supplierInvoiceNumber: body.supplierInvoiceNumber,
          supplierInvoiceDate: body.supplierInvoiceDate
            ? new Date(body.supplierInvoiceDate)
            : undefined,
          lines: body.lines.map((l) => ({
            ...l,
            expiryDate: l.expiryDate ? new Date(l.expiryDate) : undefined,
          })),
          notes: body.notes,
          createdBy: req.auth.userId,
          clientOperationId: body.operationId,
        });
      } catch (err) {
        // A network-timeout retry with the same operationId lands here instead of
        // creating a second DRAFT GRN — return the one that already exists.
        if (err instanceof DuplicateOperationError && body.operationId) {
          const [existing] = await ctx.db.raw
            .select({ id: grns.id })
            .from(grns)
            .where(
              and(
                eq(grns.tenantId, req.auth.tenantId),
                eq(grns.clientOperationId, body.operationId)
              )
            );
          if (existing) {
            return reply.code(200).send({ data: { id: existing.id } });
          }
          return reply.code(409).send({
            error: {
              code: 'DUPLICATE_OPERATION_PROCESSING',
              message: 'This GRN is still being created — please retry shortly',
            },
          });
        }
        throw err;
      }
      // grnNumber genuinely doesn't exist yet — it's assigned at approval (see grn.routes.ts
      // ApproveGRNSchema / GRNService.approve), not a bug to fix here. supplierName/grnDate
      // are denormalized now so the DRAFT-window search result at least shows the supplier
      // and date instead of a bare fallback string (see searchEntityConfig.ts's title fallback).
      const [supplier] = await ctx.db.raw
        .select({ displayName: suppliers.displayName })
        .from(suppliers)
        .where(and(eq(suppliers.id, body.supplierId), eq(suppliers.tenantId, req.auth.tenantId)));
      await ctx.events.publish('grn', id, 'GRN_CREATED', {
        grnId: id,
        supplierId: body.supplierId,
        supplierName: supplier?.displayName,
        purchaseOrderId: body.purchaseOrderId,
        branchId: body.branchId,
        grnDate: body.grnDate,
        status: 'DRAFT',
      });
      return reply.code(201).send({ data: { id } });
    },
  });

  fastify.get('/grns/:id', {
    preHandler: requirePermission(PERMISSIONS.GRN_VIEW),
    handler: async (req, reply) => {
      const { id } = req.params as { id: string };
      const ctx = ctxFactory.create({
        tenantId: req.auth.tenantId,
        userId: req.auth.userId,
        correlationId:
          (req.headers['x-correlation-id'] as string | undefined) ?? crypto.randomUUID(),
      });
      const svc = new GRNService(ctx.db.raw);
      const data = await svc.getWithLines(parseInt(id, 10), req.auth.tenantId);

      const branchScope = getBranchScope(req.auth);
      if (branchScope !== 'all' && !branchScope.includes(data.branchId)) {
        throw new ERPError('GRN_OUT_OF_SCOPE', 'GRN is outside your assigned branch(es)', 403);
      }

      return reply.send({ data });
    },
  });

  fastify.post('/grns/:id/approve', {
    preHandler: requirePermission(PERMISSIONS.GRN_APPROVE),
    handler: async (req, reply) => {
      const { id } = req.params as { id: string };
      const body = ApproveGRNSchema.parse(req.body);
      const ctx = ctxFactory.create({
        tenantId: req.auth.tenantId,
        userId: req.auth.userId,
        correlationId:
          (req.headers['x-correlation-id'] as string | undefined) ?? crypto.randomUUID(),
      });
      const svc = new GRNService(ctx.db.raw);
      const grnId = parseInt(id, 10);
      const { branchId, lines } = await svc.getWithLines(grnId, req.auth.tenantId);

      // Purchase audit 2026-07-21 gap-fix (systemic pass, part 2): GRN approval is where
      // stock/AP/GST all actually post — the highest-value mutating action to close this on,
      // alongside the same fix already applied to every PO mutating action.
      const branchScope = getBranchScope(req.auth);
      if (branchScope !== 'all' && !branchScope.includes(branchId)) {
        throw new ERPError('GRN_OUT_OF_SCOPE', 'GRN is outside your assigned branch(es)', 403);
      }

      await svc.approve(grnId, req.auth.tenantId, req.auth.userId, body.grnNumber);

      // GRNService.approve() writes availableQty/WACC/valuation directly to the shared
      // `items` table (purchase-service has no business calling into inventory-service's own
      // API for this) — inventory-service's Redis item-cache is never told, so its single-item
      // GET route served pre-GRN stock/valuation for up to the full 5-minute TTL (found in live
      // QA 2026-07-17). Invalidate the same `item:{id}` cache key inventory-service's own
      // ItemCacheService uses, via the shared Redis both services already talk to through
      // TenantScopedCache — no new cross-service HTTP call or event consumer needed.
      await Promise.all(
        [...new Set(lines.map((l) => l.itemId))].map((itemId) => ctx.cache.del(`item:${itemId}`))
      );

      return reply.send({ success: true });
    },
  });

  fastify.post('/grns/:id/reject', {
    preHandler: requirePermission(PERMISSIONS.GRN_APPROVE),
    handler: async (req, reply) => {
      const { id } = req.params as { id: string };
      const body = RejectGRNSchema.parse(req.body);
      const ctx = ctxFactory.create({
        tenantId: req.auth.tenantId,
        userId: req.auth.userId,
        correlationId:
          (req.headers['x-correlation-id'] as string | undefined) ?? crypto.randomUUID(),
      });
      const grnId = parseInt(id, 10);
      const branchScope = getBranchScope(req.auth);
      if (branchScope !== 'all') {
        const [grnRow] = await ctx.db.raw
          .select({ branchId: grns.branchId })
          .from(grns)
          .where(and(eq(grns.id, grnId), eq(grns.tenantId, req.auth.tenantId)));
        if (grnRow && !branchScope.includes(grnRow.branchId)) {
          throw new ERPError('GRN_OUT_OF_SCOPE', 'GRN is outside your assigned branch(es)', 403);
        }
      }

      const svc = new GRNService(ctx.db.raw);
      await svc.reject(grnId, req.auth.tenantId, req.auth.userId, body.reason);
      return reply.send({ success: true });
    },
  });

  fastify.get('/grns/:id/activity', {
    preHandler: requirePermission(PERMISSIONS.GRN_VIEW),
    handler: async (req, reply) => {
      const { id } = req.params as { id: string };
      const ctx = ctxFactory.create({
        tenantId: req.auth.tenantId,
        userId: req.auth.userId,
        correlationId:
          (req.headers['x-correlation-id'] as string | undefined) ?? crypto.randomUUID(),
      });
      const history = await ctx.db.raw
        .select()
        .from(grnHistory)
        .where(
          and(eq(grnHistory.grnId, parseInt(id, 10)), eq(grnHistory.tenantId, req.auth.tenantId))
        )
        .orderBy(desc(grnHistory.createdAt));
      return reply.send({ data: history });
    },
  });
}
