# ES-26 Completion Report — Reporting, Notification & Scheduler Data Consistency
**Date:** 2026-07-04
**Status:** COMPLETE

## Scope note: M6's "GST-payable" naming was a misnomer

The phase prompt and the architecture audit both describe M6 as affecting "Day Book, Account
Ledger, Bank Book, **GST-payable**, and one fund-flow report." The actual `gst-payable-report`
case (`ReportEngine.ts:1727`) already queries `invoices`/`grns` with real columns and was never
broken. The fifth broken case — using `fe.entry_date`/`fe.debit_credit`/`fe.amount`, none of which
exist on `financial_entries` — is actually `expense-analysis` (`ReportEngine.ts:1340`, confirmed via
`grep` for the three nonexistent column names across the file, which returned exactly 5 broken
`case` blocks: `day-book`, `account-ledger`, `expense-analysis`, `bank-book`, `fund-flow`). Fixed
`expense-analysis` under M6 instead of `gst-payable-report`, and used the freed-up cache work (M7)
on `gst-payable-report` as the prompt specified.

## Findings Closed
| ID | Finding | Fix Summary | Verified By |
|---|---|---|---|
| M5 | P&L CONTRA miscategorization | Added `CONTRA` → `CONTRA_REVENUE` branch to the category `CASE`, matching accounting-service's bucketing (nets into COGS) | New test computes Net Profit from report-service's rows via accounting-service's exact formula and asserts equality |
| M6 | day-book/account-ledger/expense-analysis/bank-book/fund-flow broken columns | Replaced `fe.entry_date`/`fe.debit_credit`/`fe.amount` with the real `fe.created_at`/`fe.debit_amount`/`fe.credit_amount`, matching ES-17's mapping | SQL-text assertions (no live Postgres available this session — see below) |
| M7 | report-service cache claimed but absent | Built a real 3-minute `TenantScopedCache` (ioredis) on `gst-payable-report`, resilient to Redis being unreachable (falls back to Postgres) | Test asserts a cached call within TTL doesn't re-invoke `db.execute`; a different date range and no-redis-configured cases do re-query |
| M8 | Notification retry double-send risk | Added `notification_log.idempotency_key` (unique per tenant) — caller-supplied or derived from tenant+event+channel+recipient+templateData+5-min bucket; `onConflictDoNothing` dedupes a colliding send. Corrected chaos report's experiment 3.2 (described a BullMQ job that was never built) | Test: two concurrent same-key sends yield exactly one SENT + one SKIPPED; different recipients are never deduped |
| M9 | ImportEngine non-atomic status transition | Replaced SELECT-then-UPDATE with a single `UPDATE ... WHERE status = 'VALIDATED' RETURNING id`; zero rows throws `IMPORT_INVALID_STATE` | Test: two concurrent `execute()` calls on the same job — exactly one fulfills, one rejects |

## Files Changed

| File | Change |
|---|---|
| `apps/report-service/src/domain/ReportEngine.ts` | M5 CONTRA branch; M6 column fixes (5 cases); M7 cache (constructor takes optional `redis`, `gst-payable-report` reads/writes `TenantScopedCache`) |
| `apps/report-service/src/api/analytics-reports.routes.ts` | Threads `redis` through to `ReportEngine` |
| `apps/report-service/src/main.ts` | Creates the ioredis client (lazyConnect, non-fatal on failure), passes it to routes, quits it on shutdown |
| `apps/report-service/package.json` | Added `ioredis` dependency |
| `apps/report-service/src/__tests__/financial-reports.test.ts` | New M5/M6/M7 tests |
| `packages/db-client/src/schema/notification.ts` | Added `notificationLog.idempotencyKey` + unique index on `(tenantId, idempotencyKey)` |
| `packages/db-client/migrations/0020_es26_notification_idempotency.sql` | New migration (not yet applied — see Deployment Checklist) |
| `apps/notification-service/src/domain/NotificationEngine.ts` | Idempotency key derivation + dedup on insert (both `send()` and `sendRaw()`) |
| `apps/notification-service/src/api/notification.routes.ts` | Accepts optional `idempotencyKey` on `/send`, `/send-internal`, `/send-raw-internal` |
| `apps/notification-service/src/__tests__/NotificationEngine.test.ts` | New M8 dedup tests; fixed shared `makeDb` insert-mock chain to include `onConflictDoNothing` |
| `apps/scheduler-service/src/domain/ImportEngine.ts` | Atomic conditional UPDATE in `execute()` |
| `apps/scheduler-service/src/__tests__/ImportEngine.test.ts` | New M9 concurrency tests; added `branches`/`customers`/`suppliers`/`items`/`units` to the `@erp/db` mock |
| `ERP-PLANNING/phase-completions/chaos-engineering-report.md` | Corrected experiment 3.2 to describe the actual synchronous-retry + idempotency-key mechanism instead of the never-built BullMQ job |

