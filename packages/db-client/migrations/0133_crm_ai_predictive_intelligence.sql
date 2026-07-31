-- CRM-ROADMAP Phase 3, Feature 1 (AI & Predictive Intelligence Suite).
CREATE TABLE IF NOT EXISTS "crm_churn_predictions" (
  "id" bigserial PRIMARY KEY,
  "tenant_id" integer NOT NULL,
  "customer_id" integer NOT NULL,
  "risk_level" varchar(20) NOT NULL,
  "risk_score" integer,
  "reason" text NOT NULL,
  "computed_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "crm_churn_predictions_unique" UNIQUE ("tenant_id", "customer_id")
);
CREATE INDEX IF NOT EXISTS "idx_crm_churn_predictions_tenant"
  ON "crm_churn_predictions" ("tenant_id", "risk_level");

CREATE TABLE IF NOT EXISTS "crm_next_best_actions" (
  "id" bigserial PRIMARY KEY,
  "tenant_id" integer NOT NULL,
  "customer_id" integer NOT NULL,
  "action_type" varchar(50) NOT NULL,
  "action_text" text NOT NULL,
  "reason" text NOT NULL,
  "dismissed" boolean NOT NULL DEFAULT false,
  "dismissed_at" timestamptz,
  "computed_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "crm_next_best_actions_unique" UNIQUE ("tenant_id", "customer_id")
);
CREATE INDEX IF NOT EXISTS "idx_crm_next_best_actions_tenant"
  ON "crm_next_best_actions" ("tenant_id", "customer_id");

CREATE TABLE IF NOT EXISTS "crm_product_recommendations" (
  "id" bigserial PRIMARY KEY,
  "tenant_id" integer NOT NULL,
  "customer_id" integer NOT NULL,
  "item_id" integer NOT NULL,
  "reason" text NOT NULL,
  "rank" integer NOT NULL,
  "dismissed" boolean NOT NULL DEFAULT false,
  "dismissed_at" timestamptz,
  "computed_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "crm_product_recommendations_unique" UNIQUE ("tenant_id", "customer_id", "item_id")
);
CREATE INDEX IF NOT EXISTS "idx_crm_product_recommendations_tenant"
  ON "crm_product_recommendations" ("tenant_id", "customer_id", "rank");
