# Global Search (Elasticsearch) Completion Report

**Date:** 2026-07-05
**Status:** COMPLETE

## Scope

A full command-palette-style global search (Ctrl+K/Cmd+K) across 30 entities spanning 9 backend
services, backed by Elasticsearch with per-tenant indices, real-time sync via Kafka, scheduled
backfill/incremental reindex, entity + branch-level RBAC, advanced filters, saved searches,
click analytics, and a dead-letter health view. Two things in the original request don't exist
in this codebase and were excluded: Manufacturing/BOM (no tables anywhere) and pipeline-style
Lead/Contact/Opportunity CRM (this codebase's "CRM" is customer-interaction/segment/campaign
logging, which is what got indexed instead). Full scope tracking and phase-by-phase decisions
are in the approved plan (see prior session); this report is the as-built reference.

## Architecture

**Per-tenant index isolation.** Every index is named `erp_{tenantId}_{entity}`
(`SearchEngine.indexName()`, `apps/search-service/src/domain/SearchEngine.ts`). `tenantId` is
never read from a query param or body — it comes only from the caller's verified JWT
(`request.auth.tenantId`). On top of index-level separation, every search query also carries an
explicit `filter: [{ term: { tenantId: String(tenantId) } }]` clause — belt-and-suspenders, so a
bug in index-name construction alone can't leak another tenant's documents. Covered by
`search-engine-tenant-isolation-ranking.test.ts`.

**Real-time sync (outbox → Kafka → consumer → ES).** Every mutating route across sales-service,
inventory-service, purchase-service, hr-service, auth-service, and tenant-service publishes a
lifecycle event (`CUSTOMER_CREATED`, `INVOICE_CONFIRMED`, `GRN_CREATED`, `USER_CREATED`, etc.)
through the existing outbox pattern (`outboxEvents` table → `OutboxRelayWorker` → Kafka topic
`erp.<event_type_lowercase_dotted>`). search-service's `search-service-group` consumer
(`PlatformEventConsumer`, wired in `apps/search-service/src/main.ts`) subscribes to every topic
listed in `SEARCH_SYNC_TOPICS` (`apps/search-service/src/consumers/eventEntityMap.ts`), maps each
event type to `{entity, op: 'index' | 'delete', idPrefix?}`, and calls `SearchEngine.index()` /
`.delete()` accordingly (`SearchSyncConsumer.ts`). Indexing is a partial merge
(`POST /_update` + `doc_as_upsert`), not a full overwrite — necessary because different lifecycle
events for the same entity carry different field subsets. A payment document is fed by two
independent ID sequences (customer payments from sales-service, supplier payments from
purchase-service) sharing one `payment` entity/index — disambiguated via `idPrefix` (`in-`/`out-`)
so IDs never collide.

**Failure handling.** A consumer failure writes to the shared `dlq_items` table (same table
`OutboxPublisher` uses for publish-failures) with `headers.consumer: 'search-service'` before
rethrowing, so it's visible in `PlatformEventConsumer`'s own retry/backoff bookkeeping and in this
feature's dedicated dead-letter view (see Analytics below), filtered by that marker so it never
shows other services' unrelated DLQ entries.

**Backfill / full reindex / incremental sync.** search-service has no direct database access to
other services' schemas (consistent with this codebase's "no cross-service transactional logic"
convention). Instead, each owning service exposes
`GET /internal/search-sync/:entity` (x-internal-key gated, paged, `modifiedSince` support) via a
new `search-sync.internal.routes.ts` file. `apps/scheduler-service`'s two jobs —
`search.full-reindex` (weekly) and `search.incremental-sync` (every 10 min),
`apps/scheduler-service/src/jobs/searchSyncJobs.ts` — page through every service's internal
endpoint per tenant and bulk-index into search-service's own
`POST /internal/search/reindex/:entity` / `POST /internal/search/bulk-index`
(`apps/search-service/src/api/internal.routes.ts`, also x-internal-key gated, since
scheduler-service has no JWT). For the `payment` entity, both sources (sales-service +
purchase-service) are combined into a single reindex call per tenant
(`ENTITY_SOURCES` in `searchSyncSources.ts`) — reindexing from one source alone would wipe the
other's documents.

