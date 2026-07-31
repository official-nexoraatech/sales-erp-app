import {
  bigserial,
  index,
  integer,
  jsonb,
  pgTable,
  timestamp,
  unique,
  varchar,
} from 'drizzle-orm/pg-core';

// ─── Digital Adoption Platform: Tour Progress ──────────────────────────────
// One row per (tenant, user, tour) — upserted as the user advances. `tourVersion` records
// which content version they're progressing through/completed, so a later content bump can
// offer a "What's New" prompt instead of forcing a full replay (see
// ERP-PLANNING/DAP-Planning/01_ARCHITECTURE.md §6). Owned by event-service (ADR-3: DAP
// telemetry is a platform capability, not a business domain — same rationale as this file's
// event-service siblings in distributed.ts). Mirrored to localStorage by the frontend for
// instant resume; this table is the cross-device source of truth.
export const tourProgress = pgTable(
  'tour_progress',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    tenantId: integer('tenant_id').notNull(),
    userId: integer('user_id').notNull(),
    tourId: varchar('tour_id', { length: 100 }).notNull(),
    tourVersion: integer('tour_version').notNull(),
    status: varchar('status', { length: 20 })
      .notNull()
      .default('in_progress')
      .$type<'in_progress' | 'completed' | 'skipped'>(),
    currentStepId: varchar('current_step_id', { length: 100 }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    unique('tour_progress_tenant_user_tour').on(t.tenantId, t.userId, t.tourId),
    index('idx_tour_progress_tenant_user').on(t.tenantId, t.userId),
  ]
);

// ─── Digital Adoption Platform: Tour Events ────────────────────────────────
// Append-only interaction log — direct write, not outbox/Kafka (ADR-3: wrong weight class
// for per-step UI telemetry; follows search_analytics's proven direct-write shape instead).
// Powers the DAP-2 analytics summary (drop-off-by-step, completion time, most-replayed) —
// this table ships in DAP-1 so the write path is proven; the aggregate read endpoint is DAP-2.
export const tourEvents = pgTable(
  'tour_events',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    tenantId: integer('tenant_id').notNull(),
    userId: integer('user_id').notNull(),
    tourId: varchar('tour_id', { length: 100 }).notNull(),
    tourVersion: integer('tour_version').notNull(),
    stepId: varchar('step_id', { length: 100 }),
    eventType: varchar('event_type', { length: 30 })
      .notNull()
      .$type<
        | 'tour_started'
        | 'step_viewed'
        | 'step_completed'
        | 'tour_completed'
        | 'tour_skipped'
        | 'tour_abandoned'
      >(),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).defaultNow().notNull(),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().default({}),
  },
  (t) => [
    index('idx_tour_events_tenant_tour').on(t.tenantId, t.tourId, t.occurredAt),
    index('idx_tour_events_tenant_user').on(t.tenantId, t.userId, t.occurredAt),
  ]
);

export type TourProgress = typeof tourProgress.$inferSelect;
export type NewTourProgress = typeof tourProgress.$inferInsert;
export type TourEvent = typeof tourEvents.$inferSelect;
export type NewTourEvent = typeof tourEvents.$inferInsert;
