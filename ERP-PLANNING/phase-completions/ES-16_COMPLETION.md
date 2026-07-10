# ES-16 Completion Report — Backend Performance & Hardening
**Date:** 2026-07-03
**Status:** COMPLETE (adapted to the codebase's actual architecture — see Deviations)

## Summary
Added missing DB indexes (audited against the real schema rather than assumed), Redis caching for item/customer master data, a generic circuit breaker applied to the cross-service HTTP calls that actually exist in this codebase, Redis/in-memory-backed rate limiting, real dependency health checks, and real Prometheus metrics — across all 14 running services (`api-gateway` is a stub with no Fastify app; nothing to wire there yet).

## Architecture Deviations (read before extending this phase's code)

1. **Circuit breaker targets.** The prompt assumed `sales-service`/`purchase-service` make an HTTP `POST /internal/ledger` call to inventory-service. Per ES-03's Architecture Decision, that call **does not exist** — `InvoiceService.confirm()`, `GRNService.approve()`, etc. write `inventory_ledger` directly inside their own DB transaction (shared-schema pattern). `purchase-service` makes **no** outbound cross-service HTTP call at all. The generic breaker (`packages/platform-sdk/src/circuitBreaker.ts`, built on `opossum`, matching the prompt's exact config: 5 failures/10s window → open, 30s reset, half-open probe) is instead applied to the HTTP calls that actually exist and actually risk cascading failure:
   - `sales-service` → `notification-service` (`CampaignService.send()` and `internal.routes.ts`'s birthday-greeting dispatch — both loop over many recipients, so a downed notification-service previously meant every remaining recipient waited out its own timeout).
   - `scheduler-service` → `inventory-service` (`system-jobs.ts`'s reservation-expiry and nightly-reconciliation jobs — the only real scheduler→inventory-service HTTP calls in the codebase).
2. **Rate limiting store.** Only services already holding a live `ioredis` connection (the 8 services using `PlatformContextFactory`, plus `scheduler-service`'s own BullMQ redis) use Redis as the rate-limit store. `auth-service`, `tenant-service`, `notification-service`, `report-service`, and `search-service` have no existing Redis connection; adding one solely for rate-limiting was out of scope, so they use the in-memory store — the same fallback `auth-service`'s login limiter already used before this phase. Documented as a follow-up for true multi-instance rate limiting on those five.
3. **Rate-limit keying.** `tenantOrIpKeyGenerator` (in `packages/platform-sdk/src/rate-limit.ts`) keys by `request.auth.tenantId` when present, else IP — but the global rate-limit hook runs at `onRequest`, before the `authenticate` preHandler populates `request.auth`. In practice this makes global limiting IP-keyed everywhere; true per-tenant limiting would need `config.rateLimit` overrides at the route level (after auth), which was not done for all routes across 14 services in this pass.
4. **Auth-service login limit unchanged.** `auth-service`'s `@fastify/rate-limit` registration was flipped from `global: false` to `global: true` (so non-login routes now get the 200/min default) — the login route's own `config: { rateLimit: { max: config.loginRateLimitMax, ... } }` override is unaffected, since route-level config always wins over the plugin default.
5. **Metrics live in `packages/logger`, not a new `platform-sdk/metrics.ts`.** `packages/logger` already had a working prom-client setup (`erp-metrics.ts`, `createMetricsHandler`) from Phase 13 — one service (`sales-service`) was already using it for real. Rather than add a second, competing metrics module in `platform-sdk` as the prompt specified, `erp_http_request_duration_seconds` (histogram) and `outbox_relay_total` (counter) were added to the existing `erp-metrics.ts`, and a shared `createHttpMetricsHook(serviceName)` factory was added to `packages/logger/src/metrics.ts`. All 14 services now serve real `register.metrics()` output at `/metrics` instead of the previous static placeholder strings.
6. **Index audit against real schema.** Several of the prompt's specified indexes were already covered under different names (Phase 13 / ES-03 / ES-13), and one target table (`vendor_invoices`) doesn't exist in this schema. See the migration file's header comment and the table below for the full audit.

## Indexes Added
Migration: `packages/db-client/migrations/0015_es16_performance_indexes.sql`

| Index Name | Table | Columns | Purpose |
|------------|-------|---------|---------|
| `idx_invoices_tenant_due_date` | invoices | `(tenant_id, due_date)` WHERE `status NOT IN ('PAID','CANCELLED')` | AR aging / overdue queries — tenant-first + partial (existing `idx_invoices_due_date` leads with `due_date`, not partial) |
| `idx_inventory_ledger_tenant_item_date` | inventory_ledger | `(tenant_id, item_id, created_at DESC)` | Warehouse-agnostic item ledger history (costing/report reads) |
| `idx_fifo_layers_tenant_item_wh_active` | inventory_fifo_layers | `(tenant_id, item_id, warehouse_id, received_at ASC)` WHERE `remaining_qty > 0` | Excludes exhausted FIFO layers from the index — `ValuationService` always filters `remaining_qty > 0` |
| `idx_outbox_relay_queue` | outbox_events | `(created_at ASC)` WHERE `published = false AND failed = false` | Matches `OutboxRelayWorker`'s exact hot polling query |

**Not applicable / already covered** (verified against current schema, not re-added):
`idx_invoices_tenant_status_date` (→ `idx_invoices_tenant_status`), `idx_invoices_tenant_customer` (→ `idx_invoices_tenant_customer_date`), `idx_purchase_orders_tenant_status` (→ `idx_po_tenant_status`), `idx_vendor_invoices_tenant_status` (no `vendor_invoices` table exists), `idx_inbox_events_event_id` (redundant with the `unique(event_id, consumer_service)` index), `idx_items_tenant_code` (redundant with the `items_tenant_code` unique constraint), `idx_customers_tenant_search` (already a GIN trigram index, better than `text_pattern_ops` for fuzzy search).

## Caching
- **Items** (`apps/inventory-service/src/domain/ItemCacheService.ts`): TTL 300s, key `tenant:{tenantId}:item:{itemId}`. Wired into `GET /items/:id` (cache-aside), `PUT`/`DELETE /items/:id` (invalidate). [IMPLEMENTED]
- **Customers** (`apps/sales-service/src/domain/CustomerCacheService.ts`): TTL 300s, key `tenant:{tenantId}:customer:{customerId}`. Wired into `GET /customers/:id`, `PUT`/`DELETE /customers/:id`, and `POST /customers/merge` (invalidates the merged-away source). [IMPLEMENTED]
- Both wrap the existing `TenantScopedCache` (`ctx.cache`) rather than a new Redis client, per this codebase's documented rule ("always go through `@erp/sdk` `TenantScopedCache`").
- The item-routes' pre-existing "Redis-cached < 50ms" comment on `GET /items/by-barcode/:barcode` was **not** wired up — out of this phase's specified scope (only `getItem`/`setItem`/`invalidateItem`/`invalidateTenantItems` were required); flagging as a follow-up.

## Circuit Breakers
- `packages/platform-sdk/src/circuitBreaker.ts` — `createCircuitBreaker(action, serviceName, options)`, built on `opossum`. 5 failures/10s → open, 30s reset, throws `ServiceUnavailableError` (`{SERVICE}_UNAVAILABLE`, 503) on open.
- `sales-service` → `notification-service`: `CampaignService.ts` (`sendRawNotification`) and `internal.routes.ts` (`sendBirthdayNotification`).
- `scheduler-service` → `inventory-service`: `system-jobs.ts` (`callInventoryService`, wraps both the reservation-expiry and nightly-reconciliation jobs).
- `purchase-service`: no outbound cross-service HTTP call exists to wrap (see Deviation #1).

## Rate Limiting
`@fastify/rate-limit` registered globally on all 14 running services: `max: 200, timeWindow: '1 minute'`, `keyGenerator: tenantOrIpKeyGenerator`. Redis-backed (via the service's existing `ioredis` connection) on 9 services; in-memory on 5 (see Deviation #2). `auth-service`'s login limit (10/15min via `LOGIN_RATE_LIMIT_MAX`/`_WINDOW_MS`) is unchanged.

## Health Checks
- `packages/platform-sdk/src/health.ts` — `registerHealthRoute(fastify, serviceName, checks)` + `buildHealthResponse()`; `checkDatabase(db)` and `checkKafka(kafka)` helpers; `PlatformContextFactory.checkDb()`/`checkRedis()`/`getRedis()` added.
- Services with `/health` before ES-16: 14 (all returned a static `{status:'ok'}` with no real dependency verification).
- Services with **real** dependency-checked `/health` after ES-16: 14 — `db` everywhere applicable, `redis` on the 9 Redis-backed services, `kafka` on the 3 services holding a live Kafka client (`gst-service`, `accounting-service`, `event-service`), `elasticsearch` on `search-service`. Returns `200 {status:'healthy'}` or `503 {status:'degraded', checks:{...}}`.

## Prometheus Metrics
- `erp_http_request_duration_seconds` (histogram) and `outbox_relay_total` (counter) added to `packages/logger/src/erp-metrics.ts`; `createHttpMetricsHook(serviceName)` added to `packages/logger/src/metrics.ts` (see Deviation #5).
- All 14 services now serve real `register.metrics()` Prometheus text output at `GET /metrics` (13 were previously a static placeholder string; `sales-service` already had real metrics and now also gets the duration histogram merged into its existing hook).

## Tests: 8/8 PASS
- `apps/inventory-service/src/__tests__/item-cache.test.ts` (4 tests) — cache miss/hit, key format, invalidation, using a minimal in-memory fake of the ioredis surface `TenantScopedCache` calls (real key assertions, not mocked-call assertions).
- `apps/sales-service/src/__tests__/circuit-breaker.test.ts` (2 tests) — opens after 5 failures (6th call fails fast without invoking the action), half-opens after `resetTimeout` and closes on success (fake timers).
- `apps/sales-service/src/__tests__/health.test.ts` (2 tests) — all-healthy → 200, one check failing → 503 degraded.

## Build / Lint / Test Verification
- `pnpm build` (full monorepo, all 25 packages): **PASS**
- `pnpm --filter <touched-service> lint` (14 services + 4 core packages): no **new** errors — all remaining errors are the pre-existing repo-wide `no-undef` gap for `process`/`fetch`/`crypto`/`Buffer`/`setTimeout` ESLint globals (documented pre-existing debt, unrelated files/lines).
- `pnpm --filter <touched-service> test`: **12/12 services clean**. Two services have **pre-existing** failures unrelated to ES-16, confirmed by inspection (neither touches any file this phase edited):
  - `hr-service`: `holiday.test.ts` (2) + `permission-guards.test.ts` (1) — builds its own bare Fastify instance around `holiday.routes.ts`/`payroll.routes.ts` directly, never imports `main.ts`.
  - `scheduler-service`: `ImportEngine.test.ts` (4) — a mock-db chain missing `.returning()`, unrelated to `system-jobs.ts` or `main.ts`.

## Regression Checklist
- [x] Inventory ledger writes (ES-03) still work — `ledger-service.test.ts` passes unchanged
- [x] FIFO layer queries still correct (ES-13) — `valuation.test.ts` passes unchanged
- [x] Outbox relay (ES-02) still works — new `idx_outbox_relay_queue` index matches the worker's existing query exactly, no query changes
- [x] Login rate limit (10/15min from ES-01) unchanged — route-level `config.rateLimit` override confirmed to take precedence over the new global default
- [x] All existing test suites pass except the two pre-existing, unrelated failures noted above

## Follow-ups for Whoever Picks This Up Next
1. `auth-service`, `tenant-service`, `notification-service`, `report-service`, `search-service` rate-limit on an in-memory store — fine for a single instance, but won't share counters across replicas. Give them a Redis connection if/when they're horizontally scaled.
2. `tenantOrIpKeyGenerator` is effectively IP-only for global (pre-auth) rate limiting; true per-tenant limits need route-level `config.rateLimit` overrides added after `authenticate` runs.
3. `GET /items/by-barcode/:barcode`'s pre-existing "Redis-cached" comment was never implemented — real POS-facing barcode lookups still hit Postgres every time.
4. `purchase-service` has no outbound cross-service HTTP call today; if one is added later (e.g. a real remote inventory call), wrap it with `createCircuitBreaker` from `packages/platform-sdk/src/circuitBreaker.ts`.
