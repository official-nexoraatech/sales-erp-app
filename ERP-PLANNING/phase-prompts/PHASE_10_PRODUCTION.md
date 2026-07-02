# PHASE 10 — PRODUCTION / CLOTH-SPECIFIC WORKFLOWS — SESSION STARTER PROMPT

---

```
You are the Principal Engineer on an enterprise Cloth Retail ERP. Your job: implement Phase 10 — cloth retail-specific production workflows (Job Work, Barcode, Consignment). These are the features that make this ERP specialized for cloth retail. Do NOT redesign. Continue from previous phases.

═══════════════════════════════════════════
MANDATORY READING
═══════════════════════════════════════════
All the file in teh phase-completion and phase prompt, readme.md adn all other .md files 
Read: ERP-PLANNING/TECH_AUDIT.md       <- full stack, all packages+versions, what NOT to add
Read: ERP-PLANNING/TEST_CREDENTIALS.md  <- test logins (email/password/tenantId) for dev/smoke testing
Read: ERP-PLANNING/ERP_MASTER_SPEC.md
Read: ERP-PLANNING/CODING_STANDARDS.md
Read: ERP-PLANNING/phase-completions/PHASE_3_COMPLETION.md  ← inventory ledger API
Read: ERP-PLANNING/phase-completions/PHASE_5_COMPLETION.md  ← GRN for material input

═══════════════════════════════════════════
MILESTONE SEQUENCE
═══════════════════════════════════════════

MILESTONE 10.1 — Job Work Orders (Outsourced Stitching/Processing)
  Used when: retailer sends fabric to external tailor/job worker for stitching/processing
  
  Schema: job_work_orders (from roadmap schema)
  
  Status: DRAFT → MATERIAL_ISSUED → IN_PROGRESS → QUALITY_CHECK → COMPLETED → CANCELLED
  
  Flow:
    1. Create order: item to manufacture + quantity + supplier (job worker) + rate
    2. MATERIAL_ISSUED: Deduct raw materials from stock (inventory_ledger: STOCK_OUT)
    3. COMPLETED: Receive finished goods:
       - received_qty added to stock (inventory_ledger: STOCK_IN)
       - rejected_qty → DAMAGE entry in inventory_ledger
       - scrap_qty → SCRAP entry
    4. Costing: finished_goods_cost = (materials_cost + job_work_charges) / received_qty
    
  Job Work Saga:
    Step 1 (COMPENSATABLE): Create order
    Step 2 (COMPENSATABLE): Issue materials (deduct from stock)
    Step 3 (COMPENSATABLE): Receive finished goods (add to stock at computed cost)
    Step 4 (COMPENSATABLE): Post accounting (material cost + job work cost → WIP → finished goods)
    
  Quality Check:
    Inspector marks each piece: PASS / FAIL / REWORK
    REWORK: send back to job worker (extend expected date)
    Only PASS pieces add to stock
    
  API:
    POST/GET/PUT /api/v2/job-work-orders
    POST /api/v2/job-work-orders/:id/issue-materials
    POST /api/v2/job-work-orders/:id/start-quality-check
    POST /api/v2/job-work-orders/:id/complete  (with received qty + rejected qty)
    GET  /api/v2/job-work-orders/in-progress   (for production dashboard)
  
  Frontend:
    Job work list + create form
    Quality check entry screen (item list with pass/fail/rework per piece)
    Production dashboard: pending orders, overdue, daily completion count

MILESTONE 10.2 — Barcode Management (EXTEND from Phase 2 foundations)
  Extend barcodes table from Phase 2.
  
  Barcode generation service:
    POST /api/v2/barcodes/generate
      Body: { itemId, variantId?, quantity, format: 'EAN13'|'CODE128'|'QR', printFormat: 'A4_SHEET'|'LABEL_40x25'|'LABEL_60x40' }
      Response: { barcodeIds[], printUrl }  (signed URL to print-ready PDF)
    
  Barcode label PDF generator:
    Label 40×25mm: barcode, item name, MRP, size (standard retail label)
    Label 60×40mm: barcode, item name, brand, MRP, care symbols
    A4 sheet: 21 labels per sheet (Avery format)
    
  Two output formats:
    PDF: for regular/laser printers
    ZPL: for Zebra/Citizen thermal label printers
    
  Barcode scan endpoint (CRITICAL — must be fast):
    GET /api/v2/items/by-barcode/:value
    Cache: Redis 5-minute TTL
    Must respond in < 50ms (verify with load test)
    
  API:
    POST /api/v2/barcodes/generate
    GET  /api/v2/barcodes/print/:batchId  (download generated PDF)
    POST /api/v2/barcodes/:id/deactivate  (replace with new barcode)
    GET  /api/v2/items/by-barcode/:value  (< 50ms)
  
  Frontend:
    Barcode generation dialog (from Item page → Generate Barcodes button)
    Quantity input, format selector, preview label
    Print button → opens PDF in new tab

MILESTONE 10.3 — Consignment Stock (brand sends stock on consignment to retailer)
  Feature flag: inventory.consignment.enabled
  
  Business rule: consignment stock is NOT owned until sold. NOT on balance sheet until sold.
  
  Schema: consignment_stocks, consignment_settlements
  
  Flow:
    RECEIVE: consignment_stock record created (NOT posted to financial_entries)
    SELL: when POS/invoice sells a consigned item → consignment_stock deducted + settlement due
    SETTLE: monthly settlement → compute what was sold × agreed rate → pay supplier
    RETURN: unsold consignment returned to brand
    
  API:
    POST /api/v2/consignment/receive      (receive consignment from brand)
    GET  /api/v2/consignment/stock        (list of consigned items + quantities)
    GET  /api/v2/consignment/settlements  (pending settlement amounts)
    POST /api/v2/consignment/settle/:id   (settle with payment)
    POST /api/v2/consignment/return/:id   (return unsold stock)

MILESTONE 10.4 — Reorder and Procurement Automation
  Build on: items.reorder_level + items.reorder_quantity from Phase 2
  
  Reorder Report:
    GET /api/v2/inventory/reorder-required
    Items where: available_qty <= reorder_level (from CQRS projection_stock_level)
    Response: { item, currentQty, reorderLevel, reorderQty, preferredSupplier, lastPurchaseRate }
  
  One-click PO creation:
    POST /api/v2/inventory/reorder/create-pos
    Body: { items: [{ itemId, supplierId, quantity }] }
    Creates draft POs grouped by supplier
    
  Scheduler: daily 09:00 → check reorder levels → email report to purchase manager

MILESTONE 10.5 — POS Offline Mode (feature-flagged: platform.offline.enabled)
  Progressive Web App capabilities for offline POS:
  
  Service Worker:
    Cache on startup: item catalog (all active items), price lists, customer list
    IndexedDB storage for: pending transactions queue
    
  Offline sale flow:
    1. User creates sale → stored in IndexedDB as PendingTransaction
    2. Network restored → auto-sync pending transactions → normal invoice creation
    3. Conflict: if item stock went to zero offline → flag for manual resolution
    
  UI indicators:
    Green dot: online, synced
    Yellow dot: online, syncing
    Red dot: offline, transactions pending (show count)
    
  Note: Only POS-specific flow is offline. Full ERP requires connectivity.

═══════════════════════════════════════════
ACCEPTANCE CRITERIA
═══════════════════════════════════════════

✅ Job work: material issue deducts stock; completion adds finished goods stock
✅ Job work cost: finished_goods_cost calculated correctly with landed job_work_charges
✅ Barcode label PDF: renders correctly in A4 format (21 labels) and 40×25mm label
✅ Barcode scan: GET /items/by-barcode returns in < 50ms (verify Redis cache)
✅ Consignment: consigned items NOT on balance sheet until sold
✅ Reorder report: correctly identifies items below reorder level
✅ One-click PO: creates correct draft POs grouped by preferred supplier


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
  ERP-PLANNING/phase-completions/PHASE_10_COMPLETION.md

The report must be generated and saved BEFORE closing this session.

```