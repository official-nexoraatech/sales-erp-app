-- ES-09 Migration: PO amendment history + vendor credit limit enforcement

-- Step 1: Add vendor credit limit columns to suppliers (mirrors customers.credit_limit)
ALTER TABLE "suppliers"
  ADD COLUMN IF NOT EXISTS "credit_limit" numeric(15, 2) NOT NULL DEFAULT '0',
  ADD COLUMN IF NOT EXISTS "credit_limit_enabled" boolean NOT NULL DEFAULT false;

-- Step 2: PO amendment history table
CREATE TABLE IF NOT EXISTS "purchase_order_amendments" (
  "id" bigserial PRIMARY KEY,
  "purchase_order_id" integer NOT NULL,
  "tenant_id" integer NOT NULL,
  "amendments" jsonb NOT NULL,
  "reason" text NOT NULL,
  "performed_by" integer NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "idx_po_amendments_po"
  ON "purchase_order_amendments" ("purchase_order_id", "tenant_id");
