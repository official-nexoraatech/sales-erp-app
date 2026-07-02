# ES-08 — Sales Workflow Completeness
## STATUS: 🔴 PENDING
## Sprint: 2 | Effort: 4–5 days | Risk: High
## Depends on: ES-03 (inventory ledger), ES-07 (RBAC permissions)
## Unlocks: ES-13, ES-14, ES-17

---

## YOUR ROLE

You are the **Principal Backend + Frontend Engineer** on the NEXORAA Multi-Tenant Cloth Retail ERP.
Your mission: close every gap in the sales workflow — quotation → order → invoice → payment — making each transition atomic, validated, and auditable.

---

## ═══════════════════════════════════════════
## PRE-FLIGHT CHECKLIST
## ═══════════════════════════════════════════

- [ ] Read `ERP-PLANNING/TECH_AUDIT.md`
- [ ] Read `ERP-PLANNING/CODING_STANDARDS.md`
- [ ] Read `ERP-PLANNING/phase-completions/ES-03_COMPLETION.md`
- [ ] Read `ERP-PLANNING/phase-completions/ES-07_COMPLETION.md`
- [ ] Read `apps/sales-service/src/domain/InvoiceService.ts` — full file
- [ ] Read `apps/sales-service/src/domain/QuotationService.ts` (if exists) — or search for quotation logic
- [ ] Read `apps/sales-service/src/domain/SalesOrderService.ts` (if exists)
- [ ] Read `apps/sales-service/src/domain/PaymentService.ts` (if exists)
- [ ] Read `apps/sales-service/src/api/invoice.routes.ts`
- [ ] Read `packages/db-client/src/schema/sales.ts` — all table columns
- [ ] Read `apps/web-frontend/src/pages/sales/` — list all existing sales pages
- [ ] Check `outbox_events` table — what events does InvoiceService emit?
- [ ] Run `pnpm build` and `pnpm test` — confirm clean baseline

---

## ═══════════════════════════════════════════
## COMPLETED PHASES
## ═══════════════════════════════════════════

| Phase | Status | Key Changes Relevant to You |
|-------|--------|----------------------------|
| ES-01 ✅ | Security | search-service JWT; rate limit 10/15min |
| ES-03 ✅ | Inventory | Invoice confirmation writes STOCK_OUT to inventory_ledger |
| ES-07 ✅ | RBAC | CREDIT_LIMIT_OVERRIDE and PRICE_FLOOR_OVERRIDE permissions defined |

---

## ═══════════════════════════════════════════
## PROJECT CONTEXT
## ═══════════════════════════════════════════

### Tech Stack
Node.js 20 + TypeScript 5 strict | Fastify 4 | PostgreSQL 16 + Drizzle ORM | Kafka 3 |
React 18 + Vite 5 + Tailwind CSS v4 | React Query v5 | Vitest

### Multi-Tenant Rules
- Every Drizzle query: `.where(eq(table.tenantId, ctx.tenantId))`
- Tenant ID: ALWAYS from `request.auth.tenantId` — NEVER from body/params/query

### Distributed Patterns
- **Outbox:** Every state-changing domain event (INVOICE_CONFIRMED, PAYMENT_RECORDED, etc.) written to `outbox_events` in the SAME Drizzle transaction
- **State machine:** Status transitions must be explicit and validated:
  - Quotation: DRAFT → SENT → ACCEPTED | REJECTED | EXPIRED
  - Sales Order: DRAFT → CONFIRMED → PARTIALLY_DELIVERED → DELIVERED | CANCELLED
  - Invoice: DRAFT → CONFIRMED → PARTIALLY_PAID → PAID | CANCELLED
  - Payment: DRAFT → CONFIRMED → BOUNCED (for cheques)

### Money Rules
- ALL monetary values: integers in paise (1 INR = 100 paise)
- Never store or compute with floats
- Tax: GST percentage × base_amount / 100, rounded with `Math.round()`
- Round-off: max ±0.49 paise to avoid floating point drift

### Auth Pattern
```typescript
fastify.post('/invoices/:id/confirm', {
  preHandler: [authenticate, requirePermission(PERMISSIONS.INVOICE_CONFIRM)],
}, handler)
```

### Frontend Design System (MANDATORY)
- `ERPDataGrid` for tables — never raw `<table>`
- `ERPFormField` + `ERPInput`/`ERPSelect` for forms
- `ERPSkeleton` for loading
- `useToast()` for success/error notifications
- `ERPPageHeader` for all page titles
- `ERPConfirmModal` for destructive actions (cancel, delete)
- `ERPErrorBoundary` wrapping each page
- React Query `useQuery`/`useMutation` — never raw `fetch`
- Tailwind v4: `@custom-variant dark` directive

### API Conventions
- Success: `{ data: T, meta?: { page, limit, total } }`
- Error: `{ error: { code: string, message: string, details?: object } }`

