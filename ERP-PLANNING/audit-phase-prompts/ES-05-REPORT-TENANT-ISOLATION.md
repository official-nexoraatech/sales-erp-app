# ES-05 — Report Tenant Isolation & Core Financial Reports
## STATUS: ✅ COMPLETED
## Sprint: 2 | Effort: 4–5 days | Risk: High
## Depends on: ES-02 (financial_entries must have real data)
## Unlocks: ES-17

---

## YOUR ROLE

You are the **Principal Backend + Frontend Engineer** on the NEXORAA Multi-Tenant Cloth Retail ERP.
Your mission: audit all raw SQL in ReportEngine.ts for missing tenant_id filters, then build AR Aging and AP Aging reports end-to-end (backend + frontend).

---

## ═══════════════════════════════════════════
## PRE-FLIGHT CHECKLIST
## ═══════════════════════════════════════════

- [ ] Read `ERP-PLANNING/TECH_AUDIT.md`
- [ ] Read `ERP-PLANNING/CODING_STANDARDS.md`
- [ ] Read `ERP-PLANNING/phase-completions/ES-02_COMPLETION.md` — confirm outbox relay is running
- [ ] Read `apps/report-service/src/domain/ReportEngine.ts` — read the ENTIRE file; count all raw SQL queries
- [ ] Read `apps/report-service/src/domain/ReportRegistry.ts`
- [ ] Read `apps/report-service/src/api/report.routes.ts`
- [ ] Read `packages/db-client/src/schema/sales.ts` — find `invoices` table columns
- [ ] Read `packages/db-client/src/schema/accounting.ts` — find `financial_entries` columns
- [ ] Check what indexes exist on `invoices` table for `(tenant_id, invoice_date, status)`
- [ ] Read `apps/web-frontend/src/pages/reports/` — see existing report page patterns
- [ ] Read `apps/web-frontend/src/components/erp/ERPDataGrid.tsx` — understand props API
- [ ] Run `pnpm build` and `pnpm test` — confirm clean baseline
- [ ] Verify ES-02 complete: outbox relay is running, financial_entries has data

---

## ═══════════════════════════════════════════
## COMPLETED PHASES
## ═══════════════════════════════════════════

| Phase | Status | Key Changes Relevant to You |
|-------|--------|----------------------------|
| ES-01 ✅ | Security | search-service JWT, rate limit |
| ES-02 ✅ | Outbox Relay | Events publishing; financial_entries now has journal data |
| ES-03 | Check report | inventory_ledger writes — not directly relevant to reports |
| ES-04 | Check report | report_schedules + report_run_history tables now exist |

---

## ═══════════════════════════════════════════
## PROJECT CONTEXT
## ═══════════════════════════════════════════

### Tech Stack
Node.js 20 + TypeScript 5 strict | Fastify 4 | PostgreSQL 16 + Drizzle ORM |
React 18 + Vite 5 + Tailwind CSS v4 | React Query v5 | Vitest

### Multi-Tenant Rules
- **CRITICAL FOR THIS PHASE:** Every raw SQL query in report-service MUST include `WHERE tenant_id = $tenantId`
- The `tenant_id` filter must be in the SQL WHERE clause — NOT as a post-query JS filter
- `ctx.tenantId` comes from `request.auth.tenantId` — never from URL params
- Two tenants running the same report must never see each other's data

### Auth Pattern
```typescript
fastify.get('/reports/ar-aging', {
  preHandler: [authenticate, requirePermission(PERMISSIONS.REPORT_VIEW)],
}, handler)
```

### API Conventions
- Success: `{ data: T, meta?: { page, limit, total } }`
- Error: `{ error: { code, message, details? } }`
- Money: integers in paise; format to INR on frontend
- Pagination: `?page=1&limit=100`

### Frontend Design System (MANDATORY)
- Tabular data: ALWAYS `ERPDataGrid` — never raw `<table>`
- Forms: `ERPFormField` + `ERPInput`/`ERPSelect`
- Loading: `ERPSkeleton`
- Toasts: `useToast()` hook
- Page header: `ERPPageHeader`
- Error boundary: `ERPErrorBoundary` wrapping each page
- API calls: React Query `useQuery`/`useMutation` — never raw `fetch` in components
- Tailwind v4: `@custom-variant dark` — no `darkMode: 'class'`

