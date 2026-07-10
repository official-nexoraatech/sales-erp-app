# ES-17 Completion Report — Analytics & Reporting
**Date:** 2026-07-03
**Status:** COMPLETE

## Scope decision (made with user before implementation)

Pre-flight research found that P&L / Balance Sheet / Trial Balance / Cash Flow already exist and work
correctly in **accounting-service** (`ReportsEngine.ts`, routed at `/accounting/reports/*`, with their own
frontend pages). `report-service`'s `ReportEngine.ts` had duplicate cases for the same four reports, but
they referenced columns that don't exist in the real schema (`fe.entry_date`, `fe.amount`, `fe.debit_credit`,
`account_type IN ('REVENUE','EXPENSE','COGS')`) — they had never been run against real Postgres, only
against tests that mock `db.execute` and never check column names.

Agreed direction: **fix the broken report-service cases in place** (rather than duplicating from scratch or
skipping them), so they become correct AND get CSV/Excel export + scheduling for free through the existing
generic `ReportEngine`/`ReportRegistry`/`ScheduledReportJob` infrastructure — while leaving the already-working
accounting-service pages untouched as the bespoke UI for those four statements.

New Sales/Inventory/HR analytics reports were built fresh (nothing existed for these), reusing the
`ReportEngine` switch-case + `ReportRegistry` pattern used by all ~90 other reports in this codebase, with new
dedicated chart-based frontend pages (the "Analytics" catalog is table/CSV-first everywhere else; these three
are the only chart dashboards).

## Reports Implemented / Fixed

| Report | Slug | Frontend | Status |
|--------|------|----------|--------|
| P&L | `profit-loss-report` | Generic `ReportViewerPage` + existing `ProfitLossPage` (accounting-service) | FIXED |
| Balance Sheet | `balance-sheet-report` | Generic `ReportViewerPage` + existing `BalanceSheetPage` (accounting-service) | FIXED |
| Trial Balance | `trial-balance-report` | Generic `ReportViewerPage` + existing `TrialBalancePage` (accounting-service) | FIXED |
| Cash Flow | `cash-flow-report` | Generic `ReportViewerPage` + existing `CashFlowPage` (accounting-service) | FIXED |
| Sales Analytics | `sales-revenue-trend` (new) + existing `sales-by-customer`/`sales-by-category`/`sales-by-salesperson` | `SalesAnalyticsPage.tsx` (new) | DONE |
| Inventory Analytics | `inventory-analytics` (new) | `InventoryAnalyticsPage.tsx` (new) | DONE |
| HR Analytics | `hr-headcount-by-department`, `hr-salary-cost-trend`, `hr-hires-vs-exits`, `hr-gender-diversity` (all new) | `HRAnalyticsPage.tsx` (new) | DONE |
| Scheduled Reports | Pre-existing (`ScheduledReportJob.ts`, croner + nodemailer) | Pre-existing `SchedulesPage.tsx` | Bug fixed (see below) |

## What was fixed vs. built

**Fixed (`apps/report-service/src/domain/ReportEngine.ts`):**
- `profit-loss-report` — now classifies accounts via `account_type`/`account_sub_type` (`INCOME`/`EXPENSE`/`CONTRA`,
  `SALES_REVENUE`/`COST_OF_GOODS`/`OPERATING_EXPENSE`/`TAX_EXPENSE`) and sums `debit_amount`/`credit_amount`
  over `created_at`, matching accounting-service's proven `ReportsEngine.getProfitLoss()` logic.
- `balance-sheet-report` — now derives each account's balance from `opening_balance`/`opening_balance_type` +
  `normal_balance` + period movement, instead of a naive debit-minus-credit sum with no opening balance.
- `trial-balance-report` — now computes opening/period/closing Dr/Cr per account correctly (opening balance
  netted with pre-period movement, then split back into debit/closing columns), matching double-entry rules.
- `cash-flow-report` — now derives cash movement from `CASH_AND_BANK` accounts using real columns, with an
  opening-balance subquery that avoids a join fan-out bug the naive version would have had.
