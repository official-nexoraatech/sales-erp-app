-- CRM-ROADMAP Phase 3, Feature 5 (Multi-language Communication).
ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "preferred_language" varchar(10);

CREATE TABLE IF NOT EXISTS "crm_campaign_template_translations" (
  "id" bigserial PRIMARY KEY,
  "tenant_id" integer NOT NULL,
  "template_id" integer NOT NULL,
  "language" varchar(10) NOT NULL,
  "message_template" text NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "crm_campaign_template_translations_unique" UNIQUE ("template_id", "language")
);
CREATE INDEX IF NOT EXISTS "idx_crm_campaign_template_translations_template"
  ON "crm_campaign_template_translations" ("template_id", "tenant_id");

CREATE TABLE IF NOT EXISTS "crm_campaign_message_translations" (
  "id" bigserial PRIMARY KEY,
  "tenant_id" integer NOT NULL,
  "campaign_id" integer NOT NULL,
  "language" varchar(10) NOT NULL,
  "message_template" text NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "crm_campaign_message_translations_unique" UNIQUE ("campaign_id", "language")
);
CREATE INDEX IF NOT EXISTS "idx_crm_campaign_message_translations_campaign"
  ON "crm_campaign_message_translations" ("campaign_id", "tenant_id");
