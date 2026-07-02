# AUDIT STABILIZATION PHASES — SESSION STARTER PROMPT (ES-02 through ES-20)

---

## HOW TO USE THIS DOCUMENT

Each phase in this document is an independent Claude Code session. To execute a phase:

1. Copy the **PROJECT CONTEXT** section (immediately below) into your Claude Code session
2. Copy the specific **ES-XX** phase section you want to execute
3. Tell Claude: *"You are executing ES-XX. Read the project context and phase instructions carefully, then implement everything in scope."*
4. Claude must complete the POST-IMPLEMENTATION VERIFICATION CHECKLIST before closing the session
5. Claude must generate a completion report at `ERP-PLANNING/phase-completions/ES-XX_COMPLETION.md` before finishing

**Execution order matters.** Respect the dependency graph:
- ES-02, ES-04, ES-06, ES-07 → no dependencies; run first or in parallel
- ES-03, ES-05, ES-08 → depend on ES-02
- ES-09 → depends on ES-02, ES-03, ES-07
- ES-10 → depends on ES-02
- ES-11 → depends on ES-10
- ES-12 → depends on ES-06
- ES-13 → depends on ES-02, ES-03
- ES-14 → depends on ES-10
- ES-15, ES-16 → depend on ES-02
- ES-17 → depends on ES-05, ES-13
- ES-18, ES-19 → depend on ES-07
- ES-20 → depends on ES-07, ES-19

**Critical path (do first):** ES-02 → ES-03 → ES-13 → ES-17

---

---

# PROJECT CONTEXT

> Every Claude session must read this section before touching any code.

## 1. ERP Domain

NEXORAA is a **multi-tenant SaaS ERP platform** for Indian cloth retailers and wholesalers. It handles: Sales & Invoicing, Purchase & Procurement, Inventory Management, Accounting & General Ledger, GST Compliance (Indian tax law), HR & Payroll (PF/ESI/TDS), CRM & Loyalty, Production/Job Work, Point of Sale, and Reports & Analytics.

Regulatory context: Indian GST law (CGST/SGST/IGST/cess), Companies Act 2013, EPF Act 1952, ESI Act 1948, Income Tax Act 1961.

## 2. Multi-Tenant Architecture

- All DB tables have `tenant_id UUID NOT NULL`
- PostgreSQL Row-Level Security (RLS) enforces tenant isolation
- Elasticsearch: `{tenantId}_{resourceType}` index naming
- Redis keys: `tenant:{tenantId}:{key}` prefix
- JWT carries `tenantId`; all services read it from `request.auth.tenantId`
- **Tenant ID NEVER comes from request body, query params, or URL params**

## 3. Technology Stack

| Layer | Technology |
|---|---|
| Runtime | Node.js 20 LTS + TypeScript 5 (strict mode) |
| HTTP Framework | Fastify 4 |
| Database | PostgreSQL 16 + Drizzle ORM |
| Connection Pool | PgBouncer (transaction mode) |
| Search | Elasticsearch 8 |
| Job Queue | BullMQ + Redis 7 |
| Event Bus | Kafka 3 (via `packages/event-bus-client`) |
| Auth | RS256 JWT — access 15min, refresh 7d |
| Field Encryption | AES-256-GCM |
| Monorepo | Turborepo + pnpm workspaces |
| Frontend | React 18 + TypeScript 5 + Vite 5 + Tailwind CSS v4 |
| State (server) | React Query v5 (`@tanstack/react-query`) |
| State (client) | Zustand |
| Forms | react-hook-form + Zod resolver |
| Testing | Vitest + real PostgreSQL (Docker) |
| E2E | Playwright |
| Monitoring | Prometheus + Grafana + Loki |

## 4. Monorepo Folder Structure

```
apps/
  accounting-service/     # Double-entry GL, journals, fixed assets, TDS
  api-gateway/            # Reverse proxy, rate limiting, JWT validation
  auth-service/           # Login, refresh token, session management
  event-service/          # Outbox relay, event store, CQRS projections, saga
  gst-service/            # GST computation, GSTR-1/2A/3B, e-Invoice, e-Way Bill
  hr-service/             # Employees, attendance, leave, payroll
  inventory-service/      # Items, stock levels, ledger, reservations, transfers
  notification-service/   # Email, WhatsApp, push
  pos-frontend/           # POS React app
  production-service/     # Job work orders, barcode, consignment
  purchase-service/       # POs, GRN, purchase returns, expenses
  report-service/         # Report engine, PDF, analytics, projections
  sales-service/          # Invoices, quotations, payments, loyalty, CRM
  scheduler-service/      # BullMQ cron jobs, import/export
  search-service/         # Elasticsearch query layer
  tenant-service/         # Tenant CRUD, onboarding, feature flags
  web-frontend/           # Main ERP React SPA

packages/
  cache-client/           # Redis wrapper (per-tenant key prefix)
  config/                 # Shared Zod-validated env config
  db-client/              # Drizzle ORM schemas, migrations, DB factory
    migrations/           # SQL migration files (0000-0007; Phase 10/11 MISSING)
    src/schema/           # accounting, auth, crm, distributed, gst, hr, inventory,
                          # items, master, notification, production, purchase,
                          # report, rules, sales, scheduler, tenant, workflow
  event-bus-client/       # Kafka producer/consumer wrappers
  logger/                 # Pino structured logger
  platform-sdk/           # audit, context, event-store, events, feature-flags,
                          # http-security, locks, rule-engine, schema-registry,
                          # telemetry, workflow
  shared-types/           # errors.ts, events.ts, permissions.ts, index.ts
  shared-utils/           # Date, money, string, validation utilities
```

## 5. Service Internal Structure (Standard)

```
src/
  api/          # Fastify route definitions — Zod validation only; no business logic
  domain/       # Services, Engines, Calculators — all business logic
  consumers/    # Kafka event consumers (Inbox pattern)
  jobs/         # BullMQ job processors
  middleware/   # authenticate.ts, authorize.ts
  main.ts       # Fastify app bootstrap
```

## 6. Distributed System Patterns

**Outbox Pattern:** Every domain event is written atomically to `outbox_events` in the same DB transaction as the business mutation. `apps/event-service` polls and publishes to Kafka. Consumers mark events processed in `inbox_events`.

**Inbox Pattern (Idempotency):** Every Kafka consumer checks `inbox_events` by `event_id` before processing. Duplicate events are skipped.

**CQRS:** Write model = Drizzle ORM tables. Read model = `projection_*` tables in event-service. Dashboard always reads from projections.

**Saga Pattern:** Multi-step transactions use compensating sagas in `apps/event-service`.

**Event Sourcing:** `domain_events` table: `(tenant_id, aggregate_id, aggregate_type, event_type, payload, version, created_at)`.

## 7. API Conventions

- Base path: `/api/v1/{resource}`
- Success: `{ data: T, meta?: { page, limit, total } }`
- Error: `{ error: { code: string, message: string, details?: unknown } }`
- Pagination: `?page=1&limit=20` (default 20, max 100)
- Tenant ID: ALWAYS from `request.auth.tenantId`
- Timestamps: UTC ISO 8601
- Money: integers in paise (1 INR = 100 paise)

## 8. Auth & Authorization

```typescript
// Every route MUST have both preHandlers:
fastify.get('/resource', {
  preHandler: [authenticate, requirePermission(PERMISSIONS.RESOURCE_VIEW)],
}, handler)
```

All permission constants: `packages/shared-types/src/permissions.ts`

## 9. Tenant Isolation Rules

1. Every Drizzle query: `.where(eq(table.tenantId, ctx.tenantId))`
2. Report-service raw SQL: `WHERE tenant_id = $tenantId` — no exceptions
3. Elasticsearch: `term: { tenant_id: ctx.tenantId }` filter
4. Redis: `tenant:{tenantId}:` prefix
5. BullMQ jobs: `tenantId` in job data, validated on processing

## 10. Coding Standards

- TypeScript strict mode — no `any`, no unsafe type assertions
- Zod schemas for all route input validation
- No business logic in route handlers
- No DB access outside domain service files
- Money: integers (paise). Dates: UTC ISO 8601
- Drizzle ORM for all DB access (except report-service raw SQL with explicit `tenant_id`)
- ESLint + Prettier enforced — new code must pass without warnings
- No `console.log` — use `packages/logger`
- Errors: throw typed classes from `packages/shared-types/src/errors.ts`
- Error codes: `{MODULE}_{TYPE}` (e.g., `INVOICE_NOT_FOUND`)

## 11. Frontend Design System (Mandatory)

- Tailwind CSS v4 — `@custom-variant dark` directive — do NOT add `darkMode: 'class'` to config
- ThemeContext in `apps/web-frontend/src/context/ThemeContext.tsx` manages `.dark` on `<html>`
- `ERPDataGrid` — never raw `<table>`
- `ERPFormField` + `ERPInput`/`ERPSelect`/`ERPTextarea` — never raw `<input>`
- `ERPConfirmModal` — never raw `<dialog>`
- `ERPSkeleton` — never custom spinners
- `useToast()` — never `window.alert()`
- `ERPPageHeader` — never custom `<h1>`
- `ERPErrorBoundary` wrapping each page
- API calls via React Query — never raw `fetch` in components
- Forms: react-hook-form + Zod resolver

## 12. Testing Strategy

- Unit tests: `{filename}.test.ts` alongside source — Vitest
- Integration tests: `src/__tests__/` — Vitest + real PostgreSQL (Docker)
- E2E: `apps/web-frontend/e2e/` — Playwright
- Coverage: >70% overall, >80% domain layer for new code
- Minimum per change: one success path + one failure path per new service method

## 13. Performance Requirements

- P95 API: < 200ms (list), < 100ms (lookup)
- Reports: < 5s
- Search: < 300ms P95
- Dashboard: < 2s (projections only)
- No N+1 queries

## 14. Security Requirements

- Every route: `authenticate` + `requirePermission`
- Sensitive fields: AES-256-GCM encryption
- `LOGIN_RATE_LIMIT_MAX` ≤ 10 per 15-min window
- No secrets in source code
- Zod at route boundary — no raw user input in SQL

## 15. Mandatory Reads Before Writing Code

```
Read: ERP-PLANNING/TECH_AUDIT.md              <- stack, packages, what NOT to add
Read: ERP-PLANNING/ERP_MASTER_SPEC.md         <- full domain spec
Read: ERP-PLANNING/CODING_STANDARDS.md        <- coding standards
Read: ERP-PLANNING/TEST_CREDENTIALS.md        <- test logins for dev/smoke testing
Read: All files in ERP-PLANNING/phase-completions/  <- previous phase outputs
Read: ENTERPRISE_STABILIZATION_ROADMAP.md     <- full roadmap for cross-phase context
```

---

---

# PHASE ES-02: Outbox Relay Worker & Accounting Infrastructure

```
You are executing ES-02 of the Enterprise Stabilization Roadmap on the NEXORAA Multi-Tenant Cloth Retail ERP.
Read the PROJECT CONTEXT section above completely before writing any code.

═══════════════════════════════════════════
OBJECTIVE
═══════════════════════════════════════════

Implement a persistent outbox relay worker inside apps/event-service that polls outbox_events WHERE
published = false, publishes to Kafka, and marks them published = true. Also auto-seed period_closures
rows when a new Financial Year is created.

WHY: All accounting journal entries (Invoice → Debtor DR/Sales CR, Payment → Bank DR/Debtor CR,
GRN → Inventory DR/AP CR) are never posted because no relay worker runs. Financial statements show
zero for all operational transactions. This is the single most impactful fix in the roadmap.

═══════════════════════════════════════════
SCOPE — IN SCOPE ONLY
═══════════════════════════════════════════

1. New file: apps/event-service/src/outbox/OutboxRelayWorker.ts
   - Implements start() / stop() interface for graceful shutdown
   - Polls outbox_events WHERE published = false ORDER BY created_at LIMIT $BATCH_SIZE every $INTERVAL ms
   - Publishes to Kafka using packages/event-bus-client
   - Marks published = true + published_at = NOW() AFTER successful Kafka produce()
   - Dead-letter: after OUTBOX_MAX_RETRY_ATTEMPTS (default 5) failures, set failed = true, failed_reason
   - Emits Prometheus counter outbox_relay_dead_letter_total via packages/platform-sdk/src/telemetry.ts
   - Uses dedicated PostgreSQL connection (NOT from pool) for LISTEN (added in ES-16; polling only here)
   - Runs as setInterval or async loop — must NOT block the Fastify HTTP event loop

2. New file: apps/event-service/src/outbox/outbox.types.ts
   - Typed outbox event shape

3. apps/event-service/src/main.ts
   - Register OutboxRelayWorker as a startup task; graceful shutdown on SIGTERM

4. GET /health/outbox endpoint in event-service
   - Returns: { status: 'ok'|'degraded', queueDepth: number, lastPublishedAt: string, deadLetterCount: number }

5. apps/accounting-service/src/domain/FinancialYearService.ts
   - Add seedPeriodClosures(financialYearId, startDate, endDate) called after FY creation
   - Creates 12 period_closures rows (one per calendar month in the FY), status = OPEN

6. packages/db-client/src/schema/accounting.ts
   - Verify period_closures table has status column; add if missing

7. Migration: packages/db-client/migrations/0008_es02_period_closures.sql (if schema changes needed)

8. .env.example: add OUTBOX_RELAY_POLL_INTERVAL_MS=500, OUTBOX_RELAY_BATCH_SIZE=100, OUTBOX_MAX_RETRY_ATTEMPTS=5

═══════════════════════════════════════════
ARCHITECTURE RULES
═══════════════════════════════════════════

- Relay worker is a background task started in main.ts — NOT a route handler
- Single instance per pod; rely on Kafka at-least-once + inbox deduplication for exactly-once
- NEVER mark published = true before Kafka produce() returns successfully
- Period closures: one row per calendar month; status = OPEN by default
- Worker MUST survive single Kafka batch failures and continue processing remaining events
- Config: OUTBOX_RELAY_POLL_INTERVAL_MS (default 500ms), OUTBOX_RELAY_BATCH_SIZE (default 100)

═══════════════════════════════════════════
TESTING REQUIREMENTS
═══════════════════════════════════════════

□ Integration test: write event to outbox_events (published=false) → start relay → event published and published=true within 2s
□ Integration test: simulate Kafka failure → retried; after max retries, failed=true
□ Unit test: FinancialYearService.create() for Apr-Mar FY produces exactly 12 period_closures rows with correct boundaries
□ Unit test: creating FY with partial months produces correct monthly start/end dates

═══════════════════════════════════════════
VERIFICATION CHECKLIST
═══════════════════════════════════════════

□ Create test invoice via API → outbox_events row exists with published=false
□ Wait 1-2 seconds → row is now published=true with published_at set
□ Corresponding accounting-service consumer received INVOICE_CONFIRMED event
□ Journal entry row exists in financial_entries for the invoice
□ GET /health/outbox returns 200 with queueDepth: 0 and recent lastPublishedAt
□ Create new Financial Year via API → 12 period_closures rows in DB with status OPEN
□ period_closures rows have correct start_date/end_date per month
□ Worker shuts down gracefully on SIGTERM (finish current batch, no lost events)
□ pnpm test passes in apps/event-service and apps/accounting-service
□ pnpm lint passes with zero warnings

═══════════════════════════════════════════
DEFINITION OF DONE
═══════════════════════════════════════════

□ All published=false events dispatched within 2 seconds of creation
□ New FY auto-generates 12 period_closures rows
□ Health endpoint returns accurate data
□ All integration tests pass
□ No existing tests broken
□ COMPLETION REPORT saved: ERP-PLANNING/phase-completions/ES-02_COMPLETION.md
```

