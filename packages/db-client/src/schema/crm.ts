import {
  bigserial,
  boolean,
  decimal,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  varchar,
} from 'drizzle-orm/pg-core';

// ─── Customer Interactions (M9.3) ──────────────────────────────────────────
export const customerInteractions = pgTable(
  'customer_interactions',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    tenantId: integer('tenant_id').notNull(),
    customerId: integer('customer_id').notNull(),
    type: varchar('type', { length: 20 })
      .notNull()
      .$type<'VISIT' | 'CALL' | 'COMPLAINT' | 'EMAIL' | 'WHATSAPP' | 'OTHER' | 'SYSTEM'>(),
    notes: text('notes').notNull(),
    followUpDate: timestamp('follow_up_date', { withTimezone: true }),
    followUpDone: boolean('follow_up_done').notNull().default(false),
    createdBy: integer('created_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }),
  },
  (t) => [
    index('idx_cust_interactions_customer').on(t.customerId, t.tenantId, t.createdAt),
    index('idx_cust_interactions_followup').on(t.followUpDate, t.followUpDone, t.tenantId),
    index('idx_cust_interactions_created_by').on(t.createdBy, t.tenantId),
  ]
);

// ─── Customer Segments (M9.4) ──────────────────────────────────────────────
export const customerSegments = pgTable(
  'customer_segments',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    tenantId: integer('tenant_id').notNull(),
    name: varchar('name', { length: 200 }).notNull(),
    code: varchar('code', { length: 60 }).notNull(),
    isSystem: boolean('is_system').notNull().default(false),
    filterDefinition: jsonb('filter_definition').$type<{
      rules: Array<{ field: string; operator: string; value: unknown }>;
      logic: 'AND' | 'OR';
    }>(),
    description: text('description'),
    createdBy: integer('created_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    unique('customer_segments_tenant_code').on(t.tenantId, t.code),
    index('idx_customer_segments_tenant').on(t.tenantId, t.isSystem),
  ]
);

// ─── Campaigns (M9.5) ───────────────────────────────────────────────────────
export const campaigns = pgTable(
  'campaigns',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    tenantId: integer('tenant_id').notNull(),
    name: varchar('name', { length: 200 }).notNull(),
    segmentId: integer('segment_id'),
    customerIds: jsonb('customer_ids').$type<number[]>(),
    channel: varchar('channel', { length: 20 })
      .notNull()
      .$type<'SMS' | 'WHATSAPP' | 'EMAIL' | 'IN_APP'>(),
    messageTemplate: text('message_template').notNull(),
    status: varchar('status', { length: 20 })
      .notNull()
      .default('DRAFT')
      .$type<'DRAFT' | 'SCHEDULED' | 'SENDING' | 'SENT' | 'CANCELLED' | 'FAILED'>(),
    scheduledAt: timestamp('scheduled_at', { withTimezone: true }),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    totalRecipients: integer('total_recipients').notNull().default(0),
    sentCount: integer('sent_count').notNull().default(0),
    deliveredCount: integer('delivered_count').notNull().default(0),
    failedCount: integer('failed_count').notNull().default(0),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    createdBy: integer('created_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    version: integer('version').notNull().default(0),
    // CP-4 (Campaign Management Platform initiative): campaign type taxonomy (tenant-configurable
    // metadata, not an enum), optional template linkage, and last-edit timestamp.
    campaignType: varchar('campaign_type', { length: 50 }),
    templateId: integer('template_id'),
    lastEditedAt: timestamp('last_edited_at', { withTimezone: true }),
    // CP-5: recurring-campaign support — a definition row has recurrenceRule set; each firing
    // creates its own concrete campaign row with parentRecurringCampaignId set.
    recurrenceRule: jsonb('recurrence_rule').$type<{
      frequency: 'DAILY' | 'WEEKLY' | 'MONTHLY';
      interval: number;
      endDate?: string;
      occurrences?: number;
    }>(),
    timezone: varchar('timezone', { length: 50 }),
    parentRecurringCampaignId: integer('parent_recurring_campaign_id'),
  },
  (t) => [
    index('idx_campaigns_tenant_status').on(t.tenantId, t.status, t.createdAt),
    index('idx_campaigns_scheduled').on(t.scheduledAt, t.status),
    index('idx_campaigns_parent_recurring').on(t.parentRecurringCampaignId),
  ]
);