**RBAC.** `SEARCH_GLOBAL` (search access itself) is granted to every named role; `SEARCH_REINDEX`
(admin/reindex endpoints) stays admin-tier. Per-entity gating lives in `ENTITY_PERMISSION`
(`apps/search-service/src/api/search.routes.ts`) — an untyped global search silently excludes any
entity the caller's permissions don't cover (never trusts client-side hiding). Branch-scoped
entities (per `BRANCH_SCOPED_ENTITIES` in `SearchEngine.ts`) get an additional
`getBranchScope()`-derived filter, mirroring `invoice.routes.ts`'s existing pattern.

**Attachment RBAC (fixed 2026-07-05, in two passes).** Attachments don't have one fixed
permission — a single attachment's visibility depends on which parent record it belongs to
(invoice/PO/GRN), which is stored as `entityType` on the indexed document.
`ATTACHMENT_PARENT_PERMISSION` (`search.routes.ts`) maps each parent type to the permission that
actually gates it: `INVOICE → INVOICE_VIEW`, `PURCHASE_ORDER → PO_VIEW`, `GRN → GRN_VIEW`. A
direct `entity=attachment` search is filtered to only the parent types the caller holds the
matching permission for (`attachmentEntityTypes` → an ES `terms: { entityType }` clause in
`SearchEngine.search`); an untyped global search only includes `attachment` when the caller
holds every parent-type permission outright (same all-or-nothing treatment as branch-scoped
entities, since a per-document `entityType` filter can't be safely mixed into a multi-index
query). Covered by `search-entity-rbac.test.ts`.

The first pass mapped `GRN → PO_VIEW` (not `GRN_VIEW`) to mirror purchase-service's
`attachment.routes.ts`, which at the time gated GET/download for **both** `PURCHASE_ORDER` and
`GRN` attachments on `PO_VIEW` alone — a `GRN_VIEW`-only user couldn't manage their own GRN
attachments at all, and a `PO_VIEW`-only user could manage GRN attachments without any GRN
permission. The second pass fixed that source bug directly: added a new `GRN_UPDATE` permission
(`packages/shared-types/src/permissions.ts` + the separate frontend copy in
`apps/web-frontend/src/constants/permissions.ts`), granted it to `PURCHASE_MANAGER` in
`role-defaults.ts` (OWNER/ADMIN/SUPER_ADMIN get it automatically via their full-permission
spread), backfilled existing tenants via migration
`0030_grn_update_permission_backfill.sql`, and rewrote `attachment.routes.ts` so each route
checks the permission matching the attachment's _actual_ `entityType` — `PO_VIEW`/`PO_UPDATE`
for `PURCHASE_ORDER`, `GRN_VIEW`/`GRN_UPDATE` for `GRN` — rather than one permission for both.
Upload/list know `entityType` from the request (multipart field / query param) before doing any
work; download/delete only learn it after looking up the row (`PlatformAttachments.get(id)`,
new method, tenant-scoped), so the permission check happens between that lookup and the
mutating/URL-generating call. `ATTACHMENT_PARENT_PERMISSION` in search.routes.ts was updated in
the same pass to `GRN → GRN_VIEW` to match. Covered by the new
`apps/purchase-service/src/__tests__/attachment-rbac.test.ts` (7 tests).