---

---

# PHASE ES-03: Inventory Ledger Integrity

```
You are executing ES-03 of the Enterprise Stabilization Roadmap on the NEXORAA Multi-Tenant Cloth Retail ERP.
Read the PROJECT CONTEXT section above completely before writing any code.
PREREQUISITE: ES-02 should be deployed first (outbox relay running).

═══════════════════════════════════════════
OBJECTIVE
═══════════════════════════════════════════

Fix three bugs where stock movement updates items.available_qty but does NOT write to inventory_ledger:
(1) Invoice confirmation in sales-service, (2) Purchase return approval in purchase-service,
(3) Consignment sales not reducing main warehouse inventory.

WHY: inventory_ledger is the audit source of truth for all stock movements. Required for FIFO/WACC
valuation (ES-13), inventory-to-accounting reconciliation, and stock reports. Every confirmed invoice
since launch has an incomplete stock audit trail.

═══════════════════════════════════════════
SCOPE — IN SCOPE ONLY
═══════════════════════════════════════════

1. apps/sales-service/src/domain/InvoiceService.ts
   - In confirm(): add InventoryLedgerService.recordMovement(STOCK_OUT, ...) for each invoice line
   - The ledger INSERT must be inside the same DB transaction as the available_qty UPDATE
   - Call inventory-service internal API (POST /internal/ledger) — do NOT import inventory-service directly

2. apps/purchase-service/src/domain/PurchaseReturnService.ts
   - In approve(): add InventoryLedgerService.recordMovement(STOCK_IN, ...) inside same transaction

3. apps/inventory-service/src/domain/InventoryLedgerService.ts
   - Verify recordMovement() exists with signature:
     (type: 'STOCK_IN'|'STOCK_OUT'|'ADJUSTMENT', itemId, warehouseId, quantity, unitCost,
      referenceType, referenceId, tenantId, tx?)
   - Extend if needed; create POST /internal/ledger route in inventory-service if not present

4. Consignment sale flow (check apps/production-service/ or apps/sales-service/domain/)
   - Add available_qty reduction + STOCK_OUT ledger entry on consignment sale

5. GRN approval (apps/purchase-service/src/domain/GRNService.ts)
   - Verify if GRN already writes to inventory_ledger; fix if not

═══════════════════════════════════════════
ARCHITECTURE RULES
═══════════════════════════════════════════

- Ledger write MUST be inside the same Drizzle transaction as available_qty update
- If ledger INSERT fails, the entire transaction rolls back (no orphaned qty changes)
- Never call InventoryLedgerService from a route handler — only from domain service
- Cross-service call: sales-service → inventory-service via HTTP (synchronous internal route)
  OR: emit INVOICE_CONFIRMED outbox event and let inventory-service process asynchronously
  PREFERRED: synchronous internal API call within transaction context
- Do NOT share DB connections between services

inventory_ledger schema must have:
  (id, tenant_id, item_id, warehouse_id, movement_type, quantity, unit_cost,
   reference_type, reference_id, created_at, created_by)

═══════════════════════════════════════════
TESTING REQUIREMENTS
═══════════════════════════════════════════

□ Integration test: confirm invoice → inventory_ledger has STOCK_OUT row per line with correct qty + reference_id
□ Integration test: approve purchase return → inventory_ledger has STOCK_IN row
□ Integration test: simulate ledger INSERT failure → invoice confirmation rolls back, available_qty unchanged
□ Unit test: InventoryLedgerService.recordMovement() with valid params inserts correct row

═══════════════════════════════════════════
VERIFICATION CHECKLIST
═══════════════════════════════════════════

□ Confirm invoice → SELECT * FROM inventory_ledger WHERE reference_id = {invoiceId} returns one row per line
□ Each row: movement_type = 'STOCK_OUT', correct quantity, non-null unit_cost
□ Approve purchase return → inventory_ledger rows with movement_type = 'STOCK_IN'
□ items.available_qty matches sum computed from inventory_ledger for a test item
□ Simulate ledger failure (throw in recordMovement) → invoice confirmation fails, qty unchanged
□ GRN approval writes to inventory_ledger (verify or fix)
□ pnpm test passes in apps/sales-service, apps/purchase-service, apps/inventory-service
□ pnpm lint passes

═══════════════════════════════════════════
DEFINITION OF DONE
═══════════════════════════════════════════

□ Every confirmed invoice has corresponding STOCK_OUT rows in inventory_ledger
□ Every approved purchase return has STOCK_IN rows
□ Ledger write failure causes transaction rollback
□ All integration tests pass
□ COMPLETION REPORT saved: ERP-PLANNING/phase-completions/ES-03_COMPLETION.md
```

---

---

# PHASE ES-04: Database Migration Completeness

```
You are executing ES-04 of the Enterprise Stabilization Roadmap on the NEXORAA Multi-Tenant Cloth Retail ERP.
Read the PROJECT CONTEXT section above completely before writing any code.
This phase is INDEPENDENT — no other phases needed first.

═══════════════════════════════════════════
OBJECTIVE
═══════════════════════════════════════════

Generate the missing Drizzle ORM migration files for all tables defined in schema/production.ts
and schema/report.ts that have no corresponding migration SQL, and verify on a clean PostgreSQL DB.

WHY: job_work_orders, barcode_batches, barcodes, consignment_stocks, consignment_settlements,
report_schedules, and report_run_history are defined in schema but have no migration SQL. On any
fresh production deployment, these tables will not exist, causing runtime crashes.

═══════════════════════════════════════════
SCOPE — IN SCOPE ONLY
═══════════════════════════════════════════

1. Run: pnpm drizzle-kit generate
   - Review generated SQL carefully — MUST only contain CREATE TABLE IF NOT EXISTS and CREATE INDEX IF NOT EXISTS
   - REJECT if it contains ALTER TABLE, DROP, or TRUNCATE on existing tables

2. Commit generated migration as: packages/db-client/migrations/0008_es04_phase10_11_tables.sql
   (Note: If ES-02 already created 0008_*, use 0009_ for this migration)

3. Verify migration on clean postgres:16 Docker container
   - All 7 target tables exist: job_work_orders, barcode_batches, barcodes,
     consignment_stocks, consignment_settlements, report_schedules, report_run_history
   - Each table has tenant_id column + index on (tenant_id)

4. Start apps/production-service and apps/report-service against migrated DB
   - Both start without "relation does not exist" errors

═══════════════════════════════════════════
ARCHITECTURE RULES
═══════════════════════════════════════════

- Migrations are APPEND-ONLY — never edit existing migration files
- Naming: {sequence}_{description}.sql
- All new tables must have: id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id UUID NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW()
- All new tables must have: CREATE INDEX IF NOT EXISTS idx_{table}_tenant_id ON {table}(tenant_id)
- Do NOT hand-write migration SQL — use drizzle-kit generate

═══════════════════════════════════════════
TESTING REQUIREMENTS
═══════════════════════════════════════════

□ Apply migrations on fresh postgres:16 Docker container — all tables created successfully
□ SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' — all 7 tables present
□ apps/production-service starts cleanly
□ apps/report-service starts cleanly
□ Existing migrations 0000-0007 still apply in sequence without errors

═══════════════════════════════════════════
VERIFICATION CHECKLIST
═══════════════════════════════════════════

□ pnpm drizzle-kit generate completes without errors
□ Generated migration: only CREATE TABLE IF NOT EXISTS + CREATE INDEX IF NOT EXISTS (no ALTER, DROP)
□ All 7 tables exist in migrated DB
□ Each new table has tenant_id column and index
□ apps/production-service starts cleanly after migration
□ apps/report-service starts cleanly after migration
□ Existing migration files 0000-0007 are UNMODIFIED (git diff confirms)

═══════════════════════════════════════════
DEFINITION OF DONE
═══════════════════════════════════════════

□ Migration committed and applies cleanly on fresh DB
□ All 7 tables exist with correct schema
□ Both services start without errors
□ COMPLETION REPORT saved: ERP-PLANNING/phase-completions/ES-04_COMPLETION.md
```

---

---

# PHASE ES-05: Report Tenant Isolation & Core Financial Reports

```
You are executing ES-05 of the Enterprise Stabilization Roadmap on the NEXORAA Multi-Tenant Cloth Retail ERP.
Read the PROJECT CONTEXT section above completely before writing any code.
PREREQUISITE: ES-02 complete (financial_entries must contain real data for meaningful results).

═══════════════════════════════════════════
OBJECTIVE
═══════════════════════════════════════════

Audit all raw SQL queries in ReportEngine.ts for missing tenant_id filters (cross-tenant data exposure
risk), then implement AR Aging Summary and AP Aging Summary reports.

WHY: report-service uses raw db.execute(sql`...`) queries. If any query is missing WHERE tenant_id,
a tenant can see another tenant's financial data. AR/AP Aging are the two most critical financial
management reports — completely absent, preventing overdue tracking.

═══════════════════════════════════════════
SCOPE — IN SCOPE ONLY
═══════════════════════════════════════════

1. apps/report-service/src/domain/ReportEngine.ts
   - Enumerate ALL raw SQL queries in the file
   - For each: confirm WHERE tenant_id = ${ctx.tenantId} exists; add if missing
   - Add comment // ✓ tenant_id filtered above each confirmed query

2. apps/report-service/src/__tests__/report-tenant-isolation.test.ts
   - Parameterized tests for each query: two-tenant setup, query tenant A returns ONLY tenant A data

3. AR Aging Summary report
   - SQL: join invoices + payments, compute outstanding per customer, bucket by days since invoice_date
     Buckets: 0-30, 31-60, 61-90, 90+ days; outstanding = total_amount - paid_amount
   - Only include: outstanding_balance > 0 AND status NOT IN ('CANCELLED', 'DRAFT')
   - Endpoint: GET /api/v1/reports/ar-aging?asOf=2026-07-01 (defaults to today)
   - Frontend: apps/web-frontend/src/pages/reports/ArAgingPage.tsx

4. AP Aging Summary report (same pattern for suppliers)
   - Endpoint: GET /api/v1/reports/ap-aging?asOf=2026-07-01
   - Frontend: apps/web-frontend/src/pages/reports/ApAgingPage.tsx

5. Register new routes in apps/report-service/src/api/report.routes.ts
6. Register page routes in apps/web-frontend/src/App.tsx
   - /reports/ar-aging → ArAgingPage
   - /reports/ap-aging → ApAgingPage

═══════════════════════════════════════════
ARCHITECTURE RULES
═══════════════════════════════════════════

- tenant_id filter MUST be in SQL WHERE clause — not post-query JavaScript filter
- Aging SQL: CASE WHEN (NOW()::date - invoice_date) BETWEEN 0 AND 30 THEN outstanding_amount ELSE 0 END AS bucket_0_30
- As-of date: WHERE invoice_date <= $asOfDate (index-compatible)
- Outstanding: invoice_total_amount - COALESCE(paid_amount, 0)
- Read from write model tables (invoices, financial_entries) — not projections

═══════════════════════════════════════════
UI/UX RULES
═══════════════════════════════════════════

- Both pages: ERPDataGrid columns: Name, 0-30 Days (₹), 31-60 Days (₹), 61-90 Days (₹), 90+ Days (₹), Total Outstanding (₹)
- Filter bar: as-of date picker (defaults to today) + branch filter
- Totals row at bottom using ERPDataGrid footer
- Export to CSV button
- Indian number format (lakhs/crores) for currency display
- Both pages accessible from sidebar navigation

═══════════════════════════════════════════
TESTING REQUIREMENTS
═══════════════════════════════════════════

□ Tenant isolation: create tenant A + B with separate invoices; query AR aging as tenant A → zero rows from tenant B
□ AR Aging: create invoices aged 10, 45, 75, 95 days → each in correct bucket
□ AP Aging: same pattern for supplier invoices
□ Edge case: fully paid invoice NOT in aging
□ Edge case: partially paid invoice shows remaining balance only

═══════════════════════════════════════════
VERIFICATION CHECKLIST
═══════════════════════════════════════════

□ All queries in ReportEngine.ts have // ✓ tenant_id filtered comment or a fix applied
□ Tenant isolation test: tenant A query returns zero tenant B rows
□ GET /api/v1/reports/ar-aging?asOf=2026-07-01 returns correct buckets for test data
□ GET /api/v1/reports/ap-aging returns correct buckets
□ ArAgingPage.tsx renders with ERPDataGrid, filter bar, totals row
□ ApAgingPage.tsx renders similarly
□ Export to CSV downloads correct data
□ pnpm test passes in apps/report-service
□ pnpm lint passes

═══════════════════════════════════════════
DEFINITION OF DONE
═══════════════════════════════════════════

□ Zero raw SQL queries missing tenant_id filters
□ AR and AP aging return correct bucket data
□ Both pages render correctly in browser
□ All tests pass
□ COMPLETION REPORT saved: ERP-PLANNING/phase-completions/ES-05_COMPLETION.md
```

