# [PG-044] Multi-State Professional Tax Slabs

> Template version 1.0. Every gap-prompt file in this tree must follow this exact section order.

**Category:** HR
**Priority:** Medium
**Complexity:** M — the calculation itself is a simple slab lookup (already implemented for one state); the work is a state-keyed configuration model, seed data for major states, and correctly resolving *which* state applies per employee.
**Depends on:** none
**Blocks:** none
**Primary service(s)/package(s):** apps/hr-service (src/domain/PayrollEngine.ts), packages/db-client (branches/employees schema)

---

## Overview

- **Business objective:** Professional Tax (PT) is a state-level tax in India, not a central one — every state sets its own slabs, its own monthly/annual cadence, and several states (e.g. Haryana, UP, Rajasthan, Delhi as of current law) levy **no PT at all**. A tenant with branches in, say, Karnataka and West Bengal today gets Maharashtra's slabs applied to every employee regardless of where they actually work — this is a real statutory-compliance defect for any tenant outside Maharashtra, not a cosmetic gap: incorrect PT deduction/remittance is a filing violation.
- **Current implementation:** `apps/hr-service/src/domain/PayrollEngine.ts` lines 39-51:
  ```ts
  // Professional Tax slabs (Maharashtra as default)
  const PT_SLABS = [
    { upTo: 10000, amount: 0 },
    { upTo: 15000, amount: 150 },
    { upTo: Infinity, amount: 200 },
  ];

  function computePT(grossMonthly: number): number {
    for (const slab of PT_SLABS) {
      if (grossMonthly <= slab.upTo) return slab.amount;
    }
    return 200;
  }
  ```
  This is a single hardcoded module-level constant with no state parameter anywhere — `computePT(grossSalary)` (called at line 219, `PayrollEngine.computeSlip`) takes only the salary figure, no state/tenant/employee context at all. There is no state-selection logic to even be wrong about; it is structurally incapable of being anything but Maharashtra.
- **Current architecture:** `PayrollEngine.computeSlip` is a static method taking `db`, `tenantId`, and per-employee salary/attendance figures; `computePT` is called inline as one line among PF/ESI/TDS computation (line 215-223). No `state` field is threaded through this call chain at all today.
- **Current limitations:** No per-state slab table exists (only the one Maharashtra constant). No employee-to-state resolution exists (see Architecture — this is the harder half of the problem, not the slab data itself).

## Existing Code Analysis

- **What already exists and should be reused:** `branches.address` (`packages/db-client/src/schema/tenant.ts` lines 155-161) is a `jsonb` column already typed `{ line1, line2?, city, state, pincode }` — branches already carry a `state` field today, just never read by payroll. `employees.branchId` (`hr.ts` line 97) already links each employee to a specific branch. Together, `employees.branchId → branches.address.state` is the exact join needed to resolve "which state's PT applies to this employee" **without any new schema on the employee or branch side** — the data already exists, it's just never queried by `PayrollEngine`.
  - `organizationSettings.address.state` (`tenant.ts` line 103-110) is the tenant's own registered/legal state — the fallback for tenants with a single branch or employees with no `branchId` set.
  - The existing single-slab-table shape (`PT_SLABS` array of `{ upTo, amount }`) is a fine per-state shape — just needs to become a `Record<StateCode, PTSlab[]>` rather than one constant, and the lookup key (state) needs to come from somewhere real instead of being implicit.
- **What should never be modified:** `computePF`, `computeESI`, `calculateIncomeTax`/`computeMonthlyTDS` — unrelated deduction calculations in the same file, working correctly, out of scope.
- **Prior related work:** None in `phase-completions/`. FEATURE_INVENTORY.md §5.7 and §8 both flag this as "hardcoded to Maharashtra slabs only," confirmed accurate.

## Architecture