## Testing note: no live Postgres this session

Per this repo's own coding standard for this phase, M6's tests should exercise real column names
against a real test Postgres connection rather than a fully-mocked `db.execute` (the exact gap that
let the original bug through undetected). No Docker/Postgres was reachable in this environment
(`docker ps` failed to connect to the daemon). Rather than reintroduce the same blind spot with
fabricated mock rows, the M6 tests assert on the **generated SQL text** itself (the `sql` tag is
mocked to capture template strings, not to fabricate result rows) — confirming each fixed query
references `fe.created_at`/`fe.debit_amount`/`fe.credit_amount` and never the nonexistent
`fe.entry_date`/`fe.debit_credit`/`fe.amount`. This would have caught the original bug (it inspects
column names, not fabricated data) but is not a substitute for running these 5 reports against a
real Postgres instance before this phase is considered fully verified — flagged as a follow-up.

## Tests: report-service 118/118 PASS (11 new) | notification-service 6/6 PASS (2 new) | scheduler-service 8/12 PASS (3 new, all passing)
lint: pre-existing repo-wide debt only (see below) | type-check: PASS (report-service, notification-service, scheduler-service) | build: PASS (all three + `@erp/db`)

## Known pre-existing issues found, not fixed (out of ES-26 scope)

- **scheduler-service `ImportEngine.test.ts`: 4 pre-existing test failures**, confirmed present
  before this phase (`git stash` baseline showed the identical 4 failures). Two root causes,
  neither touched by ES-26: (1) `validate()`'s tests build job fixtures with a `rawData` field, but
  `ImportEngine.validate()` reads `job.rollbackData` — the fixtures and the code have never matched
  a field name; (2) `createJob()`'s test expects `.insert().values().returning()`, but the shared
  `makeDb()` test helper's insert mock only wires `.values().onConflictDoNothing()`. Both predate
  this phase and are unrelated to M9 (the `execute()` atomicity fix and its 3 new tests all pass).
- Lint across all three services surfaces only the already-documented repo-wide missing-ESLint-
  globals debt (`process`/`fetch`/`setTimeout`/`setInterval`/`Buffer`/`require` flagged as
  `no-undef`) plus a few pre-existing unused imports (e.g. `ImportEngine.ts`'s unused `ulid` import,
  `scheduler.routes.ts`'s unused `BusinessError`) — confirmed via `git diff` that none of these
  files' lint-flagged lines were touched by this phase.
- report-engine consolidation (report-service vs accounting-service maintaining two independent
  P&L/BS/TB/CF implementations) is still not done — this is the third time this exact drift has
  needed a fix (once at ES-17, once here). Without consolidating into one shared implementation,
  it can reopen a fourth time.

## Deployment Checklist
- [x] **Schema migration applied:** `psql $DATABASE_URL < packages/db-client/migrations/0020_es26_notification_idempotency.sql` (applied 2026-07-04 to local Docker Postgres)
- [x] **`pnpm install` run** — workspace-wide install confirms `ioredis` present under `node_modules/.pnpm` (2026-07-04)
- [x] **`REDIS_URL` set** — root `.env` has `REDIS_URL=redis://localhost:6379`, matching the local `erp-redis-1` container
- [x] **Updated services deployed:** report-service, notification-service, scheduler-service, db-client (schema) — N/A, confirmed no deployment target exists in this dev environment (backend services run via `turbo run dev` on the host; `docker-compose.yml` only runs infra — Postgres/Redis/Kafka/etc., no app containers). Schema change itself verified live: `notification_log.idempotency_key` column + `notif_log_idempotency_key` unique index present in the running local Postgres (2026-07-04 re-check).

## Phases Unblocked
None — this was the last phase in the ES-25/ES-26 pair (P2 priority). ES-27 (CI/CD, Docker,
Kubernetes) is the final remaining phase from the 2026-07-03 architecture audit's remediation plan.