---

---

# PHASE ES-06: HR Payroll Correctness & Data Security

```
You are executing ES-06 of the Enterprise Stabilization Roadmap on the NEXORAA Multi-Tenant Cloth Retail ERP.
Read the PROJECT CONTEXT section above completely before writing any code.
This phase is INDEPENDENT — no other phases needed first.

═══════════════════════════════════════════
OBJECTIVE
═══════════════════════════════════════════

Encrypt payslip salary columns stored in plain text, add a guard preventing silent zero-salary
payroll for employees without salary structure, add individual payslip view, and implement
Holiday Calendar master.

WHY: payrollSlips.grossSalary and netSalary are plain decimal while employeeSalaries is encrypted —
inconsistency exposing salary history. Payroll silently produces zero results for employees without
a salary structure. Individual payslips are inaccessible from the UI.

═══════════════════════════════════════════
SCOPE — IN SCOPE ONLY
═══════════════════════════════════════════

1. packages/db-client/src/schema/hr.ts
   - Change grossSalary/netSalary column type to AES-256-GCM encrypted text
   - Add holiday_calendars table: (id, tenant_id, name, holiday_date, holiday_type, branch_id, created_at)
   - Add index: (tenant_id, holiday_date) on holiday_calendars

2. packages/db-client/migrations/0009_es06_hr_encryption_holidays.sql (new migration)
   - Include one-time data migration to encrypt existing plaintext payslip rows
   - IMPORTANT: Document in runbook — backup payroll_slips before applying this migration

3. apps/hr-service/src/domain/PayrollEngine.ts
   - Add guard: if (!employee.salaryStructureId) throw new ERPError('PAYROLL_NO_SALARY_STRUCTURE', ..., 422)
   - Add decrypt on read for grossSalary/netSalary (callers receive plain values)
   - Use EXISTING encryption utility from packages/platform-sdk or packages/shared-utils (do NOT create new one)
   - Encryption key: FIELD_ENCRYPTION_KEY env var

4. apps/hr-service/src/api/payroll.routes.ts
   - Add GET /api/v1/hr/payroll-slips/:id endpoint (verify belongs to tenant before returning)

5. New: apps/hr-service/src/api/holiday.routes.ts
   - CRUD endpoints for holiday calendar (GET list, POST create, DELETE)

6. apps/web-frontend/src/pages/hr/PayrollPage.tsx
   - Add "View Payslip" action per employee row

7. New: apps/web-frontend/src/pages/hr/PayslipViewPage.tsx
   - Printer-friendly layout: employee name, designation, pay period, earnings breakdown,
     deductions, gross/net salary, employer PF contribution
   - Print button: browser window.print()

8. New: apps/web-frontend/src/pages/hr/HolidayCalendarPage.tsx
   - ERPDataGrid: Holiday Name, Date, Type (National/State/Optional), Branch
   - Add Holiday button + seed button for 2026-27 Indian national holidays

9. apps/web-frontend/src/App.tsx — register new page routes

═══════════════════════════════════════════
ARCHITECTURE RULES
═══════════════════════════════════════════

- Encryption/decryption in domain service layer — NOT in route handler or repository
- Holiday calendar follows same CRUD pattern as other hr-service master tables
- GET /payroll-slips/:id must verify tenant ownership before returning
- Data migration for encryption: run as Node.js script (NOT SQL) with dry-run mode
  that reads + verifies decryption before writing (safer than in-DB encryption)

═══════════════════════════════════════════
TESTING REQUIREMENTS
═══════════════════════════════════════════

□ Unit test: PayrollEngine throws PAYROLL_NO_SALARY_STRUCTURE when employee has no structure
□ Integration test: run payroll → payrollSlips.grossSalary stored encrypted (raw DB value is NOT a plain number)
□ Integration test: GET /payroll-slips/:id returns decrypted gross/net salary values
□ Integration test: create holiday, run leave calculation on that day → leave balance not consumed

═══════════════════════════════════════════
VERIFICATION CHECKLIST
═══════════════════════════════════════════

□ SELECT gross_salary FROM payroll_slips LIMIT 1 in psql → returns encrypted ciphertext (not a number)
□ GET /api/v1/hr/payroll-slips/{id} → returns { grossSalary: 50000, netSalary: 45000 } (decrypted)
□ Run payroll for employee with no salary structure → 422 PAYROLL_NO_SALARY_STRUCTURE
□ PayslipViewPage.tsx renders with salary components + print button
□ HolidayCalendarPage.tsx renders with add/delete holiday functionality
□ Existing payroll run works for employees with valid salary structures
□ New migration applies cleanly; existing plaintext rows migrated to encrypted form
□ pnpm test passes in apps/hr-service
□ pnpm lint passes

═══════════════════════════════════════════
DEFINITION OF DONE
═══════════════════════════════════════════

□ Salary data encrypted at rest in payroll_slips
□ Payroll fails clearly (not silently) for employees without salary structure
□ Individual payslip viewable in UI
□ Holiday calendar manageable by HR admin
□ COMPLETION REPORT saved: ERP-PLANNING/phase-completions/ES-06_COMPLETION.md
```

---

---

# PHASE ES-07: RBAC & Permission Hardening

```
You are executing ES-07 of the Enterprise Stabilization Roadmap on the NEXORAA Multi-Tenant Cloth Retail ERP.
Read the PROJECT CONTEXT section above completely before writing any code.
This phase is INDEPENDENT — no other phases needed first.

═══════════════════════════════════════════
OBJECTIVE
═══════════════════════════════════════════

Define 7 missing RBAC permission constants and add them as requirePermission() preHandlers on
the specific routes they protect.

WHY: 7 permissions are missing from permissions.ts — VIEW_AUDIT_LOG, CREDIT_LIMIT_OVERRIDE,
PRICE_FLOOR_OVERRIDE, CANCEL_POSTED_JOURNAL, VIEW_SALARY_DETAILS, IMPERSONATE_USER, and
EXPORT_CUSTOMER_DATA. Without these, any authenticated user can override credit limits, reverse
posted journals, view all salaries, and export all customer data.

═══════════════════════════════════════════
SCOPE — IN SCOPE ONLY
═══════════════════════════════════════════

1. packages/shared-types/src/permissions.ts
   - Add 7 new constants: VIEW_AUDIT_LOG, CREDIT_LIMIT_OVERRIDE, PRICE_FLOOR_OVERRIDE,
     CANCEL_POSTED_JOURNAL, VIEW_SALARY_DETAILS, IMPERSONATE_USER, EXPORT_CUSTOMER_DATA

2. Add requirePermission guards to existing routes:
   - apps/sales-service/src/api/invoice.routes.ts
     → credit limit bypass route: requirePermission(PERMISSIONS.CREDIT_LIMIT_OVERRIDE)
     → price-below-cost override route: requirePermission(PERMISSIONS.PRICE_FLOOR_OVERRIDE)
   - apps/sales-service/src/api/customer.routes.ts
     → export endpoint: requirePermission(PERMISSIONS.EXPORT_CUSTOMER_DATA)
   - apps/accounting-service/src/api/journal.routes.ts
     → reversal route: requirePermission(PERMISSIONS.CANCEL_POSTED_JOURNAL)
   - apps/hr-service/src/api/payroll.routes.ts
     → payroll detail routes: requirePermission(PERMISSIONS.VIEW_SALARY_DETAILS)
   - apps/auth-service/src/ (if impersonation endpoint exists)
     → requirePermission(PERMISSIONS.IMPERSONATE_USER)
   - Audit log routes (if they exist)
     → requirePermission(PERMISSIONS.VIEW_AUDIT_LOG)

3. Locate role seeding file in apps/tenant-service/src/
   - Assign new permissions to appropriate roles:
     CREDIT_LIMIT_OVERRIDE → SALES_MANAGER, ADMIN
     PRICE_FLOOR_OVERRIDE → SALES_MANAGER, ADMIN
     CANCEL_POSTED_JOURNAL → ACCOUNTANT_SUPERVISOR, ADMIN
     VIEW_SALARY_DETAILS → HR_MANAGER, ADMIN
     EXPORT_CUSTOMER_DATA → ADMIN, DATA_OFFICER
     VIEW_AUDIT_LOG → ADMIN, AUDITOR
     IMPERSONATE_USER → SUPER_ADMIN

═══════════════════════════════════════════
ARCHITECTURE RULES
═══════════════════════════════════════════

- Permission order: preHandler: [authenticate, requirePermission(PERMISSIONS.X)]
  authenticate is FIRST, requirePermission is SECOND
- Permission checks at route layer — NOT inside domain services
- Domain services trust that the caller is already authorized
- Do NOT combine multiple permissions in one requirePermission call

═══════════════════════════════════════════
TESTING REQUIREMENTS
═══════════════════════════════════════════

Minimum 14 integration tests (7 permissions × 2 scenarios):
□ Each protected route: user WITHOUT permission → 403
□ Each protected route: user WITH permission → 200 / expected response
□ Admin role: can access all newly protected routes

═══════════════════════════════════════════
VERIFICATION CHECKLIST
═══════════════════════════════════════════

□ packages/shared-types/src/permissions.ts contains all 7 new constants
□ GET /api/v1/hr/payroll-runs/{id}/details → 403 for user without VIEW_SALARY_DETAILS
□ POST /api/v1/accounting/journals/{id}/reverse → 403 for user without CANCEL_POSTED_JOURNAL
□ Credit limit override route → 403 for user without CREDIT_LIMIT_OVERRIDE
□ All 14 permission integration tests pass
□ Admin role can access all new protected routes
□ pnpm test passes in all affected services
□ No existing authorized workflows broken
□ pnpm lint passes

═══════════════════════════════════════════
DEFINITION OF DONE
═══════════════════════════════════════════

□ All 7 permissions defined and wired to routes
□ Integration tests confirm 403 unauthorized / 200 authorized
□ No existing workflows broken for users with appropriate roles
□ COMPLETION REPORT saved: ERP-PLANNING/phase-completions/ES-07_COMPLETION.md
```

---

---

# PHASE ES-08: Sales Workflow Completeness

