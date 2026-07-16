# PG-045 — Payroll Loan Deductions — Completion Report

**Date:** 2026-07-11
**Status:** Complete.

## Summary

`apps/hr-service/src/domain/PayrollEngine.ts:246` previously hardcoded `const loanDeduction = 0;`
— every payslip showed `Loan Deduction: ₹0` regardless of whether the employee had a loan,
because no employee-loan entity existed anywhere in the codebase. Loans are now real:

- New `employee_loans` table (flat-EMI, no-interest: `monthlyDeduction = principalAmount /
tenureMonths`, rounded to 2 decimals) + `loan_deduction_history` (per-payslip audit trail —
  answers "which loan(s) contributed to this month's deduction" once an employee has more than
  one active loan).
- `EmployeeLoanService` (`apps/hr-service/src/domain/EmployeeLoanService.ts`): CRUD, plus
  `getActiveLoansForEmployee` (used by `computeSlip`, read-only) and `applyMonthlyDeduction`
  (used only at payroll-run approval — decrements `outstandingBalance` per loan, capped so the
  final EMI never overshoots, auto-closes at zero, writes history).
- `PayrollEngine.computeSlip` now sums active loans' EMIs (via the new pure
  `computeLoanDeduction`) into `loanDeduction`, read-only — balances are never mutated during
  calculation, only at approval, so recalculating a still-`DRAFT` payroll run never
  double-decrements a loan.
- `POST /payroll-runs/:id/approve` now also applies each approved slip's loan deduction via
  `EmployeeLoanService.applyMonthlyDeduction`, exactly once (the route's own state machine
  already prevents re-approving an `APPROVED` run).
- New `POST/GET/PATCH /employee-loans[/:id]` routes, gated by a new `EMPLOYEE_LOAN_MANAGE`
  permission (granted to `OWNER`/`ADMIN`/`SUPER_ADMIN` via the existing wildcard, and added to
  `HR_MANAGER`'s explicit list).
- Loan **disbursement** (the one-time cash payout) publishes a new `EMPLOYEE_LOAN_DISBURSED`
  event, posted by a new `EmployeeLoanAccountingConsumer` as DR Employee Loans Receivable
  (new account `1340`) / CR Cash-in-Hand.

## Deviation from the gap-prompt (flagged during implementation, not silently decided)

The doc's Architecture section assumed an existing "postingMatrix-table-driven journal
pattern already used for PF/ESI/PT/TDS" that the recurring loan-recovery deduction could be
added to as one more credit line within the existing `PAYROLL_RUN_APPROVED` journal. Reading
`PayrollAccountingConsumer.ts` and `PostingMatrixService.buildJournalEntry` directly showed
this doesn't exist — `PAYROLL_RUN_APPROVED` posts exactly one 2-line journal (DR Salaries and
Wages / CR Salary Payable) sized at the run's aggregate `totalNet`. PF, ESI, PT, and TDS are
not broken into separate ledger lines at all; they just reduce `totalNet` silently. Rather than
inventing a new multi-line-per-event mechanism (real scope creep) or inflating "Salary Expense"
by the loan amount to force balance, the recurring EMI recovery was wired to behave exactly
like every other existing deduction — it reduces `loanDeduction` → `totalDeductions` →
`totalNet`, which already flows through to the existing journal unchanged, no new posting-matrix
row. The `outstandingBalance` decrement + `loan_deduction_history` audit trail (the part that
actually matters for financial correctness) still happens correctly at approval time. Full
detail in `IMPLEMENTATION-NOTES.md`'s PG-045 entry.

The one-time **disbursement** journal (a genuine previously-uncaptured cash event) was
implemented exactly as the doc specified — new event, new consumer, new posting-matrix row.

## Acceptance Criteria

- [x] An employee with no loan continues to show `Loan Deduction: ₹0` (regression-safe) —
      `computeLoanDeduction([])` → `0`, covered by `employee-loans.test.ts`.
- [x] A new employee loan can be created, computes the correct flat-EMI `monthlyDeduction`,
      and emits `EMPLOYEE_LOAN_DISBURSED`, posted by accounting-service as DR Employee Loans
      Receivable / CR Cash — covered by `EmployeeLoanService.create` tests +
      `employee-loan-accounting-consumer.test.ts`.
- [x] `computeSlip` sums active loan EMIs into `loanDeduction`, capped so the final EMI never
      overshoots — covered directly (`computeLoanDeduction` cap test).
- [x] `outstandingBalance` decrements exactly once per payroll-run approval (not once per
      DRAFT recalculation) — enforced by design: `computeSlip` never mutates balances, only
      `EmployeeLoanService.applyMonthlyDeduction` does, called only from `/approve`, which the
      route's own `CALCULATED`-only guard prevents from running twice on the same run.
