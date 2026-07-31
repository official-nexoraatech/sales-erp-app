# Reports Module — Production Readiness Audit (2026-07-25)

Scope: `apps/report-service` (report catalog, sync/async generation, PDF via Puppeteer, scheduled
reports, its own financial report engine) + `apps/web-frontend/src/pages/reports`. Verified live
against the running stack (gateway :3000, report-service :3015, accounting-service :3019) using
tenant 2 "QA E2E Test Co", role `owner@qa-e2e.local` plus `hr.manager@qa-e2e.local` and
`cashier@qa-e2e.local` for RBAC checks. Prior audit claims (DAP-2, 2026-07-22 second-wave fixes)
were treated as unverified leads and re-checked from scratch.

## Summary

The Reports module is in materially better shape than its change history suggests. The catalog
exposes 83 report definitions across 7 categories, and **every single one has a real
implementation** in `ReportEngine.ts` (no silently-missing report slugs — the earlier "43/25
broken reports" churn appears to have genuinely landed). A representative sample of 10 reports
across all 7 categories was generated live against tenant 2's real data and returned correct,
non-empty results. Async execution, CSV/Excel export, report scheduling, dashboard KPIs, and
date-range/branch filtering all work as designed. The unit test suite (135 tests, including a
90-case tenant-isolation sweep covering every report slug) passes in full.

The headline item this audit was asked to specifically re-verify — whether report-service's
financial-report engine still diverges from accounting-service's — comes back **clean**: Trial
Balance, Balance Sheet, P&L, and Cash Flow all reconcile exactly between the two engines for the
same tenant/period (see dedicated section below). This is a genuine positive finding; the
long-standing "two diverging engines" architectural risk does not currently manifest for these
four statements.

The real gaps found are narrower than expected: (1) the generic Reports Browser has **no PDF
export at all** — the run endpoint's format enum is `JSON | CSV | EXCEL` only, confirmed with a
live 422 — even though the underlying Puppeteer PDF pipeline itself works correctly for the 8
fixed internal document types (invoice, salary slip, P&L, etc.); and (2) ad-hoc ("MANUAL")
report runs are recorded with no `userId` at all in `report_run_history`, so there is no way to
audit which specific user generated a given Trial Balance, Payroll Report, or Salary Register —
only that someone in the tenant did, and when.

## What Works (verified live)

- **Catalog** — `GET /api/report/api/v2/reports` (via gateway) returns 83 reports grouped into
  SALES (19), PURCHASE (12), INVENTORY (13), FINANCIAL (15), HR (10), GST (6), ANALYTICS (8).
  Every slug in the registry has a matching `case` block in `ReportEngine.ts` — cross-checked by
  grepping both files; counts line up 1:1.
- **Sync report generation**, real tenant-2 data, sample across categories:
  - `sales-by-category` (SALES, sync): 1 row, `Uncategorized` bucket, 57 invoices, ₹221,392.50
    revenue, 100% share (all items in this tenant lack a category — a data setup gap, not a
    report bug).
  - `trial-balance-report` (FINANCIAL, sync): 17 non-zero accounts, period debit = period
    credit = ₹2,213,248.93, closing debit = closing credit = ₹1,085,874.39 — balanced.
  - `sales-revenue-trend` (ANALYTICS, sync): `2026-07`, 59 invoices, ₹229,792.50.
- **Async report generation**, triggered and polled to completion via
  `run-history/:runId`, all `COMPLETED` with real rows:
  - `sales-register` (run 15): 60 rows, e.g. `INV/26-27/00004`, GST Audit Karnataka Customer,
    ₹5,250 grand total.
  - `purchase-register` (run 16): 34 rows, e.g. `GRN-AUDIT-33`, Global Textiles Supplier,
    ₹21,000.
  - `stock-summary` (run 17): 5 rows, e.g. `AUDIT Test Item WACC`, 75 units, ₹3,750 total value.
  - `payroll-report` (run 18): 16 rows, e.g. Priya Sharma, ₹50,000 gross, ₹47,262 net.
  - `gst-register` (run 19): 91 rows, e.g. `GRN-AUDIT-33`, ₹1,000 total GST.
  - All reports with `supportsAsync: true` **always** run async regardless of the client's
    `async` flag (`if (runAsync || definition.supportsAsync)` in
    `analytics-reports.routes.ts`) — not a bug, but worth knowing; the frontend
    (`ReportViewerPage.tsx`) already has an explicit code comment acknowledging and
    polling around this.
- **CSV/Excel export**: `sales-by-category` exported as real CSV (`"Category","Invoices",...`)
  and a genuine `Microsoft Excel 2007+` xlsx binary (17.7 KB), both with correct data.
- **PDF generation infrastructure** (Puppeteer): confirmed working for 2 of the 8 internal
  document types via the internal-key-gated `POST /reports/pdf` — `PROFIT_LOSS` (80.8 KB, 1
  page, generated in 2.49s) and `TAX_INVOICE` (119.2 KB, 1 page, 2.60s). No hangs; the earlier
  documented watch-mode Puppeteer concern does not affect the live dist build.
- **Report scheduling**: created a real schedule (`POST /api/report/api/v2/report-schedules`,
  id 9) for `sales-register`, weekly cron `0 8 * * 1`, EXCEL format, one recipient; confirmed
  stored correctly and retrievable via `GET .../report-schedules`. `ScheduledReportJob` is
  self-contained (uses the `croner` library in-process, not a call-out to scheduler-service),
  guards each tick with a Redis `SET NX EX` distributed lock (PG-048, fail-closed on Redis
  errors), and is properly wired in `main.ts` (`.start()` / `.stop()` on shutdown).
- **Dashboard KPIs** (`GET /api/report/api/v2/dashboard/kpis`): real numbers for tenant 2 —
  month sales ₹419,842.50, month collection ₹304,342.50, month profit ₹171,129.25 (57
  invoices), total receivable ₹53,550, total payable ₹28,900.
- **Filtering**: date range and branch filtering both work — a narrow 2020 date range correctly
  returns 0 rows with no error; adding `branchId:1` to `sales-register` narrowed the async
  result from 60 rows to 53.
- **RBAC, per-report granular permission** (live-tested, not just code-read):
  - `hr.manager` (has `PAYROLL_VIEW`): `payroll-report` → 202 queued. Same user against
    `trial-balance-report` (needs `TRIAL_BALANCE_VIEW`, which HR lacks) → 403 `FORBIDDEN`.
  - `cashier` (lacks `PAYROLL_VIEW`): `payroll-report` → 403 `FORBIDDEN`. Same user against
    `sales-register` (has `INVOICE_VIEW`) → 202 queued.
  - This is real per-report enforcement, not a single blanket flag — matches each report's
    `permission` field in the registry.
- **Tests**: `pnpm --filter report-service test` → **135/135 passed**, 7 files: NumberSeriesEngine
  (9), ar-aging (7), ap-aging (6), financial-reports (17), report-tenant-isolation (90),
  scheduled-report (5), pg010-api-v2-dual-registration (1). The 90-case tenant-isolation suite
  statically verifies, for every one of the 83 report slugs, that the generated SQL binds two
  distinct tenant IDs correctly (mocked `db.execute`, inspects bound `sql` template values).

## The report-service vs accounting-service reconciliation (explicitly requested)

Generated all four core financial statements from **both** engines for tenant 2, same
period/as-of-date (`2026-01-01`–`2026-07-25` / as-of `2026-07-25`), and compared the numbers
directly:

| Statement     | report-service                                                                                                                  | accounting-service                                                                                                                                                          | Match?                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Trial Balance | periodDr=periodCr=₹2,213,248.93; closingDr=closingCr=₹1,085,874.39                                                              | identical (70 lines incl. zero rows vs report-service's 17 non-zero)                                                                                                        | **Exact match**                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Balance Sheet | ASSET −₹824,581.89, LIABILITY ₹1,992.50, EQUITY −₹826,574.39                                                                    | totalAssets −₹824,581.89, totalLiabilities ₹1,992.50, totalEquity −₹826,574.39, `isBalanced: true`                                                                          | **Exact match**                                                                                                                                                                                                                                                                                                                                                                                                                         |
| P&L           | REVENUE ₹130,850, OPERATING_EXPENSE ₹936,439.54, OTHER_INCOME ₹5,000, COGS ₹19,834.85, CONTRA_REVENUE ₹6,150 (flat, uncombined) | totalRevenue ₹130,850, totalOperatingExpenses ₹936,439.54, totalOtherIncome ₹5,000, totalCogs ₹25,984.85 (= COGS + contraRevenue folded together for gross-margin purposes) | **Same underlying numbers** — report-service's flat category sum nets to the identical netProfit (−₹826,574.39) as accounting-service; the only difference is presentation (accounting-service pre-aggregates contra-revenue into "cost" for its gross-profit line, report-service leaves it as a separate raw category and has no gross/operating/net subtotal fields at all — a pre-existing, in-code-documented gap, not a data bug) |
| Cash Flow     | operating in ₹92,242.50 / out −₹1,008,439.54, net operating −₹916,197.04, investing/financing 0, closing cash −₹916,197.04      | identical field-for-field                                                                                                                                                   | **Exact match**                                                                                                                                                                                                                                                                                                                                                                                                                         |

**Conclusion**: the two engines currently reconcile for all four statements. The negative
assets / negative cash figures are real and reflect the upstream posting-bug already documented
by the accounting-service audit (silent ₹0 AP / negative-asset issue) — report-service is
correctly surfacing the _same_ underlying (buggy) ledger data, not introducing a second,
independent divergence. Code comments in `ReportEngine.ts` (`balance-sheet-report`,
`cash-flow-report` cases) explicitly state the retained-earnings roll-up and cash counter-account
classification logic were deliberately mirrored from accounting-service's `ReportsEngine` — this
appears to be the durable result of the 2026-07-22 "second wave" fix, still holding today.

## Bugs / Gaps Found

1. **No PDF export for the 83-report catalog (High, UX/feature gap, not a crash).**
   `POST /api/v2/reports/:slug/run` validates `format` against `z.enum(['JSON','CSV','EXCEL'])`
   — requesting `PDF` returns a live `422 VALIDATION_ERROR`. `ReportViewerPage.tsx` has CSV and
   Excel export buttons only, no PDF button anywhere in the Reports Browser UI. The Puppeteer
   `PdfEngine` itself works fine (verified above) but is wired only to 8 fixed internal document
   types (`TAX_INVOICE`, `QUOTATION`, `DELIVERY_CHALLAN`, `PURCHASE_ORDER`, `PAYMENT_RECEIPT`,
   `PAYMENT_VOUCHER`, `SALARY_SLIP`, `PROFIT_LOSS`) via an internal-key-gated server-to-server
   route, not to the generic report catalog. This is a re-confirmation, not a new finding — the
   2026-07-22 note "PDF export... documented, not fixed" is still accurate as of today.

2. **No per-user attribution for ad-hoc report runs (Medium-High, audit/compliance gap).**
   `report_run_history` (schema: `packages/db-client/src/schema/report.ts`) has no `userId` /
   `requestedBy` column. The insert in `analytics-reports.routes.ts`'s `/run` handler sets
   `tenantId, reportSlug, params, format, status, triggeredBy: 'MANUAL', startedAt` — `req.auth.userId`
   is available on the request but is never captured. Confirmed via `grep -i audit` across
   `report-service/src` that no separate audit-log write exists either. Practical impact: for a
   tenant with multiple users holding `TRIAL_BALANCE_VIEW`/`PAYROLL_VIEW`/etc., there is no way
   to determine which specific user pulled a given sensitive financial or payroll report — only
   that the tenant did, and when. This matters for SOX-style controls and payroll-data privacy
   audits. `report_schedules` does capture `createdBy` correctly (confirmed live: schedule id 9
   → `createdBy: 2`); the gap is specific to ad-hoc/manual runs.

3. **Report-service P&L has no computed subtotals (Low-Medium, documented pre-existing gap,
   re-confirmed still present).** `profit-loss-report` returns flat category/account rows with
   no gross-profit / operating-profit / net-profit fields, unlike accounting-service's
   `ReportsEngine.getProfitLoss()`. The in-code comment (`ReportEngine.ts` ~line 1386) explains
   an earlier attempt to inject synthetic "SUBTOTAL" rows was reverted because it broke every
   consumer's "every row is a real GL account" assumption, and that a real fix needs a dedicated
   `summary` field reviewed against all consumers (Reports Browser table, CSV/PDF export) rather
   than a rushed shape change. Confirmed this is still open — any UI/consumer built directly on
   this endpoint's raw rows (rather than accounting-service's dedicated P&L endpoint) must
   re-derive gross/operating/net profit itself or risk getting it wrong (e.g. forgetting to fold
   `CONTRA_REVENUE` into cost when computing gross margin).

4. **Catalog-listing permission vs per-report permission are two different gates (Low,
   consistency note, not a security hole).** `GET /api/v2/reports` (catalog) requires a single
   blanket `REPORT_VIEW` permission; `POST /:slug/run` checks the report's own specific
   permission (e.g. `INVOICE_VIEW`, `PAYROLL_VIEW`). Live-confirmed: `cashier@qa-e2e.local` (who
   lacks `REPORT_VIEW` per the QA seed data) gets 403 on the catalog listing but would get 202 on
   `sales-register/run` if it called that endpoint directly with a known slug (it does have
   `INVOICE_VIEW`). Not exploitable beyond what the role is already entitled to per-report, and
   the frontend nav/route is gated by `REPORT_VIEW` so in practice this role never sees the
   Reports module UI at all — but it does mean "can this role list reports" and "can this role
   run a report" are not the same permission model, which could surprise someone auditing role
   grants by only checking `REPORT_VIEW`.

5. **Caching is present for exactly 1 of 83 reports** (`gst-payable-report`, `TenantScopedCache`
   over Redis, 180s TTL, fails open to Postgres on Redis error per the code's own comment). No
   other report result is cached anywhere in `ReportEngine.ts` (grep-confirmed). This means the
   "stale-data-after-write" risk this audit was asked to check is effectively bounded to a single
   report and a 3-minute window, by design — not a broad caching correctness problem.

## Untested / Unknown Areas

- Only ~10 of the 83 reports were individually executed against live data this session (7
  categories sampled per the task's minimum, plus BS/P&L/Cash Flow/CSV/Excel/dashboard). The
  remaining ~73 are implemented (case block present, and covered by the 90-case tenant-isolation
  unit test) but were not each individually run against live tenant-2 data in this pass.
- Did not observe an actual cron-triggered scheduled report firing end-to-end (i.e., did not wait
  for `0 8 * * 1` or manually force a tick) or confirm email delivery in Mailhog. Schedule
  creation/storage/listing was verified live; the send path (`ScheduledReportJob.runSchedule`)
  was verified by code read only (nodemailer transporter config, Redis lock, HTML-escaping fix
  for stored-XSS in email attachments — already fixed per in-code comment).
- Could not live-test true cross-tenant isolation with two real business-user JWTs from two
  different tenants — tenant 1 is explicitly marked "STALE, DO NOT USE" in
  `TEST_CREDENTIALS.md` and the only cross-tenant identity available
  (`operator@platform.local`) is a platform operator with no `REPORT_VIEW` grant, so it 403s
  before reaching any tenant-scoping logic. Isolation is instead evidenced by (a) explicit
  `.where(eq(table.tenantId, req.auth.tenantId))` on every list/detail route (code-read,
  confirmed) and (b) the 90-case unit-test suite that statically checks every report's SQL binds
  the caller's tenant ID and not a hardcoded/wrong one. This is strong but not equivalent to a
  live two-tenant request/response comparison.
- Did not attempt to force a report-run failure (e.g. malformed params bypassing zod, DB error
  mid-query) to confirm `FAILED` status and `errorMessage` surface correctly end-to-end in the
  UI beyond the code path already read in `ReportViewerPage.tsx`'s `onError`/`FAILED` handling.
- `generatedDocuments` table (`packages/db-client/src/schema/report.ts`) — a PDF/S3 "generated
  documents" archive with `GENERATING/READY/FAILED/EXPIRED` status — exists in the schema but no
  usage of it was found anywhere in `report-service/src` during this audit (not grepped
  exhaustively across all 15 services). If unused, it may be dead schema from a different
  service (e.g. a purchase/sales document-archival feature) rather than a report-service gap;
  flagging as unknown rather than asserting it's broken.

## Readiness Score: 82/100

**Justification**: This module is close to production-ready for its core purpose (report
generation, export, scheduling, and financial-statement accuracy). All 83 catalog reports are
implemented and unit-tested for tenant isolation; a representative live sample across every
category returned correct data; async execution, CSV/Excel export, scheduling, filtering, and
per-report RBAC all work correctly under live testing; and — the specific concern this audit was
asked to re-verify — the two financial-report engines (report-service vs accounting-service)
currently reconcile exactly across Trial Balance, Balance Sheet, P&L, and Cash Flow. Points are
withheld for: no PDF export path for the general report catalog (a real, user-facing feature gap
that has been open since at least 2026-07-22), no per-user audit trail for ad-hoc report runs (a
real compliance-relevant gap), and the P&L endpoint's lack of computed subtotals (a documented,
deliberately-deferred gap that pushes correctness risk onto any future consumer). None of these
are data-corruption or security-bypass bugs — they are feature/observability gaps in an
otherwise solid, well-tested module.
