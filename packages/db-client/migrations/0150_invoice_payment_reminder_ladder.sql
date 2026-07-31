-- Product audit 2026-07-31, Phase 1 Step 10: payment-reminder ladder automation. Tracks which
-- reminder stage (days-overdue threshold) has already fired per invoice, so the daily job never
-- re-sends the same stage twice. Unique on (tenant_id, invoice_id, stage) is the dedup guard.
CREATE TABLE IF NOT EXISTS "invoice_reminder_log" (
  "id" bigserial PRIMARY KEY,
  "tenant_id" integer NOT NULL,
  "invoice_id" integer NOT NULL,
  "stage" varchar(20) NOT NULL,
  "sent_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "invoice_reminder_log_unique" UNIQUE ("tenant_id", "invoice_id", "stage")
);

CREATE INDEX IF NOT EXISTS "idx_invoice_reminder_log_invoice" ON "invoice_reminder_log" ("tenant_id", "invoice_id");

-- Opt-in gate, same "false preserves today's behavior exactly" convention as
-- tenant_communication_settings.approval_required (CP-7) — sends real customer-facing
-- messages, so a tenant must explicitly turn it on rather than it silently activating for
-- everyone the moment this ships.
ALTER TABLE "tenant_communication_settings"
  ADD COLUMN IF NOT EXISTS "payment_reminder_enabled" boolean NOT NULL DEFAULT false;
