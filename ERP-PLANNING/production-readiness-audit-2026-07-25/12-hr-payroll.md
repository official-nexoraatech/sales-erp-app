# HR & Payroll Module — Production Readiness Audit (2026-07-25)

Scope: `apps/hr-service` (employees, salary structures, payroll runs, loans, leaves,
alterations, Form 16) + `apps/web-frontend/src/pages/hr`. Tested live against tenant 2
("QA E2E Test Co") on the running dev stack (gateway :3000, hr-service :3021,
accounting-service :3019, Postgres via `erp-postgres-primary` docker container) using the
`hr.manager@qa-e2e.local` (HR_MANAGER) and `cashier@qa-e2e.local` (CASHIER) test accounts.
Prior audit claims were treated as unverified leads and re-checked against current code and
live data, not taken on trust.

## Summary

The HR/Payroll core (employee CRUD, salary structures, payroll calculate/approve/disburse,
Form 16, employee self-service) is functionally solid and its accounting integration is
**real and working** — this module does **not** share the sibling "hardcoded GL codes don't
match tenant's chart of accounts" bug family found in GRN/Purchase-Return/Supplier-
Payment/Expense. The historical "one bad employee aborts the whole payroll batch" bug is
confirmed fixed, live, with fresh evidence. However, this audit found a genuine, previously
undocumented **HIGH severity** gap in Employee Loans (a loan can be force-closed with its
full balance still outstanding, no validation, no accounting reversal) and a **HIGH
severity** gap in Leave Balance (balance rows are only ever created by a monthly cron that
had never fired for this tenant, so every leave application in this tenant's history bypassed
balance enforcement entirely). A **MEDIUM** Form 16 data-integrity gap was also found.

## What works (verified live)

- **Employee CRUD**: Created employee id **32** ("Audit TestEmployee") with full details —
  PAN (`ABCDE1234F`), bank account, IFSC, UAN, ESI number, gender, DOB, Aadhaar-last-4 — via
  `POST /api/hr/employees`. Persisted correctly; PAN/bank returned only as hashes in the
  response, never in plaintext or in list views. Confirmed encrypted-at-rest fields
  (`panEncrypted`, `bankAccountNoEncrypted`) are never included in `GET /employees` or
  `GET /employees/:id` responses.
- **Employee list ordering**: The historical zero-`ORDER BY` bug is fixed and verified live —
  `employee.routes.ts` line ~402 orders `desc(employees.createdAt), desc(employees.id)`.
  `GET /api/hr/employees?page=0&size=5` correctly returned the newest employees first
  (id 31, 30, 29, 28, 27).
- **Salary structures**: Created structure id **1** ("Audit Test Structure", 50/20/10
  basic/HRA/DA split + a named allowance) via `POST /api/hr/salary-structures`, then assigned
  a full salary (CTC 600,000, basic 25,000, HRA 10,000, DA 5,000, gross 50,000) to employee 32
  via `POST /api/hr/employee-salaries`. Response correctly excludes decrypted figures.
- **Payroll calculate — skip-and-continue confirmed fixed, live**: Created a fresh payroll run
  (id **4**, period 6/2026) and calculated it. Result: `27` employees processed, `4` skipped
  with clear per-employee reasons (`"Employee 1 has no active salary assigned"`, etc.), run
  correctly reached `CALCULATED` status (not stuck in `CALCULATING`). This exactly matches the
  code comment in `payroll.routes.ts` describing the 2026-07-12 fix. Pre-existing runs 2 and 3
  independently corroborate the same skip behavior in their `notes` field.
  The frontend (`PayrollPage.tsx` line ~100-110) surfaces the skipped list to the admin via a
  toast rather than hiding it behind a blanket success message.
- **Payslip math verified correct** for employee 6 in run 4 (slip id 68): presentDays 20,
  workingDays 26 → gross **38,461.54** = pro-rated basic+HRA+DA+other allowances; PF
  1,800 (12% of basic capped at ₹15,000), EPS 1,249.5 (capped at ₹1,250), ESI correctly
  zeroed (gross > ₹21,000 cap), PT 200, loan EMI 1,000, TDS correctly zeroed (mid-year-joiner
  income projection below the ₹3L slab) → totalDeductions 3,000 → **net 35,461.54**. Formula
  cross-checked by hand against `PayrollEngine.computeSlip`.
