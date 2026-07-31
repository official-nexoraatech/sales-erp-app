# Accounting Module — Fresh Production-Readiness Audit (2026-07-25)

Scope: `apps/accounting-service` (double-entry ledger, journals, chart of accounts, financial
year, posting matrix, Kafka consumers, report engine) + `apps/web-frontend/src/pages/accounting`
(not reached — see Untested section). Live-verified against tenant 2 "QA E2E Test Co" on the
running dev stack (gateway :3000, accounting-service :3019, Postgres via `docker exec
erp-postgres-primary psql`). Prior audit claims treated as leads only; everything below was
independently re-derived from the current `PostingMatrixService.ts` source, the live `accounts`
table, live `journals`/`financial_entries`/`inbox_events` rows, and live report API responses.

## Summary

The account-code mismatch bug is real, is broader than the 4 event types previously confirmed,
and is currently corrupting tenant 2's live books, not just a theoretical risk. Of 19 event
types with default posting rules in `PostingMatrixService.ts`, **6 live, reachable event types
silently fail to post at all** (`SUPPLIER_PAYMENT_MADE`, `GRN_APPROVED`,
`PURCHASE_RETURN_APPROVED`, `EXPENSE_APPROVED`, `EXPENSE_PAID`, `STOCK_ADJUSTMENT_LOSS`), plus a
7th (`PAYROLL_PROCESSED`) is also broken but is dead code with no producer. Live DB evidence:
tenant 2 has **27 APPROVED GRNs worth ₹761,800** and **26 supplier payments worth ₹866,000**,
and **not one ever posted a journal entry** — the `journals` table has zero rows with
`reference_type IN ('PURCHASE_RETURN','SUPPLIER_PAYMENT','EXPENSE')` and the only 3
`reference_type='GRN'` journals are unrelated RCM side-postings, not the core inventory/AP entry.
The live Balance Sheet for tenant 2 (fetched fresh) reports **negative total assets
(-₹786,120.35)** and an **Accounts Payable balance of exactly ₹0** despite the real payables
activity above — the report is mechanically "balanced" (debits=credits, because every journal
that _did_ post is individually valid double-entry) but is not a truthful picture of the
tenant's financial position. This is not a future risk; it is today's data.

The root cause has two independent layers, both confirmed:

1. **Wrong/missing account codes** in `DEFAULT_POSTING_RULES` (`PostingMatrixService.ts`) that
   don't match the actual seeded Chart of Accounts (`default-accounts.ts` / live `accounts`
   table for tenant 2).
2. **A platform-wide event-consumer footgun**: `PlatformEventConsumer` (`packages/platform-sdk/
src/events.ts`) claims the Kafka inbox row and runs the handler in the _same_ DB transaction.
   When the handler throws (e.g. `JOURNAL_INSUFFICIENT_LINES`), the whole transaction — including
   the inbox claim row — rolls back. The outer `catch` does write one line to raw
   `process.stderr` (not the structured `@erp/logger`) and attempts to mark the inbox row
   FAILED, but that UPDATE matches zero rows (the row was rolled back), so it's a silent no-op.
   Kafka's default auto-commit still advances the consumer offset, so the event is never
   retried, never DLQ'd, and leaves **zero row in `inbox_events`** — live-confirmed: all 138
   `accounting-service` inbox rows for tenant 2 are `PROCESSED`, none `FAILED`, which is only
   possible if failed attempts vanish entirely. `PlatformEventConsumer` is not accounting-specific
   — it's imported by search-service, scheduler-service, gst-service, sales-service too, so this
   failure-swallowing pattern is a platform-wide risk, not unique to accounting.

## Full Account-Code Mismatch Table

