# Accounting Service — Comprehensive Enterprise Audit (2026-07-23)

Status: **Investigation complete, zero code changes made.** This is the read-only findings report requested before any implementation. Findings are ranked by severity; each includes business/technical impact so fixes can be sequenced and approved individually.

---

## 1. Current Accounting Architecture

Phase 6 (`ERP-PLANNING/phase-prompts/PHASE_6_ACCOUNTING.md`, completed 2026-06-30) built the whole core domain in one migration (`0002_phase6_accounting.sql`):

- **Double-entry engine**: `journals` (header) + `financial_entries` (lines) — append-only, partitioned by year, with UPDATE/DELETE blocked by DB trigger, and a `DEFERRED` constraint trigger (`validate_journal_balance_trigger`) enforcing `SUM(debit) = SUM(credit)` per journal at commit as a second line of defense behind the application-level check in `JournalEngine.post()`.
- **Chart of Accounts**: `accounts` table, parent/child hierarchy, `account_type`/`account_sub_type`/`normal_balance`, tenant-scoped, optimistic-locked (`version`).
- **Posting Matrix**: tenant-customizable `posting_matrix` table with a hardcoded `DEFAULT_POSTING_RULES` fallback (`PostingMatrixService.ts`); GST CGST/SGST/IGST splitting is hardcoded per event type regardless of tenant config.
- **11 event consumers** turning business events (invoices, GRNs, payments, returns, expenses, payroll, loans, RCM, stock adjustments) into journals.
- **Financial Year / Period Closing**: real 10-item pre-close checklist, genuine closing-entry posting (Revenue/Expense → Income Summary → Retained Earnings), month-level period locks.
- **Reports**: Trial Balance, P&L, Balance Sheet, Cash Flow, PnL-by-cost-center (in accounting-service) — **duplicated with divergent logic** in report-service (see §13).
- **Bank Reconciliation, Fixed Assets (SLM/WDV depreciation), TDS (194C/194H/194J), Cost Centers, Opening Balances wizard** — all present with real backing tables.
- **No** voucher-type modeling (payment/receipt/contra/journal vouchers are all just `journals` differentiated by `reference_type`), **no** approval/draft workflow on journals (post immediately), **no** multi-currency, **no** budget module, **no** recurring journals, **no** digital signatures.

## 2. Record-to-Report Workflow (as implemented)

```
Business event (Kafka, via outbox relay)
  → main.ts dispatches on event.eventType (16 topics wired, all verified live — see §5)
  → *AccountingConsumer.ts: JournalEngine.checkPeriodOpen() → PostingMatrixService.buildJournalEntry() → JournalEngine.post()
  → financial_entries (append-only) + DEFERRED DB trigger re-validates balance at commit
  → ReportsEngine sums financial_entries on demand for TB/P&L/BS/CF (no denormalized balance cache)
  → FinancialYearService.closeYear() posts closing entries, locks period_closures
```

Every stage was traced to real code; this is not aspirational. The one architectural gap: **journal period-tagging and period-closed checks use wall-clock `new Date()`, never the event's actual business/document date** (§7).

## 3. Modules Reviewed

Chart of Accounts, Account Groups, Journals (manual + all 11 automated consumers), Financial Year/Period Closing, Bank Accounts/Reconciliation, Customer/Supplier/Employee/Tax/Fixed-Asset ledgers (all modeled via `reference_type` on journals, not separate sub-ledger tables), GST Ledger (separate parallel table in gst-service, not joined to journals), Trial Balance/P&L/Balance Sheet/Cash Flow (both engines), Cost Centers, TDS, Opening Balances, RBAC/permissions, audit logging, API surface, gateway wiring, cross-service event integration for Sales/Purchase/Inventory/HR/GST/Scheduler.

## 4. Missing Enterprise Features (documented gaps, not bugs)

