# ES-11 — NIC E-Invoice & E-Way Bill Integration
## STATUS: 🔴 PENDING
## Sprint: 3 | Effort: 5–7 days | Risk: High
## Depends on: ES-10 (correct GST calculation)
## Unlocks: ES-17

---

## YOUR ROLE

You are the **Principal Backend + Integration Engineer** on the NEXORAA Multi-Tenant Cloth Retail ERP.
Your mission: integrate with NIC (National Informatics Centre) IRP APIs to generate IRN (Invoice Reference Numbers) for e-invoices and generate E-Way Bills for consignments above ₹50,000.

> ⚠️ **IMPORTANT:** The EInvoicePage currently shows a STUB warning banner (added in ES-01). When this phase is complete, remove that banner from `EInvoicePage.tsx`.

---

## ═══════════════════════════════════════════
## PRE-FLIGHT CHECKLIST
## ═══════════════════════════════════════════

- [ ] Read `ERP-PLANNING/TECH_AUDIT.md`
- [ ] Read `ERP-PLANNING/CODING_STANDARDS.md`
- [ ] Read `ERP-PLANNING/phase-completions/ES-01_COMPLETION.md` — note STUB banner details
- [ ] Read `ERP-PLANNING/phase-completions/ES-10_COMPLETION.md` — verify GST calculation is correct
- [ ] Read `apps/gst-service/src/` — all existing GST service code
- [ ] Read `apps/web-frontend/src/pages/gst/EInvoicePage.tsx` — find the STUB banner
- [ ] Check `.env.example` for NIC API credential placeholders
- [ ] Check if any e-invoice HTTP client exists in `packages/platform-sdk/src/`
- [ ] Check if `invoices` table has `irn`, `ack_no`, `ack_date`, `qr_code` columns
- [ ] Read NIC Sandbox API docs (provided in environment or from `docs/` folder)
- [ ] Run `pnpm build` and `pnpm test` — confirm clean baseline

---

## ═══════════════════════════════════════════
## COMPLETED PHASES
## ═══════════════════════════════════════════

| Phase | Status | Key Changes Relevant to You |
|-------|--------|----------------------------|
| ES-01 ✅ | Security | EInvoicePage has STUB banner (remove when live) |
| ES-08 ✅ | Sales | Invoice confirmation workflow complete |
| ES-10 ✅ | GST | Correct CGST/SGST/IGST/Cess values in invoices |

---

## ═══════════════════════════════════════════
## PROJECT CONTEXT
## ═══════════════════════════════════════════

### Tech Stack
Node.js 20 + TypeScript 5 strict | Fastify 4 | PostgreSQL 16 + Drizzle ORM | React 18 + Vite 5 + Tailwind v4 | Vitest

### Multi-Tenant Rules
- Every Drizzle query: `.where(eq(table.tenantId, ctx.tenantId))`
- Tenant ID: ALWAYS from `request.auth.tenantId`
- Each tenant has their own GSTIN and NIC API credentials

### Money Rules
- All amounts: integers in paise
- NIC API accepts amounts in RUPEES with 2 decimal places — convert: `(paise / 100).toFixed(2)`

### NIC IRP API Domain Knowledge
```
Base URLs:
  Sandbox: https://einv-apisandbox.nic.in
  Production: https://einvoice1.gst.gov.in (confirm current URL)

E-Invoice Flow:
1. Generate JWT session token: POST /eivital/v1.03/dec/authenticate
2. Generate IRN: POST /eicore/v1.03/Invoice  (signed with GSTIN credentials)
3. Response: { "IRN": "...", "AckNo": "...", "AckDt": "...", "SignedQRCode": "..." }
4. Cancel IRN: POST /eicore/v1.03/Invoice/Cancel (within 24 hours of generation)

E-Way Bill:
1. Generate EWB: POST /ewaybillapi/v1.03/ewayapi?action=GENEWAYBILL
2. Applicable when: consignment value > ₹50,000 AND transported > 0 km
3. Response: { "ewbNo": "...", "ewbDt": "...", "validUpto": "..." }
4. Extension: PATCH /ewaybillapi/v1.03/ewayapi?action=UPDATEVEHICLEEWB

Applicability:
- E-invoice mandatory for turnover > ₹5 crore (tenant-level config)
- E-Way Bill: goods value > ₹50,000 in single consignment
```

### Key E-Invoice JSON Fields
```json
{
  "Version": "1.1",
  "TranDtls": { "TaxSch": "GST", "SupTyp": "B2B", "RegRev": "N", "EcmGstin": null },
  "DocDtls": { "Typ": "INV", "No": "INV-2026-001", "Dt": "01/07/2026" },
  "SellerDtls": { "Gstin": "...", "LglNm": "...", "Addr1": "...", "Loc": "...", "Pin": ..., "Stcd": "27" },
  "BuyerDtls": { "Gstin": "...", "LglNm": "...", "Pos": "27", "Addr1": "...", "Stcd": "27" },
  "ItemList": [{ "SlNo": "1", "PrdDesc": "...", "IsServc": "N", "HsnCd": "5208", "UQC": "MTR", "Qty": 100.00, "UnitPrice": 500.00, "TotAmt": 50000.00, "Cgst": 2500.00, "Sgst": 2500.00, "Igst": 0.00, "TotItemVal": 55000.00 }],
  "ValDtls": { "AssVal": 50000.00, "CgstVal": 2500.00, "SgstVal": 2500.00, "IgstVal": 0.00, "TotInvVal": 55000.00 }
}
```

