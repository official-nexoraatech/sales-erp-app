-- Phase 9 — CRM and Customer Engagement Migration
-- M9.1: Customer 360 Activity Timeline (no new tables — aggregates existing data)
-- M9.2: Customer Health Scoring (alters customers table)
-- M9.3: Customer Interaction Log (customer_interactions)
-- M9.4: Customer Segmentation (customer_segments)
-- M9.5: Campaign Management (campaigns, campaign_recipients)
-- M9.6: Birthday and Anniversary Automation (no new tables — uses customers.date_of_birth + notification_log)
-- M9.7: Festival Season Planner (business_seasons)

-- ─── M9.2: Customer Health Scoring columns ──────────────────────────────────
ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "health_score" integer;
ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "health_segment" varchar(20);
ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "scored_at" timestamptz;
CREATE INDEX IF NOT EXISTS "idx_customers_health_segment" ON "customers" ("tenant_id", "health_segment");

-- ─── Customer Interactions ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "customer_interactions" (
  "id" bigserial PRIMARY KEY NOT NULL,
  "tenant_id" integer NOT NULL,
  "customer_id" integer NOT NULL,
  "type" varchar(20) NOT NULL,
  "notes" text NOT NULL,
  "follow_up_date" timestamptz,
  "follow_up_done" boolean NOT NULL DEFAULT false,
  "created_by" integer NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "idx_cust_interactions_customer" ON "customer_interactions" ("customer_id", "tenant_id", "created_at");
CREATE INDEX IF NOT EXISTS "idx_cust_interactions_followup" ON "customer_interactions" ("follow_up_date", "follow_up_done", "tenant_id");
CREATE INDEX IF NOT EXISTS "idx_cust_interactions_created_by" ON "customer_interactions" ("created_by", "tenant_id");

-- ─── Customer Segments ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "customer_segments" (
  "id" bigserial PRIMARY KEY NOT NULL,
  "tenant_id" integer NOT NULL,
  "name" varchar(200) NOT NULL,
  "code" varchar(60) NOT NULL,
  "is_system" boolean NOT NULL DEFAULT false,
  "filter_definition" jsonb,
  "description" text,
  "created_by" integer NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "customer_segments_tenant_code" UNIQUE("tenant_id", "code")
);
CREATE INDEX IF NOT EXISTS "idx_customer_segments_tenant" ON "customer_segments" ("tenant_id", "is_system");

-- ─── Campaigns ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "campaigns" (
  "id" bigserial PRIMARY KEY NOT NULL,
  "tenant_id" integer NOT NULL,
  "name" varchar(200) NOT NULL,
  "segment_id" integer,
  "customer_ids" jsonb,
  "channel" varchar(20) NOT NULL,
  "message_template" text NOT NULL,
  "status" varchar(20) NOT NULL DEFAULT 'DRAFT',
  "scheduled_at" timestamptz,
  "sent_at" timestamptz,
  "total_recipients" integer NOT NULL DEFAULT 0,
  "sent_count" integer NOT NULL DEFAULT 0,
  "delivered_count" integer NOT NULL DEFAULT 0,
  "failed_count" integer NOT NULL DEFAULT 0,
  "cancelled_at" timestamptz,
  "created_by" integer NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS "idx_campaigns_tenant_status" ON "campaigns" ("tenant_id", "status", "created_at");
CREATE INDEX IF NOT EXISTS "idx_campaigns_scheduled" ON "campaigns" ("scheduled_at", "status");

CREATE TABLE IF NOT EXISTS "campaign_recipients" (
  "id" bigserial PRIMARY KEY NOT NULL,
  "tenant_id" integer NOT NULL,
  "campaign_id" integer NOT NULL,
  "customer_id" integer NOT NULL,
  "status" varchar(20) NOT NULL DEFAULT 'PENDING',
  "notification_log_id" integer,
  "error_message" text,
  "sent_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "idx_campaign_recipients_campaign" ON "campaign_recipients" ("campaign_id", "status");
CREATE INDEX IF NOT EXISTS "idx_campaign_recipients_customer" ON "campaign_recipients" ("customer_id", "tenant_id");

-- ─── Business Seasons — Festival Planner ───────────────────────────────────
CREATE TABLE IF NOT EXISTS "business_seasons" (
  "id" bigserial PRIMARY KEY NOT NULL,
  "tenant_id" integer NOT NULL,
  "name" varchar(200) NOT NULL,
  "season_type" varchar(30) NOT NULL,
  "start_date" timestamptz NOT NULL,
  "end_date" timestamptz NOT NULL,
  "stock_multiplier" numeric(5, 2) NOT NULL DEFAULT '1',
  "loyalty_multiplier" numeric(5, 2) NOT NULL DEFAULT '1',
  "sales_target" numeric(15, 2) NOT NULL DEFAULT '0',
  "active_discount_rule_ids" jsonb DEFAULT '[]',
  "is_active" boolean NOT NULL DEFAULT true,
  "created_by" integer NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS "idx_business_seasons_tenant_active" ON "business_seasons" ("tenant_id", "is_active", "start_date", "end_date");
