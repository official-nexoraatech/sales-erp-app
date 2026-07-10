# ES-02 — Outbox Relay Worker & Accounting Infrastructure
## STATUS: ✅ COMPLETED
## Sprint: 1 | Effort: 3–4 days | Risk: Medium
## Depends on: None (independent)
## Unlocks: ES-03, ES-05, ES-08, ES-09, ES-10, ES-13, ES-15, ES-16

---

## YOUR ROLE

You are the **Principal Backend Engineer** on the NEXORAA Multi-Tenant Cloth Retail ERP.
Your mission: implement ES-02 exactly as specified. No shortcuts. No deviations. No speculative additions.
Read everything below before writing a single line of code.

---

## ═══════════════════════════════════════════
## PRE-FLIGHT CHECKLIST — Run before any code
## ═══════════════════════════════════════════

- [ ] Read `ERP-PLANNING/TECH_AUDIT.md` — full stack + what NOT to add
- [ ] Read `ERP-PLANNING/CODING_STANDARDS.md` — coding conventions
- [ ] Read `ERP-PLANNING/ERP_MASTER_SPEC.md` — domain spec
- [ ] Read `ERP-PLANNING/TEST_CREDENTIALS.md` — test login credentials
- [ ] Read `ERP-PLANNING/audit-phase-prompts/ES-01-SECURITY-ROUTING-FIXES.md` — what ES-01 changed
- [ ] Read `apps/event-service/src/main.ts` — understand current startup flow
- [ ] Read `packages/db-client/src/schema/distributed.ts` — find `outbox_events` table schema
- [ ] Read `packages/db-client/src/schema/accounting.ts` — find `period_closures` table schema
- [ ] Read `apps/accounting-service/src/domain/FinancialYearService.ts` — understand FY creation flow
- [ ] Read `packages/event-bus-client/src/` — understand existing Kafka producer API
- [ ] Read `packages/platform-sdk/src/telemetry.ts` — understand Prometheus metrics API
- [ ] Run `pnpm build` — confirm codebase builds cleanly before you start
- [ ] Run `pnpm test` — confirm all existing tests pass before you start
- [ ] Verify ES-01 completion: `apps/search-service/src/middleware/authenticate.ts` exists

---

## ═══════════════════════════════════════════
## COMPLETED PHASES — What changed before you
## ═══════════════════════════════════════════

| Phase | Title | Key Changes Relevant to You |
|-------|-------|----------------------------|
| ES-01 ✅ | Security & Routing | search-service now requires JWT; rate limit = 10/15min; route fix in App.tsx |

**No other phases complete yet.**

---

## ═══════════════════════════════════════════
## PROJECT CONTEXT — Read completely
## ═══════════════════════════════════════════

### Tech Stack
| Layer | Technology |
|---|---|
| Runtime | Node.js 20 LTS + TypeScript 5 strict |
| HTTP | Fastify 4 |
| Database | PostgreSQL 16 + Drizzle ORM |
| Pool | PgBouncer (transaction mode) |
| Search | Elasticsearch 8 |
| Queue | BullMQ + Redis 7 |
| Events | Kafka 3 via `packages/event-bus-client` |
| Auth | RS256 JWT (access 15min / refresh 7d) |
| Encryption | AES-256-GCM field encryption |
| Monorepo | Turborepo + pnpm workspaces |
| Frontend | React 18 + Vite 5 + Tailwind CSS v4 |
| State | React Query v5 + Zustand |
| Forms | react-hook-form + Zod resolver |
| Testing | Vitest + real PostgreSQL (Docker) |
| Monitoring | Prometheus + Grafana + Loki |

### Monorepo Structure
```
apps/
  accounting-service/   event-service/    gst-service/     hr-service/
  inventory-service/    notification-service/  pos-frontend/   production-service/
  purchase-service/     report-service/   sales-service/   scheduler-service/
  search-service/       tenant-service/   web-frontend/    api-gateway/  auth-service/
packages/
  cache-client/   config/   db-client/   event-bus-client/   logger/
  platform-sdk/   shared-types/   shared-utils/
```

### Standard Service Structure
```
src/
  api/        # Fastify routes — Zod validation only; NO business logic
  domain/     # All business logic — services, engines, calculators
  consumers/  # Kafka consumers (Inbox pattern)
  jobs/       # BullMQ processors
  middleware/ # authenticate.ts, authorize.ts
  main.ts     # Fastify bootstrap
```

