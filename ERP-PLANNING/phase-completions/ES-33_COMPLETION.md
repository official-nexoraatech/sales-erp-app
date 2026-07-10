# ES-33 Completion Report — RBAC Audit Phase A: Critical Auth Gaps
**Date:** 2026-07-04
**Status:** COMPLETE

## Findings Fixed

| # | Location | Gap | Fix |
|---|----------|-----|-----|
| 1 | `apps/gst-service/src/api/einvoice.routes.ts` — `POST /gst/einvoice/retry-pending` | Zero auth. `config: { internalOnly: true }` was dead metadata, never read anywhere in the codebase. Cross-tenant IRN retry sweep, callable by anyone. | Added `requireInternalKey()` (timing-safe `x-internal-key` compare) — same pattern used by every other internal endpoint in the codebase. Confirmed sole caller (`scheduler-service`'s `gst.e-invoice-retry` cron) already sends this header; it was just never checked. |
| 2 | `apps/scheduler-service` — all routes in `scheduler.routes.ts`, `export.routes.ts`, `import.routes.ts` | No `authenticate` middleware existed anywhere in the service (no `middleware/` dir), yet routes gate on a local `hasPermission(request, perm)` reading `request.auth.permissions`. `request.auth` was always `undefined` → every route unconditionally 403 for every caller. Fails closed, but the entire scheduler/import/export admin UI was unusable. | Added `middleware/authenticate.ts` (identical RS256/JWT pattern to `hr-service`), added `jose` dependency, wired `{ preHandler: authenticate }` on all 15 routes across the 3 files. |
| 3 | `apps/notification-service` — `POST /notifications/send` | `authenticate` only, no permission check. `NOTIFICATION_SEND` permission existed in `permissions.ts` but was never wired to this route — any authenticated tenant user could send a notification to any recipient. | Added `middleware/authorize.ts` + `requirePermission(PERMISSIONS.NOTIFICATION_SEND)`. |
| 4 | `apps/search-service` — `POST /search/index`, `DELETE /search/index/:entity/:id` | `authenticate` only, no permission check, despite `SEARCH_REINDEX` already gating the sibling admin routes in the same file. | Added the same inline `hasPermission(request, PERMISSIONS.SEARCH_REINDEX)` check already used elsewhere in this file. |

## Regression Verification (not re-fixed, confirmed still closed)

- **C1–C3 (tenant-admin auth bypass chain)** — `apps/tenant-service/src/api/tenant.routes.ts`: all 6 admin routes (`/admin/tenants` GET/POST, `/admin/tenants/:id`, `:id/suspend`, `:id/activate`, `:id/close`) still use `PLATFORM_ADMIN` preHandler. ✅
- **C3 (user-management no permission checks)** — `apps/auth-service/src/routes/users.ts`: all 9 routes still use `requirePermission(...)`. ✅
- **H1 (tenantId trusted from URL param instead of JWT)** — repo-wide grep for `request.params.tenantId`, `request.body.tenantId`, and `:tenantId` in route paths across all services: **zero matches**. Not present anywhere beyond the originally-fixed locations.

## Files Changed

| File | Change |
|------|--------|
| `apps/gst-service/src/api/einvoice.routes.ts` | Added `requireInternalKey()`; gated `POST /gst/einvoice/retry-pending` |
| `apps/scheduler-service/src/middleware/authenticate.ts` | New file |
| `apps/scheduler-service/package.json` | Added `jose@^5.9.6` |
| `apps/scheduler-service/src/api/scheduler.routes.ts` | `authenticate` preHandler added to 5 routes |
| `apps/scheduler-service/src/api/export.routes.ts` | `authenticate` preHandler added to 3 routes |
| `apps/scheduler-service/src/api/import.routes.ts` | `authenticate` preHandler added to 7 routes |
| `apps/notification-service/src/middleware/authorize.ts` | New file |
| `apps/notification-service/src/api/notification.routes.ts` | `requirePermission(NOTIFICATION_SEND)` added to `POST /notifications/send` |
| `apps/search-service/src/api/search.routes.ts` | `SEARCH_REINDEX` check added to `POST /search/index`, `DELETE /search/index/:entity/:id` |

## New Test Files

| File | Tests |
|------|-------|
| `apps/gst-service/src/__tests__/einvoice-retry-pending-authz.test.ts` | 3: no key → 401, wrong key → 401, correct key → 200 |
| `apps/scheduler-service/src/__tests__/scheduler-routes-authz.test.ts` | 3: no JWT → 401, JWT w/o JOB_VIEW → 403, JWT w/ JOB_VIEW → 200 |
| `apps/notification-service/src/__tests__/notification-send-authz.test.ts` | 1: authenticated w/o NOTIFICATION_SEND → 403 |
| `apps/search-service/src/__tests__/search-index-authz.test.ts` | 3: index w/o perm → 403, index w/ perm → 200, delete w/o perm → 403 |

## Test Results

**10/10 new tests pass.** `pnpm type-check` clean on all 4 touched services
(gst-service, scheduler-service, notification-service, search-service).

**Lint:** no new error classes introduced by this phase's edits. Remaining lint errors in
touched files are pre-existing missing-ESLint-Node-globals issues (`process`, `fetch`,
`setInterval` reported as `no-undef`) — confirmed identical and pre-existing by checking
the unmodified sibling file `hr-service/src/middleware/authenticate.ts`, which reports the
exact same `'process' is not defined` error at the same line for the same code pattern.
Matches this repo's known ~223-error pre-existing lint debt; out of scope for this phase.

**Pre-existing test failures (unrelated):** `gst-service`'s `gst-engine.test.ts` (1 test)
and `ewb.test.ts` (2 tests) fail with 5-second timeouts. Verified via `git stash` that
these fail identically with this phase's changes reverted — confirmed pre-existing and
unrelated to `einvoice.routes.ts`, not touched in this phase.

## Related Finding — Flagged, Not Fixed (Out of Scope)

`apps/tenant-service/src/domain/TenantProvisioner.ts`'s `sendWelcomeEmail()` calls
`notification-service`'s `POST /notifications/send` with **no** auth header at all (no
Bearer JWT, no internal key). This call was already silently failing 401 before this
phase (caught, logged as a non-fatal warning) — adding the `NOTIFICATION_SEND` permission
guard doesn't make this worse, since `authenticate` was already rejecting it first. Welcome
emails on tenant provisioning are effectively broken today. This is a different bug class
(a legitimate system-to-system call missing the internal-key wiring that every other
internal call in the codebase has) — worth a follow-up fix, but out of scope for an RBAC
gap-closing phase.

## Deployment Checklist

No database migrations required — all changes are route-guard/middleware wiring only.

- [x] `INTERNAL_API_KEY` env var already exists and is shared across services (per ES-20) — `gst-service` now validates it on `retry-pending`
- [x] `scheduler-service` requires `JWT_PUBLIC_KEY` env var — confirmed present in the shared root `.env` (dev environment, same var every sibling service already needs)
- [x] `pnpm install` re-run for `scheduler-service`'s new `jose` dependency
- [x] 10 new regression tests pass

## Phases Unblocked

ES-34 (login redirect/UX), ES-35 (backend permission-model cleanup + shared middleware),
ES-31 (branch-level record permissions + RLS), ES-32 (frontend UI-level gating) — all
proceed on this clean baseline.
