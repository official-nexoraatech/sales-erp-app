# PG-050 — POS Shift / Cash-Drawer Frontend UI — Completion Report

**Date:** 2026-07-11
**Status:** Complete.

## Summary

Every POS session previously ran against `sessionId = 1`, a hardcoded `useState(1)` in
`apps/pos-frontend/src/POSScreen.tsx` — no cashier ever declared an opening float or
reconciled the till, even though the backend's shift model (`POST /pos/sessions/open`,
`POST /pos/sessions/:id/close`, `GET /pos/sessions/:id/summary`, all in
`apps/sales-service/src/api/pos.routes.ts`) was already fully implemented and correct.

- Added one new backend route, `GET /pos/sessions/active` (tenant + `openedBy` + `status =
'OPEN'`, most-recent-first, same `PERMISSIONS.POS_MANAGE` guard as the other three), so the
  frontend can recover "does this user already have an open session" after a page reload.
- New pos-frontend screens: `ShiftOpenScreen.tsx` (opening cash float + inline branch/
  warehouse selector), `ShiftCloseScreen.tsx` (counted cash vs. server-computed variance),
  `ShiftSummaryScreen.tsx` (read-only recap, passed via router state from the close flow).
- New `session.ts` helper — plain `localStorage` (`pos_session_id` key) + a
  `fetchActiveSession()` wrapper, matching this app's existing no-Zustand convention
  (`auth.ts`'s token-persistence pattern).
- `main.tsx` gained a `RequireSession` guard, modeled directly on the existing `RequireAuth`
  wrapper: calls `GET /pos/sessions/active` on mount, redirects to `/shift/open` if none found.
- `POSScreen.tsx`: removed the hardcoded `useState(1)`, now reads the persisted session id;
  added an "End Shift" header action linking to `/shift/close`.

## Deviations from the gap-prompt (flagged during implementation, not silently decided)

1. **`GET /warehouses` is not actually reachable by a cashier.** The doc's Architecture
   section assumed `ShiftOpenScreen`'s warehouse lookup would work the same way as its branch
   lookup. It doesn't: `GET /warehouses` (inventory-service) is gated on
   `PERMISSIONS.WAREHOUSE_VIEW`, which the `CASHIER` role does not hold
   (`apps/tenant-service/src/rbac/role-defaults.ts`) — a real cashier would get a `403` and be
   unable to open a shift at all. `ShiftOpenScreen.tsx` now tries the warehouse list first
   (works for roles that do hold `WAREHOUSE_VIEW`) and falls back to a manual numeric
   "Warehouse ID" input on any non-2xx response, rather than blocking the flow on an RBAC gap
   this frontend-only package has no standing to fix unilaterally. Full detail in
   `ERP-PLANNING/production-gap-prompts/IMPLEMENTATION-NOTES.md`'s PG-050 entry — flagged as a
   follow-up RBAC item, not fixed here.
2. **PG-051 (branch-picker) had not shipped** at implementation time (verified: no
   `BranchSelectScreen`/`branchStore` anywhere in `apps/pos-frontend/src`) — per the doc's own
   contingency, `ShiftOpenScreen` ships its own small, deliberately temporary inline branch/
   warehouse selector. If PG-051 lands later, its fuller `BranchSelectScreen` should replace
   this inline one rather than the two coexisting.

## Acceptance Criteria

- [x] `sessionId` in `POSScreen.tsx` is no longer a hardcoded `useState(1)` — now
      `useState(() => getActiveSessionId()!)`.
- [x] A cashier with no open session is redirected to `/shift/open` before reaching
      `POSScreen` — `RequireSession` guard in `main.tsx`, calls `GET /pos/sessions/active` on
      mount.
- [x] `POST /pos/sessions/open` is reachable from the UI (`ShiftOpenScreen`) — covered by
      `ShiftOpenScreen.test.tsx`'s submit test (asserts the exact POST body and that the
      returned id is persisted).
- [x] `POST /pos/sessions/:id/close` is reachable from the UI, and the displayed
      running/closing figures come straight from the session summary row — covered by
      `ShiftCloseScreen.test.tsx`.
