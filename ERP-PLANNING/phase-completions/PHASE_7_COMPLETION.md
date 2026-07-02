# Phase 7 — Indian GST Module: Completion Report

**Status:** COMPLETE  
**Completed:** 2026-06-30  
**Services Modified:** `@erp/gst-service`, `@erp/web-frontend`, `@erp/scheduler-service`, `@erp/db`

---

## Milestones Implemented

### M7.1 — GST Ledger (Append-Only Register)
- **Schema**: `gst_ledger` table in `packages/db-client/src/schema/gst.ts`
  - `sourceEventId` varchar(100) — Kafka idempotency key (prevents duplicate processing)
  - `entryType`: SALES_INVOICE | CREDIT_NOTE | PURCHASE | PURCHASE_RETURN
  - Full GST amounts: cgst, sgst, igst, cess, totalGst, taxableAmount, grandTotal
  - `itcEligible` boolean, `rcmApplicable` boolean
- **Domain**: `apps/gst-service/src/domain/GstLedgerService.ts`
  - `validateGstin()`: 15-char regex validation per GST Act
  - `insertEntry()`: idempotency-safe INSERT (checks sourceEventId before insert)
  - `getRegister()`: filtered by period + entry type
  - `getSummary()`: SQL SUM aggregation per period
- **API**: `GET /api/v2/gst/register?period=YYYY-MM&type=ALL|SALES|PURCHASE`
- **API**: `GET /api/v2/gst/summary?period=YYYY-MM`
- **Frontend**: `GstRegisterPage` — tabular ledger with summary cards, CSV export
- **Migration**: `packages/db-client/migrations/0003_phase7_gst.sql`

### M7.2 — GSTR-1 (Outward Supplies Return)
- **Domain**: `apps/gst-service/src/domain/Gstr1Service.ts`
  - `B2CS_THRESHOLD = 250000` (₹2.5L per GST rules)
  - B2B: GSTIN-registered buyers (15-char GSTIN)
  - B2CS: Unregistered buyers ≤₹2.5L per invoice (grouped by state+rate for GSTR-1)
  - B2CL: Unregistered buyers >₹2.5L (listed per invoice)
  - CDNR/CDNUR: Credit notes (registered/unregistered)
  - EXP: Exports (placeOfSupply = '96')
  - HSN summary: aggregate by HSN code
  - `toNicJson()`: NIC GSTN portal JSON format (`fp` = MMYYYY)
  - `validateBeforeExport()`: validates all B2B GSTINs + duplicate invoice check
- **API**: `GET /api/v2/gst/gstr1?period=YYYY-MM`
- **API**: `POST /api/v2/gst/gstr1/export?period=YYYY-MM&format=JSON|EXCEL`
- **Frontend**: `Gstr1Page` — collapsible sections (B2B, B2CS, CDNR, HSN), export to NIC JSON

### M7.3 — GSTR-3B (Monthly Summary Return)
- **Domain**: `apps/gst-service/src/domain/Gstr3bService.ts`
  - Table 3.1: Outward supplies (net of credit notes) — IGST/CGST/SGST/Cess breakdown
  - Table 4: ITC available vs reversed
  - **ITC Set-off Algorithm** (7-step, strictly per GST Act §49):
    1. IGST liability ← IGST ITC
    2. IGST liability ← CGST ITC (if IGST ITC exhausted)
    3. IGST liability ← SGST ITC (if still remaining)
    4. CGST liability ← remaining IGST ITC
    5. CGST liability ← CGST ITC **[NEVER SGST — enforced]**
    6. SGST liability ← remaining IGST ITC
    7. SGST liability ← SGST ITC **[NEVER CGST — enforced]**
  - Returns cash required per tax head
- **API**: `GET /api/v2/gst/gstr3b?period=YYYY-MM`
- **API**: `POST /api/v2/gst/gstr3b/export?period=YYYY-MM`
- **Frontend**: `Gstr3bPage` — collapsible Table 3.1 / Table 4 / ITC set-off breakdown, export

### M7.4 — e-Invoice (NIC IRP Integration)
- **Schema**: `einvoice_data` table (separate from `invoices` — no cross-service schema pollution)
  - `irnStatus`: PENDING_IRN | IRN_GENERATED | IRN_CANCELLED | FAILED_IRN | NOT_APPLICABLE
  - `irn` (varchar 64), `ackNo`, `ackDate`, `signedQrCode`, `signedInvoice`
  - `retryCount` (int), `lastRetryAt`, `nicRequestPayload` / `nicResponsePayload` (jsonb)
- **Domain**: `apps/gst-service/src/domain/EInvoiceService.ts`
  - Sandbox: `https://einv-apisandbox.nic.in` (dev), prod from `NIC_IRP_URL` env
  - `generateIrn()`: POST with 15s AbortSignal timeout
    - Error 2150 (duplicate) → `fetchExistingIrn()` graceful recovery
    - Error 2271 (invalid GSTIN) → marks FAILED_IRN, throws BusinessError
    - Network timeout → marks PENDING_IRN via `markPendingForRetry()` (retryCount+1)
  - `cancelIrn()`: POST to NIC cancel endpoint, marks IRN_CANCELLED
  - `getStatus()`: returns full IRN status including EWB data
  - `retryPendingIrns()`: system-level batch retry, MAX_RETRIES=5
