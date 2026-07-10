# OFFLINE-04 — Delta-Sync Download API & Reference-Data Population
## STATUS: 🔲 NOT STARTED
## Sprint: Offline-4 | Effort: Medium (3–5 days) | Risk: Medium (new public endpoints; get tenant/branch scoping right)
## Depends on: OFFLINE-03 (local Dexie stores must exist to sync into)
## Unlocks: OFFLINE-05 (feature breadth needs populated catalog/customers), OFFLINE-07 (conflict handling needs known-fresh local prices/stock to compare against)
## Source: `ERP-PLANNING/reports/OFFLINE_FIRST_ROADMAP.md` (architectural decision #2, reusable-infrastructure table)

---

## YOUR ROLE

You are the **Backend + Frontend Platform Engineer** building the "download reference
data for offline use" half of the sync layer. Today, `apps/pos-frontend` only has a
tiny, opportunistically-cached "quick items" list and customer-search cache via its
service worker's Cache API — nothing resembling a deliberate, complete local mirror of
the catalog, customer directory, price lists, and tax rates a store might need during a
multi-hour outage.

This phase does **not** invent a new sync protocol. `apps/sales-service`'s
`search-sync.internal.routes.ts` (and its duplicate in `tenant-service`) already
implements exactly the shape this needs: a `modifiedSince` + offset-pagination endpoint
returning `{content, totalElements, hasMore}`. Your job is to expose an equivalent,
properly-scoped **public** endpoint per module and wire the client to pull from it into
the OFFLINE-03 Dexie stores.

---

## PRE-FLIGHT CHECKLIST

- [ ] Read `apps/sales-service/src/api/search-sync.internal.routes.ts` in full — the exact `modifiedSince`/pagination/response-shape convention to copy
- [ ] Confirm why this route is "internal" today (likely: it's meant only for `search-service` to consume, not public clients) — read how it's authenticated/authorized, and design the new public version's auth/scoping to match this codebase's normal public-route conventions (JWT + tenant + branch scoping), not the internal-route conventions
- [ ] Read `apps/pos-frontend/src/db.ts` (or wherever OFFLINE-03 landed the Dexie schema) — the `catalogItems`, `customers`, `priceLists`/`taxRates`, `syncMeta` table shapes you're populating
- [ ] Read the actual backend schema for items (`packages/db-client/src/schema/items.ts`), customers, and pricing/tax tables to confirm field names match what OFFLINE-03's local schema expects — reconcile any mismatch by adjusting the local schema, not by inventing new backend fields
- [ ] Read `packages/platform-sdk/src/cache.ts` (`TenantScopedCache`) — check whether the new download endpoint should read through Redis (likely yes, for the catalog/pricing data that's read far more often than written) rather than hitting Postgres on every sync request
- [ ] Read how branch scoping works for the modules being synced (per OFFLINE-01's fix, `getBranchScope` is now enforced on POS sale writes — confirm whether catalog/customer/pricing data is tenant-wide or also branch-scoped in this system, and design the download endpoint's filtering accordingly)
- [ ] Confirm the realistic catalog/customer size for this client's stores (check `ERP-PLANNING` docs or ask if genuinely unknown) — this affects whether "sync everything on login" is workable or whether a smarter subset (e.g. fast-moving items, recent customers) is needed for phase-one scope; if unknown, default to full-catalog sync with a page-size cap and flag store-scale limits as a known deferred concern rather than guessing

---

## PROJECT CONTEXT

### The convention being extended

```
GET /sales-service/internal/search-sync/items?modifiedSince=2026-07-01T00:00:00Z&page=0&size=200
→ { content: [...], totalElements: 4213, hasMore: true }
```

This phase adds equivalent, publicly-callable-by-authenticated-clients endpoints (e.g.
`GET /pos/sync/items`, `GET /pos/sync/customers`, `GET /pos/sync/price-lists`,
`GET /pos/sync/tax-rates` — exact naming should match whichever service already owns
each entity; items/customers likely live in `inventory-service`/`sales-service`
respectively, check before assuming one service owns all of them) using the identical
`modifiedSince`+pagination+`{content, totalElements, hasMore}` contract, so the client
sync logic can be written once and reused across modules.

### Client-side sync loop

On login (when online) and periodically while online (e.g. every N minutes, or on
`window.online` events), the client:
1. Reads `syncMeta`'s stored `lastSyncedAt` cursor for each entity type
2. Calls the corresponding download endpoint with `modifiedSince=lastSyncedAt`
3. Upserts returned rows into the corresponding Dexie table
4. Pages through `hasMore` until exhausted
5. Updates `syncMeta.lastSyncedAt` to the sync's start time (not each page's arrival
   time — avoid missing records updated mid-sync) only after all pages succeed

This is a foundational sync loop — write it once, generically, parameterized by entity
type/endpoint, rather than four near-identical copy-pasted implementations.

### Coding Standards
- TypeScript strict — no `any`
- No `console.log` — use `packages/logger` on the backend; match `pos-frontend`'s
  existing error-surfacing convention on the client
- New backend routes must go through the same authentication/tenant/branch-scoping
  middleware every other public route in that service uses — do not model them on the
  internal route's auth (which is likely simpler/trusts internal-network-only callers)

---

## OBJECTIVE

1. Public, authenticated, tenant/branch-scoped delta-sync download endpoints exist for items/catalog, customers, price lists, and tax rates, following the existing `modifiedSince`+pagination convention
2. `apps/pos-frontend` has a generic sync-loop function that pulls from these endpoints into the corresponding OFFLINE-03 Dexie tables, tracked via `syncMeta`
3. This sync runs on login and periodically while online, with pagination handled correctly and `lastSyncedAt` updated safely

---

## SCOPE

### Step 1 — Public delta-sync download endpoints

For each entity (items, customers, price lists, tax rates), add a new authenticated
route in the owning service following `search-sync.internal.routes.ts`'s query-param and
response-shape convention exactly, but with standard public-route auth/tenant/branch
scoping (not the internal route's). Reuse the underlying query logic where possible
(`gte(entity.updatedAt, modifiedSince)` + offset pagination) rather than duplicating it —
if the internal route's handler logic can be extracted into a shared function called by
both the internal and new public route, do that; if the internal route is intentionally
isolated for a reason you find during pre-flight, don't force a shared abstraction, just
match its shape.

Consider read-through Redis caching (`TenantScopedCache`) for these endpoints given
they'll be called by every POS device on every login/periodic sync — check with the
owning service's existing caching (e.g. how item/barcode lookups are already cached) and
match that convention rather than inventing new cache-key patterns.

### Step 2 — Generic client sync-loop

In `apps/pos-frontend`, add a sync module (naming/location matching this app's
conventions from OFFLINE-01/03) with one generic function taking an entity type, its
endpoint, and its Dexie table, that performs the full paginated pull-and-upsert loop
described in Project Context. Call it once per entity type from a single "sync all
reference data" orchestrating function.

### Step 3 — Triggers

Call the sync-all function on successful login and on `window.online` events (reusing
whatever online-detection already exists from the current `pending_sales` sync logic —
don't add a second, separate online listener). Add a reasonable minimum-interval guard
so a flapping connection doesn't trigger a sync storm.

### OUT OF SCOPE
- Any change to the existing internal `search-sync` routes' consumers (`search-service`,
  `tenant-service`) — this phase adds new routes, it doesn't repurpose or modify the
  existing internal ones
- Held-sales sync, or any write-direction sync beyond what OFFLINE-02 already built for
  pending sales — this phase is download/reference-data only
- Conflict resolution for stale local data used mid-sale (e.g. cashier rings up an item
  whose price changed on the server between syncs) — that's OFFLINE-07
- Building this sync loop for `apps/web-frontend` — that's OFFLINE-09's decision to make, not this phase's

---

## TESTING REQUIREMENTS

1. New download endpoints return only tenant/branch-scoped data — a request scoped to tenant A never returns tenant B's rows (mirror the tenant-isolation test pattern used elsewhere in the relevant service's existing test suite)
2. `modifiedSince` filtering returns only rows updated after the given timestamp
3. Pagination (`hasMore`) correctly pages through a dataset larger than one page
4. Client sync-loop correctly upserts returned rows into the corresponding Dexie table
5. `syncMeta.lastSyncedAt` only advances after a full successful pull (a failure mid-pagination leaves the cursor at its prior value, so the next sync resumes correctly rather than silently skipping the failed range)
6. Sync-on-login and sync-on-reconnect both trigger correctly without duplicate/overlapping runs if triggered close together

---

## BUILD VERIFICATION

```bash
pnpm --filter @erp/inventory-service build   # or whichever service ends up owning items
pnpm --filter @erp/sales-service build       # or wherever customers/pricing live — confirm ownership first
pnpm --filter @erp/pos-frontend build
pnpm lint
pnpm type-check
pnpm test --filter @erp/inventory-service --filter @erp/sales-service --filter @erp/pos-frontend
```

---

## VERIFICATION CHECKLIST

- [ ] New download endpoints are tenant- and branch-scoped, matching this codebase's standard auth middleware (not the internal route's simpler trust model)
- [ ] Client successfully pulls a full paginated dataset into the correct Dexie tables
- [ ] `lastSyncedAt` cursor behaves correctly across successful and failed sync attempts
- [ ] Sync triggers on login and reconnect without duplicate concurrent runs
- [ ] `pnpm lint` and `pnpm type-check` pass

