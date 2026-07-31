-- CRM-ROADMAP Phase 1, Feature 6 — DLT/TRAI SMS Compliance (legal requirement, not deferrable).
-- Enforcement itself lives in notification-service's NotificationEngine — this table is the
-- only new CRM-side artifact, per AR-8.
CREATE TABLE IF NOT EXISTS "crm_dlt_templates" (
  "id" bigserial PRIMARY KEY,
  "tenant_id" integer NOT NULL,
  "template_id" varchar(50) NOT NULL,
  "header" varchar(20) NOT NULL,
  "message_pattern" text NOT NULL,
  "is_active" boolean NOT NULL DEFAULT true,
  "expires_at" timestamp with time zone,
  "created_by" integer NOT NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS "idx_crm_dlt_templates_tenant" ON "crm_dlt_templates" ("tenant_id", "is_active");