```
You are executing ES-08 of the Enterprise Stabilization Roadmap on the NEXORAA Multi-Tenant Cloth Retail ERP.
Read the PROJECT CONTEXT section above completely before writing any code.
PREREQUISITES: ES-02 (outbox relay running), ES-03 (inventory ledger writing).

═══════════════════════════════════════════
OBJECTIVE
═══════════════════════════════════════════

Complete four sales workflow gaps: Customer PDC management, auto-price-list assignment by customer
group, auto-email invoice PDF on confirmation, and Quotation-to-Delivery-Challan direct conversion.

═══════════════════════════════════════════
SCOPE — IN SCOPE ONLY
═══════════════════════════════════════════

1. PDC Management (Post-Dated Cheques)
   - packages/db-client/src/schema/sales.ts: add customer_pdcs table
     (id, tenant_id, customer_id, cheque_number, bank_name, ifsc_code, amount_paise,
      cheque_date, status, remarks, created_by, created_at, updated_at)
   - Status machine: PENDING → PRESENTED → CLEARED | BOUNCED | CANCELLED
   - Index: (tenant_id, cheque_date, status)
   - Migration: packages/db-client/migrations/0010_es08_customer_pdcs.sql
   - apps/sales-service/src/api/pdc.routes.ts (CRUD for PDCs)
   - apps/scheduler-service/src/jobs/system-jobs.ts: daily PDC auto-clear job at 00:30 IST
     Query: customer_pdcs WHERE cheque_date = TODAY AND status = PENDING → update to PRESENTED
   - New page: apps/web-frontend/src/pages/sales/CustomerPdcPage.tsx
     ERPDataGrid: Cheque Number, Bank, Amount, Cheque Date, Customer Name, Status

2. Price List Auto-Assign
   - apps/sales-service/src/domain/InvoiceService.ts in create():
     When customerId provided → look up customer.customerGroupId → customerGroup.priceListId
     Auto-set priceListId on invoice lines (single DB join, no extra round-trip)
     Priority: customer.priceListId first → customerGroup.priceListId fallback → default
   - Invoice creation still works when customer has no group (no crash, no auto-assign)

3. Auto-Email Invoice PDF on Confirmation
   - apps/sales-service/src/domain/InvoiceService.ts in confirm():
     Emit INVOICE_PDF_EMAIL outbox event (async — do NOT make sync HTTP call to notification-service)
     Payload: { invoiceId, customerId, customerEmail, customerName, tenantId, pdfUrl }
   - apps/notification-service/src/: add consumer for INVOICE_PDF_EMAIL event
     Read all email data from event payload — do NOT call back to sales-service

4. Quotation-to-Delivery-Challan Conversion
   - apps/sales-service/src/domain/QuotationService.ts:
     Add convertToDeliveryChallan(quotationId) method
     Quotation must be in ACCEPTED status — throw QUOTATION_INVALID_STATUS otherwise
     Copy lines to delivery challan; set sourceQuotationId on the new delivery challan
   - apps/sales-service/src/api/quotation.routes.ts: add conversion endpoint
   - apps/web-frontend/src/pages/sales/QuotationDetailPage.tsx:
     Add "Convert to Delivery Challan" button — visible only when status = ACCEPTED
     Show confirmation modal before converting; after success: navigate to new delivery challan

═══════════════════════════════════════════
TESTING REQUIREMENTS
═══════════════════════════════════════════

□ Unit test: InvoiceService.create() with customer in group G1 (price list P1) → auto-assigns P1
□ Unit test: QuotationService.convertToDeliveryChallan() on ACCEPTED quotation → delivery challan with same lines
□ Unit test: converting DRAFT quotation → throws QUOTATION_INVALID_STATUS
□ Integration test: confirm invoice → outbox_events has INVOICE_PDF_EMAIL event with customer email
□ Integration test: PDC auto-clear job → PDCs with today's cheque_date set to PRESENTED

═══════════════════════════════════════════
VERIFICATION CHECKLIST
═══════════════════════════════════════════

□ Create invoice for customer in group G1 → invoice lines use G1 price list automatically
□ Confirm invoice → outbox_events has INVOICE_PDF_EMAIL event with customer email in payload
□ Notification-service processes event and sends email (check notification logs)
□ Create PDC → appears in CustomerPdcPage list
□ Trigger PDC auto-clear manually → PDCs with today's date change to PRESENTED
□ Accept quotation → "Convert to Delivery Challan" button visible on detail page
□ Click button → delivery challan created with same line items
□ pnpm test passes in apps/sales-service and apps/scheduler-service
□ pnpm lint passes

═══════════════════════════════════════════
DEFINITION OF DONE
═══════════════════════════════════════════

□ Price list auto-assigned on invoice creation for customers with group price list
□ Invoice confirmation triggers email dispatch
□ PDCs created, tracked, and auto-cleared
□ Accepted quotations converted to delivery challans in one click
□ COMPLETION REPORT saved: ERP-PLANNING/phase-completions/ES-08_COMPLETION.md
```

---

---

# PHASE ES-09: Purchase Workflow & GRNI Accounting

```
You are executing ES-09 of the Enterprise Stabilization Roadmap on the NEXORAA Multi-Tenant Cloth Retail ERP.
Read the PROJECT CONTEXT section above completely before writing any code.
PREREQUISITES: ES-02 (outbox relay), ES-03 (inventory ledger), ES-07 (CREDIT_LIMIT_OVERRIDE permission).

═══════════════════════════════════════════
OBJECTIVE
═══════════════════════════════════════════

Implement GRNI (Goods Received Not Invoiced) accrual accounting and vendor credit limit check
on Purchase Order creation.

WHY: Without GRNI accrual, balance sheet understates liabilities when goods received but supplier
invoice not yet processed. POs can be raised against vendors without any spend limit validation.

═══════════════════════════════════════════
SCOPE — IN SCOPE ONLY
═══════════════════════════════════════════

1. apps/purchase-service/src/domain/GRNService.ts
   - On GRN approval: emit GRN_APPROVED outbox event INSIDE the approval transaction
     Payload: { grnId, supplierId, totalValuePaise, lineItems, tenantId }

2. apps/accounting-service/src/consumers/GRNAccountingConsumer.ts
   - Consume GRN_APPROVED event
   - Post GRNI accrual journal: Inventory DR / GRNI Accrual Payable CR
   - Use PostingMatrixService for account code resolution (entry type: GRN_RECEIVED)
   - Add GRN_RECEIVED entry to default posting matrix seed data if missing
   - Inbox deduplication: check inbox_events by event_id before processing

3. GRNI Reversal on Supplier Invoice Match
   - When purchase invoice matched to GRN → emit SUPPLIER_INVOICE_MATCHED event
   - Consumer: reverse the GRNI accrual (GRNI Accrual Payable DR / Accounts Payable CR)

4. Vendor Credit Limit Check
   - packages/db-client/src/schema/purchase.ts: add credit_limit_paise BIGINT DEFAULT 0 to suppliers
   - Migration: packages/db-client/migrations/0011_es09_grni_vendor_credit.sql
   - apps/purchase-service/src/domain/PurchaseOrderService.ts in create():
     Compare (vendor.outstandingBalance + newPOTotal) against vendor.creditLimit
     Throw VENDOR_CREDIT_LIMIT_EXCEEDED if exceeded
   - Route handler: check request.auth.permissions.includes(PERMISSIONS.CREDIT_LIMIT_OVERRIDE)
     and pass bypassCreditLimit flag to service if authorized
   - Service must NOT check permissions directly

5. apps/web-frontend/src/pages/suppliers/SupplierFormPage.tsx
   - Add "Credit Limit" field (INR amount input, optional)
   - Show warning banner on PO creation form if vendor > 80% credit utilization

═══════════════════════════════════════════
ARCHITECTURE RULES
═══════════════════════════════════════════

- GRNI accrual in accounting-service as Kafka consumer — NOT in purchase-service
- GRNI reversal triggered by SUPPLIER_INVOICE_MATCHED event
- Credit limit check: query outstanding balance dynamically — do NOT cache
- GRN_APPROVED outbox event emitted INSIDE the GRN approval DB transaction

═══════════════════════════════════════════
TESTING REQUIREMENTS
═══════════════════════════════════════════

□ Integration test: approve GRN → outbox_events has GRN_APPROVED; accounting-service posts GRNI accrual journal
□ Integration test: match supplier invoice to GRN → GRNI accrual is reversed
□ Unit test: PurchaseOrderService.create() with vendor at 110% credit → throws VENDOR_CREDIT_LIMIT_EXCEEDED
□ Unit test: same scenario with bypassCreditLimit = true → PO created successfully

═══════════════════════════════════════════
VERIFICATION CHECKLIST
═══════════════════════════════════════════

□ Approve GRN → SELECT * FROM financial_entries WHERE reference_id = {grnId} shows Inventory DR / GRNI Accrual CR
□ Match supplier invoice → GRNI accrual reversed in financial_entries
□ Create PO for vendor over credit limit → 422 VENDOR_CREDIT_LIMIT_EXCEEDED
□ Admin with CREDIT_LIMIT_OVERRIDE can create PO past limit
□ SupplierFormPage shows credit limit field and saves correctly
□ pnpm test passes in apps/purchase-service and apps/accounting-service
□ pnpm lint passes

═══════════════════════════════════════════
DEFINITION OF DONE
═══════════════════════════════════════════

□ GRN approval results in GRNI accrual journal in GL
□ Supplier invoice matching reverses the accrual correctly
□ POs against over-limit vendors rejected by default
□ Admin can override with CREDIT_LIMIT_OVERRIDE permission
□ COMPLETION REPORT saved: ERP-PLANNING/phase-completions/ES-09_COMPLETION.md
```

---

---

# PHASE ES-10: GST Compliance — Cess, RCM, GSTR-9

```
You are executing ES-10 of the Enterprise Stabilization Roadmap on the NEXORAA Multi-Tenant Cloth Retail ERP.
Read the PROJECT CONTEXT section above completely before writing any code.
PREREQUISITE: ES-02 (outbox relay running for GSTR-9 journal aggregation).

═══════════════════════════════════════════
OBJECTIVE
═══════════════════════════════════════════

Implement three GST compliance gaps: Compensation Cess calculation, Reverse Charge Mechanism
(RCM) self-invoice generation, and GSTR-9 Annual Return report generation.

WHY: Cess must be charged on applicable HSN codes (legal obligation — under-collection = penalty).
RCM requires buyer self-invoicing for specified services. GSTR-9 is mandatory annual filing.

═══════════════════════════════════════════
SCOPE — IN SCOPE ONLY
═══════════════════════════════════════════

1. packages/db-client/src/schema/gst.ts
   - Add cess_rate DECIMAL(5,2) DEFAULT 0 to gst_rates table (if missing)
   - Add is_rcm_applicable BOOLEAN DEFAULT false to gst_rates table
   - Add cess_amount_paise BIGINT DEFAULT 0 to invoice_lines table
   - Add document_type VARCHAR(30) DEFAULT 'STANDARD' to purchase_invoices table
   - Migration: packages/db-client/migrations/0012_es10_gst_cess_rcm.sql

2. GSTCalculator.ts (update ALL THREE — gst-service, sales-service, purchase-service)
   - Add cess calculation: cessAmount = taxable_value × cess_rate (result in paise)
   - Share core cess formula in packages/shared-utils/ for consistency
   - Invoice total: taxable_value + cgst + sgst + igst + cess_amount
   - Cess rate lookup: gst_rates.cess_rate for the line's HSN code; default 0 if not found

3. apps/purchase-service/src/domain/RCMService.ts (new file)
   - On purchase invoice for RCM-applicable service:
     Auto-create self-invoice with document_type = 'RCM_SELF_INVOICE'
     Link to original purchase invoice; set rcm_eligible_for_itc = true

4. apps/gst-service/src/domain/Gstr9Service.ts (new file)
   - Aggregate GSTR-1 and GSTR-3B data across all periods of a financial year
   - Implement GSTN Table sections 4, 5, 6, 7, 8, 9, 10, 11 (computable sections)
   - Mark remaining tables as "manual entry required"
   - Read-only aggregation — cache result in report_run_history

5. apps/gst-service/src/api/gstr9.routes.ts
   - GET /api/v1/gst/gstr9?financialYear=2025-26

6. New: apps/web-frontend/src/pages/gst/Gstr9Page.tsx
   - Financial year selector → "Generate GSTR-9" button → loading → display all GSTR-9 tables

7. apps/web-frontend/src/pages/sales/InvoiceFormPage.tsx
   - Add Cess column to line items table (read-only, auto-computed)

8. apps/web-frontend/src/App.tsx — register GSTR-9 route

═══════════════════════════════════════════
ARCHITECTURE RULES
═══════════════════════════════════════════

- All three GSTCalculator instances MUST produce identical cess for same input
- RCM detection: check gst_rates.is_rcm_applicable flag — do NOT hardcode HSN codes
- GSTR-9: read-only aggregation — no business writes except report_run_history cache

═══════════════════════════════════════════
TESTING REQUIREMENTS
═══════════════════════════════════════════

□ Unit test: GSTCalculator with cess_rate=3% on ₹10,000 item → cessAmount = 30,000 paise
□ Unit test: GSTCalculator with cess_rate=0 → zero cess
□ Integration test: purchase invoice for RCM service → self-invoice auto-created with document_type = 'RCM_SELF_INVOICE'
□ Integration test: GET /api/v1/gst/gstr9?financialYear=2025-26 → correct aggregate data

═══════════════════════════════════════════
VERIFICATION CHECKLIST
═══════════════════════════════════════════

□ Create invoice line with cess_rate=3% HSN → invoice shows cess = 3% of taxable value
□ invoice_lines.cess_amount_paise stored correctly in DB
□ InvoiceFormPage shows Cess column with auto-computed values
□ Create purchase invoice for GTA service (RCM) → self-invoice created with document_type = 'RCM_SELF_INVOICE'
□ GET /api/v1/gst/gstr9?financialYear=2025-26 → 200 with GSTR-9 tables
□ Gstr9Page renders with financial year selector and table data
□ Existing invoices without cess (cess_rate=0) → totals unaffected
□ pnpm test passes in apps/gst-service, apps/sales-service, apps/purchase-service
□ pnpm lint passes

═══════════════════════════════════════════
DEFINITION OF DONE
═══════════════════════════════════════════

□ Invoice lines for cess-applicable HSN codes show and store correct cess
□ RCM purchase invoices auto-generate self-invoices
□ GSTR-9 computable for a full financial year
□ COMPLETION REPORT saved: ERP-PLANNING/phase-completions/ES-10_COMPLETION.md
```

---

---

# PHASE ES-11: NIC e-Invoice & e-Way Bill Integration

