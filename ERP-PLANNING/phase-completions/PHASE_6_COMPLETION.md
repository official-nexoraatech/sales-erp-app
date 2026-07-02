# Phase 6 — Accounting Domain: Completion Report

**Date completed:** 2026-06-30  
**Branch:** ERP-1  
**Build status:** ✅ `@erp/accounting-service` clean | ✅ `@erp/web-frontend` clean

---

## Milestones Delivered

### M6.1 — Double-Entry Engine (`JournalEngine.ts`)
- `post()`: ULID journal IDs, balanced debit/credit enforced via PostgreSQL DEFERRED constraint trigger
- `reverse()`: append-only reversal — original journal marked REVERSED, reversal journal posted
- `checkPeriodOpen()`: blocks posting into closed/locked financial periods
- `PostedJournal` return type with `journalId` + `linesPosted`

### M6.2 — Event Consumers (6 files)
All consumers follow the `EventHandler` pattern from `@erp/sdk`:
- `InvoiceAccountingConsumer` — `INVOICE_CONFIRMED` → DR Receivables / CR Sales + GST; `INVOICE_CANCELLED` → journal reversal
- `GRNAccountingConsumer` — `GRN_APPROVED` → DR Inventory / CR Payables + GST (interstate flag handled)
- `PaymentAccountingConsumer` — `PAYMENT_RECEIVED`, `SUPPLIER_PAYMENT_MADE`, `CHEQUE_BOUNCED`
- `SaleReturnAccountingConsumer` — `SALE_RETURN_APPROVED` → DR Sales Returns / CR Receivables
- `ExpenseAccountingConsumer` — `EXPENSE_APPROVED`, `EXPENSE_PAID`

All consumers use `PostingMatrixService.buildJournalEntry()` which looks up account codes from the configurable `posting_matrix` table.

### M6.3 — Financial Reports Engine (`ReportsEngine.ts`)
- **Trial Balance** — as-of-date, window-function running total, `isBalanced` flag
- **Profit & Loss** — revenue → gross profit → operating profit → net income breakdowns; date range
- **Balance Sheet** — assets vs liabilities + equity as of date; checks `assets = liabilities + equity`
- **Cash Flow** — direct method: operating / investing / financing sections with opening/closing cash

### M6.4 — Bank Reconciliation (`BankReconciliationService.ts`)
- `createBankAccount()` — links bank account to GL account
- `importStatement()` — inserts BANK-side items and auto-pulls unmatched BOOK-side journal entries
- `matchItem()` — matches BANK ↔ BOOK items, posts reconciliation journal
- `getReconciliationSummary()` — unmatched items count, variance
- `finalizeReconciliation()` — marks statement FINALIZED, blocks re-reconciliation

### M6.5 — Financial Year Management (`FinancialYearService.ts`)
- `create()` / `list()` — year lifecycle management
- `runCloseChecklist()` — 10-item pre-close gate: no draft invoices, no open GRNs, all payments allocated, bank reconciled, trial balance balanced, no unprocessed outbox, stock reconciliation done, no pending approvals, 2FA confirmed
- `closeYear()` — runs checklist → posts P&L→Retained Earnings closing entry → marks FY CLOSED
- `lockPeriod()` — month-level lock via `period_closures` table with upsert

### M6.6 — Fixed Asset Register (`FixedAssetService.ts`)
- `create()` — records asset with SLM/WDV method, posts DR Asset Account / CR Bank
- `computeMonthlyDepreciation()` — SLM: `(cost - salvage) / usefulLifeMonths`; WDV: `NBV × (rate/12/100)`
- `generateDepreciationSchedule()` — full amortization table for asset life
- `postMonthlyDepreciation()` — posts DR Depreciation Expense / CR Accumulated Depreciation per asset
- `runMonthlyDepreciation()` — batch run for all active assets in a period
- `dispose()` — calculates gain/loss, posts disposal journal, marks asset DISPOSED

### M6.7 — TDS Management (`TDSService.ts`)
- `computeTDS()` — 5 categories: 194C Individual (1%), 194C Company (2%), 194H (5%), 194J Professional (10%), 194J Technical (2%)
- `recordTDSEntry()` — posts journal + inserts `tds_entries` row with `periodMonth`/`periodYear`
- `getTDSLiability()` — PENDING deposits for a period
- `generateCertificate()` — Form 16A: derives quarter months, aggregates, inserts `tds_certificates`, marks entries DEPOSITED
- `get26QData()` — quarterly return data with supplier PAN, JOINs suppliers table

---

## API Routes (9 route modules under `/api/v2`)

