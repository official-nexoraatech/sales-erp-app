-- CP-7 (Campaign Management Platform initiative): Collaboration & Compliance.
-- Additive only, no FK constraints (see CP-1 completion report for the repo-wide convention).

-- Approval workflow — optional per tenant (enforced at the application layer via
-- tenant_communication_settings.approval_required, added below). approved_by/approved_at/
-- rejection_reason are nullable and only ever set while a campaign passes through
-- PENDING_APPROVAL.
ALTER TABLE "campaigns" ADD COLUMN "approval_status" varchar(20);
ALTER TABLE "campaigns" ADD COLUMN "approved_by" integer;
ALTER TABLE "campaigns" ADD COLUMN "approved_at" timestamptz;
ALTER TABLE "campaigns" ADD COLUMN "rejection_reason" text;

-- Tenant-level toggle for whether campaigns require approval before they can be scheduled/sent —
-- reuses the tenant_communication_settings table added in CP-5 rather than a new one-row table.
ALTER TABLE "tenant_communication_settings" ADD COLUMN "approval_required" boolean NOT NULL DEFAULT false;

-- Internal notes/comments on a campaign — never sent to recipients.
CREATE TABLE "campaign_comments" (
  "id" bigserial PRIMARY KEY,
  "tenant_id" integer NOT NULL,
  "campaign_id" integer NOT NULL,
  "author_id" integer NOT NULL,
  "body" text NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX "idx_campaign_comments_campaign" ON "campaign_comments" ("campaign_id", "created_at");

-- Customer consent/preference model — more granular than the existing binary
-- customers.opt_out_sms/whatsapp/email flags (which remain the fast-path enforcement gate and
-- are NOT replaced by this table). One row per (customer, channel, category).
CREATE TABLE "customer_communication_preferences" (
  "id" bigserial PRIMARY KEY,
  "tenant_id" integer NOT NULL,
  "customer_id" integer NOT NULL,
  "channel" varchar(20) NOT NULL,
  "category" varchar(20) NOT NULL,
  "consented" boolean NOT NULL DEFAULT true,
  "consent_source" varchar(30),
  "consent_recorded_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX "customer_comm_prefs_unique" ON "customer_communication_preferences" ("tenant_id", "customer_id", "channel", "category");
