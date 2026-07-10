-- PG-028: durable per-tenant usage metering, fed by the outbox pattern.
-- usage_events is raw/append-only (one row per countable action, or one batched row for
-- high-volume actions like API calls); usage_summary is the nightly per-tenant-per-month
-- rollup the admin dashboard actually reads from. Never aggregate on read from usage_events.

CREATE TABLE IF NOT EXISTS "usage_events" (
  "id" bigserial PRIMARY KEY,
  "tenant_id" integer NOT NULL,
  "event_type" varchar(50) NOT NULL,
  "quantity" integer NOT NULL DEFAULT 1,
  "occurred_at" timestamp with time zone NOT NULL DEFAULT now(),
  "metadata" jsonb
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_usage_events_tenant_period" ON "usage_events"("tenant_id", "occurred_at");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "usage_summary" (
  "id" bigserial PRIMARY KEY,
  "tenant_id" integer NOT NULL,
  "period_start" date NOT NULL,
  "period_end" date NOT NULL,
  "invoice_count" integer NOT NULL DEFAULT 0,
  "active_user_count" integer NOT NULL DEFAULT 0,
  "storage_bytes" bigint NOT NULL DEFAULT 0,
  "api_call_count" bigint NOT NULL DEFAULT 0,
  "computed_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "usage_summary_tenant_period" UNIQUE ("tenant_id", "period_start")
);
