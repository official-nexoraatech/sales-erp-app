# Search Module — Production Readiness Audit (2026-07-25)

Scope: `apps/search-service` (indexing, global search, saved searches, search analytics,
search-service's role in the DLQ), `apps/web-frontend/src/pages/admin/SearchAnalyticsPage.tsx`,
and the global search bar feature. Live-verified against the real Elasticsearch cluster
(`localhost:9200`), the real Kafka/outbox pipeline, and the gateway (`localhost:3000`) using
tenant 2 ("QA E2E Test Co") credentials from `TEST_CREDENTIALS.md`.

## Summary

Search-service itself is well engineered: RBAC is enforced correctly and live-verified (per-entity
permission gates, untyped global search silently drops entities the caller can't see, admin routes
require `SEARCH_REINDEX`), multi-tenant isolation is architecturally sound (index name is
`erp_{tenantId}_{entity}`, tenantId always comes from the JWT, never from request input), all ES
indices across every tenant are green/healthy, the search analytics page is a real feature backed
by real usage data (not a stub), a working reindex/backfill mechanism exists (weekly full reindex +
10-minute incremental sync via scheduler-service), and all 85 of the service's own tests pass.

However, the centerpiece finding assigned for this audit is confirmed and is serious: the shared
`aggregateId` extraction bug in `packages/platform-sdk/src/events.ts:141` (already found in the
Sales audit for invoices/quotations) has a **much wider blast radius than just invoices and
quotations**. It corrupts real-time search indexing for at least 7 entity types across 3 services
(sales, purchase, HR), confirmed live against the real ES cluster right now. Additionally, two
entire entity types with real UI/backend features — **sale returns and delivery challans** — have
**zero search indexing path at all** (no event mapping, no ES index), a distinct gap in the same
family as the previously-fixed "stock had zero indexing" bug.

## Blast radius of the aggregateId collision bug (centerpiece finding)

### Root cause, precisely

`PlatformEventConsumer.subscribe()` in `packages/platform-sdk/src/events.ts` (used by every
service's generic Kafka consumer, including search-service's `SearchSyncConsumer`) computes:

```ts
aggregateId: Number(businessPayload['id'] ?? 0) || 0,   // line 141
```

This is used by `SearchSyncConsumer`/`eventEntityMap.ts` to build the Elasticsearch document id:
`${idPrefix ?? ''}${event.aggregateId}` (no `idFromPayload` override exists for any entity except
`stock`). So **any outbox payload that does not literally contain a field named `id`** — which is
nearly every hand-built payload in the codebase, since producers consistently use semantic field
names like `invoiceId`, `poId`, `grnId` — collides on ES doc `_id: "0"` (or `in-0`/`out-0` for the
prefixed `payment` entity).

A second, previously undocumented nuance makes this worse than "flat payloads only": for events
published via `PlatformEventBus.publish()`/`publishInTransaction()` (the "enveloped" shape used by
GRN, employee/HR, and others), the outbox row's top-level `aggregateId` field **is set correctly**
(`publishInTransaction` writes it in on line 39 of events.ts). But the consumer's extraction logic
at line 141 never reads `envelope?.['aggregateId']` — it only ever reads `businessPayload['id']`
(the nested business payload). So the enveloped path's one piece of always-correct data is
discarded, and the same `id`-field-name coincidence decides whether that entity type is broken —
`SUPPLIER_CREATED`/`ITEM_CREATED`/`CUSTOMER_CREATED` happen to publish the full DB row (which has a
literal `id` column) and so accidentally work; `GRN_CREATED`/`EMPLOYEE_JOINED` publish a
hand-built object with `grnId`/`employeeId` and so collide, despite going through the "already
correct" envelope path.

### Per-entity verification (payload field name vs. live ES evidence)

| Entity                 | Event(s) checked                                                                        | Outbox payload field | `businessPayload['id']`? | Live ES collision confirmed?                                                                               |
| ---------------------- | --------------------------------------------------------------------------------------- | -------------------- | ------------------------ | ---------------------------------------------------------------------------------------------------------- |
| **invoice**            | `INVOICE_CREATED`, `INVOICE_CONFIRMED` (`InvoiceService.ts`)                            | `invoiceId`          | No                       | **Yes** — `erp_2_invoice` doc `_id="0"` holds invoice 127's stale DRAFT snapshot                           |
| **quotation**          | `QUOTATION_CREATED`, `QUOTATION_UPDATED`, `QUOTATION_CONVERTED` (`quotation.routes.ts`) | `quotationId`        | No                       | **Yes** — `erp_2_quotation` doc `_id="0"` holds quotation 44's data                                        |
| **purchase_order**     | `PO_CREATED/APPROVED/AMENDED/CANCELLED` (`PurchaseOrderService.ts`)                     | `poId`               | No                       | **Yes** — `erp_2_purchase_order` doc `_id="0"` holds PO 55's data                                          |
| **grn**                | `GRN_CREATED` (enveloped, `grn.routes.ts`), `GRN_APPROVED` (flat, `GRNService.ts`)      | `grnId`              | No                       | **Yes** — `erp_2_grn` doc `_id="0"` holds GRN 34's stale DRAFT snapshot                                    |
| **purchase_return**    | `PURCHASE_RETURN_APPROVED` (`PurchaseReturnService.ts`)                                 | `returnId`           | No                       | **Yes** — `erp_2_purchase_return` doc `_id="0"` holds return 10's data                                     |
| **payment (customer)** | `PAYMENT_RECEIVED` (`PaymentService.ts`), idPrefix `in-`                                | `paymentId`          | No                       | **Yes** — `erp_2_payment` doc `_id="in-0"` holds payment 103's data                                        |
| **payment (supplier)** | `SUPPLIER_PAYMENT_MADE` (`SupplierPaymentService.ts`), idPrefix `out-`                  | `paymentId`          | No                       | **Yes** — `erp_2_payment` doc `_id="out-0"` holds payment 26's data                                        |
| **employee**           | `EMPLOYEE_JOINED` (enveloped, `employee.routes.ts`)                                     | `employeeId`         | No                       | **Yes** — `erp_2_employee` doc `_id="0"` holds employee 32's data                                          |
| **supplier** (control) | `SUPPLIER_CREATED` (enveloped, `supplier.routes.ts`)                                    | full row (`created`) | **Yes**                  | No collision — accidentally correct                                                                        |
| **customer** (control) | `CUSTOMER_CREATED` (enveloped, `customer.routes.ts`)                                    | full row (`created`) | **Yes**                  | No collision — accidentally correct                                                                        |
| **item** (control)     | `ITEM_CREATED` (enveloped, `item.routes.ts`)                                            | full row (`created`) | **Yes**                  | No collision — accidentally correct                                                                        |
| **sale return**        | `SALE_RETURN_APPROVED` (`SaleReturnService.ts`)                                         | `returnId`           | No, but **N/A**          | Not indexed at all — no `EVENT_ENTITY_MAP` entry for sale returns exists (separate gap, see below)         |
| **delivery challan**   | n/a                                                                                     | n/a                  | n/a                      | Not indexed at all — no search entity, no ES index (`erp_2_delivery_challan` does not exist), separate gap |

Raw ES evidence (queried directly against `localhost:9200`, 2026-07-25):

```
erp_2_invoice          _id=0   {"invoiceId":127,"status":"DRAFT", ...}   (alongside the correct _id=127 doc)
erp_2_quotation        _id=0   {"quotationId":44, ...}                   (alongside the correct _id=44 doc)
erp_2_purchase_order   _id=0   {"poId":55, ...}                          (alongside the correct _id=55 doc)
erp_2_grn              _id=0   {"grnId":34,"status":"DRAFT", ...}        (alongside the correct _id=34 doc)
erp_2_purchase_return  _id=0   {"returnId":10, ...}                      (alongside the correct _id=10 doc)
erp_2_payment          _id=in-0  {"paymentId":103, ...}                  (alongside the correct _id=in-103 doc)
erp_2_payment          _id=out-0 {"paymentId":26, ...}                   (alongside the correct _id=out-26 doc)
erp_2_employee         _id=0   {"employeeId":32, ...}                    (alongside the correct _id=32 doc)
erp_2_supplier / erp_2_customer / erp_2_item — no _id="0" doc present in any of them (control group, confirms the fix works when payload has a literal `id`)
```

### Why the damage is bounded but not zero

Real docs for these entities are **not permanently lost**: `scheduler-service` runs a
`search.incremental-sync` job every 10 minutes and a `search.full-reindex` job weekly
(`apps/scheduler-service/src/jobs/searchSyncJobs.ts`), which read straight from each owning
service's Postgres tables via `/internal/search-sync/:entity` and re-index by the true row id.
This is why correct docs (`_id=127`, `_id=44`, etc.) coexist with the garbage `_id=0` doc in the
same index right now — the periodic job already repaired them.

The actual live impact:

1. **A permanent phantom/zombie document** (`_id="0"`, `"in-0"`, `"out-0"`) sits in 7 of the 30
   ES indices, forever overwritten by whichever record of that type was most recently
   created/confirmed/approved in real time. It is a real, matchable Elasticsearch document — a
   user searching by a term that happens to match its stale content gets an extra, wrong/stale
   hit mixed into results.
2. **Up to a ~10-minute window after every create/confirm/approve action** where the real record
   either doesn't appear in search yet, or appears with stale/incomplete data (e.g. the `grn`
   index's `_id=0` doc still shows GRN 34 as `DRAFT` even though it was later `APPROVED` — the
   `GRN_APPROVED` event also collided into `_id=0` but a subsequent event apparently overwrote it
   again before this snapshot).
