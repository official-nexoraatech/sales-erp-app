-- CRM-ROADMAP Phase 1, Feature 1 — Contact & Account Hierarchy.
--
-- Today `customers` is a flat table — a B2B/wholesale/distributor buyer with several
-- stakeholders (billing contact, decision maker, shipping contact, ...) can't be modeled
-- correctly. `crm_accounts` is the company/entity; `crm_account_contacts` are the people
-- attached to it; `customers.account_id` is an additive, nullable link (existing POS/retail
-- customers are entirely unaffected — no bulk backfill, per 03-DATABASE-MIGRATION-PLAN.md §3).
CREATE TABLE IF NOT EXISTS "crm_accounts" (
  "id" bigserial PRIMARY KEY,
  "tenant_id" integer NOT NULL,
  "name" varchar(300) NOT NULL,
  "account_type" varchar(20) NOT NULL DEFAULT 'INDIVIDUAL',
  "gstin" text,
  "gstin_hash" varchar(64),
  "primary_phone" varchar(20),
  "primary_email" varchar(255),
  "billing_address" jsonb,
  "is_implicit" boolean NOT NULL DEFAULT false,
  "merged_into_account_id" integer,
  "notes" text,
  "created_by" integer NOT NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS "idx_crm_accounts_tenant" ON "crm_accounts" ("tenant_id", "merged_into_account_id");
CREATE INDEX IF NOT EXISTS "idx_crm_accounts_gstin_hash" ON "crm_accounts" ("gstin_hash");
CREATE INDEX IF NOT EXISTS "idx_crm_accounts_phone" ON "crm_accounts" ("primary_phone", "tenant_id");
CREATE INDEX IF NOT EXISTS "idx_crm_accounts_email" ON "crm_accounts" ("primary_email", "tenant_id");

CREATE TABLE IF NOT EXISTS "crm_account_contacts" (
  "id" bigserial PRIMARY KEY,
  "tenant_id" integer NOT NULL,
  "account_id" integer NOT NULL,
  "name" varchar(200) NOT NULL,
  "role" varchar(30) NOT NULL DEFAULT 'OTHER',
  "email" varchar(255),
  "phone" varchar(20),
  "is_primary" boolean NOT NULL DEFAULT false,
  "last_contacted_at" timestamp with time zone,
  "notes" text,
  "created_by" integer NOT NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS "idx_crm_account_contacts_account" ON "crm_account_contacts" ("account_id", "tenant_id");

ALTER TABLE "customers"
  ADD COLUMN IF NOT EXISTS "account_id" integer;

CREATE INDEX IF NOT EXISTS "idx_customers_account" ON "customers" ("account_id", "tenant_id");