- All four fixes were selected because they're **explicitly required by ES-17's objective** ("Financial
  Statements: P&L, Balance Sheet, Trial Balance, Cash Flow Statement"), and because leaving broken code that
  matches a registered, schedulable, user-facing slug is worse than either removing or fixing it.

**Left untouched (same root-cause bug, but out of ES-17's explicit scope):** `day-book`, `account-ledger`,
`bank-book` in `ReportEngine.ts` still reference `fe.entry_date`/`fe.debit_credit`/`fe.amount`, which don't
exist. Flagging for a future phase — not fixed here to keep this change surgical to ES-17's stated scope.

**Built new (`ReportEngine.ts` + `ReportRegistry.ts`):**
- `sales-revenue-trend` — monthly invoice count + revenue, defaults to a trailing 12-month window when no
  date range is given.
- `inventory-analytics` — one row per item: current stock (`projection_stock_level.available_qty`), days of
  supply (`current_stock / (30-day STOCK_OUT qty / 30)`), last sale date, and a `FAST`/`SLOW`/`STOCKOUT`
  status (configurable `fastMoverThreshold` param, default 10 units/30d).
- `hr-headcount-by-department`, `hr-gender-diversity` — current active-employee counts.
- `hr-salary-cost-trend` — monthly gross salary cost, summed from `payroll_slips`' **plaintext** components
  (`basicSalary + hraAmount + daAmount + otherAllowances + pieceRateAmount`) rather than decrypting the
  AES-256-GCM `grossSalary`/`netSalary` columns, matching how `PayrollEngine.ts` computes gross before
  encrypting it — avoids per-row decryption and avoids leaking decrypted PII into report caches/logs.
- `hr-hires-vs-exits` — monthly new-hire/exit counts from `employees.joining_date`/`exit_date`.
- Added a new `ANALYTICS` category to `ReportRegistry.ts`'s `ReportDefinition['category']` union.
- All 6 new slugs use `REPORT_VIEW` permission (already broadly assigned to roles) rather than adding new
  permission constants, to avoid the kind of permission/role-assignment gap described below.

**Bug fixed (pre-existing, unblocks this phase's own DoD):** `POST /api/v2/report-schedules` and
`DELETE /api/v2/report-schedules/:id` required `REPORT_CREATE_SCHEDULE`/`REPORT_DELETE_SCHEDULE` permissions
that were never defined in `packages/shared-types/src/permissions.ts` and never assigned to any role — those
routes were permanently 403 for every user, including OWNER/ADMIN. Since ES-17's own DoD requires "Report
schedule creates and runs," this was fixed by switching both routes (and the frontend route guard + constants
file) to the existing `REPORT_SCHEDULE` permission, which **is** defined and **is** already granted to
OWNER/ADMIN/SUPER_ADMIN via their full-permission role defaults. `DASHBOARD_VIEW` has an identical bug
(defined on the frontend, missing on the backend) but was left alone — it's outside ES-17's scope and unrelated
to reports/scheduling.

## Frontend

- `apps/web-frontend/src/pages/reports/SalesAnalyticsPage.tsx` (new) — monthly revenue line chart, top-10
  customers bar chart, category pie chart, salesperson performance table. Date range picker, defaults to
  trailing 12 months.
- `apps/web-frontend/src/pages/reports/InventoryAnalyticsPage.tsx` (new) — `ERPDataGrid` table with
  Item/Category/Current Stock/Days of Supply/Last Sale/Status columns, color-coded status badges, stockout
  banner, configurable fast-mover threshold.
- `apps/web-frontend/src/pages/reports/HRAnalyticsPage.tsx` (new) — headcount-by-department bar chart, gender
  diversity pie chart, salary cost trend line chart, hires-vs-exits bar chart.
- Routed at `/reports/sales-analytics`, `/reports/inventory-analytics`, `/reports/hr-analytics` (registered
  before the catch-all `/reports/:slug` route in `App.tsx`, matching the existing `ar-aging`/`ap-aging` pattern).
- `ReportsPage.tsx` (existing catalog) now has an "Analytics dashboards" section linking to the three new
  pages, plus an `ANALYTICS` category badge/filter for the raw registry entries.
- All 6 new report-service slugs and the 4 fixed financial slugs are also reachable through the existing
  generic `ReportViewerPage` (`/reports/:slug`) for CSV/Excel export, since they're registered in
  `ReportRegistry.ts` like every other report.

## Financial Accuracy Verification
- P&L balanced: **YES** (test: REVENUE 100,000 − EXPENSE 60,000 = NET PROFIT 40,000)
- Balance Sheet equation: **YES** (test: total ASSETS = total LIABILITY + EQUITY)
- Trial Balance: **YES** (test: total closing DEBIT = total closing CREDIT)
- Cash Flow: additional test verifies closing cash = opening cash + net movement

## Tests: 9/9 (7 required + 2 extra) PASS | 109/109 total report-service tests PASS | type-check: PASS | build: PASS

`apps/report-service/src/__tests__/financial-reports.test.ts` (new, 7 tests — matches the ES-17 spec's required
list): P&L correctness, Balance Sheet equation, Trial Balance debit=credit, tenant isolation on P&L, sales
revenue trend has 12 points + correct default date window, inventory analytics STOCKOUT classification, plus
a cash-flow-report sanity test.

`apps/report-service/src/__tests__/scheduled-report.test.ts` (new, 2 tests — required test #7): directly
exercises `ScheduledReportJob`'s private `runSchedule()` method (via a controlled test cast, since it's not
otherwise reachable without waiting on a real cron tick) — asserts a `RUNNING` → `COMPLETED` `report_run_history`
row is written on success, and `RUNNING` → `FAILED` with the error message on failure.

`apps/report-service/src/__tests__/report-tenant-isolation.test.ts` — extended with the 6 new slugs (all 85
slugs now covered).

**Known test-environment limitation (not fixed, flagged for awareness):** `@erp/db`'s schema barrel
(`packages/db-client/src/schema/index.ts`'s chain of `export * from './X.js'`) does not surface
`reportSchedules`/`reportRunHistory` under vitest's module resolution — importing `schema/report.ts` directly
works fine, but the barrel re-export silently drops everything from `workflow.ts` onward under vitest's
transform. This only affects **value imports** in tests (type-only imports, like `ReportEngine.ts` uses, are
unaffected since types are erased at compile time). Worked around in `scheduled-report.test.ts` with a scoped
`vi.mock('@erp/db', ...)` providing minimal stand-ins for the two symbols `ScheduledReportJob` needs. Whether
this also affects production builds (which use compiled `dist/` output via `tsc`, not vite's dev transform) is
unverified — worth a quick check before relying on other `@erp/db` value-imports in new report-service code.

## Money format note
The ES-17 prompt's "Money Rules" section (integer paise) does not match reality: every money column across
`accounting.ts`/`sales.ts`/`hr.ts` (including `financial_entries.debit_amount`/`credit_amount`) is
`decimal(15,2)` storing rupees directly, and the frontend's `formatCurrency`/`fmt` helpers never divide by 100.
All new code follows the actual decimal-rupee convention, not the prompt's paise claim.

## Phases Unblocked
ES-20 (PDF export of reports)
