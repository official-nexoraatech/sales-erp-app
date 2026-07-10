# ES-09 — Purchase Workflow & GRNI Completeness
## STATUS: ✅ COMPLETED (adapted — see ES-09_COMPLETION.md for architecture deviation on Fixes 3/4)
## Sprint: 2 | Effort: 3–4 days | Risk: Medium
## Depends on: ES-03 (inventory ledger), ES-07 (RBAC)
## Unlocks: ES-13, ES-16

---

## YOUR ROLE

You are the **Principal Backend + Frontend Engineer** on the NEXORAA Multi-Tenant Cloth Retail ERP.
Your mission: complete the purchase order → GRN → vendor invoice → payment cycle, with proper 3-way matching, GRNI accrual, and vendor credit controls.

---

## ═══════════════════════════════════════════
## PRE-FLIGHT CHECKLIST
## ═══════════════════════════════════════════

- [ ] Read `ERP-PLANNING/TECH_AUDIT.md`
- [ ] Read `ERP-PLANNING/CODING_STANDARDS.md`
- [ ] Read `ERP-PLANNING/phase-completions/ES-03_COMPLETION.md`
- [ ] Read `ERP-PLANNING/phase-completions/ES-07_COMPLETION.md`
- [ ] Read `apps/purchase-service/src/domain/GRNService.ts` — full file
- [ ] Read `apps/purchase-service/src/domain/PurchaseOrderService.ts` — full file
- [ ] Read `apps/purchase-service/src/domain/VendorInvoiceService.ts` (or search for vendor invoice logic)
- [ ] Read `packages/db-client/src/schema/purchase.ts` — all columns
- [ ] Read `apps/web-frontend/src/pages/purchase/` — list existing pages
- [ ] Check `outbox_events` what purchase events are currently emitted
- [ ] Run `pnpm build` and `pnpm test` — confirm clean baseline

---

## ═══════════════════════════════════════════
## COMPLETED PHASES
## ═══════════════════════════════════════════

| Phase | Status | Key Changes Relevant to You |
|-------|--------|----------------------------|
| ES-01 ✅ | Security | JWT auth wired |
| ES-03 ✅ | Inventory | GRN approval writes STOCK_IN to ledger |
| ES-07 ✅ | RBAC | CREDIT_LIMIT_OVERRIDE available for vendor credit control |

---

## ═══════════════════════════════════════════
## PROJECT CONTEXT
## ═══════════════════════════════════════════

### Tech Stack
Node.js 20 + TypeScript 5 strict | Fastify 4 | PostgreSQL 16 + Drizzle ORM | Kafka 3 | Vitest

### Multi-Tenant Rules
- Every Drizzle query: `.where(eq(table.tenantId, ctx.tenantId))`
- Tenant ID: ALWAYS from `request.auth.tenantId`

### Money Rules
- ALL monetary values stored as integers in paise
- Never floats

### Distributed Patterns
- **Outbox:** every state change writes an event to `outbox_events` in the SAME transaction
- **3-Way Match:** PO quantity ≥ GRN quantity ≥ Vendor Invoice quantity (all must agree within tolerance)
- **GRNI** (Goods Received Not Invoiced): an accrual posting created when GRN is approved but vendor invoice is not yet received. Cleared when vendor invoice is matched.

### Purchase State Machines
```
Purchase Order: DRAFT → APPROVED → PARTIALLY_RECEIVED → FULLY_RECEIVED | CANCELLED
GRN:           DRAFT → APPROVED → INVOICE_MATCHED
Vendor Invoice: DRAFT → MATCHED → APPROVED_FOR_PAYMENT → PAID | DISPUTED
Payment:       RECORDED → CLEARED | BOUNCED
```

### Auth Pattern
```typescript
fastify.post('/grn/:id/approve', {
  preHandler: [authenticate, requirePermission(PERMISSIONS.GRN_APPROVE)],
}, handler)
```

### Frontend Design System
- `ERPDataGrid` for all tables
- `ERPFormField` + inputs for forms
- `ERPSkeleton` for loading states
- `useToast()` for notifications
- `ERPPageHeader`, `ERPConfirmModal`

### Coding Standards
- TypeScript strict — no `any`
- No `console.log` — use `packages/logger`
- Drizzle ORM for all DB access
- Error codes: `PURCHASE_` prefix (e.g., `PURCHASE_QTY_MISMATCH`)
- `/* global process */` at top of files using `process.env`

---

