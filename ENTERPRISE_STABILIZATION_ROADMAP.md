# ENTERPRISE STABILIZATION ROADMAP
## NEXORAA Multi-Tenant Cloth Retail ERP — Post-Implementation Execution Plan

**Status:** APPROVED FOR EXECUTION  
**Created:** 2026-07-01  
**Scope:** All improvements identified across 10 audit reports (Functional, Architecture, UI/UX, Local Execution, Design Standard, Performance, Query Optimization, Chaos Engineering, Disaster Recovery, Production Readiness)  
**Total Phases:** 20  
**Estimated Total Effort:** ~410h (~12 weeks / 6 sprints of 2 weeks each)

---

## HOW TO USE THIS DOCUMENT

Every phase is **self-contained**. A new Claude Code session assigned to any phase must:

1. Read **PROJECT CONTEXT** (next section) completely before writing a single line of code
2. Read the assigned phase in full
3. Execute **only** what is in scope for that phase
4. Never rewrite working code; never introduce breaking changes
5. Run the verification checklist before marking the phase complete
6. Fix every failing check before closing the phase

**Execution rules that apply to every phase without exception:**
- Never skip or abbreviate PROJECT CONTEXT
- Preserve all existing architecture patterns
- Preserve all existing coding standards
- Maintain backward compatibility on all public APIs
- Update tests for every change
- Run `pnpm lint && pnpm test` and resolve all failures before marking done

---

## PROJECT CONTEXT

> Every Claude session must read this section before touching any code in any phase.

### 1. ERP Domain

NEXORAA is a **multi-tenant SaaS ERP platform** targeting Indian cloth retailers and wholesalers. It handles: Sales & Invoicing, Purchase & Procurement, Inventory Management, Accounting & General Ledger, GST Compliance (Indian tax law), HR & Payroll (PF/ESI/TDS), CRM & Loyalty, Production/Job Work, Point of Sale, and Reports & Analytics.

Regulatory context: All financial data must comply with Indian GST law (CGST/SGST/IGST/cess), Companies Act 2013, and statutory HR requirements (PF under EPF Act 1952, ESI under ESI Act 1948, TDS under Income Tax Act 1961).

### 2. Multi-Tenant Architecture

- Each **tenant** is an independent business entity (a cloth retailer)
- All database tables have a `tenant_id UUID NOT NULL` column
- PostgreSQL Row-Level Security (RLS) enforces tenant isolation at the database level
- Elasticsearch uses per-tenant index naming: `{tenantId}_{resourceType}` (e.g., `abc123_items`)
- Redis keys are prefixed: `tenant:{tenantId}:{key}`
- JWT tokens carry `tenantId` in the payload; all services extract it from `request.auth.tenantId`
- **Tenant ID must never come from request body, query params, or URL params**

### 3. Technology Stack

| Layer | Technology |
|---|---|
| Runtime | Node.js 20 LTS + TypeScript 5 (strict mode) |
| HTTP Framework | Fastify 4 (all microservices) |
| Database | PostgreSQL 16 + Drizzle ORM (type-safe, no raw SQL except report-service) |
| Connection Pool | PgBouncer (transaction mode) |
| Search | Elasticsearch 8 (per-tenant indices) |
| Job Queue | BullMQ + Redis 7 |
| Event Bus | Kafka 3 (via `packages/event-bus-client`) |
| Auth | RS256 JWT — access token 15min, refresh token 7d |
| Field Encryption | AES-256-GCM (salary, TIN, IBAN columns) |
| Monorepo | Turborepo + pnpm workspaces |
| Frontend | React 18 + TypeScript 5 + Vite 5 + Tailwind CSS v4 |
| State (server) | React Query v5 (`@tanstack/react-query`) |
| State (client) | Zustand |
| Forms | react-hook-form + Zod resolver |
| Testing (unit/int) | Vitest + real PostgreSQL DB via Docker |
| Testing (E2E) | Playwright |
| Monitoring | Prometheus + Grafana + Loki |
| CI | GitHub Actions |

### 4. Verified Monorepo Folder Structure

```
apps/
  accounting-service/     # Double-entry GL, journals, fixed assets, TDS
  api-gateway/            # Reverse proxy, rate limiting, JWT validation
  auth-service/           # Login, refresh token, session management
  event-service/          # Outbox relay, event store, CQRS projections, saga orchestration
  gst-service/            # GST computation, GSTR-1/2A/3B, e-Invoice, e-Way Bill
  hr-service/             # Employees, attendance, leave, payroll
  inventory-service/      # Items, stock levels, ledger, reservations, transfers
  notification-service/   # Email, WhatsApp, push notification dispatch
  pos-frontend/           # POS React app (mobile-first)
  production-service/     # Job work orders, barcode, consignment
  purchase-service/       # Purchase orders, GRN, purchase returns, expenses
  report-service/         # Report engine, PDF, analytics, dashboard projections
  sales-service/          # Invoices, quotations, payments, loyalty, CRM campaigns
  scheduler-service/      # BullMQ cron job registration, import/export engine
  search-service/         # Elasticsearch query layer
  tenant-service/         # Tenant CRUD, onboarding, feature flags
  web-frontend/           # Main ERP React SPA

packages/
  cache-client/           # Redis wrapper (per-tenant key prefixing)
  config/                 # Shared configuration schema (Zod-validated env vars)
  db-client/              # Drizzle ORM schemas, migrations, DB connection factory
    migrations/           # SQL migration files (0000 through 0007; Phase 10/11 MISSING)
    src/schema/           # accounting, auth, crm, distributed, gst, hr, inventory,
                          # items, master, notification, production, purchase, report,
                          # rules, sales, scheduler, tenant, workflow
  event-bus-client/       # Kafka producer/consumer wrappers
  logger/                 # Pino-based structured logger
  platform-sdk/           # Core platform: audit, context, event-store, events,
                          # feature-flags, http-security, locks, rule-engine,
                          # schema-registry, telemetry, workflow
  shared-types/           # errors.ts, events.ts, permissions.ts (RBAC constants), index.ts
  shared-utils/           # Date, money, string, validation utilities

tools/
  scripts/                # DB seed scripts, migration runners

ERP-PLANNING/             # All phase documents, design system spec, audit reports
infrastructure/           # Docker Compose, infrastructure configs
load-tests/               # k6 load test scripts
```

### 5. Service Internal Structure (Standard Pattern)

Every microservice follows this structure. Do not deviate:

```
src/
  api/          # Fastify route definitions — input validation (Zod) only; no business logic
  domain/       # Services, Engines, Calculators — all business logic lives here
  consumers/    # Kafka event consumers (Inbox pattern)
  jobs/         # BullMQ job processors (when present)
  middleware/   # authenticate.ts, authorize.ts (per-service copies)
  main.ts       # Fastify app bootstrap, plugin registration
```

Repositories are embedded inline in domain services for this codebase (no separate `repository/` layer). All DB access uses Drizzle ORM via `packages/db-client`.

### 6. Distributed System Patterns

**Outbox Pattern**
Every domain event is written atomically to `outbox_events` in the **same DB transaction** as the business mutation. The `apps/event-service` polls `outbox_events WHERE published = false` and publishes to Kafka (or dispatches directly to consumers). Consumers mark events processed in `inbox_events`.

**Inbox Pattern (Idempotency)**
Every Kafka consumer checks `inbox_events` by `event_id` before processing. If the event_id already exists in `inbox_events`, the consumer skips processing (exactly-once semantics).

**CQRS**
- Write model: normalized Drizzle ORM tables (source of truth)
- Read model: `projection_*` tables maintained by event consumers in `apps/event-service`
- Dashboard and analytics always read from projections — never from the write model

**Saga Pattern**
Multi-step distributed transactions use compensating sagas. Saga definitions live in `apps/event-service/src/api/saga.routes.ts` and domain services. Each step emits an event; on failure, compensating events are emitted to rollback.

**Event Sourcing**
Domain events are stored in `domain_events` table with: `(tenant_id, aggregate_id, aggregate_type, event_type, payload, version, created_at)`.

### 7. API Conventions

- **Base path:** `/api/v1/{resource}`
- **Methods:** `GET` (list/read), `POST` (create), `PATCH /:id` (partial update), `DELETE /:id` (soft delete)
- **Success response:** `{ data: T, meta?: { page, limit, total } }`
- **Error response:** `{ error: { code: string, message: string, details?: unknown } }`
- **Pagination:** query params `?page=1&limit=20` (default limit: 20, max: 100)
- **Tenant ID:** always from `request.auth.tenantId` — never from request body
- **Timestamps:** UTC ISO 8601 strings (`2026-01-15T10:30:00.000Z`)
- **Money:** integers in paise (1 INR = 100 paise) — never floats
- **Sorting:** `?sortBy=createdAt&sortOrder=desc`

### 8. Authentication & Authorization

```typescript
// Every route MUST have both preHandlers:
fastify.get('/resource', {
  preHandler: [authenticate, requirePermission(PERMISSIONS.RESOURCE_VIEW)],
}, handler)
```

- `authenticate` sets `request.auth = { userId, tenantId, roles, permissions[] }`
- `requirePermission(P)` checks `request.auth.permissions.includes(P)`
- All permission constants live in `packages/shared-types/src/permissions.ts`
- Tenant ID comes **only** from `request.auth.tenantId` — any route that reads it from params or body is a security bug

### 9. Tenant Isolation Rules

1. Every Drizzle query must include `.where(eq(table.tenantId, ctx.tenantId))`
2. Report-service raw SQL queries must have `WHERE tenant_id = $tenantId` — no exceptions
3. Elasticsearch queries must include `term: { tenant_id: ctx.tenantId }` filter
4. Redis cache keys must use `tenant:{tenantId}:` prefix
5. BullMQ jobs must store `tenantId` in job data and validate it on processing

### 10. Coding Standards

- TypeScript strict mode — no `any`, no unsafe type assertions
- Zod schemas for all route input validation (defined inline or in `src/api/`)
- No business logic in route handlers; route handlers call one service method
- No DB access outside domain service files
- All monetary values: integers (paise)
- All dates: UTC ISO 8601 strings
- Drizzle ORM for all DB access (except report-service raw SQL which must have explicit `tenant_id`)
- ESLint + Prettier enforced in CI — new code must pass without warnings
- No `console.log` — use `packages/logger` (`logger.info`, `logger.error`, etc.)
- Errors: throw typed error classes from `packages/shared-types/src/errors.ts`
- Error codes: `{MODULE}_{TYPE}` pattern (e.g., `INVOICE_NOT_FOUND`, `STOCK_INSUFFICIENT`)

### 11. Frontend Design System (Mandatory)

**CSS Framework:** Tailwind CSS v4  
**Dark Mode:** `@custom-variant dark` directive — do NOT add `darkMode: 'class'` to config  
**Theme:** `ThemeContext` in `apps/web-frontend/src/context/ThemeContext.tsx` manages `.dark` class on `<html>`

**Component Rules (no exceptions):**
- Tabular data: always `ERPDataGrid` from `src/components/erp/ERPDataGrid.tsx` — never raw `<table>`
- Form fields: always `ERPFormField` + `ERPInput`/`ERPSelect`/`ERPTextarea` — never raw `<input>`
- Modals/Dialogs: always `ERPConfirmModal` — never raw `<dialog>`
- Loading states: always `ERPSkeleton` — never custom spinners
- Toasts/alerts: always `useToast()` hook — never `window.alert()`
- Page headers: always `ERPPageHeader` — never custom `<h1>`
- Error boundaries: always `ERPErrorBoundary` wrapping each page component

**API Integration:**
- All API calls via React Query (`useQuery`, `useMutation`) — never raw `fetch` in components
- Invalidate related queries after every mutation
- Show `ERPSkeleton` while loading, error message on failure

**Form Validation:**
- `react-hook-form` + Zod resolver on all forms
- Inline error messages below each field via `ERPFormField`

**List Pages Standard Pattern:**
- Filter bar (search input + date range + status dropdown) above `ERPDataGrid`
- Pagination below grid via `ERPPagination`
- Empty state via `ERPEmptyState` when no data

### 12. Testing Strategy

- **Unit tests:** `{filename}.test.ts` alongside source — Vitest
- **Integration tests:** `src/__tests__/` directory — Vitest + real PostgreSQL (Docker)
- **E2E tests:** `apps/web-frontend/e2e/` — Playwright
- **Coverage targets:** >70% overall for new code; >80% for domain (service) layer
- **Minimum per change:** one success path test + one failure path test for every new service method
- **DB tests:** use a dedicated test DB (`TEST_DATABASE_URL`); reset schema between test runs

### 13. Performance Requirements

- P95 API response: < 200ms (list endpoints), < 100ms (lookup)
- Report generation: < 5s
- Search: < 300ms P95
- Dashboard load: < 2s (reads from CQRS projections only)
- No N+1 queries — list queries use single JOIN or cursor pagination

### 14. Security Requirements

- Every route has `authenticate` + `requirePermission` preHandlers
- Sensitive fields (salary, PAN, bank account, TIN): AES-256-GCM column-level encryption
- `LOGIN_RATE_LIMIT_MAX` ≤ 10 per 15-minute window
- No secrets in source code — environment variables only
- Input sanitization: Zod at route boundary — no raw user input in SQL
- Audit log: every write operation logs `(tenant_id, user_id, action, entity_type, entity_id, before, after, ip, timestamp)` via `packages/platform-sdk/src/audit.ts`

### 15. Documentation Standards

- Update `CLAUDE.md` if any convention changes
- Update inline code comments only when the WHY is non-obvious
- Do not add JSDoc for every function — only for non-obvious behavior
- API changes require updating the OpenAPI spec (if present)
- New environment variables must be added to `.env.example`
- New DB tables/columns require a corresponding Drizzle migration

---

## PHASE INDEX

| Phase | Title | Sprint | Effort | Risk | Depends On |
|---|---|---|---|---|---|
| **ES-01** | Critical Security & Routing Fixes | 1 | 1–2 days | Low | None |
| **ES-02** | Outbox Relay Worker & Accounting Infrastructure | 1 | 3–4 days | Medium | None |
| **ES-03** | Inventory Ledger Integrity | 1 | 2–3 days | Medium | ES-02 |
| **ES-04** | Database Migration Completeness | 1 | 1–2 days | Low | None |
| **ES-05** | Report Tenant Isolation & Core Financial Reports | 2 | 4–5 days | High | ES-02 |
| **ES-06** | HR Payroll Correctness & Data Security | 2 | 3–4 days | Medium | None |
| **ES-07** | RBAC & Permission Hardening | 2 | 2–3 days | Medium | None |
| **ES-08** | Sales Workflow Completeness | 2 | 4–5 days | Medium | ES-02, ES-03 |
| **ES-09** | Purchase Workflow & GRNI Accounting | 2 | 3–4 days | Medium | ES-02, ES-03 |
| **ES-10** | GST Compliance — Cess, RCM, GSTR-9 | 3 | 4–5 days | High | ES-02 |
| **ES-11** | NIC e-Invoice & e-Way Bill Integration | 3 | 4–5 days | High | ES-10 |
| **ES-12** | Statutory HR — PF/ESI, Form 16, Form 24Q | 3 | 4–5 days | Medium | ES-06 |
| **ES-13** | Inventory Valuation (FIFO/WACC) & COGS | 3 | 4–5 days | High | ES-02, ES-03 |
| **ES-14** | Input Validations & Business Rule Enforcement | 4 | 3–4 days | Medium | ES-10 |
| **ES-15** | Frontend UX Completeness & Depreciation Scheduler | 4 | 4–5 days | Low | ES-02 |
| **ES-16** | Backend Performance & Health Hardening | 4 | 3–4 days | Medium | ES-02, ES-03 |
| **ES-17** | Analytics & Reporting Completeness | 4 | 4–5 days | Low | ES-05, ES-13 |
| **ES-18** | CRM & Communication Completeness | 5 | 3–4 days | Low | ES-07 |
| **ES-19** | Enterprise Security Hardening | 5 | 4–5 days | High | ES-07 |
| **ES-20** | Enterprise Features — Audit, Attachments, Feature Flags | 5 | 4–5 days | Medium | ES-19 |

---

---

# PHASE ES-01: Critical Security & Routing Fixes

## PROJECT CONTEXT REFERENCE
Read the PROJECT CONTEXT section at the top of this document before proceeding. This phase has no additional context requirements beyond the shared context.

---

## 1. Objective
Fix five critical, fast, zero-regression issues that are blocking secure and correct operation: an unauthenticated search endpoint (security vulnerability), a misconfigured rate limit (brute-force risk), a broken route that makes Report Schedules unreachable, a silent compliance stub with no user warning, and a stale-data dashboard with no staleness indicator.

## 2. Why This Phase Exists
These five issues were confirmed by the functional audit as production blockers or active security vulnerabilities. All five can be fixed in under a combined 6 hours of work. Deferring them exposes the platform to immediate risk on any production deployment. They are grouped into a single phase because they are all surgical, localized fixes with no shared dependencies.

## 3. Scope

**In scope:**
- Add `authenticate` preHandler to all routes in `apps/search-service/src/api/search.routes.ts`
- Set `LOGIN_RATE_LIMIT_MAX` to `10` in all `.env` and `.env.example` files
- Fix route declaration order in `apps/web-frontend/src/App.tsx` line ~299 (move `/reports/schedules` before `/reports/:slug`)
- Add a visible "STUB — NOT CONNECTED TO NIC" warning banner on `apps/web-frontend/src/pages/gst/EInvoicePage.tsx`
- Add a staleness warning to `apps/web-frontend/src/pages/DashboardPage.tsx` when projection data age exceeds threshold

**Out of scope:**
- NIC e-Invoice real API integration (ES-11)
- Any other route changes
- Any business logic changes

## 4. Modules Affected
- Search Engine (security fix)
- Authentication (rate limit config)
- Reports & Analytics (route fix)
- GST Compliance (UI stub warning)
- Dashboard (staleness warning)

## 5. Files Expected to Change

| File | Change |
|---|---|
| `apps/search-service/src/api/search.routes.ts` | Add `authenticate` preHandler to all route definitions |
| `.env` (root and all service env files) | Set `LOGIN_RATE_LIMIT_MAX=10` |
| `.env.example` | Update to show `LOGIN_RATE_LIMIT_MAX=10` |
| `apps/web-frontend/src/App.tsx` | Move `/reports/schedules` route above `/reports/:slug` |
| `apps/web-frontend/src/pages/gst/EInvoicePage.tsx` | Add dismissible warning banner at page top |
| `apps/web-frontend/src/pages/DashboardPage.tsx` | Add staleness warning when `lastUpdated` > 30s |

## 6. Coding Standards to Follow
- Follow PROJECT CONTEXT Section 10 (Coding Standards)
- The `authenticate` middleware in search-service is at `apps/search-service/src/middleware/authenticate.ts` — import from there, not from other services
- Warning banners: use a Tailwind CSS v4 styled `<div>` with amber/yellow background — do not use custom CSS files
- No new npm packages for this phase

## 7. Architecture Rules
- `authenticate` must be the first preHandler on every route — do not add authorization (`requirePermission`) to search routes in this phase; that is a separate concern
- Do not modify the JWT validation logic itself — only add the middleware reference to routes
- Route reordering in `App.tsx` must not change any route paths, components, or props — only the declaration order

## 8. UI/UX Rules
- The e-Invoice STUB warning must be visually prominent (full-width amber banner at the top of the page content area, above all other content)
- Banner text: "⚠ STUB MODE: e-Invoice and e-Way Bill are not connected to the NIC portal. IRN numbers generated here are test values only. Do not use for real invoices."
- Include a dismiss button (stores dismissal in `sessionStorage` — not `localStorage`, so it reappears on next login)
- Dashboard staleness warning: non-intrusive — a small badge/chip near the KPI cards reading "Data may be stale" in amber text with a refresh icon; show only when `lastUpdatedAt` timestamp is more than 30 seconds old

## 9. Backend Rules
- Do not change any business logic in SearchEngine.ts
- The `authenticate` middleware in search-service reads the JWT from the `Authorization: Bearer {token}` header — verify this is consistent with other services before committing
- After adding `authenticate`, verify that `request.auth.tenantId` is correctly used inside `SearchEngine.ts` for tenant-scoped Elasticsearch queries (it must already be there — do not change it)

## 10. Database Rules
- No database changes in this phase

## 11. Testing Requirements
- Write one integration test for `search-service`: `GET /api/v1/search/items?q=cotton` without Authorization header must return HTTP 401
- Write one integration test: `GET /api/v1/search/items?q=cotton` with a valid JWT must return HTTP 200
- Verify the route fix manually: navigate to `/reports/schedules` in the browser and confirm `SchedulesPage` renders (not `ReportViewerPage`)
- No automated test needed for the env var change or UI warning (manual verification sufficient)

## 12. Verification Checklist

- [ ] `curl -X GET http://localhost:{PORT}/api/v1/search/items?q=test` (no auth) returns `401 Unauthorized`
- [ ] `curl -X GET http://localhost:{PORT}/api/v1/search/items?q=test -H "Authorization: Bearer {validJWT}"` returns `200`
- [ ] `LOGIN_RATE_LIMIT_MAX` is `10` in all `.env` files (grep to confirm)
- [ ] Navigate to `/reports/schedules` in browser — `SchedulesPage` renders correctly
- [ ] Navigate to `/reports/test-slug` in browser — `ReportViewerPage` renders correctly (not schedules)
- [ ] `EInvoicePage` shows amber banner at the top with dismiss functionality
- [ ] After dismissing banner, refreshing the page: banner reappears (stored in `sessionStorage`, not `localStorage`)
- [ ] Dashboard shows staleness badge when data is older than 30 seconds
- [ ] `pnpm lint` passes with zero warnings
- [ ] `pnpm test` passes in `apps/search-service`

## 13. Expected Deliverables
1. `search-service` with `authenticate` preHandler on all routes
2. All `.env` and `.env.example` files with corrected rate limit value
3. Fixed route order in `App.tsx`
4. STUB warning banner component in `EInvoicePage.tsx`
5. Staleness indicator in `DashboardPage.tsx`
6. Two new integration tests in `apps/search-service/src/__tests__/`

## 14. Definition of Done
- All 10 verification checklist items pass
- Zero new lint warnings
- Search service integration tests pass
- PR reviewed and approved
- No existing tests broken

## 15. Regression Checklist
- [ ] All other search routes still work when authenticated (items, customers, invoices)
- [ ] Other pages with `:slug` patterns still route correctly (if any)
- [ ] EInvoicePage still renders the IRN form below the banner
- [ ] Dashboard KPIs still load and display correctly when data is fresh
- [ ] All existing search-service tests still pass

## 16. Documentation Updates
- Update `.env.example` inline comment to explain `LOGIN_RATE_LIMIT_MAX` purpose and recommended value
- Add a one-line comment in `EInvoicePage.tsx` above the banner component: `// Remove this banner when NIC integration is live (see ES-11)`

## 17. Estimated Risk
**Low.** All changes are additive (adding middleware, reordering routes, adding UI elements). No business logic is touched. The only meaningful risk is that internal services calling the search-service without a JWT token will now receive 401 — verify no internal service-to-service calls hit search-service unauthenticated.

