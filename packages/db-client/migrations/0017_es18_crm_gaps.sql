-- ES-18 — CRM & Customer Communication gap-closing migration
-- Adds customer communication opt-out flags and an editable-window timestamp
-- on customer_interactions. Phase 9 (0005_phase9_crm.sql) already created
-- customer_interactions/customer_segments/campaigns/business_seasons and the
-- notification-service delivery pipeline — this migration only adds what
-- that phase deferred.

ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "opt_out_sms" boolean NOT NULL DEFAULT false;
ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "opt_out_whatsapp" boolean NOT NULL DEFAULT false;
ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "opt_out_email" boolean NOT NULL DEFAULT false;

ALTER TABLE "customer_interactions" ADD COLUMN IF NOT EXISTS "updated_at" timestamptz;
