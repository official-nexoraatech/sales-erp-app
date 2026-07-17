# ES-35 Completion Report — RBAC Audit Phase C: Backend Permission Model Cleanup

**Date:** 2026-07-04
**Status:** COMPLETE

## What Was Done

### 1. Shared auth middleware

New `packages/platform-sdk/src/auth.ts` exports `verifyAccessToken()` and
`checkPermission()` — framework-agnostic (no Fastify dependency, matching this SDK's
existing convention), consolidating logic previously hand-duplicated across 12+ services.
Every service's `middleware/authenticate.ts`/`authorize.ts` is now a thin wrapper around
these shared functions, keeping only the Fastify-specific request/reply plumbing and the
`declare module 'fastify'` augmentation that has to stay per-service.

Rewrote in: `accounting-service`, `event-service`, `gst-service`, `hr-service`,
`inventory-service`, `notification-service` (plus its SSE `authenticateStream`),
`production-service`, `purchase-service`, `report-service`, `sales-service`,
`scheduler-service`, `search-service`, `tenant-service`. Deliberately left `auth-service`
untouched (it mints tokens via its own `jwt.ts`, a different concern from verification).

**Real drift eliminated:**

- `report-service` had a fully hand-rolled RS256 verifier (manual base64url decode,
  `crypto.createVerify`, manual `exp` check) — replaced with the shared `jose`-based
  implementation every other service already used.
- Standardized every auth error body to `{ error: { code, message } }`. Previously
  `hr-service`, `event-service`, `notification-service`'s `authenticateStream`, and
  `search-service` sent plain-string `{ error: 'message' }` bodies.

### 2. Route-guard-coverage test

New `packages/shared-types/src/__tests__/route-guard-coverage.test.ts` — text-scans every
`apps/*/src/api/*.routes.ts` and fails on a route with no recognizable guard. First run
flagged 29 routes. Investigation found:

**2 real gaps, fixed:**

| Route                                                                                                         | Problem                                                                                                                                                            | Fix                                                                                                                                                                                                 |
| ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `report-service` `POST /config/number-series/:type`, `.../preview`, `POST /internal/number-series/:type/next` | Zero auth; read `request.auth.tenantId` directly → would crash (500), not reject (401), on any call. No caller exists anywhere in the repo (dead/unwired feature). | Added `authenticate` to all 3; `requirePermission(NUMBER_SERIES_CONFIG)` (pre-existing, previously-unused permission) to the 2 config routes; left the internal next-number route authenticate-only |
| `tenant-service` `POST /organization/logo/upload`                                                             | `authenticate` only — any logged-in user of any role could get a presigned URL to overwrite the tenant's shared logo                                               | Added `requirePermission(ORG_SETTINGS_EDIT)`, matching sibling `PUT /organization`                                                                                                                  |