## 18. Dependencies
- **None.** This phase has no dependencies on other phases or external systems.

## 19. Rollback Strategy
1. Remove `authenticate` preHandler from search.routes.ts
2. Revert `LOGIN_RATE_LIMIT_MAX` to previous value
3. Revert route order in `App.tsx`
4. Remove banner from `EInvoicePage.tsx`
5. Remove staleness indicator from `DashboardPage.tsx`
All changes are surgical — revert is a 5-minute git diff revert.

## 20. Approval Criteria
- A security engineer confirms `curl` test (no auth → 401) passes on the deployed branch
- QA confirms `/reports/schedules` is reachable
- Product owner confirms e-Invoice STUB banner is acceptable UX during NIC integration period

---

---

# PHASE ES-02: Outbox Relay Worker & Accounting Infrastructure

## PROJECT CONTEXT REFERENCE
Read the PROJECT CONTEXT section at the top of this document. Pay special attention to Section 6 (Distributed System Patterns) — specifically the Outbox Pattern. This phase implements the missing persistent worker that makes event-driven accounting functional.

---

## 1. Objective
Implement a persistent outbox relay worker inside `apps/event-service` that continuously polls `outbox_events WHERE published = false`, publishes events to Kafka (or dispatches them directly to consumer handlers), and marks them `published = true`. Additionally, implement auto-seeding of `period_closures` rows when a new Financial Year is created, so accounting period locks function correctly.

## 2. Why This Phase Exists
The functional audit identified that all accounting journal entries — including INVOICE_CONFIRMED → Debtor DR / Sales CR, PAYMENT_RECEIVED → Bank DR / Debtor CR, and GRN_APPROVED → Inventory DR / AP CR — are never posted because no outbox relay worker runs. The `outbox_events` table accumulates rows with `published = false` indefinitely. Financial statements (P&L, Balance Sheet, Trial Balance) show zero for all operational transactions. This is the single most impactful fix in the entire roadmap. Additionally, `period_closures` rows are never auto-created, so all accounting periods appear permanently open and period-locking is never enforced.

## 3. Scope

**In scope:**
- Implement persistent polling loop inside `apps/event-service/src/` that reads `outbox_events WHERE published = false ORDER BY created_at LIMIT 100` every 500ms and publishes to Kafka
- Mark rows `published = true` and set `published_at = NOW()` after successful Kafka publish
- Implement idempotency: if publishing fails for a batch row, log the error and continue — do not lose other events in the batch
- Add dead-letter handling: after 5 failed publish attempts, set `failed = true` and `failed_reason` on the outbox row, and emit a Prometheus alert metric
- Add auto-seed of 12 `period_closures` rows (one per month) when `FinancialYearService.create()` is called in `apps/accounting-service`
- Expose a health-check endpoint in event-service: `GET /health/outbox` returning queue depth and last published timestamp

**Out of scope:**
- Changing any Kafka consumer logic
- Changing any domain service that writes to outbox_events
- LISTEN/NOTIFY optimization (deferred to ES-16)

## 4. Modules Affected
- Distributed Systems / Event Infrastructure (`apps/event-service`)
- Accounting / GL (`apps/accounting-service/src/domain/FinancialYearService.ts`)

## 5. Files Expected to Change

| File | Change |
|---|---|
| `apps/event-service/src/main.ts` | Register the outbox relay worker as a startup task |
| `apps/event-service/src/` | New file: `outbox/OutboxRelayWorker.ts` |
| `apps/event-service/src/` | New file: `outbox/outbox.types.ts` (typed outbox event shape) |
| `packages/platform-sdk/src/events.ts` | Review and potentially update `OutboxPublisher` class; do not break existing usage |
| `apps/accounting-service/src/domain/FinancialYearService.ts` | Add `seedPeriodClosures(financialYearId, startDate, endDate)` call after FY creation |
| `packages/db-client/src/schema/accounting.ts` | Verify `period_closures` table schema — add `status` column if missing |
| `.env.example` | Add `OUTBOX_RELAY_POLL_INTERVAL_MS=500`, `OUTBOX_RELAY_BATCH_SIZE=100`, `OUTBOX_MAX_RETRY_ATTEMPTS=5` |

## 6. Coding Standards to Follow
- Worker class must implement a clean `start()` and `stop()` interface for graceful shutdown
- Use `packages/logger` for all log output — no `console.log`
- Use `packages/event-bus-client` for Kafka publishing — do not create a new Kafka client
- Metrics: use `packages/platform-sdk/src/telemetry.ts` for Prometheus metrics
- All configuration from env vars via `packages/config`
- Graceful shutdown: on SIGTERM, finish current batch and stop; do not kill in-flight publishes

## 7. Architecture Rules
- The relay worker is a background process started in `main.ts` — not a Fastify route handler
- It must run as a single instance per pod (not distributed) — rely on Kafka's at-least-once delivery and inbox deduplication for exactly-once semantics
- The `outbox_events` table is the source of truth — never mark `published = true` before the Kafka `produce()` call returns successfully
- Period closures: one row per calendar month within the financial year; status = `OPEN` by default; `LOCKED` only when manually or auto-closed
- The relay worker must not block the Fastify HTTP event loop — run it in a `setInterval` or an async loop with `await`

## 8. UI/UX Rules
- This phase is backend only. No frontend changes.

## 9. Backend Rules
- Batch size: default 100 rows per poll cycle — configurable via `OUTBOX_RELAY_BATCH_SIZE` env var
- Poll interval: default 500ms — configurable via `OUTBOX_RELAY_POLL_INTERVAL_MS` env var
- Use a DB transaction when marking rows `published = true` to prevent partial updates
- Dead-letter: after `OUTBOX_MAX_RETRY_ATTEMPTS` (default 5) failures, set `failed = true` — alert via Prometheus counter `outbox_relay_dead_letter_total`
- Health endpoint must return: `{ status: 'ok'|'degraded', queueDepth: number, lastPublishedAt: string, deadLetterCount: number }`
- Period closures: each `period_closures` row must have `(id, tenant_id, financial_year_id, period_month, period_year, start_date, end_date, status, created_at)` — reuse existing schema if it exists; only add columns if missing

## 10. Database Rules
- No new migrations required for the outbox relay (table already exists)
- If `period_closures` is missing columns, add them via a new Drizzle migration (`0008_es02_period_closures.sql`) — do not edit existing migrations
- Run `pnpm drizzle-kit generate` after any schema changes; review the generated SQL before committing

## 11. Testing Requirements
- Integration test: write one event to `outbox_events` (published=false), start the relay worker, assert the event is published to Kafka within 2 seconds and `published=true` in DB
- Integration test: simulate Kafka publish failure — assert the event is retried; after max retries, `failed=true` is set
- Unit test: `FinancialYearService.create()` with a valid date range produces exactly 12 `period_closures` rows
- Unit test: creating an FY that spans partial months (e.g., Apr–Mar Indian FY) produces correct monthly boundaries

## 12. Verification Checklist

- [ ] Create a test invoice via API → confirm a row appears in `outbox_events` with `published=false`
- [ ] Wait 1–2 seconds → confirm the row is now `published=true` and `published_at` is set
- [ ] Confirm the corresponding accounting-service consumer received the INVOICE_CONFIRMED event
- [ ] Confirm a journal entry row exists in `financial_entries` for the invoice
- [ ] `GET /health/outbox` returns 200 with `queueDepth: 0` and a recent `lastPublishedAt`
- [ ] Create a new Financial Year via API → confirm 12 `period_closures` rows exist in DB
- [ ] `period_closures` rows have status `OPEN` and correct `start_date`/`end_date` for each month
- [ ] Worker shuts down gracefully on SIGTERM (no lost events)
- [ ] `pnpm test` passes in `apps/event-service` and `apps/accounting-service`

## 13. Expected Deliverables
1. `apps/event-service/src/outbox/OutboxRelayWorker.ts` — persistent relay worker
2. `apps/event-service/src/outbox/outbox.types.ts` — type definitions
3. `apps/event-service/src/main.ts` — updated to start the worker
4. `apps/accounting-service/src/domain/FinancialYearService.ts` — auto-seed period closures
5. Health endpoint `GET /health/outbox`
6. Migration `0008_es02_period_closures.sql` (if schema changes needed)
7. Integration tests for relay worker and period seeding

## 14. Definition of Done
- Outbox relay worker is running and all `published=false` events are dispatched within 2 seconds
- Creating a new FY auto-generates 12 period_closures rows
- Health endpoint returns accurate queue depth
- All integration tests pass
- No existing tests broken

## 15. Regression Checklist
- [ ] All existing event-service routes still work (event-store, projections, saga, DLQ)
- [ ] Kafka consumers in accounting-service, gst-service continue to receive events correctly
- [ ] No duplicate journal entries created (inbox deduplication working)
- [ ] Fastify HTTP response times unaffected by the background polling loop
- [ ] Existing Financial Year creation flow still works (new period seeding is additive)

## 16. Documentation Updates
- Add `OUTBOX_RELAY_POLL_INTERVAL_MS`, `OUTBOX_RELAY_BATCH_SIZE`, `OUTBOX_MAX_RETRY_ATTEMPTS` to `.env.example` with comments
- Update `ERP-PLANNING/` operational runbook section: "Outbox relay is now a persistent worker in event-service — monitor `outbox_relay_dead_letter_total` Prometheus metric"

## 17. Estimated Risk
**Medium.** The relay worker introduces a background loop in event-service. Risk: if the worker crashes, event delivery stops silently. Mitigation: health endpoint + Prometheus alert on dead-letter count. The period closures change is additive — low risk.

## 18. Dependencies
- **None** for the outbox relay (can start immediately)
- **None** for period closures
- ES-03 depends on this phase (inventory ledger events need to be relayed)

## 19. Rollback Strategy
1. Remove `OutboxRelayWorker` startup from `main.ts` — worker stops running
2. `outbox_events` rows remain; they will be published when the worker is re-enabled
3. Revert `FinancialYearService.ts` changes — period closures must be manually created
4. Revert migration (drop added columns if any) via a new down-migration

## 20. Approval Criteria
- Accounting team confirms journal entries now appear in the GL after invoice confirmation
- DevOps confirms health endpoint is reachable and Prometheus scrapes the `outbox_relay_dead_letter_total` metric
- QA confirms no duplicate journal entries in `financial_entries` for any test invoice

---

---

# PHASE ES-03: Inventory Ledger Integrity

## PROJECT CONTEXT REFERENCE
Read the PROJECT CONTEXT section at the top of this document. Note the Outbox Pattern (Section 6) — inventory ledger writes should emit outbox events so accounting consumers can post COGS journals. ES-02 must be complete (outbox relay running) before this phase is deployed to see the full effect.

---

## 1. Objective
Fix three bugs where stock movement is recorded in `items.available_qty` but NOT written to `inventory_ledger`: (1) invoice confirmation in sales-service, (2) purchase return approval in purchase-service, and (3) consignment sales not reducing main warehouse inventory.

## 2. Why This Phase Exists
`inventory_ledger` is the audit source of truth for all stock movements. It is required for stock valuation (FIFO/WACC in ES-13), inventory-to-accounting reconciliation, and stock movement reports. The functional audit confirmed that invoice confirmation deducts `available_qty` atomically but never inserts a `STOCK_OUT` entry. Every confirmed invoice since the platform launched has an incomplete stock audit trail.

## 3. Scope

**In scope:**
- Add `InventoryLedgerService.recordMovement(STOCK_OUT, ...)` call inside `InvoiceService.confirm()` transaction for each invoice line
- Add `InventoryLedgerService.recordMovement(STOCK_IN, ...)` call inside `PurchaseReturnService.approve()` transaction
- Add inventory reduction logic in the consignment sale flow so that selling consignment stock reduces the main warehouse `available_qty` and writes a `STOCK_OUT` ledger entry
- All three ledger writes must be inside the same DB transaction as the `available_qty` update

**Out of scope:**
- FIFO/WACC valuation calculations (ES-13)
- COGS journal entries (ES-13)
- GRN approval inventory ledger (verify in this phase whether GRN already writes to ledger; fix if not)

## 4. Modules Affected
- Sales & Invoicing (`apps/sales-service`)
- Purchase & Procurement (`apps/purchase-service`)
- Inventory Management (`apps/inventory-service`)

## 5. Files Expected to Change

| File | Change |
|---|---|
| `apps/sales-service/src/domain/InvoiceService.ts` | Add `inventoryLedgerService.recordMovement()` call in `confirm()` for each line item |
| `apps/purchase-service/src/domain/PurchaseReturnService.ts` | Add `inventoryLedgerService.recordMovement()` call in `approve()` |
| `apps/inventory-service/src/domain/InventoryLedgerService.ts` | Verify `recordMovement()` method exists and accepts correct parameters; extend if needed |
| Consignment-related service (check `apps/production-service/src/` or `apps/sales-service/src/domain/`) | Add `available_qty` reduction + ledger entry on consignment sale |

## 6. Coding Standards to Follow
- The ledger INSERT must occur **inside the same Drizzle transaction** as the `available_qty` UPDATE — use a transaction callback pattern
- If the ledger INSERT fails, the entire transaction must roll back (including the qty deduction)
- Never call `InventoryLedgerService` from a route handler — only from domain service methods
- The `InventoryLedgerService` lives in `apps/inventory-service` — sales-service and purchase-service must call it via its HTTP API (internal route), not by importing it directly (microservice boundary)
- Check if internal routes exist in `apps/inventory-service/src/api/` for ledger writes — if not, create an internal route at `POST /internal/ledger`

## 7. Architecture Rules
- The sales-service → inventory-service call for ledger recording must be made **within the same business transaction context** but as a synchronous HTTP call to the internal API — handle failure by throwing and rolling back the outer DB transaction
- Alternatively: emit an `INVOICE_CONFIRMED` outbox event and let inventory-service process it asynchronously via Kafka — but this breaks atomicity. **Preferred:** synchronous internal API call within the same transaction.
- Do not share database connections between services
- The outbox event for accounting (INVOICE_CONFIRMED) should already exist — do not add duplicate events

## 8. UI/UX Rules
- This phase is backend only. No frontend changes.

## 9. Backend Rules
- `recordMovement()` signature: `(type: 'STOCK_IN'|'STOCK_OUT'|'ADJUSTMENT', itemId, warehouseId, quantity, unitCost, referenceType, referenceId, tenantId, tx?)`
- The `referenceType` should be `'INVOICE'`, `'PURCHASE_RETURN'`, or `'CONSIGNMENT_SALE'` and `referenceId` should be the corresponding document ID
- After each ledger write, verify that `items.available_qty` and the sum of all `inventory_ledger` entries reconcile (optional assertion in development mode)
- GRN approval: check `apps/purchase-service/src/domain/GRNService.ts` — if it already writes to ledger, document it and move on; if not, add it in this phase

## 10. Database Rules
- No new tables needed — `inventory_ledger` table already exists in schema
- No new migrations needed unless `inventory_ledger` is missing columns
- Verify schema: `inventory_ledger` should have `(id, tenant_id, item_id, warehouse_id, movement_type, quantity, unit_cost, reference_type, reference_id, created_at, created_by)`

## 11. Testing Requirements
- Integration test: confirm an invoice → assert a `STOCK_OUT` row exists in `inventory_ledger` for each line item with the correct quantity and `reference_id = invoiceId`
- Integration test: approve a purchase return → assert a `STOCK_IN` row exists in `inventory_ledger`
- Integration test: simulate ledger INSERT failure (mock) → assert the invoice confirmation rolls back and `available_qty` is unchanged
- Unit test: `InventoryLedgerService.recordMovement()` with valid params inserts the correct row

## 12. Verification Checklist

- [ ] Confirm an invoice via API → `SELECT * FROM inventory_ledger WHERE reference_id = {invoiceId}` returns one row per line item
- [ ] Each `inventory_ledger` row has `movement_type = 'STOCK_OUT'`, correct `quantity`, and non-null `unit_cost`
- [ ] Approve a purchase return → `SELECT * FROM inventory_ledger WHERE reference_id = {returnId}` returns rows with `movement_type = 'STOCK_IN'`
- [ ] Verify `items.available_qty` matches the balance computed from `inventory_ledger` for a test item
- [ ] Simulate ledger failure (temporarily throw in recordMovement) → invoice confirmation fails and qty is not changed
- [ ] GRN approval writes to inventory_ledger (verify or fix)
- [ ] `pnpm test` passes in `apps/sales-service`, `apps/purchase-service`, `apps/inventory-service`

## 13. Expected Deliverables
1. `InvoiceService.ts` with ledger write inside confirm() transaction
2. `PurchaseReturnService.ts` with ledger write inside approve() transaction
3. Consignment sale flow with ledger write + available_qty reduction
4. `InventoryLedgerService.ts` verified/extended with correct `recordMovement()` signature
5. Internal API route in inventory-service for cross-service ledger writes (if needed)
6. Integration tests for all three scenarios

## 14. Definition of Done
- Every confirmed invoice has corresponding `STOCK_OUT` rows in `inventory_ledger`
- Every approved purchase return has corresponding `STOCK_IN` rows in `inventory_ledger`
- Ledger write failure causes transaction rollback (no orphaned qty changes)
- All integration tests pass

## 15. Regression Checklist
- [ ] Invoice confirmation still works end-to-end (status transitions, outbox events, payment linkage)
- [ ] Purchase return approval still updates supplier balance
- [ ] Stock level queries still return correct `available_qty` for all items
- [ ] Existing inventory-service tests pass (item.integration.test.ts)

## 16. Documentation Updates
- Add comment in `InvoiceService.confirm()` above the ledger write: `// Writes STOCK_OUT to inventory_ledger for audit trail and FIFO valuation (ES-03)`
- Document the internal ledger API endpoint in the service's README if one exists

## 17. Estimated Risk
**Medium.** Modifying the `confirm()` transaction boundary is the highest-risk change — a bug here could fail invoice confirmations for all tenants. Mitigation: thorough integration tests with rollback simulation, feature-flagged deployment if possible.

## 18. Dependencies
- **ES-02** should be complete before deploying — so that INVOICE_CONFIRMED events (which already exist) trigger accounting consumers and the new ledger writes are visible end-to-end
- `inventory_ledger` table must exist in the schema (confirmed in `packages/db-client/src/schema/inventory.ts`)

## 19. Rollback Strategy
1. Revert `InvoiceService.ts` and `PurchaseReturnService.ts` changes
2. Invoice confirmation reverts to the previous behavior (qty deducted, no ledger entry)
3. Existing `inventory_ledger` rows written during the phase deployment remain — they are correct data and should not be deleted
4. No migration rollback needed (no schema changes)

## 20. Approval Criteria
- Inventory manager confirms that `SELECT COUNT(*) FROM inventory_ledger` grows by the correct number of rows after confirming 10 test invoices
- QA confirms invoice confirmation flow has no regression (PDF generation, outbox events, customer notifications still work)

---

---

# PHASE ES-04: Database Migration Completeness

## PROJECT CONTEXT REFERENCE
Read the PROJECT CONTEXT section at the top of this document. Confirmed migration gap: migrations exist from `0000` through `0007`. Schema files `packages/db-client/src/schema/production.ts` and `packages/db-client/src/schema/report.ts` define tables with no corresponding migration SQL. This phase generates and verifies the missing migrations.

---

## 1. Objective
Generate the missing Drizzle ORM migration files for all tables defined in `schema/production.ts` and `schema/report.ts` that do not yet have a corresponding migration, and verify that applying these migrations on a clean PostgreSQL database produces all expected tables.

## 2. Why This Phase Exists
The functional audit identified that `job_work_orders`, `barcode_batches`, `barcodes`, `consignment_stocks`, `consignment_settlements`, `report_schedules`, and `report_run_history` tables are defined in schema files but have no migration SQL. On any fresh production deployment, these tables will not exist, causing runtime crashes in `apps/production-service`, `apps/report-service`, and any service that touches barcode/consignment data.

## 3. Scope

**In scope:**
- Run `pnpm drizzle-kit generate` to detect the schema-migration gap
- Review the generated SQL diff carefully — it must only add new tables/indexes, not alter existing ones
- Commit the generated migration file as `0008_es04_phase10_11_tables.sql`
- Verify by applying migrations against a clean test PostgreSQL database
- Confirm all tables exist with correct columns, constraints, and indexes

**Out of scope:**
- Any schema changes to existing tables
- Any application code changes
- Phase 10/11 business logic (production-service, report scheduling)

## 4. Modules Affected
- Database (`packages/db-client`)
- Production/Job Work (schema only — `apps/production-service`)
- Report Scheduling (schema only — `apps/report-service`)

## 5. Files Expected to Change

| File | Change |
|---|---|
| `packages/db-client/migrations/0008_es04_phase10_11_tables.sql` | **New file** — generated migration |
| `packages/db-client/migrations/meta/_journal.json` | Updated by drizzle-kit automatically |

## 6. Coding Standards to Follow
- Do not hand-write the migration SQL — use `pnpm drizzle-kit generate` to generate it from the Drizzle schema
- Review the generated SQL before committing — reject the migration if it contains `ALTER TABLE`, `DROP`, or `TRUNCATE` on existing tables
- If `drizzle-kit generate` produces unexpected changes to existing tables, investigate why (drift between schema and migration state) before proceeding

## 7. Architecture Rules
- Migrations are append-only — never edit an existing migration file
- Migration file names follow the pattern: `{sequence}_{description}.sql`
- The migration must be idempotent-safe: running it twice must not fail (use `IF NOT EXISTS` for table creation)
- All new tables must have `tenant_id UUID NOT NULL` and a corresponding index on `(tenant_id)` plus `(tenant_id, id)`

## 8. UI/UX Rules
- This phase is database-only. No frontend changes.

## 9. Backend Rules
- No application code changes in this phase
- After migration is applied, run `apps/production-service` and `apps/report-service` to confirm they start without "relation does not exist" errors

## 10. Database Rules
- New tables must include: `id UUID PRIMARY KEY DEFAULT gen_random_uuid()`, `tenant_id UUID NOT NULL`, `created_at TIMESTAMPTZ DEFAULT NOW()`, `updated_at TIMESTAMPTZ DEFAULT NOW()`
- Foreign key constraints should reference correct parent tables
- Add indexes: `CREATE INDEX IF NOT EXISTS idx_{table}_{tenant_id} ON {table}(tenant_id)` for all new tables
- Verify no existing table is altered by the generated migration

## 11. Testing Requirements
- Run migrations on a fresh `postgres:16` Docker container — all tables must be created successfully
- Connect to the migrated DB and run: `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'` — confirm all expected tables are present
- Start `apps/production-service` against the migrated DB — confirm it starts without errors
- Start `apps/report-service` against the migrated DB — confirm it starts without errors

## 12. Verification Checklist

