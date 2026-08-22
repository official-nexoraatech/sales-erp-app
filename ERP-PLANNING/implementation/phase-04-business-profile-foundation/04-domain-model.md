# 04 — Domain Model

Final shapes, resolving `25-decision-record.md` D1 toward its recommended option (a) — revise this document if the user answers D1 differently.

## 1. `industries` (new, global reference table)

```sql
CREATE TABLE industries (
  id bigserial PRIMARY KEY,
  code varchar(50) UNIQUE NOT NULL,
  name varchar(100) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
```

Seed: one row, `('COMMERCE', 'Commerce & Retail')`.

## 2. `business_types` (new, global reference table)

```sql
CREATE TABLE business_types (
  id bigserial PRIMARY KEY,
  code varchar(50) UNIQUE NOT NULL,
  industry_id bigint NOT NULL REFERENCES industries(id),
  name varchar(100) NOT NULL,
  default_capability_keys jsonb NOT NULL DEFAULT '[]',   -- RENAMED from the original
                                                          -- design's `default_module_keys`
                                                          -- per D1(a) — stores real
                                                          -- CAPABILITY_REGISTRY keys
  default_regulatory_pack varchar(50) NOT NULL DEFAULT 'INDIA_GST',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
```

Seed, two rows under the `COMMERCE` industry:

| code           | name         | default_capability_keys |
| -------------- | ------------ | ----------------------- |
| `CLOTH_RETAIL` | Cloth Retail | `[]`                    |
| `GROCERY`      | Grocery      | `["INVENTORY_BATCH"]`   |

## 3. `tenants` addition

```sql
ALTER TABLE tenants ADD COLUMN business_type_id bigint REFERENCES business_types(id);
-- nullable during the transition window; backfilled for every existing row in the same
-- migration (06-database-impact.md), so in practice no tenant is ever observed with a
-- NULL business_type_id after this migration completes — nullability is a migration-safety
-- property (additive column, no NOT NULL constraint that could fail mid-backfill), not an
-- intended steady-state.
```

`tenants.vertical` is **unchanged in shape** — still `varchar(20) NOT NULL DEFAULT 'CLOTH_RETAIL'`. This phase adds a synced twin column, not a replacement.

## 4. Entity classification

| Entity                     | NEW / MODIFIED / UNCHANGED                                                                                                        |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `industries`               | NEW                                                                                                                               |
| `business_types`           | NEW                                                                                                                               |
| `tenants.business_type_id` | NEW column on an existing table                                                                                                   |
| `tenants.vertical`         | UNCHANGED (shape and semantics — its _value_ stays authoritative, this phase adds a synced derivative, not a replacement)         |
| `MODULE_REGISTRY`          | Not built — confirmed never existed, not built by this phase either (`00-overview.md` §6)                                         |
| `CAPABILITY_REGISTRY`      | UNCHANGED — this phase's `default_capability_keys` seed data references its existing keys but does not modify the registry itself |

## 5. Relationships

```
industries (1) ──< (many) business_types (1) ──< (many) tenants
                         │
                         │ default_capability_keys (jsonb, descriptive only in this phase)
                         ▼
                  CAPABILITY_REGISTRY (code, unchanged, cross-referenced not modified)
```

## 6. Lifecycle / invariants

- `industries`/`business_types` rows are never deleted or updated by tenant-facing code — they are ops-managed reference data, same governance model as `plan_entitlements` (global, admin-maintained, not user-writable).
- A `tenants` row's `business_type_id` and `vertical` must always resolve to the same logical business type after this phase ships — enforced procedurally by `setTenantBusinessType()` being the only write path (`05-service-impact.md`), not by a DB constraint (matching the existing precedent that `vertical` itself has no DB-level cross-check against anything either — this is consistent with, not a regression from, current practice).
- No tenant-scoping/`tenant_id` column on either new table — they are global reference data, correctly outside `TenantScopedDatabase`'s auto-filtering, same pattern as `plan_entitlements`.

## 7. What is explicitly not modeled (unchanged from the architecture layer's own scope)

No `organizations` table. No `tenant_modules` table. No `capabilities` sub-table below `business_types` (capabilities remain `CAPABILITY_REGISTRY`, code-defined, cross-referenced by key string only — `default_capability_keys` is an array of strings, not a foreign key relationship, deliberately, since `CAPABILITY_REGISTRY` is code, not a table, and nothing in this codebase's existing conventions models a DB→code foreign reference any more strongly than a matched string key, e.g. `feature_flags.flag_key`).
