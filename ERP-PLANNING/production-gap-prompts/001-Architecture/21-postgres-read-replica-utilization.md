# [PG-005] Postgres Read-Replica Utilization

> Template version 1.0. Every gap-prompt file in this tree must follow this exact section order. Do not add sections; do not omit sections that apply. If a section genuinely does not apply to this gap, write "Not applicable — <one-line reason>" instead of deleting it, so the structure stays diffable across files.

**Category:** Architecture
**Priority:** Medium
**Complexity:** M — the client already exists; the work is choosing call sites and building a lag-aware fallback, not building replication itself
**Depends on:** none
**Blocks:** none
**Primary service(s)/package(s):** packages/db-client (`@erp/db`), apps/report-service, apps/search-service, apps/report-service (dashboard routes)

---

## Overview

- **Business objective:** every read in the system — including heavy analytical reads (60 report definitions, live dashboards, search reindex catch-up queries) — currently competes with write traffic for the same Postgres primary connection pool. As transaction volume grows, this couples report-generation latency to write-path health and vice versa; a slow report query can starve connections needed for an invoice confirmation. A read replica already exists in `docker-compose.yml` (`erp-postgres-replica`) purely as unused infrastructure spend.
- **Current implementation:** `packages/db-client/src/index.ts` exports `createReadReplicaClient(options: DatabaseClientOptions): ErpDatabase` (lines 25–32) — functionally near-identical to `createDatabaseClient()`, just with a higher default `maxConnections` (20 vs. 10), presumably anticipating replica traffic being read-heavy/higher-concurrency. `packages/config/src/index.ts`'s `AppConfig.databaseReplicaUrl` already resolves `DATABASE_REPLICA_URL` (falling back to `DATABASE_URL` if unset) and `.env.example` documents `DATABASE_REPLICA_URL=postgresql://erp:erp_password@localhost:5433/erp` (port 5433, matching `docker-compose.yml`'s `erp-postgres-replica` service).
- **Current architecture:** confirmed by an exhaustive grep for `createReadReplicaClient` across the entire repository — the **only** match is its own definition in `packages/db-client/src/index.ts`. No service imports or calls it. Every read, including report-service's 60 report definitions and search-service's reindex queries, goes through the same `createDatabaseClient()` connection used for writes.
- **Current limitations:** there is no replication-lag awareness anywhere in the codebase (no query checks `pg_last_wal_receive_lsn`/`pg_last_wal_replay_lsn` or an equivalent staleness signal), so even if the replica client were wired in naively, a caller reading immediately after a write on the primary could see stale data with no way to detect or route around it.

## Existing Code Analysis

- **What already exists and should be reused:** `createReadReplicaClient()` itself — do not write a second replica-client constructor; the existing one already returns the same `ErpDatabase` (Drizzle) type as the primary client, so call sites that switch to it need no query-syntax changes, only a different client instance.
- **What should never be modified:** any write path (`InvoiceService.confirm()`, `JournalEngine`, any domain service that mutates state) must keep using the primary client exclusively — this package is additive (new read paths only), never a wholesale swap of an existing write-capable client.
- **Prior related work:** none — no phase-completion report references replica usage. `FEATURE_INVENTORY.md` §7's infrastructure table is the only prior documentation of this gap, and it is accurate as-is (no correction needed here, unlike PG-002/PG-003).

## Architecture

- **Candidate read-heavy call sites, in priority order:**
  1. **report-service's 60 report definitions** (`ReportEngine.ts`) — these are pure `SELECT`-only, already isolated behind `ReportEngine`'s own query-building layer, and are the single biggest read-volume consumer per `FEATURE_INVENTORY.md` §5.15. Route through the replica client first.
  2. **report-service's dashboard routes** (`dashboard.routes.ts`, live-computed KPI/chart queries) — same profile as (1), but note these read `projection_dashboard_daily` which is written frequently (near-real-time), so replication lag directly affects dashboard freshness — needs the lag-aware fallback described below, not a blind switch.
  3. **search-service's reindex/incremental-catch-up queries** (weekly full-reindex + 10-minute incremental catch-up, per `FEATURE_INVENTORY.md` §5.13) — bulk, latency-tolerant reads; a good second candidate since staleness of a few seconds is irrelevant to a job that already runs on a 10-minute cadence.
  4. **NOT** `projection_stock_level`/`projection_customer_balance` reads inside `sales-service`/`inventory-service`'s own request-serving routes (e.g. checking current stock before allowing a sale) — these need read-your-writes consistency within the same request flow and must stay on the primary; do not migrate these.
