# [PG-045] Payroll Loan Deductions

> Template version 1.0. Every gap-prompt file in this tree must follow this exact section order. Do not add sections; do not omit sections that apply. If a section genuinely does not apply to this gap, write "Not applicable — <one-line reason>" instead of deleting it, so the structure stays diffable across files.

**Category:** HR
**Priority:** Medium
**Complexity:** M — the payroll-engine wiring is small (one new deduction resolved and threaded through an existing call chain), but a correct employee-loan entity (principal, tenure, EMI schedule, outstanding-balance tracking) plus its accounting-service posting integration is real, non-trivial domain modeling.
**Depends on:** none
**Blocks:** none
**Primary service(s)/package(s):** apps/hr-service (src/domain/PayrollEngine.ts), apps/accounting-service (event consumers)

---

## Overview

- **Business objective:** many Indian retail/manufacturing employers advance salary loans to employees (festival advances, emergency loans, tailoring-machine purchase advances) recovered via fixed monthly EMI-style deductions from payroll until the loan is repaid. Today this ERP has no way to record such a loan or deduct its EMI — every payslip silently shows `Loan Deduction: ₹0`, which is not "no employees have loans," it is "the feature was never built." Any tenant that actually runs employee loans today must track and deduct them entirely outside the ERP (spreadsheet + manual payslip adjustment), defeating the point of running payroll through the system at all.
- **Current implementation:** confirmed by direct read of `apps/hr-service/src/domain/PayrollEngine.ts` line 221:
  ```ts
  const loanDeduction = 0; // future: from loan_deductions table
  ```
  This sits inline inside `PayrollEngine.computeSlip` (the same method that computes PF/ESI/PT/TDS — see lines 215-225), between the Professional Tax computation and the total-deductions sum:
  ```ts
  const totalDeductions = pfEmployee + esiEmployee + professionalTax + loanDeduction + tdsDeduction;
  ```
  `loanDeduction` is a literal constant, not a lookup — there is no `loan_deductions` table (the comment names one that was never created), no employee-loan entity anywhere in `packages/db-client/src/schema/hr.ts`, and no API route to create/view/manage an employee loan. `PayrollSlipResult.loanDeduction` (the interface field, line 33) and its persistence in `PayrollEngine.upsertSlip` (`payrollSlips.loanDeduction`, lines 290/298-306) and the payslip UI/PDF (`payroll.routes.ts` line 395, `{ component: 'Loan Deduction', amount: slip.loanDeduction }`) all already exist and correctly display whatever `loanDeduction` resolves to — they are just permanently fed a hardcoded `0`.
- **Current architecture:** `PayrollEngine.computeSlip(db, tenantId, employeeId, periodMonth, periodYear, workingDays)` is the single call site for all payroll deduction computation, called from the existing `POST /payroll-runs/:id/calculate` flow (per `apps/hr-service/src/api/payroll.routes.ts`). `PayrollEngine.upsertSlip` persists the computed slip, encrypting `grossSalary`/`netSalary` via `@erp/utils`' `encryptField` (the same field-encryption convention every other sensitive payroll figure already uses) but storing `loanDeduction` as a plain `String(...)` (unencrypted) — consistent with how `professionalTax`/`tdsDeduction`/`pfEmployee` are also stored unencrypted (only gross/net salary are encrypted today), so a new loan-deduction figure should follow that same precedent, not introduce a new encryption requirement.
- **Current limitations:** there is no employee-loan entity (principal amount, tenure in months, monthly EMI, disbursement date, outstanding balance), no way to create/approve/disburse a loan, no way to compute or apply a monthly EMI deduction, and no accounting-service posting for either the loan disbursement (a debit to an Employee Loans Receivable asset account) or its monthly recovery (a credit against that same receivable, alongside the existing payroll clearing/accrual postings).

## Existing Code Analysis