### Report SQL Pattern (required for ALL queries)
```typescript
// CORRECT — tenant filter in SQL WHERE clause
const result = await db.execute(sql`
  SELECT customer_id, customer_name,
    SUM(CASE WHEN (NOW()::date - invoice_date) BETWEEN 0 AND 30 THEN outstanding ELSE 0 END) AS bucket_0_30,
    SUM(CASE WHEN (NOW()::date - invoice_date) BETWEEN 31 AND 60 THEN outstanding ELSE 0 END) AS bucket_31_60,
    SUM(CASE WHEN (NOW()::date - invoice_date) BETWEEN 61 AND 90 THEN outstanding ELSE 0 END) AS bucket_61_90,
    SUM(CASE WHEN (NOW()::date - invoice_date) > 90 THEN outstanding ELSE 0 END) AS bucket_90_plus,
    SUM(outstanding) AS total_outstanding
  FROM invoices
  WHERE tenant_id = ${ctx.tenantId}      -- THIS LINE IS MANDATORY
    AND invoice_date <= ${asOfDate}
    AND status NOT IN ('CANCELLED', 'DRAFT')
    AND (total_amount - COALESCE(paid_amount, 0)) > 0
  GROUP BY customer_id, customer_name
  ORDER BY total_outstanding DESC
`);
```

### Coding Standards
- TypeScript strict — no `any`
- No `console.log` — use `packages/logger`
- `/* global process */` at top of files using `process.env`
- All raw SQL queries: parameterized (no string interpolation for tenant_id or user input)
- Report query result types: define TypeScript interface for each report's row shape

---

## ═══════════════════════════════════════════
## OBJECTIVE
## ═══════════════════════════════════════════

**Part 1:** Audit all raw SQL queries in `ReportEngine.ts` for missing `WHERE tenant_id` clauses.
**Part 2:** Implement AR Aging Summary and AP Aging Summary reports (backend + frontend).

**Why Part 1 is critical:** If ANY query in `ReportEngine.ts` is missing `WHERE tenant_id`, one tenant can see another tenant's financial data. This is a GDPR/legal violation and a trust-destroying security breach.

**Why Part 2:** AR Aging and AP Aging are the two most critical financial management reports. Finance teams cannot track overdue customers or vendors without them.

---

## ═══════════════════════════════════════════
## SCOPE
## ═══════════════════════════════════════════

### IN SCOPE

**Part 1 — Audit all queries in `ReportEngine.ts`**

For EVERY raw SQL query in the file:
1. Check: does it include `WHERE tenant_id = ${ctx.tenantId}` (or equivalent)?
2. If YES: add comment directly above the query: `// ✓ tenant_id filtered — ES-05 audit`
3. If NO: add the `WHERE tenant_id = ${ctx.tenantId}` clause; add the same comment

Create `apps/report-service/src/__tests__/report-tenant-isolation.test.ts`:
- For each query: set up two tenants with separate test data; run each query as tenant A; assert zero rows from tenant B appear in results

**Part 2 — AR Aging Summary**

Backend:
- Query: outstanding invoices bucketed by days overdue (0–30, 31–60, 61–90, 90+)
- Outstanding = `total_amount - COALESCE(paid_amount, 0)` where `paid_amount` is sum of payments
- As-of date parameter: `?asOf=2026-07-01` (defaults to today)
- Only invoices: `invoice_date <= asOf` AND `status NOT IN ('CANCELLED', 'DRAFT')` AND `outstanding > 0`
- Endpoint: `GET /api/v1/reports/ar-aging`
- Required permission: `PERMISSIONS.REPORT_VIEW` (verify this exists; add if not)

Frontend:
- New page: `apps/web-frontend/src/pages/reports/ArAgingPage.tsx`
- `ERPDataGrid` columns: Customer Name, 0–30 Days (₹), 31–60 Days (₹), 61–90 Days (₹), 90+ Days (₹), Total Outstanding (₹)
- Filter bar above grid: as-of date picker (defaults to today) + branch filter dropdown
- Footer row with column totals (use `ERPDataGrid` footer feature if available, else sum manually)
- Export to CSV button
- Currency displayed in Indian format (use `packages/shared-utils` currency formatter)
- Route: `/reports/ar-aging` (register in `apps/web-frontend/src/App.tsx`)
- Add to sidebar navigation

**Part 2 — AP Aging Summary**

Same structure as AR Aging but for suppliers:
- Uses `purchase_invoices` (or equivalent) + supplier payments
- Endpoint: `GET /api/v1/reports/ap-aging`
- New page: `apps/web-frontend/src/pages/reports/ApAgingPage.tsx`
- Route: `/reports/ap-aging`

**Register new reports:**
- `apps/report-service/src/domain/ReportRegistry.ts` — register AR Aging + AP Aging
- `apps/report-service/src/api/report.routes.ts` — add the two new route handlers

**Add missing index (if not already present):**
- `CREATE INDEX IF NOT EXISTS idx_invoices_tenant_date_status ON invoices(tenant_id, invoice_date, status)`

### OUT OF SCOPE
- Refactoring ReportEngine architecture
- Migrating raw SQL to Drizzle ORM
- Other report implementations (ES-17)
- Report PDF export (ES-20)

---

## ═══════════════════════════════════════════
## TESTING REQUIREMENTS
## ═══════════════════════════════════════════