- **Replication-lag-aware fallback:** add a small helper, `packages/db-client/src/replica-health.ts`, exposing `isReplicaHealthy(replicaDb: ErpDatabase, maxLagMs = 5000): Promise<boolean>` that runs `SELECT EXTRACT(EPOCH FROM (now() - pg_last_xact_replay_timestamp())) * 1000 AS lag_ms` against the replica and returns `false` if the lag exceeds the caller-supplied threshold (default 5s, overridable per call site — dashboard queries should use a tighter threshold like the existing `STALE_TOLERANCE_MS` values already defined per-projection in `apps/event-service/src/api/projections.routes.ts`, e.g. 5000ms for `projection_stock_level`/`projection_customer_balance`, 120000ms for `projection_dashboard_daily`). Call sites that get `false` back fall through to the primary client for that one query — this is a per-query decision, not a service-wide switch, so a temporarily-lagging replica degrades gracefully to "same as today" rather than serving stale data silently.
- **Component interactions:** report-service and search-service each hold both a primary and a replica `ErpDatabase` instance at startup (constructed once, like the primary is today); a small `ReplicaRouter` helper (new, `packages/db-client/src/replica-router.ts`) wraps the choose-primary-or-replica-with-lag-check logic so call sites write `const db = await replicaRouter.forRead()` instead of duplicating the lag-check boilerplate at every call site.
- **CQRS projection interaction:** the projections most sensitive to lag (`projection_stock_level`, `projection_customer_balance`) are exactly the ones this package recommends NOT routing to the replica for request-serving reads — the interaction is therefore "avoid it," not "handle it," for those two; `projection_dashboard_daily` (2-minute stale-tolerance already, per the existing admin-console constant) is the one projection where a few seconds of replica lag is already within the system's own documented tolerance.

## Database Changes

- Not applicable — no new tables/columns. This package only adds a lag-check query against Postgres's built-in `pg_last_xact_replay_timestamp()` function, which requires no schema change (it is a replica-side system function, present on any streaming-replication standby).
- Rollback strategy: not applicable — no migration to roll back; reverting this package is a code-only revert (stop calling `createReadReplicaClient`/`ReplicaRouter`).

## Backend

- **New files:** `packages/db-client/src/replica-health.ts` (`isReplicaHealthy()`), `packages/db-client/src/replica-router.ts` (`ReplicaRouter` class wrapping the primary+replica pair and the lag-check decision).
- **Modified files:** `apps/report-service/src/main.ts` (construct a replica client alongside the primary, pass a `ReplicaRouter` into `ReportEngine`), `apps/report-service/src/domain/ReportEngine.ts` (route report-definition queries and dashboard queries through `replicaRouter.forRead()` per the priority list above), `apps/search-service/src/main.ts` and its reindex job caller (route bulk reindex reads through the replica).
- **Telemetry:** add a `prom-client` counter `erp_replica_fallback_total{service}` incremented every time `ReplicaRouter` falls back to primary due to lag, so operators can see how often the replica is actually usable in practice — this is the concrete signal that tells whether the replica is pulling its weight or the lag threshold needs tuning.
- **Idempotency/caching:** not applicable — reads are naturally idempotent; no caching change bundled into this package (that's PG-002's territory).

## Frontend

Not applicable — backend-only gap; no frontend change, since routing decisions happen entirely inside report-service/search-service and are invisible to API consumers (same response shape either way).

## API Contract

Not applicable — no endpoint signature changes; this is purely an internal data-source routing decision behind existing endpoints.

## Multi-Tenant Considerations

- No isolation change — every query executed against the replica still carries the same `WHERE tenant_id = ?` filtering as the primary; the replica is a byte-for-byte streaming copy, so tenant isolation is inherited automatically, not re-implemented.
- Feature-flag gating: not applicable — this is an infrastructure routing decision, not a tenant-visible feature.

## Integration

- **report-service:** primary consumer of this package (report definitions + dashboards).
- **search-service:** secondary consumer (reindex jobs).
- **No other service** is in scope for this pass — sales-service/inventory-service/accounting-service's request-serving reads stay on the primary per the "read-your-writes" reasoning above; if a future audit finds a genuinely lag-tolerant read path in one of those services, it can adopt `ReplicaRouter` later without any change to this package.

## Coding Standards

- Reuses the existing `ErpDatabase`/`createDatabaseClient` type contract — `createReadReplicaClient()` already returns the identical Drizzle-typed client, so no query code needs to change shape, only which client instance executes it.
- New `ReplicaRouter`/`isReplicaHealthy` helpers live in `packages/db-client`, consistent with "infrastructure access goes through the SDK/db-client, not ad hoc per-service code."

## Performance

- This IS the performance improvement: offloading up to 60 report definitions' worth of query volume plus search's bulk reindex reads from the primary's connection pool. Expected effect: reduced primary connection-pool contention during report generation and reindex windows, which today can compete with invoice/payment write transactions for the same pool.
- The lag-check query itself is cheap (single scalar read) but should not run on every single query — cache the health check result for a short window (e.g. 1 second) inside `ReplicaRouter` to avoid doubling query count on the replica.

## Security

