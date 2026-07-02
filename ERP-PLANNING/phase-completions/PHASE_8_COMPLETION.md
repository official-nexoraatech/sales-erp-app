# PHASE 8 — HR, PAYROLL, AND ALTERATION WORKFLOW — COMPLETION REPORT
## Generated: 2026-06-30 | Status: COMPLETE

> **This document is the official handoff artifact for Phase 8.**
> **The next phase MUST start by reading this document.**
> **Never modify this document after generation.**

---

## 1. PHASE SUMMARY

| Field | Value |
|---|---|
| Phase Number | 8 |
| Phase Name | HR, Payroll, and Alteration Workflow |
| Start Date | 2026-06-30 |
| End Date | 2026-06-30 |
| Status | COMPLETE |
| Engineer(s) | Claude Sonnet 4.6 |
| Claude Session | ERP-1 branch, single session |

---

## 2. WHAT WAS BUILT

### 2.1 Database Schema

```sql
-- Tables created (packages/db-client/src/schema/hr.ts, migration 0004_phase8_hr.sql):
-- departments (11 columns) — name, code, managerId, soft-delete, audit
-- designations (10 columns) — name, code, soft-delete, audit
-- employees (35 columns) — employeeCode, displayName, phone, gender, dateOfBirth,
--     aadhaarLast4(4 chars only), panEncrypted+panHash, bankAccountNoEncrypted+bankAccountNoHash,
--     employmentType ENUM(FULL_TIME|PART_TIME|CONTRACT|DAILY_WAGE|TRAINEE|TAILOR),
--     departmentId, designationId, branchId, managerId, shiftId, joiningDate, exitDate,
--     exitReason, status, soft-delete, optimistic-lock (version)
-- shifts (12 columns) — startTime, endTime, gracePeriodMinutes, halfDayHours, standardHours
-- attendance (18 columns) — employeeId, attendanceDate, checkInTime, checkOutTime,
--     source ENUM(MANUAL|BIOMETRIC|MOBILE_APP), status ENUM(PRESENT|ABSENT|HALF_DAY|LATE|
--     LEAVE|HOLIDAY|WEEKLY_OFF), workHours, overtimeHours, correctionReason+correctedBy (audited)
-- leave_types (16 columns) — daysPerYear, canCarryForward, maxCarryForwardDays,
--     isGenderSpecific+genderAllowed, requiresDocument+documentRequiredAfterDays, expiryDays
-- employee_leave_balance (9 columns) — totalDays, usedDays, pendingDays, carriedForwardDays
-- leave_applications (18 columns) — startDate, endDate, days, status ENUM(PENDING|APPROVED|
--     REJECTED|CANCELLED), approvedBy/rejectedBy/cancelledBy with timestamps
-- salary_structures (9 columns) — basicPercent, hraPercent, daPercent, allowances(JSONB)
-- employee_salaries (13 columns) — ALL ENCRYPTED: ctcEncrypted, basicEncrypted, hraEncrypted,
--     daEncrypted, allowancesEncrypted, grossEncrypted (AES-256-GCM)
-- payroll_runs (17 columns) — periodMonth, periodYear, status ENUM(DRAFT|CALCULATING|
--     CALCULATED|APPROVED|DISBURSED), totalGross, totalDeductions, totalNet, journal IDs
-- payroll_slips (25 columns) — presentDays, paidLeaveDays, lopDays, basicSalary, hraAmount,
--     daAmount, pieceRateAmount, grossSalary, pfEmployee/pfEmployer, esiEmployee/esiEmployer,
--     professionalTax, loanDeduction, tdsDeduction, totalDeductions, netSalary
-- alteration_orders (24 columns) — orderNumber, customerName/Phone, receivedDate, promisedDate,
--     items(JSONB), totalAmount, advanceAmount, balanceDue, assignedToId,
--     status ENUM(RECEIVED|ASSIGNED|IN_PROGRESS|QUALITY_CHECK|READY|DELIVERED|CANCELLED)
-- alteration_tasks (9 columns) — alterationOrderId, taskDescription, tailorId, status
-- tailor_work_log (11 columns) — employeeId, alterationOrderId, workDate, units, ratePerUnit, amount

-- Indexes: 30+ indexes across all 15 tables (tenant+status, employee+date, unique constraints)
-- Migration applied and verified against local PostgreSQL — all 15 tables confirmed present
```

### 2.2 APIs Implemented

