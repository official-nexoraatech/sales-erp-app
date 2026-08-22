# 01 — Current Code Evidence

Everything below was independently verified this session by reading the actual files and querying the actual dev database — not copied from Phase 1/2's reports, though it is consistent with them.

## 1. Capability registry — unchanged since Phase 1, now has a third entry from Phase 2B

`packages/shared-types/src/capability-registry.ts`, read in full:

```ts
export const CAPABILITY_REGISTRY: Record<string, CapabilityDefinition> = {
  HR_PAYROLL: {
    key: 'HR_PAYROLL',
    name: 'HR Payroll',
    domain: 'HR',
    owningService: 'hr-service',
    flagKey: 'hr.payroll.enabled',
    requires: [],
    status: 'GA',
    applicableBusinessTypes: ['CLOTH_RETAIL', 'GROCERY'],
    permissions: ['PAYROLL_VIEW', 'PAYROLL_PROCESS'],
  },
  POS: {
    key: 'POS',
    name: 'Point of Sale',
    domain: 'Sales',
    owningService: 'sales-service',
    flagKey: 'pos.enabled',
    requires: [],
    status: 'GA',
    applicableBusinessTypes: ['CLOTH_RETAIL', 'GROCERY'],
    permissions: ['POS_ACCESS', 'POS_MANAGE'],
  },
  INVENTORY_BATCH: {/* Phase 2B, untouched by this phase */},
};
```

`HR_PAYROLL`'s `permissions` metadata lists `PAYROLL_VIEW`/`PAYROLL_PROCESS` only — `PAYROLL_APPROVE` (a real, separate constant, `permissions.ts:261`) is not listed. This is pre-existing (Phase 1 wrote this registry entry, not this phase) and is documentation metadata only — `isCapabilityEnabled`/`requireCapability` never read `def.permissions` (confirmed, `21-post-implementation-review.md` §3 item 5, re-confirmed by grep this session: zero references to `.permissions` in `capability-guard.ts`). Not a defect this phase needs to fix, but noted since `08-permissions-and-rbac.md` must not assume the metadata list is exhaustive.

## 2. `requireCapability(` — exactly one call site anywhere in `apps/`

```
apps/inventory-service/src/api/stock.routes.ts:292   requireCapability('INVENTORY_BATCH', ...)
```

Re-confirmed by full-tree grep this session (`grep -rn "requireCapability(" apps/ --include="*.ts"`, excluding tests and comments). **`HR_PAYROLL` and `POS` have never been passed to `requireCapability` in any file, ever.** The three other matches in the tree are all comments referencing the function by name, not calls (`users.ts:569`, `navigation.ts:960`, `auth.store.ts:17`).

## 3. HR Payroll route surface

`apps/hr-service/src/api/payroll.routes.ts` (1,090 lines) is the only file whose routes are gated by `PAYROLL_VIEW`/`PAYROLL_PROCESS`. Registered in `apps/hr-service/src/main.ts:124` (`await payrollRoutes(sub, ctxFactory);`), inside the same `fastify.register` block as every other `hr-service` route tree — no separate prefix/sub-app boundary exists today.

Routes (from `fastify.get/post(` scan):

| Line | Route (inferred from handler context) | Current preHandler                                                                                       |
| ---- | ------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| 80   | `GET /salary-structures`              | `authenticate`, `requirePermission(PAYROLL_VIEW)`                                                        |
| 98   | `POST /salary-structures`             | `authenticate`, `requirePermission(PAYROLL_PROCESS)`                                                     |
| 130  | `POST` (employee salary assignment)   | `authenticate`, `requirePermission(PAYROLL_PROCESS)` (pattern, verify exact line at implementation time) |
| 218  | `POST` (payroll run creation)         | same pattern                                                                                             |
| 266  | `GET` (payroll run detail/list)       | `PAYROLL_VIEW`                                                                                           |
| 314  | `GET` (payroll slip/detail)           | `PAYROLL_VIEW`                                                                                           |
| 923  | `POST /internal/payroll/prepare`      | `requireInternalKey` only — **no `authenticate`, no user JWT, called service-to-service (scheduler)**    |
| 1059 | `POST /internal/payroll/send-slips`   | `requireInternalKey` only — same                                                                         |

