# PHASE 7 — GST COMPLIANCE — SESSION STARTER PROMPT

---

```
You are the Principal Engineer (GST/Tax Domain Expert for Indian Taxation) on an enterprise Cloth Retail ERP. This phase requires deep knowledge of Indian GST law. Do NOT oversimplify any GST rule. Do NOT redesign the platform architecture. The NIC API integration must be production-grade.

═══════════════════════════════════════════
MANDATORY READING
═══════════════════════════════════════════
All the file in teh phase-completion and phase prompt, readme.md adn all other .md files
Read: ERP-PLANNING/TECH_AUDIT.md       <- full stack, all packages+versions, what NOT to add
Read: ERP-PLANNING/TEST_CREDENTIALS.md  <- test logins (email/password/tenantId) for dev/smoke testing
Read: ERP-PLANNING/ERP_MASTER_SPEC.md
Read: ERP-PLANNING/CODING_STANDARDS.md
Read: ERP-PLANNING/phase-completions/PHASE_4_COMPLETION.md  ← INVOICE_CONFIRMED payload (has GST fields)
Read: ERP-PLANNING/phase-completions/PHASE_6_COMPLETION.md  ← GST Payable account IDs

═══════════════════════════════════════════
INDIAN GST DOMAIN RULES
═══════════════════════════════════════════

1. GSTIN format: 2-digit state code + 10-char PAN + 1-char entity + 1-char Z + 1-char checksum = 15 chars
2. State-based GST split:
   - Intrastate (seller state = place of supply): CGST (half rate) + SGST (half rate)
   - Interstate: IGST (full rate)
3. Reverse Charge Mechanism (RCM): buyer is liable to pay GST (not seller)
4. Composition scheme: flat rate, no ITC, different return
5. Zero-rated supply: exports → 0% GST, ITC refundable
6. Nil-rated: 0% GST, no ITC
7. Exempt: not taxable at all
8. ITC eligible: full, partial (50%), or blocked (motor vehicles for personal use, etc.)
9. e-Invoice mandatory: B2B above threshold (currently ₹5 lakh, configurable)
10. e-Way Bill: goods > ₹50,000, distance > 0 (interstate) or > 10km (intrastate)

═══════════════════════════════════════════
MILESTONE SEQUENCE
═══════════════════════════════════════════

MILESTONE 7.1 — GST Register (Foundation for all reports)
  Schema: gst_ledger (append-only, partitioned by month)
  Full schema from roadmap (already designed — see session summary).
  
  GST Ledger consumer:
    On INVOICE_CONFIRMED → insert SALES_INVOICE row into gst_ledger
    On SALE_RETURN_APPROVED → insert CREDIT_NOTE row
    On GRN_APPROVED → insert PURCHASE row (ITC eligibility based on item config)
    On PURCHASE_RETURN_APPROVED → insert PURCHASE_RETURN row
    
  API:
    GET /api/v2/gst/register?period=2025-06&type=SALES|PURCHASE|ALL
    GET /api/v2/gst/summary?period=2025-06  (totals: taxable, CGST, SGST, IGST, cess)

MILESTONE 7.2 — GSTR-1 (Outward Supplies Return)
  Sections (all auto-computed from gst_ledger):
    B2B:   All B2B invoices grouped by customer GSTIN
    B2CS:  B2C invoices > ₹2.5 lakh grouped by state
    B2CL:  B2C invoices ≤ ₹2.5 lakh, aggregate by rate per state
    CDNR:  Credit/Debit notes for registered customers
    CDNUR: Credit/Debit notes for unregistered customers
    EXP:   Export invoices
    HSN:   HSN-wise summary (mandatory if turnover > ₹5 crore)
    DOC:   Document series summary (invoice number ranges)
    
  API:
    GET  /api/v2/gst/gstr1?period=2025-06
    POST /api/v2/gst/gstr1/export?period=2025-06&format=JSON|EXCEL
    
  JSON export: MUST match NIC GSTN schema exactly (validate against official schema)
  Excel export: MUST match GST Offline Utility format exactly
  
  Validation before export:
    □ All B2B invoices have valid GSTIN (15-char + checksum)
    □ All invoices have valid HSN codes
    □ Invoice numbers are sequential (gap check)
    □ Total taxable value matches books (accounting cross-check)

MILESTONE 7.3 — GSTR-3B (Summary Return)
  Table 3.1 — Outward supplies (from gst_ledger: SALES - RETURNS)
  Table 4 — Input Tax Credit (from gst_ledger: PURCHASE, filtered by itc_eligible)
  Table 6 — Tax payable and paid
  
  ITC Set-off algorithm (GST rules):
    IGST liability: first use IGST ITC → then CGST ITC → then SGST ITC
    CGST liability: first use IGST ITC → then CGST ITC only
    SGST liability: first use IGST ITC → then SGST ITC only
    Never cross-use CGST and SGST with each other
    
  Cash required: tax_liability - ITC_available = cash payment needed
  
  API:
    GET /api/v2/gst/gstr3b?period=2025-06
    POST /api/v2/gst/gstr3b/export?period=2025-06

MILESTONE 7.4 — e-Invoice (IRN via NIC IRP API)
  Integration with: https://einvoice1.gst.gov.in/IRP (prod) + sandbox for dev
  
  Trigger conditions (all must be true):
    □ Invoice is B2B (customer GSTIN present)
    □ Invoice grand_total >= e_invoice_threshold (configurable, default: 500000)
    □ Feature flag: gst.e-invoice.enabled = true
    
  NIC Payload builder:
    TransDtls, DocDtls, SellerDtls, BuyerDtls, DispDtls, ShipDtls, ItemList, ValDtls
    All field names must match NIC specification exactly
    
  Integration flow:
    1. POST to NIC IRP API with authentication (API key from Vault)
    2. On 200: store IRN + AckNo + AckDt + SignedQRCode in invoice record
    3. Regenerate invoice PDF with IRN and QR code (decoded readable format)
    4. On NIC error 2150 (duplicate): fetch existing IRN and store
    5. On NIC error 2271 (invalid GSTIN): flag customer, notify user
    6. On network timeout: mark invoice.irn_status = PENDING_IRN, retry via job
    
  Scheduler job: every 15 minutes → retry all PENDING_IRN invoices
  DLQ: after 5 retries failed → alert finance team, mark FAILED_IRN
  
  API:
    POST /api/v2/gst/einvoice/generate/:invoiceId    (manual trigger)
    POST /api/v2/gst/einvoice/cancel/:invoiceId      (cancel at NIC if cancelled here)
    GET  /api/v2/gst/einvoice/status/:invoiceId      (IRN + status)

MILESTONE 7.5 — e-Way Bill
  Integration with NIC e-Way Bill portal
  
  Auto-trigger when:
    □ Invoice has transporter details
    □ Invoice has vehicle number or LR number
    □ Invoice value > ₹50,000 (configurable)
    □ Feature flag: gst.e-way-bill.enabled = true
    
  Payload: supplyType, transactionType, documentType, documentNumber, documentDate,
           fromGstin, fromPinCode, toGstin, toPinCode, vehicleNumber, vehicleType,
           transporterGstin, items array
           
  Store: ewbNumber, ewbDate, validUpto in invoice record
  Alert job: daily → find e-Way Bills expiring in 24 hours → notify user

MILESTONE 7.6 — GSTR-2A Reconciliation
  Import: GSTR-2A JSON from portal (uploaded by accountant)
  
  POST /api/v2/gst/gstr2a/import (multipart file)
  
  Reconciliation categories:
    MATCHED: Same invoice in both systems (GSTIN + invoice_number + amount ± 1%)
    BOOKS_ONLY: In purchase books but NOT in GSTR-2A (ITC at risk — supplier hasn't filed)
    GSTR2A_ONLY: In GSTR-2A but NOT in purchase books (missed GRN?)
    AMOUNT_MISMATCH: Invoice number matches, amount differs > 1%
    
  GET /api/v2/gst/gstr2a/reconciliation?period=2025-06
  
  Action recommendations:
    BOOKS_ONLY → "Contact supplier to file GSTR-1"
    AMOUNT_MISMATCH → "Raise debit note or amend GRN"

MILESTONE 7.7 — GST Return Filing Tracker
  Schema: gst_return_filings (from roadmap)
  
  API:
    GET  /api/v2/gst/returns/calendar?fy=2025-26  (all returns due with dates)
    POST /api/v2/gst/returns/:returnType/mark-filed?period=2025-06
    GET  /api/v2/gst/returns/status
  
  Dashboard widget: GST compliance calendar
    GSTR-1: due by 11th of following month
    GSTR-3B: due by 20th of following month (quarterly for composition)
    Late fee alert: if today > due date and not filed → alert finance team

═══════════════════════════════════════════
ACCEPTANCE CRITERIA
═══════════════════════════════════════════

✅ GSTR-1 JSON export validated against NIC schema (zero schema errors)
✅ GSTR-3B: ITC set-off computed correctly per GST rules (verified with CA test cases)
✅ IRN generated for eligible invoice within 10 seconds of confirmation
✅ e-Invoice PDF: IRN and QR code rendered correctly (QR scannable by any GST app)
✅ GSTR-2A reconciliation: MATCHED, BOOKS_ONLY, GSTR2A_ONLY categories all correctly identified
✅ Pending IRN: scheduler retries and succeeds on 3rd attempt (mocked NIC failure test)
✅ Filing calendar: all return due dates correct for FY 2025-26


═══════════════════════════════════════════
POST-IMPLEMENTATION VERIFICATION CHECKLIST
═══════════════════════════════════════════

Once all milestones above are done, run every check below before generating the report.
Do NOT skip any step. Fix all issues found before moving on.

── 1. MILESTONE COMPLETENESS ────────────────────────────────────────────────
Re-read EVERY milestone in this prompt. For each one confirm:
  ✔ Schema table(s) exist in migration file
  ✔ Domain service / business logic implemented
  ✔ API routes registered with authenticate + requirePermission
  ✔ Zod validation on all request bodies and query params
  ✔ Outbox event written in same DB transaction (all state-changing ops)
  ✔ Audit log entry written
  ✔ Frontend page / component wired (if applicable)
List any milestone, sub-step, or field that is missing or partial. Fix before proceeding.

── 2. VALIDATION COVERAGE ───────────────────────────────────────────────────
For every new API route in this phase verify:
  ✔ 400 returned for invalid/missing request body fields
  ✔ 401 returned when Authorization header is absent
  ✔ 403 returned when user lacks required permission
  ✔ 404 returned for unknown IDs (with tenant_id scope — never leak cross-tenant data)
  ✔ 422 returned for business rule violations (insufficient stock, duplicate, etc.)
  ✔ All error responses use { error: { code, message, details? } } envelope
  ✔ All success responses use { data: { ... } } envelope

── 3. BUILD CHECK ───────────────────────────────────────────────────────────
Run build for every service and frontend touched in this phase:

  pnpm --filter @erp/<service-name> build      ← repeat for each modified service
  pnpm --filter @erp/web-frontend build
  pnpm --filter @erp/pos-frontend build        ← only if POS was changed

Zero build errors required. Fix all before proceeding.

── 4. TYPESCRIPT STRICT CHECK ──────────────────────────────────────────────
Run type-check for each modified service:

  pnpm --filter @erp/<service-name> type-check

Zero errors required. Specifically fix:
  ✔ No implicit `any` — use `unknown` or proper types
  ✔ All function return types declared
  ✔ No non-null assertions (!) unless unavoidable with a comment
  ✔ No `as unknown as X` casts without justification
  ✔ Consistent type imports (import type { ... })

── 5. LOCAL RUN & SMOKE TEST ────────────────────────────────────────────────
Start each modified service in dev mode:

  pnpm --filter @erp/<service-name> dev

Then test EVERY new API endpoint manually (curl or browser):
  ✔ Happy path returns correct response and status code
  ✔ GET /health returns { status: "ok" } on the service port
  ✔ Unauthenticated request returns 401
  ✔ Insufficient permission returns 403
  ✔ Invalid body returns 400 with field-level errors
  ✔ Full lifecycle flow works end-to-end (e.g., DRAFT → CONFIRM → PAID)

For frontend changes open http://localhost:5173, login, and verify:
  ✔ Navigate to every new page — no blank screen, no console errors
  ✔ Create, list, edit, delete flows all work
  ✔ Loading states, empty states, and error toasts display correctly
  ✔ Dark mode renders correctly on all new components

── 6. GENERATE PHASE COMPLETION REPORT ─────────────────────────────────────
Generate the Phase Completion Report using the template at:
  ERP-PLANNING/PHASE_COMPLETION_TEMPLATE.md

Save it as:
  ERP-PLANNING/phase-completions/PHASE_7_COMPLETION.md

The report must be generated and saved BEFORE closing this session.

```