// Drizzle-kit entry point — uses paths without .js extensions so drizzle-kit's CJS bundler resolves them
export * from './src/schema/auth';
export * from './src/schema/tenant';
export * from './src/schema/workflow';
export * from './src/schema/notification';
export * from './src/schema/report';
export * from './src/schema/scheduler';
export * from './src/schema/rules';
export * from './src/schema/master';
export * from './src/schema/items';
export * from './src/schema/gst';
export * from './src/schema/accounting';
export * from './src/schema/inventory';
export * from './src/schema/sales';
export * from './src/schema/production';
export * from './src/schema/purchase';

// Platform tables defined inline in src/schema/index.ts
import {
  bigserial,
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  varchar,
} from 'drizzle-orm/pg-core';

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
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    unique('outbox_events_event_id_unique').on(t.eventId),
    index('idx_outbox_unpublished').on(t.published, t.createdAt),
    index('idx_outbox_tenant').on(t.tenantId, t.createdAt),
  ]
);

export const inboxEvents = pgTable(
  'inbox_events',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    eventId: varchar('event_id', { length: 26 }).notNull(),
    consumerService: varchar('consumer_service', { length: 100 }).notNull(),
    status: varchar('status', { length: 20 }).notNull().default('PROCESSING'),
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
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index('idx_audit_log_tenant_created').on(t.tenantId, t.createdAt),
    index('idx_audit_log_entity').on(t.entityType, t.entityId, t.tenantId),
  ]
);

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

export const sagaLog = pgTable(
  'saga_log',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    sagaId: varchar('saga_id', { length: 36 }).notNull(),
    sagaType: varchar('saga_type', { length: 100 }).notNull(),
    tenantId: integer('tenant_id').notNull(),
    correlationId: varchar('correlation_id', { length: 36 }).notNull(),
    status: varchar('status', { length: 20 }).notNull().default('STARTED'),
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