**The two internal routes are a distinct case**, flagged explicitly rather than silently folded into the same gating decision as the six user-facing routes — see `07-api-contracts.md` §3 and `25-decision-record.md` D2.

`employee.routes.ts:441` reads `PAYROLL_VIEW` **in-handler**, not as a route preHandler — it conditionally includes the salary field in an employee-detail response. This is a permission check on a field, not a route gate, and is unaffected by whether the `HR_PAYROLL` capability is enabled — matching the precedent `39-implementation-report.md` §7 already established for `item.routes.ts`'s in-handler pattern. **Explicitly out of scope for backend route gating**, see `00-overview.md` §6.

## 4. POS route surface — three files, not one

Grep for the `POS_*` permission family across `apps/sales-service/src/api/` found real (non-comment) usage in:

| File                  | Routes using `POS_*`                                                                                                                               | Role in the checkout flow                                             |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| `pos.routes.ts`       | 12 routes (sessions open/close/summary, sale creation, quick-items, item search, lookup-filters, customer-search, held-sales create/list, UPI VPA) | The core POS surface                                                  |
| `day-end.routes.ts`   | 2 routes (`POS_ZREPORT_GENERATE`, `POS_ZREPORT_VIEW`)                                                                                              | Z-report / end-of-day settlement — only meaningful when POS is in use |
| `promotion.routes.ts` | 1 route, `requireAnyPermission([POS_MANAGE, POS_ACCESS])` — the file's own comment states this route is "part of the checkout flow itself"         | Promotion/discount application during POS checkout                    |

`loyalty.routes.ts` has one comment referencing `POS_MANAGE` historically but no live permission check today — confirmed not part of the current POS surface.

All three files are registered in the same `fastify.register` block in `apps/sales-service/src/main.ts` (lines 334, 336, 335 respectively — `posRoutes`, `dayEndRoutes`, `promotionRoutes`), alongside every other sales-service route tree (CRM, invoicing, quotations, etc.), which are **not** part of the POS capability and must not be affected.

See `26-affected-flow-matrix.md` for the full per-route impact analysis.

## 5. Feature flag reality check — the finding driving this phase's rollout design

Live query against the dev Postgres instance (`erp-postgres-primary`, `docker exec ... psql`), this session:

```sql
SELECT tenant_id, flag_key, enabled FROM feature_flags
WHERE flag_key IN ('pos.enabled','hr.payroll.enabled') ORDER BY flag_key, tenant_id;
```

Result: 28 tenants total. Only `tenant_id = 2` and `tenant_id = 13` have either flag `true`; every other tenant-scoped row is `false`. One `tenant_id IS NULL` (global-fallback) row exists for `pos.enabled = true` — irrelevant for any tenant that already has its own explicit `false` row, since `PlatformFeatureFlags`'s resolution order is tenant-row-first (confirmed in Phase 2B's own review, `41-phase-2b-closure-review.md` §8).

```sql
SELECT tenant_id, count(*) FROM pos_sessions GROUP BY tenant_id;     -- tenant 2: 15 rows, only tenant with any
SELECT tenant_id, count(*) FROM payroll_runs GROUP BY tenant_id;     -- tenant 2: 3 rows, only tenant with any
```

**Both provisioning defaults are `false`** — `TenantProvisioner.seedFeatureFlags` (`apps/tenant-service/src/domain/TenantProvisioner.ts:422-434`) seeds `{ key: 'pos.enabled', enabled: false }` and `{ key: 'hr.payroll.enabled', enabled: false }` unconditionally; `vertical-defaults.ts`'s `featureFlagOverrides` for both `CLOTH_RETAIL` and `GROCERY` are confirmed empty for these two keys (only `hr.tailoring.enabled` is overridden, for `CLOTH_RETAIL`).

