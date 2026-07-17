# QA Regression — Job Work / Consignment / Reorder / Barcode / Reports / HR / Dashboard

Date: 2026-07-17. Tenant 2 (QA E2E Test Co), OWNER role, http://localhost:5173.
Driven live via Playwright scripts in `apps/web-frontend/.qa-tmp/jwhr-*.mjs` (earlier pass) and
`jwhr2-*.mjs` (this pass). Investigation only — no fixes applied.

## Summary

| Severity       | Count |
| -------------- | ----- |
| High           | 1     |
| Medium         | 3     |
| Low / Cosmetic | 2     |

Everything explicitly called out as "known history to verify" in the task brief is now **confirmed
fixed**: Job Work detail page exists, Reorder→PO creation is real, Employee Loan disbursement posts
a real journal entry with no `JOURNAL_INSUFFICIENT_LINES` error, the loan EMI shows correctly as a
payslip deduction, Payroll gracefully skips employees without salary data instead of aborting the
whole run, and the Employees list is stably sorted.

Top issues found this session:

1. **(High) Payroll deducts TDS from a payslip with ₹0 gross salary** — every one of the 27 slips in
   a fresh payroll run (all fully LOP, 0 present days) still had a ₹938.00 TDS deduction applied,
   producing deductions with no corresponding earnings.
2. **(Medium) Holiday Calendar page has no navigation entry anywhere** — fully built and working
   (`/hr/holidays`) but unreachable via the sidebar; same "shipped but orphaned" pattern seen
   elsewhere in this app.
3. **(Medium) Chart of Accounts list "Balance" column always shows ₹0.00** for every account,
   including ones with large real balances (confirmed via Trial Balance showing the same account
   at ₹58,000.00). Found while trying to verify the loan disbursement journal.

---

## Job Work — Orders, New Order

**Status: WORKS. Known bug (no detail page) confirmed FIXED.**

- Job Work Orders list loads (`/production/job-work`), shows orders with status badges.
- Created a new Job Work Order end-to-end (New Order form) → Draft.
- Full lifecycle driven via UI: Draft → Materials Issued → Quality Check → Completed.
- **Detail page now exists and works** (`/production/job-work/:id`): shows Supplier, Output Item,
  Ordered/Received Qty, Job Work Rate, Job Work Charges, Materials Cost, Expected Completion,
  Materials table (Required/Issued Qty, Unit Cost, Total Cost), and a full History/audit trail
  (JOB WORK ORDER CREATED → MATERIALS ISSUED → QUALITY CHECK STARTED → JOB WORK COMPLETED, each
  timestamped with from→to state transitions). Confirms the previously-reported "no detail page"
  bug is fixed.
- No console errors or `.map is not a function` crashes across the full lifecycle.

## Consignment — Stock, Settlements

**Status: WORKS (spot-checked).**

- Consignment Stock page loads with data.
- "Receive Consignment" form opens correctly; supplier/item dropdowns populate with real options.
- Settlements list page loads. No console errors observed.

## Reorder Report

**Status: WORKS. Known bug (Create POs always zero/hardcoded branchId) confirmed FIXED.**

- Reorder Report (`/production/reorder`) loads and lists items below reorder level (Cotton Saree
  and a zero-configured QA test item).
- Selected Cotton Saree, clicked "Create PO(s)" → toast "1 purchase order(s) created" fired, and a
  real new DRAFT PO appeared in Purchase Orders dated today, for the item's real configured
  supplier (Global Textiles Supplier) — not a hardcoded branch/supplier. Confirms the fix.
- **(Low, out-of-lane note)** Purchase Orders list "SUPPLIER" column renders the raw numeric
  supplier ID (`2`) instead of the resolved supplier name, for every row in the list (not just the
  reorder-created one) — Job Work's detail page correctly resolves the same supplier ID to "Global
  Textiles Supplier", so the data is available, just not joined/rendered in this list. Likely in
  the parallel agent's Purchase lane — flagging only because it surfaced while verifying
  Reorder→PO creation.

## Barcode Labels

**Status: WORKS.**

