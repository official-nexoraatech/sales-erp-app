# OFFLINE-10 Completion Report — Test Suite & Documentation
**Date:** 2026-07-05
**Status:** COMPLETE

## Pre-flight finding

The phase prompt's premise (and the roadmap/readiness-report's framing) — "`apps/pos-frontend` has no `__tests__` directory... completely untested" — was **stale**. `apps/pos-frontend` already had a working `vitest` runner and 6 test files (781 lines, 51 tests) covering OFFLINE-01 through 07's logic layer (auth refresh, idempotency/retry/stuck-state, Dexie migration, delta-sync cursors, held-sale/customer CRUD, background-sync core). This phase's real scope was therefore: (a) fill the *component-level* gap those logic tests didn't reach — sync-status UI, conflict-resolution UI, the OFFLINE-09 lookup screen — none of which had any test; (b) add the cross-cutting scenarios no single phase owns; (c) wire the frontend suites into CI, which they were not; (d) produce documentation.

## Phases Covered

| Phase | Landed? | Test coverage added |
|---|---|---|
| OFFLINE-01 (token refresh, branch isolation) | Yes | Already covered (`auth.test.ts`, `pos-branch-isolation.test.ts`). No gap found. |
| OFFLINE-02 (idempotency/retry/stuck) | Yes | Already covered (`offlineDb.test.ts`, backend `offline02-*.test.ts`). No gap found. |
| OFFLINE-03 (Dexie migration) | Yes | Already covered (`offlineDb.test.ts`). No gap found. |
| OFFLINE-04 (delta sync) | Yes | Backend tenant/branch/`modifiedSince` scoping already covered; **added** the missing pagination/`hasMore` test (`sync-routes.integration.test.ts`) — the one requirement from the phase's own testing list with no prior test. |
| OFFLINE-05 (held sales, offline customers, receipt) | Yes | Already covered (`localStore.test.ts`, backend `offline05-customer-idempotency.test.ts`). No gap found. |
| OFFLINE-06 (background sync, status UI) | Yes | Core logic already covered (`swSync.test.ts`); **added** `ConnectivityStatus.test.tsx` + `SyncStatusPanel.test.tsx` for the status-UI requirement that had no component-level test before. |
| OFFLINE-07 (conflict resolution) | Yes | Core logic already covered (`offlineDb.test.ts`, backend `offline07-stock-conflict.test.ts`); **added** `StockConflictModal.test.tsx` for the UI-routing/figures requirement that had no component-level test before. |
| OFFLINE-08 (PWA shell) | Yes | Install-prompt/standalone-window/iOS behavior is manual-only by nature (no automatable browser install-prompt API) — left as manual verification, consistent with the phase's own testing requirements. Not re-tested here. |
| OFFLINE-09 (read-only lookup) | Yes | **Added** `LookupScreen.test.tsx` — had zero prior test coverage. |

## Test infrastructure added