## ═══════════════════════════════════════════
## OBJECTIVE
## ═══════════════════════════════════════════

Complete the purchase cycle gaps:
1. PO approval and amendment workflow
2. GRN creation from PO (partial receipts supported)
3. GRNI accrual journal on GRN approval
4. 3-way matching: PO ↔ GRN ↔ Vendor Invoice
5. Vendor payment recording with AP aging
6. Purchase return workflow
7. Vendor credit limit enforcement

---

## ═══════════════════════════════════════════
## SCOPE
## ═══════════════════════════════════════════

### IN SCOPE

**Fix 1 — PO Approval workflow**

`apps/purchase-service/src/domain/PurchaseOrderService.ts`:

- `approve(poId, ctx)`: only DRAFT → APPROVED; requires `PERMISSIONS.PO_APPROVE`
- `amend(poId, amendments, reason, ctx)`: only on APPROVED PO; creates amendment record; requires `PERMISSIONS.PO_AMEND`
- Emit `PO_APPROVED` to outbox on approval

Route: `POST /api/v1/purchase/orders/:id/approve`
Route: `POST /api/v1/purchase/orders/:id/amend`

**Fix 2 — GRN creation from PO**

`apps/purchase-service/src/domain/GRNService.ts`:

`createFromPO(poId, receivedLines, ctx)`:
- Validate: PO is APPROVED
- Each line: `received_qty ≤ (po_qty - previously_received_qty)`; throw `PURCHASE_QTY_MISMATCH` if over-receipt
- Update PO line `received_quantity`
- Update PO status: all lines fully received → `FULLY_RECEIVED`; any partial → `PARTIALLY_RECEIVED`
- Write `STOCK_IN` to inventory ledger via `POST /internal/ledger` on inventory-service
- Emit `GRN_APPROVED` and `GRNI_ACCRUAL_REQUIRED` to outbox
- All in ONE transaction

**Fix 3 — GRNI Accrual** (accounting-service consumer)

`apps/accounting-service/src/consumers/grni-accrual.consumer.ts` (create if missing):

On `GRNI_ACCRUAL_REQUIRED` Kafka event:
- Create journal entry: DR Inventory / CR GRNI Payable (at PO unit cost × received qty)
- Check inbox for deduplication before processing
- Emit `GRNI_JOURNAL_POSTED` to outbox

**Fix 4 — 3-Way Matching**

`apps/purchase-service/src/domain/VendorInvoiceService.ts`:

`matchToGRN(vendorInvoiceId, grnId, ctx)`:
- Compare quantities: GRN qty vs vendor invoice qty — if mismatch > tolerance (0.5%), throw `PURCHASE_QTY_MISMATCH` (422)
- Compare amounts: PO unit price vs vendor invoice unit price — if mismatch > tolerance (1%), create `PRICE_VARIANCE` record and alert
- On match success: update vendor invoice status → `MATCHED`; clear GRNI by posting DR GRNI Payable / CR Accounts Payable journal
- Emit `VENDOR_INVOICE_MATCHED` to outbox

Route: `POST /api/v1/purchase/vendor-invoices/:id/match`
Guard: `requirePermission(PERMISSIONS.VENDOR_INVOICE_APPROVE)`

**Fix 5 — Vendor payment recording**

`apps/purchase-service/src/domain/VendorPaymentService.ts` (create if missing):

`recordPayment(vendorInvoiceId, amount, method, referenceNo, ctx)`:
- Update `vendor_invoice_payments` table
- Recalculate `vendor_invoices.paid_amount`
- Update status: fully paid → `PAID`; partial → `PARTIALLY_PAID`
- Emit `VENDOR_PAYMENT_RECORDED` to outbox (triggers AP ledger update)

Route: `POST /api/v1/purchase/vendor-invoices/:id/payments`

**Fix 6 — Purchase return with vendor credit note**

`apps/purchase-service/src/domain/PurchaseReturnService.ts`:

Verify/complete `approve(returnId, ctx)` (ES-03 verified GRN already does STOCK_IN, but was purchase return STOCK_OUT confirmed?):
- Create `vendor_credit_note` record
- Write `STOCK_OUT` for returned items via inventory ledger
- Emit `PURCHASE_RETURN_APPROVED` to outbox
- Clear against vendor outstanding balance

**Fix 7 — Vendor credit limit enforcement**

`apps/purchase-service/src/domain/PurchaseOrderService.ts`:

In `approve()`:
- Load vendor's `credit_limit` and current outstanding AP balance
- If `outstanding + new_po_total > credit_limit` and user lacks `CREDIT_LIMIT_OVERRIDE` → throw `VENDOR_CREDIT_LIMIT_EXCEEDED` (422)

**Frontend — GRN page**

`apps/web-frontend/src/pages/purchase/GRNPage.tsx`:
- Show PO number, supplier, GRN lines with received qty vs ordered qty
- "Match to Vendor Invoice" button (triggers matching workflow)
- Status chip: DRAFT / APPROVED / INVOICE_MATCHED

**Frontend — Vendor Invoice page**

`apps/web-frontend/src/pages/purchase/VendorInvoicePage.tsx`:
- If exists: add "Match to GRN" button and payment history section
- If not exists: create it with ERPDataGrid showing vendor invoices by status

### OUT OF SCOPE
- GST Input Tax Credit (ES-10)
- Import duty / customs (separate feature)
- Purchase analytics (ES-17)

---

## ═══════════════════════════════════════════
## TESTING REQUIREMENTS
## ═══════════════════════════════════════════

`apps/purchase-service/src/__tests__/purchase-workflow.test.ts`:
1. Approve PO → status APPROVED; cannot approve again → error
2. GRN creation for partial quantities → PO status PARTIALLY_RECEIVED
3. GRN over-receipt (qty > PO qty) → PURCHASE_QTY_MISMATCH error
4. 3-way match: quantities agree → vendor invoice status MATCHED
5. 3-way match: quantity mismatch > 0.5% → PURCHASE_QTY_MISMATCH error
6. Record vendor payment (full) → status PAID
7. Record vendor payment (partial) → status PARTIALLY_PAID
8. PO approval for vendor over credit limit → VENDOR_CREDIT_LIMIT_EXCEEDED
9. PO approval with CREDIT_LIMIT_OVERRIDE → succeeds

---

## ═══════════════════════════════════════════
## BUILD VERIFICATION
## ═══════════════════════════════════════════

```bash
pnpm --filter @erp/purchase-service build
pnpm --filter @erp/purchase-service type-check
pnpm --filter @erp/accounting-service build
pnpm --filter @erp/web-frontend build
pnpm lint
pnpm test --filter @erp/purchase-service
pnpm test --filter @erp/accounting-service
```

---

## ═══════════════════════════════════════════
## VERIFICATION CHECKLIST
## ═══════════════════════════════════════════

- [ ] GRN created from PO → STOCK_IN rows in inventory_ledger
- [ ] GRN approval → GRNI Payable journal entry posted in accounting-service
- [ ] 3-way match succeeds → GRNI Payable cleared
- [ ] Vendor payment recorded → AP balance reduces
- [ ] Vendor over credit limit on PO approval → 422 with error code
- [ ] All 9 workflow tests pass
- [ ] `pnpm lint` passes

---

## ═══════════════════════════════════════════
## REGRESSION CHECKLIST
## ═══════════════════════════════════════════

- [ ] Existing GRN approval still writes STOCK_IN to inventory_ledger (ES-03)
- [ ] Purchase return approval still writes STOCK_IN (ES-03)
- [ ] Outbox relay still publishes events (ES-02)
- [ ] `PurchaseOrderListPage.tsx` still loads

---

## ═══════════════════════════════════════════
## DEFINITION OF DONE
## ═══════════════════════════════════════════

- [ ] Full PO → GRN → Vendor Invoice → Payment cycle implemented
- [ ] GRNI accrual and clearance working
- [ ] 3-way matching enforced
- [ ] 9 integration tests pass
- [ ] Completion report saved at `ERP-PLANNING/phase-completions/ES-09_COMPLETION.md`

---

## ═══════════════════════════════════════════
## COMPLETION REPORT TEMPLATE
## ═══════════════════════════════════════════

**Save as:** `ERP-PLANNING/phase-completions/ES-09_COMPLETION.md`

```markdown
# ES-09 Completion Report — Purchase Workflow & GRNI
**Date:** [YYYY-MM-DD]
**Status:** COMPLETE

## Summary
[What was completed in purchase cycle]

## 3-Way Match Implementation
- Quantity tolerance: 0.5%
- Price variance tolerance: 1% (creates alert, does not block)
- GRNI accrual: [implemented via accounting-service consumer]

## Files Changed
[Table]

## Tests: 9/9 PASS | lint: PASS | build: PASS

## Phases Unblocked
ES-13 (FIFO/WACC needs correct STOCK_IN unit_cost from GRN)
```
