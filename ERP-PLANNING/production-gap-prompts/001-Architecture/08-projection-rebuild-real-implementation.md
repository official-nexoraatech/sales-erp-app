## Verification note (read this before implementing)

The roadmap's framing ("replay the event log into the CQRS projection tables") assumes these four projections are populated by consuming a persisted event log. Direct read of the source confirms this is **not** how any of them actually work: all four (`projection_stock_level`, `projection_dashboard_daily`, `projection_customer_balance`, `projection_supplier_balance`) are maintained by **synchronous incremental-delta upserts inside the same DB transaction as the originating write** (e.g. `apps/sales-service/src/domain/InvoiceService.ts:491-510` upserts `projectionCustomerBalance` in the same transaction as the invoice insert). There is no separate consumer replaying `event_store` into them. A real "rebuild" therefore means **full recompute from the authoritative source tables** (ledger/invoice/GRN/payment history), not event replay — and a working example of exactly this recompute-and-compare pattern already exists for one of the four (`apps/inventory-service/src/jobs/reconciliation.job.ts`, nightly, detection-only). This package generalizes that existing pattern to a real, triggerable rebuild for all four, rather than inventing an event-replay mechanism the architecture doesn't have.

# [PG-008] Projection Rebuild — Real Implementation

> Template version 1.0. Every gap-prompt file in this tree must follow this exact section order. Do not add sections; do not omit sections that apply. If a section genuinely does not apply to this gap, write "Not applicable — <one-line reason>" instead of deleting it, so the structure stays diffable across files.

**Category:** Architecture
**Priority:** High
**Complexity:** M — no new infrastructure (BullMQ/Redis/JobRegistry already exist), but four distinct recompute queries must each be grounded in the real source-of-truth tables for that projection
**Depends on:** none
**Blocks:** none
**Primary service(s)/package(s):** apps/scheduler-service (new job handlers, reuses existing `JobRegistry`), apps/event-service (`api/projections.routes.ts` — trigger becomes a real enqueue instead of a `setTimeout` simulation), apps/inventory-service (existing `reconciliation.job.ts` logic reused, not duplicated)

---

## Overview

- **Business objective:** the admin Projections console (`apps/web-frontend/src/pages/admin/distributed/ProjectionsPage.tsx`) lets an operator click "Rebuild" when a projection is flagged `STALE` or `ERROR`, polls every 10s (`refetchInterval: 10_000`), and shows the projection transitioning through `REBUILDING` back to `UP_TO_DATE`. Today none of that reflects real work: the rebuild is a `setTimeout` that waits 500ms–2000ms and then marks the row `UP_TO_DATE` without recomputing anything. If a projection is genuinely wrong (drifted from its source data — the exact scenario this button exists for), clicking Rebuild makes the dashboard *look* healthy while the underlying numbers stay wrong, which is worse than doing nothing because it clears the operator's attention from a real problem.
- **Current implementation:** `apps/event-service/src/api/projections.routes.ts`, `POST /admin/projections/:name/rebuild` (lines 82-138): marks the row `REBUILDING`, then in `setImmediate`, `await new Promise((resolve) => setTimeout(resolve, delay))` with `delay` hardcoded to 2000ms for `projection_dashboard_daily` and 500ms for everything else, then marks it `UP_TO_DATE` unconditionally. The code comment is explicit: `// Trigger rebuild asynchronously (in production, would enqueue a BullMQ job)`.
- **Current architecture:** the four physical projection tables genuinely exist (`packages/db-client/src/schema/inventory.ts:362-381` for stock level; `packages/db-client/src/schema/sales.ts:500-538` for dashboard-daily and customer-balance; `packages/db-client/src/schema/purchase.ts:479-498` for supplier-balance) and are updated by real domain code, in-transaction, via `.onConflictDoUpdate` incremental deltas (e.g. `InventoryLedgerService.ts:236-254` for stock, `InvoiceService.ts:492-510, 630-640` for customer balance). `projection_metadata` (`packages/db-client/src/schema/distributed.ts:118-140`) tracks per-projection lag/staleness metadata only — it is not one of the four data tables itself. `apps/inventory-service/src/jobs/reconciliation.job.ts`'s `runReconciliation()` already does the recompute-and-compare half of this job nightly for `projection_stock_level` specifically (sums `inventory_ledger` by movement type per tenant/item/warehouse, compares to the projection, and — critically — only **flags** the mismatch into `reconciliationErrors`; it never corrects the projection row itself). `apps/scheduler-service/src/JobRegistry.ts` already provides everything a real job needs: BullMQ `Queue`/`Worker` per registered job name, a Redis-backed distributed lock (`JOB_KEY_PREFIX:lock:${name}:${tenantId}`, `SET NX EX 300`) preventing duplicate runs across pods, and a `triggerManual()` entry point already exposed at `POST /jobs/:name/trigger` in `apps/scheduler-service/src/api/scheduler.routes.ts:70-97`.
- **Current limitations:** because incremental-delta upserts never self-heal (an off-by-one bug, a partially-applied manual data-migration, or a restore-from-backup can silently desync a projection from its source forever — deltas compound, they never re-derive from scratch), a real rebuild path is a genuine production-safety gap, not a cosmetic one. And because the "rebuild" trigger lives in `event-service` while the only real job-execution infrastructure (BullMQ + `JobRegistry`) lives in `scheduler-service`, the fix necessarily spans two services — this is the actual reason the original implementer left a `setTimeout` stub rather than wiring it properly.

