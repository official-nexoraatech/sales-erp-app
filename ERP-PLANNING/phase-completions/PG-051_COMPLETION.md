# PG-051 — POS Branch-Picker UI — Completion Report

**Date:** 2026-07-11
**Status:** Complete.

## Summary

`branchId: 1` / `warehouseId: 1` were literal hardcoded values in `POSScreen.tsx` (sale
submission, held-sale local write, quick customer creation online + offline paths) — any
tenant with more than one branch would have every sale/customer/held-sale silently attributed
to branch 1 regardless of the till's real location. The server-side guard
(`branchInScope()`, OFFLINE-01) was already correct; only the client-side picker was missing.

- New `apps/pos-frontend/src/branchStore.ts` — plain `localStorage` (`pos_branch_id`,
  `pos_warehouse_id` keys), matching this app's existing no-Zustand convention.
- New `apps/pos-frontend/src/BranchSelectScreen.tsx` — the canonical branch/warehouse picker:
  auto-skips the branch step silently when the caller has exactly one accessible branch,
  filters the fetched branch list down to the JWT's `branchIds`, resolves the warehouse
  (auto-select when a branch has exactly one, dropdown when it has more than one, manual
  numeric-ID fallback when `GET /warehouses` 403s for a role without `WAREHOUSE_VIEW`), and
  persists + navigates on once both are known.
- `main.tsx`: new `/branch-select` route; new `RequireBranch` guard (modeled on `RequireAuth`/
  `RequireSession`) wrapping every branch-dependent route.
- `ShiftOpenScreen.tsx` (PG-050): replaced its own inline branch/warehouse picker with a plain
  read of `branchStore.getSelectedBranch()` — the screen is now just the opening-cash form,
  per this package's own Architecture note on which package should own the picker.
- `POSScreen.tsx`: all four hardcoded `branchId: 1`/`warehouseId: 1` literals replaced with the
  persisted selection (read once via `useState(() => getSelectedBranch())`, same
  trust-the-route-guard convention as the existing `sessionId` read).

## Deviations from the gap-prompt (flagged during implementation, not silently decided)

1. **`RequireBranch`'s guard condition is broader than the doc's literal wording.** The doc
   said the guard should fire "when `branchIds.length > 1` and no branch already selected" —
   which would let a single-branch tenant skip `BranchSelectScreen` entirely. But a
   single-branch tenant whose one branch has _more than one_ warehouse still needs a warehouse
   picked before `POST /pos/sessions/open` can succeed (it requires both fields). `RequireBranch`
   instead redirects whenever `!getSelectedBranch()` (no persisted branch **and** warehouse),
   regardless of `branchIds.length`; `BranchSelectScreen` itself still auto-skips the _branch_
   step silently for a single-branch tenant, so the acceptance criterion ("single-branch tenant
   never sees a picker") holds for the common case — full detail in
   `ERP-PLANNING/production-gap-prompts/IMPLEMENTATION-NOTES.md`'s PG-051 entry.
2. **Mid-shift "switch branch" affordance not built.** The doc's Frontend section describes
   this as a nice-to-have gated behind ending the active session first; its own Pending
   Components note explicitly calls it out as "not a hard requirement for closing this gap."
   Deferred rather than adding session-close coordination logic beyond this package's scope.
3. **No new backend endpoint added.** `GET /warehouses?branchId=` already existed in
   `apps/inventory-service/src/api/warehouse.routes.ts` (confirmed via PG-050's own working,
   tested usage of it) — the doc flagged this as "verify existence; add if missing."

## Acceptance Criteria

- [x] Every hardcoded `branchId: 1`/`warehouseId: 1` in `POSScreen.tsx` replaced — verified by
      grep: only remaining `branchId`/`warehouseId` occurrences are `selectedBranch?.branchId`/
      `selectedBranch?.warehouseId` reads (plus one pre-existing, unrelated `real.branchId` in
      the customer-sync path).
- [x] A cashier whose JWT `branchIds` contains more than one branch is shown
      `BranchSelectScreen` before reaching `POSScreen` — `RequireBranch` guard; covered by
      `BranchSelectScreen.test.tsx`'s branch-picker-rendered test.
- [x] A cashier whose JWT `branchIds` contains exactly one branch never sees a _branch_ picker
      — covered by `BranchSelectScreen.test.tsx`'s auto-skip test (single branch + single
      warehouse navigates straight through with no picker rendered).
- [x] A sale submitted after branch selection carries the selected `branchId` — covered by
      `crossCutting.test.tsx`'s new PG-051 case (held-sale Dexie write carries the persisted
      `branchId`, not the old literal `1`); server-side `branchInScope()` unchanged.
- [x] The picker's option list is filtered to the JWT's `branchIds` — covered by
      `BranchSelectScreen.test.tsx`'s filtering test.

## Verification performed this session

- `pnpm --filter @erp/pos-frontend type-check` — clean.
- `pnpm --filter @erp/pos-frontend test` — 108 passed (full suite): 8 new
  `BranchSelectScreen.test.tsx` cases, `ShiftOpenScreen.test.tsx` rewritten for its simplified
  behavior (3 cases), one new `crossCutting.test.tsx` case. No regressions in any pre-existing
  test.
- `npx eslint` on all touched/new files — only pre-existing monorepo-wide lint debt
  (`no-undef` on `window`/`localStorage`/`Response`/etc. — see project memory
  `preexisting_lint_debt`) and one real issue (unused `waitFor` import), which was fixed.
- No live browser verification (no Docker/dev server run this session) — recommend a manual
  multi-branch-tenant login → branch/warehouse picker → shift-open → sale walkthrough before
  relying on this in production.

## Files touched

- `apps/pos-frontend/src/branchStore.ts` — new.
- `apps/pos-frontend/src/BranchSelectScreen.tsx` — new.
- `apps/pos-frontend/src/ShiftOpenScreen.tsx` — rewritten (removed inline picker, reads
  `branchStore`).
- `apps/pos-frontend/src/main.tsx` — new `/branch-select` route; new `RequireBranch` guard
  wrapping `/shift/open`, `/shift/close`, `/shift/summary`, `/`, `/lookup`, `*`.
- `apps/pos-frontend/src/POSScreen.tsx` — replaced 4 hardcoded literals with the persisted
  selection.
- `apps/pos-frontend/src/__tests__/BranchSelectScreen.test.tsx` — new.
- `apps/pos-frontend/src/__tests__/ShiftOpenScreen.test.tsx` — rewritten for the simplified
  screen.
- `apps/pos-frontend/src/__tests__/crossCutting.test.tsx` — added one case.
- `ERP-PLANNING/production-gap-prompts/IMPLEMENTATION-NOTES.md` — new PG-051 entry.

## Deployment Checklist

- [x] No migration — no schema change, matches the gap-prompt's own "Not applicable" call.
- [x] No new environment variables — reuses `VITE_TENANT_API_URL`/`VITE_INVENTORY_API_URL`,
      both already present for `ShiftOpenScreen`'s prior inline picker.
- [x] No new permissions — reuses whatever gates `GET /branches`/`GET /warehouses` today
      (unchanged by this package; the `WAREHOUSE_VIEW`/`CASHIER` gap is PG-050's existing
      follow-up, not a new one).
- [ ] Follow-up (shared with PG-050, not blocking, tracked in `IMPLEMENTATION-NOTES.md`):
      decide whether to grant `CASHIER` a scoped `WAREHOUSE_VIEW` or add a lighter
      unauthenticated-field `GET /warehouses` variant, so the manual-entry fallback stops being
      the default path for the most common role.
