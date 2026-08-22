# 03 — Target Architecture

## 1. The conceptual chain

```
Tenant
  │
  ├─ Business Profile  (1:1 with tenant — which industry/business-type/country this tenant is)
  │     ├─ Industry           (COMMERCE, MANUFACTURING, HOSPITALITY, HEALTHCARE, ...)
  │     ├─ Business Type      (CLOTH_RETAIL, GROCERY, HOTEL, ... — refines Industry)
  │     └─ Regulatory Pack    (country/compliance — INDIA_GST today; separate dimension, see 02-gap-analysis G12)
  │
  ├─ Enabled Modules   (derived: Business Type's default module set ∪ manual overrides)
  │     └─ each Module = a set of Capabilities (fine-grained sub-features)
  │
  ├─ Entitlement (Plan)   (what the tenant is commercially allowed — plan_entitlements, ALREADY EXISTS)
  │
  └─ User
        └─ Role → Permission[]   (ALREADY EXISTS — RESOURCE_ACTION, JWT-carried)
              × Module-enabled?  (NEW — feature-flag-backed gate, see 05-module-capability-model.md)
              × Feature Flag     (ALREADY EXISTS — PlatformFeatureFlags)
              → Effective UI/API surface
                    → Navigation (client-side filter, existing mechanism + new module check)
                    → Domain Services (existing, unchanged trust model)
```

Everything left of "NEW" already exists and works. The target architecture is deliberately a **thin registry + gating layer** bolted onto existing, proven primitives — not a new subsystem.

## 2. Business Profile model

**Decision (see ADR-01 in `18-decisions.md`): Business Profile is a new concept, `Industry`/`Business Type` are new reference tables, `tenants.vertical` is retained as a computed/legacy-compatible column, not dropped.**

```
industries                    business_types                  tenants
─────────────               ────────────────                ──────────
id                           id                               id
code (COMMERCE, ...)         code (CLOTH_RETAIL, HOTEL, ...)  ...
name                         industry_id  FK → industries       business_type_id  FK → business_types (NEW, nullable during migration)
                              name                               vertical  varchar(20)  (KEPT — becomes a generated/synced legacy alias)
                              default_module_keys jsonb[]
                              default_regulatory_pack varchar
```

Why keep `vertical`: 4 known call sites read it directly today (`01-current-state.md` §3) — `TenantProvisioner`, `default-accounts.ts`, `vertical-defaults.ts`, the scheduler-internal route. Rather than a big-bang rename (rejected per brief §24 and CLAUDE.md's surgical-changes principle), `vertical` becomes a thin derived value: `business_types.code` for the tenant's `business_type_id`, kept in sync at write time. This lets every existing call site keep working unmodified through the transition, and only the _new_ code paths (module registry, nav) read `business_type_id`/`industries` directly. Full migration steps in `15-migration-strategy.md`.

Why a separate `Industry` above `Business Type`: the brief's own examples (Tenant A: COMMERCE/CLOTHING_RETAIL, Tenant C: HOSPITALITY/HOTEL) group multiple business types under one industry, and industries share more structural properties (e.g. does this industry typically need POS? Rooms? Patients?) than business types share pairwise. This grouping is descriptive/reporting-useful now and becomes load-bearing once module _defaults_ are set per-industry rather than repeated per-business-type.

**Explicitly NOT built:** multi-business-per-tenant. One `tenants` row still means one Business Profile. No evidence in the current codebase (tenant, branch, or provisioning model) suggests a tenant needs to run two industries simultaneously; if that need appears later, it's an additive extension (a `tenant_business_profiles` join table), not a redesign.

## 3. Module / Capability model

See `05-module-capability-model.md` for full design. Summary: a `Module` is a named bundle (`hr`, `pos`, `crm`, `production`) already implicitly present as feature-flag key prefixes and permission-name prefixes today. The registry formalizes this mapping without renaming anything:

```
modules (code-defined, not DB — mirrors ROLE_DEFAULTS' "template in code" pattern)
  code: 'hr' | 'pos' | 'crm' | 'production' | 'gst' | ...
  requiredFeatureFlagKeys: string[]     // existing PlatformFeatureFlags keys, e.g. ['hr.payroll.enabled']
  permissionPrefixes: string[]          // existing PERMISSIONS prefixes, e.g. ['HR_', 'EMPLOYEE_', 'PAYROLL_']
  navGroupLabels: string[]              // existing NAV_GROUPS labels this module owns
```

A tenant's **effective enabled-module set** = modules whose `requiredFeatureFlagKeys` all resolve `true` via the existing `PlatformFeatureFlags` for that tenant. No new enablement storage — module enablement _is_ feature-flag state, read through a registry lens. Business Type's `default_module_keys` just determines which flags get seeded `true` at provisioning (exactly how `VERTICAL_DEFAULTS` already works today, generalized).

## 4. Entitlement, Permission, Feature Flag — kept distinct (per brief §19/§4)

| Concept           | Question it answers                                           | Existing mechanism                                                               | New work                                                  |
| ----------------- | ------------------------------------------------------------- | -------------------------------------------------------------------------------- | --------------------------------------------------------- |
| Entitlement       | What does this tenant's _plan_ commercially allow?            | `plan_entitlements` + `tenants.settings.maxUsers/maxBranches` + `BillingService` | None required architecturally — already correct shape     |
| Module enablement | Is this module turned on for this tenant _right now_?         | `feature_flags` (tenant override)                                                | Registry layer (§3 above) reading existing flags          |
| Permission        | Can _this user_ perform _this action_?                        | JWT `permissions[]`, `RESOURCE_ACTION`                                           | Add module-association metadata only (`07-rbac-model.md`) |
| Feature Flag      | Is this specific sub-behavior on, independent of plan/module? | `feature_flags` (same table, different semantic layer)                           | None                                                      |

These three/four concepts share **one storage mechanism** (`feature_flags` table) by design — that's already true today for entitlement↔flag (PG-027 copies plan flags onto tenant flags) — but remain **conceptually distinct questions** asked at different points in the request lifecycle: entitlement is checked at plan-change/provisioning time, module-enablement at nav-render/route-guard time, permission at every single request.

## 5. Navigation

No backend navigation service (per brief §7, and no evidence justifies one — `01-current-state.md` §5 shows `navigation.ts` is small and static). `filterNavItem` gains one more predicate: module-enabled, sourced from the same capability set the frontend already fetches for permissions (extend whatever `/me` or `/auth/context` endpoint already returns `permissions[]` to also return `enabledModules: string[]`, computed server-side from the registry). Full design in `08-navigation-model.md`.

## 6. Diagram — request-time resolution

```
Request → Gateway (JWT sig/expiry check only, no header injection)
        → Service verifies JWT locally → tenantId, userId, permissions[]
        → requirePermission(X) preHandler                         [existing, unchanged]
        → NEW: requireModule(moduleKey) preHandler (optional,     [new, additive]
               only added to routes whose whole module can be
               disabled — e.g. HR routes check requireModule('hr'))
        → Domain handler                                          [existing, unchanged]
```

`requireModule` is a thin preHandler that calls the existing `PlatformFeatureFlags.getValue()` for that module's flag keys — same caching, same invalidation, zero new infrastructure.

## 7. What does NOT change

- JWT shape, gateway trust model, RBAC naming, DB tenancy pattern (app-level filter, not RLS — RLS is a separate hardening track, `13-security-architecture.md`), event envelope, service-per-bounded-context deployment model. All confirmed sound in `01-current-state.md` and preserved as-is.
