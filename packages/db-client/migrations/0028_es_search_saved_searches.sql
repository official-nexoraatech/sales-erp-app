-- Global Search Phase 6 — user-saved {query, filters} combinations, re-runnable from the
-- command palette's Saved Searches section.

CREATE TABLE IF NOT EXISTS "saved_searches" (
  "id" bigserial PRIMARY KEY NOT NULL,
  "tenant_id" integer NOT NULL,
  "user_id" integer NOT NULL,
  "name" varchar(100) NOT NULL,
  "query" varchar(200) NOT NULL,
  "entity" varchar(50),
  "filters" jsonb DEFAULT '{}',
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "idx_saved_searches_tenant_user" ON "saved_searches" ("tenant_id", "user_id", "created_at");