**No code anywhere reads either flag to gate route access today.** This is the load-bearing fact: a tenant's flag value has never had to be accurate for that tenant to actually use POS or Payroll, because nothing has ever checked it. The dev database's real usage rows happen to belong to the one tenant whose flags are already `true` — self-consistent in this dataset, but this is confirmed dev/test data (`project_dev_phase_no_data` memory: no real production tenants exist in this environment), so it cannot be generalized to "every real tenant's flag is accurate." See `00-overview.md` §4 and `25-decision-record.md` D1.

**Sharper finding — this is not arbitrary drift, it's an unenforced plan-tier design, with at least one real data-integrity gap.** `plan_entitlements.feature_flags` (queried live this session) shows:

```
STARTER    : [...no pos.enabled, no hr.payroll.enabled...]
GROWTH     : [..., "pos.enabled"]                                    -- no hr.payroll.enabled
ENTERPRISE : [..., "pos.enabled", "hr.payroll.enabled", ...]
```

Tenant plan distribution: 25 `STARTER`, 3 `ENTERPRISE`, 0 `GROWTH`. The two tenants with both flags `true` (2, 13) are both `ENTERPRISE` — consistent with the plan design. **But the third `ENTERPRISE` tenant (id `1`) has zero `feature_flags` rows for either key** (confirmed by an explicit `LEFT JOIN`, both columns `NULL`) — a real tenant whose plan entitles it to both capabilities but whose `feature_flags` state was never populated to match, almost certainly because `assignPlanEntitlements` was never (re-)run for it after these keys were added to the `ENTERPRISE` template. This is exactly the kind of pre-existing entitlement/flag drift D1 must account for — a blanket "set every tenant's flag to `true`" backfill would work for tenant 1 by accident; a narrower "only tenants with usage-history evidence" backfill would **miss** tenant 1 entirely (it has no `pos_sessions`/`payroll_runs` rows, plausibly because it's never been able to use either feature). See `25-decision-record.md` D1's revised recommendation.

## 6. `ctxFactory` wiring pattern — identical in both target services

Both `apps/hr-service/src/main.ts` and `apps/sales-service/src/main.ts` construct one `PlatformContextFactory` at startup (`const ctxFactory = new PlatformContextFactory({...})`), call `ctxFactory.connect()`, and pass the same `ctxFactory` instance into every route-registration function, including `payrollRoutes(sub, ctxFactory)` and `posRoutes(sub, ctxFactory)`. `requireCapability(capabilityKey, db, redis)` needs exactly `ctxFactory.rawDb` and `ctxFactory.getRedis()` — both already available at every one of these call sites, identical to the pattern `stock.routes.ts:292` already proved in Phase 2B. No new wiring mechanism is needed; this is copy the pattern, not invent one.

## 7. `pos-frontend` — confirmed to have zero capability-awareness

```
grep -rn "enabledCapabilities|capabilityKey|CAPABILITY_REGISTRY" apps/pos-frontend/src   → no matches
find apps/pos-frontend/src -iname "*nav*"                                                → no matches
```

Consistent with Phase 1's own finding (`20-implementation-report.md` §17 item 3: "`pos-frontend` has no equivalent wiring — confirmed out of scope by `08-frontend-navigation.md` §9"). `pos-frontend` has no `navigation.ts`-equivalent static nav-group structure to tag with `capabilityKey` — it is a smaller, different-shaped app (till/session-oriented, not a multi-module sidebar). Any frontend-side "POS capability off" UX for `pos-frontend` is new work, not an extension of an existing filter function. Scoped explicitly in `09-navigation-and-frontend.md` §9, not assumed away.

## 8. What does NOT need to change

- `apps/hr-service/src/api/employee.routes.ts` — in-handler check only (§3).
- `apps/sales-service/src/api/loyalty.routes.ts` — no live `POS_*` check (§4).
- `packages/shared-types/src/capability-registry.ts` — both entries already correct in shape; no edit needed.
- `packages/platform-sdk/src/capability-guard.ts` — the mechanism itself; reused unchanged, zero new logic (confirmed no gap in the existing three-outcome contract for this use case, unlike Phase 2B which needed the PUT-vs-POST transition-state fix for `item.routes.ts`).
- Any migration file — **unless** D1 resolves toward a backfill (`06-database-impact.md`).
