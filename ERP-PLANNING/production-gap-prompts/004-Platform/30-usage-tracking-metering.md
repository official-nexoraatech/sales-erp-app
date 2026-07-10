# [PG-028] Usage Tracking & Metering

> Template version 1.0. Every gap-prompt file in this tree must follow this exact section order. Do not add sections; do not omit sections that apply. If a section genuinely does not apply to this gap, write "Not applicable — <one-line reason>" instead of deleting it, so the structure stays diffable across files.

**Category:** Platform
**Priority:** Medium
**Complexity:** L — one new table, one new outbox-fed aggregation job, and instrumentation added at a handful of call sites across several services; no new service, no external integration.
**Depends on:** PG-027 (subscription/billing/license management) — usage metering exists to feed usage-based billing tiers and capacity planning; without PG-027's plan/entitlement model, "usage vs. entitlement" has nothing to compare against. Building this first in isolation would produce numbers with no consumer.
**Blocks:** none
**Primary service(s)/package(s):** packages/platform-sdk, packages/db-client, apps/scheduler-service, apps/tenant-service, apps/web-frontend

---

## Overview

- **Business objective:** There is currently no way to answer "how many invoices did tenant X create this month," "how many active users does tenant X have," "how much storage is tenant X using," or "how many API calls is tenant X making" — despite these being the natural inputs for usage-based billing tiers (PG-027) and, at minimum, capacity planning (which tenants are approaching their plan's seat/branch caps, which tenants are driving disproportionate load). Today, none of this is tracked anywhere as durable, queryable, per-tenant history.

- **Current implementation:** Confirmed by grep and direct read of `packages/logger/src/erp-metrics.ts`: Prometheus counters already exist and several are already **tenant-labeled** — e.g. `erp_invoice_create_total` (`labelNames: ['tenant_id', 'branch_id']`), `erp_auth_login_total` (`labelNames: ['tenant_id', 'outcome']`), `erp_stock_available_qty` (`labelNames: ['tenant_id', 'item_id', 'warehouse_id']`). These are real, already-shipping counters — not a gap to fix, but a resource to reuse partially (see Architecture for why "partially" and not "fully"). No dedicated usage-metering table, no per-tenant usage dashboard, and no storage-usage or API-call-volume tracking exists anywhere.

- **Current architecture:** Every service exposes `/metrics` (Prometheus scrape endpoint) via `packages/logger`'s `initializeErpMetrics()`. Prometheus is deployed as pull-based scraping (per the infra docs) with a retention window (check `infrastructure/` Prometheus config for the exact value — typically short, e.g. 15–30 days, for a metrics system, not built for multi-year billing-history retention). The outbox/event pattern (`PlatformEventBus`) is the existing durable, per-tenant, queryable event trail used for every other cross-cutting concern in this codebase (audit log, notifications, search sync).

- **Current limitations:** No `usage_events`-style durable table. No aggregation job rolls up counts into a per-tenant-per-period usage summary. No admin-facing usage dashboard (the closest thing, `TenantsPage.tsx`, shows tenant status/plan only, not usage). Storage usage (MinIO/S3 object bytes per tenant) is entirely untracked — even the S3 prefix itself is currently a no-op (see PG-029), so there isn't yet a real place objects are written to in a way that could be summed.

## Existing Code Analysis

- **What already exists and should be reused:**
  - `PlatformEventBus.publish()` / the outbox table (`outboxEvents`) — the mechanism this package uses to emit usage events durably and in-transaction with the domain write they're counting (e.g. an invoice-create usage event emitted in the same DB transaction as the invoice row itself, via `publishInTransaction()`), exactly the pattern every other event type in this codebase already follows.
  - The existing tenant-labeled Prometheus counters (`erp_invoice_create_total`, `erp_auth_login_total`, etc.) — reused as the **real-time operational view** (e.g. a live Grafana panel of "invoices/sec by tenant"), not as the source of truth for billing-grade historical usage (see Architecture for the justification of this split).
  - `JobRegistry` (`apps/scheduler-service/src/JobRegistry.ts`) — the daily/periodic aggregation job that rolls raw usage events into per-tenant-per-period summaries belongs here, following the exact same registration pattern as every other scheduled job.
  - `PlatformFeatureFlags`/`tenants.settings.maxUsers`/`.maxBranches` (from PG-027) — the entitlement values usage gets compared against on the dashboard ("12 of 25 users used").
  - `users` and `user_branches` tables — active-user and branch counts can be derived directly from existing `COUNT(*) WHERE tenant_id = ? AND is_active = true` queries; no new event needed for these two metrics specifically, since they're simple point-in-time counts, not cumulative activity (see Architecture for which metrics need events vs. which need a simple count query).

- **What should never be modified:** The existing Prometheus metric definitions in `packages/logger/src/erp-metrics.ts` — this package adds new counters/events alongside them, it does not change or remove any existing metric (several Grafana dashboards and alert rules already depend on the current set, per that file's own header comment referencing "Phase 13 / Task 13.6"). The outbox relay / event-service internals are out of scope — this package is a producer/consumer of events, not a change to the relay mechanism itself.

- **Prior related work:** None dedicated to usage/metering. `packages/logger/src/erp-metrics.ts`'s header comment ("Phase 13 / Monitoring Completeness / Task 13.6") is the closest prior work, but it is operational-metrics-focused (alerting, dashboards), not billing/capacity-planning-focused — the two overlap in mechanism (Prometheus) but serve different consumers and different retention needs, which is exactly the tension this package's Architecture section resolves.

## Architecture

- **What to meter (v1 scope):**
  1. **Invoice count** (sales-service) — already emits `erp_invoice_create_total` with a `tenant_id` label; this package adds a durable outbox event `USAGE_INVOICE_CREATED` alongside it (the Prometheus counter stays for real-time ops visibility; the event feeds the durable usage table).
  2. **Active user count** (tenant-service/auth-service) — derived via a point-in-time `COUNT(*) FROM users WHERE tenant_id = ? AND is_active = true` at aggregation time; no new event needed (see below for why).
  3. **Storage used** (MinIO/S3 bytes per tenant) — derived by summing `document_attachments.file_size` (already a column, per `packages/db-client/src/schema/document-attachments.ts`) grouped by `tenant_id` at aggregation time; again no new event needed, since the underlying `document_attachments` insert already durably records `fileSize`.
  4. **API call volume** (all services) — the one metric that genuinely has no per-tenant durable record today (`erp_http_request_total` has `method`/`route`/`status_code` labels but **no `tenant_id` label** — confirmed by reading `packages/logger/src/erp-metrics.ts:128-132`). Adding `tenant_id` as a label on an HTTP-request-volume counter is a cardinality risk at scale (tenant count × route count × status code — this is the one place this package should be conservative: aggregate call volume into a periodic durable count via a lightweight `usage_events` write at the Fastify `onResponse` hook level, batched, rather than adding an unbounded-cardinality Prometheus label).

- **Where counters should live — the decision and its justification:** Use a **dedicated `usage_events` table fed by the existing outbox pattern**, not tenant-labeled Prometheus counters, as the source of truth for durable per-tenant usage history. Reasoning:
  - Prometheus is built for real-time operational monitoring, not long-term historical billing/capacity records — its retention window (check actual configured value in `infrastructure/`) is almost certainly shorter than a useful billing-history window (e.g. 12+ months of monthly summaries), and it is not designed to survive a Prometheus data-volume reset/reprovision.
  - Cardinality: `erp_invoice_create_total{tenant_id, branch_id}` already carries real cardinality risk as tenant count grows into the hundreds/thousands (this is a general Prometheus operational concern independent of this package — flagged here because this package would make it worse if it tried to add `tenant_id` labels to already-high-cardinality counters like per-route HTTP request counts).
  - Prometheus data is not natively queryable in a relational join against `tenants`/`plan_entitlements` (PG-027) — a usage-vs-entitlement dashboard needs a simple SQL join, which a Postgres table gives for free and PromQL does not.
  - This does **not** mean throwing away the existing Prometheus counters — they remain the correct tool for live ops dashboards/alerting (already wired into Grafana/alert rules per PG-023's scope). The two systems serve different consumers: Prometheus → SRE/ops, `usage_events` + rollups → platform-admin billing/capacity dashboard.
- **New table `usage_events`** (tenant-scoped, append-only, fed by the outbox pattern): one row per countable action (`USAGE_INVOICE_CREATED`, `USAGE_API_CALL_BATCH` — the latter written as a periodic batched increment rather than one row per HTTP call, to bound table growth — see Backend).
- **New table `usage_summary`** (tenant-scoped, one row per tenant per calendar month): rolled up nightly by a new scheduler job from `usage_events` + the two point-in-time-derived metrics (active users, storage bytes). This is what the admin dashboard reads — it never queries raw `usage_events` directly for display, only for the rollup job itself and for drill-down/audit if ever needed.
- **Component interactions and data flow:**
  1. sales-service creates an invoice → existing domain write + existing `erp_invoice_create_total.inc()` + new `PlatformEventBus.publish('usage', tenantId, 'USAGE_INVOICE_CREATED', {...})` in the same transaction.
  2. Each service's Fastify instance batches API-call counts in-memory (e.g. per-minute buckets) and flushes a `USAGE_API_CALL_BATCH` event periodically (not per-request) to bound outbox/event volume.
  3. event-service's existing outbox relay publishes these to Kafka like any other event; a new consumer (could live in tenant-service, since it already owns tenant-level concerns, or scheduler-service, since it already owns periodic aggregation — **recommend scheduler-service**, since "consume events + aggregate on schedule" is exactly what its existing search-sync jobs already do, see `apps/scheduler-service/src/jobs/searchSyncJobs.ts` for the precedent) writes rows into `usage_events`.
  4. A new nightly scheduler job (`usage-rollup`) aggregates the current month's `usage_events` + point-in-time user/storage counts into `usage_summary`.
  5. Platform-admin dashboard reads `usage_summary` (+ live `tenants.settings.maxUsers`/`.maxBranches` from PG-027 for the "used vs. entitled" comparison).

## Database Changes

- **New table `usage_events`:** `id bigserial PK`, `tenant_id integer NOT NULL`, `event_type varchar(50) NOT NULL` (`USAGE_INVOICE_CREATED`, `USAGE_API_CALL_BATCH`), `quantity integer NOT NULL DEFAULT 1` (lets `USAGE_API_CALL_BATCH` carry a batched count instead of one row per call), `occurred_at timestamptz NOT NULL DEFAULT now()`, `metadata jsonb` (nullable — e.g. `{route: '/invoices', method: 'POST'}` for API-call batches).
  - Indexes: `idx_usage_events_tenant_period (tenant_id, occurred_at)` — the rollup job's primary access pattern.
- **New table `usage_summary`:** `id bigserial PK`, `tenant_id integer NOT NULL`, `period_start date NOT NULL`, `period_end date NOT NULL`, `invoice_count integer NOT NULL DEFAULT 0`, `active_user_count integer NOT NULL DEFAULT 0`, `storage_bytes bigint NOT NULL DEFAULT 0`, `api_call_count bigint NOT NULL DEFAULT 0`, `computed_at timestamptz NOT NULL DEFAULT now()`.
  - `unique (tenant_id, period_start)` — one row per tenant per month, rollup job upserts (`ON CONFLICT DO UPDATE`) rather than duplicating.
- **Migration approach:** New file `packages/db-client/migrations/0036_pg028_usage_tracking.sql` (sequential after PG-027's `0035` — re-verify actual latest migration number at implementation time, since these two packages may land out of order). Plain SQL, same `CREATE TABLE IF NOT EXISTS` convention as every other migration in this repo.
- **Rollback strategy:** Both tables are new and additive — `DROP TABLE usage_events; DROP TABLE usage_summary;` is fully safe, no existing data affected. `usage_events` growth should be bounded by a retention policy (e.g. a scheduler cleanup job deletes rows older than N months once they're rolled into `usage_summary` — mirror the existing `outbox-cleanup`/`audit-log-cleanup` scheduler jobs already listed among the 31 registered jobs per `FEATURE_INVENTORY.md` §5.12, rather than inventing a new cleanup pattern).

## Backend

- **New consumer:** `apps/scheduler-service/src/jobs/usageEventConsumer.ts` (or wherever the existing search-sync consumer lives structurally — mirror `searchSyncJobs.ts`/`searchSyncSources.ts`'s split between "job registration" and "event-source mapping") — consumes `USAGE_*` event types from Kafka, inserts into `usage_events`.
- **New scheduler job:** `usage-rollup`, registered via `JobRegistry.register()`, `tenantScoped: true` (unlike PG-027's billing-cycle job, this one fits the existing per-tenant job convention cleanly — it can run once per tenant, or once globally scanning all tenants; follow whichever convention the majority of the other 31 existing jobs use — check `apps/scheduler-service/src/jobs/system-jobs.ts` for the prevailing style before deciding).
- **API-call batching:** add a lightweight Fastify `onResponse` hook (or reuse whatever hook already increments `erp_http_request_total`, per `packages/logger/src/erp-metrics.ts:128-132` — the batching counter should live right next to that existing increment, not as a separate hook, to avoid double-instrumenting every route) that increments an in-memory per-tenant-per-minute counter, flushed periodically via `PlatformEventBus.publish()`. This must not add per-request latency or a per-request DB/Kafka write — batching is the point.
- **New routes (tenant-service, gated `PLATFORM_TENANT_MANAGE`):** `GET /admin/tenants/:id/usage?period=` — returns the relevant `usage_summary` row(s); `GET /admin/tenants/usage-overview` — cross-tenant summary for the platform-operator dashboard (all tenants' current-month usage in one call, for the overview table).
- **Validation:** Zod schema for the `period` query param (`YYYY-MM` format), matching the existing schema-per-route convention in `apps/tenant-service/src/api/tenant.schemas.ts`.
- **Idempotency:** the `usage-rollup` job's upsert (`ON CONFLICT (tenant_id, period_start) DO UPDATE`) makes reruns safe — a retried or manually re-triggered rollup for the same period recomputes rather than double-counts.

## Frontend

- **New section in `apps/web-frontend/src/pages/admin/TenantsPage.tsx`** (or a new `TenantUsagePage.tsx` if the existing page is already large enough that adding a third major tab — Details, Billing (PG-027), Usage — would be unwieldy; check the current file size/structure before deciding): a usage table per tenant (invoice count, active users, storage, API calls, each shown against its plan entitlement cap where applicable) and a cross-tenant overview table for the platform-operator landing view.
- **Permission gating:** same `PLATFORM_TENANT_MANAGE` gate already applied to the parent page — no new frontend permission constant.
- **Charting:** if a trend chart (usage over time) is added, follow this repo's `dataviz` skill/design-tokens conventions for chart colors and accessibility rather than a one-off chart implementation.

## API Contract

- `GET /admin/tenants/:id/usage?period=YYYY-MM` → `200 { data: { period, invoiceCount, activeUserCount, storageBytes, apiCallCount, entitlements: { maxUsers, maxBranches } } }` (entitlements block only populated once PG-027 ships — until then, omit or null it, since this package's own `usage_summary` table has no entitlement data itself).
- `GET /admin/tenants/usage-overview?period=YYYY-MM` → `200 { data: { content: Array<{ tenantId, tenantName, invoiceCount, activeUserCount, storageBytes, apiCallCount }> } }`.
- Both routes: `401` unauthenticated, `403` missing `PLATFORM_TENANT_MANAGE`, `400` invalid `period` format.

## Multi-Tenant Considerations

- `usage_events` and `usage_summary` both carry `tenant_id NOT NULL`, queried with explicit `WHERE tenant_id = ?` — no RLS, consistent with the rest of the schema.
- The cross-tenant `usage-overview` endpoint is the one legitimate place in this package that intentionally reads across all tenants in one query — this is correct and expected for a platform-operator-only, `PLATFORM_TENANT_MANAGE`-gated route (the same pattern `GET /admin/tenants` already uses, returning all tenants with no `tenant_id` filter, since the caller is platform-level, not tenant-scoped).
- Feature flag gating: none needed — this is a platform-operator-only capability with no per-tenant opt-in/opt-out semantics.

## Integration

- **scheduler-service:** owns the `usage-rollup` job and the `USAGE_*` event consumer.
- **sales-service (and any other service emitting a countable action):** adds one `PlatformEventBus.publish()` call per countable action, in the same transaction as the domain write it's counting — minimal touch, no restructuring of existing routes.
- **tenant-service:** owns the new usage-reporting routes and frontend data source.
- **event-service:** no code change — generic outbox relay handles the new event types automatically.
- **web-frontend:** `TenantsPage.tsx` (or a new usage sub-page).
- **Not touched:** purchase-service, accounting-service, inventory-service, gst-service, hr-service, production-service, search-service, pos-frontend, auth-service, notification-service — unless a future iteration decides more actions are worth metering (e.g. GRN count, payroll runs), which is explicitly out of v1 scope.

## Coding Standards

- Fastify + Zod + Drizzle for the new routes, matching every other tenant-service route.
- `PlatformEventBus.publish()`/outbox pattern for all new event emission — no direct Kafka producer calls anywhere in this package.
- `JobRegistry.register()` for the new scheduled job — no bespoke cron/setInterval.
- Existing Prometheus (`erp-metrics.ts`) counters are left untouched; this package adds new durable-storage instrumentation alongside them, not a replacement.
- No genuinely novel pattern introduced — this package is a straightforward application of the existing outbox + scheduler-job conventions to a new domain (usage), which is exactly why it's rated Complexity L rather than XL despite touching several services.

## Performance

- **API-call batching is mandatory, not optional** — per-request Kafka/DB writes for HTTP call counting would add unacceptable latency and load to every single request in the system; the in-memory-batch-then-periodic-flush design in Backend is the performance-critical design decision of this package.
- `usage_events` retention/cleanup job (mirroring existing outbox/audit-log cleanup jobs) bounds table growth — without it, this table grows unboundedly especially once `USAGE_API_CALL_BATCH` events are flowing from every service.
- `idx_usage_events_tenant_period` index supports the rollup job's monthly range scan without a full table scan.
- The cross-tenant `usage-overview` endpoint should query `usage_summary` (small, pre-aggregated) never `usage_events` (large, raw) — this is why the two-table split (raw events vs. summary) exists rather than aggregating on read.

## Security

- `PLATFORM_TENANT_MANAGE`-gated on both new routes — same permission as every other platform-admin surface, no new permission constant needed.
- No new external-facing surface (unlike PG-027's payment webhook) — this package is entirely internal (event consumption + scheduled aggregation + an admin-only read API), so no new signature-verification/webhook-security concern.
- `metadata` jsonb column on `usage_events` should never carry PII (e.g. don't log full request bodies) — only route/method-shape metadata for the API-call-batch case.

## Testing

- **Unit:** rollup-job aggregation logic (given a set of `usage_events` rows + a point-in-time user/storage count, produces the correct `usage_summary` row) — new `apps/scheduler-service/src/__tests__/usage-rollup.test.ts`.
- **Integration:** end-to-end — publish a `USAGE_INVOICE_CREATED` event, assert it lands in `usage_events` via the consumer, run the rollup job, assert `usage_summary` reflects it. Gate behind `describe.skipIf(!DATABASE_URL)` per this repo's existing convention for DB-dependent integration tests.
- **Route-level:** `fastify.inject()` tests for both new routes — 403 without `PLATFORM_TENANT_MANAGE`, 200 with it, correct response shape.
- **Idempotency test:** rerun the rollup job twice for the same period, assert `usage_summary` has exactly one row per tenant per period (the `ON CONFLICT DO UPDATE` upsert working correctly) rather than a duplicate.

## Acceptance Criteria

- [ ] Creating an invoice in sales-service produces exactly one `USAGE_INVOICE_CREATED` outbox event, verifiable via `SELECT * FROM outbox_events WHERE event_type = 'USAGE_INVOICE_CREATED'`.
- [ ] After the `usage-rollup` job runs (manually triggered via scheduler-service's existing manual-trigger endpoint), `usage_summary` contains a row for the current period with a correct `invoice_count`.
- [ ] `GET /admin/tenants/:id/usage?period=YYYY-MM` returns `403` without `PLATFORM_TENANT_MANAGE` and the correct usage numbers with it.
- [ ] `GET /admin/tenants/usage-overview` returns all tenants' current-period usage in one call.
- [ ] Re-running the rollup job for an already-computed period does not create a duplicate `usage_summary` row (verify row count stays 1 per tenant/period).
- [ ] API-call counting adds no measurable per-request latency (spot-check via existing `http_request_duration_seconds` histogram before/after this package's `onResponse` hook is added).

## Deliverables

- **Files to create:**
  - `packages/db-client/migrations/0036_pg028_usage_tracking.sql`
  - `apps/scheduler-service/src/jobs/usageEventConsumer.ts`
  - `apps/scheduler-service/src/jobs/usageRollup.ts` (or added to `system-jobs.ts` — decide based on existing file organization)
  - `apps/tenant-service/src/api/usage.routes.ts`
  - `apps/scheduler-service/src/__tests__/usage-rollup.test.ts`
- **Files to modify:**
  - `packages/db-client/src/schema/index.ts` (or wherever `featureFlags`/`sagaLog` live — new `usageEvents`/`usageSummary` table exports).
  - `apps/sales-service/src/api/invoice.routes.ts` (add `USAGE_INVOICE_CREATED` publish call alongside the existing invoice-create write).
  - Each service's Fastify bootstrap (`onResponse` hook addition for API-call batching) — scope to whichever services are actually in v1 (recommend starting with sales-service and purchase-service only, expanding later, rather than touching all 14 services in one pass).
  - `apps/tenant-service/src/main.ts` (register `usage.routes.ts`).
  - `apps/web-frontend/src/pages/admin/TenantsPage.tsx` (Usage section).
- **Migrations:** `0036_pg028_usage_tracking.sql` (exact number pending — re-verify latest at implementation time).
- **APIs added/changed:** `GET /admin/tenants/:id/usage`, `GET /admin/tenants/usage-overview`.
- **Events added/changed:** `USAGE_INVOICE_CREATED`, `USAGE_API_CALL_BATCH` (v1 scope — additional `USAGE_*` types can be added later without schema change, since `usage_events.event_type` is a free-form varchar).
- **Tests added:** `usage-rollup.test.ts`, usage-event-consumer integration test, route-level authz tests for both new routes.

---

## Context Preservation (for a fresh AI session with no prior history)

**Previous Work Summary:** This ERP has real, already-shipping Prometheus metrics (`packages/logger/src/erp-metrics.ts`), several already tenant-labeled (invoice creates, auth logins, stock levels), used for live ops dashboards/alerting. Nothing durable/historical/per-tenant-billable exists — no `usage_events` table, no rollup, no usage dashboard. PG-027 (subscription/billing) is a sibling package this one depends on conceptually (usage needs an entitlement to compare against) but not technically blocked by in terms of what code exists to reuse.

**Current Objective:** Add a durable, per-tenant usage-metering layer: a `usage_events` table fed by the existing outbox pattern, a nightly rollup job producing `usage_summary`, and a platform-admin usage dashboard — reusing the outbox/scheduler-job patterns already proven elsewhere in this codebase, not inventing new infrastructure.

**Architecture Snapshot:**
1. Prometheus counters (existing) are for real-time ops monitoring with a limited retention window — not the source of truth for durable per-tenant billing/capacity history. This package deliberately uses a separate Postgres-table-based mechanism for that, while leaving the existing Prometheus counters untouched.
2. The outbox pattern (`PlatformEventBus.publish()` → `outboxEvents` → event-service's Kafka relay) is the only way services emit durable cross-cutting events in this codebase — this package's usage events go through it, no exceptions.
3. `JobRegistry` (scheduler-service, BullMQ + Redis distributed lock) is the only scheduled-job mechanism.
4. API-call-volume metering is the one metric needing new instrumentation at the HTTP layer (batched, not per-request) — invoice count, active users, and storage usage can all be derived from data that's already durably recorded today (outbox events for invoices, simple `COUNT(*)` queries for users, existing `document_attachments.file_size` column for storage).
5. `document_attachments` (from ES-20) already has a `file_size` column — storage-usage metering is a `SUM(file_size) GROUP BY tenant_id` away, not a new tracking mechanism.

**Completed Components:** Outbox/event infrastructure, scheduler job registry, existing Prometheus metrics, `document_attachments` with file-size tracking — all pre-existing and reused, none built by this package.

**Pending Components:** PG-027's `plan_entitlements`/`tenant_invoices` (this package's usage numbers are only meaningful against an entitlement once PG-027 ships — until then, the usage dashboard shows raw numbers with no cap comparison, which is still useful for capacity planning even without billing).

**Known Constraints:** Dev-phase, no real tenant usage data yet — safe to iterate on schema and rollup logic without a production-data migration concern.

**Coding Standards:** See Coding Standards section above — no genuinely novel pattern introduced; this package is a straightforward application of existing outbox + scheduler-job conventions to a new domain.

**Reusable Components:** `PlatformEventBus.publish()`, `JobRegistry.register/schedule/triggerManual`, `getOrCreateCounter`-style idempotent Prometheus registration (if any new *operational* counter is added alongside the durable event, though this package's core mechanism is the `usage_events` table, not new Prometheus metrics), `document_attachments.file_size`.

**APIs Already Available:** `GET /admin/tenants` (tenant-service) for the tenant list this package's usage-overview endpoint cross-references.

**Events Already Available:** None directly reusable — this package introduces the first `USAGE_*` event types.

**Shared Utilities:** `@erp/logger`, `@erp/types` (`PERMISSIONS`), `@erp/sdk` (= `packages/platform-sdk`) for `PlatformEventBus`.

**Feature Flags:** Not applicable — platform-operator-only capability, no per-tenant opt-in.

**Multi-Tenant Rules:** `usage_events`/`usage_summary` both `tenant_id NOT NULL`, explicit `WHERE`-filtered — no RLS. The cross-tenant overview endpoint is the one legitimate all-tenants query, gated `PLATFORM_TENANT_MANAGE`.

**Security Rules:** `PLATFORM_TENANT_MANAGE` on both new routes. No PII in `usage_events.metadata`.

**Database State:** Depends on migrations through PG-027's `0035` (re-verify actual latest number at implementation time — these two packages may land in either order despite the stated dependency, since the dependency is conceptual/sequencing-preference, not a hard technical blocker for this package's own schema).

**Testing Status:** No usage-metering tests exist. `apps/scheduler-service/src/__tests__/search-sync-jobs.test.ts` is the closest existing precedent for testing a scheduler-service job/consumer pair.

**Next Session Plan:** Single session is feasible for the backend (schema + event emission + rollup job + routes); frontend dashboard work can be a lightweight follow-on within the same session if time permits, or split into a second session if not — this package does not need PG-027's XL-style multi-session split.

**Prompt for the Next Session:** "Resume `ERP-PLANNING/production-gap-prompts/004-Platform/30-usage-tracking-metering.md` (PG-028). Before writing any code, re-verify: (1) the current latest migration number in `packages/db-client/migrations/`; (2) whether PG-027's `plan_entitlements`/`tenant_invoices` tables exist yet (if not, build this package's usage dashboard without the entitlement-comparison column, and note it as a follow-up once PG-027 lands); (3) re-check `packages/logger/src/erp-metrics.ts` for any new tenant-labeled counters added since this doc was written, to avoid duplicating instrumentation."