`apps/report-service/src/__tests__/report-tenant-isolation.test.ts`:
1. Each existing ReportEngine query: tenant A data NOT visible in tenant B query results
2. Test setup: create tenant A + tenant B with separate invoices/customers

`apps/report-service/src/__tests__/ar-aging.test.ts`:
3. Create invoices aged 10, 45, 75, 95 days → each in the correct bucket
4. Fully paid invoice (outstanding = 0) → does NOT appear in AR aging
5. Partially paid invoice → appears with remaining balance only
6. Tenant isolation: tenant A AR aging returns zero tenant B rows

`apps/report-service/src/__tests__/ap-aging.test.ts`:
7. Same scenarios as AR aging but for supplier/purchase invoices

---

## ═══════════════════════════════════════════
## BUILD VERIFICATION
## ═══════════════════════════════════════════

```bash
pnpm --filter @erp/report-service build
pnpm --filter @erp/report-service type-check
pnpm --filter @erp/web-frontend build
pnpm --filter @erp/web-frontend type-check
pnpm lint
pnpm test --filter @erp/report-service
```

---

## ═══════════════════════════════════════════
## VERIFICATION CHECKLIST
## ═══════════════════════════════════════════

- [ ] ALL queries in `ReportEngine.ts` have `// ✓ tenant_id filtered — ES-05 audit` comment or a fix applied
- [ ] Tenant isolation test: create invoices for tenant A and B; AR aging for tenant A returns ZERO tenant B rows
- [ ] `GET /api/v1/reports/ar-aging?asOf=2026-07-01` returns correct bucket data for test invoices
- [ ] `GET /api/v1/reports/ap-aging` returns correct bucket data for test supplier invoices
- [ ] No-auth request to `/api/v1/reports/ar-aging` → 401
- [ ] Request without `REPORT_VIEW` permission → 403
- [ ] `ArAgingPage.tsx` renders at `/reports/ar-aging` — no blank screen, no console errors
- [ ] Filter bar: changing as-of date updates the data
- [ ] Export to CSV downloads with correct data
- [ ] `ApAgingPage.tsx` renders at `/reports/ap-aging`
- [ ] Both pages work in dark mode
- [ ] Existing reports still return correct data (not over-filtered)
- [ ] `pnpm lint` passes

---

## ═══════════════════════════════════════════
## REGRESSION CHECKLIST
## ═══════════════════════════════════════════

- [ ] Existing report pages (`ReportsPage.tsx`, `ReportViewerPage.tsx`) still load
- [ ] `/reports/schedules` still works (route fix from ES-01)
- [ ] All pre-existing reports return correct data after tenant_id filter audit
- [ ] Dashboard data unaffected
- [ ] `apps/report-service` starts cleanly

---

## ═══════════════════════════════════════════
## DEFINITION OF DONE
## ═══════════════════════════════════════════

- [ ] Zero raw SQL queries in `ReportEngine.ts` missing `tenant_id` filters
- [ ] All existing queries annotated with audit comment
- [ ] AR Aging and AP Aging return correct data for test scenarios
- [ ] Both pages render in browser with all UI components
- [ ] All tenant isolation tests pass
- [ ] Completion report saved at `ERP-PLANNING/phase-completions/ES-05_COMPLETION.md`

---

## ═══════════════════════════════════════════
## COMPLETION REPORT TEMPLATE
## ═══════════════════════════════════════════

**Save as:** `ERP-PLANNING/phase-completions/ES-05_COMPLETION.md`

```markdown
# ES-05 Completion Report — Report Tenant Isolation & Core Financial Reports
**Date:** [YYYY-MM-DD]
**Status:** COMPLETE

## Summary
[What was audited, what was fixed, what was built]

## Tenant Isolation Audit Results
- Total queries audited: [N]
- Queries already correct: [N]
- Queries that needed tenant_id fix: [N]
- List of fixed queries: [file:line for each fix]

## Files Changed
| File | Change |
|------|--------|
| apps/report-service/src/domain/ReportEngine.ts | Audited + [N] fixes |
| apps/report-service/src/domain/ReportRegistry.ts | Added AR/AP Aging |
| apps/report-service/src/api/report.routes.ts | Added 2 routes |
| apps/web-frontend/src/pages/reports/ArAgingPage.tsx | NEW |
| apps/web-frontend/src/pages/reports/ApAgingPage.tsx | NEW |
| apps/web-frontend/src/App.tsx | Added 2 routes |

## Tests Added
[List test files and pass counts]

## Test Results
pnpm test: [PASS] | pnpm lint: [PASS] | pnpm build: [PASS]

## Verification Results
[Checklist with ✅ / ❌]

## Issues Found During Audit
[Any queries that needed fixes — document which reports had missing tenant isolation]

## Phases Unblocked
ES-17 (needs AR/AP Aging as foundation)
```
