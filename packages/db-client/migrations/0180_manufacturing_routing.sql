-- Manufacturing vertical — Routing: multi-step operation sequences (e.g. Cut -> Stitch ->
-- Finish -> Pack), each step optionally assigned to a Work Center with a standard time. Keyed
-- by finished item, same pattern as boms.finished_item_id — a routing describes HOW an item is
-- produced, a BOM describes WHAT it's made of; the two are independent, a Production Order can
-- reference either, both, or neither.
CREATE TABLE IF NOT EXISTS "routings" (
  "id" bigserial PRIMARY KEY,
  "tenant_id" integer NOT NULL,
  "name" varchar(200) NOT NULL,
  "finished_item_id" integer NOT NULL,
  "finished_variant_id" integer,
  "is_active" boolean NOT NULL DEFAULT true,
  "version" integer NOT NULL DEFAULT 0,
  "created_by" integer NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_routings_tenant_item" ON "routings" ("tenant_id", "finished_item_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "routing_operations" (
  "id" bigserial PRIMARY KEY,
  "routing_id" integer NOT NULL,
  "tenant_id" integer NOT NULL,
  "sequence_no" integer NOT NULL,
  "operation_name" varchar(200) NOT NULL,
  "work_center_id" integer,
  "standard_time_minutes" decimal(10, 2) NOT NULL DEFAULT '0',
  "created_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_routing_operations_routing" ON "routing_operations" ("routing_id", "sequence_no");
--> statement-breakpoint
-- Production Order gains an optional routing reference — when set, ProductionOrderService.create()
-- instantiates one production_order_operations row per routing_operations row, in sequence, so
-- the order's actual progress through the routing's steps can be tracked independently of the
-- routing definition itself (which may later change/deactivate without affecting past orders).
ALTER TABLE "production_orders" ADD COLUMN IF NOT EXISTS "routing_id" integer;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "production_order_operations" (
  "id" bigserial PRIMARY KEY,
  "production_order_id" integer NOT NULL,
  "tenant_id" integer NOT NULL,
  "routing_operation_id" integer,
  "sequence_no" integer NOT NULL,
  "operation_name" varchar(200) NOT NULL,
  "work_center_id" integer,
  "standard_time_minutes" decimal(10, 2) NOT NULL DEFAULT '0',
  "status" varchar(20) NOT NULL DEFAULT 'PENDING',
  "actual_time_minutes" decimal(10, 2),
  "started_at" timestamptz,
  "completed_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_poo_order" ON "production_order_operations" ("production_order_id", "sequence_no");
--> statement-breakpoint
UPDATE business_types SET default_capability_keys = '["HR_PAYROLL", "INVENTORY_BATCH", "BOM", "WORK_CENTERS", "PRODUCTION_ORDER", "ROUTING"]'::jsonb
WHERE code = 'MANUFACTURING';
