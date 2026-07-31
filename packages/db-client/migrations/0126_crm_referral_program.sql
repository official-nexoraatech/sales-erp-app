-- CRM-ROADMAP Phase 2, Feature 4 — Referral Program Engine.
--
-- Reward payout still posts through the exact same loyalty_transactions ledger as Feature 3 —
-- no parallel reward rail. `code` is globally unique (not per-tenant) because the public
-- click/redeem routes resolve the tenant FROM the code itself.
CREATE TABLE IF NOT EXISTS "crm_referral_codes" (
  "id" bigserial PRIMARY KEY,
  "tenant_id" integer NOT NULL,
  "customer_id" integer NOT NULL,
  "code" varchar(20) NOT NULL,
  "is_active" boolean NOT NULL DEFAULT true,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "crm_referral_codes_code_unique" ON "crm_referral_codes" ("code");
CREATE UNIQUE INDEX IF NOT EXISTS "crm_referral_codes_tenant_customer_unique" ON "crm_referral_codes" ("tenant_id", "customer_id");

CREATE TABLE IF NOT EXISTS "crm_referral_events" (
  "id" bigserial PRIMARY KEY,
  "tenant_id" integer NOT NULL,
  "referral_code_id" integer NOT NULL,
  "event_type" varchar(20) NOT NULL,
  "ip_address" varchar(45),
  "device_id" varchar(100),
  "metadata" jsonb,
  "occurred_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "idx_crm_referral_events_code" ON "crm_referral_events" ("referral_code_id", "event_type", "occurred_at");

-- One row per referee, ever — the unique(tenant_id, referee_phone) constraint is the structural
-- guarantee behind "one-time-per-referee enforcement" (roadmap's own explicit fraud requirement).
CREATE TABLE IF NOT EXISTS "crm_referral_rewards" (
  "id" bigserial PRIMARY KEY,
  "tenant_id" integer NOT NULL,
  "referral_code_id" integer NOT NULL,
  "referrer_customer_id" integer NOT NULL,
  "referee_phone" varchar(20) NOT NULL,
  "referee_name" varchar(200),
  "referee_customer_id" integer,
  "status" varchar(20) NOT NULL DEFAULT 'PENDING',
  "referrer_points" integer NOT NULL,
  "referee_points" integer NOT NULL,
  "referrer_loyalty_transaction_id" integer,
  "referee_loyalty_transaction_id" integer,
  "ip_address" varchar(45),
  "device_id" varchar(100),
  "flag_reason" text,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "paid_at" timestamp with time zone
);

CREATE UNIQUE INDEX IF NOT EXISTS "crm_referral_rewards_tenant_referee_phone_unique" ON "crm_referral_rewards" ("tenant_id", "referee_phone");
CREATE INDEX IF NOT EXISTS "idx_crm_referral_rewards_status" ON "crm_referral_rewards" ("tenant_id", "status");
