# QA Session — Accounting Module (Journals)

**Date:** 2026-07-12
**Status:** IN PROGRESS — one confirmed bug found and fixed; rest of Accounting/GST not yet covered

## Scope

Second module of the ongoing full-application QA cycle (see
`QA-SALES-ORDER-TO-CASH_COMPLETION.md` for the first). Started with the Accounting module since
Sales invoices/payments feed it directly via journal-posting events, and memory already flagged
known issues in this area. First target: a specific bug already flagged by a prior session
(PG-037, 2026-07-11) but left unfixed — re-verified live before fixing.

## Bug Found and Fixed

### Journal creation and detail were both dead links

`JournalsPage.tsx`'s "+ Manual Journal" button (and the empty-state action) navigated to
`/accounting/journals/new`; clicking any journal row navigated to `/accounting/journals/:id`.
**Neither route was ever registered in `App.tsx`, and no form or detail component existed for
either.** The backend was already fully built and ready — `POST /journals`
(`apps/accounting-service/src/api/journal.routes.ts`) accepts a balanced multi-line entry with
optional cost-center overrides, `GET /journals/:id` returns the full journal with resolved
account names, and `POST /journals/:id/reverse` posts an offsetting reversal — all three were
simply never wired to a frontend page.

This was flagged in `ERP-PLANNING/production-gap-prompts/IMPLEMENTATION-NOTES.md`'s PG-037 entry
(_"did not build a new manual-journal-creation page... flagging here so the next session... knows
the cost-center override plumbing is already there waiting for it"_) but never picked up until
now. Confirmed still live via a fresh grep of `App.tsx` before starting.

**Fix:**

- `apps/web-frontend/src/pages/accounting/JournalFormPage.tsx` (**new**) — description, dynamic
  debit/credit line rows (account picker, optional cost-center picker, running debit/credit
  totals with a live balanced/unbalanced indicator), submit disabled until balanced with ≥2 valid
  lines — mirrors the backend's own validation (`JournalEngine.post()`: min 2 lines,
  `SUM(debit) == SUM(credit)`) so the user sees the same rule before submitting, not just after a
  round-trip.
- `apps/web-frontend/src/pages/accounting/JournalDetailPage.tsx` (**new**) — header/status,
  four-up summary cards, reversal banner (either direction — reversed-by or is-a-reversal-of),
  full line table with totals, a `Reverse` action gated on `CANCEL_POSTED_JOURNAL` and only shown
  for `POSTED`, non-reversal journals.
- `apps/web-frontend/src/App.tsx` — registered `accounting/journals/new` (→
  `JournalFormPage`, gated on `JOURNAL_CREATE`) and `accounting/journals/:id` (→
  `JournalDetailPage`, gated on `JOURNAL_VIEW`).

**Tests:** New `apps/web-frontend/e2e/journals-workflow.spec.ts` — 6 tests: the dead-link
regression itself (form actually renders, not a 404/blank page), client-side unbalanced-journal
rejection, a full balanced-journal create → detail-page navigation round trip, and 3 RBAC
gating cases for the Reverse action. 6/6 pass, and the full web-frontend E2E suite (27 tests
across all specs written this session) still passes together, both `--workers=1` and full
parallel.

## Verification

- `pnpm --filter @erp/web-frontend type-check` — clean.
- `npx playwright test` (web-frontend) — 27/27 pass (6 new + 21 from the Sales session).
- Checked for the same "list page links to an unregistered route" pattern across the rest of
  Accounting and all of GST (`grep` for `navigate(...new...)` calls vs. `App.tsx` registrations)
  — no other instances found. This was the only one.
- Did not touch `accounting-service` backend code — `POST /journals` / `GET /journals/:id` /
  `POST /journals/:id/reverse` were already correct and fully tested by that service's own
  existing suite (not re-run as part of this frontend-only change, no backend files changed).

## Known Gaps / Follow-ups

- Rest of Accounting (Chart of Accounts, Ledger, Trial Balance, P&L, Balance Sheet, Cash Flow,
  Bank Reconciliation, Financial Years, Fixed Assets, TDS, Cost Centers) not yet tested this
  session.
- GST module (E-Invoice, GSTR-1/2A/3B/9, GST Register, GST Config, Compliance) not yet tested.
- No live-data verification (no authenticated session against the real backend — see the Sales
  completion report's Verification section for why).

## Files Changed

| File                                                           | Change                                                             |
| -------------------------------------------------------------- | ------------------------------------------------------------------ |
| `apps/web-frontend/src/pages/accounting/JournalFormPage.tsx`   | **New** — manual journal creation form                             |
| `apps/web-frontend/src/pages/accounting/JournalDetailPage.tsx` | **New** — journal detail + reverse action                          |
| `apps/web-frontend/src/App.tsx`                                | Registered `accounting/journals/new` and `accounting/journals/:id` |
| `apps/web-frontend/e2e/journals-workflow.spec.ts`              | **New** — 6 tests                                                  |
