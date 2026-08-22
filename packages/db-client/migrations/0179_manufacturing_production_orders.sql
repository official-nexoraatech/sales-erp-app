-- Manufacturing vertical — standalone Production Order: in-house manufacturing, distinct from
-- Job Work Order (which always models outsourced work to an external supplier/job worker —
-- job_work_orders.supplier_id is NOT NULL there). No supplier_id here; labor_cost/overhead_cost
-- replace job_work_rate/job_work_charges as the conversion-cost fields. Otherwise mirrors
-- job_work_orders' proven shape (status lifecycle, materials/quality-checks/history subtables,
-- optional work_center_id/BOM-driven materials) so ProductionOrderService can reuse the same
-- ValuationService-backed stock-in/stock-out pattern already proven for job work.
CREATE TABLE IF NOT EXISTS "production_orders" (
  "id" bigserial PRIMARY KEY,
  "tenant_id" integer NOT NULL,
  "order_number" varchar(50),
  "status" varchar(30) NOT NULL DEFAULT 'DRAFT',
  "branch_id" integer NOT NULL,
  "warehouse_id" integer NOT NULL,
  "output_item_id" integer NOT NULL,
  "output_variant_id" integer,
  "work_center_id" integer,
  "ordered_qty" decimal(15, 3) NOT NULL,
  "received_qty" decimal(15, 3) NOT NULL DEFAULT '0',
  "rejected_qty" decimal(15, 3) NOT NULL DEFAULT '0',
  "scrap_qty" decimal(15, 3) NOT NULL DEFAULT '0',
  "labor_cost" decimal(15, 2) NOT NULL DEFAULT '0',
  "overhead_cost" decimal(15, 2) NOT NULL DEFAULT '0',
  "materials_cost" decimal(15, 2) NOT NULL DEFAULT '0',
  "finished_goods_cost" decimal(15, 2) NOT NULL DEFAULT '0',
  "order_date" timestamptz NOT NULL,
  "expected_date" timestamptz,
  "issued_at" timestamptz,
  "completed_at" timestamptz,
  "cancelled_at" timestamptz,
  "cancellation_reason" text,
  "notes" text,
  "created_by" integer NOT NULL,
  "updated_by" integer,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 0
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_production_orders_tenant" ON "production_orders" ("tenant_id", "status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_production_orders_item" ON "production_orders" ("output_item_id", "tenant_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_production_orders_date" ON "production_orders" ("tenant_id", "order_date");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_production_orders_work_center" ON "production_orders" ("work_center_id", "tenant_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "production_order_materials" (
  "id" bigserial PRIMARY KEY,
  "production_order_id" integer NOT NULL,
  "tenant_id" integer NOT NULL,
  "item_id" integer NOT NULL,
  "variant_id" integer,
  "required_qty" decimal(15, 3) NOT NULL,
  "issued_qty" decimal(15, 3) NOT NULL DEFAULT '0',
  "unit_cost" decimal(15, 2) NOT NULL DEFAULT '0',
  "total_cost" decimal(15, 2) NOT NULL DEFAULT '0',
  "warehouse_id" integer NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_pom_order" ON "production_order_materials" ("production_order_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_pom_tenant_item" ON "production_order_materials" ("tenant_id", "item_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "production_order_quality_checks" (
  "id" bigserial PRIMARY KEY,
  "production_order_id" integer NOT NULL,
  "tenant_id" integer NOT NULL,
  "piece_number" integer NOT NULL,
  "result" varchar(20) NOT NULL,
  "defect_notes" text,
  "inspected_by" integer NOT NULL,
  "inspected_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_poqc_order" ON "production_order_quality_checks" ("production_order_id", "tenant_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "production_order_history" (
  "id" bigserial PRIMARY KEY,
  "production_order_id" integer NOT NULL,
  "tenant_id" integer NOT NULL,
  "action" varchar(100) NOT NULL,
  "from_status" varchar(30),
  "to_status" varchar(30),
  "performed_by" integer NOT NULL,
  "notes" text,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_po_history_order" ON "production_order_history" ("production_order_id", "tenant_id");
--> statement-breakpoint
UPDATE business_types SET default_capability_keys = '["HR_PAYROLL", "INVENTORY_BATCH", "BOM", "WORK_CENTERS", "PRODUCTION_ORDER"]'::jsonb
WHERE code = 'MANUFACTURING';
