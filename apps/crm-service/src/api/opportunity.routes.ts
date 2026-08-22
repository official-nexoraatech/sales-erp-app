import type { FastifyInstance } from 'fastify';
import type { PlatformContextFactory } from '@erp/sdk';
import {
  tenantScopedHandler,
  getBranchScope,
  omitFieldsWithoutPermission,
  omitFieldsFromListWithoutPermission,
} from '@erp/sdk';
import { crmOpportunities, crmOpportunityHistory, items, projectionStockLevel } from '@erp/db';
import type { ErpDatabase } from '@erp/db';
import { and, desc, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import { BusinessError, NotFoundError, PERMISSIONS } from '@erp/types';
import { authenticate } from '../middleware/authenticate.js';
import { requirePermission } from '../middleware/authorize.js';
import { OpportunityService } from '../domain/OpportunityService.js';

// CRM-ROADMAP Phase 2, Feature 1 — Sales Pipeline & Opportunity Management.
//
// Phase 9 GUC-per-request rollout — migrated 2026-08-21. No external I/O — OpportunityService
// has no fetch() calls (markWon()'s OPPORTUNITY_WON/QUOTATION_CREATED events are outbox rows,
// consumed asynchronously by OpportunityWonConsumer — not a synchronous call). Post-hoc
// ctx.audit.log()/ctx.events.publish() calls are safe per caveat 4b.

const LineItemSchema = z.object({
  itemId: z.number().int().positive(),
  variantId: z.number().int().positive().optional(),
  quantity: z.number().positive(),
  unitId: z.number().int().positive().optional(),
  unitPrice: z.number().nonnegative(),
  discountPct: z.number().min(0).max(100).optional(),
  discountAmount: z.number().min(0).optional(),
});

const CreateSchema = z.object({
  name: z.string().min(2).max(300),
  dealType: z.string().max(50).optional(),
  value: z.number().nonnegative(),
  expectedCloseDate: z.string().datetime().optional(),
  customerId: z.number().int().positive().optional(),
  accountId: z.number().int().positive().optional(),
  assignedTo: z.number().int().positive().optional(),
  branchId: z.number().int().positive().optional(),
  notes: z.string().max(2000).optional(),
  lines: z.array(LineItemSchema).optional(),
});

const UpdateSchema = z.object({
  version: z.number().int().min(0),
  name: z.string().min(2).max(300).optional(),
  value: z.number().nonnegative().optional(),
  expectedCloseDate: z.string().datetime().optional(),
  customerId: z.number().int().positive().optional(),
  accountId: z.number().int().positive().optional(),
  assignedTo: z.number().int().positive().optional(),
  branchId: z.number().int().positive().optional(),
  notes: z.string().max(2000).optional(),
});

const StageChangeSchema = z.object({
  toStageCode: z.string().min(1).max(30),
  version: z.number().int().min(0),
});

const MarkWonSchema = z.object({
  version: z.number().int().min(0),
  branchId: z.number().int().positive(),
  placeOfSupply: z.string().length(2),
  sellerStateCode: z.string().length(2),
  validUntil: z.string().datetime(),
});

const MarkLostSchema = z.object({
  version: z.number().int().min(0),
  lostReason: z.string().min(1).max(500),
});

function branchInScope(
  auth: { permissions: string[]; branchIds: number[] },
  branchId: number | null
): boolean {
  if (branchId === null) return true;
  const scope = getBranchScope(auth);
  return scope === 'all' || scope.includes(branchId);
}

interface RecentItemStock {
  itemId: number;
  itemCode: string | null;
  itemName: string;
  totalAvailableQty: number;
  warehouseCount: number;
}

// CRM/O2C split — CustomerFinancialSnapshotService (sales-service) stays behind: it's an
// explicitly-documented O2C read-composition module (reads invoices/projection tables), not a
// CRM-owned service. This one method's query is inlined here rather than imported cross-service
// or called over HTTP — it's small, read-only, and touches only `items`/`projection_stock_level`,
// matching the shared-table-read precedent already established for `items` elsewhere in this
// split (OpportunityService.markWon, WhatsAppCommerceService).
async function getStockForItems(
  db: ErpDatabase,
  tenantId: number,
  itemIds: number[]
): Promise<RecentItemStock[]> {
  if (itemIds.length === 0) return [];

  const [itemRows, stockRows] = await Promise.all([
    db
      .select({ id: items.id, itemCode: items.itemCode, name: items.name })
      .from(items)
      .where(and(eq(items.tenantId, tenantId), inArray(items.id, itemIds))),
    db
      .select({
        itemId: projectionStockLevel.itemId,
        totalAvailableQty: sql<string>`sum(${projectionStockLevel.availableQty})`,
        warehouseCount: sql<number>`count(distinct ${projectionStockLevel.warehouseId})::int`,
      })
      .from(projectionStockLevel)
      .where(
        and(
          eq(projectionStockLevel.tenantId, tenantId),
          inArray(projectionStockLevel.itemId, itemIds)
        )
      )
      .groupBy(projectionStockLevel.itemId),
  ]);

  const stockByItem = new Map(stockRows.map((r) => [r.itemId, r]));
  return itemIds.map((itemId) => {
    const item = itemRows.find((i) => i.id === itemId);
    const stock = stockByItem.get(itemId);
    return {
      itemId,
      itemCode: item?.itemCode ?? null,
      itemName: item?.name ?? `Item #${itemId}`,
      totalAvailableQty: parseFloat(stock?.totalAvailableQty ?? '0'),
      warehouseCount: stock?.warehouseCount ?? 0,
    };
  });
}

// CRM/O2C split — converted from a single file-level fastify.addHook('preHandler', authenticate)
// to per-route [authenticate, requirePermission(...)] arrays: crm-service registers every route
// file on one shared `sub` instance with no file-level hook of its own, so an addHook here would
// leak onto every sibling route registered after this one in that same block (see
// conversation.routes.ts's identical conversion for the same reason).
export async function opportunityRoutes(
  fastify: FastifyInstance,
  ctxFactory: PlatformContextFactory
): Promise<void> {
  // ── GET /pipeline-stages ─────────────────────────────────────────────────────
  fastify.get(
    '/pipeline-stages',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.OPPORTUNITY_VIEW)] },
    tenantScopedHandler(ctxFactory, async (request, reply, ctx) => {
      const query = request.query as { dealType?: string };
      const stages = await OpportunityService.getStages(
        ctx.db.raw,
        ctx.tenant.tenantId,
        query.dealType
      );
      return reply.code(200).send({ data: stages });
    })
  );

  // ── GET /opportunities/forecast ───────────────────────────────────────────────
  fastify.get(
    '/opportunities/forecast',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.OPPORTUNITY_VIEW)] },
    tenantScopedHandler(ctxFactory, async (request, reply, ctx) => {
      const { permissions, branchIds } = request.auth;
      const stages = await OpportunityService.getStages(ctx.db.raw, ctx.tenant.tenantId);
      const openCodes = stages.filter((s) => !s.isWon && !s.isLost).map((s) => s.code);
      if (openCodes.length === 0) {
        const empty = { pipelineValue: 0, weightedValue: 0, commitValue: 0 };
        return reply.code(200).send({
          data: omitFieldsWithoutPermission(
            empty,
            ['pipelineValue', 'weightedValue', 'commitValue'],
            permissions,
            PERMISSIONS.OPPORTUNITY_VALUE_VIEW
          ),
        });
      }

      const conditions = [
        eq(crmOpportunities.tenantId, ctx.tenant.tenantId),
        inArray(crmOpportunities.stage, openCodes),
      ];
      const branchScope = getBranchScope({ permissions, branchIds });
      if (branchScope !== 'all') {
        conditions.push(
          or(isNull(crmOpportunities.branchId), inArray(crmOpportunities.branchId, branchScope))!
        );
      }

      const rows = await ctx.db.raw
        .select({ value: crmOpportunities.value, probability: crmOpportunities.probability })
        .from(crmOpportunities)
        .where(and(...conditions));

      const forecast = OpportunityService.computeForecast(
        rows.map((r) => ({ value: parseFloat(r.value), probability: r.probability }))
      );
      // CRM-ROADMAP Phase 3, Feature 6 — these three numbers are a direct sum of `value` across
      // every open deal, so they're gated the same as the raw field, not treated as a "safe"
      // derived aggregate (the roadmap's own explicit edge case: a probability-weighted total
      // can leak the same commercially sensitive information as the raw value it's computed from).
      return reply.code(200).send({
        data: omitFieldsWithoutPermission(
          forecast,
          ['pipelineValue', 'weightedValue', 'commitValue'],
          permissions,
          PERMISSIONS.OPPORTUNITY_VALUE_VIEW
        ),
      });
    })
  );

  // ── GET /opportunities ────────────────────────────────────────────────────────
  fastify.get(
    '/opportunities',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.OPPORTUNITY_VIEW)] },
    tenantScopedHandler(ctxFactory, async (request, reply, ctx) => {
      const { permissions, branchIds } = request.auth;
      const query = request.query as { stage?: string; dealType?: string; customerId?: string };

      const branchScope = getBranchScope({ permissions, branchIds });
      const rows = await OpportunityService.list(ctx.db.raw, ctx.tenant.tenantId, branchScope, {
        stage: query.stage,
        dealType: query.dealType,
        customerId: query.customerId ? parseInt(query.customerId, 10) : undefined,
      });
      // CRM-ROADMAP Phase 3, Feature 6 — omit the commercially sensitive `value` field, not
      // null it, for a caller lacking OPPORTUNITY_VALUE_VIEW.
      const content = omitFieldsFromListWithoutPermission(
        rows,
        ['value'],
        permissions,
        PERMISSIONS.OPPORTUNITY_VALUE_VIEW
      );
      return reply.code(200).send({ data: { content, totalElements: rows.length } });
    })
  );

  // ── GET /opportunities/:id ────────────────────────────────────────────────────
  fastify.get(
    '/opportunities/:id',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.OPPORTUNITY_VIEW)] },
    tenantScopedHandler(ctxFactory, async (request, reply, ctx) => {
      const { permissions, branchIds } = request.auth;
      const { id: idParam } = request.params as { id: string };
      const id = parseInt(idParam, 10);
      const [opportunity] = await ctx.db.raw
        .select()
        .from(crmOpportunities)
        .where(
          and(eq(crmOpportunities.id, id), eq(crmOpportunities.tenantId, ctx.tenant.tenantId))
        );
      if (!opportunity) throw new NotFoundError('CrmOpportunity', id);
      if (!branchInScope({ permissions, branchIds }, opportunity.branchId)) {
        throw new NotFoundError('CrmOpportunity', id);
      }

      const lines = await OpportunityService.listLineItems(ctx.db.raw, ctx.tenant.tenantId, id);
      const stock = await getStockForItems(
        ctx.db.raw,
        ctx.tenant.tenantId,
        lines.map((l) => l.itemId)
      );
      const history = await ctx.db.raw
        .select()
        .from(crmOpportunityHistory)
        .where(eq(crmOpportunityHistory.opportunityId, id))
        .orderBy(desc(crmOpportunityHistory.createdAt));

      // CRM-ROADMAP Phase 3, Feature 6 — same omit-not-null treatment as the list endpoint.
      const filtered = omitFieldsWithoutPermission(
        opportunity,
        ['value'],
        permissions,
        PERMISSIONS.OPPORTUNITY_VALUE_VIEW
      );
      return reply.code(200).send({ data: { ...filtered, lines, stock, history } });
    })
  );

  // ── POST /opportunities ───────────────────────────────────────────────────────
  fastify.post(
    '/opportunities',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.OPPORTUNITY_CREATE)] },
    tenantScopedHandler(ctxFactory, async (request, reply, ctx) => {
      const body = CreateSchema.parse(request.body);

      const created = await OpportunityService.create(ctx.db.raw, {
        tenantId: ctx.tenant.tenantId,
        name: body.name,
        dealType: body.dealType,
        value: body.value,
        expectedCloseDate: body.expectedCloseDate ? new Date(body.expectedCloseDate) : undefined,
        customerId: body.customerId,
        accountId: body.accountId,
        assignedTo: body.assignedTo,
        branchId: body.branchId,
        notes: body.notes,
        lines: body.lines,
        createdBy: ctx.tenant.userId,
      });

      await ctx.events.publish(
        'crm_opportunity',
        created.id,
        'OPPORTUNITY_CREATED',
        created as unknown as Record<string, unknown>
      );
      await ctx.audit.log({
        action: 'CREATE',
        entityType: 'crm_opportunity',
        entityId: created.id,
        after: created as unknown as Record<string, unknown>,
        actorEmail: request.auth.email,
      });

      return reply.code(201).send({ data: created });
    })
  );

  // ── PUT /opportunities/:id ────────────────────────────────────────────────────
  fastify.put(
    '/opportunities/:id',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.OPPORTUNITY_UPDATE)] },
    tenantScopedHandler(ctxFactory, async (request, reply, ctx) => {
      const { id: idParam } = request.params as { id: string };
      const id = parseInt(idParam, 10);
      const body = UpdateSchema.parse(request.body);

      const [existing] = await ctx.db.raw
        .select()
        .from(crmOpportunities)
        .where(
          and(eq(crmOpportunities.id, id), eq(crmOpportunities.tenantId, ctx.tenant.tenantId))
        );
      if (!existing) throw new NotFoundError('CrmOpportunity', id);

      const { version, expectedCloseDate, value, ...rest } = body;
      const [updated] = await ctx.db.raw
        .update(crmOpportunities)
        .set({
          ...rest,
          ...(expectedCloseDate ? { expectedCloseDate: new Date(expectedCloseDate) } : {}),
          ...(value !== undefined ? { value: String(value) } : {}),
          updatedAt: new Date(),
          version: existing.version + 1,
        })
        .where(
          and(
            eq(crmOpportunities.id, id),
            eq(crmOpportunities.tenantId, ctx.tenant.tenantId),
            eq(crmOpportunities.version, version)
          )
        )
        .returning();
      if (!updated) {
        return reply.code(409).send({
          error: {
            code: 'OPTIMISTIC_LOCK',
            message: 'CrmOpportunity was modified by someone else',
          },
        });
      }

      return reply.code(200).send({ data: updated });
    })
  );

  // ── DELETE /opportunities/:id ─────────────────────────────────────────────────
  fastify.delete(
    '/opportunities/:id',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.OPPORTUNITY_DELETE)] },
    tenantScopedHandler(ctxFactory, async (request, reply, ctx) => {
      const { id: idParam } = request.params as { id: string };
      const id = parseInt(idParam, 10);
      const [deleted] = await ctx.db.raw
        .delete(crmOpportunities)
        .where(and(eq(crmOpportunities.id, id), eq(crmOpportunities.tenantId, ctx.tenant.tenantId)))
        .returning({ id: crmOpportunities.id });
      if (!deleted) throw new NotFoundError('CrmOpportunity', id);
      return reply.code(200).send({ data: { message: 'Opportunity deleted' } });
    })
  );

  // ── POST /opportunities/:id/line-items ────────────────────────────────────────
  fastify.post(
    '/opportunities/:id/line-items',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.OPPORTUNITY_UPDATE)] },
    tenantScopedHandler(ctxFactory, async (request, reply, ctx) => {
      const { id: idParam } = request.params as { id: string };
      const id = parseInt(idParam, 10);
      const body = LineItemSchema.parse(request.body);
      const created = await OpportunityService.addLineItem(
        ctx.db.raw,
        ctx.tenant.tenantId,
        id,
        body
      );
      return reply.code(201).send({ data: created });
    })
  );

  // ── DELETE /opportunities/:id/line-items/:lineItemId ──────────────────────────
  fastify.delete(
    '/opportunities/:id/line-items/:lineItemId',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.OPPORTUNITY_UPDATE)] },
    tenantScopedHandler(ctxFactory, async (request, reply, ctx) => {
      const { id: idParam, lineItemId: lineItemIdParam } = request.params as {
        id: string;
        lineItemId: string;
      };
      const id = parseInt(idParam, 10);
      const lineItemId = parseInt(lineItemIdParam, 10);
      await OpportunityService.removeLineItem(ctx.db.raw, ctx.tenant.tenantId, id, lineItemId);
      return reply.code(200).send({ data: { message: 'Line item removed' } });
    })
  );

  // ── POST /opportunities/:id/stage — generic mid-pipeline move ─────────────────
  fastify.post(
    '/opportunities/:id/stage',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.OPPORTUNITY_STAGE_CHANGE)] },
    tenantScopedHandler(ctxFactory, async (request, reply, ctx) => {
      const { id: idParam } = request.params as { id: string };
      const id = parseInt(idParam, 10);
      const body = StageChangeSchema.parse(request.body);

      const [existing] = await ctx.db.raw
        .select()
        .from(crmOpportunities)
        .where(
          and(eq(crmOpportunities.id, id), eq(crmOpportunities.tenantId, ctx.tenant.tenantId))
        );
      if (!existing) throw new NotFoundError('CrmOpportunity', id);

      const stages = await OpportunityService.getStages(
        ctx.db.raw,
        ctx.tenant.tenantId,
        existing.dealType
      );
      const toStage = stages.find((s) => s.code === body.toStageCode);
      if (toStage?.isWon) {
        throw new BusinessError(
          'USE_WON_ENDPOINT',
          'Use POST /opportunities/:id/won to mark an opportunity Won'
        );
      }

      const updated = await OpportunityService.changeStage(
        ctx.db.raw,
        ctx.tenant.tenantId,
        ctx.tenant.userId,
        id,
        body
      );

      await ctx.events.publish('crm_opportunity', id, 'OPPORTUNITY_STAGE_CHANGED', {
        opportunityId: id,
        fromStage: existing.stage,
        toStage: updated.stage,
      });
      await ctx.audit.log({
        action: 'UPDATE',
        entityType: 'crm_opportunity',
        entityId: id,
        before: { stage: existing.stage },
        after: { stage: updated.stage },
        actorEmail: request.auth.email,
      });

      return reply.code(200).send({ data: updated });
    })
  );

  // ── POST /opportunities/:id/won ────────────────────────────────────────────────
  fastify.post(
    '/opportunities/:id/won',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.OPPORTUNITY_STAGE_CHANGE)] },
    tenantScopedHandler(ctxFactory, async (request, reply, ctx) => {
      const { id: idParam } = request.params as { id: string };
      const id = parseInt(idParam, 10);
      const body = MarkWonSchema.parse(request.body);

      // OPPORTUNITY_WON is now published transactionally inside markWon() itself (the outbox
      // event that drives async Quotation creation — see OpportunityService.markWon's and
      // consumers/OpportunityWonConsumer.ts's doc comments), so no post-hoc publish here.
      // QUOTATION_CREATED likewise no longer fires here — the async consumer publishes it once
      // the quotation actually exists.
      const result = await OpportunityService.markWon(
        ctx.db.raw,
        ctx.tenant.tenantId,
        ctx.tenant.userId,
        id,
        {
          version: body.version,
          branchId: body.branchId,
          placeOfSupply: body.placeOfSupply,
          sellerStateCode: body.sellerStateCode,
          validUntil: new Date(body.validUntil),
        }
      );

      await ctx.audit.log({
        action: 'UPDATE',
        entityType: 'crm_opportunity',
        entityId: id,
        after: { stage: 'WON', quotationId: null, quotationPending: true },
        actorEmail: request.auth.email,
      });

      return reply
        .code(200)
        .send({ data: { ...result.opportunity, quotationId: null, quotationPending: true } });
    })
  );

  // ── POST /opportunities/:id/lost ───────────────────────────────────────────────
  fastify.post(
    '/opportunities/:id/lost',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.OPPORTUNITY_STAGE_CHANGE)] },
    tenantScopedHandler(ctxFactory, async (request, reply, ctx) => {
      const { id: idParam } = request.params as { id: string };
      const id = parseInt(idParam, 10);
      const body = MarkLostSchema.parse(request.body);

      const updated = await OpportunityService.markLost(
        ctx.db.raw,
        ctx.tenant.tenantId,
        ctx.tenant.userId,
        id,
        body
      );

      await ctx.events.publish('crm_opportunity', id, 'OPPORTUNITY_LOST', {
        opportunityId: id,
        lostReason: body.lostReason,
      });
      await ctx.audit.log({
        action: 'UPDATE',
        entityType: 'crm_opportunity',
        entityId: id,
        after: { stage: 'LOST', lostReason: body.lostReason },
        actorEmail: request.auth.email,
      });

      return reply.code(200).send({ data: updated });
    })
  );
}