| Method | Path | Permission | Status |
|---|---|---|---|
| GET/POST | /api/v2/departments | EMPLOYEE_VIEW / EMPLOYEE_CREATE | ✅ Done |
| PUT/DELETE | /api/v2/departments/:id | EMPLOYEE_UPDATE / EMPLOYEE_DELETE | ✅ Done |
| GET/POST | /api/v2/designations | EMPLOYEE_VIEW / EMPLOYEE_CREATE | ✅ Done |
| PUT/DELETE | /api/v2/designations/:id | EMPLOYEE_UPDATE / EMPLOYEE_DELETE | ✅ Done |
| GET/POST | /api/v2/employees | EMPLOYEE_VIEW / EMPLOYEE_CREATE | ✅ Done |
| GET/PUT | /api/v2/employees/:id | EMPLOYEE_VIEW / EMPLOYEE_UPDATE | ✅ Done |
| POST | /api/v2/employees/:id/photo/upload | EMPLOYEE_UPDATE | ✅ Done (stub URL) |
| POST | /api/v2/employees/:id/documents/upload | EMPLOYEE_UPDATE | ✅ Done (stub URL) |
| POST | /api/v2/employees/:id/exit | EMPLOYEE_UPDATE | ✅ Done |
| POST | /api/v2/employees/import | EMPLOYEE_IMPORT | ✅ Done (202 queued stub) |
| GET/POST | /api/v2/shifts | ATTENDANCE_VIEW / ATTENDANCE_MARK | ✅ Done |
| POST | /api/v2/attendance/mark | ATTENDANCE_MARK | ✅ Done |
| POST | /api/v2/attendance/bulk-mark | ATTENDANCE_MARK | ✅ Done |
| GET | /api/v2/attendance/:employeeId | ATTENDANCE_VIEW | ✅ Done |
| PUT | /api/v2/attendance/:id/correct | ATTENDANCE_CORRECT | ✅ Done |
| POST | /api/v2/attendance/import | ATTENDANCE_MARK | ✅ Done (202 queued stub) |
| GET | /api/v2/attendance/report | ATTENDANCE_REPORT | ✅ Done |
| GET | /api/v2/attendance/team-summary | ATTENDANCE_REPORT | ✅ Done |
| GET/POST | /api/v2/leave-types(+/seed) | LEAVE_VIEW / LEAVE_APPROVE | ✅ Done |
| GET | /api/v2/employees/:id/leave-balance | LEAVE_VIEW | ✅ Done |
| GET/POST | /api/v2/leave-applications | LEAVE_VIEW / LEAVE_APPLY | ✅ Done |
| POST | /api/v2/leave-applications/:id/approve | LEAVE_APPROVE | ✅ Done |
| POST | /api/v2/leave-applications/:id/reject | LEAVE_REJECT | ✅ Done |
| POST | /api/v2/leave-applications/:id/cancel | LEAVE_APPLY | ✅ Done |
| GET | /api/v2/approvals/leaves/pending | LEAVE_APPROVE | ✅ Done |
| GET/POST | /api/v2/salary-structures | PAYROLL_VIEW / PAYROLL_PROCESS | ✅ Done |
| POST | /api/v2/employee-salaries | PAYROLL_PROCESS | ✅ Done (encrypted) |
| GET/POST | /api/v2/payroll-runs | PAYROLL_VIEW / PAYROLL_PROCESS | ✅ Done |
| GET | /api/v2/payroll-runs/:id | PAYROLL_VIEW | ✅ Done |
| POST | /api/v2/payroll-runs/:id/calculate | PAYROLL_PROCESS | ✅ Done |
| POST | /api/v2/payroll-runs/:id/approve | PAYROLL_APPROVE | ✅ Done |
| POST | /api/v2/payroll-runs/:id/disburse | PAYROLL_APPROVE | ✅ Done |
| GET | /api/v2/payroll-slips/:id/pdf | SALARY_SLIP_PRINT | ✅ Done (data-ready stub; PDF render deferred to report-service) |
| POST | /api/v2/payroll-runs/:id/bulk-send | PAYROLL_APPROVE | ✅ Done |
| GET/POST | /api/v2/alterations | ALTERATION_VIEW / ALTERATION_CREATE | ✅ Done |
| GET/PUT | /api/v2/alterations/:id | ALTERATION_VIEW / ALTERATION_UPDATE | ✅ Done |
| POST | /api/v2/alterations/:id/assign | ALTERATION_UPDATE | ✅ Done |
| POST | /api/v2/alterations/:id/status | ALTERATION_UPDATE | ✅ Done |
| POST | /api/v2/alterations/:id/deliver | ALTERATION_UPDATE | ✅ Done |
| GET | /api/v2/alterations/tailor/:id | ALTERATION_VIEW | ✅ Done |
| GET | /api/v2/alterations/overdue | ALTERATION_VIEW | ✅ Done |
| POST | /api/v2/tailor-work-log | ALTERATION_UPDATE | ✅ Done (feature-flagged) |
| GET | /api/v2/tailor-work-log | ALTERATION_VIEW | ✅ Done |
| GET | /api/v2/tailor-work-log/summary | ALTERATION_VIEW | ✅ Done |
| POST | /api/v2/attendance/biometric-auto-import (internal) | x-internal-key | ✅ Done |
| POST | /api/v2/leave-applications/accrue-monthly (internal) | x-internal-key | ✅ Done |
| POST | /api/v2/leave-applications/year-end-carry-forward (internal) | x-internal-key | ✅ Done |
| GET | /api/v2/alterations/promised-today-alert (internal) | x-internal-key | ✅ Done |
| GET | /api/v2/alterations/overdue-alert (internal) | x-internal-key | ✅ Done |

All routes registered with `authenticate` + `requirePermission` preHandlers (except internal-only scheduler endpoints, which use `x-internal-key` header matching `INTERNAL_API_KEY`, consistent with `sales-service`/`inventory-service` internal route pattern from earlier phases).

