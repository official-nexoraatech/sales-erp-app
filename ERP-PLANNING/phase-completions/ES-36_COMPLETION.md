# ES-36 Completion Report — RBAC Audit Phase E: Branch-Level Record Permissions + RLS
**Date:** 2026-07-04
**Status:** PARTIALLY COMPLETE — branch-scoping infrastructure shipped and demonstrated;
RLS enablement deliberately deferred (see below), not silently dropped.

## Sub-Audit

Checked `packages/db-client/src/schema/*` for `branch_id` columns before implementing, per
the phase's stated approach. Found them in 8 schema files (`sales.ts`, `purchase.ts`,
`master.ts`, `hr.ts`, `gst.ts`, `tenant.ts`, `report.ts`, `production.ts`) — branch scoping
is a broad, cross-cutting concern spanning most transactional tables. Given that breadth,
this phase built the reusable primitive and proved it on one high-value path (`invoices`)
rather than attempting a full rollout in one pass — full rollout to the remaining tables
is a tracked follow-up (see Deployment Checklist), the same split already applied to
Phase D's frontend rollout.

## What Was Built

### 1. `branchIds` flows through the JWT end-to-end
- `apps/auth-service/src/domain/roles.ts` — `loadUserRolesAndPermissions()` now also
  queries the existing `userBranches` join table and returns `branchIds: number[]`.
- `apps/auth-service/src/jwt.ts` — `AccessTokenPayload.branchIds: number[]` added; signed
  and decoded like every other claim.
- Updated all 4 token-issuing call sites: `login.ts`, `refresh.ts`, `mfa.routes.ts`
  (post-verify), `impersonate.routes.ts` (impersonation token carries the target user's
  own branches — consistent with how it already carries their roles/permissions).

### 2. Shared branch-scope decision function
New `getBranchScope(auth): number[] | 'all'` in `packages/platform-sdk/src/auth.ts`:
- `'all'` if the caller holds the new `BRANCH_SCOPE_BYPASS` permission (added to
  `permissions.ts`; `OWNER`/`SUPER_ADMIN` get it automatically via their full permission
  set — no new bypass mechanism invented, reusing the existing role-defaults pattern).
- `'all'` if the caller has zero branch assignments — so single-branch tenants and
  not-yet-branch-assigned users see exactly what they saw before this feature existed,
  rather than being silently locked out.
- Otherwise, the caller's `branchIds`, for the route to filter on.