```
You are executing ES-11 of the Enterprise Stabilization Roadmap on the NEXORAA Multi-Tenant Cloth Retail ERP.
Read the PROJECT CONTEXT section above completely before writing any code.
PREREQUISITE: ES-10 complete (cess in invoice totals; NIC validates total including cess).
EXTERNAL DEPENDENCY: NIC sandbox credentials required (obtain from NIC/GSTN portal).

═══════════════════════════════════════════
OBJECTIVE
═══════════════════════════════════════════

Replace stub implementations of e-Invoice IRN generation and e-Way Bill with real NIC API
integrations. Block invoice confirmation for eligible tenants when IRN fails.

WHY: For turnover > ₹5 Cr, every confirmed B2B invoice without a valid IRN is legally non-compliant.
Current stub silently returns mock IRNs. This exposes clients to GST penalties and ITC cancellation.

═══════════════════════════════════════════
SCOPE — IN SCOPE ONLY
═══════════════════════════════════════════

1. apps/gst-service/src/domain/EInvoiceService.ts
   - Replace stub with real NIC IRP API calls
   - All calls: 10-second timeout; NIC errors logged in full, sanitized message to client
   - NIC OAuth token: store in Redis with TTL matching NIC token expiry (~6 hours)
     Before each NIC call: check Redis for cached token; re-authenticate if missing/expired

2. apps/gst-service/src/domain/EwayBillService.ts
   - Replace stub with real NIC e-Way Bill API
   - Auto-generate when invoice.isInterState && invoice.totalValuePaise > 5_000_000 (₹50,000)

3. apps/gst-service/src/api/einvoice.routes.ts
   - Add POST /api/v1/gst/einvoice/{irnNumber}/cancel

4. packages/db-client/src/schema/gst.ts
   - Add e_invoice_eligible BOOLEAN DEFAULT false to gst_configs
   - Add irn_number VARCHAR(64), irn_ack_number VARCHAR(64), irn_qr_code TEXT (encrypted),
     irn_status VARCHAR(20), irn_generated_at TIMESTAMPTZ to invoices table
   - Add eway_bill_number VARCHAR(20), eway_bill_valid_until TIMESTAMPTZ to invoices
   - Migration: packages/db-client/migrations/0013_es11_einvoice_fields.sql

5. apps/sales-service/src/domain/InvoiceService.ts
   - In confirm(): if (tenant.gstConfig.eInvoiceEligible && invoice.isB2B) → call gst-service
     Internal SYNCHRONOUS call (not outbox event) — invoice must not confirm without IRN
     On IRN failure: throw ERPError('EINVOICE_IRN_FAILED', nicErrorMessage, 502)
     Invoice remains in DRAFT status on failure
   - Non-eligible tenants: skip IRN call entirely

6. apps/web-frontend/src/pages/gst/EInvoicePage.tsx
   - REMOVE the STUB warning banner (added in ES-01)
   - Show: IRN number, acknowledgement number, QR code image, generation timestamp
   - Status badges: GENERATED (green), PENDING (amber), FAILED (red), CANCELLED (gray)
   - Failed IRN: show NIC error message + "Retry" button
   - QR code: display as scannable image from base64 returned by NIC

7. .env.example
   - Add NIC_API_BASE_URL, NIC_CLIENT_ID, NIC_CLIENT_SECRET, NIC_SANDBOX_MODE

═══════════════════════════════════════════
ARCHITECTURE RULES
═══════════════════════════════════════════

- IRN generation: SYNCHRONOUS call to gst-service internal API (not outbox)
- Non-eligible tenants (gst_configs.e_invoice_eligible = false): skip entirely
- NIC tokens are separate from ERP JWTs — OAuth tokens managed in Redis
- Retry logic: use BullMQ in scheduler-service (not custom retry loop)
- IRN + QR code: stored encrypted in DB (sensitive compliance documents)
- e-Way Bill: only for inter-state + value > ₹50,000

═══════════════════════════════════════════
TESTING REQUIREMENTS
═══════════════════════════════════════════

□ Integration test (NIC sandbox): generate test IRN → irn_number is 64-char string
□ Integration test: confirm invoice for e-Invoice eligible tenant → invoice confirmed, irn_number non-null
□ Integration test: simulate NIC API failure → 502 returned, invoice status remains DRAFT
□ Integration test: confirm invoice for non-eligible tenant → no IRN call, invoice confirmed normally

═══════════════════════════════════════════
VERIFICATION CHECKLIST
═══════════════════════════════════════════

□ NIC sandbox: POST /api/v1/gst/einvoice/generate → valid 64-char IRN returned
□ Confirm invoice for eligible tenant → SELECT irn_number FROM invoices WHERE id = {id} → real IRN
□ STUB banner NO LONGER visible on EInvoicePage
□ QR code renders as scannable image
□ Simulate NIC down (invalid NIC_API_BASE_URL) → invoice stays DRAFT
□ Cancel an IRN → NIC cancellation API called, irn_status = CANCELLED in DB
□ Non-eligible tenant invoice confirmed without IRN call
□ pnpm test passes in apps/gst-service
□ pnpm lint passes

═══════════════════════════════════════════
DEFINITION OF DONE
═══════════════════════════════════════════

□ NIC sandbox generates real IRNs for test invoices
□ Invoice confirmation for eligible tenants blocked without valid IRN
□ Non-eligible tenants unaffected
□ QR code displayed and scannable
□ COMPLETION REPORT saved: ERP-PLANNING/phase-completions/ES-11_COMPLETION.md
```

---

---

# PHASE ES-12: Statutory HR Compliance — PF/ESI, Form 16, Form 24Q

```
You are executing ES-12 of the Enterprise Stabilization Roadmap on the NEXORAA Multi-Tenant Cloth Retail ERP.
Read the PROJECT CONTEXT section above completely before writing any code.
PREREQUISITE: ES-06 complete (payroll guard for unassigned salary structure).

═══════════════════════════════════════════
OBJECTIVE
═══════════════════════════════════════════

Implement PF/ESI challan generation, Form 16 (employee TDS certificate) PDF generation,
and Form 24Q (quarterly TDS return) data export.

WHY: Legal obligations under Indian labour and tax law. Monthly PF/ESI non-submission = penalties.
Form 16 non-issuance = employees cannot file income tax returns. Form 24Q non-filing = late fees.

═══════════════════════════════════════════
SCOPE — IN SCOPE ONLY
═══════════════════════════════════════════

1. apps/hr-service/src/domain/PfEsiChallanService.ts (new)
   - PF ECR format (EPFO specification — fixed-width text, exact line/field positions)
   - PF rates: employee = 12% of basic, employer = 12% + 0.5% admin charges
   - ESI rates: employer = 3.25% of gross (if gross ≤ ₹21,000/month); employee = 0.75%
   - Amounts in RUPEES for output (convert from paise)

2. apps/hr-service/src/domain/Form16Service.ts (new)
   - Form 16 Part A: TDS deducted and deposited summary
   - Form 16 Part B: salary breakdown and deductions
   - PDF generation using apps/report-service/src/domain/PdfEngine.ts (HTML template → PDF)

3. apps/hr-service/src/domain/Form24QService.ts (new)
   - Form 24Q: quarterly TDS return in NSDL prescribed text format
   - Output as downloadable .txt file
   - Use template string approach — not a third-party library

4. apps/hr-service/src/api/payroll.routes.ts
   - GET /api/v1/hr/payroll/pf-challan?month=7&year=2026
   - GET /api/v1/hr/payroll/esi-challan?month=7&year=2026
   - GET /api/v1/hr/payroll/form16/:employeeId?financialYear=2025-26
   - GET /api/v1/hr/payroll/form24q?quarter=1&year=2026

5. packages/db-client/src/schema/hr.ts
   - Add pf_challan_runs table:
     (id, tenant_id, month, year, total_employee_contribution_paise,
      total_employer_contribution_paise, generated_at, generated_by)
   - Migration: packages/db-client/migrations/0014_es12_statutory_hr.sql

6. New: apps/web-frontend/src/pages/hr/StatutoryCompliancePage.tsx
   - Tabbed layout: "PF Challan", "ESI Challan", "Form 16", "Form 24Q"
   - Each tab: month/quarter/year selector → Generate button → download link
   - PF Challan tab: per-employee breakdown expandable in ERPDataGrid before download
   - Form 16 tab: employee list with "Download Form 16" per row + "Bulk Download (ZIP)"

7. apps/web-frontend/src/App.tsx — register new page route

═══════════════════════════════════════════
ARCHITECTURE RULES
═══════════════════════════════════════════

- Challan generation is read-heavy — compute from payroll_slips; do NOT store computed totals
- Form 16 PDF: generated per-employee, served on demand
- Form 24Q: downloadable .txt file in NSDL format
- Use PdfEngine.ts from report-service for Form 16 PDF — do not add new PDF library

═══════════════════════════════════════════
TESTING REQUIREMENTS
═══════════════════════════════════════════

□ Unit test: PfEsiChallanService.generate(month=7, year=2026) returns correct PF/ESI for 3 test employees
□ Unit test: PF ECR format output matches EPFO spec (validate line format with regex)
□ Unit test: Form 24Q output contains correct header + one detail record per employee
□ Integration test: generate Form 16 for employee → PDF returned (non-empty byte array)

═══════════════════════════════════════════
VERIFICATION CHECKLIST
═══════════════════════════════════════════

□ GET /api/v1/hr/payroll/pf-challan?month=7&year=2026 → PF ECR format text
□ PF challan amounts correct: employee = 12% of basic, employer = 12% + admin charges
□ ESI challan generated for employees with gross ≤ ₹21,000
□ Form 16 PDF downloads successfully for test employee
□ Form 24Q .txt downloads in NSDL format
□ StatutoryCompliancePage renders with all four tabs
□ pnpm test passes in apps/hr-service
□ pnpm lint passes

═══════════════════════════════════════════
DEFINITION OF DONE
═══════════════════════════════════════════

□ PF ECR file downloadable (accepted by EPFO ECR upload portal — manual test)
□ Form 16 PDF correctly formatted with all mandatory fields
□ Form 24Q .txt passes NSDL file validation tool
□ COMPLETION REPORT saved: ERP-PLANNING/phase-completions/ES-12_COMPLETION.md
```

---

---

# PHASE ES-13: Inventory Valuation (FIFO/WACC) & COGS

```
You are executing ES-13 of the Enterprise Stabilization Roadmap on the NEXORAA Multi-Tenant Cloth Retail ERP.
Read the PROJECT CONTEXT section above completely before writing any code.
PREREQUISITES: ES-02 (outbox relay for COGS journal posting), ES-03 (inventory_ledger populated).

═══════════════════════════════════════════
OBJECTIVE
═══════════════════════════════════════════

Implement inventory cost valuation (FIFO and WACC) on inventory_ledger data, compute COGS on
invoice confirmation, post COGS journals, and add Stock Valuation Report.

WHY: Without valuation, P&L Gross Margin = Revenue minus zero. Balance Sheet Inventory = zero.
COGS is the most important cost line in a retail company's P&L.

═══════════════════════════════════════════
SCOPE — IN SCOPE ONLY
═══════════════════════════════════════════

1. apps/inventory-service/src/domain/InventoryLedgerService.ts
   - Add computeFIFOCost(itemId, warehouseId, qty, tenantId): iterate STOCK_IN layers oldest-first,
     consume until qty fulfilled; FIFO cost = weighted avg of consumed layers
     USE SELECT FOR UPDATE on consumed inventory_ledger rows (race condition safety)
   - Add computeWACCost(itemId, warehouseId, tenantId): read from inventory_wacc table
   - Update recordMovement(STOCK_OUT): compute and store unit_cost_paise using active method

2. packages/db-client/src/schema/inventory.ts
   - Add unit_cost_paise BIGINT DEFAULT 0 to inventory_ledger
   - Add valuation_method VARCHAR(10) to inventory_ledger
   - New table inventory_wacc: (id, tenant_id, item_id, warehouse_id, current_wacc_paise, current_qty, updated_at)
   - Add index: (tenant_id, item_id, warehouse_id) on inventory_wacc
   - Migration: packages/db-client/migrations/0015_es13_inventory_valuation.sql

3. Tenant-level configuration: inventory_valuation_method (FIFO or WACC) in tenant settings
   - Update WACC on every STOCK_IN: (old_value + new_value) / (old_qty + new_qty) — atomic update

4. apps/sales-service/src/domain/InvoiceService.ts
   - After STOCK_OUT writes (ES-03): emit COGS_JOURNAL outbox event
     Payload: one entry per invoice line { itemId, qty, unitCostPaise, lineTotal, tenantId }
   - Fallback: if no STOCK_IN layers exist, use item.purchasePrice as cost

5. apps/accounting-service/src/consumers/COGSAccountingConsumer.ts (new)
   - Consume COGS_JOURNAL event
   - Post COGS Expense DR / Inventory CR journal (one line per invoice line)
   - INBOX DEDUPLICATION IS MANDATORY — duplicate COGS journals are a fatal accounting error
   - Resolve COGS account code via PostingMatrixService (entry type: COGS)

6. apps/report-service/src/domain/ReportEngine.ts
   - Add stock valuation report query (tenant-isolated)
   - Endpoint: GET /api/v1/reports/stock-valuation?asOf={date}

7. New: apps/web-frontend/src/pages/reports/StockValuationPage.tsx
   - ERPDataGrid: Item Name, Category, Warehouse, Quantity on Hand, Unit Cost (₹), Total Value (₹), Valuation Method
   - As-of date picker, Export to Excel button
   - Summary card at top: Total Inventory Value

═══════════════════════════════════════════
ARCHITECTURE RULES
═══════════════════════════════════════════

- FIFO computation in inventory-service — NOT in sales-service
- SELECT FOR UPDATE on inventory_ledger rows during FIFO computation (race condition safety)
- WACC stored in inventory_wacc table; updated atomically on each STOCK_IN
- Inbox deduplication in COGSAccountingConsumer — no exceptions

═══════════════════════════════════════════
TESTING REQUIREMENTS
═══════════════════════════════════════════

□ Unit test FIFO: 3 layers (10@₹100, 5@₹120, 8@₹90); STOCK_OUT 12 units → cost = (10×100 + 2×120) = ₹1,240
□ Unit test WACC: same layers → WACC = (10×100 + 5×120 + 8×90) / 23 = ₹102.17
□ Integration test: confirm invoice → COGS_JOURNAL in outbox; accounting-service posts COGS Expense DR / Inventory CR
□ Integration test: Stock Valuation Report returns correct total for 5 test items

═══════════════════════════════════════════
VERIFICATION CHECKLIST
═══════════════════════════════════════════

□ Confirm invoice → SELECT unit_cost_paise FROM inventory_ledger WHERE movement_type = 'STOCK_OUT' → correct FIFO cost per line
□ COGS journal entry posted in financial_entries for each invoice line
□ P&L report shows non-zero COGS line (requires ES-02 relay running)
□ GET /api/v1/reports/stock-valuation → correct total for test items
□ StockValuationPage renders with correct data and export button
□ Switch to WACC method → costs computed differently on next invoice
□ pnpm test passes in apps/inventory-service and apps/accounting-service
□ pnpm lint passes

═══════════════════════════════════════════
DEFINITION OF DONE
═══════════════════════════════════════════

□ P&L Gross Margin = Revenue - COGS (non-zero, correct)
□ Stock Valuation Report shows correct inventory value at any as-of date
□ FIFO and WACC both produce correct costs for test scenarios
□ COMPLETION REPORT saved: ERP-PLANNING/phase-completions/ES-13_COMPLETION.md
```

