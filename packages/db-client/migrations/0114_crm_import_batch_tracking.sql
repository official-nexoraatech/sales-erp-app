-- CRM-ROADMAP Phase 1, Feature 7 — Data Import/Dedupe/Merge Tooling.
--
-- Additive, nullable "which import job created this row" tag on crm_accounts/crm_leads —
-- exists solely so a rolled-back CSV import can delete exactly the rows it created (this
-- feature's own DoD requirement), not a general-purpose FK to scheduler-service's import_jobs.
-- Null for every interactively-created (non-import) row, including public lead capture.
ALTER TABLE "crm_accounts"
  ADD COLUMN IF NOT EXISTS "import_batch_id" integer;

CREATE INDEX IF NOT EXISTS "idx_crm_accounts_import_batch" ON "crm_accounts" ("import_batch_id", "tenant_id");

ALTER TABLE "crm_leads"
  ADD COLUMN IF NOT EXISTS "import_batch_id" integer;

CREATE INDEX IF NOT EXISTS "idx_crm_leads_import_batch" ON "crm_leads" ("import_batch_id", "tenant_id");
