# ES-08 Completion Report — Sales Workflow Completeness
**Date:** 2026-07-02
**Status:** COMPLETE

## Summary

Closed 6 functional gaps in the end-to-end sales workflow. The major backend domain services (InvoiceService, PaymentService, SaleReturnService) were largely already implemented from prior phases. ES-08 audited them, hardened the remaining gaps, and wired up missing frontend detail views and dashboard observability.

## What Was Already Implemented (Prior Phases)

| Feature | Service Method | Status |
|---------|----------------|--------|
| Invoice credit limit check | `InvoiceService.create()` | ✅ Prior phase |
| Invoice cancellation + stock restore | `InvoiceService.cancel()` | ✅ Prior phase |
| Partial payment allocation | `PaymentService.allocate()` | ✅ Prior phase |
| Sales return + credit note | `SaleReturnService.create()` | ✅ Prior phase |
| Outbox events for all operations | Various | ✅ Prior phase |

## Fixes Applied in ES-08

### Fix 1 — Quotation Conversion (ACCEPTED-only enforcement + outbox event)
`QuotationService.convert()` was accepting SENT/VIEWED/ACCEPTED status. Hardened to **ACCEPTED only** and wrapped in a transaction that also writes `QUOTATION_CONVERTED` to the outbox.

### Fix 2 — Quotation Route Permission
`POST /quotations/:id/convert` was guarded by `PERMISSIONS.INVOICE_CREATE`. Changed to `PERMISSIONS.QUOTATION_CONVERT` (correct semantic permission).

### Fix 3 — Sale Return Quantity Validation
`SaleReturnService.create()` was computing return amounts but never validating `returnQty ≤ origQty`. Added the check: throws `BusinessError('RETURN_QTY_EXCEEDED', ...)` when exceeded (test 10).

### Fix 4 — Dashboard Sales Summary Route
New `GET /api/v2/dashboard/sales-summary` in `apps/sales-service/src/api/dashboard.routes.ts`:
- Pending Quotations: count of SENT quotations older than 3 days
- Overdue Invoices: count of OVERDUE status invoices
- Collected Today: sum of all payments from today

### Fix 5 — QuotationDetailPage.tsx
Replaced "coming soon" placeholder with a full detail page:
- Quotation summary cards (customer, valid until, grand total, place of supply)
- Line items table with GST breakdown
- Totals panel
- **"Convert to Order" button** (visible only when `status === 'ACCEPTED'`)
- "Send" button for DRAFT quotations
- ERPConfirmModal with warning variant before conversion

### Fix 6 — Dashboard Sales Workflow Cards
Added a "Sales Workflow" section to `DashboardPage.tsx` with 3 clickable metric cards:
- **Pending Quotations** → links to `/sales/quotations?status=SENT`
- **Overdue Invoices** → links to `/sales/invoices?status=OVERDUE`
- **Collected Today** → links to `/sales/payments`

## Status Machine States Verified

- **Quotation:** DRAFT → SENT → ACCEPTED → CONVERTED (convert throws on non-ACCEPTED states)
- **Invoice:** DRAFT → CONFIRMED → PARTIALLY_PAID → PAID (via PaymentService.allocate)
- **Cancellation:** CONFIRMED → CANCELLED (PAID status rejects with BusinessError)
- **Sale Return:** validates CONFIRMED/PARTIALLY_PAID/PAID invoice, validates returnQty ≤ origQty

## Credit Limit Logic

- Credit limit validation: **IMPLEMENTED** in `InvoiceService.create()` (prior phase) — check against `projectionCustomerBalance.currentBalance`
- `CREDIT_LIMIT_OVERRIDE` bypass: **IMPLEMENTED** via `overrideCreditLimit: true` flag (ES-07 permission guard)

## Files Changed

| File | Change |
|------|--------|
| `apps/sales-service/src/domain/QuotationService.ts` | Import `outboxEvents`/`ulid`; restrict convert to ACCEPTED; transaction + outbox event |
| `apps/sales-service/src/api/quotation.routes.ts` | convert route: `INVOICE_CREATE` → `QUOTATION_CONVERT` |
| `apps/sales-service/src/domain/SaleReturnService.ts` | Add `returnQty > origQty` validation |
| `apps/sales-service/src/api/dashboard.routes.ts` | **NEW** — `GET /dashboard/sales-summary` |
| `apps/sales-service/src/main.ts` | Import + register `dashboardRoutes` |
| `apps/sales-service/src/__tests__/sales-workflow.test.ts` | **NEW** — 10 workflow tests |
| `apps/web-frontend/src/api/endpoints.ts` | Add `salesDashboardApi.summary()` |
| `apps/web-frontend/src/pages/sales/QuotationDetailPage.tsx` | Full detail view + Convert to Order button |
| `apps/web-frontend/src/pages/DashboardPage.tsx` | Add Sales Workflow summary section (3 cards) |

## Tests: 10/10 PASS | lint: N/A | build: N/A (pre-existing main.ts errors unrelated to ES-08)

Pre-existing type errors in `sales-service/src/main.ts` (missing `@erp/logger` metric exports) and `web-frontend/src/pages/hr/PayrollPage.tsx` are unrelated to ES-08.

## Deployment Checklist

No database migrations required. All changes are code-only.

- [x] `QuotationService.convert()` strict ACCEPTED-only validation
- [x] `QUOTATION_CONVERTED` outbox event written in transaction
- [x] `SaleReturnService.create()` rejects returnQty > origQty
- [x] `/dashboard/sales-summary` route registered in sales-service
- [x] `QuotationDetailPage` shows full detail + Convert to Order button
- [x] Dashboard shows 3 sales workflow KPI cards
- [x] 10 tests pass in `sales-workflow.test.ts`

## Phases Unblocked

- **ES-13** — FIFO valuation needs correct inventory ledger from sales returns (SaleReturnService now validates quantities)
- **ES-14** — Business rule validations build on these state machines (quotation ACCEPTED-only is now enforced)
- **ES-17** — Analytics needs payment + return data (PaymentService + SaleReturnService confirmed complete)
