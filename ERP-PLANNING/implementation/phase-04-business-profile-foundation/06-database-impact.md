# 06 — Database Impact

## New migration (number TO VERIFY at implementation time — see `25-decision-record.md` D2)

```sql
-- Reference tables
CREATE TABLE industries (
  id bigserial PRIMARY KEY,
  code varchar(50) UNIQUE NOT NULL,
  name varchar(100) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE business_types (
  id bigserial PRIMARY KEY,
  code varchar(50) UNIQUE NOT NULL,
  industry_id bigint NOT NULL REFERENCES industries(id),
  name varchar(100) NOT NULL,
  default_capability_keys jsonb NOT NULL DEFAULT '[]',
  default_regulatory_pack varchar(50) NOT NULL DEFAULT 'INDIA_GST',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Seed
INSERT INTO industries (code, name) VALUES ('COMMERCE', 'Commerce & Retail');

INSERT INTO business_types (code, industry_id, name, default_capability_keys)
SELECT 'CLOTH_RETAIL', id, 'Cloth Retail', '[]'::jsonb FROM industries WHERE code = 'COMMERCE';
INSERT INTO business_types (code, industry_id, name, default_capability_keys)
SELECT 'GROCERY', id, 'Grocery', '["INVENTORY_BATCH"]'::jsonb FROM industries WHERE code = 'COMMERCE';

-- tenants extension
ALTER TABLE tenants ADD COLUMN business_type_id bigint REFERENCES business_types(id);

-- Lossless backfill (01-current-code-evidence.md §4 — total function over the closed
-- {'CLOTH_RETAIL','GROCERY'} value set)
UPDATE tenants t SET business_type_id = bt.id
FROM business_types bt WHERE bt.code = t.vertical;
```

Idempotent: `CREATE TABLE` fails loudly (not silently) if re-run without a guard — matches this repo's existing migration convention of not wrapping `CREATE TABLE` in `IF NOT EXISTS` (confirmed by scanning `0164`-`0169`'s style, none use it for table creation, only `0169`'s `INSERT ... ON CONFLICT DO NOTHING`/`WHERE NOT EXISTS` guards its _data_ statements). The `UPDATE` backfill is safely re-runnable (idempotent by construction — re-running it against already-correct rows is a no-op).

**Verify at implementation time, not assumed from this planning pass**: `tenants`' exact column name casing (Drizzle convention vs. raw SQL — `packages/db-client/src/schema/tenant.ts` uses camelCase in TS, snake_case in the actual DB column per Drizzle's default mapping; `businessTypeId` in Drizzle schema, `business_type_id` in the migration SQL, consistent with every other column in this table).

## Rollback

Pure additive schema — `DROP TABLE business_types, industries; ALTER TABLE tenants DROP COLUMN business_type_id;` (drop order matters: `business_types` before `industries`, due to the FK). Nothing depends on the new column/tables yet (this phase builds no consumer), so rollback has zero downstream cleanup, unlike a phase that also ships a consumer of the new data.

## What this migration does NOT do

Does not touch `feature_flags`, `plan_entitlements`, `permissions`, or any table Phase 3's (still-undecided) migration might touch — confirmed zero table overlap between this phase's migration and Phase 3's proposed one (`phase-03-hr-payroll-pos-enforcement/06-database-impact.md` touches only `feature_flags`). The only real interaction between the two phases' migrations is the shared sequential-number pool (`25-decision-record.md` D2), not data.