---

## REGRESSION CHECKLIST

- [ ] Existing internal `search-sync` routes and their consumers (`search-service`, `tenant-service`) are completely unaffected
- [ ] OFFLINE-01/02/03's auth-refresh, idempotency, and local-DB behavior are unaffected by the new sync traffic
- [ ] Existing quick-items/customer-search Cache-API caching in `sw.ts` continues to work independently of this new structured sync

---

## DEFINITION OF DONE

- [ ] Delta-sync download endpoints exist, scoped and tested, for items, customers, price lists, and tax rates
- [ ] Client sync-loop populates the corresponding OFFLINE-03 Dexie tables correctly and resumably
- [ ] All new tests pass; regression suite green
- [ ] `pnpm lint` and `pnpm type-check` pass
- [ ] Completion report saved at `ERP-PLANNING/phase-completions/OFFLINE-04_COMPLETION.md`
- [ ] `ERP-PLANNING/reports/OFFLINE_FIRST_ROADMAP.md` updated to mark OFFLINE-04 complete

---

## COMPLETION REPORT TEMPLATE

**Save as:** `ERP-PLANNING/phase-completions/OFFLINE-04_COMPLETION.md`

```markdown
# OFFLINE-04 Completion Report — Delta-Sync Download API
**Date:** [YYYY-MM-DD]
**Status:** COMPLETE / PARTIAL

## Endpoints Added
| Entity | Endpoint | Owning Service |
|---|---|---|

## Client Sync Loop
- Location: [file]
- Trigger points: login, reconnect, [interval if added]

## Files Changed
[Table]

## Tests: [N]/[N] PASS | lint: PASS | type-check: PASS | build: PASS

## Known Issues / Deferred
- Scale limits (catalog/customer count vs. sync time) not yet load-tested — recommend validating against this client's actual store data volume before wide rollout
- [Any other deferred items]
```