- **API**: `POST /api/v2/gst/einvoice/generate/:invoiceId`
- **API**: `POST /api/v2/gst/einvoice/cancel/:invoiceId`
- **API**: `GET /api/v2/gst/einvoice/status/:invoiceId`
- **API**: `POST /api/v2/gst/einvoice/retry-pending` (internal scheduler endpoint)
- **Frontend**: `EInvoicePage` — status lookup, reference card, status legend

### M7.5 — e-Way Bill
- **Domain**: `apps/gst-service/src/domain/EwayBillService.ts`
  - `EWB_VALUE_THRESHOLD = 50000` (₹50K threshold per GST rules)
  - `generate()`: POST to NIC e-Way Bill API, stores `ewbNumber`/`ewbDate`/`ewbValidUpto` in `einvoice_data`
  - `getExpiringSoon()`: queries where `ewbValidUpto ≤ now + 24h` for daily scheduler
- **API**: `POST /api/v2/gst/eway-bill/generate`
- **API**: `GET /api/v2/gst/eway-bill/expiring-soon`
- **Scheduler**: Daily job at 08:00 alerts when EWBs expire within 24h

### M7.6 — GSTR-2A Reconciliation
- **Schema**: `gst_2a_entries` table
  - `reconciliationStatus`: MATCHED | BOOKS_ONLY | GSTR2A_ONLY | AMOUNT_MISMATCH | UNMATCHED
  - `matchedLedgerId` (FK to gst_ledger), `matchVariance`, `importBatchId`
- **Domain**: `apps/gst-service/src/domain/Gstr2aService.ts`
  - `MATCH_TOLERANCE_PCT = 0.01` (±1% per GST reconciliation norms)
  - `importGstr2a()`: INSERT with batchId, deduplicates by (tenantId+period+supplierGstin+invoiceNumber)
  - `reconcile()`: supplier GSTIN + normalizedInvoiceNumber matching
    - Within tolerance → MATCHED
    - Outside tolerance → AMOUNT_MISMATCH
    - No 2A match → BOOKS_ONLY
    - No books match → GSTR2A_ONLY
  - `normalizeInvoiceNumber()`: `.trim().toUpperCase().replace(/\s+/g, '')`
- **API**: `POST /api/v2/gst/gstr2a/import` — accepts JSON array
- **API**: `GET /api/v2/gst/gstr2a/reconciliation?period=YYYY-MM`
- **Frontend**: `Gstr2aPage` — JSON file import, tabbed GSTR-2A / Books-Only view, action guidance

### M7.7 — Return Filing Tracker
- **Schema**: `gst_return_filings` table
  - `returnType`: GSTR1 | GSTR3B | GSTR9 | GSTR9C
  - `status`: PENDING | FILED | LATE_FILED
  - `dueDate`, `filedAt`, `referenceNumber` (ARN)
  - Unique constraint on (tenantId, returnType, period)
- **Domain**: `apps/gst-service/src/domain/GstReturnTrackerService.ts`
  - `getCalendar()`: generates 12 periods per FY (Apr–Mar), upserts via `onConflictDoNothing()`
  - `getDueDate()`: GSTR1 → 11th of following month; GSTR3B → 20th of following month
  - `markFiled()`: FILED if on-time, LATE_FILED if past dueDate
  - `getStatus()`: pending count, overdue count, filed this month, next due
- **API**: `GET /api/v2/gst/returns/calendar?fy=YYYY-YY`
- **API**: `POST /api/v2/gst/returns/:returnType/mark-filed`
- **API**: `GET /api/v2/gst/returns/status`
- **Frontend**: `GstCompliancePage` — dual-column calendar (GSTR1/GSTR3B), modal to mark filed, EWB expiry alerts

---

## Event Consumers Implemented

| Consumer File | Event | GST Ledger Entry |
|---|---|---|
| `InvoiceGstConsumer.ts` | `INVOICE_CONFIRMED` | SALES_INVOICE row |
| `SaleReturnGstConsumer.ts` | `SALE_RETURN_APPROVED` | CREDIT_NOTE row |
| `GRNGstConsumer.ts` | `GRN_APPROVED` | PURCHASE row (itcEligible flag) |
| `GRNGstConsumer.ts` | `PURCHASE_RETURN_APPROVED` | PURCHASE_RETURN row |

**Kafka topics subscribed:** `erp.invoice.confirmed`, `erp.sale.return.approved`, `erp.grn.approved`, `erp.purchase.return.approved`

---

## Scheduler Jobs