### Auth Pattern
```typescript
fastify.post('/gst/invoices/:id/generate-irn', {
  preHandler: [authenticate, requirePermission(PERMISSIONS.EINVOICE_GENERATE)],
}, handler)
```

### Coding Standards
- TypeScript strict — no `any`
- No `console.log` — use `packages/logger`
- NIC API credentials: from env vars — NEVER hardcode
- Retry: 3 attempts with exponential backoff for NIC API calls
- `/* global process */` at top of files using `process.env`

---

## ═══════════════════════════════════════════
## OBJECTIVE
## ═══════════════════════════════════════════

1. Build NIC IRP HTTP client with authentication, retry, and error handling
2. Generate IRN on invoice confirmation (async, via outbox + Kafka)
3. Cancel IRN on invoice cancellation (within 24h window)
4. Generate E-Way Bill for consignments above ₹50,000
5. Remove STUB banner from EInvoicePage (replaced with real status)
6. Store IRN, AckNo, SignedQRCode, EWB number in the database

---

## ═══════════════════════════════════════════
## SCOPE
## ═══════════════════════════════════════════

### IN SCOPE

**Step 1 — Schema additions**

`packages/db-client/src/schema/gst.ts`:
Add columns to `invoices` (or a new `invoice_gst_details` table):
```sql
irn VARCHAR(64),
ack_no VARCHAR(20),
ack_date TIMESTAMPTZ,
signed_qr_code TEXT,
irn_status VARCHAR(20) DEFAULT 'PENDING',  -- PENDING | GENERATED | CANCELLED | NOT_APPLICABLE
ewb_number VARCHAR(20),
ewb_valid_upto TIMESTAMPTZ,
```
Migration: `000X_es11_einvoice_columns.sql`

**Step 2 — NIC API Client**

`packages/platform-sdk/src/nicClient.ts` (new file):
```typescript
export class NICClient {
  async authenticate(gstin: string, username: string, password: string): Promise<string>
  async generateIRN(sessionToken: string, invoiceJson: NICInvoicePayload): Promise<IRNResponse>
  async cancelIRN(sessionToken: string, irn: string, reason: NICCancelReason): Promise<void>
  async generateEWB(sessionToken: string, payload: EWBPayload): Promise<EWBResponse>
}
```
- All methods: retry 3× with 1s / 2s / 4s exponential backoff
- Log all NIC API calls (request + response truncated) via `packages/logger`
- Never log GSTIN credentials
- Base URL from: `process.env['NIC_BASE_URL']` (default: sandbox URL)

**Step 3 — IRN generation flow (async via Kafka)**

Trigger: after `INVOICE_CONFIRMED` event (from ES-08 outbox).

`apps/gst-service/src/consumers/einvoice.consumer.ts` (create):
- Listens to `INVOICE_CONFIRMED` Kafka topic
- Check inbox deduplication (`inbox_events`)
- Load invoice from DB
- Build NIC JSON payload from invoice data
- Call NICClient → get IRN + AckNo + QRCode
- Update `invoices.irn`, `invoices.ack_no`, `invoices.signed_qr_code`, `invoices.irn_status = 'GENERATED'`
- If NIC returns error: set `irn_status = 'FAILED'`; write to dead letter queue
- Emit `IRN_GENERATED` event to outbox

Route (manual trigger for retries): `POST /api/v1/gst/invoices/:id/generate-irn`

**Step 4 — IRN cancellation flow**

`apps/gst-service/src/consumers/einvoice-cancel.consumer.ts` (create):
- Listens to `INVOICE_CANCELLED` Kafka event
- If `irn_status = 'GENERATED'` AND invoice was confirmed within last 24h:
  - Call NICClient.cancelIRN with appropriate reason code
  - Update `irn_status = 'CANCELLED'`
- If > 24h: log warning — manual cancellation required via portal; set `irn_status = 'CANCEL_REQUIRED_MANUALLY'`

**Step 5 — E-Way Bill generation**

`apps/gst-service/src/domain/EWayBillService.ts` (create):

`generateEWB(invoiceId, transportDetails, ctx)`:
- Only if `invoice.total_amount > 5000000` (₹50,000 in paise)
- Build EWB payload from invoice + transport details
- Call NICClient.generateEWB
- Store `ewb_number`, `ewb_valid_upto` on invoice record

Route: `POST /api/v1/gst/invoices/:id/generate-ewb`
Guard: `authenticate` + `requirePermission(PERMISSIONS.EWAYB_GENERATE)`

**Step 6 — EInvoicePage (replace STUB)**

