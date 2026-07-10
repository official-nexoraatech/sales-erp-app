# [PG-033] Real Income Summary account for year-end close

> Template version 1.0. Every gap-prompt file in this tree must follow this exact section order. Do not add sections; do not omit sections that apply. If a section genuinely does not apply to this gap, write "Not applicable — <one-line reason>" instead of deleting it, so the structure stays diffable across files.

**Category:** Accounting
**Priority:** Medium
**Complexity:** M — new system account type + restructured closing-entry journal lines, but no new UI and no change to the DR=CR trigger's rules
**Depends on:** none
**Blocks:** none
**Primary service(s)/package(s):** apps/accounting-service, packages/db-client

---

## Overview

- **Business objective:** standard double-entry year-end close routes every revenue and expense account's balance into a temporary **Income Summary** account first, then closes Income Summary's net balance into Retained Earnings. This gives an auditable, standards-conforming trail: an accountant (or an external auditor) can see "here is the one place all P&L accounts were zeroed out for the year, and here is the single net figure that moved into equity." The current implementation skips that intermediate step and posts a self-balancing pair directly against Retained Earnings, which is functionally correct for the *balance sheet* (Retained Earnings still ends up right) but is not a real closing entry an auditor would recognize, and it produces no record of which accounts were actually closed out.
- **Current implementation:** `apps/accounting-service/src/domain/FinancialYearService.ts`, `closeYear()` (lines ~270-322). It computes `pl = ReportsEngine.getProfitLoss(...)`, looks up the `RETAINED_EARNINGS`-sub-typed account, then posts:
  ```ts
  const { journalId } = await JournalEngine.post(trx, tenantId, userId, {
    description: `Year-end closing entry — net profit/loss for ${fy.yearCode}`,
    referenceType: 'FINANCIAL_YEAR',
    referenceId: financialYearId,
    lines: [
      {
        accountId: retainedEarningsAccount.id,
        debitAmount: pl.netProfit > 0 ? 0 : Math.abs(pl.netProfit),
        creditAmount: pl.netProfit > 0 ? pl.netProfit : 0,
        description: `Net ${pl.netProfit >= 0 ? 'profit' : 'loss'} — ${fy.yearCode}`,
      },
      // Counter-entry using a placeholder income summary account (same account as a self-balancing contra)
      {
        accountId: retainedEarningsAccount.id,
        debitAmount: pl.netProfit > 0 ? pl.netProfit : 0,
        creditAmount: pl.netProfit > 0 ? 0 : Math.abs(pl.netProfit),
        description: `Income summary — ${fy.yearCode}`,
      },
    ],
  });
  ```
  Note the code even looks up a `plAccount` (via `account_sub_type = 'SALES_REVENUE'`) a few lines earlier but never uses it — a leftover from an earlier, incomplete attempt at this exact fix.
- **Current architecture:** `closeYear()` runs the 10-item `runCloseChecklist()` (invoice/GRN/payment/bank-recon/trial-balance/outbox/stock/approval/2FA gates), and only if every item passes does it enter a `db.transaction()` that posts the closing journal via `JournalEngine.post()` and then locks the `financial_years` row (`status: 'CLOSED'`). The closing journal is subject to the same DEFERRED `validate_journal_balance` DB trigger (from `packages/db-client/migrations/0002_phase6_accounting.sql`) as every other journal in this system — any restructuring of the closing entry must still net to zero within that same transaction.
- **Current limitations:** because both lines of the closing entry hit the *same* account (`retainedEarningsAccount.id`), the entry is a no-op from Retained Earnings' own ledger perspective except for its net effect — `financial_entries` never shows a line against any actual revenue/expense account being "closed," and no Income Summary account exists anywhere in the Chart of Accounts to route through.

## Existing Code Analysis

- **What already exists and should be reused:** the "system-account protection" mechanism — `accounts.isSystem: boolean('is_system').notNull().default(false)` in `packages/db-client/src/schema/accounting.ts`, enforced in `apps/accounting-service/src/api/accounts.routes.ts` (`CANNOT_MODIFY_SYSTEM_ACCOUNT` / `CANNOT_DELETE_SYSTEM_ACCOUNT` on lines 157-158 and 206-207 when `existing.isSystem` is true). The new Income Summary account must be seeded with `isSystem: true`, exactly like the existing `RETAINED_EARNINGS`, `SALES_REVENUE`, `ACCOUNTS_RECEIVABLE`, etc. system accounts in `apps/accounting-service/src/domain/default-accounts.ts`.
  `ReportsEngine.getProfitLoss()` already computes exactly the revenue/COGS/expense breakdown needed to build the real closing lines — reuse its `revenue`, `otherIncome`, `cogs`, `operatingExpenses`, `financialCharges` line arrays (each already `{ accountId, accountCode, accountName, amount }`) instead of only using the final `netProfit` scalar.
  `JournalEngine.post()` already handles arbitrary multi-line balanced journals and the `financial_year_id` reference wiring — no change needed there.