### Coding Standards
- TypeScript strict — no `any`
- No `console.log` — use `packages/logger`
- No business logic in route handlers — route handler calls domain service method only
- Errors: typed classes from `packages/shared-types/src/errors.ts`
- `/* global process */` at top of files using `process.env`

---

## ═══════════════════════════════════════════
## OBJECTIVE
## ═══════════════════════════════════════════

Close the functional gaps in the end-to-end sales workflow:
1. Quotation-to-Order conversion
2. Credit limit validation on invoice confirmation
3. Multi-payment tracking (partial payments, advance payments)
4. Invoice cancellation with reversal
5. Sales return (credit note) workflow
6. Sales dashboard: pending quotations, overdue invoices, payment reminders

**Why critical:** The sales workflow is the core revenue engine. Missing workflows mean salespeople are doing partial work in the system and partial work on paper — defeating the purpose of the ERP.

---

## ═══════════════════════════════════════════
## SCOPE
## ═══════════════════════════════════════════

### IN SCOPE

**Fix 1 — Quotation to Sales Order conversion**

File: `apps/sales-service/src/domain/QuotationService.ts`

Add `convertToOrder(quotationId, ctx)`:
- Validates quotation status is `ACCEPTED`
- Creates `sales_order` with status `CONFIRMED`
- Writes `QUOTATION_CONVERTED` to outbox
- Updates quotation status → `CONVERTED`
- Returns the new sales order ID

Route: `POST /api/v1/sales/quotations/:id/convert`
Guard: `authenticate` + `requirePermission(PERMISSIONS.SALES_ORDER_CREATE)`

Frontend: Add "Convert to Order" button on `QuotationDetailPage.tsx` (only visible when status is ACCEPTED)

**Fix 2 — Credit limit validation**

File: `apps/sales-service/src/domain/InvoiceService.ts`

In `confirm(invoiceId, ctx)`:
- Load customer's `credit_limit` and current outstanding balance (`SUM` of unpaid invoices)
- If `outstanding + new_invoice_total > credit_limit`:
  - If caller has `PERMISSIONS.CREDIT_LIMIT_OVERRIDE` in JWT: proceed and log override event to outbox
  - Else: throw `CREDIT_LIMIT_EXCEEDED` error (422) with current limit and outstanding in details

**Fix 3 — Partial payment tracking**

File: `apps/sales-service/src/domain/PaymentService.ts` (create if missing)

- `recordPayment(invoiceId, amount, paymentMethod, referenceNo, ctx)`:
  - Insert into `invoice_payments` table (or `payments` — check schema)
  - Recalculate `invoices.paid_amount = SUM(payments WHERE invoice_id = X)`
  - Update `invoices.status`:
    - `paid_amount >= total_amount` → `PAID`
    - `0 < paid_amount < total_amount` → `PARTIALLY_PAID`
  - Write `PAYMENT_RECORDED` event to outbox (triggers AR update in accounting-service)
  - All in ONE Drizzle transaction

Route: `POST /api/v1/sales/invoices/:id/payments`
Guard: `authenticate` + `requirePermission(PERMISSIONS.PAYMENT_RECORD)`

Frontend page: `apps/web-frontend/src/pages/sales/InvoicePaymentsPage.tsx`
- List of payments for this invoice with payment date, amount, method, reference
- "Record Payment" button → form: amount, method (CASH/CHEQUE/UPI/NEFT/RTGS), date, reference no, notes

**Fix 4 — Invoice cancellation**

File: `apps/sales-service/src/domain/InvoiceService.ts`

`cancel(invoiceId, reason, ctx)`:
- Only cancellable if status is `CONFIRMED` (not PAID, not already CANCELLED)
- Reverse `available_qty` updates (re-add stock to inventory)
- Write `STOCK_IN` to inventory ledger via same internal route as ES-03 (`POST /internal/ledger`)
- Write `INVOICE_CANCELLED` to outbox (triggers journal reversal in accounting-service)
- Log reason in `invoice_cancellations` table (or `invoice_audit_log`)
- All in ONE transaction

Route: `DELETE /api/v1/sales/invoices/:id` (with `{ reason }` in body)
Guard: `authenticate` + `requirePermission(PERMISSIONS.INVOICE_CANCEL)`

Frontend: Cancel button on `InvoiceDetailPage.tsx` → `ERPConfirmModal` asking for reason.

**Fix 5 — Sales Return (Credit Note)**

File: `apps/sales-service/src/domain/SalesReturnService.ts` (create if missing)

`createReturn(invoiceId, returnLines, reason, ctx)`:
- Validate: invoice must be CONFIRMED or PAID
- Validate: return quantities ≤ original invoice quantities
- Create `sales_returns` record
- Each return line: restore `available_qty`, write `STOCK_IN` to inventory ledger
- Write `SALES_RETURN_APPROVED` to outbox (triggers credit note journal in accounting-service)
- All in ONE transaction

