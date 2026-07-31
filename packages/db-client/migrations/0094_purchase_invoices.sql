-- Purchase audit 2026-07-21 gap-fix: Purchase Invoice capture + PO/GRN variance check (a
-- lighter alternative to full 3-way-match AP posting — GRN approval keeps posting AP/GST
-- exactly as before this table; see PurchaseInvoiceService module comment for why).
CREATE TABLE IF NOT EXISTS "purchase_invoices" (
  "id" bigserial PRIMARY KEY,
  "tenant_id" integer NOT NULL,
  "branch_id" integer NOT NULL,
  "invoice_number" varchar(50),
  "supplier_invoice_number" varchar(100) NOT NULL,
  "supplier_id" integer NOT NULL,
  "purchase_order_id" integer NOT NULL,
  "grn_id" integer NOT NULL,
  "invoice_date" timestamptz NOT NULL,
  "status" varchar(20) NOT NULL DEFAULT 'MATCHED',
  "subtotal" decimal(15, 2) NOT NULL DEFAULT 0,
  "tax_amount" decimal(15, 2) NOT NULL DEFAULT 0,
  "grand_total" decimal(15, 2) NOT NULL DEFAULT 0,
  "variance_amount" decimal(15, 2) NOT NULL DEFAULT 0,
  "notes" text,
  "approved_by" integer,
  "approved_at" timestamptz,
  "created_by" integer NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "purchase_invoices_tenant_number" UNIQUE ("tenant_id", "invoice_number")
);
CREATE INDEX IF NOT EXISTS "idx_purchase_invoice_grn" ON "purchase_invoices" ("grn_id", "tenant_id");
CREATE INDEX IF NOT EXISTS "idx_purchase_invoice_po" ON "purchase_invoices" ("purchase_order_id", "tenant_id");
CREATE INDEX IF NOT EXISTS "idx_purchase_invoice_supplier" ON "purchase_invoices" ("supplier_id", "tenant_id");

CREATE TABLE IF NOT EXISTS "purchase_invoice_lines" (
  "id" bigserial PRIMARY KEY,
  "invoice_id" integer NOT NULL,
  "tenant_id" integer NOT NULL,
  "grn_line_id" integer NOT NULL,
  "item_id" integer NOT NULL,
  "invoiced_qty" decimal(15, 3) NOT NULL,
  "invoiced_rate" decimal(15, 2) NOT NULL,
  "qty_variance" decimal(15, 3) NOT NULL DEFAULT 0,
  "rate_variance" decimal(15, 2) NOT NULL DEFAULT 0,
  "line_total" decimal(15, 2) NOT NULL
);
CREATE INDEX IF NOT EXISTS "idx_purchase_invoice_lines_invoice" ON "purchase_invoice_lines" ("invoice_id");
