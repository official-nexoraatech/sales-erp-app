-- Phase 12 — Distributed Systems Layer Migration
-- M12.1: Event Store + Snapshots
-- M12.2: Projection Metadata (lag tracking)
-- M12.4: Dead Letter Queue Items
-- M12.6: Schema Registry
-- M12.7: Performance Profiles

-- ─── M12.1: Event Store ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "event_store" (
  "id" bigserial PRIMARY KEY NOT NULL,
  "event_id" varchar(36) NOT NULL,
  "event_type" varchar(100) NOT NULL,
  "aggregate_type" varchar(100) NOT NULL,
  "aggregate_id" varchar(100) NOT NULL,
  "aggregate_version" integer NOT NULL,
  "tenant_id" integer NOT NULL,
  "schema_version" integer NOT NULL DEFAULT 1,
  "payload" jsonb NOT NULL,
  "metadata" jsonb NOT NULL DEFAULT '{}',
  "correlation_id" varchar(36),
  "causation_id" varchar(36),
  "user_id" integer,
  "occurred_at" timestamptz NOT NULL DEFAULT now(),
  "indexed_at" timestamptz,
  CONSTRAINT "event_store_aggregate_version" UNIQUE ("aggregate_type", "aggregate_id", "aggregate_version", "tenant_id")
);
CREATE INDEX IF NOT EXISTS "idx_es_tenant_aggregate" ON "event_store" ("tenant_id", "aggregate_type", "aggregate_id", "occurred_at");
CREATE INDEX IF NOT EXISTS "idx_es_event_type" ON "event_store" ("tenant_id", "event_type", "occurred_at");
CREATE INDEX IF NOT EXISTS "idx_es_correlation" ON "event_store" ("correlation_id");
CREATE INDEX IF NOT EXISTS "idx_es_occurred_at" ON "event_store" ("occurred_at");

-- ─── M12.1: Event Snapshots ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "event_snapshots" (
  "id" bigserial PRIMARY KEY NOT NULL,
  "aggregate_type" varchar(100) NOT NULL,
  "aggregate_id" varchar(100) NOT NULL,
  "tenant_id" integer NOT NULL,
  "version" integer NOT NULL,
  "state" jsonb NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "snapshot_latest" UNIQUE ("tenant_id", "aggregate_type", "aggregate_id")
);
CREATE INDEX IF NOT EXISTS "idx_snapshot_aggregate" ON "event_snapshots" ("aggregate_type", "aggregate_id", "tenant_id");

