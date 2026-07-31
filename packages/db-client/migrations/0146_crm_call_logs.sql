-- CRM-ROADMAP Phase 4, Feature 7 (CTI / Call Center Integration).
CREATE TABLE IF NOT EXISTS "crm_call_logs" (
  "id" bigserial PRIMARY KEY,
  "tenant_id" integer NOT NULL,
  "customer_id" integer,
  "rep_user_id" integer NOT NULL,
  "direction" varchar(10) NOT NULL,
  "from_number" varchar(20) NOT NULL,
  "to_number" varchar(20) NOT NULL,
  "twilio_call_sid" varchar(64) NOT NULL,
  "status" varchar(20) NOT NULL DEFAULT 'INITIATED',
  "duration_seconds" integer,
  "recording_url" text,
  "recording_consent_confirmed" boolean NOT NULL DEFAULT false,
  "notes" text,
  "started_at" timestamptz NOT NULL DEFAULT now(),
  "ended_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "crm_call_logs_tenant_twilio_sid" UNIQUE ("tenant_id", "twilio_call_sid")
);
CREATE INDEX IF NOT EXISTS "idx_crm_call_logs_customer"
  ON "crm_call_logs" ("customer_id", "tenant_id");
CREATE INDEX IF NOT EXISTS "idx_crm_call_logs_rep"
  ON "crm_call_logs" ("rep_user_id", "tenant_id", "started_at");
