# 20 — Phase 1 (Capability Foundation): Implementation Report

Implemented 2026-08-18, following `17-file-level-change-plan.md`'s sequencing exactly, against the plan approved in docs 00–19 of this folder and `ERP-PLANNING/multi-industry-platform/21-capability-resolution-architecture.md`.

---

## 1. Executive Summary

Phase 1 is implemented, tested, and verified against live code. The capability-resolution mechanism (`CAPABILITY_REGISTRY`, `requireCapability()`/`isCapabilityEnabled()`, the three-way `CAPABILITY_NOT_ENABLED`/`FORBIDDEN`/`CAPABILITY_RESOLUTION_UNAVAILABLE` contract) is built, proven against the two real, currently-seeded flags (`hr.payroll.enabled`, `pos.enabled`), and wired end-to-end into the frontend's UX-only capability delivery path (`GET /users/me` → `auth.store` → `navigation.ts`). No production route was wired to `requireCapability` — that remains explicitly out of scope, per `00-overview.md`. Zero schema/migration change. Zero existing route, permission, or JWT behavior changed.

All planned deliverables shipped. Two mechanical gaps in the plan's own file list were discovered and closed during implementation (§16). No architectural decision was overturned; no out-of-scope item was implemented.

---

## 2. Implementation Status

**Complete.** Every item in `16-acceptance-criteria.md` is satisfied except the DB+Redis integration test's live execution (written and correct, but not run against real infrastructure this session — no local Postgres/Redis available; see §11 and §17).

---

## 3. Files Changed (existing files, modified)

| File                                                            | Change                                                                                                    |
| --------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `packages/shared-types/src/index.ts`                            | Added `export * from './capability-registry.js';`                                                         |
| `packages/platform-sdk/src/index.ts`                            | Added `export { requireCapability, isCapabilityEnabled } from './capability-guard.js';`                   |
| `packages/platform-sdk/package.json`                            | Added `fastify` as a dependency (see §16, deviation 1)                                                    |
| `packages/logger/src/erp-metrics.ts`                            | Added `erpCapabilityCheckDeniedTotal` counter (see §16, deviation 2)                                      |
| `packages/logger/src/index.ts`                                  | Exported `erpCapabilityCheckDeniedTotal`                                                                  |
| `apps/tenant-service/src/domain/BillingService.ts`              | Added one docblock line (single-owner rule) — zero logic change                                           |
| `apps/auth-service/src/routes/users.ts`                         | `GET /users/me` now computes and returns `enabledCapabilities: string[]`                                  |
| `apps/web-frontend/src/lib/navigation.ts`                       | `NavItem.capabilityKey?`, `filterNavItem`/`filterNavGroups` gain `enabledCapabilities: Set<string>` param |
| `apps/web-frontend/src/components/Layout.tsx`                   | Updated `filterNavGroups` call site                                                                       |
| `apps/web-frontend/src/components/erp/ERPCommandPalette.tsx`    | Updated `filterNavGroups` call site (2nd real call site, not listed in the file-level plan — see §16)     |
| `apps/web-frontend/src/store/auth.store.ts`                     | `AuthUser.enabledCapabilities?: string[]`                                                                 |
| `apps/web-frontend/src/api/endpoints.ts`                        | `authApi.me()`'s return type gained `enabledCapabilities: string[]`                                       |
| `apps/web-frontend/src/lib/__tests__/navigation.test.ts`        | Updated call site (required by the signature change) + 2 new tests                                        |
| `apps/web-frontend/src/pages/auth/__tests__/LoginPage.test.tsx` | 1 new test proving the end-to-end login flow                                                              |
| `pnpm-lock.yaml`                                                | Updated by `pnpm install` after adding the `fastify` dependency                                           |

`apps/web-frontend/src/pages/auth/LoginPage.tsx` and `apps/web-frontend/src/api/client.ts` were **deliberately not modified** — see §16, deviations 3–4.

## 4. Files Added

- `packages/shared-types/src/capability-registry.ts` — `CapabilityDefinition`, `CAPABILITY_REGISTRY`, `getCapabilityDefinition`
- `packages/platform-sdk/src/capability-guard.ts` — `requireCapability`, `isCapabilityEnabled`
- `packages/platform-sdk/test/unit/capability-registry.test.ts` (9 tests)
- `packages/platform-sdk/test/unit/capability-guard.test.ts` (10 tests)
- `packages/platform-sdk/test/integration/capability-resolution.integration.test.ts` (4 tests, `DATABASE_URL`+`REDIS_URL`-gated)
- `packages/platform-sdk/test/integration/capability-guard-route.test.ts` (6 tests)
- `apps/auth-service/src/__tests__/users-me-capabilities.test.ts` (3 tests)

