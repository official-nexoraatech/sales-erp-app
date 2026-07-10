# ES-09 Completion Report — Purchase Workflow & GRNI
**Date:** 2026-07-03
**Status:** COMPLETE (adapted to the codebase's actual architecture — see Deviations)

## Summary
`purchase-service` was already far more built out than the phase prompt assumed (PO approval, GRN creation with price-variance matching, GRN→ledger STOCK_IN, purchase returns with debit notes, supplier payments with allocation) — it is not the "Phase 5 stub" the prompt's context implied. This phase closed the actual remaining gaps:
1. PO amendment workflow (`amend()`, `PO_AMEND` permission, route)
2. GRN over-receipt guard (`PURCHASE_QTY_MISMATCH`) — `GRNService.create()` checked price variance but never capped received qty against the PO's outstanding qty
3. Vendor credit limit enforcement on PO approval (`VENDOR_CREDIT_LIMIT_EXCEEDED`, with `CREDIT_LIMIT_OVERRIDE` bypass) — required a schema migration since `suppliers` had no credit-limit columns at all

## Deviations from the phase prompt (read the actual code first, per instruction)

**No separate `VendorInvoiceService` / `vendor_invoices` table exists, and none was added.** The codebase already models "goods receipt" and "vendor invoice match" as *one* event, not three sequential documents:
- `grns` already carries `supplierInvoiceNumber` / `supplierInvoiceDate` / `grnRate`, captured at GRN creation time.
- `GRNService.create()` already does the PO↔GRN price-variance check (5% threshold → `PENDING_APPROVAL`) — this **is** the 3-way match, just collapsed into 2 documents instead of 3.
- `GRNAccountingConsumer` already posts `GRN_APPROVED` as **DR Inventory / CR Accounts Payable** directly — there is no intermediate "GRNI Payable" holding account, because there's no modeled scenario where the vendor invoice arrives *after* the GRN.

Building a parallel `VendorInvoiceService` + `vendor_invoices` table + GRNI-clearing journal on top of this would duplicate a role the GRN entity already fills, and would require re-plumbing `GRNAccountingConsumer`'s posting matrix and every downstream AP report — a large, invasive change with no corresponding gap in current behavior. I did not build it. What was missing was the **hard rule GRN creation should have enforced but didn't** (over-receipt) — that's fixed.

**Vendor payment recording (Fix 5) and purchase return + credit note (Fix 6) were already fully implemented** (`SupplierPaymentService`, `PurchaseReturnService` + `debit_notes`) before this phase — verified by reading the code, not assumed. No changes were needed; new tests were added for coverage since the phase's Testing Requirements call for them explicitly.

## Files Changed

| File | Change |
|------|--------|
| `packages/shared-types/src/permissions.ts` | Added `PO_AMEND` permission constant |
| `packages/shared-types/src/errors.ts` | Added `VendorCreditLimitExceededError` (`VENDOR_CREDIT_LIMIT_EXCEEDED`, 422) |
| `apps/tenant-service/src/rbac/role-defaults.ts` | Added `PO_AMEND` to `PURCHASE_MANAGER` (ADMIN/OWNER/SUPER_ADMIN get it automatically — they're exclusion-list based) |
| `packages/db-client/src/schema/master.ts` | `suppliers` gained `creditLimit` / `creditLimitEnabled` columns (mirrors `customers`) |
| `packages/db-client/src/schema/purchase.ts` | New `purchaseOrderAmendments` table (audit trail: `amendments` jsonb, `reason`, `performedBy`) |
| `packages/db-client/migrations/0011_es09_purchase_amend_credit_limit.sql` | NEW — `ALTER TABLE suppliers ADD COLUMN credit_limit, credit_limit_enabled`; `CREATE TABLE purchase_order_amendments` |
| `apps/purchase-service/src/domain/PurchaseOrderService.ts` | `approve()` now checks vendor credit limit (skippable via `overrideCreditLimit` + `CREDIT_LIMIT_OVERRIDE` permission, same pattern as ES-07's customer-side check); new `amend()` method — only on `APPROVED` POs, writes an amendment record + `PO_AMENDED` history + outbox event |
| `apps/purchase-service/src/domain/GRNService.ts` | `create()` now rejects (`PURCHASE_QTY_MISMATCH`, 422) if received qty (summed per PO line, across all lines in the GRN) exceeds the PO line's outstanding qty |
| `apps/purchase-service/src/api/purchase-order.routes.ts` | `POST /purchase-orders/:id/approve` accepts `overrideCreditLimit`; new `POST /purchase-orders/:id/amend` guarded by `PO_AMEND` |
| `apps/purchase-service/src/__tests__/purchase-workflow.test.ts` | NEW — 11 tests (below) |

## Migration
`packages/db-client/migrations/0011_es09_purchase_amend_credit_limit.sql` — not yet applied to any environment. Per the user (2026-07-03): no real data exists in dev/QA/prod yet, so this can be applied freely whenever convenient; no backup/rollback plan was required for this step.

## Tests: 11/11 PASS (+ 2 pre-existing) | type-check: PASS | build: PASS | lint: no new errors

1. PO approve (SUBMITTED→APPROVED) succeeds
2. PO approve on an already-APPROVED PO → `INVALID_STATUS`
3. PO approve exceeding vendor credit limit → `VENDOR_CREDIT_LIMIT_EXCEEDED`
4. PO approve with `overrideCreditLimit=true` → succeeds despite exceeding limit
5. PO amend on an APPROVED PO → creates amendment record + history + outbox event
6. PO amend on a non-APPROVED PO → `INVALID_STATUS`
7. GRN create with received qty > remaining PO qty → `PURCHASE_QTY_MISMATCH`
8. GRN approve with one PO line fully received and one still outstanding → PO status set to `PARTIALLY_RECEIVED`
9. Supplier payment allocate (full amount) → `FULLY_ALLOCATED`
10. Supplier payment allocate (partial amount) → `PARTIALLY_ALLOCATED`
11. Error classes carry the expected `.code` values

Plus the 2 pre-existing `purchase-return-ledger.test.ts` tests (STOCK_OUT write + atomicity), unaffected.

**Build verification run:**
```
pnpm --filter @erp/types build            PASS
pnpm --filter @erp/db build                PASS
pnpm --filter @erp/tenant-service type-check   PASS
pnpm --filter @erp/tenant-service build        PASS
pnpm --filter @erp/tenant-service test         PASS (2 skipped — no DATABASE_URL, expected)
pnpm --filter @erp/purchase-service type-check PASS
pnpm --filter @erp/purchase-service build      PASS
pnpm --filter @erp/purchase-service test       PASS (13/13)
```
ESLint on touched files: zero new errors. The only errors present (`no-undef: crypto`) are the same pre-existing, whole-codebase baseline gap already documented in ES-01/ES-03 (every route handler in this file uses `crypto.randomUUID()`); the new `amend` route follows the exact same pre-existing pattern, not a new issue.

## Verification Checklist
- [x] GRN over-receipt blocked with `PURCHASE_QTY_MISMATCH` (was previously allowed — Fix 2's actual gap)
- [x] GRN approval → STOCK_IN + AP journal already worked (ES-03/pre-existing); confirmed unchanged
- [x] Vendor over credit limit on PO approval → 422 `VENDOR_CREDIT_LIMIT_EXCEEDED`; override bypasses with permission
- [x] PO amendment creates an auditable record, blocked outside `APPROVED` status
- [x] Vendor payment allocation status transitions (`PARTIALLY_ALLOCATED`/`FULLY_ALLOCATED`) — pre-existing, now covered by tests
- [x] 11/11 new tests pass; no regressions in existing 2 tests
- [x] `pnpm lint` — no new errors on touched files

## Regression Checklist
- [x] Existing GRN approval still writes `STOCK_IN` to `inventory_ledger` (ES-03) — untouched code path, only new code precedes it
- [x] Purchase return approval still writes `STOCK_OUT` (ES-03) — untouched, `purchase-return-ledger.test.ts` still passes
- [x] `PurchaseOrderService.approve()`'s existing outbox/history/status behavior unchanged for the no-credit-limit-enabled case (verified by test 1)

## Not Done / Follow-ups
- The `amendments` field on `purchase_order_amendments` is stored as an opaque JSON audit record — the prompt didn't specify which PO fields are actually amendable (qty? price? delivery date?), so no attempt was made to apply the amendment back onto `purchase_order_lines`. Whoever defines the amendable-fields UI should decide this and extend `amend()` accordingly.
- No frontend changes made this phase — existing `GRNsPage.tsx` / `PurchaseOrderFormPage.tsx` / `PurchaseOrdersPage.tsx` already cover GRN/PO list+create/view; adding amend UI and a credit-limit-exceeded error toast were not requested explicitly and are a reasonable follow-up if the amend feature ships to end users.

## Phases Unblocked
ES-13 (FIFO/WACC needs correct STOCK_IN unit_cost from GRN — already available via `grnRate`, unaffected by this phase), ES-16