### 2.3 Services Implemented

```
PayrollEngine (apps/hr-service/src/domain/PayrollEngine.ts)
  computeSlip()  — pro-rates basic/HRA/DA by (present+paidLeave)/workingDays,
                   computes LOP days, aggregates tailor piece-rate, computes PF (12%/12%,
                   capped at ₹15,000 basic), ESI (0.75%/3.25% if gross ≤ ₹21,000),
                   Professional Tax (Maharashtra slabs), net = gross - all deductions
  upsertSlip()   — idempotent insert/update of payroll_slips per (run, employee)

PayrollAccountingConsumer (apps/accounting-service/src/consumers/PayrollAccountingConsumer.ts)
  handlePayrollRunApproved()   — DR Salaries and Wages (6010) / CR Salary Payable (2310)
  handlePayrollRunDisbursed()  — DR Salary Payable (2310) / CR Cash in Hand (1010)
```

### 2.4 Frontend Screens

| Screen | Route | Permission | Status |
|---|---|---|---|
| Employee List (search, dept, type filters) | /hr/employees | EMPLOYEE_VIEW | ✅ Done |
| Employee Create/Edit (tabbed: Basic/Employment/Bank & Tax) | /hr/employees/new, /hr/employees/:id/edit | EMPLOYEE_CREATE / EMPLOYEE_UPDATE | ✅ Done |
| Employee View (profile, salary gate, leave balance) | /hr/employees/:id | EMPLOYEE_VIEW | ✅ Done |
| Department/Designation management (modal) | embedded in Employees list | EMPLOYEE_CREATE | ✅ Done |
| Attendance (mark / calendar / team summary tabs) | /hr/attendance | ATTENDANCE_VIEW | ✅ Done |
| Leave (apply form + pending approvals) | /hr/leaves | LEAVE_VIEW | ✅ Done |
| Payroll (runs list, create/calculate/approve/disburse, salary assignment) | /hr/payroll | PAYROLL_VIEW | ✅ Done |
| Alteration Orders List (status filter, overdue badge) | /hr/alterations | ALTERATION_VIEW | ✅ Done |
| Alteration Counter Screen (receive order) | /hr/alterations/new | ALTERATION_CREATE | ✅ Done |
| Alteration Detail (assign tailor, status transitions, delivery payment) | /hr/alterations/:id | ALTERATION_VIEW | ✅ Done |

All pages wired into `App.tsx` (lazy-loaded + `PermissionRoute`-gated) and a new "HR & PAYROLL" sidebar group added to `Layout.tsx`.

### 2.5 Events Published

| Event | Topic | Publisher | Consumers |
|---|---|---|---|
| EMPLOYEE_JOINED | erp.employee.joined | employee.routes | (none yet — search-service Phase 9) |
| EMPLOYEE_EXITED | erp.employee.exited | employee.routes | (none yet) |
| LEAVE_APPLIED | erp.leave.applied | leave.routes | (none yet) |
| LEAVE_APPROVED | erp.leave.approved | leave.routes | (none yet) |
| LEAVE_REJECTED | erp.leave.rejected | leave.routes | (none yet) |
| LEAVE_CANCELLED | erp.leave.cancelled | leave.routes | (none yet) |
| PAYROLL_RUN_APPROVED | erp.payroll.run.approved | payroll.routes | accounting-service (PayrollAccountingConsumer) |
| PAYROLL_RUN_DISBURSED | erp.payroll.run.disbursed | payroll.routes | accounting-service (PayrollAccountingConsumer) |
| SALARY_SLIP_READY | erp.salary.slip.ready | payroll.routes | (none yet — notification dispatch is direct REST call, not event-driven) |
| ALTERATION_RECEIVED | erp.alteration.received | alteration.routes | (none yet) |
| ALTERATION_ASSIGNED | erp.alteration.assigned | alteration.routes | (none yet — in-app notification sent via direct REST call) |
| ALTERATION_STATUS_CHANGED | erp.alteration.status.changed | alteration.routes | (none yet) |
| ALTERATION_READY | erp.alteration.ready | alteration.routes | (none yet — WhatsApp sent via direct REST call, see §2.6) |
| ALTERATION_DELIVERED | erp.alteration.delivered | alteration.routes | (none yet) |

All events written to `outbox_events` in the same DB transaction as the business mutation (verified via live test — see §6.2).

### 2.6 Events Consumed

| Event | Topic | Consumer | Action |
|---|---|---|---|
| PAYROLL_RUN_APPROVED | erp.payroll.run.approved | accounting-service | Post DR Salaries Expense / CR Salary Payable journal |
| PAYROLL_RUN_DISBURSED | erp.payroll.run.disbursed | accounting-service | Post DR Salary Payable / CR Bank journal |

