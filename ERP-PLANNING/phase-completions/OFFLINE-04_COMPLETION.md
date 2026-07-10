# OFFLINE-04 Completion Report — Delta-Sync Download API
**Date:** 2026-07-05
**Status:** COMPLETE (backend + client logic; live-DB verification deferred — see below)

## Endpoints Added
| Entity | Endpoint | Owning Service | Permission | Branch-scoped? |
|---|---|---|---|---|
| Items/catalog | `GET /sync/items` | inventory-service | `ITEM_VIEW` | No (items are tenant-wide) |
| Price list items | `GET /sync/price-list-items` | inventory-service | `PRICE_LIST_VIEW` | No (tenant-wide) |
| Tax rates | `GET /sync/tax-rates` | inventory-service | `ITEM_VIEW` | No (derived from items, tenant-wide) |
| Customers | `GET /sync/customers` | sales-service | `CUSTOMER_VIEW` | Yes — `getBranchScope()` + `inArray(customers.branchId, scope)` |

All four follow `search-sync.internal.routes.ts`'s exact `modifiedSince` + `page`/`size` +
`{content, totalElements, hasMore}` contract, but sit behind this codebase's standard
`authenticate` + `requirePermission` JWT middleware instead of the internal route's
`x-internal-key` trust model. They are new files (`sync.routes.ts` in each service), not
edits to the internal routes — `search-sync.internal.routes.ts` and its consumers
(`search-service`, `tenant-service`) are untouched.

**Naming deviation from the phase prompt's example:** the prompt suggested
`/pos/sync/items` etc. Used `/sync/items`, `/sync/customers`, etc. instead (no `/pos`
prefix) since items/price-lists/tax-rates are owned by inventory-service, which has no
existing "pos" concept — `/pos/sync/items` would have been a POS-specific path on a
service that doesn't otherwise know about POS. `/sync/<entity>` per owning service is a
generic reference-data endpoint any future offline client can reuse, not just POS.

**Why the internal route's handler wasn't reused/shared:** the internal route's
`totalElements` is `content.length` (an approximation, fine for its backfill-job
consumers who don't paginate against a moving cursor) and it has no `ORDER BY` (fine for
a one-shot backfill, not safe for a resumable multi-page client pull under concurrent
writes). Sharing the handler would have meant either degrading the new routes to match
those shortcuts, or changing the internal route's behavior — which the phase's own scope
explicitly protects ("existing internal routes... completely unaffected"). The new
routes duplicate the query shape but compute an accurate count and add
`ORDER BY updatedAt, id` for stable pagination.

**Tax rates**: there's no dedicated tax-rate master (GST/cess live on `items`, keyed by
`hsnCode`). `/sync/tax-rates` queries items (tenant + modifiedSince scoped, capped at
5000 rows) and dedupes to one row per `hsnCode` (most-recently-updated wins) in
application code rather than a SQL `DISTINCT ON`, since the realistic number of distinct
HSN codes per tenant is small (tens, not thousands). **This 5000-row cap is a real,
undiscussed scale assumption** — if a tenant's catalog exceeds it, some HSN codes could
be missed. Flagged below as deferred.

**Caching**: evaluated read-through `TenantScopedCache` per the pre-flight checklist, but
skipped it. This codebase's only caching precedent (`ItemCacheService`,
`CustomerCacheService`) is single-entity-by-ID with a fixed TTL. These sync endpoints'
cache key would have to include `modifiedSince` + `page`, which is different per calling
device (each has its own cursor) — a near-zero hit rate cache not worth the complexity.

## Client Sync Loop
- Location: `apps/pos-frontend/src/referenceSync.ts`
- One generic `syncEntity<T>(store, endpoint, upsert)` function, parameterized per
  entity, called once each for items/customers/price-list-items/tax-rates from
  `syncAllReferenceData()`.
- Reads `syncMeta`'s cursor, pages via `modifiedSince`+`page`+`size` until `hasMore` is
  false, upserts each page immediately, and only advances `lastSyncedAt` (to the sync's
  start time) after every page for that entity has succeeded. A failure on any page
  throws before the cursor is touched, so the next sync resumes from the prior value.
- Each of the 4 entities syncs independently via `Promise.allSettled` — one entity
  failing doesn't block or roll back the others.
- An in-flight guard (`syncInFlight`) collapses overlapping triggers into the same
  promise; a 60s minimum-interval guard (bypassable with `force: true`) stops a flapping
  connection from re-triggering a full sync on every `online` blip.
- Trigger points: `apps/pos-frontend/src/POSScreen.tsx`'s existing top-level `useEffect`
  (the same one OFFLINE-01/02 wired `syncPending`/online-detection into) —
  `syncAllReferenceData(true)` once on mount (POSScreen only renders once authenticated,
  so this doubles as "on login"), and `syncAllReferenceData()` inside the existing
  `handleOnline` handler. No second `window.addEventListener('online', ...)` was added.
- On total sync failure, surfaces a `toast.error(...)`, matching this app's existing
  error-surfacing convention (no `console.log`).

