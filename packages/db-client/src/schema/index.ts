import {
  bigint,
  bigserial,
  boolean,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  varchar,
} from 'drizzle-orm/pg-core';

// ─── Outbox Events (Transactional Outbox Pattern) ──────────────────────────
// Events written in the same DB transaction as business data — never published directly
export const outboxEvents = pgTable(
  'outbox_events',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    eventId: varchar('event_id', { length: 26 }).notNull(),
    eventType: varchar('event_type', { length: 100 }).notNull(),
    aggregateType: varchar('aggregate_type', { length: 100 }).notNull(),
    aggregateId: integer('aggregate_id').notNull(),
    tenantId: integer('tenant_id').notNull(),
    payload: jsonb('payload').notNull(),
    published: boolean('published').notNull().default(false),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    retryCount: integer('retry_count').notNull().default(0),
    failed: boolean('failed').notNull().default(false),
    failedReason: text('failed_reason'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    unique('outbox_events_event_id_unique').on(t.eventId),
    index('idx_outbox_unpublished').on(t.published, t.createdAt),
    index('idx_outbox_tenant').on(t.tenantId, t.createdAt),
  ]
);

// ─── Inbox Events (Consumer Idempotency) ─────────────────────────────────
export const inboxEvents = pgTable(
  'inbox_events',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    eventId: varchar('event_id', { length: 26 }).notNull(),
    consumerService: varchar('consumer_service', { length: 100 }).notNull(),
    status: varchar('status', { length: 20 })
      .notNull()
      .default('PROCESSING')
      .$type<'PROCESSING' | 'PROCESSED' | 'FAILED'>(),
    tenantId: integer('tenant_id').notNull(),
    errorMessage: text('error_message'),
    processedAt: timestamp('processed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    unique('inbox_events_idempotency').on(t.eventId, t.consumerService),
    index('idx_inbox_status').on(t.status, t.createdAt),
  ]
);

// ─── Audit Log (Append-only — never UPDATE/DELETE per §13 rule 4) ─────────
export const auditLog = pgTable(
  'audit_log',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    tenantId: integer('tenant_id').notNull(),
    userId: integer('user_id').notNull(),
    action: varchar('action', { length: 200 }).notNull(),
    entityType: varchar('entity_type', { length: 100 }).notNull(),
    entityId: integer('entity_id'),
    beforeData: jsonb('before_data'),
    afterData: jsonb('after_data'),
    metadata: jsonb('metadata'),
    actorEmail: varchar('actor_email', { length: 255 }),
    ipAddress: varchar('ip_address', { length: 45 }),
    changedFields: text('changed_fields').array(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index('idx_audit_log_tenant_created').on(t.tenantId, t.createdAt),
    index('idx_audit_log_entity').on(t.entityType, t.entityId, t.tenantId),
  ]
);

// ─── Feature Flags ─────────────────────────────────────────────────────────
export const featureFlags = pgTable(
  'feature_flags',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    tenantId: integer('tenant_id'),
    flagKey: varchar('flag_key', { length: 200 }).notNull(),
    enabled: boolean('enabled').notNull().default(false),
    config: jsonb('config'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    unique('feature_flags_tenant_key').on(t.tenantId, t.flagKey),
    index('idx_feature_flags_tenant').on(t.tenantId, t.flagKey),
  ]
);

// ─── Saga Log ──────────────────────────────────────────────────────────────
export const sagaLog = pgTable(
  'saga_log',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    sagaId: varchar('saga_id', { length: 36 }).notNull(),
    sagaType: varchar('saga_type', { length: 100 }).notNull(),
    tenantId: integer('tenant_id').notNull(),
    correlationId: varchar('correlation_id', { length: 36 }).notNull(),
    status: varchar('status', { length: 20 })
      .notNull()
      .default('STARTED')
      .$type<'STARTED' | 'COMPLETED' | 'COMPENSATING' | 'COMPENSATED' | 'FAILED'>(),
    currentStep: integer('current_step').notNull().default(0),
    stepHistory: jsonb('step_history').notNull().default([]),
    payload: jsonb('payload').notNull().default({}),
    error: text('error'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index('idx_saga_log_tenant_status').on(t.tenantId, t.status, t.createdAt),
    index('idx_saga_log_correlation').on(t.correlationId),
  ]
);