- **Accounting integration — confirmed real, not the broken PostingMatrixService family**:
  - Confirmed `PAYROLL_PROCESSED` (5110/1010) in `PostingMatrixService.ts` is genuinely dead
    code — grepped hr-service, it is never emitted by any producer.
  - The real events hr-service emits are `PAYROLL_RUN_APPROVED` (6010 Salaries Exp / 2310
    Salary Payable), `PAYROLL_RUN_DISBURSED` (2310 / 1010 Cash), `EMPLOYEE_LOAN_DISBURSED`
    (1340 Employee Loans Receivable / 1010), `EMPLOYEE_LOAN_REPAID` (6010 / 1340). All four
    account codes (1010, 1340, 2310, 6010) **exist and are active** in tenant 2's real chart
    of accounts (`accounts` table) — confirmed by direct query.
  - Approved run 4 live: `outbox_events` shows `PAYROLL_RUN_APPROVED` and
    `EMPLOYEE_LOAN_REPAID` both `published=true, failed=false`; `journals` table shows both
    posted (`status=POSTED`), with correct `financial_entries` lines: 35,461.54
    Dr 6010/Cr 2310 for the payroll accrual, and 3,000.00 Dr 6010/Cr 1340 for loan EMI
    recovery (3,000 = employee 6's ₹1,000 + employee 31's ₹2,000 EMI, both processed in the
    same run — verified against `employee_loans.outstanding_balance` decrementing correctly:
    employee 6 5,000→4,000, employee 31 10,000→8,000).
  - Disbursed run 4: `PAYROLL_RUN_DISBURSED` published, journal posted, Dr 2310/Cr 1010
    35,461.54.
  - New loan (id **11**, ₹12,000 to employee 32) disbursement also verified: journal posted,
    Dr 1340 12,000 / Cr 1010 12,000.
  - Zero failed outbox events for tenant 2 across the board (`failed=true` count = 0).
- **Leaves — apply/approve/reject flow works mechanically**: Applied Casual Leave for
  employee 6 (2026-08-10 to 08-11, 2 days) → id 8, `PENDING`. Approved it →
  attendance rows auto-created with `status=LEAVE` for those dates, event
  `LEAVE_APPROVED` published. (See Bugs section for the balance-enforcement gap this exposed.)
- **RBAC**: `CASHIER` token (no HR permissions) got clean `403 FORBIDDEN` with the specific
  missing-permission name (`Missing permission: EMPLOYEE_VIEW`, `Missing permission:
PAYROLL_VIEW`) on `GET /employees` and `GET /payroll-runs`.
- **Employee self-service**: `GET /api/hr/me/payroll-slips` correctly scopes to the caller's
  own linked employee via `employees.userId` — `hr.manager@qa-e2e.local` (→ employee 27) and
  `cashier@qa-e2e.local` (→ employee 4) each saw only their own 2-3 slips, no cross-employee
  leakage. `/me/leave-balance` and `/me/attendance` follow the same pattern.
- **Migration 0103** (`0103_qa_e2e_employee_user_link_backfill.sql`): reviewed — it's a
  narrow, tenant-2-only, `@qa-e2e.local`-only backfill of `employees.user_id` pairing each
  named test-role login to a distinct employee record, added because migration 0087 added the
  self-service link column but left it NULL for everyone (no automatic name-matching exists,
  by design — real tenants still need to link accounts manually). Confirmed it's a no-op
  against any other tenant and confirmed live that self-service now resolves real data for
  the linked test users.
- **Form 16**: Generated for employee 6, FY 2026-27 — real, non-placeholder aggregated data:
  gross 88,461.54 across 3 payroll runs, TDS 938, monthly breakdown per period, standard
  deduction 75,000 applied correctly, taxable income computed correctly. (See Bugs section
  for a data-scope gap.)
- **Payslip PDF**: `GET /payroll-slips/68/pdf` returned a real 118KB PDF (HTTP 200), not a
  stub.
- **Alterations**: This is a tailoring-shop garment-alteration order tracker (customer drop-
  off → tailor assignment → status pipeline → delivery+payment), **not** an HR
  salary/structure change-request workflow as the term might suggest. Code review shows a
  clean state machine (`ALLOWED_TRANSITIONS`), optimistic locking on update, and correct
  balance-due computation on delivery. Not live-tested this session (out of the "payroll"
  critical path) but no defects spotted in review.
- **hr-service test suite**: `pnpm --filter @erp/hr-service test` → 59/77 passing. All 18
  failures are the known pre-existing JWT-issuer test-infra gap (test asserts 403/404/422/etc,
  actually gets 401) across `employee-documents.test.ts`, `attendance-import.test.ts`, and
  `permission-guards.test.ts` — confirmed every single failure is this exact
  `expected 401 to be <code>` pattern, no new regressions.

## Bugs / gaps found

### 1. HIGH — Employee loan can be force-closed with its full balance still outstanding, no validation, no accounting trail