- **What already exists and should be reused:** `PayrollSlipResult.loanDeduction` and its full downstream plumbing (persistence in `payrollSlips`, payslip line-item display in `payroll.routes.ts`) are already correct and complete — this package's job is only to make the *upstream* value real, not to build any new downstream display/storage. `computePF`/`computeESI`/`calculateIncomeTax`/`computeMonthlyTDS` in the same file are the established style for a deduction-computation function (pure function, static export, called inline from `computeSlip`) — a new `computeLoanEMI`-shaped function should match that same shape. `apps/hr-service/src/__tests__/statutory-payroll.test.ts` already exercises `computeSlip`'s deduction chain end-to-end and is the natural home for new loan-deduction test cases (per PG-044's sibling package, which explicitly defers "payroll loan deductions (PG-045, same file, `loanDeduction = 0` hardcoded at line 221) — separate gap, separate package" — confirming this package's scope boundary against PG-044 was already deliberately drawn).
- **What should never be modified:** `computePF`, `computeESI`, `computePT`/`PTSlabService` (per PG-044, if implemented first — verify at implementation time whether PG-044 has landed, since it changes `computePT`'s signature from `(grossMonthly)` to `(grossMonthly, slabs)`), and `calculateIncomeTax`/`computeMonthlyTDS` — all unrelated, working deduction calculations in the same file, out of scope. The existing `payrollSlips.loanDeduction` column and its unencrypted-storage convention should not be changed to encrypted storage as part of this package (that would be scope creep beyond what this gap asks for, and would inconsistently single out one deduction type for encryption when PF/ESI/PT/TDS aren't).
- **Prior related work:** none in `ERP-PLANNING/phase-completions/`. PG-044 (`008-HR/40-multi-state-professional-tax.md`) is the sibling package in the same file and explicitly calls out this gap as separate scope — read that file's "Pending Components" section for the exact boundary already agreed.

## Architecture

