-- CRM-ROADMAP Phase 4, Feature 5 (Sales Forecasting & Quota Management).
CREATE TABLE IF NOT EXISTS "crm_sales_quotas" (
  "id" bigserial PRIMARY KEY,
  "tenant_id" integer NOT NULL,
  "subject_type" varchar(20) NOT NULL,
  "subject_user_id" integer,
  "subject_territory_id" integer,
  "period_year" integer NOT NULL,
  "period_month" integer NOT NULL,
  "quota_amount" decimal(15,2) NOT NULL,
  "created_by" integer NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS "idx_crm_sales_quotas_tenant_period"
  ON "crm_sales_quotas" ("tenant_id", "period_year", "period_month");
CREATE INDEX IF NOT EXISTS "idx_crm_sales_quotas_rep"
  ON "crm_sales_quotas" ("subject_user_id", "tenant_id");
CREATE INDEX IF NOT EXISTS "idx_crm_sales_quotas_territory"
  ON "crm_sales_quotas" ("subject_territory_id", "tenant_id");
