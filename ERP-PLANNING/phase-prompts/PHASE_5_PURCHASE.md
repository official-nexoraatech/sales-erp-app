# PHASE 5 — PURCHASE — SESSION STARTER PROMPT

---

```
You are the Principal Backend Engineer (Purchase Domain) on an enterprise Cloth Retail ERP. Your job: implement Phase 5 — Purchase completely. Mirror the quality and patterns from Phase 4 (Sales). Do NOT redesign. Continue from all previous phases.

═══════════════════════════════════════════
MANDATORY READING
═══════════════════════════════════════════
All the file in teh phase-completion and phase prompt, readme.md adn all other .md files
Read: ERP-PLANNING/TECH_AUDIT.md       <- full stack, all packages+versions, what NOT to add
Read: ERP-PLANNING/TEST_CREDENTIALS.md  <- test logins (email/password/tenantId) for dev/smoke testing
Read: ERP-PLANNING/ERP_MASTER_SPEC.md
Read: ERP-PLANNING/CODING_STANDARDS.md
Read: ERP-PLANNING/phase-completions/PHASE_3_COMPLETION.md  ← addStock() API
Read: ERP-PLANNING/phase-completions/PHASE_4_COMPLETION.md  ← follow same patterns as Sales

═══════════════════════════════════════════
PURCHASE MODULE PRINCIPLES
═══════════════════════════════════════════

Purchase is the mirror of Sales:
  Sales:    Customer → Invoice → Payment Received → Return → Credit Note
  Purchase: Supplier → PO → GRN → Supplier Payment → Purchase Return → Debit Note

Stock increases on GRN approval (call Phase 3 addStock()).
Accounting entries posted on GRN (stock debit + payable credit) and payment (payable debit + bank credit).

═══════════════════════════════════════════
MILESTONE SEQUENCE
═══════════════════════════════════════════

MILESTONE 5.1 — Purchase Order
  Schema: purchase_orders, purchase_order_lines, purchase_order_history + trigger
  Status: DRAFT → SUBMITTED → PENDING_APPROVAL → APPROVED → PARTIALLY_RECEIVED → RECEIVED → CLOSED → CANCELLED
  
  API:
    POST/GET/PUT /api/v2/purchase-orders
    GET  /api/v2/purchase-orders/:id
    POST /api/v2/purchase-orders/:id/submit
    POST /api/v2/purchase-orders/:id/approve
    POST /api/v2/purchase-orders/:id/cancel
    POST /api/v2/purchase-orders/:id/duplicate
    GET  /api/v2/purchase-orders/:id/pdf
    GET  /api/v2/purchase-orders/pending-delivery  (POs partially received, overdue)
  
  Events: PO_CREATED, PO_APPROVED, PO_CANCELLED
  Notifications: On APPROVED → Email/WhatsApp PO to supplier
  Frontend: PO list + create form + detail view

MILESTONE 5.2 — Goods Receipt Note (GRN)
  Schema: grns, grn_lines, grn_history + trigger
  
  3-Way Match on GRN:
    PO quantity vs GRN quantity (allow partial receipt)
    PO rate vs GRN rate (price variance detection)
    If variance > 5% → trigger approval workflow (GRN_PRICE_VARIANCE)
  
  GRN saga (PURCHASE_GRN):
    Step 1 (COMPENSATABLE): Create GRN record
    Step 2 (COMPENSATABLE): Validate 3-way match
    Step 3 (COMPENSATABLE): Update PO received quantities
    Step 4 (COMPENSATABLE): Add stock to warehouse (call Phase 3 addStock())
    Step 5 (COMPENSATABLE): Post accounting entry (stock asset debit + payable credit)
    Step 6 (IRREVERSIBLE): Write GRN_APPROVED event to outbox
  
  API:
    POST /api/v2/grns             (link to PO, enter received quantities)
    POST /api/v2/grns/:id/approve
    POST /api/v2/grns/:id/reject
    GET  /api/v2/grns
    GET  /api/v2/grns/:id
  
  Events: GRN_APPROVED, GRN_REJECTED
  Frontend: GRN create screen (pre-fills from PO, allow editing received qty and rate)

MILESTONE 5.3 — Landed Cost Allocation
  Schema: landed_costs, landed_cost_allocations
  
  Landed costs: customs duty, freight, insurance, handling charges
  Allocation methods: BY_VALUE, BY_QUANTITY, BY_WEIGHT
  
  API:
    POST /api/v2/grns/:id/landed-costs  (add costs to GRN)
    POST /api/v2/grns/:id/allocate      (distribute costs to lines)
  
  Result: item cost = (grn_rate × qty + allocated_landed_cost) / qty

MILESTONE 5.4 — Supplier Payments
  Schema: supplier_payments, supplier_payment_allocations
  
  Payment modes: CASH, CHEQUE, NEFT, RTGS, UPI
  PDC (Post-Dated Cheques): track issue date, bank clearing date, status
  PDC Scheduler: daily job → notify finance 3 days before PDC clearing date
  
  API:
    POST /api/v2/supplier-payments
    POST /api/v2/supplier-payments/:id/allocate
    POST /api/v2/supplier-payments/:id/bounce
    GET  /api/v2/suppliers/:id/outstanding
    GET  /api/v2/suppliers/:id/statement
  
  Events: SUPPLIER_PAYMENT_MADE, PDC_ISSUED, CHEQUE_BOUNCED

MILESTONE 5.5 — Purchase Returns and Debit Notes
  Schema: purchase_returns, purchase_return_lines, debit_notes
  
  Purchase Return flow:
    → Select GRN → select items and quantities to return
    → Reason: quality issue, wrong item, excess quantity
    → Debit note auto-generated
    → Stock deducted on approval
    
  Debit Note: reduces payable to supplier
  
  API:
    POST /api/v2/purchase-returns
    GET  /api/v2/purchase-returns
    POST /api/v2/purchase-returns/:id/approve
    GET  /api/v2/debit-notes

MILESTONE 5.6 — Expense Management
  Schema: expenses, expense_lines
  
  Expense types: RENT, ELECTRICITY, SALARY, FREIGHT, MARKETING, MAINTENANCE, MISC
  Status: DRAFT → SUBMITTED → PENDING_APPROVAL → APPROVED → PAID
  
  API:
    POST/GET/PUT /api/v2/expenses
    POST /api/v2/expenses/:id/submit
    POST /api/v2/expenses/:id/approve
    POST /api/v2/expenses/:id/pay
  
  Accounting: on approve → debit expense account + credit payable
               on pay → debit payable + credit bank

═══════════════════════════════════════════
ACCEPTANCE CRITERIA
═══════════════════════════════════════════

✅ PO approved → WhatsApp PDF sent to supplier
✅ GRN with 5% price variance triggers approval workflow
✅ GRN approval adds stock to warehouse (verify via GET /inventory/stock)
✅ Landed cost: total GRN cost correctly distributed to all lines
✅ PDC: scheduler alerts finance 3 days before clearing date
✅ Purchase return: stock deducted, debit note created with correct amount
✅ Supplier outstanding: balance = GRN totals - payments - debit notes


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
  ERP-PLANNING/phase-completions/PHASE_5_COMPLETION.md

The report must be generated and saved BEFORE closing this session.

```