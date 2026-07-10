# [PG-034] Cash Flow report — investing & financing sections

> Template version 1.0. Every gap-prompt file in this tree must follow this exact section order. Do not add sections; do not omit sections that apply. If a section genuinely does not apply to this gap, write "Not applicable — <one-line reason>" instead of deleting it, so the structure stays diffable across files.

**Category:** Accounting
**Priority:** Medium
**Complexity:** M — requires classifying existing cash movements by source rather than inventing new transaction types, plus one new account pattern for owner capital/loan financing
**Depends on:** none
**Blocks:** none
**Primary service(s)/package(s):** apps/accounting-service

---

## Overview

- **Business objective:** a proper Cash Flow Statement has three sections — Operating, Investing, Financing — because a business owner or lender reading it needs to distinguish "cash from day-to-day trading" from "cash spent buying/selling fixed assets" from "cash from loans or owner contributions/drawings." Today the report only ever shows Operating activity; Investing and Financing are permanently empty, which makes the statement incomplete for any tenant that buys/disposes fixed assets, takes a bank loan, or has owner capital movement — all of which this ERP already supports elsewhere (Fixed Assets & Depreciation module, an `Owner's Capital`/`Owner Drawings`/`Bank Loan` account already exist in the seeded Chart of Accounts) but none of which currently show up in this specific report.
- **Current implementation:** `apps/accounting-service/src/domain/ReportsEngine.ts`, `getCashFlow()` (lines 366-437). It computes `openingCash`/`closingCash` from `CASH_AND_BANK`-sub-typed accounts, buckets all cash in/out into two `operatingActivities` lines ("Cash received from customers" / "Cash paid to suppliers"), and hardcodes the rest:
  ```ts
  // Simplified direct method — classify cash flows by reference_type
  const operatingActivities = [
    { label: 'Cash received from customers', amount: totalCashIn },
    { label: 'Cash paid to suppliers', amount: -totalCashOut },
  ];
  const netOperating = netCashMovement;

  return {
    ...
    investingActivities: [],
    netInvesting: 0,
    financingActivities: [],
    netFinancing: 0,
    ...
  };
  ```
  Note the comment says "classify cash flows by `reference_type`" but the code doesn't actually do that — every cash movement in the period is lumped into the same two operating lines regardless of what caused it, and nothing is ever routed to investing/financing.
- **Current architecture:** the report queries `financial_entries` joined to `accounts` filtered to `account_sub_type = 'CASH_AND_BANK'`, aggregating `debit_amount`/`credit_amount` across the whole period with no further classification. `financial_entries` already carries `reference_type` and `reference_id` on every row (populated by `JournalEngine.post()` from whatever `referenceType`/`referenceId` the caller passed in) — this is exactly the signal needed to classify a given cash movement, it's just not being read for this purpose today.
- **Current limitations:** Fixed Asset purchase and disposal already post real journal entries (`FixedAssetService.dispose()`, lines ~261-337, posts a gain/loss journal referencing the disposal; asset purchase presumably posts via a similar path or manual journal against the `1500 Fixed Assets` account) — but the Cash Flow report has no logic to recognize a `CASH_AND_BANK` line whose *counter-account* was a Fixed Asset account as an investing activity rather than an operating one. Similarly, no financing-activity classification exists for the seeded `3010 Owner's Capital`, `3030 Owner Drawings`, or `2510 Bank Loan` accounts — a cash receipt for a bank loan or an owner capital injection today gets silently folded into "Cash received from customers."

## Existing Code Analysis