export const campaignRecipients = pgTable(
  'campaign_recipients',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    tenantId: integer('tenant_id').notNull(),
    campaignId: integer('campaign_id').notNull(),
    customerId: integer('customer_id').notNull(),
    status: varchar('status', { length: 20 })
      .notNull()
      .default('PENDING')
      .$type<'PENDING' | 'SENT' | 'DELIVERED' | 'FAILED'>(),
    notificationLogId: integer('notification_log_id'),
    errorMessage: text('error_message'),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    // CP-6: engagement/attribution timestamps. Only deliveredAt is populated this phase (via the
    // webhook -> outbox -> consumer path); opened/clicked/converted are reserved for later CP-6
    // scope (click/open tracking, revenue attribution — deferred, see CP-6 completion report).
    deliveredAt: timestamp('delivered_at', { withTimezone: true }),
    openedAt: timestamp('opened_at', { withTimezone: true }),
    clickedAt: timestamp('clicked_at', { withTimezone: true }),
    convertedAt: timestamp('converted_at', { withTimezone: true }),
  },
  (t) => [
    index('idx_campaign_recipients_campaign').on(t.campaignId, t.status),
    index('idx_campaign_recipients_customer').on(t.customerId, t.tenantId),
  ]
);

// ─── Campaign Templates (CP-4) ──────────────────────────────────────────────
// Reusable, versioned campaign message templates — distinct from notificationTemplates (which
// backs transactional event notifications, not campaign broadcast authoring).
export const campaignTemplates = pgTable(
  'campaign_templates',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    tenantId: integer('tenant_id').notNull(),
    name: varchar('name', { length: 200 }).notNull(),
    category: varchar('category', { length: 50 }),
    campaignType: varchar('campaign_type', { length: 50 }),
    channel: varchar('channel', { length: 20 })
      .notNull()
      .$type<'SMS' | 'WHATSAPP' | 'EMAIL' | 'IN_APP'>(),
    messageTemplate: text('message_template').notNull(),
    createdBy: integer('created_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    version: integer('version').notNull().default(0),
  },
  (t) => [index('idx_campaign_templates_tenant').on(t.tenantId, t.channel)]
);

// ─── Campaign History (CP-4) ────────────────────────────────────────────────
// Lifecycle/edit audit trail — who did what to a campaign, when, and (for edits) a diff of what
// changed.
export const campaignHistory = pgTable(
  'campaign_history',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    tenantId: integer('tenant_id').notNull(),
    campaignId: integer('campaign_id').notNull(),
    actorId: integer('actor_id').notNull(),
    action: varchar('action', { length: 30 }).notNull(),
    fromStatus: varchar('from_status', { length: 20 }),
    toStatus: varchar('to_status', { length: 20 }),
    diff: jsonb('diff').$type<Record<string, unknown>>(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index('idx_campaign_history_campaign').on(t.campaignId, t.createdAt)]
);