---

---

# PHASE ES-14: Input Validations & Business Rule Enforcement

```
You are executing ES-14 of the Enterprise Stabilization Roadmap on the NEXORAA Multi-Tenant Cloth Retail ERP.
Read the PROJECT CONTEXT section above completely before writing any code.
PREREQUISITES: ES-10 (GST data for FY boundary check), ES-06 (payroll guard already done — verify).

═══════════════════════════════════════════
OBJECTIVE
═══════════════════════════════════════════

Implement 10 missing input validations and business rules preventing data quality issues:
duplicate invoices, negative stock, invalid GSTINs, invalid IFSC codes, expired quotation conversion,
FY boundary violations, leave overlaps, payroll structure guard (verify), PAN format, EAN-13 barcode.

═══════════════════════════════════════════
SCOPE — IN SCOPE ONLY (10 rules)
═══════════════════════════════════════════

1. packages/shared-utils/src/validators.ts (new file)
   - validateGSTIN(gstin: string): boolean — 15-char format + GSTN checksum algorithm
   - validateIFSC(ifsc: string): boolean — /^[A-Z]{4}0[A-Z0-9]{6}$/
   - validatePAN(pan: string): boolean — /^[A-Z]{5}[0-9]{4}[A-Z]{1}$/
   - validateEAN13(barcode: string): boolean — EAN-13 checksum (modulo 10 Luhn)
   - validateGSTINChecksum(gstin): boolean — GSTN's modulo-36 Luhn-like algorithm

2. Duplicate Invoice Detection — apps/sales-service/src/domain/InvoiceService.ts
   - Same customer + amount within ±5% tolerance + date within ±7 days → warn (not block)
   - Return 202 Accepted with { data: invoice, warnings: ['POSSIBLE_DUPLICATE'] }
   - UI: yellow inline banner with "Create Anyway" button + matching invoice reference

3. Negative Stock Prevention — apps/inventory-service/src/domain/InventoryLedgerService.ts
   - Atomic UPDATE: UPDATE items SET available_qty = available_qty - $qty
     WHERE id = $id AND tenant_id = $tenantId AND available_qty >= $qty
   - If rows_affected = 0 → throw STOCK_INSUFFICIENT

4. GSTIN Checksum Validation
   - Use validateGSTIN() in Zod schema .refine() in:
     apps/sales-service/src/api/invoice.routes.ts
     apps/purchase-service/src/api/purchase-order.routes.ts
   - Frontend: apps/web-frontend/src/components/erp/ERPGSTINInput.tsx
     Show red border + "Invalid GSTIN format" on blur

5. IFSC Format Validation — all bank account IFSC fields in sales/hr/purchase services

6. Quotation Valid-Until Check — apps/sales-service/src/domain/QuotationService.ts
   - Block conversion if valid_until < today → throw QUOTATION_EXPIRED

7. Financial Year Boundary Check — apps/sales-service/src/domain/InvoiceService.ts
   - Block invoice if invoice_date outside any open FY: throw INVOICE_DATE_OUT_OF_PERIOD
   - Query: financial_years WHERE start_date <= $invoiceDate AND end_date >= $invoiceDate AND status = 'OPEN'

8. Leave Overlap Check — apps/hr-service/src/domain/ (leave application logic)
   - On leave application: check if existing APPROVED leave overlaps dates for same employee
   - Query: WHERE employee_id = $id AND status = 'APPROVED' AND start_date <= $endDate AND end_date >= $startDate
   - If count > 0 → throw LEAVE_OVERLAP

9. Payroll Salary Structure Guard — Verify ES-06 implemented this; fix if not

10. PAN Format Constraint — packages/db-client/src/schema/hr.ts
    - Add CHECK constraint on employees.pan_number: CHECK (pan_number ~ '^[A-Z]{5}[0-9]{4}[A-Z]$')
    - Migration: packages/db-client/migrations/0016_es14_validations.sql

11. EAN-13 Barcode Checksum — barcode input component in web-frontend
    - Client-side validation: show inline error if checksum fails

═══════════════════════════════════════════
ARCHITECTURE RULES
═══════════════════════════════════════════

- All validators in packages/shared-utils/src/validators.ts — one function per validator
- Zod .refine() for format validations at route boundary
- Business rule violations: typed ERPError
- Duplicate invoice: 202 (warn, not block) — allow "Create Anyway"
- Negative stock: use atomic UPDATE (not a two-step read-then-update)

═══════════════════════════════════════════
TESTING REQUIREMENTS
═══════════════════════════════════════════

□ Unit test each of the 5 format validators with valid and invalid inputs
□ Integration test: duplicate invoices (same customer, amount, date) → 202 with POSSIBLE_DUPLICATE warning
□ Integration test: concurrent stock deduction below zero → one success, one STOCK_INSUFFICIENT
□ Integration test: leave overlap → 422 LEAVE_OVERLAP
□ DB test: employee with invalid PAN → CHECK constraint rejects

═══════════════════════════════════════════
VERIFICATION CHECKLIST
═══════════════════════════════════════════

□ GSTIN 29ABCDE1234F1Z5 validates as correct; 29ABCDE1234F1Z6 fails checksum
□ Duplicate invoice → 202 with POSSIBLE_DUPLICATE warning (not 422)
□ Concurrent test: two threads deplete stock of 1 unit → one success, one STOCK_INSUFFICIENT
□ Invoice with date outside open FY → 422 INVOICE_DATE_OUT_OF_PERIOD
□ Leave application overlapping existing → 422 LEAVE_OVERLAP
□ Employee with invalid PAN format → rejected at DB level
□ EAN-13 checksum validation works in browser barcode input
□ pnpm test passes across all affected services
□ pnpm lint passes

═══════════════════════════════════════════
DEFINITION OF DONE
═══════════════════════════════════════════

□ All 10 validation rules enforced consistently across backend and frontend
□ Concurrent stock deduction test passes (no negative stock possible)
□ Format validators have unit tests with valid and invalid inputs
□ COMPLETION REPORT saved: ERP-PLANNING/phase-completions/ES-14_COMPLETION.md
```

---

---

# PHASE ES-15: Frontend UX Completeness & Depreciation Scheduler

```
You are executing ES-15 of the Enterprise Stabilization Roadmap on the NEXORAA Multi-Tenant Cloth Retail ERP.
Read the PROJECT CONTEXT section above completely before writing any code.
PREREQUISITE: ES-02 (depreciation journals require outbox relay).
IMPORTANT: All UI changes use the ERP component library (ERPDataGrid, ERPFormField, etc.). No custom CSS.

═══════════════════════════════════════════
OBJECTIVE
═══════════════════════════════════════════

Fix 9 frontend UX gaps and register the fixed asset depreciation scheduler job.

═══════════════════════════════════════════
SCOPE — IN SCOPE ONLY (9 items)
═══════════════════════════════════════════

1. ERPDataGrid footer totals
   - apps/web-frontend/src/components/erp/ERPDataGrid.tsx
   - Add optional footer?: boolean prop
   - When enabled: show sum totals below each numeric column (type: 'currency' or 'number' only)
   - Distinct footer row (slightly darker background); format same as body cells
   - Default: disabled — existing usages MUST be unaffected

2. Flat-amount discount on InvoiceFormPage
   - apps/web-frontend/src/pages/sales/InvoiceFormPage.tsx
   - Add flat-amount discount input alongside existing % discount
   - Mutually exclusive: entering one clears the other
   - Recompute line total: unit_price × qty - discount_amount

3. Print Receipt on AlterationsPage
   - apps/web-frontend/src/pages/hr/AlterationsPage.tsx
   - Add "Print Receipt" button → browser window.print()

4. Depreciation schedule view on FixedAssetsPage
   - apps/web-frontend/src/pages/accounting/FixedAssetsPage.tsx
   - Click asset row → modal showing monthly depreciation schedule
   - Table: Month, Opening Value, Depreciation, Closing Value, Accumulated Depreciation

5. Branch filter on DashboardPage
   - apps/web-frontend/src/pages/DashboardPage.tsx
   - Dropdown at top-right, defaults to "All Branches"
   - Filter API calls by ?branchId={id} query param
   - Backend: add WHERE branch_id = $branchId to projection queries when provided

6. Credit note balance on CustomerViewPage
   - apps/web-frontend/src/pages/customers/CustomerViewPage.tsx
   - Add credit note balance to customer summary card
   - Show as "Credit Balance: ₹12,500" in green text (only when balance > 0)
   - Backend: add to existing customer detail endpoint response
     (sum of non-expired, non-applied credit notes for the customer)

7. Warehouse filter on StockLevelsPage
   - apps/web-frontend/src/pages/inventory/StockLevelsPage.tsx
   - Filter bar above grid, defaults to "All Warehouses"

8. Mobile responsive audit
   - Test main pages at 375px and 768px viewports
   - Fix any horizontal overflow: Invoice list, Dashboard, Inventory, HR pages
   - Use existing Tailwind responsive prefixes — no arbitrary values like w-[347px]

9. Register depreciation scheduler job
   - apps/scheduler-service/src/jobs/system-jobs.ts: add monthly depreciation job
     BullMQ cron: '0 2 1 * *' (00:30 IST = 02:00 UTC equivalent for 1st of month)
     Calls accounting-service FixedAssetService.runMonthlyDepreciation(tenantId) per tenant
   - apps/scheduler-service/src/JobRegistry.ts: register the job
   - Job must be idempotent: running twice same month must NOT double-post depreciation

═══════════════════════════════════════════
TESTING REQUIREMENTS
═══════════════════════════════════════════

□ Unit test: ERPDataGrid with footer=true and 3 numeric rows → footer row with correct sums
□ Integration test: depreciation job runs → financial_entries has depreciation journal for all active assets
□ Integration test: depreciation job run twice same month → only one depreciation entry per asset
□ Manual test: StockLevelsPage warehouse filter shows only items in selected warehouse

═══════════════════════════════════════════
VERIFICATION CHECKLIST
═══════════════════════════════════════════

□ ERPDataGrid with footer={true} → totals row with correct sums; without footer → identical to before
□ Invoice flat-amount discount: enter ₹500 → line total reduces ₹500; % field clears
□ AlterationsPage "Print Receipt" → browser print dialog
□ FixedAssetsPage: click asset → depreciation schedule modal with monthly table
□ Dashboard branch filter: select Branch A → KPIs update to Branch A only
□ CustomerViewPage: customer with ₹12,500 credit note → "Credit Balance: ₹12,500" in green
□ StockLevelsPage: select Warehouse B → only Warehouse B stock shown
□ Main pages at 375px: no horizontal overflow
□ Depreciation job registered and visible in BullMQ admin UI
□ pnpm lint passes

═══════════════════════════════════════════
DEFINITION OF DONE
═══════════════════════════════════════════

□ All 9 UX items verified in browser
□ Depreciation job runs successfully in test environment
□ No horizontal overflow at 375px on major pages
□ COMPLETION REPORT saved: ERP-PLANNING/phase-completions/ES-15_COMPLETION.md
```

---

---

# PHASE ES-16: Backend Performance & Health Hardening