**Frontend.** `ERPCommandPalette.tsx` (`apps/web-frontend/src/components/erp/`) — Ctrl+K/Cmd+K via
the new `useKeyboardShortcut` hook, 300ms-debounced search, grouped + highlighted results
(ES `<em>` fragments rendered as React text nodes, never `dangerouslySetInnerHTML`, since ES
doesn't escape surrounding text), full keyboard nav (arrows/enter/escape/tab-trap), recent
searches (Zustand + `persist`, max 10, `store/recentSearches.store.ts`), advanced filters
(status/date range), saved searches (`saved_searches` table + `/saved-searches` routes), and
click analytics. Result routes check `hasPermission()` per row. Wired into `Layout.tsx` behind
`hasPermission('SEARCH_GLOBAL')`.

**Analytics + health.** `search_analytics` table logs every query (fire-and-forget, never blocks
the response) with latency/result-count; `POST /search/analytics/click` closes the loop when a
user picks a result. `SearchAnalyticsPage` (`/admin/search-analytics`, gated on
`SEARCH_REINDEX`) shows total searches / no-result rate / avg latency / click-through rate,
popular and no-result query lists, and the dead-letter queue with Retry/Discard actions.

## Entities covered (30)

customer, supplier, item, invoice, purchase_order, stock, employee, quotation, crm_interaction,
crm_segment, crm_campaign, category, brand, unit, warehouse, stock_transfer, stock_adjustment,
grn, purchase_return, account, journal_entry, payment, attendance, payroll_run,
leave_application, user, role, branch, organization, attachment.

## Selector migration

`ERPAsyncSelect` (previously dead code — zero usages anywhere) is now wired via a shared
`createSearchLoadOptions(entity)` helper (`apps/web-frontend/src/lib/searchSelectOptions.ts`) in
the two highest-traffic, largest-dataset pickers: `InvoiceFormPage.tsx` (customer) and
`PurchaseOrderFormPage.tsx` (supplier) — both previously did an unbounded `list({})` fetch.
**Deliberately not migrated** (documented, not forgotten): ~30 other selector call sites
(item/employee/warehouse/branch pickers in other forms) — branch/warehouse pickers are small,
fixed lists and aren't the scale problem this migration targets; the remaining item/employee
pickers are lower-traffic and left for a follow-up pass.

## How to add a new searchable entity

1. Add the entity name to `SearchEntity` and its ES mapping to `ENTITY_MAPPINGS` in
   `apps/search-service/src/domain/SearchEngine.ts`. If it's branch-scoped, add it to
   `BRANCH_SCOPED_ENTITIES`.
2. Add its `*_VIEW` permission to `ENTITY_PERMISSION` in
   `apps/search-service/src/api/search.routes.ts`.
3. Add its lifecycle event types to `EVENT_ENTITY_MAP` in
   `apps/search-service/src/consumers/eventEntityMap.ts` (`{entity, op, idPrefix?}`).
4. Make sure the owning service actually publishes `CREATED`/`UPDATED`/`DELETED` outbox events at
   the mutating route (`ctx.events.publish(...)`, matching the existing convention) — if it
   doesn't yet, add them.
5. Add the entity to that service's `search-sync.internal.routes.ts` (or create one, following
   the existing per-service pattern) so backfill/incremental-sync can page through it.
6. Add an entry to `SEARCH_ENTITY_CONFIG` in
   `apps/web-frontend/src/lib/searchEntityConfig.ts` (icon, group label, title/subtitle fields,
   and a `route(hit)` function — omit `route` if there's no detail page yet; the palette renders
   it as non-navigable rather than crashing).
7. Run a full reindex for existing rows (see below) — new documents will start flowing through
   the Kafka consumer automatically going forward.

## How to rebuild an index

- **One tenant, one entity:** `POST /internal/search/reindex/:entity` on search-service
  (x-internal-key header, body `{ tenantId, documents: [...] }`) — or trigger it end-to-end via
  the owning service's `/internal/search-sync/:entity` endpoint + scheduler-service's
  `runSearchFullReindex(tenantId)` (`apps/scheduler-service/src/jobs/searchSyncJobs.ts`), which
  pages through every source for that entity automatically.
- **Everything, all tenants:** the `search.full-reindex` scheduled job
  (`apps/scheduler-service/src/jobs/system-jobs.ts`) already runs weekly; it can be triggered
  on-demand through scheduler-service's job-run admin route if available, or by calling
  `runSearchFullReindex()` directly for each tenant.