- **Two design questions, stated explicitly per this template's own "surface tradeoffs" instruction, rather than picked silently:**
  1. **Which state governs PT for a given employee?** The task framing offers two options: "the tenant's registered state" or "the employee's work-state if the tenant has multi-state branches." Given `branches.address.state` already exists per-branch and `employees.branchId` already links employee → branch, **the correct answer is the employee's branch state, falling back to the tenant's `organizationSettings.address.state` only if `branchId` is null** (a small number of employees — e.g. head-office-only staff — may not have a branch assigned; confirm this is actually possible in the data model before relying on the fallback path, since `employees.branchId` may in practice always be set). This is the technically correct answer for a genuinely multi-state tenant and costs nothing extra to implement since the join already exists.
  2. **Where does the per-state slab table live — hardcoded in `PayrollEngine.ts` (like today, just keyed by state) or a real DB table?** Recommend a **DB table** (`pt_slabs`, seeded, not tenant-editable in v1) over extending the hardcoded-constant pattern, because: (a) slabs change when state governments revise them — a code deploy for every state's periodic PT revision is worse than a data update; (b) some states have gender-differentiated slabs or annual (not monthly) computation cadence (e.g. some states levy PT as a fixed annual amount, others monthly) — modeling that as a second hardcoded array-of-arrays gets unreadable fast, whereas a table with `effectiveFrom`/`effectiveTo` date-ranges naturally supports future slab revisions without another code change. This is "only as much redesign as the gap needs" per this template's Architecture guidance — a full user-editable-PT-slab admin UI is not being proposed, just data-driven lookup instead of hardcoded lookup, since the slabs themselves need to change over time independent of app releases.
- Component/data flow: `PayrollEngine.computeSlip(employeeId, ...) → resolve employee's branchId → branches.address.state (fallback: organizationSettings.address.state) → PTSlabService.getSlabs(state, payPeriodDate) → computePT(grossMonthly, slabs) → professionalTax`.
- `computePT`'s signature changes from `(grossMonthly: number)` to `(grossMonthly: number, slabs: PTSlabRow[])` — the slab *selection* (by state + date) happens in the caller (`computeSlip`), the slab *application* (given a resolved slab list) stays a pure function, same shape as today, just parameterized instead of hardcoded.

## Database Changes

