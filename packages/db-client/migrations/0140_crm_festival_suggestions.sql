-- CRM-ROADMAP Phase 4, Feature 3 (Festival Intelligence AI).
CREATE TABLE IF NOT EXISTS "crm_festival_suggestions" (
  "id" bigserial PRIMARY KEY,
  "tenant_id" integer NOT NULL,
  "season_type" varchar(30) NOT NULL,
  "suggested_year" integer NOT NULL,
  "status" varchar(20) NOT NULL DEFAULT 'PENDING',
  "suggested_start_date" timestamptz,
  "suggested_end_date" timestamptz,
  "suggested_stock_multiplier" decimal(5,2),
  "suggested_loyalty_multiplier" decimal(5,2),
  "reason" text NOT NULL,
  "prior_year_order_count" integer,
  "prior_year_revenue" decimal(15,2),
  "reviewed_by" integer,
  "reviewed_at" timestamptz,
  "created_season_id" integer,
  "computed_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "crm_festival_suggestions_unique" UNIQUE ("tenant_id", "season_type", "suggested_year")
);
CREATE INDEX IF NOT EXISTS "idx_crm_festival_suggestions_tenant"
  ON "crm_festival_suggestions" ("tenant_id", "status");