**Note on WhatsApp/notification delivery:** `notification-service` does not yet run a Kafka consumer (confirmed — no consumer wiring exists in that service as of Phase 7). Rather than build on a non-existent Kafka pipeline, `hr-service` calls `notification-service` directly via a new internal REST endpoint (`POST /api/v2/notifications/send-internal`, gated by `x-internal-key` since `notification-service`'s existing routes assume `request.auth` is already populated by an upstream gateway that does not yet exist). This is the same "call service directly" pattern already used for internal jobs in `scheduler-service`. A companion `POST /api/v2/notifications/templates/seed-hr` endpoint seeds the `ALTERATION_READY` (WHATSAPP) and `ALTERATION_ASSIGNED` (IN_APP) templates per tenant — **must be run once per tenant** before notifications will actually send (the notification engine silently skips channels with no matching template row).

### 2.7 Background Jobs

| Job Name | Cron | What It Does | Status |
|---|---|---|---|
| hr.attendance.biometric-auto-import | `59 23 * * *` | Nightly biometric machine auto-import trigger | ✅ Done (calls hr-service; biometric machine integration itself is a stub returning `imported: 0` — no biometric hardware/CSV source is configured yet) |
| hr.leave.accrual | `0 0 1 * *` | Monthly leave credit accrual for all eligible employees, all tenants | ✅ Done |
| hr.leave.year-end-carry-forward | `59 23 31 12 *` | Dec 31 — carries forward eligible leave balances into next year, flags non-carry-forward as expired | ✅ Done |
| hr.payroll.prepare | `0 1 25 * *` | Log-only placeholder (pre-existing stub from earlier planning, unchanged) | ⚠️ Stub (log only) |
| hr.salary-slip.email | `0 9 28 * *` | Log-only placeholder (pre-existing stub from earlier planning, unchanged) | ⚠️ Stub (log only) |
| hr.alteration.promised-today-alert | `0 8 * * *` | Daily 08:00 — finds alterations promised today, fetches via internal endpoint (tailor push notification dispatch deferred — no employee→user account mapping exists in schema to resolve a tailor's login user) | ✅ Done (fetch + log; push delivery deferred — see §7) |
| hr.alteration.overdue-alert | `0 8:30 * * *` (30 8 * * *) | Daily 08:30 — finds overdue alterations, fetches via internal endpoint | ✅ Done (fetch + log; manager push delivery deferred — see §7) |

`hr.payroll.prepare` and `hr.salary-slip.email` were pre-existing stub registrations in `scheduler-service` (added in earlier planning before Phase 8 was implemented) and were left as log-only placeholders since the spec's salary-slip-email flow is already covered by the on-demand `POST /payroll-runs/:id/bulk-send` API action.

### 2.8 Sagas Implemented

| Saga | Steps | Compensations | Status |
|---|---|---|---|
| PAYROLL_PROCESSING | Implemented as discrete API-driven state transitions (DRAFT→CALCULATING→CALCULATED→APPROVED→DISBURSED) rather than a formal `WorkflowEngine` saga object | Re-running `/calculate` is idempotent (upsert per employee); no automatic compensation for `/approve`→`/disburse` since both post real accounting journals (irreversible by design, matching the spec's Step 5 "IRREVERSIBLE") | ✅ Functionally complete — see §13 for the architecture decision not to use the formal saga framework |

---

## 3. FOLDER STRUCTURE (ACTUAL)

```
packages/db-client/src/schema/
└── hr.ts                          — 15 tables, all Drizzle exports + types

packages/db-client/migrations/
└── 0004_phase8_hr.sql             — hand-written SQL (matches 0002/0003 pattern; drizzle-kit
                                      generate was not used because the schema snapshot journal
                                      was already 2 phases stale — see §13)

apps/hr-service/src/
├── domain/
│   ├── PayrollEngine.ts           — pro-ration, PF/ESI/PT computation, slip upsert
│   └── leave-type-seed.ts         — 6 default leave types per spec
├── middleware/
│   ├── authenticate.ts            — RS256 JWT verify (copied pattern from accounting-service)
│   └── authorize.ts               — requirePermission()
├── api/
│   ├── employee.routes.ts         — departments, designations, employees (M8.1)
│   ├── attendance.routes.ts       — shifts, mark/bulk-mark/correct/report (M8.2)
│   ├── leave.routes.ts            — leave-types, balance, apply/approve/reject/cancel (M8.3)
│   ├── payroll.routes.ts          — salary-structures, employee-salaries, payroll-runs (M8.4)
│   ├── alteration.routes.ts       — alteration CRUD + status machine + notifications (M8.5)
│   ├── tailor-work-log.routes.ts  — piece-rate logging (M8.6)
│   └── internal.routes.ts         — scheduler-triggered cross-tenant batch endpoints
└── main.ts                        — Fastify bootstrap, port 3021

apps/accounting-service/src/consumers/
└── PayrollAccountingConsumer.ts   — PAYROLL_RUN_APPROVED / PAYROLL_RUN_DISBURSED handlers

apps/web-frontend/src/pages/hr/
├── EmployeesPage.tsx
├── EmployeeFormPage.tsx
├── EmployeeViewPage.tsx
├── AttendancePage.tsx
├── LeavesPage.tsx
├── PayrollPage.tsx
├── AlterationsPage.tsx
├── AlterationFormPage.tsx
└── AlterationDetailPage.tsx
```

---

## 4. PUBLIC INTERFACES (CONSUMED BY OTHER PHASES)

### 4.1 API Contracts (external)
```typescript
// GET /api/v2/employees/:id (hr-service, port 3021)
// Response includes hasSalaryData: boolean — true only if caller has PAYROLL_VIEW permission
// panEncrypted/bankAccountNoEncrypted are NEVER returned in any response

// POST /api/v2/payroll-runs/:id/approve
// Publishes PAYROLL_RUN_APPROVED → consumed by accounting-service
// Publishes PAYROLL_RUN_DISBURSED on /disburse → consumed by accounting-service
```

### 4.2 Events (external contracts)
```typescript
interface PayrollRunApprovedPayload {
  payrollRunId: number;
  periodMonth: number;
  periodYear: number;
  totalGross: string | number;
  totalDeductions: string | number;
  totalNet: string | number;
}
// Schema Version: 1
// Consumers: accounting-service

interface PayrollRunDisbursedPayload {
  payrollRunId: number;
  totalNet: string | number;
}
// Schema Version: 1
// Consumers: accounting-service
```

### 4.3 Shared Types Added
- `packages/shared-types/src/permissions.ts` already contained all 21 HR permission constants from earlier planning (EMPLOYEE_*, ATTENDANCE_*, LEAVE_*, PAYROLL_*, SALARY_*, ALTERATION_*) — no new backend permission constants were needed.
- `apps/web-frontend/src/constants/permissions.ts` — added the same 21 constants (previously missing from the frontend mirror).

---

## 5. INTEGRATION POINTS (WHAT THE NEXT PHASE MUST KNOW)

### 5.1 What this phase provides to downstream phases
- `employees` table with `branchId` FK — ready for any future scheduling/POS-staff-assignment feature.
- `payroll_runs.salaryJournalId` / `disbursalJournalId` columns exist in schema but are **not yet populated** by `PayrollAccountingConsumer` (the consumer posts the journal but does not write the resulting `journalId` back onto the `payroll_runs` row — see §7 known issue).
- Tailor work log (`tailor_work_log`) feeds directly into `PayrollEngine.computeSlip()` via `pieceRateAmount` — verified end-to-end is NOT yet tested with actual tailor work log entries (only the present/LOP path was live-tested; see §6.2).

### 5.2 What this phase needs from upstream phases (already resolved)
- `accounts` table + `JournalEngine`/`PostingMatrixService` from Phase 6 — used unmodified, only added 2 new `DEFAULT_POSTING_RULES` entries (`PAYROLL_RUN_APPROVED` → 6010/2310, `PAYROLL_RUN_DISBURSED` → 2310/1010).
- `branches` table from Phase 2 — `employees.branchId` and `alteration_orders.branchId` are plain FKs (not enforced at DB level, consistent with the rest of the codebase's FK-less convention).
- `FIELD_ENCRYPTION_KEY` env var from Phase 0/3 — reused for PAN, bank account, and all salary figures.

### 5.3 What the NEXT phase must integrate with
- **search-service (Phase 9):** Should consume `EMPLOYEE_JOINED`/`EMPLOYEE_EXITED` for an employee directory search index, matching the pattern already used for customers/items.
- **notification-service:** Should eventually move from the direct-REST-call pattern (`send-internal`) to a proper Kafka consumer once the notification-service Kafka pipeline is built — at that point `ALTERATION_READY`/`ALTERATION_ASSIGNED` event publishing (already wired in outbox) can be consumed instead of the direct HTTP call.
- **Employee↔User account linkage:** No phase has yet added a `userId` FK on `employees`. This blocks true push notifications to a specific tailor's logged-in session (see §7) — a future phase should decide whether to add this FK or keep HR and Auth identities separate by design.

---

## 6. TESTS

### 6.1 Test Coverage
| Suite | Coverage | Status |
|---|---|---|
| Automated unit/integration tests | None written | ⚠️ Not done — see §12 |
| Manual live smoke test (real Postgres + Redis + Kafka infra, real JWT login) | All 6 milestones' happy paths | ✅ Pass |

### 6.2 Critical Tests Passing (verified live against running services)
- [x] Employee create: `pan`/`bankAccountNo` returned only as `panHash`/`bankAccountNoHash` (HMAC), never plaintext or `*Encrypted` fields; `aadhaarLast4` stores only 4 digits
- [x] Department/designation create + list
- [x] Attendance mark (upsert on `tenant_id, employee_id, attendance_date`)
- [x] Leave types seed (6 rows: CL, SL, EL, ML, PL, CO)
- [x] Alteration order create → auto-generates `ALT-0001` order number, computes `balanceDue = total - advance`
- [x] Alteration assign → status transitions `RECEIVED → ASSIGNED`
- [x] Employee salary set (encrypted, only id/employeeId/effectiveFrom returned)
- [x] Payroll run create → calculate → **verified LOP formula**: 1 present day / 26 working days → `lopDays: 25.0`, `basicSalary: 576.92` (= 15000 × 1/26), `pfEmployee: 69.23` (12% of pro-rated basic), `esiEmployee: 7.21` / `esiEmployer: 31.25` (gross 961.54 ≤ 21000 threshold), `netSalary: 885.10` = `grossSalary(961.54) − totalDeductions(76.44)` exactly
- [x] Payroll approve → `PAYROLL_RUN_APPROVED` event written to `outbox_events` in same transaction
- [x] 401 returned for missing Authorization header (`GET /employees` with no token)
- [x] 422 returned for invalid body (empty `customerName`) — confirms codebase convention `ValidationError` → 422, not 400 (see CODING_STANDARDS.md `errors.ts`; this matches every other phase's actual behavior, not the verification checklist's literal "400" wording)
- [x] `audit_log` rows written for every CREATE/UPDATE action tested (7 rows confirmed via direct DB query)
- [x] `outbox_events` rows written for EMPLOYEE_JOINED, ALTERATION_RECEIVED, ALTERATION_ASSIGNED, PAYROLL_RUN_APPROVED (4 rows confirmed via direct DB query)
- [x] TypeScript strict mode: zero errors across `hr-service`, `accounting-service`, `scheduler-service`, `notification-service`, `web-frontend`, `@erp/db`
- [x] ESLint: zero **new** errors introduced (pre-existing repo-wide `no-undef` gaps for `process`/`crypto`/`fetch`/`URL`/`Blob`/`document` globals — present in every prior phase's services identically — were not introduced by this phase and are out of scope to fix here)

### 6.3 Not tested live (no test harness / time-boxed)
- [ ] Concurrent payroll calculation race (re-running `/calculate` twice concurrently)
- [ ] Leave approval → attendance LEAVE records created (code path verified by code review, not live HTTP test)
- [ ] Year-end carry-forward / monthly accrual internal jobs (code path verified by code review, not live HTTP test — requires waiting for cron or manual `x-internal-key` call)
- [ ] WhatsApp delivery on alteration READY (requires `POST /notifications/templates/seed-hr` to be run once, plus `WHATSAPP_ACCESS_TOKEN`/`WHATSAPP_PHONE_NUMBER_ID` configured — not configured in this dev environment)
- [ ] Biometric CSV import (`/attendance/import` is a 202-stub; spec's "30-day biometric CSV for 20 employees in < 30 seconds" acceptance criterion has no real CSV parser yet — see §12)

---

## 7. KNOWN ISSUES AND TECHNICAL DEBT

| Issue | Severity | Resolution Plan |
|---|---|---|
| `payroll_runs.salaryJournalId`/`disbursalJournalId` not written back from accounting-service's consumer | Low | Add a callback or have `PayrollAccountingConsumer` update `payroll_runs` directly (cross-service write — needs a decision on whether accounting-service should write into hr-service's tables) — Phase 9+ |
| `/attendance/biometric-auto-import` and `/attendance/import` are stubs — no real biometric CSV parser | Medium | Spec's acceptance criterion "30-day biometric CSV for 20 employees processes in < 30 seconds" is **not yet verifiable** — needs a CSV format spec + ImportEngine integration (scheduler-service already has `ImportEngine.ts` from Phase 3/5 that could be reused) — next HR-adjacent phase |
| Tailor push notification (`ALTERATION_ASSIGNED`) and tailor/manager daily alerts have no employee→user-account FK to resolve a specific recipient | Medium | `employees` table has no `userId` column; `sendNotification()` in `alteration.routes.ts` sends without `recipientUserId`, so the in-app notification is created but not targeted to a specific bell icon. Needs an architecture decision: add `employees.userId` FK, or keep HR/Auth identities separate and resolve via phone/email matching instead | Next phase |
| `notification-service` has no JWT auth middleware at all (pre-existing gap from an earlier phase, not introduced here) | Medium (pre-existing) | A minimal additive `send-internal` endpoint (internal-key gated) was added to unblock Phase 8's WhatsApp requirement without touching the broken public routes. The proper fix (wire `authenticate` middleware into `notification-service`) is out of scope for HR but should be picked up by whichever phase owns notification-service hardening |
| `hr.payroll.prepare` / `hr.salary-slip.email` scheduler jobs remain log-only stubs | Low | The on-demand `POST /payroll-runs/:id/bulk-send` API covers the salary-slip-email use case; the 25th-of-month auto-prepare job was judged non-critical for Phase 8 since `/payroll-runs` can be created and calculated on demand | Future polish |
| No automated test suite (unit or integration) for hr-service | Medium | All verification was live manual smoke testing against real infra (see §6.2). `apps/hr-service` has `vitest` configured (`test: vitest run --passWithNoTests`) but zero test files exist, matching the project-wide pattern where most services also lack tests (per TECH_AUDIT.md, only 4 services have integration tests) | Phase 5/test-harness follow-up, same as other services |
| Professional Tax slabs hardcoded to Maharashtra | Low | `PayrollEngine`'s `PT_SLABS` constant is not state-configurable per tenant/branch; spec did not require multi-state PT in Phase 8 | Future enhancement |
| `purchase.ts` and now `hr.ts` are both absent from `packages/db-client/drizzle-schema.ts` (the drizzle-kit entry point) — `drizzle-kit generate` would not pick up either schema | Low (documented design choice) | Migrations for both phases were hand-written instead, matching the Phase 6/7 precedent (`0002`, `0003` were also hand-written, not drizzle-kit-generated) — see §13 |

---

## 8. FEATURE FLAGS USED

| Flag | Default | Who Controls |
|---|---|---|
| `hr.tailoring.enabled` | Must be explicitly seeded `true` per tenant (no flag row = disabled, per `PlatformFeatureFlags` safe-default behavior) | Admin per tenant — seed via `INSERT INTO feature_flags (tenant_id, flag_key, enabled) VALUES (NULL, 'hr.tailoring.enabled', true)` or a one-time call to the (new) `POST /api/v2/seed-feature-flags` internal endpoint in hr-service |

---

## 9. PERMISSIONS ADDED

No new backend permission constants were needed — all 21 were already present in `packages/shared-types/src/permissions.ts` from earlier planning:

```typescript
EMPLOYEE_VIEW, EMPLOYEE_CREATE, EMPLOYEE_UPDATE, EMPLOYEE_DELETE, EMPLOYEE_IMPORT,
ATTENDANCE_VIEW, ATTENDANCE_MARK, ATTENDANCE_CORRECT, ATTENDANCE_REPORT,
LEAVE_VIEW, LEAVE_APPLY, LEAVE_APPROVE, LEAVE_REJECT,
PAYROLL_VIEW, PAYROLL_PROCESS, PAYROLL_APPROVE,
SALARY_VIEW, SALARY_SLIP_PRINT,
ALTERATION_VIEW, ALTERATION_CREATE, ALTERATION_UPDATE
```

These same 21 constants were added to `apps/web-frontend/src/constants/permissions.ts` (previously missing from the frontend mirror, which would have made every HR page's `PermissionRoute` guard reject all users).

---

## 10. ENVIRONMENT VARIABLES ADDED

```
HR_SERVICE_PORT=3021
HR_SERVICE_URL=http://localhost:3021       # scheduler-service → hr-service internal calls
VITE_HR_URL=http://localhost:3021          # web-frontend → hr-service
```

Added to `.env`, `.env.example`. Reuses existing `FIELD_ENCRYPTION_KEY` and `INTERNAL_API_KEY` — no new secrets required.

---

## 11. DEPLOYMENT NOTES

```
New service started (previously stub): hr-service, port 3021
New DB migration: packages/db-client/migrations/0004_phase8_hr.sql (15 tables, hand-written SQL)
Migration applied and verified locally: YES (all 15 tables confirmed via \dt against erp-postgres-primary)
Migration is backward-compatible: YES (all new tables, no changes to existing tables)
Zero-downtime deploy: YES

Post-deploy seeding (one-time, per tenant):
  POST http://localhost:3021/api/v2/leave-types/seed         — seed 6 default leave types
  POST http://localhost:3014/api/v2/notifications/templates/seed-hr  — seed WhatsApp/in-app templates
  INSERT feature_flags row for 'hr.tailoring.enabled' (or call /seed-feature-flags) if tailoring piece-rate is used

Services that need restart to pick up new outbox event types:
  accounting-service (added PAYROLL_RUN_APPROVED/PAYROLL_RUN_DISBURSED Kafka topics + consumer)
  scheduler-service (added 4 new cron jobs, modified 2 existing HR job stubs)
  notification-service (added send-internal + seed-hr-templates routes)
```

---

## 12. WHAT IS NOT DONE (REMAINING TODO)

| Item | Why Deferred | Target Phase |
|---|---|---|
| Real biometric CSV import parser | No biometric machine CSV format was specified; `ImportEngine` from scheduler-service could be extended | HR follow-up / Phase 9 |
| Employee photo/document actual S3 upload (currently returns a stub URL string, no MinIO pre-signed URL wiring) | Time-boxed; other phases (e.g. organization logo upload) already have the MinIO pattern that can be copied | HR follow-up |
| Employee CSV bulk import (`POST /employees/import` is a 202-stub) | Same as biometric import — needs `ImportEngine` integration | HR follow-up |
| Salary slip PDF generation (`GET /payroll-slips/:id/pdf` returns JSON data, not an actual PDF) | report-service's Puppeteer/Handlebars pipeline (Phase established) was not wired for a payslip template in this session | HR follow-up |
| `employees.userId` FK for true per-user push notifications | Architecture decision needed (see §7) | Next phase |
| Automated unit/integration test suite for hr-service | Time-boxed in favor of live manual verification against real infra | Test-harness phase |
| Loan deduction and TDS-on-salary computation (`loanDeduction`/`tdsDeduction` always compute to 0) | Spec listed "Apply loan deductions" but no `loan` schema/table was defined in the spec's milestone list; left as a documented zero placeholder in `PayrollSlipResult` | Future enhancement |

---

## 13. ARCHITECTURE DECISIONS MADE IN THIS PHASE

| Decision | Why | Alternatives Considered |
|---|---|---|
| Hand-wrote `0004_phase8_hr.sql` instead of running `drizzle-kit generate` | The migration journal (`migrations/meta/_journal.json`) only has entries for `0000`/`0001` — Phase 6's and Phase 7's migrations (`0002`, `0003`) were also hand-written and never recorded in the journal, and `drizzle-schema.ts` (the drizzle-kit entry point) is missing both `purchase.ts` and now `hr.ts`. Running `generate` would have produced a messy diff trying to retroactively capture 3 phases of schema drift at once | Fixing `drizzle-schema.ts` to include everything and regenerating — rejected as out-of-scope and risky for a single phase to attempt to reconcile 3 phases of migration debt |
| HR → Notification: direct REST call (`send-internal`) instead of Kafka event consumer | `notification-service` has zero Kafka consumer wiring as of Phase 7 (confirmed by code inspection — only `accounting-service` and a few others have `PlatformEventConsumer.subscribe()` calls). Building a notification Kafka consumer was out of scope for an HR-domain phase | Building the notification consumer as part of Phase 8 — rejected as scope creep into another domain's service |
| PayrollEngine implemented as a static-method class colocated in hr-service rather than a `WorkflowEngine` saga | The spec describes a 6-step saga, but `WorkflowEngine` (from `@erp/sdk`) is designed around pre-registered system workflow *definitions* with approval steps, not arbitrary multi-service compensating transactions. The actual payroll flow is naturally expressed as explicit Fastify route handlers per status transition (`/calculate`, `/approve`, `/disburse`), each idempotent and independently retryable, which is simpler and matches how Phase 6's `FinancialYearService.closeYear()` (also a multi-step irreversible flow) was implemented — as a plain service class, not a formal saga object | Registering a `PAYROLL_PROCESSING` `WorkflowEngine` definition — rejected as added complexity with no compensating-transaction benefit since steps 5–6 are explicitly IRREVERSIBLE per the spec anyway |
| Encrypted employee salary fields stored as separate `*Encrypted` varchar columns rather than a single JSON blob | Matches the established pattern from `employees.panEncrypted`/`bankAccountNoEncrypted` and `accounts` table conventions; allows each figure to be decrypted independently in `PayrollEngine` without parsing a JSON blob | Single encrypted JSON blob — rejected for consistency with existing `encryptField`/`decryptField` per-scalar-value usage across the codebase |
| Professional Tax slabs hardcoded (not configurable) | Spec only required PT to be computed "state-wise, per slab" without specifying which states' slabs to support out of the gate; Maharashtra slabs were used as the working default, matching the org's default state context elsewhere in the codebase | Building a full state/slab config table — deferred as over-engineering for a Phase 8 MVP |

---

## 14. RISKS FOR NEXT PHASE

| Risk | Impact | Mitigation |
|---|---|---|
| Salary figures are encrypted but `FIELD_ENCRYPTION_KEY` has no rotation mechanism (same risk flagged in TECH_AUDIT.md for GSTIN/PAN since Phase 2/3) | High if key is ever compromised — all encrypted salary/PAN/bank data becomes unrecoverable on rotation without a re-encryption migration | Document key rotation procedure before production; same risk already exists for inventory/sales encrypted fields |
| `hr.tailoring.enabled` defaults to disabled (no flag row = `{enabled: false}`) — tailor work log API will silently 403 with `FEATURE_DISABLED` until seeded per tenant | Medium — could look like a bug to QA/next session if not aware the flag needs seeding | Documented in §8/§11 of this report |
| Notification delivery for `ALTERATION_READY` requires BOTH `POST /notifications/templates/seed-hr` AND real `WHATSAPP_ACCESS_TOKEN`/`WHATSAPP_PHONE_NUMBER_ID` config — neither was exercised end-to-end in this dev environment | Medium — acceptance criterion "WhatsApp sent when status → READY" is code-complete but **not live-verified** | Next session with WhatsApp sandbox credentials should run the full READY-status flow and confirm `notification_log` row shows `status: 'SENT'` |

---

## 15. FINAL ARCHITECTURE SUMMARY

Phase 8 built `hr-service` (port 3021) from an empty stub into a complete HR domain service covering all 6 milestones: employee master with AES-256-GCM field encryption for PAN/bank account and last-4-digit-only Aadhaar storage; attendance with manual/biometric/mobile sources and shift-based late/half-day/overtime computation; leave management with 6 seeded leave types, balance tracking, and an approve/reject/cancel flow that creates LEAVE attendance records on approval; payroll processing via a `PayrollEngine` that pro-rates salary by present+paid-leave days, computes PF/ESI/Professional-Tax deductions, and aggregates tailor piece-rate work into the gross salary, with `PAYROLL_RUN_APPROVED`/`PAYROLL_RUN_DISBURSED` events consumed by a new `accounting-service` consumer that posts the corresponding double-entry journals; and a full alteration-order status machine (RECEIVED → ASSIGNED → IN_PROGRESS → QUALITY_CHECK → READY → DELIVERED/CANCELLED) with WhatsApp/in-app notification hooks. All 15 database tables were migrated and verified live against the local PostgreSQL instance, and the complete employee-create → salary-set → payroll-calculate → approve flow was smoke-tested end-to-end with real JWT auth, confirming correct LOP proration, PF/ESI math, outbox event writes, and audit log entries. The frontend gained 9 new pages under a new "HR & Payroll" sidebar group. The main gaps left for a follow-up session are: real biometric/employee CSV import (currently 202-stubs), salary-slip PDF rendering (currently returns JSON, not a PDF), and live verification of the WhatsApp notification path with real Meta Cloud API credentials.

---

*Generated by: Claude Sonnet 4.6 | Date: 2026-06-30 | Next Phase: Phase 9 — Search & Cross-Domain Indexing (or as directed)*