- New table `pt_slabs` (global reference data, not tenant-scoped — PT law is the same for every tenant with employees in a given state, so this is seeded once, not per-tenant, similar to how `gst-service`'s GST rate/HSN master is seeded globally rather than per-tenant): `id, state_code (2-letter, e.g. 'MH','KA','WB','TN','AP','TS','GJ','MP','AS'), slab_order int, income_upto numeric (nullable = no upper bound), monthly_amount numeric, effective_from date, effective_to date (nullable = still current), created_at`.
- Seed data (migration `INSERT`s, not application code) for at minimum: Maharashtra (existing 3-slab data, preserved exactly so no tenant's numbers change silently), Karnataka, West Bengal, Tamil Nadu, Andhra Pradesh, Telangana, Gujarat, Madhya Pradesh, Assam (the task's named list) — each state's current slabs as published by that state's Commercial Taxes department, verified against a current authoritative source at implementation time (do not guess figures; this is exactly the kind of exact-monetary-slab data that must be sourced correctly, not approximated). States with **no PT** (Haryana, UP, Rajasthan, Delhi, etc.) get **no rows** — the lookup must default to zero cleanly when a state has no matching rows, not throw or silently apply Maharashtra's rates.
- Migration: next sequential number in `packages/db-client/migrations/` (0034 is latest at time of writing — re-check before creating). Additive only (`CREATE TABLE` + `INSERT`), fully reversible by `DROP TABLE`.
- Rollback strategy: dropping `pt_slabs` and reverting `PayrollEngine.ts` to the hardcoded constant is a clean rollback since no other table gains a foreign key to `pt_slabs` (payroll slips store the *computed* `professionalTax` amount, not a reference to the slab row used — consistent with how PF/ESI amounts are already stored as computed values, not references).

## Backend

- `PayrollEngine.ts`: replace `PT_SLABS` constant + `computePT(grossMonthly)` with a `PTSlabService` (new file, `apps/hr-service/src/domain/PTSlabService.ts`) exposing `getSlabsForState(db, stateCode, asOfDate): Promise<PTSlabRow[]>` (queries `pt_slabs` filtered by `state_code`, `effective_from <= asOfDate`, `effective_to IS NULL OR effective_to >= asOfDate`, ordered by `slab_order`) and a pure `computePT(grossMonthly, slabs): number` (same loop logic as today, just over the resolved slabs instead of the hardcoded constant; if `slabs` is empty, return `0` — this is the "clean default for states with no PT" the task calls for).
- `PayrollEngine.computeSlip` gains a state-resolution step before calling `computePT`: look up the employee's `branchId` → `branches.address.state`, fallback to `organizationSettings.address.state` for the tenant. Cache this per payroll-run batch (resolve once per branch, not once per employee, if a run spans many employees on the same branch — avoid N+1 branch lookups).
- No new route needed — this is entirely internal to payroll calculation, triggered by the existing `POST /payroll-runs/:id/calculate` flow.

## Frontend

- Not applicable — backend-only calculation change. Payslip PDF rendering already displays "Professional Tax: ₹X" as a line item (per FEATURE_INVENTORY §5.7 payslip generation); no template change needed since the amount, not its derivation, is what the payslip shows.
- Optional (not required for this gap): an HR settings read-only view showing "which state's PT slabs apply to each branch" for transparency — nice-to-have, not blocking.

## API Contract

- Not applicable — no new/changed REST endpoint. The change is entirely within `PayrollEngine.computeSlip`'s internal calculation.

## Multi-Tenant Considerations

- `pt_slabs` is intentionally **not** tenant-scoped (it's statutory reference data identical for every tenant with employees in a given state) — this is a deliberate exception to the "every table carries tenant_id" convention, analogous to `gst-service`'s GST rate/HSN master which is also global reference data, not per-tenant. Document this exception explicitly in the migration comment so a future reviewer doesn't flag its missing `tenant_id` as a bug.
- Employee state resolution still respects tenant/branch isolation as normal — `employees.branchId` and `branches` lookups are already tenant-scoped via existing queries; no new isolation logic needed there.

## Integration

- **hr-service only** — no other service touched. Payslip PDF generation (also hr-service, per FEATURE_INVENTORY, or report-service's payslip template — confirm which service owns payslip PDF rendering before assuming no cross-service change is needed) consumes the already-computed `professionalTax` figure from `payrollSlips`, unchanged.

## Coding Standards

- Drizzle schema + migration convention matching every other table in this repo (see Database Changes).
- `PTSlabService` follows the same static-class-with-DB-param style as `PayrollEngine`/`computePF`/`computeESI` in the same file — no new architectural pattern introduced.

## Performance

- One extra `SELECT` per distinct branch per payroll run (cacheable within a single run's execution) — negligible; payroll runs are a monthly batch job over at most a few hundred employees per tenant, not a hot path.
- Index `pt_slabs` on `(state_code, effective_from, effective_to)` for the lookup.

## Security

- Not applicable beyond existing `PERMISSIONS.PAYROLL_PROCESS`/`PAYROLL_APPROVE` gates on the payroll-run endpoints that trigger this calculation — no new permission needed since this is a calculation-accuracy fix, not a new capability.

## Testing

- Extend `apps/hr-service/src/__tests__/statutory-payroll.test.ts` (existing PT/PF/ESI/TDS test file) with: Maharashtra slabs produce identical output to today's hardcoded constant (regression safety — no existing tenant's numbers should shift); at least one other seeded state (e.g. Karnataka) produces its own correct slab amount; a state with no PT (e.g. Haryana, if not seeded) produces `0`, not an error and not Maharashtra's rate; an employee with no resolvable `branchId`/state falls back to the tenant's `organizationSettings` state correctly.
- Verify seeded slab figures against an authoritative current source at implementation time — this is stated explicitly because incorrect statutory figures are a compliance risk, not just a code-quality one.

## Acceptance Criteria

- [ ] An employee in a Maharashtra branch gets exactly the same PT amount as before this change (regression-safe).
- [ ] An employee in a Karnataka (or other seeded state) branch gets that state's correct PT slab amount, not Maharashtra's.
- [ ] An employee in a no-PT state gets `professionalTax: 0`.
- [ ] `pnpm --filter hr-service test` passes including new multi-state PT tests.
- [ ] Migration adds `pt_slabs` seeded with verified, sourced figures for at least the 8 states named in this package's scope, and is reversible.

## Deliverables

- **Files to create:** `apps/hr-service/src/domain/PTSlabService.ts`, migration file for `pt_slabs` + seed data.
- **Files to modify:** `apps/hr-service/src/domain/PayrollEngine.ts` (remove hardcoded `PT_SLABS`, wire `PTSlabService` + state resolution into `computeSlip`), `apps/hr-service/src/__tests__/statutory-payroll.test.ts`.
- **Migrations:** one new migration (`pt_slabs` table + seed `INSERT`s).
- **APIs added/changed:** none.
- **Events added/changed:** none.
- **Tests added:** multi-state PT regression + new-state + no-PT-state test cases.

---

## Context Preservation (for a fresh AI session with no prior history)

**Previous Work Summary:** `apps/hr-service/src/domain/PayrollEngine.ts` computes Professional Tax via a single hardcoded 3-slab constant (`PT_SLABS`, lines 39-51) explicitly commented "Maharashtra as default" — there is no state parameter anywhere in the call chain; every tenant, regardless of where their employees actually work, gets Maharashtra's ₹0/₹150/₹200 slabs.

**Current Objective:** Make PT state-aware: resolve each employee's actual work-state (via `employees.branchId → branches.address.state`, falling back to the tenant's `organizationSettings.address.state`), look up that state's slabs from a new seeded `pt_slabs` reference table (not another hardcoded constant, since state slabs change over time independent of app releases), and default cleanly to zero for states with no PT.

**Architecture Snapshot:** `branches.address` is already a `jsonb` column typed with a `state` field (`packages/db-client/src/schema/tenant.ts`); `employees.branchId` already links to it. `pt_slabs` is deliberately global reference data (not tenant-scoped), analogous to gst-service's GST rate/HSN master. `PayrollEngine.computeSlip` is the single call site needing the new state-resolution step before its existing `computePT` call (line 219).

**Completed Components:** PF (`computePF`), ESI (`computeESI`), TDS (`calculateIncomeTax`/`computeMonthlyTDS`) — all correct, unrelated, do not touch.

**Pending Components:** This package does not address payroll loan deductions (PG-045, same file, `loanDeduction = 0` hardcoded at line 221) — separate gap, separate package.

**Known Constraints:** Seeded slab figures must be sourced correctly, not approximated — this is exact statutory data.

**Coding Standards:** Match `computePF`/`computeESI`'s existing static-method-plus-pure-function style; Drizzle migration convention as used throughout `packages/db-client/migrations`.

**Reusable Components:** `branches.address.state`, `organizationSettings.address.state`, `employees.branchId` — all already exist, no new columns needed on those tables.

**APIs Already Available:** none new required — internal calculation change only.

**Events Already Available:** not applicable.

**Shared Utilities:** none new beyond standard Drizzle/`@erp/db` query patterns already used throughout `PayrollEngine.ts`.

**Feature Flags:** none.

**Multi-Tenant Rules:** `pt_slabs` is a deliberate exception to per-tenant scoping (global statutory reference data); employee/branch resolution remains tenant-scoped as normal.

**Security Rules:** no new permission; existing `PAYROLL_PROCESS`/`PAYROLL_APPROVE` gates are unchanged and sufficient.

**Database State:** new `pt_slabs` table + seed data, next sequential migration number after 0034 (verify current latest before creating).

**Testing Status:** `apps/hr-service/src/__tests__/statutory-payroll.test.ts` currently tests PF/ESI/TDS and presumably the single hardcoded PT slab — extend, don't replace, its PT coverage.

**Next Session Plan:** single session.

**Prompt for the Next Session:** "Implement `ERP-PLANNING/production-gap-prompts/008-HR/40-multi-state-professional-tax.md` (PG-044). Before writing the migration's seed data, source current, correct PT slab figures for each state in scope from an authoritative reference — do not approximate. Preserve the existing Maharashtra figures exactly (regression safety) and verify via `apps/hr-service/src/__tests__/statutory-payroll.test.ts` that no existing tenant's Maharashtra-based payroll output changes."
