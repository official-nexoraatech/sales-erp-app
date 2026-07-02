import {
  bigserial,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  varchar,
} from 'drizzle-orm/pg-core';

// ─── Event Store ───────────────────────────────────────────────────────────────
// Append-only log of all domain events (M12.1)
// NOTE: In production this table should be PARTITIONED BY RANGE(occurred_at)
// For dev we create it as a regular table and partition via application logic.
export const eventStore = pgTable(
  'event_store',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    eventId: varchar('event_id', { length: 36 }).notNull(),
    eventType: varchar('event_type', { length: 100 }).notNull(),
    aggregateType: varchar('aggregate_type', { length: 100 }).notNull(),
    aggregateId: varchar('aggregate_id', { length: 100 }).notNull(),
    aggregateVersion: integer('aggregate_version').notNull(),
    tenantId: integer('tenant_id').notNull(),
    schemaVersion: integer('schema_version').notNull().default(1),
    payload: jsonb('payload').notNull(),
    metadata: jsonb('metadata').notNull().default({}),
    correlationId: varchar('correlation_id', { length: 36 }),
    causationId: varchar('causation_id', { length: 36 }),
    userId: integer('user_id'),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).defaultNow().notNull(),
    indexedAt: timestamp('indexed_at', { withTimezone: true }),
  },
  (t) => [
    unique('event_store_aggregate_version').on(t.aggregateType, t.aggregateId, t.aggregateVersion, t.tenantId),
    index('idx_es_tenant_aggregate').on(t.tenantId, t.aggregateType, t.aggregateId, t.occurredAt),
    index('idx_es_event_type').on(t.tenantId, t.eventType, t.occurredAt),
    index('idx_es_correlation').on(t.correlationId),
    index('idx_es_occurred_at').on(t.occurredAt),
  ]
);

// ─── Event Snapshots ──────────────────────────────────────────────────────────
// Aggregate state snapshot every N events (M12.1 — snapshot policy: every 50 events)
export const eventSnapshots = pgTable(
  'event_snapshots',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    aggregateType: varchar('aggregate_type', { length: 100 }).notNull(),
    aggregateId: varchar('aggregate_id', { length: 100 }).notNull(),
    tenantId: integer('tenant_id').notNull(),
    version: integer('version').notNull(),
    state: jsonb('state').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    unique('snapshot_latest').on(t.tenantId, t.aggregateType, t.aggregateId),
    index('idx_snapshot_aggregate').on(t.aggregateType, t.aggregateId, t.tenantId),
  ]
);

// ─── DLQ Items ────────────────────────────────────────────────────────────────
// Dead Letter Queue — messages that failed processing after max retries (M12.4)
export const dlqItems = pgTable(
  'dlq_items',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    topic: varchar('topic', { length: 200 }).notNull(),
    partition: integer('partition').notNull().default(0),
    offset: varchar('offset', { length: 50 }).notNull().default('0'),
    payload: jsonb('payload').notNull(),
    headers: jsonb('headers').notNull().default({}),
    errorMessage: text('error_message').notNull(),
    retryCount: integer('retry_count').notNull().default(0),
    status: varchar('status', { length: 20 })
      .notNull()
      .default('PENDING')
      .$type<'PENDING' | 'REPLAYED' | 'DISCARDED'>(),
    tenantId: integer('tenant_id'),
    lastRetriedAt: timestamp('last_retried_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index('idx_dlq_topic_status').on(t.topic, t.status, t.createdAt),
    index('idx_dlq_status').on(t.status, t.createdAt),
    index('idx_dlq_tenant').on(t.tenantId, t.status),
  ]
);

// ─── Schema Registry ──────────────────────────────────────────────────────────
// Event schema catalog with compatibility checking (M12.6)
export const schemaRegistryTable = pgTable(
  'schema_registry',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    eventType: varchar('event_type', { length: 100 }).notNull(),
    schemaVersion: integer('schema_version').notNull(),
    jsonSchema: jsonb('json_schema').notNull(),
    compatibilityMode: varchar('compatibility_mode', { length: 20 })
      .notNull()
      .default('BACKWARD')
      .$type<'BACKWARD' | 'FORWARD' | 'FULL' | 'NONE'>(),
    description: text('description'),
    registeredBy: varchar('registered_by', { length: 100 }),
    registeredAt: timestamp('registered_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    unique('schema_registry_type_version').on(t.eventType, t.schemaVersion),
    index('idx_schema_registry_type').on(t.eventType, t.schemaVersion),
  ]
);

// ─── Projection Metadata ───────────────────────────────────────────────────────
// Tracks last update time and lag for each CQRS projection (M12.2)
export const projectionMetadata = pgTable(
  'projection_metadata',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    projectionName: varchar('projection_name', { length: 100 }).notNull(),
    tenantId: integer('tenant_id'),
    lastEventId: varchar('last_event_id', { length: 36 }),
    lastUpdatedAt: timestamp('last_updated_at', { withTimezone: true }).defaultNow().notNull(),
    lastEventOccurredAt: timestamp('last_event_occurred_at', { withTimezone: true }),
    status: varchar('status', { length: 20 })
      .notNull()
      .default('UP_TO_DATE')
      .$type<'UP_TO_DATE' | 'REBUILDING' | 'STALE' | 'ERROR'>(),
    errorMessage: text('error_message'),
    rebuildStartedAt: timestamp('rebuild_started_at', { withTimezone: true }),
    rebuildCompletedAt: timestamp('rebuild_completed_at', { withTimezone: true }),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    unique('proj_meta_name_tenant').on(t.projectionName, t.tenantId),
    index('idx_proj_meta_name').on(t.projectionName),
  ]
);

// ─── Performance Profiles ─────────────────────────────────────────────────────
// Stores P95 latency measurements for key endpoints (M12.7)
export const performanceProfiles = pgTable(
  'performance_profiles',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    endpoint: varchar('endpoint', { length: 200 }).notNull(),
    method: varchar('method', { length: 10 }).notNull(),
    p50Ms: integer('p50_ms'),
    p95Ms: integer('p95_ms'),
    p99Ms: integer('p99_ms'),
    sampleCount: integer('sample_count').notNull().default(0),
    targetP95Ms: integer('target_p95_ms'),
    measuredAt: timestamp('measured_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index('idx_perf_endpoint').on(t.endpoint, t.method, t.measuredAt),
  ]
);

export type EventStoreEntry = typeof eventStore.$inferInsert;
export type EventSnapshot = typeof eventSnapshots.$inferInsert;
export type DlqItem = typeof dlqItems.$inferSelect;
export type NewDlqItem = typeof dlqItems.$inferInsert;
export type SchemaRegistryEntry = typeof schemaRegistryTable.$inferSelect;
export type NewSchemaRegistryEntry = typeof schemaRegistryTable.$inferInsert;
export type ProjectionMetadata = typeof projectionMetadata.$inferSelect;
export type NewProjectionMetadata = typeof projectionMetadata.$inferInsert;
export type PerformanceProfile = typeof performanceProfiles.$inferInsert;
