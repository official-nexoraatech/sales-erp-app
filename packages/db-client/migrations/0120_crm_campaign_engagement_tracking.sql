-- CRM-ROADMAP Phase 2, Feature 6 — Campaign Studio — Engagement Tracking Activation.
--
-- campaignRecipients.opened_at/clicked_at/converted_at have existed since CP-6 but were never
-- written to anywhere ("schema-complete, write-incomplete"). This migration adds exactly what's
-- needed to finally write them: a nullable tracked-link URL on campaigns, an A/B variant table,
-- a variant assignment column on campaign_recipients, and the per-recipient click/open tracking
-- token table. Every addition is additive — an existing campaign with no linkUrl/no variants
-- behaves identically to today.
ALTER TABLE "campaigns"
  ADD COLUMN IF NOT EXISTS "link_url" text;

CREATE TABLE IF NOT EXISTS "crm_campaign_variants" (
  "id" bigserial PRIMARY KEY,
  "tenant_id" integer NOT NULL,
  "campaign_id" integer NOT NULL,
  "label" varchar(10) NOT NULL,
  "message_template" text NOT NULL,
  "weight" integer NOT NULL DEFAULT 50,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "idx_crm_campaign_variants_campaign" ON "crm_campaign_variants" ("campaign_id", "tenant_id");

ALTER TABLE "campaign_recipients"
  ADD COLUMN IF NOT EXISTS "variant_id" integer;

CREATE TABLE IF NOT EXISTS "crm_link_clicks" (
  "id" bigserial PRIMARY KEY,
  "tenant_id" integer NOT NULL,
  "campaign_id" integer NOT NULL,
  "campaign_recipient_id" integer NOT NULL,
  "tracking_token" varchar(40) NOT NULL,
  "destination_url" text,
  "click_count" integer NOT NULL DEFAULT 0,
  "first_clicked_at" timestamp with time zone,
  "last_clicked_at" timestamp with time zone,
  "open_count" integer NOT NULL DEFAULT 0,
  "first_opened_at" timestamp with time zone,
  "last_opened_at" timestamp with time zone,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "crm_link_clicks_token_unique" ON "crm_link_clicks" ("tracking_token");
CREATE INDEX IF NOT EXISTS "idx_crm_link_clicks_recipient" ON "crm_link_clicks" ("campaign_recipient_id");
