-- PG-037: Departments / Cost Centers — additive, optional accounting dimension.
-- Tenant-scoped reference table (unlike PG-044's globally-seeded pt_slabs) plus two
-- nullable FK columns. No existing row is touched; validate_journal_balance (DR=CR)
-- is unaffected since cost_center_id is an informational tag, not a balancing dimension.

CREATE TABLE IF NOT EXISTS "cost_centers" (
  "id" bigserial PRIMARY KEY,
  "tenant_id" integer NOT NULL,
  "code" varchar(30) NOT NULL,
  "name" varchar(300) NOT NULL,
  "parent_id" integer,
  "is_active" boolean NOT NULL DEFAULT true,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "created_by" integer NOT NULL,
  CONSTRAINT "cost_centers_tenant_code" UNIQUE ("tenant_id", "code")
);

CREATE INDEX IF NOT EXISTS "idx_cost_centers_tenant" ON "cost_centers" ("tenant_id");
CREATE INDEX IF NOT EXISTS "idx_cost_centers_parent" ON "cost_centers" ("parent_id", "tenant_id");

ALTER TABLE "accounts" ADD COLUMN IF NOT EXISTS "default_cost_center_id" integer;
ALTER TABLE "financial_entries" ADD COLUMN IF NOT EXISTS "cost_center_id" integer;

-- Rollback:
--   ALTER TABLE "financial_entries" DROP COLUMN "cost_center_id";
--   ALTER TABLE "accounts" DROP COLUMN "default_cost_center_id";
--   DROP TABLE "cost_centers";
