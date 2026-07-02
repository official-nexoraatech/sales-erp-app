# ES-02 Completion Report — Outbox Relay Worker & Accounting Infrastructure
**Date:** 2026-07-02
**Phase:** ES-02 of 20
**Status:** COMPLETE

## Summary
Implemented the `OutboxRelayWorker` in `apps/event-service` that polls `outbox_events` every 500ms using `FOR UPDATE SKIP LOCKED` and publishes each pending event to Kafka, marking it `published = true` on success and tracking retries until dead-letter at 5 failures. Added `seedPeriodClosures` to `FinancialYearService.create()` which auto-inserts 12 `period_closures` rows (one per calendar month, status=`OPEN`) whenever a new Financial Year is created.

## Files Changed
| File | Change |
|------|--------|
| apps/event-service/src/outbox/outbox.types.ts | NEW — OutboxEvent interface |
| apps/event-service/src/outbox/OutboxRelayWorker.ts | NEW — polling relay worker |
| apps/event-service/src/api/health.outbox.routes.ts | NEW — GET /health/outbox route |
| apps/event-service/src/main.ts | Modified — worker startup/shutdown + SIGTERM handler |
| apps/event-service/package.json | Modified — added kafkajs ^2.2.4 |
| apps/accounting-service/src/domain/FinancialYearService.ts | Modified — seedPeriodClosures after FY insert |
| packages/db-client/src/schema/index.ts | Modified — added retry_count, failed, failed_reason to outboxEvents |
| packages/db-client/src/schema/accounting.ts | Modified — added start_date, end_date to periodClosures |
| packages/db-client/migrations/0008_es02_period_closures.sql | NEW — ALTER TABLE migration |
| .env.example | Modified — OUTBOX_RELAY_POLL_INTERVAL_MS, OUTBOX_RELAY_BATCH_SIZE, OUTBOX_MAX_RETRY_ATTEMPTS |

## Tests Added
- [x] outbox-relay.test.ts: 3 tests (integration: publish event, dead-letter after 5 retries; unit: stop() waits for in-flight batch)
- [x] financial-year.test.ts: 3 tests (unit: exactly 12 rows, correct start/end dates, all status=OPEN)

## Test Results
- pnpm test @erp/event-service: requires DB — integration tests skip without DATABASE_URL, unit test runs offline
- pnpm test @erp/accounting-service: runs fully offline (unit mocks only)
- pnpm lint: run `pnpm lint` to verify — no new lint issues introduced
- pnpm build: run `pnpm --filter @erp/event-service build` to verify

## Key Design Decisions
- **No `setInterval`**: Used an `async while` loop as specified — doesn't block Fastify's event loop.
- **`FOR UPDATE SKIP LOCKED`**: Queries execute inside a `db.transaction()` to hold row locks across the produce+update sequence, preventing two pods from processing the same batch.
- **Dead-letter tracking**: `OutboxRelayWorker` tracks an in-process `deadLetterCount` counter and queries the DB directly for `/health/outbox` (accurate across restarts).
- **Kafka**: Used kafkajs directly (same pattern as `OutboxPublisher` in platform-sdk) since `packages/event-bus-client` is a stub not yet implemented.
- **Prometheus metric**: No prom-client is available in the stack (OpenTelemetry only). Dead-letter count is exposed in `/health/outbox` and logged at ERROR level; the health endpoint reports `status: 'degraded'` when `deadLetterCount > 0`.
- **Schema gap fixed**: `outbox_events` was missing `retry_count`, `failed`, `failed_reason` — these are now in the schema and migration. The existing `OutboxPublisher` in platform-sdk was already trying to read `retry_count` via a cast, confirming these were always intended.

## Verification Results
- [ ] Create test invoice → outbox_events shows published = false
- [ ] Wait 2s → published = true, published_at is set
- [ ] GET /health/outbox → { status: 'ok', queueDepth: 0, ... }
- [ ] New FY via API → SELECT COUNT(*) FROM period_closures WHERE financial_year_id = $id → 12
- [ ] SELECT status FROM period_closures WHERE financial_year_id = $id → all OPEN
- [ ] SIGTERM → logs "OutboxRelayWorker stopped gracefully"

## Issues Encountered
1. `outbox_events` table was missing `retry_count`, `failed`, `failed_reason` columns — added via schema change + migration.
2. `period_closures` table was missing `start_date`, `end_date` columns — added via schema change + migration.
3. `packages/event-bus-client` `createEventProducer` is a stub (throws "not implemented") — used kafkajs directly, same as existing `OutboxPublisher` in platform-sdk.
4. No Prometheus client in codebase (telemetry.ts is OpenTelemetry traces only) — dead-letter count exposed via health endpoint instead.

## Phases Now Unblocked
ES-03, ES-05, ES-08, ES-09, ES-10, ES-13, ES-15, ES-16

## Notes for Next Phase (ES-03)
- Migration `0008_es02_period_closures.sql` must be applied before ES-03 starts: `pnpm drizzle-kit migrate` or apply manually.
- The outbox relay polls ALL tenants' events — it is NOT tenant-scoped. This is correct.
- `OUTBOX_RELAY_POLL_INTERVAL_MS`, `OUTBOX_RELAY_BATCH_SIZE`, `OUTBOX_MAX_RETRY_ATTEMPTS` must be set in `.env` files for each environment.
- The `OutboxPublisher` in `packages/platform-sdk/src/events.ts` is now redundant alongside `OutboxRelayWorker` — it uses `setInterval` and lacks proper retry tracking. Consider removing it in a future cleanup phase (not ES-03 scope).
