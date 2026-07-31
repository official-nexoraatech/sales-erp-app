-- CRM-ROADMAP Phase 3, Feature 3 — Campaign ROI & Attribution Reporting.
--
-- Both new campaign_recipients columns are set together by attributeConversions() and cleared
-- together on reversal (a cancelled invoice that was previously attributed) — convertedAt is
-- cleared alongside them since a reversed attribution isn't "converted" at all anymore.
-- cost_per_message has no prior concept anywhere in this codebase; null/missing channel keys
-- default to 0 spend at report time, so this is additive and opt-in per tenant.
ALTER TABLE "campaign_recipients" ADD COLUMN IF NOT EXISTS "converted_invoice_id" integer;
ALTER TABLE "campaign_recipients" ADD COLUMN IF NOT EXISTS "converted_amount" decimal(15, 2);

ALTER TABLE "tenant_communication_settings" ADD COLUMN IF NOT EXISTS "cost_per_message" jsonb;
