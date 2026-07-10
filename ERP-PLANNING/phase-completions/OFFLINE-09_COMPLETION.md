# OFFLINE-09 Completion Report — Counter Lookup (Rescoped to pos-frontend)
**Date:** 2026-07-05
**Status:** COMPLETE

## Agreed Scope

Scoped with the client before implementation, per this phase's required scoping gate:

- **Target app: `apps/pos-frontend`**, not `web-frontend` as originally titled.
  `pos-frontend` already has the full offline foundation (OFFLINE-01–08: Dexie,
  idempotent sync, delta downloads), so a counter-level lookup need is served there
  instead of building new offline infrastructure into the much larger `web-frontend`.
- **Data in scope: item/price/tax lookup + customer lookup, read-only.** Both are
  already fully synced to Dexie by OFFLINE-04's reference-data sync — no new backend
  endpoint or storage was needed.
- **Explicitly excluded:** stock-quantity lookup and customer purchase history. Neither
  is cached anywhere today (no `/sync/stock` endpoint/table exists; purchase history is
  an online-only `sales-service` endpoint). Both would require new sync infrastructure
  and were deferred rather than built speculatively.
- `apps/web-frontend` is untouched — it remains at the audit's confirmed-zero offline
  baseline.

## What Changed

Added a new read-only "Lookup" screen to `pos-frontend`, reachable via a nav link from
the main POS screen, for a manager/cashier to look up item and customer details during a
network outage without starting a sale. It reads exclusively from the Dexie tables
OFFLINE-04 already keeps synced (`catalogItems`, `customers`) — no new sync logic, new
endpoint, or new Dexie table was added.

- Two tabs: **Items** (search by name/barcode/item code — shows MRP, sale price, GST%,
  cess%, HSN, status) and **Customers** (search by name/phone — shows phone, alt phone,
  email, customer type).
- Per-tab staleness indicator ("Last sync: Xm ago") reusing the exact convention already
  used on the main POS screen's `SyncStatusPanel`, rather than inventing a new one — the
  `ConnectivityDot`/`formatLastSync` pair was extracted out of `POSScreen.tsx` into a
  shared `ConnectivityStatus.tsx` so both screens use the same code, not a duplicate.
- No offline write support — this is intentionally read-only per the agreed scope.

## Files Changed

| File | Change |
|---|---|
| `apps/pos-frontend/src/ConnectivityStatus.tsx` | New — `ConnectivityDot` + `formatLastSync` extracted from `POSScreen.tsx` for reuse |
| `apps/pos-frontend/src/POSScreen.tsx` | Removed the two extracted functions in favor of importing them; added a "Lookup" nav link in the top bar |
| `apps/pos-frontend/src/LookupScreen.tsx` | New — the read-only item/customer lookup screen |
| `apps/pos-frontend/src/main.tsx` | Added `/lookup` route (behind existing `RequireAuth`) |
| `ERP-PLANNING/audit-phase-prompts/OFFLINE-09-WEB-FRONTEND-OFFLINE-SCOPE.md` | Agreed Scope section filled in, status marked complete |

## Tests: 51/51 PASS | lint: no new errors (pre-existing monorepo-wide `no-undef` debt unchanged) | type-check: PASS | build (tsc --noEmit): PASS

Live browser verification not performed in this session — recommend a quick manual
check of the Lookup screen (online and with DevTools offline) before considering this
fully verified end-to-end.

## Known Issues / Deferred

- Stock-quantity lookup: would need a new `/sync/stock` (or similar) endpoint in
  `inventory-service`, a new Dexie table, and a prominent staleness badge (stock goes
  stale much faster than item/price data). Not built — explicitly out of agreed scope.
- Customer purchase history: only available via the online-only
  `GET /customers/:id/activity` endpoint in `sales-service`; no offline cache exists.
  Not built — explicitly out of agreed scope.
- `apps/web-frontend` still has zero offline infrastructure, unchanged by this phase —
  if a future need arises there, it would be a new, separately-scoped phase.