// ─── Usage Events (PG-028, tenant-scoped, append-only) ─────────────────────
// Raw per-action record fed by the outbox pattern (see PlatformEventBus). `quantity` lets
// a high-volume action (e.g. USAGE_API_CALL_BATCH) carry a batched count in one row instead
// of one row per occurrence. Never queried directly for dashboard display — only by the
// nightly rollup job and for drill-down/audit; usage_summary is what the dashboard reads.
export const usageEvents = pgTable(
  'usage_events',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    tenantId: integer('tenant_id').notNull(),
    eventType: varchar('event_type', { length: 50 }).notNull(),
    quantity: integer('quantity').notNull().default(1),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).defaultNow().notNull(),
    metadata: jsonb('metadata'),
  },
  (t) => [index('idx_usage_events_tenant_period').on(t.tenantId, t.occurredAt)]
);

// ─── Usage Summary (PG-028, tenant-scoped) ──────────────────────────────────
// One row per tenant per calendar month, upserted nightly by the usage-rollup scheduler
// job — the only table the platform-admin usage dashboard reads from.
export const usageSummary = pgTable(
  'usage_summary',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    tenantId: integer('tenant_id').notNull(),
    periodStart: date('period_start').notNull(),
    periodEnd: date('period_end').notNull(),
    invoiceCount: integer('invoice_count').notNull().default(0),
    activeUserCount: integer('active_user_count').notNull().default(0),
    storageBytes: bigint('storage_bytes', { mode: 'number' }).notNull().default(0),
    apiCallCount: bigint('api_call_count', { mode: 'number' }).notNull().default(0),
    computedAt: timestamp('computed_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [unique('usage_summary_tenant_period').on(t.tenantId, t.periodStart)]
);

// ─── FAQ Items (platform marketing content — global, no tenant_id) ─────────
// Backs the public marketing site's FAQ section (previously a hardcoded array in
// FAQSection.tsx). Global, not tenant-scoped: this is platform content, not a
// per-tenant configurable thing — mirrors plan_entitlements' "global template" shape
// rather than campaignTemplates' tenant-scoped one. sortOrder/version/isPublished follow
// this codebase's existing conventions (items.ts categories/brands/units for sortOrder,
// notificationTemplates for the isActive-style publish flag, nearly every mutable table
// for the optimistic-lock version column).
export const faqItems = pgTable(
  'faq_items',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    category: varchar('category', { length: 100 }).notNull(),
    question: text('question').notNull(),
    answer: text('answer').notNull(),
    sortOrder: integer('sort_order').notNull().default(0),
    isPublished: boolean('is_published').notNull().default(true),
    version: integer('version').notNull().default(0),
    createdBy: integer('created_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index('idx_faq_items_published_sort').on(t.isPublished, t.sortOrder),
    index('idx_faq_items_category').on(t.category, t.sortOrder),
  ]
);

export type FaqItem = typeof faqItems.$inferSelect;
export type NewFaqItem = typeof faqItems.$inferInsert;

export type OutboxEvent = typeof outboxEvents.$inferInsert;
export type InboxEvent = typeof inboxEvents.$inferInsert;
export type AuditLogEntry = typeof auditLog.$inferInsert;
export type FeatureFlag = typeof featureFlags.$inferSelect;
export type SagaLogEntry = typeof sagaLog.$inferInsert;
export type UsageEvent = typeof usageEvents.$inferSelect;
export type NewUsageEvent = typeof usageEvents.$inferInsert;
export type UsageSummary = typeof usageSummary.$inferSelect;
export type NewUsageSummary = typeof usageSummary.$inferInsert;

export * from './auth.js';
export * from './tenant.js';
export * from './workflow.js';
export * from './notification.js';
export * from './report.js';
export * from './scheduler.js';
export * from './rules.js';
export * from './master.js';
export * from './items.js';
export * from './gst.js';
export * from './accounting.js';
export * from './inventory.js';
export * from './sales.js';
export * from './purchase.js';
export * from './hr.js';
export * from './crm.js';
export * from './production.js';
export * from './distributed.js';
export * from './document-attachments.js';
export * from './search.js';