- Full reindex deletes and recreates the ES index before repopulating — safe (it's a search
  cache, not a system of record), but a document is unsearchable for the duration of that one
  entity's reindex.

## Troubleshooting

- **A record doesn't show up in search:** check `dlq_items` filtered to
  `headers->>'consumer' = 'search-service'` (surfaced in `SearchAnalyticsPage`'s dead-letter
  list) — the sync consumer may have failed on that event. Retry re-runs `syncSearchIndex`
  directly; Discard marks it resolved without retrying.
- **A search result isn't clickable:** the entity has no `route()` mapped in
  `searchEntityConfig.ts` yet (currently: role, journal_entry, payment, crm_segment,
  crm_campaign, attachment) — add one once that entity has a detail page.
- **A caller sees fewer entity groups than expected:** check `ENTITY_PERMISSION` — an untyped
  global search silently drops any entity the caller lacks `*_VIEW` for; this is intentional, not
  a bug.
- **High no-result rate:** check `SearchAnalyticsPage`'s "No-Result Searches" list — often a
  vocabulary gap (add a synonym to `ERP_ANALYSIS_SETTINGS`) rather than a missing document.
- **Latency above 300ms:** check `SearchAnalyticsPage`'s avg latency stat (flagged in a warning
  color above 300ms) before assuming an ES cluster problem — the debounce (300ms client-side) and
  network round-trip both count against the perceived budget, not just ES query time.

## Testing

- **search-service:** 11 test files / 61 tests, including dedicated tenant-isolation coverage
  (index path never crosses tenants, disjoint filter clauses per tenant) and ranking coverage
  (boost weights, fuzziness default, relevance-order preservation) added in
  `search-engine-tenant-isolation-ranking.test.ts`.
- **8 other backend services** (sales, inventory, purchase, accounting, hr, auth, tenant,
  scheduler) — all green; their outbox-event and internal-route additions are covered inline in
  each service's existing test files.
- **web-frontend:** 9 test files / 31 tests (Vitest + RTL), including `ERPCommandPalette.test.tsx`
  (9 tests: debounce, highlighting, keyboard nav, non-navigable results, filters) and
  `SearchAnalyticsPage.test.tsx` (3 tests: summary rendering, retry, discard).
- **Playwright E2E smoke suite** (`apps/web-frontend/e2e/global-search.spec.ts`) — the first
  Playwright test anywhere in this repo, scoped narrowly per the approved plan: Ctrl+K opens the
  palette → typing calls the real search endpoint → selecting a result navigates → Escape closes
  without navigating. Runs against the real Vite dev server with auth/search network calls
  mocked at the HTTP boundary (`page.route`), since there's no docker-compose'd
  Postgres/Elasticsearch/Kafka stack available to this suite — a true full-stack E2E run belongs
  in a separate integration pipeline. Run with `pnpm --filter @erp/web-frontend test:e2e`
  (auto-starts the dev server; first run needs `npx playwright install chromium` once).

## Known gaps (flagged, not fixed in this phase)

- ~30 selector call sites (item/employee/warehouse/branch pickers in other forms) not migrated
  to `ERPAsyncSelect` — see Selector migration section above.
- 5 entities have no detail-page route yet (role, journal_entry, payment, crm_segment,
  crm_campaign, attachment) — they render as non-clickable rows in the palette until a detail
  page exists and `searchEntityConfig.ts` is updated.
- No live Elasticsearch/Kafka/Postgres/Redis stack was available in this session — all backend
  behavior is verified via unit/integration tests with mocked `fetch`/Kafka, not against a real
  cluster. Before production rollout, run the deployment checklist below against a real
  docker-compose'd stack.

## Deployment Checklist

- [x] Migration `0028_es_search_saved_searches.sql` applied to the dev DB
- [x] Migration `0029_es_search_analytics.sql` applied to the dev DB
- [x] Migration `0030_grn_update_permission_backfill.sql` applied to the dev DB
- [ ] All three migrations applied to staging/production DBs (no staging/production environment
      exists yet — this codebase is still pre-launch, per current project state)
