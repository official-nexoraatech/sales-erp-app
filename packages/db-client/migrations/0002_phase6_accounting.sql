-- Phase 6 — Double Entry Accounting Engine
-- Migration: 0002_phase6_accounting.sql
-- Generated: 2026-06-30

-- ─── Journals (Double-Entry Header) ──────────────────────────────────────
CREATE TABLE "journals" (
  "id" bigserial PRIMARY KEY NOT NULL,
  "tenant_id" integer NOT NULL,
  "journal_id" varchar(26) NOT NULL,
  "description" varchar(500),
  "reference_type" varchar(50),
  "reference_id" integer,
  "reversal_of" varchar(26),
  "reversed_by" varchar(26),
  "is_reversal" boolean NOT NULL DEFAULT false,
  "status" varchar(20) NOT NULL DEFAULT 'POSTED',
  "posted_at" timestamp with time zone NOT NULL DEFAULT now(),
  "financial_year_id" integer,
  "period_month" integer,
  "period_year" integer,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "created_by" integer NOT NULL,
  CONSTRAINT "journals_tenant_journal_id" UNIQUE("tenant_id", "journal_id")
);
--> statement-breakpoint
CREATE INDEX "idx_journals_tenant" ON "journals"("tenant_id", "posted_at");
--> statement-breakpoint
CREATE INDEX "idx_journals_reference" ON "journals"("reference_type", "reference_id", "tenant_id");
--> statement-breakpoint
CREATE INDEX "idx_journals_reversal_of" ON "journals"("reversal_of");

-- ─── Financial Entries — Partitioned Parent Table ─────────────────────────
-- APPEND ONLY: no UPDATE or DELETE ever (financial_entries is event-sourced)
-- Partitioned by created_at year for performance
CREATE TABLE "financial_entries" (
  "id" bigserial NOT NULL,
  "tenant_id" integer NOT NULL,
  "journal_id" varchar(26) NOT NULL,
  "account_id" integer NOT NULL,
  "account_code" varchar(30) NOT NULL,
  "account_name" varchar(300) NOT NULL,
  "debit_amount" numeric(15, 2) NOT NULL DEFAULT 0,
  "credit_amount" numeric(15, 2) NOT NULL DEFAULT 0,
  "description" varchar(500),
  "reference_type" varchar(50),
  "reference_id" integer,
  "narration" text,
  "created_by" integer NOT NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  PRIMARY KEY ("id", "created_at")
) PARTITION BY RANGE ("created_at");
--> statement-breakpoint

-- ─── Yearly Partitions ────────────────────────────────────────────────────
CREATE TABLE "financial_entries_2025" PARTITION OF "financial_entries"
  FOR VALUES FROM ('2025-01-01 00:00:00+00') TO ('2026-01-01 00:00:00+00');
--> statement-breakpoint
CREATE TABLE "financial_entries_2026" PARTITION OF "financial_entries"
  FOR VALUES FROM ('2026-01-01 00:00:00+00') TO ('2027-01-01 00:00:00+00');
--> statement-breakpoint
CREATE TABLE "financial_entries_2027" PARTITION OF "financial_entries"
  FOR VALUES FROM ('2027-01-01 00:00:00+00') TO ('2028-01-01 00:00:00+00');
--> statement-breakpoint

-- ─── Indexes on partitions (auto-inherited by child partitions) ───────────
CREATE INDEX "idx_financial_entries_journal" ON "financial_entries"("journal_id", "tenant_id");
--> statement-breakpoint
CREATE INDEX "idx_financial_entries_account" ON "financial_entries"("account_id", "tenant_id", "created_at");
--> statement-breakpoint
CREATE INDEX "idx_financial_entries_tenant_date" ON "financial_entries"("tenant_id", "created_at");

-- ─── Prevent UPDATE/DELETE on financial_entries (event-sourced) ──────────
CREATE OR REPLACE FUNCTION prevent_financial_entries_mutation()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'financial_entries is append-only — UPDATE and DELETE are not allowed (Journal: %)', OLD.journal_id;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_prevent_financial_entries_update
  BEFORE UPDATE ON financial_entries
  FOR EACH ROW EXECUTE FUNCTION prevent_financial_entries_mutation();

CREATE TRIGGER trg_prevent_financial_entries_delete
  BEFORE DELETE ON financial_entries
  FOR EACH ROW EXECUTE FUNCTION prevent_financial_entries_mutation();

-- ─── THE GOLDEN RULE: Journal Balance Validation (Deferred Constraint) ────
-- DEFERRABLE INITIALLY DEFERRED = fires at end-of-transaction, not per-row
-- This allows inserting multiple DR/CR lines within one TX before the check runs
CREATE OR REPLACE FUNCTION validate_journal_balance()
RETURNS TRIGGER AS $$
DECLARE
  v_balance NUMERIC;
