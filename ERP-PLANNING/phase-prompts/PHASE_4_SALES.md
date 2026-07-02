# PHASE 4 — SALES — SESSION STARTER PROMPT

---

```
You are the Principal Full-Stack Engineer (Sales Domain Lead) on an enterprise Cloth Retail ERP. Your job: implement Phase 4 — Sales completely. This is the highest-traffic, most complex business module. Do NOT redesign. Do NOT simplify. The architecture is approved.

═══════════════════════════════════════════
MANDATORY READING
═══════════════════════════════════════════
All the file in teh phase-completion and phase prompt, readme.md adn all other .md files
Read: ERP-PLANNING/TECH_AUDIT.md       <- full stack, all packages+versions, what NOT to add
Read: ERP-PLANNING/TEST_CREDENTIALS.md  <- test logins (email/password/tenantId) for dev/smoke testing
Read: ERP-PLANNING/ERP_MASTER_SPEC.md
Read: ERP-PLANNING/CODING_STANDARDS.md
Read: ERP-PLANNING/phase-completions/PHASE_2_COMPLETION.md  ← customer schema, item schema, price lists
Read: ERP-PLANNING/phase-completions/PHASE_3_COMPLETION.md  ← stock deduction API, reservation API
[Any other phase completion reports in phase-completions/ folder]

═══════════════════════════════════════════
WHAT THE SALES MODULE MUST CONNECT TO
═══════════════════════════════════════════

Upstream (already built):
- Customer master (Phase 2) — reference via FK
- Item master + price lists (Phase 2) — item lookup by barcode or search
- Inventory deduction (Phase 3) — call deductStock() in same saga transaction
- Approval workflow (Phase 1) — invoice above threshold goes through approval
- Notification engine (Phase 1) — invoice confirmation WhatsApp to customer
- PDF engine (Phase 1) — invoice PDF generation
- Number series (Phase 1) — invoice number auto-generation
- Rule engine (Phase 1) — discount limits, credit limit, price floor

Downstream (consumed by future phases):
- Accounting (Phase 6): consumes INVOICE_CONFIRMED → posts double-entry
- GST (Phase 7): consumes INVOICE_CONFIRMED → records GST liability
- CRM (Phase 9): reads invoice history for customer timeline

═══════════════════════════════════════════
CRITICAL BUSINESS RULES
═══════════════════════════════════════════

1. GST Computation (MANDATORY, never bypass):
   sellerStateCode === placeOfSupply → CGST + SGST (each = gstRate/2)
   sellerStateCode !== placeOfSupply → IGST (= full gstRate)
   Verify using GSTCalculator.compute() from Phase 2

2. Stock Deduction (MANDATORY):
   Use the atomic SQL from Phase 3 — NEVER read-then-check-then-deduct
   Deduction in SAME transaction as invoice creation

3. Credit Limit (MANDATORY):
   newBalance = customer.currentBalance + invoiceTotal
   if (newBalance > customer.creditLimit && !hasPermission(CREDIT_LIMIT_OVERRIDE)) → reject

4. Price Floor:
   lineTotal / qty < item.minSalePrice && !hasPermission(PRICE_OVERRIDE) → reject

5. Invoice Number:
   Use NumberSeriesEngine.next('INVOICE', branchId) — thread-safe, no duplicates

6. Loyalty Points:
   Feature-flagged: sales.loyalty.enabled
   On invoice confirm: earn points = floor(grandTotal / loyaltyRate)

═══════════════════════════════════════════
MILESTONE SEQUENCE
═══════════════════════════════════════════

MILESTONE 4.1 — Quotation
  Schema: quotations, quotation_lines
  Status: DRAFT → SENT → VIEWED → ACCEPTED → CONVERTED → EXPIRED → REJECTED
  API:
    POST/GET/PUT /api/v2/quotations
    POST /api/v2/quotations/:id/send     (email/WhatsApp to customer)
    POST /api/v2/quotations/:id/convert  (quotation → invoice, 1-click)
    POST /api/v2/quotations/:id/expire
  Scheduler: daily job → expire quotations past validity date
  Frontend: Quotation list + create form + detail view + convert button

MILESTONE 4.2 — Sales Invoice (CORE — build this correctly)
  Schema:
    - invoices table (25+ columns — see roadmap schema)
    - invoice_lines table (per-line GST computation)
    - invoice_history table + trigger
  
  Invoice Lifecycle Saga (INVOICE_CREATION):
    Step 1  (COMPENSATABLE): Validate credit limit
    Step 2  (COMPENSATABLE): Validate price floor for each line
    Step 3  (COMPENSATABLE): Reserve stock for all lines (via Phase 3 ReservationEngine)
    Step 4  (COMPENSATABLE): Generate invoice number
    Step 5  (COMPENSATABLE): Compute GST per line
    Step 6  (COMPENSATABLE): Create invoice record + lines
    Step 7  (COMPENSATABLE): Deduct stock (fulfil reservations)
    Step 8  (COMPENSATABLE): Deduct from accounts receivable
    Step 9  (IRREVERSIBLE): Write to outbox: INVOICE_CONFIRMED event
    Step 10 (IRREVERSIBLE): Generate PDF async (non-blocking)
    
  Cancellation Saga (INVOICE_CANCELLATION):
    Step 1: Restore stock
    Step 2: Restore customer balance
    Step 3: Write INVOICE_CANCELLED event to outbox
    
  API:
    POST   /api/v2/invoices            (create in DRAFT)
    POST   /api/v2/invoices/:id/confirm (confirm → deduct stock)
    POST   /api/v2/invoices/:id/cancel
    GET    /api/v2/invoices
    GET    /api/v2/invoices/:id
    PUT    /api/v2/invoices/:id         (only in DRAFT status)
    GET    /api/v2/invoices/:id/pdf     (signed URL to PDF)
    GET    /api/v2/invoices/:id/activity (history log)
    POST   /api/v2/invoices/:id/duplicate (copy to new draft)
  
  Frontend:
    Invoice list (DataTable, all filters)
    Invoice create/edit form:
      - Customer search with 360° mini-summary popup
      - Line items: barcode scan OR search by name
      - Per-line quantity, unit, price, discount (%, flat), GST rate auto-filled from item
      - Live totals (subtotal, discount, taxable, CGST, SGST/IGST, grand total)
      - Delivery date, payment terms, notes
      - Print/PDF preview
    Invoice view page
    Invoice approval screen (if pending approval)

MILESTONE 4.3 — POS (Point of Sale)
  Schema: pos_sessions, pos_session_events
  
  POS Mode differences vs Invoice:
    - Simplified UI (single screen, touchscreen-optimized)
    - No draft state — direct confirmation
    - Walk-in customer allowed (customer optional)
    - Multiple payment modes on ONE transaction (cash + card split)
    - Barcode scanner as primary input
    - Receipt printer support (80mm thermal printer, ESC/POS)
    - Quick keys for top 10 items (configurable)
    
  API:
    POST /api/v2/pos/sessions/open   (start shift — enter opening cash)
    POST /api/v2/pos/sessions/:id/close (end shift — enter closing cash)
    GET  /api/v2/pos/sessions/:id/summary
    POST /api/v2/pos/sales           (fast path — single API call for POS sale)
    GET  /api/v2/pos/quick-items     (cached — top items for quick keys)
    GET  /api/v2/pos/customer-search (optimized for mobile search)
  
  Frontend (apps/pos-frontend — separate React app):
    Full POS screen with: item grid, cart, payment modal, receipt
    Barcode input field always focused
    Touch-friendly large buttons

MILESTONE 4.4 — Payment Received (Receipts)
  Schema: payments, payment_allocations
  
  Payment types: CASH, CARD, UPI, CHEQUE, NEFT, RTGS, CREDIT_NOTE, ADVANCE
  
  Allocation: one payment can settle multiple invoices (partial allowed)
  Cheque management: post-dated cheque tracking, bounced cheque workflow
  Advance payment: received before invoice → linked later
  
  API:
    POST /api/v2/payments            (record payment)
    POST /api/v2/payments/:id/allocate (link to invoices)
    POST /api/v2/payments/:id/bounce  (mark cheque bounced)
    GET  /api/v2/payments
    GET  /api/v2/payments/:id
    GET  /api/v2/customers/:id/outstanding (invoices pending payment + aging)
  
  Events: PAYMENT_RECEIVED, CHEQUE_BOUNCED
  Frontend: Payment list + record payment modal + allocation UI

MILESTONE 4.5 — Sale Return and Credit Notes
  Schema: sale_returns, sale_return_lines, credit_notes
  
  Sale Return flow:
    → Select original invoice(s) → select items and quantities to return
    → Reason selection (defect, wrong item, customer changed mind, etc.)
    → Physical return or not (if not, no stock addition)
    → Generate credit note automatically
    
  Credit Note: can be:
    - Used against future invoice (allocated like a payment)
    - Refunded as cash/UPI
    
  API:
    POST /api/v2/sale-returns
    GET  /api/v2/sale-returns
    GET  /api/v2/sale-returns/:id
    POST /api/v2/credit-notes/:id/apply (apply against an invoice)
    POST /api/v2/credit-notes/:id/refund (cash refund)
  
  Events: SALE_RETURN_APPROVED, CREDIT_NOTE_CREATED
  Frontend: Return initiation form + credit note management

MILESTONE 4.6 — Loyalty Program (feature-flagged: sales.loyalty.enabled)
  Schema: loyalty_transactions
  
  Config per tenant: earn_rate (e.g., 1 point per ₹100), redeem_rate (1 point = ₹0.50)
  Tiers: BRONZE (0–999 pts), SILVER (1000–4999 pts), GOLD (5000+ pts)
  
  API:
    GET  /api/v2/customers/:id/loyalty  (balance + tier + history)
    POST /api/v2/pos/loyalty/redeem     (redeem during POS sale)
  
  Scheduler: birthday bonus points
  Scheduler: points expiry (configurable — e.g., expire after 1 year if inactive)

MILESTONE 4.7 — Delivery Challan
  Schema: delivery_challans, delivery_challan_lines
  
  For when goods are sent before invoicing (common in wholesale/job work)
  Can be converted to invoice later
  
  API:
    POST/GET/PUT /api/v2/delivery-challans
    POST /api/v2/delivery-challans/:id/dispatch
    POST /api/v2/delivery-challans/:id/convert-to-invoice

═══════════════════════════════════════════
CQRS PROJECTIONS TO UPDATE
═══════════════════════════════════════════

On INVOICE_CONFIRMED:
  projection_dashboard_daily: sales_count++, sales_amount += grandTotal
  projection_customer_balance: balance += grandTotal

On PAYMENT_RECEIVED:
  projection_dashboard_daily: collected_amount += amount
  projection_customer_balance: balance -= allocated_amount

On INVOICE_CANCELLED:
  projection_dashboard_daily: sales_count--, sales_amount -= grandTotal
  projection_customer_balance: balance -= grandTotal

═══════════════════════════════════════════
ACCEPTANCE CRITERIA
═══════════════════════════════════════════

✅ GST: B2B intrastate → CGST+SGST; interstate → IGST
✅ Credit limit: exceeded without override permission → 422 error
✅ Stock deduction: concurrent invoice creation never causes negative stock
✅ Invoice number: concurrent invoice creation never returns duplicate number
✅ POS sale: end-to-end in < 3 seconds (customer lookup → item scan → payment → receipt)
✅ Sale return: returned items stock restored; credit note created with matching GST
✅ Payment allocation: ₹10,000 payment allocated across 3 outstanding invoices
✅ PDF: invoice PDF renders with QR code, GSTIN, IRN placeholder, all GST breakdown
✅ Quotation convert: creates invoice pre-filled with all quotation data

Generate Phase Completion Report at end. Begin Milestone 4.1.

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
  ERP-PLANNING/phase-completions/PHASE_4_COMPLETION.md

The report must be generated and saved BEFORE closing this session.

```