| Job ID | Schedule | Purpose |
|---|---|---|
| `gst.e-invoice-retry` | `*/15 * * * *` | Retry PENDING_IRN across all tenants |
| `gst.eway-bill-expiry-alert` | `0 8 * * *` | Alert when EWBs expire within 24h |

---

## Frontend Routes Added

| Route | Page | Permission |
|---|---|---|
| `/gst/register` | GstRegisterPage | GST_VIEW |
| `/gst/gstr1` | Gstr1Page | GSTR1_VIEW |
| `/gst/gstr3b` | Gstr3bPage | GSTR3B_VIEW |
| `/gst/einvoice` | EInvoicePage | GST_VIEW |
| `/gst/gstr2a` | Gstr2aPage | GSTR2A_RECONCILE |
| `/gst/compliance` | GstCompliancePage | GST_VIEW |

Navigation updated: `Layout.tsx` GST group now has 7 sub-items (Config + 6 new Phase 7 pages).

---

## Indian GST Law Compliance

- **GSTIN validation**: `^\d{2}[A-Z]{5}\d{4}[A-Z]{1}[A-Z\d]{1}[Z]{1}[A-Z\d]{1}$` (15 chars)
- **Interstate detection**: `sellerStateCode !== placeOfSupply` → IGST; else CGST+SGST
- **B2B threshold**: All GSTIN-registered buyers regardless of amount
- **B2CS threshold**: ₹2,50,000 — intrastate unregistered buyers ≤ threshold aggregated
- **B2CL threshold**: ₹2,50,000 — unregistered buyers > threshold listed per invoice
- **e-Invoice threshold**: ₹5,00,000 total invoice value (enforced by caller)
- **e-Way Bill threshold**: ₹50,000 goods value
- **ITC set-off**: IGST→IGST ITC→CGST ITC→SGST ITC; CGST→IGST remaining→CGST only; SGST→IGST remaining→SGST only. Cross-CGST/SGST forbidden (§49 GST Act)
- **GSTR-2A tolerance**: ±1% for amount matching

---

## Files Created / Modified

### New Files
- `packages/db-client/src/schema/gst.ts` — extended with 4 new tables
- `packages/db-client/migrations/0003_phase7_gst.sql` — SQL migration
- `apps/gst-service/src/domain/GstLedgerService.ts`
- `apps/gst-service/src/domain/Gstr1Service.ts`
- `apps/gst-service/src/domain/Gstr3bService.ts`
- `apps/gst-service/src/domain/EInvoiceService.ts`
- `apps/gst-service/src/domain/EwayBillService.ts`
- `apps/gst-service/src/domain/Gstr2aService.ts`
- `apps/gst-service/src/domain/GstReturnTrackerService.ts`
- `apps/gst-service/src/consumers/InvoiceGstConsumer.ts`
- `apps/gst-service/src/consumers/SaleReturnGstConsumer.ts`
- `apps/gst-service/src/consumers/GRNGstConsumer.ts`
- `apps/gst-service/src/api/gst-register.routes.ts`
- `apps/gst-service/src/api/gstr1.routes.ts`
- `apps/gst-service/src/api/gstr3b.routes.ts`
- `apps/gst-service/src/api/einvoice.routes.ts`
- `apps/gst-service/src/api/eway-bill.routes.ts`
- `apps/gst-service/src/api/gstr2a.routes.ts`
- `apps/gst-service/src/api/gst-returns.routes.ts`
- `apps/web-frontend/src/pages/gst/GstRegisterPage.tsx`
- `apps/web-frontend/src/pages/gst/Gstr1Page.tsx`
- `apps/web-frontend/src/pages/gst/Gstr3bPage.tsx`
- `apps/web-frontend/src/pages/gst/EInvoicePage.tsx`
- `apps/web-frontend/src/pages/gst/Gstr2aPage.tsx`
- `apps/web-frontend/src/pages/gst/GstCompliancePage.tsx`

### Modified Files
- `apps/gst-service/src/main.ts` — Kafka consumers + 7 new route modules
- `apps/gst-service/package.json` — added kafkajs ^2.2.4, ulid ^2.3.0
- `apps/web-frontend/src/App.tsx` — 6 new GST routes
- `apps/web-frontend/src/components/Layout.tsx` — GST nav group with 7 items
- `apps/web-frontend/src/api/endpoints.ts` — gstApi extended with 15 new methods
- `apps/web-frontend/src/constants/permissions.ts` — Phase 7 GST permissions added
- `apps/scheduler-service/src/jobs/system-jobs.ts` — 2 new GST jobs + updated e-Invoice retry

---

## Type-Check Status

- `@erp/gst-service`: ✅ PASS (0 errors)
- `@erp/web-frontend`: ✅ PASS (0 errors)
- `@erp/db`: ✅ PASS (rebuilt with new GST tables)

---

## Next Phase

Phase 7 is COMPLETE. Frontend pages are fully connected to API endpoints.  
Next steps: Phase 8 (HR/Payroll) or Phase 9 (Reports & Analytics) as per ERP implementation plan.
