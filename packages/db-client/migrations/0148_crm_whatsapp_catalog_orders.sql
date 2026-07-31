-- CRM-ROADMAP Phase 4, Feature 2 (WhatsApp Commerce).
CREATE TABLE IF NOT EXISTS "crm_whatsapp_catalog_orders" (
  "id" bigserial PRIMARY KEY,
  "tenant_id" integer NOT NULL,
  "customer_id" integer,
  "wa_order_message_id" varchar(100) NOT NULL,
  "catalog_id" varchar(100),
  "status" varchar(20) NOT NULL,
  "rejection_reason" text,
  "quotation_id" integer,
  "raw_payload" jsonb NOT NULL DEFAULT '{}',
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "crm_whatsapp_catalog_orders_tenant_msg" UNIQUE ("tenant_id", "wa_order_message_id")
);
CREATE INDEX IF NOT EXISTS "idx_crm_whatsapp_catalog_orders_customer"
  ON "crm_whatsapp_catalog_orders" ("customer_id", "tenant_id");