### Multi-Tenant Rules (NEVER violate)
- Every DB table has `tenant_id UUID NOT NULL`
- Tenant ID comes ONLY from `request.auth.tenantId` — NEVER from body/params/query
- Every Drizzle query: `.where(eq(table.tenantId, ctx.tenantId))`
- Redis keys: `tenant:{tenantId}:{key}` prefix
- Elasticsearch: `term: { tenant_id: ctx.tenantId }` filter on every query

### Auth Pattern (every route must follow this)
```typescript
fastify.get('/resource', {
  preHandler: [authenticate, requirePermission(PERMISSIONS.RESOURCE_VIEW)],
}, handler)
```

### Distributed System Patterns
**Outbox:** Domain event written to `outbox_events` in same DB transaction as business mutation.
`event-service` polls and publishes to Kafka. This relay worker IS WHAT YOU ARE BUILDING.

**Inbox (Idempotency):** Every Kafka consumer checks `inbox_events` by `event_id` before processing.
Duplicate → skip. This prevents double-posting of journal entries.

**Outbox event table columns:** `(id, tenant_id, event_type, payload JSONB, published BOOLEAN DEFAULT false, published_at TIMESTAMPTZ, retry_count INT DEFAULT 0, failed BOOLEAN DEFAULT false, failed_reason TEXT, created_at)`

### API Conventions
- Success: `{ data: T, meta?: { page, limit, total } }`
- Error: `{ error: { code: string, message: string, details?: unknown } }`
- Money: integers in paise (1 INR = 100 paise) — NEVER floats
- Timestamps: UTC ISO 8601

### Coding Standards
- TypeScript strict — no `any`, no unsafe casts
- No `console.log` — use `packages/logger` (`logger.info`, `logger.error`)
- Errors: throw from `packages/shared-types/src/errors.ts`
- Error codes: `MODULE_TYPE` pattern (e.g., `OUTBOX_PUBLISH_FAILED`)
- Drizzle ORM for all DB access
- No business logic in route handlers
- Add `/* global process */` at top of any file that uses `process.env` (ESLint global gap)

---

## ═══════════════════════════════════════════
## OBJECTIVE
## ═══════════════════════════════════════════

Implement a persistent outbox relay worker in `apps/event-service` and auto-seed `period_closures`
when a Financial Year is created.

**Why this is critical:** Every accounting journal entry (Invoice → Debtor DR/Sales CR,
Payment → Bank DR/Debtor CR, GRN → Inventory DR/AP CR) is currently NEVER POSTED because no
relay worker runs. The `outbox_events` table fills up with `published = false` rows forever.
Financial statements show zero for all transactions. This is the highest-impact fix in the roadmap.

---

## ═══════════════════════════════════════════
## SCOPE
## ═══════════════════════════════════════════

### IN SCOPE — implement exactly these

**1. `apps/event-service/src/outbox/outbox.types.ts` (new file)**
```typescript
export interface OutboxEvent {
  id: string;
  tenantId: string;
  eventType: string;
  payload: Record<string, unknown>;
  retryCount: number;
  createdAt: Date;
}
```

**2. `apps/event-service/src/outbox/OutboxRelayWorker.ts` (new file)**
- Class with `start(): Promise<void>` and `stop(): Promise<void>` interface
- Polling loop: every `OUTBOX_RELAY_POLL_INTERVAL_MS` (default 500ms), query:
  `SELECT * FROM outbox_events WHERE published = false ORDER BY created_at LIMIT $batchSize FOR UPDATE SKIP LOCKED`
- For each event: call Kafka producer via `packages/event-bus-client`
- After successful produce: `UPDATE outbox_events SET published = true, published_at = NOW() WHERE id = $id`
- On produce failure: `UPDATE outbox_events SET retry_count = retry_count + 1 WHERE id = $id`
- Dead-letter: if `retry_count >= OUTBOX_MAX_RETRY_ATTEMPTS` (default 5): set `failed = true, failed_reason = error.message`
  Increment Prometheus counter: `outbox_relay_dead_letter_total` via `packages/platform-sdk/src/telemetry.ts`
- Graceful shutdown: on `stop()`, finish current batch then exit loop
- Uses `packages/logger` for all logging
- Config from env vars via `packages/config`
- **MUST NOT block Fastify HTTP event loop** — use async loop with await