-- ─── M12.4: DLQ Items ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "dlq_items" (
  "id" bigserial PRIMARY KEY NOT NULL,
  "topic" varchar(200) NOT NULL,
  "partition" integer NOT NULL DEFAULT 0,
  "offset" varchar(50) NOT NULL DEFAULT '0',
  "payload" jsonb NOT NULL,
  "headers" jsonb NOT NULL DEFAULT '{}',
  "error_message" text NOT NULL,
  "retry_count" integer NOT NULL DEFAULT 0,
  "status" varchar(20) NOT NULL DEFAULT 'PENDING',
  "tenant_id" integer,
  "last_retried_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "idx_dlq_topic_status" ON "dlq_items" ("topic", "status", "created_at");
CREATE INDEX IF NOT EXISTS "idx_dlq_status" ON "dlq_items" ("status", "created_at");
CREATE INDEX IF NOT EXISTS "idx_dlq_tenant" ON "dlq_items" ("tenant_id", "status");

-- ─── M12.6: Schema Registry ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "schema_registry" (
  "id" bigserial PRIMARY KEY NOT NULL,
  "event_type" varchar(100) NOT NULL,
  "schema_version" integer NOT NULL,
  "json_schema" jsonb NOT NULL,
  "compatibility_mode" varchar(20) NOT NULL DEFAULT 'BACKWARD',
  "description" text,
  "registered_by" varchar(100),
  "registered_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "schema_registry_type_version" UNIQUE ("event_type", "schema_version")
);
CREATE INDEX IF NOT EXISTS "idx_schema_registry_type" ON "schema_registry" ("event_type", "schema_version");

-- ─── M12.2: Projection Metadata ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "projection_metadata" (
  "id" bigserial PRIMARY KEY NOT NULL,
  "projection_name" varchar(100) NOT NULL,
  "tenant_id" integer,
  "last_event_id" varchar(36),
  "last_updated_at" timestamptz NOT NULL DEFAULT now(),
  "last_event_occurred_at" timestamptz,
  "status" varchar(20) NOT NULL DEFAULT 'UP_TO_DATE',
  "error_message" text,
  "rebuild_started_at" timestamptz,
  "rebuild_completed_at" timestamptz,
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "proj_meta_name_tenant" UNIQUE ("projection_name", "tenant_id")
);
CREATE INDEX IF NOT EXISTS "idx_proj_meta_name" ON "projection_metadata" ("projection_name");

-- ─── M12.7: Performance Profiles ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "performance_profiles" (
  "id" bigserial PRIMARY KEY NOT NULL,
  "endpoint" varchar(200) NOT NULL,
  "method" varchar(10) NOT NULL,
  "p50_ms" integer,
  "p95_ms" integer,
  "p99_ms" integer,
  "sample_count" integer NOT NULL DEFAULT 0,
  "target_p95_ms" integer,
  "measured_at" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "idx_perf_endpoint" ON "performance_profiles" ("endpoint", "method", "measured_at");

-- ─── Seed: Default Projection Metadata rows ─────────────────────────────────
INSERT INTO "projection_metadata" ("projection_name", "tenant_id", "status") VALUES
  ('projection_dashboard_daily', NULL, 'UP_TO_DATE'),
  ('projection_customer_balance', NULL, 'UP_TO_DATE'),
  ('projection_stock_level', NULL, 'UP_TO_DATE'),
  ('projection_customer_aging', NULL, 'UP_TO_DATE')
ON CONFLICT ("projection_name", "tenant_id") DO NOTHING;

-- ─── Seed: Core event schemas in registry ───────────────────────────────────
INSERT INTO "schema_registry" ("event_type", "schema_version", "json_schema", "compatibility_mode", "description", "registered_by") VALUES
  ('INVOICE_CONFIRMED', 1, '{"type":"object","required":["invoiceId","invoiceNumber","grandTotal","tenantId"],"properties":{"invoiceId":{"type":"integer"},"invoiceNumber":{"type":"string"},"grandTotal":{"type":"number"},"tenantId":{"type":"integer"},"customerId":{"type":"integer"},"lines":{"type":"array"}}}', 'BACKWARD', 'Invoice confirmed event schema v1', 'system'),
  ('INVOICE_CONFIRMED', 2, '{"type":"object","required":["invoiceId","invoiceNumber","grandTotal","tenantId","branchId"],"properties":{"invoiceId":{"type":"integer"},"invoiceNumber":{"type":"string"},"grandTotal":{"type":"number"},"tenantId":{"type":"integer"},"customerId":{"type":"integer"},"branchId":{"type":"integer"},"lines":{"type":"array"},"metadata":{"type":"object"}}}', 'BACKWARD', 'Invoice confirmed event schema v2 (adds branchId + metadata)', 'system'),
  ('PAYMENT_RECEIVED', 1, '{"type":"object","required":["paymentId","invoiceId","amount","tenantId"],"properties":{"paymentId":{"type":"integer"},"invoiceId":{"type":"integer"},"amount":{"type":"number"},"tenantId":{"type":"integer"},"mode":{"type":"string"}}}', 'BACKWARD', 'Payment received event schema v1', 'system'),
  ('STOCK_DEDUCTED', 1, '{"type":"object","required":["itemId","warehouseId","quantity","tenantId"],"properties":{"itemId":{"type":"integer"},"warehouseId":{"type":"integer"},"quantity":{"type":"number"},"tenantId":{"type":"integer"},"reference":{"type":"string"}}}', 'BACKWARD', 'Stock deducted event schema v1', 'system'),
  ('STOCK_RECEIVED', 1, '{"type":"object","required":["itemId","warehouseId","quantity","tenantId"],"properties":{"itemId":{"type":"integer"},"warehouseId":{"type":"integer"},"quantity":{"type":"number"},"tenantId":{"type":"integer"}}}', 'BACKWARD', 'Stock received event schema v1', 'system')
ON CONFLICT ("event_type", "schema_version") DO NOTHING;
