# PHASE [N] — [NAME] — COMPLETION REPORT
## Generated: [DATE] | Status: COMPLETE

> **This document is the official handoff artifact for Phase [N].**
> **The next phase MUST start by reading this document.**
> **Never modify this document after generation.**

---

## 1. PHASE SUMMARY

| Field | Value |
|---|---|
| Phase Number | [N] |
| Phase Name | [Name] |
| Start Date | [Date] |
| End Date | [Date] |
| Status | COMPLETE / PARTIALLY COMPLETE |
| Engineer(s) | [Names] |
| Claude Session | [Link or ID if saved] |

---

## 2. WHAT WAS BUILT

### 2.1 Database Schema
List every table created, every index added, every function/trigger created.

```sql
-- Tables created:
-- invoices (25 columns)
-- invoice_lines (18 columns)
-- invoice_payments (10 columns)

-- Indexes created:
-- idx_invoices_tenant_date
-- idx_invoice_lines_invoice_id

-- Functions created:
-- fn_compute_invoice_balance()

-- Triggers created:
-- tr_invoice_history (archives on UPDATE)
-- tr_invoice_balance_check (validates before CONFIRM)
```

### 2.2 APIs Implemented
List every endpoint with method, path, permission, and status.

| Method | Path | Permission | Status |
|---|---|---|---|
| GET | /api/v2/invoices | INVOICE_VIEW | ✅ Done |
| POST | /api/v2/invoices | INVOICE_CREATE | ✅ Done |
| GET | /api/v2/invoices/:id | INVOICE_VIEW | ✅ Done |
| PUT | /api/v2/invoices/:id | INVOICE_UPDATE | ✅ Done |
| POST | /api/v2/invoices/:id/confirm | INVOICE_CREATE | ✅ Done |
| POST | /api/v2/invoices/:id/cancel | INVOICE_CANCEL | ✅ Done |

### 2.3 Services Implemented
List every service class/module with its responsibilities.

```
InvoiceService
  createInvoice()     — Full saga with stock deduction + accounting + events
  cancelInvoice()     — Reversal saga
  getInvoiceById()    — Direct DB read
  listInvoices()      — Paginated from write model

InvoiceQueryService (CQRS read side)
  getDashboardKPIs()  — From projection_dashboard_daily
```

### 2.4 Frontend Screens
List every screen/page built.

| Screen | Route | Permission | Status |
|---|---|---|---|
| Invoice List | /invoices | INVOICE_VIEW | ✅ Done |
| Invoice Create | /invoices/create | INVOICE_CREATE | ✅ Done |
| Invoice View | /invoices/:id | INVOICE_VIEW | ✅ Done |
| Invoice Edit | /invoices/:id/edit | INVOICE_UPDATE | ✅ Done |

### 2.5 Events Published
List every Kafka event this phase's code publishes.

| Event | Topic | Publisher | Consumers |
|---|---|---|---|
| INVOICE_CONFIRMED | erp.sales.invoice.confirmed | InvoiceService | InventoryService, AccountingService, NotificationService |
| INVOICE_CANCELLED | erp.sales.invoice.cancelled | InvoiceService | InventoryService, AccountingService |

### 2.6 Events Consumed
List every event this phase's code listens to.

| Event | Topic | Consumer | Action |
|---|---|---|---|
| PAYMENT_RECORDED | erp.sales.payment.recorded | InvoiceService | Update invoice paid_amount |

### 2.7 Background Jobs
List every scheduled job implemented.

| Job Name | Cron | What It Does | Status |
|---|---|---|---|
| reservation-expiry | */6 * * * * | Release expired stock reservations | ✅ Done |
| invoice-overdue-check | 0 8 * * * | Flag overdue invoices | ✅ Done |

### 2.8 Sagas Implemented
| Saga | Steps | Compensations | Status |
|---|---|---|---|
| INVOICE_CREATION | 8 steps | 6 compensatable, 2 irreversible | ✅ Done |

---

## 3. FOLDER STRUCTURE (ACTUAL)

```
apps/sales-service/
└── src/
    ├── domain/
    │   └── invoice/
    │       ├── Invoice.entity.ts
    │       ├── Invoice.service.ts
    │       ├── Invoice.saga.ts
    │       └── invoice.errors.ts
    ├── application/
    │   └── invoice/
    │       ├── createInvoice.handler.ts
    │       └── cancelInvoice.handler.ts
    ├── infrastructure/
    │   └── db/
    │       └── invoice.repository.impl.ts
    └── api/
        └── invoice/
            ├── invoice.routes.ts
            └── invoice.schemas.ts
```

---

## 4. PUBLIC INTERFACES (CONSUMED BY OTHER PHASES)

> **Other services and phases depend on these — never change without versioning.**

### 4.1 API Contracts (external)
```typescript
// POST /api/v2/invoices
// Request: CreateInvoiceRequest (from packages/shared-types/src/invoice.types.ts)
// Response: Invoice (from packages/shared-types/src/invoice.types.ts)
```

### 4.2 Events (external contracts)
```typescript
// INVOICE_CONFIRMED payload:
interface InvoiceConfirmedPayload {
  invoiceId: number;
  invoiceNumber: string;
  customerId: number;
  branchId: number;
  warehouseId: number;
  grandTotal: number;
  taxableAmount: number;
  gstAmount: number;
  lines: Array<{ itemId: number; variantId?: number; quantity: number; unitCost: number }>;
  paymentMode: string;
  paidAtConfirmation: number;
}
// Schema Version: 1
// Consumers: inventory-service, accounting-service, notification-service, gst-service
```

