-- Purchase audit 2026-07-21 gap-fix: RFQ -> Supplier Quotations -> Comparison. Suppliers have
-- no portal/login in this system, so quotation capture is manual data entry by the purchasing
-- team on the supplier's behalf, same trust model as the rest of Purchase.
CREATE TABLE IF NOT EXISTS "rfqs" (
  "id" bigserial PRIMARY KEY,
  "tenant_id" integer NOT NULL,
  "branch_id" integer NOT NULL,
  "rfq_number" varchar(50),
  "requisition_id" integer,
  "status" varchar(20) NOT NULL DEFAULT 'DRAFT',
  "due_date" timestamptz,
  "notes" text,
  "created_by" integer NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "rfqs_tenant_number" UNIQUE ("tenant_id", "rfq_number")
);
CREATE INDEX IF NOT EXISTS "idx_rfq_tenant_status" ON "rfqs" ("tenant_id", "status", "created_at");

CREATE TABLE IF NOT EXISTS "rfq_lines" (
  "id" bigserial PRIMARY KEY,
  "rfq_id" integer NOT NULL,
  "tenant_id" integer NOT NULL,
  "line_number" integer NOT NULL,
  "item_id" integer NOT NULL,
  "description" text,
  "qty" decimal(15, 3) NOT NULL,
  "unit_id" integer
);
CREATE INDEX IF NOT EXISTS "idx_rfq_lines_rfq" ON "rfq_lines" ("rfq_id");

CREATE TABLE IF NOT EXISTS "rfq_suppliers" (
  "id" bigserial PRIMARY KEY,
  "rfq_id" integer NOT NULL,
  "tenant_id" integer NOT NULL,
  "supplier_id" integer NOT NULL,
  "status" varchar(20) NOT NULL DEFAULT 'INVITED',
  "invited_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "rfq_suppliers_unique" UNIQUE ("rfq_id", "supplier_id")
);
CREATE INDEX IF NOT EXISTS "idx_rfq_suppliers_rfq" ON "rfq_suppliers" ("rfq_id", "tenant_id");

CREATE TABLE IF NOT EXISTS "supplier_quotations" (
  "id" bigserial PRIMARY KEY,
  "tenant_id" integer NOT NULL,
  "rfq_id" integer NOT NULL,
  "supplier_id" integer NOT NULL,
  "quotation_number" varchar(100),
  "status" varchar(20) NOT NULL DEFAULT 'SUBMITTED',
  "valid_till" timestamptz,
  "grand_total" decimal(15, 2) NOT NULL DEFAULT 0,
  "notes" text,
  "converted_to_po_id" integer,
  "created_by" integer NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "idx_quotation_rfq" ON "supplier_quotations" ("rfq_id", "tenant_id");
CREATE INDEX IF NOT EXISTS "idx_quotation_supplier" ON "supplier_quotations" ("supplier_id", "tenant_id");

CREATE TABLE IF NOT EXISTS "supplier_quotation_lines" (
  "id" bigserial PRIMARY KEY,
  "quotation_id" integer NOT NULL,
  "tenant_id" integer NOT NULL,
  "rfq_line_id" integer NOT NULL,
  "item_id" integer NOT NULL,
  "qty" decimal(15, 3) NOT NULL,
  "unit_price" decimal(15, 2) NOT NULL,
  "gst_rate" decimal(5, 2) NOT NULL DEFAULT 0,
  "delivery_days" integer,
  "line_total" decimal(15, 2) NOT NULL
);
CREATE INDEX IF NOT EXISTS "idx_quotation_lines_quotation" ON "supplier_quotation_lines" ("quotation_id");