3. Confirmed **not** a data-loss bug (real per-ID docs survive/self-heal), but it is a data
   _quality_ bug users can actually observe in the global search UI today, and it silently defeats
   the purpose of real-time search sync for 7+ entity types — search only becomes reliably correct
   after the next scheduled sync, not immediately after the action, which is the opposite of what
   "real-time indexing" is supposed to buy.

### Fix scope note

The root cause lives in shared `packages/platform-sdk/src/events.ts`, not in search-service. A
correct general fix (e.g. preferring `envelope?.['aggregateId']` when present, or adding
`idFromPayload` overrides in `eventEntityMap.ts` for every affected entity the way `stock` already
has) affects every consumer of `PlatformEventConsumer`, not just search — this was flagged as
"platform-sdk, shared code" in the CLAUDE.md sense and is out of this audit's fix scope; reporting
only, per the task.

## What works (verified live)

- **Global search** (`GET /api/search/search?q=...` via gateway): searched `Ramesh` → correctly
  returned the exact customer `Ramesh Textiles` top-ranked with highlighting, plus fuzzy-matched
  secondary results. Relevance ranking, highlighting, and cross-entity results all work.
- **RBAC enforcement**, live-tested with the `cashier` role: `GET /search?entity=payroll_run`
  correctly 403'd (`Missing permission: PAYROLL_VIEW`); untyped search for the same cashier
  silently omitted entities like `supplier` that the role lacks permission for, while `owner`'s
  identical query included them. No bypass found.
