-- CP-5 (Campaign Management Platform initiative): Scheduling & Automation.
-- Additive only, no FK constraints (see CP-1 completion report for the repo-wide convention).

-- Per-tenant communication settings — this phase only populates frequency_cap; business_hours/
-- quiet_hours columns are added now (nullable) so a later phase can populate them without another
-- migration, but are not read/enforced by any code in this phase (SH-07/SH-08, deferred).
CREATE TABLE "tenant_communication_settings" (
  "id" bigserial PRIMARY KEY,
  "tenant_id" integer NOT NULL,
  "frequency_cap" jsonb,
  "business_hours" jsonb,
  "quiet_hours" jsonb,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX "tenant_communication_settings_tenant_unique" ON "tenant_communication_settings" ("tenant_id");

-- Recurring campaigns: a recurring "definition" row has recurrence_rule set; each firing creates
-- its own concrete campaign row with parent_recurring_campaign_id pointing back to the
-- definition, so each occurrence gets its own independent recipients/analytics (matches how
-- CP-6's analytics work is designed to attribute per-campaign, not per-recurrence-series).
ALTER TABLE "campaigns" ADD COLUMN "recurrence_rule" jsonb;
ALTER TABLE "campaigns" ADD COLUMN "timezone" varchar(50);
ALTER TABLE "campaigns" ADD COLUMN "parent_recurring_campaign_id" integer;
CREATE INDEX "idx_campaigns_parent_recurring" ON "campaigns" ("parent_recurring_campaign_id");

-- Trigger-based automation rules (birthday, inactivity/win-back, etc.) — each enabled rule is
-- evaluated by a scheduler-service cron job, which creates a real campaign row per firing (going
-- through the same CampaignService.send() path as a manually-authored campaign) rather than
-- sending outside the campaigns table the way the old birthday-greeting special case did.
CREATE TABLE "campaign_automation_rules" (
  "id" bigserial PRIMARY KEY,
  "tenant_id" integer NOT NULL,
  "trigger_type" varchar(50) NOT NULL,
  "enabled" boolean NOT NULL DEFAULT true,
  "channel" varchar(20) NOT NULL,
  "template_id" integer,
  "message_template" text,
  "conditions" jsonb,
  "last_fired_at" timestamptz,
  "created_by" integer NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 0
);
CREATE INDEX "idx_campaign_automation_rules_tenant" ON "campaign_automation_rules" ("tenant_id", "enabled", "trigger_type");