**3. `apps/event-service/src/main.ts` (modify)**
- Import and instantiate `OutboxRelayWorker`
- Call `worker.start()` after Fastify registers all routes
- On SIGTERM: call `worker.stop()` before `fastify.close()`

**4. Health endpoint in event-service**
- Route: `GET /health/outbox`
- Response: `{ status: 'ok'|'degraded', queueDepth: number, lastPublishedAt: string | null, deadLetterCount: number }`
- `status: 'degraded'` when `deadLetterCount > 0`

**5. `apps/accounting-service/src/domain/FinancialYearService.ts` (modify)**
- After successfully creating a new FY: call `seedPeriodClosures(financialYearId, startDate, endDate)`
- `seedPeriodClosures`: INSERT 12 rows into `period_closures`, one per calendar month in the FY range
- Each row: `(id, tenant_id, financial_year_id, period_month, period_year, start_date, end_date, status='OPEN', created_at)`
- Use the existing `tenant_id` from the FY being created

**6. `packages/db-client/src/schema/accounting.ts` (verify/modify)**
- Check `period_closures` table exists with columns: `id, tenant_id, financial_year_id, period_month, period_year, start_date, end_date, status, created_at`
- If `status` column is missing: add it
- If table is missing: add it

**7. Migration (if schema changes needed)**
- File: `packages/db-client/migrations/0008_es02_period_closures.sql`
- Run `pnpm drizzle-kit generate` to produce it; review before committing
- Must only add columns/tables — no ALTER on existing data columns

**8. `.env.example` (modify)**
```
OUTBOX_RELAY_POLL_INTERVAL_MS=500    # Poll interval in ms (default 500)
OUTBOX_RELAY_BATCH_SIZE=100          # Events per batch (default 100)
OUTBOX_MAX_RETRY_ATTEMPTS=5          # Dead-letter after N failures (default 5)
```

### OUT OF SCOPE — do not touch
- Any Kafka consumer logic in any service
- Any domain service that currently writes to `outbox_events`
- LISTEN/NOTIFY optimization (that is ES-16)
- Any frontend changes

---

## ═══════════════════════════════════════════
## ARCHITECTURE RULES
## ═══════════════════════════════════════════

- Worker is a background process — NOT a Fastify route. It runs alongside Fastify.
- Single instance per pod. Rely on Kafka at-least-once + inbox deduplication for exactly-once.
- `FOR UPDATE SKIP LOCKED` on the SELECT prevents two pods from processing the same event.
- NEVER mark `published = true` before Kafka `produce()` returns successfully.
- Period closures: 12 rows per FY, status = `OPEN`, correct calendar month boundaries.
- Config all via env vars — no hardcoded values.

---

## ═══════════════════════════════════════════
## TESTING REQUIREMENTS
## ═══════════════════════════════════════════

Create in `apps/event-service/src/__tests__/outbox-relay.test.ts`:

1. **Integration test:** Write 1 event to `outbox_events (published=false)` → start worker → assert event `published=true` within 2000ms
2. **Integration test:** Simulate Kafka failure (mock producer to throw) → assert `retry_count` increments → after 5 failures, `failed=true`
3. **Unit test:** Worker `stop()` method resolves after finishing current batch (no in-flight events lost)

Create in `apps/accounting-service/src/__tests__/financial-year.test.ts`:

4. **Unit test:** `FinancialYearService.create()` for April 2026 – March 2027 → exactly 12 `period_closures` rows
5. **Unit test:** Each row has correct `start_date` and `end_date` (April 1 – April 30, May 1 – May 31, etc.)
6. **Unit test:** All 12 rows have `status = 'OPEN'`

---

## ═══════════════════════════════════════════
## BUILD VERIFICATION
## ═══════════════════════════════════════════

Run these commands and fix ALL errors before proceeding to verification:

```bash
pnpm --filter @erp/event-service build
pnpm --filter @erp/event-service type-check
pnpm --filter @erp/accounting-service build
pnpm --filter @erp/accounting-service type-check
pnpm --filter @erp/db-client build
pnpm lint
pnpm test --filter @erp/event-service
pnpm test --filter @erp/accounting-service
```

Zero errors required. Fix all TypeScript strict errors before moving on.

---

## ═══════════════════════════════════════════
## VERIFICATION CHECKLIST
## ═══════════════════════════════════════════