- **New entity: `employee_loans`.** Fields: `id, tenantId, employeeId, loanType (e.g. 'SALARY_ADVANCE' | 'FESTIVAL_ADVANCE' | 'GENERAL'), principalAmount, tenureMonths, monthlyDeduction (EMI), disbursedAmount, disbursedDate, outstandingBalance, status ('ACTIVE' | 'CLOSED' | 'CANCELLED'), createdAt, createdBy`. `monthlyDeduction` is computed once at loan creation (simple `principalAmount / tenureMonths`, rounded — this ERP has no existing interest-bearing-loan amortization concept anywhere to build on, and the task scope is "EMI-style payroll deduction," not a full loan-amortization-schedule product; a flat-EMI, no-interest model matches the "salary advance" framing and keeps this at Medium rather than Large complexity — flag if a specific tenant needs interest-bearing loans, which would be a follow-on package, not this one).
- **Where EMI deduction happens:** `PayrollEngine.computeSlip` gains a step before the existing `loanDeduction = 0` line: look up the employee's `ACTIVE` `employee_loans` row(s) (an employee could in principle have more than one active loan — sum their `monthlyDeduction`s, capped at the employee's `outstandingBalance` for each so the last EMI doesn't overshoot), sum into `loanDeduction`, and decrement each loan's `outstandingBalance` by its applied EMI — but only on **approval/finalization** of the payroll run, not on every re-calculation of a still-DRAFT slip (payroll runs are commonly recalculated multiple times before approval — decrementing `outstandingBalance` at `computeSlip` time, which can run repeatedly on the same DRAFT slip, would double- or triple-decrement the balance). This mirrors the existing DRAFT-vs-approved distinction already present in `payrollSlips.status` (`'DRAFT'` per `upsertSlip`, line 294) — the loan-balance decrement belongs at the same point the payroll run transitions out of DRAFT (the existing approve/disburse step), not inside `computeSlip` itself.
- **Accounting integration — reuse, don't invent:** per this codebase's established "no cross-service transactional logic" convention (ledger-writing services duplicate the relevant domain logic/posting rather than calling another service synchronously), this package does **not** add a new Kafka event type. Instead: (1) **loan disbursement** posts through the same mechanism the task calls for reusing — the existing payroll-approve/disburse Kafka event flow into accounting-service (verify the exact existing event name at implementation time, e.g. `PAYROLL_RUN_APPROVED`/`PAYROLL_DISBURSED` — confirm against `apps/hr-service`'s outbox-event-producing code before implementing) already carries the accrual/clearing journal pattern for net-pay/PF/ESI/PT/TDS; loan EMI recovery should be added as one more line in that same existing posting-matrix-driven journal (a credit to Employee Loans Receivable, alongside the existing net-pay/statutory-deduction credit lines), not a new event or a new consumer. (2) **loan disbursement itself** (the one-time payout of the loan principal to the employee, distinct from the monthly recovery) is a separate, smaller event — reuse the same outbox-event → accounting-service-consumer pattern (a new event type, e.g. `EMPLOYEE_LOAN_DISBURSED`, is justified here since disbursement is a distinct business moment from any existing payroll event, not an attempt to invent a parallel posting mechanism for the *recurring* deduction, which does reuse the existing payroll event).
- **Data flow:** `POST /employee-loans` (create + disburse) → `hr-service` writes `employee_loans` row, emits `EMPLOYEE_LOAN_DISBURSED` via the existing outbox-relay pattern (`outboxEvents` table, same as every other cross-service event in this codebase) → `accounting-service` consumer posts DR Employee Loans Receivable / CR Cash-or-Bank (a new small consumer, following the exact shape of existing consumers like `PaymentAccountingConsumer`). Monthly: `PayrollEngine.computeSlip` sums active loans' EMI into `loanDeduction` (read-only, no balance mutation) → payroll-run approval step decrements `outstandingBalance` per loan and includes the summed EMI as one more credit line in the existing payroll accrual/clearing journal event → `accounting-service` posts it through the existing consumer, unchanged in event type, just one more posting-matrix line item (`lineLabel: 'Loan Recovery'`, following the same `postingMatrix` row-per-deduction-type convention already used for PF/ESI/PT/TDS — confirm the exact existing row shape in `postingMatrix` seed data before adding a new row for this).

## Database Changes

- New table `employee_loans`: `id, tenant_id, employee_id, loan_type (varchar), principal_amount (decimal), tenure_months (int), monthly_deduction (decimal), disbursed_amount (decimal), disbursed_date (date), outstanding_balance (decimal), status (varchar: ACTIVE/CLOSED/CANCELLED), created_at, created_by, updated_at`.
- New table `loan_deduction_history` (or reuse `payrollSlips` alone if a per-slip audit trail isn't needed beyond the aggregate `loanDeduction` figure already stored there — recommend a small history table anyway, since a tenant will want to answer "which specific loan(s) contributed to this month's ₹X loan deduction on this payslip," which the aggregate `payrollSlips.loanDeduction` alone cannot answer once an employee has more than one loan): `id, tenant_id, employee_loan_id, payroll_slip_id, amount_deducted, period_month, period_year, created_at`.
- Migration: next sequential number in `packages/db-client/migrations/` after `0034_organization_theme_config.sql` (re-verify current latest before creating — concurrent packages may have added migrations since this was written).
- Rollback strategy: `DROP TABLE loan_deduction_history` then `DROP TABLE employee_loans` — clean rollback since `payrollSlips.loanDeduction` (pre-existing column) reverts to always being `0` again exactly as it is today, with no other table depending on the new ones.

## Backend

- New `apps/hr-service/src/domain/EmployeeLoanService.ts`: CRUD for `employee_loans` (create computes `monthlyDeduction = principalAmount / tenureMonths`, rounded to 2 decimals; disburse emits the `EMPLOYEE_LOAN_DISBURSED` outbox event), plus `getActiveLoansForEmployee(db, tenantId, employeeId): Promise<EmployeeLoan[]>` used by `PayrollEngine.computeSlip`.
- `PayrollEngine.ts`: replace `const loanDeduction = 0;` (line 221) with a call to `EmployeeLoanService.getActiveLoansForEmployee` + a new pure function `computeLoanDeduction(activeLoans): number` (sums `monthlyDeduction`, capped per-loan at that loan's current `outstandingBalance` so the final EMI doesn't overshoot) — matching the existing `computePF`/`computeESI` pure-function style.
- New routes `apps/hr-service/src/api/employee-loans.routes.ts`: `POST /employee-loans` (create + disburse), `GET /employee-loans?employeeId=`, `GET /employee-loans/:id`, `PATCH /employee-loans/:id` (cancel/close only — no principal edits once disbursed, to keep the ledger trail honest).
- The existing payroll-run approval/disbursement step (wherever it currently emits the accrual/clearing journal event for net-pay/PF/ESI/PT/TDS — locate the exact file at implementation time, likely in `payroll.routes.ts` or a `PayrollRunService`) gains: (a) a call to decrement each contributing loan's `outstandingBalance` and insert a `loan_deduction_history` row, and (b) one more line item in the existing outbox event payload for the loan-recovery credit — reusing the existing event type, not adding a new one for this recurring part.
- New small `accounting-service` consumer (or an addition to the existing payroll-accrual consumer, whichever the existing pattern favors — verify at implementation time) handling `EMPLOYEE_LOAN_DISBURSED`: DR Employee Loans Receivable (new system account, seeded via the same `default-accounts.ts` pattern used for other system accounts) / CR Cash-or-Bank.

## Frontend

- New "Employee Loans" page under HR settings/employee-detail (following existing `EmployeeViewPage.tsx`/`EmployeeFormPage.tsx` conventions) — list active/closed loans for an employee, a "New Loan" form (principal, tenure, loan type), showing computed EMI and outstanding balance.
- `PayslipViewPage.tsx` already renders a "Loan Deduction" line (per `payroll.routes.ts` line 395) — no change needed there; it will simply start showing a real, non-zero figure once the backend is wired.
- Permission gating via the existing `PermissionGate`/`usePermission()` convention, using a new `EMPLOYEE_LOAN_MANAGE` permission (or reuse an existing HR-configuration permission if one already covers "manage employee financial records" — verify at implementation time).

## API Contract

- `POST /employee-loans` → request `{ employeeId, loanType, principalAmount, tenureMonths, disbursedDate }` → `201 { data: EmployeeLoan }` (server computes `monthlyDeduction`, sets `outstandingBalance = principalAmount`, `status: 'ACTIVE'`, emits `EMPLOYEE_LOAN_DISBURSED`).
- `GET /employee-loans?employeeId=` → `200 { data: EmployeeLoan[] }`
- `GET /employee-loans/:id` → `200 { data: EmployeeLoan & { history: LoanDeductionHistoryEntry[] } }`
- `PATCH /employee-loans/:id` → request `{ status: 'CANCELLED' | 'CLOSED' }` → `200 { data: EmployeeLoan }` — cancel only permitted before any deduction has been applied; close is the terminal state once `outstandingBalance` reaches `0` (system-set, not user-set, when the last EMI clears it — a manual `CLOSED` transition is for early payoff/write-off cases only).
- Error codes: `404 EMPLOYEE_LOAN_NOT_FOUND`, `400 INVALID_LOAN_TENURE` (e.g. `tenureMonths <= 0`), standard `{error:{code,message}}` envelope matching every other hr-service route.

## Multi-Tenant Considerations

- `employee_loans`/`loan_deduction_history` are fully tenant-scoped (`tenant_id` on every row, explicit `WHERE tenant_id = ?` on every query) — standard convention, no exception needed here (unlike PG-044's deliberately-global `pt_slabs`).
- Employee/branch isolation is inherited automatically since `employeeId` lookups already go through tenant-scoped `employees` queries elsewhere in `PayrollEngine.ts` — no new isolation logic needed.

## Integration

- **hr-service**: primary owner of the new entity, routes, and `PayrollEngine` wiring.
- **accounting-service**: new consumer for `EMPLOYEE_LOAN_DISBURSED`, plus a small addition to the existing payroll-accrual/clearing consumer for the recurring EMI credit line — reusing the existing event flow and posting-matrix pattern, per the Architecture section's explicit instruction not to invent a new one.
- No other of the 14 services touched.

## Coding Standards

- Drizzle schema + migration convention matching every other table in this repo.
- `EmployeeLoanService` follows the same static-class-with-DB-param style as `PayrollEngine`/`computePF`/`computeESI` in the same codebase area — no new architectural pattern introduced.
- Reuses the existing outbox-event/Kafka-consumer pattern for cross-service posting (per the Master Roadmap's "no package here should introduce a second way to do any of these" cross-cutting rule) rather than a synchronous cross-service call, consistent with this codebase's documented "no cross-service transactional logic" architecture.

## Performance

- One additional `SELECT` per employee per payroll run to fetch active loans (negligible — payroll runs are a monthly batch over at most a few hundred employees per tenant, same performance class as PG-044's per-branch PT-slab lookup).
- Index `employee_loans` on `(tenant_id, employee_id, status)` for the active-loan lookup.

## Security

- New `EMPLOYEE_LOAN_MANAGE` permission (or reuse of an existing HR-financial-configuration permission) gates loan creation/cancellation — this is sensitive financial data about an individual employee and must not be readable/writable by anyone without an explicit HR-payroll-adjacent permission, following the same sensitivity posture as salary-structure data elsewhere in `hr-service`.
- `outstandingBalance`/`monthlyDeduction` are not currently proposed for field-level encryption, consistent with how `professionalTax`/`tdsDeduction`/`pfEmployee` are also stored unencrypted today (only gross/net salary get `encryptField`) — flag if a future security review decides otherwise, but do not introduce inconsistent encryption for only this one new field without a broader decision.

## Testing

- Extend `apps/hr-service/src/__tests__/statutory-payroll.test.ts` (or a new dedicated `employee-loans.test.ts`, given the CRUD surface is larger than a pure calculation like PT/PF/ESI): an employee with no active loan gets `loanDeduction: 0` (regression-safe — matches today's behavior exactly); an employee with one active loan gets the correct EMI deducted and the loan's `outstandingBalance` correctly decremented only on payroll-run approval, not on every DRAFT recalculation; an employee whose final EMI would overshoot the remaining `outstandingBalance` gets capped at the remaining balance, not the full EMI; multiple active loans for one employee sum correctly.
- New `apps/hr-service/src/__tests__/employee-loans.test.ts`: create/disburse/cancel CRUD round-trip, tenant isolation.
- Integration test (or extend an existing accounting-consumer test) verifying `EMPLOYEE_LOAN_DISBURSED` posts the correct DR/CR pair, and that the recurring EMI correctly appears as one more line in the existing payroll accrual/clearing journal event without breaking that journal's existing DR=CR balance.

## Acceptance Criteria

- [ ] An employee with no loan continues to show `Loan Deduction: ₹0` on their payslip (regression-safe).
- [ ] A new employee loan can be created, computes the correct flat-EMI `monthlyDeduction`, and emits `EMPLOYEE_LOAN_DISBURSED`, which accounting-service posts as DR Employee Loans Receivable / CR Cash-or-Bank.
- [ ] `PayrollEngine.computeSlip` correctly sums an employee's active loan EMIs into `loanDeduction`, capped so the final EMI never overshoots the remaining balance.
- [ ] Loan `outstandingBalance` decrements exactly once per payroll-run approval (not once per DRAFT recalculation), and the existing payroll accrual/clearing journal event gains one more correctly-balanced credit line for loan recovery.
- [ ] A loan's `status` transitions to `CLOSED` automatically once `outstandingBalance` reaches `0`.
- [ ] `pnpm --filter hr-service test` and `pnpm --filter accounting-service test` pass, including new loan-deduction tests.

## Deliverables

- **Files to create:** `apps/hr-service/src/domain/EmployeeLoanService.ts`, `apps/hr-service/src/api/employee-loans.routes.ts`, `apps/hr-service/src/__tests__/employee-loans.test.ts`, a new frontend "Employee Loans" page, migration file for `employee_loans` + `loan_deduction_history`, new accounting-service consumer (or extension of the existing payroll-accrual consumer) for `EMPLOYEE_LOAN_DISBURSED` + loan-recovery posting-matrix row.
- **Files to modify:** `apps/hr-service/src/domain/PayrollEngine.ts` (replace hardcoded `loanDeduction = 0` with real resolution, line 221), the existing payroll-run approval/disbursement step (add loan-balance decrement + one more journal-event line item), `apps/hr-service/src/__tests__/statutory-payroll.test.ts` (regression cases), `packages/db-client/src/schema/hr.ts` (new tables), `default-accounts.ts` (new Employee Loans Receivable system account).
- **Migrations:** one new migration (`employee_loans` + `loan_deduction_history` tables), next sequential number after `0034` (re-verify current latest before creating).
- **APIs added/changed:** `POST/GET/PATCH /employee-loans[/:id]`.
- **Events added/changed:** new `EMPLOYEE_LOAN_DISBURSED` event; existing payroll accrual/clearing event gains one additional line item (no new event type for the recurring deduction).
- **Tests added:** `employee-loans.test.ts`, extended `statutory-payroll.test.ts` loan-deduction cases, extended accounting-consumer posting test.

---

## Context Preservation (for a fresh AI session with no prior history)

**Previous Work Summary:** `apps/hr-service/src/domain/PayrollEngine.ts` line 221 hardcodes `const loanDeduction = 0; // future: from loan_deductions table` — the interface field, persistence, and payslip display for a loan deduction all already exist and work correctly; only the upstream value is fake. No employee-loan entity, table, or route exists anywhere in the codebase. PG-044 (multi-state PT, same file) explicitly named this as separate, deferred scope when it was written.

**Current Objective:** build a real employee-loan entity (flat-EMI, no-interest, principal/tenure/monthly-deduction/outstanding-balance), wire it into `PayrollEngine.computeSlip`'s existing deduction chain (read-only sum, capped per-loan at remaining balance), decrement `outstandingBalance` only at payroll-run approval (not on every DRAFT recalculation), and post both the one-time disbursement and the recurring monthly recovery to accounting-service — reusing the existing outbox-event/consumer pattern (a new `EMPLOYEE_LOAN_DISBURSED` event for disbursement; the recurring recovery rides the existing payroll accrual/clearing event as one more line item, not a new event type).

**Architecture Snapshot:** `PayrollEngine.computeSlip` (`apps/hr-service/src/domain/PayrollEngine.ts`) is the single call site for all payroll deductions (PF/ESI/PT/TDS/loan); `payrollSlips.status` already distinguishes `DRAFT` from approved, which is the correct point to gate the one-time loan-balance decrement; this codebase's established convention is "ledger-writing services duplicate/extend domain logic and post via the existing outbox-event pattern," not synchronous cross-service calls — do not invent a new event type for the recurring EMI recovery.

**Completed Components:** PF/ESI/PT/TDS computation (all correct, unrelated, do not touch — PT may be mid-refactor if PG-044 lands first, verify `computePT`'s signature before assuming the `(grossMonthly)` single-argument shape still holds).

**Pending Components:** interest-bearing loans / amortization schedules are explicitly out of scope for this package (flat-EMI, no-interest model only) — a follow-on package if a specific tenant needs it.

**Known Constraints:** loan-balance decrement must happen exactly once per payroll-run approval, not once per `computeSlip` call (payroll runs are commonly recalculated multiple times while still `DRAFT`) — getting this wrong silently over-deducts an employee's loan balance, a real financial-correctness bug, not just a display issue.

**Coding Standards:** match `computePF`/`computeESI`'s existing static-method-plus-pure-function style in `PayrollEngine.ts`; reuse the existing outbox-event/Kafka-consumer pattern for the accounting-service posting, per this codebase's "no cross-service transactional logic, duplicate the posting via the established event flow" convention.

**Reusable Components:** `PayrollSlipResult.loanDeduction` and its existing persistence/display plumbing (no changes needed there), `default-accounts.ts`'s system-account-seeding pattern (for the new Employee Loans Receivable account), the existing `postingMatrix`-table-driven journal-construction pattern (for the new loan-recovery line item).

**APIs Already Available:** none new required for the payroll-calculation side (internal to `computeSlip`); the existing `POST /payroll-runs/:id/calculate` and approval/disbursement flow are the integration points, unchanged in shape.

**Events Already Available:** the existing payroll-run approval/disbursement outbox event (exact name to confirm at implementation time — carries the current accrual/clearing journal for net-pay/PF/ESI/PT/TDS) is what the recurring EMI recovery should extend, not replace.

**Shared Utilities:** `@erp/logger`, `@erp/types` (`BusinessError`), standard Drizzle/`@erp/db` query patterns already used throughout `PayrollEngine.ts`; `encryptField`/`decryptField` from `@erp/utils` exist but are deliberately **not** proposed for the new loan fields, matching how PF/ESI/PT/TDS are also stored unencrypted today.

**Feature Flags:** none required — this is a core payroll-calculation correctness fix (an always-zero deduction becoming real), not an opt-in enterprise feature.

**Multi-Tenant Rules:** `employee_loans`/`loan_deduction_history` are fully tenant-scoped, standard `WHERE tenant_id = ?` convention — no exception needed (unlike PG-044's global `pt_slabs`).

**Security Rules:** new `EMPLOYEE_LOAN_MANAGE` permission (or reuse of an existing HR-financial-configuration permission — confirm at implementation time) gates all loan CRUD; existing `PAYROLL_PROCESS`/`PAYROLL_APPROVE` gates are unchanged and sufficient for the payroll-calculation side.

**Database State:** new `employee_loans` + `loan_deduction_history` tables, next sequential migration after `0034_organization_theme_config.sql` (re-verify current latest before creating).

**Testing Status:** `apps/hr-service/src/__tests__/statutory-payroll.test.ts` currently tests PF/ESI/TDS/PT and presumably asserts `loanDeduction: 0` somewhere (per `payroll-encryption.test.ts` line 70's `loanDeduction: 0` reference, found via grep) — that assertion must be preserved as a genuine "no active loan" case, not simply deleted, once real loans exist.

**Next Session Plan:** single session — Medium complexity, one service pair (hr-service + a small accounting-service consumer addition), no schema redesign of existing tables required (only new tables + a small existing-event-payload addition).

**Prompt for the Next Session:** "Implement `ERP-PLANNING/production-gap-prompts/008-HR/41-payroll-loan-deductions.md` (PG-045). Before writing code: (1) re-verify `apps/hr-service/src/domain/PayrollEngine.ts` line 221 still reads `const loanDeduction = 0;` and check whether PG-044 (multi-state PT) has landed first, since it changes `computePT`'s signature; (2) locate the exact existing outbox-event name and payload shape for payroll-run approval/disbursement before adding the loan-recovery line item to it — do not invent a new event type for the recurring deduction, only for the one-time `EMPLOYEE_LOAN_DISBURSED`; (3) confirm the loan-balance decrement is wired to the approval step, not `computeSlip` itself, to avoid double-decrementing on DRAFT recalculation."
