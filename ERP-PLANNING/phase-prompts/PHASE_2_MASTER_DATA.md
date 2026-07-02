# PHASE 2 — MASTER DATA — SESSION STARTER PROMPT
## Paste this entire prompt as your first message in a new Claude session.

---

```
You are the Principal Backend Engineer and Full-Stack Developer on an enterprise Cloth Retail ERP. Your sole job in this session is Phase 2 — Master Data. Do NOT redesign. Do NOT simplify. Continue from Phase 1.

═══════════════════════════════════════════
MANDATORY READING (READ BEFORE WRITING CODE)
═══════════════════════════════════════════

Read: ERP-PLANNING/TECH_AUDIT.md       <- full stack, all packages+versions, what NOT to add
Read: ERP-PLANNING/TEST_CREDENTIALS.md  <- test logins (email/password/tenantId) for dev/smoke testing
Read: ERP-PLANNING/ERP_MASTER_SPEC.md
Read: ERP-PLANNING/CODING_STANDARDS.md
Read: ERP-PLANNING/phase-completions/PHASE_0_COMPLETION.md
Read: ERP-PLANNING/phase-completions/PHASE_1_COMPLETION.md

These are your source of truth. All decisions must align with them.

═══════════════════════════════════════════
WHAT EXISTS FROM PHASES 0 AND 1
═══════════════════════════════════════════

Phase 0: Monorepo, Docker, CI/CD, Platform SDK, Auth, Observability, Kubernetes
Phase 1: Tenant Engine, RBAC, Workflow Engine, Notification Engine, PDF Engine, Number Series, Scheduler, Import/Export Engine, Search Engine, Rule Engine

All platform engines are working and tested. Use them — do NOT rebuild them.

═══════════════════════════════════════════
YOUR OBJECTIVE — PHASE 2
═══════════════════════════════════════════

Build all master data entities. These are the core reference data that every transaction in Phases 3–11 will use. No invoice can be created without items, customers, and GST config. No payroll can run without employees. This phase is the data foundation.

═══════════════════════════════════════════
MILESTONE SEQUENCE (DO IN THIS ORDER)
═══════════════════════════════════════════

MILESTONE 2.1 — Organization and Branches
  Backend:
    - organizations table (full schema from roadmap)
    - branches table
    - GET /organization, PUT /organization, POST /organization/logo/upload
    - GET/POST/PUT/DELETE /branches
    - Validation: GSTIN format, cannot delete branch with transactions
    - Seed: one default branch on tenant provisioning
  Frontend:
    - Organization settings page (edit org details, upload logo)
    - Branch list page with DataTable
    - Branch create/edit form
    - Dark mode, permission gating, loading/error/empty states

MILESTONE 2.2 — Warehouse Management
  Backend:
    - warehouses table
    - Full CRUD API with permission guard
    - One default warehouse per branch on tenant provisioning
    - Cannot delete warehouse with stock
  Frontend:
    - Warehouse list + create/edit screens

MILESTONE 2.3 — User Management
  Backend:
    - users table (extends auth-service from Phase 0)
    - User CRUD: GET/POST/PUT/DELETE /users
    - POST /users/:id/reset-password
    - POST /users/:id/lock and /unlock
    - PUT /users/:id/branches (assign branch access)
    - GET /users/me, PUT /users/me, PUT /users/me/password
    - POST /users/me/avatar/upload
    - Validation: email unique per tenant, cannot delete last OWNER
  Frontend:
    - User list with role and branch badges
    - User create/edit form with role selector and branch multi-select
    - Profile page for current user

MILESTONE 2.4 — Customer Master
  Backend:
    - customers table (full schema from roadmap — 30+ columns)
    - customers_history table + trigger
    - GIN index for fuzzy name search
    - Full CRUD API
    - Duplicate detection: warn on same mobile or GSTIN
    - GET /customers/:id/statement
    - GET /customers/:id/outstanding
    - GET /customers/:id/activity (360° view data)
    - POST /customers/merge (MDG)
    - POST /customers/import, GET /customers/export
    - Elasticsearch indexing on create/update
  Frontend:
    - Customer list with search, filters (type, city, status, overdue-only)
    - Customer create/edit form with GSTIN validation (real-time format check)
    - Customer 360° view page (all sections: balance, invoices, payments, loyalty, timeline)

MILESTONE 2.5 — Supplier Master
  Backend:
    - suppliers table (full schema)
    - suppliers_history table + trigger
    - Full CRUD API
    - GET /suppliers/:id/statement
    - GET /suppliers/:id/outstanding
    - POST /suppliers/import, GET /suppliers/export
    - Bank account stored encrypted
    - Elasticsearch indexing
  Frontend:
    - Supplier list with search and filters
    - Supplier create/edit form
    - Supplier view page

MILESTONE 2.6 — Item Master (LARGEST milestone — most complex)
  Backend:
    - categories table
    - brands table
    - units table
    - attribute_sets table
    - attributes table
    - attribute_values table
    - items table (full schema — 40+ columns)
    - item_variants table
    - items_history table + trigger
    - price_lists table
    - price_list_items table
    - Full CRUD for all above
    - POST /items/:id/variants
    - POST /items/:id/barcode/generate
    - GET /items/by-barcode/:barcode (< 50ms, cached in Redis)
    - GET /items/:id/stock
    - GET /items/:id/price-history
    - POST /items/import, GET /items/export
    - Elasticsearch indexing
    - Validation: HSN code format, GST rate must be in [0, 5, 12, 18, 28]
  Frontend:
    - Category list + create/edit
    - Brand list + create/edit
    - Unit list + create/edit
    - Item list with category, brand, status filters + search
    - Item create/edit form (full — HSN, GST rate, variant config, barcode)
    - Item view page with stock by warehouse, price history
    - Variant management UI
    - Barcode generator and print dialog

MILESTONE 2.7 — GST and HSN Configuration
  Backend:
    - gst_rates table
    - hsn_master table (seed from government HSN master list)
    - GSTCalculator.compute() function (IGST vs CGST+SGST auto-switch)
    - POST /gst/validate-hsn
    - GET /gst/rates
    - PUT /gst/rates/:id
  Frontend:
    - GST rate configuration screen (admin)
    - HSN lookup widget (used in item form and invoice line form)

MILESTONE 2.8 — Chart of Accounts
  Backend:
    - accounts table (full schema)
    - Seed 40+ default accounts on tenant provisioning (full list from roadmap)
    - Full CRUD API
    - Cannot delete account with transactions
    - Tree structure endpoint for account picker UI
    - GET /accounts/:id/ledger
  Frontend:
    - Chart of accounts tree view
    - Account create/edit form
    - Account ledger view (transaction history)

MILESTONE 2.9 — Opening Balances Wizard
  Backend:
    - POST /opening-balances/customers (batch)
    - POST /opening-balances/suppliers (batch)
    - POST /opening-balances/stock (batch)
    - POST /opening-balances/accounts (batch)
    - POST /opening-balances/cash-bank
    - GET /opening-balances/status
    - POST /opening-balances/lock
  Frontend:
    - Multi-step wizard (5 steps + review + lock)
    - Import from Excel at each step
    - Trial balance check at review step (must balance before locking)

═══════════════════════════════════════════
FIELD-LEVEL ENCRYPTION REMINDER
═══════════════════════════════════════════

These fields MUST be encrypted before storing (AES-256-GCM):
- customers.gstin, customers.pan
- suppliers.bank_account_no
- employees.pan, employees.bank_account_no (Phase 8)

Use PlatformContext.encryption.encrypt(value) — already in SDK from Phase 0.
Store companion _hash column for search: ctx.encryption.searchHash(value)

═══════════════════════════════════════════
SEARCH INDEXING REMINDER
═══════════════════════════════════════════

Every create/update for Customer, Supplier, Item must:
1. Save to DB (primary)
2. Write CUSTOMER_CREATED or ITEM_UPDATED event to outbox
3. Search indexer (event consumer) updates Elasticsearch

Do NOT call Elasticsearch directly from the save handler.
Use the Outbox → Event → Consumer pattern.

═══════════════════════════════════════════
ACCEPTANCE CRITERIA
═══════════════════════════════════════════

✅ Customer CRUD: all 5 operations work, GSTIN format validated in real-time
✅ Item with 3 variants: creating item creates correct variant records
✅ Price list: customer with assigned price list gets correct price (not default)
✅ HSN validation: valid HSN returns GST rate, invalid returns 422
✅ Opening balance: customer balance entry creates corresponding ledger entry
✅ Import 5,000 items: completes in < 3 minutes with error report
✅ Barcode scan: GET /items/by-barcode/:value returns in < 50ms (verify Redis cache hit)
✅ Customer search by name, mobile, or GSTIN all work
✅ Temporal history: customer update creates row in customers_history
✅ Chart of accounts: all 40+ default accounts present on new tenant

Generate Phase Completion Report at end using ERP-PLANNING/PHASE_COMPLETION_TEMPLATE.md.

Begin with Milestone 2.1. Confirm reference files read before writing code.

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
  ERP-PLANNING/phase-completions/PHASE_2_COMPLETION.md

The report must be generated and saved BEFORE closing this session.

```