- [x] A loan's `status` transitions to `CLOSED` automatically once `outstandingBalance` reaches
      `0` — covered by `applyMonthlyDeduction`'s cap/auto-close test.
- [x] `pnpm --filter hr-service test` and `pnpm --filter accounting-service test` pass,
      including new loan-deduction tests.

## Verification performed this session

- `pnpm --filter hr-service test` — 65/67 passing; all 11 new `employee-loans.test.ts` tests
  green. The 2 failures are pre-existing, unrelated (`holiday.test.ts`, already documented in
  `PG-043_COMPLETION.md`/`PG-044_COMPLETION.md` — confirmed still failing identically on a
  clean `git stash` of this session's changes).
- `pnpm --filter accounting-service test` — 35/40 passing (5 skipped, pre-existing integration
  tests requiring a live DB); both new `employee-loan-accounting-consumer.test.ts` tests green.
- `pnpm --filter hr-service run type-check` — clean (after `pnpm --filter @erp/db build` +
  `pnpm --filter @erp/types build`, required so the new schema/permission exports land in the
  compiled `dist/` those apps import from).
- `pnpm --filter accounting-service run type-check` — clean.
- `pnpm --filter tenant-service run type-check` — clean (after the `role-defaults.ts` edit).
- Docker/Postgres was not available this session (`docker ps` fails to reach the daemon) — the
  new migrations were not run against a live database.

## Files touched

- `packages/db-client/src/schema/hr.ts` — `employeeLoans`/`loanDeductionHistory` tables + type
  exports.
- `packages/db-client/migrations/0046_pg045_employee_loans.sql` — new tables.
- `packages/db-client/migrations/0047_pg045_employee_loan_manage_permission_backfill.sql` — new;
  backfills `EMPLOYEE_LOAN_MANAGE` for existing tenants' `OWNER`/`ADMIN`/`SUPER_ADMIN`/`HR_MANAGER`
  roles (same gap as `0038_pg020_sso_config_manage_permission_backfill.sql` — role-defaults.ts
  is only evaluated at tenant-provisioning time).
- `packages/shared-types/src/permissions.ts` — new `EMPLOYEE_LOAN_MANAGE` constant.
- `apps/tenant-service/src/rbac/role-defaults.ts` — added `EMPLOYEE_LOAN_MANAGE` to `HR_MANAGER`.
- `apps/hr-service/src/domain/EmployeeLoanService.ts` — new.
- `apps/hr-service/src/domain/PayrollEngine.ts` — added `computeLoanDeduction`; replaced
  hardcoded `loanDeduction = 0` with a real, read-only, capped sum.
- `apps/hr-service/src/api/employee-loans.routes.ts` — new; `POST/GET/PATCH /employee-loans[/:id]`.
- `apps/hr-service/src/api/payroll.routes.ts` — `/payroll-runs/:id/approve` now applies each
  slip's loan deduction via `EmployeeLoanService.applyMonthlyDeduction`.
- `apps/hr-service/src/main.ts` — registered `employeeLoanRoutes`.
- `apps/accounting-service/src/domain/default-accounts.ts` — new `1340 Employee Loans
Receivable` system account.
- `apps/accounting-service/src/domain/PostingMatrixService.ts` — new `EMPLOYEE_LOAN_DISBURSED`
  default posting rule.
- `apps/accounting-service/src/consumers/EmployeeLoanAccountingConsumer.ts` — new.
- `apps/accounting-service/src/main.ts` — registered the consumer + `erp.employee.loan.disbursed`
  topic.
- `apps/hr-service/src/__tests__/employee-loans.test.ts` — new; 11 tests (`computeLoanDeduction`,
  `EmployeeLoanService.computeMonthlyDeduction`/`create`/`applyMonthlyDeduction`/`updateStatus`).
- `apps/accounting-service/src/__tests__/employee-loan-accounting-consumer.test.ts` — new; 2 tests.
- `ERP-PLANNING/production-gap-prompts/IMPLEMENTATION-NOTES.md` — new PG-045 entry (the
  posting-matrix deviation above).

## Deployment Checklist

- [x] Run migrations `0046_pg045_employee_loans.sql` and
      `0047_pg045_employee_loan_manage_permission_backfill.sql` against the target database —
      verified applied 2026-07-17: `employee_loans` table exists and 40 role_permissions rows
      carry `EMPLOYEE_LOAN_MANAGE`.
- [ ] Existing tenants need their Chart of Accounts reseeded (or account `1340` manually added)
      before `EMPLOYEE_LOAN_DISBURSED` can post — `PostingMatrixService` skips unconfigured
      accounts gracefully but then fails with `JOURNAL_INSUFFICIENT_LINES` if the account is
      genuinely missing. New tenants provisioned after this change get it automatically via
      `DEFAULT_ACCOUNTS`.
- [x] No new environment variables.