- **What already exists and should be reused:**
  - `FixedAssetService.dispose()` (`apps/accounting-service/src/domain/FixedAssetService.ts`, ~line 261) already posts a real journal with a `gainLossAccountId` line and a disposal-proceeds line referencing the disposed asset — this is exactly the data an investing-activities line needs (asset disposal proceeds). Fixed-asset *purchase* postings (wherever they're recorded — check whether purchase of a fixed asset currently goes through a manual journal entry via `POST /journal` referencing the `1500`-series accounts, since no dedicated "asset acquisition" service method was found in this pass) are the counterpart to trace for the outflow side.
  - The seeded `3010 Owner's Capital`, `3030 Owner Drawings` (`accountSubType: 'EQUITY'`), and `2510 Bank Loan` (`accountSubType: 'LONG_TERM_LIABILITY'`) accounts in `apps/accounting-service/src/domain/default-accounts.ts` already exist — no new account needs to be invented for financing activities, they've simply never been read by this report.
  - `financial_entries.reference_type`/`reference_id` (already populated on every posted line by `JournalEngine.post()`) is the mechanism to reuse for classification — no new column is needed to know *what* caused a cash movement, just a query that joins on it.
- **What should never be modified:** `getTrialBalance()`, `getProfitLoss()`, `getBalanceSheet()` are separate methods in the same file and must not be touched — this gap is scoped to `getCashFlow()` only. The underlying `financial_entries` append-only table and its DR=CR trigger are out of scope. `FixedAssetService`'s disposal/depreciation posting logic itself must not be modified — only *read* by the cash-flow classification query.
- **Prior related work:** `ERP-PLANNING/reports/FEATURE_INVENTORY.md` §5.6/§8 documents this exact gap ("cash flow is direct-method operating-only; investing/financing sections are always empty"). No phase-completion report has previously touched `getCashFlow()`.

## Architecture

- Keep the direct method (already the chosen approach, and simpler to reason about than switching to indirect method) but make the classification real instead of hardcoded, by joining the `CASH_AND_BANK` cash-movement rows to the *other side* of the same journal (same `journal_id`) and inspecting that counter-account's `account_sub_type` (and, where more precision is needed, `reference_type`):
  - Counter-account `account_sub_type = 'FIXED_ASSET'` (or `'ACCUMULATED_DEPRECIATION'`/gain-loss account referenced via a disposal journal's `reference_type = 'FIXED_ASSET_DISPOSAL'`) → **Investing activities** (asset purchase = outflow, disposal proceeds = inflow).
  - Counter-account `account_sub_type` is `'EQUITY'` and the specific account is `Owner's Capital`/`Owner Drawings`, or `account_sub_type = 'LONG_TERM_LIABILITY'` (e.g. `Bank Loan`) → **Financing activities** (capital injection/loan drawdown = inflow, drawings/loan repayment = outflow).
  - Everything else (the existing customer-receipt/supplier-payment cash movements, plus any other `CASH_AND_BANK` counter-party not matching the above) → **Operating activities**, same as today.
- This is a query-restructuring change inside `getCashFlow()`, not a new service or new event flow — no new architecture pattern is introduced. The three-section split is computed in one pass by grouping the existing `financial_entries` join result by counter-account classification instead of by nothing.
- Data flow: unchanged upstream (fixed-asset disposal/purchase and loan/capital journals already post through the existing `JournalEngine.post()` path) — this package only changes how `getCashFlow()` reads and buckets what's already there.

## Database Changes

Not applicable — no schema change. `financial_entries.reference_type`/`reference_id` and `accounts.account_sub_type` already carry everything needed to classify a cash movement; this is a report-query change only.

## Backend

- **`apps/accounting-service/src/domain/ReportsEngine.ts`, `getCashFlow()`:** restructure the SQL query to, for each `CASH_AND_BANK` financial-entry line in the period, join to the other `financial_entries` row(s) sharing the same `journal_id` (excluding the cash line itself) and read that counter-line's `account_sub_type`. Bucket the cash line's net amount into `operatingActivities`, `investingActivities`, or `financingActivities` per the rules in Architecture. Label each investing/financing line meaningfully (e.g. "Purchase of fixed assets", "Proceeds from disposal of fixed assets", "Bank loan received", "Bank loan repaid", "Owner's capital introduced", "Owner's drawings") rather than one generic bucket line, mirroring the existing style of the two operating lines.
- Handle the edge case where a single journal has more than 2 lines (e.g. a disposal journal with a cash line, a fixed-asset-cost line, and a gain/loss line) — the classification should key off whichever non-cash counter-account is present; if a journal genuinely has multiple non-cash counter-account types (rare, e.g. a compound entry), classify by the dominant/first non-cash account found and document that as a known simplification rather than trying to split one cash line across sections.
- No new Kafka events, no new permission constant — `CASH_FLOW_VIEW` continues to guard the existing route (`GET /reports/cash-flow` or wherever it's registered in `apps/accounting-service/src/api/reports.routes.ts`).
- No change to `FixedAssetService.dispose()`, `PostingMatrixService`, or any consumer that posts fixed-asset/loan/capital journals — this package only reads what they already write.

## Frontend

- The Cash Flow report page in `apps/web-frontend` (Accounting/Reports section) already renders `operatingActivities`/`investingActivities`/`financingActivities` arrays generically (since the API contract's shape doesn't change, only whether the latter two arrays are populated) — if the current component special-cases "always empty, so hide these sections," that conditional needs to be removed so the sections render once real data exists. No new page, route, or permission gating needed.

## API Contract

- `GET /reports/cash-flow?from=...&to=...` — response shape (`CashFlowReport` interface in `ReportsEngine.ts`) is unchanged: `{ operatingActivities: [...], netOperating, investingActivities: [...], netInvesting, financingActivities: [...], netFinancing, netCashMovement, openingCash, closingCash, generatedAt }`. Only the *contents* of `investingActivities`/`financingActivities` change from always-`[]`/`0` to real line items and real net totals when applicable transactions exist in the period.

## Multi-Tenant Considerations

No change to tenant-scoping — the restructured query still filters every join on `tenant_id` exactly as the existing `getCashFlow()` query does. No feature-flag gating needed; this is a completeness fix to an existing report, not a new opt-in capability.

## Integration

- **apps/accounting-service** only. This reads data already posted by `FixedAssetService` (fixed asset purchase/disposal journals) and by whatever manual/journal-entry path records loan/capital transactions (`POST /journal` with an appropriate `referenceType`, or a future dedicated loan-drawdown flow if one gets built) — no other service is touched, and no new cross-service event is introduced.

## Coding Standards

Reuses the existing raw-SQL-via-`sql` tagged-template pattern already used throughout `ReportsEngine.ts` (see `getTrialBalance()`, `getProfitLoss()`, `getBalanceSheet()` for the established style) rather than introducing an ORM query-builder chain or a new abstraction. No new framework, library, or pattern.

## Performance

- The new join (cash line → same-journal counter-line → its account's `account_sub_type`) adds one additional join to a query that already joins `accounts` to `financial_entries` — `financial_entries` already has an index on `(journal_id, tenant_id)` (`idx_financial_entries_journal` from `0002_phase6_accounting.sql`), which directly covers this new join's access pattern, so no new index is needed.
- Cash Flow reports are run per-period (typically monthly/yearly), not on a hot request path — no caching concern beyond what already applies to the existing report.

## Security

Not a security-sensitive change — same permission (`CASH_FLOW_VIEW`), same tenant-scoping, no new data exposure (the underlying fixed-asset/loan/capital journal data is already readable via other reports like Trial Balance/Balance Sheet; this just re-presents it correctly classified in one more report).

## Testing

- **Unit/integration tests** (extend or add to whatever test file covers `ReportsEngine` under `apps/accounting-service/src/__tests__/`, or a new `cash-flow.test.ts`): (a) a period with only customer-receipt/supplier-payment cash movements produces the same operating-only output as today (no regression); (b) a period including a fixed-asset purchase (cash out, counter-account `FIXED_ASSET`) correctly appears under investing, not operating; (c) a period including an asset disposal (via `FixedAssetService.dispose()`) with cash proceeds correctly appears under investing; (d) a period including a bank-loan drawdown or owner-capital injection correctly appears under financing; (e) `netOperating + netInvesting + netFinancing === netCashMovement` holds in every case (the three sections must still sum to the same total the report already computes today, since total cash movement doesn't change — only its classification does).
- **Regression:** re-run any existing test exercising `getCashFlow()` to confirm the operating-only baseline case is unaffected.

## Acceptance Criteria

- [ ] A tenant with only sales/purchase cash activity in a period sees identical `operatingActivities`/`netOperating` output to before this change, and `investingActivities`/`financingActivities` remain empty (correctly, since none occurred).
- [ ] A tenant that disposed a fixed asset within the reporting period sees the disposal proceeds under `investingActivities`, not folded into "Cash received from customers."
- [ ] A tenant with a bank-loan or owner-capital cash movement in the period sees it under `financingActivities` with a clear label.
- [ ] `netOperating + netInvesting + netFinancing` always equals the report's own `netCashMovement` (no cash movement is double-counted or dropped during reclassification).
- [ ] `pnpm --filter @erp/accounting-service test` passes, including new cash-flow classification tests.

## Deliverables

- **Files to create:** `apps/accounting-service/src/__tests__/cash-flow.test.ts` (or extend an existing reports test file if one already covers `ReportsEngine`).
- **Files to modify:** `apps/accounting-service/src/domain/ReportsEngine.ts` (`getCashFlow()` restructure only — no other method touched).
- **Migrations:** none.
- **APIs added/changed:** none (same route, response shape unchanged, contents of two previously-empty arrays now populated).
- **Events added/changed:** none.
- **Tests added:** operating-only regression case, fixed-asset-purchase investing case, fixed-asset-disposal investing case, loan/capital financing case, three-sections-sum-to-total invariant.

---

## Context Preservation (for a fresh AI session with no prior history)

**Previous Work Summary:** `accounting-service`'s Cash Flow report (`ReportsEngine.getCashFlow()`) computes real opening/closing cash and a real net cash movement from `CASH_AND_BANK`-sub-typed accounts, but only ever produces two hardcoded "operating" line items ("Cash received from customers" / "Cash paid to suppliers") and permanently empty `investingActivities`/`financingActivities` arrays — confirmed directly in code at lines 416-431 of `ReportsEngine.ts`. Fixed Asset purchase/disposal (`FixedAssetService`) and the seeded `Owner's Capital`/`Owner Drawings`/`Bank Loan` Chart-of-Accounts entries already exist and already post real journal entries — they just aren't read by this specific report.

**Current Objective:** make `getCashFlow()` classify each `CASH_AND_BANK` financial-entry line by its same-journal counter-account (via the existing `financial_entries.journal_id` join and `accounts.account_sub_type`), routing fixed-asset-related cash movements to Investing and loan/owner-capital-related cash movements to Financing, with everything else remaining Operating exactly as today.

**Architecture Snapshot:** (1) every journal line already carries `reference_type`/`reference_id` and is linked to its sibling lines via `journal_id`; (2) the Chart of Accounts already has the account types needed (`FIXED_ASSET`, `LONG_TERM_LIABILITY`, `EQUITY` sub-types) with no new account required; (3) `financial_entries` is append-only and indexed on `(journal_id, tenant_id)`, which the new join reuses; (4) the report keeps the direct method — no indirect-method rewrite.

**Completed Components:** Fixed Asset disposal posting (`FixedAssetService.dispose()`), the seeded loan/capital accounts, the existing operating-cash computation in `getCashFlow()` — all pre-existing and reused read-only.

**Pending Components:** the classification join/query logic itself, and (if it doesn't already exist) confirming how fixed-asset *purchase* (as opposed to disposal) is currently journaled, since that's the outflow side of investing activities and needs to be traceable the same way disposal already is.

**Known Constraints:** the three sections must always sum to the pre-existing `netCashMovement` total — this package reclassifies cash movements, it does not change the total cash movement figure. Must not touch `getTrialBalance()`, `getProfitLoss()`, or `getBalanceSheet()` in the same file.

**Coding Standards:** reuse the existing raw-SQL `sql` tagged-template style already used throughout `ReportsEngine.ts` — do not introduce a query-builder abstraction just for this method.

**Reusable Components:** `financial_entries` (with its existing `journal_id`/`reference_type` columns), `accounts.account_sub_type`, `FixedAssetService.dispose()` (read-only reference for how disposal journals are shaped).

**APIs Already Available:** the Cash Flow route itself (unchanged path/shape) — only its computed contents change.

**Events Already Available:** none new needed.

**Shared Utilities:** `@erp/sdk` (`TenantScopedDatabase`), `drizzle-orm`'s `sql` tagged template.

**Feature Flags:** none — completeness fix to an existing mandatory report.

**Multi-Tenant Rules:** every new join must carry the same `tenant_id` filter as the existing query.

**Security Rules:** unchanged — `CASH_FLOW_VIEW` permission continues to guard the route.

**Database State:** no schema change; depends on `financial_entries`/`accounts` as they exist today (post migration `0002_phase6_accounting.sql` onward).

**Testing Status:** no dedicated cash-flow classification test exists today — this is new test coverage, not an update to existing assertions (unlike PG-033, which does require updating existing test assertions).

**Next Session Plan:** single session — this is a self-contained query restructure in one method plus new tests.

**Prompt for the Next Session:** "Implement `ERP-PLANNING/production-gap-prompts/006-Accounting/35-cash-flow-investing-financing-sections.md` (PG-034): rewrite `apps/accounting-service/src/domain/ReportsEngine.ts`'s `getCashFlow()` to classify each cash movement by its same-journal counter-account's `account_sub_type` (`FIXED_ASSET` → Investing, `LONG_TERM_LIABILITY`/loan-and-capital `EQUITY` accounts → Financing, everything else → Operating as today), replacing the hardcoded empty `investingActivities`/`financingActivities` arrays. Verify the three sections always sum to the existing `netCashMovement` total. Add tests for each classification case."