- **Multi-tenant isolation**: index naming (`erp_{tenantId}_{entity}`) is derived exclusively from
  `auth.tenantId` (JWT claim) in every route — never from request body/query — so cross-tenant
  leakage is architecturally prevented, consistent with the 2026-07-19/23 prior audits.
- **Index health**: `curl localhost:9200/_cat/indices/erp_*` shows **every** index across **every**
  tenant (300+ indices) as `green open`. Zero red/yellow indices found.
- **Search Analytics page** (`SearchAnalyticsPage.tsx`) is real, not a stub: `GET
/admin/search/analytics/summary` returned genuine usage data (148 searches over 30 days, popular
  queries, no-result queries, click-through rate, avg latency) sourced from a real
  `search_analytics` Postgres table populated by every search call. The page also surfaces the
  search-service's DLQ (retry/discard pending index-sync failures) — currently empty/healthy
  (`0` pending dead letters for tenant 2), i.e. search-service's role in the DLQ is healthy right
  now.
- **Advanced filters/facets**: `search.routes.ts` supports `status`, `branchId`, `warehouseId`,
  `customerId`, `supplierId` exact-match filters plus a `dateField`/`dateFrom`/`dateTo` range
  filter, gated appropriately; covered by `search-advanced-filters.test.ts`.
- **Reindexing/backfill capability exists and works**: `POST /admin/search/reindex/:entity`
  (human/JWT-gated) and the internal equivalents used by `scheduler-service`'s
  `search.full-reindex` (weekly) / `search.incremental-sync` (10 min) jobs both pull from
  Postgres by real primary key and write correct-ID docs — this is precisely what's currently
  masking the aggregateId bug's damage (see above). Confirmed present and exercised (the correct
  `_id=<real id>` docs alongside every garbage `_id=0` doc are proof it ran).
- **Tests**: all 16 test files / 85 tests in `apps/search-service/src/__tests__` pass
  (`pnpm --filter @erp/search-service test`), including RBAC, tenant isolation/ranking, bulk index,
  date-range filters, admin authz, dead-letters routes, and the sync-consumer's own event-mapping
  unit tests.

## Other bugs/gaps found

