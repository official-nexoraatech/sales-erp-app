import type { FastifyInstance } from 'fastify';
import type { PlatformContextFactory } from '@erp/sdk';
import {
  getBranchScope,
  omitFieldsWithoutPermission,
  omitFieldsFromListWithoutPermission,
} from '@erp/sdk';
import { crmOpportunities, crmOpportunityHistory } from '@erp/db';
import { and, desc, eq, inArray, isNull, or } from 'drizzle-orm';
import { z } from 'zod';
import { BusinessError, NotFoundError, PERMISSIONS } from '@erp/types';
import { authenticate } from '../middleware/authenticate.js';
import { requirePermission } from '../middleware/authorize.js';
import { OpportunityService } from '../domain/OpportunityService.js';
import { CustomerFinancialSnapshotService } from '../domain/CustomerFinancialSnapshotService.js';

// CRM-ROADMAP Phase 2, Feature 1 — Sales Pipeline & Opportunity Management.

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

type AuthedRequest = {
  auth: {
    tenantId: number;
    userId: number;
    email: string;
    permissions: string[];
    branchIds: number[];
  };
};

function branchInScope(
  auth: { permissions: string[]; branchIds: number[] },
  branchId: number | null
): boolean {
  if (branchId === null) return true;
  const scope = getBranchScope(auth);
  return scope === 'all' || scope.includes(branchId);
}

