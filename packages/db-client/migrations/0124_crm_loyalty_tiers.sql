-- CRM-ROADMAP Phase 2, Feature 3 — Loyalty & Rewards Tiering Layer.
--
-- Tiers are derived from LIFETIME points earned, never demoted automatically (see
-- crm_loyalty_tiers' own doc comment in schema/crm.ts). Redemption catalog redemptions still
-- post through the existing loyalty_transactions ledger — this is additive, not a parallel
-- rewards rail.
CREATE TABLE IF NOT EXISTS "crm_loyalty_tiers" (
  "id" bigserial PRIMARY KEY,
  "tenant_id" integer NOT NULL,
  "name" varchar(100) NOT NULL,
  "code" varchar(50) NOT NULL,
  "min_lifetime_points" integer NOT NULL,
  "benefits" text,
  "is_active" boolean NOT NULL DEFAULT true,
  "created_by" integer NOT NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 0
);

CREATE UNIQUE INDEX IF NOT EXISTS "crm_loyalty_tiers_tenant_code" ON "crm_loyalty_tiers" ("tenant_id", "code");
CREATE INDEX IF NOT EXISTS "idx_crm_loyalty_tiers_tenant" ON "crm_loyalty_tiers" ("tenant_id", "min_lifetime_points");

CREATE TABLE IF NOT EXISTS "crm_redemption_catalog" (
  "id" bigserial PRIMARY KEY,
  "tenant_id" integer NOT NULL,
  "name" varchar(200) NOT NULL,
  "description" text,
  "points_cost" integer NOT NULL,
  "reward_type" varchar(20) NOT NULL,
  "reward_value" decimal(10, 2) NOT NULL,
  "is_active" boolean NOT NULL DEFAULT true,
  "created_by" integer NOT NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS "idx_crm_redemption_catalog_tenant" ON "crm_redemption_catalog" ("tenant_id", "is_active");

CREATE TABLE IF NOT EXISTS "crm_loyalty_redemptions" (
  "id" bigserial PRIMARY KEY,
  "tenant_id" integer NOT NULL,
  "customer_id" integer NOT NULL,
  "catalog_item_id" integer NOT NULL,
  "points_cost" integer NOT NULL,
  "reward_type" varchar(20) NOT NULL,
  "reward_value" decimal(10, 2) NOT NULL,
  "loyalty_transaction_id" integer NOT NULL,
  "invoice_id" integer,
  "created_by" integer NOT NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "idx_crm_loyalty_redemptions_customer" ON "crm_loyalty_redemptions" ("customer_id", "tenant_id", "created_at");

ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "loyalty_tier_id" integer;
