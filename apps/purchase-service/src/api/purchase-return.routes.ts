import type { FastifyInstance } from 'fastify';
import type { PlatformContextFactory } from '@erp/sdk';
import { getBranchScope, tenantScopedHandler } from '@erp/sdk';
import { purchaseReturns, purchaseReturnLines, debitNotes, suppliers, grns, items } from '@erp/db';
import { and, desc, eq, inArray, sql, getTableColumns } from 'drizzle-orm';
import { z } from 'zod';
import { PERMISSIONS, ERPError } from '@erp/types';
import { authenticate } from '../middleware/authenticate.js';
import { requirePermission } from '../middleware/authorize.js';
import { PurchaseReturnService } from '../domain/PurchaseReturnService.js';
import { DebitNoteService } from '../domain/DebitNoteService.js';

const ApplyDebitNoteSchema = z.object({
  amount: z.number().positive(),
  notes: z.string().max(2000).optional(),
});

const ReturnLineSchema = z.object({
  grnLineId: z.number().int().positive(),
  itemId: z.number().int().positive(),
  variantId: z.number().int().positive().optional(),
  returnQty: z.number().positive(),
  unitPrice: z.number().nonnegative(),
  gstRate: z.number().min(0).max(100),
});

const CreateReturnSchema = z.object({
  grnId: z.number().int().positive(),
  supplierId: z.number().int().positive(),
  branchId: z.number().int().positive(),
  warehouseId: z.number().int().positive(),
  returnDate: z.string().datetime(),
  reason: z.enum(['QUALITY_ISSUE', 'WRONG_ITEM', 'EXCESS_QUANTITY', 'DAMAGED', 'OTHER']),
  returnNotes: z.string().max(2000).optional(),
  lines: z.array(ReturnLineSchema).min(1),
});

