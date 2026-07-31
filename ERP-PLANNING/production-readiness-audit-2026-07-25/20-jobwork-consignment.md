# Job Work & Consignment Modules — Production Readiness Audit

**Date:** 2026-07-25
**Auditor:** Fresh ground-up live audit (no prior claims trusted without re-verification)
**Environment:** Gateway http://localhost:3000, production-service http://localhost:3022 direct, tenant 2 "QA E2E Test Co", owner@qa-e2e.local

---

## Summary

Both features are **real, complete backend + frontend implementations**, not guesses — they live in
`apps/production-service` (routes: `job-work.routes.ts`, `consignment.routes.ts`, `reorder.routes.ts`;
domain: `JobWorkOrderService.ts`, `ConsignmentService.ts`, `ReorderService.ts`) and
`apps/web-frontend/src/pages/production/` (`JobWorkOrdersPage`, `JobWorkOrderCreatePage`,
`JobWorkOrderDetailPage`, `JobWorkQualityCheckPage`, `ConsignmentStockPage`,
`ConsignmentSettlementsPage`, `ReorderReportPage`), wired into nav (`lib/navigation.ts`) and routing
(`App.tsx`) with permission-gated routes.

**Job Work Orders** is functionally complete end-to-end (create → issue materials → quality check →
complete/cancel), correctly adjusts inventory both directions, has clean validation/RBAC/error
handling, and the historically-flagged "no detail page ever existed" bug is confirmed fixed. However
it has **zero accounting integration** (not "wrong GL codes" — no posting pipeline exists at all) and
**zero automated test coverage**.