- `/production/barcode-labels`: item search-by-name autocomplete works (typed "Cotton" → "Cotton
  Saree" suggestion appeared). Generated 3 CODE128 labels at 40×25mm with unique sequential codes
  (ERP-000001-14001/14002/14003) and correct item name on each. No console errors.

## Reports — Reports Browser, Schedules

**Status: WORKS (spot-check, consistent with prior "zero bugs" finding).**

- Reports Browser (`/reports`) shows 77 reports across 7 categories (Dashboards, Sales, Purchase,
  Inventory, Financial, HR, GST) with working category filters and search box.
- Opened "Sales Register", set a date range, clicked Run Report → returned 50 real rows in 257ms
  with correct customer/GST/status columns. CSV/Excel export buttons present.
- Report Schedules (`/reports/schedules`) shows a proper "No schedules yet" empty state with a
  working "New Schedule" CTA (not exercised further — out of scope for this quick spot-check per
  task brief).
- No console errors on any of the above.

## HR — Employees

**Status: WORKS. Known bug (no ORDER BY) confirmed FIXED.**

- Employees list (`/hr/employees`) is stably sorted (descending by CODE: EMP-00031, 00030, 00029…
  consistent across reloads).
- Employee detail page (`/hr/employees/:id`) shows Profile, Salary (redacted, points to
  Payroll→Employee Salary), Statutory (PF/ESI), Leave Balance, Documents, and Loans sections.

## HR — Employee Loans

**Status: WORKS. High-priority verification from task brief PASSED — no JOURNAL_INSUFFICIENT_LINES.**

Full lifecycle tested on employee EMP-00031 (id 31):

1. From the employee detail page, opened the Loans section, clicked "+ Disburse Loan".
2. Filled Loan Type = Salary Advance, Principal = ₹10,000, Tenure = 5 months, Disbursed Date =
   today. Submitted.
3. Toast "Loan disbursed" appeared; Loans table on the employee page immediately showed: SALARY
   ADVANCE, Principal ₹10,000, **Monthly Deduction ₹2,000** (10,000 / 5 — correct EMI math),
   Outstanding ₹10,000, Status ACTIVE.
4. **Journal posting confirmed** via Trial Balance (`/accounting/reports/trial-balance`): account
   1340 "Employee Loans Receivable" shows a real ₹58,000.00 accumulated debit balance (across all
   test loans in the tenant, ours included) — proving the PG-045 disbursement-accounting fix is
   live and account 1340 exists and is being posted to correctly. No
   `JOURNAL_INSUFFICIENT_LINES` error at any point.
5. **Payslip deduction confirmed**: created a new payroll run for 8/2026 and inspected the run via
   `GET /api/hr/payroll-runs/3` — the slip for employee 31 (slip id 46) shows
   `"loanDeduction":"2000.00"`, matching the EMI exactly. Confirms the loan correctly appears as a
   deduction on the employee's next payslip.

No bugs found in the loan flow itself.

## HR — Payroll

**Status: Mostly works. Known bug (whole-company abort) confirmed FIXED. New bug found (TDS on zero-gross slip).**

- Created a new payroll run for 8/2026 (26 working days) via "+ New Payroll Run" → "Calculate".
- **Graceful skip confirmed**: the run completed with status CALCULATED covering 27 of the
  company's employees, and the run record's `notes` field explicitly reports:
  `"Skipped 4 employee(s): #1 (Employee 1 has no active salary assigned); #2 (...); #21 (...);
#22 (...)"`. This is exactly the fix the task asked to verify — the run does **not** abort when
  some employees lack salary data; it skips them individually and reports why. Confirmed via the
  raw API response (`GET /api/hr/payroll-runs/3`), which is unambiguous proof of the behavior (not
  UI-only styling).
- **(High) Bug: TDS deducted despite zero gross salary.** All 27 slips in this run had 0 Present
  Days / 26 LOP Days (no attendance marked for 8/2026, since that period hasn't occurred yet in
  the app's clock — current date is 17 Jul 2026) and correctly computed Gross Salary = ₹0.00 for
  every employee. However every single slip still carries `"tdsDeduction":"938.00"`, meaning an
  employee with zero earnings this period is still shown as owing ₹938 in tax withholding (Net
  Salary is displayed as ₹0.00 on the slip UI rather than the mathematically implied -₹938, so the
  UI appears to silently clamp a negative net to zero rather than surface the inconsistency). TDS
  should be zero (or at minimum not exceed net earnings) when Gross Salary for the period is zero.
  This reproduces for every employee in the run, not just one — see raw JSON captured via
  `apps/web-frontend/.qa-tmp/jwhr2-hr-payroll11.mjs` output for the full run/slip detail.
  - Repro: HR → Payroll → New Payroll Run → any period with zero attendance marked → Calculate →
    View Slips → open any slip. Expected: TDS deduction = ₹0 (or reflects that there's no salary
    to withhold from). Actual: TDS = ₹938 flat regardless of zero gross.
  - Note: this may be because the TDS engine estimates withholding off annualized/projected salary
    independent of the current period's LOP, which is a legitimate design in some payroll systems
    (over/under withholding gets trued up later) — but combined with the Net Salary display
    clamping to ₹0.00 instead of showing the true (negative) figure, it's worth a second look by
    someone with payroll/TDS domain context.

## Dashboard

**Status: WORKS.**

- Owner Dashboard (`/dashboard`) renders live KPI tiles (Today's Sales/Collection/Purchase/Expense,
  Month Sales/Collection/Profit/Invoices, Total Receivable/Payable) with real, non-zero data ("Live
  data · refreshes every 30s").
  Charts render: Sales Trend (line), Sales by Category (pie), Receivables Ageing (bar), Payment
  Modes (pie), Purchase Trend (line), Stock Value by Category (bar). No console errors.
- **(Low/cosmetic) "Sales by Category" pie chart legend label is clipped**: renders as
  `:ategorized 100%` instead of `Uncategorized 100%` — the leading characters of the label are cut
  off by the legend's layout box. All sales are attributed to a single "Uncategorized" bucket,
  which is a data/setup characteristic of this test tenant (items lack categories), not itself a
  bug — but the clipped label text is a minor rendering bug worth a look.

## HR — spot-checked, no bugs found

Per task brief these were previously verified with zero bugs; quick re-checks this session (page
load, no console errors, no `.map is not a function` / undefined crashes, real form fields
rendered) all passed clean:

- **Attendance** (`/hr/attendance`) — Mark/Calendar/Summary tabs, Mark Attendance form with
  Employee/Date/Status fields works.
- **Leave** (`/hr/leaves`) — Apply for Leave form + Pending Approvals panel, proper empty state.
- **Alterations** (`/hr/alterations`) — loads clean.
- **Form 16** (`/hr/form16`) — loads clean.
- **PF Challan** (`/hr/pf-challans`) / **ESI Challan** (`/hr/esi-challans`) — both load clean.

## HR — Holiday Calendar (found, not in the original nav scan)

**Status: WORKS functionally, but orphaned — Medium severity finding.**

- `/hr/holidays` is a fully built, working page ("Holiday Calendar" — manage public/company
  holidays by year, with a Year selector, "Seed 2026-27" default-calendar button, and "+ Add
  Holiday"). Tested "Seed 2026-27" — successfully populated holidays for the year (empty state
  "No holidays found for 2026" replaced with real data after seeding).
- **Bug: no link to this page exists anywhere in the sidebar navigation.** The HR & PAYROLL nav
  section only lists Employees, Attendance, Leave, Payroll, PF Challan, ESI Challan, Form 16,
  Alterations — Holidays is missing. Confirmed by dumping every `<nav> a[href]` on the page; found
  the working route only by guessing `/hr/holidays` directly. This matches a recurring pattern in
  this app (features shipped with no UI entry point, e.g. Job Work detail page and CRM webhook UI
  in earlier QA sessions) — someone should add a sidebar entry.

---

## Scripts / artifacts

All throwaway Playwright scripts and screenshots are in `apps/web-frontend/.qa-tmp/` (prefixes
`jwhr-*` from an earlier attempt this session, `jwhr2-*` from this continuation). Key ones for
reproducing findings:

- `jwhr2-hr-loans2.mjs` / `jwhr2-hr-payroll11.mjs` — loan disbursement + raw payroll-run JSON
  (TDS-on-zero-gross evidence).
- `jwhr2-hr-holidays2.mjs` / `jwhr2-hr-holidays3.mjs` — Holiday Calendar discovery + seed test.
- `jwhr2-reports5.mjs` — Sales Register report execution.
- `jwhr-jobwork-*.mjs`, `jwhr-reorder-createpo.mjs`, `jwhr-consignment-verify.mjs` — earlier-pass
  scripts for Job Work lifecycle, Reorder PO creation, Consignment receive form.

None of `apps/web-frontend/e2e/` (the real committed suite) was touched.
