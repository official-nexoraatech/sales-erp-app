-- Manufacturing vertical, Phase A (Bill of Materials foundation). Per the Phase 12 expansion-
-- framework review, this is the first real test of the capability model composing a genuinely
-- NEW capability (Grocery/Distribution both only ever reused existing ones). Data + new tables,
-- no changes to any existing table.

-- 1. New industry (first non-COMMERCE industry actually used) + business type.
INSERT INTO "industries" ("code", "name")
VALUES ('MANUFACTURING', 'Manufacturing')
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "business_types" ("code", "industry_id", "name", "default_capability_keys", "default_regulatory_pack")
SELECT 'MANUFACTURING', id, 'Manufacturing', '["HR_PAYROLL", "INVENTORY_BATCH", "BOM"]'::jsonb, 'INDIA_GST'
FROM "industries" WHERE "code" = 'MANUFACTURING'
ON CONFLICT ("code") DO NOTHING;
--> statement-breakpoint

-- 2. Bill of Materials — single-level (no nested sub-assemblies in Phase A). Only one isActive
--    BOM per (tenant, finished item, variant) is enforced in BOMService, not a DB constraint,
--    matching this codebase's existing soft-delete/isActive conventions elsewhere.
CREATE TABLE IF NOT EXISTS "boms" (
  "id" bigserial PRIMARY KEY,
  "tenant_id" integer NOT NULL,
  "name" varchar(200) NOT NULL,
  "finished_item_id" integer NOT NULL,
  "finished_variant_id" integer,
  "output_qty" decimal(15, 3) NOT NULL DEFAULT '1',
  "is_active" boolean NOT NULL DEFAULT true,
  "version" integer NOT NULL DEFAULT 0,
  "created_by" integer NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "idx_boms_tenant_item" ON "boms" ("tenant_id", "finished_item_id");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "bom_lines" (
  "id" bigserial PRIMARY KEY,
  "bom_id" integer NOT NULL,
  "tenant_id" integer NOT NULL,
  "component_item_id" integer NOT NULL,
  "component_variant_id" integer,
  "quantity_per_output" decimal(15, 3) NOT NULL,
  "scrap_percent" decimal(5, 2) NOT NULL DEFAULT '0',
  "created_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "idx_bom_lines_bom" ON "bom_lines" ("bom_id");
CREATE INDEX IF NOT EXISTS "idx_bom_lines_tenant_item" ON "bom_lines" ("tenant_id", "component_item_id");