```
You are executing ES-16 of the Enterprise Stabilization Roadmap on the NEXORAA Multi-Tenant Cloth Retail ERP.
Read the PROJECT CONTEXT section above completely before writing any code.
PREREQUISITES: ES-02 (outbox relay worker exists), ES-03 (stock reservations in place).

═══════════════════════════════════════════
OBJECTIVE
═══════════════════════════════════════════

Optimize backend reliability: replace 100ms outbox polling with PostgreSQL LISTEN/NOTIFY, add
expired stock reservation cleanup job, add loyalty point expiry scheduler, and add GSTR-2A
import validation.

═══════════════════════════════════════════
SCOPE — IN SCOPE ONLY
═══════════════════════════════════════════

1. PostgreSQL LISTEN/NOTIFY for Outbox Relay
   - Migration: packages/db-client/migrations/0017_es16_outbox_notify_trigger.sql
     CREATE OR REPLACE FUNCTION notify_outbox() RETURNS TRIGGER AS $$
       BEGIN PERFORM pg_notify('outbox_channel', NEW.id::text); RETURN NEW; END;
     $$ LANGUAGE plpgsql;
     CREATE TRIGGER outbox_notify_trigger AFTER INSERT ON outbox_events
       FOR EACH ROW EXECUTE FUNCTION notify_outbox();
   - apps/event-service/src/outbox/OutboxRelayWorker.ts
     Replace polling loop with pg.query('LISTEN outbox_channel')
     Use DEDICATED PostgreSQL connection OUTSIDE PgBouncer
     (PgBouncer transaction mode does NOT support LISTEN/NOTIFY)
     Implement automatic reconnection on LISTEN connection failure
     Keep polling as 60s FALLBACK (in case NOTIFY is missed on connection restart)

2. Expired Stock Reservation Cleanup Job
   - apps/scheduler-service/src/jobs/system-jobs.ts
     Daily at 03:00 IST: DELETE stock_reservations WHERE status = 'EXPIRED'
     AND updated_at < NOW() - INTERVAL '30 days'
     ONLY delete EXPIRED status — never delete PENDING or HELD reservations

3. Loyalty Points Expiry Job
   - apps/sales-service/src/domain/LoyaltyService.ts
     Add expirePoints(tenantId, asOfDate) method
     Deduct points with expiry_date < TODAY AND status = 'ACTIVE'
     Skip employees with 0 expiring points
     Write LOYALTY_POINTS_EXPIRED event to outbox (for CRM analytics)
   - apps/scheduler-service/src/jobs/system-jobs.ts
     Nightly at 01:00 IST; iterate all active tenants; call LoyaltyService.expirePoints() per tenant

4. apps/scheduler-service/src/JobRegistry.ts
   - Register reservation cleanup job + loyalty expiry job

5. GSTR-2A Import Validation
   - packages/shared-utils/src/gstr2a-schema.ts (new file): Zod schema for GSTR-2A JSON
   - apps/gst-service/src/domain/Gstr2aService.ts
     Add JSON schema validation before processing: Gstr2aSchema.parse(input) at start of importFromJson()
     On validation failure → throw 422 with field-level Zod errors

═══════════════════════════════════════════
ARCHITECTURE RULES
═══════════════════════════════════════════

- LISTEN connection: dedicated PostgreSQL connection (NOT from PgBouncer) — must stay open
- LISTEN connection must reconnect automatically on failure
- Polling fallback: 60s intervals (not 100ms as before)
- Loyalty expiry: per-tenant loop — NOT a single query across all tenants
- GSTR-2A validation: Zod schema — not manual field checks

═══════════════════════════════════════════
TESTING REQUIREMENTS
═══════════════════════════════════════════

□ Performance test: measure DB query rate before/after LISTEN/NOTIFY → confirm reduction to near 0/s idle
□ Integration test: insert outbox event → relay receives NOTIFY and processes within 100ms
□ Integration test: loyalty points with expiry_date = yesterday → expiry job sets status = EXPIRED
□ Integration test: cleanup job → EXPIRED reservations >30 days deleted; PENDING reservations untouched

═══════════════════════════════════════════
VERIFICATION CHECKLIST
═══════════════════════════════════════════

□ Outbox relay NOTIFY received within 100ms of outbox_events INSERT (confirm via log timestamp diff)
□ DB connection pool metrics: queries/second drops significantly during idle (Prometheus)
□ stock_reservations cleanup: EXPIRED rows >30 days deleted; PENDING rows preserved
□ Loyalty expiry: active points with past expiry date → status changed to EXPIRED
□ GSTR-2A import with invalid JSON → 422 with validation error; valid JSON → imports successfully
□ Outbox relay still processes events correctly after LISTEN/NOTIFY change
□ pnpm test passes in all affected services
□ pnpm lint passes

═══════════════════════════════════════════
DEFINITION OF DONE
═══════════════════════════════════════════

□ Outbox relay responds to events within 100ms via LISTEN/NOTIFY
□ DB query rate during idle reduced by >80% vs polling
□ Expired reservations cleaned up daily
□ Loyalty point expiry runs nightly
□ COMPLETION REPORT saved: ERP-PLANNING/phase-completions/ES-16_COMPLETION.md
```

---

---

# PHASE ES-17: Analytics & Reporting Completeness

```
You are executing ES-17 of the Enterprise Stabilization Roadmap on the NEXORAA Multi-Tenant Cloth Retail ERP.
Read the PROJECT CONTEXT section above completely before writing any code.
PREREQUISITES: ES-05 (tenant isolation pattern established), ES-13 (COGS data for margin reports).

═══════════════════════════════════════════
OBJECTIVE
═══════════════════════════════════════════

Implement 8 analytics and reporting gaps needed for monthly business reviews:
Branch P&L, Item Gross Margin, Inventory Turnover, DSO, Loyalty Points Liability,
Alteration Order Status, POS Cashier Summary, Fixed Asset Depreciation Schedule.

═══════════════════════════════════════════
SCOPE — IN SCOPE ONLY (8 reports)
═══════════════════════════════════════════

For each report: SQL query in ReportEngine.ts + API endpoint in report.routes.ts + frontend page.
Every SQL query MUST have WHERE tenant_id = ${ctx.tenantId} (verified by inspection and test).
All endpoints: GET /api/v1/reports/{report-name}?startDate=&endDate= (default = current FY).
All pages: standard pattern — date range filter → Generate → ERPDataGrid → Export CSV.

1. Branch-wise Profit & Loss (RPT-07)
   - Aggregate financial_entries by branch_id and account_type
   - Requires financial_entries.branch_id column — if missing, skip this report and document
   - Page: BranchPnlPage.tsx; Route: /reports/branch-pnl

2. Item-wise Gross Margin Summary (RPT-08)
   - gross_margin = revenue - cogs per item (requires ES-13 COGS in financial_entries)
   - Sortable by margin % (highest to lowest by default)
   - Page: ItemMarginPage.tsx; Route: /reports/item-margin

3. Inventory Turnover Ratio by Category (RPT-16)
   - turnover_ratio = COGS / average_inventory_value
   - average = (opening_stock_value + closing_stock_value) / 2
   - Page: InventoryTurnoverPage.tsx; Route: /reports/inventory-turnover

4. Day Sales Outstanding / DSO (RPT-17)
   - DSO = (average_accounts_receivable / total_credit_sales) × 365
   - Credit invoices only (payment_terms != 'CASH')
   - Page: DsoPage.tsx; Route: /reports/dso

5. Loyalty Points Liability Report (RPT-13)
   - total_liability = SUM(active_loyalty_points × redemption_rate) per tenant config
   - Page: LoyaltyLiabilityPage.tsx; Route: /reports/loyalty-liability

6. Alteration Order Status Report (RPT-11)
   - All alteration orders with status, tailor assigned, due date, completion date
   - Page: AlterationStatusPage.tsx; Route: /reports/alteration-status

7. POS Cashier-wise Summary (RPT-19)
   - Totals per cashier (employee) for a selected date
   - Filter by date + cashier (employee) dropdown
   - Page: PosCashierPage.tsx; Route: /reports/pos-cashier

8. Fixed Asset Depreciation Schedule per Asset (RPT-14)
   - Monthly depreciation table per asset for a selected FY
   - Page: DepreciationSchedulePage.tsx; Route: /reports/depreciation-schedule

Register all 8 routes in apps/web-frontend/src/App.tsx.
Register all 8 reports in apps/report-service/src/domain/ReportRegistry.ts.

═══════════════════════════════════════════
ARCHITECTURE RULES
═══════════════════════════════════════════

- Every SQL query: WHERE tenant_id = ${ctx.tenantId} — verified + annotated
- All monetary values in response: integers (paise); format INR on frontend
- Report generation < 5s for < 1 year date range
- Run EXPLAIN ANALYZE on every new query before committing
- Add composite indexes if queries trigger sequential scans

═══════════════════════════════════════════
TESTING REQUIREMENTS
═══════════════════════════════════════════

□ Integration test per report: insert known test data → call endpoint → assert expected values
□ Tenant isolation test per report: tenant A data must NOT appear in tenant B's response
□ Performance test: each report with 12 months of data returns in < 5s

═══════════════════════════════════════════
VERIFICATION CHECKLIST
═══════════════════════════════════════════

□ Branch P&L: two branches with separate invoices → separate revenue per branch (or documented as skipped)
□ Item Gross Margin: item with ₹100 revenue + ₹60 COGS → 40% margin
□ Inventory Turnover: correct for test item with known COGS and stock values
□ DSO: correct for test scenario with credit invoices and payment dates
□ Loyalty Points Liability: correct total points × redemption rate
□ Alteration Order Status: all orders with correct status
□ POS Cashier Summary: correct totals per cashier for test day
□ Fixed Asset Depreciation Schedule: correct monthly depreciation for test asset
□ All 8 pages render in browser with correct ERPDataGrid layout
□ Export CSV works for all 8 reports
□ pnpm test passes in apps/report-service
□ pnpm lint passes

═══════════════════════════════════════════
DEFINITION OF DONE
═══════════════════════════════════════════

□ All 8 reports return correct data for test scenarios
□ All 8 pages render in browser
□ CSV export works for all 8 reports
□ All integration and tenant isolation tests pass
□ COMPLETION REPORT saved: ERP-PLANNING/phase-completions/ES-17_COMPLETION.md
```

---

---

# PHASE ES-18: CRM & Communication Completeness

```
You are executing ES-18 of the Enterprise Stabilization Roadmap on the NEXORAA Multi-Tenant Cloth Retail ERP.
Read the PROJECT CONTEXT section above completely before writing any code.
PREREQUISITE: ES-07 (CUSTOMER_UPDATE permission exists for opt-out API).

═══════════════════════════════════════════
OBJECTIVE
═══════════════════════════════════════════

Implement three CRM gaps: a UI for the discount rule builder, WhatsApp opt-in/opt-out management
(TRAI DLT compliance), and campaign delivery tracking.

═══════════════════════════════════════════
SCOPE — IN SCOPE ONLY
═══════════════════════════════════════════

1. Discount Rule Builder UI
   - New: apps/web-frontend/src/pages/crm/DiscountRuleBuilderPage.tsx
   - Uses existing rule engine from packages/platform-sdk/src/rule-engine.ts
   - Dynamic form built from rule engine schema — do NOT hardcode rule conditions
   - Create, edit, and activate discount rules from the UI

2. WhatsApp Opt-In/Opt-Out Management (TRAI DLT Compliance)
   - packages/db-client/src/schema/crm.ts: add customer_communication_preferences table
     (id, tenant_id, customer_id, whatsapp_opted_out, opted_out_at, opted_out_reason, updated_at)
     One row per customer; index on (tenant_id, customer_id)
   - Migration: packages/db-client/migrations/0018_es18_crm_tracking.sql
   - apps/sales-service/src/api/crm.routes.ts
     POST /api/v1/customers/{id}/communication-preferences
     Body: { whatsappOptedOut: true|false }
     Guard: requirePermission(PERMISSIONS.CUSTOMER_UPDATE)
   - apps/notification-service/src/: add opt-out check BEFORE any WhatsApp dispatch
     Direct DB read (NOT cache) — regulatory compliance requires freshest data
   - apps/web-frontend/src/pages/customers/CustomerViewPage.tsx
     Add "Communication Preferences" section with WhatsApp opt-out toggle
     Show "Opted out on {date}" timestamp if opted out

3. Campaign Delivery Tracking
   - packages/db-client/src/schema/crm.ts: add campaign_delivery_events table
     (id, tenant_id, campaign_id, customer_id, event_type, event_at, metadata JSONB)
     Append-only; index on (tenant_id, campaign_id)
   - apps/sales-service/src/api/crm.routes.ts
     POST /api/v1/campaigns/webhook/delivery — UNAUTHENTICATED (called by BSP)
     Authenticate via HMAC signature in X-BSP-Signature header (custom preHandler)
     Store delivery/open/click events in campaign_delivery_events
   - apps/sales-service/src/domain/CampaignService.ts
     Compute open_rate = count(OPENED) / count(DELIVERED); click rate similarly
   - apps/web-frontend/src/pages/crm/CampaignsPage.tsx
     Add columns: Sent, Delivered, Failed, Open Rate (%), Click Rate (%)

═══════════════════════════════════════════
ARCHITECTURE RULES
═══════════════════════════════════════════

- Webhook is unauthenticated externally — authenticate ONLY via HMAC X-BSP-Signature header
- Campaign delivery events: append-only (never update existing rows)
- Opt-out check: direct DB read (no cache) in notification-service
- Webhook endpoint: must validate HMAC signature before storing any data

═══════════════════════════════════════════
TESTING REQUIREMENTS
═══════════════════════════════════════════

□ Unit test: notification-service WhatsApp dispatch checks opt-out; opted-out customer does NOT receive message
□ Integration test: call delivery webhook with HMAC-signed payload → event stored in campaign_delivery_events
□ Integration test: call delivery webhook with invalid HMAC → 401
□ Unit test: campaign open rate computed correctly from delivery events

═══════════════════════════════════════════
VERIFICATION CHECKLIST
═══════════════════════════════════════════

□ Create discount rule via DiscountRuleBuilderPage → rule saved and visible in rule list
□ Opt customer out of WhatsApp → customer_communication_preferences.whatsapp_opted_out = true in DB
□ Trigger WhatsApp campaign → opted-out customer does NOT receive message (check notification-service logs)
□ Simulate delivery webhook events → CampaignsPage shows delivery/open/click metrics
□ Invalid HMAC webhook → 401 response
□ pnpm test passes in apps/sales-service and apps/notification-service
□ pnpm lint passes

═══════════════════════════════════════════
DEFINITION OF DONE
═══════════════════════════════════════════

□ Opted-out customers do not receive WhatsApp campaigns
□ Campaign delivery metrics visible on campaigns page
□ Discount rules manageable via UI
□ COMPLETION REPORT saved: ERP-PLANNING/phase-completions/ES-18_COMPLETION.md
```

---

---

# PHASE ES-19: Enterprise Security Hardening

