-- Purchase audit 2026-07-21 gap-fix: Purchase Requisition (department request -> approval),
-- upstream of RFQ/PO. No budget-enforcement subsystem exists in this codebase — estimatedTotal
-- is informational for the approver, not checked against a budget ceiling (documented gap).
CREATE TABLE IF NOT EXISTS "purchase_requisitions" (
  "id" bigserial PRIMARY KEY,
  "tenant_id" integer NOT NULL,
  "branch_id" integer NOT NULL,
  "requisition_number" varchar(50),
  "department" varchar(100),
  "priority" varchar(10) NOT NULL DEFAULT 'MEDIUM',
  "status" varchar(20) NOT NULL DEFAULT 'DRAFT',
  "required_by_date" timestamptz,
  "estimated_total" decimal(15, 2) NOT NULL DEFAULT 0,
  "notes" text,
  "rejection_reason" text,
  "converted_to_po_id" integer,
  "requested_by" integer NOT NULL,
  "approved_by" integer,
  "approved_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 0,
  CONSTRAINT "purchase_requisitions_tenant_number" UNIQUE ("tenant_id", "requisition_number")
);
CREATE INDEX IF NOT EXISTS "idx_requisition_tenant_status" ON "purchase_requisitions" ("tenant_id", "status", "created_at");

CREATE TABLE IF NOT EXISTS "purchase_requisition_lines" (
  "id" bigserial PRIMARY KEY,
  "requisition_id" integer NOT NULL,
  "tenant_id" integer NOT NULL,
  "line_number" integer NOT NULL,
  "item_id" integer NOT NULL,
  "description" text,
  "requested_qty" decimal(15, 3) NOT NULL,
  "unit_id" integer,
  "estimated_unit_price" decimal(15, 2) NOT NULL DEFAULT 0,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "idx_requisition_lines_requisition" ON "purchase_requisition_lines" ("requisition_id");