BEGIN
  SELECT COALESCE(SUM(debit_amount), 0) - COALESCE(SUM(credit_amount), 0)
    INTO v_balance
    FROM financial_entries
   WHERE journal_id = NEW.journal_id
     AND tenant_id  = NEW.tenant_id;

  IF ABS(v_balance) > 0.01 THEN
    RAISE EXCEPTION
      'Journal % (tenant %) is unbalanced: SUM(DR) - SUM(CR) = %. All DR lines must equal all CR lines.',
      NEW.journal_id, NEW.tenant_id, v_balance;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Deferred so trigger fires ONCE per journal_id at transaction COMMIT, not per INSERT row
CREATE CONSTRAINT TRIGGER validate_journal_balance_trigger
  AFTER INSERT ON financial_entries
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION validate_journal_balance();

-- ─── Posting Matrix ───────────────────────────────────────────────────────
CREATE TABLE "posting_matrix" (
  "id" bigserial PRIMARY KEY NOT NULL,
  "tenant_id" integer NOT NULL,
  "event_type" varchar(100) NOT NULL,
  "line_label" varchar(100),
  "debit_account_code" varchar(30) NOT NULL,
  "credit_account_code" varchar(30) NOT NULL,
  "description" varchar(500),
  "sort_order" integer NOT NULL DEFAULT 0,
  "is_active" boolean NOT NULL DEFAULT true,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "created_by" integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX "idx_posting_matrix_tenant_event" ON "posting_matrix"("tenant_id", "event_type");

-- ─── Financial Years ──────────────────────────────────────────────────────
CREATE TABLE "financial_years" (
  "id" bigserial PRIMARY KEY NOT NULL,
  "tenant_id" integer NOT NULL,
  "year_code" varchar(20) NOT NULL,
  "start_date" date NOT NULL,
  "end_date" date NOT NULL,
  "status" varchar(20) NOT NULL DEFAULT 'OPEN',
  "is_current" boolean NOT NULL DEFAULT false,
  "closed_at" timestamp with time zone,
  "closed_by" integer,
  "closing_entries_journal_id" varchar(26),
  "notes" text,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "created_by" integer NOT NULL,
  CONSTRAINT "financial_years_tenant_code" UNIQUE("tenant_id", "year_code")
);
--> statement-breakpoint
CREATE INDEX "idx_financial_years_tenant" ON "financial_years"("tenant_id", "status");

-- ─── Period Closures ──────────────────────────────────────────────────────
CREATE TABLE "period_closures" (
  "id" bigserial PRIMARY KEY NOT NULL,
  "tenant_id" integer NOT NULL,
  "financial_year_id" integer NOT NULL,
  "period_month" integer NOT NULL,
  "period_year" integer NOT NULL,
  "status" varchar(20) NOT NULL DEFAULT 'OPEN',
  "closed_at" timestamp with time zone,
  "closed_by" integer,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "period_closures_unique" UNIQUE("tenant_id", "financial_year_id", "period_month", "period_year")
);
--> statement-breakpoint
CREATE INDEX "idx_period_closures_tenant" ON "period_closures"("tenant_id", "financial_year_id");

-- ─── Bank Accounts ────────────────────────────────────────────────────────
CREATE TABLE "bank_accounts" (
  "id" bigserial PRIMARY KEY NOT NULL,
  "tenant_id" integer NOT NULL,
  "account_id" integer NOT NULL,
  "bank_name" varchar(200) NOT NULL,
  "account_number" varchar(50),
  "ifsc_code" varchar(20),
  "branch_name" varchar(200),
  "is_active" boolean NOT NULL DEFAULT true,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "created_by" integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX "idx_bank_accounts_tenant" ON "bank_accounts"("tenant_id");

-- ─── Bank Statements ──────────────────────────────────────────────────────
CREATE TABLE "bank_statements" (
  "id" bigserial PRIMARY KEY NOT NULL,
  "tenant_id" integer NOT NULL,
  "bank_account_id" integer NOT NULL,
  "statement_date" date NOT NULL,
  "opening_balance" numeric(15, 2) NOT NULL DEFAULT 0,
  "closing_balance" numeric(15, 2) NOT NULL DEFAULT 0,
  "file_path" varchar(500),
  "status" varchar(20) NOT NULL DEFAULT 'IMPORTED',
  "imported_at" timestamp with time zone NOT NULL DEFAULT now(),
  "created_by" integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX "idx_bank_statements_account" ON "bank_statements"("bank_account_id", "tenant_id");

-- ─── Bank Reconciliation Items ────────────────────────────────────────────
CREATE TABLE "bank_reconciliation_items" (
  "id" bigserial PRIMARY KEY NOT NULL,
  "tenant_id" integer NOT NULL,
  "bank_account_id" integer NOT NULL,
  "bank_statement_id" integer,
  "item_type" varchar(10) NOT NULL,
  "transaction_date" date NOT NULL,
  "description" varchar(500),
  "debit_amount" numeric(15, 2) NOT NULL DEFAULT 0,
  "credit_amount" numeric(15, 2) NOT NULL DEFAULT 0,
  "reference_number" varchar(100),
  "status" varchar(20) NOT NULL DEFAULT 'UNMATCHED',
  "matched_item_id" integer,
  "journal_id" varchar(26),
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "created_by" integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX "idx_bank_recon_account" ON "bank_reconciliation_items"("bank_account_id", "tenant_id");
--> statement-breakpoint
CREATE INDEX "idx_bank_recon_status" ON "bank_reconciliation_items"("status", "bank_account_id");

-- ─── Fixed Assets ─────────────────────────────────────────────────────────
CREATE TABLE "fixed_assets" (
  "id" bigserial PRIMARY KEY NOT NULL,
  "tenant_id" integer NOT NULL,
  "asset_code" varchar(30) NOT NULL,
  "name" varchar(300) NOT NULL,
  "category" varchar(100),
  "account_id" integer NOT NULL,
  "accumulated_depreciation_account_id" integer,
  "depreciation_expense_account_id" integer,
  "purchase_date" date NOT NULL,
  "purchase_cost" numeric(15, 2) NOT NULL,
  "salvage_value" numeric(15, 2) NOT NULL DEFAULT 0,
  "useful_life_months" integer NOT NULL,
  "depreciation_method" varchar(10) NOT NULL DEFAULT 'SLM',
  "wdv_rate" numeric(5, 2),
  "current_value" numeric(15, 2) NOT NULL,
  "accumulated_depreciation" numeric(15, 2) NOT NULL DEFAULT 0,
  "disposal_date" date,
  "disposal_type" varchar(20),
  "disposal_amount" numeric(15, 2),
  "disposal_journal_id" varchar(26),
  "status" varchar(20) NOT NULL DEFAULT 'ACTIVE',
  "notes" text,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  "created_by" integer NOT NULL,
  "version" integer NOT NULL DEFAULT 0,
  CONSTRAINT "fixed_assets_tenant_code" UNIQUE("tenant_id", "asset_code")
);
--> statement-breakpoint
CREATE INDEX "idx_fixed_assets_tenant" ON "fixed_assets"("tenant_id", "status");

-- ─── Asset Depreciation Schedule ──────────────────────────────────────────
CREATE TABLE "asset_depreciation_schedule" (
  "id" bigserial PRIMARY KEY NOT NULL,
  "tenant_id" integer NOT NULL,
  "asset_id" integer NOT NULL,
  "period_month" integer NOT NULL,
  "period_year" integer NOT NULL,
  "opening_value" numeric(15, 2) NOT NULL,
  "depreciation_amount" numeric(15, 2) NOT NULL,
  "closing_value" numeric(15, 2) NOT NULL,
  "journal_id" varchar(26),
  "posted_at" timestamp with time zone,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "asset_depreciation_unique" UNIQUE("tenant_id", "asset_id", "period_month", "period_year")
);
--> statement-breakpoint
CREATE INDEX "idx_asset_depr_asset" ON "asset_depreciation_schedule"("asset_id", "tenant_id");

-- ─── TDS Entries ──────────────────────────────────────────────────────────
CREATE TABLE "tds_entries" (
  "id" bigserial PRIMARY KEY NOT NULL,
  "tenant_id" integer NOT NULL,
  "supplier_id" integer NOT NULL,
  "payment_id" integer NOT NULL,
  "tds_section" varchar(10) NOT NULL,
  "taxable_amount" numeric(15, 2) NOT NULL,
  "tds_rate" numeric(5, 2) NOT NULL,
  "tds_amount" numeric(15, 2) NOT NULL,
  "period_month" integer NOT NULL,
  "period_year" integer NOT NULL,
  "deposit_status" varchar(20) NOT NULL DEFAULT 'PENDING',
  "deposited_at" timestamp with time zone,
  "deposited_by" integer,
  "journal_id" varchar(26),
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "created_by" integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX "idx_tds_entries_tenant" ON "tds_entries"("tenant_id", "period_year", "period_month");
--> statement-breakpoint
CREATE INDEX "idx_tds_entries_supplier" ON "tds_entries"("supplier_id", "tenant_id");

-- ─── TDS Certificates ─────────────────────────────────────────────────────
CREATE TABLE "tds_certificates" (
  "id" bigserial PRIMARY KEY NOT NULL,
  "tenant_id" integer NOT NULL,
  "supplier_id" integer NOT NULL,
  "certificate_number" varchar(50),
  "period_quarter" integer NOT NULL,
  "period_year" integer NOT NULL,
  "total_taxable_amount" numeric(15, 2) NOT NULL,
  "total_tds_amount" numeric(15, 2) NOT NULL,
  "tds_section" varchar(10) NOT NULL,
  "form_type" varchar(10) NOT NULL DEFAULT '16A',
  "generated_at" timestamp with time zone,
  "generated_by" integer,
  "file_path" varchar(500),
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "tds_certificates_unique" UNIQUE("tenant_id", "supplier_id", "period_quarter", "period_year", "tds_section")
);
--> statement-breakpoint
CREATE INDEX "idx_tds_certificates_tenant" ON "tds_certificates"("tenant_id", "period_year");