**27 legitimate exceptions**, documented with reasoning in the test's `KNOWN_EXCEPTIONS`
map: self-service account actions (auth-service MFA/sessions/impersonate-end — guarded by
a plugin-scoped `authenticate` hook this text-scan can't see), record-level authorization
(tenant-service approval routes, scoped to the caller's own userId as approver),
self-service notification inbox (ES-33), a public token-based unsubscribe link, and
reference-data GETs (branches, organization) intentionally open to any tenant member while
mutations require the stricter permission.

### 3. `CUSTOMER_DELETE` — frontend/backend sync bug, not a backend gap

The permission already existed in the backend (`packages/shared-types/src/permissions.ts`)
and was already correctly enforced on `DELETE /customers/:id`. It was simply **absent from
the frontend's** `constants/permissions.ts`, so `CustomersPage.tsx`'s Delete button could
never check it and rendered unconditionally for every user. Fixed:

- Added `CUSTOMER_DELETE` to `apps/web-frontend/src/constants/permissions.ts`.
- Gated `CustomersPage.tsx`'s Edit/Delete/+New Customer actions with `hasPermission()`,
  matching the pattern already used in its sibling `CustomerViewPage.tsx`.
- Added 2 new tests to `CustomersPage.test.tsx` (buttons hidden without permission, shown
  with it).

### 4. Permission constant normalization

- **Real bug found and fixed**: `role-defaults.ts`'s `SALES_MANAGER` was assigned
  `CUSTOMER_UPDATE` — a constant **no backend route checks at all**. The actual update
  route (`PUT /customers/:id`) requires `CUSTOMER_EDIT`. Net effect: Sales Managers cannot
  edit customer records today. Fixed: `SALES_MANAGER` now gets `CUSTOMER_EDIT`.
  `CUSTOMER_UPDATE` the constant was left defined (not deleted — full removal needs a
  wider check this phase didn't have budget for) but confirmed dead on the authz path.
- **`AUDIT_LOG_VIEW` vs `VIEW_AUDIT_LOG` — investigated, confirmed NOT duplicates.**
  `AUDIT_LOG_VIEW` gates Phase-12 distributed-systems admin views (event store, DLQ, saga
  monitor, schema registry, projections, performance — 15 usages across 5 files in
  `event-service`); `VIEW_AUDIT_LOG` gates the security/compliance audit-trail viewer
  (ES-19/ES-20, `auth-service`). Left both as-is. Documented here specifically so a future
  cleanup pass doesn't merge them incorrectly.
- **`WAREHOUSE_MANAGE` vs. fine-grained stock permissions — still deferred.** Carried over
  from ES-34. Two generations of stock permission constants exist
  (`STOCK_TRANSFER`/`STOCK_ADJUST`/`STOCK_ADJUST_APPROVE` vs.
  `STOCK_TRANSFER_VIEW`/`STOCK_ADJUSTMENT_VIEW`/`STOCK_ADJUSTMENT_MANAGE`/
  `PHYSICAL_VERIFICATION_VIEW`), neither wired to the actual backend routes (which check
  only `WAREHOUSE_MANAGE` — held only by `OWNER`/`ADMIN`, not `INVENTORY_MANAGER`).
  Properly fixing this needs route-guard rewrites across `transfer.routes.ts`,
  `adjustment.routes.ts`, `physical-verification.routes.ts` plus a `role-defaults.ts`
  update — larger and riskier than this phase's remaining time allowed. Left as an
  explicitly flagged follow-up, not silently dropped.
- **Third internal-key-check variant found, not consolidated**: `inventory-service`'s
  `reservation.routes.ts`/`stock.routes.ts` inline a `timingSafeEqual`-based check with
  local naming, distinct from the shared `requireInternalKey()` helper and from
  `report-service`'s locally-named `checkInternalKey`. Functionally correct — just a 4th
  copy of the same ~15 lines. Flagged for a future backend-hygiene pass.

## Files Changed

| File                                                                                                                                                    | Change                                                                                              |
| ------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `packages/platform-sdk/src/auth.ts`                                                                                                                     | New file — `verifyAccessToken()`, `checkPermission()`                                               |
| `packages/platform-sdk/src/index.ts`                                                                                                                    | Export the above                                                                                    |
| `packages/platform-sdk/package.json`                                                                                                                    | Added `jose@^5.9.6`                                                                                 |
| `apps/{accounting,event,gst,hr,inventory,notification,production,purchase,report,sales,scheduler,search,tenant}-service/src/middleware/authenticate.ts` | Rewritten to call `verifyAccessToken()`                                                             |
| `apps/{accounting,event,gst,hr,inventory,notification,production,purchase,report,sales,tenant}-service/src/middleware/authorize.ts`                     | Rewritten to call `checkPermission()`                                                               |
| `apps/scheduler-service/package.json`                                                                                                                   | Removed now-unused `jose` (added in ES-33, superseded by `@erp/sdk`)                                |
| `apps/report-service/src/api/report.routes.ts`                                                                                                          | Added auth to 3 previously-unguarded, broken routes                                                 |
| `apps/tenant-service/src/api/organization.routes.ts`                                                                                                    | Added `ORG_SETTINGS_EDIT` to logo upload                                                            |
| `apps/tenant-service/src/rbac/role-defaults.ts`                                                                                                         | `SALES_MANAGER`: `CUSTOMER_UPDATE` → `CUSTOMER_EDIT`                                                |
| `apps/web-frontend/src/constants/permissions.ts`                                                                                                        | Added `CUSTOMER_DELETE`                                                                             |
| `apps/web-frontend/src/pages/customers/CustomersPage.tsx`                                                                                               | Gated Edit/Delete/+New Customer actions                                                             |
| `apps/accounting-service/src/__tests__/permission-guards.test.ts`                                                                                       | Fixed string→object error assertion (real regression from this phase's error-shape standardization) |
| `apps/hr-service/src/__tests__/permission-guards.test.ts`                                                                                               | Fixed same pre-existing string→object assertion mismatch (predates this phase)                      |
| `apps/sales-service/src/__tests__/permission-guards.test.ts`                                                                                            | Fixed 3 instances of the same pre-existing mismatch                                                 |

## New Test Files

| File                                                               | Tests                                                                             |
| ------------------------------------------------------------------ | --------------------------------------------------------------------------------- |
| `packages/platform-sdk/src/__tests__/auth.test.ts`                 | 6: `checkPermission` 3-state, `verifyAccessToken` valid/forged-key/missing-config |
| `packages/shared-types/src/__tests__/route-guard-coverage.test.ts` | 1 (repo-wide scan); iterating on it surfaced and fixed 2 real gaps                |

`CustomersPage.test.tsx` extended from 2 to 4 tests (2 new, permission-gating).

## Test Results

**All 13 touched services + `@erp/sdk` + `@erp/types` + `web-frontend`: `type-check` clean.**
Full test suites run per-service: `@erp/sdk` 9 files/63 tests pass (incl. new
`auth.test.ts`); `report-service` 118/118; `sales-service`, `hr-service`,
`accounting-service` permission-guards suites all pass after the assertion fixes;
`notification-service`, `search-service`, `scheduler-service`, `purchase-service`,
`inventory-service`, `event-service`, `tenant-service`, `production-service` all pass;
`web-frontend` 17/17 (6 test files). `gst-service` has 3 pre-existing, confirmed-unrelated
timeout failures (`ewb.test.ts`, `gst-engine.test.ts`) and `accounting-service`/
`hr-service` have 1–2 more (`financial-year.test.ts`, `holiday.test.ts`) — all verified via
`git stash` and/or cross-file inspection to be pre-existing and unrelated to auth
middleware (timing flakiness under parallel test load, and a known pre-existing
`holidayCalendars`/`@erp/db` export bug respectively), not caused by this phase.

**Lint:** zero lint findings (errors or warnings) on any of the 24 rewritten
`authenticate.ts`/`authorize.ts` files — better than the pre-existing baseline, since the
`process.env` access that triggered the recurring "process is not defined" `no-undef`
error in 13 separate files now lives once in `@erp/sdk/auth.ts` (already carrying the
established `/* global process */` suppression comment).

## Deployment Checklist

- [x] **Backfill migration needed for existing tenants**: `role-defaults.ts`'s
      `SALES_MANAGER` permission set changed (`CUSTOMER_UPDATE` → `CUSTOMER_EDIT`).
      `ROLE_DEFAULTS` is only applied at tenant-provisioning time — existing tenants'
      already-seeded `SALES_MANAGER` role rows in `role_permissions` won't pick this up
      automatically (same caveat as `0023_dashboard_view_permission_backfill.sql`).
      Fixed 2026-07-17: `0070_es35_es37_role_defaults_permission_backfill.sql` (consolidated
      with the ES-37 backfills below), applied and verified against the dev DB.
- [x] No other DB migrations required — remaining changes are middleware/route-guard code only
- [x] `pnpm install` re-run for `platform-sdk`'s new `jose` dependency; confirmed scheduler-service's now-redundant copy removed
- [x] All new/updated tests pass

## Phases Unblocked

ES-31 (branch-level permissions + RLS — builds on the now-consolidated `authenticate`
middleware rather than having to touch 13 separate copies), ES-32 (frontend UI-level
gating).