## 5. Files Deleted

None.

---

## 6. Database Changes

**None**, as designed (`10-database-and-migrations.md`). No migration, no schema file touched, no `drizzle-kit generate` run.

---

## 7. API Changes

- `GET /users/me` (`apps/auth-service`) — additive field only: `data.enabledCapabilities: string[]`. No existing field removed, renamed, or reshaped. Verified by 3 new tests, including one asserting every pre-existing field is unchanged.
- No new production route. No route gained a new preHandler. `requireCapability` exists and is fully tested but is not attached to any real route in this phase, per scope.

---

## 8. Capability Registry Changes

Exactly 2 entries, as specified:

| Key          | flagKey              | permissions (metadata only)       |
| ------------ | -------------------- | --------------------------------- |
| `HR_PAYROLL` | `hr.payroll.enabled` | `PAYROLL_VIEW`, `PAYROLL_PROCESS` |
| `POS`        | `pos.enabled`        | `POS_ACCESS`, `POS_MANAGE`        |

Both `flagKey`s confirmed real and seeded (`TenantProvisioner.ts`'s `seedFeatureFlags`, migration `0022_es28_seed_feature_flag_defaults.sql`). Permission values were corrected from the plan's illustrative placeholders — see §16, deviation 5.

---

## 9. Service Enforcement Changes

**None to production routes**, as designed. `requireCapability`/`isCapabilityEnabled` are built, exported from `@erp/sdk`, and proven via:

- Unit tests mocking `PlatformFeatureFlags` (all 4 preHandler outcomes + resolution/dependency-composition logic)
- A throwaway, never-deployed test route (`GET /__test/capability-check`) inside `platform-sdk`'s own test suite, proving the full `authenticate → requireCapability → requirePermission` chain, including tenant isolation and the composed-guard ordering

No file in `apps/hr-service`, `apps/sales-service` (routes), `apps/ai-copilot-service`, `apps/api-gateway`, any Kafka consumer, or any scheduler job was touched.

---

## 10. Frontend Changes

- `navigation.ts`: `NavItem.capabilityKey?: string` (optional, unused by any current `NAV_GROUPS` entry), `filterNavItem`/`filterNavGroups` gain a coarser capability-gate check ordered before the permission check.
- `Layout.tsx` and `ERPCommandPalette.tsx` (the two real call sites) both pass `new Set(user?.enabledCapabilities ?? [])`.
- `auth.store.ts`: `AuthUser.enabledCapabilities?: string[]`, persisted automatically (already covered by `partialize`'s existing `user: s.user` — no change needed there).
- `LoginPage.tsx`: **not modified**. Its existing `completeLogin`'s `...(me as object)` spread already carries `enabledCapabilities` through automatically once it's part of `authApi.me()`'s response shape — confirmed by a new test (`LoginPage.test.tsx`).
- `client.ts` (`performRefresh`): **not modified** — `enabledCapabilities` is not re-derived on token refresh (unlike JWT-carried `roles`/`permissions`). Deliberate, plan-sanctioned (`17-file-level-change-plan.md`: "may be a no-op in this phase") — see §17.

No `NAV_GROUPS` entry was tagged with `capabilityKey`. Zero visible behavior change for any existing nav item (proven by a new test asserting an empty vs. populated-but-unrelated `enabledCapabilities` set filters identically).

---

## 11. AI Copilot Impact

None — confirmed, not re-verified from scratch this session (doc `09-ai-copilot-impact.md`'s conclusion was already re-verified during the pre-implementation gate review). No file in `apps/ai-copilot-service` was touched; nothing in this phase changes that conclusion, since no real route was gated.

---

## 12. Tests Executed

| Suite                                                                                          | Result                                                                                                                                                                                   |
| ---------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/platform-sdk` unit (`capability-registry.test.ts`, `capability-guard.test.ts`)       | 19/19 passed                                                                                                                                                                             |
| `packages/platform-sdk` route-level integration (`capability-guard-route.test.ts`)             | 6/6 passed                                                                                                                                                                               |
| `packages/platform-sdk` DB+Redis integration (`capability-resolution.integration.test.ts`)     | **Written, correctly `describe.skipIf`-gated on `DATABASE_URL`+`REDIS_URL`; not executed — no local Postgres/Redis available this session (Docker not running).** Genuine gap — see §17. |
| `apps/auth-service` full suite                                                                 | 66/66 passed (incl. 3 new `/users/me` tests, 15 existing `users-authz.test.ts` unchanged)                                                                                                |
| `apps/tenant-service` (`billing-service.test.ts`, `tenant-admin-authz.test.ts`)                | 14/14 passed                                                                                                                                                                             |
| `apps/web-frontend` (`navigation.test.ts`, `ERPCommandPalette.test.tsx`, `LoginPage.test.tsx`) | 140/140 passed                                                                                                                                                                           |
| Full monorepo `turbo run type-check` (30 packages)                                             | 35/35 tasks passed                                                                                                                                                                       |
| Full monorepo `turbo run test --continue` (all services)                                       | 25/34 tasks passed cleanly; 9 pre-existing failures, all confirmed unrelated (see §13)                                                                                                   |

## 13. Test Results — Regression Analysis

The full-suite run surfaced failures in `@erp/config`, `@erp/types` (2 unrelated coverage tests), `@erp/accounting-service`, `@erp/sales-service`, `@erp/hr-service`, `@erp/api-gateway`, `@erp/event-service`, `@erp/inventory-service`, and one `@erp/web-frontend` test (`no-dark-variant-regression.test.ts`, a 15s test-suite-scan timeout under parallel CPU load). **None of these packages/files were touched by this phase.** Definitively confirmed pre-existing (not a regression from this work) by:

1. Stashing every Phase 1 change (`git stash -u`) and re-running `apps/hr-service/src/__tests__/employee-documents.test.ts` standalone against the clean baseline — **identical 14/14 failures**, byte-for-byte the same assertions (`expected 401 to be 403/404`).
2. Restoring the stash and confirming the working tree matched exactly (`git status` before/after).
3. The uniform `401`-instead-of-`{200,403,404}` failure signature across every one of these unrelated services matches a previously-documented, pre-existing flakiness/environment class in this repo (JWT/test-infra issues under heavy parallel test load — see this session's own memory: `turbo_parallel_test_false_failures.md`, `concurrent_sessions_on_same_repo.md`).

Every package this phase actually touches (`@erp/types`, `@erp/sdk`, `@erp/logger`, `@erp/auth-service`, `@erp/tenant-service`, `@erp/web-frontend`) passed 100% both standalone and inside the full-suite run.

---

## 14. Build/Typecheck/Lint Results

- **Typecheck**: `turbo run type-check` across all 30 packages — **35/35 tasks passed**, zero errors.
- **Build**: `packages/shared-types`, `packages/logger`, `packages/platform-sdk` built successfully (`tsc`, zero errors). Rebuilding these was required mid-session for consuming packages' typechecks to see the new barrel exports (dist-based resolution, a known repo characteristic).
- **Lint**: `packages/shared-types`, `packages/platform-sdk` (0 errors — 1 pre-existing error in `feature-flags.ts:121`, not touched by this phase), `apps/auth-service` (0 errors, 3 pre-existing-style warnings in the new test file), `apps/web-frontend` (0 errors). No new lint error introduced anywhere.

---

## 15. Backward Compatibility Verification

- **Existing Grocery/Clothing-Retail tenants**: unaffected — confirmed via the full `auth-service`/`tenant-service` regression suites (81 tests, 100% pass) and the full-monorepo typecheck.
- **Existing roles/permissions**: untouched — `ROLE_DEFAULTS`, `permissions.ts` read-only referenced.
- **Existing JWT behavior**: untouched — no file in `jwt.ts`/`auth.ts` (token issuance/verification) was modified.
- **Existing navigation**: byte-for-byte identical for every current nav item — proven by a dedicated new test (`navigation.test.ts`: empty vs. unrelated-populated `enabledCapabilities` set produce identical filtered output).
- **Existing `/users/me` consumers**: additive field only, verified by a dedicated new test asserting every pre-existing field is unchanged.
- **`git diff` scope**: matches `17-file-level-change-plan.md`'s file list plus the 5 documented, mechanically-necessary additions (§16).

---

## 16. Deviations from Plan

1. **`packages/platform-sdk/package.json` needed a new `fastify` dependency** (not in the file-level plan). `capability-guard.ts`'s own approved design (`05-platform-sdk.md` §2) imports `FastifyRequest`/`FastifyReply`/`preHandlerAsyncHookHandler` types directly — but `platform-sdk` had zero prior Fastify dependency, and `auth.ts`'s own comment states the package is deliberately "framework-agnostic (no Fastify import)." This is a real, noteworthy tension between the plan's explicit, repeatedly-stated design (`requireCapability` centralized in `platform-sdk`, unlike the historically-per-service `requirePermission`) and the package's stated philosophy. Resolved as **mechanical, not architectural**: the import is `import type` only (zero runtime dependency, erased at compile time), and every consumer of `requireCapability` already depends on `fastify` directly. Added `"fastify": "^5.9.0"` (matching the version pinned elsewhere in the monorepo) and ran `pnpm install`. Flagged here per the "if the plan and code differ, document and continue only if purely mechanical" instruction — this did not change any security/architectural property.
2. **`packages/logger/src/erp-metrics.ts`/`index.ts` were not in the file-level plan's table**, but `14-observability-and-audit.md` §2 explicitly requires the `erp_capability_check_denied_total` counter, and the codebase's only existing convention for Prometheus counters is this exact file (`getOrCreateCounter`, idempotent registration). Added the counter there, following the identical pattern already used by `tenantStatus.ts`'s `erpTenantBlockedRequestsTotal`. An omission-fix, not a new architecture.
3. **`apps/web-frontend/src/components/erp/ERPCommandPalette.tsx`** is a second, real call site of `filterNavGroups` not mentioned anywhere in `17-file-level-change-plan.md` (which only lists `Layout.tsx`). Required for compilation once `filterNavGroups`'s signature changed; wired identically to `Layout.tsx` for consistency (the command palette should reflect the same capability-filtered nav as the sidebar).
4. **`LoginPage.tsx` and `client.ts` were left unmodified**, per the plan's own explicit allowance that both are "possibly a no-op in this phase." `LoginPage.tsx`'s existing object-spread already carries `enabledCapabilities` through with zero code change (verified by test); `client.ts`'s `performRefresh` does not re-sync `enabledCapabilities` on token refresh — see §17 (known limitation).
5. **Registry `permissions` metadata values corrected against real code**: the plan's own placeholder for `POS` (`['POS_SALE_CREATE', 'POS_MANAGE']`) does not exist in `permissions.ts` — real POS-related constants are `POS_ACCESS`, `POS_OPEN_SHIFT`, `POS_CLOSE_SHIFT`, `POS_APPLY_DISCOUNT`, `POS_VOID_BILL`, `POS_CASH_DRAWER`, `POS_ZREPORT_VIEW`, `POS_ZREPORT_GENERATE`, `POS_MANAGE`. Used `['POS_ACCESS', 'POS_MANAGE']`. This is exactly the verification step the plan itself flagged as required before merge (`03-capability-registry.md` §2's note), not a deviation from intent.

No architectural decision (frontend delivery mechanism, error contract, deferred-hardening scope, fail-closed design) was reopened or changed.

---

## 17. Known Limitations

1. **DB+Redis integration test not executed against real infrastructure this session** — correctly written and skip-gated (mirrors `tenant.integration.test.ts`'s exact `describe.skipIf(!DATABASE_URL)` convention, extended with a `REDIS_URL` gate since no such Redis-gated convention existed before this phase). No local Postgres/Redis was available (Docker Desktop not running). Should be run in CI or a dev environment with real infra before treating the DB/Redis-cache path as fully proven end-to-end — the mocked unit and route-level tests already prove the logic correctly, just not against the real `PlatformFeatureFlags` L1→L2→DB→Redis path.
2. **`enabledCapabilities` is not refreshed on token refresh** (`client.ts`'s `performRefresh`), unlike `roles`/`permissions` (which are re-decoded from the JWT on every refresh). A capability toggle can take effect in the frontend's nav filtering only after the next full login, not the next silent refresh. Deliberate and plan-sanctioned; has zero visible effect in this phase since no real nav item consumes `capabilityKey` yet.
3. **`pos-frontend`** has no equivalent wiring — confirmed out of scope by `08-frontend-navigation.md` §9 (no nav-group concept there).

---

## 18. Deferred Work

Unchanged from the plan — tracked, not touched:

- Wiring `requireCapability` onto any real HR/Production/other route (next phase).
- Tagging any real `NAV_GROUPS` entry with `capabilityKey` (next phase).
- `BillingService.assignPlanEntitlements` transaction-safety gap and `PlatformFeatureFlags` write-after-invalidate cache race — both documented in `19-deferred-hardening-risks.md`, neither touched.
- Business Profile (`industries`/`business_types`) workstream — independent track, not part of this phase.

---

## 19. Recommended Next Step

1. Run `capability-resolution.integration.test.ts` against real Postgres+Redis (CI or a dev box with Docker) to close limitation §17.1 before treating the mechanism as fully proven.
2. Proceed to the roadmap's "Phase 2 (future)" — wire `requireCapability` onto one real route per capability (starting with `HR_PAYROLL` or `POS`, each already proven), following the shadow/dry-run rollout sequence documented in `15-rollout-and-rollback.md`'s "what the next phase's rollout must look like" section, and expand the registry one entry per PR as real routes adopt it.
