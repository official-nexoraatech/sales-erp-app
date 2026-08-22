# 04 — Domain Model: New Entities

All new tables follow existing repo conventions confirmed in `01-current-state.md`: `bigserial` PK, `created_at`/`updated_at`, plain-SQL migrations in `packages/db-client/migrations/NNNN_description.sql`, Drizzle schema in `packages/db-client/src/schema/*.ts`, no RLS (matches current convention, not a deviation).

## 1. `industries` (new, global — no tenant_id, reference data like `plan_entitlements`)

```sql
CREATE TABLE industries (
  id bigserial PRIMARY KEY,
  code varchar(50) UNIQUE NOT NULL,       -- 'COMMERCE', 'MANUFACTURING', 'HOSPITALITY', 'HEALTHCARE'
  name varchar(100) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
```

## 2. `business_types` (new, global)

```sql
CREATE TABLE business_types (
  id bigserial PRIMARY KEY,
  code varchar(50) UNIQUE NOT NULL,        -- 'CLOTH_RETAIL', 'GROCERY', 'HOTEL', 'RESTAURANT', ...
  industry_id bigint NOT NULL REFERENCES industries(id),
  name varchar(100) NOT NULL,
  default_module_keys jsonb NOT NULL DEFAULT '[]',   -- ['pos','inventory','crm','hr', ...]
  default_regulatory_pack varchar(50) NOT NULL DEFAULT 'INDIA_GST',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
```

Seed data at migration time: `CLOTH_RETAIL` and `GROCERY` rows under a `COMMERCE` industry — this is a **data migration of what already exists**, not new business modeling (see `15-migration-strategy.md` step 1).

## 3. `tenants` additions (additive, nullable during transition)

```sql
ALTER TABLE tenants ADD COLUMN business_type_id bigint REFERENCES business_types(id);
-- tenants.vertical (existing varchar(20)) is retained; a migration backfills
-- business_type_id from the existing vertical value, and a thin write-path
-- helper keeps `vertical` in sync going forward (see 15-migration-strategy.md).
```

No `regulatory_pack` column directly on `tenants` in v1 — derived from `business_types.default_regulatory_pack` unless a future need (e.g. same business type, different country) requires a tenant-level override. Not built speculatively (CLAUDE.md §2).

## 4. Module registry — code, not DB

Per `03-target-architecture.md` §3, modules are defined in code (`packages/shared-types/src/modules.ts`, new file), mirroring how `ROLE_DEFAULTS` is a code-defined template, not a DB table:

```ts
export interface ModuleDefinition {
  code: string; // 'hr', 'pos', 'crm', 'production', 'gst', 'hospitality-rooms', ...
  name: string;
  requiredFeatureFlagKeys: string[]; // existing PlatformFeatureFlags keys
  permissionPrefixes: string[]; // existing PERMISSIONS prefixes this module owns
  navGroupLabels: string[]; // existing NAV_GROUPS labels this module owns
}

export const MODULE_REGISTRY: Record<string, ModuleDefinition> = {
  hr: {
    code: 'hr',
    name: 'HR & Payroll',
    requiredFeatureFlagKeys: ['hr.payroll.enabled'],
    permissionPrefixes: ['HR_', 'EMPLOYEE_', 'ATTENDANCE_', 'PAYROLL_', 'LEAVE_'],
    navGroupLabels: ['HR & PAYROLL'],
  },
  pos: {
    code: 'pos',
    name: 'Point of Sale',
    requiredFeatureFlagKeys: ['pos.enabled'],
    permissionPrefixes: ['POS_'],
    navGroupLabels: [], // POS is its own frontend app, not a web-frontend nav group
  },
  // ... one entry per existing module, populated incrementally, not all at once
};
```

Why code, not a DB table: modules are a **development-time** concept (new modules ship with new code, they can't be "added" via admin UI without the code existing first) — matching how `ROLE_DEFAULTS` and `VERTICAL_DEFAULTS` are already code, not data. This also avoids a chicken-and-egg problem where a DB-registered module has no corresponding routes/nav yet.

## 5. Relationships diagram

```
industries 1───* business_types 1───* tenants ───* users
                       │                  │
                       │ default_module_keys
                       ▼                  │
                MODULE_REGISTRY (code) ───┘ (used to seed feature_flags at provisioning)
                       │
                       ▼
                feature_flags (existing table — tenant-scoped, per-module keys)
                       │
                       ▼
        requireModule() preHandler / navigation filter (read-time gate)
```

## 6. What is explicitly NOT modeled

- No `organizations` table (confirmed unnecessary, `01-current-state.md` §2).
- No `tenant_modules` table (module state lives in `feature_flags`, not a parallel table — `02-gap-analysis.md` G1/G6).
- No `capabilities` sub-table below module in v1 — the brief's "Capability" concept (finer than Module) is represented by individual feature flags within a module's `requiredFeatureFlagKeys`/adjacent optional flags, not a new hierarchy level. If a real need for capability-level entitlement (distinct from module-level) emerges during Phase 10, extend `ModuleDefinition` with an `optionalCapabilities: string[]` field rather than a new table — additive, not speculative.