Route: `POST /api/v1/sales/returns`
Guard: `authenticate` + `requirePermission(PERMISSIONS.SALES_RETURN_CREATE)`

Frontend: `apps/web-frontend/src/pages/sales/SalesReturnPage.tsx`
- Select invoice, select items and quantities to return, provide reason
- On submit: show credit note number

**Fix 6 — Sales summary cards on dashboard**

File: `apps/web-frontend/src/pages/DashboardPage.tsx`

Add to the existing dashboard:
- Pending Quotations: count of SENT quotations older than 3 days
- Overdue Invoices: count of CONFIRMED invoices past `due_date`
- Collected Today: sum of payments recorded today
- Each card links to the relevant list page

---

### OUT OF SCOPE
- GST/Tax calculations (ES-10)
- Pricing engine (separate)
- Delivery scheduling
- Shipping integration
- POS cash register (separate module)

---

## ═══════════════════════════════════════════
## TESTING REQUIREMENTS
## ═══════════════════════════════════════════

`apps/sales-service/src/__tests__/sales-workflow.test.ts`:
1. Convert ACCEPTED quotation → sales order created with status CONFIRMED
2. Convert DRAFT quotation → throws error (wrong state)
3. Credit limit exceeded → CREDIT_LIMIT_EXCEEDED error (422)
4. Credit limit exceeded + CREDIT_LIMIT_OVERRIDE permission → proceeds
5. Record payment for 50% of invoice → status becomes PARTIALLY_PAID
6. Record payment for remaining 50% → status becomes PAID
7. Cancel CONFIRMED invoice → STOCK_IN ledger row created, status CANCELLED
8. Cancel PAID invoice → error (cannot cancel paid invoice)
9. Create sales return with valid quantities → STOCK_IN, SALES_RETURN_APPROVED event
10. Create sales return with quantity > original → error

---

## ═══════════════════════════════════════════
## BUILD VERIFICATION
## ═══════════════════════════════════════════

```bash
pnpm --filter @erp/sales-service build
pnpm --filter @erp/sales-service type-check
pnpm --filter @erp/web-frontend build
pnpm --filter @erp/web-frontend type-check
pnpm lint
pnpm test --filter @erp/sales-service
```

---

## ═══════════════════════════════════════════
## VERIFICATION CHECKLIST
## ═══════════════════════════════════════════

- [ ] `POST /quotations/:id/convert` creates a sales order for ACCEPTED quotation
- [ ] Invoice confirmation for customer over credit limit → 422
- [ ] Invoice confirmation with CREDIT_LIMIT_OVERRIDE → succeeds
- [ ] Record partial payment → invoice.status = PARTIALLY_PAID
- [ ] Record full payment → invoice.status = PAID
- [ ] Cancel confirmed invoice → inventory_ledger has STOCK_IN row, status = CANCELLED
- [ ] Sales return → inventory_ledger has STOCK_IN row
- [ ] Dashboard shows pending quotation count
- [ ] All 10 workflow tests pass
- [ ] `pnpm lint` passes

---

## ═══════════════════════════════════════════
## REGRESSION CHECKLIST
## ═══════════════════════════════════════════

- [ ] Basic invoice create/confirm (without credit issues) still works
- [ ] ES-03 inventory ledger writes still work on normal confirm
- [ ] Outbox events from invoice operations still publish
- [ ] `InvoiceListPage.tsx` still loads and shows invoices
- [ ] `QuotationListPage.tsx` still loads and shows quotations

---

## ═══════════════════════════════════════════
## DEFINITION OF DONE
## ═══════════════════════════════════════════

- [ ] All 6 fixes implemented and tested
- [ ] 10 integration tests pass
- [ ] No existing workflows broken
- [ ] Completion report saved at `ERP-PLANNING/phase-completions/ES-08_COMPLETION.md`

---

## ═══════════════════════════════════════════
## COMPLETION REPORT TEMPLATE
## ═══════════════════════════════════════════

**Save as:** `ERP-PLANNING/phase-completions/ES-08_COMPLETION.md`

```markdown
# ES-08 Completion Report — Sales Workflow Completeness
**Date:** [YYYY-MM-DD]
**Status:** COMPLETE

## Summary
[What was implemented across sales workflow]

## Status Machine States Verified
- Quotation: [DRAFT → SENT → ACCEPTED → CONVERTED verified]
- Invoice: [DRAFT → CONFIRMED → PARTIALLY_PAID → PAID verified]
- Cancellation: [CONFIRMED → CANCELLED verified]

## Credit Limit Logic
- Credit limit validation: [IMPLEMENTED]
- CREDIT_LIMIT_OVERRIDE bypass: [IMPLEMENTED]

## Files Changed
[Table with file → change]

## Tests: 10/10 PASS | lint: PASS | build: PASS

## Phases Unblocked
ES-13 (FIFO valuation needs correct inventory ledger from sales returns)
ES-14 (business rule validations build on these state machines)
ES-17 (analytics needs payment + return data)
```