`EmployeeLoanService.updateStatus` (`apps/hr-service/src/domain/EmployeeLoanService.ts:139-164`),
reached via `PATCH /employee-loans/:id`, validates the `CANCELLED` transition (blocks it once
any deduction has been applied) but has **no equivalent guard for `CLOSED`** — any loan can be
marked `CLOSED` regardless of `outstandingBalance`, silently and immediately:

- Payroll stops deducting the EMI (only `ACTIVE` loans are read by
  `EmployeeLoanService.getActiveLoansForEmployee`).
- No accounting event fires (`updateStatus` never touches the event bus), so account 1340
  "Employee Loans Receivable" stays permanently overstated by the forgiven amount — a silent,
  untracked write-off with no journal, no audit note explaining why.

**Live reproduction**: `PATCH /api/hr/employee-loans/11 {"status":"CLOSED"}` on a loan with
`principalAmount=12000`, `outstandingBalance=12000` (zero repaid) returned `200 OK` and set
`status=CLOSED` while `outstandingBalance` remained `12000.00`.

**Pre-existing corroboration**: this bug was already live in the tenant's data before this
session touched anything — loans 1, 4, 5, 6, 7, 8 (all employee 1) are `CLOSED` with
`outstanding_balance = 6000.00` each (unchanged from principal), from an earlier QA session
that presumably exercised the close/cancel endpoint without realizing the gap.

**Business impact**: an HR user (deliberately or by mistake) can wipe out any employee's
loan obligation with one API call, with zero financial control and zero record of it in the
books. This is a real money-handling integrity gap, not a cosmetic one.

**Fix direction**: mirror the `CANCELLED` guard — reject `CLOSED` unless
`outstandingBalance <= 0` (or add a distinct "WRITE_OFF" action that both validates
permission and posts a reversing journal).

### 2. HIGH — Leave balance is cron-only-seeded and was never seeded for this tenant; balance enforcement was silently bypassed for every leave application