- **What should never be modified:** the DEFERRED `validate_journal_balance` trigger and `prevent_financial_entries_mutation` trigger (both in `0002_phase6_accounting.sql`) must not be touched — the fix must produce a journal that already balances by construction, not rely on loosening the trigger. `runCloseChecklist()`'s 10 checklist items are unrelated and out of scope. `ReportsEngine.getBalanceSheet()`/`getTrialBalance()` read from `financial_entries` generically and need no change — once the closing entry posts correct account-level lines, these reports automatically reflect a properly-zeroed P&L for the closed year without any changes to their own code.
- **Prior related work:** no phase-completion report currently documents this area; `ERP-PLANNING/reports/FEATURE_INVENTORY.md` §5.6/§8 documents the gap as "closing entry posts a self-balancing pair to the same Retained Earnings account rather than a real Income Summary account — a modeling simplification, self-documented in code," matching exactly what was found here. `apps/accounting-service/src/__tests__/financial-year.test.ts` already exercises `closeYear()` and will need its assertions updated to match the new multi-line journal shape.

## Architecture

- Add one new system account, `Income Summary` (a new `accountSubType` value, e.g. `INCOME_SUMMARY`), seeded per-tenant alongside the existing default Chart of Accounts. Its `accountType` should be `EQUITY` (it's a temporary equity-adjacent clearing account in standard practice) or `INCOME` — this repo's existing `accountType` enum (`ASSET | LIABILITY | EQUITY | INCOME | EXPENSE | CONTRA`) has no dedicated "clearing" type, so `EQUITY` is the closest fit since Income Summary's balance ultimately rolls into Retained Earnings (also `EQUITY`); document this choice explicitly in the seed data comment so a future reader isn't confused by an income-flavored account classified as equity.
- Restructure `closeYear()`'s closing-entry construction into two journal-posting steps within the *same* transaction (still one atomic commit, just more lines in it):
  1. **Close revenue/other-income accounts to Income Summary:** for each line in `pl.revenue` + `pl.otherIncome` (each has a real `accountId` and `amount`), debit that account for its balance and credit Income Summary for the sum — zeroing every revenue account for the year.
  2. **Close expense/COGS/financial-charge accounts to Income Summary:** for each line in `pl.cogs` + `pl.operatingExpenses` + `pl.financialCharges`, credit that account for its balance and debit Income Summary for the sum — zeroing every expense account for the year.
  3. **Close Income Summary's net balance to Retained Earnings:** debit Income Summary / credit Retained Earnings for a net profit, or the reverse for a net loss — this is the one place Retained Earnings changes.
- This is three internally-balanced postings (or one big multi-line journal covering all three, since `JournalEngine.post()` accepts an arbitrary line array and only requires total DR = total CR across the whole set) rather than a schema/pattern change — no new architecture is introduced, this reuses the existing `JournalEngine.post()` single-journal-multi-line capability already used elsewhere (e.g. `PostingMatrixService.buildJournalEntry()` builds multi-line journals with GST splits the same way).
- Data flow: `FinancialYearService.closeYear()` → `ReportsEngine.getProfitLoss()` (already called, now its full line arrays are consumed instead of just `netProfit`) → build the 3-step journal line array → `JournalEngine.post()` (unchanged) → same DB trigger validates DR=CR across the whole set → `financial_years.closingEntriesJournalId` set as today.

## Database Changes

- **Schema change (not a new table):** extend the `accountSubType` TypeScript union in `packages/db-client/src/schema/accounting.ts` (the `.$type<...>()` on the `accounts.accountSubType` column) to add `'INCOME_SUMMARY'` alongside the existing 18 sub-types. Since the column is already `varchar('account_sub_type', { length: 50 })` with no DB-level `CHECK` constraint enforcing the enum (it's TypeScript-only typing), no `ALTER TABLE` is strictly required for the column itself — but a migration is still needed to seed the actual per-tenant Income Summary account row.
- **Migration:** next sequential file, `0035_pg033_income_summary_account.sql` (or `0036_...` if PG-032's migration lands first — confirm the latest number at implementation time). For each existing tenant, `INSERT INTO accounts (tenant_id, account_code, name, account_type, account_sub_type, normal_balance, is_system, ...) SELECT id, '3900', 'Income Summary', 'EQUITY', 'INCOME_SUMMARY', 'CREDIT', true, ... FROM tenants ON CONFLICT DO NOTHING`, using an account code (`3900`) that doesn't collide with the existing `3000`-`3030` Equity block or any other seeded code in `apps/accounting-service/src/domain/default-accounts.ts`. Also add the same entry to `DEFAULT_ACCOUNTS` in `default-accounts.ts` so every *new* tenant provisioned after this change gets it automatically at tenant-provisioning time (no code change needed there beyond the array addition — `tenant-service`'s provisioning step already iterates this array).
- **Rollback strategy:** additive only — no existing column, trigger, or table is altered. Rollback is `DELETE FROM accounts WHERE account_sub_type = 'INCOME_SUMMARY'` (safe only if no financial year has been closed with the new logic yet; once a tenant has closed a year through the new Income Summary account, that account has posted `financial_entries` against it and — per the existing `CANNOT_DELETE_SYSTEM_ACCOUNT` / "account has posted financial entries" guards already in `accounts.routes.ts` — cannot be deleted without first reverting the closing journal itself. This is intentional: once real closing entries exist through Income Summary, unwinding them is a financial-correction operation, not a schema rollback, and should go through `JournalEngine.reverse()` on the closing journal, not a DB rollback.

## Backend

- **`apps/accounting-service/src/domain/default-accounts.ts`:** add the `Income Summary` entry to `DEFAULT_ACCOUNTS` (code `3900`, `accountType: 'EQUITY'`, `accountSubType: 'INCOME_SUMMARY'`, `normalBalance: 'CREDIT'`, `isSystem: true`, `parentCode: '3000'`).
- **`packages/db-client/src/schema/accounting.ts`:** add `'INCOME_SUMMARY'` to the `accountSubType` TypeScript union.
- **`apps/accounting-service/src/domain/FinancialYearService.ts`, `closeYear()`:** replace the current two-line self-balancing block with the 3-step construction described in Architecture. Remove the now-genuinely-used `plAccount` lookup (currently dead — fetched, never used) and instead look up the Income Summary account the same way (`WHERE account_sub_type = 'INCOME_SUMMARY'`). If no Income Summary account exists for a tenant (e.g. one that pre-dates this change and hasn't had the backfill migration run, or somehow deleted its seed), throw a clear `BusinessError('INCOME_SUMMARY_ACCOUNT_MISSING', ...)` rather than silently falling back to the old placeholder behavior — this makes the gap impossible to silently regress to.
- No new Kafka events — the existing `JOURNAL_POSTED` event (published inside `JournalEngine.post()`) fires exactly as before, just with more/different lines in its payload's implied journal.
- No new permission constant needed — `FINANCIAL_YEAR_CLOSE` already guards the route that calls `closeYear()`.

## Frontend

Not applicable — no page-level change. The Financial Year Close page (wherever it lives in `apps/web-frontend`, under Accounting settings) already just triggers the close and shows checklist/result status; it doesn't render the closing journal's line-by-line detail today, and this package doesn't add that (out of scope — could be a follow-up if a user wants to see the itemized closing entries, but the request here is the correct entry existing at all, not a new UI to view it).

## API Contract

- No route path or request/response shape change to the financial-year-close endpoint itself (`POST /financial-years/:id/close`, wherever it's registered in `apps/accounting-service/src/api/financial-year.routes.ts`) — the observable contract (checklist pass/fail, then closed status) is unchanged. The only difference is what's actually posted to `financial_entries` under the hood, visible only via the Journal/Ledger views (`GET /journal/:journalId`, `GET /accounts/:id/ledger` if it exists) which already generically render whatever lines a journal has.

## Multi-Tenant Considerations

Each tenant needs its own Income Summary account row (system accounts are per-tenant in this codebase's Chart of Accounts model, not shared) — the backfill migration and the `DEFAULT_ACCOUNTS` addition both operate per-tenant, consistent with how every other system account already works. No feature-flag gating needed; this is a correctness fix to an existing mandatory close process, not an opt-in.

## Integration

- **apps/accounting-service** only. No other service reads or writes the closing journal or the Income Summary account. `tenant-service`'s provisioning flow (which seeds `DEFAULT_ACCOUNTS` for new tenants) picks up the new entry automatically with no code change on its side, since it already iterates whatever `default-accounts.ts` exports.

## Coding Standards

Reuses the existing `JournalEngine.post()` multi-line-journal capability, the existing `isSystem` system-account-protection convention, and the existing migration-file convention — no new pattern is introduced. The one genuinely new decision (classifying Income Summary as `EQUITY` rather than inventing a new `accountType`) is called out explicitly above rather than silently baked in, since it's a judgment call about this repo's existing 6-type enum rather than a mechanical extension.

## Performance

Not applicable — this adds a handful of extra `financial_entries` rows to a once-a-year operation (financial year close); no pagination, caching, or indexing concern. The existing indexes on `financial_entries` (`journal_id`, `account_id`, `tenant_id + created_at`) already cover the new rows' access patterns identically to every other journal's rows.

## Security

No new permission surface — `FINANCIAL_YEAR_CLOSE` continues to gate the operation. The Income Summary account itself is protected by the pre-existing `isSystem` guard against direct modification/deletion, exactly like other system accounts, so a non-privileged user cannot tamper with it outside the close process.

## Testing

- **`apps/accounting-service/src/__tests__/financial-year.test.ts`** (already exercises `closeYear()`): update existing assertions that currently check for the two-line self-balancing Retained-Earnings-only journal to instead assert the new multi-line journal correctly zeroes every revenue/expense account and nets the correct amount into Retained Earnings via Income Summary. Add new test cases: (a) net-profit year (revenue > expenses) posts Income Summary as a net credit rolled into Retained Earnings; (b) net-loss year does the reverse; (c) a tenant missing the Income Summary account (simulating pre-migration state) gets a clear `INCOME_SUMMARY_ACCOUNT_MISSING` error instead of silently falling back.
- **Regression:** confirm the DEFERRED `validate_journal_balance` trigger still passes for the new multi-line journal (i.e. the transaction commits without the trigger raising) — this is implicitly tested by any successful `closeYear()` test run, since the trigger fires at commit.
- **Integration test:** verify `ReportsEngine.getTrialBalance()` and `getBalanceSheet()` for a period *after* year-close show all revenue/expense accounts at zero and Retained Earnings correctly updated — this proves the Income Summary routing actually zeroed the P&L accounts, which the old two-line-on-Retained-Earnings approach never did.

## Acceptance Criteria

- [ ] A new tenant provisioned after this change has an `Income Summary` (`account_sub_type = 'INCOME_SUMMARY'`, `is_system = true`) account in its Chart of Accounts automatically.
- [ ] Existing tenants get the same account via the backfill migration, without any duplicate/conflicting account code.
- [ ] Running `closeYear()` for a financial year with a net profit produces `financial_entries` lines against every actual revenue/expense account used that year (not just against Retained Earnings), with Income Summary's net balance rolling into Retained Earnings.
- [ ] `ReportsEngine.getTrialBalance()` for the day after close shows every revenue/expense account at a zero closing balance, and Income Summary itself back at zero (its balance passed through, not parked).
- [ ] The DEFERRED `validate_journal_balance` trigger does not raise for the new multi-line closing journal (transaction commits cleanly).
- [ ] `pnpm --filter @erp/accounting-service test` passes, including updated `financial-year.test.ts` assertions.
- [ ] Attempting to close a year for a tenant with no Income Summary account (simulated) fails with a clear, actionable error rather than silently reverting to the old placeholder behavior.

## Deliverables

- **Files to create:** `packages/db-client/migrations/0035_pg033_income_summary_account.sql` (number to be confirmed against latest at implementation time).
- **Files to modify:**
  - `apps/accounting-service/src/domain/default-accounts.ts` (add Income Summary to `DEFAULT_ACCOUNTS`)
  - `packages/db-client/src/schema/accounting.ts` (add `'INCOME_SUMMARY'` to `accountSubType` union)
  - `apps/accounting-service/src/domain/FinancialYearService.ts` (`closeYear()` restructure)
  - `apps/accounting-service/src/__tests__/financial-year.test.ts` (updated + new assertions)
- **Migrations:** one new migration seeding the Income Summary account for existing tenants.
- **APIs added/changed:** none (same route, different internal posting logic).
- **Events added/changed:** none (same `JOURNAL_POSTED` event, richer payload).
- **Tests added:** net-profit close, net-loss close, missing-Income-Summary-account error case, post-close trial-balance verification.

---

## Context Preservation (for a fresh AI session with no prior history)

**Previous Work Summary:** `accounting-service`'s year-end close (`FinancialYearService.closeYear()`) runs a 10-item pre-close checklist, then posts a closing journal. Today that journal is a two-line self-balancing pair that both hit the Retained Earnings account — the code's own comment calls this "a placeholder income summary account (same account as a self-balancing contra)." No Income Summary account exists in the Chart of Accounts. `ReportsEngine.getProfitLoss()` already computes the full revenue/expense breakdown by account but `closeYear()` only currently uses its final `netProfit` scalar.

**Current Objective:** add a real, system-protected Income Summary account per tenant, and restructure the closing journal into a proper 3-step close: (1) revenue/other-income accounts → Income Summary, (2) expense/COGS/financial-charge accounts → Income Summary, (3) Income Summary's net → Retained Earnings — all within one balanced multi-line journal, without touching the DEFERRED DR=CR trigger.

**Architecture Snapshot:** (1) the Chart of Accounts already has an `isSystem` boolean protecting certain accounts from user modification/deletion — reuse it for Income Summary; (2) `JournalEngine.post()` already accepts arbitrary multi-line journals and only requires the whole set to balance, so no new posting mechanism is needed; (3) the DEFERRED `validate_journal_balance` DB trigger (from `0002_phase6_accounting.sql`) fires once per journal at transaction commit and must not be modified; (4) `accountSubType` is a TypeScript-typed `varchar`, not a DB enum, so adding `INCOME_SUMMARY` is a type-union edit plus a data-seed migration, not a `CHECK` constraint change.

**Completed Components:** the pre-close 10-item checklist (`runCloseChecklist()`), the DR=CR trigger, `JournalEngine`, `ReportsEngine.getProfitLoss()`'s per-account line breakdown — all pre-existing and reused as-is.

**Pending Components:** the Income Summary account itself, the backfill migration, and the `closeYear()` restructure — all net-new in this package. Do not touch `runCloseChecklist()`'s 10 checklist items or any of the trial-balance/balance-sheet/cash-flow report code beyond verifying they correctly reflect the new closing entry (they should need zero code changes, only new test assertions).

**Known Constraints:** the closing journal must still balance exactly (DR=CR) within the same DEFERRED-trigger-enforced transaction; the account-code `3900` chosen for Income Summary must not collide with any existing seeded code in `default-accounts.ts` (verify against the full list before implementation, since `3010`/`3020`/`3030` are already taken under the `3000` Equity parent).

**Coding Standards:** reuse `JournalEngine.post()`'s existing multi-line capability and the `isSystem` account-protection convention; no new framework/pattern.

**Reusable Components:** `ReportsEngine.getProfitLoss()` (source of the real per-account amounts to close), `JournalEngine.post()` (posts the restructured multi-line journal), `default-accounts.ts` (seed pattern to copy for the new account).

**APIs Already Available:** the financial-year-close route itself (`apps/accounting-service/src/api/financial-year.routes.ts`) — unchanged externally, only its internal call to `closeYear()` behaves differently.

**Events Already Available:** `JOURNAL_POSTED` (published by `JournalEngine.post()`) — no new event type needed.

**Shared Utilities:** `@erp/types` (`BusinessError`, `NotFoundError`), `@erp/db` (Drizzle schema), `@erp/sdk` (`PlatformEventBus`, `TenantScopedDatabase`).

**Feature Flags:** none — this is a correctness fix to a mandatory process, not opt-in.

**Multi-Tenant Rules:** Income Summary is a per-tenant account row (like every other Chart of Accounts entry) — seed it per-tenant via migration for existing tenants and via `DEFAULT_ACCOUNTS` for new ones.

**Security Rules:** no permission change — `FINANCIAL_YEAR_CLOSE` still gates the close operation; the new account is protected by the existing `isSystem` guard.

**Database State:** depends on migrations through `0034_organization_theme_config.sql`; adds one new migration seeding the Income Summary account. No table schema change beyond the TypeScript `accountSubType` union.

**Testing Status:** `apps/accounting-service/src/__tests__/financial-year.test.ts` already tests `closeYear()` against the old two-line behavior — these assertions must be updated, not just extended, since the old behavior is being replaced, not supplemented.

**Next Session Plan:** single session — schema/seed change, then `closeYear()` restructure, then test updates, in that order.

**Prompt for the Next Session:** "Implement `ERP-PLANNING/production-gap-prompts/006-Accounting/34-real-income-summary-account.md` (PG-033): add a per-tenant `Income Summary` system account (code `3900`, `EQUITY`/`INCOME_SUMMARY`) via a new migration and a `default-accounts.ts` entry, then restructure `apps/accounting-service/src/domain/FinancialYearService.ts`'s `closeYear()` to route revenue/expense accounts through Income Summary before netting into Retained Earnings, replacing the current two-line self-balancing placeholder. Update `financial-year.test.ts` accordingly. Do not touch the DEFERRED `validate_journal_balance` trigger or the 10-item pre-close checklist."
