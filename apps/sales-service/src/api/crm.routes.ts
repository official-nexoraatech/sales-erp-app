import type { FastifyInstance } from 'fastify';
import type { PlatformContextFactory } from '@erp/sdk';
import {
  customers,
  customerInteractions,
  customerSegments,
  campaigns,
  businessSeasons,
  notificationLog,
} from '@erp/db';
import type { ErpDatabase } from '@erp/db';
import { and, eq, gte, isNull, lte, sql } from 'drizzle-orm';
import { z } from 'zod';
import { BusinessError, NotFoundError, OptimisticLockError, ValidationError, PERMISSIONS } from '@erp/types';
import { authenticate } from '../middleware/authenticate.js';
import { requirePermission } from '../middleware/authorize.js';
import { SegmentService, PREBUILT_SEGMENTS, type SegmentFilterDefinition, type SegmentFilterRule } from '../domain/SegmentService.js';
import { CampaignService, checkChannelLimits } from '../domain/CampaignService.js';
import { HealthScoringService } from '../domain/HealthScoringService.js';

type AuthedRequest = { auth: { tenantId: number; userId: number } };

const InteractionSchema = z.object({
  type: z.enum(['VISIT', 'CALL', 'COMPLAINT', 'EMAIL', 'WHATSAPP', 'OTHER']),
  notes: z.string().min(1).max(2000),
  followUpDate: z.string().datetime().optional().or(z.literal('')),
});