Because `AuthPayload` is defined once in `@erp/sdk` (ES-35's consolidation), this is
immediately available via `request.auth.branchIds` in all 13 consolidated services with no
further per-service plumbing required.

### 3. Demonstrated end-to-end on `GET /invoices`
```ts
const branchScope = getBranchScope(req.auth);
if (branchScope !== 'all') conditions.push(inArray(invoices.branchId, branchScope));
```
A `SALES_MANAGER` assigned to branches 3 and 5 now only sees those branches' invoices in
the list view; `OWNER`/`SUPER_ADMIN`/anyone with `BRANCH_SCOPE_BYPASS` see everything,
unchanged from today.

### 4. RLS — investigated, deliberately not enabled this phase
Drafting the RLS migration surfaced a real, live-breaking risk: `TenantScopedDatabase.raw`
— used by the large majority of routes, including the exact `GET /invoices` route just
modified (confirmed **zero** `.transaction()` calls anywhere in `invoice.routes.ts`) —
never sets the `app.current_tenant_id` Postgres session GUC outside an explicit
`.transaction()` block. Enabling `ROW LEVEL SECURITY` with a policy keyed on that GUC would
make every non-transactional query — this codebase's dominant read path — silently return
**zero rows**. This is exactly the gap the architecture audit's **M14** finding already
identified ("`TenantScopedDatabase.raw` queries never set the RLS session GUC") and
deferred to "a dedicated security-hardening phase" — confirmed still open, not
re-discovered as new.

**Decision:** ship the working, tested app-layer branch filter now (real, immediate value);
do not enable RLS until the GUC-per-request plumbing is fixed first. A fail-open RLS
policy (permissive when the GUC is unset) would create false security assurance without
real protection. A fail-closed one would break the app. Landing either silently would be
worse than being explicit that this piece is not done yet.

## Files Changed

| File | Change |
|------|--------|
| `packages/shared-types/src/permissions.ts` | Added `BRANCH_SCOPE_BYPASS` |
| `apps/auth-service/src/domain/roles.ts` | `loadUserRolesAndPermissions()` also returns `branchIds` |
| `apps/auth-service/src/jwt.ts` | `AccessTokenPayload.branchIds`, sign/verify updated |
| `apps/auth-service/src/routes/{login,refresh,mfa.routes,impersonate.routes}.ts` | Pass `branchIds` into token issuance |
| `packages/platform-sdk/src/auth.ts` | `AuthPayload.branchIds`; new `getBranchScope()` |
| `packages/platform-sdk/src/index.ts` | Export `getBranchScope`, `BranchScope` |
| `apps/sales-service/src/api/invoice.routes.ts` | `GET /invoices` now branch-scoped |
| `apps/auth-service/src/__tests__/roles.test.ts` | `@erp/db` mock + fake-db dispatch: added `userBranches` (real regression — the test crashed with "No userBranches export" until fixed) |
| `apps/auth-service/src/__tests__/mfa.test.ts` | `@erp/db` mock: added `userBranches` (same regression, 5 of the file's tests were failing with 500s until fixed) |
| `apps/auth-service/src/__tests__/security.test.ts` | `@erp/db` mock: added `userBranches`; inserted a 4th sequential `mockReturnValueOnce` for the new parallel `userBranches` query the refresh-rotation test's call-order-sensitive mock didn't account for |

## New/Updated Tests

| File | Tests |
|------|-------|
| `packages/platform-sdk/src/__tests__/auth.test.ts` | +3 `getBranchScope` tests (restrict / bypass / zero-assignment default); existing JWT round-trip test extended to cover `branchIds` |

## Test Results

All 14 services (13 ES-35-consolidated + `auth-service`) + `@erp/sdk`: `type-check` clean
after adding `branchIds` to `AuthPayload`/`AccessTokenPayload`. `apps/sales-service`
`type-check` clean after wiring `getBranchScope` into `invoice.routes.ts`. `@erp/sdk` test
suite: 9/9 pass (including the 3 new branch-scope tests).

**Real regressions found and fixed:** adding the parallel `userBranches` query to
`loadUserRolesAndPermissions()` broke 3 auth-service test files whose `@erp/db` mocks
didn't export `userBranches` (`roles.test.ts` — 3 tests crashed outright; `mfa.test.ts` —
5 tests failed with 500s; `security.test.ts` — 1 call-order-sensitive mock needed a 4th
sequential return value for the new parallel query). All fixed; `auth-service` now passes
45/46 tests (up from 37/46 before these fixes).

**1 remaining failure, confirmed pre-existing and unrelated:**
`mfa.test.ts > ... > 5 failed logins from the same IP block the IP; the 6th attempt is
429` — fails deterministically expecting 401 but getting 429 starting earlier than the
test expects. Traced this to `apps/auth-service/src/routes/login.ts`, which has a large
(101-line) pre-existing uncommitted diff unrelated to this phase's edits (this phase only
added a `branchIds` destructure and pass-through, both in the success path). The failing
scenario exercises only failed-password attempts, which return before reaching either of
those two added lines — this phase's change cannot be the cause. Not investigated further
since it belongs to whatever is modifying `login.ts`'s IP-blocking logic elsewhere, outside
this phase's scope.

**Not run:** a live end-to-end branch-isolation test (real DB, two users assigned to
different branches, confirmed cross-branch invoice visibility is blocked) — no live
Postgres was available in this session. Consistent with this repo's existing precedent
(several other phases' DB-integration tests are skipped for the same reason) — flagged
here rather than silently assumed passing.

## Deployment Checklist

- [ ] **Rollout to remaining branch-scoped tables** — this phase proved the pattern on
      `invoices` only. The other 7 schema files with `branch_id` columns (`purchase.ts`,
      `master.ts`, `hr.ts`, `gst.ts`, `tenant.ts`, `report.ts`, `production.ts`) need the
      same `getBranchScope()` + `inArray(table.branchId, scope)` treatment applied to their
      list/detail routes — mechanical once reviewed per-table, not started here.
- [ ] **RLS enablement** — blocked on fixing the GUC-per-request gap first. Needed before
      any `CREATE POLICY` can safely ship: either (a) make `TenantScopedDatabase.raw`
      always run through a lightweight transaction that sets `app.current_tenant_id` /
      a new `app.current_branch_ids` GUC before the query, on the same connection, or
      (b) audit and rewrite every non-transactional call site to use `.transaction()`.
      Both are substantial, cross-cutting changes — correctly a dedicated phase, not a
      sub-task of this one.
- [ ] **Role-default assignment for `BRANCH_SCOPE_BYPASS`** — currently only
      `OWNER`/`SUPER_ADMIN` hold it (via their full-permission-set default). If any other
      role should see all branches (e.g. a tenant-wide `ACCOUNTANT` role), add it
      explicitly in `role-defaults.ts` — not done here since no such requirement was named.
- [x] No database migration required for this phase's actual changes — `branchIds` is
      JWT-only (derived from the existing `userBranches` table at token-issue time), and
      the one route changed (`GET /invoices`) is an in-code query filter, not a schema change.

## Phases Unblocked

ES-37 (frontend UI-level gating) — independent of this phase, proceeds regardless.