Live tenant-2 COA has 70 accounts, seeded from `apps/accounting-service/src/domain/
default-accounts.ts` (verified via `docker exec erp-postgres-primary psql ... SELECT
account_code, name FROM accounts WHERE tenant_id=2`). Two codes now in the seed source
(`6110` Stock Adjustment Loss, `2340` TDS Payable) are **absent from tenant 2's actual live
table** — provisioning drift: tenant 2 was seeded before those codes were added to
`default-accounts.ts` and never re-synced.

| Event Type                                                                                  | Debit code                       | Exists (live)?                                                                                | Credit code            | Exists (live)?              | Result                                                                                                                                                                       | Correct code(s)                                                              |
| ------------------------------------------------------------------------------------------- | -------------------------------- | --------------------------------------------------------------------------------------------- | ---------------------- | --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `INVOICE_CONFIRMED`                                                                         | 1120                             | Yes, but is **"Trade Debtors — Wholesale"**, not generic AR (real generic AR is 1100)         | 4000 (Sales Revenue)   | Yes                         | **Posts, mislabeled** — every invoice's AR lands in the Wholesale sub-ledger regardless of customer type                                                                     | AR line should resolve 1100, or a retail/wholesale-aware code                |
| `INVOICE_CANCELLED`                                                                         | — (reversal only)                | —                                                                                             | —                      | —                           | N/A                                                                                                                                                                          | —                                                                            |
| `PAYMENT_RECEIVED`                                                                          | 1010 (Cash in Hand)              | Yes                                                                                           | 1120                   | Yes (mislabeled, see above) | Posts, mislabeled                                                                                                                                                            | —                                                                            |
| `SUPPLIER_PAYMENT_MADE`                                                                     | **2010**                         | **No — doesn't exist**                                                                        | 1010                   | Yes                         | **BROKEN — 0 lines built, whole journal fails**                                                                                                                              | 2010 → **2100** (Accounts Payable)                                           |
| `GRN_APPROVED`                                                                              | 1310                             | Yes, but is **"Prepaid Expenses"**, comment says "Inventory Asset"                            | **2010**               | **No**                      | **BROKEN** — credit unresolved, both lines of the main rule skipped; GST-ITC block also fails (see below)                                                                    | 2010 → **2100**; 1310 should be 1200 (Inventory) or a dedicated GRIT account |
| `PURCHASE_RETURN_APPROVED`                                                                  | **2010**                         | **No**                                                                                        | 1310                   | Yes (mislabeled)            | **BROKEN**, same as above reversed                                                                                                                                           | 2010 → **2100**                                                              |
| `COGS_CALCULATED`                                                                           | 5000 (COGS)                      | Yes                                                                                           | 1200 (Inventory)       | Yes                         | **Works** — this is _why_ the Sales audit found COGS posting fine: it uses different, correct codes than GRN                                                                 | —                                                                            |
| `SALE_RETURN_APPROVED`                                                                      | 4900 (Sales Returns)             | Yes                                                                                           | 1120                   | Yes (mislabeled)            | Works                                                                                                                                                                        | —                                                                            |
| `EXPENSE_APPROVED`                                                                          | **5200**                         | **No — never existed in any seed**                                                            | **2010**               | **No**                      | **BROKEN, both sides wrong**                                                                                                                                                 | 5200 → **6000** (Operating Expenses); 2010 → **2100**                        |
| `EXPENSE_PAID`                                                                              | **2010**                         | **No**                                                                                        | 1010                   | Yes                         | **BROKEN**                                                                                                                                                                   | 2010 → **2100**                                                              |
| `PAYROLL_PROCESSED`                                                                         | **5110**                         | **No**                                                                                        | 1010                   | Yes                         | **BROKEN, but dead code** — grep confirms zero producers emit this event type anywhere in the repo; real payroll uses `PAYROLL_RUN_APPROVED`/`PAYROLL_RUN_DISBURSED` instead | 5110 → 6010 if ever wired; otherwise should be deleted                       |
| `PAYROLL_RUN_APPROVED`                                                                      | 6010 (Salaries and Wages)        | Yes                                                                                           | 2310 (Salary Payable)  | Yes                         | Works                                                                                                                                                                        | —                                                                            |
| `PAYROLL_RUN_DISBURSED`                                                                     | 2310                             | Yes                                                                                           | 1010                   | Yes                         | Works                                                                                                                                                                        | —                                                                            |
| `EMPLOYEE_LOAN_DISBURSED`                                                                   | 1340 (Employee Loans Receivable) | Yes                                                                                           | 1010                   | Yes                         | Works                                                                                                                                                                        | —                                                                            |
| `STOCK_ADJUSTMENT_LOSS`                                                                     | **6110**                         | **No (live) — missing from tenant 2's actual COA**, though present in current seed source     | 1310                   | Yes (mislabeled)            | **BROKEN live for tenant 2** (provisioning drift, not a code bug per se)                                                                                                     | Re-seed/backfill 6110 for existing tenants                                   |
| `STOCK_ADJUSTMENT_GAIN`                                                                     | 1310                             | Yes (mislabeled)                                                                              | 4100 (Other Income)    | Yes                         | Works, but posts stock gains into "Prepaid Expenses"                                                                                                                         | —                                                                            |
| `CHEQUE_BOUNCED`                                                                            | 1120                             | Yes (mislabeled)                                                                              | 1010                   | Yes                         | Works                                                                                                                                                                        | —                                                                            |
| `RCM_LIABILITY_POSTED`                                                                      | 1330 (RCM Tax Input Credit)      | Yes                                                                                           | 2330 (RCM Tax Payable) | Yes                         | **Works — live-confirmed**, 3 real journals (`journals.id` 138, 139, 161) for GRN #28/#29/#34, all correctly ₹250/₹100/₹150 balanced entries                                 | —                                                                            |
| `EMPLOYEE_LOAN_REPAID`                                                                      | 6010                             | Yes                                                                                           | 1340                   | Yes                         | Works                                                                                                                                                                        | —                                                                            |
| GST codes (payable side): CGST 2210 / SGST 2220 / IGST 2230                                 | —                                | Yes, all 3 exist                                                                              | —                      | —                           | Work (used by INVOICE_CONFIRMED / SALE_RETURN_APPROVED)                                                                                                                      | —                                                                            |
| GST codes (input/ITC side): CGST_INPUT **1410** / SGST_INPUT **1420** / IGST_INPUT **1430** | —                                | **No — none of the three exist under this numbering anywhere**, real seed uses 1321/1322/1323 | —                      | —                           | **BROKEN** (used only by GRN_APPROVED / PURCHASE_RETURN_APPROVED, both already broken)                                                                                       | 1410→**1321**, 1420→**1322**, 1430→**1323**                                  |

