-- Business Profile Foundation (ERP-PLANNING/implementation/phase-04-business-profile-foundation):
-- industries/business_types reference tables + tenants.business_type_id, backfilled from the
-- existing tenants.vertical column. vertical is retained (ADR-01), not replaced — this is a
-- synced, additive column, not a migration off vertical. default_capability_keys stores real
-- CAPABILITY_REGISTRY keys (packages/shared-types/src/capability-registry.ts), per phase-04's
-- D1 decision (confirmed 2026-08-19) — not the original planning doc's "default_module_keys"
-- name, since no MODULE_REGISTRY was ever built (superseded by the flat CAPABILITY_REGISTRY
-- model, multi-industry-platform/21-capability-resolution-architecture.md).

CREATE TABLE "industries" (
  "id" bigserial PRIMARY KEY,
  "code" varchar(50) NOT NULL,
  "name" varchar(100) NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "industries_code_unique" UNIQUE ("code")
);

CREATE TABLE "business_types" (
  "id" bigserial PRIMARY KEY,
  "code" varchar(50) NOT NULL,
  "industry_id" bigint NOT NULL REFERENCES "industries"("id"),
  "name" varchar(100) NOT NULL,
  "default_capability_keys" jsonb NOT NULL DEFAULT '[]',
  "default_regulatory_pack" varchar(50) NOT NULL DEFAULT 'INDIA_GST',
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "business_types_code_unique" UNIQUE ("code")
);

INSERT INTO "industries" ("code", "name") VALUES ('COMMERCE', 'Commerce & Retail');

INSERT INTO "business_types" ("code", "industry_id", "name", "default_capability_keys")
SELECT 'CLOTH_RETAIL', "id", 'Cloth Retail', '[]'::jsonb
FROM "industries" WHERE "code" = 'COMMERCE';

INSERT INTO "business_types" ("code", "industry_id", "name", "default_capability_keys")
SELECT 'GROCERY', "id", 'Grocery', '["INVENTORY_BATCH"]'::jsonb
FROM "industries" WHERE "code" = 'COMMERCE';

ALTER TABLE "tenants" ADD COLUMN "business_type_id" bigint REFERENCES "business_types"("id");

-- Lossless backfill: tenants.vertical is NOT NULL, constrained to exactly {'CLOTH_RETAIL',
-- 'GROCERY'} at the API boundary (tenant.schemas.ts's Zod enum), matching the two rows seeded
-- above one-for-one — every existing tenant resolves.
UPDATE "tenants" t SET "business_type_id" = bt."id"
FROM "business_types" bt WHERE bt."code" = t."vertical";
