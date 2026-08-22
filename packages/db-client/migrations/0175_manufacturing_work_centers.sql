-- Manufacturing vertical, Phase B — Work Centers foundation.
CREATE TABLE IF NOT EXISTS "work_centers" (
  "id" bigserial PRIMARY KEY,
  "tenant_id" integer NOT NULL,
  "name" varchar(200) NOT NULL,
  "code" varchar(30) NOT NULL,
  "description" text,
  "capacity_per_day" decimal(15, 3) NOT NULL DEFAULT '0',
  "is_active" boolean NOT NULL DEFAULT true,
  "created_by" integer NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_work_centers_tenant_code" ON "work_centers" ("tenant_id", "code");
--> statement-breakpoint
ALTER TABLE "job_work_orders" ADD COLUMN IF NOT EXISTS "work_center_id" integer;
--> statement-breakpoint
UPDATE business_types SET default_capability_keys = '["HR_PAYROLL", "INVENTORY_BATCH", "BOM", "WORK_CENTERS"]'::jsonb
WHERE code = 'MANUFACTURING';