Run these manually after build passes:

- [ ] Create test invoice via API → `SELECT published FROM outbox_events ORDER BY created_at DESC LIMIT 1` → `published = false`
- [ ] Wait 2 seconds → same query → `published = true` and `published_at` is set
- [ ] `GET /health/outbox` → `{ status: 'ok', queueDepth: 0, lastPublishedAt: '...', deadLetterCount: 0 }`
- [ ] Check accounting-service logs — `INVOICE_CONFIRMED` consumer received the event
- [ ] `SELECT * FROM financial_entries WHERE reference_type = 'INVOICE'` → journal entry rows exist
- [ ] Create new Financial Year via API → `SELECT COUNT(*) FROM period_closures WHERE financial_year_id = $newFyId` → 12
- [ ] `SELECT status FROM period_closures WHERE financial_year_id = $newFyId` → all rows show `OPEN`
- [ ] Send SIGTERM to event-service → logs show "OutboxRelayWorker stopped gracefully"
- [ ] `pnpm test` → all tests pass in event-service and accounting-service
- [ ] `pnpm lint` → zero warnings

---

## ═══════════════════════════════════════════
## REGRESSION CHECKLIST
## ═══════════════════════════════════════════

Verify these existing features still work after your changes:

- [ ] All existing event-service routes respond (event-store, projections, saga, DLQ endpoints)
- [ ] Kafka consumers in accounting-service still process events (no duplicate journal entries)
- [ ] Fastify HTTP response times unaffected — start a load test or watch logs during relay polling
- [ ] Existing Financial Year creation flow completes (new period seeding is additive, not replacing)
- [ ] `GET /health` (main health endpoint) still returns `{ status: 'ok' }`
- [ ] `pnpm test` for all OTHER services passes (no regressions in unrelated packages)

---

## ═══════════════════════════════════════════
## DEFINITION OF DONE
## ═══════════════════════════════════════════

- [ ] `outbox_events` rows with `published = false` are dispatched within 2 seconds of creation
- [ ] Creating a new FY auto-generates exactly 12 `period_closures` rows with status `OPEN`
- [ ] `GET /health/outbox` returns accurate real-time queue depth
- [ ] Dead-letter events are flagged after 5 failures (not silently lost)
- [ ] All integration and unit tests pass
- [ ] Zero build errors, zero TypeScript errors, zero lint warnings
- [ ] Completion report saved at `ERP-PLANNING/phase-completions/ES-02_COMPLETION.md`

---

## ═══════════════════════════════════════════
## COMPLETION REPORT TEMPLATE
## ═══════════════════════════════════════════

**SAVE THIS FILE BEFORE CLOSING THE SESSION:**
`ERP-PLANNING/phase-completions/ES-02_COMPLETION.md`

```markdown
# ES-02 Completion Report — Outbox Relay Worker & Accounting Infrastructure
**Date:** [YYYY-MM-DD]
**Phase:** ES-02 of 20
**Status:** COMPLETE

## Summary
[2-3 sentences describing what was implemented and verified]

## Files Changed
| File | Change |
|------|--------|
| apps/event-service/src/outbox/OutboxRelayWorker.ts | NEW |
| apps/event-service/src/outbox/outbox.types.ts | NEW |
| apps/event-service/src/main.ts | Modified — worker startup/shutdown |
| apps/accounting-service/src/domain/FinancialYearService.ts | Modified — period seeding |
| packages/db-client/src/schema/accounting.ts | [Modified if needed] |
| packages/db-client/migrations/0008_es02_period_closures.sql | [NEW if migration needed] |
| .env.example | Modified — new env vars |

## Tests Added
- [ ] outbox-relay.test.ts: [N] tests
- [ ] financial-year.test.ts: [N] tests

## Test Results
- pnpm test @erp/event-service: [PASS — N tests]
- pnpm test @erp/accounting-service: [PASS — N tests]
- pnpm lint: [PASS]
- pnpm build: [PASS]

## Verification Results
[Copy the verification checklist and mark each ✅ or ❌]

## Issues Encountered
[Any problems found during implementation and how resolved]

## Phases Now Unblocked
ES-03, ES-05, ES-08, ES-09, ES-10, ES-13, ES-15, ES-16

## Notes for Next Phase (ES-03)
[Critical context the ES-03 session should know — e.g., any schema changes, env vars needed]
```