1. **Sale returns have zero search indexing** (High). `EVENT_ENTITY_MAP` in
   `apps/search-service/src/consumers/eventEntityMap.ts` has no entry for `SALE_RETURN_APPROVED`
   (or any sale-return event), and there is no `sale_return` `SearchEntity`/ES index at all. A
   fully real, working feature (Sale Returns, confirmed working end-to-end in the 2026-07-13 CRM/
   Sales audit) is completely invisible to global search — same class of bug as the previously
   fixed "stock had zero indexing path" finding, just never caught for this entity.
2. **Delivery challans have zero search indexing** (Medium-High). Same gap — `DeliveryChallanService`/
   `delivery-challan.routes.ts` is a real feature in sales-service with no corresponding search
   entity, event mapping, or ES index.
3. **Numeric/SKU query relevance quality** (Medium). Searching the literal SKU `23432432` (an
   exact match on `erp_2_item`'s only item with that SKU) returns the correct item, but ranked
   _last_ among 9 hits — 8 unrelated `customer` records (mostly matched loosely on
   partially-similar phone numbers via `fuzziness: AUTO`) rank above the exact SKU match. Not
   incorrect (the right result is present), but a real relevance-quality defect for a common
   search pattern (searching by product code/SKU/barcode) that could make an exact hit hard for a
   user to notice on a busy results page.
4. **Average search latency is high** (Low/Info, not conclusively a bug). The analytics summary
   reported `avgLatencyMs: 833` over the last 30 days for tenant 2 — worth another look under
   normal (non-audit-hammering) load before trusting this number as representative; noting for
   visibility rather than flagging as confirmed.

## Untested/unknown areas

- **Saved searches** (`saved-searches.routes.ts`) — only unit/authz-tested (`saved-searches-authz.test.ts`
  passes), not exercised live end-to-end from the frontend in this session.
- **"Did you mean" / suggest** (`GET /search/suggest`, trigram similarity) — code reviewed, not
  live-exercised (needs `pg_trgm`-backed historical query data with `result_count > 0` to produce
  a suggestion; not attempted here).
- **Click-through boosting** — `search_analytics.clickedResultId` is real and the boost logic in
  `search.routes.ts` reads it, but `clickedCount: 0` in the live summary means no click has ever
  actually been recorded in this environment (the frontend must call `POST
/search/analytics/click`); the boost path itself was not exercised live.
- **DLQ deep dive** — explicitly out of scope per the task; only confirmed search-service's queue
  is currently empty/healthy for tenant 2, not the DLQ's broader mechanics.
- Other tenants' data (e.g. tenant 6, 8, 12, 25, etc. visible in the index listing) were not
  spot-checked for the same aggregateId collision — the tenant-2 evidence above is a representative
  sample, not an exhaustive per-tenant sweep, but the bug is in shared code that runs identically
  for every tenant, so the same collisions are expected everywhere.

## Readiness score: 70/100

**Justification.** Search-service's own engineering (RBAC, tenant isolation, index health,
analytics, admin tooling, reindex safety net, test coverage) is genuinely solid — the kind of
polish seen in a mature module, and none of the previously-fixed issues (2026-07-19, 2026-07-23)
have regressed. But the module's core promise — "real-time search reflects what just happened" —
is currently broken for 7 of its higher-value entity types (invoices, quotations, purchase orders,
GRNs, purchase returns, both payment types, employees) due to a shared platform bug, producing both
a permanent phantom document per affected index and a real (bounded but nonzero) staleness window
on every create/update. Layered on top, two real business features (sale returns, delivery
challans) are entirely absent from search — a correctness gap of the same severity class as the
already-fixed "stock had zero indexing" bug. These are core-functionality defects a user would
notice ("I just confirmed this invoice, why can't I find it / why do I see a weird half-empty
result"), not edge cases, which caps the score well below the 80s despite the strong
infrastructure/security posture underneath.

## Test data created during this audit

- No new tenant/customer/item/etc. business records were created. Live verification used existing
  tenant-2 QA data (customers, items, invoices, quotations, POs, GRNs, purchase returns, payments,
  employees already present from prior audit sessions) plus read-only ES queries and gateway
  search/analytics calls.
- Ran `pnpm --filter @erp/search-service test` (read-only, no live infra touched).
- Logged in as `owner@qa-e2e.local` and `cashier@qa-e2e.local` (existing QA users) to obtain JWTs
  for live RBAC verification; tokens written to the session scratchpad only, not committed.
