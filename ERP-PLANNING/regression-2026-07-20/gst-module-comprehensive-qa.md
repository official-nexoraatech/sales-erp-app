# GST Module — Comprehensive QA & Gap Analysis — 2026-07-20

**Scope:** GST Ledger Register, GSTR-1, GSTR-3B, GSTR-9, e-Invoice (IRN), GSTR-2A Reconciliation, Compliance Calendar, GST Reports, GST Settings/Master Data, GST Transactions, ITC, RCM, GST Adjustments, e-Way Bill.

**Method:** (1) reviewed all prior QA memory and planning docs for this module (2026-07-12/13/17 sessions, PG-039/PG-040 gap-prompts, ES-10 phase doc); (2) verified via git history + direct code read which previously-documented gaps are already fixed vs still open; (3) ran the gst-service unit test suite; (4) live-tested a subset of flows directly against the running stack (API + DB) — real login, real writes, real Kafka consumers, tenant 2 "QA E2E Test Co". A background live-browser-testing agent was launched to cover the remaining untested flows (e-Invoice IRN generation, GSTR-2A import, e-Way Bill generation, CDNR live path) but was terminated mid-run by an account-level weekly usage limit before reporting; those items are flagged **NOT LIVE-TESTED THIS SESSION** below rather than guessed at.

**Do not treat this document's "confirmed working" claims as permanent** — this is a point-in-time snapshot, consistent with this module's history of regressions (see §1.1).

---

## 1. Current Workflow

### 1.1 End-to-end GST compliance cycle

```
Transaction (Invoice / GRN / Sale Return / Purchase Return)
        │  (confirm/approve)
        ▼
Outbox event (INVOICE_CONFIRMED / GRN_APPROVED / SALE_RETURN_APPROVED / PURCHASE_RETURN_APPROVED)
        │  (transactional outbox → Kafka relay)
        ▼
   ┌────┴─────────────────────────┐
   ▼                              ▼
gst-service consumers      accounting-service consumers
(InvoiceGstConsumer,       (InvoiceAccountingConsumer,
 GRNGstConsumer,            SaleReturnAccountingConsumer,
 SaleReturnGstConsumer)     GRNGstConsumer-equivalent, etc.)
   │                              │
   ▼                              ▼
gst_ledger (append-only,    journals / financial_entries
 one row per document,       (double-entry books)
 tenant+period scoped)
   │
   ├─► GST Register / period summary (GstLedgerService.getSummary)
   ├─► GSTR-1 (Gstr1Service — B2B/B2CS/B2CL/CDNR/CDNUR/HSN summary, Excel export)
   ├─► GSTR-3B (Gstr3bService — outward liability + ITC availed + RCM + reversal,
   │            IGST→CGST→SGST set-off algorithm, manual import-IGST override)
   ├─► GSTR-2A Reconciliation (Gstr2aService — import purchases-side GSTR-2A data,
   │            auto-match against gst_ledger PURCHASE rows within ±1% tolerance)
   ├─► GSTR-9 (GSTR9Engine — annual rollup of Tables 4/5/6/7 from gst_ledger,
   │            Table 9 tax-paid from persisted per-period GSTR-3B discharge data)
   └─► e-Invoice/e-Way Bill (EInvoiceService/EwayBillService — real NIC sandbox/prod
                calls, auto-triggered on B2B invoice confirm)

All of the above tracked against an auto-generated GST Return Filing Calendar
(GstReturnTrackerService), which supports mark-filed (one-way transition since
2026-07-18) and persists real GSTR-3B cash/ITC discharge at filing time (feeds
GSTR-9 Table 9).
```

### 1.2 Module interactions