const SegmentFilterRuleSchema = z.object({
  field: z.string().min(1),
  operator: z.enum(['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'contains']),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  value: z.any(),
});

const SegmentCreateSchema = z.object({
  name: z.string().min(2).max(200),
  rules: z.array(SegmentFilterRuleSchema).min(1),
  logic: z.enum(['AND', 'OR']).default('AND'),
  description: z.string().max(2000).optional(),
});

const SegmentPreviewSchema = z.object({
  segmentCode: z.string().optional(),
  rules: z.array(SegmentFilterRuleSchema).optional(),
  logic: z.enum(['AND', 'OR']).default('AND'),
}).refine((d) => !!d.segmentCode || (d.rules && d.rules.length > 0), {
  message: 'Either segmentCode or a non-empty rules array is required',
});

const CampaignPreviewSchema = z.object({
  segmentId: z.number().int().positive().optional(),
  customerIds: z.array(z.number().int().positive()).optional(),
  messageTemplate: z.string().min(1).max(2000),
  channel: z.enum(['SMS', 'WHATSAPP', 'EMAIL', 'IN_APP']),
});

const CampaignCreateSchema = z.object({
  name: z.string().min(2).max(200),
  segmentId: z.number().int().positive().optional(),
  customerIds: z.array(z.number().int().positive()).optional(),
  channel: z.enum(['SMS', 'WHATSAPP', 'EMAIL', 'IN_APP']),
  messageTemplate: z.string().min(1).max(2000),
});

const CampaignScheduleSchema = z.object({
  scheduledAt: z.string().datetime(),
});

const SeasonSchema = z.object({
  name: z.string().min(2).max(200),
  seasonType: z.enum(['FESTIVAL_SEASON', 'WEDDING_SEASON', 'SUMMER_COLLECTION', 'YEAR_END_SALE']),
  startDate: z.string().datetime(),
  endDate: z.string().datetime(),
  stockMultiplier: z.number().min(0).default(1),
  loyaltyMultiplier: z.number().min(0).default(1),
  salesTarget: z.number().min(0).default(0),
  isActive: z.boolean().default(true),
});

const SeasonUpdateSchema = SeasonSchema.extend({ version: z.number().int().min(0) });

export async function crmRoutes(fastify: FastifyInstance, ctxFactory: PlatformContextFactory): Promise<void> {
  // ════════════════════════════════════════════════════════════════════════
  // M9.3 — Customer Interaction Log
  // ════════════════════════════════════════════════════════════════════════

  fastify.post<{ Params: { id: string } }>(
    '/customers/:id/interactions',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.CRM_INTERACTION_CREATE)] },
    async (request, reply) => {
      const { tenantId, userId } = (request as unknown as AuthedRequest).auth;
      const ctx = ctxFactory.create({ tenantId, userId, correlationId: (request.headers['x-correlation-id'] as string) ?? crypto.randomUUID() });
      const customerId = parseInt(request.params.id, 10);

      const body = InteractionSchema.safeParse(request.body);
      if (!body.success) throw new ValidationError(body.error.errors.map((e) => e.message).join('; '));

      const [customer] = await ctx.db.raw.select({ id: customers.id }).from(customers).where(and(eq(customers.id, customerId), eq(customers.tenantId, tenantId), isNull(customers.deletedAt)));
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
      await ctx.audit.log({ action: 'CREATE', entityType: 'customer_interaction', entityId: created.id, after: created as unknown as Record<string, unknown> });
      await ctx.events.publish('customer_interaction', created.id, 'CRM_INTERACTION_CREATED', created as unknown as Record<string, unknown>);

      return reply.code(201).send({ data: created });
    }
  );

  fastify.get<{ Params: { id: string } }>(
    '/customers/:id/interactions',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.CRM_INTERACTION_VIEW)] },
    async (request, reply) => {
      const { tenantId, userId } = (request as unknown as AuthedRequest).auth;
      const ctx = ctxFactory.create({ tenantId, userId, correlationId: (request.headers['x-correlation-id'] as string) ?? crypto.randomUUID() });
      const customerId = parseInt(request.params.id, 10);

      const rows = await ctx.db.raw
        .select()
        .from(customerInteractions)
        .where(and(eq(customerInteractions.customerId, customerId), eq(customerInteractions.tenantId, tenantId)))
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
      const ctx = ctxFactory.create({ tenantId, userId, correlationId: (request.headers['x-correlation-id'] as string) ?? crypto.randomUUID() });
      const customerId = parseInt(request.params.id, 10);
      const interactionId = parseInt(request.params.interactionId, 10);

      const body = InteractionSchema.safeParse(request.body);
      if (!body.success) throw new ValidationError(body.error.errors.map((e) => e.message).join('; '));

      const [existing] = await ctx.db.raw
        .select()
        .from(customerInteractions)
        .where(and(eq(customerInteractions.id, interactionId), eq(customerInteractions.customerId, customerId), eq(customerInteractions.tenantId, tenantId)));
      if (!existing) throw new NotFoundError('Interaction', interactionId);

      const ageMs = Date.now() - existing.createdAt.getTime();
      if (ageMs > 24 * 60 * 60 * 1000) {
        throw new BusinessError('INTERACTION_EDIT_WINDOW_EXPIRED', 'Interactions can only be edited within 24 hours of creation');
      }

      const [updated] = await ctx.db.raw
        .update(customerInteractions)
        .set({
          type: body.data.type,
          notes: body.data.notes,
          followUpDate: body.data.followUpDate ? new Date(body.data.followUpDate) : null,
          updatedAt: new Date(),
        })
        .where(and(eq(customerInteractions.id, interactionId), eq(customerInteractions.tenantId, tenantId)))
        .returning();
      if (!updated) throw new Error('Interaction update failed unexpectedly');

      await ctx.cache.invalidate(`crm:activity:${customerId}:*`);
      await ctx.audit.log({ action: 'UPDATE', entityType: 'customer_interaction', entityId: interactionId, before: existing as unknown as Record<string, unknown>, after: updated as unknown as Record<string, unknown> });

      return reply.code(200).send({ data: updated });
    }
  );

  // GET /crm/follow-ups — today's follow-up tasks for the logged-in user
  fastify.get('/crm/follow-ups', { preHandler: [authenticate, requirePermission(PERMISSIONS.CRM_INTERACTION_VIEW)] }, async (request, reply) => {
    const { tenantId, userId } = (request as unknown as AuthedRequest).auth;
    const ctx = ctxFactory.create({ tenantId, userId, correlationId: (request.headers['x-correlation-id'] as string) ?? crypto.randomUUID() });

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
  });

  // ════════════════════════════════════════════════════════════════════════
  // M9.2 — Customer Health Scoring
  // ════════════════════════════════════════════════════════════════════════

  fastify.get('/crm/segments/health', { preHandler: [authenticate, requirePermission(PERMISSIONS.CRM_VIEW)] }, async (request, reply) => {
    const { tenantId, userId } = (request as unknown as AuthedRequest).auth;
    const ctx = ctxFactory.create({ tenantId, userId, correlationId: (request.headers['x-correlation-id'] as string) ?? crypto.randomUUID() });
    const counts = await HealthScoringService.segmentCounts(ctx.db.raw, tenantId);
    return reply.code(200).send({ data: counts });
  });

  // ════════════════════════════════════════════════════════════════════════
  // M9.4 — Customer Segmentation
  // ════════════════════════════════════════════════════════════════════════

  fastify.get('/crm/segments', { preHandler: [authenticate, requirePermission(PERMISSIONS.CRM_SEGMENT_VIEW)] }, async (request, reply) => {
    const { tenantId, userId } = (request as unknown as AuthedRequest).auth;
    const ctx = ctxFactory.create({ tenantId, userId, correlationId: (request.headers['x-correlation-id'] as string) ?? crypto.randomUUID() });

    const saved = await ctx.db.raw.select().from(customerSegments).where(eq(customerSegments.tenantId, tenantId));
    const prebuilt = PREBUILT_SEGMENTS.map((code) => ({ id: null, code, name: code.replace(/-/g, ' '), isSystem: true }));

    return reply.code(200).send({ data: { content: [...prebuilt, ...saved], totalElements: prebuilt.length + saved.length } });
  });

  fastify.post('/crm/segments', { preHandler: [authenticate, requirePermission(PERMISSIONS.CRM_SEGMENT_CREATE)] }, async (request, reply) => {
    const { tenantId, userId } = (request as unknown as AuthedRequest).auth;
    const ctx = ctxFactory.create({ tenantId, userId, correlationId: (request.headers['x-correlation-id'] as string) ?? crypto.randomUUID() });

    const body = SegmentCreateSchema.safeParse(request.body);
    if (!body.success) throw new ValidationError(body.error.errors.map((e) => e.message).join('; '));

    const code = body.data.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
    const filterDefinition: SegmentFilterDefinition = { rules: body.data.rules as SegmentFilterRule[], logic: body.data.logic };

    const [created] = await ctx.db.raw
      .insert(customerSegments)
      .values({ tenantId, name: body.data.name, code, isSystem: false, filterDefinition, description: body.data.description, createdBy: userId })
      .returning();
    if (!created) throw new Error('Segment creation failed unexpectedly');

    await ctx.audit.log({ action: 'CREATE', entityType: 'customer_segment', entityId: created.id, after: created as unknown as Record<string, unknown> });
    await ctx.events.publish('customer_segment', created.id, 'CRM_SEGMENT_CREATED', created as unknown as Record<string, unknown>);

    return reply.code(201).send({ data: created });
  });

  fastify.post('/crm/segments/preview', { preHandler: [authenticate, requirePermission(PERMISSIONS.CRM_SEGMENT_VIEW)] }, async (request, reply) => {
    const { tenantId, userId } = (request as unknown as AuthedRequest).auth;
    const ctx = ctxFactory.create({ tenantId, userId, correlationId: (request.headers['x-correlation-id'] as string) ?? crypto.randomUUID() });

    const body = SegmentPreviewSchema.safeParse(request.body);
    if (!body.success) throw new ValidationError(body.error.errors.map((e) => e.message).join('; '));

    const where = body.data.segmentCode
      ? await SegmentService.resolveWhere(ctx.db.raw, tenantId, await loadSegment(ctx.db.raw, tenantId, body.data.segmentCode))
      : SegmentService.customWhere(tenantId, { rules: body.data.rules as SegmentFilterRule[], logic: body.data.logic });
    const count = await SegmentService.countMatching(ctx.db.raw, where);

    return reply.code(200).send({ data: { matchingCount: count } });
  });

  // Standalone campaign-recipient preview — used by the "Preview Recipients" button
  // before a campaign is created. Reuses the same CampaignService.previewSample logic
  // that runs during actual campaign creation (see POST /crm/campaigns below).
  fastify.post('/crm/campaigns/preview', { preHandler: [authenticate, requirePermission(PERMISSIONS.CRM_CAMPAIGN_CREATE)] }, async (request, reply) => {
    const { tenantId, userId } = (request as unknown as AuthedRequest).auth;
    const ctx = ctxFactory.create({ tenantId, userId, correlationId: (request.headers['x-correlation-id'] as string) ?? crypto.randomUUID() });

    const body = CampaignPreviewSchema.safeParse(request.body);
    if (!body.success) throw new ValidationError(body.error.errors.map((e) => e.message).join('; '));
    if (!body.data.segmentId && (!body.data.customerIds || body.data.customerIds.length === 0)) {
      throw new ValidationError('Preview requires either segmentId or a non-empty customerIds list');
    }

    const preview = await CampaignService.previewSample(ctx, body.data.segmentId, body.data.customerIds, body.data.messageTemplate, body.data.channel);
    return reply.code(200).send({ data: preview });
  });

  async function loadSegment(ctxDbRaw: ErpDatabase, tenantId: number, idOrCode: string) {
    if (PREBUILT_SEGMENTS.includes(idOrCode as (typeof PREBUILT_SEGMENTS)[number])) {
      return { code: idOrCode, isSystem: true, filterDefinition: null as SegmentFilterDefinition | null };
    }
    const segId = parseInt(idOrCode, 10);
    if (Number.isNaN(segId)) throw new NotFoundError('Segment', idOrCode);
    const [segment] = await ctxDbRaw.select().from(customerSegments).where(and(eq(customerSegments.id, segId), eq(customerSegments.tenantId, tenantId)));
    if (!segment) throw new NotFoundError('Segment', idOrCode);
    return { code: segment.code, isSystem: segment.isSystem, filterDefinition: segment.filterDefinition as SegmentFilterDefinition | null };
  }

  fastify.get<{ Params: { id: string } }>('/crm/segments/:id/customers', { preHandler: [authenticate, requirePermission(PERMISSIONS.CRM_SEGMENT_VIEW)] }, async (request, reply) => {
    const { tenantId, userId } = (request as unknown as AuthedRequest).auth;
    const ctx = ctxFactory.create({ tenantId, userId, correlationId: (request.headers['x-correlation-id'] as string) ?? crypto.randomUUID() });
    const query = request.query as { page?: string; size?: string };
    const page = Math.max(0, parseInt(query.page ?? '0', 10));
    const size = Math.min(100, parseInt(query.size ?? '20', 10));

    const segment = await loadSegment(ctx.db.raw, tenantId, request.params.id);
    const where = await SegmentService.resolveWhere(ctx.db.raw, tenantId, segment);
    const { rows, total } = await SegmentService.listMatching(ctx.db.raw, where, page, size);

    return reply.code(200).send({ data: { content: rows, totalElements: total, page, size } });
  });

  fastify.get<{ Params: { id: string } }>('/crm/segments/:id/export', { preHandler: [authenticate, requirePermission(PERMISSIONS.CRM_SEGMENT_VIEW)] }, async (request, reply) => {
    const { tenantId, userId } = (request as unknown as AuthedRequest).auth;
    const ctx = ctxFactory.create({ tenantId, userId, correlationId: (request.headers['x-correlation-id'] as string) ?? crypto.randomUUID() });

    const segment = await loadSegment(ctx.db.raw, tenantId, request.params.id);
    const where = await SegmentService.resolveWhere(ctx.db.raw, tenantId, segment);
    const { rows } = await SegmentService.listMatching(ctx.db.raw, where, 0, 10_000);

    const header = ['Customer Code', 'Name', 'Phone', 'Email', 'Loyalty Points', 'Status'];
    const csvRows = rows.map((c) => [c.customerCode ?? '', c.displayName, c.phone, c.email ?? '', String(c.loyaltyPoints), c.status]);
    const csv = [header, ...csvRows].map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\r\n');

    reply.header('Content-Type', 'text/csv; charset=utf-8');
    reply.header('Content-Disposition', `attachment; filename="segment-${request.params.id}-export.csv"`);
    return reply.code(200).send(csv);
  });

  // ════════════════════════════════════════════════════════════════════════
  // M9.5 — Campaign Management
  // ════════════════════════════════════════════════════════════════════════

  fastify.post('/crm/campaigns', { preHandler: [authenticate, requirePermission(PERMISSIONS.CRM_CAMPAIGN_CREATE)] }, async (request, reply) => {
    const { tenantId, userId } = (request as unknown as AuthedRequest).auth;
    const ctx = ctxFactory.create({ tenantId, userId, correlationId: (request.headers['x-correlation-id'] as string) ?? crypto.randomUUID() });

    const body = CampaignCreateSchema.safeParse(request.body);
    if (!body.success) throw new ValidationError(body.error.errors.map((e) => e.message).join('; '));
    if (!body.data.segmentId && (!body.data.customerIds || body.data.customerIds.length === 0)) {
      throw new ValidationError('Campaign requires either segmentId or a non-empty customerIds list');
    }

    const warnings = checkChannelLimits(body.data.channel, body.data.messageTemplate);

    const [created] = await ctx.db.raw
      .insert(campaigns)
      .values({
        tenantId,
        name: body.data.name,
        segmentId: body.data.segmentId,
        customerIds: body.data.customerIds,
        channel: body.data.channel,
        messageTemplate: body.data.messageTemplate,
        createdBy: userId,
      })
      .returning();
    if (!created) throw new Error('Campaign creation failed unexpectedly');

    const preview = await CampaignService.previewSample(ctx, body.data.segmentId, body.data.customerIds, body.data.messageTemplate, body.data.channel);
    await ctx.audit.log({ action: 'CREATE', entityType: 'campaign', entityId: created.id, after: created as unknown as Record<string, unknown> });
    await ctx.events.publish('campaign', created.id, 'CRM_CAMPAIGN_CREATED', created as unknown as Record<string, unknown>);

    return reply.code(201).send({ data: created, preview, warnings: [...warnings, ...preview.warnings] });
  });

  fastify.get('/crm/campaigns', { preHandler: [authenticate, requirePermission(PERMISSIONS.CRM_VIEW)] }, async (request, reply) => {
    const { tenantId, userId } = (request as unknown as AuthedRequest).auth;
    const ctx = ctxFactory.create({ tenantId, userId, correlationId: (request.headers['x-correlation-id'] as string) ?? crypto.randomUUID() });
    const query = request.query as { status?: string };

    let where = eq(campaigns.tenantId, tenantId);
    if (query.status) {
      where = and(where, eq(campaigns.status, query.status as 'DRAFT' | 'SCHEDULED' | 'SENDING' | 'SENT' | 'CANCELLED' | 'FAILED'))!;
    }

    const rows = await ctx.db.raw.select().from(campaigns).where(where).orderBy(sql`created_at DESC`);
    return reply.code(200).send({ data: { content: rows, totalElements: rows.length } });
  });

  fastify.get<{ Params: { id: string } }>('/crm/campaigns/:id', { preHandler: [authenticate, requirePermission(PERMISSIONS.CRM_VIEW)] }, async (request, reply) => {
    const { tenantId, userId } = (request as unknown as AuthedRequest).auth;
    const ctx = ctxFactory.create({ tenantId, userId, correlationId: (request.headers['x-correlation-id'] as string) ?? crypto.randomUUID() });
    const id = parseInt(request.params.id, 10);

    const [campaign] = await ctx.db.raw.select().from(campaigns).where(and(eq(campaigns.id, id), eq(campaigns.tenantId, tenantId)));
    if (!campaign) throw new NotFoundError('Campaign', id);

    return reply.code(200).send({ data: campaign });
  });

  fastify.post<{ Params: { id: string } }>('/crm/campaigns/:id/send', { preHandler: [authenticate, requirePermission(PERMISSIONS.CRM_CAMPAIGN_SEND)] }, async (request, reply) => {
    const { tenantId, userId } = (request as unknown as AuthedRequest).auth;
    const ctx = ctxFactory.create({ tenantId, userId, correlationId: (request.headers['x-correlation-id'] as string) ?? crypto.randomUUID() });
    const id = parseInt(request.params.id, 10);

    const updated = await CampaignService.send(ctx, id);
    return reply.code(200).send({ data: updated });
  });

  fastify.post<{ Params: { id: string } }>('/crm/campaigns/:id/schedule', { preHandler: [authenticate, requirePermission(PERMISSIONS.CRM_CAMPAIGN_CREATE)] }, async (request, reply) => {
    const { tenantId, userId } = (request as unknown as AuthedRequest).auth;
    const ctx = ctxFactory.create({ tenantId, userId, correlationId: (request.headers['x-correlation-id'] as string) ?? crypto.randomUUID() });
    const id = parseInt(request.params.id, 10);

    const body = CampaignScheduleSchema.safeParse(request.body);
    if (!body.success) throw new ValidationError(body.error.errors.map((e) => e.message).join('; '));

    const updated = await CampaignService.schedule(ctx, id, new Date(body.data.scheduledAt));
    return reply.code(200).send({ data: updated });
  });

  fastify.post<{ Params: { id: string } }>('/crm/campaigns/:id/cancel', { preHandler: [authenticate, requirePermission(PERMISSIONS.CRM_CAMPAIGN_CREATE)] }, async (request, reply) => {
    const { tenantId, userId } = (request as unknown as AuthedRequest).auth;
    const ctx = ctxFactory.create({ tenantId, userId, correlationId: (request.headers['x-correlation-id'] as string) ?? crypto.randomUUID() });
    const id = parseInt(request.params.id, 10);

    const updated = await CampaignService.cancel(ctx, id);
    return reply.code(200).send({ data: updated });
  });

  fastify.get<{ Params: { id: string } }>('/crm/campaigns/:id/stats', { preHandler: [authenticate, requirePermission(PERMISSIONS.CRM_VIEW)] }, async (request, reply) => {
    const { tenantId, userId } = (request as unknown as AuthedRequest).auth;
    const ctx = ctxFactory.create({ tenantId, userId, correlationId: (request.headers['x-correlation-id'] as string) ?? crypto.randomUUID() });
    const id = parseInt(request.params.id, 10);

    const [campaign] = await ctx.db.raw.select({ id: campaigns.id }).from(campaigns).where(and(eq(campaigns.id, id), eq(campaigns.tenantId, tenantId)));
    if (!campaign) throw new NotFoundError('Campaign', id);

    const stats = await CampaignService.getStats(ctx, id);
    return reply.code(200).send({ data: stats });
  });

  fastify.get<{ Params: { id: string } }>('/crm/campaigns/:id/recipients', { preHandler: [authenticate, requirePermission(PERMISSIONS.CRM_VIEW)] }, async (request, reply) => {
    const { tenantId, userId } = (request as unknown as AuthedRequest).auth;
    const ctx = ctxFactory.create({ tenantId, userId, correlationId: (request.headers['x-correlation-id'] as string) ?? crypto.randomUUID() });
    const id = parseInt(request.params.id, 10);

    const [campaign] = await ctx.db.raw.select({ id: campaigns.id }).from(campaigns).where(and(eq(campaigns.id, id), eq(campaigns.tenantId, tenantId)));
    if (!campaign) throw new NotFoundError('Campaign', id);

    const recipients = await CampaignService.listRecipients(ctx, id);
    return reply.code(200).send({ data: recipients });
  });

  // ════════════════════════════════════════════════════════════════════════
  // M9.6 — Birthday and Anniversary Automation
  // ════════════════════════════════════════════════════════════════════════

  fastify.get('/crm/campaigns/birthday-stats', { preHandler: [authenticate, requirePermission(PERMISSIONS.CRM_VIEW)] }, async (request, reply) => {
    const { tenantId, userId } = (request as unknown as AuthedRequest).auth;
    const ctx = ctxFactory.create({ tenantId, userId, correlationId: (request.headers['x-correlation-id'] as string) ?? crypto.randomUUID() });
    const query = request.query as { month?: string };
    const month = query.month ?? new Date().toISOString().slice(0, 7);
    const [year, mon] = month.split('-').map(Number);
    if (!year || !mon) throw new ValidationError('month must be in YYYY-MM format');
    const from = new Date(Date.UTC(year, mon - 1, 1));
    const to = new Date(Date.UTC(year, mon, 1));

    const rows = await ctx.db.raw
      .select({ status: notificationLog.status, count: sql<number>`count(*)::int` })
      .from(notificationLog)
      .where(and(eq(notificationLog.tenantId, tenantId), eq(notificationLog.eventType, 'BIRTHDAY_GREETING'), gte(notificationLog.createdAt, from), lte(notificationLog.createdAt, to)))
      .groupBy(notificationLog.status);

    const stats = { month, sent: 0, failed: 0, skipped: 0, pending: 0 };
    for (const row of rows) {
      if (row.status === 'SENT' || row.status === 'DELIVERED') stats.sent += row.count;
      else if (row.status === 'FAILED') stats.failed = row.count;
      else if (row.status === 'SKIPPED') stats.skipped = row.count;
      else stats.pending = row.count;
    }

    return reply.code(200).send({ data: stats });
  });

  // ════════════════════════════════════════════════════════════════════════
  // M9.7 — Festival Season Planner
  // ════════════════════════════════════════════════════════════════════════

  fastify.get('/crm/seasons', { preHandler: [authenticate, requirePermission(PERMISSIONS.CRM_SEASON_VIEW)] }, async (request, reply) => {
    const { tenantId, userId } = (request as unknown as AuthedRequest).auth;
    const ctx = ctxFactory.create({ tenantId, userId, correlationId: (request.headers['x-correlation-id'] as string) ?? crypto.randomUUID() });
    const rows = await ctx.db.raw.select().from(businessSeasons).where(eq(businessSeasons.tenantId, tenantId)).orderBy(sql`start_date DESC`);
    return reply.code(200).send({ data: { content: rows, totalElements: rows.length } });
  });

  fastify.get('/crm/seasons/active', { preHandler: [authenticate, requirePermission(PERMISSIONS.CRM_SEASON_VIEW)] }, async (request, reply) => {
    const { tenantId, userId } = (request as unknown as AuthedRequest).auth;
    const ctx = ctxFactory.create({ tenantId, userId, correlationId: (request.headers['x-correlation-id'] as string) ?? crypto.randomUUID() });
    const now = new Date();

    const [season] = await ctx.db.raw
      .select()
      .from(businessSeasons)
      .where(and(eq(businessSeasons.tenantId, tenantId), eq(businessSeasons.isActive, true), lte(businessSeasons.startDate, now), gte(businessSeasons.endDate, now)));

    return reply.code(200).send({ data: season ?? null });
  });

  fastify.post('/crm/seasons', { preHandler: [authenticate, requirePermission(PERMISSIONS.CRM_SEASON_MANAGE)] }, async (request, reply) => {
    const { tenantId, userId } = (request as unknown as AuthedRequest).auth;
    const ctx = ctxFactory.create({ tenantId, userId, correlationId: (request.headers['x-correlation-id'] as string) ?? crypto.randomUUID() });

    const body = SeasonSchema.safeParse(request.body);
    if (!body.success) throw new ValidationError(body.error.errors.map((e) => e.message).join('; '));
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

    await ctx.events.publish('business_season', created.id, 'SEASON_CREATED', created as unknown as Record<string, unknown>);
    await ctx.audit.log({ action: 'CREATE', entityType: 'business_season', entityId: created.id, after: created as unknown as Record<string, unknown> });

    return reply.code(201).send({ data: created });
  });

  fastify.put<{ Params: { id: string } }>('/crm/seasons/:id', { preHandler: [authenticate, requirePermission(PERMISSIONS.CRM_SEASON_MANAGE)] }, async (request, reply) => {
    const { tenantId, userId } = (request as unknown as AuthedRequest).auth;
    const ctx = ctxFactory.create({ tenantId, userId, correlationId: (request.headers['x-correlation-id'] as string) ?? crypto.randomUUID() });
    const id = parseInt(request.params.id, 10);

    const body = SeasonUpdateSchema.safeParse(request.body);
    if (!body.success) throw new ValidationError(body.error.errors.map((e) => e.message).join('; '));
    if (new Date(body.data.endDate) <= new Date(body.data.startDate)) {
      throw new BusinessError('INVALID_SEASON_DATES', 'endDate must be after startDate');
    }

    const [existing] = await ctx.db.raw.select().from(businessSeasons).where(and(eq(businessSeasons.id, id), eq(businessSeasons.tenantId, tenantId)));
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
      .where(and(eq(businessSeasons.id, id), eq(businessSeasons.tenantId, tenantId), eq(businessSeasons.version, body.data.version)))
      .returning();

    if (!updated) throw new OptimisticLockError('Season');

    await ctx.audit.log({ action: 'UPDATE', entityType: 'business_season', entityId: id, before: existing as unknown as Record<string, unknown>, after: updated as unknown as Record<string, unknown> });

    return reply.code(200).send({ data: updated });
  });
}
