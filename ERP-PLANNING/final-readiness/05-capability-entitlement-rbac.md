# 05 — Capability, Entitlement & RBAC Audit

Independent verification against the live working tree. This is the single most important area of the audit — it is the mechanism the entire "multi-industry without forking" claim depends on. Two of the audit's three confirmed BLOCKERs live here.

## Overall verdict

**"Capability mechanism exists" — yes, and it is well-built where it is used.** The registry, guard, and cache are coherent, fail-closed on both unknown keys and resolution errors, and correctly composed with permission checks wherever both are present.

**"Capability mechanism actually protects things" — no, not uniformly.** POS and HR_PAYROLL are fully enforced end-to-end. INVENTORY_BATCH is correctly, narrowly scoped. But the entire Manufacturing vertical's 5 capabilities — the most recently built, most heavily documented part of the capability system — have **zero enforcement in their own owning service**, and every tenant's OWNER/ADMIN can already reach them today regardless of plan or vertical.

## 1. Capability registry — `packages/shared-types/src/capability-registry.ts`

8 entries: `HR_PAYROLL`, `POS`, `INVENTORY_BATCH`, `BOM`, `WORK_CENTERS`, `PRODUCTION_ORDER`, `ROUTING`, `MRP` (read in full, 138 lines). Flat namespace, each with `flagKey`, `requires` (dependency list), `applicableBusinessTypes` (display/provisioning metadata **only** — never read by `isCapabilityEnabled()`, so nothing at request time actually stops a Cloth-Retail tenant from having a manufacturing flag flipped on and passing the check). Cycle protection exists only as a unit test (`capability-registry.test.ts`'s DFS), **not** as a runtime guard — the recursive resolver in `capability-guard.ts:83-85` has no visited-set. Rated **LOW** (no cycle exists today; protection is a CI gate, not defense-in-depth).

## 2. Capability guard runtime mechanism — `packages/platform-sdk/src/capability-guard.ts`

`requireCapability()` returns a Fastify preHandler, fail-closed on unknown key (`if (!def) return false`) and on resolution error (503 `CAPABILITY_RESOLUTION_UNAVAILABLE`, distinguished from a definitive 403 `CAPABILITY_NOT_ENABLED` in both the metric label and wire response). No fail-open path found anywhere. Resolution hits `PlatformFeatureFlags` (DB/Redis with a two-tier cache — see §5).

## 3. BLOCKER — Manufacturing capabilities have zero backend enforcement

Grepped every `apps/*/src/api/*.routes.ts` for `requireCapability` usage. Result: **6 files total, across only 3 services** (sales-service: pos/promotion/day-end routes; hr-service: payroll; inventory-service: stock/item). **Zero files in `apps/production-service`** — confirmed by reading all 5 route files (`bom.routes.ts`, `mrp.routes.ts`, `routing.routes.ts`, `work-center.routes.ts`, `production-order.routes.ts`) in full: every preHandler uses only `requirePermission(PERMISSIONS.*)`, and neither `requireCapability` nor `isCapabilityEnabled` is imported anywhere in the service.

This means: `BOM`, `WORK_CENTERS`, `PRODUCTION_ORDER`, `ROUTING`, `MRP` are registered as `BETA`, `applicableBusinessTypes: ['MANUFACTURING']` capabilities in the registry — but the registry entries are **decorative**. Nothing in the actual request path checks whether a tenant's plan/vertical entitles them to these features.

The reason this is exploitable, not merely theoretical: `apps/tenant-service/src/rbac/role-defaults.ts:18-19` grants every tenant's `OWNER` role every permission in the system (`TENANT_SCOPED_PERMISSIONS`, minus 2 platform-only exclusions) — including `BOM_VIEW`, `PRODUCTION_ORDER_CREATE`, `MRP_CREATE_REQUISITION`, etc. — with zero vertical awareness. So **any tenant's OWNER, on any plan, in any vertical, can call these endpoints today.**

Corroborated independently by the navigation/API audit: `apps/production-service/src/api/bom.routes.ts` and `work-center.routes.ts` never call `requireCapability`, and the nav items for BOM/Work Centers don't even set `capabilityKey` — so neither the frontend nor the backend gates these by plan. This is currently inert only because `BOM_VIEW`/`WORK_CENTER_VIEW` are not yet granted to any _named_ default role (only the OWNER wildcard) — but it is exactly the shape of bug that ships silently the day a Manufacturing-vertical role default gets wired.

**Rated BLOCKER.** Fix is mechanical: add `requireCapability('BOM', ...)` etc. to the 5 production-service route files, following the exact pattern already proven correct on `stock.routes.ts:279-280`.

## 4. BLOCKER — billing plan-change reintroduces the vertical-default-override bug

`BillingService.assignPlanEntitlements(tenantId, plan)` (`apps/tenant-service/src/domain/BillingService.ts:38-82`) upserts every flag in a plan's `feature_flags` template with `enabled: true` (lines 71-78). Plan templates and vertical defaults share the same flag-key namespace with no cross-awareness:

- `packages/db-client/migrations/0040_pg027_billing_entitlements.sql:55-56` — the seeded `GROWTH` and `ENTERPRISE` plan templates both include `"pos.enabled"`.
- `apps/tenant-service/src/rbac/vertical-defaults.ts:37-44` (DISTRIBUTION) and `:48-65` (MANUFACTURING) both explicitly set `pos.enabled: false` ("a factory isn't a retail counter" / "wholesale is the default").
- The codebase's own prior fix for exactly this clash exists: `TenantProvisioner.ts:253-262` calls a private `reapplyVerticalFeatureFlagOverrides()` right after `assignPlanEntitlements` during **provisioning**, with an explicit comment describing the exact clash this audit is flagging.
- **But `reapplyVerticalFeatureFlagOverrides` is only ever called from `TenantProvisioner.provision()`** (2 call sites total in the repo: its own definition and that one call). The other real caller of `assignPlanEntitlements` — `PATCH /admin/tenants/:id/plan` (`apps/tenant-service/src/api/billing.routes.ts:83`), used to change an **existing** tenant's plan — calls it directly with no reapply step.

**Reproducible bug:** provision a DISTRIBUTION or MANUFACTURING tenant on STARTER (`pos.enabled=false`, correctly set). Later, upgrade that tenant to GROWTH/ENTERPRISE via the admin plan-change route. `pos.enabled` silently flips back to `true`, with nothing to re-suppress it. **No test covers this path** — `business-type-capability-consistency.test.ts` only exercises `TenantProvisioner.provision()`, never the plan-change route in isolation.

**Rated BLOCKER** — not "not yet fixed everywhere," but a confirmed regression of a previously-fixed bug class, reachable through a real, currently-shipped admin route.

Related, compounding finding: `assignPlanEntitlements` is **not wrapped in a DB transaction** (no `db.transaction(...)`, despite that convention existing elsewhere in the same service, e.g. `branch.routes.ts`) — a mid-loop failure leaves the tenant's `plan` column updated but only some flags granted. Rated **HIGH**.

## 5. Feature-flag cache — HIGH staleness window on entitlement changes

`packages/platform-sdk/src/feature-flags.ts`: two-tier cache, L1 in-memory (30s TTL), L2 Redis (300s TTL) with pub/sub invalidation across processes. **`BillingService.ts` and `TenantProvisioner.ts` never call `.invalidate()`** — grepped, zero calls in either file. So after any plan/entitlement change, stale cached values (up to 5 minutes) can be served in either direction by `isCapabilityEnabled()`. Rated **HIGH**, distinct from and additional to the §4 blocker.

## 6. RBAC genericity

Permission _naming_ is domain-generic where practical (`ITEM_VIEW`, `STOCK_VIEW`, `REPORT_VIEW`), but the _mechanism_ is closed-world: `TenantVertical` (`apps/tenant-service/src/rbac/vertical-defaults.ts:1`) is a hardcoded 4-value union (`CLOTH_RETAIL | GROCERY | DISTRIBUTION | MANUFACTURING`); `VERTICAL_DEFAULTS`/`ROLE_DEFAULTS` are hand-maintained `Record` types. Adding a 5th vertical (Hotel/Healthcare) requires editing 4 files across `permissions.ts`, `capability-registry.ts`, `vertical-defaults.ts`, `role-defaults.ts` — code changes, not configuration. Rated **MEDIUM** — architecturally expected for a 4-vertical MVP, but confirms the mechanism is not yet data-driven.

## 7. Dead/unchecked permission constants

A large, **self-documented** list is actively tracked by `packages/shared-types/src/__tests__/rbac-role-route-coverage.test.ts`, which scans every route file's `requirePermission()` call and requires each permission be either role-granted, in an `ADMIN_ONLY_BY_DESIGN` allowlist, or in `DEFERRED_PENDING_PRODUCT_DECISION`. All manufacturing permissions are currently in the deferred list ("no PRODUCTION_MANAGER role... OWNER/ADMIN-only by design until that decision lands"). **This test does not check capability enforcement at all** — it is a permission-vs-role coverage test, entirely blind to the §3 blocker.

## 8. JWT staleness on permission change

Permissions are embedded directly in the signed JWT (`apps/auth-service/src/jwt.ts:9,46`), with a 15-minute default access-token TTL (`apps/auth-service/src/config.ts:14`). A revoked/changed permission has up to a 15-minute exposure window until token expiry or refresh. Capability changes, by contrast, are resolved live per-request (bounded by the feature-flag cache TTL, §5) — a slightly unusual but not wrong asymmetry. Rated **MEDIUM**.

## Ranked findings

| #   | Finding                                                                                                               | Severity                    |
| --- | --------------------------------------------------------------------------------------------------------------------- | --------------------------- |
| 1   | `PATCH /admin/tenants/:id/plan` reintroduces the vertical-default-override bug on plan upgrades                       | **BLOCKER**                 |
| 2   | Zero `requireCapability` enforcement anywhere in production-service (BOM/WORK_CENTERS/PRODUCTION_ORDER/ROUTING/MRP)   | **BLOCKER**                 |
| 3   | `assignPlanEntitlements` not transaction-wrapped                                                                      | HIGH                        |
| 4   | Feature-flag cache has no push-invalidation from the billing write path — up to 5-min stale window                    | HIGH                        |
| 5   | The one test that could catch finding #1 (`business-type-capability-consistency.test.ts`) only exercises provisioning | HIGH (test-gap enabling #1) |
| 6   | 15-minute stale-JWT window for permission (not capability) changes                                                    | MEDIUM                      |
| 7   | RBAC/vertical mechanism is closed-world — 5th vertical needs code changes across 4 files                              | MEDIUM                      |
| 8   | Capability dependency-cycle protection is test-time only, no runtime guard                                            | LOW                         |
| 9   | `applicableBusinessTypes` metadata never enforced at runtime                                                          | LOW / DOC-ONLY              |
| 10  | Distribution pricing / Partner Portal have no capability-registry entry at all — out of scope of the system entirely  | DOC-ONLY (scope gap)        |

## Confirmed correct, no gap

POS and HR_PAYROLL: `requireCapability` present on every route checked (16 and 13 call sites respectively), paired correctly with `requirePermission`, backed by dedicated authz test suites. INVENTORY_BATCH: correctly, narrowly scoped (only the batch-specific endpoint gated, base stock routes intentionally ungated). Fail-closed behavior on unknown capability key and on resolution error. Capability-before-permission ordering wherever both checks exist together.
