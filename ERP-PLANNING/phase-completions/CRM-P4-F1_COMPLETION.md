# CRM-ROADMAP Phase 4, Feature 1 — Field Sales / Distributor CRM — Completion Report

**Date:** 2026-07-31
**Status:** Complete, tested against a real local Postgres, zero regressions in every touched
service's full test suite.

## Summary

Route planning + GPS check-in/out visit logging for reps covering physical territory, the last
Phase 4 feature without a hard external blocker (WhatsApp Commerce needs Meta vendor credentials;
Partner Portal's own spec says not to build until the Customer Portal is live in production; CTI
has an open vendor choice plus unresolved call-recording legal questions). Before writing any
code, research confirmed two of the roadmap's own open questions were already answered by
existing precedent: Mobile CRM (Phase 3, Feature 4) already established "responsive-first PWA
extension of `web-frontend`, no new native app" as this codebase's answer to "separate app vs.
PWA," and the OFFLINE-02/05 `clientOperationId` unique-constraint idempotency mechanism (already
used by `InvoiceService`/`CustomerService`) was the exact "conflict resolution, not naive
last-write-wins" pattern the roadmap asks to reuse. Research also surfaced the one genuinely new
piece of infrastructure this feature needed: `web-frontend`'s service worker explicitly does not
queue offline writes yet (its own header comment names this feature as the one that would add
that) — so a real, purpose-scoped offline write-queue was built, not assumed to already exist.

### Backend

- **Schema** (migration `0144_crm_field_sales.sql`): `crm_visit_routes` (a distribution manager's
  planned route: name, `assignedTo`, optional `territoryId` reusing Phase 4 Feature 4's territory
  concept, `scheduledDate`, `status`), `crm_visit_route_stops` (ordered customer stops per route,
  `status` + `visitId` set once a visit is logged against it), `crm_field_visits` (the actual-visit
  log: `repUserId`, `customerId`, optional `routeStopId` — a visit is valid standalone/unplanned
  too, not only ever tied to a planned stop — `checkInLat`/`checkInLng`/`checkOutLat`/
  `checkOutLng` as `decimal(9,6)` pairs, `clientOperationId` for idempotency).
- **`FieldVisitService`** (new): `createRoute`/`listRoutes` (identity-scoped to the caller unless
  `ROUTE_MANAGE`)/`setStops` (replace-all, same convention as Territory Management's
  `setBranches`)/`getRouteProgress`/`updateRoute` (optimistic-locked). `logVisit` reuses the
  **exact** `clientOperationId` unique-constraint + catch-`23505`-via-`isUniqueConstraintViolation`
  - re-query-and-return-existing pattern already used by `CustomerService.create` (OFFLINE-05) —
    not a new conflict-resolution strategy, per the roadmap's own explicit instruction. `checkOut`
    scopes its `WHERE` clause to `(id, tenantId, repUserId)`, so a rep attempting another rep's
    visit id gets a `NotFoundError` (404), never a 403 — the same "ownership mismatch reveals
    nothing" discipline as the Customer Portal's own routes.
- **Routes** (`field-visit.routes.ts`, new): `POST`/`GET /visit-routes`, `PUT /visit-routes/:id`,
  `PUT /visit-routes/:id/stops`, `GET /visit-routes/:id/progress`, `POST /field-visits`,
  `PUT /field-visits/:id/checkout`, `GET /field-visits`. Two new permissions:
  `ROUTE_MANAGE` (distribution managers — route CRUD, tenant-wide visit/route visibility) and
  `FIELD_VISIT_MANAGE` (a rep's own check-in/out). Both granted to SALES_MANAGER (migration
  `0145_crm_field_sales_permission_backfill.sql`) — this codebase has no distinct "field rep"
  role, reps are `SALES_MANAGER`-scoped users today, so visibility scoping happens at the query
  layer (`repUserId`/`assignedTo` = caller) rather than via a new role.

### Frontend

