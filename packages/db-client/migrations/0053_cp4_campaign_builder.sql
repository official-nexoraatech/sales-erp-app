-- CP-4 (Campaign Management Platform initiative): Campaign Builder 2.0.
-- Additive only, per ERP-PLANNING/Campaign-Planning/19_MIGRATION_AND_BACKWARD_COMPATIBILITY.md —
-- no existing column/table is renamed or dropped. No FK constraints added, matching this schema's
-- established zero-FK convention (see CP-1 completion report for the investigation/decision).

-- Reusable, versioned campaign message templates — distinct from notification_templates, which
-- backs transactional event notifications, not campaign broadcast authoring.
CREATE TABLE "campaign_templates" (
  "id" bigserial PRIMARY KEY,
  "tenant_id" integer NOT NULL,
  "name" varchar(200) NOT NULL,
  "category" varchar(50),
  "campaign_type" varchar(50),
  "channel" varchar(20) NOT NULL,
  "message_template" text NOT NULL,
  "created_by" integer NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 0
);
CREATE INDEX "idx_campaign_templates_tenant" ON "campaign_templates" ("tenant_id", "channel");

-- Lifecycle/edit audit trail — who did what to a campaign, when, and (for edits) a diff of what
-- changed. Powers the "History" tab planned for CP-7's collaboration work; started here because
-- campaign editing (this phase) is what first generates entries worth showing.
CREATE TABLE "campaign_history" (
  "id" bigserial PRIMARY KEY,
  "tenant_id" integer NOT NULL,
  "campaign_id" integer NOT NULL,
  "actor_id" integer NOT NULL,
  "action" varchar(30) NOT NULL,
  "from_status" varchar(20),
  "to_status" varchar(20),
  "diff" jsonb,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX "idx_campaign_history_campaign" ON "campaign_history" ("campaign_id", "created_at");

-- Campaign type taxonomy (tenant-configurable metadata, not an enum — new types never need a
-- schema change) and template linkage.
ALTER TABLE "campaigns" ADD COLUMN "campaign_type" varchar(50);
ALTER TABLE "campaigns" ADD COLUMN "template_id" integer;
ALTER TABLE "campaigns" ADD COLUMN "last_edited_at" timestamptz;
