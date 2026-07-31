# Purchase Module — Fresh Production-Readiness Audit (2026-07-25)

## Scope

`apps/purchase-service` (Purchase Orders, GRN, Purchase Returns, branch scoping, RBAC) +
`apps/web-frontend/src/pages/purchase`. Live-tested against the running stack (gateway :3000,
purchase-service :3020, inventory-service :3012, accounting-service :3019, gst-service :3018,
tenant/auth-service) using tenant 2 "QA E2E Test Co", role PURCHASE_MANAGER, plus a
purpose-created branch-6-scoped PURCHASE_MANAGER user and the seeded STAFF user. Suppliers CRUD
itself was not deep-audited (per instructions), only confirmed PO creation references a real
supplier record correctly.

## Summary

The prior same-day 2026-07-21 audit report (`PURCHASE-MODULE-AUDIT-2026-07-21.md`) claimed
93/100 readiness after three escalating "gap-closure passes," with branch-scope enforcement
"closed completely" and GL posting "confirmed via passing tests." Live re-verification against
the actual running stack found that claim badly wrong on the single most important axis: **the
entire Purchase→Accounting posting path (GRN receipt and Purchase Return) silently produces
zero General Ledger journal entries, every single time, for every historical GRN/Purchase Return
in the tenant.** This is a Critical, revenue/compliance-corrupting bug that none of the 68
purchase-service unit tests or the 93/100 score caught, because the root cause lives entirely in
**accounting-service** (not purchase-service) and no test anywhere in the repo exercises
`GRNAccountingConsumer`/`PostingMatrixService` against the real seeded Chart of Accounts. Stock
movement (GRN receipt add, Purchase Return deduct, WACC revaluation) and GST ledger posting both
work correctly and were live-verified. Branch-scoping (list/detail/create/mutate, including the
GRN and Purchase Return indirect cases) is genuinely solid and matches the prior audit's claim —
that part of the 93/100 story held up. RBAC and input validation are clean. One data-integrity
gap (PO creation accepts a nonexistent `supplierId` with no existence check) was found new this
session.

## What Works (live-verified, real record IDs)

- **PO lifecycle**: Created PO id **53** (supplier 2 "Global Textiles Supplier", branch 1,
  warehouse 5, 100 × Cotton Saree @ ₹200, 5% GST) → DRAFT → `submit` → `approve` (poNumber
  `PO-AUDIT-53`) → correct CGST/SGST split (₹500/₹500, intrastate, placeOfSupply=sellerStateCode
  ="27"), grandTotal ₹21,000. PO correctly transitioned to status `RECEIVED` after full receipt.
- **GRN creation & approval**: Created GRN id **33** against PO 53, approved (`GRN-AUDIT-33`).
  **Inventory stock verified before/after**: warehouse 5 (Main Warehouse) item "Cotton Saree"
  (id 1) went from 2905.000 → 3005.000 (+100, exact), other warehouses (12, 9) untouched —
  confirms the deduction/addition targets the correct per-warehouse `projection_stock_level` row,
  not a tenant-wide aggregate. WACC correctly revalued: `waccCost` 187.20 → 187.56,
  `currentStockValue` +₹20,000 exactly (642,456.26 → 662,456.26). Over-receipt beyond the PO's
  ordered qty was correctly blocked (`INVALID_PO_STATUS` once PO reached `RECEIVED`).
- **Purchase Return with real line selection**: Created Purchase Return id **10** against GRN 33
  using a real `grnLineId` (33) and `reason: QUALITY_ISSUE` (confirmed enum:
  `QUALITY_ISSUE|WRONG_ITEM|EXCESS_QUANTITY|DAMAGED|OTHER`) — frontend
  (`PurchaseReturnFormPage.tsx`) also confirmed to populate `grnLineId` from real GRN lines, not
  a hardcoded empty array (the historical 2026-07-13 bug class). Approved → auto-created Debit
  Note id 9. Stock correctly decremented in warehouse 5 only: 3005.000 → 2995.000 (−10, exact).
