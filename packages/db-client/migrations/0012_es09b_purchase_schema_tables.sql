-- ES-09b — Purchase module schema tables. These were defined in
-- packages/db-client/src/schema/purchase.ts but that module was never
-- exported from drizzle-schema.ts, so drizzle-kit generate never saw it and
-- no migration ever created these tables (migration 0012/gst_cess_rcm's
-- ALTER TABLE "grns"/"grn_lines" was operating on tables that don't exist).
-- purchase_order_amendments is not included here — it was already created by
-- 0011_es09_purchase_amend_credit_limit.sql.

CREATE TABLE IF NOT EXISTS "purchase_orders" (
  "id" bigserial PRIMARY KEY,
  "tenant_id" integer NOT NULL,
  "branch_id" integer NOT NULL,
  "warehouse_id" integer NOT NULL,
  "po_number" varchar(50),
  "supplier_id" integer NOT NULL,
  "status" varchar(30) NOT NULL DEFAULT 'DRAFT',
  "po_date" timestamptz NOT NULL,
  "expected_delivery_date" timestamptz,
  "place_of_supply" varchar(2) NOT NULL,
  "seller_state_code" varchar(2),
  "subtotal" numeric(15, 2) NOT NULL DEFAULT '0',
  "discount_amount" numeric(15, 2) NOT NULL DEFAULT '0',
  "taxable_amount" numeric(15, 2) NOT NULL DEFAULT '0',
  "cgst_amount" numeric(15, 2) NOT NULL DEFAULT '0',
  "sgst_amount" numeric(15, 2) NOT NULL DEFAULT '0',
  "igst_amount" numeric(15, 2) NOT NULL DEFAULT '0',
  "grand_total" numeric(15, 2) NOT NULL DEFAULT '0',
  "received_amount" numeric(15, 2) NOT NULL DEFAULT '0',
  "currency" varchar(3) NOT NULL DEFAULT 'INR',
  "notes" text,
  "terms_and_conditions" text,
  "pdf_url" text,
  "approved_at" timestamptz,
  "approved_by" integer,
  "cancelled_at" timestamptz,
  "cancellation_reason" text,
  "submitted_at" timestamptz,
  "created_by" integer NOT NULL,
  "updated_by" integer,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 0,
  CONSTRAINT "purchase_orders_tenant_number" UNIQUE ("tenant_id", "po_number")
);
CREATE INDEX IF NOT EXISTS "idx_po_tenant_status" ON "purchase_orders" ("tenant_id", "status", "created_at");
CREATE INDEX IF NOT EXISTS "idx_po_supplier" ON "purchase_orders" ("supplier_id", "tenant_id");
CREATE INDEX IF NOT EXISTS "idx_po_expected_delivery" ON "purchase_orders" ("expected_delivery_date", "status");

CREATE TABLE IF NOT EXISTS "purchase_order_lines" (
  "id" bigserial PRIMARY KEY,
  "purchase_order_id" integer NOT NULL,
  "tenant_id" integer NOT NULL,
  "line_number" integer NOT NULL,
  "item_id" integer NOT NULL,
  "variant_id" integer,
  "description" text,
  "ordered_qty" numeric(15, 3) NOT NULL,
  "received_qty" numeric(15, 3) NOT NULL DEFAULT '0',
  "unit_id" integer,
  "unit_price" numeric(15, 2) NOT NULL,
  "discount_pct" numeric(5, 2) NOT NULL DEFAULT '0',
  "discount_amount" numeric(15, 2) NOT NULL DEFAULT '0',
  "taxable_amount" numeric(15, 2) NOT NULL DEFAULT '0',
  "gst_rate" numeric(5, 2) NOT NULL DEFAULT '0',
  "cgst_rate" numeric(5, 2) NOT NULL DEFAULT '0',
  "sgst_rate" numeric(5, 2) NOT NULL DEFAULT '0',
  "igst_rate" numeric(5, 2) NOT NULL DEFAULT '0',
  "cgst_amount" numeric(15, 2) NOT NULL DEFAULT '0',
  "sgst_amount" numeric(15, 2) NOT NULL DEFAULT '0',
  "igst_amount" numeric(15, 2) NOT NULL DEFAULT '0',
  "line_total" numeric(15, 2) NOT NULL,
  "hsn_code" varchar(20),
  "created_at" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "idx_po_lines_po" ON "purchase_order_lines" ("purchase_order_id");
CREATE INDEX IF NOT EXISTS "idx_po_lines_item" ON "purchase_order_lines" ("item_id", "tenant_id");

CREATE TABLE IF NOT EXISTS "purchase_order_history" (
  "id" bigserial PRIMARY KEY,
  "purchase_order_id" integer NOT NULL,
  "tenant_id" integer NOT NULL,
  "action" varchar(100) NOT NULL,
  "from_status" varchar(30),
  "to_status" varchar(30),
  "performed_by" integer NOT NULL,
  "notes" text,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "idx_po_history_po" ON "purchase_order_history" ("purchase_order_id", "tenant_id");

CREATE TABLE IF NOT EXISTS "grns" (
  "id" bigserial PRIMARY KEY,
  "tenant_id" integer NOT NULL,
  "branch_id" integer NOT NULL,
  "warehouse_id" integer NOT NULL,
  "grn_number" varchar(50),
  "purchase_order_id" integer NOT NULL,
  "supplier_id" integer NOT NULL,
  "status" varchar(30) NOT NULL DEFAULT 'DRAFT',
  "grn_date" timestamptz NOT NULL,
  "supplier_invoice_number" varchar(100),
  "supplier_invoice_date" timestamptz,
  "subtotal" numeric(15, 2) NOT NULL DEFAULT '0',
  "taxable_amount" numeric(15, 2) NOT NULL DEFAULT '0',
  "cgst_amount" numeric(15, 2) NOT NULL DEFAULT '0',
  "sgst_amount" numeric(15, 2) NOT NULL DEFAULT '0',
  "igst_amount" numeric(15, 2) NOT NULL DEFAULT '0',
  "cess_amount" numeric(15, 2) NOT NULL DEFAULT '0',
  "grand_total" numeric(15, 2) NOT NULL DEFAULT '0',
  "landed_cost_total" numeric(15, 2) NOT NULL DEFAULT '0',
  "effective_cost_total" numeric(15, 2) NOT NULL DEFAULT '0',
  "has_price_variance" boolean NOT NULL DEFAULT false,
  "rcm_applicable" boolean NOT NULL DEFAULT false,
  "variance_approved_by" integer,
  "variance_approved_at" timestamptz,
  "notes" text,
  "rejection_reason" text,
  "approved_at" timestamptz,
  "approved_by" integer,
  "created_by" integer NOT NULL,
  "updated_by" integer,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 0,
  CONSTRAINT "grns_tenant_number" UNIQUE ("tenant_id", "grn_number")
);
CREATE INDEX IF NOT EXISTS "idx_grn_tenant_status" ON "grns" ("tenant_id", "status", "created_at");
CREATE INDEX IF NOT EXISTS "idx_grn_po" ON "grns" ("purchase_order_id", "tenant_id");
CREATE INDEX IF NOT EXISTS "idx_grn_supplier" ON "grns" ("supplier_id", "tenant_id");

CREATE TABLE IF NOT EXISTS "grn_lines" (
  "id" bigserial PRIMARY KEY,
  "grn_id" integer NOT NULL,
  "tenant_id" integer NOT NULL,
  "purchase_order_line_id" integer,
  "line_number" integer NOT NULL,
  "item_id" integer NOT NULL,
  "variant_id" integer,
  "description" text,
  "ordered_qty" numeric(15, 3) NOT NULL DEFAULT '0',
  "received_qty" numeric(15, 3) NOT NULL,
  "unit_id" integer,
  "po_rate" numeric(15, 2) NOT NULL DEFAULT '0',
  "grn_rate" numeric(15, 2) NOT NULL,
  "price_variance_pct" numeric(8, 4) NOT NULL DEFAULT '0',
  "gst_rate" numeric(5, 2) NOT NULL DEFAULT '0',
  "cgst_rate" numeric(5, 2) NOT NULL DEFAULT '0',
  "sgst_rate" numeric(5, 2) NOT NULL DEFAULT '0',
  "igst_rate" numeric(5, 2) NOT NULL DEFAULT '0',
  "taxable_amount" numeric(15, 2) NOT NULL DEFAULT '0',
  "cgst_amount" numeric(15, 2) NOT NULL DEFAULT '0',
  "sgst_amount" numeric(15, 2) NOT NULL DEFAULT '0',
  "igst_amount" numeric(15, 2) NOT NULL DEFAULT '0',
  "cess_rate" numeric(5, 2) NOT NULL DEFAULT '0',
  "cess_amount" numeric(15, 2) NOT NULL DEFAULT '0',
  "line_total" numeric(15, 2) NOT NULL,
  "allocated_landed_cost" numeric(15, 2) NOT NULL DEFAULT '0',
  "effective_unit_cost" numeric(15, 4) NOT NULL DEFAULT '0',
  "hsn_code" varchar(20),
  "warehouse_id" integer,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "idx_grn_lines_grn" ON "grn_lines" ("grn_id");
CREATE INDEX IF NOT EXISTS "idx_grn_lines_item" ON "grn_lines" ("item_id", "tenant_id");

CREATE TABLE IF NOT EXISTS "grn_history" (
  "id" bigserial PRIMARY KEY,
  "grn_id" integer NOT NULL,
  "tenant_id" integer NOT NULL,
  "action" varchar(100) NOT NULL,
  "from_status" varchar(30),
  "to_status" varchar(30),
  "performed_by" integer NOT NULL,
  "notes" text,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "idx_grn_history_grn" ON "grn_history" ("grn_id", "tenant_id");

CREATE TABLE IF NOT EXISTS "landed_costs" (
  "id" bigserial PRIMARY KEY,
  "tenant_id" integer NOT NULL,
  "grn_id" integer NOT NULL,
  "cost_type" varchar(50) NOT NULL,
  "description" text,
  "amount" numeric(15, 2) NOT NULL,
  "allocation_method" varchar(20) NOT NULL DEFAULT 'BY_VALUE',
  "is_allocated" boolean NOT NULL DEFAULT false,
  "created_by" integer NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "idx_landed_costs_grn" ON "landed_costs" ("grn_id", "tenant_id");

CREATE TABLE IF NOT EXISTS "supplier_payments" (
  "id" bigserial PRIMARY KEY,
  "tenant_id" integer NOT NULL,
  "branch_id" integer NOT NULL,
  "payment_number" varchar(50) NOT NULL,
  "supplier_id" integer NOT NULL,
  "payment_date" timestamptz NOT NULL,
  "payment_mode" varchar(20) NOT NULL,
  "amount" numeric(15, 2) NOT NULL,
  "allocated_amount" numeric(15, 2) NOT NULL DEFAULT '0',
  "unallocated_amount" numeric(15, 2) NOT NULL,
  "status" varchar(30) NOT NULL DEFAULT 'PAID',
  "cheque_number" varchar(50),
  "cheque_bank_name" varchar(200),
  "cheque_date" timestamptz,
  "is_pdc" boolean NOT NULL DEFAULT false,
  "pdc_clearing_date" timestamptz,
  "pdc_alert_sent_at" timestamptz,
  "transaction_reference" varchar(100),
  "notes" text,
  "bounced_at" timestamptz,
  "bounce_reason" text,
  "created_by" integer NOT NULL,
  "updated_by" integer,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "supplier_payments_tenant_number" UNIQUE ("tenant_id", "payment_number")
);
CREATE INDEX IF NOT EXISTS "idx_sp_tenant_supplier" ON "supplier_payments" ("tenant_id", "supplier_id", "payment_date");
CREATE INDEX IF NOT EXISTS "idx_sp_pdc" ON "supplier_payments" ("is_pdc", "pdc_clearing_date", "status");

CREATE TABLE IF NOT EXISTS "supplier_payment_allocations" (
  "id" bigserial PRIMARY KEY,
  "payment_id" integer NOT NULL,
  "grn_id" integer NOT NULL,
  "tenant_id" integer NOT NULL,
  "amount" numeric(15, 2) NOT NULL,
  "allocated_by" integer NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "idx_sp_alloc_payment" ON "supplier_payment_allocations" ("payment_id", "tenant_id");
CREATE INDEX IF NOT EXISTS "idx_sp_alloc_grn" ON "supplier_payment_allocations" ("grn_id", "tenant_id");

CREATE TABLE IF NOT EXISTS "purchase_returns" (
  "id" bigserial PRIMARY KEY,
  "tenant_id" integer NOT NULL,
  "branch_id" integer NOT NULL,
  "return_number" varchar(50),
  "grn_id" integer NOT NULL,
  "supplier_id" integer NOT NULL,
  "warehouse_id" integer NOT NULL,
  "status" varchar(30) NOT NULL DEFAULT 'DRAFT',
  "return_date" timestamptz NOT NULL,
  "reason" varchar(50) NOT NULL,
  "return_notes" text,
  "grand_total" numeric(15, 2) NOT NULL DEFAULT '0',
  "debit_note_id" integer,
  "approved_at" timestamptz,
  "approved_by" integer,
  "created_by" integer NOT NULL,
  "updated_by" integer,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "purchase_returns_tenant_number" UNIQUE ("tenant_id", "return_number")
);
CREATE INDEX IF NOT EXISTS "idx_pr_tenant_status" ON "purchase_returns" ("tenant_id", "status", "created_at");
CREATE INDEX IF NOT EXISTS "idx_pr_grn" ON "purchase_returns" ("grn_id", "tenant_id");
CREATE INDEX IF NOT EXISTS "idx_pr_supplier" ON "purchase_returns" ("supplier_id", "tenant_id");

CREATE TABLE IF NOT EXISTS "purchase_return_lines" (
  "id" bigserial PRIMARY KEY,
  "purchase_return_id" integer NOT NULL,
  "tenant_id" integer NOT NULL,
  "grn_line_id" integer NOT NULL,
  "line_number" integer NOT NULL,
  "item_id" integer NOT NULL,
  "variant_id" integer,
  "return_qty" numeric(15, 3) NOT NULL,
  "unit_price" numeric(15, 2) NOT NULL,
  "gst_rate" numeric(5, 2) NOT NULL DEFAULT '0',
  "taxable_amount" numeric(15, 2) NOT NULL DEFAULT '0',
  "cgst_amount" numeric(15, 2) NOT NULL DEFAULT '0',
  "sgst_amount" numeric(15, 2) NOT NULL DEFAULT '0',
  "igst_amount" numeric(15, 2) NOT NULL DEFAULT '0',
  "line_total" numeric(15, 2) NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "idx_pr_lines_return" ON "purchase_return_lines" ("purchase_return_id");
CREATE INDEX IF NOT EXISTS "idx_pr_lines_item" ON "purchase_return_lines" ("item_id", "tenant_id");

CREATE TABLE IF NOT EXISTS "debit_notes" (
  "id" bigserial PRIMARY KEY,
  "tenant_id" integer NOT NULL,
  "debit_note_number" varchar(50) NOT NULL,
  "purchase_return_id" integer NOT NULL,
  "supplier_id" integer NOT NULL,
  "status" varchar(20) NOT NULL DEFAULT 'OPEN',
  "amount" numeric(15, 2) NOT NULL,
  "applied_amount" numeric(15, 2) NOT NULL DEFAULT '0',
  "balance_amount" numeric(15, 2) NOT NULL,
  "issue_date" timestamptz NOT NULL,
  "expiry_date" timestamptz,
  "notes" text,
  "created_by" integer NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "debit_notes_tenant_number" UNIQUE ("tenant_id", "debit_note_number")
);
CREATE INDEX IF NOT EXISTS "idx_debit_notes_tenant_supplier" ON "debit_notes" ("tenant_id", "supplier_id", "status");

CREATE TABLE IF NOT EXISTS "expenses" (
  "id" bigserial PRIMARY KEY,
  "tenant_id" integer NOT NULL,
  "branch_id" integer NOT NULL,
  "expense_number" varchar(50),
  "expense_type" varchar(50) NOT NULL,
  "supplier_id" integer,
  "status" varchar(30) NOT NULL DEFAULT 'DRAFT',
  "expense_date" timestamptz NOT NULL,
  "due_date" timestamptz,
  "description" text,
  "total_amount" numeric(15, 2) NOT NULL DEFAULT '0',
  "paid_amount" numeric(15, 2) NOT NULL DEFAULT '0',
  "payment_mode" varchar(20),
  "payment_date" timestamptz,
  "payment_reference" varchar(100),
  "account_id" integer,
  "approved_at" timestamptz,
  "approved_by" integer,
  "paid_at" timestamptz,
  "paid_by" integer,
  "notes" text,
  "attachments" jsonb NOT NULL DEFAULT '[]',
  "created_by" integer NOT NULL,
  "updated_by" integer,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "expenses_tenant_number" UNIQUE ("tenant_id", "expense_number")
);
CREATE INDEX IF NOT EXISTS "idx_expenses_tenant_status" ON "expenses" ("tenant_id", "status", "expense_date");
CREATE INDEX IF NOT EXISTS "idx_expenses_type" ON "expenses" ("tenant_id", "expense_type");

CREATE TABLE IF NOT EXISTS "expense_lines" (
  "id" bigserial PRIMARY KEY,
  "expense_id" integer NOT NULL,
  "tenant_id" integer NOT NULL,
  "line_number" integer NOT NULL,
  "description" text NOT NULL,
  "amount" numeric(15, 2) NOT NULL,
  "gst_rate" numeric(5, 2) NOT NULL DEFAULT '0',
  "gst_amount" numeric(15, 2) NOT NULL DEFAULT '0',
  "line_total" numeric(15, 2) NOT NULL,
  "account_id" integer,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "idx_expense_lines_expense" ON "expense_lines" ("expense_id");

CREATE TABLE IF NOT EXISTS "projection_supplier_balance" (
  "id" bigserial PRIMARY KEY,
  "tenant_id" integer NOT NULL,
  "supplier_id" integer NOT NULL,
  "current_balance" numeric(15, 2) NOT NULL DEFAULT '0',
  "total_purchased" numeric(15, 2) NOT NULL DEFAULT '0',
  "total_paid" numeric(15, 2) NOT NULL DEFAULT '0',
  "total_returns" numeric(15, 2) NOT NULL DEFAULT '0',
  "overdue_amount" numeric(15, 2) NOT NULL DEFAULT '0',
  "last_grn_at" timestamptz,
  "last_payment_at" timestamptz,
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "proj_supplier_balance_unique" UNIQUE ("tenant_id", "supplier_id")
);
CREATE INDEX IF NOT EXISTS "idx_proj_supplier_balance_tenant" ON "projection_supplier_balance" ("tenant_id", "supplier_id");
