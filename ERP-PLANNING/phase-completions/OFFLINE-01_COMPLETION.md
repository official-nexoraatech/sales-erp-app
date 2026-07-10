# OFFLINE-01 Completion Report — POS Token Refresh & Branch Isolation
**Date:** 2026-07-05
**Status:** COMPLETE

## Findings Closed

| Finding | Fix Summary | Verified By |
|---|---|---|
| POS access tokens expire in 15 min; `pos-frontend` had no refresh-token flow, so a multi-hour outage left the device with a dead token and forced a manual re-login before any queued sale could sync | Login now persists the refresh token (`setTokens` in new `src/auth.ts`); a new `authFetch` wrapper refreshes-and-retries once on any 401, deduping concurrent refresh attempts into a single in-flight `POST /auth/refresh` call; a proactive `ensureFreshToken()` runs before each sync batch | 7 vitest unit tests in `apps/pos-frontend/src/__tests__/auth.test.ts` |
| `apps/sales-service`'s `POST /pos/sales` (and `POST /pos/sessions/open`) trusted a client-submitted `branchId`, scoping only by tenant | Added a `branchInScope()` check using the existing `getBranchScope(req.auth)` helper (same pattern as `invoice.routes.ts:84`); rejects with `403 BRANCH_ACCESS_DENIED` before any DB access if the submitted `branchId` isn't in the caller's JWT `branchIds` | 6 no-DB Fastify-inject tests in `apps/sales-service/src/__tests__/pos-branch-isolation.test.ts` |

## Pre-flight findings worth recording

- **`apps/web-frontend` already has a working, non-trivial refresh-token flow** (`src/api/client.ts`'s `request()`/`performRefresh()`), contrary to what a literal reading of the phase brief implied. It already does exactly what this phase needed for POS: persists both tokens via a zustand store, dedupes concurrent refresh attempts behind a single module-level `refreshPromise`, retries the failed request once, and falls back to `logout()` + redirect on refresh failure. `pos-frontend`'s new `src/auth.ts` mirrors this convention (adapted to `localStorage` instead of zustand, since that's what `pos-frontend` already used for the access token) rather than inventing a new pattern.
- **`apps/pos-frontend` had zero test infrastructure** (no `vitest`, no test script) before this phase — this is the first test file in that package. Added `vitest`+`jsdom` as devDependencies and a minimal `vitest.config.ts`, matching versions already used by `apps/web-frontend`.
- Only two routes in `pos.routes.ts` read a client-submitted `branchId` from the request body: `POST /pos/sessions/open` and `POST /pos/sales`. The other routes (`held-sales`, `quick-items`, `customer-search`, `upi-vpa`, `send-receipt`) don't take a `branchId` in their body, so nothing else needed the guard.

## Files Changed

| File | Change |
|---|---|
| `apps/sales-service/src/api/pos.routes.ts` | Added `branchInScope()` helper + guard on `POST /pos/sessions/open` and `POST /pos/sales` |
| `apps/sales-service/src/__tests__/pos-branch-isolation.test.ts` | New — 6 tests (reject out-of-scope branch, accept in-scope branch, accept when no branch assignments, accept with `BRANCH_SCOPE_BYPASS`, same two checks for `/pos/sessions/open`) |
| `apps/pos-frontend/src/auth.ts` | New — token persistence, `authFetch` (refresh-and-retry-once, deduped), `ensureFreshToken` (proactive pre-sync check) |
| `apps/pos-frontend/src/LoginScreen.tsx` | Persists refresh token via `setTokens()` instead of only the access token |
| `apps/pos-frontend/src/main.tsx` | `RequireAuth` now reads via `getAccessToken()` instead of a raw `localStorage` key |
| `apps/pos-frontend/src/POSScreen.tsx` | Every raw `fetch(...)` to sales-service/production-service now goes through `authFetch`; removed the old manual "clear token + redirect on 401" branches in the quick-items/customer-search queries (now centralized in `authFetch`); `syncPending()` calls `ensureFreshToken()` before its loop; `ReceiptOverlay` calls `authFetch` directly instead of taking a `headers` prop |
| `apps/pos-frontend/package.json` | Added `test` script, `vitest`/`jsdom` devDependencies |
| `apps/pos-frontend/vitest.config.ts` | New — jsdom environment for the new test suite |
| `apps/pos-frontend/src/__tests__/auth.test.ts` | New — 7 tests (token persistence, pass-through on success, refresh-and-retry-once on 401, deduped burst refresh, refresh-failure fallback, no-refresh-token fallback) |

## Tests: 13/13 PASS (7 pos-frontend + 6 sales-service, new) | full sales-service suite: 46/46 PASS (16 pre-existing DB-gated skipped) | lint: pre-existing repo-wide gap, unaffected by this phase (see below) | type-check: PASS (30/30 packages, repo-wide) | build: PASS (`pos-frontend`, `sales-service`)

## Known Issues / Deferred

- **`pnpm lint` was not a green gate before this phase and still isn't.** The shared root `eslint.config.mjs` has no browser/DOM global declarations, so every use of `window`, `fetch`, `localStorage`, `Response`, `Headers`, etc. across the whole frontend surface — including pre-existing code in `LoginScreen.tsx`, `POSScreen.tsx`, and `sw.ts` — trips `no-undef`. This phase's new files (`auth.ts`, `auth.test.ts`) inherit the same pre-existing repo-wide category of error, not a new one; fixing the shared eslint config would touch every frontend package and is out of scope for this phase. This matches previously-recorded pre-existing lint debt (~223 errors monorepo-wide before this session).
- **No live DB/Docker available this session** (consistent with prior ES-22–ES-24 sessions), so the branch-isolation guard was verified only via the no-DB, mocked Fastify-inject path (`pos-branch-isolation.test.ts`), not a full live-DB integration test that exercises the entire `POST /pos/sales` success path end-to-end. The guard itself runs before any DB access, so this is a low-risk gap, but a live-DB pass is still worth doing once Docker/Postgres is reachable.
- **Refresh-token storage hardening was intentionally not attempted.** `pos-frontend` continues to store the refresh token in `localStorage`, matching the existing access-token storage convention (per the phase's own OUT OF SCOPE list) rather than introducing a second storage mechanism (e.g. httpOnly cookie) for just the refresh token.
- **`incrementRetries`/backoff and idempotency on `POST /pos/sales`** remain out of scope per this phase's brief — that's `OFFLINE-02`.