- [ ] Elasticsearch cluster provisioned and reachable from search-service in the target
      environment (`ELASTICSEARCH_URL` / API key env vars)
- [x] Per-tenant ES indices created for every existing tenant — **was never actually true until
      2026-07-19** (see Production-Readiness Audit below); "new tenants get theirs created
      automatically at tenant-provisioning time" was also false until this session. Verify
      again against the target environment's own ES cluster before go-live — this checklist
      item was previously marked done from code inspection alone, never from a live cluster.
- [ ] `search-service-group` Kafka consumer confirmed consuming all topics in
      `SEARCH_SYNC_TOPICS` in the target environment (check consumer lag)
- [ ] `search.full-reindex` and `search.incremental-sync` scheduled jobs confirmed registered
      and running in scheduler-service's cron in the target environment
- [ ] `INTERNAL_API_KEY` (or equivalent) shared secret configured consistently across
      search-service, scheduler-service, and all 6 owning services' internal routes
- [x] CI pipeline runs the Playwright E2E smoke suite (`e2e` job in
      `.github/workflows/ci.yml`, installs chromium + runs `pnpm test:e2e` against
      `apps/web-frontend`)

## Production-Readiness Audit — 2026-07-19

Full audit against a **real, live Elasticsearch 8.17 + Kafka + Postgres stack** (this repo's
`docker-compose.yml`), not mocked `fetch`/Kafka like every prior verification of this feature.
This is the first time this feature was ever exercised against a real cluster, and it surfaced
four real bugs — the first two meant **every tenant's search index, for every entity, forever,
had silently never been created with its intended mapping**:

1. **CRITICAL — `index.max_ngram_diff` violation broke every index creation call, always.**
   `ERP_ANALYSIS_SETTINGS`'s `erp_ngram_tokenizer` spans `min_gram: 3` to `max_gram: 12` (a diff
   of 9), but Elasticsearch's default `index.max_ngram_diff` is `1`. Every
   `createTenantIndices()`/`fullReindex()` PUT, for every entity, for every tenant, returned
   HTTP 400 `illegal_argument_exception` — the entire documented analyzer/synonym/ngram/fuzzy
   relevance model had **never once been active** for a single tenant. Fixed by adding
   `max_ngram_diff: 9` to `ERP_ANALYSIS_SETTINGS` in `SearchEngine.ts`.
2. **CRITICAL — a logging bug masked bug #1 completely.** The success/failure branch treated
   _any_ 400 response as "index already exists, fine" (`status !== 400`) instead of checking
   specifically for `resource_already_exists_exception`. Every failed creation logged "ES index
   created" at info level — there was no way to have noticed bug #1 from logs alone. Fixed via
   a new `isIndexAlreadyExistsError()` helper checking `error.type` specifically, applied to
   both `createTenantIndices()` and `fullReindex()` (the latter's PUT result wasn't checked at
   all before this fix).
3. **CRITICAL — tenant provisioning never created real indices.**
   `TenantProvisioner.createEsIndices()` (tenant-service) hand-rolled its own direct
   Elasticsearch PUT calls for only 5 of the 30 entities, under **plural** index names
   (`customers`/`items`/`invoices`/`suppliers`/`employees`) that predate a rename to singular
   entity names elsewhere in the codebase, with a simpler/different analyzer — completely
   disconnected from `SearchEngine.ENTITY_MAPPINGS`, the actual source of truth. Confirmed live:
   every tenant had these 5 legacy indices sitting empty, while real documents (via Kafka events
   calling `SearchEngine.index()`) fell through to ES's auto-create-index default — no custom
   analyzers, wrong field types inferred from JSON (e.g. `creditLimit`/`tenantId` as `text`
   instead of `double`/`keyword`), and an un-intended default replica count. Fixed by adding
   `POST /internal/search/create-tenant-indices` to search-service's internal routes (same
   internal-key-gated convention as reindex/bulk-index) and having `TenantProvisioner` call it
   instead of touching Elasticsearch directly — matching this codebase's "only the owning
   service touches its own store" convention. **Cluster-wide cleanup performed this session**:
   deleted all ~150 orphaned/mis-mapped/stray indices across the dev cluster's 17 real tenants
   (plus stray `erp_90xxxx_payment` indices from unrelated test-tenant-ID pollution) and
   recreated all 510 (17 tenants × 30 entities) correctly — cluster health green, 0 unassigned
   shards, `replicas: 0` as designed. **A fresh backfill/reindex is still required in every
   other environment** (staging/prod, once they exist) after this fix deploys — this cleanup was
   dev-cluster-only and this codebase is pre-launch with no real tenant data at stake.