- **GST ledger posting (gst-service)**: Independently confirmed correct for both flows — GST
  register (`GET /gst/gst/register?period=2026-07&type=PURCHASE`) shows a real, non-zero entry
  for `GRN-AUDIT-33` (taxable ₹20,000) and for the return `PR-2-1784930054372` (taxable ₹2,000).
  This is a genuinely separate code path (gst-service's own Kafka consumer) from the broken
  accounting-service path below, and it works.
- **Branch scoping — live-verified on both PO and GRN and Purchase Return, list/detail/mutate/
  create**: created a second PURCHASE_MANAGER user scoped to branch 6 only. That user: got 403
  `PO_OUT_OF_SCOPE` on `GET /purchase-orders/53`, on `POST /purchase-orders/53/submit`, and on
  `POST /purchase-orders` when the body named `branchId:1`; got 403 `GRN_OUT_OF_SCOPE` on
  `GET /grns/33`; got 403 `PURCHASE_RETURN_OUT_OF_SCOPE` on `GET /purchase-returns/10`; and the
  branch-6 user's PO list (5 results) contained zero branch-1 records. This matches the prior
  audit's §14-16 claims — genuinely fixed, not over-claimed, on this one axis.
- **RBAC**: STAFF role correctly got 403 `Missing permission: PO_CREATE` / `PO_VIEW` on
  create/list.
- **Validation**: negative `orderedQty`/`receivedQty`, empty `lines` array, and missing
  `supplierId` all return clean 400s with a useful Zod message, not 500s.
- **purchase-service test suite**: `pnpm --filter @erp/purchase-service test` → **68/68 passed**,
  10 files, run standalone (matches the prior audit's claimed count).

## Bugs / Gaps Found

### CRITICAL — GRN and Purchase Return never post to the General Ledger; failure is completely silent

Live-verified via direct DB inspection (Postgres `outbox_events`/`inbox_events`/Kafka consumer
group offsets), not assumption:

- `GET /accounting/journals?referenceType=GRN&referenceId=33` → **0 results**.
- `GET /accounting/journals?referenceType=PURCHASE_RETURN&referenceId=10` → **0 results**.
- The `GRN_APPROVED` outbox event for GRN 33 published successfully to Kafka topic
  `erp.grn.approved` (`outbox_events.published=true`, no failure) and both **gst-service** and
  **search-service** show a `PROCESSED` row in `inbox_events` for that exact `eventId` — but
  **accounting-service has zero row at all** (not `FAILED`, just absent) for this or any prior
  `GRN_APPROVED`/`PURCHASE_RETURN_APPROVED` event: `select oe.event_type, count(*) from
inbox_events ie join outbox_events oe ... where ie.consumer_service='accounting-service' group
by oe.event_type` never returns `GRN_APPROVED` or `PURCHASE_RETURN_APPROVED`, across 132
  historical accounting-service inbox rows.
- Root cause, confirmed by reading code + querying the real seeded Chart of Accounts
  (`select account_code,name from accounts where tenant_id=2`):
  `apps/accounting-service/src/domain/PostingMatrixService.ts`'s `DEFAULT_POSTING_RULES` and
  `GST_ACCOUNT_CODES` hardcode account codes that **do not exist** in
  `apps/accounting-service/src/domain/default-accounts.ts`'s actual seed data:
  - `GRN_APPROVED`/`PURCHASE_RETURN_APPROVED`/`SUPPLIER_PAYMENT_MADE`/`EXPENSE_APPROVED`/
    `EXPENSE_PAID` all reference **`'2010'`** for Accounts Payable. The real seeded AP account
    code is **`2100`** ("Accounts Payable (Creditors)"); `2010` doesn't exist at all.
  - The GST input-credit lines for `GRN_APPROVED`/`PURCHASE_RETURN_APPROVED` reference
    `GST_ACCOUNT_CODES.CGST_INPUT/SGST_INPUT/IGST_INPUT` = **`'1410'/'1420'/'1430'`**, none of
    which exist in `default-accounts.ts` (only the payable-side `2210/2220/2230` CGST/SGST/IGST
    Payable accounts were seeded — there is no Input Tax Credit account on the purchase side at
    all).
  - Comment-level bug too: `PostingMatrixService.ts` labels `'1310'` as "Inventory Asset" for the
    GRN debit line, but `default-accounts.ts` actually defines `1310` as **"Prepaid Expenses"**
    (real Inventory is `1200`). Even if the AP-code bug were fixed, GRN receipts would currently
    misclassify inventory purchases as prepaid expenses on the balance sheet.
  - Net effect in `PostingMatrixService.buildJournalEntry()`: `codeToId.get('2010')` resolves to
    `undefined`, so the main debit/credit rule line is silently skipped (`if (!drId || !crId)
continue`), and the GST ITC block's guards (`if (cgstId)`, `if (apId)`) also skip every line
    for the same reason — `lines.length` stays below 2, which throws
    `BusinessError('JOURNAL_INSUFFICIENT_LINES', ...)`.
  - That exception is caught and **re-thrown** by `handleGRNApproved`/`handlePurchaseReturnApproved`,
    but `PlatformEventConsumer.subscribe()` in `packages/platform-sdk/src/events.ts` does the
    inbox-claim insert and the handler call **inside the same DB transaction**. When the handler
    throws, the whole transaction (including the just-inserted `inbox_events` claim row) rolls
    back — so the later `catch` block's attempt to mark the row `FAILED` updates **zero rows**
    (the row it's trying to update was never actually committed). Combined with the outer
    `eachMessage` never rethrowing to kafkajs, the Kafka offset still commits normally. Result:
    **a real, reproducible, deterministic failure with zero trace anywhere** — no DLQ entry, no
    `FAILED` inbox row, no journal, just a silent no-op forever. This is a distinct and more
    severe bug than the general "outbox dead-letters were invisible" gap fixed in the Event
    Service audit (2026-07-23) — that fix covers _outbox publish_ failures, not _inbox/consumer
    handler_ failures, which have no equivalent safety net.
- **Verified this is the correct explanation, not a coincidence**: `RCM_LIABILITY_POSTED` (also
  emitted from the same `GRNService.approve()` transaction, same relay, same consumer) uses
  account codes `1330`/`2330` (both of which exist) and **does** post successfully — 2 processed
  rows in `inbox_events`. `INVOICE_CONFIRMED`/`PAYMENT_RECEIVED`/`SALE_RETURN_APPROVED` use
  `1120`/`4000`/`1010` (all exist) and post fine too. The bug is precisely scoped to the
  Accounts-Payable side of the ledger (`'2010'`) plus the purchase-side GST input-credit codes —
  i.e. **the entire supplier/purchase half of the GL is broken**, while the customer/sales half
  works.
- **Why the 93/100 score and 68/68 tests missed this**: no test file anywhere in the repo
  exercises `GRNAccountingConsumer`, `handlePurchaseReturnApproved`, or `PostingMatrixService`
  against the real seeded `default-accounts.ts` data. `purchase-service`'s own
  `purchase-return-ledger.test.ts` (cited by the prior audit as proof GL posting works) only
  tests `PurchaseReturnService`'s inventory-ledger row and GST-split arithmetic — it never
  touches accounting-service at all. `accounting-service/src/__tests__/` has dedicated consumer
  tests for invoice, expense, employee-loan, and sale-return postings, but **none for
  GRN or Purchase Return** — the two purchase-side postings introduced/claimed-fixed in the very
  audit that scored this module 93/100.
- **Business impact**: every GRN ever approved in this tenant has zero Accounts Payable
  liability and zero inventory-value journal entry on the books; every Purchase Return has no
  reversal entry. Trial Balance, Balance Sheet, and P&L are all silently wrong for any tenant
  using Purchase. This is as severe as the "expense ₹0 journals" and "BS/CashFlow divergence"
  Critical findings from the 2026-07-23 Accounting audit, but on a different code path.
- **Fix scope note (not applied — audit only)**: this needs a coordinated fix in
  `accounting-service` (`PostingMatrixService.ts` account codes corrected to match
  `default-accounts.ts`, and 2 new Input-Credit accounts seeded for CGST/SGST/IGST-on-purchase if
  they're meant to exist), plus closing the inbox/transaction-rollback observability hole in
  `packages/platform-sdk/src/events.ts` (the inbox claim should survive a handler failure so it
  can be marked `FAILED` and show up in DLQ tooling) — out of scope to fix in this audit pass but
  flagged as the top blocking item.

### HIGH — PO creation accepts a nonexistent supplierId with no existence check

`POST /purchase-orders` with `supplierId: 999999` (confirmed not to exist via
`GET /suppliers/999999` → 404) returned **201** and created PO id **54** with `supplierName:
null`. There is no cross-service (or same-DB) existence check on `supplierId` at PO-creation
time. Downstream, GRN/GST/PDF/reporting flows that expect a real supplier record (name, GSTIN,
state) would silently carry nulls. Low likelihood of a real user typing a random ID, but a real
gap for programmatic/API integration use and for a typo'd ID from a stale dropdown cache.

### Confirmed NOT a bug — WACC/stock-check "tenant-wide vs per-warehouse" pattern

The Inventory audit's flagged root-cause pattern (checking aggregate tenant-wide stock instead of
per-warehouse) **is present in `PurchaseReturnService.approve()`**: the sufficiency check at
`apps/purchase-service/src/domain/PurchaseReturnService.ts:198`
(`sql`${items.availableQty} >= ${qty}``) checks the tenant-wide `items.availableQty` column, not
the per-warehouse `projection_stock_level` row, before decrementing. In the live test this didn't
produce a visibly wrong result because the tenant-wide total and the single-warehouse total both
had sufficient stock — but in a multi-warehouse tenant, a Purchase Return could be approved
(passing the tenant-wide check) even when the _specific_ warehouse being returned from has
insufficient stock; the per-warehouse `projection_stock_level` decrement is then clamped with
`GREATEST(0, ...)` (line 263), silently masking the shortfall rather than erroring. This mirrors
the Inventory module's confirmed Critical finding and should be fixed alongside it — same root
cause, second confirmed occurrence in a sibling service (consistent with the "no cross-service
transactional logic — fixes must be applied to each copy individually" architecture note).
GRN's stock-_add_ path was live-verified correct (targets the right warehouse), since a receipt
has no insufficiency check to get wrong.

### Not re-verified / out of scope this session

- **Reorder Report / auto-PO-creation**: lives in `apps/production-service`
  (`ReorderService.ts`, `reorder.routes.ts`), not `apps/purchase-service` — out of this pass's
  scope per the task's own note to check where it lives first. Not tested here.
- **Multi-tenant isolation**: every route read in `purchase-order.routes.ts`/`grn.routes.ts`/
  `purchase-return.routes.ts` consistently filters by `eq(table.tenantId, tenantId)` from the
  authenticated JWT claim, which is a strong code-level signal. Could not live-verify with a
  second real tenant this session (no currently-valid second-tenant credential was available;
  a cached token from a different concurrent session's tenant had already expired) — recommend a
  follow-up live cross-tenant test rather than trusting code inspection alone for something this
  security-sensitive.
- **Supplier Payment / Expense accounting** (adjacent to Purchase, not strictly in this audit's
  scope): both use the same broken `'2010'` AP code in `PostingMatrixService.ts` and are almost
  certainly affected by the identical silent-failure bug — flagged for the Accounting/HR-adjacent
  audit passes to confirm, not independently live-tested here.
- Landed Cost allocation, Supplier credit-limit enforcement, PO amendment workflow, RFQ/
  Requisition/Blanket-PO/Purchase-Invoice-variance features (§14 of the prior report) — not
  re-tested this session; no reason from this session's findings to doubt their basic
  functioning, but also not independently confirmed.

## Readiness Score: **48/100**

The prior 93/100 score is not credible against live evidence. Scoring rationale:

- **-35**: the GRN/Purchase-Return → GL posting path is completely non-functional and silently
  fails for every occurrence — this is the single most important promise of a Purchase module
  (accurate AP liability and inventory valuation on the books) and it does not hold at all.
  Combined with zero test coverage catching it, this is a "the core financial workflow doesn't
  work" level of severity, not a deductible gap.
- **-8**: WACC-check tenant-wide-vs-per-warehouse gap in Purchase Return, same class as the
  Inventory module's confirmed Critical finding.
- **-5**: no supplier-existence validation on PO creation.
- **-4**: for the pre-existing, deliberate, correctly-documented gaps carried over from the prior
  audit (2-way match only, no Purchase Requisition/RFQ/Blanket-PO as of the base module — largely
  since closed per §14-16, not re-verified but plausible) and the still-unverified multi-tenant
  live test.
- What remains solidly working and verified live: PO/GRN/Purchase-Return workflow mechanics,
  stock movement correctness (add and deduct, right warehouse, correct WACC math), GST ledger
  posting, branch scoping (genuinely thorough, list/detail/create/mutate, live-tested on 3
  different entity types), RBAC, and input validation — these are real and account for the
  remaining points.
