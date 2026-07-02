# PHASE 3 — INVENTORY — SESSION STARTER PROMPT

---

```
You are the Principal Backend Engineer (Inventory Domain Expert) on an enterprise Cloth Retail ERP. Your job in this session: implement Phase 3 — Inventory Management — completely. Do NOT redesign. Do NOT simplify.

═══════════════════════════════════════════
MANDATORY READING
═══════════════════════════════════════════

Read: ERP-PLANNING/TECH_AUDIT.md       <- full stack, all packages+versions, what NOT to add
Read: ERP-PLANNING/TEST_CREDENTIALS.md  <- test logins (email/password/tenantId) for dev/smoke testing
Read: ERP-PLANNING/ERP_MASTER_SPEC.md
Read: ERP-PLANNING/CODING_STANDARDS.md
Read: ERP-PLANNING/phase-completions/PHASE_2_COMPLETION.md  ← especially: items table schema, warehouses schema, public interfaces

═══════════════════════════════════════════
CRITICAL INVARIANT — NEVER VIOLATE
═══════════════════════════════════════════

Stock NEVER goes negative. The ONLY safe way to deduct stock is:

  UPDATE items
  SET available_qty = available_qty - :qty, version = version + 1
  WHERE id = :itemId AND tenant_id = :tenantId AND available_qty >= :qty;

  If rows_affected = 0 → throw InsufficientStockError(available)
  If rows_affected = 1 → write to inventory_ledger in SAME transaction

This SQL is atomic. No race condition is possible. Do NOT use a separate SELECT then UPDATE.

═══════════════════════════════════════════
MILESTONE SEQUENCE
═══════════════════════════════════════════

MILESTONE 3.1 — Inventory Ledger (FOUNDATION — everything else depends on this)
  Schema:
    - inventory_ledger table (append-only, partitioned by year)
    - Partition: inventory_ledger_2025, inventory_ledger_2026 (maintenance job creates next year's)
    - Indexes: (tenant_id, item_id, warehouse_id, created_at) and (tenant_id, reference_type, reference_id)
    - NEVER allow UPDATE or DELETE on this table (add CHECK constraint or trigger to prevent)
  
  Service functions (all in apps/inventory-service):
    addStock(params, trx) → insert STOCK_IN entry
    deductStock(params, trx) → atomic check + STOCK_OUT entry
    adjustStock(params, trx) → ADJUSTMENT entry
    transferStock(from, to, params, trx) → TRANSFER_OUT + TRANSFER_IN entries
  
  API:
    GET /api/v2/inventory/stock (list with filters: warehouse, below-reorder, status)
    GET /api/v2/inventory/stock/:itemId (stock by all warehouses)
    GET /api/v2/inventory/ledger/:itemId (paginated ledger entries)
  
  Nightly reconciliation job:
    Compare SUM(ledger movements) vs items.available_qty
    Flag mismatches → alert → reconciliation_errors log
  
  Tests:
    □ 100 concurrent deduction requests for 50 units of stock → exactly 50 succeed, 50 fail with InsufficientStockError
    □ No negative stock under any concurrent scenario
    □ Ledger row always has correct quantity_before and quantity_after snapshots

MILESTONE 3.2 — Stock Reservations
  Schema:
    - stock_reservations table (from roadmap schema)
  
  Service:
    ReservationEngine.reserve(itemId, warehouseId, qty, reference, expiresAt)
      → deducts from available_qty, adds to reserved_qty, creates reservation record
    ReservationEngine.fulfill(reservationId)
      → deducts from reserved_qty (stock was sold)
    ReservationEngine.release(reservationId, reason)
      → restores reserved_qty to available_qty
  
  API:
    POST /api/v2/inventory/reservations
    DELETE /api/v2/inventory/reservations/:id
    GET /api/v2/inventory/reservations (active only)
  
  Scheduler job: every 6 hours — find expired reservations → release + notify
  
  Events: RESERVATION_CREATED, RESERVATION_FULFILLED, RESERVATION_RELEASED, RESERVATION_EXPIRED

MILESTONE 3.3 — Stock Transfers
  Schema:
    - stock_transfers table
    - stock_transfer_lines table
  
  Status machine: DRAFT → SUBMITTED → PENDING_APPROVAL → APPROVED → DISPATCHED → IN_TRANSIT → RECEIVED → CANCELLED
  
  Saga (STOCK_TRANSFER):
    Step 1 (COMPENSATABLE): Create transfer record
    Step 2 (COMPENSATABLE): Reserve stock at source warehouse
    Step 3 (COMPENSATABLE): On DISPATCHED: deduct from source (TRANSFER_OUT to ledger)
    Step 4 (COMPENSATABLE): On RECEIVED: add to destination (TRANSFER_IN to ledger)
  
  API:
    POST/GET/PUT /api/v2/stock-transfers
    GET /api/v2/stock-transfers/:id
    POST /api/v2/stock-transfers/:id/submit
    POST /api/v2/stock-transfers/:id/approve (workflow)
    POST /api/v2/stock-transfers/:id/dispatch
    POST /api/v2/stock-transfers/:id/receive (with line-level received quantities)
    POST /api/v2/stock-transfers/:id/cancel
  
  Frontend:
    Stock Transfer list + create form + detail view
    Receive screen: enter actual quantities received per line (may differ from dispatched)
  
  Events: TRANSFER_DISPATCHED, TRANSFER_RECEIVED, TRANSFER_CANCELLED

MILESTONE 3.4 — Stock Adjustments
  Schema:
    - stock_adjustments table
    - stock_adjustment_lines table
  
  Types: DAMAGE, EXPIRY, THEFT, SHORTAGE, EXCESS, QUALITY_ISSUE, SAMPLE_ISSUED, RETURN_TO_VENDOR
  Flow: DRAFT → PENDING_APPROVAL (if value > threshold) → APPROVED → inventory_ledger updated
  
  API:
    POST/GET/PUT /api/v2/stock-adjustments
    POST /api/v2/stock-adjustments/:id/submit
    POST /api/v2/stock-adjustments/:id/approve
    POST /api/v2/stock-adjustments/:id/cancel
  
  Frontend:
    Adjustment create form (line-level: item, +/- direction, qty, reason)
    Adjustment list with status filter

MILESTONE 3.5 — Physical Stock Verification
  Schema:
    - physical_verifications table
    - physical_verification_lines table
  
  Flow:
    1. Create verification → snapshot system qty for all items in warehouse
    2. Staff enter physical counts (can be multiple sessions)
    3. System computes variance: physical_qty - system_qty
    4. Manager reviews (positive = excess found, negative = shortage)
    5. Approve → auto-create stock adjustment for each variance
  
  API:
    POST /api/v2/physical-verifications
    GET /api/v2/physical-verifications/:id
    POST /api/v2/physical-verifications/:id/start-counting
    PUT /api/v2/physical-verifications/:id/counts (batch update counted quantities)
    GET /api/v2/physical-verifications/:id/variances
    POST /api/v2/physical-verifications/:id/approve
  
  Frontend:
    Create verification → auto-populate items from warehouse
    Count entry: spreadsheet-like interface
    Variance report with approve/reject per line option

MILESTONE 3.6 — Fabric Roll Management (feature-flagged: inventory.fabric-rolls.enabled)
  Schema:
    - fabric_rolls table
    - fabric_cuts table
  
  Service:
    FabricRollService.receiveRoll(rollNumber, itemId, meters, grn) → create roll record
    FabricRollService.cut(rollId, meters, purpose, reference) → deduct from roll, create cut record
    FabricRollService.getAvailableRolls(itemId) → sorted FIFO by receipt date
  
  API:
    GET /api/v2/fabric-rolls?itemId=X (available rolls for item)
    POST /api/v2/fabric-rolls/:id/cut
    GET /api/v2/fabric-rolls/:id/cuts (cut history)
  
  Frontend:
    Roll inventory screen (item → rolls with current meters)
    Roll detail with cut history

═══════════════════════════════════════════
CQRS PROJECTION: Stock Level
═══════════════════════════════════════════

projection_stock_level table (from ERP_MASTER_SPEC.md Section 4.3):
  tenant_id, item_id, warehouse_id, available_qty, reserved_qty, last_movement_at

Event consumers update this projection:
  STOCK_DEDUCTED → available_qty -= qty
  STOCK_RECEIVED → available_qty += qty
  RESERVATION_CREATED → reserved_qty += qty; available_qty -= qty
  RESERVATION_RELEASED → reserved_qty -= qty; available_qty += qty

Dashboard reads from projection (not live ledger).
Reports read from live ledger (authoritative).

═══════════════════════════════════════════
ACCEPTANCE CRITERIA
═══════════════════════════════════════════

✅ Concurrent test: 100 simultaneous requests to sell last 50 units → exactly 50 succeed
✅ Transfer: dispatch deducts from source, receive adds to destination (verify amounts match)
✅ Physical verification: approved variances create matching adjustment entries
✅ Reservation expiry job runs and releases stock
✅ Fabric roll FIFO: oldest roll selected first automatically
✅ Nightly reconciliation: passes with zero discrepancies on clean data
✅ Ledger: every movement has quantity_before, quantity_after, reference_type, reference_id

Begin Milestone 3.1. Confirm reading before writing code.

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
  ERP-PLANNING/phase-completions/PHASE_3_COMPLETION.md

The report must be generated and saved BEFORE closing this session.

```