4. **HIGH — unbounded `from` param crashes past page ~500.** `GET /search`'s Zod schema
   capped `size` at 100 but put no ceiling on `from` — a caller paging past result 10,000 (very
   plausible at ERP scale: browsing an unfiltered list of millions of invoices) got
   Elasticsearch's raw `illegal_argument_exception` (`index.max_result_window`) bubbling up as
   an opaque 500 instead of a clean 400. Fixed by capping `from` at 9900 in `SearchQuerySchema`
   (`9900 + size's max of 100 = 10000`). Deep result sets need the scroll/`search_after` API,
   not `from`/`size` — out of scope here; this just turns an ugly crash into an honest "narrow
   your search" 400.

**Live-verified after fixes** (real ES 8.17, real Postgres rows for tenant 2, real HTTP calls
through `GET /search` with RS256 JWTs, not mocks):

- Synonym expansion ("cloth" → matches "Textile"), ngram partial substring match, and fuzzy
  typo tolerance all now genuinely work against indexed data — none of the three ever worked
  before this session, per bugs #1–#3 above.
- Numeric fields (`creditLimit`) now correctly typed `double`, not `text`.
- RBAC entity-permission gating (403 on missing `*_VIEW`) and untyped global-search filtering
  (silently drops ungranted entities) both hold under real requests.
- Cross-tenant isolation confirmed with two real signed JWTs (tenant 2 vs. tenant 34) — a
  query that matches tenant 2's real customer data returns zero hits under tenant 34's token.
- Unicode/emoji and an ES-query-injection-shaped payload (`'; DROP TABLE customers;--`) both
  handled safely — the query text is always a JSON value inside `multi_match`, never
  string-concatenated into a DSL string, so there's no ES-query-injection surface here.
- Bounded load test: 25,000 synthetic item documents bulk-indexed in ~9.3s (~2,700 docs/sec,
  single-node dev cluster, `BATCH_SIZE: 500`). Query p50/p95 latency on that volume: exact match
  33/86ms, ngram partial 36/42ms, fuzzy typo 19/22ms, sorted-by-numeric-field 30/186ms — all
  well under the 300ms budget this feature's own analytics dashboard warns above. This is a
  single-node dev-cluster measurement at 25K records, **not** a production capacity benchmark —
  real "millions of records / 500 concurrent users" sizing needs a proper multi-node ES cluster
  test, which needs dedicated infrastructure this session didn't have.

**Not exercised this session** (flagged, not fixed): a true concurrent-user load test (500
simultaneous searchers), the scheduler-service `search.full-reindex`/`search.incremental-sync`
cron jobs against a live run (no scheduler-service process was started), and the Playwright E2E
suite re-run against the now-fixed backend (it already ran mocked at the HTTP boundary per the
original Testing section above; a live re-run was out of scope for this pass).

## Enterprise Audit + Fix Pass — 2026-07-23