**Tally**: 19 defined event-type rule sets. 7 reference at least one nonexistent/wrong account
code (SUPPLIER_PAYMENT_MADE, GRN_APPROVED, PURCHASE_RETURN_APPROVED, EXPENSE_APPROVED,
EXPENSE_PAID, PAYROLL_PROCESSED, STOCK_ADJUSTMENT_LOSS); 6 of those 7 are live/reachable and
confirmed broken by live data (PAYROLL_PROCESSED is unreachable dead code). A further 4 event
types (INVOICE_CONFIRMED, PAYMENT_RECEIVED, SALE_RETURN_APPROVED, CHEQUE_BOUNCED) post
successfully today but silently misfile every Accounts-Receivable line into the "Trade Debtors —
Wholesale" sub-ledger (code 1120) regardless of whether the customer is retail or wholesale,
because the comment/intent was a generic "Accounts Receivable" account. `1310` has the identical
mislabeling problem for the inventory side (posts as "Prepaid Expenses").

## Live evidence the Balance Sheet is currently wrong for tenant 2

Queried directly (`docker exec erp-postgres-primary psql`, tenant_id=2):

- `grns`: 27 rows `status='APPROVED'`, `SUM(grand_total) = ₹761,800.00`
- `supplier_payments`: 25 `PAID` + 1 `FULLY_ALLOCATED`, `SUM(amount) = ₹866,000.00`
- `purchase_returns`: 9 rows `status='APPROVED'`
- `expenses`: 6 `PAID` + 1 `SUBMITTED`
- `journals` for tenant 2 grouped by `reference_type`: only `EMPLOYEE_LOAN (10)`, `GRN (3 —
all RCM side-postings, not core GRN entries)`, `INVOICE (82)`, `PAYMENT (33)`,
  `PAYROLL_RUN (4)`, `SALE_RETURN (5)`, `STOCK_ADJUSTMENT (1)`, plus 24 manual journals with no
  reference type. **Zero** rows with `reference_type IN ('SUPPLIER_PAYMENT','PURCHASE_RETURN',
'EXPENSE')`.

