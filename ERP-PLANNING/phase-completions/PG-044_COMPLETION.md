# PG-044 — Multi-State Professional Tax Slabs — Completion Report

**Date:** 2026-07-11
**Status:** Complete.

## Summary

`apps/hr-service/src/domain/PayrollEngine.ts` previously computed Professional Tax via a single
hardcoded 3-slab constant (`PT_SLABS`, explicitly commented "Maharashtra as default") with no state
parameter anywhere in the call chain — every tenant, regardless of where employees actually work,
got Maharashtra's ₹0/₹150/₹200 slabs. PT is now state-aware:

- `PayrollEngine.computeSlip` resolves each employee's work-state via a new
  `resolveEmployeeState()` — the employee's `branchId → branches.address.state`, falling back to
  the tenant's `organizationSettings.address.state` when the employee has no branch or the branch
  has no state on file.
- A new `PTSlabService.getSlabsForState(db, state, asOfDate)` looks up that state's slabs from a
  new seeded `pt_slabs` table (global reference data, no `tenant_id` — same pattern as
  `hsn_master`), filtered by `effective_from`/`effective_to` date range.
- `PTSlabService.computePT(grossMonthly, slabs)` is the pure slab-application function — same loop
  shape as the old hardcoded `computePT`, just parameterized. Empty `slabs` (a no-PT state) resolves
  cleanly to `0`.
- `normalizeStateToCode()` maps a resolved state value — which in practice may be a full name
  ("Maharashtra") or a 2-letter code ("MH"), since `branches.address.state` is a free-text input,
  not a controlled dropdown (see Deviations below) — to the code `pt_slabs` is keyed on.

Seeded states: Maharashtra (preserved exactly from the old constant — regression safety), Karnataka,
West Bengal, Tamil Nadu, Andhra Pradesh, Telangana, Gujarat, Madhya Pradesh, Assam. Haryana, UP,
Rajasthan, Delhi (and all other unseeded states) intentionally have zero rows — they levy no PT,
and the lookup returns `0`, not Maharashtra's rate and not an error.

## Deviations from the gap-prompt (both flagged during implementation, not silently decided)

1. **Free-text state field.** The prompt assumed `branches.address.state` is a clean lookup key. It
   isn't — `BranchesPage.tsx` uses a plain text `Input`, not the `INDIAN_STATES` dropdown used
   elsewhere in the frontend. Handled with `normalizeStateToCode()`; the frontend field itself is
   unfixed (separate, unscoped frontend gap — see `IMPLEMENTATION-NOTES.md`'s PG-044 entry).
2. **Tamil Nadu / Madhya Pradesh cadence.** TN levies PT half-yearly and MP computes on annual
   income with an uneven final-month deduction — neither is natively "a monthly amount," which is
   all the prompt's schema (`monthly_amount`, no periodicity field) supports. Asked the user rather
   than silently approximating exact statutory figures; user chose a monthly-equivalent
   normalization (sourced figure ÷ 6 or ÷ 12, rounded to the nearest rupee — reproduces the correct
   period liability when deducted every payroll run). Documented as an explicit approximation in the
   migration file's header comment, with a note that a future periodicity-aware `PTSlabService`
   enhancement should replace it if exact month-by-month figures become a hard requirement.

## Acceptance Criteria

- [x] An employee in a Maharashtra branch gets exactly the same PT amount as before this change —
      `MH_SLABS` test fixture in `statutory-payroll.test.ts` reproduces the old `PT_SLABS` constant
      bracket-for-bracket (0 / 150 / 200 at the same thresholds).
- [x] An employee in a Karnataka (seeded) branch gets Karnataka's slab amount, not Maharashtra's —
      covered by `PTSlabService.computePT` tests with `KA_SLABS`.
- [x] An employee in a no-PT state gets `professionalTax: 0` — covered directly (`computePT(50000, [])` → `0`).
- [x] `pnpm --filter hr-service test` passes including the new multi-state PT tests — 54/56 passing;
      16/16 new tests green. The 2 failures are pre-existing, unrelated (`holiday.test.ts`, already
      documented in `PG-043_COMPLETION.md` — same root cause, no uncommitted changes to that file).
- [x] Migration adds `pt_slabs` seeded with sourced figures for all 8 named states, reversible via
      `DROP TABLE`.

## Verification performed this session

- `pnpm --filter hr-service test` — 54/56 passing (2 pre-existing unrelated failures, see above).
- `pnpm --filter @erp/db type-check` — clean.
- `pnpm --filter @erp/hr-service type-check` — clean (after `pnpm --filter @erp/db build`, required
  so the new `ptSlabs` schema export lands in `@erp/db`'s compiled `dist/`, which apps import from).
- All 8 states' PT slab figures sourced via live web search (BankBazaar/ClearTax/greytHR/FactoHR),
  not guessed — see the migration file's per-state source comments.
- Docker/Postgres was not available this session — the migration was not run against a live
  database; verify `pnpm --filter @erp/db db:migrate` applies cleanly before relying on this in an
  environment with real data.

## Files touched

- `packages/db-client/src/schema/hr.ts` — `ptSlabs` table + `PTSlab`/`NewPTSlab` type exports.
- `packages/db-client/migrations/0045_pg044_pt_slabs.sql` — new; `pt_slabs` table + seed data for
  9 states (MH regression-preserved + 8 newly sourced).
- `apps/hr-service/src/domain/PTSlabService.ts` — new; `getSlabsForState`, `computePT`,
  `normalizeStateToCode`.
- `apps/hr-service/src/domain/PayrollEngine.ts` — removed hardcoded `PT_SLABS`/`computePT`; added
  `resolveEmployeeState()`; wired into `computeSlip` (new optional `ptStateCache` param).
- `apps/hr-service/src/api/payroll.routes.ts` — both `computeSlip` call sites now create and pass a
  per-run `ptStateCache` Map (resolves each branch's state once per run, not once per employee).
- `apps/hr-service/src/__tests__/statutory-payroll.test.ts` — 16 new tests: `PTSlabService.computePT`
  (MH regression, KA, no-PT-state), `normalizeStateToCode`, `resolveEmployeeState` (branch resolution,
  null-branchId fallback, no-state-on-branch fallback).

## Deployment Checklist

- [x] Run `pt_slabs` migration (`0045_pg044_pt_slabs.sql`) against the target database — verified
      applied 2026-07-17: `pt_slabs` table exists in the dev DB.
- [x] No new environment variables.
- [x] No new permissions — existing `PAYROLL_PROCESS`/`PAYROLL_APPROVE` gates are unchanged and
      sufficient (calculation-accuracy fix, not a new capability).