Full architecture/gap-analysis review of the entire search feature (indexing, query engine,
ranking, filters/facets, event-driven sync, multi-tenancy, security, performance, monitoring,
audit, API surface, integration with all 7 owning services) before any code was touched, per
this session's explicit "no assumptions, present findings first" instruction. Six findings were
selected by the user for fixes (out of a larger list — see "Findings not fixed" below); all six
were implemented, unit-tested, and live-verified against this repo's real Elasticsearch 8.17 +
Kafka + Postgres stack (tenant 2, the existing "QA E2E Test Co" tenant), not just mocks.

### 1. CRITICAL — the `stock` entity had zero indexing path; fixed, now event-driven

`stock` (per-warehouse item quantity) had a full ES mapping, permission (`STOCK_VIEW`), and
index provisioned for every tenant — but no event anywhere ever indexed a document into it, and
scheduler-service's backfill explicitly excluded it ("a running balance, not a discrete row").
`GET /search?entity=stock` always silently returned zero results. It was also absent from the
frontend's entity config, so no UI ever surfaced it either.

**Fix:** `InventoryLedgerService.upsertProjection()` (the single funnel every stock movement —
GRN receipt, sale, adjustment, transfer — already passes through to update
`projection_stock_level`) now also publishes a `STOCK_LEVEL_CHANGED` outbox event with the
post-movement absolute quantity plus denormalized item/warehouse names (two lightweight
indexed-PK lookups, the same order of magnitude of DB cost the valuation calls on this same
path already incur). `eventEntityMap.ts` gained an `idFromPayload` extension point (every other
entity keeps the default `aggregateId`-based id) since `stock`'s natural key is
`item × warehouse × variant`, not a single row id. Added a real backfill/reindex source
(`GET /internal/search-sync/stock` in inventory-service, joining `projection_stock_level` with
`items`/`warehouses`) — the "not a discrete row" rationale for excluding it from backfill turned
out to be incorrect; it's exactly as row-based as everything else the backfill job already
covers. Wired `stock` into the frontend's `SEARCH_ENTITY_CONFIG` (routes to `/inventory/stock`,
the existing Stock Levels page).

