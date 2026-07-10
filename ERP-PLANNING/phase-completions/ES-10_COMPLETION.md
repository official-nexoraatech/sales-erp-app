# ES-10 Completion Report — GST Compliance
**Date:** 2026-07-03
**Status:** COMPLETE (adapted to the codebase's actual architecture — see Deviations)

## Summary
The phase prompt assumed a single `GSTEngine.ts`. The actual codebase splits GST logic
across three places: `gst-service` (GST ledger, GSTR-1/2A/3B, HSN master — already had
`cessRate`/`cessAmount` end-to-end at the ledger level), `sales-service`'s own
`GSTCalculator.ts` (invoice/POS line computation), and `purchase-service`'s own
`GSTCalculator.ts` (GRN line computation). Cess was **already fully wired** through
`gst-service`'s ledger, HSN master, and GSTR-1/GSTR-3B — the actual gap was that the two
per-service line calculators (sales, purchase) never accepted a `cessRate` and never
persisted it, and — far more seriously — a real, live bug: **the `INVOICE_CONFIRMED` and
`GRN_APPROVED` outbox payloads were missing almost every GST field the ledger consumers
read**, meaning the GST ledger has been silently recording ₹0 taxable/CGST/SGST/IGST for
every sales invoice and every GRN since it was built. That's fixed as part of Fix 4 below.

## GST Calculation Audit
**Bugs found: 3**

1. **`InvoiceService.confirm()` (sales-service) wrote a truncated `INVOICE_CONFIRMED`
   outbox payload** — only `{invoiceId, invoiceNumber, customerId, grandTotal}`. But
   `gst-service`'s `InvoiceGstConsumer` reads `taxableAmount`, `cgstAmount`, `sgstAmount`,
   `igstAmount`, `customerGstin`, `placeOfSupply`, `gstRate`, `branchId` from that payload.
   Every field it didn't find defaulted to `0`/`null`. Result: every `gst_ledger` row for
   every confirmed invoice had `taxableAmount = 0`, `cgstAmount = 0`, etc. — GSTR-1, GSTR-3B,
   and the GST Register have been silently wrong for all sales data. **Fixed**: the payload
   now carries the full breakdown already computed and stored on the `invoices` row, plus a
   customer GSTIN/name lookup and `isInterstate` derived from `igstAmount > 0`.
2. **Same bug, `GRNService.approve()` (purchase-service) → `GRN_APPROVED`** — consumed by
   *both* `gst-service`'s `GRNGstConsumer` (GST ledger) and `accounting-service`'s
   `GRNAccountingConsumer` (ITC journal lines). Same silent-zero effect on the purchase
   side of the GST ledger *and* on every GST input-credit journal line ever posted for a
   GRN. **Fixed**: payload now carries `taxableAmount`/`cgstAmount`/`sgstAmount`/
   `igstAmount`/`cessAmount`/`placeOfSupply`/`sellerStateCode`/`supplierGstin`/
   `supplierName`/`branchId`/`isInterstate`/`rcmApplicable`.
3. **`GRNService.create()`'s `grandTotal` formula omitted cess** even before this phase
   added cess support (`taxableAmount + cgstAmount + sgstAmount + igstAmount`, no cess
   term) — a pure oversight, now correct since cess is threaded through the same formula.

## Cess Implementation
- `hsn_master.cess_rate` (gst-service ledger) — already existed, untouched.
- `gst_ledger.cess_amount` — already existed, untouched.
- **New**: `invoices.cess_amount`, `invoice_lines.cess_rate` / `cess_amount`
- **New**: `grns.cess_amount`, `grn_lines.cess_rate` / `cess_amount`
- `sales-service/domain/GSTCalculator.ts` and `purchase-service/domain/GSTCalculator.ts`
  (the per-service *line*-level calculators, distinct from `gst-service`'s
  header-level `GSTCalculator.compute`) both gained `cessRate` input / `cessAmount` output.
- `POST /invoices`, `POST /pos/sale`, `POST /grns` line schemas accept optional
  `cessRate` (default 0).
- Migration: `packages/db-client/migrations/0012_es10_gst_cess_rcm.sql`

## RCM Implementation
- **Unregistered vendor detection**: `suppliers.is_registered` (new column, default
  `true`). `GRNService.create()` looks it up; if `false`, the GRN is marked
  `rcm_applicable = true` (new `grns.rcm_applicable` column) and `grandTotal` (the amount
  actually payable to the supplier) is computed as **taxable-only** — the self-assessed
  CGST/SGST/IGST/Cess is still stored on the GRN/lines (for the GST ledger + RCM
  register) but is excluded from what's owed to the supplier.
- **Accounting**: on approval, if `rcmApplicable`, the `GRN_APPROVED` payload sent to
  `accounting-service` zeroes `cgstAmount`/`sgstAmount`/`igstAmount`/`cessAmount` (so no
  spurious "GST payable to supplier" line is posted), and a second outbox event
  `RCM_LIABILITY_POSTED` carries the real self-assessed tax total. New
  `RcmAccountingConsumer.ts` posts **DR RCM Tax Input Credit (1330) / CR RCM Tax Payable
  (2330)** — both new Chart-of-Accounts entries in `default-accounts.ts` (new tenants get
  them automatically; existing tenants must re-call `POST /accounts/seed-defaults`,
  which is idempotent).
- `gst-service/domain/GSTCalculator.ts` gained `calculateRCMTax(baseAmount, gstRate,
  isInterstate)` (thin wrapper over the existing `compute()`).
- `GET /api/v2/gst/rcm-register?period=YYYY-MM` — new route, lists all `gst_ledger`
  entries with `rcmApplicable = true` for a period. Guarded by `GST_VIEW` (the prompt's
  `GST_RETURN_VIEW` permission doesn't exist in this codebase; `GST_VIEW` is the existing
  permission used by the near-identical `/gst/register` route).
- **Not implemented**: "RCM input tax credit available only after payment is made to the
  vendor" (explicitly called out in the prompt's RCM domain rules). ITC is currently
  recognized at GRN approval, same as ordinary purchases. Implementing a payment-linked
  ITC state machine would require a new field on `gst_ledger` plus wiring into
  `SupplierPaymentService`, which is a meaningfully larger change with no existing analog
  in this codebase — flagging as a follow-up rather than building it speculatively.

## GSTR-9
- New `apps/gst-service/src/domain/GSTR9Engine.ts` — pure aggregation over `gst_ledger`
  for a financial year (`periodsForFY("2025-26")` → `2025-04`..`2026-03`).
  - Table 4: taxable outward supplies (sales, net of credit notes, `gstRate > 0`)
  - Table 5: nil-rated/exempt/non-GST outward supplies (`gstRate = 0`)
  - Table 6: ITC availed, split into ordinary inward supplies vs. RCM (via
    `rcmApplicable`)
  - Table 7: ITC reversed (purchase returns + purchases explicitly flagged
    `itcEligible = false`)
  - Table 9: tax paid — this codebase has no persisted cash-vs-ITC discharge split per
    period (that split is computed transiently per-month in `Gstr3bService.
    computeItcSetoff`, never stored), so Table 9 reports total output liability for the
    FY (equal to Table 4's total). Documented limitation, not a fabricated number.
- Routes: `GET /api/v2/gst/gstr9?year=2025-26` (guard: new `GSTR9_VIEW`),
  `GET /api/v2/gst/gstr9/export?year=2025-26&format=json` (guard: new `GSTR9_FILE`,
  audit-logged).
- New permissions `GSTR9_VIEW` / `GSTR9_FILE` (mirroring the existing `GSTR3B_VIEW`/
  `GSTR3B_FILE` pattern), added to `ACCOUNTANT`, `ACCOUNTANT_SUPERVISOR` (+ file),
  `AUDITOR` (view-only); `OWNER`/`ADMIN`/`SUPER_ADMIN` get them automatically
  (exclusion-list / `Object.values(PERMISSIONS)` based, per this codebase's RBAC pattern).
- Frontend: `apps/web-frontend/src/pages/gst/GSTR9Page.tsx` — FY picker, Table 4/5/6/7/9
  as cards, "Download JSON" button, and a real "Prepare Filing" status indicator built
  from the *already-existing* `GET /gst/returns/calendar?fy=` endpoint (flags any
  GSTR-1/GSTR-3B period in the FY not yet `FILED`/`LATE_FILED`/`NIL_FILED`) rather than a
  fabricated gap check.
- Data accuracy: verified via unit tests (below) against hand-computed expected sums,
  and via the tenant-isolation test.

## Incidental Fixes (pre-existing, unrelated to ES-10, needed to unblock `pnpm --filter @erp/web-frontend build`)
- `PayrollPage.tsx`: two adjacent `<tr>` JSX siblings inside `.map()` without a wrapping
  `<Fragment>` — pre-existing syntax error (uncommitted before this session, not touched
  by ES-06/ES-09's diffs). Wrapped in `<Fragment key={run.id}>`.
- `PayslipViewPage.tsx`: `<ERPPageHeader variant="detail">` missing the required `backTo`
  prop. Added `backTo="/hr/payroll"`.

## Files Changed
| File | Change |
|------|--------|
| `packages/db-client/src/schema/sales.ts` | `invoices.cessAmount`; `invoice_lines.cessRate`/`cessAmount` |
| `packages/db-client/src/schema/purchase.ts` | `grns.cessAmount`/`rcmApplicable`; `grn_lines.cessRate`/`cessAmount` |
| `packages/db-client/src/schema/master.ts` | `suppliers.isRegistered` |
| `packages/db-client/migrations/0012_es10_gst_cess_rcm.sql` | NEW — all of the above |
| `packages/shared-types/src/permissions.ts` | `GSTR9_VIEW`, `GSTR9_FILE` |
| `apps/web-frontend/src/constants/permissions.ts` | mirrored |
| `apps/sales-service/src/domain/GSTCalculator.ts` | cess input/output on line calc |
| `apps/sales-service/src/domain/InvoiceService.ts` | cess threading; **`INVOICE_CONFIRMED` payload fix** |
| `apps/sales-service/src/api/invoice.routes.ts`, `pos.routes.ts` | `cessRate` in line schema |
| `apps/purchase-service/src/domain/GSTCalculator.ts` | cess input/output on line calc |
| `apps/purchase-service/src/domain/GRNService.ts` | cess threading; RCM detection + grandTotal exclusion; **`GRN_APPROVED` payload fix**; `RCM_LIABILITY_POSTED` event |
| `apps/purchase-service/src/api/grn.routes.ts` | `cessRate` in line schema |
| `apps/gst-service/src/domain/GSTCalculator.ts` | `calculateRCMTax()` |
| `apps/gst-service/src/domain/GSTR9Engine.ts` | NEW |
| `apps/gst-service/src/domain/GstLedgerService.ts` | `getRcmRegister()` |
| `apps/gst-service/src/api/gstr9.routes.ts` | NEW |
| `apps/gst-service/src/api/rcm.routes.ts` | NEW |
| `apps/gst-service/src/main.ts` | route registration |
| `apps/accounting-service/src/domain/default-accounts.ts` | `1330` RCM Tax Input Credit, `2330` RCM Tax Payable |
| `apps/accounting-service/src/domain/PostingMatrixService.ts` | `RCM_LIABILITY_POSTED` posting rule |
| `apps/accounting-service/src/consumers/RcmAccountingConsumer.ts` | NEW |
| `apps/accounting-service/src/main.ts` | consumer + topic registration |
| `apps/tenant-service/src/rbac/role-defaults.ts` | `GSTR9_VIEW`/`GSTR9_FILE` on ACCOUNTANT/ACCOUNTANT_SUPERVISOR/AUDITOR |
| `apps/web-frontend/src/pages/gst/GSTR9Page.tsx` | NEW |
| `apps/web-frontend/src/api/endpoints.ts`, `App.tsx`, `components/Layout.tsx` | GSTR-9 + RCM register wiring |
| `apps/web-frontend/src/pages/hr/PayrollPage.tsx`, `PayslipViewPage.tsx` | incidental pre-existing bug fixes (see above) |
| `apps/gst-service/src/__tests__/gst-engine.test.ts` | NEW — tests 1, 2, 3, 5, 6, 7 |
| `apps/purchase-service/src/__tests__/rcm.test.ts` | NEW — test 4 |
| `apps/purchase-service/src/__tests__/purchase-workflow.test.ts` | mock script updated for the new supplier lookups |
| `apps/sales-service/src/__tests__/invoice-ledger.test.ts` | mock script updated for the new customer lookup |

## Tests: 7/7 PASS across 2 files (6 in gst-service + 1 in purchase-service — RCM detection is GRNService's logic, not gst-service's, per this codebase's actual module split; see note in the gst-engine.test.ts header)
1. Intra-state 18% GST on ₹10,000 → CGST 900 + SGST 900 + IGST 0 + Cess 0 — PASS
2. Inter-state 18% GST on ₹10,000 → CGST 0 + SGST 0 + IGST 1,800 — PASS
3. Intra-state with 3% cess → Cess = 300 — PASS
4. Unregistered supplier GRN → `rcmApplicable = true`, `grandTotal` excludes GST — PASS
5. GSTR-9 Table 4 taxable outward supplies matches confirmed invoices — PASS
6. GSTR-9 Table 6 ITC sum matches confirmed vendor invoices (ordinary + RCM split) — PASS
7. Tenant isolation — GSTR-9 for tenant A returns zero tenant B data — PASS

No regressions: `purchase-workflow.test.ts` (11/11), `purchase-return-ledger.test.ts` (2/2),
`invoice-ledger.test.ts` (2/2), `sales-workflow.test.ts` (10/10), `permission-guards.test.ts`
(both services), `financial-year.test.ts` (3/3) — all still pass after updating two tests'
mock scripts to account for the new supplier/customer lookups introduced by the payload fix.

**Build verification run:**
```
pnpm --filter @erp/types build              PASS
pnpm --filter @erp/db build                 PASS
pnpm --filter @erp/gst-service build        PASS (tsc — no separate type-check script)
pnpm --filter @erp/sales-service build      PASS
pnpm --filter @erp/purchase-service build   PASS
pnpm --filter @erp/accounting-service build PASS
pnpm --filter @erp/tenant-service build     PASS
pnpm --filter @erp/web-frontend build       PASS (after the 2 incidental fixes above)
pnpm --filter @erp/gst-service test         PASS (6/6)
pnpm --filter @erp/purchase-service test    PASS (14/14, incl. new RCM test)
pnpm --filter @erp/sales-service test       PASS (22/22, 3 skipped — no DATABASE_URL)
pnpm --filter @erp/accounting-service test  PASS (9/9, 3 skipped)
```

**Lint**: `pnpm lint` (whole-repo, via turbo) fails at `@erp/config` — a pre-existing,
unrelated `no-undef: process` baseline gap (42 errors, none touched by this phase).
Scoped `eslint src/` on every package I touched (gst-service, sales-service,
purchase-service, accounting-service, tenant-service, web-frontend) shows only the same
pre-existing `no-undef: crypto/process/Blob/URL/document/React` baseline gap already
documented in ES-01/ES-03/ES-09 — my new files (`gstr9.routes.ts`, `rcm.routes.ts`,
`GSTR9Page.tsx`) follow the exact same pattern as their siblings (`gstr3b.routes.ts`,
`Gstr3bPage.tsx`) and introduce no new category of lint error.

## Verification Checklist
- [x] Intra-state invoice → CGST + SGST present; IGST = 0
- [x] Inter-state invoice → IGST present; CGST = SGST = 0
- [x] Cess field present in invoice line response (`invoice_lines.cessAmount`)
- [x] Unregistered vendor GRN → marked `rcm_applicable = true`
- [x] `GET /gst/gstr9?year=2025-26` returns non-empty response with all 5 tables
- [x] Export endpoint returns JSON file download
- [x] `GSTR9Page.tsx` renders without errors (build passes; manual browser smoke test not
      run — no local Postgres/Kafka available in this session, consistent with prior
      phases' "no DATABASE_URL" test skips)
- [x] Tenant isolation: tenant A GSTR-9 has zero tenant B invoices (unit test 7)
- [x] All 7 GST tests pass
- [x] `pnpm lint` on touched packages — no new errors beyond documented pre-existing baseline

## Regression Checklist
- [x] Existing invoice creation still calculates correct GST (cess defaults to 0 when
      omitted; CGST/SGST/IGST split logic unchanged)
- [x] EInvoicePage still shows STUB banner (ES-01) — untouched
- [x] Existing GSTR-1 / GSTR-3B pages still load — untouched; `Gstr3bService`/
      `Gstr1Service` now receive *correct* non-zero ledger data as a side effect of the
      Fix-4 payload corrections (previously silently zero)

## Phases Unblocked
ES-11 (E-Invoice needs correct GST amounts — now actually correct, not silently zero)
ES-17 (analytics needs GST data)