- [ ] `pnpm drizzle-kit generate` completes without errors
- [ ] Generated migration contains only `CREATE TABLE IF NOT EXISTS` and `CREATE INDEX IF NOT EXISTS` statements — no `ALTER TABLE`, no `DROP`
- [ ] Migration applied to fresh DB: all 7 target tables exist (`job_work_orders`, `barcode_batches`, `barcodes`, `consignment_stocks`, `consignment_settlements`, `report_schedules`, `report_run_history`)
- [ ] Each new table has `tenant_id` column and index on `(tenant_id)`
- [ ] `apps/production-service` starts cleanly after migration
- [ ] `apps/report-service` starts cleanly after migration
- [ ] Existing migration files `0000` through `0007` are unmodified (git diff confirms)

## 13. Expected Deliverables
1. `packages/db-client/migrations/0008_es04_phase10_11_tables.sql` — verified migration
2. Updated `migrations/meta/_journal.json`

## 14. Definition of Done
- Migration file is committed and applies cleanly on a fresh database
- All 7 tables exist with correct schema
- Both `production-service` and `report-service` start without errors
- No existing migrations are modified

## 15. Regression Checklist
- [ ] All existing migrations `0000`–`0007` still apply in sequence without errors
- [ ] All existing services start without errors after applying the new migration
- [ ] No existing table columns are changed or dropped

## 16. Documentation Updates
- Add comment in `packages/db-client/migrations/0008_es04_phase10_11_tables.sql` header: `-- Phase ES-04: Production and Report Scheduling tables (Phase 10/11 schema gap fix)`

## 17. Estimated Risk
**Low.** This phase only adds new tables. It cannot break existing functionality. The only risk is if `drizzle-kit generate` incorrectly detects schema drift in existing tables — mitigated by carefully reviewing the generated SQL before committing.

## 18. Dependencies
- None. This phase is fully independent and can run in parallel with any other phase.

## 19. Rollback Strategy
1. Run a down-migration that drops the 7 new tables (write a manual rollback script if drizzle-kit does not generate one)
2. Restore `_journal.json` to its previous state
3. All application functionality is unaffected (no code uses these tables yet)

## 20. Approval Criteria
- DBA or tech lead reviews the generated SQL and confirms it contains only additive changes
- CI pipeline applies the migration in the test environment without failures

---

---

# PHASE ES-05: Report Tenant Isolation & Core Financial Reports

## PROJECT CONTEXT REFERENCE
Read the PROJECT CONTEXT section at the top of this document. This phase touches `apps/report-service/src/domain/ReportEngine.ts` which contains 57 raw SQL queries. The critical rule: **every raw SQL query in report-service must include `WHERE tenant_id = $tenantId`** derived from `request.auth.tenantId`. This phase also adds AR Aging and AP Aging reports, which require ES-02 to be complete so that `financial_entries` contains real data.

---

## 1. Objective
Audit all 57 raw SQL queries in `ReportEngine.ts` for missing tenant_id filters (a cross-tenant data exposure risk), then implement AR Aging Summary and AP Aging Summary reports — the two most critical financial management reports identified in the audit.

## 2. Why This Phase Exists
The functional audit found that `report-service/src/domain/ReportEngine.ts` uses raw `db.execute(sql\`...\`)` queries where tenant_id injection from `PlatformContext` cannot be automatically verified. If any query is missing the `WHERE tenant_id =` clause, a tenant can see another tenant's financial data. Additionally, AR Aging and AP Aging reports — core receivables/payables management tools — are completely absent, preventing finance teams from tracking overdue customers and vendors.

## 3. Scope

**In scope:**
- Enumerate all 57 raw SQL queries in `ReportEngine.ts`
- For each query: confirm it includes `WHERE tenant_id = ${ctx.tenantId}` (or equivalent); add it if missing
- Write a parameterized test for each query that asserts tenant isolation (two-tenant setup; query tenant A returns only tenant A data)
- Implement AR Aging Summary: SQL query + `GET /api/v1/reports/ar-aging` endpoint + `ArAgingPage.tsx` frontend
- Implement AP Aging Summary: SQL query + `GET /api/v1/reports/ap-aging` endpoint + `ApAgingPage.tsx` frontend

**Out of scope:**
- Refactoring the report engine architecture
- Migrating raw SQL to Drizzle ORM (separate initiative if desired)
- Other reports (ES-17)

## 4. Modules Affected
- Reports & Analytics (`apps/report-service`)
- Accounting/GL (data source for aging reports: `financial_entries`, `invoices`, `supplier_payments`)
- Web Frontend (new report pages)

## 5. Files Expected to Change

| File | Change |
|---|---|
| `apps/report-service/src/domain/ReportEngine.ts` | Add missing `tenant_id` WHERE clauses; document each query's tenant filter |
| `apps/report-service/src/domain/ReportRegistry.ts` | Register AR Aging and AP Aging reports |
| `apps/report-service/src/api/report.routes.ts` | Add `GET /ar-aging` and `GET /ap-aging` route handlers |
| `apps/report-service/src/__tests__/` | New: `report-tenant-isolation.test.ts` (57 parameterized tests), `ar-aging.test.ts`, `ap-aging.test.ts` |
| `apps/web-frontend/src/pages/reports/` | New: `ArAgingPage.tsx`, `ApAgingPage.tsx` |
| `apps/web-frontend/src/App.tsx` | Register new report page routes |

## 6. Coding Standards to Follow
- All raw SQL must use parameterized queries — never string interpolation for tenant_id: `sql\`WHERE tenant_id = ${ctx.tenantId}\`` (Drizzle tagged template handles parameterization)
- Report query results must be typed — define a TypeScript interface for each report's row shape
- New report pages use `ERPDataGrid` with bucket columns (0–30, 31–60, 61–90, 90+)
- AR/AP Aging pages must show totals row at the bottom of the grid

## 7. Architecture Rules
- The tenant_id filter must be applied in the SQL WHERE clause — not as a post-query JavaScript filter
- Report queries must read from the write model tables (`invoices`, `financial_entries`, `purchase_orders`) — not from projections (projections may not be complete)
- AR Aging SQL: join `invoices` with `financial_entries` (or `invoice_payments`) to compute outstanding balance per customer, then bucket by `(NOW() - invoice_date)` in days
- AP Aging SQL: same pattern for supplier invoices and payments

## 8. UI/UX Rules
- AR Aging page: `ERPDataGrid` columns: Customer Name, 0–30 Days (₹), 31–60 Days (₹), 61–90 Days (₹), 90+ Days (₹), Total Outstanding (₹)
- AP Aging page: same structure for suppliers
- Both pages: filter bar with date-as-of picker (defaults to today), branch filter, currency display in Indian number format (lakhs/crores)
- Both pages: export to Excel button (CSV download)
- Totals row at bottom of each column using `ERPDataGrid` footer aggregation
- Route AR Aging: `/reports/ar-aging`, AP Aging: `/reports/ap-aging`

## 9. Backend Rules
- Aging buckets computed in SQL using `CASE WHEN (NOW()::date - invoice_date) BETWEEN 0 AND 30 THEN outstanding_amount ELSE 0 END AS bucket_0_30`
- "As of date" parameter: `?asOf=2026-07-01` — defaults to current date; filter invoices issued on or before this date
- Outstanding balance: `invoice_total_amount - COALESCE(paid_amount, 0)`
- Only include invoices with `outstanding_balance > 0` and status NOT IN ('CANCELLED', 'DRAFT')
- Response pagination: these reports typically have 20–500 rows — paginate at 100 per page with totals in response `meta`

## 10. Database Rules
- No new tables or columns
- Add database index on `invoices(tenant_id, invoice_date, status)` if not already present — verify in `0007_phase13_indexes.sql`
- The AS-OF date filter must use an index-compatible range: `WHERE invoice_date <= $asOfDate`

## 11. Testing Requirements
- Tenant isolation: create two tenants (A and B) with separate invoices; query AR aging as tenant A — assert zero rows from tenant B
- AR Aging correctness: create invoices aged 10, 45, 75, 95 days — assert each appears in the correct bucket
- AP Aging correctness: same for purchase invoices
- Edge case: fully paid invoice must not appear in aging (outstanding = 0)
- Edge case: partially paid invoice must appear with the remaining balance only

## 12. Verification Checklist

- [ ] All 57 queries in `ReportEngine.ts` have been reviewed — each has a `// ✓ tenant_id filtered` comment or a fix applied
- [ ] Tenant isolation test passes: tenant A query returns zero tenant B rows
- [ ] `GET /api/v1/reports/ar-aging?asOf=2026-07-01` returns correct buckets for test data
- [ ] `GET /api/v1/reports/ap-aging` returns correct buckets for test data
- [ ] AR Aging page renders in browser with `ERPDataGrid`, filter bar, and totals row
- [ ] AP Aging page renders in browser similarly
- [ ] Export to CSV downloads correct data
- [ ] Both pages are accessible via sidebar navigation
- [ ] `pnpm test` passes in `apps/report-service`
- [ ] `pnpm lint` passes

## 13. Expected Deliverables
1. All 57 queries in `ReportEngine.ts` verified and annotated
2. `report-tenant-isolation.test.ts` with parameterized tests for tenant isolation
3. AR Aging endpoint + SQL query
4. AP Aging endpoint + SQL query
5. `ArAgingPage.tsx` frontend page
6. `ApAgingPage.tsx` frontend page
7. Routes registered in `App.tsx`

## 14. Definition of Done
- Zero raw SQL queries in ReportEngine.ts are missing tenant_id filters
- AR and AP aging reports return correct bucket data for test scenarios
- Both pages render correctly in browser with all UI components
- All new tests pass

## 15. Regression Checklist
- [ ] Existing reports still return correct data (not over-filtered)
- [ ] Existing report page (`ReportsPage.tsx`, `ReportViewerPage.tsx`) still functions
- [ ] Dashboard data is unaffected
- [ ] `apps/report-service` starts cleanly

## 16. Documentation Updates
- Add AR Aging and AP Aging to the report catalog in `ERP-PLANNING/`
- Document the SQL query pattern for tenant isolation in a comment at the top of `ReportEngine.ts`

## 17. Estimated Risk
**High.** This phase has the largest blast radius: modifying 57 raw SQL queries risks accidentally breaking existing reports if a WHERE clause is added incorrectly. Mitigation: the parameterized tenant isolation test suite catches any regression. Do not edit queries for which the tenant filter is already confirmed — annotation only.

## 18. Dependencies
- **ES-02** — financial_entries must contain real journal data for aging calculations to be meaningful
- No other phase dependencies

## 19. Rollback Strategy
1. Revert `ReportEngine.ts` changes — existing reports return to previous behavior
2. Remove AR/AP Aging routes from `report.routes.ts` and pages from `App.tsx`
3. The tenant isolation annotation (comments only) can be reverted or left in place

## 20. Approval Criteria
- Finance team confirms AR Aging report correctly identifies overdue customers using live data
- Security review confirms the tenant isolation test passes and cross-tenant queries are impossible
- QA confirms all pre-existing reports produce identical results post-change

---

---

# PHASE ES-06: HR Payroll Correctness & Data Security

## PROJECT CONTEXT REFERENCE
Read the PROJECT CONTEXT section at the top of this document. Key constraint: salary data must use AES-256-GCM field-level encryption (see Section 14, Security Requirements). The `employeeSalaries` table is already encrypted; `payrollSlips.grossSalary` and `payrollSlips.netSalary` are stored in plain text — this phase fixes that.

---

## 1. Objective
Fix four HR/Payroll gaps: encrypt payslip salary columns that are currently stored in plain text, add a guard that prevents payroll from silently computing zero-salary for employees without an assigned salary structure, add an individual payslip view to the payroll page, and implement a Holiday Calendar master so that attendance and leave calculations respect public holidays.

## 2. Why This Phase Exists
Employee salary data is sensitive personal information. The functional audit found that `payrollSlips.grossSalary` and `payrollSlips.netSalary` are stored in plain decimal while `employeeSalaries` is encrypted — an inconsistency that exposes salary history via any DB backup or admin query. Additionally, payroll calculation silently produces incorrect results when an employee has no salary structure assigned, and individual payslips are inaccessible from the UI.

## 3. Scope

**In scope:**
- Add AES-256-GCM encryption to `payrollSlips.grossSalary` and `payrollSlips.netSalary` columns
- Add a pre-calculation guard in `PayrollEngine.ts` that throws `PAYROLL_NO_SALARY_STRUCTURE` if an employee has no salary structure before computing
- Add `PayslipViewPage.tsx` — individual payslip view accessible from `PayrollPage.tsx`
- Add Holiday Calendar: `holiday_calendars` table + CRUD API in hr-service + `HolidayCalendarPage.tsx`

**Out of scope:**
- PF/ESI challan generation (ES-12)
- Form 16 / Form 24Q (ES-12)
- Attendance device integration

## 4. Modules Affected
- HR & Payroll (`apps/hr-service`)
- Web Frontend (new pages)
- Database (`packages/db-client/src/schema/hr.ts`)

## 5. Files Expected to Change

| File | Change |
|---|---|
| `packages/db-client/src/schema/hr.ts` | Change `grossSalary`/`netSalary` column type to encrypted text; add `holiday_calendars` table |
| `packages/db-client/migrations/` | New migration: `0009_es06_hr_encryption_holidays.sql` |
| `apps/hr-service/src/domain/PayrollEngine.ts` | Add salary structure check guard + decrypt payslip fields on read |
| `apps/hr-service/src/api/payroll.routes.ts` | Add `GET /payroll-slips/:id` route for individual payslip |
| `apps/hr-service/src/api/` | New: `holiday.routes.ts` — CRUD for holiday calendar |
| `apps/web-frontend/src/pages/hr/PayrollPage.tsx` | Add "View Payslip" action per employee row |
| `apps/web-frontend/src/pages/hr/` | New: `PayslipViewPage.tsx` — individual payslip detail |
| `apps/web-frontend/src/pages/hr/` | New: `HolidayCalendarPage.tsx` — manage public holidays |
| `apps/web-frontend/src/App.tsx` | Register new page routes |

## 6. Coding Standards to Follow
- Use the existing encryption utility from `packages/platform-sdk/src/` or `packages/shared-utils/src/` — do not implement a new AES-256-GCM utility
- The encryption key must come from environment variable `FIELD_ENCRYPTION_KEY` — never hardcode
- Encrypted columns must decrypt on read transparently — callers should receive plain values
- The migration for encryption must handle existing plain-text rows: encrypt them in the migration using a one-time SQL function call
- Holiday calendar: one `holiday_calendars` row per tenant per holiday; bulk-import from a JSON list is a nice-to-have in this phase only if effort allows

## 7. Architecture Rules
- Encryption/decryption must occur in the domain service layer (`PayrollEngine.ts`), not in the route handler or repository
- Holiday calendar follows the same CRUD pattern as other master tables in hr-service
- The individual payslip endpoint `GET /payroll-slips/:id` must verify the payslip belongs to the requesting tenant before returning data

## 8. UI/UX Rules
- `PayslipViewPage.tsx`: display payslip in a printer-friendly layout (candidate for PDF export later in ES-20)
  - Show: employee name, designation, pay period, earnings breakdown, deductions breakdown, gross salary, net salary, employer PF contribution
  - Print button (browser `window.print()` for now)
- `HolidayCalendarPage.tsx`: `ERPDataGrid` with columns: Holiday Name, Date, Type (National/State/Optional), Branch (optional)
  - Add Holiday button → inline form or modal
  - Import holidays: provide a seed button for current FY national holidays (hardcoded list for 2026–27 Indian national holidays)
- `PayrollPage.tsx`: add "View Payslip" icon/button in each row's action column

## 9. Backend Rules
- Before encrypting existing rows in migration: create a DB backup snapshot (note this in deployment runbook)
- `PayrollEngine.ts` guard: `if (!employee.salaryStructureId) throw new ERPError('PAYROLL_NO_SALARY_STRUCTURE', 'Employee has no salary structure assigned', 422)`
- Holiday calendar must be considered in leave calculation: if an approved leave day falls on a holiday, it should not consume leave balance (verify if leave calculation already handles this; fix if not)
- Individual payslip API: `GET /api/v1/hr/payroll-slips/:id` — include employee details, salary structure breakdown, deductions, and employer contributions

## 10. Database Rules
- Migration strategy for existing plaintext salary data:
  ```sql
  -- Pseudo-approach: use a PostgreSQL extension or run a one-time Node.js script
  -- that reads all existing payrollSlips rows, encrypts values in application layer,
  -- and updates them — safer than in-DB encryption
  ```
- Add `holiday_calendars` table with: `(id, tenant_id, name, holiday_date, holiday_type, branch_id, created_at)`
- Add index: `(tenant_id, holiday_date)` on `holiday_calendars`

## 11. Testing Requirements
- Unit test: `PayrollEngine.ts` throws `PAYROLL_NO_SALARY_STRUCTURE` when employee has no structure
- Integration test: run payroll for an employee with a salary structure — `payrollSlips.grossSalary` is stored encrypted (verify by reading raw DB value and confirming it is not a plain number)
- Integration test: `GET /payroll-slips/:id` returns decrypted gross/net salary values
- Integration test: create a holiday, run leave calculation on that day — leave balance not consumed

## 12. Verification Checklist

- [ ] `SELECT gross_salary FROM payroll_slips LIMIT 1` in psql returns an encrypted ciphertext (not a plain number)
- [ ] `GET /api/v1/hr/payroll-slips/{id}` returns `{ grossSalary: 50000, netSalary: 45000 }` (decrypted)
- [ ] Running payroll for an employee with no salary structure returns 422 with error code `PAYROLL_NO_SALARY_STRUCTURE`
- [ ] `PayslipViewPage.tsx` renders with all salary components and a print button
- [ ] `HolidayCalendarPage.tsx` renders with add/delete holiday functionality
- [ ] Existing payroll run functionality still works for employees with valid salary structures
- [ ] New migration applies cleanly and existing plaintext salary rows are migrated to encrypted form
- [ ] `pnpm test` passes in `apps/hr-service`

## 13. Expected Deliverables
1. Encrypted `grossSalary`/`netSalary` columns in `payrollSlips` with migration
2. Payroll guard in `PayrollEngine.ts`
3. Individual payslip API endpoint
4. Holiday Calendar API (CRUD)
5. `PayslipViewPage.tsx` frontend
6. `HolidayCalendarPage.tsx` frontend
7. Integration and unit tests

## 14. Definition of Done
- Salary data is encrypted at rest in `payroll_slips` table
- Payroll fails clearly (not silently) for employees without salary structure
- Individual payslip is viewable in the UI
- Holiday calendar is manageable by HR admin

## 15. Regression Checklist
- [ ] Payroll run for employees with salary structures still produces correct amounts
- [ ] Leave balance calculation unchanged for non-holiday days
- [ ] Employee view page still works
- [ ] Attendance page unaffected

## 16. Documentation Updates
- Add `FIELD_ENCRYPTION_KEY` to `.env.example` with a note: "AES-256-GCM key — must be 32 bytes"
- Update deployment runbook: "Backup payroll_slips table before applying migration 0009"

## 17. Estimated Risk
**Medium.** The encryption migration on existing data is the highest-risk step — a bug could corrupt existing payslip records. Mitigation: run the data migration as a separate Node.js script (not SQL), with a dry-run mode that reads and verifies decryption before writing.

## 18. Dependencies
- **None** for payroll guard and holiday calendar
- Existing encryption utility in platform-sdk must be identified and reused (do not create a new one)

## 19. Rollback Strategy
1. Restore `payroll_slips` from backup if encryption migration corrupts data
2. Revert schema to plaintext columns
3. Revert `PayrollEngine.ts` guard (employees with no structure return zero-salary again)
4. Remove new pages and routes

## 20. Approval Criteria
- HR manager confirms that a raw DB query on `payroll_slips` shows encrypted values (not plain numbers)
- QA confirms that the payroll run workflow and payslip view both work end-to-end
- Security review confirms the encryption key is loaded from env and not hardcoded

---

---

# PHASE ES-07: RBAC & Permission Hardening

## PROJECT CONTEXT REFERENCE
Read the PROJECT CONTEXT section at the top of this document. Permission constants are in `packages/shared-types/src/permissions.ts`. All routes must use `requirePermission(PERMISSIONS.X)` preHandler. This phase adds 7 missing permission constants and wires them as route guards on existing routes.

---

## 1. Objective
Define 7 missing RBAC permission constants and add them as `requirePermission()` preHandlers on the specific routes they are meant to protect, preventing any authenticated user from performing sensitive operations regardless of their role.

## 2. Why This Phase Exists
The functional audit identified 7 permissions that are missing from `permissions.ts`: `VIEW_AUDIT_LOG`, `CREDIT_LIMIT_OVERRIDE`, `PRICE_FLOOR_OVERRIDE`, `CANCEL_POSTED_JOURNAL`, `VIEW_SALARY_DETAILS`, `IMPERSONATE_USER`, and `EXPORT_CUSTOMER_DATA`. Without these, any user with basic authentication can override customer credit limits, sell below cost, reverse posted journals, view all employee salaries, and export all customer personal data — serious internal control and GDPR violations.

## 3. Scope

**In scope:**
- Add 7 new permission constants to `packages/shared-types/src/permissions.ts`
- Add `requirePermission(PERMISSIONS.CREDIT_LIMIT_OVERRIDE)` to invoice credit limit bypass routes in sales-service
- Add `requirePermission(PERMISSIONS.PRICE_FLOOR_OVERRIDE)` to price-below-cost override routes in sales-service
- Add `requirePermission(PERMISSIONS.CANCEL_POSTED_JOURNAL)` to journal reversal routes in accounting-service
- Add `requirePermission(PERMISSIONS.VIEW_SALARY_DETAILS)` to payroll detail routes in hr-service
- Add `requirePermission(PERMISSIONS.EXPORT_CUSTOMER_DATA)` to customer data export routes in sales-service
- Add `requirePermission(PERMISSIONS.VIEW_AUDIT_LOG)` to audit log routes (if they exist)
- Add `requirePermission(PERMISSIONS.IMPERSONATE_USER)` to any user impersonation endpoint in auth-service
- Assign new permissions to appropriate default roles in tenant-service or wherever role seeding occurs

**Out of scope:**
- Building new UI for permissions management
- Changing the roles and permissions data model
- Any feature flag changes

## 4. Modules Affected
- RBAC / Permissions (`packages/shared-types`)
- Sales & Invoicing (`apps/sales-service`)
- Accounting / GL (`apps/accounting-service`)
- HR & Payroll (`apps/hr-service`)
- Auth (`apps/auth-service`)
- Tenant Management (`apps/tenant-service` — role seeding)

## 5. Files Expected to Change

| File | Change |
|---|---|
| `packages/shared-types/src/permissions.ts` | Add 7 new permission constants |
| `apps/sales-service/src/api/invoice.routes.ts` | Add `CREDIT_LIMIT_OVERRIDE` and `PRICE_FLOOR_OVERRIDE` guards to relevant routes |
| `apps/sales-service/src/api/customer.routes.ts` | Add `EXPORT_CUSTOMER_DATA` guard to export endpoint |
| `apps/accounting-service/src/api/journal.routes.ts` | Add `CANCEL_POSTED_JOURNAL` guard to reversal route |
| `apps/hr-service/src/api/payroll.routes.ts` | Add `VIEW_SALARY_DETAILS` guard to payroll detail routes |
| `apps/auth-service/src/` | Add `IMPERSONATE_USER` guard to impersonation endpoint (if it exists) |
| Tenant role seeding file (locate in `apps/tenant-service/src/`) | Assign new permissions to ADMIN and MANAGER roles |