| Feature                                           | Status        | Note                                                                                                                                                                        |
| ------------------------------------------------- | ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Multi-currency                                    | **Not built** | PG-036 gap-prompt exists (XL effort), explicitly gated on product sign-off — correct to leave alone                                                                         |
| Budget module                                     | **Not built** | Explicitly documented as a deliberate scope exclusion (`purchase.ts:548-550` comment)                                                                                       |
| Recurring journals                                | **Not built** | Zero references anywhere in accounting-service                                                                                                                              |
| Journal/voucher approval workflow (draft→approve) | **Not built** | `journals.status` is `POSTED\|REVERSED` only — journals post immediately; upstream documents (expenses, payroll) have their own approval, but the journal itself never does |
| Digital signatures                                | **Not built** | No schema support at all                                                                                                                                                    |
| Voucher-type modeling                             | **Not built** | Everything is a `journal` + `reference_type`; no separate JV/PV/RV/CV tables                                                                                                |
| Departments (distinct from Cost Centers)          | **Not built** | Cost centers cover the use case partially; no separate dimension                                                                                                            |
| Cash Book (pure cash-drawer ledger)               | **Not built** | Neither service has one; `bank-book` requires a `bank_account_id`                                                                                                           |
| Control-vs-posting account flag on CoA            | **Not built** | Only implied by `is_system`/hierarchy, not an explicit enforced flag                                                                                                        |

## 5. Bugs Found

Ranked by severity. All are read-verified with file:line citations (from sub-agent research); none are speculative.

### CRITICAL

1. **Expense journals post ₹0 for every expense in the system.**
   `apps/purchase-service/src/domain/ExpenseService.ts:124,173` emits `{ expenseId, expenseType, totalAmount }`. `apps/accounting-service/src/consumers/ExpenseAccountingConsumer.ts:9-14,21` reads `p.grandTotal` (a field the producer never sends) → `amount` is always `0` → `PostingMatrixService` builds a 2-line journal with `debitAmount: 0, creditAmount: 0` → `JournalEngine.post()`'s balance check (`|0-0| > 0.01`) passes trivially, so the phantom entry posts successfully with no error, no log, no GL trail for the real amount.
   - **Business impact**: every expense (utilities, rent, professional fees, etc.) is invisible in P&L/GL despite the source document existing and being "approved/paid" — silently wrong financials, zero visibility since nothing errors.
   - **Same bug class** as the previously-fixed sale-return GST truncation (`d9d657e`) and invoice-interstate bug (`114bb4e`) — same root cause pattern (producer/consumer field-name drift), third occurrence, not yet swept for.
   - No test file exists for `ExpenseAccountingConsumer`, which is why it was never caught.

