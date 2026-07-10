# ES-17 — Analytics & Reporting
## STATUS: ✅ COMPLETED 
## Sprint: 4 | Effort: 5–6 days | Risk: Medium
## Depends on: ES-05 (report tenant isolation), ES-10 (GST), ES-13 (COGS), ES-16 (performance)
## Unlocks: ES-20

---

## YOUR ROLE

You are the **Principal Backend + Frontend Engineer** on the NEXORAA Multi-Tenant Cloth Retail ERP.
Your mission: build the full analytics and reporting suite — financial statements (P&L, Balance Sheet), inventory analytics, sales analytics, HR analytics — and a scheduled report system.

---

## ═══════════════════════════════════════════
## PRE-FLIGHT CHECKLIST
## ═══════════════════════════════════════════

- [ ] Read `ERP-PLANNING/TECH_AUDIT.md`
- [ ] Read `ERP-PLANNING/CODING_STANDARDS.md`
- [ ] Read `ERP-PLANNING/phase-completions/ES-05_COMPLETION.md` — AR/AP Aging implemented
- [ ] Read `ERP-PLANNING/phase-completions/ES-10_COMPLETION.md` — GSTR-9 implemented
- [ ] Read `ERP-PLANNING/phase-completions/ES-13_COMPLETION.md` — COGS data available
- [ ] Read `ERP-PLANNING/phase-completions/ES-16_COMPLETION.md` — performance indexes
- [ ] Read `apps/report-service/src/domain/ReportEngine.ts` — all existing reports
- [ ] Read `apps/report-service/src/domain/ReportRegistry.ts` — existing registry
- [ ] Read `packages/db-client/src/schema/accounting.ts` — chart of accounts structure
- [ ] Read `packages/db-client/src/schema/report.ts` — report_schedules, report_run_history tables
- [ ] Read `apps/web-frontend/src/pages/reports/` — all existing report pages
- [ ] Run `pnpm build` — confirm clean baseline

---

## ═══════════════════════════════════════════
## COMPLETED PHASES
## ═══════════════════════════════════════════

| Phase | Status | Key Changes Relevant to You |
|-------|--------|----------------------------|
| ES-05 ✅ | Reports | AR/AP Aging; all queries tenant-isolated |
| ES-10 ✅ | GST | GSTR-9; Cess; RCM |
| ES-13 ✅ | Valuation | COGS data in financial_entries |
| ES-16 ✅ | Performance | Indexes on invoices, ledger, outbox |

---

## ═══════════════════════════════════════════
## PROJECT CONTEXT
## ═══════════════════════════════════════════

### Tech Stack
Node.js 20 + TypeScript 5 strict | Fastify 4 | PostgreSQL 16 (raw SQL for reports) |
React 18 + Vite 5 + Tailwind v4 | Recharts (charting library) | React Query v5 | Vitest

### Multi-Tenant Rules
- EVERY raw SQL query MUST include `WHERE tenant_id = ${tenantId}`
- Audit ALL new SQL with comment: `// ✓ tenant_id filtered — ES-17`

### Money Rules
- All amounts: integers in paise
- Display: divide by 100 for INR; use `toLocaleString('en-IN')` for Indian number format

### Report SQL Pattern
```typescript
const result = await db.execute(sql`
  SELECT ...
  FROM financial_entries fe
  WHERE fe.tenant_id = ${ctx.tenantId}  -- MANDATORY
    AND fe.entry_date BETWEEN ${fromDate} AND ${toDate}
    AND ...
  GROUP BY ...
  ORDER BY ...
`);
```

### Chart of Accounts Structure
```
Account Types: ASSET | LIABILITY | EQUITY | REVENUE | EXPENSE
P&L = REVENUE accounts - EXPENSE accounts
Balance Sheet = ASSET accounts vs LIABILITY + EQUITY accounts
```

### Auth Pattern
```typescript
fastify.get('/reports/pnl', {
  preHandler: [authenticate, requirePermission(PERMISSIONS.REPORT_VIEW)],
}, handler)
```

### Frontend Design System
- `ERPDataGrid` for all tabular reports
- Recharts `BarChart`, `LineChart`, `PieChart` for visualizations
- `ERPSkeleton` for loading
- Export buttons: CSV (via API) and Print (via `window.print()`)

### Coding Standards
- TypeScript strict — no `any`
- Report query types: define interface for each result row
- `/* global process */` at top of files using `process.env`

---

## ═══════════════════════════════════════════
## OBJECTIVE
## ═══════════════════════════════════════════