| Module | Endpoints |
|--------|-----------|
| `accounts.routes` | Chart of Accounts CRUD |
| `opening-balances.routes` | Opening balance import |
| `journal.routes` | GET /journals, GET /journals/:id, POST /journals, POST /journals/:id/reverse, GET /accounts/:id/ledger |
| `reports.routes` | GET /reports/trial-balance, profit-loss, balance-sheet, cash-flow |
| `bank.routes` | POST /bank-accounts, POST/GET /bank-reconciliation/:accountId/\* |
| `financial-year.routes` | GET/POST /financial-years, GET close-checklist, POST close, POST lock-period |
| `fixed-assets.routes` | Full CRUD + depreciation-schedule + dispose + batch depreciation run |
| `tds.routes` | GET /tds/liability, POST /tds/deduct, POST/GET /tds/certificates, GET /tds/26q |
| `posting-matrix.routes` | GET/POST/PUT/DELETE /posting-matrix, POST seed |

---

## Frontend Pages (10 pages under `accounting/`)

| Route | Page | Key Features |
|-------|------|--------------|
| `accounting/journals` | JournalsPage | Paginated list, click to drill down |
| `accounting/accounts/:id/ledger` | LedgerPage | Date range filter, running balance |
| `accounting/reports/trial-balance` | TrialBalancePage | 9-column table, balance indicator |
| `accounting/reports/profit-loss` | ProfitLossPage | Revenue → Net income breakdown |
| `accounting/reports/balance-sheet` | BalanceSheetPage | Side-by-side assets vs liabilities |
| `accounting/reports/cash-flow` | CashFlowPage | 3-section direct method |
| `accounting/bank-reconciliation` | BankReconciliationPage | Click-to-match BANK/BOOK UX |
| `accounting/financial-years` | FinancialYearsPage | Checklist panel, close confirmation |
| `accounting/fixed-assets` | FixedAssetsPage | Asset register with NBV footer |
| `accounting/tds` | TDSPage | Monthly liability + 26Q quarterly |

---

## Shared Package Updates

**`packages/shared-types/src/permissions.ts`** — Added Phase 6 permissions:
```
CASH_FLOW_VIEW, FIXED_ASSET_VIEW, FIXED_ASSET_CREATE, FIXED_ASSET_UPDATE,
FIXED_ASSET_DISPOSE, TDS_VIEW, TDS_MANAGE, POSTING_MATRIX_VIEW, POSTING_MATRIX_UPDATE
```

**`apps/web-frontend/src/constants/permissions.ts`** — Mirrored above

**`apps/web-frontend/src/api/endpoints.ts`** — Added 7 new API client modules

**`apps/web-frontend/src/App.tsx`** — 10 lazy-loaded routes added

**`apps/web-frontend/src/components/Layout.tsx`** — 9 new sidebar items in Accounting group

---

## Database Guarantees Enforced

| Invariant | Mechanism |
|-----------|-----------|
| SUM(DR) = SUM(CR) per journal | PostgreSQL DEFERRED CONSTRAINT trigger on `financial_entries` |
| Append-only ledger | UPDATE/DELETE blocked by trigger on `financial_entries` |
| No posting to closed periods | `JournalEngine.checkPeriodOpen()` + `period_closures` table |
| Year-end close gate | 10-item checklist in `FinancialYearService.runCloseChecklist()` |
| TDS threshold enforcement | `computeTDS()` returns 0 if below threshold; `recordTDSEntry()` throws if amount = 0 |

---

## Build Fixes Applied During Implementation

1. `@erp/sdk` does not export `ERPEventPayload` — fixed all consumers to import from `@erp/types`
2. `event.payload` typed as `Record<string, unknown>` — all casts changed to `as unknown as PayloadType`
3. `exactOptionalPropertyTypes: true` violations — spread pattern (`...(val ? { key: val } : {})`) applied across all services and routes
4. `BankReconciliationService` select alias mismatch — `.select({ journalId: ... })` fixed
5. `FixedAssetService` schema field names — `assetName`→`name`, `accountId`, `disposalDate`
6. `TDSService` schema field names — `tdsSection`, `taxableAmount`, `periodMonth`/`periodYear`, `depositStatus`
7. `PostingMatrix` routes — `debitAccountCode`/`creditAccountCode` (varchar), `sortOrder` (not `priority`)
8. `PlatformEventConsumer` API — direct Kafka instantiation + `subscribe(topics, handler, dbFactory)`
9. Frontend pages — `ERPListSkeleton` → `ERPTableSkeleton`; `ERPPageHeader` requires `variant="list"`
10. `kafkajs` and `ulid` added to `accounting-service/package.json` dependencies

---

## Phase 7 Readiness

Phase 6 is complete. The following are unblocked:

- **Phase 7** (HR/Payroll Domain) — can consume accounting events from Phase 6
- **Reporting dashboards** — all 4 financial reports are API-ready
- **Audit trail** — all journal mutations go through `ctx.audit.log()`
- **Multi-tenant** — all queries scoped by `tenantId` via `TenantScopedDatabase`
