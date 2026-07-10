# [PG-035] Opening Balance Wizard — full trial-balance validation

> Template version 1.0. Every gap-prompt file in this tree must follow this exact section order. Do not add sections; do not omit sections that apply. If a section genuinely does not apply to this gap, write "Not applicable — <one-line reason>" instead of deleting it, so the structure stays diffable across files.

**Category:** Accounting
**Priority:** Medium
**Complexity:** S — the check itself is a query/logic upgrade inside one existing route handler; no new wizard steps, no schema change
**Depends on:** none
**Blocks:** none
**Primary service(s)/package(s):** apps/accounting-service

---

## Overview

- **Business objective:** the Opening-Balance Wizard is a one-time, irreversible-after-lock operation that seeds a tenant's entire starting financial position (customer/supplier balances, stock, GL accounts, cash/bank). Once locked, these become the baseline every subsequent report (Trial Balance, P&L, Balance Sheet) builds on. If the pre-lock check doesn't actually verify that every category of entered data is internally consistent and reconciles against each other the way a real trial balance would, a tenant can lock in a genuinely unbalanced starting position — one that individually "balances" by the wizard's narrow definition but doesn't actually tie out sub-ledger-to-GL, and every downstream financial report inherits that error permanently (since locked opening balances aren't meant to be edited).
- **Current implementation:** `apps/accounting-service/src/api/opening-balances.routes.ts`, `POST /opening-balances/lock` (lines ~362-426). The check, verbatim:
  ```ts
  // Basic trial balance check: total DEBIT opening_balances should = total CREDIT
  // Simplified check — real implementation computes from all financial entries
  const allBalances = await ctx.db.raw
    .select()
    .from(openingBalances)
    .where(eq(openingBalances.tenantId, tenantId));

  let totalDebit = 0;
  let totalCredit = 0;
  for (const b of allBalances) {
    if (b.entityType === 'STOCK') continue; // stock is always DEBIT
    const amt = parseFloat(b.amount);
    if (b.balanceType === 'DEBIT') totalDebit += amt;
    else totalCredit += amt;
  }

  const difference = Math.abs(totalDebit - totalCredit);
  if (difference > 0.01) {
    throw new BusinessError('TRIAL_BALANCE_MISMATCH', ...);
  }
  ```
  This sums the raw `opening_balances` staging rows (entity types `CUSTOMER`, `SUPPLIER`, `ACCOUNT`, `CASH_BANK`) by `balanceType`, and **entirely excludes `STOCK` rows from the balance check** ("stock is always DEBIT" — true in isolation, but stock's value still needs a credit-side home, normally the Inventory *asset* account being debited and some equity/suspense account being credited during opening entry, which this check never verifies exists or matches).
- **Current architecture:** the wizard has 5 steps, each a separate `POST /opening-balances/{customers|suppliers|stock|accounts|cash-bank}` batch endpoint that upserts rows into one shared `openingBalances` staging table (`entityType` discriminator) and flips a boolean flag (`customersCompleted`, `suppliersCompleted`, etc.) on the single-row-per-tenant `openingBalancesWizard` table. `POST /opening-balances/lock` is the final gate — once locked (`status: 'LOCKED'`), the wizard rejects further writes to any step ('OPENING_BALANCES_LOCKED' `BusinessError`).
- **Current limitations:** the check (a) never touches `financial_entries`, `journals`, or `accounts` at all — it only looks at the wizard's own staging table; (b) skips `STOCK` entirely rather than folding its value into the debit side against an equity/suspense credit; (c) does not verify that a customer's opening balance actually nets against the `1120 Trade Debtors` account balance the wizard's "Accounts" step separately entered (i.e. no sub-ledger-to-GL reconciliation between the Customers step and the Accounts step, even though both ultimately represent the same Accounts Receivable figure from two different angles); (d) does the same for Suppliers vs. Accounts Payable, and for Cash/Bank rows vs. any GL cash/bank account entered separately in the Accounts step.

## Existing Code Analysis

- **What already exists and should be reused:** the wizard's 5-step UX and its `openingBalancesWizard`/`openingBalances` tables are correct and must not change shape — this package only strengthens what runs inside `POST /opening-balances/lock`, it does not add or reorder wizard steps. `ReportsEngine.getTrialBalance()` already exists and demonstrates the correct pattern for computing a genuine DR=CR balance from `financial_entries` — though note opening balances are deliberately staged in `openingBalances`, not yet posted to `financial_entries` (that posting, if it happens, is a separate concern from this check — confirm at implementation time whether locking the wizard also posts an opening journal via `JournalEngine.post()`, or whether `financial_entries` is populated by a different path; if no such posting currently exists, this package should not silently start creating one, since that would be a functional expansion beyond "fix the validation check").
- **What should never be modified:** the 5 step endpoints' request/response Zod schemas (`CustomerBalanceRow`, `SupplierBalanceRow`, `StockBalanceRow`, `AccountBalanceRow`, `CashBankRow`) and their upsert-then-flag-completion behavior — the user-facing wizard flow must stay exactly as it is. The `OPENING_BALANCES_LOCKED` post-lock write-rejection behavior is correct and untouched.
- **Prior related work:** `ERP-PLANNING/reports/FEATURE_INVENTORY.md` §5.6/§8 documents this exactly ("Opening-Balance Wizard ... simplified trial-balance check before lock — self-documented as simplified"), matching the code comment found here verbatim. No phase-completion report has previously modified this check.

## Architecture

- No redesign of the wizard's step flow. The upgrade is entirely inside the validation logic that `POST /opening-balances/lock` runs before flipping `status` to `LOCKED`:
  1. **Include stock in the balance equation** instead of skipping it: stock's total debit value (already computed today, just excluded from the sum) must be matched by an equal credit somewhere — either require the Accounts step to include a credit-side "Opening Stock Suspense" or "Owner's Capital" entry covering the stock value, or (simpler, and consistent with how a real opening-balance exercise works) treat the aggregate stock DEBIT total as part of the overall DR side of one combined equation across all 5 categories, so the wizard-wide check becomes: `SUM(all DEBIT rows across Customers+Suppliers+Stock+Accounts+CashBank) === SUM(all CREDIT rows across the same)`. This is the most surgical fix — it doesn't require inventing a new suspense account, just stops artificially excluding stock from the sum it was always implicitly part of.
  2. **Sub-ledger-to-GL reconciliation:** cross-check that the *sum* of all `CUSTOMER`-type opening balances matches whatever `1100`/`1120`-series Accounts Receivable figure (if any) was separately entered in the Accounts step — and analogously for Suppliers vs. Accounts Payable, and Cash/Bank rows vs. any cash/bank GL account entered in the Accounts step. In practice, this repo's convention is that the Accounts step is for *non-sub-ledger* GL accounts (P&L, other assets/liabilities) and Customers/Suppliers/CashBank are the sub-ledger detail that *replaces* needing a matching AR/AP/cash GL line — confirm this product assumption with whoever owns the wizard's original design intent before implementing a hard reconciliation requirement, since either genuinely correct interpretation is defensible; document whichever is chosen directly in the check's code comment so a future reader doesn't have to re-derive it. **Recommended interpretation (least invasive):** treat Customers/Suppliers/Stock/CashBank rows as authoritative sub-ledger detail that must NOT also be double-entered as GL lines in the Accounts step; the check should therefore *warn or reject* if the Accounts step contains an account with `accountSubType` in `('ACCOUNTS_RECEIVABLE', 'ACCOUNTS_PAYABLE', 'CASH_AND_BANK', 'INVENTORY')` — since those are meant to be represented via the dedicated Customers/Suppliers/CashBank/Stock steps instead, and double-entering both would silently double-count in the DR=CR sum.
  3. Keep the existing 5-step UX and the same `POST /opening-balances/lock` response shape — only the internal computation changes, plus a richer error message breaking down *where* the imbalance is (e.g. "Customers: 50,000 DR, Accounts: 45,000 CR — mismatch of 5,000" style detail) instead of just a single aggregate difference figure, so a user actually knows which step to go back and fix.
- Data flow: unchanged — `POST /opening-balances/lock` still reads from `openingBalances` only (no new table, no `financial_entries` dependency introduced unless investigation at implementation time reveals lock already posts a journal, in which case reconcile against that instead of duplicating logic).

## Database Changes

Not applicable — no schema change. This is a validation-logic upgrade against existing `openingBalances` rows; no new column or table is needed for the recommended (least-invasive) interpretation above. If a future product decision requires storing an explicit "Opening Stock Suspense" GL mapping, that would be a separate, later schema change — out of scope here.

## Backend

- **`apps/accounting-service/src/api/opening-balances.routes.ts`, `POST /opening-balances/lock`:** replace the current DEBIT/CREDIT sum-with-stock-excluded logic with: (a) include stock's DEBIT total in the overall sum; (b) add the double-entry guard described above (reject if any `ACCOUNT`-type row's linked account has a sub-ledger-covered `accountSubType`); (c) produce a structured, per-category breakdown in the error payload when the check fails, rather than one flat number.
- No new route, no new Kafka event, no new permission constant — `OPENING_BALANCE_LOCK` continues to guard this endpoint exactly as today.
- Investigate (as a pre-implementation step, not a new deliverable) whether locking already triggers any posting into `financial_entries`/`journals` via `JournalEngine` elsewhere in this file or a related service — if it does, the "full trial balance" framing in this gap's title should mean reconciling against that posted journal (reusing `ReportsEngine.getTrialBalance()`-style logic) rather than only the raw staging table; if it doesn't, the fix stays scoped to the staging-table-only check described above, and that scoping should be stated explicitly in the shipped code comment (replacing the current "Simplified check — real implementation computes from all financial entries" comment with an accurate description of what the upgraded check actually does).

## Frontend

- The Opening Balance Wizard UI (`apps/web-frontend`, wherever the 5-step wizard component lives under Accounting/Settings) should surface the richer per-category error breakdown when lock fails, instead of (or in addition to) today's single difference figure — so a user knows which step to revisit. No new step, no new page, no new permission gating.

## API Contract

- `POST /opening-balances/lock` — request unchanged (no body). Response on failure changes from a single `TRIAL_BALANCE_MISMATCH` message string to a structured error detail, e.g. `{ error: { code: 'TRIAL_BALANCE_MISMATCH', message: '...', details: { customers: { debit, credit }, suppliers: {...}, stock: {...}, accounts: {...}, cashBank: {...}, overallDifference } } }` — additive to the existing `BusinessError` envelope convention used elsewhere in this file, not a breaking shape change. Response on success unchanged (`{ data: { message, lockedAt, totalDebit, totalCredit } }`), with `totalDebit`/`totalCredit` now correctly including stock.

## Multi-Tenant Considerations

No change — the check already operates strictly within `WHERE tenantId = ...` scoping, and this package doesn't alter that. No feature-flag gating needed; this strengthens an existing mandatory validation, it isn't a new opt-in behavior.

## Integration

- **apps/accounting-service** only. No other service reads or writes `openingBalances`/`openingBalancesWizard`.

## Coding Standards

Reuses the existing `BusinessError` convention and the existing Zod-validated route-handler style already used throughout `opening-balances.routes.ts` — no new pattern introduced. If reconciliation against `financial_entries` turns out to be needed (see Backend section), reuse `ReportsEngine`'s existing SQL-aggregation style rather than inventing a new one.

## Performance

Not applicable — this check runs once per tenant, at wizard-lock time (a rare, one-time-per-tenant operation), against a small staging table (`openingBalances`, bounded by the number of customers/suppliers/accounts/items a tenant seeds) — no indexing/caching/pagination concern.

## Security

Not a security-sensitive change — same permission (`OPENING_BALANCE_LOCK`), same tenant-scoping. The only "risk" this package mitigates is a *data-integrity* one: a tenant locking in an opening position that looks balanced by a too-narrow definition but isn't truly reconciled, permanently biasing every downstream financial report.

## Testing

- **Unit tests** (extend or add to `apps/accounting-service/src/__tests__/` — no existing opening-balance test file was confirmed during research; check for one before creating a new one): (a) stock's DEBIT value is now included in the overall sum (a wizard that previously "balanced" by having stock's debit uncompensated for should now correctly fail, proving the old check's gap is closed); (b) a wizard where Customers/Suppliers/CashBank sub-ledger totals are double-entered as matching GL accounts in the Accounts step is rejected with a clear message identifying the double-entry; (c) a genuinely balanced 5-step wizard (all categories reconciling correctly, stock included) locks successfully; (d) the failure response includes the structured per-category breakdown, not just one aggregate number.
- **Regression:** any existing test exercising `POST /opening-balances/lock`'s happy path must still pass with the new stock-inclusive computation (adjust fixture data if a previously-passing "balanced" fixture only balanced because stock was excluded).

## Acceptance Criteria

- [ ] A wizard whose stock DEBIT total isn't matched by an equal aggregate CREDIT across Customers/Suppliers/Accounts/CashBank now correctly fails to lock (previously it would have locked, since stock was excluded from the sum).
- [ ] A wizard that double-enters a customer's balance both via the Customers step and via a matching Accounts-Receivable-sub-typed account in the Accounts step is rejected with a clear "double-entry" error rather than silently double-counting.
- [ ] A correctly-constructed, genuinely-balanced 5-step wizard still locks successfully (no false-positive regression).
- [ ] The lock-failure response includes a per-category breakdown, not just a single difference number.
- [ ] `pnpm --filter @erp/accounting-service test` passes.

## Deliverables

- **Files to create:** a new test file if none currently exists for `opening-balances.routes.ts` under `apps/accounting-service/src/__tests__/`.
- **Files to modify:** `apps/accounting-service/src/api/opening-balances.routes.ts` (`POST /opening-balances/lock` validation logic + error response shape); the Opening Balance Wizard's lock-failure UI in `apps/web-frontend` to render the new structured breakdown.
- **Migrations:** none.
- **APIs added/changed:** `POST /opening-balances/lock` — same path, richer failure-response `details`, corrected `totalDebit`/`totalCredit` computation (stock included).
- **Events added/changed:** none.
- **Tests added:** stock-inclusion regression case, double-entry-rejection case, happy-path lock case, structured-error-detail case.

---

## Context Preservation (for a fresh AI session with no prior history)

**Previous Work Summary:** the Opening Balance Wizard (`apps/accounting-service/src/api/opening-balances.routes.ts`) has 5 batch-entry steps (Customers/Suppliers/Stock/Accounts/CashBank) writing into a shared `openingBalances` staging table, gated by a single-row-per-tenant `openingBalancesWizard` completion tracker. `POST /opening-balances/lock` runs a check before permanently locking the wizard — today that check is self-documented in code as "Simplified check — real implementation computes from all financial entries," and it explicitly skips `STOCK` rows from the DR=CR sum ("stock is always DEBIT") without ever confirming stock's value is matched by an equal credit elsewhere, and never cross-checks sub-ledger totals (Customers/Suppliers/CashBank) against any matching GL account entered in the Accounts step.

**Current Objective:** upgrade the pre-lock check to (1) include stock's debit total in the overall balance equation instead of excluding it, and (2) guard against double-entering sub-ledger-covered account types (AR/AP/Cash-Bank/Inventory) in the separate Accounts step, which would silently double-count. Keep the wizard's 5-step UX completely unchanged — this is a validation-logic upgrade inside one route handler, not a UX redesign.

**Architecture Snapshot:** (1) all 5 steps write to one shared `openingBalances` table with an `entityType` discriminator; (2) the wizard-completion state lives in a separate single-row-per-tenant `openingBalancesWizard` table; (3) locking is currently the only place any cross-category validation happens; (4) it is not yet confirmed whether locking the wizard also posts a real opening journal to `financial_entries` via `JournalEngine` — this must be checked first, since it changes what "full trial balance" should mean here (reconciling against posted `financial_entries`, vs. reconciling only the staging-table categories against each other).

**Completed Components:** the 5-step UX, the staging table, the wizard-completion tracker, the post-lock write-rejection guard — all pre-existing and untouched by this package.

**Pending Components:** the validation-logic rewrite itself, and the investigation into whether opening balances get posted to `financial_entries` at lock time (this investigation should happen at the start of implementation, before writing the fix, since it determines the fix's scope).

**Known Constraints:** must not change the wizard's step count, step order, or per-step request/response shapes. Must not silently start posting to `financial_entries` if it doesn't already happen today (that would be a functional expansion beyond "fix the validation check," requiring separate product sign-off).

**Coding Standards:** reuse the existing `BusinessError` pattern and this file's existing Zod-validated route-handler style; reuse `ReportsEngine`'s SQL-aggregation style only if reconciling against `financial_entries` turns out to be in scope.

**Reusable Components:** the existing `openingBalances`/`openingBalancesWizard` Drizzle tables (no schema change); `ReportsEngine.getTrialBalance()` as a reference pattern only, not a direct dependency, unless the `financial_entries`-posting investigation says otherwise.

**APIs Already Available:** `POST /opening-balances/lock` itself (being modified, not replaced), the 5 step endpoints (untouched).

**Events Already Available:** `OPENING_BALANCES_LOCKED` (published inside the existing lock transaction) — no new event needed.

**Shared Utilities:** `@erp/types` (`BusinessError`), `@erp/sdk` (`PlatformEventBus`, `TenantScopedDatabase`).

**Feature Flags:** none.

**Multi-Tenant Rules:** unchanged — every query already filters on `tenantId`.

**Security Rules:** unchanged — `OPENING_BALANCE_LOCK` permission continues to guard the route.

**Database State:** no schema change; depends on the existing `openingBalances`/`openingBalancesWizard` tables as they exist today.

**Testing Status:** no dedicated test file for this route was confirmed to exist during research — check `apps/accounting-service/src/__tests__/` before assuming one needs to be created from scratch vs. extended.

**Next Session Plan:** single session — investigate the financial_entries-posting question first (quick grep/read), then implement the validation upgrade, then tests.

**Prompt for the Next Session:** "Implement `ERP-PLANNING/production-gap-prompts/006-Accounting/36-opening-balance-full-trial-balance-validation.md` (PG-035): first confirm whether `POST /opening-balances/lock` in `apps/accounting-service/src/api/opening-balances.routes.ts` already posts to `financial_entries` anywhere in this codebase; then upgrade its pre-lock check to include stock's debit total in the overall DR=CR sum (currently excluded) and to reject double-entry of sub-ledger-covered account types (AR/AP/Cash-Bank/Inventory) in the Accounts step, replacing the current 'Simplified check' comment with an accurate description of the new logic. Keep the wizard's 5-step UX and API shapes unchanged; add a structured per-category breakdown to the failure response."
