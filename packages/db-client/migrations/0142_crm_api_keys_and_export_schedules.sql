-- CRM-ROADMAP Phase 4, Feature 8 (Public CRM API, Developer Portal & BI/Data-Warehouse Export).
CREATE TABLE IF NOT EXISTS "crm_api_keys" (
  "id" bigserial PRIMARY KEY,
  "tenant_id" integer NOT NULL,
  "name" varchar(200) NOT NULL,
  "key_prefix" varchar(20) NOT NULL,
  "key_hash" varchar(64) NOT NULL,
  "scopes" jsonb NOT NULL DEFAULT '[]',
  "is_active" boolean NOT NULL DEFAULT true,
  "last_used_at" timestamptz,
  "expires_at" timestamptz,
  "revoked_at" timestamptz,
  "revoked_by" integer,
  "created_by" integer NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "crm_api_keys_hash_unique" UNIQUE ("key_hash")
);
CREATE INDEX IF NOT EXISTS "idx_crm_api_keys_tenant"
  ON "crm_api_keys" ("tenant_id", "is_active");

CREATE TABLE IF NOT EXISTS "export_schedules" (
  "id" bigserial PRIMARY KEY,
  "tenant_id" integer NOT NULL,
  "entity_type" varchar(100) NOT NULL,
  "format" varchar(10) NOT NULL DEFAULT 'XLSX',
  "filters" jsonb NOT NULL DEFAULT '{}',
  "cron_expression" varchar(100) NOT NULL,
  "recipients" jsonb NOT NULL DEFAULT '[]',
  "active" integer NOT NULL DEFAULT 1,
  "created_by" integer NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "idx_export_schedules_tenant"
  ON "export_schedules" ("tenant_id", "active");

CREATE TABLE IF NOT EXISTS "export_run_history" (
  "id" bigserial PRIMARY KEY,
  "tenant_id" integer NOT NULL,
  "schedule_id" integer,
  "entity_type" varchar(100) NOT NULL,
  "format" varchar(10) NOT NULL,
  "status" varchar(20) NOT NULL DEFAULT 'RUNNING',
  "started_at" timestamptz,
  "completed_at" timestamptz,
  "file_url" text,
  "error_message" text,
  "row_count" integer,
  "duration_ms" integer,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "idx_export_run_tenant"
  ON "export_run_history" ("tenant_id", "status");
CREATE INDEX IF NOT EXISTS "idx_export_run_schedule"
  ON "export_run_history" ("schedule_id");