- `@testing-library/react` + `@testing-library/jest-dom` added to `apps/pos-frontend` (matching `apps/web-frontend`'s existing convention exactly).
- `apps/pos-frontend/vitest.config.ts`: added the `@vitejs/plugin-react` plugin and a `setupFiles` entry (`src/setupTests.ts`, importing `@testing-library/jest-dom/vitest`) — previously logic-only, no component-render support.
- `SyncStatusPanel`, `StockConflictModal`, and `supportsBackgroundSync` were changed from private to exported in `POSScreen.tsx` (additive `export` keyword only, no behavior change) specifically so these presentational units are testable without mounting the full 1300-line `POSScreen` (which would otherwise require mocking the camera barcode scanner, QR code generation, react-query, and audio APIs disproportionately to what's being tested).

## New test files (pos-frontend)

| File | Tests | Covers |
|---|---|---|
| `ConnectivityStatus.test.tsx` | 8 | `ConnectivityDot` (online/offline/pending states) + `formatLastSync` formatting |
| `SyncStatusPanel.test.tsx` | 6 | Pending/stuck/conflict count display, button visibility rules, callback wiring |
| `StockConflictModal.test.tsx` | 7 | Empty state, figure accuracy, catalog-name resolution + fallback, adjust/cancel callbacks, multi-conflict rendering |
| `LookupScreen.test.tsx` | 4 | Cached item/customer display, per-tab staleness indicator, offline indicator with data still visible |
| `crossCutting.test.tsx` | 3 | See below |

## Cross-Cutting Tests Added

All three in `apps/pos-frontend/src/__tests__/crossCutting.test.tsx`:

1. **Outage + mid-outage token expiry + reconnect** — queues 3 sales, simulates the mirrored token dying partway through the batch (first request 401s), and asserts: exactly one `/auth/refresh` call for the whole batch (not one per sale), every originally-queued `operationId` is submitted exactly once (no duplicates, none dropped), and the queue ends empty.
2. **Background-Sync-unsupported-browser fallback** — deletes `window.SyncManager` to simulate Safari/Firefox, asserts `supportsBackgroundSync()` correctly reports `false`, then proves the shared sync primitive (`runBackgroundSync`) still completes correctly regardless — there is no separate/divergent fallback code path to independently verify, by design (documented in the new architecture doc, §5).
3. **Stuck stock-conflict resolved via the OFFLINE-07 UI → exactly one invoice** — renders `StockConflictModal`, clicks "Adjust & retry", verifies the real `resolveConflict()` produces a fresh `operationId` (the dead one is never reused), then runs a sync and asserts exactly one `POST /pos/sales` call — not zero, not two.

Ran the full suite 3 times consecutively (plus multiple additional runs during development) with no flakiness.

## Backend gap found and fixed

`apps/sales-service/src/__tests__/sync-routes.integration.test.ts` (OFFLINE-04's DB-gated integration suite) covered tenant isolation, branch scoping, and `modifiedSince`, but had no test for pagination/`hasMore` — the phase's testing requirement #3. Added one, verified passing against a live Postgres instance (`erp-postgres-primary` docker container) after running the pending `0031`/`0032` idempotency migrations that hadn't yet been applied to that instance.

## CI wiring

Root `pnpm test:coverage` (`turbo run test:coverage`) does **not** run either frontend's tests — neither defines a `test:coverage` script, so `turbo` silently skips them. **Investigated adding one** (mirroring the backend-service convention, `"test:coverage": "vitest run --coverage"`) but reverted it: `@vitest/coverage-v8` is only a declared dependency of `packages/platform-sdk`, so pnpm's per-package `node_modules` isolation makes it unresolvable from any other package — confirmed this is **pre-existing and repo-wide**, not specific to the frontends, by reproducing the identical failure running `apps/sales-service`'s own already-existing `test:coverage` script locally. Adding the script to the frontends would have made `turbo run test:coverage` start failing for them in CI (a regression), since turbo auto-includes any package that defines the script.

Instead, added an explicit step to `.github/workflows/ci.yml`'s existing `test` job:
```yaml
- name: Run frontend unit tests (pos-frontend, web-frontend)
  run: |
    pnpm --filter @erp/pos-frontend test
    pnpm --filter @erp/web-frontend test
```
This runs the plain `test` script (no coverage, already verified working) for both frontends unconditionally in CI, satisfying this phase's own testing requirement #3 without touching the pre-existing, broken, repo-wide coverage-gate convention.

## Documentation Updated

- **New:** `ERP-PLANNING/reports/OFFLINE_ARCHITECTURE.md` — local DB schema (all 9 Dexie tables with version history), sync protocol (delta download + queued-write idempotency), auth/token-refresh, Background Sync + its fallback, conflict resolution, the OFFLINE-09 lookup screen, PWA shell, a troubleshooting section (stuck items, stock conflicts, token-refresh failures, Background-Sync-unsupported browsers, legacy-store migration), and a "known gaps" section documenting the coverage-v8 CI finding above.
- **Updated:** `docs/training/CASHIER_GUIDE.md` — added a "Working Offline" subsection (connectivity dot states, last-sync indicator, stuck-item retry, stock-conflict resolution walkthrough, offline-receipt labeling) and 4 new rows in the "Common POS Issues" table, covering exactly the offline-related sections this program touched (receipt, sync status, conflict resolution) — this program's changes only.

## Tests: 79/79 pos-frontend PASS (28 new + 51 pre-existing) | 85/85 sales-service PASS (1 new + 84 pre-existing, run against a live DB) | 31/31 web-frontend PASS (unaffected regression check) | type-check: PASS (pos-frontend, web-frontend, sales-service) | lint: pre-existing repo-wide debt only (see below) | build: not re-verified beyond type-check (pos-frontend/web-frontend `build` script is `tsc --noEmit`, identical to `type-check`)

## Known Issues / Deferred

- **Pre-existing, repo-wide:** `pnpm lint` on `apps/pos-frontend` reports errors on every new test file for undeclared browser globals (`window`, `navigator`, `fetch`, `setTimeout`, `Response`, `RequestInit`) — this is the same `no-undef`/missing-ESLint-globals pattern already present in every pre-existing file in this package (`auth.ts`, `offlineDb.ts`, `swSync.ts`, `sw.ts`, `referenceSync.ts`, `main.tsx`, and the pre-existing `auth.test.ts`/`swSync.test.ts`). Not introduced or worsened in kind by this phase — verified the new files' lint output contains no error category beyond this pre-existing one and the pre-existing `no-non-null-assertion` warning convention.
- **Pre-existing, repo-wide:** the root `pnpm test:coverage` convention (`@vitest/coverage-v8` only resolvable from `packages/platform-sdk`) is broken for every package that defines `test:coverage`, not just the frontends — see "CI wiring" above. Worth a dedicated fix (either declaring the dependency in every consuming package, or a pnpm hoist setting) but that is a repo-wide infrastructure fix outside this phase's scope.
- `CASHIER_GUIDE.md` mismatches unrelated to this program (discount button, split payment, UPI display) remain open — not touched, per this phase's explicit out-of-scope list.
- OFFLINE-08's install-prompt/standalone-window/iOS-add-to-home-screen behavior remains manual-verification-only; no browser-automation coverage was added for it (consistent with its own phase's testing requirements, which are manual by nature).
