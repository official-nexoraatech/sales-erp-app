# 05 — Module / Capability Model

## 1. Definition

- **Module**: a coherent business function a tenant can turn on/off wholesale (HR, POS, CRM, Production, GST). Corresponds roughly to one `NAV_GROUPS` entry and one permission-prefix family today.
- **Capability**: a finer-grained behavior within a module (e.g. within `crm`: journey-builder, loyalty-tiering, referral-program). Represented as individual feature flags, not a new hierarchy level (see `04-domain-model.md` §6).

## 2. Why build on `feature_flags`, not a new table

`PlatformFeatureFlags` (`packages/platform-sdk/src/feature-flags.ts`) already provides exactly what a module-enablement system needs: per-tenant override over global default, 2-tier cache (30s memory / 300s Redis), Redis pub/sub hot-invalidation, and it's already proven in production use across ~20 flags. Building a second `tenant_modules` table with its own cache/invalidation would duplicate all of that for zero additional capability. This directly follows CLAUDE.md's Simplicity First principle and the brief's explicit instruction (§1, §24) not to introduce new infrastructure without a concrete need.

## 3. Registry → enablement flow

```
MODULE_REGISTRY['hr'].requiredFeatureFlagKeys = ['hr.payroll.enabled']

isModuleEnabled(tenantId, 'hr'):
  for each key in MODULE_REGISTRY['hr'].requiredFeatureFlagKeys:
    if !PlatformFeatureFlags.getValue(tenantId, key): return false
  return true
```

A module is "enabled" when **all** its required flags resolve true. Most modules will map to exactly one flag (matching the existing 1 module ≈ 1 flag pattern already seen for `pos.enabled`, `multi-branch.enabled`). Modules needing multiple flags (e.g. `crm` spanning several sub-flags) are the exception, not the default design.

## 4. Provisioning-time seeding

`TenantProvisioner.seedFeatureFlags(tenantId, vertical)` already exists (`apps/tenant-service/src/domain/TenantProvisioner.ts:422-454`) and already applies `VERTICAL_DEFAULTS[vertical].featureFlagOverrides` on top of a base list. This generalizes directly:

```ts
// today:
seedFeatureFlags(tenantId, vertical); // reads VERTICAL_DEFAULTS[vertical]

// target (additive change, same function signature pattern):
seedFeatureFlags(tenantId, businessTypeId); // reads business_types.default_module_keys,
// resolves each module code via MODULE_REGISTRY
// to its requiredFeatureFlagKeys, seeds them true
```

`VERTICAL_DEFAULTS` doesn't disappear — it becomes the `CLOTH_RETAIL`/`GROCERY` rows' `default_module_keys` content, migrated once (see `15-migration-strategy.md`).

## 5. Request-time gating

New `requireModule(moduleCode)` preHandler in `packages/platform-sdk` (new file, alongside the existing `requirePermission`), added **only** to route trees whose entire module can be legitimately absent for a tenant (HR routes, Production routes, a future Rooms/Reservations module) — not retrofitted onto every existing route, since most modules (Sales, Inventory, Accounting) are always-on Commerce Core and don't need the check. Ordering: `requireModule` before `requirePermission` (cheaper failure, and "module not enabled" is a clearer error than "permission denied" for a genuinely absent feature).

## 6. Frontend consumption

The session/auth-context payload the frontend already fetches (whatever currently supplies `permissions[]` to `web-frontend`) gains one additional field, `enabledModules: string[]`, computed server-side once per session/token-refresh (not per-nav-render) — cheap, since it's the same `PlatformFeatureFlags` calls the backend already makes for route guards, just aggregated. `filterNavItem` (`08-navigation-model.md`) reads this array.

## 7. New-industry onboarding checklist (using this model)

1. Add `business_types` row (industry_id, code, `default_module_keys`).
2. For each new module the industry needs that doesn't exist yet: add a `MODULE_REGISTRY` entry, corresponding `feature_flags` seed row(s), permission constants (prefixed per existing convention), nav group.
3. Existing modules (Sales, Inventory, Accounting, GST, HR) are reused as-is — no new registry entry needed, they're already Commerce Core defaults.
4. No service split is required to add a module — a module can live inside an existing service (like GST modules live in `gst-service`, HR in `hr-service`) or a new service, per normal domain-ownership judgment (`01-current-state.md` §9), not because the module system requires it.