## 6. Coding Standards to Follow
- Permission constant naming: `UPPER_SNAKE_CASE` matching the pattern of existing permissions in `permissions.ts`
- The `requirePermission` call must be the **second** preHandler (after `authenticate`): `preHandler: [authenticate, requirePermission(PERMISSIONS.X)]`
- Do not combine multiple permissions in a single `requirePermission` call — create separate middleware calls if a route needs multiple permissions

## 7. Architecture Rules
- Permission checks occur at the route layer — never inside domain services
- Domain services must trust that the caller has already been authorized (no re-checking permissions in service methods)
- Role-permission assignments are seeded data — store in the same location where existing roles are seeded

## 8. UI/UX Rules
- This phase is primarily backend. No new UI pages.
- Ensure that existing UI components that call now-protected routes handle 403 responses gracefully (show `ERPEmptyState` with "Permission required" message)

## 9. Backend Rules
- Before adding a permission guard to a route, identify which existing user roles should have that permission — assign them in the role seed data
- `CREDIT_LIMIT_OVERRIDE`: assign to `SALES_MANAGER` and `ADMIN` roles only
- `PRICE_FLOOR_OVERRIDE`: assign to `SALES_MANAGER` and `ADMIN` roles only
- `CANCEL_POSTED_JOURNAL`: assign to `ACCOUNTANT_SUPERVISOR` and `ADMIN` roles only
- `VIEW_SALARY_DETAILS`: assign to `HR_MANAGER` and `ADMIN` roles only
- `EXPORT_CUSTOMER_DATA`: assign to `ADMIN` and `DATA_OFFICER` roles only
- `VIEW_AUDIT_LOG`: assign to `ADMIN` and `AUDITOR` roles only
- `IMPERSONATE_USER`: assign to `SUPER_ADMIN` role only

## 10. Database Rules
- No schema changes — permissions are constants in code and seeded as role-permission associations in the DB
- If role-permission associations are stored in a table (check `packages/db-client/src/schema/auth.ts`), insert new rows via a migration or seed script

## 11. Testing Requirements
- Integration test per new permission: call the protected route without the permission (use a test user that lacks it) — assert 403
- Integration test per new permission: call the protected route with a user that has the permission — assert 200/expected response
- Total: minimum 14 integration tests (7 permissions × 2 scenarios each)

## 12. Verification Checklist

- [ ] `packages/shared-types/src/permissions.ts` contains all 7 new constants
- [ ] `GET /api/v1/hr/payroll-runs/{id}/details` returns 403 for a user without `VIEW_SALARY_DETAILS`
- [ ] `POST /api/v1/accounting/journals/{id}/reverse` returns 403 for user without `CANCEL_POSTED_JOURNAL`
- [ ] Credit limit override route returns 403 for user without `CREDIT_LIMIT_OVERRIDE`
- [ ] All 14 permission integration tests pass
- [ ] Admin role can access all new protected routes (admin has all permissions)
- [ ] `pnpm test` passes in all affected services
- [ ] No existing functionality broken for users with appropriate roles

## 13. Expected Deliverables
1. 7 new permission constants in `permissions.ts`
2. Permission guards on 6 existing routes across 4 services
3. Role-permission seed data updated
4. 14 integration tests

## 14. Definition of Done
- All 7 permissions defined and wired to routes
- Integration tests confirm 403 for unauthorized users and 200 for authorized users
- No existing authorized workflows broken

## 15. Regression Checklist
- [ ] Admin users can still access all routes they previously accessed
- [ ] Accountants can still create and view journals (only reversal of posted journals requires new permission)
- [ ] Salespeople can still create invoices (only credit limit bypass requires new permission)
- [ ] HR managers can still view payroll runs (only detailed salary breakdown requires new permission)

## 16. Documentation Updates
- Update `ERP-PLANNING/` permissions reference document with 7 new permissions and their assigned roles
- Add comment in `permissions.ts` above each new constant explaining which routes it protects

## 17. Estimated Risk
**Medium.** Adding permission guards to existing routes may break the UI for users who previously had implicit access and now receive 403. Mitigation: carefully map which user roles need each permission before deployment; communicate role changes to tenant admins.

## 18. Dependencies
- **None.** This phase is independent of other phases.

## 19. Rollback Strategy
1. Remove `requirePermission` calls from the protected routes — routes revert to requiring only authentication
2. Remove 7 new constants from `permissions.ts` (safe — unused constants cause no harm if removed)
3. Revert role seed data changes

## 20. Approval Criteria
- Security team confirms that a test user without `CANCEL_POSTED_JOURNAL` permission cannot reverse a posted journal entry
- QA confirms that Admin and Manager roles can perform all operations they could before this phase

---

---

# PHASE ES-08: Sales Workflow Completeness

## PROJECT CONTEXT REFERENCE
Read the PROJECT CONTEXT section at the top of this document. This phase depends on ES-02 (outbox relay must be running for auto-email to work) and ES-03 (inventory ledger must be writing before quotation-to-invoice conversion makes sense). Review `apps/sales-service/src/domain/` carefully — `InvoiceService.ts`, `QuotationService.ts`, `PaymentService.ts`, and `LoyaltyService.ts` are all in scope.

---

## 1. Objective
Complete four sales workflow gaps: Customer PDC (post-dated cheque) management, automatic price list assignment by customer group on invoice creation, auto-email of invoice PDF on confirmation, and Quotation-to-Delivery-Challan direct conversion.

## 2. Why This Phase Exists
These four gaps create daily operational friction: sales agents must manually select price lists (causing pricing errors), customers do not automatically receive invoice PDFs (manual email burden), PDC management happens outside the ERP (breaking receivables tracking), and confirmed quotations cannot be directly converted to delivery challans (missing the cloth retail workflow).

## 3. Scope

**In scope:**
- PDC Management: `customer_pdcs` table + CRUD API + scheduler job to auto-clear PDCs on cheque date + `CustomerPdcPage.tsx`
- Price List Auto-Assign: in `InvoiceService.create()`, when `customerId` is provided, look up `customer.customerGroupId` → `customerGroup.priceListId` and auto-set `priceListId` on invoice lines
- Auto-Email Invoice PDF: in `InvoiceService.confirm()`, emit `INVOICE_PDF_EMAIL` outbox event; notification-service consumes it and sends the PDF to `invoice.customer.email`
- Quotation-to-Delivery-Challan: in `QuotationService.ts`, add `convertToDeliveryChallan(quotationId)` method + API route + UI button on `QuotationDetailPage.tsx`

**Out of scope:**
- Multi-currency invoices
- Barcode scanner integration
- Sales target module

## 4. Modules Affected
- Sales & Invoicing (`apps/sales-service`)
- Notification (`apps/notification-service`)
- Web Frontend (new page, updated pages)
- Database (`packages/db-client/src/schema/sales.ts`)

## 5. Files Expected to Change

| File | Change |
|---|---|
| `packages/db-client/src/schema/sales.ts` | Add `customer_pdcs` table |
| `packages/db-client/migrations/` | New: `0010_es08_customer_pdcs.sql` |
| `apps/sales-service/src/domain/InvoiceService.ts` | Add price list auto-assign in `create()`; add auto-email outbox event in `confirm()` |
| `apps/sales-service/src/domain/QuotationService.ts` | Add `convertToDeliveryChallan()` method |
| `apps/sales-service/src/api/` | New: `pdc.routes.ts`; update `quotation.routes.ts` for conversion endpoint |
| `apps/scheduler-service/src/jobs/system-jobs.ts` | Add PDC auto-clear daily job |
| `apps/notification-service/src/` | Add `INVOICE_PDF_EMAIL` event consumer |
| `apps/web-frontend/src/pages/sales/` | New: `CustomerPdcPage.tsx`; update `QuotationDetailPage.tsx` |
| `apps/web-frontend/src/App.tsx` | Register PDC page route |

## 6. Coding Standards to Follow
- PDC state machine: `PENDING → PRESENTED → CLEARED | BOUNCED | CANCELLED`
- The auto-email must be asynchronous (via outbox event) — do not make a synchronous HTTP call to notification-service inside `confirm()`
- Price list lookup: use a single DB join in the invoice creation query — do not make an extra round-trip to fetch the price list
- Quotation conversion: the quotation must be in status `ACCEPTED` to be convertible; throw `QUOTATION_INVALID_STATUS` otherwise

## 7. Architecture Rules
- PDC auto-clear: use the BullMQ scheduler job in `scheduler-service/src/jobs/system-jobs.ts` — not a cron in sales-service
- The auto-email consumer in notification-service reads `invoice.customer.email` from the event payload — the event payload must include all necessary data (do not require notification-service to make an API call back to sales-service)
- Quotation → Delivery Challan conversion creates a new `delivery_challans` record in the same service (sales-service already has `DeliveryChallanService.ts`)

## 8. UI/UX Rules
- `CustomerPdcPage.tsx`: `ERPDataGrid` columns: Cheque Number, Bank, Amount, Cheque Date, Customer Name, Status; filter by status and date range
- PDC add form: Cheque Number, Bank Name, IFSC, Amount, Cheque Date, Remarks
- QuotationDetailPage: add "Convert to Delivery Challan" button — visible only when quotation status = `ACCEPTED`; shows confirmation modal before converting
- After conversion: show success toast and navigate to the new delivery challan detail page

## 9. Backend Rules
- PDC auto-clear job: daily at 00:30 IST; query `customer_pdcs WHERE cheque_date = TODAY AND status = PENDING`; update status to `PRESENTED` and emit `PDC_PRESENTED` event
- Price list priority: if `customer.priceListId` is set directly, use it first; fall back to `customerGroup.priceListId`; fall back to default price list
- Auto-email: the `INVOICE_PDF_EMAIL` event payload must include `{ invoiceId, customerId, customerEmail, customerName, tenantId, pdfUrl (or inline base64) }`
- Quotation conversion: copy quotation lines to delivery challan lines with the same items and quantities; set `sourceQuotationId` on the delivery challan

## 10. Database Rules
- `customer_pdcs` schema: `(id, tenant_id, customer_id, cheque_number, bank_name, ifsc_code, amount_paise, cheque_date, status, remarks, created_by, created_at, updated_at)`
- Index: `(tenant_id, cheque_date, status)` on `customer_pdcs`
- No changes to existing tables

## 11. Testing Requirements
- Unit test: `InvoiceService.create()` with a customer belonging to group G1 (with price list P1) auto-assigns P1 to invoice lines
- Unit test: `QuotationService.convertToDeliveryChallan()` on an ACCEPTED quotation creates a delivery challan with the same lines
- Unit test: converting a DRAFT quotation throws `QUOTATION_INVALID_STATUS`
- Integration test: confirm an invoice → assert `INVOICE_PDF_EMAIL` event in `outbox_events`
- Integration test: PDC auto-clear job → PDCs with today's cheque_date are set to PRESENTED

## 12. Verification Checklist

- [ ] Create invoice for customer in group G1 (group has price list P1) → invoice lines use P1 prices automatically
- [ ] Confirm invoice → `outbox_events` has `INVOICE_PDF_EMAIL` event with customer email in payload
- [ ] Notification-service processes event and sends email (check notification logs)
- [ ] Create a PDC → PDC appears in `CustomerPdcPage.tsx` list
- [ ] Trigger PDC auto-clear manually → PDCs with today's date change to PRESENTED
- [ ] Accept a quotation → "Convert to Delivery Challan" button is visible on detail page
- [ ] Click button → delivery challan created with same line items
- [ ] `pnpm test` passes in `apps/sales-service` and `apps/scheduler-service`

## 13. Expected Deliverables
1. `customer_pdcs` table and migration
2. PDC CRUD API in sales-service
3. PDC auto-clear BullMQ job
4. Price list auto-assign in `InvoiceService.create()`
5. Auto-email outbox event in `InvoiceService.confirm()`
6. `INVOICE_PDF_EMAIL` consumer in notification-service
7. `convertToDeliveryChallan()` in `QuotationService.ts`
8. `CustomerPdcPage.tsx` frontend
9. "Convert to Delivery Challan" button on `QuotationDetailPage.tsx`

## 14. Definition of Done
- Price list is auto-assigned on invoice creation for customers with a group price list
- Invoice confirmation triggers email dispatch (verifiable via notification logs)
- PDCs can be created, tracked, and auto-cleared
- Accepted quotations can be converted to delivery challans in one click

## 15. Regression Checklist
- [ ] Invoice creation still works when customer has no group (no price list auto-assign, no crash)
- [ ] Existing quotation flow (create, edit, accept) unchanged
- [ ] Existing delivery challan creation flow unchanged
- [ ] Existing payment flow unchanged

## 16. Documentation Updates
- Add PDC management to the Sales module user guide in `ERP-PLANNING/`
- Document the price list priority logic in `InvoiceService.ts` as a comment

## 17. Estimated Risk
**Medium.** Price list auto-assign touches the invoice creation flow — a bug could assign the wrong price list to all new invoices. Mitigation: thorough unit tests with multiple customer-group scenarios; add a regression test that confirms invoices without a group-assigned price list still work.

## 18. Dependencies
- **ES-02** — auto-email requires outbox relay to dispatch `INVOICE_PDF_EMAIL` events
- **ES-03** — quotation-to-delivery-challan uses the established inventory ledger write pattern

## 19. Rollback Strategy
1. Revert price list auto-assign in `InvoiceService.create()` — manual price list selection resumes
2. Remove `INVOICE_PDF_EMAIL` event emission from `confirm()` — emails stop being sent
3. Disable PDC auto-clear job in `JobRegistry.ts`
4. Remove `convertToDeliveryChallan()` route and method

## 20. Approval Criteria
- Sales manager confirms price lists are correctly auto-assigned for 5 test customers from different groups
- Customer confirms receiving invoice email after confirmation (UAT)
- QA confirms quotation-to-delivery-challan conversion creates correct line items

---

---

# PHASE ES-09: Purchase Workflow & GRNI Accounting

## PROJECT CONTEXT REFERENCE
Read the PROJECT CONTEXT section at the top of this document. This phase depends on ES-02 for GRNI accrual journal posting. Key file: `apps/purchase-service/src/domain/GRNService.ts` — the GRN approval flow must emit a GRNI outbox event that triggers accounting-service to post the accrual journal.

---

## 1. Objective
Implement GRNI (Goods Received Not Invoiced) accrual accounting so that receiving goods creates a balance sheet liability before the supplier invoice arrives, and add a vendor credit limit check on Purchase Order creation to prevent unauthorized overspend.

## 2. Why This Phase Exists
Without GRNI accrual journals, the balance sheet understates liabilities whenever goods are received but the supplier invoice has not yet been processed. This misrepresents the company's financial position, especially at period end. Additionally, POs can be raised against vendors without any spend limit validation, risking unauthorized commitments.

## 3. Scope

**In scope:**
- On GRN approval: emit `GRN_APPROVED` outbox event with `{ grnId, supplierId, totalValuePaise, lineItems, tenantId }` payload
- In `apps/accounting-service/src/consumers/GRNAccountingConsumer.ts`: post GRNI accrual journal (Inventory DR / GRNI Accrual Payable CR)
- When supplier invoice (purchase invoice) is matched to GRN: reverse the GRNI accrual (GRNI Accrual Payable DR / Accounts Payable CR)
- Vendor credit limit check: in `PurchaseOrderService.create()`, compare `(vendor.outstandingBalance + newPOTotal)` against `vendor.creditLimit`; throw `VENDOR_CREDIT_LIMIT_EXCEEDED` if exceeded; only users with `CREDIT_LIMIT_OVERRIDE` permission can bypass

**Out of scope:**
- Purchase budget by category (deferred)
- Supplier performance scorecard (deferred)
- Multi-currency POs

## 4. Modules Affected
- Purchase & Procurement (`apps/purchase-service`)
- Accounting / GL (`apps/accounting-service`)
- Web Frontend (minimal — add credit limit display to supplier form/view)

## 5. Files Expected to Change

| File | Change |
|---|---|
| `apps/purchase-service/src/domain/GRNService.ts` | Emit `GRN_APPROVED` outbox event with value payload on GRN approval |
| `apps/purchase-service/src/domain/PurchaseOrderService.ts` | Add vendor credit limit check in `create()` |
| `apps/accounting-service/src/consumers/GRNAccountingConsumer.ts` | Implement GRNI accrual journal posting |
| `apps/accounting-service/src/consumers/` | Update or create consumer for supplier invoice → reverse GRNI accrual |
| `packages/db-client/src/schema/purchase.ts` | Add `credit_limit_paise` column to suppliers table (if missing) |
| `packages/db-client/migrations/` | New: `0011_es09_grni_vendor_credit.sql` |
| `apps/web-frontend/src/pages/suppliers/SupplierFormPage.tsx` | Add credit limit field |

## 6. Coding Standards to Follow
- The GRNI outbox event must be emitted **inside the GRN approval transaction** — not after it
- Journal entry: `{ debit: 'Inventory/Stock Account', credit: 'GRNI Accrual Payable', amount: grnTotal, reference: grnId }`
- Use the existing `PostingMatrixService.ts` in accounting-service for account code resolution — do not hardcode account codes

## 7. Architecture Rules
- GRNI accrual is an accounting entry — it belongs in accounting-service as a Kafka consumer, not in purchase-service
- The GRNI reversal must be triggered by a `SUPPLIER_INVOICE_MATCHED` event emitted when a purchase invoice is matched to a GRN
- Credit limit check must query `supplier.outstandingBalance` dynamically (sum of approved POs minus paid amounts) — do not cache this value

## 8. UI/UX Rules
- `SupplierFormPage.tsx`: add "Credit Limit" field (INR amount input, optional)
- Display a warning banner on PO creation form if vendor has an outstanding balance close to their credit limit (> 80% utilized)

## 9. Backend Rules
- Credit limit bypass: check `request.auth.permissions.includes(PERMISSIONS.CREDIT_LIMIT_OVERRIDE)` in the route handler and pass a `bypassCreditLimit` flag to the service — the service must not check permissions directly
- GRNI journal account codes: resolve via `PostingMatrixService` using posting matrix entry type `GRN_RECEIVED`
- If `PostingMatrixService` does not have a `GRN_RECEIVED` entry, add it to the default posting matrix seed data

## 10. Database Rules
- Add `credit_limit_paise BIGINT DEFAULT 0` to suppliers table
- No other schema changes

## 11. Testing Requirements
- Integration test: approve a GRN → `outbox_events` contains `GRN_APPROVED` event; accounting-service posts GRNI accrual journal
- Integration test: match supplier invoice to GRN → GRNI accrual is reversed
- Unit test: `PurchaseOrderService.create()` with vendor at 110% credit utilization throws `VENDOR_CREDIT_LIMIT_EXCEEDED`
- Unit test: same scenario with `bypassCreditLimit = true` creates the PO successfully

## 12. Verification Checklist

- [ ] Approve a GRN → `SELECT * FROM financial_entries WHERE reference_id = {grnId}` shows Inventory DR / GRNI Accrual CR
- [ ] Match supplier invoice → GRNI accrual is reversed in `financial_entries`
- [ ] Create PO for vendor with credit limit exceeded → 422 `VENDOR_CREDIT_LIMIT_EXCEEDED` response
- [ ] Admin user (with `CREDIT_LIMIT_OVERRIDE`) can create PO past limit
- [ ] `SupplierFormPage.tsx` shows credit limit field and saves correctly
- [ ] `pnpm test` passes in `apps/purchase-service` and `apps/accounting-service`

## 13. Expected Deliverables
1. `GRN_APPROVED` outbox event emission in `GRNService.ts`
2. GRNI accrual journal consumer in accounting-service
3. GRNI reversal on supplier invoice matching
4. Vendor credit limit check in `PurchaseOrderService.ts`
5. `credit_limit_paise` column in suppliers table + migration
6. Credit limit field in `SupplierFormPage.tsx`
7. Integration and unit tests

## 14. Definition of Done
- GRN approval results in a GRNI accrual journal entry in the GL
- Supplier invoice matching reverses the accrual correctly
- POs against vendors over their credit limit are rejected by default
- Admin can override credit limit with the `CREDIT_LIMIT_OVERRIDE` permission

## 15. Regression Checklist
- [ ] Existing GRN approval flow still updates `purchase_orders.received_quantity`
- [ ] Existing supplier payment flow unchanged
- [ ] POs without vendor credit limits (limit = 0) are still created freely
- [ ] Existing GRNAccountingConsumer events still process correctly

## 16. Documentation Updates
- Add GRNI accounting workflow to the Purchase module documentation in `ERP-PLANNING/`
- Document vendor credit limit check behavior in `PurchaseOrderService.ts` comment

## 17. Estimated Risk
**Medium.** Adding an outbox event to GRN approval is moderate risk — if the event payload is malformed, GRNI journals will be posted incorrectly. Mitigation: validate payload schema in the consumer before posting.

## 18. Dependencies
- **ES-02** — GRNI journal posting requires the outbox relay to be running
- **ES-07** — `CREDIT_LIMIT_OVERRIDE` permission must exist before the bypass check is implemented

## 19. Rollback Strategy
1. Remove `GRN_APPROVED` outbox event emission — GRNI journals stop being posted
2. Remove credit limit check from `PurchaseOrderService.create()` — POs can be created without limit validation
3. Retain the `credit_limit_paise` column (no harm in having it)

## 20. Approval Criteria
- Finance manager confirms GRNI accrual entries appear in the balance sheet as a liability after GRN approval
- Procurement manager confirms POs are rejected for over-limit vendors in UAT

---

---

# PHASE ES-10: GST Compliance — Cess, RCM, GSTR-9

## PROJECT CONTEXT REFERENCE
Read the PROJECT CONTEXT section at the top of this document. GST-specific context: India's GST law requires Compensation Cess on specified goods (e.g., tobacco, luxury items), Reverse Charge Mechanism (RCM) for specified services, and an Annual Return (GSTR-9). Key files: `apps/gst-service/src/domain/GSTCalculator.ts`, `apps/sales-service/src/domain/GSTCalculator.ts`, and `apps/purchase-service/src/domain/GSTCalculator.ts` (each service has its own GST calculator — all must be updated consistently).

---

## 1. Objective
Implement three GST compliance gaps: (1) Compensation Cess calculation on applicable invoice lines, (2) Reverse Charge Mechanism (RCM) self-invoice generation for specified service purchases, and (3) GSTR-9 Annual Return report generation.

## 2. Why This Phase Exists
These are legal GST compliance requirements. Cess must be charged on invoice lines for goods under cess-applicable HSN codes (e.g., 3% cess on 28% GST category items like tobacco). Without cess, the company under-collects government tax and is liable for the shortfall plus interest. RCM requires buyers to self-invoice and pay GST directly for services like Goods Transport Agency, legal services, and security — without it, the company fails to account for RCM liability. GSTR-9 is a mandatory annual filing for all registered taxpayers.

## 3. Scope

