-- Phase 7 — GST Domain Migration
-- M7.1: GST Ledger (append-only, indexed by period_month)
-- M7.4: e-Invoice Data Store
-- M7.6: GSTR-2A Imported Entries
-- M7.7: GST Return Filings Tracker

-- ─── GST Ledger ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "gst_ledger" (
  "id" bigserial PRIMARY KEY NOT NULL,
  "tenant_id" integer NOT NULL,
  "period_month" varchar(7) NOT NULL,
  "entry_type" varchar(30) NOT NULL,
  "gstin_of_counterparty" varchar(15),
  "counterparty_name" varchar(300),
  "document_number" varchar(100) NOT NULL,
  "document_date" date NOT NULL,
  "place_of_supply" varchar(2),
  "is_interstate" boolean NOT NULL DEFAULT false,
  "taxable_amount" numeric(15, 2) NOT NULL DEFAULT '0',
  "cgst_amount" numeric(15, 2) NOT NULL DEFAULT '0',
  "sgst_amount" numeric(15, 2) NOT NULL DEFAULT '0',
  "igst_amount" numeric(15, 2) NOT NULL DEFAULT '0',
  "cess_amount" numeric(15, 2) NOT NULL DEFAULT '0',
  "total_gst" numeric(15, 2) NOT NULL DEFAULT '0',
  "grand_total" numeric(15, 2) NOT NULL DEFAULT '0',
  "itc_eligible" boolean NOT NULL DEFAULT true,
  "itc_reversal_reason" varchar(200),
  "hsn_code" varchar(20),
  "gst_rate" numeric(5, 2),
  "rcm_applicable" boolean NOT NULL DEFAULT false,
  "source_event_id" varchar(100),
  "source_document_id" integer,
  "source_document_type" varchar(50),
  "branch_id" integer,
  "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "idx_gst_ledger_tenant_period" ON "gst_ledger" ("tenant_id", "period_month", "entry_type");
CREATE INDEX IF NOT EXISTS "idx_gst_ledger_counterparty" ON "gst_ledger" ("tenant_id", "gstin_of_counterparty", "period_month");
CREATE INDEX IF NOT EXISTS "idx_gst_ledger_source" ON "gst_ledger" ("source_event_id");
CREATE INDEX IF NOT EXISTS "idx_gst_ledger_doc" ON "gst_ledger" ("tenant_id", "document_number", "entry_type");

-- ─── GST Return Filings ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "gst_return_filings" (
  "id" bigserial PRIMARY KEY NOT NULL,
  "tenant_id" integer NOT NULL,
  "return_type" varchar(20) NOT NULL,
  "period" varchar(7) NOT NULL,
  "due_date" date NOT NULL,
  "filed_date" date,
  "status" varchar(20) NOT NULL DEFAULT 'PENDING',
  "reference_number" varchar(100),
  "filed_by" integer,
  "filing_data" jsonb,
  "notes" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "gst_return_filings_tenant_type_period" UNIQUE("tenant_id", "return_type", "period")
);

CREATE INDEX IF NOT EXISTS "idx_gst_return_filings_tenant" ON "gst_return_filings" ("tenant_id", "return_type", "status");

-- ─── GSTR-2A Entries ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "gst_2a_entries" (
  "id" bigserial PRIMARY KEY NOT NULL,
  "tenant_id" integer NOT NULL,
  "period" varchar(7) NOT NULL,
  "import_batch_id" varchar(50) NOT NULL,
  "supplier_gstin" varchar(15) NOT NULL,
  "supplier_name" varchar(300),
  "invoice_number" varchar(100) NOT NULL,
  "invoice_date" date NOT NULL,
  "invoice_type" varchar(10) DEFAULT 'INV',
  "taxable_amount" numeric(15, 2) NOT NULL DEFAULT '0',
  "cgst_amount" numeric(15, 2) NOT NULL DEFAULT '0',
  "sgst_amount" numeric(15, 2) NOT NULL DEFAULT '0',
  "igst_amount" numeric(15, 2) NOT NULL DEFAULT '0',
  "cess_amount" numeric(15, 2) NOT NULL DEFAULT '0',
  "place_of_supply" varchar(2),
  "reconciliation_status" varchar(20) NOT NULL DEFAULT 'UNMATCHED',
  "matched_ledger_id" integer,
  "match_variance" numeric(15, 2),
  "reconciled_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "idx_gst_2a_tenant_period" ON "gst_2a_entries" ("tenant_id", "period");
CREATE INDEX IF NOT EXISTS "idx_gst_2a_supplier" ON "gst_2a_entries" ("tenant_id", "supplier_gstin", "period");
CREATE INDEX IF NOT EXISTS "idx_gst_2a_status" ON "gst_2a_entries" ("tenant_id", "reconciliation_status", "period");
CREATE INDEX IF NOT EXISTS "idx_gst_2a_batch" ON "gst_2a_entries" ("import_batch_id");

-- ─── e-Invoice Data Store ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "einvoice_data" (
  "id" bigserial PRIMARY KEY NOT NULL,
  "tenant_id" integer NOT NULL,
  "invoice_id" integer NOT NULL,
  "invoice_number" varchar(100) NOT NULL,
  "irn" varchar(64),
  "ack_number" varchar(50),
  "ack_date" timestamptz,
  "signed_qr_code" text,
  "signed_invoice" text,
  "irn_status" varchar(30) NOT NULL DEFAULT 'PENDING_IRN',
  "retry_count" integer NOT NULL DEFAULT 0,
  "last_retry_at" timestamptz,
  "failure_reason" text,
  "cancelled_at" timestamptz,
  "cancel_reason" varchar(200),
  "cancel_remark" text,
  "ewb_number" varchar(30),
  "ewb_date" timestamptz,
  "ewb_valid_upto" timestamptz,
  "nic_request_payload" jsonb,
  "nic_response_payload" jsonb,
  "created_by" integer NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "einvoice_data_tenant_invoice" UNIQUE("tenant_id", "invoice_id")
);

CREATE INDEX IF NOT EXISTS "idx_einvoice_data_irn" ON "einvoice_data" ("irn");
CREATE INDEX IF NOT EXISTS "idx_einvoice_data_status" ON "einvoice_data" ("tenant_id", "irn_status");
CREATE INDEX IF NOT EXISTS "idx_einvoice_data_retry" ON "einvoice_data" ("irn_status", "retry_count", "last_retry_at");