1. Financial Statements: P&L, Balance Sheet, Trial Balance, Cash Flow Statement
2. Sales Analytics: revenue trend, top customers, salesperson performance
3. Inventory Analytics: fast/slow movers, stock aging, days-of-supply
4. HR Analytics: headcount, salary cost trend, attrition
5. Scheduled Reports: email delivery at set intervals

---

## ═══════════════════════════════════════════
## SCOPE
## ═══════════════════════════════════════════

### IN SCOPE

**Report 1 — Profit & Loss Statement**

Backend: `apps/report-service/src/domain/reports/PnLReport.ts` (new file)

Query: sum of `financial_entries` by account type, grouped by account, for date range
```sql
SELECT a.account_code, a.account_name, a.account_type,
  SUM(CASE WHEN fe.entry_type = 'CREDIT' THEN fe.amount ELSE -fe.amount END) AS balance
FROM financial_entries fe
JOIN chart_of_accounts a ON fe.account_id = a.id
WHERE fe.tenant_id = ${tenantId}
  AND fe.entry_date BETWEEN ${fromDate} AND ${toDate}
  AND a.account_type IN ('REVENUE', 'EXPENSE')
GROUP BY a.id, a.account_code, a.account_name, a.account_type
ORDER BY a.account_type, a.account_code
```

Route: `GET /api/v1/reports/pnl?from=2026-04-01&to=2026-06-30`

Frontend: `apps/web-frontend/src/pages/reports/PnLPage.tsx`
- Date range picker (defaults to current quarter)
- Revenue section, Expense section, Net Profit/Loss at bottom
- "Compare to previous period" toggle
- Export to CSV

**Report 2 — Balance Sheet**

Same pattern — ASSET, LIABILITY, EQUITY accounts as of a given date.

Route: `GET /api/v1/reports/balance-sheet?asOf=2026-06-30`
Frontend: `apps/web-frontend/src/pages/reports/BalanceSheetPage.tsx`

**Report 3 — Trial Balance**

All accounts with their debit/credit balance. Running check: total debits = total credits.

Route: `GET /api/v1/reports/trial-balance?asOf=2026-06-30`
Frontend: `apps/web-frontend/src/pages/reports/TrialBalancePage.tsx`

**Report 4 — Sales Analytics**

`apps/report-service/src/domain/reports/SalesAnalyticsReport.ts`:

Sub-reports:
- Monthly revenue trend (last 12 months): `GROUP BY DATE_TRUNC('month', invoice_date)`
- Top 10 customers by revenue (date range)
- Category-wise sales breakdown
- Salesperson performance (if `invoices.created_by` or `invoices.salesperson_id` exists)

Route: `GET /api/v1/reports/sales-analytics?from=2025-07-01&to=2026-06-30`
Frontend: `apps/web-frontend/src/pages/reports/SalesAnalyticsPage.tsx`
- Line chart: monthly revenue trend (Recharts `LineChart`)
- Bar chart: top 10 customers
- Pie chart: category breakdown

**Report 5 — Inventory Analytics**

`apps/report-service/src/domain/reports/InventoryAnalyticsReport.ts`:

- Fast movers: items with highest STOCK_OUT count in last 30/60/90 days
- Slow movers: items with zero or low STOCK_OUT in last 90 days
- Stock aging: days since last STOCK_IN per item (long-aging = cash tied up)
- Days of supply: current_qty / avg_daily_consumption (last 30 days)
- Stockout alerts: items where available_qty = 0

Route: `GET /api/v1/reports/inventory-analytics`
Frontend: `apps/web-frontend/src/pages/reports/InventoryAnalyticsPage.tsx`
- Table: Item, Category, Current Stock, Days of Supply, Last Sale Date, Status (Fast/Slow/Stockout)

**Report 6 — HR Analytics**

`apps/report-service/src/domain/reports/HRAnalyticsReport.ts`:

- Headcount by department (current)
- Monthly salary cost trend (from payroll_slips — decrypt amounts from ES-06)
- New hires vs exits per month
- Gender diversity (if gender field exists on employees)

Route: `GET /api/v1/reports/hr-analytics?from=2025-07-01&to=2026-06-30`
Frontend: `apps/web-frontend/src/pages/reports/HRAnalyticsPage.tsx`

**Report 7 — Scheduled Reports**

`apps/report-service/src/domain/ReportScheduler.ts` (new file):

Using `report_schedules` table (created in ES-04):
```typescript
// Cron: every day at 6 AM → check due schedules
// For each due schedule:
//   1. Run the report
//   2. Store result in report_run_history
//   3. Email the result (CSV attachment) via email-service / nodemailer
```

