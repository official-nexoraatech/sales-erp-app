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
    channel: varchar('channel', { length: 20 }).notNull().$type<'SMS' | 'WHATSAPP' | 'EMAIL' | 'IN_APP'>(),
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
  },
  (t) => [
    index('idx_campaigns_tenant_status').on(t.tenantId, t.status, t.createdAt),
    index('idx_campaigns_scheduled').on(t.scheduledAt, t.status),
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
  },
  (t) => [
    index('idx_campaign_recipients_campaign').on(t.campaignId, t.status),
    index('idx_campaign_recipients_customer').on(t.customerId, t.tenantId),
  ]
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
    loyaltyMultiplier: decimal('loyalty_multiplier', { precision: 5, scale: 2 }).notNull().default('1'),
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
export type BusinessSeason = typeof businessSeasons.$inferSelect;
export type NewBusinessSeason = typeof businessSeasons.$inferInsert;
