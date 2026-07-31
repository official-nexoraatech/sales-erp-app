# PURCHASE MODULE — COMPREHENSIVE AUDIT & VERIFICATION REPORT

## Generated: 2026-07-21 | Status: COMPLETE — verification pass, THEN a gap-closure build-out (§14)

> **Update (same day, follow-up session):** after this report's original verification pass (§1-13
> below, left unedited), the user asked to close the identified gaps rather than defer them. §14
> documents that build-out: Purchase Requisition, RFQ/Supplier Quotation/Comparison, Blanket
> PO/Rate Contracts, a Purchase Invoice variance-check layer (deliberately NOT full 3-way-match —
> see §14.4), Vendor Rating, a Purchase KPI Dashboard, bulk Supplier CSV import + list-page CSV
> export, and branch-level PO scoping enforcement. Production readiness re-scored in §14.9.

> This report covers the Purchase module (Supplier → PO → GRN → Purchase Return/Debit Note →
> Supplier Payment), following the GST/HR/Inventory module passes. The requested comprehensive
> audit, gap-analysis, and fix pass had **already been executed earlier the same day** (session
> timestamp 2026-07-21T09:43:43Z) and was sitting uncommitted in the working tree. This session's
> work was: (1) confirm that prior work against the current codebase, (2) run full
> typecheck+test verification standalone per service (not batched — batched turbo runs have
> previously produced false failures on this repo), (3) spot-check the highest-risk diffs
> (money/GST-posting logic) line-by-line, (4) run an independent fresh gap-analysis against an
> enterprise (SAP/Dynamics/NetSuite/Odoo-class) feature checklist to catch anything the earlier
> pass missed or deliberately deferred, and (5) produce this report. No code was modified this
> session — everything below reflects what already exists in the (uncommitted) working tree.

---

## 1. Current Purchase Architecture

Schema: `packages/db-client/src/schema/purchase.ts` — `purchaseOrders`, `purchaseOrderLines`,
`purchaseOrderHistory`, `purchaseOrderAmendments`, `grns`, `grnLines`, `grnHistory`,
`landedCosts`, `supplierPayments`, `supplierPaymentAllocations`, `purchaseReturns`,
`purchaseReturnLines`, `debitNotes`, `expenses`, `expenseLines`, `projectionSupplierBalance`.
Suppliers themselves (master data, contacts, GSTIN/PAN/bank/credit terms) live in
`sales-service` (`master.ts`), not purchase-service — a deliberate split matching how Customers
are also owned by sales-service.

Domain services (`apps/purchase-service/src/domain/`): `PurchaseOrderService`, `GRNService`,
`PurchaseReturnService`, `DebitNoteService`, `SupplierPaymentService`, `LandedCostService`,
`ExpenseService`, `ValuationService`, `GSTCalculator`.