- [x] `GET /pos/sessions/active` returns `null` / the correct row / never another tenant's or
      user's session — covered by `pos-sessions-active.integration.test.ts` (real-Postgres,
      `describe.skipIf(!DATABASE_URL)`, same convention as `sync-routes.integration.test.ts`);
      **not run this session** — no live DB available (see below).
- [x] No sale can be completed without an active session — already true server-side
      (`NO_OPEN_SESSION`); the frontend now prevents reaching `POSScreen` at all without one,
      via `RequireSession`, rather than surfacing an opaque error mid-sale.

## Verification performed this session

- `pnpm --filter @erp/sales-service exec tsc --noEmit` — clean.
- `pnpm --filter @erp/pos-frontend exec tsc --noEmit` — clean.
- `pnpm --filter @erp/sales-service test` — 63 passed, 25 skipped (skips are the pre-existing
  DB-gated integration suites, including the new `pos-sessions-active.integration.test.ts`, 3
  tests, skipped for the same no-live-DB reason as other recent sessions — see project memory
  `es24_no_live_db_available`).
- `pnpm --filter @erp/pos-frontend test` — 101 passed (full suite, including 5 new test files:
  `ShiftOpenScreen.test.tsx`, `ShiftCloseScreen.test.tsx`, `ShiftSummaryScreen.test.tsx`,
  `session.test.ts`, plus an added case in `crossCutting.test.tsx` proving `POSScreen` reads
  `sessionId` from the persisted value rather than a fixed literal). No regressions in any
  pre-existing test.
- No live browser verification (no Docker/dev server run this session) — recommend a manual
  shift-open → sale → shift-close → summary walkthrough before relying on this in production,
  per this repo's UI-change verification norm.

## Files touched

- `apps/sales-service/src/api/pos.routes.ts` — new `GET /pos/sessions/active` route.
- `apps/sales-service/src/__tests__/pos-sessions-active.integration.test.ts` — new; DB-gated,
  covers most-recent-OPEN-session, null-when-none, tenant/user isolation.
- `apps/pos-frontend/src/session.ts` — new; `getActiveSessionId`/`setActiveSessionId`/
  `clearActiveSessionId`/`fetchActiveSession`.
- `apps/pos-frontend/src/ShiftOpenScreen.tsx` — new.
- `apps/pos-frontend/src/ShiftCloseScreen.tsx` — new.
- `apps/pos-frontend/src/ShiftSummaryScreen.tsx` — new.
- `apps/pos-frontend/src/main.tsx` — new `/shift/open`, `/shift/close`, `/shift/summary`
  routes; new `RequireSession` guard wrapping `/` and `*`.
- `apps/pos-frontend/src/POSScreen.tsx` — removed hardcoded `sessionId`; added "End Shift"
  header link.
- `apps/pos-frontend/src/__tests__/ShiftOpenScreen.test.tsx` — new.
- `apps/pos-frontend/src/__tests__/ShiftCloseScreen.test.tsx` — new.
- `apps/pos-frontend/src/__tests__/ShiftSummaryScreen.test.tsx` — new.
- `apps/pos-frontend/src/__tests__/session.test.ts` — new.
- `apps/pos-frontend/src/__tests__/crossCutting.test.tsx` — added one case.
- `ERP-PLANNING/production-gap-prompts/IMPLEMENTATION-NOTES.md` — new PG-050 entry (the
  `WAREHOUSE_VIEW` gap above).

## Deployment Checklist

- [x] No migration — no schema change, matches the gap-prompt's own "Not applicable" call.
- [x] No new environment variables.
- [x] No new permissions — reuses `PERMISSIONS.POS_MANAGE` on the one new route, matching the
      three existing session routes exactly.
- [ ] Follow-up (not blocking, tracked in `IMPLEMENTATION-NOTES.md`): decide whether to grant
      `CASHIER` a scoped `WAREHOUSE_VIEW` or add a lighter unauthenticated-field `GET
  /warehouses` variant, so `ShiftOpenScreen`'s manual-entry fallback stops being the
      default path for the most common role.