Fresh reports pulled live via `GET /api/accounting/reports/*` (accountant.supervisor token):

- **Trial Balance** (`asOf=2026-07-25`): `totalDebits = totalCredits = 1,038,412.85`,
  `isBalanced: true`. Mechanically self-consistent (every journal that _did_ post is valid
  double-entry) — this is not the same as being _correct_.
- **Balance Sheet**: `totalAssets = -786,120.35` (negative total assets — not possible for a real
  business), `Cash in Hand (1010) closing = -₹868,735.50` (deeply negative cash), `Inventory
(1200) = -₹31,834.85` (negative inventory), **`Accounts Payable (2100) = ₹0`** despite
  ₹761,800 of real approved GRN receipts and ₹866,000 of real supplier payments, `totalLiabilities
= ₹1,992.50` only (just the small GST-payable residuals), `isBalanced: true` (assets ==
  liabilities+equity, both -786,120.35) — again mechanically balanced, not economically correct.
- **P&L** (`2026-04-01..2026-07-25`): `totalRevenue = 130,850`, `totalCogs = 25,984.85`,
  `totalOperatingExpenses = 897,978` (100% payroll — no purchase/expense costs ever land here
  because GRN/EXPENSE_APPROVED never post), `netProfit = -788,112.85`. True profitability is
  unknowable from this report: real purchase/expense costs are entirely missing, so whatever the
  correct number is, it is **not** this one.
- **Cash Flow**: `"Cash paid to suppliers": -960,978` — this label is itself misleading; the real
  driver, cross-checked against the Trial Balance, is `PAYROLL_RUN_DISBURSED` (₹897,978) +
  `EMPLOYEE_LOAN_DISBURSED` (₹63,000) = 960,978 exactly. **None** of the ₹866,000 in real supplier
  payments is in this number, because `SUPPLIER_PAYMENT_MADE` never posts a cash line either — so
  paradoxically the "Cash paid to suppliers" figure is both mislabeled (it's actually
  payroll+loans) and simultaneously excludes real supplier cash outflows entirely.

Net: for a real tenant with this transaction history, the books are silently wrong today —
Accounts Payable is invisible, Inventory/Prepaid movement from purchases is invisible, real
operating costs are absent from P&L, and Cash Flow miscategorizes its single largest driver.

## What works (verified live)

- **INVOICE_CONFIRMED / PAYMENT_RECEIVED / SALE_RETURN_APPROVED / CHEQUE_BOUNCED**: post
  correctly (both codes resolve), matching the Sales audit's finding — 82 INVOICE journals, 33
  PAYMENT journals, 5 SALE_RETURN journals present and the Trial Balance ties out.
- **COGS_CALCULATED**: posts correctly — uses 5000/1200, which are both real, distinct from the
  broken 1310/2010 pair GRN uses. This directly answers task item 2: COGS works _because it
  happens to reference different, valid codes_, not because the underlying bug class was avoided.