```
You are executing ES-19 of the Enterprise Stabilization Roadmap on the NEXORAA Multi-Tenant Cloth Retail ERP.
Read the PROJECT CONTEXT section above completely before writing any code.
PREREQUISITE: ES-07 (permission constants for security admin routes).
RISK: HIGH — changes to auth-service are the highest-risk changes in the platform.
     2FA must be opt-in. IP allowlist only enforced when explicitly configured.
     Thorough integration tests required. Verify rollback plan before deploying to production.

═══════════════════════════════════════════
OBJECTIVE
═══════════════════════════════════════════

Implement TOTP-based 2FA, user session management, and per-tenant IP allowlisting.

═══════════════════════════════════════════
SCOPE — IN SCOPE ONLY
═══════════════════════════════════════════

1. TOTP Two-Factor Authentication
   - Use existing npm package: speakeasy or otpauth — do NOT implement TOTP from scratch
   - TOTP secrets: AES-256-GCM encrypted at rest in totp_secrets table
   - Backup codes: 10 codes, 8-char alphanumeric, hashed with bcrypt in totp_backup_codes
   - Enrollment: QR code display in UI; issuer = "NEXORAA ERP", account = {tenantName}:{userEmail}
   - TOTP window tolerance: ±1 step (30s each side) for clock drift
   - Auth flow: password succeeds → return pre_auth_token (30s TTL)
     Client submits TOTP code + pre_auth_token → get full JWT
   - Backup code: single-use (mark used_at in DB); second use → 401

2. Session Management
   - Store active sessions in user_sessions table
   - On full auth (including TOTP if enrolled): create user_sessions row + include session_id in JWT jti claim
   - GET /api/v1/auth/sessions — list active sessions (IP, device, last_active)
   - DELETE /api/v1/auth/sessions/{id} — revoke: add session_id to Redis blocklist
   - authenticate middleware: check Redis blocklist; revoked session → 401
   - Session token: store only HASH in DB (raw token given to client once)

3. IP Allowlist
   - Per-tenant CIDR configuration in tenant_ip_allowlists table
   - Check at API GATEWAY level — NOT in individual services
   - Use ip-cidr or ipaddr.js npm package for CIDR matching
   - If tenant_ip_allowlists is EMPTY → all IPs allowed (only enforce when at least one CIDR configured)
   - ADMIN role: can bypass IP check

4. Database Schema
   - packages/db-client/src/schema/auth.ts:
     totp_secrets: (id, tenant_id, user_id, encrypted_secret, is_enabled, enrolled_at)
     totp_backup_codes: (id, tenant_id, user_id, code_hash, used_at)
     user_sessions: (id, tenant_id, user_id, session_token_hash, ip_address, user_agent, last_active_at, revoked_at, created_at)
     tenant_ip_allowlists: (id, tenant_id, cidr, description, created_by, created_at)
   - Migration: packages/db-client/migrations/0019_es19_security_hardening.sql

5. Tenant Service
   - apps/tenant-service/src/: add IP allowlist CRUD API

6. New frontend pages:
   - apps/web-frontend/src/pages/auth/TwoFactorSetupPage.tsx
     Step-by-step: scan QR → verify TOTP → save backup codes → done
   - apps/web-frontend/src/pages/auth/SessionsPage.tsx
     ERPDataGrid: Device/Browser, IP Address, Last Active, Created At, Revoke button
   - apps/web-frontend/src/pages/settings/ — IP Allowlist management
     CIDR range input + Add + list of CIDRs with Remove + Test IP button

═══════════════════════════════════════════
ARCHITECTURE RULES
═══════════════════════════════════════════

- 2FA is OPT-IN — disabled by default; existing login flow unchanged for users without 2FA
- IP allowlist: only enforced when at least one CIDR is configured
- Session revocation: Redis blocklist (TTL = JWT expiry); authenticate checks blocklist
- LISTEN connection for session checks: use existing session_id in JWT jti claim
- pre_auth_token: Redis key with 30s TTL; deleted after TOTP verified

═══════════════════════════════════════════
TESTING REQUIREMENTS
═══════════════════════════════════════════

□ Unit test: TOTP verification with valid code → true; expired code (>60s) → false
□ Unit test: backup code verification works once; second use → false
□ Integration test: login with 2FA — correct TOTP → full JWT; wrong TOTP → 401
□ Integration test: revoke session → subsequent requests with that JWT → 401
□ Integration test: login from IP not in allowlist (when allowlist has entries) → 403
□ Integration test: login from allowed IP → succeeds

═══════════════════════════════════════════
VERIFICATION CHECKLIST
═══════════════════════════════════════════

□ Enroll TOTP via QR code → authenticator app generates valid codes
□ Login with 2FA: correct TOTP → full JWT returned
□ Login with wrong TOTP → 401
□ Use backup code → login succeeds; same backup code again → 401
□ Revoke session from SessionsPage → subsequent requests → 401
□ Add CIDR 192.168.1.0/24 to tenant allowlist → login from 10.0.0.1 → 403
□ Login from 192.168.1.100 → succeeds
□ Login WITHOUT 2FA enrolled → works normally (2FA is opt-in)
□ Tenants without IP allowlist configured → all IPs still allowed
□ pnpm test passes in apps/auth-service
□ pnpm lint passes

═══════════════════════════════════════════
DEFINITION OF DONE
═══════════════════════════════════════════

□ Users can enroll in 2FA and log in using TOTP
□ Sessions can be listed and revoked
□ IP allowlist blocks logins from non-allowed CIDRs (when configured)
□ All integration tests pass
□ COMPLETION REPORT saved: ERP-PLANNING/phase-completions/ES-19_COMPLETION.md
```

---

---

# PHASE ES-20: Enterprise Features — Audit Log UI, Attachments, Feature Flags

```
You are executing ES-20 of the Enterprise Stabilization Roadmap on the NEXORAA Multi-Tenant Cloth Retail ERP.
Read the PROJECT CONTEXT section above completely before writing any code.
PREREQUISITES: ES-07 (VIEW_AUDIT_LOG permission), ES-19 (security hardening complete).

═══════════════════════════════════════════
OBJECTIVE
═══════════════════════════════════════════

Implement Audit Log Viewer UI, Document Attachments for invoices/POs/GRNs, Feature Flag Admin UI,
and PDF export for all tabular reports.

═══════════════════════════════════════════
SCOPE — IN SCOPE ONLY
═══════════════════════════════════════════

1. Audit Log Viewer
   - Backend: GET /api/v1/admin/audit-logs?entityType=&userId=&startDate=&endDate=&page=1&limit=50
     Guard: requirePermission(PERMISSIONS.VIEW_AUDIT_LOG)
     Use existing packages/platform-sdk/src/audit.ts queryAuditLog() — do NOT query audit_logs directly
   - New page: apps/web-frontend/src/pages/admin/AuditLogPage.tsx
     ERPDataGrid columns: Timestamp, User, Action, Entity Type, Entity ID, IP Address
     Filters: date range, entity type, user
     Click row → expanded detail showing before/after JSON diff

2. Document Attachments
   - packages/db-client/src/schema/ (choose appropriate schema file): add document_attachments table
     (id, tenant_id, entity_type VARCHAR(30), entity_id UUID, file_name, file_size_bytes,
      mime_type, storage_key, created_by, created_at)
     Index: (tenant_id, entity_type, entity_id)
   - Migration: packages/db-client/migrations/0020_es20_enterprise_features.sql
   - FileStorageService interface with two implementations:
     LocalFileStorage (dev, configured via FILE_STORAGE_PROVIDER=local)
     S3FileStorage (prod, FILE_STORAGE_PROVIDER=s3 + S3 credentials from env)
   - File storage rules:
     Store files in storage (NOT DB), only metadata in document_attachments
     Allowed: PDF, PNG, JPG, XLSX; max 10MB per file
     Storage key: UUID-based (NOT original filename) to prevent path traversal
     Download: signed URL (1hr expiry for S3) or token-protected proxy (for local)
     NEVER expose internal storage path to clients
   - POST /api/v1/attachments with multipart/form-data { entityType, entityId, file }
     Returns { attachmentId, downloadUrl }
   - New component: apps/web-frontend/src/components/erp/ERPDocumentUpload.tsx
     Drag-and-drop + file type/size validation + upload progress + file list with download + delete
   - Add document upload section to:
     apps/web-frontend/src/pages/sales/InvoiceDetailPage.tsx
     apps/web-frontend/src/pages/purchase/PurchaseOrderFormPage.tsx

3. Feature Flag Admin UI
   - Backend: GET /api/v1/admin/feature-flags + PATCH /api/v1/admin/feature-flags
     Guard: ADMIN role only
     Use packages/platform-sdk/src/feature-flags.ts read/write methods
     Validate flag name against known flag registry — reject unknown names (400)
   - New page: apps/web-frontend/src/pages/admin/FeatureFlagsPage.tsx
     List of feature flags with toggle switch per flag; state persists after page refresh
     Save button

4. PDF Export for All Reports
   - apps/report-service/src/domain/PdfEngine.ts: extend to support all report types
   - apps/report-service/src/api/report.routes.ts: add ?format=pdf query param to all report endpoints
   - All report pages (AR Aging, AP Aging, Stock Valuation, all 8 from ES-17):
     Add "Export PDF" button alongside existing "Export CSV"

5. .env.example: add FILE_STORAGE_PROVIDER, S3_BUCKET, S3_REGION, S3_ACCESS_KEY, S3_SECRET_KEY

6. apps/web-frontend/src/App.tsx: register new admin routes

═══════════════════════════════════════════
ARCHITECTURE RULES
═══════════════════════════════════════════

- Document files in storage (local or S3), only metadata in DB
- File keys: UUID-based — never use original filename as storage key
- Download: never expose storage path; use signed URL or proxy endpoint
- MIME type: validate server-side (not just extension) before storing
- Audit log: use existing queryAuditLog() from platform-sdk — no direct table access
- Feature flags: use existing feature-flags.ts methods — no parallel system

═══════════════════════════════════════════
TESTING REQUIREMENTS
═══════════════════════════════════════════

□ Integration test: upload PDF → document_attachments row created → download URL returns file
□ Integration test: audit log GET with entityType=INVOICE → returns only invoice events for tenant
□ Unit test: PATCH feature-flags with unknown flag name → 400
□ Integration test: non-ADMIN user accessing feature flags API → 403

═══════════════════════════════════════════
VERIFICATION CHECKLIST
═══════════════════════════════════════════

□ Upload PDF to invoice → attachment visible in InvoiceDetailPage
□ Download attachment → correct file downloaded
□ AuditLogPage shows audit events for invoice confirms, payment creates, etc.
□ Filter audit log by entity type → only correct entity events shown
□ FeatureFlagsPage shows current flag states; toggle flag → persists after page refresh
□ Export PDF from AR Aging report → correctly formatted PDF downloaded
□ Non-ADMIN cannot access Feature Flags API (403)
□ User without VIEW_AUDIT_LOG cannot access audit log (403)
□ pnpm test passes in affected services
□ pnpm lint passes

═══════════════════════════════════════════
DEFINITION OF DONE
═══════════════════════════════════════════

□ Documents can be uploaded, listed, and downloaded for invoices and POs
□ Audit log viewable with filters and before/after diff
□ Feature flags toggleable via UI (ADMIN only)
□ PDF export works for all reports
□ COMPLETION REPORT saved: ERP-PLANNING/phase-completions/ES-20_COMPLETION.md
```

---

---

# POST-IMPLEMENTATION VERIFICATION CHECKLIST (All Phases)

Every ES phase session must run these checks before generating the completion report:

```
── 1. MILESTONE COMPLETENESS ────────────────────────────────────────────────
Re-read EVERY in-scope item. For each one confirm:
  ✔ Schema table(s) exist in migration file (if any)
  ✔ Domain service / business logic implemented
  ✔ API routes registered with authenticate + requirePermission
  ✔ Zod validation on all request bodies and query params
  ✔ Outbox event written in same DB transaction (for all state-changing ops)
  ✔ Frontend page / component wired (if applicable)
List any item that is missing or partial. Fix before proceeding.

── 2. VALIDATION COVERAGE ───────────────────────────────────────────────────
For every new API route verify:
  ✔ 400 returned for invalid/missing request body fields
  ✔ 401 returned when Authorization header is absent
  ✔ 403 returned when user lacks required permission
  ✔ 404 returned for unknown IDs (with tenant_id scope)
  ✔ 422 returned for business rule violations
  ✔ Error responses: { error: { code, message, details? } }
  ✔ Success responses: { data: { ... } }

── 3. BUILD CHECK ───────────────────────────────────────────────────────────
  pnpm --filter @erp/<service-name> build     (each modified service)
  pnpm --filter @erp/web-frontend build
Zero build errors required. Fix all before proceeding.

── 4. TYPESCRIPT STRICT CHECK ──────────────────────────────────────────────
  pnpm --filter @erp/<service-name> type-check
Zero errors. No implicit any, all return types declared, no non-null assertions (!),
no as unknown as X casts, consistent type imports.

── 5. LOCAL RUN & SMOKE TEST ────────────────────────────────────────────────
  pnpm --filter @erp/<service-name> dev
Test every new endpoint:
  ✔ Happy path returns correct response
  ✔ GET /health returns { status: "ok" }
  ✔ No auth → 401; no permission → 403; invalid body → 400
For frontend: http://localhost:5173 — navigate to every new page, verify:
  ✔ No blank screen, no console errors
  ✔ Create/list/edit/delete flows work
  ✔ Dark mode renders correctly

── 6. GENERATE PHASE COMPLETION REPORT ─────────────────────────────────────
Use template: ERP-PLANNING/PHASE_COMPLETION_TEMPLATE.md
Save as: ERP-PLANNING/phase-completions/ES-XX_COMPLETION.md
Report must be saved BEFORE closing the session.
```

---

*Document created: 2026-07-02*
*Owner: NEXORAA Engineering — covers ES-02 through ES-20 of ENTERPRISE_STABILIZATION_ROADMAP.md*
*ES-01 is already complete — see ENTERPRISE_STABILIZATION_ROADMAP.md for details.*
