import type { FastifyInstance } from 'fastify';
import type { PlatformContextFactory } from '@erp/sdk';
import { getBranchScope } from '@erp/sdk';
import {
  customers,
  customerInteractions,
  customerSegments,
  campaigns,
  campaignTemplates,
  crmCampaignTemplateTranslations,
  crmCampaignMessageTranslations,
  campaignAutomationRules,
  campaignComments,
  crmCampaignVariants,
  businessSeasons,
  notificationLog,
  tenantSenderIdentity,
  tenantCommunicationSettings,
  crmWhatsappCatalogOrders,
} from '@erp/db';
import type { ErpDatabase } from '@erp/db';
import { and, eq, gte, inArray, isNull, lte, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import {
  BusinessError,
  NotFoundError,
  OptimisticLockError,
  ValidationError,
  PERMISSIONS,
} from '@erp/types';
import { authenticate } from '../middleware/authenticate.js';
import { requirePermission } from '../middleware/authorize.js';
import {
  SegmentService,
  PREBUILT_SEGMENTS,
  type SegmentFilterDefinition,
  type SegmentFilterRule,
} from '../domain/SegmentService.js';
import {
  CampaignService,
  checkChannelLimits,
  checkDltCompliance,
  renderCampaignMessage,
} from '../domain/CampaignService.js';
import { HealthScoringService } from '../domain/HealthScoringService.js';
import { FestivalIntelligenceService } from '../domain/FestivalIntelligenceService.js';

type AuthedRequest = {
  auth: { tenantId: number; userId: number; permissions: string[]; branchIds: number[] };
};

// CP-8: a client-submitted branchId must fall within the caller's own JWT branchIds (or they
// hold BRANCH_SCOPE_BYPASS) — mirrors pos.routes.ts's branchInScope() exactly, since campaigns
// (like POS sales) are created via a body-supplied branchId rather than scoped via query filter.
function branchInScope(
  auth: { permissions: string[]; branchIds: number[] },
  branchId: number
): boolean {
  const scope = getBranchScope(auth);
  return scope === 'all' || scope.includes(branchId);
}

const InteractionSchema = z.object({
  type: z.enum(['VISIT', 'CALL', 'COMPLAINT', 'EMAIL', 'WHATSAPP', 'OTHER']),
  notes: z.string().min(1).max(2000),
  followUpDate: z.string().datetime().optional().or(z.literal('')),
});

const SegmentFilterRuleSchema = z.object({
  field: z.string().min(1),
  // CRM-ROADMAP Phase 2, Feature 7 — behavioral/RFM operators added alongside the original 7;
  // see SegmentService.ts's buildCondition for how each is evaluated.
  operator: z.enum([
    'eq',
    'neq',
    'gt',
    'gte',
    'lt',
    'lte',
    'contains',
    'between_dates',
    'purchased_category',
    'rfm_score',
  ]),

  value: z.any(),
});

const SegmentCreateSchema = z.object({
  name: z.string().min(2).max(200),
  rules: z.array(SegmentFilterRuleSchema).min(1),
  logic: z.enum(['AND', 'OR']).default('AND'),
  description: z.string().max(2000).optional(),
});

const SegmentPreviewSchema = z
  .object({
    segmentCode: z.string().optional(),
    rules: z.array(SegmentFilterRuleSchema).optional(),
    logic: z.enum(['AND', 'OR']).default('AND'),
  })
  .refine((d) => !!d.segmentCode || (d.rules && d.rules.length > 0), {
    message: 'Either segmentCode or a non-empty rules array is required',
  });

const CampaignPreviewSchema = z.object({
  segmentId: z.number().int().positive().optional(),
  customerIds: z.array(z.number().int().positive()).optional(),
  messageTemplate: z.string().min(1).max(2000),
  channel: z.enum(['SMS', 'WHATSAPP', 'EMAIL', 'IN_APP']),
});

// CRM-ROADMAP Phase 2, Feature 6 — up to 2 variants (the roadmap's own Playwright scenario is
// literally "A/B test two message variants"), each independently DLT-checked at send time.
const CampaignVariantSchema = z.object({
  label: z.string().min(1).max(10),
  messageTemplate: z.string().min(1).max(2000),
  weight: z.number().int().positive().max(100).default(50),
});

const CampaignCreateSchema = z.object({
  name: z.string().min(2).max(200),
  segmentId: z.number().int().positive().optional(),
  customerIds: z.array(z.number().int().positive()).optional(),
  channel: z.enum(['SMS', 'WHATSAPP', 'EMAIL', 'IN_APP']),
  messageTemplate: z.string().min(1).max(2000),
  // CP-4: tenant-configurable type taxonomy (not an enum) + optional link to the template a
  // campaign was authored from.
  campaignType: z.string().max(50).optional(),
  templateId: z.number().int().positive().optional(),
  // CP-8: store/branch scoping — omitted or absent means tenant-wide (today's behavior).
  branchId: z.number().int().positive().optional(),
  // CRM-ROADMAP Phase 2, Feature 6 — the real destination a {{link}} token resolves to; omitted
  // means the template has no tracked link (today's default for every existing campaign).
  linkUrl: z.string().url().max(2000).optional(),
  variants: z.array(CampaignVariantSchema).max(2).optional(),
});

// CP-4: every field optional except `version` (required for the optimistic-lock check) — a
// caller only sends the fields it actually wants to change.
const CampaignUpdateSchema = z.object({
  version: z.number().int().min(0),
  name: z.string().min(2).max(200).optional(),
  branchId: z.number().int().positive().nullable().optional(),
  segmentId: z.number().int().positive().nullable().optional(),
  customerIds: z.array(z.number().int().positive()).nullable().optional(),
  channel: z.enum(['SMS', 'WHATSAPP', 'EMAIL', 'IN_APP']).optional(),
  messageTemplate: z.string().min(1).max(2000).optional(),
  campaignType: z.string().max(50).nullable().optional(),
  templateId: z.number().int().positive().nullable().optional(),
  // CRM-ROADMAP Phase 2, Feature 6 — variants are deliberately not editable via this route
  // (only settable at creation, per CampaignCreateSchema); linkUrl can still be adjusted or
  // cleared (null) before the campaign is sent.
  linkUrl: z.string().url().max(2000).nullable().optional(),
});

// CP-5: recurrenceRule is optional — a plain one-time scheduled send omits it entirely, matching
// today's behavior exactly.
const CampaignScheduleSchema = z.object({
  scheduledAt: z.string().datetime(),
  recurrenceRule: z
    .object({
      frequency: z.enum(['DAILY', 'WEEKLY', 'MONTHLY']),
      interval: z.number().int().positive(),
      endDate: z.string().datetime().optional(),
      occurrences: z.number().int().positive().optional(),
    })
    .optional(),
  timezone: z.string().max(50).optional(),
});

// CP-7: rejection requires a reason so the campaign owner knows what to fix before resubmitting.
const CampaignRejectSchema = z.object({
  reason: z.string().min(1).max(1000),
});

const CampaignCommentSchema = z.object({
  body: z.string().min(1).max(2000),
});

// CP-8: per-tenant/per-channel sender identity — upsert, one row per (tenant, channel).
const SenderIdentitySchema = z.object({
  channel: z.enum(['SMS', 'WHATSAPP', 'EMAIL', 'IN_APP', 'INSTAGRAM']),
  senderName: z.string().min(1).max(200),
  senderAddressOrNumber: z.string().min(1).max(200),
});

// CP-7/CP-5 follow-up: tenant_communication_settings had no route at all until now — approval
// (CP-7) and frequency capping (CP-5) were both "opt-in per tenant" in the domain logic but had
// no way for a tenant to actually opt in short of a direct DB write. All fields optional so a
// caller can flip just one without re-sending the whole settings object.
const CommunicationSettingsSchema = z.object({
  approvalRequired: z.boolean().optional(),
  // Product audit 2026-07-31, Phase 1 Step 10: opt-in gate for the daily invoice
  // payment-reminder ladder (scheduler-service's sales.payment-reminder-ladder job) — off
  // (false) preserves today's behavior exactly, same convention as approvalRequired above.
  paymentReminderEnabled: z.boolean().optional(),
  maxPerDayFrequencyCap: z.number().int().positive().nullable().optional(),
  // CP-9 follow-up (R14): overrides notification-service's default 200/min internal send rate
  // limit for this tenant specifically — null/omitted uses the platform default.
  notificationRateLimitPerMinute: z.number().int().positive().nullable().optional(),
  // CRM-ROADMAP Phase 3, Feature 3 — per-message cost rate per channel, feeding
  // CampaignService.getStats()/getRoiReport()'s spend calculation. Missing channel keys default
  // to 0 spend, so an unconfigured tenant sees no behavior change.
  costPerMessage: z
    .object({
      SMS: z.number().nonnegative().optional(),
      WHATSAPP: z.number().nonnegative().optional(),
      EMAIL: z.number().nonnegative().optional(),
      IN_APP: z.number().nonnegative().optional(),
    })
    .optional(),
});

const CampaignTemplateSchema = z.object({
  name: z.string().min(2).max(200),
  category: z.string().max(50).optional(),
  campaignType: z.string().max(50).optional(),
  channel: z.enum(['SMS', 'WHATSAPP', 'EMAIL', 'IN_APP']),
  messageTemplate: z.string().min(1).max(2000),
});

// CRM-ROADMAP Phase 3, Feature 5 — replaces the entire translation set for one template/campaign
// per call (delete + bulk insert), rather than per-language granular routes — simpler for both
// this API and the template editor's "one save button" UX.
const TranslationsSchema = z.object({
  translations: z
    .array(
      z.object({
        language: z.string().min(2).max(10),
        messageTemplate: z.string().min(1).max(2000),
      })
    )
    .max(20),
});

// CP-5: trigger-based automation rules
const AutomationRuleSchema = z.object({
  triggerType: z.enum(['BIRTHDAY', 'INACTIVITY', 'ANNIVERSARY']),
  enabled: z.boolean().default(true),
  channel: z.enum(['SMS', 'WHATSAPP', 'EMAIL', 'IN_APP']),
  templateId: z.number().int().positive().optional(),
  messageTemplate: z.string().min(1).max(2000).optional(),
  conditions: z.record(z.unknown()).optional(),
});

const SeasonSchema = z.object({
  name: z.string().min(2).max(200),
  seasonType: z.enum([
    'FESTIVAL_SEASON',
    'WEDDING_SEASON',
    'SUMMER_COLLECTION',
    'YEAR_END_SALE',
    'MONSOON_STOCKUP',
    'HARVEST_SEASON',
  ]),
  startDate: z.string().datetime(),
  endDate: z.string().datetime(),
  stockMultiplier: z.number().min(0).default(1),
  loyaltyMultiplier: z.number().min(0).default(1),
  salesTarget: z.number().min(0).default(0),
  isActive: z.boolean().default(true),
});

const SeasonUpdateSchema = SeasonSchema.extend({ version: z.number().int().min(0) });

export async function crmRoutes(
  fastify: FastifyInstance,
  ctxFactory: PlatformContextFactory
): Promise<void> {
  // ════════════════════════════════════════════════════════════════════════
  // M9.3 — Customer Interaction Log
  // ════════════════════════════════════════════════════════════════════════

  fastify.post<{ Params: { id: string } }>(
    '/customers/:id/interactions',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.CRM_INTERACTION_CREATE)] },
    async (request, reply) => {
      const { tenantId, userId } = (request as unknown as AuthedRequest).auth;
      const ctx = ctxFactory.create({
        tenantId,
        userId,
        correlationId: (request.headers['x-correlation-id'] as string) ?? crypto.randomUUID(),
      });
      const customerId = parseInt(request.params.id, 10);

      const body = InteractionSchema.safeParse(request.body);
      if (!body.success)
        throw new ValidationError(body.error.errors.map((e) => e.message).join('; '));

      const [customer] = await ctx.db.raw
        .select({ id: customers.id })
        .from(customers)
        .where(
          and(
            eq(customers.id, customerId),
            eq(customers.tenantId, tenantId),
            isNull(customers.deletedAt)
          )
        );
      if (!customer) throw new NotFoundError('Customer', customerId);

      const [created] = await ctx.db.raw
        .insert(customerInteractions)
        .values({
          tenantId,
          customerId,
          type: body.data.type,
          notes: body.data.notes,
          followUpDate: body.data.followUpDate ? new Date(body.data.followUpDate) : null,
          createdBy: userId,
        })
        .returning();
      if (!created) throw new Error('Interaction creation failed unexpectedly');

      await ctx.cache.invalidate(`crm:activity:${customerId}:*`);
      await ctx.audit.log({
        action: 'CREATE',
        entityType: 'customer_interaction',
        entityId: created.id,
        after: created as unknown as Record<string, unknown>,
      });
      await ctx.events.publish(
        'customer_interaction',
        created.id,
        'CRM_INTERACTION_CREATED',
        created as unknown as Record<string, unknown>
      );

      return reply.code(201).send({ data: created });
    }
  );

  fastify.get<{ Params: { id: string } }>(
    '/customers/:id/interactions',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.CRM_INTERACTION_VIEW)] },
    async (request, reply) => {
      const { tenantId, userId } = (request as unknown as AuthedRequest).auth;
      const ctx = ctxFactory.create({
        tenantId,
        userId,
        correlationId: (request.headers['x-correlation-id'] as string) ?? crypto.randomUUID(),
      });
      const customerId = parseInt(request.params.id, 10);

      const rows = await ctx.db.raw
        .select()
        .from(customerInteractions)
        .where(
          and(
            eq(customerInteractions.customerId, customerId),
            eq(customerInteractions.tenantId, tenantId)
          )
        )
        .orderBy(sql`created_at DESC`);

      return reply.code(200).send({ data: { content: rows, totalElements: rows.length } });
    }
  );

  // PUT /customers/:id/interactions/:interactionId — edit within 24h of creation (ES-18)
  fastify.put<{ Params: { id: string; interactionId: string } }>(
    '/customers/:id/interactions/:interactionId',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.CRM_INTERACTION_CREATE)] },
    async (request, reply) => {
      const { tenantId, userId } = (request as unknown as AuthedRequest).auth;
      const ctx = ctxFactory.create({
        tenantId,
        userId,
        correlationId: (request.headers['x-correlation-id'] as string) ?? crypto.randomUUID(),
      });
      const customerId = parseInt(request.params.id, 10);
      const interactionId = parseInt(request.params.interactionId, 10);

      const body = InteractionSchema.safeParse(request.body);
      if (!body.success)
        throw new ValidationError(body.error.errors.map((e) => e.message).join('; '));

      const [existing] = await ctx.db.raw
        .select()
        .from(customerInteractions)
        .where(
          and(
            eq(customerInteractions.id, interactionId),
            eq(customerInteractions.customerId, customerId),
            eq(customerInteractions.tenantId, tenantId)
          )
        );
      if (!existing) throw new NotFoundError('Interaction', interactionId);

      const ageMs = Date.now() - existing.createdAt.getTime();
      if (ageMs > 24 * 60 * 60 * 1000) {
        throw new BusinessError(
          'INTERACTION_EDIT_WINDOW_EXPIRED',
          'Interactions can only be edited within 24 hours of creation'
        );
      }

      const [updated] = await ctx.db.raw
        .update(customerInteractions)
        .set({
          type: body.data.type,
          notes: body.data.notes,
          followUpDate: body.data.followUpDate ? new Date(body.data.followUpDate) : null,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(customerInteractions.id, interactionId),
            eq(customerInteractions.tenantId, tenantId)
          )
        )
        .returning();
      if (!updated) throw new Error('Interaction update failed unexpectedly');

      await ctx.cache.invalidate(`crm:activity:${customerId}:*`);
      await ctx.audit.log({
        action: 'UPDATE',
        entityType: 'customer_interaction',
        entityId: interactionId,
        before: existing as unknown as Record<string, unknown>,
        after: updated as unknown as Record<string, unknown>,
      });

      return reply.code(200).send({ data: updated });
    }
  );

  // GET /crm/follow-ups — today's follow-up tasks for the logged-in user
  fastify.get(
    '/crm/follow-ups',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.CRM_INTERACTION_VIEW)] },
    async (request, reply) => {
      const { tenantId, userId } = (request as unknown as AuthedRequest).auth;
      const ctx = ctxFactory.create({
        tenantId,
        userId,
        correlationId: (request.headers['x-correlation-id'] as string) ?? crypto.randomUUID(),
      });

      const startOfDay = new Date();
      startOfDay.setHours(0, 0, 0, 0);
      const endOfDay = new Date();
      endOfDay.setHours(23, 59, 59, 999);

      const rows = await ctx.db.raw
        .select({
          id: customerInteractions.id,
          customerId: customerInteractions.customerId,
          customerName: customers.displayName,
          type: customerInteractions.type,
          notes: customerInteractions.notes,
          followUpDate: customerInteractions.followUpDate,
          createdBy: customerInteractions.createdBy,
        })
        .from(customerInteractions)
        .innerJoin(customers, eq(customers.id, customerInteractions.customerId))
        .where(
          and(
            eq(customerInteractions.tenantId, tenantId),
            eq(customerInteractions.followUpDone, false),
            gte(customerInteractions.followUpDate, startOfDay),
            lte(customerInteractions.followUpDate, endOfDay)
          )
        );

      return reply.code(200).send({ data: { content: rows, totalElements: rows.length } });
    }
  );

  // ════════════════════════════════════════════════════════════════════════
  // M9.2 — Customer Health Scoring
  // ════════════════════════════════════════════════════════════════════════

  fastify.get(
    '/crm/segments/health',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.CRM_VIEW)] },
    async (request, reply) => {
      const { tenantId, userId } = (request as unknown as AuthedRequest).auth;
      const ctx = ctxFactory.create({
        tenantId,
        userId,
        correlationId: (request.headers['x-correlation-id'] as string) ?? crypto.randomUUID(),
      });
      const counts = await HealthScoringService.segmentCounts(ctx.db.raw, tenantId);
      return reply.code(200).send({ data: counts });
    }
  );

  // ════════════════════════════════════════════════════════════════════════
  // M9.4 — Customer Segmentation
  // ════════════════════════════════════════════════════════════════════════

  fastify.get(
    '/crm/segments',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.CRM_SEGMENT_VIEW)] },
    async (request, reply) => {
      const { tenantId, userId } = (request as unknown as AuthedRequest).auth;
      const ctx = ctxFactory.create({
        tenantId,
        userId,
        correlationId: (request.headers['x-correlation-id'] as string) ?? crypto.randomUUID(),
      });

      const saved = await ctx.db.raw
        .select()
        .from(customerSegments)
        .where(eq(customerSegments.tenantId, tenantId));
      const prebuilt = PREBUILT_SEGMENTS.map((code) => ({
        id: null,
        code,
        name: code.replace(/-/g, ' '),
        isSystem: true,
      }));

      return reply.code(200).send({
        data: { content: [...prebuilt, ...saved], totalElements: prebuilt.length + saved.length },
      });
    }
  );

  fastify.post(
    '/crm/segments',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.CRM_SEGMENT_CREATE)] },
    async (request, reply) => {
      const { tenantId, userId } = (request as unknown as AuthedRequest).auth;
      const ctx = ctxFactory.create({
        tenantId,
        userId,
        correlationId: (request.headers['x-correlation-id'] as string) ?? crypto.randomUUID(),
      });

      const body = SegmentCreateSchema.safeParse(request.body);
      if (!body.success)
        throw new ValidationError(body.error.errors.map((e) => e.message).join('; '));

      const code = body.data.name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/(^-|-$)/g, '');
      const filterDefinition: SegmentFilterDefinition = {
        rules: body.data.rules as SegmentFilterRule[],
        logic: body.data.logic,
      };

      const [created] = await ctx.db.raw
        .insert(customerSegments)
        .values({
          tenantId,
          name: body.data.name,
          code,
          isSystem: false,
          filterDefinition,
          description: body.data.description,
          createdBy: userId,
        })
        .returning();
      if (!created) throw new Error('Segment creation failed unexpectedly');

      // CRM-ROADMAP Phase 2, Feature 7 — a behavioral-operator segment would otherwise sit
      // empty in crm_segment_membership_cache until the next nightly refresh; seed it once now
      // so a consumer reading the cache immediately after creation doesn't see a false zero.
      if (SegmentService.needsMembershipCache(filterDefinition)) {
        const where = SegmentService.customWhere(tenantId, filterDefinition);
        await SegmentService.refreshMembershipCache(ctx.db.raw, tenantId, created.id, where);
      }

      await ctx.audit.log({
        action: 'CREATE',
        entityType: 'customer_segment',
        entityId: created.id,
        after: created as unknown as Record<string, unknown>,
      });
      await ctx.events.publish(
        'customer_segment',
        created.id,
        'CRM_SEGMENT_CREATED',
        created as unknown as Record<string, unknown>
      );

      return reply.code(201).send({ data: created });
    }
  );

  fastify.post(
    '/crm/segments/preview',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.CRM_SEGMENT_VIEW)] },
    async (request, reply) => {
      const { tenantId, userId } = (request as unknown as AuthedRequest).auth;
      const ctx = ctxFactory.create({
        tenantId,
        userId,
        correlationId: (request.headers['x-correlation-id'] as string) ?? crypto.randomUUID(),
      });

      const body = SegmentPreviewSchema.safeParse(request.body);
      if (!body.success)
        throw new ValidationError(body.error.errors.map((e) => e.message).join('; '));

      const where = body.data.segmentCode
        ? await SegmentService.resolveWhere(
            ctx.db.raw,
            tenantId,
            await loadSegment(ctx.db.raw, tenantId, body.data.segmentCode)
          )
        : SegmentService.customWhere(tenantId, {
            rules: body.data.rules as SegmentFilterRule[],
            logic: body.data.logic,
          });
      const count = await SegmentService.countMatching(ctx.db.raw, where);

      return reply.code(200).send({ data: { matchingCount: count } });
    }
  );

  // Standalone campaign-recipient preview — used by the "Preview Recipients" button
  // before a campaign is created. Reuses the same CampaignService.previewSample logic
  // that runs during actual campaign creation (see POST /crm/campaigns below).
  fastify.post(
    '/crm/campaigns/preview',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.CRM_CAMPAIGN_CREATE)] },
    async (request, reply) => {
      const { tenantId, userId } = (request as unknown as AuthedRequest).auth;
      const ctx = ctxFactory.create({
        tenantId,
        userId,
        correlationId: (request.headers['x-correlation-id'] as string) ?? crypto.randomUUID(),
      });

      const body = CampaignPreviewSchema.safeParse(request.body);
      if (!body.success)
        throw new ValidationError(body.error.errors.map((e) => e.message).join('; '));
      if (!body.data.segmentId && (!body.data.customerIds || body.data.customerIds.length === 0)) {
        throw new ValidationError(
          'Preview requires either segmentId or a non-empty customerIds list'
        );
      }

      const preview = await CampaignService.previewSample(
        ctx,
        body.data.segmentId,
        body.data.customerIds,
        body.data.messageTemplate,
        body.data.channel
      );
      return reply.code(200).send({ data: preview });
    }
  );

  async function loadSegment(ctxDbRaw: ErpDatabase, tenantId: number, idOrCode: string) {
    if (PREBUILT_SEGMENTS.includes(idOrCode as (typeof PREBUILT_SEGMENTS)[number])) {
      return {
        code: idOrCode,
        isSystem: true,
        filterDefinition: null as SegmentFilterDefinition | null,
      };
    }
    const segId = parseInt(idOrCode, 10);
    if (Number.isNaN(segId)) throw new NotFoundError('Segment', idOrCode);
    const [segment] = await ctxDbRaw
      .select()
      .from(customerSegments)
      .where(and(eq(customerSegments.id, segId), eq(customerSegments.tenantId, tenantId)));
    if (!segment) throw new NotFoundError('Segment', idOrCode);
    return {
      code: segment.code,
      isSystem: segment.isSystem,
      filterDefinition: segment.filterDefinition as SegmentFilterDefinition | null,
    };
  }

  fastify.get<{ Params: { id: string } }>(
    '/crm/segments/:id/customers',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.CRM_SEGMENT_VIEW)] },
    async (request, reply) => {
      const { tenantId, userId } = (request as unknown as AuthedRequest).auth;
      const ctx = ctxFactory.create({
        tenantId,
        userId,
        correlationId: (request.headers['x-correlation-id'] as string) ?? crypto.randomUUID(),
      });
      const query = request.query as { page?: string; size?: string };
      const page = Math.max(0, parseInt(query.page ?? '0', 10));
      const size = Math.min(100, parseInt(query.size ?? '20', 10));

      const segment = await loadSegment(ctx.db.raw, tenantId, request.params.id);
      const where = await SegmentService.resolveWhere(ctx.db.raw, tenantId, segment);
      const { rows, total } = await SegmentService.listMatching(ctx.db.raw, where, page, size);

      return reply.code(200).send({ data: { content: rows, totalElements: total, page, size } });
    }
  );

  fastify.get<{ Params: { id: string } }>(
    '/crm/segments/:id/export',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.CRM_SEGMENT_VIEW)] },
    async (request, reply) => {
      const { tenantId, userId } = (request as unknown as AuthedRequest).auth;
      const ctx = ctxFactory.create({
        tenantId,
        userId,
        correlationId: (request.headers['x-correlation-id'] as string) ?? crypto.randomUUID(),
      });

      const segment = await loadSegment(ctx.db.raw, tenantId, request.params.id);
      const where = await SegmentService.resolveWhere(ctx.db.raw, tenantId, segment);
      const { rows } = await SegmentService.listMatching(ctx.db.raw, where, 0, 10_000);

      const header = ['Customer Code', 'Name', 'Phone', 'Email', 'Loyalty Points', 'Status'];
      const csvRows = rows.map((c) => [
        c.customerCode ?? '',
        c.displayName,
        c.phone,
        c.email ?? '',
        String(c.loyaltyPoints),
        c.status,
      ]);
      // Prefix a leading quote on cells starting with =, +, -, @ (or tab/CR) so Excel/Sheets
      // never interprets a free-text field (e.g. customer display name) as a formula when this
      // CSV is opened — CWE-1236 CSV/formula injection.
      const sanitizeCsvCell = (v: unknown): string => {
        const s = String(v);
        return /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
      };
      const csv = [header, ...csvRows]
        .map((r) => r.map((v) => `"${sanitizeCsvCell(v).replace(/"/g, '""')}"`).join(','))
        .join('\r\n');

      reply.header('Content-Type', 'text/csv; charset=utf-8');
      reply.header(
        'Content-Disposition',
        `attachment; filename="segment-${request.params.id}-export.csv"`
      );
      return reply.code(200).send(csv);
    }
  );

  // ════════════════════════════════════════════════════════════════════════
  // M9.5 — Campaign Management
  // ════════════════════════════════════════════════════════════════════════

  fastify.post(
    '/crm/campaigns',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.CRM_CAMPAIGN_CREATE)] },
    async (request, reply) => {
      const auth = (request as unknown as AuthedRequest).auth;
      const { tenantId, userId } = auth;
      const ctx = ctxFactory.create({
        tenantId,
        userId,
        correlationId: (request.headers['x-correlation-id'] as string) ?? crypto.randomUUID(),
      });

      const body = CampaignCreateSchema.safeParse(request.body);
      if (!body.success)
        throw new ValidationError(body.error.errors.map((e) => e.message).join('; '));
      if (!body.data.segmentId && (!body.data.customerIds || body.data.customerIds.length === 0)) {
        throw new ValidationError(
          'Campaign requires either segmentId or a non-empty customerIds list'
        );
      }
      if (body.data.branchId !== undefined && !branchInScope(auth, body.data.branchId)) {
        throw new BusinessError(
          'BRANCH_OUT_OF_SCOPE',
          'branchId is outside your assigned branches'
        );
      }

      const warnings = checkChannelLimits(body.data.channel, body.data.messageTemplate);

      // CRM-ROADMAP Phase 1, Feature 6 — blocked at creation time, before any row is
      // inserted, with a clear specific error (not a generic failure). A synthetic render
      // stands in for a real recipient here — no recipient needs to be resolved just to
      // validate the template shape, and this must reject an empty-segment campaign's SMS
      // content just as readily as one with real recipients.
      if (body.data.channel === 'SMS') {
        const syntheticMessage = renderCampaignMessage(body.data.messageTemplate, {
          customerName: 'Customer',
          balance: 0,
          loyaltyPoints: 0,
          shopName: 'Our Store',
        });
        const dltResult = await checkDltCompliance(ctx, 'SMS', syntheticMessage);
        if (!dltResult.compliant) {
          throw new BusinessError(
            'DLT_TEMPLATE_MISMATCH',
            dltResult.reason ?? 'DLT template mismatch'
          );
        }
      }

      const [created] = await ctx.db.raw
        .insert(campaigns)
        .values({
          tenantId,
          name: body.data.name,
          segmentId: body.data.segmentId,
          customerIds: body.data.customerIds,
          channel: body.data.channel,
          messageTemplate: body.data.messageTemplate,
          campaignType: body.data.campaignType,
          templateId: body.data.templateId,
          branchId: body.data.branchId,
          linkUrl: body.data.linkUrl,
          createdBy: userId,
        })
        .returning();
      if (!created) throw new Error('Campaign creation failed unexpectedly');

      if (body.data.variants && body.data.variants.length > 0) {
        await ctx.db.raw.insert(crmCampaignVariants).values(
          body.data.variants.map((v) => ({
            tenantId,
            campaignId: created.id,
            label: v.label,
            messageTemplate: v.messageTemplate,
            weight: v.weight,
          }))
        );
      }

      // CRM-ROADMAP Phase 3, Feature 5 — snapshot the source template's language variants onto
      // this campaign, same "copy at creation time, not a live link" convention
      // campaigns.messageTemplate itself already uses for the base template.
      if (body.data.templateId) {
        const templateTranslations = await ctx.db.raw
          .select()
          .from(crmCampaignTemplateTranslations)
          .where(
            and(
              eq(crmCampaignTemplateTranslations.templateId, body.data.templateId),
              eq(crmCampaignTemplateTranslations.tenantId, tenantId)
            )
          );
        if (templateTranslations.length > 0) {
          await ctx.db.raw.insert(crmCampaignMessageTranslations).values(
            templateTranslations.map((t) => ({
              tenantId,
              campaignId: created.id,
              language: t.language,
              messageTemplate: t.messageTemplate,
            }))
          );
        }
      }

      const preview = await CampaignService.previewSample(
        ctx,
        body.data.segmentId,
        body.data.customerIds,
        body.data.messageTemplate,
        body.data.channel,
        body.data.branchId
      );
      await ctx.audit.log({
        action: 'CREATE',
        entityType: 'campaign',
        entityId: created.id,
        after: created as unknown as Record<string, unknown>,
      });
      await ctx.events.publish(
        'campaign',
        created.id,
        'CRM_CAMPAIGN_CREATED',
        created as unknown as Record<string, unknown>
      );

      return reply
        .code(201)
        .send({ data: created, preview, warnings: [...warnings, ...preview.warnings] });
    }
  );

  fastify.get(
    '/crm/campaigns',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.CRM_VIEW)] },
    async (request, reply) => {
      const auth = (request as unknown as AuthedRequest).auth;
      const { tenantId, userId } = auth;
      const ctx = ctxFactory.create({
        tenantId,
        userId,
        correlationId: (request.headers['x-correlation-id'] as string) ?? crypto.randomUUID(),
      });
      const query = request.query as { status?: string };

      const conditions = [eq(campaigns.tenantId, tenantId)];
      if (query.status) {
        conditions.push(
          eq(
            campaigns.status,
            query.status as 'DRAFT' | 'SCHEDULED' | 'SENDING' | 'SENT' | 'CANCELLED' | 'FAILED'
          )
        );
      }
      // CP-8: a branch-scoped caller sees tenant-wide campaigns (branchId IS NULL) plus any
      // scoped to one of their own branches — mirrors invoices.routes.ts's getBranchScope use.
      const branchScope = getBranchScope(auth);
      if (branchScope !== 'all') {
        conditions.push(or(isNull(campaigns.branchId), inArray(campaigns.branchId, branchScope))!);
      }

      const rows = await ctx.db.raw
        .select()
        .from(campaigns)
        .where(and(...conditions))
        .orderBy(sql`created_at DESC`);
      return reply.code(200).send({ data: { content: rows, totalElements: rows.length } });
    }
  );

  fastify.get<{ Params: { id: string } }>(
    '/crm/campaigns/:id',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.CRM_VIEW)] },
    async (request, reply) => {
      const auth = (request as unknown as AuthedRequest).auth;
      const { tenantId, userId } = auth;
      const ctx = ctxFactory.create({
        tenantId,
        userId,
        correlationId: (request.headers['x-correlation-id'] as string) ?? crypto.randomUUID(),
      });
      const id = parseInt(request.params.id, 10);

      const [campaign] = await ctx.db.raw
        .select()
        .from(campaigns)
        .where(and(eq(campaigns.id, id), eq(campaigns.tenantId, tenantId)));
      if (!campaign) throw new NotFoundError('Campaign', id);
      if (campaign.branchId && !branchInScope(auth, campaign.branchId)) {
        throw new NotFoundError('Campaign', id);
      }

      return reply.code(200).send({ data: campaign });
    }
  );

  // CRM-ROADMAP Phase 3, Feature 5 — per-language variants for this specific campaign (either
  // snapshotted from a source template at creation, or authored directly here). A campaign with
  // zero rows sends its plain messageTemplate to every recipient, unchanged from today.
  fastify.get<{ Params: { id: string } }>(
    '/crm/campaigns/:id/translations',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.CRM_VIEW)] },
    async (request, reply) => {
      const { tenantId, userId } = (request as unknown as AuthedRequest).auth;
      const ctx = ctxFactory.create({
        tenantId,
        userId,
        correlationId: (request.headers['x-correlation-id'] as string) ?? crypto.randomUUID(),
      });
      const id = parseInt(request.params.id, 10);

      const [campaign] = await ctx.db.raw
        .select({ id: campaigns.id })
        .from(campaigns)
        .where(and(eq(campaigns.id, id), eq(campaigns.tenantId, tenantId)));
      if (!campaign) throw new NotFoundError('Campaign', id);

      const rows = await ctx.db.raw
        .select()
        .from(crmCampaignMessageTranslations)
        .where(
          and(
            eq(crmCampaignMessageTranslations.campaignId, id),
            eq(crmCampaignMessageTranslations.tenantId, tenantId)
          )
        )
        .orderBy(sql`language ASC`);
      return reply.code(200).send({ data: { content: rows, totalElements: rows.length } });
    }
  );

  // Replaces the entire translation set for this campaign in one call. Blocked once the campaign
  // has left DRAFT/SCHEDULED — same "can't rewrite content mid/post-send" reasoning as variants
  // already being create-only, applied here since this route allows edits after creation too.
  fastify.put<{ Params: { id: string } }>(
    '/crm/campaigns/:id/translations',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.CRM_CAMPAIGN_CREATE)] },
    async (request, reply) => {
      const { tenantId, userId } = (request as unknown as AuthedRequest).auth;
      const ctx = ctxFactory.create({
        tenantId,
        userId,
        correlationId: (request.headers['x-correlation-id'] as string) ?? crypto.randomUUID(),
      });
      const id = parseInt(request.params.id, 10);

      const body = TranslationsSchema.safeParse(request.body);
      if (!body.success)
        throw new ValidationError(body.error.errors.map((e) => e.message).join('; '));

      const [campaign] = await ctx.db.raw
        .select({ id: campaigns.id, status: campaigns.status })
        .from(campaigns)
        .where(and(eq(campaigns.id, id), eq(campaigns.tenantId, tenantId)));
      if (!campaign) throw new NotFoundError('Campaign', id);
      if (!['DRAFT', 'SCHEDULED'].includes(campaign.status)) {
        throw new BusinessError(
          'INVALID_CAMPAIGN_STATE',
          `Cannot edit translations on a campaign in status ${campaign.status}`
        );
      }

      const languages = body.data.translations.map((t) => t.language);
      if (new Set(languages).size !== languages.length) {
        throw new ValidationError('Each language may appear at most once');
      }

      let rows: (typeof crmCampaignMessageTranslations.$inferSelect)[] = [];
      await ctx.db.transaction(async (trx) => {
        await trx.raw
          .delete(crmCampaignMessageTranslations)
          .where(
            and(
              eq(crmCampaignMessageTranslations.campaignId, id),
              eq(crmCampaignMessageTranslations.tenantId, tenantId)
            )
          );
        if (body.data.translations.length > 0) {
          rows = await trx.raw
            .insert(crmCampaignMessageTranslations)
            .values(
              body.data.translations.map((t) => ({
                tenantId,
                campaignId: id,
                language: t.language,
                messageTemplate: t.messageTemplate,
              }))
            )
            .returning();
        }
      });

      await ctx.audit.log({
        action: 'UPDATE',
        entityType: 'campaign_message_translations',
        entityId: id,
        after: { languages } as unknown as Record<string, unknown>,
      });
      return reply.code(200).send({ data: { content: rows, totalElements: rows.length } });
    }
  );

  // CP-4: edit a DRAFT/SCHEDULED campaign, optimistic-locked via `version`. Editing a SCHEDULED
  // campaign resets it to DRAFT (CampaignService.update handles this) — the client must
  // re-confirm scheduling via a fresh POST .../schedule call.
  fastify.put<{ Params: { id: string } }>(
    '/crm/campaigns/:id',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.CRM_CAMPAIGN_CREATE)] },
    async (request, reply) => {
      const auth = (request as unknown as AuthedRequest).auth;
      const { tenantId, userId } = auth;
      const ctx = ctxFactory.create({
        tenantId,
        userId,
        correlationId: (request.headers['x-correlation-id'] as string) ?? crypto.randomUUID(),
      });
      const id = parseInt(request.params.id, 10);

      const body = CampaignUpdateSchema.safeParse(request.body);
      if (!body.success)
        throw new ValidationError(body.error.errors.map((e) => e.message).join('; '));
      const {
        version,
        name,
        branchId,
        segmentId,
        customerIds,
        channel,
        messageTemplate,
        campaignType,
        templateId,
        linkUrl,
      } = body.data;
      if (branchId !== undefined && branchId !== null && !branchInScope(auth, branchId)) {
        throw new BusinessError(
          'BRANCH_OUT_OF_SCOPE',
          'branchId is outside your assigned branches'
        );
      }
      const patch = {
        ...(name !== undefined ? { name } : {}),
        ...(branchId !== undefined ? { branchId } : {}),
        ...(segmentId !== undefined ? { segmentId } : {}),
        ...(customerIds !== undefined ? { customerIds } : {}),
        ...(channel !== undefined ? { channel } : {}),
        ...(messageTemplate !== undefined ? { messageTemplate } : {}),
        ...(campaignType !== undefined ? { campaignType } : {}),
        ...(templateId !== undefined ? { templateId } : {}),
        ...(linkUrl !== undefined ? { linkUrl } : {}),
      };
      if (Object.keys(patch).length === 0)
        throw new ValidationError('At least one field besides version must be provided');

      const updated = await CampaignService.update(ctx, id, version, patch);
      return reply.code(200).send({ data: updated });
    }
  );

  fastify.get<{ Params: { id: string } }>(
    '/crm/campaigns/:id/history',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.CRM_VIEW)] },
    async (request, reply) => {
      const { tenantId, userId } = (request as unknown as AuthedRequest).auth;
      const ctx = ctxFactory.create({
        tenantId,
        userId,
        correlationId: (request.headers['x-correlation-id'] as string) ?? crypto.randomUUID(),
      });
      const id = parseInt(request.params.id, 10);

      const [campaign] = await ctx.db.raw
        .select({ id: campaigns.id })
        .from(campaigns)
        .where(and(eq(campaigns.id, id), eq(campaigns.tenantId, tenantId)));
      if (!campaign) throw new NotFoundError('Campaign', id);

      const history = await CampaignService.listHistory(ctx, id);
      return reply.code(200).send({ data: history });
    }
  );

  // ════════════════════════════════════════════════════════════════════════
  // CP-7 — Campaign Approval Workflow
  // ════════════════════════════════════════════════════════════════════════
  // Submitting is gated the same as editing a DRAFT (CRM_CAMPAIGN_CREATE); approve/reject require
  // the separate CRM_CAMPAIGN_APPROVE permission so a tenant can designate specific
  // approvers distinct from whoever is allowed to author campaigns.

  fastify.post<{ Params: { id: string } }>(
    '/crm/campaigns/:id/submit-for-approval',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.CRM_CAMPAIGN_CREATE)] },
    async (request, reply) => {
      const { tenantId, userId } = (request as unknown as AuthedRequest).auth;
      const ctx = ctxFactory.create({
        tenantId,
        userId,
        correlationId: (request.headers['x-correlation-id'] as string) ?? crypto.randomUUID(),
      });
      const id = parseInt(request.params.id, 10);

      const updated = await CampaignService.submitForApproval(ctx, id);
      return reply.code(200).send({ data: updated });
    }
  );

  fastify.post<{ Params: { id: string } }>(
    '/crm/campaigns/:id/approve',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.CRM_CAMPAIGN_APPROVE)] },
    async (request, reply) => {
      const { tenantId, userId } = (request as unknown as AuthedRequest).auth;
      const ctx = ctxFactory.create({
        tenantId,
        userId,
        correlationId: (request.headers['x-correlation-id'] as string) ?? crypto.randomUUID(),
      });
      const id = parseInt(request.params.id, 10);

      const updated = await CampaignService.approve(ctx, id);
      return reply.code(200).send({ data: updated });
    }
  );

  fastify.post<{ Params: { id: string } }>(
    '/crm/campaigns/:id/reject',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.CRM_CAMPAIGN_APPROVE)] },
    async (request, reply) => {
      const { tenantId, userId } = (request as unknown as AuthedRequest).auth;
      const ctx = ctxFactory.create({
        tenantId,
        userId,
        correlationId: (request.headers['x-correlation-id'] as string) ?? crypto.randomUUID(),
      });
      const id = parseInt(request.params.id, 10);

      const body = CampaignRejectSchema.safeParse(request.body);
      if (!body.success)
        throw new ValidationError(body.error.errors.map((e) => e.message).join('; '));

      const updated = await CampaignService.reject(ctx, id, body.data.reason);
      return reply.code(200).send({ data: updated });
    }
  );

  // ════════════════════════════════════════════════════════════════════════
  // CP-7 — Campaign Comments (internal notes, never sent to recipients)
  // ════════════════════════════════════════════════════════════════════════

  fastify.get<{ Params: { id: string } }>(
    '/crm/campaigns/:id/comments',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.CRM_VIEW)] },
    async (request, reply) => {
      const { tenantId, userId } = (request as unknown as AuthedRequest).auth;
      const ctx = ctxFactory.create({
        tenantId,
        userId,
        correlationId: (request.headers['x-correlation-id'] as string) ?? crypto.randomUUID(),
      });
      const id = parseInt(request.params.id, 10);

      const [campaign] = await ctx.db.raw
        .select({ id: campaigns.id })
        .from(campaigns)
        .where(and(eq(campaigns.id, id), eq(campaigns.tenantId, tenantId)));
      if (!campaign) throw new NotFoundError('Campaign', id);

      const rows = await ctx.db.raw
        .select()
        .from(campaignComments)
        .where(and(eq(campaignComments.campaignId, id), eq(campaignComments.tenantId, tenantId)))
        .orderBy(sql`created_at ASC`);
      return reply.code(200).send({ data: { content: rows, totalElements: rows.length } });
    }
  );

  fastify.post<{ Params: { id: string } }>(
    '/crm/campaigns/:id/comments',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.CRM_CAMPAIGN_CREATE)] },
    async (request, reply) => {
      const { tenantId, userId } = (request as unknown as AuthedRequest).auth;
      const ctx = ctxFactory.create({
        tenantId,
        userId,
        correlationId: (request.headers['x-correlation-id'] as string) ?? crypto.randomUUID(),
      });
      const id = parseInt(request.params.id, 10);

      const body = CampaignCommentSchema.safeParse(request.body);
      if (!body.success)
        throw new ValidationError(body.error.errors.map((e) => e.message).join('; '));

      const [campaign] = await ctx.db.raw
        .select({ id: campaigns.id })
        .from(campaigns)
        .where(and(eq(campaigns.id, id), eq(campaigns.tenantId, tenantId)));
      if (!campaign) throw new NotFoundError('Campaign', id);

      const [created] = await ctx.db.raw
        .insert(campaignComments)
        .values({ tenantId, campaignId: id, authorId: userId, body: body.data.body })
        .returning();
      if (!created) throw new Error('Campaign comment creation failed unexpectedly');

      await ctx.audit.log({
        action: 'CREATE',
        entityType: 'campaign_comment',
        entityId: created.id,
      });

      return reply.code(201).send({ data: created });
    }
  );

  // ════════════════════════════════════════════════════════════════════════
  // CP-4 — Campaign Templates
  // ════════════════════════════════════════════════════════════════════════

  fastify.post(
    '/crm/campaign-templates',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.CRM_CAMPAIGN_CREATE)] },
    async (request, reply) => {
      const { tenantId, userId } = (request as unknown as AuthedRequest).auth;
      const ctx = ctxFactory.create({
        tenantId,
        userId,
        correlationId: (request.headers['x-correlation-id'] as string) ?? crypto.randomUUID(),
      });

      const body = CampaignTemplateSchema.safeParse(request.body);
      if (!body.success)
        throw new ValidationError(body.error.errors.map((e) => e.message).join('; '));

      const [created] = await ctx.db.raw
        .insert(campaignTemplates)
        .values({
          tenantId,
          name: body.data.name,
          category: body.data.category,
          campaignType: body.data.campaignType,
          channel: body.data.channel,
          messageTemplate: body.data.messageTemplate,
          createdBy: userId,
        })
        .returning();
      if (!created) throw new Error('Campaign template creation failed unexpectedly');

      await ctx.audit.log({
        action: 'CREATE',
        entityType: 'campaign_template',
        entityId: created.id,
        after: created as unknown as Record<string, unknown>,
      });
      return reply.code(201).send({ data: created });
    }
  );

  fastify.get(
    '/crm/campaign-templates',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.CRM_VIEW)] },
    async (request, reply) => {
      const { tenantId, userId } = (request as unknown as AuthedRequest).auth;
      const ctx = ctxFactory.create({
        tenantId,
        userId,
        correlationId: (request.headers['x-correlation-id'] as string) ?? crypto.randomUUID(),
      });
      const query = request.query as { channel?: string };

      let where = eq(campaignTemplates.tenantId, tenantId);
      if (query.channel) {
        where = and(
          where,
          eq(campaignTemplates.channel, query.channel as 'SMS' | 'WHATSAPP' | 'EMAIL' | 'IN_APP')
        )!;
      }

      const rows = await ctx.db.raw
        .select()
        .from(campaignTemplates)
        .where(where)
        .orderBy(sql`name ASC`);
      return reply.code(200).send({ data: { content: rows, totalElements: rows.length } });
    }
  );

  fastify.get<{ Params: { id: string } }>(
    '/crm/campaign-templates/:id',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.CRM_VIEW)] },
    async (request, reply) => {
      const { tenantId, userId } = (request as unknown as AuthedRequest).auth;
      const ctx = ctxFactory.create({
        tenantId,
        userId,
        correlationId: (request.headers['x-correlation-id'] as string) ?? crypto.randomUUID(),
      });
      const id = parseInt(request.params.id, 10);

      const [template] = await ctx.db.raw
        .select()
        .from(campaignTemplates)
        .where(and(eq(campaignTemplates.id, id), eq(campaignTemplates.tenantId, tenantId)));
      if (!template) throw new NotFoundError('Campaign template', id);

      return reply.code(200).send({ data: template });
    }
  );

  // CRM-ROADMAP Phase 3, Feature 5 — per-language variants of a saved template. A template with
  // zero rows here is unaffected (send() uses its plain messageTemplate for every recipient).
  fastify.get<{ Params: { id: string } }>(
    '/crm/campaign-templates/:id/translations',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.CRM_VIEW)] },
    async (request, reply) => {
      const { tenantId, userId } = (request as unknown as AuthedRequest).auth;
      const ctx = ctxFactory.create({
        tenantId,
        userId,
        correlationId: (request.headers['x-correlation-id'] as string) ?? crypto.randomUUID(),
      });
      const id = parseInt(request.params.id, 10);

      const [template] = await ctx.db.raw
        .select({ id: campaignTemplates.id })
        .from(campaignTemplates)
        .where(and(eq(campaignTemplates.id, id), eq(campaignTemplates.tenantId, tenantId)));
      if (!template) throw new NotFoundError('Campaign template', id);

      const rows = await ctx.db.raw
        .select()
        .from(crmCampaignTemplateTranslations)
        .where(
          and(
            eq(crmCampaignTemplateTranslations.templateId, id),
            eq(crmCampaignTemplateTranslations.tenantId, tenantId)
          )
        )
        .orderBy(sql`language ASC`);
      return reply.code(200).send({ data: { content: rows, totalElements: rows.length } });
    }
  );

  // Replaces the entire translation set for this template in one call (delete + bulk insert).
  fastify.put<{ Params: { id: string } }>(
    '/crm/campaign-templates/:id/translations',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.CRM_CAMPAIGN_CREATE)] },
    async (request, reply) => {
      const { tenantId, userId } = (request as unknown as AuthedRequest).auth;
      const ctx = ctxFactory.create({
        tenantId,
        userId,
        correlationId: (request.headers['x-correlation-id'] as string) ?? crypto.randomUUID(),
      });
      const id = parseInt(request.params.id, 10);

      const body = TranslationsSchema.safeParse(request.body);
      if (!body.success)
        throw new ValidationError(body.error.errors.map((e) => e.message).join('; '));

      const [template] = await ctx.db.raw
        .select({ id: campaignTemplates.id })
        .from(campaignTemplates)
        .where(and(eq(campaignTemplates.id, id), eq(campaignTemplates.tenantId, tenantId)));
      if (!template) throw new NotFoundError('Campaign template', id);

      const languages = body.data.translations.map((t) => t.language);
      if (new Set(languages).size !== languages.length) {
        throw new ValidationError('Each language may appear at most once');
      }

      let rows: (typeof crmCampaignTemplateTranslations.$inferSelect)[] = [];
      await ctx.db.transaction(async (trx) => {
        await trx.raw
          .delete(crmCampaignTemplateTranslations)
          .where(
            and(
              eq(crmCampaignTemplateTranslations.templateId, id),
              eq(crmCampaignTemplateTranslations.tenantId, tenantId)
            )
          );
        if (body.data.translations.length > 0) {
          rows = await trx.raw
            .insert(crmCampaignTemplateTranslations)
            .values(
              body.data.translations.map((t) => ({
                tenantId,
                templateId: id,
                language: t.language,
                messageTemplate: t.messageTemplate,
              }))
            )
            .returning();
        }
      });

      await ctx.audit.log({
        action: 'UPDATE',
        entityType: 'campaign_template_translations',
        entityId: id,
        after: { languages } as unknown as Record<string, unknown>,
      });
      return reply.code(200).send({ data: { content: rows, totalElements: rows.length } });
    }
  );

  // ════════════════════════════════════════════════════════════════════════
  // CP-5 — Campaign Automation Rules
  // ════════════════════════════════════════════════════════════════════════

  fastify.post(
    '/crm/automation-rules',
    // CP-7: previously reused CRM_CAMPAIGN_CREATE — now its own permission since managing
    // always-on trigger rules is a distinct responsibility from authoring one-off campaigns.
    { preHandler: [authenticate, requirePermission(PERMISSIONS.CRM_AUTOMATION_MANAGE)] },
    async (request, reply) => {
      const { tenantId, userId } = (request as unknown as AuthedRequest).auth;
      const ctx = ctxFactory.create({
        tenantId,
        userId,
        correlationId: (request.headers['x-correlation-id'] as string) ?? crypto.randomUUID(),
      });

      const body = AutomationRuleSchema.safeParse(request.body);
      if (!body.success)
        throw new ValidationError(body.error.errors.map((e) => e.message).join('; '));

      const [created] = await ctx.db.raw
        .insert(campaignAutomationRules)
        .values({
          tenantId,
          triggerType: body.data.triggerType,
          enabled: body.data.enabled,
          channel: body.data.channel,
          templateId: body.data.templateId,
          messageTemplate: body.data.messageTemplate,
          conditions: body.data.conditions,
          createdBy: userId,
        })
        .returning();
      if (!created) throw new Error('Automation rule creation failed unexpectedly');

      await ctx.audit.log({
        action: 'CREATE',
        entityType: 'campaign_automation_rule',
        entityId: created.id,
        after: created as unknown as Record<string, unknown>,
      });
      return reply.code(201).send({ data: created });
    }
  );

  fastify.get(
    '/crm/automation-rules',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.CRM_VIEW)] },
    async (request, reply) => {
      const { tenantId, userId } = (request as unknown as AuthedRequest).auth;
      const ctx = ctxFactory.create({
        tenantId,
        userId,
        correlationId: (request.headers['x-correlation-id'] as string) ?? crypto.randomUUID(),
      });

      const rows = await ctx.db.raw
        .select()
        .from(campaignAutomationRules)
        .where(eq(campaignAutomationRules.tenantId, tenantId))
        .orderBy(sql`trigger_type ASC`);
      return reply.code(200).send({ data: { content: rows, totalElements: rows.length } });
    }
  );

  fastify.put<{ Params: { id: string } }>(
    '/crm/automation-rules/:id',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.CRM_AUTOMATION_MANAGE)] },
    async (request, reply) => {
      const { tenantId, userId } = (request as unknown as AuthedRequest).auth;
      const ctx = ctxFactory.create({
        tenantId,
        userId,
        correlationId: (request.headers['x-correlation-id'] as string) ?? crypto.randomUUID(),
      });
      const id = parseInt(request.params.id, 10);

      const body = AutomationRuleSchema.partial().safeParse(request.body);
      if (!body.success)
        throw new ValidationError(body.error.errors.map((e) => e.message).join('; '));

      const [existing] = await ctx.db.raw
        .select()
        .from(campaignAutomationRules)
        .where(
          and(eq(campaignAutomationRules.id, id), eq(campaignAutomationRules.tenantId, tenantId))
        );
      if (!existing) throw new NotFoundError('Automation rule', id);

      const [updated] = await ctx.db.raw
        .update(campaignAutomationRules)
        .set({
          ...body.data,
          updatedAt: new Date(),
          version: sql`${campaignAutomationRules.version} + 1`,
        })
        .where(eq(campaignAutomationRules.id, id))
        .returning();
      if (!updated) throw new Error('Automation rule update failed unexpectedly');

      await ctx.audit.log({
        action: 'UPDATE',
        entityType: 'campaign_automation_rule',
        entityId: id,
        before: existing as unknown as Record<string, unknown>,
        after: updated as unknown as Record<string, unknown>,
      });
      return reply.code(200).send({ data: updated });
    }
  );

  fastify.post<{ Params: { id: string } }>(
    '/crm/campaigns/:id/send',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.CRM_CAMPAIGN_SEND)] },
    async (request, reply) => {
      const { tenantId, userId } = (request as unknown as AuthedRequest).auth;
      const ctx = ctxFactory.create({
        tenantId,
        userId,
        correlationId: (request.headers['x-correlation-id'] as string) ?? crypto.randomUUID(),
      });
      const id = parseInt(request.params.id, 10);

      const updated = await CampaignService.send(ctx, id);
      return reply.code(200).send({ data: updated });
    }
  );

  fastify.post<{ Params: { id: string } }>(
    '/crm/campaigns/:id/schedule',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.CRM_CAMPAIGN_CREATE)] },
    async (request, reply) => {
      const { tenantId, userId } = (request as unknown as AuthedRequest).auth;
      const ctx = ctxFactory.create({
        tenantId,
        userId,
        correlationId: (request.headers['x-correlation-id'] as string) ?? crypto.randomUUID(),
      });
      const id = parseInt(request.params.id, 10);

      const body = CampaignScheduleSchema.safeParse(request.body);
      if (!body.success)
        throw new ValidationError(body.error.errors.map((e) => e.message).join('; '));

      const rule = body.data.recurrenceRule
        ? {
            frequency: body.data.recurrenceRule.frequency,
            interval: body.data.recurrenceRule.interval,
            ...(body.data.recurrenceRule.endDate !== undefined
              ? { endDate: body.data.recurrenceRule.endDate }
              : {}),
            ...(body.data.recurrenceRule.occurrences !== undefined
              ? { occurrences: body.data.recurrenceRule.occurrences }
              : {}),
          }
        : undefined;
      const updated = await CampaignService.schedule(
        ctx,
        id,
        new Date(body.data.scheduledAt),
        rule,
        body.data.timezone
      );
      return reply.code(200).send({ data: updated });
    }
  );

  fastify.post<{ Params: { id: string } }>(
    '/crm/campaigns/:id/cancel',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.CRM_CAMPAIGN_CREATE)] },
    async (request, reply) => {
      const { tenantId, userId } = (request as unknown as AuthedRequest).auth;
      const ctx = ctxFactory.create({
        tenantId,
        userId,
        correlationId: (request.headers['x-correlation-id'] as string) ?? crypto.randomUUID(),
      });
      const id = parseInt(request.params.id, 10);

      const updated = await CampaignService.cancel(ctx, id);
      return reply.code(200).send({ data: updated });
    }
  );

  fastify.get<{ Params: { id: string } }>(
    '/crm/campaigns/:id/stats',
    // CP-7: separate from CRM_VIEW so a tenant can grant basic campaign visibility without
    // exposing delivery/engagement analytics.
    { preHandler: [authenticate, requirePermission(PERMISSIONS.CRM_CAMPAIGN_ANALYTICS_VIEW)] },
    async (request, reply) => {
      const { tenantId, userId } = (request as unknown as AuthedRequest).auth;
      const ctx = ctxFactory.create({
        tenantId,
        userId,
        correlationId: (request.headers['x-correlation-id'] as string) ?? crypto.randomUUID(),
      });
      const id = parseInt(request.params.id, 10);

      const [campaign] = await ctx.db.raw
        .select({ id: campaigns.id })
        .from(campaigns)
        .where(and(eq(campaigns.id, id), eq(campaigns.tenantId, tenantId)));
      if (!campaign) throw new NotFoundError('Campaign', id);

      const stats = await CampaignService.getStats(ctx, id);
      return reply.code(200).send({ data: stats });
    }
  );

  // CRM-ROADMAP Phase 3, Feature 3 — cross-campaign ROI report. Same permission as per-campaign
  // stats above: "no new attack surface — read-only aggregate reporting, same permission model
  // as existing campaign viewing" per this feature's own security note.
  fastify.get(
    '/crm/campaigns/roi-report',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.CRM_CAMPAIGN_ANALYTICS_VIEW)] },
    async (request, reply) => {
      const { tenantId, userId } = (request as unknown as AuthedRequest).auth;
      const ctx = ctxFactory.create({
        tenantId,
        userId,
        correlationId: (request.headers['x-correlation-id'] as string) ?? crypto.randomUUID(),
      });
      const report = await CampaignService.getRoiReport(ctx);
      return reply.code(200).send({ data: { content: report, totalElements: report.length } });
    }
  );

  fastify.get<{ Params: { id: string } }>(
    '/crm/campaigns/:id/recipients',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.CRM_CAMPAIGN_ANALYTICS_VIEW)] },
    async (request, reply) => {
      const { tenantId, userId } = (request as unknown as AuthedRequest).auth;
      const ctx = ctxFactory.create({
        tenantId,
        userId,
        correlationId: (request.headers['x-correlation-id'] as string) ?? crypto.randomUUID(),
      });
      const id = parseInt(request.params.id, 10);

      const [campaign] = await ctx.db.raw
        .select({ id: campaigns.id })
        .from(campaigns)
        .where(and(eq(campaigns.id, id), eq(campaigns.tenantId, tenantId)));
      if (!campaign) throw new NotFoundError('Campaign', id);

      const recipients = await CampaignService.listRecipients(ctx, id);
      return reply.code(200).send({ data: recipients });
    }
  );

  // ════════════════════════════════════════════════════════════════════════
  // M9.6 — Birthday and Anniversary Automation
  // ════════════════════════════════════════════════════════════════════════

  fastify.get(
    '/crm/campaigns/birthday-stats',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.CRM_VIEW)] },
    async (request, reply) => {
      const { tenantId, userId } = (request as unknown as AuthedRequest).auth;
      const ctx = ctxFactory.create({
        tenantId,
        userId,
        correlationId: (request.headers['x-correlation-id'] as string) ?? crypto.randomUUID(),
      });
      const query = request.query as { month?: string };
      const month = query.month ?? new Date().toISOString().slice(0, 7);
      const [year, mon] = month.split('-').map(Number);
      if (!year || !mon) throw new ValidationError('month must be in YYYY-MM format');
      const from = new Date(Date.UTC(year, mon - 1, 1));
      const to = new Date(Date.UTC(year, mon, 1));

      const rows = await ctx.db.raw
        .select({ status: notificationLog.status, count: sql<number>`count(*)::int` })
        .from(notificationLog)
        .where(
          and(
            eq(notificationLog.tenantId, tenantId),
            eq(notificationLog.eventType, 'BIRTHDAY_GREETING'),
            gte(notificationLog.createdAt, from),
            lte(notificationLog.createdAt, to)
          )
        )
        .groupBy(notificationLog.status);

      const stats = { month, sent: 0, failed: 0, skipped: 0, pending: 0 };
      for (const row of rows) {
        if (row.status === 'SENT' || row.status === 'DELIVERED') stats.sent += row.count;
        else if (row.status === 'FAILED') stats.failed = row.count;
        else if (row.status === 'SKIPPED') stats.skipped = row.count;
        else stats.pending = row.count;
      }

      return reply.code(200).send({ data: stats });
    }
  );

  // ════════════════════════════════════════════════════════════════════════
  // M9.7 — Festival Season Planner
  // ════════════════════════════════════════════════════════════════════════

  fastify.get(
    '/crm/seasons',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.CRM_SEASON_VIEW)] },
    async (request, reply) => {
      const { tenantId, userId } = (request as unknown as AuthedRequest).auth;
      const ctx = ctxFactory.create({
        tenantId,
        userId,
        correlationId: (request.headers['x-correlation-id'] as string) ?? crypto.randomUUID(),
      });
      const rows = await ctx.db.raw
        .select()
        .from(businessSeasons)
        .where(eq(businessSeasons.tenantId, tenantId))
        .orderBy(sql`start_date DESC`);
      return reply.code(200).send({ data: { content: rows, totalElements: rows.length } });
    }
  );

  fastify.get(
    '/crm/seasons/active',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.CRM_SEASON_VIEW)] },
    async (request, reply) => {
      const { tenantId, userId } = (request as unknown as AuthedRequest).auth;
      const ctx = ctxFactory.create({
        tenantId,
        userId,
        correlationId: (request.headers['x-correlation-id'] as string) ?? crypto.randomUUID(),
      });
      const now = new Date();

      const [season] = await ctx.db.raw
        .select()
        .from(businessSeasons)
        .where(
          and(
            eq(businessSeasons.tenantId, tenantId),
            eq(businessSeasons.isActive, true),
            lte(businessSeasons.startDate, now),
            gte(businessSeasons.endDate, now)
          )
        );

      return reply.code(200).send({ data: season ?? null });
    }
  );

  fastify.post(
    '/crm/seasons',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.CRM_SEASON_MANAGE)] },
    async (request, reply) => {
      const { tenantId, userId } = (request as unknown as AuthedRequest).auth;
      const ctx = ctxFactory.create({
        tenantId,
        userId,
        correlationId: (request.headers['x-correlation-id'] as string) ?? crypto.randomUUID(),
      });

      const body = SeasonSchema.safeParse(request.body);
      if (!body.success)
        throw new ValidationError(body.error.errors.map((e) => e.message).join('; '));
      if (new Date(body.data.endDate) <= new Date(body.data.startDate)) {
        throw new BusinessError('INVALID_SEASON_DATES', 'endDate must be after startDate');
      }

      const [created] = await ctx.db.raw
        .insert(businessSeasons)
        .values({
          tenantId,
          name: body.data.name,
          seasonType: body.data.seasonType,
          startDate: new Date(body.data.startDate),
          endDate: new Date(body.data.endDate),
          stockMultiplier: String(body.data.stockMultiplier),
          loyaltyMultiplier: String(body.data.loyaltyMultiplier),
          salesTarget: String(body.data.salesTarget),
          isActive: body.data.isActive,
          createdBy: userId,
        })
        .returning();
      if (!created) throw new Error('Season creation failed unexpectedly');

      await ctx.events.publish(
        'business_season',
        created.id,
        'SEASON_CREATED',
        created as unknown as Record<string, unknown>
      );
      await ctx.audit.log({
        action: 'CREATE',
        entityType: 'business_season',
        entityId: created.id,
        after: created as unknown as Record<string, unknown>,
      });

      return reply.code(201).send({ data: created });
    }
  );

  fastify.put<{ Params: { id: string } }>(
    '/crm/seasons/:id',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.CRM_SEASON_MANAGE)] },
    async (request, reply) => {
      const { tenantId, userId } = (request as unknown as AuthedRequest).auth;
      const ctx = ctxFactory.create({
        tenantId,
        userId,
        correlationId: (request.headers['x-correlation-id'] as string) ?? crypto.randomUUID(),
      });
      const id = parseInt(request.params.id, 10);

      const body = SeasonUpdateSchema.safeParse(request.body);
      if (!body.success)
        throw new ValidationError(body.error.errors.map((e) => e.message).join('; '));
      if (new Date(body.data.endDate) <= new Date(body.data.startDate)) {
        throw new BusinessError('INVALID_SEASON_DATES', 'endDate must be after startDate');
      }

      const [existing] = await ctx.db.raw
        .select()
        .from(businessSeasons)
        .where(and(eq(businessSeasons.id, id), eq(businessSeasons.tenantId, tenantId)));
      if (!existing) throw new NotFoundError('Season', id);

      const [updated] = await ctx.db.raw
        .update(businessSeasons)
        .set({
          name: body.data.name,
          seasonType: body.data.seasonType,
          startDate: new Date(body.data.startDate),
          endDate: new Date(body.data.endDate),
          stockMultiplier: String(body.data.stockMultiplier),
          loyaltyMultiplier: String(body.data.loyaltyMultiplier),
          salesTarget: String(body.data.salesTarget),
          isActive: body.data.isActive,
          updatedAt: new Date(),
          version: existing.version + 1,
        })
        .where(
          and(
            eq(businessSeasons.id, id),
            eq(businessSeasons.tenantId, tenantId),
            eq(businessSeasons.version, body.data.version)
          )
        )
        .returning();

      if (!updated) throw new OptimisticLockError('Season');

      await ctx.audit.log({
        action: 'UPDATE',
        entityType: 'business_season',
        entityId: id,
        before: existing as unknown as Record<string, unknown>,
        after: updated as unknown as Record<string, unknown>,
      });

      return reply.code(200).send({ data: updated });
    }
  );

  // ════════════════════════════════════════════════════════════════════════
  // CRM-ROADMAP Phase 4, Feature 3 — Festival Intelligence AI (suggestion review)
  // ════════════════════════════════════════════════════════════════════════

  fastify.get(
    '/crm/festival-suggestions',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.CRM_SEASON_VIEW)] },
    async (request, reply) => {
      const { tenantId } = (request as unknown as AuthedRequest).auth;
      const ctx = ctxFactory.create({
        tenantId,
        userId: 0,
        correlationId: (request.headers['x-correlation-id'] as string) ?? crypto.randomUUID(),
      });
      const query = request.query as {
        status?: 'PENDING' | 'APPROVED' | 'REJECTED' | 'INSUFFICIENT_DATA';
      };
      const rows = await FestivalIntelligenceService.list(ctx.db.raw, tenantId, {
        status: query.status,
      });
      return reply.code(200).send({ data: { content: rows, totalElements: rows.length } });
    }
  );

  const ApproveSuggestionSchema = z.object({
    name: z.string().min(2).max(200),
    startDate: z.string().optional(),
    endDate: z.string().optional(),
    stockMultiplier: z.number().positive().optional(),
    loyaltyMultiplier: z.number().positive().optional(),
  });

  fastify.post<{ Params: { id: string } }>(
    '/crm/festival-suggestions/:id/approve',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.CRM_SEASON_MANAGE)] },
    async (request, reply) => {
      const { tenantId, userId } = (request as unknown as AuthedRequest).auth;
      const ctx = ctxFactory.create({
        tenantId,
        userId,
        correlationId: (request.headers['x-correlation-id'] as string) ?? crypto.randomUUID(),
      });
      const id = parseInt(request.params.id, 10);

      const body = ApproveSuggestionSchema.safeParse(request.body);
      if (!body.success)
        throw new ValidationError(body.error.errors.map((e) => e.message).join('; '));

      const result = await FestivalIntelligenceService.approve(ctx.db.raw, tenantId, userId, id, {
        name: body.data.name,
        startDate: body.data.startDate ? new Date(body.data.startDate) : undefined,
        endDate: body.data.endDate ? new Date(body.data.endDate) : undefined,
        stockMultiplier: body.data.stockMultiplier,
        loyaltyMultiplier: body.data.loyaltyMultiplier,
      });

      await ctx.audit.log({
        action: 'UPDATE',
        entityType: 'crm_festival_suggestion',
        entityId: id,
        after: { status: 'APPROVED', createdSeasonId: result.seasonId } as unknown as Record<
          string,
          unknown
        >,
      });
      return reply.code(200).send({ data: result });
    }
  );

  fastify.post<{ Params: { id: string } }>(
    '/crm/festival-suggestions/:id/reject',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.CRM_SEASON_MANAGE)] },
    async (request, reply) => {
      const { tenantId, userId } = (request as unknown as AuthedRequest).auth;
      const ctx = ctxFactory.create({
        tenantId,
        userId,
        correlationId: (request.headers['x-correlation-id'] as string) ?? crypto.randomUUID(),
      });
      const id = parseInt(request.params.id, 10);

      const updated = await FestivalIntelligenceService.reject(ctx.db.raw, tenantId, userId, id);

      await ctx.audit.log({
        action: 'UPDATE',
        entityType: 'crm_festival_suggestion',
        entityId: id,
        after: { status: 'REJECTED' } as unknown as Record<string, unknown>,
      });
      return reply.code(200).send({ data: updated });
    }
  );

  // ════════════════════════════════════════════════════════════════════════
  // CP-5/CP-7 follow-up — Tenant Communication Settings (approval + frequency cap)
  // ════════════════════════════════════════════════════════════════════════
  // Gated on CRM_AUTOMATION_MANAGE — the closest existing "manage tenant-wide campaign
  // behavior" permission (this table already held frequencyCap since CP-5); not worth a new
  // permission constant + backfill migration for a single settings surface.

  fastify.get(
    '/crm/communication-settings',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.CRM_AUTOMATION_MANAGE)] },
    async (request, reply) => {
      const { tenantId, userId } = (request as unknown as AuthedRequest).auth;
      const ctx = ctxFactory.create({
        tenantId,
        userId,
        correlationId: (request.headers['x-correlation-id'] as string) ?? crypto.randomUUID(),
      });

      const [settings] = await ctx.db.raw
        .select()
        .from(tenantCommunicationSettings)
        .where(eq(tenantCommunicationSettings.tenantId, tenantId));

      return reply.code(200).send({
        data: {
          approvalRequired: settings?.approvalRequired ?? false,
          paymentReminderEnabled: settings?.paymentReminderEnabled ?? false,
          maxPerDayFrequencyCap: settings?.frequencyCap?.maxPerDay ?? null,
          notificationRateLimitPerMinute: settings?.notificationRateLimitPerMinute ?? null,
          costPerMessage: settings?.costPerMessage ?? null,
        },
      });
    }
  );

  fastify.put(
    '/crm/communication-settings',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.CRM_AUTOMATION_MANAGE)] },
    async (request, reply) => {
      const { tenantId, userId } = (request as unknown as AuthedRequest).auth;
      const ctx = ctxFactory.create({
        tenantId,
        userId,
        correlationId: (request.headers['x-correlation-id'] as string) ?? crypto.randomUUID(),
      });

      const body = CommunicationSettingsSchema.safeParse(request.body);
      if (!body.success)
        throw new ValidationError(body.error.errors.map((e) => e.message).join('; '));

      const [existing] = await ctx.db.raw
        .select()
        .from(tenantCommunicationSettings)
        .where(eq(tenantCommunicationSettings.tenantId, tenantId));

      const nextFrequencyCap =
        body.data.maxPerDayFrequencyCap !== undefined
          ? body.data.maxPerDayFrequencyCap === null
            ? null
            : { maxPerDay: body.data.maxPerDayFrequencyCap }
          : (existing?.frequencyCap ?? null);

      const [saved] = existing
        ? await ctx.db.raw
            .update(tenantCommunicationSettings)
            .set({
              ...(body.data.approvalRequired !== undefined
                ? { approvalRequired: body.data.approvalRequired }
                : {}),
              ...(body.data.paymentReminderEnabled !== undefined
                ? { paymentReminderEnabled: body.data.paymentReminderEnabled }
                : {}),
              ...(body.data.notificationRateLimitPerMinute !== undefined
                ? { notificationRateLimitPerMinute: body.data.notificationRateLimitPerMinute }
                : {}),
              ...(body.data.costPerMessage !== undefined
                ? { costPerMessage: body.data.costPerMessage }
                : {}),
              frequencyCap: nextFrequencyCap,
              updatedAt: new Date(),
            })
            .where(eq(tenantCommunicationSettings.id, existing.id))
            .returning()
        : await ctx.db.raw
            .insert(tenantCommunicationSettings)
            .values({
              tenantId,
              approvalRequired: body.data.approvalRequired ?? false,
              paymentReminderEnabled: body.data.paymentReminderEnabled ?? false,
              notificationRateLimitPerMinute: body.data.notificationRateLimitPerMinute ?? null,
              costPerMessage: body.data.costPerMessage ?? null,
              frequencyCap: nextFrequencyCap,
            })
            .returning();
      if (!saved) throw new Error('Communication settings save failed unexpectedly');

      await ctx.audit.log({
        action: existing ? 'UPDATE' : 'CREATE',
        entityType: 'tenant_communication_settings',
        entityId: saved.id,
      });

      return reply.code(200).send({
        data: {
          approvalRequired: saved.approvalRequired,
          paymentReminderEnabled: saved.paymentReminderEnabled,
          maxPerDayFrequencyCap: saved.frequencyCap?.maxPerDay ?? null,
          notificationRateLimitPerMinute: saved.notificationRateLimitPerMinute ?? null,
          costPerMessage: saved.costPerMessage ?? null,
        },
      });
    }
  );

  // ════════════════════════════════════════════════════════════════════════
  // CP-8 — Tenant Sender Identity
  // ════════════════════════════════════════════════════════════════════════

  fastify.get(
    '/crm/sender-identity',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.CRM_SENDER_IDENTITY_MANAGE)] },
    async (request, reply) => {
      const { tenantId, userId } = (request as unknown as AuthedRequest).auth;
      const ctx = ctxFactory.create({
        tenantId,
        userId,
        correlationId: (request.headers['x-correlation-id'] as string) ?? crypto.randomUUID(),
      });
      const rows = await ctx.db.raw
        .select()
        .from(tenantSenderIdentity)
        .where(eq(tenantSenderIdentity.tenantId, tenantId));
      return reply.code(200).send({ data: { content: rows, totalElements: rows.length } });
    }
  );

  // Upsert — one row per (tenant, channel). A tenant configures each channel independently by
  // calling this once per channel; there is no separate create-vs-update distinction from the
  // caller's perspective.
  fastify.put(
    '/crm/sender-identity',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.CRM_SENDER_IDENTITY_MANAGE)] },
    async (request, reply) => {
      const { tenantId, userId } = (request as unknown as AuthedRequest).auth;
      const ctx = ctxFactory.create({
        tenantId,
        userId,
        correlationId: (request.headers['x-correlation-id'] as string) ?? crypto.randomUUID(),
      });

      const body = SenderIdentitySchema.safeParse(request.body);
      if (!body.success)
        throw new ValidationError(body.error.errors.map((e) => e.message).join('; '));

      const [existing] = await ctx.db.raw
        .select({ id: tenantSenderIdentity.id })
        .from(tenantSenderIdentity)
        .where(
          and(
            eq(tenantSenderIdentity.tenantId, tenantId),
            eq(tenantSenderIdentity.channel, body.data.channel)
          )
        );

      const [saved] = existing
        ? await ctx.db.raw
            .update(tenantSenderIdentity)
            .set({
              senderName: body.data.senderName,
              senderAddressOrNumber: body.data.senderAddressOrNumber,
              updatedAt: new Date(),
            })
            .where(eq(tenantSenderIdentity.id, existing.id))
            .returning()
        : await ctx.db.raw
            .insert(tenantSenderIdentity)
            .values({
              tenantId,
              channel: body.data.channel,
              senderName: body.data.senderName,
              senderAddressOrNumber: body.data.senderAddressOrNumber,
            })
            .returning();
      if (!saved) throw new Error('Sender identity save failed unexpectedly');

      await ctx.audit.log({
        action: existing ? 'UPDATE' : 'CREATE',
        entityType: 'tenant_sender_identity',
        entityId: saved.id,
        after: saved as unknown as Record<string, unknown>,
      });

      return reply.code(200).send({ data: saved });
    }
  );

  // CRM-ROADMAP Phase 4, Feature 2 (WhatsApp Commerce). Reuses QUOTATION_VIEW rather than a new
  // permission — this is just "which quotations came from WhatsApp," the same underlying
  // resource a caller already needs QUOTATION_VIEW to see at all. Minimal ERP-side surface per
  // the roadmap's own spec: an order-source indicator on the existing Quotations list, not a new
  // page.
  fastify.get(
    '/crm/whatsapp-orders',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.QUOTATION_VIEW)] },
    async (request, reply) => {
      const { tenantId } = (request as unknown as AuthedRequest).auth;
      const rows = await ctxFactory.rawDb
        .select({
          id: crmWhatsappCatalogOrders.id,
          customerId: crmWhatsappCatalogOrders.customerId,
          quotationId: crmWhatsappCatalogOrders.quotationId,
          status: crmWhatsappCatalogOrders.status,
          rejectionReason: crmWhatsappCatalogOrders.rejectionReason,
          createdAt: crmWhatsappCatalogOrders.createdAt,
        })
        .from(crmWhatsappCatalogOrders)
        .where(eq(crmWhatsappCatalogOrders.tenantId, tenantId));
      return reply.code(200).send({ data: { content: rows, totalElements: rows.length } });
    }
  );
}