- Not applicable beyond ensuring the replica connection uses the same credential-scoping discipline as the primary (a read-only Postgres role for the replica connection is recommended at the infra level — flag this as a `DATABASE_REPLICA_URL` connection-string concern for whoever provisions the actual replica role, out of scope for this application-code package but worth calling out so it isn't missed).

## Testing

- New `packages/db-client/src/__tests__/replica-router.test.ts`: mock a healthy replica (falls through to replica), a lagging replica (falls back to primary), and a replica connection failure (falls back to primary, does not throw).
- Extend `apps/report-service`'s existing report-generation tests to assert results are identical regardless of which client served the query (a correctness/parity check, not a performance test) — run the same report definition against both a seeded primary and a seeded replica-equivalent test database and diff the output.
- Manual verification: with `docker-compose up`, confirm `erp-postgres-replica` receives read traffic during a report generation (verify via Postgres's own `pg_stat_activity` on the replica container) that it did not receive before this package.

## Acceptance Criteria

- [ ] `packages/db-client/src/replica-router.ts` and `replica-health.ts` exist and are unit-tested.
- [ ] report-service's report-definition and dashboard queries route through `ReplicaRouter`, falling back to primary when replica lag exceeds the per-query threshold.
- [ ] search-service's reindex/incremental-catch-up queries route through `ReplicaRouter`.
- [ ] `erp_replica_fallback_total` Prometheus counter is exposed and increments correctly in the fallback test case.
- [ ] No write path in any service was touched — verified by confirming `createDatabaseClient()` (primary) is still the only client constructor referenced in every domain service that performs `INSERT`/`UPDATE`/`DELETE`.
- [ ] `pnpm --filter @erp/db-client --filter @erp/report-service --filter @erp/search-service test` all pass.

## Deliverables

- **Files to create:** `packages/db-client/src/replica-health.ts`, `packages/db-client/src/replica-router.ts`, `packages/db-client/src/__tests__/replica-router.test.ts`.
- **Files to modify:** `apps/report-service/src/main.ts`, `apps/report-service/src/domain/ReportEngine.ts`, `apps/search-service/src/main.ts`, search-service's reindex-job caller file (confirm exact path at implementation time).
- **Migrations:** none.
- **APIs added/changed:** none.
- **Events added/changed:** none.
- **Tests added:** `replica-router.test.ts`, report-service parity test.

---

## Context Preservation (for a fresh AI session with no prior history)

**Previous Work Summary:** `docker-compose.yml` runs a Postgres read replica and `packages/db-client` already exports a working `createReadReplicaClient()` — but nothing in `apps/` ever calls it; every read hits the primary.

**Current Objective:** wire the existing replica client into report-service (report definitions + dashboards) and search-service (reindex jobs) via a new lag-aware `ReplicaRouter` that falls back to the primary when replication lag exceeds a per-query-type threshold, without touching any write path.

**Architecture Snapshot:** `createDatabaseClient()`/`createReadReplicaClient()` (`packages/db-client/src/index.ts`) return the identical Drizzle-typed `ErpDatabase`; `projection_dashboard_daily` already has a documented 2-minute staleness tolerance (`apps/event-service/src/api/projections.routes.ts`'s `STALE_TOLERANCE_MS`) that this package's lag threshold for dashboard queries should match; `projection_stock_level`/`projection_customer_balance` reads inside request-serving flows (not report-service) must stay on the primary for read-your-writes correctness.

**Completed Components:** the replica client and the replica Postgres instance itself (both already exist, unused).

**Pending Components:** extending replica routing to any service beyond report-service/search-service is explicitly out of scope for this package — a future pass can adopt `ReplicaRouter` elsewhere once it's proven here.

**Known Constraints:** single shared Postgres primary + one replica (no multi-replica load balancing in scope); no RLS — tenant isolation is inherited automatically from the primary's own row-level `tenant_id` filtering, unchanged on the replica.

**Coding Standards:** extends `@erp/db`'s existing client-construction pattern; introduces one new but justified concept (`ReplicaRouter`) since no lag-aware routing existed before.

**Reusable Components:** `createReadReplicaClient()`, `createDatabaseClient()` (both in `packages/db-client/src/index.ts`).

**APIs Already Available:** not applicable.

**Events Already Available:** not applicable.

**Shared Utilities:** `@erp/db`.

**Feature Flags:** not applicable.

**Multi-Tenant Rules:** unchanged — inherited from primary via streaming replication.

**Security Rules:** recommend (infra-level, out of this package's code scope) that `DATABASE_REPLICA_URL` use a read-only Postgres role.

**Database State:** no migration needed; relies on Postgres's built-in `pg_last_xact_replay_timestamp()`.

**Testing Status:** no replica-routing test exists today — this package adds the first ones.

**Next Session Plan:** single session — M complexity, does not need splitting.

**Prompt for the Next Session:** "Implement `ERP-PLANNING/production-gap-prompts/001-Architecture/21-postgres-read-replica-utilization.md` (PG-005). Re-verify `createReadReplicaClient` still has zero callers before starting, per the roadmap's standing re-verification rule — this is a low-churn area so it's unlikely to have changed, but confirm."