- **PAYROLL_RUN_APPROVED / PAYROLL_RUN_DISBURSED / EMPLOYEE_LOAN_DISBURSED /
  EMPLOYEE_LOAN_REPAID**: all codes resolve; 4 PAYROLL_RUN + 10 EMPLOYEE_LOAN journals present
  and balanced.
- **RCM_LIABILITY_POSTED**: works, live-confirmed via journals 138/139/161 (₹250/₹100/₹150,
  each individually balanced) for GRNs #28, #29, #34.
- **Financial Year**: tenant 2 has one OPEN financial year (`FY2026-27`, 2026-04-01 to
  2027-03-31, `id=1`, `isCurrent=true`). `financial-year.routes.ts` gates `/close-checklist` and
  `/close` behind `FINANCIAL_YEAR_CLOSE`; confirmed live that **neither** ACCOUNTANT nor
  ACCOUNTANT_SUPERVISOR holds that permission (both get 403 `Missing permission:
FINANCIAL_YEAR_CLOSE` on `/financial-years/1/close-checklist`) — by design:
  `apps/tenant-service/src/rbac/role-defaults.ts` grants `FINANCIAL_YEAR_CLOSE` only to
  OWNER/SUPER_ADMIN, explicitly excluding it even from ADMIN (deliberate `.filter()` exclusion
  alongside PAYROLL_PROCESS and IMPERSONATE_USER). This is intentional, not a bug.
- **RBAC — ACCOUNTANT vs ACCOUNTANT_SUPERVISOR**: decoded both live JWTs. ACCOUNTANT has
  ACCOUNT_VIEW/CREATE/UPDATE, JOURNAL_VIEW/CREATE, and (per role-defaults comments from an
  earlier audit) all 4 report-view permissions (TRIAL_BALANCE/PROFIT_LOSS/BALANCE_SHEET/
  CASH_FLOW_VIEW) — confirmed present in the live token. ACCOUNTANT lacks
  `CANCEL_POSTED_JOURNAL` and all `FINANCIAL_YEAR_*` permissions; ACCOUNTANT_SUPERVISOR has
  `FINANCIAL_YEAR_VIEW` (can see FYs) plus `CANCEL_POSTED_JOURNAL`, `TDS_MANAGE`, fixed-asset
  management, e-Invoice/e-Way Bill generation, GSTR-1/3B filing — a real, sensible privilege
  escalation between the two roles.
- **`PlatformEventConsumer` idempotency mechanism itself** (the insert/`onConflictDoUpdate`
  claim + `returning()` check) is correctly race-free for the _successful_ path — this is the
  ES-24 fix noted in an earlier session and it holds up on inspection; the bug is specifically
  that failure and success share a transaction boundary, not that the idempotency logic is
  wrong.

## Other bugs/gaps found

1. **Same-transaction rollback swallows all consumer failures, platform-wide** — Severity:
   Critical. `packages/platform-sdk/src/events.ts` lines ~163-225: `db.transaction(async (trx) =>
{ claim inbox row; await handler(event, trx); mark PROCESSED })`. Any handler throw rolls back
   the claim row too. The catch block's "mark FAILED" `UPDATE` runs against `db.raw` (not `trx`)
   matching on `eventId+consumerService`, but that row no longer exists post-rollback, so it's a
   silent 0-row no-op. Live-confirmed: **all 138** accounting-service inbox rows for tenant 2 are
   `status='PROCESSED'`, zero `FAILED` — mathematically only possible if every failure vanishes
   without a trace in the DB. There IS one artifact: a raw `process.stderr.write(...)` line (not
   routed through `@erp/logger`, so not structured/searchable in whatever log pipeline exists) —
   so it's not _literally_ invisible to someone tailing container stdout at the right moment, but
   it is invisible to the `inbox_events` table, any DLQ, any dashboard, or any retry mechanism.
   Kafka's default auto-commit still advances past the message since `eachMessage` returns
   normally. **Confirmed platform-wide**: `PlatformEventConsumer` is imported (`grep`) by
   accounting-service, sales-service, search-service, scheduler-service, and gst-service — the
   same failure-swallowing applies to every consumer in every one of those services, not just
   accounting's posting matrix. This is a distinct, higher-priority fix from the account-code
   mismatches themselves: even after every code in the table above is corrected, any _future_
   misconfiguration in _any_ service's event handler will fail exactly this same silent way.