## Existing Code Analysis

- **What already exists and should be reused:** `runReconciliation()`'s ledger-sum SQL (`apps/inventory-service/src/jobs/reconciliation.job.ts:27-48`) as the exact recompute source for `projection_stock_level` — extend it (see Architecture) rather than writing a second, parallel aggregation query that could drift from it. `JobRegistry` in full (`register`, `triggerManual`, the distributed lock, BullMQ `Queue`/`Worker`) — do not build a second job-scheduling mechanism in `event-service`; BullMQ `Queue` objects are just thin Redis-key wrappers keyed by queue name, so `event-service` can enqueue onto a queue name that `scheduler-service`'s `JobRegistry` already has a `Worker` consuming, using nothing more than a shared Redis connection (see Architecture). The `.onConflictDoUpdate` upsert shape already used for writing each projection (mirror the exact column set, do not invent a different write shape for rebuild vs. incremental update).
- **What should never be modified:** the incremental-delta upsert call sites themselves (`InventoryLedgerService.ts`, `InvoiceService.ts`, `PaymentService.ts`, `GRNService.ts`, `SupplierPaymentService.ts`, `PurchaseReturnService.ts`) — those are the normal-path writers and stay exactly as they are; rebuild is a separate, out-of-band, full-recompute path that overwrites the projection row wholesale, it does not change how the row is normally kept up to date. `apps/inventory-service/src/jobs/reconciliation.job.ts`'s existing detection-only nightly behavior stays as-is (still valuable as a low-noise nightly alert) — this package adds a rebuild capability alongside it, not a replacement.
- **Prior related work:** none specific to projection rebuild; the nightly reconciliation job (above) is the closest prior art and is explicitly reused, not duplicated.

## Architecture

- **Recompute source per projection** (all four use the same principle: full `GROUP BY` aggregation over authoritative tables, replacing the current row rather than adding to it):
  - `projection_stock_level`: reuse `runReconciliation()`'s exact `SUM(...) FROM inventory_ledger GROUP BY tenant_id, item_id, warehouse_id` query (`reconciliation.job.ts:32-48`), but instead of only comparing-and-flagging, `UPSERT` the computed sum directly into `projectionStockLevel.availableQty` (reserved_qty needs a parallel sum over active reservations — check `ReservationEngine.ts` for the reservation-source table before finalizing this query at implementation time, since `reconciliation.job.ts` only reconciles `availableQty` today, not `reservedQty`).
  - `projection_customer_balance`: `SUM(invoices.grandTotal)` for non-cancelled invoices minus `SUM(payments.amount)` allocated to that customer minus approved sale-return credit amounts, grouped by `tenantId, customerId` — mirror exactly the fields `InvoiceService.ts:492-510` and `PaymentService.ts` already increment/decrement so the rebuilt total matches what incremental deltas were supposed to produce.
  - `projection_supplier_balance`: same shape, sourced from `grns`/`SupplierPaymentService.ts`/`PurchaseReturnService.ts`'s existing delta call sites (`totalPurchased`, `totalPaid`, `totalReturns`).
  - `projection_dashboard_daily`: `GROUP BY tenantId, branchId, date` over invoices (count/sum for `salesCount`/`salesAmount`), payments (`collectedAmount`), and sale returns (`returnCount`/`returnAmount`) for a bounded date range (rebuild defaults to the trailing 90 days, not all-time, to keep the query bounded — dashboard staleness tolerance is already only 2 minutes per `STALE_TOLERANCE_MS` in `projections.routes.ts:11`, so a 90-day rebuild window is more than sufficient for any realistic drift scenario).