**Consignment** is only half-real: receiving, returning, and settlement create/settle all work and
correctly keep consigned stock off the owned-inventory books. But the one method that would ever mark
consigned stock as _sold_ — `ConsignmentService.recordSale()` — has **no HTTP route and no caller
anywhere in the codebase**, confirmed both by static search and by live data (all 17 consignment stock
records in tenant 2, going back to 2026-07-13, have `soldQty = 0.000` with no exception). This makes
Settlements structurally unable to ever compute a non-zero amount — live-verified by creating a real
settlement (id 15) against supplier 2's active consignment stock: `totalSoldQty: "0.000"`,
`totalAmount: "0.00"`, `lineItems: []`. This is a pre-existing, self-documented gap (see DAP tour
comments and the integration test's own docstring) still unresolved as of today's live test.

**Reorder Report**: both historically-flagged bugs (Create POs always creating zero POs;
hardcoded `branchId: 1`) are genuinely fixed. A new, previously-unflagged bug was found: the
frontend hardcodes `placeOfSupply: '27'` (Maharashtra) with no UI control, unlike the regular
Purchase Order form which has an editable state picker — the exact bug class the team just fixed
elsewhere (commit `dc9651d`) but missed here.

Job Work and Consignment events (`JOB_WORK_ORDER_CREATED/COMPLETED`, `CONSIGNMENT_RECEIVED/SETTLED`)
are published to the outbox correctly but **accounting-service has no consumer registered for any of
them**, and `PostingMatrixService.ts` has zero entries for either prefix — so today's confirmed
posting-matrix hardcoded-account-code bug is **not applicable here**; the gap is more fundamental
(no posting path exists at all, not a wrong-code path).

---

## What Works (live-verified)

### Job Work Orders — full lifecycle, tenant 2, live data

- Created JWO **id 22** (`JWO-2-1784938800166`): supplier 2 (Global Textiles Supplier), branch 1,
  warehouse 5 (Main Warehouse), output item 43 (AUDIT Test Item WACC), ordered qty 10 @ ₹50/unit job
  work rate, material: 20 units of item 1 (Cotton Saree) @ ₹100/unit.
- **issue-materials**: item 1 `availableQty` dropped 3516.000 → 3496.000 (exactly 20 units deducted);
  `inventoryLedger` STOCK_OUT row written; status DRAFT → MATERIAL_ISSUED; history row logged.
- **start-quality-check** → status MATERIAL_ISSUED → QUALITY_CHECK.
- **quality-checks** submitted: 2 PASS, 1 FAIL with defect notes — stored correctly.
- **complete** with receivedQty=9, rejectedQty=1, scrapQty=0: output item 43 `availableQty` rose
  60.000 → 69.000 (+9, correct); `finishedGoodsCost` auto-computed = (materialsCost 2000 +
  jobWorkCharges 500) / 9 = **277.78** (correct); status → COMPLETED.
- **GET /job-work-orders/22** (detail): returns the full order plus `materials[]`, `qualityChecks[]`,
  `history[]` in one response — confirms the 2026-07-12 finding "no detail page ever existed" is
  fixed; both frontend `JobWorkOrderDetailPage.tsx` and this endpoint are real.
- Auto-numbering (`JWO-{tenantId}-{timestamp}`) works — confirmed by inline code comment this was a
  known prior bug (`orderNumber` never set) and is now fixed.
- Validation: `POST /job-work-orders` with only `{supplierId:2}` → clean `400 VALIDATION_ERROR` with
  a field-by-field message list, not a 500.
- Not-found: `GET /job-work-orders/999999` → clean `404 NOT_FOUND`.
- Invalid transition: `issue-materials` on an already-COMPLETED order → clean
  `400 INVALID_STATUS`, not a 500.
- RBAC: cashier role (no `JOB_WORK_VIEW`) → clean `403 FORBIDDEN` with the specific missing
  permission named.
- Code-level tenant isolation: `getWithDetails`/`list` tenant-scope both sides of the
  supplier/item joins, and `create()` verifies `supplierId`/`outputItemId` belong to the caller's
  tenant before insert (per inline "Security audit" comments — consistent with the same fix pattern
  already verified live elsewhere in this codebase). Not independently re-verified with a second
  tenant in this session due to time.
- **Cancel** path (code-reviewed, not live-exercised this session): restores issued-material stock
  and writes a compensating STOCK_IN ledger row — logic looks correct.

### Consignment — receive/return/settle, tenant 2, live data

- **receive**: created consignment stock **id 18**, 15 units of item 1 @ agreed rate ₹120 from
  supplier 2. Confirmed item 1's `availableQty` was **unchanged** (3496.000 before and after) —
  correctly modeled as off-books stock, not owned inventory, matching the code's own comment
  ("Consignment stock is NOT posted to financial_entries — it's not owned until sold").
- **listStock**: returns joined supplier/item/warehouse names correctly (the historical
  "always shows —" bug is fixed, per inline comment and live response).
- **return**: returned 5 of 15 units from stock id 18 back to the supplier — `availableQty` and
  `returnedQty` updated atomically with a concurrency-safe WHERE-guarded UPDATE.
- **createSettlement**: created settlement **id 15** (`CS-2-1784938974167`) for supplier 2 — auto
  numbering works (same historical fix as job-work orderNumber).
- **settle**: marked settlement 15 SETTLED with a payment reference — status transition works.
- Concurrency: `apps/production-service/src/__tests__/consignment-concurrency.integration.test.ts`
  passes live against the dev DB (2/2 tests, run with `DATABASE_URL` set) — proves the
  atomic-check-and-deduct guard on `recordSale`/`returnToSupplier` genuinely prevents lost updates
  under concurrent access, even though `recordSale` has no caller (see Critical Gaps below).

### Reorder Report — both historical bugs confirmed fixed

- `ReorderService.getReorderRequired()` now infers `defaultSupplierId`/`lastPurchasePrice` from the
  most recent PO line for that item (items have no stored default-supplier FK) — previously always
  `undefined`, which meant "Create POs" filtered every item out and created nothing. Now populated.
- `ReorderReportPage.tsx` no longer hardcodes `branchId: 1` — it resolves the real branch from the
  selected warehouse's own `branchId` and blocks PO creation with a clear toast if it can't be
  resolved or if "All Warehouses" is selected.
- `ReorderService.createPOsFromReorder()` validates itemIds/supplierIds against the caller's tenant
  before use (rejects cross-tenant dangling references), computes real CGST/SGST/IGST split via
  `GSTCalculator` based on the supplier's actual registered state vs. `placeOfSupply`, and creates
  one DRAFT PO per supplier with correct line-level GST.

---

## Bugs / Gaps Found

### CRITICAL — Consignment "sale" flow is dead code; Settlements always compute ₹0

**Evidence:** `ConsignmentService.recordSale()` (apps/production-service/src/domain/ConsignmentService.ts:94)
is the only method that increments a consignment stock row's `soldQty`. Grepped for `recordSale(` across
the entire `apps/` tree — the only call site is the integration test itself
(`consignment-concurrency.integration.test.ts:78`), whose own docstring says
_"recordSale() has no route/caller yet (confirmed dead code)"_. No route file, no sales-service
integration, no event consumer calls it. Live DB check: `SELECT soldQty FROM consignment_stocks WHERE
tenant_id=2` → all 17 historical rows are `0.000`, no exceptions. Live-created settlement id 15 for
supplier 2 (who has multiple ACTIVE/PARTIAL consignment stock rows with real return activity) came
back with `totalSoldQty: "0.000"`, `totalAmount: "0.00"`, `lineItems: []`.
**Impact:** The entire business purpose of a consignment module — track goods sold on behalf of a
supplier and settle what's owed them — cannot happen. Receiving and returning consigned goods works;
selling them (the actual revenue-recognition event) does not exist as a reachable flow anywhere in the
app. Any tenant relying on this module for real consignment sales gets silently wrong (always-zero)
settlements forever.
**Severity:** Critical (core feature non-functional, silent failure — no error, just always ₹0).
**Note:** This is not a new discovery this session — it is already self-documented in the codebase
(3 DAP tour files + the integration test docstring), evidently found and left un-fixed in an earlier
session. Confirmed still true live today.

### CRITICAL — Job Work has zero accounting integration (not a wrong-code bug — no path at all)

**Evidence:** `JOB_WORK_ORDER_CREATED`, `JOB_WORK_MATERIALS_ISSUED`, `JOB_WORK_ORDER_COMPLETED`
events are published to the outbox correctly (confirmed live: `outbox_events` rows for aggregate 22
all have `published = true`). But `apps/accounting-service/src/main.ts` registers consumers for
Invoice, GRN, COGS, Payment, SaleReturn, PurchaseReturn, Expense, Payroll, EmployeeLoan, RCM, and
StockAdjustment events — **there is no `JobWorkAccountingConsumer.ts` and no handler for any
`JOB_WORK_*` event type**. `PostingMatrixService.ts` has zero entries for `JOB_WORK` or
`CONSIGNMENT` prefixes either. Live-verified: after fully completing JWO 22 (₹500 job work charges +
₹2000 materials cost + ₹277.78 finished-goods cost, all correctly computed and stored on the job
work order row), queried `journals` for `reference_type ILIKE '%JOB_WORK%'` → **0 rows**.
**Impact:** Job work charges owed to the job worker/supplier (a real liability) never post to
Accounts Payable or any expense/WIP account. Financial statements will never reflect job-work labor
cost, no matter how many job work orders are completed. Same is true for Consignment settlements
(`CONSIGNMENT_SETTLED` also has no consumer) — though that's moot given Settlements can never be
non-zero anyway (see above).
**Severity:** Critical for any tenant that actually uses job-work outsourcing and expects it to
appear in their books.
**Relation to today's known PostingMatrixService bug:** Not the same bug. The already-confirmed issue
is that PostingMatrixService hardcodes _wrong_ GL account codes for several event types it does
handle. Job Work/Consignment aren't in that broken set — they're simply entirely absent from the
posting matrix, a different and more fundamental gap.

### HIGH — Reorder Report's one-click "Create POs" hardcodes `placeOfSupply: '27'` with no UI control

**Evidence:** `apps/web-frontend/src/pages/production/ReorderReportPage.tsx:114` sends
`placeOfSupply: '27'` (Maharashtra's GST code) directly in the `createPOMutation.mutate()` payload —
there is no state variable, no `<Select>`, nothing the user can change. Compare
`apps/web-frontend/src/pages/purchase/PurchaseOrderFormPage.tsx`, which also defaults
`placeOfSupply` to `'27'` but renders it as an editable state-picker `<Select>` (line ~345) the user
must confirm/change before submitting.
**Impact:** `ReorderService.createPOsFromReorder()` uses `placeOfSupply` vs. the supplier's actual
registered state to decide CGST/SGST (intrastate) vs. IGST (interstate). For any tenant/branch
outside Maharashtra, one-click reorder POs will get the wrong GST split silently — no error, just an
incorrect PO that may need manual correction or cause GST filing mismatches downstream.
**Severity:** High — silent financial/tax-correctness bug, though narrow blast radius (only this
one-click flow; manual PO creation via `PurchaseOrderFormPage` is unaffected). Same bug class the
team just fixed platform-wide in commit `dc9651d` ("stop hardcoding seller GST state to
Maharashtra") — this instance appears to have been missed by that sweep since it lives in
production-service's frontend page, not sales/pos.
**Not previously flagged** in any prior QA history file reviewed.

### MEDIUM — JOB_WORK_* and CONSIGNMENT_* permissions granted to no operational role

**Evidence:** `apps/tenant-service/src/rbac/role-defaults.ts` — grepped every role block for
`JOB_WORK` / `CONSIGNMENT`. Neither appears in `PURCHASE_MANAGER` (lines 114–176) nor
`INVENTORY_MANAGER` (lines 285–329), the two roles that would logically run job-work/consignment
operations. Only `OWNER` and `SUPER_ADMIN` (via the tenant-wide wildcard) and `ADMIN` (same
wildcard minus 3 unrelated permissions) can reach any Job Work or Consignment route — confirmed
live: `cashier@qa-e2e.local` gets `403 FORBIDDEN: Missing permission: JOB_WORK_VIEW`, and no other
seeded non-admin role in `TEST_CREDENTIALS.md` has these permissions either per the same file.
**Impact:** Route-level RBAC itself works correctly (enforces what's granted), but the feature is
practically unreachable for day-to-day operational staff — only account owners/admins can use it.
This matches the exact "role-defaults.ts omission" pattern already documented and fixed for dozens
of other permissions throughout this same file (see the file's own inline comments), but Job
Work/Consignment appear to have been missed by all of those prior sweeps.
**Severity:** Medium — not a security hole (nothing is over-permissioned), but a usability/adoption
gap that would surface immediately in any real customer pilot.

### LOW — No automated test coverage for Job Work Order lifecycle

**Evidence:** `apps/production-service/src/__tests__/` contains exactly 3 files:
`barcode-generation.test.ts`, `reorder-gst.test.ts`, `consignment-concurrency.integration.test.ts`.
There is no `job-work*.test.ts` of any kind. The full create → issue → QC → complete/cancel lifecycle
I live-verified above (including the stock-deduction/stock-addition math and status machine) has zero
regression coverage.
**Severity:** Low/process risk — everything I tested passed, but nothing prevents a future change
from silently breaking it.

---

## Untested / Unknown Areas

- Multi-tenant cross-tenant isolation was reviewed at the code level (tenant-scoped joins, ownership
  checks on create) but not independently re-verified live with a second tenant's data in this
  session, due to time.
- `JobWorkOrderService.cancel()`'s stock-restoration path was code-reviewed but not live-exercised
  (only create/issue/QC/complete were run end-to-end; cancel was not triggered on a live order).
- Dashboard/`in-progress` list endpoints (`/job-work-orders/dashboard`, `/job-work-orders/in-progress`)
  were not live-hit this session.
- Frontend `JobWorkOrderCreatePage.tsx` / `JobWorkQualityCheckPage.tsx` were not exercised through an
  actual browser session — only their backend endpoints were driven directly via API. Code
  inspection shows they call the same endpoints verified above.
- Whether any other service (sales-service, POS) was ever _intended_ to call
  `ConsignmentService.recordSale()` and simply never got wired up, vs. it being an incomplete
  feature by design, was not determined — no TODO/roadmap reference to a planned integration point
  was found in either the DAP tours or the production-service code.

---

## Readiness Score: 48/100

**Breakdown:**

- Job Work Orders (~65/100 standalone): inventory math, status machine, validation, RBAC
  enforcement, and error handling are all genuinely solid and live-verified. Held back hard by zero
  accounting integration (a real production blocker for any finance-conscious tenant) and zero test
  coverage.
- Consignment (~20/100 standalone): receive/return/settle-status-transition mechanics work, but the
  module cannot perform its core job (recognize a sale and pay the supplier what's actually owed) —
  this is not a partial gap, it's the central feature being entirely unreachable.
- Reorder Report (~75/100 standalone): both historically-flagged bugs are genuinely fixed; one new,
  real GST-correctness bug found in the one-click flow.

Weighted toward Consignment's severity (a module whose settlement numbers are always wrong is
arguably worse than a module that doesn't exist, since it can mislead a user who trusts the ₹0 output
at face value), the combined score is **48/100** — real, well-built infrastructure that is not
production-ready for any tenant intending to actually use consignment revenue tracking or see job-work
costs in their books.

---

## Test Data Created (tenant 2, dev DB — not cleaned up, per dev-phase convention)

- Job Work Order id **22** (`JWO-2-1784938800166`), status COMPLETED
- Job Work Order id **21** (`JWO-2-1784938799848`), status DRAFT (duplicate from an initial
  path-discovery attempt via the gateway, left as-is)
- Consignment stock id **18** (15 units item 1 from supplier 2 @ ₹120, then 5 returned)
- Consignment settlement id **15** (`CS-2-1784938974167`), status SETTLED, ₹0 (see Critical Gaps)