2. **`accountCode` mislabeling (1120, 1310)** — Severity: High. Both compile/run fine (the codes
   exist) but post to the wrong sub-ledger relative to their comments/intent. `1120` is "Trade
   Debtors — Wholesale," not generic Accounts Receivable, so retail invoices/payments/returns all
   land in the wholesale debtors bucket. `1310` is "Prepaid Expenses," not an inventory account,
   so the (broken) GRN/adjustment postings that reference it would misstate Prepaid Expenses even
   once the AP-side code is fixed. Both need either a real generic-AR/Inventory code substituted,
   or the comments and business logic reconciled with intent (should invoices split by customer
   type into 1110/1120, or all go through the parent 1100?).

3. **Test suite cannot catch this bug class by construction** — Severity: High (process gap).
   Every consumer test (`expense-accounting-consumer.test.ts`,
   `employee-loan-accounting-consumer.test.ts`, `invoice-accounting-consumer.test.ts`, etc.)
   `vi.mock('../domain/PostingMatrixService.js', ...)` — `buildJournalEntry` never runs for real.
   The one test that does exercise `PostingMatrixService.buildJournalEntry` directly
   (`posting-matrix-sale-return-gst.test.ts`) hand-builds a 4-row fake account list containing
   only the exact codes the test needs (4900/1120/2210/2220) — it would pass identically whether
   or not `2010`/`5200`/`1410` etc. exist anywhere, because it never populates them. No test
   anywhere in `apps/accounting-service/src/__tests__` loads the real 70-row
   `DEFAULT_ACCOUNTS`/seed list and asserts every `DEFAULT_POSTING_RULES` code resolves against
   it. This fully confirms the task's suspicion and is the concrete reason the bug shipped and
   has stood undetected through however many prior sessions.

4. **Test run: 5 failing tests, but likely test-infra breakage, not app bugs** — Severity:
   Medium/uncertain. `pnpm --filter @erp/accounting-service test` → **64 passed, 5 failed, 7
   skipped** (2 test files entirely skipped as integration-only:
   `fixed-asset-concurrency.integration.test.ts`, `tds-service.test.ts`; `accounts.integration
.test.ts` also skipped). All 5 failures are `expected 401 to be {403|422|200}` in
   `permission-guards.test.ts` and `opening-balances-lock.test.ts` — every failure is an
   authentication rejection (401) where the test expected the request to get _past_ auth and be
   evaluated for authorization/business-logic (403/422/200). This pattern strongly suggests a
   broken/stale JWT fixture or missing test env var in those two files rather than a real RBAC
   regression (other tests in the same files, using presumably-valid tokens, pass). Flagging as
   unconfirmed — did not chase down the fixture root cause given time budget.

5. **Provisioning drift for existing tenants** — Severity: Medium. `default-accounts.ts` now
   defines `6110` (Stock Adjustment Loss) and `2340` (TDS Payable) that tenant 2's live `accounts`
   table doesn't have, because tenant 2 was provisioned before those lines were added and nothing
   re-syncs already-provisioned tenants when the seed list changes. Any tenant provisioned before
   a given `default-accounts.ts` change is permanently missing that account until someone notices
   and manually creates it — same failure-shape as the PG-era "seedDefaultAccounts never ran
   automatically" bug noted in `default-accounts.ts`'s own comments, just for incremental
   additions instead of the initial seed.