// Phase 9 GUC-per-request rollout — migrated 2026-08-21. No external I/O — neither
// PurchaseReturnService nor DebitNoteService has fetch() calls; ctx.cache.del() is a Redis
// call via the platform SDK.
export async function purchaseReturnRoutes(
  fastify: FastifyInstance,
  ctxFactory: PlatformContextFactory
): Promise<void> {
  fastify.addHook('preHandler', authenticate);

  fastify.get('/purchase-returns', {
    preHandler: requirePermission(PERMISSIONS.PURCHASE_RETURN_VIEW),
    handler: tenantScopedHandler(ctxFactory, async (req, reply, ctx) => {
      const q = req.query as {
        status?: string;
        supplierId?: string;
        page?: string;
        pageSize?: string;
      };
      const page = Math.max(1, parseInt(q.page ?? '1', 10));
      const pageSize = Math.min(100, parseInt(q.pageSize ?? '20', 10));
      const offset = (page - 1) * pageSize;

      const conditions = [eq(purchaseReturns.tenantId, ctx.tenant.tenantId)];
      if (q.status) conditions.push(eq(purchaseReturns.status, q.status as never));
      if (q.supplierId) conditions.push(eq(purchaseReturns.supplierId, parseInt(q.supplierId, 10)));

      // Purchase audit 2026-07-21 gap-fix (systemic pass) — see purchase-order.routes.ts.
      const branchScope = getBranchScope(req.auth);
      if (branchScope !== 'all') {
        if (branchScope.length === 0) {
          return reply.send({ data: { content: [], totalElements: 0, page, pageSize } });
        }
        conditions.push(inArray(purchaseReturns.branchId, branchScope));
      }

      const rows = await ctx.db.raw
        .select({
          ...getTableColumns(purchaseReturns),
          supplierName: suppliers.displayName,
          grnNumber: grns.grnNumber,
        })
        .from(purchaseReturns)
        .leftJoin(suppliers, eq(purchaseReturns.supplierId, suppliers.id))
        .leftJoin(grns, eq(purchaseReturns.grnId, grns.id))
        .where(and(...conditions))
        .orderBy(desc(purchaseReturns.returnDate), desc(purchaseReturns.id))
        .limit(pageSize)
        .offset(offset);

      const [countRow] = await ctx.db.raw
        .select({ count: sql<number>`count(*)::int` })
        .from(purchaseReturns)
        .where(and(...conditions));

      return reply.send({
        data: { content: rows, totalElements: countRow?.count ?? 0, page, pageSize },
      });
    }),
  });

  fastify.get('/purchase-returns/:id', {
    preHandler: requirePermission(PERMISSIONS.PURCHASE_RETURN_VIEW),
    handler: tenantScopedHandler(ctxFactory, async (req, reply, ctx) => {
      const { id } = req.params as { id: string };
      const returnId = parseInt(id, 10);
      const [ret] = await ctx.db.raw
        .select({
          ...getTableColumns(purchaseReturns),
          supplierName: suppliers.displayName,
          grnNumber: grns.grnNumber,
        })
        .from(purchaseReturns)
        .leftJoin(suppliers, eq(purchaseReturns.supplierId, suppliers.id))
        .leftJoin(grns, eq(purchaseReturns.grnId, grns.id))
        .where(
          and(eq(purchaseReturns.id, returnId), eq(purchaseReturns.tenantId, ctx.tenant.tenantId))
        );
      if (!ret)
        return reply
          .code(404)
          .send({ error: { code: 'NOT_FOUND', message: 'Purchase return not found' } });

      const branchScope = getBranchScope(req.auth);
      if (branchScope !== 'all' && !branchScope.includes(ret.branchId)) {
        throw new ERPError(
          'PURCHASE_RETURN_OUT_OF_SCOPE',
          'Purchase return is outside your assigned branch(es)',
          403
        );
      }

      const lines = await ctx.db.raw
        .select({ ...getTableColumns(purchaseReturnLines), itemName: items.name })
        .from(purchaseReturnLines)
        .leftJoin(items, eq(purchaseReturnLines.itemId, items.id))
        .where(eq(purchaseReturnLines.purchaseReturnId, returnId));

      let debitNote = null;
      if (ret.debitNoteId) {
        [debitNote] = await ctx.db.raw
          .select()
          .from(debitNotes)
          .where(
            and(eq(debitNotes.id, ret.debitNoteId), eq(debitNotes.tenantId, ctx.tenant.tenantId))
          );
      }

      return reply.send({ data: { ...ret, lines, debitNote } });
    }),
  });

  fastify.post('/purchase-returns', {
    preHandler: requirePermission(PERMISSIONS.PURCHASE_RETURN_CREATE),
    handler: tenantScopedHandler(ctxFactory, async (req, reply, ctx) => {
      const body = CreateReturnSchema.parse(req.body);

      const createScope = getBranchScope(req.auth);
      if (createScope !== 'all' && !createScope.includes(body.branchId)) {
        throw new ERPError(
          'PURCHASE_RETURN_OUT_OF_SCOPE',
          'Cannot create a purchase return outside your assigned branch(es)',
          403
        );
      }

      const svc = new PurchaseReturnService(ctx.db.raw);
      const id = await svc.create({
        tenantId: ctx.tenant.tenantId,
        branchId: body.branchId,
        grnId: body.grnId,
        supplierId: body.supplierId,
        warehouseId: body.warehouseId,
        returnDate: new Date(body.returnDate),
        reason: body.reason,
        returnNotes: body.returnNotes,
        lines: body.lines,
        createdBy: ctx.tenant.userId,
      });
      // returnNumber is generated inside svc.create() (not returned — its contract is just
      // the numeric id) so it's re-read here rather than duplicated/guessed at this layer.
      const [createdReturn] = await ctx.db.raw
        .select({ returnNumber: purchaseReturns.returnNumber })
        .from(purchaseReturns)
        .where(eq(purchaseReturns.id, id));
      const [supplier] = await ctx.db.raw
        .select({ displayName: suppliers.displayName })
        .from(suppliers)
        .where(and(eq(suppliers.id, body.supplierId), eq(suppliers.tenantId, ctx.tenant.tenantId)));
      await ctx.events.publish('purchase_return', id, 'PURCHASE_RETURN_CREATED', {
        returnId: id,
        returnNumber: createdReturn?.returnNumber,
        supplierId: body.supplierId,
        supplierName: supplier?.displayName,
        grnId: body.grnId,
        branchId: body.branchId,
        returnDate: body.returnDate,
        status: 'DRAFT',
      });
      return reply.code(201).send({ data: { id } });
    }),
  });

  fastify.post('/purchase-returns/:id/approve', {
    preHandler: requirePermission(PERMISSIONS.PURCHASE_RETURN_APPROVE),
    handler: tenantScopedHandler(ctxFactory, async (req, reply, ctx) => {
      const { id } = req.params as { id: string };
      const returnId = parseInt(id, 10);

      const approveScope = getBranchScope(req.auth);
      if (approveScope !== 'all') {
        const [retRow] = await ctx.db.raw
          .select({ branchId: purchaseReturns.branchId })
          .from(purchaseReturns)
          .where(
            and(eq(purchaseReturns.id, returnId), eq(purchaseReturns.tenantId, ctx.tenant.tenantId))
          );
        if (retRow && !approveScope.includes(retRow.branchId)) {
          throw new ERPError(
            'PURCHASE_RETURN_OUT_OF_SCOPE',
            'Purchase return is outside your assigned branch(es)',
            403
          );
        }
      }

      const lines = await ctx.db.raw
        .select({ itemId: purchaseReturnLines.itemId })
        .from(purchaseReturnLines)
        .where(eq(purchaseReturnLines.purchaseReturnId, returnId));
      const svc = new PurchaseReturnService(ctx.db.raw);
      const debitNoteId = await svc.approve(returnId, ctx.tenant.tenantId, ctx.tenant.userId);

      // Same cross-service item-cache gap GRN receipts had (fixed 2026-07-17) — a purchase
      // return also writes availableQty/valuation directly to `items`, so inventory-service's
      // Redis item-cache needs the same invalidation or it serves pre-return stock for up to
      // the full 5-minute TTL.
      await Promise.all(
        [...new Set(lines.map((l) => l.itemId))].map((itemId) => ctx.cache.del(`item:${itemId}`))
      );

      return reply.send({ success: true, data: { debitNoteId } });
    }),
  });

  fastify.get('/debit-notes', {
    preHandler: requirePermission(PERMISSIONS.PURCHASE_RETURN_VIEW),
    handler: tenantScopedHandler(ctxFactory, async (req, reply, ctx) => {
      const q = req.query as {
        supplierId?: string;
        status?: string;
        page?: string;
        pageSize?: string;
      };
      const page = Math.max(1, parseInt(q.page ?? '1', 10));
      const pageSize = Math.min(100, parseInt(q.pageSize ?? '20', 10));
      const offset = (page - 1) * pageSize;

      const conditions = [eq(debitNotes.tenantId, ctx.tenant.tenantId)];
      if (q.supplierId) conditions.push(eq(debitNotes.supplierId, parseInt(q.supplierId, 10)));
      if (q.status) conditions.push(eq(debitNotes.status, q.status as never));

      // Purchase audit 2026-07-21 gap-fix (systemic pass, part 3): debitNotes has no branchId
      // of its own — resolve through its parent purchaseReturn.
      const listScope = getBranchScope(req.auth);
      if (listScope !== 'all') {
        if (listScope.length === 0) {
          return reply.send({ data: { content: [], totalElements: 0, page, pageSize } });
        }
        conditions.push(inArray(purchaseReturns.branchId, listScope));
      }

      const rows = await ctx.db.raw
        .select({ ...getTableColumns(debitNotes), supplierName: suppliers.displayName })
        .from(debitNotes)
        .leftJoin(suppliers, eq(debitNotes.supplierId, suppliers.id))
        .leftJoin(purchaseReturns, eq(debitNotes.purchaseReturnId, purchaseReturns.id))
        .where(and(...conditions))
        .orderBy(desc(debitNotes.issueDate), desc(debitNotes.id))
        .limit(pageSize)
        .offset(offset);

      const [countRow] = await ctx.db.raw
        .select({ count: sql<number>`count(*)::int` })
        .from(debitNotes)
        .leftJoin(purchaseReturns, eq(debitNotes.purchaseReturnId, purchaseReturns.id))
        .where(and(...conditions));

      return reply.send({
        data: { content: rows, totalElements: countRow?.count ?? 0, page, pageSize },
      });
    }),
  });

  fastify.get('/debit-notes/:id', {
    preHandler: requirePermission(PERMISSIONS.PURCHASE_RETURN_VIEW),
    handler: tenantScopedHandler(ctxFactory, async (req, reply, ctx) => {
      const { id } = req.params as { id: string };
      const [row] = await ctx.db.raw
        .select({
          ...getTableColumns(debitNotes),
          supplierName: suppliers.displayName,
          _returnBranchId: purchaseReturns.branchId,
        })
        .from(debitNotes)
        .leftJoin(suppliers, eq(debitNotes.supplierId, suppliers.id))
        .leftJoin(purchaseReturns, eq(debitNotes.purchaseReturnId, purchaseReturns.id))
        .where(
          and(eq(debitNotes.id, parseInt(id, 10)), eq(debitNotes.tenantId, ctx.tenant.tenantId))
        );
      if (!row)
        return reply
          .code(404)
          .send({ error: { code: 'NOT_FOUND', message: 'Debit note not found' } });

      const detailScope = getBranchScope(req.auth);
      if (
        detailScope !== 'all' &&
        row._returnBranchId !== null &&
        !detailScope.includes(row._returnBranchId)
      ) {
        throw new ERPError(
          'DEBIT_NOTE_OUT_OF_SCOPE',
          'Debit note is outside your assigned branch(es)',
          403
        );
      }

      const { _returnBranchId, ...data } = row;
      return reply.send({ data });
    }),
  });

  // Marks part or all of a debit note's value as matched against a supplier bill/payment
  // (see DebitNoteService's own comment for why this endpoint exists — previously debit
  // notes had no way to ever leave OPEN status). Reuses PURCHASE_RETURN_APPROVE since
  // that's the same authority level that generates the debit note in the first place.
  fastify.post('/debit-notes/:id/apply', {
    preHandler: requirePermission(PERMISSIONS.PURCHASE_RETURN_APPROVE),
    handler: tenantScopedHandler(ctxFactory, async (req, reply, ctx) => {
      const { id } = req.params as { id: string };
      const body = ApplyDebitNoteSchema.parse(req.body);
      const applyScope = getBranchScope(req.auth);
      if (applyScope !== 'all') {
        const [dnRow] = await ctx.db.raw
          .select({ branchId: purchaseReturns.branchId })
          .from(debitNotes)
          .leftJoin(purchaseReturns, eq(debitNotes.purchaseReturnId, purchaseReturns.id))
          .where(
            and(eq(debitNotes.id, parseInt(id, 10)), eq(debitNotes.tenantId, ctx.tenant.tenantId))
          );
        if (
          dnRow?.branchId !== null &&
          dnRow?.branchId !== undefined &&
          !applyScope.includes(dnRow.branchId)
        ) {
          throw new ERPError(
            'DEBIT_NOTE_OUT_OF_SCOPE',
            'Debit note is outside your assigned branch(es)',
            403
          );
        }
      }

      const svc = new DebitNoteService(ctx.db.raw);
      await svc.apply({
        id: parseInt(id, 10),
        tenantId: ctx.tenant.tenantId,
        amount: body.amount,
        notes: body.notes,
      });
      return reply.send({ success: true });
    }),
  });
}
