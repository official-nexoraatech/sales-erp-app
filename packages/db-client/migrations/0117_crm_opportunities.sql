-- CRM-ROADMAP Phase 2, Feature 1 — Sales Pipeline & Opportunity Management.
--
-- Bulk/wholesale/B2B deals get a visible, forecastable pipeline for the first time. Pipeline
-- stages are tenant-configurable (crm_pipeline_stages) but optional — a tenant with zero rows
-- uses OpportunityService's hardcoded default stage set, same "customization optional, sensible
-- default always applies" convention as crm_ticket_sla_rules. Line items are pre-quotation
-- forecast lines (no GST/HSN yet); marking an opportunity Won auto-creates a real Quotation via
-- the existing QuotationService, which computes GST fresh from `items` at that point.
CREATE TABLE IF NOT EXISTS "crm_pipeline_stages" (
  "id" bigserial PRIMARY KEY,
  "tenant_id" integer NOT NULL,
  "deal_type" varchar(50),
  "code" varchar(30) NOT NULL,
  "name" varchar(100) NOT NULL,
  "sequence" integer NOT NULL,
  "probability" integer NOT NULL,
  "is_won" boolean NOT NULL DEFAULT false,
  "is_lost" boolean NOT NULL DEFAULT false,
  "is_active" boolean NOT NULL DEFAULT true,
  "created_by" integer NOT NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS "idx_crm_pipeline_stages_tenant" ON "crm_pipeline_stages" ("tenant_id", "deal_type", "is_active");
CREATE UNIQUE INDEX IF NOT EXISTS "crm_pipeline_stages_code_unique" ON "crm_pipeline_stages" ("tenant_id", "deal_type", "code");

CREATE TABLE IF NOT EXISTS "crm_opportunities" (
  "id" bigserial PRIMARY KEY,
  "tenant_id" integer NOT NULL,
  "name" varchar(300) NOT NULL,
  "deal_type" varchar(50),
  "stage" varchar(30) NOT NULL DEFAULT 'NEW',
  "probability" integer NOT NULL DEFAULT 10,
  "value" numeric(15,2) NOT NULL DEFAULT 0,
  "expected_close_date" timestamp with time zone,
  "customer_id" integer,
  "account_id" integer,
  "assigned_to" integer,
  "branch_id" integer,
  "converted_quotation_id" integer,
  "won_at" timestamp with time zone,
  "lost_at" timestamp with time zone,
  "lost_reason" text,
  "notes" text,
  "created_by" integer NOT NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS "idx_crm_opportunities_tenant_stage" ON "crm_opportunities" ("tenant_id", "stage", "branch_id");
CREATE INDEX IF NOT EXISTS "idx_crm_opportunities_close_date" ON "crm_opportunities" ("tenant_id", "expected_close_date");
CREATE INDEX IF NOT EXISTS "idx_crm_opportunities_customer" ON "crm_opportunities" ("customer_id", "tenant_id");

CREATE TABLE IF NOT EXISTS "crm_opportunity_line_items" (
  "id" bigserial PRIMARY KEY,
  "tenant_id" integer NOT NULL,
  "opportunity_id" integer NOT NULL,
  "line_number" integer NOT NULL,
  "item_id" integer NOT NULL,
  "variant_id" integer,
  "quantity" numeric(15,3) NOT NULL,
  "unit_id" integer,
  "unit_price" numeric(15,2) NOT NULL,
  "discount_pct" numeric(5,2) NOT NULL DEFAULT 0,
  "discount_amount" numeric(15,2) NOT NULL DEFAULT 0,
  "line_total" numeric(15,2) NOT NULL DEFAULT 0,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "idx_crm_opportunity_line_items_opportunity" ON "crm_opportunity_line_items" ("opportunity_id", "tenant_id");

CREATE TABLE IF NOT EXISTS "crm_opportunity_history" (
  "id" bigserial PRIMARY KEY,
  "tenant_id" integer NOT NULL,
  "opportunity_id" integer NOT NULL,
  "activity_type" varchar(20) NOT NULL,
  "from_stage" varchar(30),
  "to_stage" varchar(30),
  "notes" text,
  "actor_id" integer,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "idx_crm_opportunity_history_opportunity" ON "crm_opportunity_history" ("opportunity_id", "created_at");