- **`lib/offlineVisitQueue.ts`** (new): a small, purpose-built IndexedDB write-queue — explicitly
  _not_ a generic offline framework, scoped to field-visit check-in/out submissions only.
  `submitOrQueueVisitAction` attempts the real request first; only a genuine network failure (a
  `TypeError` from `fetch` itself, never an HTTP error response) queues the action. `flushVisitQueue`
  replays queued actions in submission order, stopping at the first failure so later actions never
  run out of order, and is triggered both by a manual "Sync Now" button and a `window`
  `online`-event listener. The bearer token is read fresh at send time on every attempt (never
  captured into the stored record), since a queued action can sit for hours past its original
  token's expiry. Conflict-safety is inherited entirely from the backend's `clientOperationId`
  mechanism — replaying a queued action after a flaky partial success is safe by construction, no
  new client-side dedup logic needed.
- **`FieldVisitsPage.tsx`** (new, rep-facing): "My Routes" — each route's stops with a Check In
  button (captures GPS via `navigator.geolocation`, falling back gracefully with no GPS if denied/
  unavailable — a visit can still be logged without coordinates), plus an "Unplanned Visit" panel
  for ad-hoc check-ins against any customer. Shows a pending-sync count with a manual sync button
  when offline actions are queued.
- **`VisitRoutesPage.tsx`** (new, manager-facing): create a route (name/rep/date), add stops via
  customer search, view per-route progress (completed vs. total stops).
- Both wired into `App.tsx`/`navigation.ts` (`/crm/field-visits` gated on `FIELD_VISIT_MANAGE`,
  `/crm/visit-routes` gated on `ROUTE_MANAGE`) and `endpoints.ts` (`fieldVisitApi`).

## Decisions (flagged, not silently decided)

1. **No manager-hierarchy scoping** — `ROUTE_MANAGE` sees every rep's routes/visits tenant-wide,
   not just their direct reports. This codebase has no manager-hierarchy concept at all (confirmed
   via research); inventing one for this feature alone would be speculative infrastructure beyond
   what was asked. Same "no partial-tenant admin view" precedent as `TERRITORY_MANAGE`/
   `QUOTA_MANAGE`.