`employee_leave_balance` had **zero rows for all 31 employees in tenant 2** before this audit
manually triggered the seeding endpoint. The only code path that ever creates a balance row
is the internal `POST /api/v2/leave-applications/accrue-monthly` endpoint
(`internal.routes.ts:49`), wired in scheduler-service as cron `0 0 1 * *` ("Monthly leave
credit accrual", `tenantScoped: false`) — i.e. it only runs if the scheduler-service happens
to be up at midnight on the 1st of the month. There is no bootstrap-on-tenant-creation,
bootstrap-on-employee-creation, or admin-triggerable "seed now" path.

Both `POST /leave-applications` (apply) and `POST /leave-applications/:id/approve` guard the
balance check with `if (balance) { ... }` — when no balance row exists, the check is
**silently skipped entirely** rather than treated as zero-available. Result: with balance
rows missing, employees can apply for and get approved for unlimited leave with zero cap
enforcement.

**Live reproduction**:

1. Confirmed `SELECT count(distinct employee_id) FROM employee_leave_balance WHERE
tenant_id=2` = 0 before any action this session.
2. Applied 2 days Casual Leave for employee 6 — succeeded (`201`), no balance check ran
   (there was nothing to check against).
3. Manually POSTed the internal accrual endpoint directly at hr-service (`:3021`) — it worked
   correctly and created 93 balance rows (proving the code itself is fine; the gap is purely
   operational/architectural). The new Casual Leave balance row for employee 6 was created
   with `totalDays=1.00`, `usedDays=0.00` — the already-`PENDING` 2-day application from step
   2 was never reflected in `pendingDays` (it predates the row).
4. Approved that leave application anyway — `usedDays` went to `2.00` against `totalDays
1.00` (200% over cap), accepted with no warning, no rejection. `LEAVE_APPROVE` performs no
   balance validation at all (by design — only `LEAVE_APPLY` checks, and only if a balance row
   already exists).

**Business impact**: for this entire test tenant's history (since inception), the "Insufficient
leave balance" business rule has never actually been enforced once. Any production tenant
that onboards mid-month, or whose scheduler-service has any downtime spanning midnight on the
1st (a routine deploy window), silently loses leave-balance enforcement for that whole
period with no error, no alert, and no admin-visible indicator that balances are unseeded.

**Fix direction**: treat a missing balance row as zero-available (reject, not skip) at
apply-time; and/or seed a balance row on employee creation / leave-type creation instead of
relying solely on a monthly cron; and/or add balance validation to the approve step as a
defense-in-depth backstop.

### 3. MEDIUM — Form 16 includes payroll slips from never-approved (DRAFT/CALCULATED) runs

`Form16Service.generateForm16Data` (`apps/hr-service/src/domain/Form16Service.ts:68-88`)
joins `payrollSlips` to `payrollRuns` filtered only by employee/tenant/FY date range — it does
**not** filter by `payrollRuns.status` or `payrollSlips.status`. Live-verified: employee 6's
FY2026-27 Form 16 included a row for period 8/2026 from run 3, which is still `CALCULATED`
(never approved, never disbursed, still editable/recalculable). In this instance the row
happened to be all-zero (no attendance recorded for that future period) so it had no visible
effect on the totals, but the code path is real: any tenant with a leftover unapproved/
abandoned draft payroll run containing non-zero figures would have those figures baked into
a legal tax certificate before the payroll was ever finalized. Should filter to
`payrollSlips.status IN ('APPROVED', 'PAID')` (or equivalently `payrollRuns.status IN
('APPROVED', 'DISBURSED')`).

### 4. Data-integrity observation (not a code bug) — orphaned journal reference

`journals` id 9/10 reference `PAYROLL_RUN` id `1`, but `payroll_runs` id 1 no longer exists in
the table for any tenant (sequence starts effectively at 2) — an artifact of an earlier data
reset that didn't cascade/clean the accounting side. Not a functional issue for new runs, but
worth noting: there is no FK constraint between `journals.reference_id` and the source
table, so a future data reset would silently leave orphaned references again with no
detectability at runtime (only surfaced by manual DB inspection, as done here).

## Untested / unknown areas

- **Live cross-tenant HTTP isolation probe**: not performed — the only second tenant
  available in this session's scratch history (tenant 93) had an expired JWT with no
  recoverable password. Isolation is instead backed by **code review**: every single HR route
  read this session (employees, payroll, leaves, alterations, loans, self-service) filters
  every query with `eq(X.tenantId, tenantId)` sourced from the JWT, with no exceptions
  spotted. This is strong static evidence but not equivalent to a live cross-tenant fetch
  attempt.
- **Alterations module**: reviewed via code only (state machine, locking, balance math look
  correct), not exercised live end-to-end this session.
- **Statutory reports** (PF/ESI challans, PT report, ESIChallanService/PFChallanService/
  PTReportService/PTSlabService): not exercised live this session — out of the explicit scope
  list but adjacent; flagged for a future pass.
- **Attendance biometric import / holiday calendar / shifts**: not exercised live.
- **Employee exit flow** (`POST /employees/:id/exit`): reviewed in code (transactional,
  publishes `EMPLOYEE_EXITED`), not exercised live this session.
- **Loan repayment via `loanDeductionHistory`**: confirmed the deduction _decrements the
  balance and publishes the accounting event_, but did not separately fetch
  `GET /employee-loans/:id` to inspect the `history` array's per-deduction rows.

## Readiness score: 72/100

**Justification**: The payroll engine's core math, the batch-skip fix, and — most
importantly given this session's specific mandate — the accounting integration are all
confirmed genuinely correct and live-verified, which is the single biggest risk this audit
was asked to rule in/out and it came back clean (unlike the sibling GRN/Purchase-Return/
Expense posting-matrix bug family). That alone would put this module in the 80s. It's pulled
down to 72 by two HIGH-severity findings that are financial-control gaps, not UI polish: a
loan can be silently written off with no validation and no ledger trail, and leave-balance
enforcement has — in practice, for this entire tenant's history — never actually applied,
because its only trigger is an unmonitored monthly cron with no bootstrap or backstop. Both
are the kind of gap that looks fine in a demo (nothing visibly errors) and only surfaces as a
real incident once real money or real HR policy is on the line.

## Test data created this session (tenant 2)

- Employee id **32** ("Audit TestEmployee") — full profile incl. PAN/bank/UAN/ESI.
- Salary structure id **1** ("Audit Test Structure") + salary assignment id 28 for employee 32.
- Payroll run id **4** (period 6/2026): calculated (27 processed / 4 skipped), approved,
  disbursed. Attendance marked for employee 6, 2026-06-01 through 06-20 (20 PRESENT days,
  ids 44-63).
- Leave application id **8** (employee 6, Casual Leave, 2026-08-10/11) — applied and approved.
- Leave balance rows for all 31 employees, year 2026 (93 rows), created by manually
  triggering the accrual endpoint (this is a real seeding action with tenant-wide effect —
  not a throwaway test row; leaving it in place is correct/desired going forward).
- Employee loan id **11** (employee 32, ₹12,000 GENERAL, 6-month tenure) — disbursed then
  force-closed (deliberately, to reproduce Finding #1).
- Accounting journals 163-166 (tenant 2) from the above payroll/loan actions — all real,
  correctly posted, not cleaned up (matches existing pattern of QA data left in this shared
  dev tenant).