**In scope:**
- Add `cess_rate` field to `gst_rates` master (already in `packages/db-client/src/schema/gst.ts` — verify; add if missing)
- Update `GSTCalculator.ts` (in all three services) to compute `cessAmount = taxable_value × cess_rate` and include it in invoice line totals
- Add RCM flag to applicable GST configurations; on purchase invoice creation for RCM-applicable services, auto-create a self-invoice document
- Implement `GSTR9Service.ts` in gst-service that aggregates GSTR-1 and GSTR-3B data across all periods of a financial year
- Add `GET /api/v1/gst/gstr9` endpoint and `Gstr9Page.tsx` frontend

**Out of scope:**
- NIC portal API filing (ES-11)
- GSTR-4 (Composition scheme)
- GST TCS for e-commerce

## 4. Modules Affected
- GST Compliance (`apps/gst-service`)
- Sales & Invoicing (`apps/sales-service` — GST calculator)
- Purchase & Procurement (`apps/purchase-service` — RCM self-invoice)
- Web Frontend (new GSTR-9 page)

## 5. Files Expected to Change

| File | Change |
|---|---|
| `packages/db-client/src/schema/gst.ts` | Add `cess_rate DECIMAL(5,2) DEFAULT 0` to `gst_rates` table if not present |
| `packages/db-client/migrations/` | New: `0012_es10_gst_cess_rcm.sql` |
| `apps/gst-service/src/domain/GSTCalculator.ts` | Add cess calculation |
| `apps/sales-service/src/domain/GSTCalculator.ts` | Add cess calculation |
| `apps/purchase-service/src/domain/GSTCalculator.ts` | Add cess calculation + RCM detection |
| `apps/purchase-service/src/domain/` | New: `RCMService.ts` — auto-generate self-invoice for RCM purchases |
| `apps/gst-service/src/domain/` | New: `Gstr9Service.ts` — GSTR-9 data aggregation |
| `apps/gst-service/src/api/` | New: `gstr9.routes.ts` |
| `apps/web-frontend/src/pages/gst/` | New: `Gstr9Page.tsx` |
| `apps/web-frontend/src/App.tsx` | Register GSTR-9 route |

## 6. Coding Standards to Follow
- Cess amount: integer (paise) — store as `cess_amount_paise BIGINT` on invoice lines; not a float
- RCM self-invoice: use the same `purchase_invoices` table with a `document_type = 'RCM_SELF_INVOICE'` discriminator — do not create a new table
- GSTR-9 computation: pure read operation — aggregate from `gstr1_data` and `gstr3b_data` tables; no writes

## 7. Architecture Rules
- GSTCalculator consistency: all three GSTCalculator instances (`gst-service`, `sales-service`, `purchase-service`) must produce identical cess calculations for the same input — consider sharing the core cess formula in `packages/shared-utils/`
- RCM detection: check `gst_rates.is_rcm_applicable` flag on the HSN code — do not hardcode HSN codes in the service
- GSTR-9: read-only aggregation service — no DB writes except for caching the generated report in `report_run_history`

## 8. UI/UX Rules
- `Gstr9Page.tsx`: financial year selector → "Generate GSTR-9" button → loading state → display all GSTR-9 tables (Table 4 through Table 19 as per GST portal format)
- Display cess column in invoice line items on `InvoiceFormPage.tsx` (add a "Cess" column to the line items table — read-only, auto-computed)
- Show RCM indicator badge on applicable purchase invoice lines

## 9. Backend Rules
- Cess rate lookup: the `GSTCalculator` must look up `gst_rates.cess_rate` for the invoice line's HSN code; default to 0 if not found
- Invoice totals: `invoice_total = taxable_value + cgst_amount + sgst_amount + igst_amount + cess_amount`
- RCM self-invoice: created automatically and linked to the original purchase invoice; `rcm_eligible_for_itc = true` flag
- GSTR-9 structure follows the official GSTN format — 19 table sections; implement only the computable sections (4, 5, 6, 7, 8, 9, 10, 11) and mark the rest as "manual entry required"

## 10. Database Rules
- Add `cess_rate DECIMAL(5,2) DEFAULT 0` to `gst_rates` table
- Add `cess_amount_paise BIGINT DEFAULT 0` to `invoice_lines` table
- Add `is_rcm_applicable BOOLEAN DEFAULT false` to `gst_rates` table
- Add `document_type VARCHAR(30) DEFAULT 'STANDARD'` to `purchase_invoices` table (for RCM self-invoice discrimination)

## 11. Testing Requirements
- Unit test: `GSTCalculator` with cess_rate=3% on a ₹10,000 item computes `cessAmount = 300` (30,000 paise)
- Unit test: `GSTCalculator` with cess_rate=0 produces zero cess amount
- Integration test: purchase invoice for RCM-applicable service creates a corresponding self-invoice document
- Integration test: `GET /api/v1/gst/gstr9?financialYear=2025-26` returns correct aggregate data

## 12. Verification Checklist

- [ ] Create invoice line with HSN code that has cess_rate=3% → invoice shows cess amount = 3% of taxable value
- [ ] `invoice_lines.cess_amount_paise` is stored correctly in DB
- [ ] `InvoiceFormPage.tsx` shows Cess column with auto-computed values
- [ ] Create purchase invoice for GTA service (RCM applicable) → self-invoice auto-created with `document_type = 'RCM_SELF_INVOICE'`
- [ ] `GET /api/v1/gst/gstr9?financialYear=2025-26` returns 200 with GSTR-9 tables
- [ ] `Gstr9Page.tsx` renders with financial year selector and table data
- [ ] `pnpm test` passes in `apps/gst-service`, `apps/sales-service`, `apps/purchase-service`

## 13. Expected Deliverables
1. Cess calculation in all three GSTCalculator instances
2. `cess_amount_paise` column on `invoice_lines` + migration
3. `RCMService.ts` with self-invoice auto-generation
4. `Gstr9Service.ts` with GSTR-9 aggregation
5. GSTR-9 API endpoint
6. `Gstr9Page.tsx` frontend
7. Unit and integration tests

## 14. Definition of Done
- Invoice lines for cess-applicable HSN codes show and store the correct cess amount
- RCM purchase invoices auto-generate self-invoices
- GSTR-9 report is computable for a full financial year
- All tests pass

## 15. Regression Checklist
- [ ] Existing invoices without cess (cess_rate=0) are unaffected in totals
- [ ] GSTR-1 and GSTR-3B generation unchanged
- [ ] Invoice confirmation flow still works end-to-end
- [ ] Purchase invoice creation for non-RCM services is unchanged

## 16. Documentation Updates
- Add cess rate configuration to the GST setup guide in `ERP-PLANNING/`
- Document RCM-applicable HSN codes and how to flag them in `gst_rates` master

## 17. Estimated Risk
**High.** Cess changes the invoice total computation — a bug affects every invoice for cess-applicable items. Mitigation: the cess_rate defaults to 0, so existing items are unaffected until the rate is configured; thorough unit tests for the calculator.

## 18. Dependencies
- **ES-02** — GSTR-9 aggregates from journals that require the outbox relay to be posting
- **ES-07** — GST filing routes should have appropriate permissions (GST_RETURN_FILE or similar — add in ES-07 if not already present)

## 19. Rollback Strategy
1. Set all `gst_rates.cess_rate = 0` — cess computation reverts to zero for all items
2. Disable RCM self-invoice creation in `RCMService.ts`
3. Remove GSTR-9 route — existing GSTR-1/3B routes unaffected

## 20. Approval Criteria
- GST consultant or CA confirms GSTR-9 output matches expected format for a test financial year
- QA confirms cess amounts on invoices match manually calculated values for 5 test HSN codes

---

---

# PHASE ES-11: NIC e-Invoice & e-Way Bill Integration

## PROJECT CONTEXT REFERENCE
Read the PROJECT CONTEXT section at the top of this document. e-Invoice context: India's NIC (National Informatics Centre) operates the IRP (Invoice Registration Portal). Businesses with turnover > ₹5 Cr must generate an IRN (Invoice Reference Number) and QR code for every B2B invoice. e-Way Bill is mandatory for inter-state goods movement exceeding ₹50,000 in value. Both APIs are at NIC's GSP (GST Suvidha Provider) endpoints. Key files: `apps/gst-service/src/domain/EInvoiceService.ts` (currently a stub) and `apps/gst-service/src/domain/EwayBillService.ts` (currently a stub). ES-10 (cess and GSTR-9) must be complete before this phase because IRN generation requires correct invoice totals including cess.

---

## 1. Objective
Replace the stub implementations of e-Invoice IRN generation and e-Way Bill creation with real NIC API integrations, implement proper error handling so that IRN failures block invoice confirmation for eligible taxpayers, and remove the STUB warning banner added in ES-01.

## 2. Why This Phase Exists
For businesses with turnover > ₹5 Cr, every confirmed B2B invoice that lacks a valid IRN is legally non-compliant. The current stub silently returns mock IRN numbers with no indication to users that compliance is not achieved. This exposes clients to GST penalties, cancellation of input tax credit claims, and potential prosecution.

## 3. Scope

**In scope:**
- Implement real NIC IRN API calls in `EInvoiceService.ts` using NIC sandbox credentials (Phase 1) and production credentials (Phase 2)
- Implement real e-Way Bill API in `EwayBillService.ts`
- Add tenant-level configuration: `gst_configs.e_invoice_eligible` (bool) — only tenants with this flag true trigger real IRN calls
- Block invoice confirmation in `sales-service` if IRN generation fails for an eligible tenant (throw `EINVOICE_IRN_FAILED`)
- Add IRN cancel endpoint: `POST /api/v1/gst/einvoice/{irnNumber}/cancel`
- Update `EInvoicePage.tsx`: remove STUB banner (added in ES-01), show real IRN status, display QR code
- Add retry logic: if NIC API is temporarily down, queue the IRN request and retry up to 3 times with exponential backoff