2. **Offline write support is a real, working IndexedDB queue with online-event flush and
   ordered replay — not the Background Sync API.** Browser support for Background Sync remains
   inconsistent (notably absent in Safari/iOS); a same-tab `online`-event listener plus a manual
   "Sync Now" fallback is simpler, universally supported, and matches this codebase's existing
   "retry with the same operationId" level of sophistication for offline handling (POS's own
   OFFLINE-02/05/07 don't use Background Sync either).
3. **GPS is best-effort, not required.** A rep who denies location permission, is on a device
   without GPS, or is indoors with a bad fix can still check in/out with null coordinates — the
   roadmap's own spec never says a visit without GPS should be rejected, and rejecting one would
   block a rep's actual job over a UX/hardware limitation outside their control.
4. **No route-stop "skip" action shipped in the UI this pass** — the `SKIPPED` stop status exists
   in the schema/type but nothing sets it yet; a rep who can't complete a stop simply leaves it
   `PENDING`. Flagged as a small, easy follow-up, not silently dropped.

## Testing performed this session

- `pnpm --filter @erp/db build` / `@erp/types build` — clean, after schema/permission additions.
- Both migrations live-applied directly to the local dev Postgres (same `db:migrate`-is-broken
  caveat as every other feature shipped this session).
- Type-check clean on `sales-service` and `web-frontend`.
- **New tests, all passing**:
  - `field-visit-service.test.ts` (7) — route creation + identity-scoped listing (own vs.
    tenant-wide), `setStops` replace-all + `getRouteProgress` resolving customer names,
    `logVisit` marking a linked stop `VISITED`, idempotent `logVisit` (a retried
    `clientOperationId` returns the original visit, confirmed via direct DB row count — not a
    duplicate), `checkOut` success for the visit's own rep, `checkOut` 404 (not 403) for a
    different rep, `listVisits` scoping.
  - `field-visit-permission-guard.test.ts` (4) — `ROUTE_MANAGE`/`FIELD_VISIT_MANAGE` gating,
    401 with no token.
  - `offlineVisitQueue.test.ts` (6, using `fake-indexeddb` — added as a new, dev-only, already-
    present-in-the-pnpm-store dependency) — immediate success bypasses the queue entirely, a
    network failure queues the action, the token is read fresh at send time (not captured), a
    queued action is replayed and removed once the server accepts it, a still-offline flush
    leaves the action queued, a 5xx response also leaves it queued (not silently dropped as
    delivered).
- **A real, incidental Feature 8 gap found and fixed while testing this feature**:
  `route-guard-coverage.test.ts` (the repo's self-defending unguarded-route scanner) flagged all
  four `public-api.routes.ts` routes from Feature 8 as unguarded — `requirePublicApiScope(` was
  never added to the scanner's `GUARD_MARKERS` list when that feature shipped, the same gap class
  `requirePortalAuth` hit for the Customer Portal. Fixed by adding it, documented with the same
  "genuinely new guard pattern, present in coverage not `KNOWN_EXCEPTIONS`" comment style as the
  portal precedent. The other 7 failures this scanner reports (`notification-service`'s template
  routes, `tenant-service`'s organization-logo route) are confirmed pre-existing and unrelated —
  neither file was touched by this feature or Feature 8 (verified via `git status`).
- **Full regression sweep** (run sequentially, one suite at a time, per the lesson from earlier
  this session): `sales-service` (536/581 — the 45 failures are the exact same 13 pre-existing
  JWT-issuer-test-debt files this session's every prior sweep has hit, confirmed identical file-
  by-file to the immediately-prior Feature 8 sweep, i.e. zero new failures introduced), `tenant-
service` (61/61 — one run hit an unrelated 3-minute environment timeout, a clean retry passed
  immediately), `web-frontend` (442/442, +8 over the pre-feature baseline: the 6 new
  `offlineVisitQueue` tests plus 2 new nav-entry assertions), `@erp/types` (`dead-permission-
constants` clean; `route-guard-coverage` at its corrected baseline of 7 pre-existing failures,
  down from 11 before this feature's fix).
- `pnpm --filter @erp/sales-service lint` / `@erp/web-frontend lint` — both at their pre-existing
  error-count baseline (2, 16) after fixing one genuine new lint error this feature introduced
  (`FieldVisitService.ts` imported `ValidationError` but never used it).

## What is not done (remaining TODO)

| Item                                                                                        | Why deferred                                                                                                                            | Target                                            |
| ------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| A "skip this stop" action in the UI                                                         | Schema/type support the `SKIPPED` status; no route wires it yet                                                                         | Small follow-up                                   |
| Manager-hierarchy-scoped visibility (a manager sees only their direct reports' visits)      | No manager-hierarchy concept exists anywhere in this codebase                                                                           | Only if org-structure needs it                    |
| Route reordering (drag-and-drop stop sequence)                                              | `sequenceNumber` is set at add-time only; reordering would replace-all via `setStops` already, but no dedicated UI affordance was built | Follow-up if reps need it                         |
| Background Sync API / service-worker-driven flush (vs. this pass's same-tab `online`-event) | Inconsistent browser support; same-tab flush + manual button is simpler and universally supported                                       | Only if real field feedback shows the gap matters |
| Playwright E2E coverage                                                                     | Not run this session                                                                                                                    | Follow-up                                         |

## Deployment Checklist

- [ ] Apply migrations `0144_crm_field_sales.sql` and
      `0145_crm_field_sales_permission_backfill.sql` to every real tenant's database — same
      `db:migrate`-is-broken caveat as every other feature shipped this session; apply the SQL
      files directly if the migrate CLI still doesn't work by then.
- [ ] `pnpm install` (or equivalent) in any CI/deploy pipeline that caches `node_modules` — this
      feature added `fake-indexeddb` as a new `web-frontend` devDependency.