**Confirmed architectural pattern (same as Inventory/GST modules' root cause):**
purchase-service cannot call inventory-service's domain layer directly (a cross-service HTTP
call can't share the caller's DB transaction), so `GRNService`/`PurchaseReturnService` maintain
their own copy of stock-mutation and WACC/FIFO valuation logic
(`purchase-service/src/domain/ValuationService.ts`, a sibling of inventory-service's and
sales-service's own copies). This is the same "no cross-service transactional logic" pattern
flagged in prior audits — fixes must be applied to each copy individually, and drift between
copies is the single most recurring bug class found across all module audits to date.

GRN approval is the point where stock, AP liability, and GST-input-credit all get created in
one transaction — this system uses **2-way matching (PO ↔ GRN)**, not 3-way (PO → GRN →
Invoice); there is no separate "Purchase Invoice" entity (see §4).

---

## 2. Complete Business Workflow — Validated

Supplier (sales-service) → PO (Draft → Submit → Approve, with optional tiered high-value
approval) → GRN (Draft → Approve, partial/multiple GRNs per PO supported, batch/serial/expiry/
QC/accepted-rejected-damaged qty captured at receipt) → Landed Cost allocation (freight/customs/
insurance/handling, by value/qty/weight) → Inventory + GL + GST ledger updated atomically on GRN
approval → Purchase Return (against GRN, partial/full) → Debit Note (auto-created, has a real
settlement/apply path) → Supplier Payment (advance/partial/full, multi-invoice allocation, TDS
deduction, cheque-bounce reversal) → Purchase/Supplier Reports (Purchase Register, Supplier
Ledger/Statement, Analytics, Vendor Performance).

Every stage was traced through actual code (`PurchaseOrderService`, `GRNService`,
`PurchaseReturnService`, `DebitNoteService`, `SupplierPaymentService`, plus the downstream
`accounting-service`/`gst-service` consumers), not assumed from documentation.

---

## 3. Modules Reviewed

Supplier Management (sales-service), PO lifecycle + amendments, GRN (incl. partial/multi/batch/
QC), Landed Cost allocation, Purchase Returns + Debit Notes, Supplier Payments (incl. TDS,
cheque-bounce reversal), Expenses, GST posting (incl. RCM), Accounting posting (AP/GL/journals),
RBAC across all 8 tenant roles, PDF generation (PO/voucher), Reports (Purchase Analytics,
Supplier Performance, Purchase Register, AP Aging), and API/route-level auth on every purchase
endpoint. Not independently re-verified this session (already covered by their own dedicated
audits, cross-referenced instead of re-run): Item/Stock valuation math itself
([[qa_inventory_module_comprehensive_2026_07_21]]), GST return filing/e-Invoice/e-Way Bill
([[qa_gst_comprehensive_2026_07_20]]).

---

## 4. Missing Enterprise Features (confirmed via fresh code search this session)

These are genuinely absent from the codebase — not bugs, but real functional gaps relative to
SAP B1 / Dynamics BC / NetSuite / Odoo Enterprise-class procurement suites:

| Feature                                                                                   | Status                                           | Evidence                                                                                                                                                                                                                                                                                                                                                                                            |
| ----------------------------------------------------------------------------------------- | ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Purchase Requisition** (department request → budget check → approval, pre-RFQ)          | **Missing**                                      | No `requisition` table/service/route/page anywhere in schema, purchase-service, or web-frontend.                                                                                                                                                                                                                                                                                                    |
| **RFQ / Supplier Quotations / Quotation Comparison**                                      | **Missing**                                      | No `rfq`/`quotation` concept in purchase's schema or service layer (the only `quotation` hit in the repo is sales-service's unrelated customer-quotation feature).                                                                                                                                                                                                                                  |
| **Blanket PO / Rate Contracts**                                                           | **Missing**                                      | `purchaseOrders` has no `contractId`/`validTill`/`callOffQty` — every PO is a discrete one-off order.                                                                                                                                                                                                                                                                                               |
| **Three-Way Matching / distinct Purchase Invoice entity**                                 | **Missing (2-way match only)**                   | GRN approval itself posts AP + GL + GST — there is no separate invoice-capture-and-match step. This is a deliberate architectural choice (matches how Sales Invoice ≈ Delivery in this system's sibling module), not an oversight, but it means invoice-vs-GRN quantity/amount discrepancies (over-billing, price changes between PO and supplier invoice) have no dedicated reconciliation screen. |
| **Vendor/Supplier Rating**                                                                | **Missing**                                      | No rating/score column on the supplier table (the CRM `healthScore` fields on the same table are for customers, unrelated). Today's new `supplier-performance` report computes metrics on the fly but doesn't persist a rating.                                                                                                                                                                     |
| **Purchase KPI Dashboard** (pending POs/GRNs/payments, supplier outstanding, at a glance) | **Missing**                                      | Only a generic cross-module `DashboardPage` and the pull/report-style `PurchaseAnalyticsPage` exist; no purpose-built live-KPI purchase dashboard.                                                                                                                                                                                                                                                  |
| **Bulk Import/Export (CSV/Excel) on PO/Supplier/GRN**                                     | **Missing**                                      | No CSV/XLSX parsing or bulk-export component on any purchase list page.                                                                                                                                                                                                                                                                                                                             |
| **Branch-level PO access control**                                                        | **Partial**                                      | `purchaseOrders.branchId` is stored, but no purchase-service route calls the platform's `getBranchScope()` helper (used by inventory/sales/search-service) — branch is a denormalized/reporting field only; RBAC is purely permission-based, not branch-scoped.                                                                                                                                     |
| **PO Amendment / Revision History**                                                       | **Exists**                                       | `purchaseOrderAmendments` table + `PurchaseOrderService.amend()` (only from `APPROVED` status) + `purchaseOrderHistory` audit trail. Not a gap.                                                                                                                                                                                                                                                     |
| **Reverse Charge (RCM) GST**                                                              | **Exists**, more complete than initially assumed | Auto-detected from unregistered-supplier status, zeroes CGST/SGST/IGST on the GRN and posts self-assessed liability via a dedicated `RCM_LIABILITY_POSTED` event to gst-service (`GstLedgerService.applyRcmLiability`), plus GSTR-3B RCM bucket wiring. Not a gap.                                                                                                                                  |

**Deliberately deferred (per this morning's session, re-confirmed still correct to defer):**
multi-currency supplier support (no FX schema anywhere), full FEFO batch-wise stock
_consumption_ (only GRN-time capture exists), and consolidating purchase-service's
`GSTCalculator` with gst-service's separate implementation (different interfaces, no active bug
from the duplication — see [[qa_purchase_module_comprehensive_2026_07_21]] for the full
reasoning).

None of the 8 missing items above were in this morning's "Critical + High-value" scope — they
are larger net-new epics (Requisition→RFQ→Quotation is effectively a whole new pre-PO workflow)
appropriate for a separate planning/scoping pass, not a bundled continuation.

---

## 5. Bugs Found & Fixed (this morning's session — verified correct this session)

7 critical, money/compliance-corrupting bugs and 8 high-value gaps — full list with root
cause/impact in [[qa_purchase_module_comprehensive_2026_07_21]] (not duplicated here to avoid
drift between the two documents). Headline items: purchase-return GST ledger entries were
posting ₹0 (payload field mismatch), purchase returns never hit the general ledger at all
(missing consumer), interstate purchase returns were taxed as intrastate (hardcoded flag),
bounced supplier cheques never reversed in the GL (wrong reference-type lookup), landed costs
double-counted on a second freight/insurance charge, supplier credit limits couldn't be set from
the UI/API despite being enforced, and 4 RBAC dead-permission-constant gaps (`EXPENSE_APPROVE`,
`SUPPLIER_STATEMENT_VIEW`, `PURCHASE_MANAGER` missing several purchase-adjacent grants,
`AUDITOR` had zero purchase-side visibility).

**Spot-checked this session** (full diff read, not just described): `PaymentAccountingConsumer`'s
`CHEQUE_BOUNCED` fix correctly branches on `supplierId` presence and uses a parameterized
`sql` tag (no injection risk); `LandedCostService.allocate()`'s `isAllocated=false` filter plus
additive `effectiveCostTotal` SQL update is mathematically correct for repeat calls; the
`role-defaults.ts` RBAC additions are narrowly scoped and each carries an inline justification
comment citing the specific route that gates on the constant. No issues found in any spot-check.

---

## 6. Remaining Risks

- **2-way match only** (§4) — a supplier invoice that disagrees with the GRN (price change,
  extra charges billed) has no dedicated capture/match/variance workflow; it would have to be
  handled as a manual journal adjustment or a Purchase Return + re-GRN, neither of which is a
  natural fit. Worth a dedicated scoping conversation if 3-way matching is a real compliance
  requirement for this business.
- **Branch-level PO access is reporting-only, not enforced** (§4) — any user with `PO_VIEW`/
  `PO_CREATE` can see/act on POs across all branches regardless of their assigned branch. Low
  risk in a single-location tenant, real gap in a multi-branch one.
- **No supplier rating/scoring persisted** — vendor selection during PO creation has no
  data-driven signal beyond the on-demand analytics report.
- Architectural drift risk remains for `ValuationService`/`GSTCalculator` duplication across
  purchase-service/inventory-service/sales-service/gst-service (documented, monitored, not
  fixed this session — see [[architecture_no_cross_service_valuation]]).

---

## 7. Test Coverage (verified this session, standalone per service)

| Service            | Type-check | Tests                                                                                                                                                                             |
| ------------------ | ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| purchase-service   | ✅ clean   | ✅ 40/40 passed (6 files, incl. new `debit-note-service.test.ts`, `rcm.test.ts`)                                                                                                  |
| accounting-service | ✅ clean   | ✅ 50 passed / 7 skipped (13 files)                                                                                                                                               |
| gst-service        | ✅ clean   | ✅ 46 passed / 2 skipped (10 files)                                                                                                                                               |
| sales-service      | ✅ clean   | ✅ 145 passed / 103 skipped (26 files)                                                                                                                                            |
| tenant-service     | ✅ clean   | ✅ 43 passed / 8 skipped (11 files)                                                                                                                                               |
| report-service     | ✅ clean   | ✅ 122/122 passed (7 files)                                                                                                                                                       |
| web-frontend       | ✅ clean   | ✅ 411/411 passed (37 files — scoped to purchase/suppliers/reports/navigation regression suites, incl. the `no-dark-variant-regression` and 92-route `navigation.test.ts` checks) |

`@erp/db` and `@erp/types` were rebuilt first (per [[shared_package_rebuild_needed_for_typecheck]])
so the type-checks above reflect the current schema, not a stale build.

---

## 8. Performance Summary

Not independently load-tested this session (no code changed). No new N+1 or missing-index
patterns observed while spot-checking the diffs; `LandedCostService`/`ValuationService` changes
operate within the existing single-GRN transaction scope, not a new bulk/loop pattern.

## 9. Security Assessment

RBAC gaps from §5 closed. `CHEQUE_BOUNCED` fix uses parameterized SQL (verified, no injection
risk introduced). No new attachment/route/permission gaps found in this session's spot-checks.
Branch-level PO scoping gap noted in §6 is the one open item.

## 10. GST Compliance Status

RCM auto-detection + self-assessed liability posting, purchase-return GST reversal (now correct
interstate/intrastate + non-zero amounts), GSTR-3B RCM bucket — all confirmed present and
covered by passing tests (`rcm.test.ts`, `gstr3b-rcm-reversal.test.ts`,
`purchase-return-ledger.test.ts`). No new GST gaps found this session beyond what's already
tracked in [[qa_gst_comprehensive_2026_07_20]].

## 11. Inventory Integration Status

GRN approval → stock + WACC/FIFO update, now including landed-cost adjustment flowing into
`items.waccCost`/FIFO layers (previously stopped at the display-only `grnLines.effectiveUnitCost`).
GRN batch/serial/expiry/QC capture shipped (receipt-time only, per documented scope). Purchase
Return correctly deducts stock. Not re-verified this session:
`projection_stock_level` per-warehouse projection accuracy on GRN receipt (a 2026-07-17 finding,
`ERP-PLANNING/regression-2026-07-17/inventory-purchase.md` finding #7) — cross-reference
[[qa_inventory_module_comprehensive_2026_07_21]] for whether that was addressed in the Inventory
module's own audit pass.

## 12. Accounting Integration Status

AP posting on GRN approval, full reversal posting rule for Purchase Returns (previously
completely missing), TDS deduction wired end-to-end from Supplier Payment UI through to the
existing (previously unreachable) `accounting-service` TDS endpoint, cheque-bounce reversal now
correct for both customer and supplier payments. All confirmed via passing
`purchase-return-ledger.test.ts`, `PaymentAccountingConsumer` tests, and `opening-balances-lock`/
`journal-cost-center` accounting-service suites (unaffected, still green).

## 13. Production Readiness Score

**82/100** for the Purchase module as implemented. Deductions: -8 for 2-way-match-only (no
Purchase Invoice/3-way-match entity — a real gap for businesses that need supplier-invoice
variance control), -6 for the 7 missing pre-PO/enterprise-workflow features in §4 (Requisition,
RFQ, Blanket PO/Rate Contracts, Import/Export, Purchase Dashboard, Supplier Rating — none of
these block the core Order-to-Pay flow, all are additive), -4 for branch-level PO scoping being
reporting-only rather than enforced. The core procurement lifecycle (Supplier → PO → GRN →
Return/Debit Note → Payment, with correct GST/GL posting throughout) is solid, tested, and
matches the readiness bar set by the Inventory (80/100) and prior GST/HR module passes.

---

## Recommendation (superseded for scope — see §14)

The morning session's scope decision — "Critical + High-value gaps" rather than the full
SAP/Dynamics-class feature set — was correct and remains correct after this independent
re-verification. The 7 items in §4 are real gaps but are each substantial net-new features
(Requisition→RFQ→Quotation alone is a full pre-PO workflow), not bug fixes, and deserve their
own dedicated scoping/planning conversation rather than being bundled into a "continue the audit"
pass. Nothing found this session changes that recommendation or reveals a correctness regression
in what already shipped. _(The user subsequently asked to close these gaps anyway — see §14.)_

---

## 14. Gap-Closure Build-Out (same-day follow-up session)

User instruction: "if there is any finding and missing gap then please continue to fix it."
Scoped via two decisions confirmed with the user first: (1) the Purchase Invoice / 3-way-match
gap would be built as a **lighter variance-check layer**, not a rework of the AP-posting trigger
(GRN approval keeps posting AP/GST exactly as before — see §14.4); (2) build order would follow
the real procurement lifecycle: Requisition → RFQ/Quotation → Blanket PO → Invoice-match →
Vendor Rating → Dashboard → Import/Export → branch enforcement.

### 14.1 Purchase Requisition

- **Root cause of gap:** no requisition concept existed anywhere — POs were the earliest
  procurement artifact, with no department-request/approval step upstream of them.
- **Business justification:** lets a non-purchasing department (e.g. Production, Retail) formally
  request goods with a priority/required-by-date, without needing PO-creation permissions
  themselves; a Purchase Manager approves and converts to a priced PO.
- **Technical justification:** new table pair (`purchase_requisitions`/`purchase_requisition_lines`)
  and `RequisitionService` mirror the existing `PurchaseOrderService` state-machine shape
  (Draft→Submit→Approve/Reject→Convert) for consistency; `convertToPO()` calls the _existing_
  `PurchaseOrderService.create()` rather than duplicating PO-creation logic.
- **DB changes:** migration `0091_purchase_requisitions.sql` (2 new tables).
- **API changes:** `apps/purchase-service/src/api/requisition.routes.ts` (`/requisitions*`, new
  permissions `REQUISITION_VIEW/CREATE/APPROVE/CONVERT`).
- **Files:** `RequisitionService.ts`, `requisition.routes.ts`, `RequisitionsPage.tsx`,
  `RequisitionFormPage.tsx`, `RequisitionDetailPage.tsx` (convert-to-PO UI inline on approval).
- **No budget-validation enforcement** — no budget/cost-center-budget subsystem exists anywhere in
  this codebase; `estimatedTotal` is informational for the approver only. Documented gap, not
  silently dropped.

### 14.2 RFQ / Supplier Quotations / Quotation Comparison

- **Root cause of gap:** no vendor-comparison workflow existed — a PO always named one supplier
  up front, with no structured way to solicit and compare competing prices first.
- **Business justification:** lets a buyer invite multiple suppliers, record what each one quoted
  (suppliers have no login/portal in this system, so quotation capture is manual data entry by
  the buyer — same trust model as the rest of Purchase), and select a winner, which auto-creates
  the resulting draft PO from the winning quotation's lines.
- **Technical justification:** 5 new tables (`rfqs`, `rfq_lines`, `rfq_suppliers`,
  `supplier_quotations`, `supplier_quotation_lines`); `RfqService.selectQuotation()` reuses
  `PurchaseOrderService.create()` (same reuse pattern as Requisition conversion) and marks
  losing quotations `REJECTED` + closes the RFQ, so the comparison view never shows stale
  `SUBMITTED` rows next to a decided winner.
- **DB changes:** migration `0092_rfq_supplier_quotations.sql`.
- **API changes:** `rfq.routes.ts` (`/rfqs*`, `/quotations/:id/select`); new permissions
  `RFQ_VIEW/CREATE`, `SUPPLIER_QUOTATION_CREATE/COMPARE` — named distinctly from sales-service's
  pre-existing customer-facing `QUOTATION_VIEW/CREATE` to avoid a permission-name collision
  (caught by a `tsc` duplicate-key build error, fixed before it ever reached RBAC).
- **Files:** `RfqService.ts`, `rfq.routes.ts`, `RfqsPage.tsx`, `RfqFormPage.tsx`,
  `RfqComparePage.tsx` (record-quotation modal + side-by-side comparison + select-winner modal).

### 14.3 Blanket PO / Rate Contracts

- **Root cause of gap:** every PO was a discrete, one-off order; no way to set up a standing
  agreement with a validity window that gets drawn against repeatedly.
- **Business justification:** businesses with recurring suppliers (e.g. a monthly fabric-roll
  contract) shouldn't need a brand-new PO negotiated every time.
- **Technical justification:** reused the **existing** multi-GRN-per-PO mechanism entirely — a
  Blanket/Rate-Contract PO is just a `STANDARD` PO with a `poType` tag and a `contractValidTill`
  gate. `GRNService.create()` now rejects new GRNs against an expired contract PO
  (`CONTRACT_EXPIRED`), checked right after the existing `INVALID_PO_STATUS` check. No new table,
  no change to GRN/valuation/GST posting logic at all — the smallest-footprint way to close this
  gap given the existing architecture already supported the hard part (partial/repeat receipts).
- **DB changes:** migration `0093_po_blanket_contract_and_requisition_link.sql` (4 new columns on
  `purchase_orders`: `po_type`, `contract_valid_from`, `contract_valid_till`, `requisition_id`).
- **API changes:** `POST /purchase-orders` accepts optional `poType`/`contractValidFrom`/
  `contractValidTill`.
- **Files:** `PurchaseOrderService.ts`, `purchase-order.routes.ts`, `GRNService.ts` (expiry
  check), `PurchaseOrderFormPage.tsx` (PO Type select + conditional date fields).

### 14.4 Purchase Invoice — variance-check layer (NOT full 3-way-match)

- **Root cause of gap:** the system posts AP/GST at GRN approval (2-way PO↔GRN match) — there was
  no record of what a supplier's actual invoice said versus what was received, so a supplier
  over-billing (wrong qty or a price that drifted from the PO/GRN rate) had no dedicated flag.
- **Business justification, and why NOT full 3-way-match:** the user explicitly chose the lighter
  option after being shown the tradeoff — full 3-way-match would move the AP/GST posting trigger
  from GRN-approval to invoice-approval, touching financial-critical code that has been
  bug-fixed multiple times this week (§5). A pure reconciliation record gets the auditing value
  (flag variance for a human to review before payment) without that risk.
- **Technical justification:** `PurchaseInvoiceService.create()` pulls the referenced GRN's lines,
  computes `qtyVariance`/`rateVariance` per line and a total `varianceAmount`, and sets
  status `MATCHED` or `VARIANCE` — it never touches `journals`, `gstLedger`, or
  `SupplierPaymentService`, which is stated explicitly as a code comment on the new
  `purchase_invoices` table definition so a future reader doesn't assume it re-posts anything.
- **DB changes:** migration `0094_purchase_invoices.sql` (2 new tables).
- **API changes:** `purchase-invoice.routes.ts` (`/purchase-invoices*`); new permissions
  `PURCHASE_INVOICE_VIEW/CREATE/APPROVE`.
- **Files:** `PurchaseInvoiceService.ts`, `purchase-invoice.routes.ts`, `PurchaseInvoicesPage.tsx`,
  `PurchaseInvoiceFormPage.tsx` (GRN picker pre-fills invoiced qty/rate from the GRN for editing).

### 14.5 Vendor/Supplier Rating

- **Root cause of gap:** no rating/score column existed on the supplier table (the CRM
  `healthScore` fields on the same physical table are for _customers_, unrelated).
- **Business justification:** gives buyers a persisted, at-a-glance signal for vendor selection
  during PO/RFQ creation, independent of the on-demand analytics report.
- **Technical justification:** simple `rating` (decimal 1.0-5.0) + `ratingNotes` columns on
  `suppliers`; added to the Zod create/update schema (sales-service owns suppliers) and to the
  frontend `supplierFormSchema` — the latter matters because `zodResolver` silently strips any
  field not declared in the schema, the exact bug class that broke supplier-edit's `version`
  field earlier this week (§5), so it was added to _both_ schemas deliberately, not just the form.
- **DB changes:** migration `0095_supplier_rating.sql` (`suppliers.rating`, `suppliers.rating_notes`).
- **Files:** `master.ts` (schema), `supplier.routes.ts` (sales-service), `supplier.schema.ts`
  (frontend), `SupplierFormPage.tsx` (rating select + notes), `SuppliersPage.tsx` (rating column).

### 14.6 Purchase KPI Dashboard

- **Root cause of gap:** only a generic cross-module `DashboardPage` and the pull-style
  `PurchaseAnalyticsPage` report existed — no purpose-built live-KPI view for Purchase.
- **Business justification:** pending POs/GRNs, supplier outstanding, and this-month spend
  answer the "what needs my attention right now" question a report doesn't.
- **Technical justification:** a single new aggregation endpoint
  (`GET /purchase-orders-dashboard-summary`) rather than a new reporting subsystem — reuses
  existing tables (`purchaseOrders`, `grns`, `projectionSupplierBalance`) with plain `count`/`sum`
  aggregates, respects the same `getBranchScope()` enforcement added in §14.8.
- **Files:** `dashboard.routes.ts`, `PurchaseDashboardPage.tsx`.

### 14.7 Bulk Import/Export

- **Root cause of gap — corrected mid-build:** the original §4 gap-analysis said Import/Export was
  entirely missing. Building it surfaced that this was wrong: `scheduler-service` already has a
  **complete, tested** `ImportEngine` (upload → map columns → validate → execute → rollback, with
  SSE progress and per-entity CSV templates) that has fully supported `supplier` (among other
  entities) the whole time — it just had **zero frontend UI anywhere in the app** (confirmed via
  `POST /suppliers/import` in sales-service, which was itself a stub pointing at this exact
  engine and never wired up). Same "backend built, no UI" pattern as prior findings (TDS, Event
  Store). Building a bespoke importer from scratch would have duplicated this, so the fix was a
  frontend wizard that drives the existing engine instead.
- **Business/technical justification:** bulk-onboarding a supplier list is a real first-time-setup
  need; reusing the existing engine means validation/rollback semantics are already correct and
  tested — only the missing UI layer was added.
- **API changes:** none on the backend; added `scheduler` to the frontend's gateway service map
  (`client.ts`) since nothing had ever called it, and an `importApi` client wrapper.
- **Export:** `ERPDataGrid` already had a working `enableExport`/`exportFilename` CSV-export
  toggle (used by `CustomersPage`) — simply not turned on for Purchase pages. Enabled on
  Suppliers, Purchase Orders, GRNs, Purchase Returns, Supplier Payments, and Expenses.
- **Files:** `SupplierImportPage.tsx` (upload → auto-map → validate → execute), `endpoints.ts`,
  `client.ts`, `enableExport` added to 6 list pages.

### 14.8 Branch-level PO access control

- **Root cause of gap:** `purchaseOrders.branchId` was stored but no purchase-service route ever
  called the platform's `getBranchScope()` helper (already used by inventory/sales/search-service,
  including in the Inventory module's own audit fix earlier the same day) — any caller with
  `PO_VIEW` saw every branch's POs, not just their own.
- **Business justification:** a real gap for any multi-branch tenant; branch-scoped staff
  shouldn't see or act on another branch's purchasing.
- **Technical justification:** applied the identical pattern already validated in the Inventory
  module's warehouse-scoping fix — `getBranchScope(req.auth)` filters the PO list query via
  `inArray(purchaseOrders.branchId, branchScope)`, and the single-PO `GET` throws a 403
  (`PO_OUT_OF_SCOPE`) if the fetched PO's branch isn't in scope. **Scoped to list + detail only**
  this session (the two routes covering the actual reported leak — "can see POs across branches")
  — mutating actions (submit/approve/cancel/amend) were not individually re-audited for branch
  scope; flagged as a fast-follow if a stricter enforcement posture is wanted.
- **Files:** `purchase-order.routes.ts`.

### 14.9 Verification (all standalone, not batched)

| Service          | Type-check | Tests                                                                                                                                                                                                                                           |
| ---------------- | ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| purchase-service | ✅ clean   | ✅ 40/40 (unchanged pass count — new features have no dedicated unit tests yet, see below)                                                                                                                                                      |
| sales-service    | ✅ clean   | ✅ 145/145 (5 skipped unrelated)                                                                                                                                                                                                                |
| tenant-service   | ✅ clean   | ✅ 43/43 (8 skipped unrelated)                                                                                                                                                                                                                  |
| web-frontend     | ✅ clean   | ✅ 415/415, incl. `navigation.test.ts`'s route-reachability guard (one new allowlist entry added for `/suppliers/import`, reachable via a button not the sidebar — same pattern as the pre-existing analytics-dashboard-card allowlist entries) |

`@erp/db`/`@erp/types` rebuilt before each type-check per the established gotcha. A permission
name collision (`QUOTATION_CREATE` already used by sales-service's customer-quotation feature)
was caught by a `tsc` duplicate-object-key build error and renamed to `SUPPLIER_QUOTATION_CREATE`
before it ever reached RBAC or routes.

**Known gap in this build-out itself:** the 8 new features above do not yet have their own
`__tests__` unit-test files (unlike the morning session's fixes, which each got dedicated
regression tests) — verification for this pass relied on full-suite green + manual code review
of each service/route file, not new automated coverage. Recommended as the next step if this
module continues to be iterated on.

### 14.10 Updated Production Readiness Score (superseded — see §15 for the current score)

**88/100** (up from 82/100 in §13). Remaining deductions: -6 for the Purchase Invoice layer being
a variance-check rather than a full AP-posting-trigger 3-way-match (a deliberate, user-confirmed
scope choice, not an oversight); -4 for branch-scope enforcement covering only list/detail, not
every mutating PO action; -2 for the new features lacking dedicated unit tests (§14.9). Multi-
currency and full FEFO stock consumption remain out of scope, as before.

---

## 15. Second gap-closure pass (same-day, user asked "if there is any gap still, please continue")

Two of §14's own self-reported gaps were closed, plus a **newly-discovered systemic gap** the
first pass under-scoped.

### 15.1 Branch-scope enforcement was systemic, not PO-only (real finding, not assumed)

§14.8 fixed branch-scoping for `purchase_orders` only. Checking which other purchase-service
tables carry a `branchId` column (`grns`, `supplier_payments`, `purchase_returns`, `expenses`,
plus the three new `purchase_requisitions`/`rfqs`/`purchase_invoices` tables from §14.1-14.4)
confirmed the same unenforced-`branchId` gap existed identically on **every one of them** — the
list route never filtered by branch, the detail route never checked it. Applied the exact same
`getBranchScope()` pattern from §14.8 (and the Inventory module's original fix) to all 7:
list-route filtering (`inArray(table.branchId, branchScope)`) plus a detail-route scope check
(`ERPError(..., 403)` if the fetched row's branch isn't in scope). Files touched: `grn.routes.ts`,
`supplier-payment.routes.ts`, `purchase-return.routes.ts`, `expense.routes.ts`,
`requisition.routes.ts`, `rfq.routes.ts` (+`RfqService.list()`), `purchase-invoice.routes.ts`
(+`PurchaseInvoiceService.list()`), `RequisitionService.list()` — each service's `list()` gained
an optional `branchIds?: number[]` parameter rather than duplicating the filter at the route
layer redundantly.

### 15.2 PO branch-scope extended from list/detail to every mutating action

§14.9's own noted gap. Added a small `assertPoBranchInScope()` helper in
`purchase-order.routes.ts` (a lightweight `{branchId}`-only lookup, not a full PO fetch) and
called it first thing in `update`, `submit`, `approve`, `amend`, `cancel`, `duplicate`, `pdf`,
and `activity` — every route that acts on a specific PO by id, not just the two GET routes.
Also extended to GRN's `approve` (reused the branchId already returned by `getWithLines()`,
no extra query) and `reject` (added the same lightweight lookup) — GRN approval is where
stock/AP/GST actually post, the single highest-value mutating action to close this on. **Not**
extended to every other entity's mutating actions this pass (Purchase Return approve, Supplier
Payment create/allocate/bounce, Expense approve/pay) — flagged as the one remaining honest gap
below rather than silently left uncovered.

### 15.3 Dedicated unit tests added for the 8 new features (§14.9's other noted gap)

4 new test files, `apps/purchase-service/src/__tests__/`:

- `requisition-service.test.ts` (8 tests) — `estimatedTotal` computation, all 4 status-transition
  guards (submit/approve/reject/convert), missing-line-override rejection, empty-requisition
  rejection.
- `rfq-service.test.ts` (6 tests) — `grandTotal` computation, CLOSED/CANCELLED-RFQ quotation
  rejection, already-SELECTED re-selection rejection, empty-quotation rejection.
- `purchase-invoice-service.test.ts` (8 tests) — **this one caught nothing wrong but is the most
  load-bearing**: directly verifies the variance arithmetic (qty variance, rate variance, and the
  combined monetary `varianceAmount`) against hand-computed expected values, plus the
  non-APPROVED-GRN and unknown-`grnLineId` rejections.
- `po-branch-scope.test.ts` (6 tests) — a real `Fastify` app + `app.inject()` (not a mocked HTTP
  layer) proving the branch-scope fix end-to-end through the actual route/permission-middleware
  stack: 403 for an out-of-scope caller on both GET and POST /submit, 200 for in-scope, and the
  two escape hatches (`BRANCH_SCOPE_BYPASS`, no branch assignments) still work.

purchase-service test count: **40 → 68**, all passing standalone (one 5s timeout was observed in
a single full-suite run under background-process contention — reproduced clean on 2 immediate
re-runs, consistent with the known "batched runs can false-fail, always re-verify standalone"
pattern, not a real regression).

### 15.4 Remaining honest gap (not fixed this pass)

Branch-scope enforcement's mutating-action coverage is now PO (full) and GRN (approve/reject)
only — Purchase Return's `approve`, Supplier Payment's `create`/`allocate`/`bounce`, and
Expense's `approve`/`pay` still only enforce scope on their list/detail GET routes, not on the
mutating actions themselves. Given the pattern is now proven, small, and mechanical
(`assertXBranchInScope` + one `getBranchScope()` call per handler), this is a fast, low-risk
follow-up if a stricter posture is wanted — deliberately not done this pass to avoid unbounded
scope creep across 3 more files for diminishing marginal risk (an attacker would need to already
know a specific out-of-branch record's id, since discovery via the list is now blocked
everywhere).

### 15.5 Verification

| Service          | Type-check | Tests                                             |
| ---------------- | ---------- | ------------------------------------------------- |
| purchase-service | ✅ clean   | ✅ 68/68 (was 40/40)                              |
| web-frontend     | ✅ clean   | (untouched this pass — no frontend files changed) |

### 15.6 Updated Production Readiness Score (superseded — see §16)

**91/100** (up from 88/100 in §14.10). Remaining deductions: -6 for the Purchase Invoice
variance-check-not-full-3-way-match design (unchanged, deliberate); -3 for branch-scope
mutating-action coverage stopping at PO+GRN rather than all 5 remaining entities (§15.4, down
from -4 now that the systemic list/detail gap and PO's own full mutating-action coverage are
both closed).

---

## 16. Third gap-closure pass (same-day, user asked "continue to fix all gaps")

§15.4's own explicitly-flagged residual gap — Purchase Return/Supplier Payment/Expense mutating
actions still unscoped — was closed, and closed _further_ than originally scoped: every
create-time entry point (a branch-restricted caller could previously POST any of these entities
naming a `branchId` outside their own scope, even though they couldn't see it afterward) and the
one polymorphic case (attachments) also got the same fix.

### 16.1 Full inventory of what got closed this pass

- **Create-time validation** added to `purchase-orders`, `grns`, `supplier-payments`,
  `purchase-returns`, `expenses`, `requisitions`, `rfqs`, `purchase-invoices` — every POST that
  accepts a `branchId` in its body now 403s if that branch isn't in the caller's scope, closing
  the gap where list/detail scoping blocked _seeing_ an out-of-branch record but not _creating_
  one there in the first place.
- **Remaining mutating actions**: Supplier Payment `allocate`/`bounce`/`voucher`; Purchase Return
  `approve`; Expense `update`/`submit`/`approve`/`pay`; Requisition `submit`/`approve`/`reject`/
  `convert-to-po` (the latter also checks the _new_ PO's target branch, not just the source
  requisition's); RFQ `quotations` (record) and `quotations/:id/select` (also checks the
  resulting PO's target branch); Purchase Invoice `approve`.
- **Debit notes** (`purchase-return.routes.ts`'s `/debit-notes*`) have no `branchId` column of
  their own — resolved through a `leftJoin` to their parent `purchaseReturns` row for list
  filtering, detail checking, and the `/apply` action.
- **Landed costs** (`landed-cost.routes.ts`) similarly have no `branchId` — resolved through
  `grns.branch_id` for all 3 routes (add cost, allocate, list).
- **Attachments** (`attachment.routes.ts`) are polymorphic (`entityType` + `entityId` across
  PURCHASE_ORDER/GRN/SUPPLIER) — added a small `resolveEntityBranchId()` dispatcher and applied
  it to all 4 routes (upload, list, download, delete), the one case in this pass that needed
  genuinely new dispatch logic rather than reusing the by-now-established single-table pattern.

### 16.2 What's still out of scope (by design, not oversight)

Nothing further within purchase-service itself was identified as an open branch-scope gap after
this pass — every route that accepts, lists, displays, or mutates a branch-carrying (directly or
by join) record now enforces it. Two items remain deliberately untouched, both because they were
explicit, already-confirmed scope decisions rather than incomplete work:

- **Purchase Invoice as a variance-check layer, not full 3-way-match** — the user was shown this
  exact tradeoff via a direct question before any of this work began and chose the lighter
  option; reopening it wasn't requested and would mean reworking the AP/GST posting trigger on
  financial-critical code.
- **Multi-currency, full FEFO stock consumption, GSTCalculator consolidation** — deferred in the
  original morning session (before this conversation) as separate, substantially-sized epics
  outside "the Purchase module gap list," re-confirmed correct to defer at each subsequent
  re-verification pass. Not reopened absent a specific request, since building any one of them is
  itself a project-sized undertaking, not a bounded gap-fix.

### 16.3 Verification

purchase-service: type-check clean, **68/68 tests still passing** (no new tests added this pass —
the existing `po-branch-scope.test.ts` + service unit tests already exercise the exact
`getBranchScope()`/`ERPError(..., 403)` pattern reused verbatim across every file touched here;
`attachment-rbac.test.ts`'s own existing assertions were re-run and are unaffected, since its
mock auth payload's empty `branchIds` resolves to unrestricted `'all'` scope — confirming the new
checks are backward-compatible with unrestricted callers, not just correct for restricted ones).

### 16.4 Updated Production Readiness Score

**93/100** (up from 91/100 in §15.6). Remaining deductions: -6 for the Purchase Invoice
variance-check-not-full-3-way-match design (unchanged, deliberate, user-confirmed); -1 residual
for the new checks lacking their own dedicated per-entity regression tests (only PO's got one in
§15.3 — the other 7 entities' branch-scope fixes are covered by the full-suite green + manual
code-pattern consistency, not a test asserting each one individually).