6. **Cash Flow statement mislabels its own numbers** — Severity: Medium. "Cash paid to suppliers"
   in the live Cash Flow report is actually 100% payroll + employee-loan disbursement (₹960,978)
   and 0% real supplier payments (which never post at all, see above). Even once the AP bug is
   fixed, this label needs to be verified against the real cash-flow-statement categorization
   logic in `ReportsEngine.ts`/`ReportEngine.ts` — it may be a generic "everything non-customer"
   bucket rather than a true accounts-payable-specific computation.

## Untested / unknown areas

- `apps/web-frontend/src/pages/accounting` — not opened in a browser this session; all
  verification here was API/DB-level. Given the API-level bugs found, any UI screen surfacing
  Trial Balance/Balance Sheet/Cash Flow/AP aging would be displaying the same wrong numbers, but
  the UI layer itself (loading states, error handling, permission gating in the frontend) was not
  independently checked.
- Chart of Accounts CRUD constraint enforcement (task item 7) — only read-path/hierarchy-render
  logic (`accounts.routes.ts`) was skimmed; did not live-test creating a circular parent
  reference, mismatched `accountType` vs `parentId`'s type, or duplicate `accountCode`. Zod schema
  validates shape (`accountType` enum, `parentId` positive int) but no explicit
  parent-type-consistency check was found on a code read — not confirmed broken, just not
  exercised.
- Two-report-engine divergence (task item 10) — confirmed structurally: `report-service`'s
  `ReportRegistry.ts` independently registers `TRIAL_BALANCE_VIEW`/`PROFIT_LOSS_VIEW`/
  `BALANCE_SHEET_VIEW`/`CASH_FLOW_VIEW` report types with its own `ReportEngine.ts`, separate from
  accounting-service's `ReportsEngine.ts`. Unlike `PostingMatrixService`, a grep of
  `ReportEngine.ts` found no hardcoded account-code comparisons — it appears to aggregate by
  `accountType`/`accountSubType` from the same `financial_entries` table accounting-service
  writes to, so it would likely reflect the _same_ underlying (currently wrong) numbers rather
  than diverge further — but this was not live-executed this session (report-service's actual
  route path for these report types wasn't resolved in the time available) and is a
  code-inspection-only conclusion, not a live-verified one.
- Did not live-trigger a fresh event (e.g., approve a new Expense right now) to watch it fail
  in real time — the historical live data (27 GRNs, 26 supplier payments, 9 purchase returns,
  all with zero corresponding journals) was treated as stronger, higher-volume evidence than one
  more synthetic trigger would add, given the time budget.
- Fixed-asset and TDS integration tests are skipped entirely in this environment (no live DB
  fixture wired for `.integration.test.ts` files) — untested this session.

## Readiness score: 35/100

Justification: the ledger's _mechanics_ are sound (idempotent consumer claiming, deferred
trigger-enforced `financial_entries` balance validation, correct FY/RBAC gating, no double-entry
violations in what does post) — that's real engineering and it shows. But roughly a third of the
event types that are supposed to keep the books current for a retail/wholesale business
(everything AP-side: supplier payments, GRNs, purchase returns, expenses, plus stock-loss
write-offs) **have never posted a single journal entry for tenant 2's real operational history**,
and the resulting Balance Sheet is not merely incomplete — it reports **negative total assets**,
which is not a number any accountant or auditor could look at as "conservative under-reporting";
it's a broken report. This is a live financial-integrity bug affecting a real (test) tenant's
actual data today, compounded by a platform-wide silent-failure pattern that means the next
similar misconfiguration — in accounting or any of the other 4 services sharing
`PlatformEventConsumer` — will fail exactly as invisibly, and by a test suite that is structurally
incapable of catching this whole bug class because it never runs `PostingMatrixService` against a
realistic account set. Score reflects: solid core primitives, but the module's actual purpose —
producing a trustworthy financial position — is currently not being met for roughly half its
event surface, with no safety net (tests, alerting, DLQ) that would have caught or would catch it
going forward.
