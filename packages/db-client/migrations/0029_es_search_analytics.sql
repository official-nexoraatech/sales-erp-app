-- Global Search Phase 8 — one row per GET /search call, powering the popular/no-result/
-- latency admin analytics view. clicked_result_id/clicked_entity are filled in later via a
-- follow-up call when the user actually opens a result.

CREATE TABLE IF NOT EXISTS "search_analytics" (
  "id" bigserial PRIMARY KEY NOT NULL,
  "tenant_id" integer NOT NULL,
  "user_id" integer NOT NULL,
  "query" varchar(200) NOT NULL,
  "entity" varchar(50),
  "result_count" integer NOT NULL,
  "latency_ms" integer NOT NULL,
  "clicked_result_id" varchar(100),
  "clicked_entity" varchar(50),
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "idx_search_analytics_tenant_created" ON "search_analytics" ("tenant_id", "created_at");
CREATE INDEX IF NOT EXISTS "idx_search_analytics_tenant_query" ON "search_analytics" ("tenant_id", "query");