### 4.3 Shared Types Added
List any new types added to `packages/shared-types` that other packages now depend on.

---

## 5. INTEGRATION POINTS (WHAT THE NEXT PHASE MUST KNOW)

> Critical connections for the next phase to hook into.

### 5.1 What this phase provides to downstream phases
- `invoiceApi.getById(id)` returns invoice with lines and payment status
- `INVOICE_CONFIRMED` event carries all data needed for inventory deduction
- `INVOICE_CANCELLED` event triggers stock restoration

### 5.2 What this phase needs from upstream phases (already resolved)
- Customer data from Master Data phase (Phase 2) — resolved via FK
- Item data from Master Data phase — resolved via FK
- Warehouse data from Master Data phase — resolved via FK

### 5.3 What the NEXT phase must integrate with
- Phase 6 (Accounting): Must consume `INVOICE_CONFIRMED` and post double-entry
- Phase 7 (GST): Must consume `INVOICE_CONFIRMED` and record GST liability
- Phase 3 (Inventory) if not done: Must consume `INVOICE_CONFIRMED` to deduct stock

---

## 6. TESTS

### 6.1 Test Coverage
| Suite | Coverage | Status |
|---|---|---|
| Unit — InvoiceService | 94% | ✅ Pass |
| Integration — Invoice API | 100% endpoints | ✅ Pass |
| Concurrency — stock deduction | tested 100 concurrent | ✅ Pass |

### 6.2 Critical Tests Passing
- [ ] Stock cannot go negative under concurrent invoice creation
- [ ] GST computed correctly for all 4 scenarios (CGST+SGST, IGST, exempt, zero)
- [ ] Double-entry journals balance on every invoice
- [ ] Credit limit enforced correctly
- [ ] Duplicate invoice number rejected at DB constraint level
- [ ] Outbox event written in same transaction as invoice
- [ ] Inbox pattern prevents duplicate event processing

---

## 7. KNOWN ISSUES AND TECHNICAL DEBT

| Issue | Severity | Resolution Plan |
|---|---|---|
| [Description] | High/Medium/Low | [How to fix, in which phase] |

---

## 8. FEATURE FLAGS USED

| Flag | Default | Who Controls |
|---|---|---|
| `gst.e-invoice.enabled` | false | Admin per tenant |
| `sales.quotations.enabled` | true | Admin per tenant |

---

## 9. PERMISSIONS ADDED

List all new permission constants added to `packages/shared-types/src/permissions.ts`:

```typescript
INVOICE_VIEW, INVOICE_CREATE, INVOICE_UPDATE, INVOICE_CANCEL,
INVOICE_PRINT, INVOICE_EXPORT, INVOICE_APPROVE,
QUOTATION_VIEW, QUOTATION_CREATE, QUOTATION_UPDATE, QUOTATION_CANCEL, QUOTATION_CONVERT,
PAYMENT_IN_VIEW, PAYMENT_IN_CREATE, PAYMENT_IN_UPDATE, PAYMENT_IN_DELETE,
CREDIT_LIMIT_OVERRIDE, DISCOUNT_OVERRIDE, PRICE_OVERRIDE
```

---

## 10. ENVIRONMENT VARIABLES ADDED

```
RAZORPAY_KEY_ID=         (in Vault: erp/prod/razorpay)
RAZORPAY_KEY_SECRET=     (in Vault: erp/prod/razorpay)
MAX_INVOICE_AMOUNT=      (optional cap, default: none)
```

---

## 11. DEPLOYMENT NOTES

```
Docker image: sales-service:v[X.Y.Z]
New DB migrations: migrations/0015_invoice_tables.sql
Migration is backward-compatible: YES / NO (explain if NO)
Zero-downtime deploy: YES / NO
Rollback procedure: [describe]
```

---

## 12. WHAT IS NOT DONE (REMAINING TODO)

Be honest. List everything deferred.

| Item | Why Deferred | Target Phase |
|---|---|---|
| POS offline mode | Feature flag off, complex PWA work | Phase 4 extension |
| e-Invoice auto-retry | Low priority for MVP | Phase 7 |

---

## 13. ARCHITECTURE DECISIONS MADE IN THIS PHASE

List any decisions that future developers need to know about.

| Decision | Why | Alternatives Considered |
|---|---|---|
| Invoice PDF generated async (not blocking create) | Performance — PDF takes 800ms | Sync generation |
| Credit limit checked before stock deduction | Fail fast on business rule | Check after |

---

## 14. RISKS FOR NEXT PHASE

| Risk | Impact | Mitigation |
|---|---|---|
| GST API rate limits from NIC | IRN generation may be slow during peak | Queue with retry |

---

## 15. FINAL ARCHITECTURE SUMMARY

In 3–5 sentences, describe what was built in plain English so the next engineer (and next Claude session) can instantly understand the state of the system.

**Example:** "The Sales phase implements a complete invoice lifecycle from DRAFT to PAID with Saga orchestration. Stock is atomically deducted using a single UPDATE with a WHERE quantity >= requested clause. All state changes are audit-logged and written to the outbox in the same DB transaction. GST is computed automatically at line-item level. The POS interface supports barcode scanning and multiple payment modes but does not yet support offline operation."

---

*Generated by: Claude [model] | Date: [date] | Next Phase: Phase [N+1] — [Name]*
