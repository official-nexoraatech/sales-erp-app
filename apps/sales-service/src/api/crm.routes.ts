import type { FastifyInstance } from 'fastify';
import type { PlatformContextFactory } from '@erp/sdk';
import { tenantScopedHandler } from '@erp/sdk';
import {
  customers,
  customerInteractions,
  businessSeasons,
  tenantSenderIdentity,
  tenantCommunicationSettings,
  crmWhatsappCatalogOrders,
} from '@erp/db';
import { and, eq, gte, isNull, lte, sql } from 'drizzle-orm';
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

const InteractionSchema = z.object({
  type: z.enum(['VISIT', 'CALL', 'COMPLAINT', 'EMAIL', 'WHATSAPP', 'OTHER']),
  notes: z.string().min(1).max(2000),
  followUpDate: z.string().datetime().optional().or(z.literal('')),
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

// Phase 9 GUC-per-request rollout — migrated 2026-08-21. No external I/O anywhere in this file.
// Post-hoc ctx.audit.log()/ctx.events.publish()/ctx.cache.invalidate() calls are safe per caveat
// 4b. GET /crm/whatsapp-orders previously queried ctxFactory.rawDb directly with no tenant-scoped
// connection at all — this migration is the first time that route gets the GUC set for it.
export async function crmRoutes(
  fastify: FastifyInstance,
  ctxFactory: PlatformContextFactory
): Promise<void> {
  // ════════════════════════════════════════════════════════════════════════
  // M9.3 — Customer Interaction Log
  // ════════════════════════════════════════════════════════════════════════

  fastify.post(
    '/customers/:id/interactions',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.CRM_INTERACTION_CREATE)] },
    tenantScopedHandler(ctxFactory, async (request, reply, ctx) => {
      const { id: idParam } = request.params as { id: string };
      const customerId = parseInt(idParam, 10);

      const body = InteractionSchema.safeParse(request.body);
      if (!body.success)
        throw new ValidationError(body.error.errors.map((e) => e.message).join('; '));

      const [customer] = await ctx.db.raw
        .select({ id: customers.id })
        .from(customers)
        .where(
          and(
            eq(customers.id, customerId),
            eq(customers.tenantId, ctx.tenant.tenantId),
            isNull(customers.deletedAt)
          )
        );
      if (!customer) throw new NotFoundError('Customer', customerId);

      const [created] = await ctx.db.raw
        .insert(customerInteractions)
        .values({
          tenantId: ctx.tenant.tenantId,
          customerId,
          type: body.data.type,
          notes: body.data.notes,
          followUpDate: body.data.followUpDate ? new Date(body.data.followUpDate) : null,
          createdBy: ctx.tenant.userId,
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
    })
  );

  fastify.get(
    '/customers/:id/interactions',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.CRM_INTERACTION_VIEW)] },
    tenantScopedHandler(ctxFactory, async (request, reply, ctx) => {
      const { id: idParam } = request.params as { id: string };
      const customerId = parseInt(idParam, 10);

      const rows = await ctx.db.raw
        .select()
        .from(customerInteractions)
        .where(
          and(
            eq(customerInteractions.customerId, customerId),
            eq(customerInteractions.tenantId, ctx.tenant.tenantId)
          )
        )
        .orderBy(sql`created_at DESC`);

      return reply.code(200).send({ data: { content: rows, totalElements: rows.length } });
    })
  );

  // PUT /customers/:id/interactions/:interactionId — edit within 24h of creation (ES-18)
  fastify.put(
    '/customers/:id/interactions/:interactionId',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.CRM_INTERACTION_CREATE)] },
    tenantScopedHandler(ctxFactory, async (request, reply, ctx) => {
      const { id: idParam, interactionId: interactionIdParam } = request.params as {
        id: string;
        interactionId: string;
      };
      const customerId = parseInt(idParam, 10);
      const interactionId = parseInt(interactionIdParam, 10);

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
            eq(customerInteractions.tenantId, ctx.tenant.tenantId)
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
            eq(customerInteractions.tenantId, ctx.tenant.tenantId)
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
    })
  );

  // GET /crm/follow-ups — today's follow-up tasks for the logged-in user
  fastify.get(
    '/crm/follow-ups',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.CRM_INTERACTION_VIEW)] },
    tenantScopedHandler(ctxFactory, async (request, reply, ctx) => {
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
            eq(customerInteractions.tenantId, ctx.tenant.tenantId),
            eq(customerInteractions.followUpDone, false),
            gte(customerInteractions.followUpDate, startOfDay),
            lte(customerInteractions.followUpDate, endOfDay)
          )
        );

      return reply.code(200).send({ data: { content: rows, totalElements: rows.length } });
    })
  );

  // M9.2 — Customer Health Scoring: GET /crm/segments/health moved to crm-service
  // (apps/crm-service/src/api/health-scoring.routes.ts, CRM/O2C split 2026-08-20).
  // M9.4/M9.5/CP-4/CP-5/CP-7/M9.6 — Customer Segmentation, Campaign Management, Campaign
  // Templates, Automation Rules, Campaign Approval/Comments, and Birthday Automation all moved
  // to crm-service's campaign.routes.ts (CRM/O2C split 2026-08-20), alongside JourneyService's
  // journey.routes.ts — moved together since SegmentService.resolveWhere()/customWhere() return
  // an in-process Drizzle SQL fragment that only composes correctly when Segment/Campaign/
  // Journey share one process.

  // ════════════════════════════════════════════════════════════════════════
  // M9.7 — Festival Season Planner
  // ════════════════════════════════════════════════════════════════════════

  fastify.get(
    '/crm/seasons',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.CRM_SEASON_VIEW)] },
    tenantScopedHandler(ctxFactory, async (request, reply, ctx) => {
      const rows = await ctx.db.raw
        .select()
        .from(businessSeasons)
        .where(eq(businessSeasons.tenantId, ctx.tenant.tenantId))
        .orderBy(sql`start_date DESC`);
      return reply.code(200).send({ data: { content: rows, totalElements: rows.length } });
    })
  );

  fastify.get(
    '/crm/seasons/active',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.CRM_SEASON_VIEW)] },
    tenantScopedHandler(ctxFactory, async (request, reply, ctx) => {
      const now = new Date();

      const [season] = await ctx.db.raw
        .select()
        .from(businessSeasons)
        .where(
          and(
            eq(businessSeasons.tenantId, ctx.tenant.tenantId),
            eq(businessSeasons.isActive, true),
            lte(businessSeasons.startDate, now),
            gte(businessSeasons.endDate, now)
          )
        );

      return reply.code(200).send({ data: season ?? null });
    })
  );

  fastify.post(
    '/crm/seasons',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.CRM_SEASON_MANAGE)] },
    tenantScopedHandler(ctxFactory, async (request, reply, ctx) => {
      const body = SeasonSchema.safeParse(request.body);
      if (!body.success)
        throw new ValidationError(body.error.errors.map((e) => e.message).join('; '));
      if (new Date(body.data.endDate) <= new Date(body.data.startDate)) {
        throw new BusinessError('INVALID_SEASON_DATES', 'endDate must be after startDate');
      }

      const [created] = await ctx.db.raw
        .insert(businessSeasons)
        .values({
          tenantId: ctx.tenant.tenantId,
          name: body.data.name,
          seasonType: body.data.seasonType,
          startDate: new Date(body.data.startDate),
          endDate: new Date(body.data.endDate),
          stockMultiplier: String(body.data.stockMultiplier),
          loyaltyMultiplier: String(body.data.loyaltyMultiplier),
          salesTarget: String(body.data.salesTarget),
          isActive: body.data.isActive,
          createdBy: ctx.tenant.userId,
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
    })
  );

  fastify.put(
    '/crm/seasons/:id',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.CRM_SEASON_MANAGE)] },
    tenantScopedHandler(ctxFactory, async (request, reply, ctx) => {
      const { id: idParam } = request.params as { id: string };
      const id = parseInt(idParam, 10);

      const body = SeasonUpdateSchema.safeParse(request.body);
      if (!body.success)
        throw new ValidationError(body.error.errors.map((e) => e.message).join('; '));
      if (new Date(body.data.endDate) <= new Date(body.data.startDate)) {
        throw new BusinessError('INVALID_SEASON_DATES', 'endDate must be after startDate');
      }

      const [existing] = await ctx.db.raw
        .select()
        .from(businessSeasons)
        .where(and(eq(businessSeasons.id, id), eq(businessSeasons.tenantId, ctx.tenant.tenantId)));
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
            eq(businessSeasons.tenantId, ctx.tenant.tenantId),
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
    })
  );

  // Festival Intelligence AI (suggestion review) endpoints moved to crm-service's
  // festival-intelligence.routes.ts (CRM/O2C split). businessSeasons' direct CRUD above is
  // unaffected — that stays here, unrelated to the suggestion-review flow.

  // ════════════════════════════════════════════════════════════════════════
  // CP-5/CP-7 follow-up — Tenant Communication Settings (approval + frequency cap)
  // ════════════════════════════════════════════════════════════════════════
  // Gated on CRM_AUTOMATION_MANAGE — the closest existing "manage tenant-wide campaign
  // behavior" permission (this table already held frequencyCap since CP-5); not worth a new
  // permission constant + backfill migration for a single settings surface.

  fastify.get(
    '/crm/communication-settings',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.CRM_AUTOMATION_MANAGE)] },
    tenantScopedHandler(ctxFactory, async (request, reply, ctx) => {
      const [settings] = await ctx.db.raw
        .select()
        .from(tenantCommunicationSettings)
        .where(eq(tenantCommunicationSettings.tenantId, ctx.tenant.tenantId));

      return reply.code(200).send({
        data: {
          approvalRequired: settings?.approvalRequired ?? false,
          paymentReminderEnabled: settings?.paymentReminderEnabled ?? false,
          maxPerDayFrequencyCap: settings?.frequencyCap?.maxPerDay ?? null,
          notificationRateLimitPerMinute: settings?.notificationRateLimitPerMinute ?? null,
          costPerMessage: settings?.costPerMessage ?? null,
        },
      });
    })
  );

  fastify.put(
    '/crm/communication-settings',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.CRM_AUTOMATION_MANAGE)] },
    tenantScopedHandler(ctxFactory, async (request, reply, ctx) => {
      const body = CommunicationSettingsSchema.safeParse(request.body);
      if (!body.success)
        throw new ValidationError(body.error.errors.map((e) => e.message).join('; '));

      const [existing] = await ctx.db.raw
        .select()
        .from(tenantCommunicationSettings)
        .where(eq(tenantCommunicationSettings.tenantId, ctx.tenant.tenantId));

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
              tenantId: ctx.tenant.tenantId,
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
    })
  );

  // ════════════════════════════════════════════════════════════════════════
  // CP-8 — Tenant Sender Identity
  // ════════════════════════════════════════════════════════════════════════

  fastify.get(
    '/crm/sender-identity',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.CRM_SENDER_IDENTITY_MANAGE)] },
    tenantScopedHandler(ctxFactory, async (request, reply, ctx) => {
      const rows = await ctx.db.raw
        .select()
        .from(tenantSenderIdentity)
        .where(eq(tenantSenderIdentity.tenantId, ctx.tenant.tenantId));
      return reply.code(200).send({ data: { content: rows, totalElements: rows.length } });
    })
  );

  // Upsert — one row per (tenant, channel). A tenant configures each channel independently by
  // calling this once per channel; there is no separate create-vs-update distinction from the
  // caller's perspective.
  fastify.put(
    '/crm/sender-identity',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.CRM_SENDER_IDENTITY_MANAGE)] },
    tenantScopedHandler(ctxFactory, async (request, reply, ctx) => {
      const body = SenderIdentitySchema.safeParse(request.body);
      if (!body.success)
        throw new ValidationError(body.error.errors.map((e) => e.message).join('; '));

      const [existing] = await ctx.db.raw
        .select({ id: tenantSenderIdentity.id })
        .from(tenantSenderIdentity)
        .where(
          and(
            eq(tenantSenderIdentity.tenantId, ctx.tenant.tenantId),
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
              tenantId: ctx.tenant.tenantId,
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
    })
  );

  // CRM-ROADMAP Phase 4, Feature 2 (WhatsApp Commerce). Reuses QUOTATION_VIEW rather than a new
  // permission — this is just "which quotations came from WhatsApp," the same underlying
  // resource a caller already needs QUOTATION_VIEW to see at all. Minimal ERP-side surface per
  // the roadmap's own spec: an order-source indicator on the existing Quotations list, not a new
  // page.
  fastify.get(
    '/crm/whatsapp-orders',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.QUOTATION_VIEW)] },
    tenantScopedHandler(ctxFactory, async (request, reply, ctx) => {
      const rows = await ctx.db.raw
        .select({
          id: crmWhatsappCatalogOrders.id,
          customerId: crmWhatsappCatalogOrders.customerId,
          quotationId: crmWhatsappCatalogOrders.quotationId,
          status: crmWhatsappCatalogOrders.status,
          rejectionReason: crmWhatsappCatalogOrders.rejectionReason,
          createdAt: crmWhatsappCatalogOrders.createdAt,
        })
        .from(crmWhatsappCatalogOrders)
        .where(eq(crmWhatsappCatalogOrders.tenantId, ctx.tenant.tenantId));
      return reply.code(200).send({ data: { content: rows, totalElements: rows.length } });
    })
  );
}