**Live-verified:** real `addStock()` call against tenant 2 (item "Cotton Saree", warehouse "QA
E2E Warehouse") produced a correct `STOCK_LEVEL_CHANGED` outbox row and updated
`projection_stock_level`; a live bulk-index + `GET /search?entity=stock&q=cotton` against real
ES returned the document with correct highlighting; search-service's real Kafka consumer group
confirmed subscribed to the new `erp.stock.level.changed` topic.

### 2. Zod validation added to `internal.routes.ts`

Unlike every JWT-gated route in this service, the internal-key-gated routes (used by
scheduler-service and tenant-service, which have no JWT to validate against) took
`tenantId`/`entity`/`documents` straight off `request.body` with zero schema — a missing
`tenantId` would have silently built an ES index name like `erp_undefined_item`. Added Zod
schemas matching the rest of the codebase's convention. Live-verified: a request with a missing
`tenantId` now returns `422 VALIDATION_ERROR` instead of corrupting an index name.

### 3. Route-level rate-limit override for `/search` and `/search/suggest`

The platform-wide global rate limiter is effectively IP-keyed, not tenant-keyed, for every
service including this one (a documented, pre-existing platform-wide characteristic — see
`packages/platform-sdk/src/rate-limit.ts`'s own comment: a globally-registered limiter runs at
`onRequest`, before any route's `authenticate` preHandler populates `request.auth`). At 200/min,
this is tuned for occasional admin/CRUD traffic, not a command palette firing a request on every
300ms-debounced keystroke for every logged-in user — a handful of concurrent users behind one
office IP could exhaust it inside a minute of normal typing. Raised the ceiling to 600/min for
these two specific, cheap, read-only, legitimately-high-frequency routes rather than building
true tenant-aware keying (which would require re-verifying the JWT a second time before
`authenticate` runs, since `@fastify/rate-limit`'s key generator also executes at `onRequest`) —
a deliberate scope call, documented inline at both call sites.

### 4. Search-specific Prometheus metrics

Investigation found the "DLQ backlog" metric gap I initially flagged was already solved
platform-wide: `erp_dlq_depth` (event-service's `OutboxRelayWorker.refreshGauges()`) queries
`dlq_items` ungrouped by consumer, so it already reflects search-service's own dead-letter
entries — no new code needed there. What was genuinely missing: `erp_search_sync_failure_total`
(consumer sync failures by event type — depth alone hides history once an item is
retried/discarded) and `erp_search_reindex_total` (documents processed by reindex/bulk-index, by
entity and outcome) — both previously visible only in service logs. Live-verified present in
`/metrics` output after a real service boot.

### 5. Audit logging for destructive admin routes

`DELETE /admin/search/indices` (wipes every index for a tenant), `POST /admin/search/reindex/:entity`,
`POST /admin/search/bulk-index`, and `POST /admin/search/indices` previously left no audit trail
at all, unlike every other admin/destructive action in this codebase. Added
`PlatformAuditLogger` calls (best-effort, never blocks the actual action on a logging failure).
Live-verified: a real `POST /admin/search/indices` call against tenant 2 produced a genuine
`audit_log` row (`action: CREATE_INDICES, entity_type: search_index, tenant_id: 2, user_id: 1`).

### 6. Real per-entity result-count aggregation (facets)

An untyped, multi-entity search's palette group headers previously showed no count at all, and
implicitly could only ever reflect whatever fraction of one flat, `size`-capped, combined-
relevance page happened to be each type — a high-volume but lower-BM25-scored entity could be
entirely invisible despite having real matches. Added an ES `terms` aggregation on the `_index`
metadata field (only for multi-index searches; a single-`entity` search already has an exact
`total`), parsed into `SearchResult.entityCounts`, surfaced in the command palette as a
"N total" badge on any group whose real total exceeds what's actually rendered. Live-verified:
a real multi-entity search for "cotton" against tenant 2 returned
`entityCounts: {customer: 17, stock: 1}`.

### Findings surfaced but not fixed (out of this pass's approved scope)

- No real per-entity result-allocation strategy beyond the new count display — a single flat
  top-N query across all permitted indices, sorted by combined BM25 score, is still how the
  actual returned page is chosen; a very differently-scored entity's matches can still be
  under-represented in the visible rows even though the count badge now reveals when this
  happens.
- `attachment` still has no backfill/reindex source (deliberate, pre-existing — no
  owning-entity listing endpoint built for it) — real-time Kafka indexing is its only path, so a
  DLQ'd attachment event has no full-reindex safety net, unlike every other entity now including
  `stock`.
- `search_analytics.query` has no trigram (GIN) index for `/search/suggest`'s `similarity()`
  call — fine at current per-tenant analytics volume, worth a follow-up if that table grows very
  large for a single tenant.
- True horizontal scaling (multi-node ES cluster, shard/replica strategy beyond the current
  single-shard/zero-replica dev-cluster default) was out of scope — this pre-launch codebase has
  no production ES cluster to size against yet (see `[[project_dev_phase_no_data]]`).

### Testing

- 3 new/expanded search-service test files (`search-engine-entity-counts.test.ts` new;
  `search-internal-reindex-authz.test.ts` and `search-admin-authz.test.ts` extended) — 85 tests
  total in the package, all green.
- `inventory-service`'s `ledger-service.test.ts` updated for the new outbox-publish DB calls in
  `upsertProjection()` — 6 tests green (2 pre-existing, unrelated test-file failures in that
  package, confirmed present on a clean `git stash` baseline before any of this session's
  changes, are out of scope for this pass).
- `web-frontend`'s `ERPCommandPalette.test.tsx` extended with an entity-counts badge test — 11
  tests green.
- Full `tsc --noEmit` clean across search-service, inventory-service, scheduler-service,
  web-frontend, `@erp/logger`, `@erp/types`.
- Live end-to-end verification against the real docker-compose stack (Postgres/Kafka/
  Elasticsearch), documented per-fix above — not just mocked unit tests.