`apps/web-frontend/src/pages/gst/EInvoicePage.tsx`:
- REMOVE the STUB warning banner (the `sessionStorage` banner from ES-01)
- Add a real status column to the invoice list: IRN Generated / Pending / Failed / Not Applicable
- Add "Generate IRN" button (manual retry for failed ones)
- Show QR code (small) for invoices with IRN
- Add E-Way Bill status column and "Generate EWB" button

**Add to `.env.example`:**
```
NIC_BASE_URL=https://einv-apisandbox.nic.in
NIC_USERNAME=
NIC_PASSWORD=
NIC_GSTIN=
NIC_APP_KEY=
```

### OUT OF SCOPE
- GSTR-1 data push to GSTN portal (requires separate GSTN API)
- PDF printing of e-invoice (ES-20)
- Multi-GSTIN tenants (complex scenario — single GSTIN per tenant for now)

---

## ═══════════════════════════════════════════
## TESTING REQUIREMENTS
## ═══════════════════════════════════════════

Use NIC sandbox for integration testing.

`apps/gst-service/src/__tests__/nicClient.test.ts`:
1. (Unit) `buildNICPayload(invoice)` returns correct JSON structure — all amounts in rupees
2. (Unit) Intra-state invoice → `CgstVal + SgstVal` present; `IgstVal = 0`
3. (Unit) Inter-state invoice → `IgstVal` present; `CgstVal = SgstVal = 0`
4. (Integration) NIC sandbox authenticate → returns session token
5. (Integration) NIC sandbox generate IRN → returns `IRN`, `AckNo`, `SignedQRCode`
6. (Unit) NIC API returns 429 → client retries up to 3×
7. (Unit) NIC API returns 500 → fails after 3 retries; `irn_status = 'FAILED'`

`apps/gst-service/src/__tests__/ewb.test.ts`:
8. Invoice total < ₹50,000 → EWB generation throws `EWB_NOT_REQUIRED`
9. Invoice total > ₹50,000 → EWB number stored on invoice

---

## ═══════════════════════════════════════════
## BUILD VERIFICATION
## ═══════════════════════════════════════════

```bash
pnpm --filter @erp/platform-sdk build
pnpm --filter @erp/gst-service build
pnpm --filter @erp/gst-service type-check
pnpm --filter @erp/web-frontend build
pnpm lint
pnpm test --filter @erp/gst-service
```

---

## ═══════════════════════════════════════════
## VERIFICATION CHECKLIST
## ═══════════════════════════════════════════

- [ ] NIC sandbox returns IRN for test invoice JSON
- [ ] IRN stored in `invoices.irn` after Kafka consumer processes `INVOICE_CONFIRMED`
- [ ] `EInvoicePage.tsx` shows real IRN status — STUB banner is REMOVED
- [ ] "Generate IRN" button manually triggers for failed invoices
- [ ] Invoice cancellation triggers IRN cancellation flow
- [ ] E-Way Bill generated for invoices above ₹50,000
- [ ] All 9 tests pass
- [ ] `.env.example` has NIC credential placeholders
- [ ] `pnpm lint` passes

---

## ═══════════════════════════════════════════
## REGRESSION CHECKLIST
## ═══════════════════════════════════════════

- [ ] Invoice confirmation still works (no regression from async IRN consumer)
- [ ] Existing GST pages (GSTR-9, etc.) still load
- [ ] STUB banner is gone from EInvoicePage (that was the intended removal)

---

## ═══════════════════════════════════════════
## DEFINITION OF DONE
## ═══════════════════════════════════════════

- [ ] NIC IRP client implemented with retry
- [ ] IRN generated via async Kafka consumer
- [ ] E-Way Bill service implemented
- [ ] STUB banner removed from EInvoicePage
- [ ] IRN/EWB stored in DB
- [ ] 9 tests pass
- [ ] Completion report saved at `ERP-PLANNING/phase-completions/ES-11_COMPLETION.md`

---

## ═══════════════════════════════════════════
## COMPLETION REPORT TEMPLATE
## ═══════════════════════════════════════════

**Save as:** `ERP-PLANNING/phase-completions/ES-11_COMPLETION.md`

```markdown
# ES-11 Completion Report — NIC E-Invoice & E-Way Bill
**Date:** [YYYY-MM-DD]
**Status:** COMPLETE

## NIC Integration
- NIC Base URL used: [SANDBOX / PRODUCTION]
- IRN generation: [WORKING / PARTIAL / FAILED — explain]
- EWB generation: [WORKING / PARTIAL / FAILED — explain]

## STUB Banner
- Removed from EInvoicePage.tsx: [YES/NO]

## Files Changed
| File | Change |
|------|--------|
| packages/platform-sdk/src/nicClient.ts | NEW |
| apps/gst-service/src/consumers/einvoice.consumer.ts | NEW |
| apps/gst-service/src/consumers/einvoice-cancel.consumer.ts | NEW |
| apps/gst-service/src/domain/EWayBillService.ts | NEW |
| apps/web-frontend/src/pages/gst/EInvoicePage.tsx | STUB removed; real status added |
| packages/db-client/migrations/000X_es11_einvoice_columns.sql | NEW |

## Known Limitations
[Any NIC API issues, workarounds, or pending items]

## Tests: 9/9 PASS | lint: PASS | build: PASS
```