2. **Balance Sheet gives different, materially inconsistent numbers depending on which of two live endpoints is called.**
   `apps/accounting-service/src/domain/ReportsEngine.ts:477-512` adds a synthetic "Current Year Earnings" equity plug (from the open FY's unclosed P&L) so `isBalanced` is always true. `apps/report-service/src/domain/ReportEngine.ts:1389-1416` (`balance-sheet-report`, same `BALANCE_SHEET_VIEW` permission, reachable via the generic Reports Browser) has no such plug — it will show `totalAssets ≠ totalLiabilities + Equity`, off by exactly the unclosed period's net P&L.
   - **Business impact**: a user or auditor pulling the same report two different ways (dedicated Accounting page vs. Reports Browser) gets a "balanced" and an "unbalanced" Balance Sheet for the same tenant/period. This is a direct compliance/audit-readiness failure — the fix for this exact bug class was already applied once and never propagated (matches the known "fixed in one copy, not propagated" architecture pattern).

3. **Cash Flow Statement misclassifies all activity as Operating in report-service.**
   `apps/report-service/src/domain/ReportEngine.ts:1418-1464` buckets everything into 2 generic "Cash received/paid" Operating lines. `apps/accounting-service/src/domain/ReportsEngine.ts:538-662` does real Operating/Investing/Financing classification via a LATERAL join on the counter-account's sub-type. Closing cash balance matches between the two, but Operating Cash Flow — a headline solvency metric — is materially wrong in report-service for any tenant with loan draws or fixed-asset purchases.

### HIGH

4. **Journal reversal bypasses the period-closed check.**
   `journal.routes.ts:187` (`POST /journals/:id/reverse`) never calls `JournalEngine.checkPeriodOpen`, unlike manual journal creation (`journal.routes.ts:151`). A supervisor can reverse a journal into a period that's been explicitly locked via financial-year lock-period — inconsistent enforcement of the same control.

5. **Period tagging and period-closed checks use processing time, not the transaction's business date.**
   `JournalEngine.ts:88-90` derives `periodMonth`/`periodYear` from `new Date()` (now), and every consumer's `checkPeriodOpen(db, tenantId, new Date())` call checks against today's period — never the actual invoice/GRN/payment date. Consequence: closing March does not reliably block a March-dated invoice event that happens to be _processed_ in April — it posts into April's period instead of being rejected, and a genuinely backdated correction can't be tested against the period it claims to belong to.

### MEDIUM

6. **Financial-Year close checklist item 10 ("Owner 2FA re-authentication") is a no-op that claims otherwise.**
   `FinancialYearService.ts:257-263` hardcodes `passed: true` with a comment saying enforcement happens via an `x-2fa-verified` header at the route level. `financial-year.routes.ts`'s `/close` handler (lines 71-90) does not check any such header — the documented control does not exist. This is a compliance-checklist item silently always green.

7. **report-service's P&L has no computed subtotals.**
   `ReportEngine.ts:1355-1387` returns flat per-account rows only — gross profit / operating profit / net profit (which `ReportsEngine.ts:284-292` computes) are absent from the schema entirely (`ReportRegistry.ts:1043-1048` has no field for them). Anything built directly on the generic registry endpoint has no reliable way to show a bottom line.

8. **report-service Trial Balance has different "period" semantics and silently drops zero-activity rows** vs. accounting-service's cumulative-since-inception version — reconciling totals mask a real difference in what "period" means to a user switching between the two.

9. **Employee loan repayments never reach the GL.**
   `hr-service/src/api/payroll.routes.ts:486-500` decrements the loan balance in hr-service's own DB on payroll approval but emits no event carrying the deduction amount (only aggregate `totalNet` goes out). Employee Loans Receivable (account 1340) is debited once at disbursement and **never credited down** — permanently overstated relative to the true outstanding balance.

10. **TDS on supplier payments has no automatic posting.** `SupplierPaymentService.ts` computes zero TDS; the only path is a fully manual `POST /tds/deduct` an accountant must remember to call per payment.

11. **Depreciation batch is never scheduled.** `FixedAssetService.runMonthlyDepreciationBatch` is reachable only via a manual API call; a grep of `scheduler-service` for "depreciation" returns zero matches — no cron job exists.

### LOW

12. Silent zero/negative-amount skips with **no logging at all** in `RcmAccountingConsumer.ts:23`, `StockAdjustmentAccountingConsumer.ts:24`, `CogsAccountingConsumer.ts:24` (contrast: Payroll/EmployeeLoan consumers at least `logger.warn`).
13. `InvoiceAccountingConsumer.ts:94-100` and `PaymentAccountingConsumer.ts:104-107` treat "no original journal found for reversal" as a handled success (warn + return) rather than an error — a genuine race or upstream bug would be silently swallowed instead of retried/DLQ'd.
14. `accounts`, `cost-centers`, `posting-matrix` list endpoints return unpaginated full arrays, inconsistent with `journals`/ledger's `page`/`size` convention — fine at current CoA-sized data, a real risk at scale.
15. Dead permission constants: `VOUCHER_CREATE`/`VOUCHER_VIEW`/`VOUCHER_CANCEL` granted to ACCOUNTANT/ACCOUNTANT_SUPERVISOR in role-defaults but no voucher route/module exists anywhere — not caught by the existing dead-permission-constant regression test because that test only checks textual reference, not actual `requirePermission()` enforcement.
16. `OPENING_BALANCE_LOCK` is the only permission gating the entire opening-balances wizard including view — ACCOUNTANT/ACCOUNTANT_SUPERVISOR/AUDITOR can't even view opening-balance status. Plausibly intentional (one-time setup task) — flagged, not asserted as wrong.
17. `CashFlowPage.tsx` reads `a.description`, API returns `label` — activity-row descriptions render blank (amounts unaffected). Known, logged in PG-034 notes, never fixed.
18. `Gstr3bPage.tsx` reads a different response shape than `Gstr3bService.compute()` returns — every GSTR-3B value renders `—` regardless of backend correctness. Pre-existing, GST/accounting boundary.

### Test coverage gaps (not bugs, but risk)

- No `JournalEngine.test.ts` — the core balance-validation, reversal, and period-check logic has no direct unit test; consumer tests all mock `JournalEngine` entirely.
- Zero test files for `GRNAccountingConsumer`, `PayrollAccountingConsumer`, `RcmAccountingConsumer`, `StockAdjustmentAccountingConsumer`, `PurchaseReturnAccountingConsumer`, `ExpenseAccountingConsumer` — the last of which is exactly the consumer with the ₹0 bug (#1) that a test would have caught.

## 6. Bugs Already Fixed (recent commits + in-flight uncommitted work — verified, not re-flagged)

- `2de9f86` — bank-reconciliation tenant-isolation gap, one-way GST filing lock. **Swept for recurrence across all of accounting-service — no other instance found.**
- `b0dc883` — CoA never seeded on tenant provisioning (every journal post silently failed).
- `114bb4e` — invoice CGST/SGST/IGST lines silently dropped (isInterstate recomputed from a field the producer never sent); TDS 26Q 500 error; GST Register ₹0.00 display bug; CoA running-balance bug; missing Employee Loans Receivable account for pre-existing tenants.
- `d9d657e` — sale returns posted ₹0 to accounting and never reached GST ledger.
- `6b881af` — ACCOUNTANT granted `ACCOUNT_UPDATE` + report-view permissions. **Verified correctly wired to the actual route guards, not just granted-but-dead.**
- **Uncommitted, currently in the working tree** (verified as real/correct, not WIP-broken): dual-journal reversal on invoice cancellation (INVOICE_CONFIRMED + COGS_CALCULATED both reversed), cheque-bounce reference-type disambiguation (customer PAYMENT vs. supplier SUPPLIER_PAYMENT), sale-return GST amounts now forwarded to the posting matrix, new TDS Payable (2340) and Stock Adjustment Loss (6110) default accounts, new `PurchaseReturnAccountingConsumer` and `StockAdjustmentAccountingConsumer` — **both confirmed to have real, correctly-shaped producers and are NOT dead code.**

## 7. Remaining Risks (beyond the bug list)

- Cost centers exist but are explicitly "purely informational" — never enforced in balance validation, so no true cost-center-level budget control exists even though the dimension is captured.
- The GST ledger (gst-service) is a parallel table populated by its own Kafka consumers, not derived from `financial_entries` — a manual journal adjustment in accounting-service never appears in GST numbers, and vice versa. Architectural, matches the known "no cross-service transactional logic" pattern.
- Report-service and accounting-service will keep drifting on every future report change unless someone either merges them or establishes which one is canonical — right now both are live and user-reachable for the same 4 slugs.

## 8. Recommended Improvements (priority order)

1. Fix `ExpenseAccountingConsumer` field-name mismatch (Critical #1) — highest business impact, smallest fix.
2. Add the "Current Year Earnings" equity plug to report-service's Balance Sheet (Critical #2), and real 3-way Cash Flow classification (Critical #3) — or, better, have report-service call accounting-service's `ReportsEngine` instead of maintaining a second implementation, to close this class of drift permanently (worth discussing as an architectural option, not just a patch).
3. Add `checkPeriodOpen` to journal reversal (High #4).
4. Thread the actual business/document date through to `checkPeriodOpen`/period-tagging instead of `new Date()` (High #5) — larger change, needs care since it touches every consumer's call site.
5. Fix or remove the false 2FA-checklist claim (Medium #6).
6. Address Medium #7–#11 as a batch (report subtotals, employee-loan repayment event, TDS auto-posting, depreciation cron) — each independent, can be sequenced individually.
7. Low-severity items (#12–#18) — cheap, no architectural risk, batchable.
8. Add missing consumer tests, especially `ExpenseAccountingConsumer` (would have caught #1) and a direct `JournalEngine.test.ts`.

## 9. Test Coverage

15 accounting-service test files exist covering accounts, cash-flow, depreciation, employee-loan consumer, financial-year, fixed-asset concurrency, opening-balances lock, permission guards, cost-centers (+journal integration +PnL-by-cost-center), TDS, and the two most recently touched consumers (sale-return, invoice). Gaps: no `JournalEngine` direct unit test, no test for GRN/Payroll/Rcm/StockAdjustment/PurchaseReturn/Expense consumers (6 of 11).

## 10. Performance Benchmark

Not load-tested this session (out of scope for a read-only pass). Structural risk noted: unpaginated `accounts`/`cost-centers`/`posting-matrix` endpoints (Low #14); `financial_entries` is partitioned by year, which is the right structure for ledger volume.

## 11. Security Assessment

Strong. Every route has a permission preHandler; tenant-scoping swept clean across all mutating queries (only known gap already fixed in `2de9f86`); journals are genuinely immutable (no PUT/DELETE route, DB triggers block direct mutation); error handler registered before routes (no regression of the platform-wide bug); CORS methods include PUT/PATCH/DELETE; gateway `apiV2` wiring correct and consistent with frontend calls. Minor gaps: dead voucher permission constants (Low #15), audit-log write-after-commit ordering (consistent app-wide, not accounting-specific).

## 12. Double Entry Compliance Status

**Compliant.** App-level check in `JournalEngine.post()` (`|totalDr - totalCr| > 0.01` → throws `JOURNAL_UNBALANCED`) plus a DEFERRED DB trigger as a second line of defense. The only way a ₹0-vs-₹0 "balanced" phantom journal gets through is Critical #1 — the validation itself is correct, the bug is that both sides are wrongly zero, not unequal.

## 13. Financial Statement Accuracy

**Not fully accurate today** — Balance Sheet and Cash Flow Statement give different numbers depending on which of the two live report engines is queried (Critical #2, #3). Accounting-service's own versions are internally correct (BS balances via the earnings plug, CF is properly 3-way classified). Trial Balance and P&L reconcile in total but differ in row-set/subtotal presentation between engines (Medium #7, #8).

## 14. GST Integration Status

Functional for the flows swept this session (invoice, GRN, sale return now correctly carry CGST/SGST/IGST into journals). GST ledger remains a parallel, non-reconciled register relative to `financial_entries` (architectural, not a bug). GSTR-3B frontend rendering bug (#18) is a display-only issue at the GST/accounting boundary.

## 15. Banking Integration Status

Bank accounts, statement import, reconciliation items/matching, tenant-isolation all verified correct post-`2de9f86`. No bank-charge or interest-posting automation found (not requested as a specific gap-prompt; flagged as absent).

## 16. Audit Readiness Status

Good foundation: append-only ledger with DB-enforced immutability, real audit-log writes on every mutating accounting action, journal reversal (not deletion) as the only correction mechanism. Two things undercut full audit-readiness today: the false 2FA-checklist item (Medium #6) and the two-different-Balance-Sheets problem (Critical #2) — an auditor pulling numbers from the "wrong" endpoint would flag the books as literally not balancing.

## 17. Production Readiness Score

**~78/100.** Core double-entry engine, security/RBAC, tenant isolation, and audit logging are enterprise-grade. The score is held back by: one live financial-data-corrupting bug (Critical #1, small fix), one real cross-engine Balance-Sheet inconsistency (Critical #2, the single most audit-relevant finding), a misleading Cash Flow metric in one of two live endpoints (Critical #3), and a compliance checklist item that lies about its own enforcement (Medium #6). None of these require architectural rework to fix — they're targeted, well-understood, independently fixable issues consistent with the bug classes this codebase has already been through (field-name drift between producer/consumer, and fix-in-one-copy-not-propagated across the accounting-service/report-service split).

---

### Source material

Full detail behind every finding above (exact file:line quotes, additional low-severity notes, and the complete event-flow trace table) is available in this session's sub-agent research — ask if you want the raw traces re-surfaced for any specific finding before implementation.

---

## Fixes Applied (same session, 2026-07-23)

Implemented in priority order per user direction. Every fix verified: full test suites for accounting-service (76 tests), report-service (135 tests), hr-service (77 tests) all pass; `tsc --noEmit` clean for accounting-service, report-service, hr-service, scheduler-service.

| #            | Issue                                                                                                               | Root cause                                                                                                                                             | Fix                                                                                                                                                                              | Files                                                                                                               |
| ------------ | ------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| 1 (Critical) | Every expense posted a phantom ₹0 journal                                                                           | Consumer read `p.grandTotal`, producer sends `totalAmount`                                                                                             | Read the real field                                                                                                                                                              | `ExpenseAccountingConsumer.ts` + new test                                                                           |
| 2 (Critical) | Balance Sheet gives different numbers from the two live report engines                                              | report-service's version had no "Current Year Earnings" equity plug that accounting-service's already has                                              | Mirrored the plug (open-FY lookup + net P&L calc) into report-service                                                                                                            | `report-service/ReportEngine.ts` + test                                                                             |
| 3 (Critical) | Cash Flow in report-service bucketed everything as Operating                                                        | No counter-account classification (accounting-service already had it)                                                                                  | Mirrored the LATERAL-join 3-way classification                                                                                                                                   | `report-service/ReportEngine.ts` + 2 tests                                                                          |
| 4 (High)     | Journal reversal could post into a locked period                                                                    | `/journals/:id/reverse` never called `checkPeriodOpen`, unlike manual creation                                                                         | Added the same check                                                                                                                                                             | `journal.routes.ts`                                                                                                 |
| 5 (High)     | Journals tagged/checked against wall-clock processing time, not the event's actual time                             | Every consumer used `new Date()` for both `checkPeriodOpen` and period tagging                                                                         | Threaded `event.occurredAt` (or, for payroll, the run's own periodMonth/periodYear — more precise) through as `postingDate`, added to `JournalEntry`/`PostingContext`            | `JournalEngine.ts`, `PostingMatrixService.ts`, all 11 consumer files                                                |
| 6 (Medium)   | Silent zero/negative-amount skips had no log line                                                                   | Missing `logger.warn` in 3 consumers                                                                                                                   | Added warn logs                                                                                                                                                                  | `RcmAccountingConsumer.ts`, `StockAdjustmentAccountingConsumer.ts`, `CogsAccountingConsumer.ts`                     |
| 7 (Medium)   | Missing-journal-for-reversal cases silently "succeeded"                                                             | `warn` + `return` instead of throwing, masking a genuine anomaly (producer guarantees a journal exists at that point)                                  | Throw `BusinessError` so Kafka retries/DLQs                                                                                                                                      | `InvoiceAccountingConsumer.ts`, `PaymentAccountingConsumer.ts` + updated test                                       |
| 8 (Medium)   | Year-close checklist's "Owner 2FA" item claimed server-side enforcement that doesn't exist anywhere in the codebase | Comment described a header check never implemented                                                                                                     | Made the item honest (no false pass), documented as a real future feature needing product sign-off, not built unilaterally                                                       | `FinancialYearService.ts`                                                                                           |
| 9 (Medium)   | report-service P&L had no gross/operating/net profit subtotals                                                      | **Attempted fix reverted** — appending synthetic rows broke the "every row is a GL account" contract other consumers rely on (caught by existing test) | Documented properly; real fix needs a `ReportResult.summary` field reviewed against every consumer, not a rushed row-injection                                                   | `report-service/ReportEngine.ts` (comment only)                                                                     |
| 10 (Medium)  | report-service vs accounting-service Trial Balance had different "period" semantics                                 | accounting-service's version had no lower date bound at all (cumulative-since-inception)                                                               | Default period start to the current open financial year, pre-FY activity folds into opening balance                                                                              | `accounting-service/ReportsEngine.ts`                                                                               |
| 11 (Medium)  | Employee Loans Receivable permanently overstated after disbursement                                                 | hr-service decremented its own loan balance on payroll approval but emitted no event                                                                   | New `EMPLOYEE_LOAN_REPAID` event (producer) + new consumer handler (additive journal, same pattern as COGS_CALCULATED)                                                           | `hr-service/payroll.routes.ts`, `EmployeeLoanAccountingConsumer.ts`, `PostingMatrixService.ts`, `main.ts` + 2 tests |
| 12 (Low)     | Depreciation never ran automatically                                                                                | No scheduler job called the existing (idempotent) batch method                                                                                         | New internal route + monthly cron job                                                                                                                                            | `scheduler-internal.routes.ts`, `scheduler-service/system-jobs.ts`                                                  |
| —            | TDS auto-posting on supplier payment                                                                                | No TDS fields/rules exist anywhere in the data model                                                                                                   | **Deliberately deferred** — requires product-defined tax rules (sections/rates/thresholds), not a code bug; same gating this codebase already applies to multi-currency (PG-036) | —                                                                                                                   |
| —            | Pagination on accounts/cost-centers/posting-matrix list endpoints                                                   | Acceptable at current data volume per the report itself                                                                                                | **Deferred** — touches Chart-of-Accounts/Cost-Center frontend pages currently mid-edit in a concurrent session                                                                   | —                                                                                                                   |
| —            | Dead `VOUCHER_*` permission constants                                                                               | Already known from an earlier QA session and explicitly allowlisted in `dead-permission-constants.test.ts`                                             | **Not touched** — looks like a deliberate "reserved for a future Vouchers module" placeholder, not an oversight                                                                  | —                                                                                                                   |
| —            | `CashFlowPage.tsx` label/description mismatch                                                                       | Reported as still-open in earlier memory                                                                                                               | **Already fixed** in a prior session — verified, no action needed                                                                                                                | —                                                                                                                   |
| —            | `Gstr3bPage.tsx` field mismatch                                                                                     | Real, unfixed                                                                                                                                          | **Deferred** — file is currently modified/uncommitted in a concurrent session; avoided colliding with unknown in-flight work                                                     | —                                                                                                                   |

### Regressions caught and fixed during verification

- Changing `handleInvoiceCancelled`'s missing-journal case from warn-to-throw broke its own existing test (`invoice-accounting-consumer.test.ts`) — updated the test to assert the new (correct) throwing behavior.
- The report-service P&L subtotal fix broke `financial-reports.test.ts` (synthetic rows swept into category-based sums) — reverted the row-injection approach rather than patch around it.
- The Balance Sheet equity-plug and Cash Flow reclassification changes added new `db.execute` calls / changed query row shapes — updated `financial-reports.test.ts`'s mocks accordingly (added a no-open-FY case for Balance Sheet; added a fixed-asset-counter-account case for Cash Flow) rather than leaving them under-tested.

### New test coverage added

`journal-engine.test.ts` (balance validation + period-open guards — previously had zero direct tests), `expense-accounting-consumer.test.ts` (regression guard for the ₹0 bug), and new cases in `employee-loan-accounting-consumer.test.ts` for the new `EMPLOYEE_LOAN_REPAID` handler.
