-- ES-20 — Audit trail enrichment, document attachments, feature flag seed defaults

ALTER TABLE "audit_log" ADD COLUMN IF NOT EXISTS "actor_email" varchar(255);
ALTER TABLE "audit_log" ADD COLUMN IF NOT EXISTS "ip_address" varchar(45);
ALTER TABLE "audit_log" ADD COLUMN IF NOT EXISTS "changed_fields" text[];

CREATE TABLE IF NOT EXISTS "document_attachments" (
  "id" bigserial PRIMARY KEY,
  "tenant_id" integer NOT NULL,
  "entity_type" varchar(50) NOT NULL,
  "entity_id" integer NOT NULL,
  "file_name" varchar(255) NOT NULL,
  "object_key" varchar(500) NOT NULL,
  "file_size" integer NOT NULL,
  "mime_type" varchar(100) NOT NULL,
  "uploaded_by" integer NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "idx_document_attachments_entity" ON "document_attachments" ("tenant_id", "entity_type", "entity_id");

-- NULL tenant_id rows are never "equal" for uniqueness purposes, so ON CONFLICT
-- can't dedupe these — use an explicit existence check instead for re-run safety.
INSERT INTO "feature_flags" ("tenant_id", "flag_key", "enabled")
SELECT NULL, v.flag_key, false
FROM (VALUES ('einvoice_enabled'), ('whatsapp_enabled'), ('fifo_valuation'), ('mfa_required'), ('purchase_3way_match')) AS v(flag_key)
WHERE NOT EXISTS (
  SELECT 1 FROM "feature_flags" f WHERE f."tenant_id" IS NULL AND f."flag_key" = v.flag_key
);