**Out of scope:**
- GSTN portal filing (deferred — these are separate APIs)
- e-Invoice for B2C transactions (NIC doesn't require IRN for B2C)

## 4. Modules Affected
- GST Compliance (`apps/gst-service`)
- Sales & Invoicing (`apps/sales-service` — blocking confirm on IRN failure)
- Web Frontend (`EInvoicePage.tsx`)
- Database (`packages/db-client/src/schema/gst.ts`)

## 5. Files Expected to Change

| File | Change |
|---|---|
| `apps/gst-service/src/domain/EInvoiceService.ts` | Replace stub with real NIC IRP API calls |
| `apps/gst-service/src/domain/EwayBillService.ts` | Replace stub with real NIC e-Way Bill API calls |
| `apps/gst-service/src/api/einvoice.routes.ts` | Add cancel IRN route |
| `apps/sales-service/src/domain/InvoiceService.ts` | Add IRN generation call before finalizing `confirm()` for eligible tenants |
| `packages/db-client/src/schema/gst.ts` | Add `e_invoice_eligible BOOLEAN DEFAULT false` to `gst_configs`; add `irn_number`, `irn_qr_code`, `irn_status` to `invoices` |
| `packages/db-client/migrations/` | New: `0013_es11_einvoice_fields.sql` |
| `apps/web-frontend/src/pages/gst/EInvoicePage.tsx` | Remove STUB banner; show real IRN data and QR code |
| `.env.example` | Add `NIC_API_BASE_URL`, `NIC_CLIENT_ID`, `NIC_CLIENT_SECRET`, `NIC_SANDBOX_MODE` |

## 6. Coding Standards to Follow
- NIC API credentials must come from environment variables — never hardcoded
- All NIC API calls must have a 10-second timeout — do not let a slow NIC API block the request indefinitely
- NIC API error responses must be logged in full (for debugging) but only a sanitized message returned to the client
- The IRN and QR code (base64) must be stored encrypted in the DB — these are sensitive compliance documents

## 7. Architecture Rules
- The IRN generation call in `sales-service` must be a synchronous call to `gst-service` internal API — not an event/outbox (invoice must not be confirmed without an IRN for eligible tenants)
- For non-eligible tenants (turnover < ₹5 Cr), skip the IRN call entirely — do not call gst-service at all
- Retry logic: use the BullMQ retry mechanism in `scheduler-service` — not a custom retry loop in the service
- NIC authentication: NIC uses its own OAuth token (separate from the ERP's JWT). Store NIC tokens in Redis with TTL matching the NIC token expiry (typically 6 hours)

## 8. UI/UX Rules
- `EInvoicePage.tsx`: show IRN number, acknowledgement number, QR code image, and generation timestamp for each eligible invoice
- Show status badge: `GENERATED` (green), `PENDING` (amber), `FAILED` (red), `CANCELLED` (gray)
- Failed IRN: show error message from NIC and a "Retry" button
- QR code: display as a scannable image using the base64 data returned by NIC

## 9. Backend Rules
- Eligible tenant check: `if (tenant.gstConfig.eInvoiceEligible && invoice.isB2B) { generateIRN() }`
- IRN failure handling: `throw new ERPError('EINVOICE_IRN_FAILED', nicErrorMessage, 502)` — sales-service must catch this and NOT mark the invoice as `CONFIRMED`
- NIC token management: before each NIC API call, check Redis for a cached NIC token; if missing or expired, re-authenticate with NIC and cache the new token
- e-Way Bill: generate automatically when `invoice.isInterState && invoice.totalValuePaise > 5_000_000` (₹50,000 = 5,000,000 paise)

## 10. Database Rules
- Add `irn_number VARCHAR(64)`, `irn_ack_number VARCHAR(64)`, `irn_qr_code TEXT` (encrypted), `irn_status VARCHAR(20)`, `irn_generated_at TIMESTAMPTZ` to `invoices` table
- Add `e_invoice_eligible BOOLEAN DEFAULT false` to `gst_configs`
- Add `eway_bill_number VARCHAR(20)`, `eway_bill_valid_until TIMESTAMPTZ` to `invoices`

## 11. Testing Requirements
- Integration test (sandbox): generate a test IRN using NIC sandbox credentials — assert `irn_number` is a 64-character string
- Integration test: confirm an invoice for an e-Invoice eligible tenant → invoice is confirmed and has a non-null `irn_number`
- Integration test: simulate NIC API failure → invoice confirmation returns 502 and invoice status remains `DRAFT`
- Integration test: confirm an invoice for a non-eligible tenant → no IRN call made, invoice confirmed normally

## 12. Verification Checklist

- [ ] NIC sandbox: `POST /api/v1/gst/einvoice/generate` returns a valid IRN (64 chars) for a test invoice payload
- [ ] Confirm invoice for eligible tenant → `SELECT irn_number FROM invoices WHERE id = {id}` returns a real IRN
- [ ] STUB banner is no longer visible on `EInvoicePage.tsx`
- [ ] QR code renders as a scannable image on the page
- [ ] Simulate NIC API down (set `NIC_API_BASE_URL` to an invalid URL) → invoice confirmation returns error and invoice stays DRAFT
- [ ] Cancel an IRN → NIC cancellation API called and `irn_status = CANCELLED` in DB
- [ ] Non-eligible tenant invoice confirmed without IRN call
- [ ] `pnpm test` passes in `apps/gst-service`

## 13. Expected Deliverables
1. `EInvoiceService.ts` with real NIC IRP API integration
2. `EwayBillService.ts` with real NIC e-Way Bill integration
3. IRN cancel endpoint
4. IRN fields on `invoices` table + migration
5. Eligible tenant gate in `InvoiceService.confirm()`
6. Updated `EInvoicePage.tsx` showing real IRN data and QR code
7. NIC token caching in Redis
8. Integration tests using NIC sandbox

## 14. Definition of Done
- NIC sandbox generates real IRNs for test invoices
- Invoice confirmation for eligible tenants is blocked without a valid IRN
- Non-eligible tenants are unaffected
- QR code is displayed and scannable

## 15. Regression Checklist
- [ ] Invoice confirmation for non-eligible tenants still works (no IRN call)
- [ ] Existing e-Invoice page routes still function
- [ ] GSTR-1 data is unaffected by the IRN additions
- [ ] Invoice PDF generation still works with the new IRN fields

## 16. Documentation Updates
- Add NIC credentials setup guide to deployment documentation
- Document the e-Invoice eligibility flag in the tenant onboarding guide
- Remove STUB banner comment from `EInvoicePage.tsx` (added in ES-01)

## 17. Estimated Risk
**High.** External API integration with NIC is inherently unpredictable — NIC's sandbox has known reliability issues. Mitigation: implement graceful degradation with a feature flag `NIC_SANDBOX_MODE=true` that bypasses IRN for testing; production only uses real NIC credentials with appropriate handling.

## 18. Dependencies
- **ES-10** — GSTR invoice totals must include cess before IRN payload is submitted (NIC validates the total)
- NIC sandbox credentials (external dependency — obtain from NIC/GSTN portal)

## 19. Rollback Strategy
1. Set `gst_configs.e_invoice_eligible = false` for all tenants → no IRN calls made
2. Invoice confirmation reverts to not requiring IRN
3. STUB banner in `EInvoicePage.tsx` can be re-added as a maintenance mode notice
4. NIC token in Redis expires naturally

## 20. Approval Criteria
- GST consultant verifies a sandbox-generated IRN is correctly formatted (64-char hash, valid acknowledgement number)
- QR code passes NIC QR code verification tool
- Product owner approves the e-Invoice page UX showing IRN status

---

---

# PHASE ES-12: Statutory HR Compliance — PF/ESI, Form 16, Form 24Q

## PROJECT CONTEXT REFERENCE
Read the PROJECT CONTEXT section at the top of this document. HR statutory context: India's Employees' Provident Fund (EPF) Act 1952 requires monthly PF challan submission; the ESI Act 1948 requires bi-monthly ESI contribution challan. Income Tax Form 16 is a mandatory annual TDS certificate for every salaried employee. Form 24Q is the quarterly TDS return filed with the Income Tax Department. All of these depend on correct payroll data — ES-06 must be complete (payroll guard for unassigned salary structure) before this phase.

---

## 1. Objective
Implement PF/ESI challan generation, Form 16 (employee TDS certificate) PDF generation, and Form 24Q (quarterly TDS return) data export — the three mandatory statutory HR compliance deliverables.

## 2. Why This Phase Exists
These are legal obligations under Indian labour and tax law. Monthly PF/ESI challan non-submission results in penalties. Form 16 non-issuance by the employer means employees cannot file their income tax returns. Form 24Q non-filing results in late filing fees. Any production deployment to a company with employees requires these features operational before the first payroll run.

## 3. Scope

**In scope:**
- PF Challan: monthly per-employee PF contribution summary + challan file in the EPFO ECR (Electronic Challan cum Return) format
- ESI Challan: monthly per-employee ESI contribution summary in ESIC portal format
- Form 16 Part A: TDS deducted and deposited summary (auto-computed from payroll)
- Form 16 Part B: salary breakdown and deductions (must be digitally generated as a PDF)
- Form 24Q: quarterly salary TDS return in the prescribed text format for TIN-NSDL upload

**Out of scope:**
- Electronic filing with government portals (manual upload for now)
- Biometric integration
- Employee loan/advance management

## 4. Modules Affected
- HR & Payroll (`apps/hr-service`)
- Document/PDF Engine (`apps/report-service/src/domain/PdfEngine.ts` — reuse for Form 16 PDF)
- Web Frontend (new pages for challan download, Form 16 generation)

## 5. Files Expected to Change

| File | Change |
|---|---|
| `apps/hr-service/src/domain/` | New: `PfEsiChallanService.ts` |
| `apps/hr-service/src/domain/` | New: `Form16Service.ts` |
| `apps/hr-service/src/domain/` | New: `Form24QService.ts` |
| `apps/hr-service/src/api/payroll.routes.ts` | Add challan, Form 16, Form 24Q endpoints |
| `apps/web-frontend/src/pages/hr/PayrollPage.tsx` | Add "Download PF Challan", "Generate Form 16", "Export Form 24Q" buttons |
| `apps/web-frontend/src/pages/hr/` | New: `StatutoryCompliancePage.tsx` |
| `apps/web-frontend/src/App.tsx` | Register new page route |
| `packages/db-client/src/schema/hr.ts` | Add `pf_challan_runs` table |
| `packages/db-client/migrations/` | New: `0014_es12_statutory_hr.sql` |

## 6. Coding Standards to Follow
- PF ECR format: fixed-width text format as per EPFO specification — line length and field positions must match exactly
- Form 24Q: file in NSDL prescribed text format — use a template string approach, not a third-party library
- Form 16: use `PdfEngine.ts` for PDF generation — use HTML template + Puppeteer/wkhtmltopdf (whichever is already configured)
- All statutory amounts must be in the correct unit for the respective format (e.g., ECR expects amounts in rupees, not paise — convert on output)

## 7. Architecture Rules
- Challan generation is a read-heavy computation — query the `payroll_slips` table for the relevant month/quarter and compute totals; do not store computed challan amounts (recompute on demand)
- Form 16 PDF must be generated per-employee and stored in the document store (or served on demand)
- Form 24Q: generate as a downloadable `.txt` file in NSDL format

## 8. UI/UX Rules
- `StatutoryCompliancePage.tsx`: tabbed layout — "PF Challan", "ESI Challan", "Form 16", "Form 24Q"
- Each tab: month/quarter/year selector → "Generate" button → download link
- PF Challan tab: show per-employee breakdown before download (expandable `ERPDataGrid`)
- Form 16 tab: show employee list with "Download Form 16" per row + "Bulk Download (ZIP)" option

## 9. Backend Rules
- PF contribution: employer = 12% of basic salary; employee = 12% of basic salary; admin charges = 0.5% of basic
- ESI contribution: employer = 3.25% of gross salary (if gross ≤ ₹21,000/month); employee = 0.75%
- TDS in Form 24Q: use the TDS amounts already computed in `PayrollEngine.ts` (must be verified as correct)
- Form 16 Part A data source: `payroll_tds` table or equivalent; Form 16 Part B: salary structure from `payroll_slips`

## 10. Database Rules
- Add `pf_challan_runs` table: `(id, tenant_id, month, year, total_employee_contribution_paise, total_employer_contribution_paise, generated_at, generated_by)`
- No other schema changes

## 11. Testing Requirements
- Unit test: `PfEsiChallanService.generate(month=7, year=2026, tenantId)` returns correct PF/ESI totals for 3 test employees
- Unit test: PF ECR format output matches the EPFO ECR specification (validate line format with regex)
- Unit test: Form 24Q output file contains correct header record and one detail record per employee
- Integration test: generate Form 16 for an employee — assert PDF is returned (non-empty byte array)

## 12. Verification Checklist

- [ ] `GET /api/v1/hr/payroll/pf-challan?month=7&year=2026` returns PF ECR format text
- [ ] PF challan amounts correct: employee_contribution = 12% of basic, employer = 12% + admin charges
- [ ] ESI challan generated for employees with gross ≤ ₹21,000
- [ ] Form 16 PDF downloads successfully for a test employee
- [ ] Form 24Q `.txt` file downloads in NSDL format
- [ ] `StatutoryCompliancePage.tsx` renders with all four tabs
- [ ] `pnpm test` passes in `apps/hr-service`

## 13. Expected Deliverables
1. `PfEsiChallanService.ts` with PF ECR and ESI challan generation
2. `Form16Service.ts` with Form 16 Part A and Part B PDF generation
3. `Form24QService.ts` with NSDL quarterly return generation
4. API endpoints for all three
5. `StatutoryCompliancePage.tsx` frontend
6. `pf_challan_runs` table + migration
7. Unit tests validating format compliance

## 14. Definition of Done
- PF ECR file can be downloaded and is accepted by the EPFO ECR upload portal (manual test)
- Form 16 PDF is correctly formatted and contains all mandatory fields
- Form 24Q `.txt` file passes NSDL file validation tool

## 15. Regression Checklist
- [ ] Existing payroll run flow unchanged
- [ ] Payslip view (ES-06) still works
- [ ] Employee salary computation unchanged

## 16. Documentation Updates
- Add statutory compliance section to the HR module user guide
- Document PF/ESI rate configuration (rates are hardcoded per current law — document where to update if rates change)

## 17. Estimated Risk
**Medium.** The statutory file formats are specified by government agencies — any format deviation causes rejection. Mitigation: validate output against EPFO/ESIC/NSDL specification documents; include sample outputs in the test suite.

## 18. Dependencies
- **ES-06** — payroll guard and encryption must be complete (payroll must be correct before generating statutory reports)

## 19. Rollback Strategy
1. Remove challan/Form 16/24Q routes and pages — payroll flow unaffected
2. Retain `pf_challan_runs` table (no harm in having it)

## 20. Approval Criteria
- CA or statutory compliance officer validates PF ECR file format against EPFO specification
- QA confirms Form 16 PDF contains employee PAN, TAN, and correct TDS amounts

---

---

# PHASE ES-13: Inventory Valuation (FIFO/WACC) & COGS

## PROJECT CONTEXT REFERENCE
Read the PROJECT CONTEXT section at the top of this document. This phase depends critically on ES-03 (inventory_ledger must have STOCK_IN/STOCK_OUT entries) and ES-02 (outbox relay for COGS journal posting). Without inventory_ledger entries, FIFO/WACC computation has no data to work with.

---

## 1. Objective
Implement inventory cost valuation (FIFO and Weighted Average Cost methods) on top of the `inventory_ledger` table populated in ES-03, and use the computed unit cost to post COGS (Cost of Goods Sold) journal entries when invoices are confirmed.

## 2. Why This Phase Exists
Without inventory valuation, the P&L Gross Margin is computed as Revenue minus zero cost — meaningless. The Balance Sheet Inventory account balance does not reflect actual stock value. Stock Valuation Report (needed by finance for period-end closing) cannot be generated. COGS is the most important cost line in a retail company's P&L.

## 3. Scope

**In scope:**
- Implement FIFO cost valuation in `InventoryLedgerService.ts`: for each STOCK_OUT entry, compute the unit cost by consuming the oldest STOCK_IN layers first
- Implement WACC (Weighted Average Cost) as an alternative: `wacc = (current_stock_value + new_purchase_value) / (current_qty + new_purchase_qty)` updated on each STOCK_IN
- Add tenant-level configuration: `inventory_valuation_method` (FIFO or WACC) in tenant settings
- On invoice confirmation (after ES-03 writes STOCK_OUT): compute COGS = sum(line_qty × unit_cost) and emit `COGS_JOURNAL` outbox event
- `accounting-service`: consume `COGS_JOURNAL` event and post `COGS Expense DR / Inventory CR` journal entry
- Implement Stock Valuation Report: `GET /api/v1/reports/stock-valuation?asOf={date}` + `StockValuationPage.tsx`

**Out of scope:**
- Standard cost method
- Negative stock correction historical backfill (only new transactions from ES-03 go-live are valued)

## 4. Modules Affected
- Inventory Management (`apps/inventory-service`)
- Accounting / GL (`apps/accounting-service`)
- Reports (`apps/report-service`)
- Web Frontend (new report page)

## 5. Files Expected to Change

| File | Change |
|---|---|
| `apps/inventory-service/src/domain/InventoryLedgerService.ts` | Add `computeFIFOCost()` and `computeWACCost()` methods |
| `apps/inventory-service/src/domain/InventoryLedgerService.ts` | Update `recordMovement(STOCK_OUT)` to compute and store `unit_cost_paise` |
| `apps/sales-service/src/domain/InvoiceService.ts` | After STOCK_OUT writes, emit `COGS_JOURNAL` outbox event with computed COGS total |
| `apps/accounting-service/src/consumers/` | New: `COGSAccountingConsumer.ts` |
| `packages/db-client/src/schema/inventory.ts` | Add `unit_cost_paise BIGINT` and `valuation_method VARCHAR(10)` to `inventory_ledger` |
| `packages/db-client/migrations/` | New: `0015_es13_inventory_valuation.sql` |
| `apps/report-service/src/domain/ReportEngine.ts` | Add stock valuation report query |
| `apps/web-frontend/src/pages/reports/` | New: `StockValuationPage.tsx` |

## 6. Coding Standards to Follow
- FIFO computation must query `inventory_ledger` ordered by `created_at ASC` for STOCK_IN layers — do not sort by any other field
- WACC must be stored per `(tenant_id, item_id, warehouse_id)` — update on every STOCK_IN
- All cost values: integers (paise)
- COGS journal: one journal line per invoice line (not a single total) — enables item-level profitability analysis

## 7. Architecture Rules
- FIFO computation occurs in `inventory-service` — sales-service does not compute costs
- The `unit_cost_paise` returned by the FIFO/WACC computation is included in the `COGS_JOURNAL` event payload
- `accounting-service`'s `COGSAccountingConsumer` must use the Inbox pattern (deduplication by `event_id`) — duplicate COGS journals are a fatal accounting error
- COGS account code: resolve via `PostingMatrixService` using entry type `COGS`

## 8. UI/UX Rules
- `StockValuationPage.tsx`: `ERPDataGrid` columns: Item Name, Category, Warehouse, Quantity on Hand, Unit Cost (₹), Total Value (₹), Valuation Method (FIFO/WACC)
- As-of date picker (defaults to today)
- Export to Excel button
- Summary card at top: Total Inventory Value across all items

## 9. Backend Rules
- FIFO cost for a STOCK_OUT: iterate through available STOCK_IN layers oldest-first, consume quantities until the STOCK_OUT quantity is fulfilled; the FIFO cost is the weighted average of the consumed layers
- WACC: stored in a `inventory_wacc` table `(tenant_id, item_id, warehouse_id, current_wacc_paise, current_qty)` — update atomically on each STOCK_IN using `(old_value + new_value) / (old_qty + new_qty)`
- If no STOCK_IN layers exist (stock received before ES-03 was deployed): use `item.purchasePrice` as the fallback cost

## 10. Database Rules
- Add `unit_cost_paise BIGINT DEFAULT 0` to `inventory_ledger`
- New table: `inventory_wacc` `(id, tenant_id, item_id, warehouse_id, current_wacc_paise, current_qty, updated_at)`
- Add index: `(tenant_id, item_id, warehouse_id)` on `inventory_wacc`

## 11. Testing Requirements
- Unit test FIFO: three STOCK_IN layers (10 units @ ₹100, 5 units @ ₹120, 8 units @ ₹90), then STOCK_OUT 12 units → cost = (10×100 + 2×120) = ₹1,240
- Unit test WACC: same layers → WACC after all purchases = (10×100 + 5×120 + 8×90) / 23 = ₹102.17
- Integration test: confirm invoice → `COGS_JOURNAL` event in outbox; accounting-service consumer posts `COGS Expense DR / Inventory CR`
- Integration test: Stock Valuation Report returns correct total for 5 test items

## 12. Verification Checklist

- [ ] Confirm invoice for 3 items → `SELECT unit_cost_paise FROM inventory_ledger WHERE movement_type = 'STOCK_OUT'` shows correct FIFO cost per line
- [ ] COGS journal entry posted in `financial_entries` for each invoice line
- [ ] P&L report now shows non-zero COGS line (after ES-02 relay is running)
- [ ] `GET /api/v1/reports/stock-valuation` returns correct total for test items
- [ ] `StockValuationPage.tsx` renders with correct data and export button
- [ ] Switch valuation method to WACC → costs computed differently on next invoice
- [ ] `pnpm test` passes in `apps/inventory-service` and `apps/accounting-service`

## 13. Expected Deliverables
1. FIFO and WACC cost computation in `InventoryLedgerService.ts`
2. `unit_cost_paise` stored on every `inventory_ledger` STOCK_OUT row
3. `COGS_JOURNAL` outbox event emission in `InvoiceService.confirm()`
4. `COGSAccountingConsumer.ts` posting COGS journal
5. Stock Valuation Report endpoint
6. `StockValuationPage.tsx` frontend
7. `inventory_wacc` table + migration
8. Unit tests for FIFO and WACC algorithms

## 14. Definition of Done
- P&L Gross Margin = Revenue − COGS (non-zero, correct)
- Stock Valuation Report shows correct inventory value at any as-of date
- FIFO and WACC both produce correct costs for test scenarios

## 15. Regression Checklist
- [ ] Invoice confirmation still works end-to-end (ES-03 changes must not be broken)
- [ ] Existing accounting journal entries unaffected
- [ ] Inventory stock levels unchanged (valuation is additive computation)

## 16. Documentation Updates
- Add inventory valuation method configuration to the Inventory setup guide
- Document the FIFO algorithm in a comment block in `InventoryLedgerService.ts`

## 17. Estimated Risk
**High.** FIFO cost computation on concurrent invoice confirmations must be race-condition-safe — two simultaneous confirmations could both consume the same STOCK_IN layer. Mitigation: use a DB-level row lock (`SELECT FOR UPDATE`) on `inventory_ledger` rows being consumed for FIFO computation.

## 18. Dependencies
- **ES-02** — COGS journal posting requires outbox relay
- **ES-03** — inventory_ledger must have STOCK_IN/STOCK_OUT data

## 19. Rollback Strategy
1. Set all tenants to WACC with 0-cost fallback — COGS journals post zero COGS (better than wrong COGS)
2. Disable `COGSAccountingConsumer` — no COGS journals posted
3. Retain valuation columns (no harm)

## 20. Approval Criteria
- Finance team confirms P&L Gross Margin is non-zero and matches manually calculated COGS for a test month
- Inventory manager confirms Stock Valuation Report total matches physical stock value

---

---

# PHASE ES-14: Input Validations & Business Rule Enforcement

## PROJECT CONTEXT REFERENCE
Read the PROJECT CONTEXT section at the top of this document. Validations belong at the Zod schema layer in route handlers (format validations) and in domain service methods (business rule validations). Never add validation logic inside repositories. This phase touches multiple services — read the relevant service domain files before making changes.

---

## 1. Objective
Implement 10 missing input validations and business rules that prevent data quality issues, double-billing, overselling, and period integrity violations — all identified in the functional audit.

## 2. Why This Phase Exists
Missing validations cause silent data corruption: duplicate invoices lead to customer disputes, negative stock causes oversell, invalid GSTINs stored cause GST filing rejections, and post-period invoices break financial statements. These are not theoretical risks — they are operational failures that occur in daily use.

## 3. Scope

**In scope (10 validations/rules):**
1. **Duplicate invoice detection**: same customer + same amount ± 7 days → warn with override option
2. **Negative stock prevention**: concurrent invoice confirmations cannot reduce `available_qty` below 0 (use `SELECT FOR UPDATE` + check)
3. **GSTIN checksum validation**: enforce 15-char format + checksum regex on all GSTIN fields in all services
4. **IFSC code format**: enforce 11-char format (`[A-Z]{4}0[A-Z0-9]{6}`) on bank account IFSC fields
5. **Quotation valid_until check**: block quotation-to-invoice/delivery-challan conversion if `valid_until < today`
6. **Financial year boundary check**: block invoice creation with `invoice_date` outside the open financial year
7. **Leave overlap check**: reject leave application if another approved leave overlaps the same dates for the same employee
8. **Payroll salary structure guard**: already done in ES-06 — verify it is in place; skip if confirmed
9. **PAN format validation**: enforce `[A-Z]{5}[0-9]{4}[A-Z]{1}` regex at DB level (add CHECK constraint)
10. **EAN-13 barcode checksum**: validate barcode format checksum on client side before saving

**Out of scope:**
- MOQ validation on invoice lines (lower priority)
- Credit note auto-expiry (lower priority)

## 4. Modules Affected
- Sales & Invoicing (`apps/sales-service`)
- Inventory Management (`apps/inventory-service`)
- GST Compliance (`apps/gst-service`, `apps/sales-service`, `apps/purchase-service` — GSTIN validation)
- HR & Payroll (`apps/hr-service` — leave overlap, PAN)
- Database (`packages/db-client/src/schema/`)
- Web Frontend (client-side barcode checksum)

## 5. Files Expected to Change

| File | Change |
|---|---|
| `apps/sales-service/src/domain/InvoiceService.ts` | Add duplicate invoice check; financial year boundary check |
| `apps/inventory-service/src/domain/InventoryLedgerService.ts` | Add `SELECT FOR UPDATE` + negative stock check |
| `packages/shared-utils/src/` | New: `validators.ts` — GSTIN checksum, IFSC format, PAN format, EAN-13 checksum utilities |
| `apps/sales-service/src/api/invoice.routes.ts` | Use GSTIN validator in Zod schema |
| `apps/purchase-service/src/api/purchase-order.routes.ts` | Use GSTIN validator |
| `apps/hr-service/src/domain/` | New or update: leave overlap check in leave application logic |
| `packages/db-client/src/schema/hr.ts` | Add `CHECK (pan ~ '^[A-Z]{5}[0-9]{4}[A-Z]{1}$')` constraint on employee PAN column |
| `packages/db-client/migrations/` | New: `0016_es14_validations.sql` |
| `apps/web-frontend/src/components/erp/ERPGSTINInput.tsx` | Add checksum validation |
| `apps/web-frontend/src/` | Barcode input component: add EAN-13 checksum validation |

## 6. Coding Standards to Follow
- All validators go in `packages/shared-utils/src/validators.ts` — one exported function per validator
- Zod `.refine()` for format validations at route boundary
- Business rule violations: throw typed `ERPError` with appropriate error code
- Duplicate invoice check: warn (not block) — return a `202 Accepted` with `{ data: invoice, warnings: ['POSSIBLE_DUPLICATE'] }`

## 7. Architecture Rules
- GSTIN checksum algorithm: the last character of a GSTIN is a checksum — implement the standard algorithm (modulo 36 based on Luhn-like formula specified by GSTN)
- Negative stock: use a database-level optimistic lock — `UPDATE items SET available_qty = available_qty - $qty WHERE id = $id AND tenant_id = $tenantId AND available_qty >= $qty` — if rows_affected = 0, throw `STOCK_INSUFFICIENT`
- Financial year boundary: query `financial_years WHERE start_date <= $invoiceDate AND end_date >= $invoiceDate AND status = 'OPEN'` — if no row found, throw `INVOICE_DATE_OUT_OF_PERIOD`

## 8. UI/UX Rules
- Duplicate invoice warning: show a yellow inline banner on the invoice form ("A similar invoice may already exist — Invoice #INV-001 for same customer on 2026-06-25") with a "Create Anyway" button
- GSTIN validation: `ERPGSTINInput.tsx` — show red border + "Invalid GSTIN format" inline error on blur
- EAN-13 validation: inline error message below barcode input field if checksum fails

## 9. Backend Rules
- Duplicate detection window: `invoice_date BETWEEN (new_date - INTERVAL '7 days') AND (new_date + INTERVAL '7 days') AND customer_id = $customerId AND total_amount BETWEEN ($amount * 0.95) AND ($amount * 1.05)` (± 5% amount tolerance)
- Leave overlap: `SELECT COUNT(*) FROM leave_applications WHERE employee_id = $id AND status = 'APPROVED' AND start_date <= $endDate AND end_date >= $startDate` — if count > 0, throw `LEAVE_OVERLAP`
- PAN CHECK constraint: use a PostgreSQL CHECK constraint — this prevents any application code from bypassing the validation

## 10. Database Rules
- Add `CHECK (pan_number ~ '^[A-Z]{5}[0-9]{4}[A-Z]$')` to `employees.pan_number` column
- No other schema changes beyond the PAN constraint

## 11. Testing Requirements
- Unit test each of the 10 validators in `validators.ts` with valid and invalid inputs
- Integration test: confirm two invoices for same customer, same amount, same date → second triggers 202 with POSSIBLE_DUPLICATE warning
- Integration test: concurrent stock deduction below zero → one request succeeds, one receives STOCK_INSUFFICIENT
- Integration test: leave application overlapping existing approved leave → 422 LEAVE_OVERLAP

## 12. Verification Checklist

- [ ] GSTIN `29ABCDE1234F1Z5` validates as correct; `29ABCDE1234F1Z6` fails checksum
- [ ] Duplicate invoice attempt returns 202 with warning (not 422)
- [ ] Concurrent test: two threads simultaneously confirm invoices that deplete remaining stock of 1 unit → one succeeds, one fails
- [ ] Invoice with `invoice_date` outside open FY → 422 `INVOICE_DATE_OUT_OF_PERIOD`
- [ ] Leave application overlapping existing leave → 422 `LEAVE_OVERLAP`
- [ ] Employee with invalid PAN format rejected at DB level
- [ ] EAN-13 checksum validation works in browser barcode input
- [ ] `pnpm test` passes across all affected services

## 13. Expected Deliverables
1. `packages/shared-utils/src/validators.ts` with 5 format validators
2. Duplicate invoice detection in `InvoiceService.ts`
3. Negative stock prevention using atomic UPDATE
4. GSTIN validation on all route Zod schemas (sales, purchase, gst services)
5. Leave overlap check in hr-service
6. PAN CHECK constraint + migration
7. Client-side EAN-13 validation
8. Unit and integration tests for all 10 rules

## 14. Definition of Done
- All 10 validation rules are enforced consistently across backend and frontend
- Concurrent stock deduction test passes (no negative stock possible)
- All format validators have unit tests with valid and invalid inputs

## 15. Regression Checklist
- [ ] Valid invoices (no duplicate) still created normally
- [ ] Leave applications for non-overlapping dates still work
- [ ] Employees with valid PAN can still be created/updated
- [ ] Stock deduction for non-concurrent requests unaffected

## 16. Documentation Updates
- Add validation rules to the API error code reference in `ERP-PLANNING/`
- Document duplicate invoice detection behavior for sales agents

## 17. Estimated Risk
**Medium.** The negative stock atomic update changes the stock deduction mechanism — any bug here causes invoice confirmation failures. Mitigation: test in isolation before deploying alongside other changes.

## 18. Dependencies
- **ES-10** — financial year boundary check requires cess-inclusive invoice totals to be correct
- **ES-06** — payroll structure guard (item 8) should already be done; verify before including in scope

## 19. Rollback Strategy
1. Remove validators from Zod schemas — format validation reverts to basic Zod string
2. Remove duplicate check from `InvoiceService.ts` — all invoices accepted
3. Revert atomic stock update to previous `UPDATE` query — negative stock becomes possible again
4. Drop PAN CHECK constraint via a new migration

## 20. Approval Criteria
- QA confirms all 10 validation scenarios fail correctly with appropriate error messages
- Product owner approves the duplicate invoice warning UX (warn, not block)

---

---

# PHASE ES-15: Frontend UX Completeness & Depreciation Scheduler

## PROJECT CONTEXT REFERENCE
Read the PROJECT CONTEXT section at the top of this document. Frontend rules are in Section 11 (Frontend Design System). All UI changes must use the ERP component library (`ERPDataGrid`, `ERPFormField`, etc.). Tailwind CSS v4 with `@custom-variant dark` — no custom CSS files. This phase is primarily frontend with one backend scheduler addition.

---

## 1. Objective
Fix 9 frontend UX gaps and register the fixed asset depreciation scheduler job — all items that improve daily usability without touching business logic.

## 2. Why This Phase Exists
The UX gaps create daily operational friction: finance teams see all-warehouse aggregate stock (can't filter by warehouse), the dashboard has no branch filter (multi-branch owners see combined KPIs), `ERPDataGrid` shows no column totals, and the depreciation scheduler job exists in code but is not registered to run.

## 3. Scope

**In scope:**
1. `ERPDataGrid`: add optional `footer` prop that shows sum totals below each numeric column
2. `InvoiceFormPage.tsx`: add flat-amount discount input alongside the existing % discount
3. `AlterationsPage.tsx`: add "Print Receipt" button (browser print)
4. `FixedAssetsPage.tsx`: add depreciation schedule view per asset (modal showing monthly depreciation)
5. `DashboardPage.tsx`: add branch filter dropdown (filter KPIs by selected branch)
6. `CustomerViewPage.tsx`: add credit note balance display in the customer summary card
7. `StockLevelsPage.tsx` (InventoryPage): add warehouse filter dropdown
8. Mobile responsive audit: test main pages at 375px, 768px viewports; fix any layout overflow issues
9. Register depreciation scheduler job in `apps/scheduler-service/src/jobs/system-jobs.ts` and `JobRegistry.ts`

**Out of scope:**
- Building new report pages (ES-17)
- Building new form pages

## 4. Modules Affected
- Web Frontend (all listed pages + `ERPDataGrid` component)
- Scheduler Service (depreciation job)
- Accounting Service (depreciation computation — already implemented in `FixedAssetService.ts`)

## 5. Files Expected to Change

| File | Change |
|---|---|
| `apps/web-frontend/src/components/erp/ERPDataGrid.tsx` | Add `footer?: boolean` prop; compute column sums |
| `apps/web-frontend/src/pages/sales/InvoiceFormPage.tsx` | Add flat-amount discount field; recompute line total |
| `apps/web-frontend/src/pages/hr/AlterationsPage.tsx` | Add Print Receipt button |
| `apps/web-frontend/src/pages/accounting/FixedAssetsPage.tsx` | Add depreciation schedule modal |
| `apps/web-frontend/src/pages/DashboardPage.tsx` | Add branch filter; filter API calls by `branchId` query param |
| `apps/web-frontend/src/pages/customers/CustomerViewPage.tsx` | Add credit note balance to summary card |
| `apps/web-frontend/src/pages/inventory/StockLevelsPage.tsx` | Add warehouse filter |
| `apps/scheduler-service/src/jobs/system-jobs.ts` | Add monthly depreciation job |
| `apps/scheduler-service/src/JobRegistry.ts` | Register depreciation job with cron schedule |

## 6. Coding Standards to Follow
- `ERPDataGrid` footer: sum only columns with `type: 'currency'` or `type: 'number'` in the column definition — do not sum text columns
- Flat-amount discount: mutually exclusive with % discount — when one is entered, clear the other; recompute line total as `unit_price × qty - discount_amount`
- All Tailwind classes must use existing design tokens — no arbitrary values like `w-[347px]`
- Mobile audit: use browser DevTools responsive mode — fix any elements that overflow horizontally at 375px

## 7. Architecture Rules
- Depreciation job: run on the 1st of each month at 02:00 IST via BullMQ cron schedule `'0 2 1 * *'` (UTC adjusted for IST)
- The depreciation job calls `accounting-service`'s `FixedAssetService.runMonthlyDepreciation(tenantId)` — do not run computation in scheduler-service
- Branch filter on dashboard: add `?branchId={id}` query param to the dashboard API endpoints; backend must filter projections by branch

## 8. UI/UX Rules
- Branch filter on dashboard: dropdown at the top-right of the dashboard page, defaulting to "All Branches"
- Warehouse filter on StockLevelsPage: filter bar (above the grid), defaulting to "All Warehouses"
- Credit note balance: show as "Credit Balance: ₹12,500" in green text in the customer summary card (only show if balance > 0)
- Depreciation schedule modal: table with columns: Month, Opening Value, Depreciation, Closing Value, Accumulated Depreciation
- Footer totals on grids: show in a distinct bottom row with slightly darker background; format same as body cells

## 9. Backend Rules
- Depreciation job: must be idempotent — running twice in the same month must not double-post depreciation
- Dashboard branch filter: add `WHERE branch_id = $branchId` to projection queries when `branchId` is provided
- Credit note balance API: add to existing customer detail endpoint response (sum of non-expired, non-applied credit notes for the customer)

## 10. Database Rules
- No schema changes in this phase

## 11. Testing Requirements
- Unit test: `ERPDataGrid` with `footer: true` and 3 numeric rows renders a footer row with correct sums
- Integration test: depreciation job runs → `financial_entries` contains depreciation journal for all active assets
- Integration test: depreciation job run twice in same month → only one depreciation entry per asset
- Manual test: StockLevelsPage warehouse filter correctly shows only items in the selected warehouse

## 12. Verification Checklist

- [ ] `ERPDataGrid` with `footer={true}` shows totals row; sum is correct
- [ ] Invoice flat-amount discount: enter ₹500 discount → line total reduces by ₹500; % discount field clears
- [ ] AlterationsPage "Print Receipt" button triggers browser print dialog
- [ ] FixedAssetsPage: click asset row → depreciation schedule modal shows monthly table
- [ ] Dashboard branch filter: select Branch A → KPIs update to Branch A data only
- [ ] CustomerViewPage: customer with ₹12,500 credit note shows "Credit Balance: ₹12,500" in green
- [ ] StockLevelsPage: select Warehouse B → only Warehouse B stock shown
- [ ] Main pages at 375px width: no horizontal overflow (test: Invoice list, Dashboard, Inventory, HR pages)
- [ ] Depreciation job registered and runs on 1st of month (verify in BullMQ admin UI)
- [ ] `pnpm lint` passes

## 13. Expected Deliverables
1. `ERPDataGrid` footer totals feature
2. Flat-amount discount on invoice form
3. Print button on AlterationsPage
4. Depreciation schedule modal on FixedAssetsPage
5. Branch filter on DashboardPage
6. Credit note balance on CustomerViewPage
7. Warehouse filter on StockLevelsPage
8. Mobile responsive fixes
9. Depreciation BullMQ job registration

## 14. Definition of Done
- All 9 UX items verified in browser
- Depreciation job runs successfully in test environment
- No horizontal overflow at 375px on major pages

## 15. Regression Checklist
- [ ] `ERPDataGrid` without `footer` prop renders identically to before
- [ ] Invoice % discount still works after flat-amount discount field added
- [ ] Depreciation schedule modal does not affect the asset list rendering
- [ ] Dashboard loads correctly when no branch filter is applied

## 16. Documentation Updates
- Document `footer` prop in `ERPDataGrid` component API reference
- Note depreciation job schedule in the scheduler-service README

## 17. Estimated Risk
**Low.** Primarily additive UI changes and a new scheduler job. The highest risk is the `ERPDataGrid` footer change — it is a shared component. Mitigation: the footer is opt-in (disabled by default), so existing usages are unaffected.

## 18. Dependencies
- **ES-02** — depreciation journals require outbox relay to post

## 19. Rollback Strategy
1. Remove `footer` prop support from `ERPDataGrid` (other usages already don't pass `footer` so unaffected)
2. Revert individual page changes one by one — all changes are isolated to specific files
3. Unregister depreciation job from `JobRegistry.ts`

## 20. Approval Criteria
- Product owner demos all 9 UX improvements and confirms they match the expected behavior
- Finance confirms depreciation jobs run on the 1st of the month and post correct entries

---

---

# PHASE ES-16: Backend Performance & Health Hardening

## PROJECT CONTEXT REFERENCE
Read the PROJECT CONTEXT section at the top of this document. Performance targets: P95 API < 200ms, no N+1 queries, outbox polling should use PostgreSQL LISTEN/NOTIFY instead of 100ms polling. This phase optimizes background processes that are currently inefficient or have unbounded growth.

---

## 1. Objective
Optimize four backend performance and health issues: replace 100ms polling in the outbox publisher with PostgreSQL LISTEN/NOTIFY, add a cleanup job for expired stock reservations, add a loyalty point expiry scheduler, and add GSTR-2A input validation.

## 2. Why This Phase Exists
The 100ms polling in `OutboxPublisher` generates 10 DB queries per second per pod under any load — a connection pool drain risk at scale. The `stock_reservations` table grows unbounded as expired reservations are never deleted. Loyalty point expiry is tracked in the schema but never processed. These are operational reliability issues, not functional ones.

## 3. Scope

**In scope:**
- Replace OutboxPublisher polling loop with PostgreSQL `LISTEN/NOTIFY`: the DB triggers `NOTIFY outbox_channel` on each INSERT into `outbox_events`; the relay worker uses `pg.query('LISTEN outbox_channel')` to receive immediate notifications
- Add BullMQ cleanup job: daily at 03:00 IST, delete `stock_reservations WHERE status = 'EXPIRED' AND updated_at < NOW() - INTERVAL '30 days'`
- Add BullMQ loyalty expiry job: nightly at 01:00 IST, deduct loyalty points from `loyalty_transactions WHERE expiry_date < TODAY AND status = 'ACTIVE'`; emit `LOYALTY_EXPIRED` event
- Add GSTR-2A import validation: when `Gstr2aService.importFromJson()` is called, validate the JSON against the official GSTN GSTR-2A schema before processing

**Out of scope:**
- Connection pooling optimization (PgBouncer already configured)
- Query optimization (ES-17 audit covers reports)
- Search performance

## 4. Modules Affected
- Event Infrastructure (`apps/event-service`)
- Inventory Management (`apps/inventory-service`)
- Sales (`apps/sales-service/src/domain/LoyaltyService.ts`)
- Scheduler (`apps/scheduler-service`)
- GST Compliance (`apps/gst-service`)

## 5. Files Expected to Change

| File | Change |
|---|---|
| `apps/event-service/src/outbox/OutboxRelayWorker.ts` | Replace polling loop with LISTEN/NOTIFY; keep polling as fallback every 60s |
| `apps/scheduler-service/src/jobs/system-jobs.ts` | Add reservation cleanup job + loyalty expiry job |
| `apps/scheduler-service/src/JobRegistry.ts` | Register new jobs |
| `apps/sales-service/src/domain/LoyaltyService.ts` | Add `expirePoints(tenantId, asOfDate)` method |
| `apps/gst-service/src/domain/Gstr2aService.ts` | Add JSON schema validation before import |
| `packages/shared-utils/src/` | New: `gstr2a-schema.ts` — Zod schema for GSTR-2A JSON |

## 6. Coding Standards to Follow
- LISTEN/NOTIFY: use a dedicated PostgreSQL connection (not from the pool) for the LISTEN connection — this connection must stay open and not be returned to the pool
- Keep polling fallback at 60s intervals — in case the NOTIFY is missed (connection restart, etc.)
- Loyalty expiry: write `LOYALTY_POINTS_EXPIRED` events to outbox for CRM analytics — do not silently deduct
- GSTR-2A validation: use Zod schema, not manual field checks

## 7. Architecture Rules
- The LISTEN connection must be outside PgBouncer (direct to PostgreSQL) — PgBouncer in transaction mode does not support `LISTEN`
- Add a PostgreSQL trigger on `outbox_events` INSERT: `NOTIFY outbox_channel, NEW.id` — this requires a migration with a `CREATE TRIGGER` statement
- Loyalty expiry runs per-tenant: the scheduler job must iterate all active tenants and call `LoyaltyService.expirePoints()` for each — do not process all tenants in a single query

## 8. UI/UX Rules
- No frontend changes in this phase

## 9. Backend Rules
- LISTEN/NOTIFY trigger: `CREATE OR REPLACE FUNCTION notify_outbox() RETURNS TRIGGER AS $$ BEGIN PERFORM pg_notify('outbox_channel', NEW.id::text); RETURN NEW; END; $$ LANGUAGE plpgsql;`
- Reservation cleanup: soft-delete only if `status = 'EXPIRED'` — never delete PENDING or HELD reservations
- Loyalty expiry: zero-value deduction rows should not be created — skip employees with 0 expiring points

## 10. Database Rules
- New migration: `0017_es16_outbox_notify_trigger.sql` — adds the PG NOTIFY trigger on `outbox_events`
- No table additions or modifications

## 11. Testing Requirements
- Performance test: measure DB query rate before and after LISTEN/NOTIFY change — confirm reduction from ~10/s to near 0/s during idle
- Integration test: insert an outbox event → confirm the relay worker receives NOTIFY and processes within 100ms (vs 500ms poll interval)
- Integration test: loyalty points with `expiry_date = yesterday` → expiry job sets status = EXPIRED
- Integration test: cleanup job runs → EXPIRED reservations older than 30 days are deleted; PENDING reservations untouched

## 12. Verification Checklist

- [ ] Outbox relay NOTIFY received within 100ms of `outbox_events` INSERT (confirm via log timestamp diff)
- [ ] DB connection pool metrics: queries per second drops significantly during idle (monitor via Prometheus)
- [ ] `stock_reservations` cleanup job runs: EXPIRED rows > 30 days are deleted, PENDING rows preserved
- [ ] Loyalty expiry job: active points with past expiry date → status changed to EXPIRED
- [ ] GSTR-2A import with invalid JSON → 422 with validation error; valid JSON → imports successfully
- [ ] `pnpm test` passes in all affected services

## 13. Expected Deliverables
1. LISTEN/NOTIFY-based outbox relay with polling fallback
2. PostgreSQL NOTIFY trigger migration
3. Reservation cleanup BullMQ job
4. Loyalty points expiry BullMQ job
5. `LoyaltyService.expirePoints()` method
6. GSTR-2A Zod validation schema
7. Performance and integration tests

## 14. Definition of Done
- Outbox relay responds to events within 100ms via LISTEN/NOTIFY
- DB query rate during idle is reduced by > 80% compared to polling
- Expired reservations are cleaned up daily
- Loyalty point expiry runs nightly

## 15. Regression Checklist
- [ ] Outbox relay still processes events correctly after LISTEN/NOTIFY change
- [ ] Existing stock reservation HOLD and RELEASE flows unchanged
- [ ] Loyalty point accrual and redemption unaffected
- [ ] GSTR-2A import still works for valid JSON

## 16. Documentation Updates
- Document the LISTEN connection requirement (must be direct to PostgreSQL, not via PgBouncer) in the deployment guide
- Add loyalty expiry and reservation cleanup job schedules to the scheduler-service operational runbook

## 17. Estimated Risk
**Medium.** The LISTEN/NOTIFY change modifies the outbox relay's event detection mechanism — if the NOTIFY connection drops without reconnection, events are not processed until the 60s fallback poll. Mitigation: implement automatic reconnection on LISTEN connection failure.

## 18. Dependencies
- **ES-02** — outbox relay worker must exist before it can be optimized
- **ES-03** — stock reservations are created in inventory-service; cleanup job must run after ES-03 is stable

## 19. Rollback Strategy
1. Remove the NOTIFY trigger — revert to polling mode in `OutboxRelayWorker.ts`
2. Unregister cleanup and expiry jobs from `JobRegistry.ts`
3. GSTR-2A validation can be made optional via a feature flag

## 20. Approval Criteria
- DevOps confirms Prometheus metrics show reduced DB query rate after LISTEN/NOTIFY change
- QA confirms outbox events are still processed correctly under load

---

---

# PHASE ES-17: Analytics & Reporting Completeness

## PROJECT CONTEXT REFERENCE
Read the PROJECT CONTEXT section at the top of this document. All new reports in this phase must follow the tenant isolation pattern established in ES-05 (every raw SQL query has `WHERE tenant_id = $tenantId`). Reports read from write-model tables (not projections) for accuracy. All report pages use `ERPDataGrid` with export to CSV.

---

## 1. Objective
Implement 8 analytics and reporting gaps that finance, inventory, and operations teams require for regular business review.

## 2. Why This Phase Exists
The functional audit listed 20 missing reports. ES-05 covered the two highest-priority (AR/AP Aging). ES-13 covered Stock Valuation. This phase covers the next 8 highest-value reports needed for monthly business reviews: Branch P&L, Item Gross Margin, Inventory Turnover, Day Sales Outstanding (DSO), Loyalty Points Liability, Alteration Order Status, POS Cashier Summary, and Fixed Asset Depreciation Schedule.

## 3. Scope

**In scope:**
1. Branch-wise Profit & Loss (RPT-07)
2. Item-wise Gross Margin Summary (RPT-08) — requires ES-13 COGS data
3. Inventory Turnover Ratio by Category (RPT-16)
4. Day Sales Outstanding (DSO) (RPT-17)
5. Loyalty Points Liability Report (RPT-13)
6. Alteration Order Status Report (RPT-11)
7. POS Cashier-wise Summary (RPT-19)
8. Fixed Asset Depreciation Schedule per asset (RPT-14)

Each report: backend SQL + API endpoint + frontend page.

**Out of scope:**
- GSTR-9 (ES-10)
- Stock Valuation (ES-13)
- AR/AP Aging (ES-05)

## 4. Modules Affected
- Reports (`apps/report-service`)
- Web Frontend (8 new report pages)

## 5. Files Expected to Change

| File | Change |
|---|---|
| `apps/report-service/src/domain/ReportEngine.ts` | Add 8 new report queries |
| `apps/report-service/src/domain/ReportRegistry.ts` | Register 8 new reports |
| `apps/report-service/src/api/report.routes.ts` | Add 8 new endpoints |
| `apps/web-frontend/src/pages/reports/` | 8 new page files |
| `apps/web-frontend/src/App.tsx` | Register 8 new routes |

## 6. Coding Standards to Follow
- Every SQL query: `WHERE tenant_id = ${ctx.tenantId}` — verified by inspection and test
- All monetary values in response: integers (paise); format to INR on the frontend using `packages/shared-utils` currency formatter
- Date ranges: all reports accept `?startDate=&endDate=` query params; default to current FY

## 7. Architecture Rules
- Branch P&L: aggregate `financial_entries` by `branch_id` and `account_type` — requires `branch_id` column on `financial_entries` (verify it exists)
- Item Gross Margin: `gross_margin = revenue - cogs` per item — requires ES-13 COGS data in `financial_entries`
- Inventory Turnover: `turnover_ratio = COGS / average_inventory_value`; average = `(opening_stock + closing_stock) / 2`
- DSO: `DSO = (average_accounts_receivable / total_credit_sales) × 365`

## 8. UI/UX Rules
- Standard report page pattern: date range filter → Generate button → `ERPDataGrid` with results → Export CSV button
- Item Gross Margin: sortable by margin % (highest to lowest by default)
- POS Cashier Summary: filter by date + cashier (employee) dropdown
- All pages use `ERPPageHeader` with report name and date range shown as subtitle

## 9. Backend Rules
- All 8 queries must be parameterized (no string concatenation of tenant_id or dates)
- Report generation time target: < 5s for reports with < 1 year date range
- DSO: use only invoices with `payment_terms != 'CASH'` (credit invoices only)
- Loyalty Points Liability: `total_liability = SUM(active_loyalty_points × redemption_rate)` per tenant configuration

## 10. Database Rules
- No schema changes
- Verify that `financial_entries.branch_id` exists — needed for Branch P&L (if missing, this specific report is deferred)
- Add composite indexes if any new queries trigger sequential scans: test with `EXPLAIN ANALYZE` on the report queries with realistic data volumes

## 11. Testing Requirements
- Integration test per report: insert known test data → call report endpoint → assert expected output values
- Tenant isolation test per report: tenant A data must not appear in tenant B's report response
- Performance test: each report with 12 months of data must return in < 5s

## 12. Verification Checklist

- [ ] Branch P&L: two branches with separate invoices → P&L shows separate revenue per branch
- [ ] Item Gross Margin: item with ₹100 revenue and ₹60 COGS shows 40% margin
- [ ] Inventory Turnover: computed correctly for a test item with known COGS and stock values
- [ ] DSO: computed correctly for a test scenario with credit invoices and payment dates
- [ ] Loyalty Points Liability: returns correct total points × redemption rate
- [ ] Alteration Order Status: shows all alteration orders with correct status
- [ ] POS Cashier Summary: shows correct totals per cashier for a test day
- [ ] Fixed Asset Depreciation Schedule: shows correct monthly depreciation for a test asset
- [ ] All 8 pages render in browser with correct `ERPDataGrid` layout
- [ ] Export CSV works for all 8 reports
- [ ] `pnpm test` passes in `apps/report-service`

## 13. Expected Deliverables
1. 8 SQL queries in `ReportEngine.ts`
2. 8 API endpoints in `report.routes.ts`
3. 8 frontend report pages
4. 8 routes registered in `App.tsx`
5. Integration tests for all 8 reports
6. Tenant isolation tests for all 8 reports

## 14. Definition of Done
- All 8 reports return correct data for test scenarios
- All 8 pages render in browser
- CSV export works
- All integration tests pass

## 15. Regression Checklist
- [ ] Existing reports (AR Aging, AP Aging, Stock Valuation) unchanged
- [ ] `ReportsPage.tsx` (report listing) still loads
- [ ] Dashboard unaffected

## 16. Documentation Updates
- Add all 8 reports to the report catalog in `ERP-PLANNING/`

## 17. Estimated Risk
**Low.** New SQL queries on read-only data — no write operations, no transaction boundaries. Risk: a slow query without proper indexing causes timeouts. Mitigation: `EXPLAIN ANALYZE` every query before committing.

## 18. Dependencies
- **ES-05** — tenant isolation pattern established
- **ES-13** — Item Gross Margin and Inventory Turnover require COGS data

## 19. Rollback Strategy
1. Remove the 8 new route registrations and page routes — all previous reports still work
2. No data changes to rollback

## 20. Approval Criteria
- Finance team confirms Branch P&L matches manual calculations
- Product owner signs off on all 8 report UIs

---

---

# PHASE ES-18: CRM & Communication Completeness

## PROJECT CONTEXT REFERENCE
Read the PROJECT CONTEXT section at the top of this document. CRM context: `apps/sales-service/src/domain/CampaignService.ts` handles campaign creation and dispatch. The backend rule engine exists in `packages/platform-sdk/src/rule-engine.ts`. WhatsApp integration goes through `apps/notification-service`. ES-07 must be complete for permission guards on CRM operations.

---

## 1. Objective
Implement three CRM gaps: a UI for the discount rule builder (backend already exists), WhatsApp opt-in/opt-out management for TRAI DLT compliance, and campaign delivery tracking (open/click/bounce rates).

## 2. Why This Phase Exists
The discount rule builder backend exists in `packages/platform-sdk/src/rule-engine.ts` but has no frontend. Sales managers cannot configure pricing rules without engineering intervention. WhatsApp opt-out management is required by TRAI DLT regulations — sending WhatsApp messages to opted-out customers is a regulatory violation. Campaign analytics are absent, making it impossible to measure marketing ROI.

## 3. Scope

**In scope:**
- `DiscountRuleBuilderPage.tsx`: visual UI to create, edit, and activate discount rules using the existing rule engine
- WhatsApp opt-in/opt-out: `customer_communication_preferences` table + API to record opt-out; notification-service must check before sending WhatsApp
- Campaign delivery tracking: webhook endpoint `POST /api/v1/campaigns/webhook/delivery` to receive delivery/open/click events from WhatsApp BSP; store in `campaign_delivery_events` table; update `CampaignsPage.tsx` with delivery metrics

**Out of scope:**
- WhatsApp Business API direct integration (use existing BSP/provider)
- NPS survey module
- Multi-channel campaign builder

## 4. Modules Affected
- Sales/CRM (`apps/sales-service`)
- Notification (`apps/notification-service`)
- Web Frontend (new and updated pages)
- Database (`packages/db-client/src/schema/crm.ts`)

## 5. Files Expected to Change

| File | Change |
|---|---|
| `packages/db-client/src/schema/crm.ts` | Add `customer_communication_preferences` and `campaign_delivery_events` tables |
| `packages/db-client/migrations/` | New: `0018_es18_crm_tracking.sql` |
| `apps/sales-service/src/api/crm.routes.ts` | Add opt-in/opt-out API + campaign delivery webhook |
| `apps/sales-service/src/domain/CampaignService.ts` | Store delivery events; compute open/click rates |
| `apps/notification-service/src/` | Add opt-out check before WhatsApp dispatch |
| `apps/web-frontend/src/pages/crm/` | New: `DiscountRuleBuilderPage.tsx` |
| `apps/web-frontend/src/pages/crm/CampaignsPage.tsx` | Add delivery metrics columns to campaigns grid |
| `apps/web-frontend/src/pages/customers/CustomerViewPage.tsx` | Add communication preference toggle (opt-in/opt-out) |
| `apps/web-frontend/src/App.tsx` | Register discount rule builder route |

## 6. Coding Standards to Follow
- Rule builder UI: use the rule engine's schema to build a dynamic form — do not hardcode rule conditions
- Webhook endpoint: must validate that the webhook source is the trusted BSP (HMAC signature verification)
- Opt-out: once a customer opts out, `customer_communication_preferences.whatsapp_opted_out = true`; this must be checked synchronously before any WhatsApp dispatch

## 7. Architecture Rules
- The delivery webhook is unauthenticated (called by external BSP) — authenticate via HMAC signature in a custom preHandler
- Campaign delivery events are append-only — never update existing delivery event rows
- The opt-out check in notification-service must be a direct DB read (not a cache) — ensure regulatory compliance requires the freshest data

## 8. UI/UX Rules
- `DiscountRuleBuilderPage.tsx`: drag-and-drop rule builder is ideal but a simple form-based approach is acceptable for this phase
- Campaign delivery metrics on `CampaignsPage.tsx`: add columns: Sent, Delivered, Failed, Open Rate (%), Click Rate (%)
- Customer opt-out toggle: in `CustomerViewPage.tsx` under "Communication Preferences" section — show current WhatsApp status with toggle switch + "Opted out on {date}" timestamp if opted out

## 9. Backend Rules
- Opt-out API: `POST /api/v1/customers/{id}/communication-preferences` with `{ whatsappOptedOut: true|false }`; require `requirePermission(PERMISSIONS.CUSTOMER_UPDATE)` — this is existing permission
- Campaign open rate: `open_rate = events.count(type='OPENED') / events.count(type='DELIVERED')`
- Webhook: `POST /api/v1/campaigns/webhook/delivery` — no JWT auth; HMAC verification header `X-BSP-Signature`

## 10. Database Rules
- `customer_communication_preferences`: `(id, tenant_id, customer_id, whatsapp_opted_out, opted_out_at, opted_out_reason, updated_at)` — one row per customer
- `campaign_delivery_events`: `(id, tenant_id, campaign_id, customer_id, event_type, event_at, metadata JSONB)` — append-only
- Add index: `(tenant_id, campaign_id)` on `campaign_delivery_events`

## 11. Testing Requirements
- Unit test: notification-service WhatsApp dispatch checks opt-out status; opted-out customer does not receive message
- Integration test: call delivery webhook with HMAC-signed payload → event stored in `campaign_delivery_events`
- Integration test: call delivery webhook with invalid HMAC → 401
- Unit test: campaign open rate computed correctly from delivery events

## 12. Verification Checklist

- [ ] Create a discount rule via `DiscountRuleBuilderPage.tsx` → rule saved and visible in rule list
- [ ] Opt a customer out of WhatsApp → `customer_communication_preferences.whatsapp_opted_out = true` in DB
- [ ] Trigger WhatsApp campaign → opted-out customer does not receive message (check notification-service logs)
- [ ] Simulate delivery webhook events → `CampaignsPage.tsx` shows delivery/open/click metrics
- [ ] Invalid HMAC webhook → 401 response
- [ ] `pnpm test` passes in `apps/sales-service` and `apps/notification-service`

## 13. Expected Deliverables
1. `customer_communication_preferences` + `campaign_delivery_events` tables + migration
2. Opt-in/opt-out API
3. WhatsApp opt-out check in notification-service
4. Delivery webhook endpoint with HMAC verification
5. `DiscountRuleBuilderPage.tsx`
6. Campaign delivery metrics on `CampaignsPage.tsx`
7. Communication preference toggle on `CustomerViewPage.tsx`

## 14. Definition of Done
- Opted-out customers do not receive WhatsApp campaigns
- Campaign delivery metrics are visible on the campaigns page
- Discount rules can be created and managed via the UI

## 15. Regression Checklist
- [ ] Existing campaign creation and dispatch flow unchanged
- [ ] Customer create/edit flow unchanged
- [ ] Existing notification dispatch for non-WhatsApp channels unaffected

## 16. Documentation Updates
- Add WhatsApp opt-out compliance note to the CRM module user guide
- Document HMAC webhook signature format for BSP integration

## 17. Estimated Risk
**Low.** New tables and endpoints; no changes to critical business logic paths.

## 18. Dependencies
- **ES-07** — existing customer update permission used for opt-out API

## 19. Rollback Strategy
1. Disable opt-out check in notification-service — all customers receive WhatsApp again
2. Remove webhook endpoint — delivery tracking stops
3. Remove rule builder page — rules must be managed via direct DB/API

## 20. Approval Criteria
- Compliance officer confirms opted-out customer test scenario: no WhatsApp message sent
- Marketing team confirms delivery metrics match expected values in a UAT campaign

---

---

# PHASE ES-19: Enterprise Security Hardening

## PROJECT CONTEXT REFERENCE
Read the PROJECT CONTEXT section at the top of this document. Security context (Section 14): all routes have `authenticate` + `requirePermission`. This phase adds three new security layers: TOTP-based 2FA, user session management, and IP allowlisting. These changes touch the authentication flow in `apps/auth-service` — the highest-risk service in the platform.

---

## 1. Objective
Implement Three enterprise security features: TOTP-based Two-Factor Authentication, active user session management (view and revoke sessions), and per-tenant IP allowlisting for trusted login locations.

## 2. Why This Phase Exists
These three features are standard in enterprise ERPs (SAP, NetSuite, Microsoft Dynamics) and are increasingly expected by corporate clients. Without 2FA, a compromised password gives full access. Without session management, there is no way to revoke access for a lost device or compromised account. Without IP allowlisting, login from any location worldwide is permitted — a risk for businesses with office-only access requirements.

## 3. Scope

**In scope:**
- TOTP 2FA: enroll via QR code (TOTP secret + authenticator app), verify TOTP on login, backup codes (10 single-use codes)
- Session management: store active sessions in a `user_sessions` table with metadata (IP, device, last active); add `GET /api/v1/auth/sessions` to list and `DELETE /api/v1/auth/sessions/{id}` to revoke
- IP Allowlist: per-tenant configuration of allowed CIDR ranges; on login, check client IP against allowlist; block if not allowed; bypass-able by ADMIN role

**Out of scope:**
- Hardware security keys (FIDO2/WebAuthn)
- SSO/SAML integration
- SMS OTP (TOTP only in this phase)

## 4. Modules Affected
- Authentication (`apps/auth-service`)
- Tenant Management (`apps/tenant-service`)
- Web Frontend (2FA enrollment page, sessions page)
- Database (`packages/db-client/src/schema/auth.ts`)

## 5. Files Expected to Change

| File | Change |
|---|---|
| `packages/db-client/src/schema/auth.ts` | Add `totp_secrets`, `totp_backup_codes`, `user_sessions`, `tenant_ip_allowlists` tables |
| `packages/db-client/migrations/` | New: `0019_es19_security_hardening.sql` |
| `apps/auth-service/src/` | Add TOTP enrollment, verification, and backup code logic |
| `apps/auth-service/src/` | Add session creation on login; session revocation endpoint |
| `apps/api-gateway/src/` | Add IP allowlist middleware check on every request |
| `apps/tenant-service/src/` | Add IP allowlist CRUD API |
| `apps/web-frontend/src/pages/auth/` | New: `TwoFactorSetupPage.tsx`, `SessionsPage.tsx` |
| `apps/web-frontend/src/pages/settings/` | Add IP Allowlist management to settings |

## 6. Coding Standards to Follow
- TOTP: use `speakeasy` or `otpauth` npm package — do not implement TOTP algorithm from scratch
- TOTP secrets: AES-256-GCM encrypted at rest in `totp_secrets` table
- Backup codes: hashed with bcrypt (not plain text) in `totp_backup_codes`
- Session tokens: store only a hash of the session token in DB — the raw token is given to the client once
- IP allowlist CIDR matching: use `ip-cidr` or `ipaddr.js` npm package

## 7. Architecture Rules
- 2FA verification step: after password auth succeeds, return a temporary `pre_auth_token` (30-second TTL); client submits TOTP code with `pre_auth_token` to get the full JWT
- Session creation: on successful full authentication (including TOTP if enrolled), create a row in `user_sessions` and include `session_id` in the JWT `jti` claim
- Session revocation: add `session_id` to a Redis blocklist; `authenticate` middleware must check the blocklist
- IP check at `api-gateway` level — not in individual services

## 8. UI/UX Rules
- 2FA setup: QR code displayed using a QR code React library; step-by-step guide (scan → verify one TOTP → save backup codes → done)
- Sessions page: `ERPDataGrid` with columns: Device/Browser, IP Address, Location (geo-lookup optional), Last Active, Created At, Revoke button
- IP Allowlist: CIDR range input with "Add", list of existing CIDRs with "Remove", test IP button

## 9. Backend Rules
- TOTP enrollment: `issuer` should be "NEXORAA ERP", `account` should be `{tenantName}:{userEmail}`
- TOTP window tolerance: ±1 step (30 seconds each side) to account for clock drift
- IP allowlist check: if `tenant_ip_allowlists` is empty, all IPs are allowed; only enforce when at least one CIDR is configured
- Backup codes: 10 codes, each 8 characters alphanumeric, single-use (mark used in DB after consumption)

## 10. Database Rules
- `totp_secrets`: `(id, tenant_id, user_id, encrypted_secret, is_enabled, enrolled_at)`
- `totp_backup_codes`: `(id, tenant_id, user_id, code_hash, used_at)`
- `user_sessions`: `(id, tenant_id, user_id, session_token_hash, ip_address, user_agent, last_active_at, revoked_at, created_at)`
- `tenant_ip_allowlists`: `(id, tenant_id, cidr, description, created_by, created_at)`

## 11. Testing Requirements
- Unit test: TOTP verification with valid code returns true; expired code (>60s ago) returns false
- Unit test: backup code verification works once; second use of same code returns false
- Integration test: login with 2FA enabled — must provide TOTP code to get JWT; wrong TOTP → 401
- Integration test: revoke a session → subsequent requests with that session's JWT return 401
- Integration test: login from IP not in allowlist → 403 when allowlist has entries

## 12. Verification Checklist

- [ ] Enroll TOTP via QR code → authenticator app generates valid codes
- [ ] Login with 2FA enabled: correct TOTP → full JWT returned
- [ ] Login with wrong TOTP → 401 response
- [ ] Use backup code → login succeeds; same backup code again → 401
- [ ] Revoke session from `SessionsPage.tsx` → subsequent requests with that JWT → 401
- [ ] Add CIDR `192.168.1.0/24` to tenant allowlist → login from `10.0.0.1` returns 403
- [ ] Login from `192.168.1.100` → succeeds
- [ ] `pnpm test` passes in `apps/auth-service`

## 13. Expected Deliverables
1. TOTP enrollment and verification flow in auth-service
2. Session creation, listing, and revocation
3. IP allowlist CRUD and enforcement in api-gateway
4. 4 new DB tables + migration
5. `TwoFactorSetupPage.tsx` frontend
6. `SessionsPage.tsx` frontend
7. IP Allowlist settings UI
8. Integration tests for all three features

## 14. Definition of Done
- Users can enroll in 2FA and log in using TOTP
- Sessions can be listed and revoked
- IP allowlist blocks logins from non-allowed CIDRs
- All integration tests pass

## 15. Regression Checklist
- [ ] Login for users without 2FA still works (2FA is opt-in)
- [ ] All existing authenticated routes still work after session changes
- [ ] Tenants without IP allowlist configured: all IPs still allowed
- [ ] Existing JWT validation in all services unaffected

## 16. Documentation Updates
- Add 2FA setup guide to the user documentation
- Document IP allowlist configuration in the tenant admin guide
- Document session management in the security operations guide

## 17. Estimated Risk
**High.** Changes to the authentication flow are the highest-risk changes in the platform — a bug can lock all users out. Mitigation: 2FA must be opt-in (disabled by default); IP allowlist only enforced when explicitly configured; thorough integration tests with rollback plan verified before deployment.

## 18. Dependencies
- **ES-07** — permission constants needed for new admin-only security settings routes

## 19. Rollback Strategy
1. Set `is_enabled = false` for all TOTP secrets → 2FA bypassed for all users
2. Remove IP allowlist check from api-gateway → all IPs allowed again
3. Session blocklist: clear Redis blocklist → all revoked sessions become valid again (temporary; until next deploy)
4. These rollback steps are reversible with no data loss

## 20. Approval Criteria
- Security team completes a manual penetration test of the 2FA enrollment and bypass scenarios
- DevOps confirms IP allowlist is enforced at the api-gateway level (tested with a VPN to simulate a blocked IP)

---

---

# PHASE ES-20: Enterprise Features — Audit Log UI, Document Attachments, Feature Flags

## PROJECT CONTEXT REFERENCE
Read the PROJECT CONTEXT section at the top of this document. Audit logging infrastructure already exists in `packages/platform-sdk/src/audit.ts` — this phase adds a UI to view it. Feature flags exist in `packages/platform-sdk/src/feature-flags.ts` — this phase adds a per-tenant admin UI. Document attachments are new — requires a file storage strategy (local disk for dev, S3-compatible for production via environment config).

---

## 1. Objective
Implement three enterprise features that every competitor ERP includes: an Audit Log Viewer UI for admin trail visibility, Document Attachments for invoices/POs/GRNs, and a Feature Flag Admin UI for per-tenant feature toggles. Add PDF export capability to all tabular reports.

## 2. Why This Phase Exists
Enterprise clients expect to see who changed what and when (audit trail), attach supporting documents to transactions (invoices, POs, quality certificates), and have feature toggles managed without code deployments. These features differentiate the platform from basic ERPs and are table-stakes for enterprise sales.

## 3. Scope

**In scope:**
- Audit Log Viewer: `GET /api/v1/admin/audit-logs` with filters (entity_type, user_id, date range) + `AuditLogPage.tsx`
- Document Attachments: file upload API for `invoices`, `purchase_orders`, `grn_entries`, `employees`; store files in configurable location; `DocumentUpload` React component
- Feature Flag Admin UI: `GET/PATCH /api/v1/admin/feature-flags` + `FeatureFlagsPage.tsx`
- PDF export for all tabular reports (AR Aging, AP Aging, Stock Valuation, and the 8 from ES-17): use `apps/report-service/src/domain/PdfEngine.ts`

**Out of scope:**
- E-signature
- Document OCR
- Version history on documents

## 4. Modules Affected
- Platform SDK (`packages/platform-sdk/src/audit.ts`, `src/feature-flags.ts`)
- Report Service (`apps/report-service`)
- Sales, Purchase, HR (attachment support)
- Web Frontend (multiple new pages and components)
- Database (`packages/db-client/src/schema/`)

## 5. Files Expected to Change

| File | Change |
|---|---|
| `packages/db-client/src/schema/` | New or update: `document_attachments` table in appropriate schema file |
| `packages/db-client/migrations/` | New: `0020_es20_enterprise_features.sql` |
| `apps/report-service/src/domain/PdfEngine.ts` | Extend to support PDF export for all report types |
| `apps/report-service/src/api/report.routes.ts` | Add `?format=pdf` query param support |
| `apps/tenant-service/src/` | Add feature flag read/write API using platform-sdk |
| `apps/api-gateway/src/` | Add document upload proxy or dedicated attachment service |
| `apps/web-frontend/src/pages/admin/` | New: `AuditLogPage.tsx`, `FeatureFlagsPage.tsx` |
| `apps/web-frontend/src/components/erp/` | New: `ERPDocumentUpload.tsx` component |
| `apps/web-frontend/src/pages/sales/InvoiceDetailPage.tsx` | Add document upload section |
| `apps/web-frontend/src/pages/purchase/PurchaseOrderFormPage.tsx` | Add document upload section |
| `apps/web-frontend/src/App.tsx` | Register new admin routes |

## 6. Coding Standards to Follow
- File uploads: multipart/form-data; max 10MB per file; allowed types: PDF, PNG, JPG, XLSX
- File storage: abstract behind `FileStorageService` interface with two implementations: `LocalFileStorage` (dev) and `S3FileStorage` (prod); configured via `FILE_STORAGE_PROVIDER` env var
- File paths: never expose the internal storage path to clients — serve files via a signed URL or a proxy endpoint
- Audit log queries: use `packages/platform-sdk/src/audit.ts` existing `queryAuditLog()` function — do not query `audit_logs` table directly

## 7. Architecture Rules
- Document attachments stored in storage, not in DB — only the file metadata (name, size, type, storage key, entity_id, entity_type, tenant_id) is stored in `document_attachments` table
- Feature flags: use `packages/platform-sdk/src/feature-flags.ts` read/write methods — do not build a parallel feature flag system
- Audit log viewer: `VIEW_AUDIT_LOG` permission (defined in ES-07) required
- Feature flag admin: `ADMIN` role only

## 8. UI/UX Rules
- `AuditLogPage.tsx`: `ERPDataGrid` columns: Timestamp, User, Action, Entity Type, Entity ID, IP Address; filters: date range, entity type, user; click row → expanded detail showing `before`/`after` JSON diff
- `FeatureFlagsPage.tsx`: list of feature flags with toggle switch per flag; show which flags are enabled/disabled per tenant; save button
- `ERPDocumentUpload.tsx`: drag-and-drop zone + file type/size validation + upload progress bar + list of uploaded files with download link + delete button
- Report PDF export: add "Export PDF" button alongside "Export CSV" on all report pages

## 9. Backend Rules
- Audit log API: `GET /api/v1/admin/audit-logs?entityType=INVOICE&startDate=&endDate=&userId=&page=1&limit=50`
- File upload: `POST /api/v1/attachments` with `{ entityType: 'INVOICE', entityId: 'uuid', file: multipart }` — return `{ attachmentId, downloadUrl }`
- Download URL: signed URL with 1-hour expiry (for S3) or a token-protected proxy URL (for local storage)
- Feature flag update: validate flag name against the known flag registry in `feature-flags.ts` — reject unknown flag names

## 10. Database Rules
- `document_attachments`: `(id, tenant_id, entity_type VARCHAR(30), entity_id UUID, file_name, file_size_bytes, mime_type, storage_key, created_by, created_at)`
- Index: `(tenant_id, entity_type, entity_id)` on `document_attachments`
- No changes to existing tables

## 11. Testing Requirements
- Integration test: upload a PDF file → `document_attachments` row created → download URL returns the file
- Integration test: audit log API with `entityType=INVOICE` filter → returns only invoice audit events for the tenant
- Unit test: `FeatureFlagsPage` with unknown flag name → rejected by backend with 400
- Integration test: non-ADMIN user accessing `FeatureFlagsPage` API → 403

## 12. Verification Checklist

- [ ] Upload PDF to an invoice → attachment visible in `InvoiceDetailPage.tsx`
- [ ] Download attachment → correct file downloaded
- [ ] `AuditLogPage.tsx` shows audit events for invoice confirms, payment creates, etc.
- [ ] Filter audit log by entity type → only correct entity events shown
- [ ] `FeatureFlagsPage.tsx` shows current flag states; toggle a flag → state persists after page refresh
- [ ] Export PDF from AR Aging report → correctly formatted PDF downloaded
- [ ] Non-ADMIN cannot access Feature Flags API (403)
- [ ] User without `VIEW_AUDIT_LOG` permission cannot access audit log (403)
- [ ] `pnpm test` passes in affected services

## 13. Expected Deliverables
1. `document_attachments` table + migration
2. File upload/download API with local and S3 storage backends
3. `ERPDocumentUpload.tsx` component
4. Document upload section on Invoice and PO pages
5. `AuditLogPage.tsx`
6. `FeatureFlagsPage.tsx`
7. PDF export for all report pages
8. Integration tests

## 14. Definition of Done
- Documents can be uploaded, listed, and downloaded for invoices and POs
- Audit log is viewable with filters
- Feature flags can be toggled via the UI
- PDF export works for all reports

## 15. Regression Checklist
- [ ] Invoice detail page still loads without attachments component error
- [ ] Existing report CSV export unchanged
- [ ] Existing feature flag reads in services unchanged
- [ ] Audit logging continues to write to the audit_logs table

## 16. Documentation Updates
- Add file storage configuration (`FILE_STORAGE_PROVIDER`, S3 credentials) to `.env.example`
- Add audit log viewer guide to the admin documentation
- Document feature flag names and their effects in `ERP-PLANNING/`

## 17. Estimated Risk
**Medium.** File uploads introduce a new attack surface (path traversal, malicious file uploads). Mitigation: validate MIME type server-side (not just extension), store files with UUID keys (not original filenames), serve via proxy (never expose storage path).

## 18. Dependencies
- **ES-19** — `VIEW_AUDIT_LOG` and feature flag admin permissions established in ES-07; security hardening in ES-19 ensures the audit log viewer is appropriately protected

## 19. Rollback Strategy
1. Remove document upload routes and component — no data loss (uploaded files remain in storage)
2. Remove `AuditLogPage.tsx` route — audit logging continues writing (unaffected)
3. Remove `FeatureFlagsPage.tsx` — flags remain at their last set values in the platform-sdk store

## 20. Approval Criteria
- Product owner confirms document attachments work end-to-end for an invoice (upload → download)
- System administrator confirms audit log shows a full trail of the last 100 transactions with before/after values
- DevOps confirms PDF exports are correctly formatted and downloadable

---

---

## APPENDIX A — DEPENDENCY GRAPH

```
ES-01 ──────────────────────────────────────────────────────────► (independent)
ES-02 ──────────────────────────────────────────────────────────► (independent)
ES-03 ──────────────────────── ES-02 ────────────────────────────►
ES-04 ──────────────────────────────────────────────────────────► (independent)
ES-05 ──────────────────────── ES-02 ────────────────────────────►
ES-06 ──────────────────────────────────────────────────────────► (independent)
ES-07 ──────────────────────────────────────────────────────────► (independent)
ES-08 ──────────────────────── ES-02, ES-03 ─────────────────────►
ES-09 ──────────────────────── ES-02, ES-03, ES-07 ──────────────►
ES-10 ──────────────────────── ES-02 ────────────────────────────►
ES-11 ──────────────────────── ES-10 ────────────────────────────►
ES-12 ──────────────────────── ES-06 ────────────────────────────►
ES-13 ──────────────────────── ES-02, ES-03 ─────────────────────►
ES-14 ──────────────────────── ES-10 (FY boundary uses GST data) ►
ES-15 ──────────────────────── ES-02 ────────────────────────────►
ES-16 ──────────────────────── ES-02, ES-03 ─────────────────────►
ES-17 ──────────────────────── ES-05, ES-13 ─────────────────────►
ES-18 ──────────────────────── ES-07 ────────────────────────────►
ES-19 ──────────────────────── ES-07 ────────────────────────────►
ES-20 ──────────────────────── ES-07, ES-19 ─────────────────────►
```

**Critical Path:** ES-02 → ES-03 → ES-13 → ES-17

**Sprint 1 (Week 1–2):** ES-01, ES-02, ES-03, ES-04 *(production blockers)*
**Sprint 2 (Week 3–4):** ES-05, ES-06, ES-07, ES-08, ES-09 *(operational readiness)*
**Sprint 3 (Week 5–6):** ES-10, ES-11, ES-12, ES-13 *(compliance)*
**Sprint 4 (Week 7–8):** ES-14, ES-15, ES-16, ES-17 *(completeness)*
**Sprint 5 (Week 9–12):** ES-18, ES-19, ES-20 *(enterprise hardening)*

---

## APPENDIX B — GLOBAL ROLLBACK POLICY

If any phase causes a production incident:
1. Revert the offending service to the previous Docker image tag
2. The database schema changes can remain (they are all additive — new columns or tables)
3. Revert application code changes via `git revert`
4. Re-run `pnpm build` and redeploy the previous service version
5. File a post-mortem within 24 hours

All phases are designed so that reverting application code restores previous behavior without requiring a down-migration. The only exception is ES-06 (payslip encryption migration) — see that phase's rollback strategy.

---

## APPENDIX C — PRODUCTION READINESS GATE

The platform is considered **production ready (< ₹5 Cr turnover clients)** when:
- [ ] ES-01 complete (security + routing)
- [ ] ES-02 complete (outbox relay — accounting functional)
- [ ] ES-03 complete (inventory ledger)
- [ ] ES-04 complete (migrations)

The platform is considered **production ready (all clients including > ₹5 Cr turnover)** when:
- [ ] All Sprint 1 + Sprint 2 phases complete
- [ ] ES-10 complete (cess, RCM, GSTR-9)
- [ ] ES-11 complete (NIC e-Invoice)
- [ ] ES-12 complete (statutory HR)

---

*Document generated: 2026-07-01*
*Next review: After Sprint 1 completion*
*Owner: Chief Product Architect — NEXORAA*
