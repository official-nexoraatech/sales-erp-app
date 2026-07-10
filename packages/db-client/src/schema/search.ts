import { bigserial, index, integer, jsonb, pgTable, timestamp, varchar } from 'drizzle-orm/pg-core';

// ─── Saved Searches (Phase 6) ──────────────────────────────────────────────
// A user-named {query, filters} combination they can re-run from the command palette's
// Saved Searches section. Owned by search-service (its first-ever table beyond the shared
// dlq_items it already writes to).
export const savedSearches = pgTable(
  'saved_searches',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    tenantId: integer('tenant_id').notNull(),
    userId: integer('user_id').notNull(),
    name: varchar('name', { length: 100 }).notNull(),
    query: varchar('query', { length: 200 }).notNull(),
    entity: varchar('entity', { length: 50 }),
    filters: jsonb('filters').$type<Record<string, unknown>>().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index('idx_saved_searches_tenant_user').on(t.tenantId, t.userId, t.createdAt),
  ]
);

export type SavedSearch = typeof savedSearches.$inferSelect;
export type NewSavedSearch = typeof savedSearches.$inferInsert;

// ─── Search Analytics (Phase 8) ────────────────────────────────────────────
// One row per GET /search call — powers the "popular searches / no-result searches /
// latency" admin view. Click-through is recorded via a follow-up PATCH from the frontend
// once the user actually opens a result (see search-analytics.routes.ts).
export const searchAnalytics = pgTable(
  'search_analytics',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    tenantId: integer('tenant_id').notNull(),
    userId: integer('user_id').notNull(),
    query: varchar('query', { length: 200 }).notNull(),
    entity: varchar('entity', { length: 50 }),
    resultCount: integer('result_count').notNull(),
    latencyMs: integer('latency_ms').notNull(),
    clickedResultId: varchar('clicked_result_id', { length: 100 }),
    clickedEntity: varchar('clicked_entity', { length: 50 }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index('idx_search_analytics_tenant_created').on(t.tenantId, t.createdAt),
    index('idx_search_analytics_tenant_query').on(t.tenantId, t.query),
  ]
);

export type SearchAnalyticsEvent = typeof searchAnalytics.$inferSelect;
export type NewSearchAnalyticsEvent = typeof searchAnalytics.$inferInsert;