Route: `POST /api/v1/reports/schedules` — create schedule
Route: `GET /api/v1/reports/schedules` — list schedules
Route: `DELETE /api/v1/reports/schedules/:id`

Frontend: `apps/web-frontend/src/pages/reports/ReportSchedulePage.tsx`
- List of scheduled reports
- "New Schedule" form: Report type, frequency (daily/weekly/monthly), email recipients, format (CSV/JSON)

### OUT OF SCOPE
- PDF export (ES-20)
- XBRL filing (complex accounting standards)
- Custom report builder
- Real-time streaming dashboards

---

## ═══════════════════════════════════════════
## TESTING REQUIREMENTS
## ═══════════════════════════════════════════

`apps/report-service/src/__tests__/financial-reports.test.ts`:
1. P&L: REVENUE 100,000 - EXPENSE 60,000 = NET PROFIT 40,000 ✓
2. Balance Sheet: Total ASSETS = Total (LIABILITY + EQUITY) ✓
3. Trial Balance: Total DEBIT = Total CREDIT ✓
4. Tenant isolation: P&L for tenant A contains zero tenant B data
5. Sales analytics: 12-month revenue trend has 12 data points
6. Inventory analytics: item with zero stock shows 'STOCKOUT' status
7. Report schedule created → runs on due date → `report_run_history` row created

---

## ═══════════════════════════════════════════
## BUILD VERIFICATION
## ═══════════════════════════════════════════

```bash
pnpm --filter @erp/report-service build
pnpm --filter @erp/report-service type-check
pnpm --filter @erp/web-frontend build
pnpm lint
pnpm test --filter @erp/report-service
```

---

## ═══════════════════════════════════════════
## VERIFICATION CHECKLIST
## ═══════════════════════════════════════════

- [ ] P&L report: REVENUE - EXPENSE = NET PROFIT/LOSS (verified with test data)
- [ ] Balance Sheet: ASSETS = LIABILITIES + EQUITY
- [ ] Trial Balance: Debit total = Credit total
- [ ] Tenant isolation: tenant A cannot see tenant B financial data
- [ ] Sales trend chart loads with real data in Recharts
- [ ] Inventory analytics shows stockout alerts
- [ ] Report schedule creates and runs
- [ ] All 7 report tests pass
- [ ] `pnpm lint` passes

---

## ═══════════════════════════════════════════
## REGRESSION CHECKLIST
## ═══════════════════════════════════════════

- [ ] AR Aging / AP Aging from ES-05 still work
- [ ] GSTR-9 from ES-10 still works
- [ ] `/reports/schedules` route still works (route order from ES-01)
- [ ] `ReportViewerPage.tsx` still loads for existing report types

---

## ═══════════════════════════════════════════
## DEFINITION OF DONE
## ═══════════════════════════════════════════

- [ ] P&L, Balance Sheet, Trial Balance all correct
- [ ] Sales, Inventory, HR analytics pages render with real data
- [ ] Report scheduler functional
- [ ] 7 tests pass
- [ ] Completion report saved at `ERP-PLANNING/phase-completions/ES-17_COMPLETION.md`

---

## ═══════════════════════════════════════════
## COMPLETION REPORT TEMPLATE
## ═══════════════════════════════════════════

**Save as:** `ERP-PLANNING/phase-completions/ES-17_COMPLETION.md`

```markdown
# ES-17 Completion Report — Analytics & Reporting
**Date:** [YYYY-MM-DD]
**Status:** COMPLETE

## Reports Implemented
| Report | Endpoint | Frontend Page | Status |
|--------|----------|---------------|--------|
| P&L | /reports/pnl | PnLPage.tsx | DONE |
| Balance Sheet | /reports/balance-sheet | BalanceSheetPage.tsx | DONE |
| Trial Balance | /reports/trial-balance | TrialBalancePage.tsx | DONE |
| Sales Analytics | /reports/sales-analytics | SalesAnalyticsPage.tsx | DONE |
| Inventory Analytics | /reports/inventory-analytics | InventoryAnalyticsPage.tsx | DONE |
| HR Analytics | /reports/hr-analytics | HRAnalyticsPage.tsx | DONE |

## Financial Accuracy Verification
- P&L balanced: [YES]
- Balance Sheet equation: [YES]
- Trial Balance: [YES]

## Tests: 7/7 PASS | lint: PASS | build: PASS

## Phases Unblocked
ES-20 (PDF export of reports)
```
