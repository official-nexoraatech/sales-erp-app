# GST Module — Fresh Production-Readiness Audit (2026-07-25)

Scope: `apps/gst-service` (GST ledger, GSTR-1, GSTR-2A, GSTR-3B, GSTR-9, e-Invoice, e-Way Bill) +
`apps/web-frontend/src/pages/gst`. All findings below were re-verified against current code and a
live stack (gateway :3000, gst-service :3018, sales-service :3013, purchase-service :3020,
Postgres `erp-postgres-primary`, tenant 2 "QA E2E Test Co"). Prior audit claims in `ERP-PLANNING/`
were treated as unverified leads only.

## Summary

The GST module's core money-critical paths are genuinely correct and were independently
live-verified with fresh transactions during this session: intrastate/interstate sale invoices,
a GRN with real ITC tracking, a full reverse-charge (RCM) purchase (including the follow-up
liability patch), and a sale return that correctly lands in the GST ledger as a reachable credit
note in GSTR-1. The 2026-07-13 "GSTR-9 100% nil-rated" bug is fixed at the architecture level
(GSTR-9's Table 4/5 split no longer depends on `gst_rate` at all, it uses actual tax charged), and
the previously-flagged `gst_rate` backfill (migration `0067_gst_ledger_gst_rate_backfill.sql`) is
confirmed applied — zero NULL/misclassified rows remain for tenant 2. e-Invoice and e-Way Bill both
fail cleanly with `NIC_NOT_CONFIGURED` (422) when triggered live — genuinely just a missing
external credential, not a masked code bug. The full `gst-service` test suite passes (48/50, 2
skipped for the known pre-existing JWT-issuer test-infra gap).

Two real, previously-unflagged issues were found this session: (1) the **root cause** of the
2026-07-12/13 "always interstate" bug — the `is_interstate` flag itself — was never backfilled for
historical rows, only its downstream symptom (`gst_rate`) was; 33 real tenant-2 sales-invoice rows
still carry a wrong `is_interstate=true` flag today, corrupting the GSTR-1 B2CS "type" (INTER/INTRA)
field for period 2026-07. (2) The AUDITOR role — whose entire purpose is financial oversight and
which already holds `GSTR9_VIEW` — is missing `GST_VIEW`, `GSTR1_VIEW`, `GSTR3B_VIEW`, and
`GSTR2A_RECONCILE`, so an auditor can see the annual return but not the monthly/quarterly ones or
the underlying ledger register. Both are live-confirmed, not just code-read.

## What works (verified live, real record IDs)

- **Intrastate sale invoice** (tenant 2, customer 1 "Ramesh Textiles", item 1 "Cotton Saree",
  ₹2,000 taxable @ 5%): invoice id **126** (`INV/26-27/00003`), confirmed →
  `gst_ledger` id **83**: `is_interstate=f`, `cgst=50.00`, `sgst=50.00`, `igst=0.00`,
  `gst_rate=5.00`. Correct 50/50 CGST/SGST split, `gst_rate` populated (not NULL).
- **Interstate sale invoice** (new customer id 924 "GST Audit Karnataka Customer",
  GSTIN `29AABCU9603R1ZH`, ₹5,000 taxable @ 5%, MH→KA): invoice id **127**
  (`INV/26-27/00004`), confirmed → `gst_ledger` id **84**: `is_interstate=t`, `cgst=0`,
  `sgst=0`, `igst=250.00`, `gst_rate=5.00`. Correct full-IGST split.
- **GRN / ordinary ITC tracking**: pre-existing tenant-2 GRN data (e.g. `gst_ledger` id 81,
  GRN-AUDIT-33, taxable ₹20,000, CGST/SGST ₹500/₹500, `itc_eligible=t`) confirms ordinary
  purchase ITC posts correctly on gst-service's own ledger, independent of whether
  accounting-service's journal posting succeeds — these are separate consumers
  (`GRNGstConsumer.ts` vs accounting-service's `GRNAccountingConsumer.ts`), confirming the
  PostingMatrixService `2010`/`2100` GL-code bug found in the sibling Purchase/Suppliers audits
  does **not** affect GST-side ITC tracking.
- **RCM (reverse-charge) purchase, fresh end-to-end test**: created unregistered supplier
  id 15, PO id 55 (approved, ₹3,000 taxable @ 5%, CGST/SGST ₹75/₹75), GRN id 34
  (`GRN-GST-AUDIT-34`, approved) → `gst_ledger` id **85**: `cgst=75.00`, `sgst=75.00`,
  `gst_rate=5.00`, `itc_eligible=t`, `rcm_applicable=t` — exactly matching the GRN's real
  self-assessed tax. This confirms `GstLedgerService.applyRcmLiability`'s two-step
  write-then-patch flow (`GRN_APPROVED` zeroes tax, `RCM_LIABILITY_POSTED` patches it in) works
  correctly today.
- **Sale return → GST credit note, fresh end-to-end test**: returned 1 of 2 units from invoice
  126 → sale-return id 12, credit note id 12 (`CN-2-1784931802740`) → `gst_ledger` id **86**:
  `entry_type=CREDIT_NOTE`, `source_document_type=SALE_RETURN`, taxable ₹1,000, CGST/SGST
  ₹25/₹25. Confirmed **reachable in GSTR-1**: `GET /gst/gstr1?period=2026-07` lists this exact
  credit note in the `cdnur` (unregistered credit note) array — the sale-return→GST-ledger path
  from commit `d9d657e` works correctly on the GST side, independently verified from the
  accounting side already confirmed by the Sales audit.
- **GSTR-1 B2CS/B2CL threshold** (`Gstr1Service.ts`): `val <= 250000 → B2CS`, else `B2CL` — code
  confirms the 2026-07-12 inversion is fixed; live period 2026-07 data has zero B2CL entries and
  three B2CS groups, consistent with no invoice in the period exceeding ₹2.5L.
- **GSTR-9** (`GET /gst/gstr9?year=2026-27`): Table 4 (taxable) = **₹122,850**, Table 5
  (nil-rated) = **₹0** — the classification no longer keys off `gst_rate` (which was NULL on old
  rows) but off actual tax charged (`hasTax` = cgst+sgst+igst > 0), so it is correct regardless of
  backfill status. Table 6 ITC split (ordinary vs RCM) and Table 9 (tax paid, unfiled-period
  tracking) both populate sensibly.
- **GSTR-2A reconciliation** (`GET /gst/gstr2a/reconciliation?period=2026-07`): real reconciled
  data from a prior session still live — 1 matched, 1 books-only, 1 GSTR2A-only, 1 amount-mismatch
  bucket, all populated with real supplier/GRN data. Confirmed still functional.
- **e-Invoice** (`POST /gst/einvoice/generate/126` with a full, schema-valid NIC payload): returns
  `422 NIC_NOT_CONFIGURED` — the check happens before any network call, confirming this is
  cleanly an external-credential gap, not a masked code defect.
- **e-Way Bill** (`POST /gst/eway-bill/generate` with a full, schema-valid payload, value above the
  ₹50,000 threshold): also returns `422 NIC_NOT_CONFIGURED` for the same reason.
- **RBAC — negative test**: STAFF role gets `403 FORBIDDEN` (`Missing permission: GSTR1_VIEW` /
  `GSTR9_FILE`) on both GSTR-1 view and GSTR-9 export.
- **RBAC — positive test**: ACCOUNTANT can view GSTR-1 and the GST register (200 OK).
- **Multi-tenant isolation**: every read path in `GstLedgerService`, `Gstr1Service`,
  `Gstr2aService`, `Gstr3bService`, `GSTR9Engine` filters on `eq(gstLedger.tenantId, tenantId)` —
  confirmed by code review across all five domain files, and by a dedicated unit test
  (`gst-engine.test.ts` #7, "tenant isolation — GSTR-9 for tenant A returns zero tenant B data").
  Only one active tenant (2) exists in this dev environment, so true live cross-tenant leakage
  could not be exercised end-to-end this session.
- **Test suite**: `pnpm --filter @erp/gst-service test` → **11 files, 48 passed, 2 skipped**
  (the 2 skips are the known pre-existing JWT-issuer 401-vs-403 test-infra gap, not new bugs).

## Bugs / gaps found

### 1. `is_interstate` was fixed at the code level but never backfilled — real historical data still wrong (High)

The 2026-07-13 QA session fixed the root cause (`InvoiceGstConsumer`/`SaleReturnGstConsumer` now
read the producer's real `isInterstate` flag instead of an always-true comparison) and shipped a
backfill for the **symptom** (`gst_rate`, migration `0067_gst_ledger_gst_rate_backfill.sql`,
confirmed applied — 0 NULL rows for tenant 2). But no equivalent backfill was ever written for the
`is_interstate` column itself, which was the actual root of the original bug.

Live evidence (tenant 2, `gst_ledger`, period 2026-07):

```
place_of_supply | is_interstate | count | sum(taxable)
27               | t             | 33    | 107,850.00   <- WRONG: seller state is also 27 (MH)
27               | f             | 2     | 7,000.00     <- correct
```

All 33 rows are dated 2026-07-12 (before the fix landed) and have real, correctly-computed
`cgst`/`sgst` amounts with `igst=0` — the actual tax collected is right, only the boolean tag is
wrong. Impact: `Gstr1Service.ts` line 154 uses this flag to tag each B2CS group `INTER`/`INTRA` in
the NIC-format JSON export; a B2CS entry tagged `INTER` with `placeOfSupply` equal to the seller's
own registered state (MH/27) is internally inconsistent with an all-CGST/SGST tax split and would
misreport which state's government the tax revenue belongs to if filed as-is. One further isolated
row also has `place_of_supply='MH'` (a literal state name instead of the 2-digit code) — a
one-off data-entry artifact from an earlier ad-hoc test, not a systemic issue.

Downstream impact is narrower than it first looks: `EInvoiceService`, `GstComplianceSaga`
(e-Way Bill), and `GSTR9Engine` all independently re-derive interstate-ness from `igstAmount > 0`
rather than trusting the stored flag, so e-Invoice/EWB payloads and GSTR-9 are unaffected. Only
`Gstr1Service`'s B2CS `type` field (and the NIC JSON export built from it) is corrupted for the
affected period.

**Business impact**: any tenant that went live with the pre-2026-07-13 code has a data-integrity
gap in the GSTR-1 exports for the affected period(s) that the existing `gst_rate` backfill did not
fix. Needs a companion backfill (recompute `is_interstate` from `igst_amount > 0`) before those
periods are filed.

### 2. AUDITOR role can view the annual return but not the monthly/quarterly ones (Medium)

`apps/tenant-service/src/rbac/role-defaults.ts`'s `AUDITOR` block grants `GSTR9_VIEW` but not
`GST_VIEW`, `GSTR1_VIEW`, `GSTR3B_VIEW`, or `GSTR2A_RECONCILE` — live-confirmed:

```
GET /gst/gstr9?year=2026-27          → 200 OK  (as AUDITOR)
GET /gst/register?period=2026-07     → 403 Missing permission: GST_VIEW
GET /gst/gstr3b?period=2026-07       → 403 Missing permission: GSTR3B_VIEW
```

This is the same "granted-but-dead-permission" pattern noted elsewhere in this codebase's history
(see `role-defaults.ts` comments around lines 223–244, where the identical gap was already found
and fixed for `ACCOUNTANT_SUPERVISOR` — that role holds the full `GST_VIEW`/`GSTR1_VIEW`/
`GSTR3B_VIEW`/`GSTR2A_RECONCILE`/`GST_COMPUTE` set). AUDITOR's entire stated purpose ("financial
oversight") is inconsistent with being able to see the annual roll-up but none of the monthly
filings or the underlying GST ledger register that feed it.

**Business impact**: a tenant relying on the AUDITOR role for GST compliance review cannot
actually review monthly/quarterly GST filings or the register — only the once-a-year GSTR-9.

### 3. Minor: one stale, unpatched historical RCM row (Low, informational)

`gst_ledger` id 68 (GRN 28, `GRN-QA-RCM-1`, dated 2026-07-20 16:48 — roughly the same session that
shipped the G6 RCM fix) still shows `cgst=0, sgst=0, gst_rate=0` despite the underlying GRN having
real self-assessed tax (`cgst=125, sgst=125` in `purchase-service.grns`). This looks like leftover
test data from immediately before/during that fix rather than a currently-live bug: a fresh,
independently-created RCM GRN in this session (id 34, see "What works" above) patched correctly
end-to-end. Not a current code defect, but this one row will permanently understate GRN 28's RCM
liability in any historical report that reads it.

### 4. Minor: in-app help content is stale on the RCM fix (Low, informational)

`apps/web-frontend/src/dap/content/tours/purchase/grns-complete-guide.tour.ts` and
`.../gst/gstr3b-complete-guide.tour.ts` both still describe "a known payload gap zeroes the GST
ledger's RCM tax figures even though the accounting entry books correctly" as a live caveat users
should work around. This session confirms that gap is fixed (see RCM test above) — the DAP tour
copy was not updated when the G6 fix shipped and now tells users to manually cross-check something
the system already handles.

### 5. Minor: no dedicated unit test for the sale-return → GST-ledger consumer (Low)

`apps/gst-service/src/__tests__/` has no test file exercising
`SaleReturnGstConsumer.handleSaleReturnApproved` directly (searched for both the filename and the
function name — no matches). The behavior is correct (independently confirmed live in this
session), but it has no regression coverage of its own; a future change could silently break it
without a red test.

## Untested / unknown areas

- True live cross-tenant leakage (a second real tenant issuing a request and confirming zero
  bleed-through) — only one active tenant exists in this dev environment; isolation is
  code-reviewed + unit-tested but not live-tenant-to-tenant tested this session.
- GSTR-1 Excel export and GSTR-1 auto-prepare endpoints were not exercised live (only unit-tested
  per the passing `gstr1-excel-export.test.ts`).
- e-Invoice/e-Way Bill cancellation flows, and the actual NIC IRP/EWB API integration once a real
  `NIC_API_KEY` is supplied — cannot be tested without that external credential.
- GST Compliance Saga's full multi-step orchestration (beyond the `buildEwayBillPayload` unit
  tests) was not exercised live end-to-end.
- Frontend pages (`apps/web-frontend/src/pages/gst/*.tsx`) were reviewed for correct API wiring
  only (endpoint paths match backend routes) — not click-tested in a live browser this session.

## Readiness score: 82/100

**Justification**: The financially load-bearing paths — sales GST posting (both intrastate and
interstate), purchase ITC tracking, RCM self-assessment, sale-return credit notes reaching GSTR-1,
and GSTR-9's revenue classification — are all genuinely correct today and were independently
proven with fresh, real transactions, not just re-read from prior claims. e-Invoice/e-Way Bill are
cleanly gated on a missing external credential rather than hiding a code bug. The full backend test
suite passes. What holds this back from a higher score: one real, live data-integrity gap
(un-backfilled `is_interstate` corrupting the GSTR-1 B2CS type field for historical periods) that
could produce an invalid or misleading NIC filing if those periods are filed as-is, and one real
RBAC gap (AUDITOR can't see monthly/quarterly returns) that undermines the compliance-oversight
role's actual purpose. Both are narrow, well-understood, and inexpensive to fix (a targeted
backfill migration + adding four permission constants to one role), but they are live production
gaps, not resolved ones.