## Files Changed
| File | Change |
|---|---|
| `apps/inventory-service/src/api/sync.routes.ts` | New — `/sync/items`, `/sync/price-list-items`, `/sync/tax-rates` |
| `apps/inventory-service/src/main.ts` | Registered `syncRoutes` |
| `apps/inventory-service/src/__tests__/sync-routes.test.ts` | New — auth/permission gating (no DB) |
| `apps/inventory-service/src/__tests__/sync-routes.integration.test.ts` | New — tenant isolation, modifiedSince, pagination, dedup (DB-gated) |
| `apps/sales-service/src/api/sync.routes.ts` | New — `/sync/customers` |
| `apps/sales-service/src/main.ts` | Registered `syncRoutes` |
| `apps/sales-service/src/__tests__/sync-routes.test.ts` | New — auth/permission gating (no DB) |
| `apps/sales-service/src/__tests__/sync-routes.integration.test.ts` | New — tenant/branch isolation, modifiedSince (DB-gated) |
| `apps/pos-frontend/src/referenceSync.ts` | New — generic sync loop + orchestrator |
| `apps/pos-frontend/src/__tests__/referenceSync.test.ts` | New — pagination, cursor advance/hold-back, dedupe, interval guard |
| `apps/pos-frontend/src/POSScreen.tsx` | Wired `syncAllReferenceData` into the existing mount/online effect |
| `.env.example` | Added `VITE_INVENTORY_API_URL` (pos-frontend now calls inventory-service directly) |

## Tests
- New tests: 10 permission-gate/no-DB tests (7 inventory-service + 3 sales-service) +
  10 DB-gated integration tests (5 + 5) + 5 pos-frontend unit tests, all written to the
  Testing Requirements checklist (tenant isolation, `modifiedSince`, pagination/`hasMore`,
  client upsert, cursor-hold-on-failure, no duplicate concurrent sync runs).
- **Executed and passing:** `inventory-service` sync-routes.test.ts (7/7),
  `sales-service` sync-routes.test.ts (3/3), `pos-frontend` referenceSync.test.ts (5/5).
  Full existing suites re-run clean: inventory-service 22/22 (+15 pre-existing DB-gated
  skipped), sales-service 58/58 (+21 pre-existing DB-gated skipped), pos-frontend 19/19.
- **Not executed — no live DB this session** (Docker Desktop unreachable, same gap as
  every session since ES-22): `sync-routes.integration.test.ts` in both services
  (10 tests total, tenant/branch isolation + modifiedSince + pagination + tax-rate
  dedup), gated with this repo's established `describe.skipIf(!DB_URL)` convention so
  they correctly no-op here and will run once Postgres is reachable.
- `pnpm type-check` / `build`: PASS for `@erp/inventory-service`, `@erp/sales-service`,
  `@erp/pos-frontend` (`tsc` clean, zero errors).
- `pnpm lint` on touched production files (`sync.routes.ts` ×2, `referenceSync.ts`,
  `POSScreen.tsx`): zero new errors/warnings beyond the pre-existing, previously-documented
  repo-wide gap (`eslint.config.mjs` declares no Node/browser globals — every `URL`,
  `Response`, `fetch`, `window`, etc. across the whole frontend, and `process`/`crypto`
  across every backend service, already errors this way; see
  `[[preexisting_lint_debt]]` and OFFLINE-01/02/03's completion reports for the same
  finding). Confirmed by diffing against `auth.ts`/`item.integration.test.ts` which show
  the identical error shape pre-existing. One genuinely-new issue was found and fixed
  during this phase: an unused `page` destructure in both `sync.routes.ts` files.

## Known Issues / Deferred
- **Scale limits not load-tested.** Full-catalog sync-on-login is the phase-one design
  (per the pre-flight checklist's fallback guidance — no client store-scale data was
  available to size against). The `/sync/tax-rates` 5000-row pre-dedup cap is a related,
  undiscussed scale assumption — validate against this client's actual item count before
  wide rollout.
- **Deletion propagation is not handled.** Like the internal `search-sync` route this
  mirrors, all four endpoints filter out soft-deleted rows (`isNull(deletedAt)`). Once an
  item/customer is deleted, it silently stops appearing in every future `modifiedSince`
  response — a device that cached it before the delete never learns to remove it
  locally. Out of this phase's explicit scope (conflict/staleness handling is OFFLINE-07)
  but worth flagging as a gap in the sync model itself, not just a conflict-resolution
  edge case.
- **Pre-existing gap noticed, not fixed:** `sales-service`'s existing `GET /customers`
  list route (used by the main web app, not this phase) does not apply branch scoping,
  unlike the new `/sync/customers` route. Not in scope to fix here (surgical change
  policy), but the inconsistency is worth a dedicated look.
- Live-DB verification of the 10 integration tests (tenant/branch isolation, modifiedSince,
  pagination, tax-rate dedup) is still outstanding — run
  `pnpm --filter @erp/inventory-service --filter @erp/sales-service test` against a real
  `DATABASE_URL` before considering this phase production-safe.
