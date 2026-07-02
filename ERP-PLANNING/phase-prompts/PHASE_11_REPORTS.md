# PHASE 11 — REPORTS AND ANALYTICS — SESSION STARTER PROMPT

---

```
You are the Principal Full-Stack Engineer (Business Intelligence) on an enterprise Cloth Retail ERP. Your job: implement Phase 11 — all reports, dashboards, analytics, and scheduled report dispatch. Every transaction module is complete by now. This phase reads from them all. Do NOT redesign. Do NOT skip reports.

═══════════════════════════════════════════
MANDATORY READING
═══════════════════════════════════════════
All the file in teh phase-completion and phase prompt, readme.md adn all other .md files 
Read: ERP-PLANNING/TECH_AUDIT.md       <- full stack, all packages+versions, what NOT to add
Read: ERP-PLANNING/TEST_CREDENTIALS.md  <- test logins (email/password/tenantId) for dev/smoke testing
Read: ERP-PLANNING/ERP_MASTER_SPEC.md
Read: ERP-PLANNING/CODING_STANDARDS.md
Read all phase completion reports in ERP-PLANNING/phase-completions/
The report engine reads from tables built in Phases 2–10.

═══════════════════════════════════════════
REPORT ENGINE ARCHITECTURE
═══════════════════════════════════════════

All reports follow this pattern:
1. Report definition registered in ReportRegistry (slug, title, filters, columns)
2. ReportEngine.generate(slug, tenantId, branchIds, filters) → ReportResult
3. All reports respect: branch-scoped access, financial year boundaries, tenant isolation
4. Results > 10,000 rows → async job → download link (via Import/Export engine)
5. Results ≤ 10,000 rows → synchronous response
6. All reports support: screen display + PDF export + Excel export + CSV export
7. All reports can be scheduled (using Scheduler Engine from Phase 1)

ReportEngine interface:
  generate(slug, params): Promise<ReportResult | AsyncJobRef>
  schedule(slug, params, schedule, recipients): Promise<ScheduledReport>
  getById(reportSlug): ReportDefinition

═══════════════════════════════════════════
MILESTONE SEQUENCE
═══════════════════════════════════════════

MILESTONE 11.1 — Report Engine Framework
  Schema: report_schedules, report_run_history
  
  ReportRegistry: register all 50+ report definitions
  ReportEngine: core execution with filters, pagination, branch scoping
  ReportFormatter: JSON → PDF, Excel, CSV (use Puppeteer for PDF, SheetJS for Excel)
  
  API:
    GET  /api/v2/reports                          (list all available reports)
    GET  /api/v2/reports/:slug/definition         (columns, filters, description)
    POST /api/v2/reports/:slug/generate           (sync if small, async if large)
    GET  /api/v2/reports/jobs/:jobId/status       (async job status)
    GET  /api/v2/reports/jobs/:jobId/download     (signed URL for download)
    POST /api/v2/reports/:slug/schedule           (create schedule)
    GET  /api/v2/reports/schedules                (list schedules)
    DELETE /api/v2/reports/schedules/:id          (remove schedule)
    
  Scheduler job: every 5 minutes → check scheduled reports → run due ones → email

MILESTONE 11.2 — Sales Reports (build all 19 from roadmap)
  Complete list:
    sales-register, sales-by-customer, sales-by-item, sales-by-category, sales-by-brand,
    sales-by-salesperson, sales-by-branch, sales-by-payment-mode, day-book,
    outstanding-receivables (aging: 0-30, 31-60, 61-90, 90+ days),
    collection-report, credit-note-report, return-report, profit-by-invoice,
    profit-by-item, profit-by-category, quotation-conversion,
    customer-statement, sales-target-vs-actual
  
  Profit reports: (sale_price - unit_cost) × quantity per line
  
  Outstanding aging: classify each invoice by days overdue into 4 buckets

MILESTONE 11.3 — Purchase Reports (build all 13 from roadmap)
  Complete list:
    purchase-register, purchase-by-supplier, purchase-by-item, purchase-by-category,
    grn-report, pending-deliveries, outstanding-payables, payment-made-report,
    purchase-return-report, debit-note-report, expense-report,
    supplier-statement, po-vs-grn, price-trend

MILESTONE 11.4 — Inventory Reports (build all 14 from roadmap)
  Complete list:
    stock-summary, stock-by-warehouse, stock-by-category, stock-movement,
    stock-aging, slow-moving (no sale in X days, configurable),
    fast-moving, reorder-report, negative-stock,
    stock-valuation (FIFO method — use inventory_ledger to compute FIFO cost),
    stock-transfer-report, stock-adjustment-report,
    physical-verification, fabric-roll-report, reservation-report

MILESTONE 11.5 — Financial Reports (build all 15 from roadmap)
  Complete list:
    day-book, cash-book, bank-book, ledger,
    trial-balance, profit-loss, balance-sheet, cash-flow,
    accounts-payable (aging), accounts-receivable (aging),
    bank-reconciliation, expense-analysis, tds-report,
    depreciation-schedule, fund-flow

MILESTONE 11.6 — HR Reports
  payroll-report, salary-register, attendance-report, leave-report,
  alteration-report (revenue + pending), tailor-work-log-report

MILESTONE 11.7 — GST Reports (SEPARATE from Phase 7 computation — these are display reports)
  gst-register (all transactions), gstr1-summary, gstr3b-summary,
  hsn-summary, itc-report, reverse-charge-report

MILESTONE 11.8 — Owner Dashboard (rebuild from existing with all data)
  The dashboard is the most-used screen. Rebuild it for production quality.
  
  All data from CQRS projections (< 200ms load time):
  
  KPI Cards (real-time projection):
    Today Sales | Today Collection | Today Purchase | Today Expense
    Month Sales | Month Collection | Month Profit (est)
    
  Charts (weekly refresh from CQRS):
    1. Revenue Trend — last 12 months (LineChart, current FY vs previous FY overlay)
    2. Sales by Category — current month (PieChart)
    3. Payment Mode Split — current month (DonutChart)
    4. Customer Segment Health — CHAMPION/LOYAL/AT_RISK/LOST (DonutChart)
    5. Top 10 Items by Revenue — current month (HorizontalBarChart)
    6. Branch Comparison — if multi-branch (BarChart)
    7. Outstanding Aging — 4-bucket StackedBarChart
    8. Purchase vs Sales Trend — last 6 months (LineChart)
    
  Alert Widgets:
    - Items below reorder level (count + link to report)
    - Pending approvals (count + link)
    - Overdue alterations (count + link)
    - PDC cheques due this week (list)
    - Customers overdue > 90 days (count + ₹ amount + link)
    - GST filing due this month (GSTR-1, GSTR-3B dates)
    
  Frontend:
    Fully responsive (works on mobile for owner checking business from home)
    Dark mode complete

MILESTONE 11.9 — Scheduled Report Dispatch
  UI for schedule management:
    Pick report → configure filters → pick format → set schedule → add email recipients
  
  API:
    POST /api/v2/reports/schedules
      Body: { reportSlug, params, format, schedule, recipients: [{email, name}], active }
    
  Email: send as attachment (PDF or Excel) with professional template
  Unsubscribe token in email footer (one-click unsubscribe from that schedule)
  
  Pre-built schedules suggested on first login:
    Daily Day Book → owner email (daily 21:00)
    Weekly Outstanding Receivables → sales team (Monday 09:00)
    Monthly GSTR-1 Reminder → accountant (5th of month 10:00)

MILESTONE 11.10 — Real-Time POS Analytics
  POS screen sidebar (updates every 5 minutes):
    Today's invoice count (live badge)
    Today's total sales (live)
    Hourly sales chart: bar chart 09:00–21:00 (updates every 30 minutes)
    Current cash in drawer (running total)
    Last 5 invoices (quick view)

═══════════════════════════════════════════
ACCEPTANCE CRITERIA
═══════════════════════════════════════════

✅ All 50+ reports render correct data (spot-check 5 critical ones against manual calculation)
✅ Outstanding aging: correct classification of invoices into 4 buckets
✅ Profit report: sale_price - cost_price = profit per line (verified on 3 test invoices)
✅ Trial balance: DR = CR total (must pass or report shows unbalanced alert)
✅ Large report (> 10,000 rows): processed async, download link sent
✅ Scheduled report: email received at correct time with correct PDF attachment
✅ Dashboard: loads in < 300ms (all data from CQRS projections)
✅ All reports: branch-scoped (branch manager sees only their branch)
✅ FIFO stock valuation: cost computed correctly for 3 test scenarios


═══════════════════════════════════════════
POST-IMPLEMENTATION VERIFICATION CHECKLIST
═══════════════════════════════════════════

Once all milestones above are done, run every check below before generating the report.
Do NOT skip any step. Fix all issues found before moving on.

── 1. MILESTONE COMPLETENESS ────────────────────────────────────────────────
Re-read EVERY milestone in this prompt. For each one confirm:
  ✔ Schema table(s) exist in migration file
  ✔ Domain service / business logic implemented
  ✔ API routes registered with authenticate + requirePermission
  ✔ Zod validation on all request bodies and query params
  ✔ Outbox event written in same DB transaction (all state-changing ops)
  ✔ Audit log entry written
  ✔ Frontend page / component wired (if applicable)
List any milestone, sub-step, or field that is missing or partial. Fix before proceeding.

── 2. VALIDATION COVERAGE ───────────────────────────────────────────────────
For every new API route in this phase verify:
  ✔ 400 returned for invalid/missing request body fields
  ✔ 401 returned when Authorization header is absent
  ✔ 403 returned when user lacks required permission
  ✔ 404 returned for unknown IDs (with tenant_id scope — never leak cross-tenant data)
  ✔ 422 returned for business rule violations (insufficient stock, duplicate, etc.)
  ✔ All error responses use { error: { code, message, details? } } envelope
  ✔ All success responses use { data: { ... } } envelope

── 3. BUILD CHECK ───────────────────────────────────────────────────────────
Run build for every service and frontend touched in this phase:

  pnpm --filter @erp/<service-name> build      ← repeat for each modified service
  pnpm --filter @erp/web-frontend build
  pnpm --filter @erp/pos-frontend build        ← only if POS was changed

Zero build errors required. Fix all before proceeding.

── 4. TYPESCRIPT STRICT CHECK ──────────────────────────────────────────────
Run type-check for each modified service:

  pnpm --filter @erp/<service-name> type-check

Zero errors required. Specifically fix:
  ✔ No implicit `any` — use `unknown` or proper types
  ✔ All function return types declared
  ✔ No non-null assertions (!) unless unavoidable with a comment
  ✔ No `as unknown as X` casts without justification
  ✔ Consistent type imports (import type { ... })

── 5. LOCAL RUN & SMOKE TEST ────────────────────────────────────────────────
Start each modified service in dev mode:

  pnpm --filter @erp/<service-name> dev

Then test EVERY new API endpoint manually (curl or browser):
  ✔ Happy path returns correct response and status code
  ✔ GET /health returns { status: "ok" } on the service port
  ✔ Unauthenticated request returns 401
  ✔ Insufficient permission returns 403
  ✔ Invalid body returns 400 with field-level errors
  ✔ Full lifecycle flow works end-to-end (e.g., DRAFT → CONFIRM → PAID)

For frontend changes open http://localhost:5173, login, and verify:
  ✔ Navigate to every new page — no blank screen, no console errors
  ✔ Create, list, edit, delete flows all work
  ✔ Loading states, empty states, and error toasts display correctly
  ✔ Dark mode renders correctly on all new components

── 6. GENERATE PHASE COMPLETION REPORT ─────────────────────────────────────
Generate the Phase Completion Report using the template at:
  ERP-PLANNING/PHASE_COMPLETION_TEMPLATE.md

Save it as:
  ERP-PLANNING/phase-completions/PHASE_11_COMPLETION.md

The report must be generated and saved BEFORE closing this session.

```