// ─── Tenant Communication Settings (CP-5) ───────────────────────────────────
// This phase only populates/enforces frequencyCap; businessHours/quietHours columns exist
// (nullable) for a later phase to populate without another migration (SH-07/SH-08, deferred).
export const tenantCommunicationSettings = pgTable(
  'tenant_communication_settings',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    tenantId: integer('tenant_id').notNull(),
    frequencyCap: jsonb('frequency_cap').$type<{ maxPerDay?: number }>(),
    businessHours: jsonb('business_hours').$type<{ startHour: number; endHour: number }>(),
    quietHours: jsonb('quiet_hours').$type<{ startHour: number; endHour: number }>(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [unique('tenant_communication_settings_tenant_unique').on(t.tenantId)]
);

// ─── Campaign Automation Rules (CP-5) ───────────────────────────────────────
// Trigger-based automation — each enabled rule is evaluated by a scheduler-service cron job,
// which creates a real campaign row per firing (same CampaignService.send() path as a manual
// campaign) rather than sending outside the campaigns table.
export const campaignAutomationRules = pgTable(
  'campaign_automation_rules',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    tenantId: integer('tenant_id').notNull(),
    triggerType: varchar('trigger_type', { length: 50 })
      .notNull()
      .$type<'BIRTHDAY' | 'INACTIVITY' | 'ANNIVERSARY'>(),
    enabled: boolean('enabled').notNull().default(true),
    channel: varchar('channel', { length: 20 })
      .notNull()
      .$type<'SMS' | 'WHATSAPP' | 'EMAIL' | 'IN_APP'>(),
    templateId: integer('template_id'),
    messageTemplate: text('message_template'),
    conditions: jsonb('conditions').$type<Record<string, unknown>>(),
    lastFiredAt: timestamp('last_fired_at', { withTimezone: true }),
    createdBy: integer('created_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    version: integer('version').notNull().default(0),
  },
  (t) => [index('idx_campaign_automation_rules_tenant').on(t.tenantId, t.enabled, t.triggerType)]
);

// ─── Business Seasons — Festival Planner (M9.7) ────────────────────────────
export const businessSeasons = pgTable(
  'business_seasons',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    tenantId: integer('tenant_id').notNull(),
    name: varchar('name', { length: 200 }).notNull(),
    seasonType: varchar('season_type', { length: 30 })
      .notNull()
      .$type<'FESTIVAL_SEASON' | 'WEDDING_SEASON' | 'SUMMER_COLLECTION' | 'YEAR_END_SALE'>(),
    startDate: timestamp('start_date', { withTimezone: true }).notNull(),
    endDate: timestamp('end_date', { withTimezone: true }).notNull(),
    stockMultiplier: decimal('stock_multiplier', { precision: 5, scale: 2 }).notNull().default('1'),
    loyaltyMultiplier: decimal('loyalty_multiplier', { precision: 5, scale: 2 })
      .notNull()
      .default('1'),
    salesTarget: decimal('sales_target', { precision: 15, scale: 2 }).notNull().default('0'),
    activeDiscountRuleIds: jsonb('active_discount_rule_ids').$type<number[]>().default([]),
    isActive: boolean('is_active').notNull().default(true),
    createdBy: integer('created_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    version: integer('version').notNull().default(0),
  },
  (t) => [
    index('idx_business_seasons_tenant_active').on(t.tenantId, t.isActive, t.startDate, t.endDate),
  ]
);

// ─── Type Exports ──────────────────────────────────────────────────────────────
export type CustomerInteraction = typeof customerInteractions.$inferSelect;
export type NewCustomerInteraction = typeof customerInteractions.$inferInsert;
export type CustomerSegment = typeof customerSegments.$inferSelect;
export type NewCustomerSegment = typeof customerSegments.$inferInsert;
export type Campaign = typeof campaigns.$inferSelect;
export type NewCampaign = typeof campaigns.$inferInsert;
export type CampaignRecipient = typeof campaignRecipients.$inferSelect;
export type NewCampaignRecipient = typeof campaignRecipients.$inferInsert;
export type CampaignTemplate = typeof campaignTemplates.$inferSelect;
export type NewCampaignTemplate = typeof campaignTemplates.$inferInsert;
export type CampaignHistory = typeof campaignHistory.$inferSelect;
export type NewCampaignHistory = typeof campaignHistory.$inferInsert;
export type TenantCommunicationSettings = typeof tenantCommunicationSettings.$inferSelect;
export type NewTenantCommunicationSettings = typeof tenantCommunicationSettings.$inferInsert;
export type CampaignAutomationRule = typeof campaignAutomationRules.$inferSelect;
export type NewCampaignAutomationRule = typeof campaignAutomationRules.$inferInsert;
export type BusinessSeason = typeof businessSeasons.$inferSelect;
export type NewBusinessSeason = typeof businessSeasons.$inferInsert;