- **Execution path (cross-service, via shared BullMQ, not HTTP):** `scheduler-service` registers four new jobs in `JobRegistry` (one per projection name, `tenantScoped: true`, **no cron** — these are trigger-only; see the note on `JobRegistry.schedule()` below), each running the corresponding recompute-and-upsert query, then calling `event-service`'s existing `POST /admin/projections/:name/heartbeat` internal-ish endpoint (already exists, `projections.routes.ts:142-163` — reuse it, it already sets `status: 'UP_TO_DATE'`) or, more directly, updating `projectionMetadata` itself since `scheduler-service` already has a direct DB connection (avoids an unnecessary HTTP round-trip for a same-transaction-adjacent update). `event-service`'s `POST /admin/projections/:name/rebuild` handler is rewritten to: mark `REBUILDING` (unchanged), then **enqueue** onto the matching BullMQ queue directly — `new Queue(`projection-rebuild-${name}`, { connection: redis }).add(name, { tenantId: request.auth.tenantId })` — using the same Redis connection `event-service` already holds via `ctxFactory.getRedis()` (`main.ts:70`, already used for rate-limiting). This works because a BullMQ `Queue` is just a named set of Redis keys; any process holding the same Redis connection and queue name can enqueue onto a queue that a *different* process's `Worker` (in `scheduler-service`, via `JobRegistry`) is consuming — no HTTP call, no new internal-key route, no duplicated business logic.
- **`JobRegistry.schedule()` caveat:** `main.ts:34-38` in `scheduler-service` currently calls `registry.schedule(name)` for every registered job at startup, which calls `job.queue.add(name, {tenantId}, {repeat: {pattern: job.config.cron}})` — a recurring cron add. The four new rebuild jobs must be registered with `register()` (so a `Worker` exists to consume manually-enqueued jobs) but **excluded from the automatic `schedule()` loop** (they have no meaningful cron — rebuild-on-demand only). Add a `manualOnly: boolean` flag to `JobConfig` (small, additive change to `JobRegistry.ts`'s existing interface) and skip `schedule()` for jobs where `manualOnly === true`, defaulting to `false` for all 31 existing jobs (zero behavior change for them).
- **Component interactions / data flow:** operator clicks Rebuild (web-frontend, unchanged) → `event-service` marks `REBUILDING`, enqueues onto `projection-rebuild-<name>` queue → `scheduler-service`'s `Worker` (already running, already has the distributed lock wrapper) picks it up, runs the recompute query, upserts the projection row, updates `projectionMetadata` to `UP_TO_DATE` (or `ERROR` with `errorMessage` on failure, matching the existing status enum) → `ProjectionsPage.tsx`'s existing 10s poll picks up the real status change, no frontend code change needed.

## Database Changes

- Not applicable to the four projection tables or `projection_metadata` — all columns needed already exist. The only schema-adjacent change is additive and in-code, not SQL: `JobConfig.manualOnly?: boolean` in `apps/scheduler-service/src/JobRegistry.ts` (TypeScript interface, not a DB migration).

## Backend

- **Files to create:** `apps/scheduler-service/src/jobs/projectionRebuildJobs.ts` — registers the four jobs (`projection-rebuild-stock-level`, `-dashboard-daily`, `-customer-balance`, `-supplier-balance`) with `manualOnly: true`, each handler running its recompute query (reusing/extending `runReconciliation`'s query for stock level — import it directly from `apps/inventory-service` is not possible cross-service without publishing it as a shared package function; instead extract the SQL into a small shared helper in `packages/db-client` or duplicate the single `SELECT` — given it's one query, duplication here is acceptable and simpler than a new shared-package boundary; note this explicitly as a documented, deliberate tradeoff, not an oversight).
- **Files to modify:** `apps/scheduler-service/src/JobRegistry.ts` (add `manualOnly` to `JobConfig`, skip it in the `main.ts` schedule loop — actually the skip logic belongs in `main.ts`'s loop at lines 34-38, filtering `registry.listAll().filter(j => !j.config.manualOnly)`), `apps/scheduler-service/src/main.ts` (import and call the new job registration, apply the `manualOnly` filter), `apps/event-service/src/api/projections.routes.ts` (replace the `setImmediate`/`setTimeout` block with the BullMQ enqueue described above), `apps/event-service/src/main.ts` (pass a `Queue`-capable Redis reference into `projectionRoutes`, mirroring how `worker` is passed into `dlqRoutes` in PG-007).
- **Events/Kafka:** not applicable — this uses BullMQ/Redis, not Kafka, matching how every other scheduler job already works.
- **Idempotency:** each rebuild job is naturally idempotent — it's a full recompute-and-overwrite, not an incremental delta, so running it twice in a row produces the same result both times. The existing `JobRegistry` distributed lock (`SET NX EX 300` keyed by job name + tenantId) already prevents two concurrent rebuilds of the same projection/tenant from racing.
- **Error handling:** on recompute failure, the job handler updates `projectionMetadata.status = 'ERROR'` with `errorMessage` (existing column, existing enum value) rather than leaving the row stuck on `REBUILDING` forever — mirrors the existing `catch` block already in the current stub code (`projections.routes.ts:126-131`), just now triggered by a real failure instead of a caught `setTimeout` promise rejection that can never actually occur.

## Frontend

- Not applicable — `ProjectionsPage.tsx`'s existing rebuild button, 10s poll, and status badges require no change; the fix makes the status transitions they already display honest instead of simulated.

## API Contract

- `POST /admin/projections/:name/rebuild` (event-service, unchanged path/method/permission) → still `202 { data: { projectionName, status: 'REBUILDING', message: 'Rebuild initiated' } }`, but now backed by a real enqueued job instead of a fake delay. No new error codes at the trigger point (enqueue failures — e.g. Redis unreachable — surface as the existing route's generic error handler would for any DB/infra failure).

## Multi-Tenant Considerations

- Rebuild jobs are tenant-scoped (`manualOnly: true, tenantScoped: true` in `JobConfig`, matching the existing convention) — the recompute query for a triggered rebuild filters to the requesting operator's `tenantId` only, never recomputing across tenants in one job run, consistent with every other tenant-scoped job already in `system-jobs.ts`.

## Integration

- **event-service**: enqueues onto BullMQ queues it does not own a `Worker` for — this is the one new cross-service coupling this package introduces (a shared Redis connection + agreed-upon queue-naming convention), and it should be documented clearly at the call site with a comment pointing back to this package, since it's easy for a future reader to wonder why `event-service` imports `bullmq`'s `Queue` without a corresponding `Worker`.
- **scheduler-service**: owns the actual recompute logic and the `Worker`s, per its existing role as the home for all real background job implementations (see also PG-026, "scheduler log-only stub jobs — real implementations," which this package is architecturally consistent with even though projection rebuild isn't literally one of those 31 log-only jobs).
- **inventory-service**: `reconciliation.job.ts`'s query is reused (duplicated, per the documented tradeoff above) as the stock-level recompute source; the file itself is not modified.

## Coding Standards

- Reuses `JobRegistry`/BullMQ/the existing distributed-lock pattern exactly as-is — the only novel-but-justified addition is `JobConfig.manualOnly`, a one-field, additive, backward-compatible extension needed because this is the first job type in this codebase that should never run on a cron, only on explicit trigger.

## Performance

- Rebuild queries are `GROUP BY` aggregations bounded per-tenant (and, for dashboard-daily, per a 90-day window) — acceptable for on-demand, human-triggered operations; do not add these as scheduled/periodic jobs (they remain manual-only, matching the reason a full recompute exists at all: it's a remediation tool, not a steady-state pattern — steady-state correctness still comes from the existing incremental deltas).

## Security

- No new permission surface — `POST /admin/projections/:name/rebuild` keeps its existing `AUDIT_LOG_VIEW` gate (same PG-015 cross-reference as PG-006/PG-007: the dedicated `PROJECTION_VIEW`/`PROJECTION_MANAGE` constants already exist in `packages/shared-types/src/permissions.ts:383-384` but are not yet wired here — out of scope for this package).

## Testing

- New `apps/scheduler-service/src/__tests__/projectionRebuildJobs.test.ts`: each of the four job handlers recomputes and upserts correctly against a seeded set of source rows with a deliberately-wrong existing projection row (proving it's overwritten, not incremented), and marks `projectionMetadata` `ERROR` with a message on a forced DB failure.
- Update `apps/event-service/src/api/projections.routes.ts`'s tests (or add `projections-rebuild.test.ts` if none exist yet — verify at implementation time) to assert the rebuild handler enqueues onto the correct BullMQ queue name instead of asserting on the old `setTimeout` timing.
- Manual repro: manually corrupt a `projection_customer_balance` row (e.g. set `currentBalance` to an obviously wrong value via direct SQL), trigger rebuild via the admin UI, confirm within a few seconds (worker poll + lock acquisition) that the row is corrected to match `SUM(invoices) - SUM(payments)` for that customer.

## Acceptance Criteria

- [ ] The comment `// Trigger rebuild asynchronously (in production, would enqueue a BullMQ job)` no longer exists in the codebase — it now genuinely enqueues one.
- [ ] All four projections have a registered `scheduler-service` job (`manualOnly: true`) whose handler recomputes from source tables and overwrites (not increments) the projection row.
- [ ] A deliberately-corrupted projection row is corrected by triggering Rebuild via the existing admin UI, verified by direct DB query after the job completes.
- [ ] `JobConfig.manualOnly` jobs are excluded from `main.ts`'s automatic cron-scheduling loop at startup (verify none of the 31 existing jobs regressed — they all still get scheduled).
- [ ] `pnpm --filter @erp/scheduler-service test` and `pnpm --filter @erp/event-service test` pass.

## Deliverables

- **Files to create:** `apps/scheduler-service/src/jobs/projectionRebuildJobs.ts`, `apps/scheduler-service/src/__tests__/projectionRebuildJobs.test.ts`.
- **Files to modify:** `apps/scheduler-service/src/JobRegistry.ts`, `apps/scheduler-service/src/main.ts`, `apps/event-service/src/api/projections.routes.ts`, `apps/event-service/src/main.ts`.
- **Migrations:** none.
- **APIs added/changed:** `POST /admin/projections/:name/rebuild` behavior only (path/contract unchanged).
- **Events added/changed:** none — this uses BullMQ, not Kafka.
- **Tests added:** `projectionRebuildJobs.test.ts`, updated/added rebuild-route test in event-service.

---

## Context Preservation (for a fresh AI session with no prior history)

**Previous Work Summary:** `apps/event-service/src/api/projections.routes.ts`'s rebuild handler is a `setTimeout`-based simulation that always ends in `UP_TO_DATE` regardless of whether anything was actually recomputed. All four physical projection tables (stock level, dashboard-daily, customer-balance, supplier-balance) are real and are normally kept up to date by synchronous incremental-delta upserts inside the originating domain transaction (invoice creation, GRN posting, etc.) — not by consuming a persisted event log, which is why "replay the event log" (the roadmap's original framing) is not the right mental model here. A working detection-only precedent already exists for one of the four: `apps/inventory-service/src/jobs/reconciliation.job.ts`'s nightly job sums `inventory_ledger` and flags (but does not fix) drift against `projection_stock_level`.

**Current Objective:** make rebuild real for all four projections by recomputing each from its authoritative source tables and overwriting the projection row, executed via `scheduler-service`'s existing `JobRegistry`/BullMQ infrastructure, triggered from `event-service`'s existing admin route via a direct BullMQ enqueue over shared Redis (no new HTTP coupling between the two services).

**Architecture Snapshot:** `JobRegistry` (`apps/scheduler-service/src/JobRegistry.ts`) already provides `register`/`triggerManual`/distributed-lock/BullMQ `Queue`+`Worker` per job name. `projectionMetadata` (`packages/db-client/src/schema/distributed.ts:118-140`) tracks lag/status only, separate from the four actual data tables. `ProjectionsPage.tsx` already polls every 10s and needs no frontend change — it will simply start reflecting real status transitions.

**Completed Components:** the nightly stock-level reconciliation detection job (`reconciliation.job.ts`) — reused, not modified, as the query basis for the stock-level rebuild.

**Pending Components:** PG-015's permission-granularity fix (`AUDIT_LOG_VIEW` vs. dedicated `PROJECTION_VIEW`/`PROJECTION_MANAGE`) is out of scope here. Extending `reconciliationErrors`-style detection-and-flag nightly jobs to the other three projections (dashboard-daily, customer-balance, supplier-balance) is a reasonable future enhancement but not required for this package — this package only needs the on-demand rebuild path to work, not a new nightly detector for the other three.

**Known Constraints:** single shared Postgres, no RLS — every recompute query must filter by `tenantId` explicitly (`tenantScoped: true` in the new `JobConfig` entries), matching every existing job in `system-jobs.ts`.

**Coding Standards:** see Coding Standards section — the only new pattern is `JobConfig.manualOnly`, a small additive field; everything else reuses `JobRegistry` exactly as built.

**Reusable Components:** `JobRegistry.register`/`.triggerManual` (`apps/scheduler-service/src/JobRegistry.ts`), the ledger-sum SQL in `apps/inventory-service/src/jobs/reconciliation.job.ts:27-48` (reused/adapted, not imported cross-service — duplicated deliberately, see Backend section), the existing `.onConflictDoUpdate` upsert column shapes already used in `InventoryLedgerService.ts`/`InvoiceService.ts`/purchase-service's domain files.

**APIs Already Available:** `POST /admin/projections/:name/heartbeat` (event-service, existing) as an alternative to a direct DB write from scheduler-service, if a same-process DB update is later judged undesirable — not required for the initial implementation.

**Events Already Available:** not applicable — this fix uses BullMQ/Redis, not Kafka.

**Shared Utilities:** `@erp/logger`, `@erp/db` (`projectionStockLevel`, `projectionDashboardDaily`, `projectionCustomerBalance`, `projectionSupplierBalance`, `projectionMetadata` — all already exported from the schema).

**Feature Flags:** not applicable.

**Multi-Tenant Rules:** every rebuild job filters strictly by the triggering operator's `tenantId`; no cross-tenant recompute in a single job run.

**Security Rules:** unchanged `AUDIT_LOG_VIEW` gate on the trigger route, pending PG-015.

**Database State:** all four projection tables and `projection_metadata` already exist with every column this package needs — no migration required. Verify at implementation time that no concurrent work has altered `JobConfig`'s shape since this file was authored (it is a small, actively-used interface).

**Testing Status:** zero tests exist for projection rebuild today (there was nothing real to test — the stub always "succeeded"). `reconciliation.job.ts`'s detection logic has its own existing test coverage (verify current location/name at implementation time) that is unaffected by this package.

**Next Session Plan:** single session — Complexity M reflects four distinct recompute queries needing careful grounding in real source tables, not architectural size; if time-constrained, stock-level (which has an existing query to adapt) is the highest-value first slice, with the other three as natural follow-on commits in the same session.

**Prompt for the Next Session:** "Implement `ERP-PLANNING/production-gap-prompts/001-Architecture/08-projection-rebuild-real-implementation.md` (PG-008). Before writing code, re-verify that all four projection tables are still populated via synchronous incremental-delta upserts (not event consumption) by re-reading `InvoiceService.ts` and `InventoryLedgerService.ts`'s projection-write call sites — this is the load-bearing correction to the roadmap's original 'replay the event log' framing. Start with `projection_stock_level` (adapt `reconciliation.job.ts`'s existing query), then the other three, then wire `JobConfig.manualOnly` and the `event-service` BullMQ enqueue."