- **sales-service** produces `INVOICE_CONFIRMED` / `SALE_RETURN_APPROVED` events with the full tax breakdown (taxable/CGST/SGST/IGST, isInterstate, GSTIN) — both gst-service and accounting-service consume the _same_ event independently and build their own view (per this codebase's documented "no cross-service transactional logic" convention — GST-domain math is duplicated per-service, not called cross-service).
- **purchase-service** produces `GRN_APPROVED` (feeds both gst_ledger via GRNGstConsumer and accounting via a separate consumer), and separately computes RCM self-assessment at GRN-creation time based on the supplier's `isRegistered` flag.
- **gst-service** is the single source of truth for `gst_ledger`; every return (GSTR-1/3B/9/2A) reads from it via `GstLedgerService`, not from sales/purchase-service directly.
- **accounting-service** never reads `gst_ledger` — it derives its own tax lines from the same event payloads via `PostingMatrixService`, which is why GST-ledger correctness and books correctness are two independent code paths that can (and, per §2, do) drift apart.

### 1.3 What's real vs. simplified (as of this session, superseding the 2026-07-11 `FEATURE_INVENTORY.md`, which is 9 days stale and predates the gateway cutover, PG-039, and PG-040)

| Area                                                               | Status                                                                                                |
| ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------- |
| GSTR-1 (B2B/B2CS/B2CL/CDNR/CDNUR/HSN, Excel export)                | Real, Excel export uses the `xlsx` library (not a JSON stub as the stale doc claims)                  |
| GSTR-3B ITC set-off (IGST→CGST→SGST)                               | Real, mandated order, verified correct in prior sessions                                              |
| GSTR-3B RCM / ITC-reversal / manual import override (PG-039)       | **Implemented and live-verified this session** — code, tests, and migration all present               |
| GSTR-9 Table 9 real discharge tracking (PG-040)                    | **Implemented and live-verified this session** — `filing_data` genuinely persisted at mark-filed time |
| GSTR-2A reconciliation (import + ±1% auto-match)                   | Present in code; **not live-tested this session** (agent failure)                                     |
| e-Invoice (IRN) — NIC sandbox/prod integration, auto-cancel, retry | Present in code with real test coverage; **not live-tested this session**                             |
| e-Way Bill — real generation, ₹50k threshold                       | Present in code; threshold logic unit-verified; **live NIC call not tested this session**             |
| Compliance Calendar — due-date tracking, mark-filed                | **Live-verified this session** — real overdue tracking, correct LATE_FILED transition                 |
| One-way GST filing lock (`RETURN_ALREADY_FILED`)                   | **Live-verified this session**                                                                        |
| RCM self-assessment                                                | **Live-verified structurally broken this session** — see §2, Finding G1                               |

---

## 2. Gap Analysis

### G1 — CRITICAL — RCM self-assessment can never be triggered by any real user action

- **Module:** RCM / Purchase (supplier master) / GST Compliance
- **Issue:** `GRNService.ts` correctly computes `rcmApplicable = !supplier.isRegistered`, and every downstream consumer of that flag (GRNGstConsumer, GstLedgerService, Gstr3bService's PG-039 wiring, GSTR-9) is correctly built and tested. But **`suppliers.isRegistered` can never be set to `false` through any API or UI path** — `SupplierSchema` in `apps/sales-service/src/api/supplier.routes.ts` (the actual route that creates suppliers — not purchase-service, despite RCM/GRN logic living there) has no `isRegistered` field at all. Zod's `safeParse()` silently strips unrecognized keys, so a client sending `isRegistered: false` is ignored, and the DB column defaults to `true` (confirmed live: `POST /api/sales/suppliers` with `isRegistered: false` in the body returned a created supplier with `isRegistered: true`). Grep across the entire frontend and both services confirms zero other references to `isRegistered` anywhere.
- **Severity:** Critical. This isn't a display bug — it's a legally-mandated tax self-assessment (GST Act §9(3)/9(4)) that is structurally impossible to trigger for any tenant, ever, regardless of how correct the downstream computation is. Consistent with a live DB check: **zero `gst_ledger` rows have `rcm_applicable = true` for this tenant**, and zero suppliers are `is_registered = false`, despite the tenant having 9 real suppliers.
- **Business Impact:** Any real business that purchases from unregistered vendors (a common scenario — small transporters, unregistered contractors, individual service providers) would never have RCM liability computed, self-assessed, or reflected in GSTR-3B Table 3.1(d)/4A, understating GST liability with no error or warning anywhere in the product.
- **Technical Root Cause:** `SupplierSchema` (apps/sales-service/src/api/supplier.routes.ts) omits `isRegistered` from both the create schema and (need to verify at fix time) the update schema; the frontend supplier form has no corresponding field either.
- **Recommended Solution:** Add `isRegistered: z.boolean().default(true)` to `SupplierSchema` (and `SupplierUpdateSchema`, which extends it) in `apps/sales-service/src/api/supplier.routes.ts`, thread it into the `.insert(suppliers).values({...})` call, and add a corresponding toggle to the Supplier create/edit form in `apps/web-frontend`. This is the same "producer never sends/accepts a field the consumer needs" bug class already fixed twice this month (B1, sale-return GST-ledger fix) — but on the _input_ side rather than the event-payload side.

### G2 — HIGH — Sale-return accounting reversal journal fails to post (`JOURNAL_INSUFFICIENT_LINES`)

- **Module:** Accounting / Sale Return / GST (adjacent)
- **Issue:** Live-reproduced this session: created a real sale return (₹2,100 incl. ₹100 GST) against a confirmed invoice. The `SALE_RETURN_APPROVED` event correctly reached both consumers — `gst_ledger` now gets a correct `CREDIT_NOTE` row (confirms the 2026-07-18 fix, commit `d9d657e`, is genuinely working) — but `accounting-service` threw `JOURNAL_INSUFFICIENT_LINES` and logged `"Could not build valid journal lines for event SALE_RETURN_APPROVED — check Chart of Accounts configuration"`. No journal was posted at all.
- **Severity:** High (same bug class as the earlier-fixed B1 blocker — books silently fail to reflect a real business event — but scoped to sale returns only, and it fails loudly in logs rather than silently succeeding with wrong numbers, so it's more detectable but still fully broken).
- **Business Impact:** Every sale return in this system currently fails to post its reversing journal entry. Trade Debtors stays overstated and Sales Revenue is never contra-credited for any return, permanently, for every tenant.
- **Technical Root Cause:** `PostingMatrixService.ts` line 52 — the `SALE_RETURN_APPROVED` posting rule hardcodes `debitCode: '4200'`. **No account with code `4200` exists anywhere** — `apps/accounting-service/src/domain/default-accounts.ts` (the standard seed template used by every tenant) defines "Sales Returns (Contra Revenue)" under code **`4900`**, not `4200`. Confirmed live: tenant 2's `accounts` table has no `4200` row. This is a plain typo/mismatch between the posting-matrix rule and the actual seeded chart of accounts — not a per-tenant configuration gap.
- **Recommended Solution:** Change `PostingMatrixService.ts:52`'s `debitCode: '4200'` to `debitCode: '4900'` to match the seeded account. One-line fix, low risk, directly addresses the root cause with no schema or data migration needed (the account already exists in every tenant's seeded CoA).

### G3 — MEDIUM — RCM Register has a working backend but zero reachable UI

- **Module:** RCM / GST Reports
- **Issue:** `GET /gst/rcm-register?period=...` (apps/gst-service/src/api/rcm.routes.ts) is fully implemented and correctly filters `gst_ledger` by `rcmApplicable=true`. `apps/web-frontend/src/api/endpoints.ts` even has a wired `gstApi.rcmRegister(period)` client method. **No page or component anywhere in `apps/web-frontend/src` calls it** — grep confirms the only reference to `rcmRegister`/`getRcmRegister` in the entire frontend is the client-method definition itself.
- **Severity:** Medium (matches the exact "backend fully wired, zero UI ever called it" bug class found repeatedly in this codebase's history — e.g., Stock Transfer submit, Employee Loans before a prior QA session built it).
- **Business Impact:** Once G1 is fixed and RCM transactions start actually occurring, a business owner/accountant will have no way to see the underlying RCM transaction detail for a period — only the rolled-up total inside GSTR-3B, with no drill-down.
- **Technical Root Cause:** Feature was built end-to-end on the backend (ES-10 phase) but the frontend page was never built.
- **Recommended Solution:** Add an "RCM Register" view — either a new page under `/gst/rcm-register` or a filterable section inside the existing GST Register page (`GstRegisterPage.tsx` already has a "Type" filter dropdown; adding an "RCM" option there and wiring it to `gstApi.rcmRegister()` would reuse the existing page rather than building a new one, consistent with this codebase's "reuse over rebuild" convention).

### G4 — LOW — Two gst-service unit tests are timing-flaky, not logic-broken

- **Module:** e-Way Bill / GST Compliance Saga (test infrastructure only)
- **Issue:** `ewb.test.ts`'s threshold test and `GstComplianceSaga.test.ts`'s intra-state payload test both intermittently exceed vitest's default 5000ms timeout. Isolated re-runs show the _first_ test in each file consistently takes ~4.9s (cold module import of `@erp/sdk`'s dependency graph), right at the timeout boundary — not an infinite hang, not a business-logic defect. The threshold check itself (`payload.totalValue <= EWB_VALUE_THRESHOLD`) is synchronous, correct, and throws immediately once reached; the delay is entirely in module resolution before that line runs.
- **Severity:** Low — test-infrastructure noise, not a product defect. But it's a real CI-flakiness risk: any CI run with cold caches could see this fail non-deterministically.
- **Recommended Solution:** Bump `testTimeout` for these two files (or globally in `vitest.config.ts`) to ~10000ms. No production code change needed.

### G5 — NOT LIVE-TESTED THIS SESSION (flag for follow-up, not a confirmed gap)

The background live-browser-testing agent assigned to these areas was terminated by an account-level weekly usage limit before reporting results. These are **not** confirmed bugs — they're marked exactly as untested so a follow-up session doesn't skip them:

- e-Invoice (IRN) actual generation call against the NIC sandbox (unit tests pass; a real end-to-end generate→cancel→retry cycle was not driven live)
- GSTR-2A reconciliation actual import + auto-match execution (only prior sessions' page-load smoke check exists)
- e-Way Bill actual generation call + expiring-soon alert UI (threshold logic is unit-verified; the live NIC call path is not)
- CDNR (registered credit-note) classification, live — this tenant has **zero confirmed B2B (GSTIN-bearing) invoices in its data**, so the CDNR bucket in GSTR-1 has never had real data to classify. Code read of `Gstr1Service.ts` lines 194–215 shows the classification structurally splits on `gstinOfCounterparty` presence, which looks correct, but this has not been exercised with real B2B data since the 2026-07-18 sale-return payload fix (`d9d657e`) changed what that consumer writes.

---

## 3. Impact Analysis (for the proposed fixes below)

| Fix                                                               | Modules affected                                                                                                                        | Risk                                                                                                                                    | Regression testing needed                                                                                                                                                                                     | Migration/compat concerns                                                                                                                                                                                                   |
| ----------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **G2** — `PostingMatrixService.ts` debitCode `4200→4900`          | accounting-service only (one constant)                                                                                                  | Very low — single string value, matches an account that already exists in every tenant's seeded CoA                                     | Re-run the sale-return I just created (or a fresh one) through to journal posting; spot-check no other posting-matrix rule references `4200` anywhere else (grep confirms none)                               | None — no schema change, no data migration; any past sale returns that failed to post will still be missing a journal (would need a one-off backfill script if this matters for existing dev data — flagging, not blocking) |
| **G1** — add `isRegistered` to `SupplierSchema` + frontend toggle | sales-service (supplier CRUD), web-frontend (supplier form), indirectly purchase-service/gst-service (consumers of the flag, unchanged) | Low — additive optional field with a safe default (`true`, preserving all existing behavior for every supplier created before this fix) | Create a real unregistered supplier → GRN → confirm `gst_ledger.rcm_applicable=true` → confirm GSTR-3B Table 3.1(d)/4A goes non-zero (this closes the loop PG-039 already built but could never be exercised) | None — purely additive; existing suppliers keep `isRegistered=true`, unaffected                                                                                                                                             |
| **G3** — surface RCM Register in GstRegisterPage                  | web-frontend only                                                                                                                       | Very low — new read-only view on an existing, already-correct backend endpoint                                                          | Manual check: RCM filter shows correct rows once G1 produces real RCM data                                                                                                                                    | None                                                                                                                                                                                                                        |
| **G4** — bump test timeout                                        | gst-service test config only                                                                                                            | None — test infra only                                                                                                                  | Re-run `pnpm --filter @erp/gst-service test` clean                                                                                                                                                            | None                                                                                                                                                                                                                        |

**General regression risk for this module:** GST-domain logic is duplicated per-service by design (no cross-service calls) — fixing G1/G2 does not touch `Gstr1Service`, `Gstr3bService`, `GSTR9Engine`, or `EInvoiceService`/`EwayBillService`, so GSTR-1/3B/9/e-Invoice/e-Way Bill computations are not at risk from these two fixes. The main regression surface is: (a) accounting's Trial Balance/P&L for sale-return-heavy periods (G2), and (b) supplier creation/edit forms and any existing supplier-list filters that might assume `isRegistered` is always `true` (G1) — a targeted grep before implementing should confirm no such assumption exists.

---

## 4. Fix Plan

### G2 (recommend fixing first — smallest, highest-confidence, most severe)

- **Why needed:** Every sale return in the system currently fails to post its reversing journal, silently breaking the books for a common, frequent business event.
- **Approach:** One-line constant fix (`'4200'` → `'4900'`) in `PostingMatrixService.ts`.
- **Alternative considered:** Add account `4200` to the seed template instead of fixing the posting-matrix reference. **Rejected** — `4900` already exists, is already the correctly-named "Sales Returns (Contra Revenue)" account, and is presumably already used/expected elsewhere; adding a duplicate account would create two contra-revenue accounts with the same purpose, which is worse than fixing the one-line reference.
- **Why preferred:** Minimal surface area, matches existing seeded data exactly, no new migration.

### G1

- **Why needed:** RCM is a mandated GST self-assessment; it is currently impossible to trigger, which is worse than a display bug — a real business with unregistered-supplier purchases would produce a wrong (understated) GSTR-3B with no way to fix it inside the product.
- **Approach:** Add `isRegistered: z.boolean().default(true)` to the Zod schema, thread through to the insert/update, add a frontend checkbox/toggle to the supplier form (mirroring how `GstConfigPage`'s "Interstate (IGST)" checkbox is done elsewhere in this codebase for a similar boolean-flag UI pattern).
- **Alternative considered:** Infer "unregistered" automatically from whether a GSTIN is present (`gstin == null → unregistered`), instead of an explicit field. **Rejected** — a supplier can legitimately not have a GSTIN on file for administrative reasons while still being registered (or vice versa in edge cases), and this codebase already has a precedent of avoiding unreliable auto-detection in favor of explicit fields (see PG-039's explicit rejection of GSTIN-based import detection for the same reason). An explicit field matches the real GRNService logic exactly and doesn't guess.
- **Why preferred:** Matches the field GRNService already expects exactly; no guessing logic to get subtly wrong.

### G3

- **Why needed:** Once G1 makes RCM data real, users need to see it, not just its rolled-up total in GSTR-3B.
- **Approach:** Add "RCM" as a `Type` filter option in the existing `GstRegisterPage.tsx`, wired to `gstApi.rcmRegister()`.
- **Alternative considered:** Build a dedicated new page/route. **Rejected** — `GstRegisterPage` already has the exact list/table/period-filter UI shape needed; a new page would duplicate it for no benefit.

### G4

- **Why needed:** Prevent CI flakiness.
- **Approach:** `testTimeout: 10000` in the two affected test files (or `vitest.config.ts` globally if other gst-service tests show the same cold-import cost).

---

## 5. Implementation Status

**G2 — FIXED and live-verified.** `PostingMatrixService.ts:52` `debitCode: '4200'` → `'4900'`. Rebuilt + restarted accounting-service. Re-created a fresh sale return (return #8) end-to-end and confirmed via direct DB query: journal posts DR account 10 (4900, Sales Returns) ₹1,050 / CR account 20 (1120, Trade Debtors) ₹1,050 — balanced, correct accounts, correct amount.

**G1 — FIXED and live-verified for the "can RCM be triggered at all" question; a second, closely-related bug (G6, below) was discovered while verifying it.** Added `isRegistered: z.boolean().default(true)` to `SupplierSchema`/`SupplierUpdateSchema` in `apps/sales-service/src/api/supplier.routes.ts` (flows through automatically since both insert/update spread `...body.data`), mirrored in the frontend `supplierFormSchema` + a new "GST Registered" checkbox in `SupplierFormPage.tsx` (defaulted to `true` explicitly, since a checkbox reports an explicit boolean on submit unlike a blank text field). Rebuilt + restarted sales-service. Live end-to-end: created a real unregistered supplier (`isRegistered:false` now persists, confirmed) → PO → approved → GRN → confirmed `rcmApplicable:true` on the GRN, `grandTotal` correctly excludes GST (₹5,000 vs ₹5,250 taxable+tax) → approved the GRN → confirmed a real `gst_ledger` row now exists with `rcm_applicable=true, taxable_amount=5000` (previously: zero such rows existed for this tenant, structurally impossible).

**G6 — discovered during G1 verification, Critical, FIXED and live-verified same session.** RCM tax amount (CGST/SGST/IGST) was always ₹0 in `gst_ledger`, even once RCM correctly triggers. Root cause: `apps/purchase-service/src/domain/GRNService.ts` deliberately zeroes `cgstAmount`/`sgstAmount`/`igstAmount` in the shared `GRN_APPROVED` outbox payload for RCM GRNs (so accounting-service doesn't double-book a "GST payable to supplier" line) — the real self-assessed liability was instead only reaching accounting-service via a _separate_ event (`RCM_LIABILITY_POSTED`), which gst-service had no consumer for at all, so `gst_ledger` permanently recorded ₹0 tax for every RCM row.

**Fix:** added `GstLedgerService.applyRcmLiability()` (apps/gst-service/src/domain/GstLedgerService.ts) — looks up the `gst_ledger` row by `sourceDocumentType='GRN' + sourceDocumentId`, splits the `RCM_LIABILITY_POSTED` event's lump-sum `rcmTaxAmount` into CGST+SGST (50/50) or IGST using the row's own already-correct `isInterstate` flag (mirroring this codebase's existing intrastate/interstate split convention elsewhere, e.g. e-Way Bill payload building), and patches the row's tax columns + recomputed `gstRate`/`totalGst`/`grandTotal`. Wired a new `handleRcmLiabilityPosted` consumer (apps/gst-service/src/consumers/GRNGstConsumer.ts) into `apps/gst-service/src/main.ts`'s event dispatcher and `erp.rcm.liability.posted` topic subscription. Cess is deliberately left at its existing value (not decomposed from the lump sum — no reliable way to split it without more data than the event carries, documented in code).

**Live-verified:** created a second fresh unregistered-supplier PO→GRN cycle (GRN-QA-RCM-2, ₹2,000 taxable, 5% intrastate). Post-fix, `gst_ledger` shows `cgst_amount=50.00, sgst_amount=50.00, total_gst=100.00, grand_total=2100.00, gst_rate=5.00` — all correct. `GET /gst/gst/gstr3b?period=2026-07` now shows `table31.inwardRcm: {cgst:50, sgst:50, taxableValue:7000}` and `table4.itcAvailable.rcm: {cgst:50, sgst:50}` — real, non-zero, correct. The pre-fix GRN (GRN-QA-RCM-1) correctly remains at ₹0 (its event was already consumed before the fix existed — expected, not a bug; a real go-live tenant with pre-fix RCM history would need a similar backfill consideration, though this is dev-phase test data only). gst-service test suite re-run clean (only the pre-existing, unrelated G4 timing-flaky tests failed, confirmed via targeted re-run of the actually-touched test files `gst-ledger-service-summary.test.ts` + `gst-engine.test.ts`, both fully green).

**G3 (RCM Register UI), G4 (test timeout) — not yet fixed**, out of scope for this session per explicit user direction (fix G6 only, stop there).

---

## 6. Final Validation Plan (once fixes are approved and applied)

1. G2: re-create a sale return via the live stack, confirm a journal posts with correct DR 4900 (Sales Returns) / CR 1120 (Trade Debtors) lines, confirm Trial Balance reflects it.
2. G1: create a real unregistered supplier via the fixed API/UI → GRN → confirm `gst_ledger.rcm_applicable=true` → confirm GSTR-3B Table 3.1(d) and Table 4A(rcm) both go non-zero → confirm `computeItcSetoff()`'s `cashRequired` reflects the added liability (this is the exact acceptance criterion PG-039 already wrote but could never verify).
3. G3: confirm the RCM filter renders the same data as the direct API call.
4. Re-run full `pnpm --filter @erp/gst-service test` and `pnpm --filter @erp/accounting-service test` clean.
5. Spot-check no regression in GSTR-1/GSTR-9/e-Invoice/e-Way Bill (untouched by G1/G2, but cheap to re-verify given they share `gst_ledger`).

---

## 7. Summary

**Issues found:** 6 (1 Critical found during fix verification [G6], 1 Critical [G1], 1 High [G2], 1 Medium [G3], 1 Low [G4], plus 4 areas explicitly flagged as untested rather than guessed at).
**Issues fixed:** 3 — **G2** (sale-return accounting posting), **G1** (RCM can now be triggered at all), and **G6** (RCM now reports its real, correct tax amount, not just a correct taxable value). All three rebuilt, restarted, and live-verified end-to-end against the running stack; all three services' regression suites re-run clean (failures traced to pre-existing system-load timeouts, confirmed passing standalone, zero true regressions).
**Remaining risks:**

- **G3** — RCM Register has a correct backend and correct data (now that G6 is fixed) but no UI, so the detail behind the GSTR-3B RCM total still isn't visible to users. Not fixed this session, per explicit scope.
- **G4** — cosmetic test flakiness only, not a product risk.
- Historical pre-fix data note: the one RCM GRN created before the G6 fix (GRN-QA-RCM-1) permanently shows ₹0 tax in `gst_ledger` since its `RCM_LIABILITY_POSTED` event was already consumed by the old code — dev-phase test data only, no action needed, but flag this exact pattern if a real tenant ever had RCM activity before this fix ships.
  **Recommended future improvements:** a CI check that fails when a `PostingMatrixService` account code doesn't exist in `default-accounts.ts` (would have caught G2 automatically); a lint/test rule requiring every `apiClient`-exposed method in `endpoints.ts` to have at least one caller in the frontend (would have caught G3, and the several prior "backend built, UI never wired" bugs this codebase has repeatedly hit); a cross-consumer contract test asserting that any field zeroed in one event consumer's payload for a documented reason has an equivalent real value available to every _other_ consumer of that same event (would have caught G6 before it shipped — the exact same "shared payload, one consumer's need breaks another's assumption" shape as the historical B1/sale-return bugs, and now a third confirmed instance of it in this module alone).
  **Test coverage achieved this session:** gst-service/accounting-service/sales-service full unit suites run standalone (all real failures were pre-existing system-load timeouts, confirmed via isolated re-run, zero true regressions from G1/G2/G6); 4 real live end-to-end flows driven against the running stack (Compliance Calendar mark-filed + one-way lock, sale-return → GST-ledger + accounting incl. the G2 fix, and two full RCM chains supplier→PO→GRN→gst_ledger→GSTR-3B, before and after the G6 fix, to prove the exact before/after difference); 4 areas (e-Invoice, GSTR-2A, e-Way Bill, CDNR-with-real-data) remain live-untested pending a follow-up session (background testing agent was cut short by an account usage limit).

---

## 8. Session 2 (2026-07-20, continued) — closed out G3/G4, live-tested every remaining area, found + fixed a 7th bug (G7)

User asked to finish the remaining open items and get the whole module genuinely working, offering to help with any real blocker. No further background agents were used (the account usage limit from Session 1 was assumed still in effect) — everything below was driven directly via curl/DB queries against the same running stack, the same way G1/G2/G6 were found and fixed.

### G4 — FIXED

Root cause was more precise than originally described: `apps/gst-service` had **no `vitest.config.ts` at all**, so it silently used Vitest's built-in 5000ms default instead of the monorepo's shared 10s/15s convention every other service-with-a-config uses. Added `apps/gst-service/vitest.config.ts` with `testTimeout: 15_000` (matching `auth-service`'s existing value). Re-ran: 10/10 test files pass clean, including the two previously-flaky ones (3.8s and 4.9s actual runtime — genuinely just slow cold imports, never a hang).

### G3 — FIXED and live-verified

Added an "RCM (Reverse Charge)" option to `GstRegisterPage.tsx`'s existing Type filter, routed to the already-correct `gstApi.rcmRegister(period)` client method when selected (no backend change needed — `GET /gst/rcm-register` and the existing `GET /gst/register` return identical `gst_ledger` row shapes, confirmed by reading both query implementations). Also added a 5th "RCM Liability" summary tile next to the existing Sales/Purchases/Credit Notes/Purchase Returns tiles, since `GstLedgerService.getSummary()` has carried a real `rcm` bucket since PG-039 but nothing rendered it. `tsc --noEmit` clean; live-verified both `GET /gst/gst/rcm-register` and `GET /gst/gst/summary`'s `rcm` field return real, correct data matching what the page now renders.

### e-Invoice (IRN) / e-Way Bill — confirmed to be a genuine external-credential gap, not a bug

Traced the full auto-IRN pipeline live: created a B2B customer with a real-format GSTIN, confirmed an invoice against them, and watched gst-service's log. First attempt failed with `"e-Invoice: seller GSTIN/address not configured; skipping auto-IRN"` — the tenant's own **Organization Settings** (`GET/PUT /tenant/organization`) had `gstin: null, address: null` (nobody had ever configured this tenant's own seller identity across any prior QA session). This is real tenant master data, not a secret, so I set it (`PUT /tenant/organization` with a real-format GSTIN and address) — this itself is arguably a legitimate onboarding-completeness finding (a tenant can operate the entire rest of the ERP without ever configuring its own GSTIN, and silently gets no e-Invoice/e-Way Bill functionality with only a warn-level log, no user-facing error, until someone notices). After fixing that, a second confirmed invoice progressed further and failed cleanly with `NIC_NOT_CONFIGURED` (`BusinessError`, HTTP 422) — this is the genuine, expected stopping point: `NIC_API_KEY`/`NIC_USERNAME`/`NIC_PASSWORD` (documented in `.env.example`) are blank in this environment, and generating a real IRN/e-Way Bill requires actual credentials from India's NIC e-Invoice/e-Way Bill sandbox or production portal (GSP registration or direct API access) — something only the user/business can obtain, not something derivable or fabricatable. **Code confirmed correct and safe**: proper prerequisite validation, clean typed error, no crash, no silent wrong data. **Action needed from the user, if real IRN/EWB testing is wanted:** register for NIC e-Invoice API sandbox access (or via a GSP) and provide `NIC_API_KEY` (+ username/password if the chosen integration path needs them) in `.env`.

### GSTR-2A Reconciliation — live-tested fully, zero bugs found

Created a registered supplier with a real GSTIN, ran three separate PO→GRN→approve cycles to produce three real `gst_ledger` PURCHASE rows, then exercised `POST /gst/gstr2a/import` + `GET /gst/gstr2a/reconciliation` against them to hit all four reconciliation outcomes with real data:

- **MATCHED** (exact amount, real ledger row) — correct, `matchedLedgerId` points to the real row, `matchVariance: 0.00`.
- **AMOUNT_MISMATCH** (books ₹4,000 vs GSTR-2A ₹4,500, i.e. beyond the ±1% tolerance) — correctly flagged, variance ₹500 exactly right.
- **GSTR2A_ONLY** (imported row with no matching purchase in the books) — correctly bucketed, right taxable amount.
- **BOOKS_ONLY** (real purchase never imported into GSTR-2A) — correctly bucketed, right taxable amount.
  No bugs found in this area — the ±1% tolerance matcher, the four-way classification, and the summary aggregation all work exactly as designed.

### G7 — NEW bug found live-testing CDNR, FIXED and live-verified

Created a real B2B customer (with a valid-format GSTIN), invoiced and confirmed against them, then created a sale return. The resulting credit note's `gst_ledger` row had `gstin_of_counterparty: null` and `counterparty_name: null` — even though the customer genuinely has a GSTIN on file — which meant GSTR-1 filed it under **CDNUR** (unregistered) instead of **CDNR** (registered), and with a blank receiver name/GSTIN either way. This is a real compliance-relevant classification bug, not a display issue.

**Root cause:** identical shape to the B1/other-GST-producer bugs — `apps/gst-service/src/consumers/SaleReturnGstConsumer.ts`'s payload interface has _always_ declared `customerName?: string; customerGstin?: string;` and its handler already reads `p.customerGstin`/`p.customerName` — but `apps/sales-service/src/domain/SaleReturnService.ts` (the producer) never fetched or sent either field, even in the `d9d657e` fix two days prior that fixed every _other_ field mismatch on this same event. `Gstr1Service.ts`'s CDNR/CDNUR classification logic itself was always correct (splits on `gstinOfCounterparty.length === 15`) — it simply never received real data to classify.

**Fix:** added a `customers` table lookup (`displayName`, `gstin`) inside `SaleReturnService.create()`'s transaction, right before the outbox-event insert, and threads `customerName`/`customerGstin` into the `SALE_RETURN_APPROVED` payload. Updated `apps/sales-service/src/__tests__/sales-workflow.test.ts`'s mock `.where()` call sequence to account for the new query (this required carefully re-tracing the _actual_ call order in `create()` — the mock queue is a flat FIFO across every `.where()` call in the transaction, and I initially missed two intermediate UPDATE-with-`.where()` calls (`saleReturns` status flip, `projectionCustomerBalance` update) that don't destructure their result and so were silently satisfied by the pre-existing catch-all — the new customer lookup is the first call after those that _does_ destructure, so it needed a real mocked array, correctly positioned as the 7th `.where()` call, not the naively-assumed 4th).

**Live-verified:** fresh B2B invoice → confirm → sale return → `gst_ledger` now shows the real GSTIN (`27AAPFU0939F1ZV`) and name (`QA B2B Customer Pvt Ltd`) on the credit-note row → `GET /gst/gstr1?period=2026-07`'s `sections.cdnr` now correctly contains the entry with the right GSTIN/name/amounts, and `sections.cdnur` no longer absorbs it.

**Regression:** `sales-workflow.test.ts` (16/16 pass, including the corrected mock), full `sales-service` suite (21/21 files, 145/145 tests), full `gst-service` and `accounting-service` suites (unaffected, both clean) all re-run and pass.

### Updated final status

| #                                              | Severity | Status                                                                                                                                                         |
| ---------------------------------------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| G1                                             | Critical | **Fixed**, live-verified (Session 1)                                                                                                                           |
| G2                                             | High     | **Fixed**, live-verified (Session 1)                                                                                                                           |
| G3                                             | Medium   | **Fixed**, live-verified (Session 2)                                                                                                                           |
| G4                                             | Low      | **Fixed**, verified (Session 2)                                                                                                                                |
| G6                                             | Critical | **Fixed**, live-verified (Session 1)                                                                                                                           |
| G7                                             | High     | **Fixed**, live-verified (Session 2)                                                                                                                           |
| e-Invoice / e-Way Bill real IRN/EWB generation | —        | **Blocked on external NIC credentials** — code confirmed correct up to that exact boundary; needs `NIC_API_KEY` (+ username/password) from the user, see above |
| GSTR-2A Reconciliation                         | —        | **Live-tested, zero bugs found**                                                                                                                               |

**Every area in this module that could be tested without a real external government-portal credential has now been live-tested with real data, and every bug found has been fixed and live-verified.** The one remaining gap (real NIC IRN/e-Way Bill generation) is a credential/access question for the user, not an engineering task — the code path up to that boundary is confirmed correct and fails safely.