export async function opportunityRoutes(
  fastify: FastifyInstance,
  ctxFactory: PlatformContextFactory
): Promise<void> {
  fastify.addHook('preHandler', authenticate);

  // ── GET /pipeline-stages ─────────────────────────────────────────────────────
  fastify.get('/pipeline-stages', {
    preHandler: requirePermission(PERMISSIONS.OPPORTUNITY_VIEW),
    handler: async (request, reply) => {
      const { tenantId } = (request as unknown as AuthedRequest).auth;
      const query = request.query as { dealType?: string };
      const ctx = ctxFactory.create({
        tenantId,
        userId: (request as unknown as AuthedRequest).auth.userId,
        correlationId: (request.headers['x-correlation-id'] as string) ?? crypto.randomUUID(),
      });
      const stages = await OpportunityService.getStages(ctx.db.raw, tenantId, query.dealType);
      return reply.code(200).send({ data: stages });
    },
  });

  // ── GET /opportunities/forecast ───────────────────────────────────────────────
  fastify.get('/opportunities/forecast', {
    preHandler: requirePermission(PERMISSIONS.OPPORTUNITY_VIEW),
    handler: async (request, reply) => {
      const { tenantId, permissions, branchIds } = (request as unknown as AuthedRequest).auth;
      const ctx = ctxFactory.create({
        tenantId,
        userId: (request as unknown as AuthedRequest).auth.userId,
        correlationId: (request.headers['x-correlation-id'] as string) ?? crypto.randomUUID(),
      });
      const stages = await OpportunityService.getStages(ctx.db.raw, tenantId);
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
        eq(crmOpportunities.tenantId, tenantId),
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
    },
  });

  // ── GET /opportunities ────────────────────────────────────────────────────────
  fastify.get('/opportunities', {
    preHandler: requirePermission(PERMISSIONS.OPPORTUNITY_VIEW),
    handler: async (request, reply) => {
      const { tenantId, permissions, branchIds } = (request as unknown as AuthedRequest).auth;
      const query = request.query as { stage?: string; dealType?: string; customerId?: string };
      const ctx = ctxFactory.create({
        tenantId,
        userId: (request as unknown as AuthedRequest).auth.userId,
        correlationId: (request.headers['x-correlation-id'] as string) ?? crypto.randomUUID(),
      });

      const branchScope = getBranchScope({ permissions, branchIds });
      const rows = await OpportunityService.list(ctx.db.raw, tenantId, branchScope, {
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
    },
  });

  // ── GET /opportunities/:id ────────────────────────────────────────────────────
  fastify.get<{ Params: { id: string } }>('/opportunities/:id', {
    preHandler: requirePermission(PERMISSIONS.OPPORTUNITY_VIEW),
    handler: async (request, reply) => {
      const { tenantId, permissions, branchIds } = (request as unknown as AuthedRequest).auth;
      const id = parseInt(request.params.id, 10);
      const ctx = ctxFactory.create({
        tenantId,
        userId: (request as unknown as AuthedRequest).auth.userId,
        correlationId: (request.headers['x-correlation-id'] as string) ?? crypto.randomUUID(),
      });
      const [opportunity] = await ctx.db.raw
        .select()
        .from(crmOpportunities)
        .where(and(eq(crmOpportunities.id, id), eq(crmOpportunities.tenantId, tenantId)));
      if (!opportunity) throw new NotFoundError('CrmOpportunity', id);
      if (!branchInScope({ permissions, branchIds }, opportunity.branchId)) {
        throw new NotFoundError('CrmOpportunity', id);
      }

      const lines = await OpportunityService.listLineItems(ctx.db.raw, tenantId, id);
      const stock = await CustomerFinancialSnapshotService.getStockForItems(
        ctx.db.raw,
        tenantId,
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
    },
  });

  // ── POST /opportunities ───────────────────────────────────────────────────────
  fastify.post('/opportunities', {
    preHandler: requirePermission(PERMISSIONS.OPPORTUNITY_CREATE),
    handler: async (request, reply) => {
      const { tenantId, userId, email } = (request as unknown as AuthedRequest).auth;
      const body = CreateSchema.parse(request.body);
      const ctx = ctxFactory.create({
        tenantId,
        userId,
        correlationId: (request.headers['x-correlation-id'] as string) ?? crypto.randomUUID(),
      });

      const created = await OpportunityService.create(ctx.db.raw, {
        tenantId,
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
        createdBy: userId,
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
        actorEmail: email,
      });

      return reply.code(201).send({ data: created });
    },
  });

  // ── PUT /opportunities/:id ────────────────────────────────────────────────────
  fastify.put<{ Params: { id: string } }>('/opportunities/:id', {
    preHandler: requirePermission(PERMISSIONS.OPPORTUNITY_UPDATE),
    handler: async (request, reply) => {
      const { tenantId } = (request as unknown as AuthedRequest).auth;
      const id = parseInt(request.params.id, 10);
      const body = UpdateSchema.parse(request.body);
      const ctx = ctxFactory.create({
        tenantId,
        userId: (request as unknown as AuthedRequest).auth.userId,
        correlationId: (request.headers['x-correlation-id'] as string) ?? crypto.randomUUID(),
      });

      const [existing] = await ctx.db.raw
        .select()
        .from(crmOpportunities)
        .where(and(eq(crmOpportunities.id, id), eq(crmOpportunities.tenantId, tenantId)));
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
            eq(crmOpportunities.tenantId, tenantId),
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
    },
  });

  // ── DELETE /opportunities/:id ─────────────────────────────────────────────────
  fastify.delete<{ Params: { id: string } }>('/opportunities/:id', {
    preHandler: requirePermission(PERMISSIONS.OPPORTUNITY_DELETE),
    handler: async (request, reply) => {
      const { tenantId } = (request as unknown as AuthedRequest).auth;
      const id = parseInt(request.params.id, 10);
      const ctx = ctxFactory.create({
        tenantId,
        userId: (request as unknown as AuthedRequest).auth.userId,
        correlationId: (request.headers['x-correlation-id'] as string) ?? crypto.randomUUID(),
      });
      const [deleted] = await ctx.db.raw
        .delete(crmOpportunities)
        .where(and(eq(crmOpportunities.id, id), eq(crmOpportunities.tenantId, tenantId)))
        .returning({ id: crmOpportunities.id });
      if (!deleted) throw new NotFoundError('CrmOpportunity', id);
      return reply.code(200).send({ data: { message: 'Opportunity deleted' } });
    },
  });

  // ── POST /opportunities/:id/line-items ────────────────────────────────────────
  fastify.post<{ Params: { id: string } }>('/opportunities/:id/line-items', {
    preHandler: requirePermission(PERMISSIONS.OPPORTUNITY_UPDATE),
    handler: async (request, reply) => {
      const { tenantId } = (request as unknown as AuthedRequest).auth;
      const id = parseInt(request.params.id, 10);
      const body = LineItemSchema.parse(request.body);
      const ctx = ctxFactory.create({
        tenantId,
        userId: (request as unknown as AuthedRequest).auth.userId,
        correlationId: (request.headers['x-correlation-id'] as string) ?? crypto.randomUUID(),
      });
      const created = await OpportunityService.addLineItem(ctx.db.raw, tenantId, id, body);
      return reply.code(201).send({ data: created });
    },
  });

  // ── DELETE /opportunities/:id/line-items/:lineItemId ──────────────────────────
  fastify.delete<{ Params: { id: string; lineItemId: string } }>(
    '/opportunities/:id/line-items/:lineItemId',
    {
      preHandler: requirePermission(PERMISSIONS.OPPORTUNITY_UPDATE),
      handler: async (request, reply) => {
        const { tenantId } = (request as unknown as AuthedRequest).auth;
        const id = parseInt(request.params.id, 10);
        const lineItemId = parseInt(request.params.lineItemId, 10);
        const ctx = ctxFactory.create({
          tenantId,
          userId: (request as unknown as AuthedRequest).auth.userId,
          correlationId: (request.headers['x-correlation-id'] as string) ?? crypto.randomUUID(),
        });
        await OpportunityService.removeLineItem(ctx.db.raw, tenantId, id, lineItemId);
        return reply.code(200).send({ data: { message: 'Line item removed' } });
      },
    }
  );

  // ── POST /opportunities/:id/stage — generic mid-pipeline move ─────────────────
  fastify.post<{ Params: { id: string } }>('/opportunities/:id/stage', {
    preHandler: requirePermission(PERMISSIONS.OPPORTUNITY_STAGE_CHANGE),
    handler: async (request, reply) => {
      const { tenantId, userId, email } = (request as unknown as AuthedRequest).auth;
      const id = parseInt(request.params.id, 10);
      const body = StageChangeSchema.parse(request.body);
      const ctx = ctxFactory.create({
        tenantId,
        userId,
        correlationId: (request.headers['x-correlation-id'] as string) ?? crypto.randomUUID(),
      });

      const [existing] = await ctx.db.raw
        .select()
        .from(crmOpportunities)
        .where(and(eq(crmOpportunities.id, id), eq(crmOpportunities.tenantId, tenantId)));
      if (!existing) throw new NotFoundError('CrmOpportunity', id);

      const stages = await OpportunityService.getStages(ctx.db.raw, tenantId, existing.dealType);
      const toStage = stages.find((s) => s.code === body.toStageCode);
      if (toStage?.isWon) {
        throw new BusinessError(
          'USE_WON_ENDPOINT',
          'Use POST /opportunities/:id/won to mark an opportunity Won'
        );
      }

      const updated = await OpportunityService.changeStage(ctx.db.raw, tenantId, userId, id, body);

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
        actorEmail: email,
      });

      return reply.code(200).send({ data: updated });
    },
  });

  // ── POST /opportunities/:id/won ────────────────────────────────────────────────
  fastify.post<{ Params: { id: string } }>('/opportunities/:id/won', {
    preHandler: requirePermission(PERMISSIONS.OPPORTUNITY_STAGE_CHANGE),
    handler: async (request, reply) => {
      const { tenantId, userId, email } = (request as unknown as AuthedRequest).auth;
      const id = parseInt(request.params.id, 10);
      const body = MarkWonSchema.parse(request.body);
      const ctx = ctxFactory.create({
        tenantId,
        userId,
        correlationId: (request.headers['x-correlation-id'] as string) ?? crypto.randomUUID(),
      });

      const result = await OpportunityService.markWon(ctx.db.raw, tenantId, userId, id, {
        version: body.version,
        branchId: body.branchId,
        placeOfSupply: body.placeOfSupply,
        sellerStateCode: body.sellerStateCode,
        validUntil: new Date(body.validUntil),
      });

      await ctx.events.publish('crm_opportunity', id, 'OPPORTUNITY_WON', {
        opportunityId: id,
        quotationId: result.quotationId,
      });
      await ctx.events.publish('quotation', result.quotationId, 'QUOTATION_CREATED', {
        quotationId: result.quotationId,
        customerId: result.opportunity.customerId,
        branchId: body.branchId,
        status: 'DRAFT',
      });
      await ctx.audit.log({
        action: 'UPDATE',
        entityType: 'crm_opportunity',
        entityId: id,
        after: { stage: 'WON', quotationId: result.quotationId },
        actorEmail: email,
      });

      return reply.code(200).send({ data: result });
    },
  });

  // ── POST /opportunities/:id/lost ───────────────────────────────────────────────
  fastify.post<{ Params: { id: string } }>('/opportunities/:id/lost', {
    preHandler: requirePermission(PERMISSIONS.OPPORTUNITY_STAGE_CHANGE),
    handler: async (request, reply) => {
      const { tenantId, userId, email } = (request as unknown as AuthedRequest).auth;
      const id = parseInt(request.params.id, 10);
      const body = MarkLostSchema.parse(request.body);
      const ctx = ctxFactory.create({
        tenantId,
        userId,
        correlationId: (request.headers['x-correlation-id'] as string) ?? crypto.randomUUID(),
      });

      const updated = await OpportunityService.markLost(ctx.db.raw, tenantId, userId, id, body);

      await ctx.events.publish('crm_opportunity', id, 'OPPORTUNITY_LOST', {
        opportunityId: id,
        lostReason: body.lostReason,
      });
      await ctx.audit.log({
        action: 'UPDATE',
        entityType: 'crm_opportunity',
        entityId: id,
        after: { stage: 'LOST', lostReason: body.lostReason },
        actorEmail: email,
      });

      return reply.code(200).send({ data: updated });
    },
  });
}
