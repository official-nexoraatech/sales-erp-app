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
checks the permission matching the attachment's *actual* `entityType` — `PO_VIEW`/`PO_UPDATE`
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
- [ ] Per-tenant ES indices created for every existing tenant
      (`POST /admin/search/indices/:tenantId` or equivalent bulk script) before first use —
      new tenants get theirs created automatically at tenant-provisioning time
- [ ] `search-service-group` Kafka consumer confirmed consuming all topics in
      `SEARCH_SYNC_TOPICS` in the target environment (check consumer lag)
- [ ] `search.full-reindex` and `search.incremental-sync` scheduled jobs confirmed registered
      and running in scheduler-service's cron in the target environment
- [ ] `INTERNAL_API_KEY` (or equivalent) shared secret configured consistently across
      search-service, scheduler-service, and all 6 owning services' internal routes
- [x] CI pipeline runs the Playwright E2E smoke suite (`e2e` job in
      `.github/workflows/ci.yml`, installs chromium + runs `pnpm test:e2e` against
      `apps/web-frontend`)
