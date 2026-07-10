# [PG-049] Search-service horizontal scaling / ES cluster readiness

> Template version 1.0. Every gap-prompt file in this tree must follow this exact section order. Do not add sections; do not omit sections that apply. If a section genuinely does not apply to this gap, write "Not applicable — <one-line reason>" instead of deleting it, so the structure stays diffable across files.

**Category:** Search
**Priority:** Low
**Complexity:** M — no code is currently broken; this is a capacity-planning and (possibly) an index-topology change, which touches every entity-sync path in the service even though each change is individually small.
**Depends on:** none
**Blocks:** none
**Primary service(s)/package(s):** apps/search-service, apps/scheduler-service (search sync jobs), infra (`docker-compose.yml` / eventual k8s ES manifests)

---

## Overview

- **Business objective:** search-service is currently sized and topologized for the dev/single-tenant-testing case. Nothing breaks today, but the index-per-tenant-per-entity model has a hard multiplication problem baked into it: `tenant_count × 30 entity_types = total ES indices`. At 50 tenants that's 1,500 indices; at 500 tenants it's 15,000. This is invisible in the current single-node dev cluster (`docker-compose.yml`'s `elasticsearch` service) and will only surface as a real incident — cluster-state bloat, slow shard allocation, OOM on coordinating nodes — well after enough tenants have onboarded that a topology change becomes disruptive to migrate. The business objective is to have a documented, reviewed plan *before* tenant count growth forces an emergency re-architecture.
- **Current implementation:** `apps/search-service/src/domain/SearchEngine.ts`. `indexName()` (line 363) builds `erp_${tenantId}_${entity}`, one index per (tenant, entity) pair, for all 30 entries of the `SearchEntity` union (lines 6-36: customer, supplier, item, invoice, purchase_order, stock, employee, quotation, crm_interaction, crm_segment, crm_campaign, category, brand, unit, warehouse, stock_transfer, stock_adjustment, grn, purchase_return, account, journal_entry, payment, attendance, payroll_run, leave_application, user, role, branch, organization, attachment). `createIndex()`/`deleteIndex()` (lines ~384-403), `index()`/`bulkIndex()` (lines 412-448), and `fullReindex()` (lines 582-608) all operate index-by-index via this naming scheme. Multi-entity search (`search()`, ~line 465-473) queries a comma-joined list of these per-tenant-per-entity indices directly (`entities.map((e) => this.indexName(tenantId, e)).join(',')`), i.e. Elasticsearch's multi-index search feature is already relied on as the cross-entity query mechanism.
- **Current architecture:** Single-node ES 8.17.0 in `docker-compose.yml` (lines 143-165): `discovery.type: single-node`, `ES_JAVA_OPTS: "-Xms512m -Xmx512m"`, `xpack.security.enabled: false`. This is explicitly a dev container, not a sized cluster — there is no multi-node config, no shard/replica policy, and no ILM (index lifecycle management) policy anywhere in the repo. Sync is driven by `apps/scheduler-service/src/jobs/searchSyncJobs.ts`: `runSearchFullReindex()` (weekly, one call per tenant, iterating all `ENTITY_SOURCES` keys and calling `search-service`'s reindex endpoint) and `runSearchIncrementalSync()` (every 10 minutes, `modifiedSince = now - 15min` upsert-only pass). Real-time sync additionally happens via ~55 mapped Kafka event types per FEATURE_INVENTORY.md §5.13.
- **Current limitations:** No documented shard/replica strategy, no multi-node cluster config, and — the more fundamental issue — no revisit of whether one-index-per-tenant-per-entity is the right model past a certain tenant count. Elasticsearch's own operational guidance caps a healthy node around ~20 shards per GB of heap and recommends avoiding cluster-wide shard counts in the tens of thousands; with 1 primary shard (ES 8's default) + 1 replica per index, `tenant_count × 30 × 2` shards accumulates fast, and *most of those indices are near-empty* for the majority of tenants (a small tenant's `journal_entry` or `payroll_run` index may hold a few hundred documents but still costs a full shard's worth of cluster overhead). There is no code path today that would let ops reduce index count without a data-migration effort — `indexName()` is called from every read/write site, so any topology change is a cross-cutting rename, not a config flag.

## Existing Code Analysis

- **What already exists and should be reused:** `indexName()` as the single naming choke-point (already centralized — this is the one thing that makes a future topology change *tractable* rather than a full rewrite, since every caller already goes through this one function). `fullReindex()`'s delete-and-recreate-per-index pattern (lines 589-591) is the natural place to also apply index settings (shards/replicas) at creation time. The scheduler's existing weekly-full / 10-min-incremental cadence should be kept as-is — this gap is about cluster topology, not sync frequency.
- **What should never be modified:** The Kafka real-time sync path (~55 event types) and the per-tenant branch-scoping/date-range filter logic in `SearchEngine.ts` are working and out of scope — this package is purely about index topology and node/cluster sizing, not query semantics or sync triggers. Do not touch `search()`'s query-building logic (BM25/synonym/analyzer config) — that's unrelated to this gap.
- **Prior related work:** None — this is the first pass at search-service capacity planning. No `ERP-PLANNING/phase-completions/` report covers ES cluster sizing. The "Global Search feature completed" work (see project memory) built the feature; it did not address scale.

## Architecture

This package is primarily a **plan document + defensive code changes**, not a full re-platforming — actually standing up a multi-node ES cluster is an infra/ops task (parallel to PG-022 Kubernetes readiness), not something this package should attempt to implement blind. What this package *should* produce:

1. **A documented index-count projection** against realistic tenant-growth targets (e.g. 50 / 200 / 1,000 tenants × 30 entities × (1 primary + 1 replica) = 3,000 / 12,000 / 60,000 shards) with the specific ES guidance thresholds it would breach (ES recommends keeping shard count per node in the low thousands at most for stable cluster-state propagation).
2. **A revisit decision on the one-index-per-tenant-per-entity model**, framed as three concrete options rather than a vague "consider scaling":
   - **Option A — keep per-tenant-per-entity indices, but add ILM + shard-count tuning**: set `number_of_shards: 1` explicitly (ES8 default is already 1, but make it explicit and reviewed) and drop `number_of_replicas` to 0 for low-traffic tenant indices (search is not the system of record — data is always re-derivable from Postgres via `fullReindex()`, so losing a replica shard on node failure is a *slow* recovery, not data loss). This is the lowest-effort option and defers the real fix.
   - **Option B — shared index per entity type, tenant as a filtered field**: e.g. one `erp_customer` index (instead of `erp_{tenantId}_customer` per tenant) with `tenantId` as a required filter clause on every query — mirrors how `search()` already adds a `tenantId` term filter defensively (per the code comment at SearchEngine.ts line 56-64 about not trusting index-name-implied tenant scoping alone). This collapses index count from `tenants × 30` to a flat `30`, at the cost of every query needing a mandatory tenant filter (already true in practice) and larger per-index document counts (fine — ES indices handle millions of docs per shard without issue; the problem today is index *count*, not per-index *size*).
   - **Option C — index aliasing with tiered indices**: keep per-tenant-per-entity physical indices for large/active tenants, but roll small/inactive tenants into a shared "long-tail" index via an ES alias layer, reindexing a tenant out of the shared index once it crosses an activity threshold. This is the most flexible but most complex option, and should only be pursued if Option B's flat-shared-index model turns out to have query-performance problems at real scale (unlikely given ES's design, but worth naming as a fallback).
   - **Recommendation for this package:** document all three, recommend **Option B** as the target architecture (simplest mental model, smallest index count, and `tenantId`-filtered multi-tenant querying is already the pattern used everywhere else in this codebase — Postgres has no RLS either, just explicit `WHERE tenant_id = ?`, so this is consistent with the rest of the system's tenant-isolation philosophy), but explicitly flag that migrating from A to B is a **breaking reindex operation** requiring a maintenance window per tenant (or a dual-write cutover), and should be scheduled deliberately, not silently rolled into a routine deploy.
3. **Multi-node cluster sizing guidance**: minimum 3-node ES cluster for production (quorum for master election), heap sized to ~50% of node RAM up to the 32GB compressed-oops ceiling, dedicated data vs. coordinating-node roles once query volume justifies it. This is standard ES ops guidance, not custom code — call it out as an infra/Helm-chart concern for whoever picks up PG-022 (Kubernetes production readiness), not something search-service's own code needs to implement.

## Database Changes

Not applicable — no Postgres schema change. If Option B (shared index per entity) is adopted, the change is entirely inside Elasticsearch (index topology), not the relational schema. No Drizzle migration is needed for this package.

## Backend

- `indexName()` in `SearchEngine.ts` becomes the single point of change if Option B is adopted later — instead of `erp_${tenantId}_${entity}`, it would return `erp_${entity}` and every query gains an explicit `term: { tenantId }` filter (already partially true — the code comment at line 56-64 shows the team already added a defensive tenant filter on top of index-name scoping for exactly this kind of reason, so the pattern isn't new).
- For this package specifically (Low priority, documentation-first), the concrete code change is smaller: add explicit `settings: { number_of_shards: 1, number_of_replicas: 0 }` (or 1 replica for large/critical tenants, tunable) to the index-creation calls in `createIndex()` (line ~386-394) and `fullReindex()` (line ~589-591), rather than relying on ES cluster defaults. This is a safe, additive, low-risk change independent of the bigger Option A/B/C decision, and should ship regardless of which long-term option is chosen.
- No new routes. No new Kafka events. No new outbox usage — this gap is infra-facing, not API-facing.
- Add a lightweight `GET /admin/search/cluster-stats` internal endpoint (reusing the existing `getIndexStats()` per-index stats call at line 612-614, aggregated across all of a tenant's indices, or cluster-wide via `_cat/indices` if called with platform-admin scope) so ops has a documented way to observe index count / shard count growth over time without SSHing into the ES container — this gives early warning before the risk in this gap becomes an incident.

## Frontend

Not applicable — this is a backend/infra capacity-planning gap. The existing `admin/SearchAnalyticsPage.tsx` in web-frontend already surfaces search-service telemetry (click/latency analytics per FEATURE_INVENTORY §5.13); if the `cluster-stats` endpoint above is built, a small additional card on that same page (index count, shard count, oldest un-reindexed tenant) would be a natural home — but building that card is optional polish, not the core deliverable of this package.

## API Contract

- `GET /admin/search/cluster-stats` (internal/platform-admin only) — Request: none (tenant-scoped via JWT, or `?all=true` for platform-admin cross-tenant view). Response: `{ data: { indexCount: number, totalShards: number, totalDocs: number, largestIndexBytes: number, perEntity: Record<SearchEntity, { indexCount: number, totalDocs: number }> } }`. Error codes: `403 FORBIDDEN` (non-platform-admin requesting `all=true`), `502 SEARCH_UNAVAILABLE` (ES unreachable).
- All other existing search-service API contracts (search, saved-search, DLQ view) are unchanged by this package.

## Multi-Tenant Considerations

- This gap is fundamentally *about* multi-tenant scale — the index-per-tenant model is the multi-tenancy mechanism today, and its scaling ceiling is the entire subject of this package.
- If Option B is adopted, tenant isolation moves from "physical index separation" to "mandatory query-time filter," which is a lower isolation guarantee in theory (a bug omitting the filter would cross-tenant-leak search results) but is exactly the same trust model already used for every Postgres table in this system (no RLS, app-code-enforced `tenant_id` filtering) — so it is not introducing a *new* class of risk, just extending an existing, already-accepted one to search. This should be stated explicitly in the decision record so it's a conscious tradeoff, not an overlooked one.
- Branch-scoping (mentioned in FEATURE_INVENTORY §5.13 as "branch-scoped for applicable entities") is a query-time filter today regardless of index topology — unaffected by this change either way.

## Integration

- **apps/search-service**: the service whose index topology this package concerns.
- **apps/scheduler-service**: `searchSyncJobs.ts`'s full-reindex job is the operation that would need to change if Option B (shared index) is adopted — reindexing "all tenants into one index" instead of "each tenant into its own index" is a different code path (bulk-index across tenants into a single target index, still tagging each document with its `tenantId` field, which is already stored per document per the `bulkIndex()` call at line 442 (`tenantId: String(tenantId)` is already written onto every document — this is not new plumbing, just a change in which index it lands in).
- **Infra (docker-compose / future k8s manifests)**: cluster node count and sizing is an infra change, coordinated with whoever executes PG-022.

## Coding Standards

Reuses the existing `@erp/logger` (Winston) logging already present in `SearchEngine.ts` (`logger.info`/`logger.warn` calls throughout). No new logging pattern. The `cluster-stats` endpoint follows the same Fastify + `requirePermission` + Zod convention as every other route in this codebase — no novel pattern introduced. The index-settings change (explicit shard/replica counts) is additive configuration on an existing ES client call, not a new abstraction.

## Performance

- This entire package *is* a performance/scale package. The core risk being documented: ES cluster-state size grows with shard count, and cluster-state must be replicated to every node on every change — at tens of thousands of shards, even routine operations (index creation, mapping updates) start taking seconds instead of milliseconds, and a lost node's shard-recovery storm can degrade the whole cluster.
- Setting `number_of_replicas: 0` (recommended above for most tenant indices) roughly halves shard count immediately, at the cost of needing a `fullReindex()` (already exists, already scheduled weekly) as the recovery path instead of ES's own replica-promotion if a data node is lost — an acceptable tradeoff given search data is always re-derivable from Postgres.

## Security

Not applicable in the RBAC/OWASP sense — no new user-facing attack surface. The one new consideration: the proposed `cluster-stats` endpoint exposes infrastructure topology (shard counts, doc counts) and must be platform-admin-gated (via `requirePermission`), not exposed to regular tenant users, to avoid leaking cross-tenant scale information (e.g., another tenant's document counts) if the `all=true` cross-tenant view is ever hit without proper authorization.

## Testing

- No behavior-changing test is strictly required for the documentation-only parts of this package (the Option A/B/C decision record itself isn't code).
- For the shard/replica-settings change: extend `apps/search-service/src/__tests__/search-engine-tenant-isolation-ranking.test.ts` (or add a sibling test) asserting `createIndex()`/`fullReindex()` pass the expected `settings` object to the ES client mock.
- For the `cluster-stats` endpoint (if built in this pass): a new `apps/search-service/src/__tests__/cluster-stats.test.ts` covering the platform-admin-only authorization check and the aggregation shape.

## Acceptance Criteria

- [ ] A written decision record exists (this file, or a linked follow-up doc) naming Options A/B/C, their tradeoffs, and a recommendation, reviewable by a human before any index-topology migration is scheduled.
- [ ] `createIndex()` and `fullReindex()` in `SearchEngine.ts` explicitly set `number_of_shards`/`number_of_replicas` (verifiable by reading the ES `PUT /{index}` request body sent in a test, not relying on ES cluster defaults).
- [ ] A documented shard-count projection exists for at least 3 tenant-count milestones (e.g. 50/200/1,000 tenants), each stating the resulting shard count and whether it crosses commonly-cited ES stability guidance.
- [ ] If the `cluster-stats` endpoint is built: `curl` (or an equivalent test) against `GET /admin/search/cluster-stats` returns a real index/shard count matching `GET _cat/indices` on the underlying cluster.

## Deliverables

- **Files to create:** `apps/search-service/src/api/admin.routes.ts` (or extend an existing admin routes file) for `cluster-stats`, if built this pass.
- **Files to modify:** `apps/search-service/src/domain/SearchEngine.ts` (`createIndex`, `fullReindex` — explicit shard/replica settings).
- **Migrations:** none.
- **APIs added/changed:** `GET /admin/search/cluster-stats` (new, optional for this pass).
- **Events added/changed:** none.
- **Tests added:** shard/replica-settings assertion in the existing tenant-isolation test file; new `cluster-stats.test.ts` if that endpoint is built.

---

## Context Preservation (for a fresh AI session with no prior history)

**Previous Work Summary:** search-service is fully built and working (Global Search feature, completed 2026-07-05) — real-time Kafka sync, weekly full-reindex, 10-minute incremental catch-up, 30 indexed entity types, one ES index per (tenant, entity) pair. It runs today against a single-node dev Elasticsearch container with no cluster topology or capacity plan for tenant growth.

**Current Objective:** Produce (a) a reviewed decision record on whether the one-index-per-tenant-per-entity model should change before tenant count grows, and (b) a small, safe, immediately-shippable code change (explicit shard/replica settings on index creation) that doesn't require committing to the bigger topology decision yet.

**Architecture Snapshot:**
1. `indexName(tenantId, entity)` in `SearchEngine.ts` (line 363) is the single naming choke-point — `erp_${tenantId}_${entity}`.
2. 30 entity types are unioned in the `SearchEntity` type (lines 6-36).
3. Sync: real-time via ~55 Kafka event types, weekly full-reindex + 10-min incremental via scheduler-service's `searchSyncJobs.ts`.
4. ES today: single-node, 512MB heap, security disabled — a dev container, not a sized cluster (`docker-compose.yml` lines 143-165).
5. No RLS anywhere in this system (Postgres or ES) — tenant isolation is always application-code-enforced filtering, so extending that trust model to a shared ES index (Option B) is consistent with the rest of the system.

**Completed Components:** Global Search feature itself (all 10 phases, see project memory `global_search_feature_completed`). This package does not touch that feature's query/UI behavior.

**Pending Components:** Actually executing a topology migration (Option B rollout) is explicitly NOT part of this package — that's a scheduled, reviewed, separate migration once tenant growth data justifies it. Multi-node ES cluster deployment itself is an infra/Helm task for PG-022, not this package.

**Known Constraints:** No live production tenant-growth data exists yet (dev-phase project, see `project_dev_phase_no_data` memory) — the shard-count projections in this package are therefore illustrative/formula-based, not measured. Re-verify against real tenant counts before treating any option as final.

**Coding Standards:** See "Coding Standards" section above — reuses `@erp/logger`, Fastify/Zod/`requirePermission` conventions already used throughout `search-service`.

**Reusable Components:** `indexName()`, `createIndex()`, `fullReindex()`, `getIndexStats()` in `SearchEngine.ts` — all already exist and are the right places to extend, not replace.

**APIs Already Available:** search-service's existing search/saved-search/DLQ-view endpoints (unaffected). `getIndexStats(tenantId, entity)` (line 612) already returns per-index ES stats and is the building block for the proposed `cluster-stats` aggregation endpoint.

**Events Already Available:** The ~55 Kafka event types search-service already consumes for real-time sync — unaffected by this package.

**Shared Utilities:** `@erp/logger` for structured logging (already used throughout `SearchEngine.ts`).

**Feature Flags:** Not applicable — this is infra capacity planning, not a tenant-facing feature.

**Multi-Tenant Rules:** Every ES document already carries a `tenantId` field (written in `bulkIndex()`, line 442) regardless of index topology — this package's Option B leans on that existing field as the isolation filter instead of introducing it.

**Security Rules:** Any new `cluster-stats`-style endpoint must be platform-admin-gated via `requirePermission`, not exposed to regular tenant users.

**Database State:** Not applicable — no Postgres involvement.

**Testing Status:** `apps/search-service/src/__tests__/search-engine-tenant-isolation-ranking.test.ts` and `search-engine-date-range.test.ts` exist and cover query-time behavior; no test currently asserts index-creation settings (shards/replicas) — this package should add that coverage.

**Next Session Plan:** Single session is sufficient for the decision record + the shard/replica-settings code change. If Option B (shared-index migration) is later greenlit, that becomes its own, separate, larger package (should be re-scoped and re-prioritized at that time, not pre-built speculatively here per the "no speculative flexibility" coding guideline).

**Prompt for the Next Session:** "Read `ERP-PLANNING/production-gap-prompts/012-Search/51-search-horizontal-scaling.md` in full. Implement the 'Backend' section's shard/replica-settings change in `apps/search-service/src/domain/SearchEngine.ts` (`createIndex()` and `fullReindex()`), add the corresponding test assertions described in 'Testing', and confirm the Option A/B/C decision record in 'Architecture' has been reviewed by a human before treating this package as complete — do not attempt the Option B index-topology migration itself in this session, it is explicitly out of scope."
