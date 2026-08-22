# 23 — GUC-Per-Request Rollout Checklist

Phase 9 (`13-security-architecture.md` §2 step 1) — the "GUC-per-request gap" fix. Piloted and
live-verified 2026-08-21 on `production-service`'s `bom.routes.ts` only. This doc records what the
fix is, why it's shaped the way it is (including a dead end), and the checklist for migrating each
remaining route file.

## The gap

`app.current_tenant_id` (the GUC RLS policies would key off) was only ever set inside an explicit
`TenantScopedDatabase.transaction()` call — never for the far more common `ctx.db.raw.select()...`
path almost every route actually uses. Enabling RLS today would see it unset/stale for most
queries (`ES-36_COMPLETION.md`).

## Why this isn't a `pool.on('connect', ...)`-style fix

postgres-js pools connections per top-level query — a session GUC set on one query has no
guaranteed relationship to which physical connection serves the next one. Two approaches were
tried:

1. **`sql.reserve()`** — pin one physical connection for a request's lifetime, set the GUC once,
   release afterward via Fastify `onResponse`/`onError` hooks. **Dead end**, confirmed empirically
   in this session: a reserved connection is a stripped-down `Sql` instance with no `.begin()` —
   only plain queries. drizzle-orm's own `.transaction()` unconditionally calls `client.begin(...)`,
   so any domain service that opens a transaction against a reserved connection (most of them —
   e.g. `BOMService.create()`) throws `this.client.begin is not a function`. A reserved connection
   cannot be handed to `drizzle()` and still support nested transactions.
2. **`ErpDatabase.transaction()`** (the pool-level `.begin()`, already used by
   `TenantScopedDatabase.transaction()` today) — this is the one that works. `set_config(...,
true)` (`SET LOCAL`) auto-reverts at commit/rollback, and drizzle's own class-switching
   (`PostgresJsSession` → `PostgresJsTransaction`) makes a nested `.transaction()` call from inside
   resolve to a `SAVEPOINT` automatically — exactly what `BOMService.create()` needs, with zero
   changes to any domain service.

The real cost of option 2: the request's entire DB-touching body must run **inside** the
transaction callback — postgres-js's `.begin()` only stays open for the callback's lifetime, so
there's no "prepare in a preHandler, release in onResponse" shape available the way a reserved
connection would have allowed. This is why the fix is a **per-handler wrapper**
(`tenantScopedHandler` in `@erp/sdk`), not a global Fastify hook pair.

## What shipped (`packages/platform-sdk/src/`)

- `tenantConnection.ts` — `withTenantConnection(pooledDb, tenantId, fn)`: wraps `fn` in
  `pooledDb.transaction()`, sets the GUC first via `SET LOCAL`.
- `fastify-tenant-connection.ts` — `tenantScopedHandler(ctxFactory, handler)`: returns a Fastify
  handler that resolves `request.auth` (must already be set — register after `authenticate`),
  calls `withTenantConnection`, builds a `PlatformContext` from the scoped connection via
  `ctxFactory.create(tenant, scopedDb)` (the `create()` signature grew an optional `dbOverride`
  param for exactly this, fully backward compatible — every existing call site is unaffected).
- Tests: `platform-sdk/src/__tests__/tenantConnection.test.ts` (real Postgres — concurrent
  isolation, auto-revert-on-commit, rollback-on-throw, and the nested-transaction-as-savepoint
  proof that would have caught the `.reserve()` dead end immediately).

## Migrating a route file — checklist

1. **Check which pattern this service uses first.** Most services have a `PlatformContextFactory`
   (`main.ts` constructs one, route files take `ctxFactory` and call `ctxFactory.create({...})`
   per request) — these use `tenantScopedHandler(ctxFactory, async (req, reply, ctx) => {...})`,
   replacing any `ctxFactory.create({...})` call with the `ctx` parameter now provided (`ctx.
tenant.tenantId`/`ctx.tenant.userId` replace `req.auth.tenantId`/`req.auth.userId`). Some
   services (found in `ai-copilot-service`) have no `PlatformContextFactory` at all — `main.ts`
   passes a plain pool-level `db: ErpDatabase` straight to the route file. For those, call
   `withTenantConnection(db, req.auth.tenantId, (scopedDb) => {...})` directly around just the DB
   work, per call site — there's no `ctx` to build.
2. No `main.ts` changes needed either way — neither wrapper is a Fastify hook, so both compose
   with whatever route-group registration already exists.
   2b. **`fastify.get<{ Params: {...} }>(...)` route generics stop narrowing `request.params` once
   the handler is `tenantScopedHandler(ctxFactory, async (request, reply, ctx) => {...})`** —
   `tenantScopedHandler`'s own signature is a plain, non-generic `FastifyRequest`, so
   `request.params` types as `unknown` inside the callback regardless of the route's own generic.
   Cast manually — `const { id } = request.params as { id: string };` — matching the convention
   every un-migrated route file in this codebase already uses anyway (none of them relied on the
   Fastify generic for real type safety even before this rollout).
3. **Check for independently-committed writes before migrating**: does this route file do several
   writes where a later failure should NOT roll back an earlier one (e.g. "log an audit entry
   regardless of whether the main operation later fails")? If yes, that pattern needs to move
   outside the wrapped body (or migration deferred) — under this fix, everything inside the
   wrapped body now commits or rolls back as one unit.
4. **Check for external I/O mid-handler — found in `ai-copilot-service`, a new caveat class,
   possibly worse than #3.** Does the handler make a real network call to something slow/external
   (LLM completion, payment gateway, webhook/email/SMS send) _interleaved_ with its own DB reads/
   writes, not just before/after them? If yes, do **not** wrap the whole handler — that would
   hold a Postgres transaction (and its connection) open for the external call's entire duration,
   risking connection-pool exhaustion and lock contention under load. `copilot.routes.ts`'s two
   GET routes (pure reads) were migrated; its POST route (`orchestrator.sendMessage()`, an
   agentic Claude tool-use loop with DB calls before/after/between API round-trips) was
   deliberately left on the plain pool connection — closing the gap there correctly needs each
   individual short DB call scoped on its own, not the whole request, which is its own follow-up
   design task, not something to force into this rollout pass. Watch for the same shape in any
   route touching notification-service (SMS/WhatsApp/email sends), tenant-service's billing
   routes (Razorpay calls), or webhook-receiving routes generally.
   4b. **`ctx.audit.log()` (or any other side-effect call) issued AFTER the main service call, in the
   route handler itself — found in `accounting-service`, very common there.** First flagged as a
   blocker (a service's own `db.transaction()` call looked like it committed independently before
   the route's subsequent `ctx.audit.log()` ran) — **investigated further and it is not actually
   a problem**, confirmed empirically in `platform-sdk/src/__tests__/tenantConnection-nested-
rollback.test.ts`: once the whole handler is wrapped (via `tenantScopedHandler`/
   `withTenantConnection`), any nested `db.transaction()` call a domain service makes becomes a
   SAVEPOINT of the _outer_ transaction, not an independent commit — it only becomes durable when
   the outer transaction itself commits, i.e. when the whole handler returns without throwing.
   Since `ctx.audit.log()` (built from the same scoped `ctx.db`) runs inside that same outer
   transaction too, "the operation and its audit log succeed or fail together" is exactly what
   migrating to `tenantScopedHandler` already gives you, automatically — no domain-service or
   `PlatformAuditLogger` changes needed. **Migrate these routes normally, same as any other.** (A
   real caveat still exists in the opposite direction: DON'T mix an unmigrated route calling a
   service's `.transaction()` directly against the pool with an assumption that it behaves
   identically to the migrated case — the durability timing is genuinely different pre- vs.
   post-migration, which is exactly why this needed proving rather than assuming.)
   4c. **A call that looks like external I/O but is fire-and-forget (not awaited by its caller) is
   safe to migrate — found in `sales-service/customer.routes.ts`'s `sendPortalInviteEmail()`.**
   It calls `fetch(...).catch(...)` but returns `void` synchronously and its caller never `await`s
   it — the route (and its wrapping transaction) returns/commits without waiting on the network
   round trip, so there's no held-open connection. This is different from caveat 4's failure mode,
   where the handler itself `await`s the external call. Check whether the call is actually awaited
   before assuming it needs to stay unmigrated.
   4d. **Object-storage calls (`PlatformAttachments`/`StorageClient.uploadFile()`/`deleteFile()`/
   `getSignedUrl()`) are the same caveat-4 shape even though the "external" system is S3/MinIO, not
   another microservice — found in every service's `attachment.routes.ts`.** `upload()` calls
   `storage.uploadFile()` before its own DB insert; `delete()` calls `storage.deleteFile()` before
   its DB delete — both interleaved with DB work. Leave these routes unmigrated, same as any other
   caveat-4 case.
   4e. **Cross-tenant scheduler-driven batch jobs don't fit this wrapper at all — found in
   `sales-service/internal.routes.ts`.** Routes that loop `for (const tenant of activeTenants)` (or
   have no tenant scope at all, e.g. an UPDATE with no tenant filter) can't be wrapped by
   `tenantScopedHandler`/`withTenantConnection`, which both assume one tenantId for the whole
   request. Properly closing the GUC gap here means a per-iteration `withTenantConnection` call
   inside the loop — a bigger redesign than this rollout's per-route swap. Leave the whole file
   unmigrated with this reasoning noted, don't try to force-fit it.
   4f. **A public route with no tenant known up front doesn't always mean "leave it unmigrated" —
   it depends on WHERE the tenant gets resolved.** If the route itself does the lookup (e.g.
   `crm-service/link-tracking.routes.ts`: `ctxFactory.rawDb.select()...where(eq(trackingToken,
...))`), the gap still closes cleanly — do the unscoped lookup first, then wrap only the
   follow-up writes in `withTenantConnection(ctxFactory.rawDb, row.tenantId, ...)` once the tenant
   is known. But if the lookup-then-write happens _inside_ a domain-service method that takes a
   plain `db` and does its own multi-step work internally (`ReferralService.redeem()`,
   `CallService.handleStatusCallback()` in `crm-service/referral-public.routes.ts` and
   `inbound-webhooks.routes.ts`), there's no discrete route-level query to wrap — closing the gap
   means restructuring the service method to separate "resolve tenant" from "do the scoped work,"
   a service-level design change, not a route-file swap. Also watch for batch payloads that can
   span more than one resolved tenant within a single request (some of `inbound-webhooks.routes.ts`'s
   Meta-webhook handlers loop over `entry[]` generically) — same as caveat 4e, one tenantId can't
   cover the whole handler then. Leave these unmigrated with the specific reason noted.
   4g. **A route with DB work on BOTH sides of a fetch() (a read before, a write after) doesn't have
   to stay fully unmigrated — split it into two separate `withTenantConnection`/
   `tenantScopedHandler`-adjacent calls, with the fetch() strictly between them — found in
   `purchase-service/internal.routes.ts`.** Each wrap sets its own GUC and commits independently;
   neither one holds a connection open across the network call, so this doesn't reintroduce
   caveat 4's connection-pool-exhaustion risk. `/purchase/pdc-alerts`: wrap #1 reads the due PDCs
   - tenant contact email, fetch runs after, wrap #2 (only entered if the fetch was attempted)
     marks the PDCs alerted. Where the "read" side turns out to be a per-iteration loop of read-
     then-fetch (`/purchase/po-delivery-reminders/send`: originally one supplier lookup right
     before each per-PO fetch), restructure it to batch all the reads into one wrap upfront (e.g.
     fetch every needed supplier row via a single `inArray(...)` query, build a lookup map) so the
     loop that follows is pure fetches with zero interleaved DB work — cleaner than alternating
     wrap/fetch/wrap/fetch per iteration. If a route only has DB reads before the fetch and nothing
     after it, one wrap suffices (existing caveat 4b/5b shape) — this caveat only applies when
     there's real post-fetch DB work to close the gap on too.
5. Mocked route-authz tests: fake `ctxFactory.rawDb` (needs `.transaction(cb)` and `.execute(...)`
   — see `bom-routes-authz.test.ts`'s `makeFakeDb()`) and `ctxFactory.create()` (the returned ctx
   needs a `.tenant: { tenantId, userId, correlationId }` too, once any route reads
   `ctx.tenant.*` — found missing in `pos-capability.test.ts`'s `makeCtxFactory()`, which threw a
   500 until fixed), and mock drizzle-orm's `sql` export too (not just `eq`/`and`/etc.) since
   `withTenantConnection` imports it internally and a per-file `vi.mock('drizzle-orm', ...)`
   replaces the module for every importer, not just the test's own direct imports. For files with
   no `PlatformContextFactory`, fake the plain `db` object the same way instead.
   5b. **Internal-key-guarded routes (`checkInternalKey` preHandler, called by scheduler-service —
   e.g. `accounting-service/scheduler-internal.routes.ts`) have no `req.auth` at all**, so
   `tenantScopedHandler` doesn't apply — `tenantId` comes from a query param instead. Use
   `withTenantConnection(ctxFactory.rawDb, tenantId, ...)` directly, same as the no-
   `PlatformContextFactory` services. These routes are also where external-I/O-mid-handler shows
   up again (e.g. a bank-reconciliation reminder route `fetch()`-es notification-service inside a
   per-account loop) — check case 4 above just as carefully here.
6. Rebuild the service's dist, restart the live process (services here run compiled `dist/main.js`,
   not `tsx watch` — see `backend_services_run_from_dist_not_watch` memory; **check the actually-
   running process's command line first** — `inventory-service` this session turned out to be
   running via `tsx` directly against `src/main.ts`, not `dist/main.js`, so it was restarted the
   same way rather than force-fit to the dist convention), live-verify: exercise every route in
   the file via curl through the gateway, then fire ~20 requests and confirm `pg_stat_activity`
   count doesn't creep up (connection-leak check). **Gateway path gotcha, recurs almost every
   service**: the client-facing gateway prefix is `/api/<service-short-name>` (e.g.
   `/api/inventory/...`, `/api/crm/...`), which the gateway then rewrites to `/api/v2` (or
   unprefixed, per that service's `apiV2` flag in `api-gateway/src/config.ts`) before forwarding
   upstream — `/api/v2/...` is the _upstream's own_ internal path, never the gateway-facing one.
   Check `api-gateway/src/config.ts`'s `UPSTREAM_DEFAULTS` before guessing either prefix.

## Progress

- **`production-service` — 100% done.** `bom.routes.ts` (pilot), `reorder.routes.ts`,
  `job-work.routes.ts`, `barcode.routes.ts`, `consignment.routes.ts` all migrated 2026-08-21.
  New authz tests for every route family (`job-work-routes-authz.test.ts`,
  `barcode-routes-authz.test.ts`, `consignment-routes-authz.test.ts`, `reorder-routes-authz.test.ts`
  — 104 tests total). Rebuilt, restarted, live-verified against a real tenant (reorder-required →
  create-pos flow), `pg_stat_activity` stayed flat across repeated requests.
- **`ai-copilot-service` — partial.** No `PlatformContextFactory` (plain `db` passed) — migrated
  the two `GET /copilot/conversations*` routes via `withTenantConnection` directly. Left
  `POST /copilot/conversations/:id/messages` unmigrated — calls `orchestrator.sendMessage()`, an
  agentic Claude tool-use loop with DB calls interleaved between API round-trips (caveat 4).
- **`automation-service` — partial.** Same no-ctxFactory pattern — migrated all
  `/automation/definitions*` CRUD + `/history`. Left `POST .../trigger` and
  `POST /automation/webhook/:id` unmigrated — both call `WorkflowEngine.execute()`, which can send
  notifications and has DELAY nodes (caveat 4).
- **`accounting-service` — 100% done, 2026-08-21 (all 12 route files).** `financial-year.routes.ts`,
  `cost-centers.routes.ts`, `tds.routes.ts`, `posting-matrix.routes.ts`, `bank.routes.ts`,
  `fixed-assets.routes.ts`, `journal.routes.ts`, `accounts.routes.ts`,
  `search-sync.internal.routes.ts` (internal-key-guarded, caveat 5b) all fully migrated —
  post-hoc `ctx.audit.log()` calls proved safe here (see caveat 4b's rewrite, backed by
  `tenantConnection-nested-rollback.test.ts`). `reports.routes.ts` migrated except
  `GET /reports/profit-loss/pdf` (fetches report-service, caveat 4).
  **The 2 previously-deferred files are now done too**: `opening-balances.routes.ts` — the
  earlier deferral was purely time/effort economics (7 near-identical routes), never a real
  caveat blocker — no external I/O anywhere in the file; migrated all 7 routes, the lock route's
  `ctx.db.transaction()` call becomes a savepoint of the outer transaction as usual.
  `scheduler-internal.routes.ts` — 4 of 5 routes are genuinely single-tenant with no external
  I/O and migrated via `withTenantConnection(ctxFactory.rawDb, tenantId, ...)` (caveat 5b);
  `POST /internal/bank-reconciliation/reminder` has a notification-service `fetch()` but it runs
  strictly _after_ the per-account DB read/compute loop finishes (not interleaved with more DB
  writes), so only that read/compute portion is wrapped — the notification call itself stays
  outside the transaction, same shape as `crm-service`'s `sla-breach-sweep` route.
  Found and fixed one more instance of the mocked-`ctxFactory` regression:
  `financial-year-auto-seed.test.ts` (missing `.rawDb`/`.transaction()`/`.execute()` — 3 tests
  went from 200/200/200 to 500/500/"spy not called" until fixed). Full suite re-run clean
  afterward — the only 5 remaining failures (2 in `permission-guards.test.ts`, 3 in
  `opening-balances-lock.test.ts`) are the already-documented pre-existing JWT-issuer-class bug,
  reconfirmed via git-stash-revert-and-rerun (identical failures with both migrated files fully
  reverted). Rebuilt, restarted, live-verified against tenant 2 through the gateway/direct:
  `GET /opening-balances/status` (real in-progress wizard data — deliberately did NOT run the
  write routes against this shared QA tenant's real staging data) and all 4 internal scheduler
  routes directly against the service (`trial-balance-snapshot`, `bank-reconciliation/reminder`,
  `financial-years/seed` — correctly no-op'd since tenant 2 already has one, and
  `fixed-assets/depreciation/run`). `pg_stat_activity` stable (9 → 9) across repeated requests.
- **`sales-service` — 2 of 21 route files done, 2026-08-21.** `quotation.routes.ts` — all routes
  migrated except `POST /quotations/:id/send` (`QuotationNotificationService.notifyQuotationSent()`
  fetches notification-service, caveat 4). `invoice.routes.ts` — all routes migrated except
  `POST /invoices/:id/confirm` (`InvoiceNotificationService.notifyInvoiceConfirmed()`, same fetch
  caveat) and `GET /invoices/:id/pdf` (fetches report-service, same shape as accounting's PDF
  route). Both files' 9 pre-existing test failures (401-vs-403/202, the same
  `issuer: 'erp-test'`-mismatch class documented in `preexisting_jwt_issuer_test_bug`) confirmed
  unrelated via git-stash-revert-and-rerun — identical failures with the changes fully reverted,
  and the same failure shape recurs in totally untouched files (`customer-block-unblock.test.ts`,
  `pos-branch-isolation.test.ts`, `sync-routes.test.ts`, etc.) in the same full-suite run. Rebuilt,
  restarted, live-verified against tenant 2 (QA E2E Test Co): quotation
  list/create/get/send/accept/reject/convert/expire and invoice list/create/get/activity/
  duplicate/cancel all exercised live through the gateway; `pg_stat_activity` peaked transiently at
  28 during a 160-request burst then settled back to 11 (pool reuse, not a leak). Test data cleaned
  up.
  **+ 6 more files done same day**: `dashboard.routes.ts`, `sync.routes.ts` (OFFLINE-04, no
  external I/O, pure reads), `loyalty.routes.ts` (POS-redeem routes only — the 6 admin/read routes
  live in crm-service post-split; `LoyaltyService.redeemPoints()/redeemCatalogItem()` have no
  fetch() calls), `commission.routes.ts` (`CommissionService` has no fetch() calls),
  `day-end.routes.ts` (`DayEndSettlementService.generate()/list()` have no fetch() calls; post-hoc
  `ctx.audit.log()` on the generate route is safe per caveat 4b), `search-sync.internal.routes.ts`
  (internal-key-guarded, caveat 5b — `withTenantConnection` directly, tenantId from query string,
  same shape as accounting-service's copy of this file). All rebuilt/restarted/live-verified
  against tenant 2 through the gateway (dashboard summary, sync/customers, commission-plans
  create+list, commissions/mine, commission-assignments, day-end — got a clean 403 from a missing
  POS_ZREPORT_VIEW/capability gate rather than an error, confirming the route itself wires
  correctly even though this tenant's role doesn't hold that permission — and the internal
  search-sync route on its actual `/api/v2/internal/search-sync/:entity` path). `pg_stat_activity`
  stable (10 → 9) across 60 additional requests. Test data cleaned up.
  **+ remaining 13 files done same day, `sales-service` now 100% reviewed.**
  `promotion.routes.ts`, `delivery-challan.routes.ts`, `sale-return.routes.ts`,
  `integrations.routes.ts` (subscription CRUD only — actual webhook dispatch is a different
  service), `supplier.routes.ts`, `crm.routes.ts` (also closed a pre-existing gap: `GET
/crm/whatsapp-orders` previously queried `ctxFactory.rawDb` directly with no tenant-scoped
  connection at all), and `customer.routes.ts` fully migrated — no external I/O anywhere in any of
  them (`sendPortalInviteEmail()` in `customer.routes.ts` is fire-and-forget, caveat 4c).
  `payment.routes.ts` migrated except `POST /payments` (`PaymentNotificationService
.notifyPaymentReceived()` fetches notification-service, caveat 4). `pos.routes.ts` migrated
  except `POST /pos/sales` and `POST /pos/sales/:id/send-receipt` —
  `/pos/sales`'s catch-all failure branch deliberately calls `svc.cancel()` then re-throws
  (OFFLINE-07's "void the orphaned DRAFT so retries aren't blocked" must survive the overall
  request failing); wrapping it would make the final re-throw roll the cancel back too — genuine
  caveat 3, not caveat 4, and the most important single case this rollout has found so far.
  `send-receipt` fetches notification-service after its own DB reads (caveat 4).
  `attachment.routes.ts` and `customer-360.routes.ts` deliberately left fully unmigrated
  (`PlatformAttachments`/`StorageClient` object-storage calls, caveat 4d; `crm-service`
  fetch()-backed composition routes, caveat 4). `internal.routes.ts` deliberately left fully
  unmigrated — cross-tenant scheduler-driven batch jobs, caveat 4e, doesn't fit this wrapper at
  all. `portal.routes.ts` — no `PlatformContextFactory` (identity from `request.portalAuth`, not
  `req.auth`) — migrated via `withTenantConnection` directly, all routes except `GET
/portal/loyalty` (fetches crm-service, caveat 4).
  Found and fixed a real regression during this batch: `pos-capability.test.ts`'s mocked
  `ctxFactory` had no `.transaction()`/`.execute()` on `rawDb` and no `.tenant` on the returned
  `ctx` — both now required once `GET /pos/sessions/active` uses `tenantScopedHandler` — caused a
  500 instead of 200 until fixed (now documented as caveat 5's `.tenant` addendum). Full suite
  re-run after the fix: 28 failures/166 passing, byte-identical to the pre-this-session baseline —
  zero net regressions across the whole service. Rebuilt, restarted, live-verified against tenant
  2 through the gateway: customers (list/get/statement/activity/preferences), suppliers
  (list/create), sale-returns/delivery-challans (list/create), promotions (clean 403 —
  PROMOTION_VIEW gap in this tenant's role config, not a bug), integrations/crm/payments (list),
  full POS session lifecycle (open/active/summary/close), held-sales (create/list/resume), quick-
  items/item-search/lookup-filters/customer-search/upi-vpa, and the unmigrated `POST /pos/sales`
  itself (a real sale end-to-end: invoice created+confirmed, payment allocated, correct GST
  total). `pg_stat_activity` stable (8-14 range, no creep) across ~140 additional requests this
  batch. All test data cleaned up. **Every one of `sales-service`'s 22 route files has now been
  reviewed against this checklist — 0 files skipped, each either migrated or documented with a
  specific caveat.**

- **`crm-service` — 100% reviewed, 2026-08-21 (all 23 route files).** Fully migrated (no external
  I/O anywhere in the file): `health-scoring.routes.ts`, `api-key.routes.ts`,
  `crm-dashboard.routes.ts`, `festival-intelligence.routes.ts`, `territory.routes.ts`,
  `dlt-template.routes.ts`, `quota.routes.ts`, `field-visit.routes.ts`, `ticket.routes.ts`,
  `account.routes.ts`, `opportunity.routes.ts` (markWon's OPPORTUNITY_WON/QUOTATION_CREATED events
  are outbox rows, not a synchronous call). **Partially migrated** (one or two routes left on the
  old pattern, everything else moved): `call.routes.ts` (`POST /calls/initiate` fetches Twilio's
  REST API), `conversation.routes.ts` (`POST /conversations/:id/messages` awaits a real fetch to
  notification-service), `internal.routes.ts` (4 genuinely single-tenant routes migrated via
  `withTenantConnection` — including `GET /internal/customers/:id/health-predictions`,
  `POST /internal/recommendations/:id/feedback`, `GET /internal/customers/:id/loyalty-balance`,
  and `POST /crm/tickets/sla-breach-sweep` whose notification loop runs strictly after its DB
  work completes — everything else in the file is a cross-tenant scheduler batch job, caveat 4e),
  `lead.routes.ts` (`POST /leads/:id/convert` awaits a real fetch inside
  `LeadService.convertToCustomer()`; `POST /leads/capture` is public but its tenantId is known
  upfront from the request body, so it uses `withTenantConnection` directly rather than
  `tenantScopedHandler`; `POST /leads/:id/assign`'s notification is fire-and-forget via `void`,
  caveat 4c, so it migrated cleanly), `campaign.routes.ts` (`POST /crm/campaigns/:id/send` awaits
  a real fetch per recipient inside `CampaignService.send()` — every other `CampaignService`
  method used here takes a full `ctx: PlatformContext` already, so the `tenantScopedHandler`-
  provided `ctx` passes straight through unchanged). `link-tracking.routes.ts` — properly closed
  the gap despite the tenant being unknown up front: does an unscoped lookup by trackingToken via
  `ctxFactory.rawDb`, then scopes the follow-up click/open writes with
  `withTenantConnection(ctxFactory.rawDb, row.tenantId, ...)` once the tenant is known.
  `public-api.routes.ts` — no `PlatformContextFactory` (per-tenant API-key auth); all 4 read
  routes wrapped in `withTenantConnection` once `requirePublicApiScope`'s preHandler resolves the
  tenant. **Deliberately left fully unmigrated**: `referral-public.routes.ts` and
  `inbound-webhooks.routes.ts` — new caveat class (4f): unlike `link-tracking.routes.ts`, the
  tenant-resolving lookup lives _inside_ a domain-service method that takes a plain `db` and does
  its own multi-step lookup+write internally (`ReferralService.redeem()`,
  `CallService.handleStatusCallback()`), and/or a batch payload can in principle span more than
  one tenant within a single request — closing the gap there means restructuring those service
  methods to separate "resolve tenant" from "do the scoped work," a service-level design change,
  not a route-file swap.
  Found and fixed 3 real regressions from this batch's mocked-`ctxFactory` test files (same class
  as `pos-capability.test.ts` before it): `dlt-template-routes.test.ts` and
  `api-key-routes-permission-guard.test.ts` (missing `.tenant` on the returned ctx, missing
  `.rawDb`/`.transaction()`/`.execute()`, and — for `dlt-template-routes.test.ts` specifically —
  a `vi.mock('drizzle-orm', ...)` that didn't include `sql`, which `withTenantConnection` imports
  internally) and `crm-dashboard-permission-guards.test.ts` (same `.tenant`/`.rawDb` gap). All
  fixed; full suite re-run clean afterward (130 passing, 0 failures, up from 122 before this
  batch's fixes). Rebuilt, restarted, live-verified against tenant 2 through the gateway: ~25 GET
  routes across every route file family (health-scoring, api-keys, calls, dashboard, festival-
  suggestions, referrals, dlt-templates, territories, quotas, conversations, journeys,
  visit-routes, tickets [clean 403 — permission gap, not a bug], accounts [same], pipeline-stages,
  opportunities, leads, lead-assignment-rules, segments, campaigns, campaign-templates,
  automation-rules, roi-report, birthday-stats), real writes (lead/territory/opportunity create),
  and the public `POST /api/v2/leads/capture` route (confirmed working directly against
  crm-service — a gateway-path 401 in an early curl attempt was a wrong-URL mistake on my part,
  not a real regression). `pg_stat_activity` stable (17 → 9) across ~45 additional requests. All
  test data cleaned up.

- **`inventory-service` — 100% reviewed, 2026-08-21 (all 15 route files).** Fully migrated (no
  external I/O anywhere in the file): `unit.routes.ts`, `fabric-roll.routes.ts`, `brand.routes.ts`,
  `category.routes.ts`, `sync.routes.ts`, `valuation.routes.ts`, `physical-verification.routes.ts`,
  `adjustment.routes.ts` (the new `assertAdjustmentInScope` helper mirrors
  `assertVerificationInScope`'s lookup-then-scope pattern; the approve route's pre-existing
  STOCK_ADJUST_APPROVE high-value-approval gate carried over unchanged),
  `warehouse.routes.ts`, `stock.routes.ts` (4 of 6 routes — see below), `transfer.routes.ts`,
  `item.routes.ts` (all 10 routes, including `PUT /items/:id`'s `ctx.db.transaction()` call for
  the items-history archive row, which becomes a savepoint of the outer transaction per caveat 4b).
  **Partially migrated**: `reservation.routes.ts` (create/list/release migrated;
  `POST /inventory/reservations/expire` left unmigrated — `ReservationEngine.expireStale()` has
  no tenant filter at all, a genuine caveat-4e cross-tenant batch job). `stock.routes.ts` — the 4
  authenticated routes (list stock, stock-by-item, ledger, near-expiry-stock) migrated;
  `POST /inventory/reconcile` and `POST /inventory/near-expiry-alert` deliberately left
  unmigrated — both are internal-key-guarded scheduler triggers whose `runReconciliation`/
  `runNearExpiryAlert` job functions query and group by tenant_id across **every** tenant in one
  call, the same caveat-4e shape as `sales-service/internal.routes.ts`. `internal.routes.ts` — 2
  of 3 routes (`POST /internal/ledger`, `POST /internal/inventory/valuation-snapshot`) are
  genuinely single-tenant and migrated via `withTenantConnection(ctxFactory.rawDb, tenantId, ...)`
  (caveat 5b); `POST /internal/inventory/physical-verification-reminder` wraps only its DB read of
  the tenant's contact email, with the notification-service `fetch()` running after, same shape as
  `accounting-service`'s bank-reconciliation-reminder route.
  `search-sync.internal.routes.ts` — fully migrated via `withTenantConnection` (internal-key-
  guarded, caveat 5b), covering all 8 entities this service owns (`item`/`category`/`brand`/
  `unit`/`warehouse`/`stock_transfer`/`stock_adjustment`/`stock`).
  No mocked-`ctxFactory` test regressions found in this service — full suite re-run showed the
  exact same 5 failed files / 19 failed pre-existing tests both before and after migration (one
  test flipped from fail to pass between runs, not attributable to the migration), confirmed via
  git-stash-revert-and-rerun; these are the same JWT-issuer-class pre-existing bug documented
  elsewhere in this rollout. Typecheck/lint clean (the 3 lint errors present are pre-existing,
  confirmed untouched via `git status` on `jobs/reconciliation.job.ts`). Rebuilt, restarted (this
  service runs via `tsx` directly against `src/main.ts`, not compiled `dist/main.js` — differs from
  the `dist`-based restart convention used for the other 3 services so far), live-verified against
  tenant 2 through the gateway (`/api/inventory/...` — this service's gateway-facing prefix, NOT
  `/api/v2`, which is only the upstream-side rewrite target): warehouses/items/stock/stock-
  transfers/stock-adjustments/physical-verifications/valuation/units/brands/categories/near-
  expiry-stock all 200, a real `POST /units` write committed and was cleaned up afterward, and all
  4 internal-key-guarded routes directly against the service on their real
  `/api/v2/internal/...` paths (search-sync item + stock entities, valuation-snapshot,
  physical-verification-reminder) all returned real data. `pg_stat_activity` stable at 10 across
  30 additional requests.

- **`purchase-service` — 100% reviewed, 2026-08-21 (all 13 route files).** Fully migrated (no
  external I/O anywhere in the file): `dashboard.routes.ts`, `landed-cost.routes.ts`,
  `purchase-invoice.routes.ts`, `rfq.routes.ts`, `requisition.routes.ts`, `expense.routes.ts`,
  `grn.routes.ts`, `purchase-return.routes.ts`. `search-sync.internal.routes.ts` — fully migrated
  via `withTenantConnection` (internal-key-guarded, caveat 5b), covering all 4 entities this
  service owns (`purchase_order`/`grn`/`purchase_return`/`payment`).
  `internal.routes.ts` — all 3 routes interleave a notification-service fetch() with DB work on
  both sides (a read before, a write after, or both) — new pattern for this rollout: each route
  restructured into **two separate `withTenantConnection` calls** (one for the pre-fetch read,
  one for the post-fetch write), with the fetch() itself running strictly between them, never
  inside either transaction. `/purchase/pdc-alerts`: read due PDCs + tenant email in wrap #1,
  fetch, then mark-alerted writes in wrap #2 (preserves the existing "only mark alerted if a send
  was attempted" semantics). `/purchase/po-delivery-reminders/send`: restructured to batch-read
  pending POs + all their suppliers' emails in one wrap upfront (no per-iteration DB read
  anymore), then loop fetches with zero DB work interleaved — the cleanest possible shape.
  `/purchase/pending-grn-alerts/run`: read-only before the fetch, no post-fetch write, so a single
  wrap suffices (same shape as accounting's bank-reconciliation-reminder).
  `purchase-order.routes.ts` and `supplier-payment.routes.ts` — all routes migrated except their
  respective `GET .../:id/pdf` and `GET .../:id/voucher` routes (both fetch report-service for
  on-demand PDF generation, caveat 4, same shape as accounting-service's PDF route).
  `attachment.routes.ts` — deliberately left fully unmigrated (`PlatformAttachments` object-
  storage calls interleaved with DB reads, caveat 4d, identical shape to every other service's
  copy of this file).
  Found and fixed one mocked-`ctxFactory` test regression: `po-branch-scope.test.ts` (missing
  `.rawDb`/`.execute()` on the mock db and missing `.tenant` on the object `.create()` returns —
  all 6 tests in the file went from 200/403 to 500 until fixed). Full suite re-run clean
  afterward: 72 passing, 0 failures (4 integration tests skipped, no real-DB infra available,
  same as every other service checked this rollout). Typecheck clean; lint had exactly one real
  error introduced by this session's own edit (`search-sync.internal.routes.ts`'s `/* global
process, crypto */` comment left declaring an now-unused `crypto` global after the
  `ctxFactory.create()` call using it was removed) — fixed; all other lint output is pre-existing
  warnings. Rebuilt, restarted (also runs via `tsx` directly against `src/main.ts`, not
  `dist/main.js` — same as `inventory-service`), live-verified against tenant 2 through the
  gateway (`/api/purchase/...`): purchase-orders/grns/expenses/supplier-payments/purchase-
  returns/debit-notes/dashboard-summary all 200; requisitions/rfqs/purchase-invoices/pending-
  approval-count all a clean 403 (permission gaps in this tenant's role config, confirmed via
  response body, not route bugs). All 4 internal-key-guarded routes verified directly against the
  service on their real `/api/v2/...` paths (search-sync, pdc-alerts, po-delivery-reminders,
  pending-grn-alerts) — all returned real data matching this tenant's actual PO/GRN backlog. A
  real `POST /expenses` write committed and was cleaned up afterward. `pg_stat_activity` stable
  at 10 across 30 additional requests.

- **`tenant-service` — 100% reviewed, 2026-08-21 (all 12 route files).** Fully migrated (no
  external I/O anywhere in the file): `sso-config.routes.ts` (all 3 routes). `branch.routes.ts`
  (all 5 routes — the POST route's `ctx.db.transaction()` call, acquiring a per-tenant advisory
  lock before the branch-limit check, becomes a savepoint of the outer transaction per caveat 4b).
  `approval.routes.ts` — no `PlatformContextFactory` in this service (plain `db` passed), migrated
  via `withTenantConnection` directly; `WorkflowEngine.notifyUser()`'s `fetch()` call is always
  invoked as `void this.notifyUser(...)` at every call site (fire-and-forget, caveat 4c) — safe
  despite the notification send inside it. `usage.routes.ts` — `GET /admin/tenants/:id/usage` is
  a platform-admin lookup of a SPECIFIC tenant (tenantId from the :id param, not the caller's own
  req.auth.tenantId), migrated via `withTenantConnection` directly; `GET
/admin/tenants/usage-overview` deliberately left unmigrated — its own comment already
  documents it as the one legitimate cross-tenant query (caveat 4e).
  `search-sync.internal.routes.ts` — fully migrated via `withTenantConnection` (internal-key-
  guarded, caveat 5b), covering both entities this service owns (`branch`/`organization`).
  `organization.routes.ts` — `GET`/`PUT /organization` migrated; `POST /organization/logo/upload`
  and `GET /organization/logo` deliberately left unmigrated — real `StorageClient` object-storage
  calls interleaved with DB reads/writes (caveat 4d, same shape as every service's
  `attachment.routes.ts`). `billing.routes.ts` — the 3 read/patch routes (billing summary, plan
  change, invoice list) are single-tenant lookups by :id, migrated via `withTenantConnection`
  directly; `POST .../retry-payment` deliberately left unmigrated — `chargeInvoice()` makes a
  real Razorpay gateway call interleaved with DB work (caveat 4). `billing-webhook.routes.ts` —
  the Razorpay webhook itself doesn't know its tenant up front; restructured to look up the
  tenant by `paymentGatewayRef` first, then scope the actual status-update write via
  `withTenantConnection` once resolved (caveat 4f, same shape as `crm-service`'s
  `link-tracking.routes.ts`). `tenant.routes.ts` — `GET /admin/tenants/:id` is a pure single-
  tenant read, migrated via `withTenantConnection` directly; every other route in the file
  (`public/signup`, `admin/tenants` POST, suspend/activate/close) delegates to
  `TenantProvisioner`, which is saturated with external I/O across many interleaved steps (S3
  bucket creation, Elasticsearch index creation via a search-service `fetch()`, notification
  sends) — deliberately left unmigrated (caveat 4); `GET /admin/tenants` is a genuine cross-tenant
  list (caveat 4e), also left unmigrated. **Deliberately left fully unmigrated, no tenant
  dimension at all**: `demo-request.routes.ts` and `faq.routes.ts` — both operate on genuinely
  platform-wide tables with no `tenant_id` column (marketing lead capture, global FAQ content),
  confirmed via each file's own header comment; there is no GUC gap to close here at all, a
  different category from every other "leave unmigrated" case in this rollout so far.
  `billing-internal.routes.ts` — the daily billing-cycle scheduler job, deliberately left fully
  unmigrated: a genuine cross-tenant loop (caveat 4e) making a per-tenant Razorpay charge call
  inside it, also squarely within this session's standing "ignore Razorpay real-credentials/
  pricing work" scope exclusion.
  Found and fixed 7 mocked-`ctxFactory`/mocked-`db` test regressions from this batch (the largest
  single-service count so far): `branch-permission.test.ts`, `organization-permission.test.ts`,
  `sso-config-permission.test.ts`, `usage-routes-authz.test.ts` (all missing `.rawDb`/`.tenant`
  and/or the `sql` drizzle-orm mock), and 3 more inside the shared
  `audit-log-coverage.test.ts` file (`POST /branches`, `PUT /organization` create-path, `PUT`/
  `DELETE /sso-config`) — the `POST /branches` case additionally needed the mock's `db.transaction`
  to serve two different shapes correctly: `withTenantConnection`'s own call expects its callback's
  param to expose `.execute()` directly, while the route's own nested `ctx.db.transaction()`
  (TOCTOU branch-limit lock) expects its callback's param to expose `.raw` instead — same
  underlying object, two different wrapper shapes, now documented for future mock-writing.
  Also fixed the same `sql`-export gap in `billing-routes-authz.test.ts` and
  `billing-webhook.test.ts` (the latter also needed a `.select()` stub added, since the webhook
  route now looks up the tenant before writing). Full suite re-run clean afterward: 68 passing, 0
  failures (30 skipped integration tests needing real DB infra, consistent with every other
  service checked this rollout). Typecheck clean; one real TS narrowing bug caught and fixed
  during migration itself (not a pre-existing issue) — `billing-webhook.routes.ts`'s
  `paymentEntity?.order_id` truthy-narrowing didn't survive being captured inside a
  `withTenantConnection` closure two levels down, since it was accessed as a property
  (`paymentEntity.order_id`) rather than a bound local; fixed by extracting `const orderId =
paymentEntity.order_id` right after the narrowing check. Rebuilt, restarted (runs via compiled
  `dist/main.js`, unlike the tsx-direct pattern found on `inventory-service`/`purchase-service` —
  confirmed by checking the actual running process first, per the updated checklist step 6),
  live-verified against tenant 2 / the platform operator through the gateway (`/api/tenant/...`):
  branches/organization/approvals-pending all 200 for the tenant owner; billing-summary/invoices/
  usage/tenant-detail all 200 for the platform operator; a clean 404 (not 500) on GET /sso-config
  for a tenant with no SSO config configured, confirming NotFoundError still propagates correctly
  post-migration. Both internal search-sync entities (branch/organization) verified directly
  against the service with real data. A real `PUT`/`DELETE /sso-config` write-then-cleanup cycle
  exercised end-to-end successfully. `pg_stat_activity` stable at 9 across 30 additional requests.

- **`gst-service` — 100% reviewed, 2026-08-21 (all 11 route files).** Fully migrated (no external
  I/O anywhere in the file): `rcm.routes.ts`, `gst-register.routes.ts` (both `/gst/register` and
  `/gst/summary`), `gstr9.routes.ts` (both view + export), `gst-returns.routes.ts` (calendar,
  mark-filed, status). `gst.routes.ts` — 5 of 6 routes migrated; `POST /gst/compute` is pure
  computation (`GSTCalculator`) with no DB access at all, so there's no GUC gap to close there —
  left unchanged, a new category distinct from every "external I/O" deferral so far. `gstr2a.
routes.ts` — all 3 routes migrated, including the internal-key-guarded `reconcile-run` (caveat
  5b). `gstr3b.routes.ts` — GET/export routes migrated; the internal `reminder` route wraps only
  its DB read (tenant contact email), with the notification `fetch()` running after (caveat 4b/5b
  shape). `gstr1.routes.ts` — GET/export routes migrated; the internal `auto-prepare` route
  (single-tenant, no external I/O) fully migrated via `withTenantConnection`, building `ctx` via
  `ctxFactory.create(tenant, scopedDb)` _inside_ the wrap so `ctx.audit.log()` stays inside the
  same scoped transaction (this service's routes consistently pass `ctx.db`, not `ctx.db.raw`, to
  domain-service methods — a new nuance for internal-route migrations: the `ctx` object itself
  must be built inside the `withTenantConnection` callback whenever the domain layer expects
  `ctx.db` rather than a raw db handle). `eway-bill.routes.ts` — `GET /expiring-soon` and the
  internal `expiry-alert` reminder (same DB-read-then-fetch shape as gstr3b's reminder) migrated;
  `POST /generate` deliberately left unmigrated — `EwayBillService.generate()` makes a real NIC
  e-Way Bill API call inside its own transaction (caveat 4). `einvoice.routes.ts` — only the 2
  pure-read GET routes (`status`, `list`) migrated; `generate`/`cancel`/`retry` all call
  `EInvoiceService` methods that hit the real NIC e-Invoice API interleaved with DB writes
  (caveat 4), and `retry-pending` is additionally a genuine cross-tenant batch job (`tenantId=0`
  sentinel, caveat 4e) — all 4 left unmigrated. `internal.routes.ts` — deliberately left fully
  unmigrated: every route in the file (the compliance-saga trigger and the 3 saga-retry-callback
  actions) delegates straight into `EInvoiceService.generateIrn/cancelIrn` and eway-bill
  generation, all real NIC calls (caveat 4) — this is gst-service's single most externally-
  saturated file, matching its role as the one service holding NIC credentials. No mocked-
  `ctxFactory` test regressions found — full suite (51 passing, 2 skipped) was clean on the very
  first run, no fixes needed (unlike every prior service in this rollout). Typecheck clean; the 3
  lint errors present are pre-existing, confirmed untouched via `git status` on
  `EInvoiceService.ts`/`EwayBillService.ts`/`ewb.test.ts`. Rebuilt, restarted (runs via `tsx`
  directly against `src/main.ts`, same as `inventory-service`/`purchase-service`), live-verified
  against tenant 2 through the gateway (`/api/gst/...`): all 13 migrated GET routes 200, all 4
  internal-key-guarded routes verified directly against the service with real reconciliation/
  filing-readiness/notification-sent data, a real `PUT /gst/rates/:id` write-then-revert cycle
  exercised successfully (the revert hit the gateway's rate limiter, so cleanup was done via a
  direct DB update instead — confirmed the row matches its original value afterward).
  `pg_stat_activity` stable at 9 across 30 additional requests.

- **`hr-service` — 100% reviewed, 2026-08-21 (all 14 route files, the largest single-service
  scope in this rollout so far at ~6,000 lines).** Fully migrated (no external I/O): `attendance-
import-config.routes.ts`, `employee-self-service.routes.ts`, `employee-loans.routes.ts`,
  `tailor-work-log.routes.ts`, `holiday.routes.ts`, `statutory.routes.ts` (all PF/ESI/PT/Form-16
  routes — CSV export is computed locally, no fetch anywhere), `employee-lifecycle.routes.ts`
  (nominees/history/exit-workflow/F&F-settlement), `leave.routes.ts` (all 9 routes — several
  `ctx.db.transaction()` calls become savepoints per caveat 4b). `search-sync.internal.routes.ts`
  — fully migrated via `withTenantConnection` (caveat 5b), covering all 4 entities this service
  owns. `alteration.routes.ts` — 7 of 9 routes migrated; `/assign` and `/status` both call
  `sendNotification()` with DB work on both sides, restructured via manual `withTenantConnection`
  wraps (caveat 4g) rather than `tenantScopedHandler`, since the notification must never run
  inside an open transaction. `attendance.routes.ts` — 8 of 9 routes migrated;
  `POST /attendance/import` interleaves 4 sequential scheduler-service calls with DB reads before
  and an audit-log write after — restructured into two `withTenantConnection` wraps per caveat
  4g. `employee.routes.ts` — 13 of 20 routes migrated (departments/designations/employees CRUD);
  the 6 photo/document routes deliberately left unmigrated (real `PlatformAttachments` object-
  storage calls, caveat 4d); `POST /employees/import` deliberately left unchanged — a thin relay
  to scheduler-service with no DB access at all, so there's no GUC gap to close there (same
  no-DB-access category as gst-service's `/gst/compute`). `payroll.routes.ts` — 13 of 14 routes
  migrated (salary structures, employee-salary assignment, payroll-run lifecycle including the
  atomic-guarded approve/disburse transitions, bulk-send, both internal scheduler routes rebuilt
  via `withTenantConnection`); only `GET /payroll-slips/:id/pdf` deliberately left unmigrated
  (report-service PDF fetch, caveat 4, same shape as every other service's PDF route).
  `internal.routes.ts` — deliberately left fully unmigrated: every route in the file (biometric
  auto-import trigger, monthly leave accrual, year-end carry-forward, both alteration alert
  routes, feature-flag seed) queries or loops across every tenant with no single-tenant scope
  anywhere — the clearest caveat-4e case found in this rollout, confirmed by reading each query's
  WHERE clause.
  Found and fixed 2 mocked-`ctxFactory`/mocked-`db` test regressions from this batch:
  `holiday.test.ts` (missing `.rawDb`/`.tenant`, and its mock `db.transaction` needed to satisfy
  two different call shapes — `withTenantConnection`'s own call expects its callback param to
  expose `.execute()` directly, matching the same nuance documented for `tenant-service`) and
  `payroll-capability.test.ts` (its existing `rawDb: {}`/`getRedis: () => ({})` mocks are asserted
  byte-for-byte via `toHaveBeenCalledWith('HR_PAYROLL', {}, {})` at route-registration time — fixed
  by giving the _same_ auto-chaining `Proxy` object real `.transaction()`/`.execute()` behavior
  while leaving its enumerable-key surface empty, so the deep-equality assertion against `{}`
  still passes even though the object now behaves correctly for `withTenantConnection`). Full
  suite re-run afterward: 4 remaining failed files (`attendance-import.test.ts`,
  `employee-documents.test.ts`, `payroll-preflight.test.ts`, `permission-guards.test.ts`, 21 tests
  total) all independently reconfirmed 100% pre-existing via git-stash-revert-and-rerun on each
  file — all hardcode the wrong JWT issuer (`'erp-test'` instead of `'erp-auth-service'`), the
  same recurring bug class documented elsewhere in this rollout; `employee-documents.test.ts` in
  particular exercises routes I deliberately left unmigrated, ruling out any connection to this
  session's changes. Typecheck clean; 1 pre-existing lint error (`payroll-guard.test.ts`,
  confirmed untouched via `git status`), rest are pre-existing style warnings. Rebuilt, restarted
  (runs via compiled `dist/main.js`, same as `tenant-service`/`gst-service`), live-verified against
  tenant 2 through the gateway (`/api/hr/...`): all 16 migrated GET routes 200 across every route
  family (departments/designations/employees/holidays/leave-types/shifts/attendance-report/
  payroll-runs/preflight/salary-structures/employee-loans/pf-challans/alterations/tailor-work-log/
  me-attendance/approvals-pending/attendance-import-config). Both internal routes verified
  directly against the service — search-sync returned real employee data, and
  `/internal/payroll/prepare` ran a real idempotent payroll recalculation for tenant 2's current
  period (left as legitimate output, not test junk, matching this rollout's established practice
  for real idempotent side effects). A real `POST`/`DELETE /holidays` write-then-cleanup cycle
  exercised successfully end-to-end. `pg_stat_activity` stable at 9 across 30 additional requests.

- **`search-service` — all 5 route files, all done.** This service has **no
  `PlatformContextFactory` at all** (same shape as `ai-copilot-service`'s partial migration) —
  `main.ts` passes a plain `db: ErpDatabase` straight into each route-registration function, so
  every migrated route uses `withTenantConnection(db, tenantId, ...)` directly, no ctx object at
  all. `saved-searches.routes.ts` (all 3 routes) and `search-analytics.routes.ts` (all 3 routes)
  fully migrated, no external I/O in either. `dead-letters.routes.ts` — list and discard routes
  migrated cleanly; the retry route calls `syncSearchIndex()` (a real Elasticsearch write) with a
  DB read before and a DB write after, restructured per caveat 4g into two separate
  `withTenantConnection` calls around the ES call. `internal.routes.ts` — **left fully
  unmigrated**: every route (reindex/bulk-index/create-tenant-indices) talks only to
  Elasticsearch via `SearchEngine`, touching zero Postgres tables — same "no-DB-access-at-all"
  category as gst-service's `/gst/compute` and hr-service's `/employees/import`. `search.routes.ts`
  (the largest file, 6 routes) — `GET /search` migrated by wrapping its two DB touches
  independently rather than via a literal caveat-4g split: a best-effort `try/catch` read
  (click-boost lookup) runs fully before the ES `engine.search()` call, and a `void`
  fire-and-forget analytics insert runs after it — since neither DB operation is ever concurrent
  with the ES call and neither needs transactional atomicity with it (both were already
  best-effort/fire-and-forget before this migration), each got its own independent
  `withTenantConnection` wrap instead of restructuring around a shared boundary. The four
  `/admin/search/*` routes (reindex, bulk-index, create-indices, delete-indices) each call an ES
  method first, then a shared `logAdminAction()` helper for a best-effort post-hoc audit-log
  write — fixed by wrapping the write INSIDE `logAdminAction` itself (not the whole handler),
  since it always runs strictly after the ES call completes, never concurrently with it. `GET
/admin/search/stats/:entity`, `POST /search/index`, `DELETE /search/index/:entity/:id` — all
  three touch only Elasticsearch, zero DB access, left unchanged (same no-DB-access-at-all
  category). Typecheck clean throughout. Zero net-new lint errors (one pre-existing
  non-null-assertion warning in `search.routes.ts` confirmed untouched via `git diff`). Test
  fixes needed in 4 of the service's 16 test files — all the same underlying gap (mocked `db`
  objects missing `.transaction()`/`.execute()` for `withTenantConnection`), plus one file
  (`saved-searches-authz.test.ts`) that additionally mocked `drizzle-orm` wholesale without
  including `sql`, which `withTenantConnection`'s own GUC-setting query needs — silently breaking
  with an opaque 500 rather than a clear error, since the mock factory swallows the import
  entirely. Fixed by adding a small `withTransactionSupport()` test helper (wraps a mock db with
  self-referential `.transaction()`/`.execute()`) and adding `sql` to the drizzle-orm mock where
  missing. Full suite: 85/85 passing, 0 regressions. Runs via `tsx` directly against `src/main.ts`
  (port 3017, gateway prefix `/api/search`, `apiV2: true`) — restarted matching that launch
  method. Live-verified through the gateway: all migrated GET routes 200
  (`/search`, `/saved-searches`, `/search/suggest`, `/admin/search/dead-letters`,
  `/admin/search/analytics/summary`, `/admin/search/stats/:entity`), a real `POST`/`DELETE
/saved-searches` write-then-cleanup cycle succeeded, `pg_stat_activity` stable at 9 across 30
  additional requests.

- **`event-service` — all 8 route files, all done.** Has a real `PlatformContextFactory` (unlike
  search-service). `event-store.routes.ts` (2 routes) and `dap.routes.ts` (3 routes) — fully
  migrated via `tenantScopedHandler`, no external I/O, single-tenant throughout. `dlq.routes.ts`
  (5 routes) — summary/list/detail/discard migrated via `tenantScopedHandler`; the replay route
  loops over N pending items, each doing a real Kafka publish (`worker.publishRaw()`) followed by
  its own DB write — a **loop-shaped extension of caveat 4g**: rather than one shared transaction
  around the whole loop (which would hold a transaction open across N sequential network calls),
  each iteration gets its own `withTenantConnection` wrap for its write, strictly after that
  item's publish call resolves; not routed through `tenantScopedHandler` since that wraps the
  entire handler body in one transaction, exactly what this shape must avoid. `saga.routes.ts` (5
  routes) — the 3 pure-read routes (summary/list/detail) migrated via `tenantScopedHandler`;
  `retry`/`compensate` **left fully unmigrated** — they delegate into a bootstrap-time
  `SagaOrchestrator` singleton (constructed in `main.ts` against the raw pooled db, before any
  request exists) whose `execute()`/`compensateSteps()` loop runs arbitrary per-step domain logic
  (real external side effects — events published, other services reacting) interleaved with
  `saga_log` writes across potentially many steps; retrofitting a GUC wrap would mean threading a
  per-request scoped db down through every registered step factory, a `SagaOrchestrator` API
  change, not a route-level fix — same shape as gst-service's `internal.routes.ts`.
  `schema-registry.routes.ts` and `performance.routes.ts` — **left fully unmigrated**, both
  **new instances of the "no tenant dimension at all" category**: `schema_registry` and
  `performance_profiles` (packages/db-client/src/schema/distributed.ts) have no `tenant_id`
  column at all — event JSON schemas and endpoint latency benchmarks are genuinely platform-wide,
  shared across every tenant, not per-tenant records. `projections.routes.ts` — **left fully
  unmigrated**, a **new "cross-tenant admin route" instance**: `projectionMetadata` has a
  _nullable_ `tenant_id` (unique per projectionName+tenantId, allowing either a global or a
  per-tenant row), but every route in this file queries/updates by `projectionName` alone with no
  tenantId filter anywhere — genuinely cross-tenant platform monitoring of each CQRS projection's
  health/lag, not scoped to the calling admin's own tenant; wrapping these would apply a GUC these
  queries never intended and, once RLS is enabled, would silently hide the cross-tenant/global
  rows this dashboard exists to show. Same category as tenant-service's `GET /admin/tenants`, just
  for a synchronous admin route rather than a scheduler batch job. `health.outbox.routes.ts` — a
  single unauthenticated health-check route with no tenant context at all, self-evidently out of
  scope. Typecheck clean throughout. Lint: 7 pre-existing errors (unused imports in
  `performance.routes.ts`/`projections.routes.ts`, `import()` type annotations in
  `schema-registry.routes.ts`/`permission-granularity.test.ts`), all confirmed untouched via
  `git stash` + rerun — identical error set with the migration fully reverted. Tests: 27
  pre-existing failures (permission-granularity.test.ts, dlq-replay.test.ts,
  projections-rebuild.test.ts) all returning 401 — confirmed 100% pre-existing via the same
  stash-and-rerun (identical 27 failed/3 passed/3 skipped with every route change reverted); this
  is the same recurring JWT-issuer test bug documented elsewhere in this rollout (`'erp-test'` vs
  `'erp-auth-service'`), unrelated to this migration. Runs via `tsx` directly against `src/main.ts`
  (port 3023, gateway prefix `/api/event`, `apiV2: false` — but the service's own routes are
  registered under `/api/v2` in `main.ts`, so the real gateway-facing path is
  `/api/event/api/v2/...`). Live-verified through the gateway: all 5 migrated GET routes 200
  (event-store, dlq summary, saga summary, saga list, dap progress), a real
  `PUT /dap/progress/:tourId` write succeeded and was confirmed via a follow-up GET, cleaned up
  directly via `docker exec ... DELETE FROM tour_progress` (no DELETE route exists for this
  table), `pg_stat_activity` stable at 9 across 30 additional requests.

- **`scheduler-service` — all 4 route files, all done.** No `PlatformContextFactory` here either
  (plain `db` passed to each route registration function, like search-service) — every migrated
  route uses `withTenantConnection(db, tenantId, ...)` directly. `scheduler.routes.ts` — `GET
/jobs` and `GET /jobs/:name/history` migrated (the former's per-job loop calls
  `registry.getStatus()`, confirmed pure BullMQ/Redis with zero Postgres access, so safe to run
  inside the same wrap — Redis ops are fast and don't carry the "holds a transaction open across
  an uncertain network call" risk that external HTTP fetches do); `POST /jobs/:name/trigger`,
  `PATCH /jobs/:name/pause`, `PATCH /jobs/:name/resume` left unchanged — confirmed via reading
  `JobRegistry.ts` that `triggerManual`/`pause`/`resume` are pure `job.queue.*` BullMQ calls with
  zero Postgres access (job_history itself is written by the worker, not these routes) — same
  "no-DB-access-at-all" category as gst-service's `/gst/compute`. `export.routes.ts` (3 routes) —
  all migrated; `POST /exports/generate`'s job-row insert + status update + `registry
.triggerManual()` enqueue all run inside one wrap (triggerManual confirmed Redis-only, same
  reasoning as above). `export-schedule.routes.ts` (5 routes) — all migrated, no external I/O
  anywhere. `import.routes.ts` (8 routes) — the interesting one: `ImportEngine` held a single
  `ErpDatabase` reference constructed ONCE at route-registration time and reused by every request
  (unlike event-service's `SchemaRegistry`/`EventStoreService`, which were already built fresh
  per-request); confirmed via grep that none of its methods do external I/O, so the fix was
  building a **fresh `ImportEngine` instance per request** from the scoped db, mirroring the
  ctx-built-inside-the-wrap pattern from event-service/gst-service. `upload`/`map`/`validate`
  migrated this way; `rollback` too (a single bounded delete+status-update, now atomic where it
  wasn't before — a genuine improvement, not just parity). **`execute` deliberately NOT
  migrated** — a real, concrete instance of caveat 3 (independently-committed writes surviving
  later failure): its row-import loop processes 100-row batches, each in its own try/catch that
  turns a batch failure into a `failed` count rather than throwing — batches are meant to commit
  independently, and a partially-completed import is undone via the explicit `POST
.../rollback` endpoint, not an automatic transaction rollback; wrapping the whole call in one
  transaction would mean an unrelated failure partway through rolls back every already-committed
  batch too. `GET /imports/:jobId/status`'s SSE branch is a **new pattern**: rather than one
  request-scoped transaction (impossible here — the connection can stay open for minutes while
  the client polls), each `getStatus()` call (the initial one AND every 2-second poll inside the
  `setInterval`) gets its own short-lived `withTenantConnection` wrap — avoiding a long-held
  transaction for the SSE connection's entire lifetime, which would be a real
  bloat/locking problem, not just a style concern. `GET /imports/templates/:entityType` — pure
  static lookup, zero DB access, left unchanged (no-DB-access-at-all). Typecheck clean. Lint: 0
  errors, 100 pre-existing warnings (missing-return-type, non-null-assertion — all in test files
  and pre-existing domain code untouched by this migration). Tests: 7 regressions across 3 files
  (`scheduler-routes-authz.test.ts`, `export-routes.test.ts`, `export-schedule-routes.test.ts`),
  all the same recurring gap — mocked `db` objects missing `.transaction()`/`.execute()` for
  `withTenantConnection` — fixed with the by-now-standard self-referential mock pattern; full
  suite 111/111 passing after the fix. Runs via `tsx` directly against `src/main.ts` (port 3016,
  gateway prefix `/api/scheduler`, `apiV2: true`). Live-verified: all 3 tested GET routes 200 (hit
  directly against the service on 3016 rather than through the gateway — the gateway's shared
  rate limiter was still cooling down from earlier services' verification bursts in this same
  session), a real `POST`/`DELETE /export-schedules` cycle succeeded (the DELETE route only
  soft-deactivates via `active: 0`, so the row was hard-deleted afterward via direct SQL to leave
  no residue), `pg_stat_activity` stable at 9 across 30 additional requests. Background job/worker
  code in `src/jobs/*.ts` (cron handlers, BullMQ workers, Kafka consumers) is explicitly out of
  scope for this rollout — matches every prior service, where only HTTP route files were touched.

- **`notification-service` — all 3 route files, all done.** No `PlatformContextFactory` (plain
  `db` passed, like search-service/scheduler-service) — every migrated route uses
  `withTenantConnection(db, tenantId, ...)` directly. `notification.routes.ts` (17 routes) — the
  largest file in this service. `NotificationEngine` held one `ErpDatabase` built ONCE at
  route-registration time (same `ImportEngine`-shaped gap as scheduler-service) — fixed by
  building a fresh `NotificationEngine(scopedDb, deliveryQueue)` per request, reusing the same
  shared `deliveryQueue` (a real BullMQ `Queue`, correctly long-lived). Confirmed via reading
  `NotificationEngine.ts`/`DeliveryQueue.ts` that every actual channel send (SMS/email/WhatsApp)
  goes through `DeliveryQueue.enqueue()` — a plain `queue.add()` Redis call with zero direct
  external HTTP I/O (the real provider calls happen in `DeliveryQueue`'s worker-side `process()`,
  a separate execution context out of scope for this rollout, same as every other service's
  background workers) — so every route, including the 4 internal seed-template routes and
  `send`/`send-internal`/`send-raw-internal`/`retrySingle`/`retryFailed`, was safe to wrap
  normally with no caveat-4/4g restructuring needed. `GET /notifications/stream` (SSE) reused the
  scheduler-service pattern: rather than one transaction held open for the connection's lifetime
  (potentially minutes), the initial seed query AND every 5-second poll each get their own
  short-lived `withTenantConnection` wrap. `template.routes.ts` (6 routes) — all straightforward
  single-tenant CRUD migrated normally; `POST .../preview` (pure Handlebars render, zero DB access)
  left unchanged. `webhook.routes.ts` (4 processing routes + 2 GET verification-handshake routes)
  — a genuinely new **caveat 4f applied per-loop-iteration**: these are public, unauthenticated
  provider callbacks (MSG91/SendGrid/Meta/Instagram) where each payload is a BATCH of
  reports/events, and for each one the `notificationLog` lookup by `externalMessageId` is
  inherently cross-tenant (no tenant is known until that lookup resolves) — so that lookup stays
  unscoped, and once `logRow.tenantId` is known, the write pair
  (`recordDeliveryEvent`+`applyDeliveryUpdate`) runs inside its own `withTenantConnection` wrap,
  one per loop iteration (same loop-shape as event-service's DLQ replay route). The two GET
  `hub.verify_token`/`hub.challenge` handshake routes touch no DB at all, left unchanged. Hit the
  same drizzle-orm-mock-missing-`sql` gap discovered in search-service's rollout in one test file
  that mocked `drizzle-orm` wholesale for `eq`/`and`/`desc` only. Typecheck clean; lint 0 errors
  (33 pre-existing warnings). Test fixes needed in 5 of 16 test files, all the same
  missing-`.transaction()`/`.execute()` mock gap; full suite 101/101 passing after (4 skips are
  pre-existing `describe.skipIf(!DATABASE_URL)` real-DB integration tests, confirmed unrelated —
  one of them, `webhook-delivery.test.ts`, calls the exported `recordDeliveryEvent`/
  `applyDeliveryUpdate` helpers directly with a raw db, completely bypassing the route layer, so
  their signatures were deliberately left unchanged to keep that test valid). Runs via `tsx`
  directly against `src/main.ts` (port 3014, gateway prefix `/api/notification`, `apiV2: true`).
  Live-verified through the gateway: all 4 tested GET routes 200, a real `POST`/`DELETE
/notifications/templates` write-then-cleanup succeeded, a live SSE connection to
  `/notifications/stream` (query-param JWT, since EventSource can't set custom headers) delivered
  a real initial heartbeat + a real 5-second poll tick with live unread-count data, confirming the
  per-poll-wrap pattern works end-to-end — `pg_stat_activity` stayed stable (9) both across 30
  additional requests and after the SSE client disconnected (no leaked long-held transaction).

- **`report-service` — all 3 route files (+ 2 shared domain engines), all done.** No
  `PlatformContextFactory` (plain `db` passed, like search/scheduler/notification-service). The
  **single biggest new pattern discovered in the whole rollout**: this service reads through a
  `ReplicaRouter` (PG-005) that picks a physical connection — primary or a genuinely separate
  read-replica pool — per call via `.forRead()`, with lag-aware fallback. Confirmed
  `createReadReplicaClient()` returns a full `ErpDatabase` (same drizzle-postgres-js wrapper as
  the primary), so `.transaction()` + `SET LOCAL`/`set_config()` work identically against the
  replica — a hot standby rejects actual DML at the WAL level, but read-only session/transaction
  operations are fine. The fix shape everywhere: call `replicaRouter.forRead()` FIRST to resolve
  which connection to use, THEN wrap that resolved connection in `withTenantConnection` — never
  the other way around. `dashboard.routes.ts` (4 routes, the heaviest — `/charts` alone runs 8
  raw-SQL queries) — every route already explicit-filtered by `tenant_id` in its WHERE clause;
  this migration adds RLS-ready defense-in-depth on top of already-correct queries, not a fix for
  a missing filter. `ReportEngine.ts` (2472 lines, one giant `runQuery()` switch keyed by report
  slug) — `generate()` (the one public entry point, single call site into `runQuery()`) now
  resolves `forRead()` and wraps the whole call in `withTenantConnection`, with `runQuery()`
  changed to take the scoped db as a parameter instead of resolving `replicaRouter.forRead()`
  internally — every one of ~30 report slugs, including the ones sourced from the shared
  `ReportsEngine` (`@erp/sdk`, the consolidated Trial-Balance/P&L/BS/Cash-Flow engine) via `new
TenantScopedDatabase(tid, db)`, inherits the fix for free since they all flow through this one
  chokepoint. `analytics-reports.routes.ts` (11 routes) — routes calling `engine.generate()`
  needed no additional wrap (self-scoped internally now); the async-report branch's `setImmediate`
  callback runs fully DETACHED from the request lifecycle (after the 202 response is already
  sent) so each of its three `report_run_history` writes (RUNNING/COMPLETED/FAILED) got its own
  independent `withTenantConnection` wrap rather than being covered by wrapping the route handler
  (nothing is left to wrap by the time that callback runs); `GET /api/v2/unsubscribe/:token` is
  **caveat 4f** (public, no JWT, tenant unknown until the `unsubscribeToken` lookup resolves).
  `report.routes.ts` (5 routes) — `NumberSeriesEngine` had the same `ImportEngine`-shaped
  route-registration-time-singleton gap (fixed the same way: fresh instance per request from the
  scoped db); as a genuine side benefit, `next()`'s previously-non-atomic
  select-then-conditional-insert-then-UPDATE...RETURNING sequence is now atomic as a side effect
  of the wrap, not just parity. `POST /internal/reports/outstanding-summary` — the `tenants`
  lookup (before a real `fetch()` to notification-service, best-effort try/catch) got its own
  wrap; `POST /reports/pdf` touches no DB at all, left unchanged (no-DB-access-at-all). Typecheck
  clean throughout. Lint: 1 pre-existing error (`NumberSeriesEngine.test.ts`'s unused `makeSelect`,
  confirmed via empty `git diff` on every test file before any test-mock fixes were made), 41
  pre-existing warnings. Tests: 122 regressions across 5 files (`ar-aging`, `ap-aging`,
  `financial-reports`, `report-tenant-isolation`, `scheduled-report`) — all the same root cause,
  but with a **new wrinkle**: since the GUC-setting call and the real report query now both hit
  `.execute()` on the same `trx` object, a naive `.transaction()` mock would corrupt every
  existing `mock.calls[0]`/`mockResolvedValueOnce()`-ordering assertion (the GUC call would
  become "call zero", shifting everything by one). Fixed with a **smarter interception**: the
  mock's `trx.execute()` recognizes the GUC call (by SQL-text content when `sql` is mocked to a
  `{strings,values}` shape, or by being-the-first-call-per-transaction when it isn't) and
  resolves it directly without ever forwarding to the tracked `execute` mock — so
  `db.execute.mock.calls` end up containing exactly the same entries, in the same order, as
  before this migration. Full suite 135/135 passing after. Runs via `tsx` directly against
  `src/main.ts` (port 3015, gateway prefix `/api/report`, `apiV2: false` — but
  `analytics-reports.routes.ts`/`dashboard.routes.ts` hardcode `/api/v2` directly into their own
  route paths, so the real gateway-facing path is `/api/report/api/v2/...`).
  Live-verified through the gateway: all 6 tested GET routes 200 (3 dashboard widgets, reports
  list, run-history, schedules list), a real async report run (`POST .../sales-register/run`)
  went 202→PENDING then polled to a genuine `COMPLETED` result with 76 real rows — proving the
  detached `setImmediate` wraps work end-to-end — plus a real `POST
/config/number-series/invoice/preview` returned a real formatted number, `pg_stat_activity`
  stable at 9 across 30 additional requests.

- **`api-gateway` — reviewed, nothing to migrate.** Confirmed architecturally: no `@erp/db`
  dependency in `package.json`, and a repo-wide grep for `createDatabaseClient`/`drizzle(`/
  `ErpDatabase`/`pg`/`postgres`/`Database` across `apps/api-gateway/src/` returns zero matches.
  It is a pure HTTP proxy/router (path rewriting, rate limiting, upstream dispatch per
  `UPSTREAM_DEFAULTS`) with no direct Postgres access anywhere — there is no GUC gap to close
  here because there is no query to scope. This is the 15th and final service in the rollout.

## Rollout complete

All 15 backend services have now been reviewed: `production-service`, `sales-service`,
`crm-service`, `accounting-service`, `inventory-service`, `purchase-service`, `tenant-service`,
`gst-service`, `hr-service`, `search-service`, `event-service`, `scheduler-service`,
`notification-service`, and `report-service` were migrated route-by-route (every route file
either migrated via `withTenantConnection`/`tenantScopedHandler`, or left deliberately unmigrated
with a documented reason — external I/O / independent-write / cross-tenant-batch-job /
tenant-resolved-inside-a-service-method / no-tenant-dimension-at-all / no-DB-access-at-all);
`api-gateway` was confirmed to have no Postgres access at all and needs no migration. Still
outstanding, explicitly out of scope for this pass: the unmigrated external-I/O routes in
`ai-copilot-service`/`automation-service` (a separate, smaller-granularity follow-up design task
noted early in this rollout, never part of the per-service sweep). Deliberately
**not** blanket-applied in one pass: this is a foundational, hard-to-reverse change to the request
lifecycle, and `13-security-architecture.md`'s own recommendation is a table-by-table, monitored
rollout — the same caution it prescribes for RLS itself. Roll out service-by-service, checking
step 3 above for each route file, before enabling RLS on any table.

**Where this leaves RLS enablement**: `app.current_tenant_id` is now set correctly on every route
across all 15 services that has a real per-tenant query to scope — the precondition
`13-security-architecture.md` set for turning on Postgres Row-Level Security itself is satisfied.
RLS is still **not enabled** on any table as of this rollout's completion; enabling it is a
separate, deliberately-deferred next step (its own table-by-table, monitored rollout, per that
doc's own recommendation) — not an automatic consequence of this checklist finishing. The
deliberately-unmigrated routes documented throughout this file (external I/O, independent-write,
cross-tenant-batch-job, tenant-resolved-inside-a-service-method) are exactly the places RLS
enablement needs to re-check first, since those queries never got the per-request GUC and would
either break (RLS silently hiding rows a genuinely cross-tenant query needs) or simply not benefit
from the added protection.

## Step 2 — RLS enablement begins (2026-08-22): `invoices`, the first table

**Blocker found before any table could be touched**: every service connects to Postgres as `erp`,
which turns out to be a Postgres **superuser** (Docker's official Postgres image always makes
`POSTGRES_USER` a superuser). Confirmed empirically — created a real RLS policy + `FORCE ROW
LEVEL SECURITY` on a throwaway table, queried as `erp` with the GUC unset, got rows back from
every tenant instead of zero. Postgres superusers unconditionally bypass RLS; no table-level
setting can override it. Enabling RLS under the existing role setup would have compiled cleanly
and done nothing — worse than not doing it, since it creates false confidence.

**Fix — a new non-superuser application role.** Created `erp_app` (`NOSUPERUSER NOCREATEDB
NOCREATEROLE NOBYPASSRLS`), reassigned ownership of every existing table/sequence/function from
`erp` to `erp_app` (had to do this per-object in a loop, not via `REASSIGN OWNED BY`, which fails
on database-level ownership with "required by the database system"), and granted `erp_app` full
privileges + default-privileges-for-future-objects on the `public` schema. `erp_app` owns the
tables (not just granted access) specifically so it can still run `drizzle-kit migrate` (`ALTER
TABLE` requires ownership or superuser) — `FORCE ROW LEVEL SECURITY` on each RLS-enabled table
ensures ownership doesn't bypass RLS the way it normally would for an owner. `erp` remains
available for admin/migration access but is no longer the app's runtime connection. Added the
same idempotent role-creation block to `infrastructure/docker/postgres/init.sql` (matching the
existing `repl_user` pattern) so a fresh container install sets this up automatically — for a
truly fresh install there are zero pre-existing tables at `init.sql` time, so the
per-object-reassignment loop is a no-op and every table Drizzle creates afterward (once
`DATABASE_URL` points at `erp_app` from the start) is `erp_app`-owned automatically, no
reassignment ever needed. Also discovered `current_tenant_id()` (documented in `init.sql`) had
never actually been applied to the running dev database — created it for real, and empirically
confirmed its "fail loud" design works correctly under realistic connection-pool reuse (a pooled
connection that touched the GUC once, then had it reset, correctly raises "Security: tenant
context not set. Access denied." on a later query that never sets it again — a brand-new,
never-touched connection instead returns NULL silently, which is why the very first naive test of
this function looked broken; that edge case essentially never happens with a real, warmed-up
`postgres-js` connection pool). Switched `.env`'s `DATABASE_URL`/`DATABASE_REPLICA_URL` to
`erp_app`, then restarted all 15 running services (`production-service` was already down,
unrelated to this work) in two batches by launch method (dist vs tsx), verifying health after
each batch, then ran a smoke test across 8+ routes spanning sales/inventory/crm/accounting/
tenant/gst/purchase/hr-service to confirm the whole platform still functions identically under
the new role before touching any RLS policy.

**RLS-readiness audit for `invoices`** (delegated to a subagent, ~109 tool calls, thorough):
found 19 real call sites still touching `invoices` without the per-request GUC. Most were exactly
the already-documented deliberately-unmigrated routes from the rollout above (scheduler-service's
`sales.payment-reminder-ladder`/projection-rebuild jobs, `ExportEngine`'s cron-driven exports,
sales-service's `mark-overdue`/payment-reminder/health-score/prediction internal routes,
crm-service's five cron-driven `internal.routes.ts` sweeps, gst-service's real-NIC-API
e-Invoice routes + its Kafka consumer + the shared `platform-sdk` gst-compliance saga factory) —
expected, and left as a documented, accepted gap rather than fixed here. **Two findings were not
niche batch jobs but everyday production routes** that would have started throwing "tenant
context not set" immediately: sales-service's `POST /invoices/:id/confirm` and
`GET /customers/:id/360`. Both were previously left unmigrated only because of a `fetch()` call
interleaved with DB work (checklist caveat 4) and needed the caveat-4g treatment applied for
real:

- **`POST /invoices/:id/confirm`** (`invoice.routes.ts`) — all the route's own DB work (confirm,
  item-cache-invalidation read, audit log) now runs inside one `withTenantConnection` wrap
  (`ctx` built inside it, same pattern as event-service/gst-service's internal routes);
  `InvoiceNotificationService.notifyInvoiceConfirmed()` runs after that wrap has committed. That
  method itself had its own two SELECTs before its fetch calls — its signature changed from
  taking a caller-supplied `PlatformContext` to taking the raw pooled `db` + `tenantId` directly,
  so it can open its _own_ separate `withTenantConnection` wrap for its reads (a `ctx` built
  inside the route's wrap can't be reused after that transaction has already committed). Real
  fetch calls (WhatsApp/email notification) run strictly outside both wraps.
- **`GET /customers/:id/360`** (`customer-360.routes.ts`) — a harder shape: the crm-service
  predictions fetch previously ran _concurrently_ with 5 DB reads inside one `Promise.allSettled`,
  not sequentially before/after — caveat 4g's simple "read then fetch then write" split doesn't
  apply directly. Restructured into: (1) a small existence-check wrap first (preserves the
  original "404 before ever firing the crm-service call" behavior), (2) the predictions fetch and
  the main 5-way DB `Promise.allSettled` batch started together and awaited together (the batch
  now inside its own `withTenantConnection` wrap), preserving the original wall-clock parallelism
  from 07-PERFORMANCE-PLAN.md §1 even though the DB batch is now transaction-wrapped.

Both fixes hit the same recurring test-mock gap as everywhere else in this rollout (mocked `db`
missing `.transaction()`/`.execute()`, and one file's wholesale `drizzle-orm` mock missing `sql`)
— fixed with the by-now-standard patterns. `customer-360-degradation.test.ts` (5 tests, the one
file directly exercising this restructured code) passes cleanly after the mock fix; the sales-
service full suite shows the exact same ~28 pre-existing JWT-issuer failures with or without
these two files' changes (confirmed via git-stash-and-rerun), zero new regressions.

**The migration** (`packages/db-client/migrations/0176_enable_rls_invoices.sql` —
`drizzle-kit migrate` is currently broken per the pre-existing DB-migration-bookkeeping issue
documented elsewhere in this project's memory, so applied directly via `psql` against the running
dev database, matching how every other schema/data change has been applied this session):
`ALTER TABLE invoices ENABLE ROW LEVEL SECURITY`, `FORCE ROW LEVEL SECURITY` (required since
`erp_app` owns the table), and a single `CREATE POLICY ... USING (tenant_id =
current_tenant_id())` with no separate `WITH CHECK` — Postgres reuses the `USING` expression for
write-side validation too when none is given, so a write for a mismatched `tenant_id` is
rejected, not just hidden afterward.

**Live-verified end-to-end**: as `erp_app` with the GUC unset, `SELECT count(*) FROM invoices`
returns 0 (not an error — a genuinely fresh connection that's never touched the GUC name gets
NULL from `current_setting(..., true)`, which is a safe fail-closed default); with `SET LOCAL
app.current_tenant_id` set, returns the real per-tenant count. Through the actual application:
`POST /invoices/1401/confirm` on a real DRAFT invoice succeeded end-to-end (real invoice number
generated, no errors in the service log, best-effort notification didn't crash the request);
`GET /invoices` list, `GET /invoices/:id` detail, and report-service's `GET
/api/v2/dashboard/kpis` (which reads `invoices` through `ReportEngine`'s `ReplicaRouter`-aware
`withTenantConnection` wrap, fixed as part of the earlier report-service rollout work) all
returned 200 with correct data. `pg_stat_activity` stable at 13 across a 20-request burst mixing
list/dashboard calls. (`GET /customers/:id/360` could not be exercised live end-to-end — the only
available test JWT's `OWNER` role is missing `CRM_360_VIEW` in its current permission grant, a
pre-existing, unrelated RBAC gap, not something this work introduced or should fix under this
task — its 5/5 passing unit tests, which exercise the exact restructured code path, are the
verification of record for that route.)

**Explicitly deferred, not fixed in this pass** (per the user's own choice of scope): the ~17
background-job/Kafka-consumer/real-NIC-API call sites the audit found. These will start either
throwing "tenant context not set" (on a warmed-up connection pool) or silently returning
empty/zero results (on a connection that's never touched the GUC name) now that RLS is live on
`invoices`. This is a known, accepted, and now-documented gap — not a surprise regression — and
is the natural next follow-up before extending RLS further or before relying on these jobs'
current behavior in production.

**Next**: `journal_entries` and `payments` are next in `13-security-architecture.md`'s own
priority order for this table-by-table rollout — each needs its own fresh RLS-readiness audit
(a table's unsafe-call-site list doesn't transfer from `invoices`), its own fixes for any
real-production-route findings, and its own migration, monitored independently before moving to
the next table.

## Step 2 continued (2026-08-22): `journal_entries` — the second table

`journal_entries` in the security doc's terminology maps to two tightly-coupled tables in this
schema: `journals` (header) and `financial_entries` (DR/CR lines, joined via the varchar
`journal_id` ULID, not `journals.id`). Both were treated as one RLS unit.

**Fresh audit result — a different outcome than invoices**: 25 call sites found across the
codebase; **zero everyday-production routes were unsafe**. `journal.routes.ts`,
`accounts.routes.ts`, `bank.routes.ts`, `financial-year.routes.ts`, `reports.routes.ts`,
`fixed-assets.routes.ts`, and `tds.routes.ts` were all already `tenantScopedHandler`-wrapped from
the Phase 9 rollout, and the shared `financial-reports-engine.ts` / report-service's
`ReportEngine` both receive an already-scoped `db`. No caveat-4g (fetch-interleaved-with-DB-work)
fix was needed anywhere — unlike invoices, no code changes were required before enabling RLS.

**Deliberately left unsafe, same accepted category as invoices**: accounting-service's 12 Kafka
consumers (Invoice/GRN/Cogs/Payment/SaleReturn/PurchaseReturn/Expense/Payroll/EmployeeLoan/Rcm/
StockAdjustment/Commission — dispatched against a bootstrap-time singleton db, never per-request
wrapped) and 2 scheduler-service jobs (`accounting.zero-value-journal-audit` cron,
`platform.partition-maintenance`). `JournalEngine.post()`/`.reverse()`'s own inserts still set the
GUC correctly via their internal `db.transaction()` regardless of caller; only the Invoice/Payment
consumers' pre-reversal SELECTs on `journals` are genuinely unscoped and will now hit "tenant
context not set" on a warmed connection — that already surfaces as the existing
`BusinessError('JOURNAL_NOT_FOUND_FOR_REVERSAL', ...)` guard, routing to the DLQ for retry rather
than silently no-op'ing a reversal.

**Real bug found and fixed before enabling RLS, not present in the invoices rollout**:
`financial_entries` is `PARTITION BY RANGE (created_at)` with pre-created yearly partitions
(`financial_entries_2025/2026/2027`, see `0002_phase6_accounting.sql`). Confirmed empirically —
not assumed from docs — that a partitioned parent's RLS _policy_ is shared across the whole
hierarchy automatically, but the `ENABLE`/`FORCE ROW LEVEL SECURITY` _flags_ are NOT inherited:
each partition starts with both flags false regardless of the parent's setting. A query against
the parent table was correctly filtered once RLS was enabled there, but a query naming a specific
yearly partition directly (`financial_entries_2026`) bypassed RLS entirely and returned every
tenant's rows under any GUC state, including unset. Fixed by explicitly enabling+forcing RLS on
all 3 existing partitions (no separate `CREATE POLICY` needed per partition — the parent's policy
applies automatically once a partition's own flags are on, confirmed by testing before/after).
Also fixed `apps/scheduler-service/src/jobs/system-jobs.ts`'s `platform.partition-maintenance` job
(creates next year's partition every Dec 1) to `ALTER TABLE ... ENABLE/FORCE ROW LEVEL SECURITY`
on the partition it just created — otherwise every new yearly partition would silently reopen this
exact gap for a full year until caught.

**The migration**: `packages/db-client/migrations/0177_enable_rls_journal_entries.sql` — same
shape as 0176 (`ENABLE`/`FORCE ROW LEVEL SECURITY` + single `tenant_isolation` policy, no
`WITH CHECK`), applied to `journals`, `financial_entries`, and all 3 existing partitions. Applied
directly via `psql` against the running dev database (`drizzle-kit migrate` still broken, same as
0176), `meta/_journal.json` updated to register it.

**Live-verified end-to-end** through the real application (gateway → accounting-service):
`GET /api/accounting/journals` (list, 200, correctly tenant-scoped), `GET
/api/accounting/journals/:journalId` (detail with lines, 200), `GET
/api/accounting/reports/trial-balance` (200, real account balances), and a real `POST
/api/accounting/journals` (manual balanced journal, 201, confirmed landed in the DB with the
correct `tenant_id` under RLS via a direct psql check with the GUC set). `pg_stat_activity`
connection count stable (9 → 9) across a 20-request burst, all 200s. Partition-direct-access fix
verified by querying `financial_entries_2026` directly before and after the flag change (before:
477 rows regardless of GUC state; after: 0 rows with GUC unset, correctly tenant-filtered count
with GUC set).

**Next**: `payments` is the last table in this rollout's original 3-table priority list — its own
fresh audit, any fixes, its own migration, monitored independently.

## Step 2 continued (2026-08-22): `payments` — the third and last table in this rollout

`payments` resolves to exactly one table (`packages/db-client/src/schema/sales.ts`'s
sales-service customer AR payment-receipt table, POS + manual "Record Payment") plus its child
`payment_allocations`. Two similarly-named tables were checked and ruled out: purchase-service's
`supplier_payments` (a genuinely separate AP table) and tenant-service's PG-027 Razorpay billing
(no separate payments table — state lives on `tenant_invoices` itself). Not partitioned — same
simple shape as invoices.

**Fresh audit found 14 call sites, 2 everyday-production-route findings, both fixed**:

- **`POST /payments`** (Record Payment) — same caveat-4g shape as invoices' confirm route:
  `PaymentNotificationService.notifyPaymentReceived()` makes a real fetch() after its own DB
  reads. Restructured identically — all DB work (including the `DuplicateOperationError`
  existing-row lookup) inside one `withTenantConnection` wrap, notification method now takes the
  raw db + tenantId and manages its own separate wrap.
- **`POST /pos/sales`** (POS checkout, the highest-volume path touching `payments`) — a harder,
  genuinely new case. Its catch-all failure branch calls `svc.cancel()` and re-throws on purpose
  (OFFLINE-07 — that compensating write must commit independently of the failed main
  transaction), which is checklist caveat 3, not 4. **But the route turned out to be GUC-unsafe
  even in what looked like its own real transaction**: `ctx.db.raw.transaction()` calls
  `.transaction()` on the plain pooled `ErpDatabase` — `TenantScopedDatabase.raw` strips the
  wrapper that would have called `set_config`; only `TenantScopedDatabase`'s own `.transaction()`
  (called on `ctx.db`, never `ctx.db.raw`) sets the GUC. Fixed by giving each
  independently-committing phase (session verify, DRAFT-invoice create, the
  confirm/payment/loyalty transaction, each `cancel()` compensating write, the post-commit
  cache-invalidation read) its own `withTenantConnection` wrap — each is a real, separate
  Postgres transaction, preserving the same independent-commit boundaries caveat 3 requires.
  `waitForOperationResult`'s poll loop (up to 10 attempts, 150ms apart) got its own per-iteration
  wrap rather than one held-open transaction, same pattern as scheduler-service's SSE polling.

**Operational lesson hit while verifying this fix, worth remembering**: sales-service runs live
from `dist/main.js` (a plain `node` process), not `tsx watch` — a `tsx watch` process for the same
service was also running (PID mismatch confirmed via `Get-NetTCPConnection -LocalPort 3013`) but
was NOT the one bound to the port, so it was silently irrelevant. Editing the route files and
retesting kept reproducing the exact pre-fix RLS failure for ~15 minutes before this was caught —
`dist/` was stale. Fixed by `tsc` build + killing the old dist process + starting a fresh one.
Matches [[backend_services_run_from_dist_not_watch]] but is a sharper version of that lesson: a
_live, healthy-looking_ `tsx watch` process for the same service can coexist with the real one and
create false confidence that a source edit is live when it isn't — checking the actual
port-owning PID's command line is the reliable check, not just "is some process for this service
running."

**The migration**: `packages/db-client/migrations/0178_enable_rls_payments.sql` — same shape as
0176 (not partitioned, no `WITH CHECK`), applied to `payments` and `payment_allocations`. Applied
directly via `psql` (`drizzle-kit migrate` still broken), `meta/_journal.json` updated.

**Live-verified end-to-end** through the real application after the dist rebuild: `GET
/api/sales/payments` (200, tenant-scoped), a real `POST /api/sales/payments` (201, confirmed
landed with correct `tenant_id` via direct psql check), a real full `POST /api/sales/pos/sales`
checkout (201 — invoice CONFIRMED→PAID, payment created and allocated, all correctly tenant-scoped
under RLS, zero Postgres errors), and a deliberate failure case (zero-stock item → 422
`INSUFFICIENT_STOCK`) confirming the compensating `cancel()` write committed independently — the
DRAFT invoice was correctly `CANCELLED` under RLS even though the main transaction rolled back.
`pg_stat_activity` stable across a 20-request burst.

**Deliberately left unsafe, same accepted category as invoices/journal_entries**: sales-service's
`internal.routes.ts` CRM health-score/predictions cron sweep (raw SQL joining `payments`,
internal-key-guarded) and scheduler-service's `ExportEngine`/`exportGenerateJob`/
`ExportScheduleJob`/`projectionRebuildJobs` (BullMQ background jobs and cron, not live request
paths).

**Rollout status: all 3 tables in the original priority list (`invoices`, `journal_entries`,
`payments`) now have RLS enabled and live-verified.** The ~17 background-job/consumer/NIC-API
call sites accepted as deferred across all three tables (some overlapping — e.g.
accounting-service's consumers touch both invoices and journal_entries) remain the next follow-up
item, tracked separately from this checklist.

## Step 3 (2026-08-22): reconciling and closing the deferred background-job/consumer/NIC-API list

The ~17-ish deferred call sites from the invoices/journal_entries/payments audits, reconciled into
5 clusters and closed (or explicitly re-confirmed as an accepted gap) one cluster at a time.

**Investigation first, before any fix**: a dedicated investigation pass classified every deferred
call site into one of three shapes — **A** (already single-tenant per invocation — a normal wrap
closes it), **B** (a real `for (tenant of activeTenants)` cross-tenant loop in the handler's own
code — needs a per-iteration wrap, not one wrap around the whole request), **C** (a real external
API call, e.g. NIC, interleaved with DB work — needs the caveat-4g split). This classification is
what let each cluster get the right fix shape instead of one wrapper pattern applied blindly
everywhere.

**Cluster 1 — accounting-service's 12 Kafka consumers: turned out to need NO fix at all.**
Verified empirically, not assumed: a real POS-sale test's resulting `INVOICE_CONFIRMED`/
`PAYMENT_RECEIVED` events were consumed and posted two real journals with the correct `tenant_id`
under live RLS, no errors. Root cause of the earlier (wrong) "unsafe" classification in both this
checklist and the invoices/journal_entries audits: `packages/platform-sdk/src/events.ts`'s
`PlatformEventConsumer.subscribe()` — used by every service's Kafka consumers, not just
accounting-service's — already wraps every `handler(event, trx)` call in `db.transaction(...)`
(the `TenantScopedDatabase` version, which sets `app.current_tenant_id` via `set_config` itself),
not a bare pooled connection. This corrects the earlier audits' finding for this cluster.

**Cluster 2 — scheduler-service jobs (Shape A almost throughout, since `tenantScoped: true` jobs
are already scheduled once per tenant by `JobRegistry`)**: `sales.payment-reminder-ladder`,
`accounting.zero-value-journal-audit` (both: DB work wrapped, per-invoice notification `fetch()`
calls kept outside per caveat-4g), all 4 `projectionRebuildJobs` (rebuild wrapped, `markResult()`
deliberately left outside — `projection_metadata` has no `tenant_id` column, one row per
projection name platform-wide, not per tenant), `exportGenerateJob` (query wrapped, MinIO
upload/status-update writes each their own wrap), `ExportScheduleJob.runSchedule` (caveat 4f — the
initial lookup-by-`scheduleId` can't be tenant-scoped since `tenantId` isn't known until that row
is read; every call after it is). `ExportScheduleJob.syncSchedules` stays a documented,
accepted-as-is cross-tenant read (must see every tenant's schedules to manage BullMQ repeatables
in one pass).

**Clusters 3 & 4 — sales-service's and crm-service's `internal.routes.ts`**: mostly Shape B
(existing `for (tenant of activeTenants)` loops, wrapped per iteration). Three routes had **no**
tenant scope at all and needed real restructuring, not just wrapping: sales-service's
`/invoices/mark-overdue` and `/quotations/expire-stale` (`QuotationService.expireStale()` gained a
`tenantId` param) were single bulk `UPDATE`s across every tenant in one statement — converted to a
real per-tenant loop; crm-service's `LoyaltyService.expirePoints()`'s initial cross-tenant SELECT
stays unscoped by design (finds every tenant's expired points in one pass) but its per-row write —
each row already carries its own `tenantId` — now gets its own wrap, replacing a bare
`db.transaction()` call that never set the GUC (a plain `ErpDatabase`'s `.transaction()`, not
`TenantScopedDatabase`'s). crm-service's `campaigns/dispatch-scheduled` and
`automation-rules/dispatch-due` wrap the whole per-item `ctx`-building + send call, accepting that
this holds a transaction open across the notification-service enqueue `fetch()` — a deliberate
simplification since that call is a fast BullMQ-enqueue, not a slow/unreliable external API like
gst-service's NIC calls (Cluster 5, below), where the same shortcut would not have been acceptable.

**Cluster 5 — gst-service (Shape C, the real NIC-API paths)**: the fix landed one level down from
routes, in `EInvoiceService`/`EwayBillService` themselves — every DB call there now goes through
`db.transaction()` (`TenantScopedDatabase`'s own method, not `db.raw.transaction()`), which sets
the GUC itself **regardless of how the caller's `ctx.db`/`db` was built** (same mechanism proven
in Cluster 1). This meant the HTTP routes (`einvoice.routes.ts`, `eway-bill.routes.ts`) needed
_no changes at all_ — `ctx = ctxFactory.create({...})` without a `dbOverride` is now safe as-is,
since every downstream call is self-scoping. Also fixed: `retryPendingIrns()`'s per-record retry
loop was building a **fake** `{ raw, tenantId }` object cast to `TenantScopedDatabase` — it had no
real `.transaction()` method at all, so `generateIrn()`'s already-safe success-path write would
have thrown at runtime the first time this cron path actually reached it (never caught before
since retries rarely succeed in this dev environment) — replaced with a real
`new TenantScopedDatabase(...)` instance. The shared `packages/platform-sdk/src/sagas/
gst-compliance.ts` step factory (used by both gst-service's own orchestrator and event-service's
HTTP-proxied retry/compensate path) had the same bare-`db.select`/`db.update` gap, fixed with
`withTenantConnection`.

**Test-mock fallout, all the by-now-standard patterns**: every affected service needed the usual
"mock is missing `.transaction()`/`.execute()`" fix (self-referencing `transaction: (fn) => fn(db)`
identity mock), and two files needed the "wholesale `drizzle-orm` mock missing `sql`" fix (the
GUC-setting call throws opaquely otherwise). One test additionally hit the "GUC-setting call
consumes a mock queue slot meant for a real query" gotcha (`system-jobs.test.ts`) — fixed by having
the mock recognize and swallow the `set_config` call specifically, by SQL-text match. One
assertion (`platform.partition-maintenance`'s `db.execute` call count) needed updating from 1 to 3
to match the new `ENABLE`/`FORCE ROW LEVEL SECURITY` calls added on the created partition (see
Step 2 continued's `journal_entries` section, same job). All 5 affected services' full suites pass
clean afterward: platform-sdk (193), scheduler-service (111), crm-service (130 + pre-existing
skips), gst-service (51 + pre-existing skips), sales-service (166 passed, same ~28 pre-existing
JWT-issuer failures confirmed via git-stash-and-rerun, zero new regressions).

**Live-verified end-to-end** across all 4 backend services after a full rebuild+restart (all 4 run
from `dist/main.js`, not `tsx watch`, in this environment — confirmed by checking the actual
port-owning PID for each, not just "a process with this service's name exists"): sales-service's
`/crm/credit-limit-review/run`, `/invoices/mark-overdue` (real write, 20 invoices updated across
tenants, correct per-tenant counts verified directly against the DB), `/quotations/expire-stale`;
crm-service's `/loyalty/expire-points`, `/crm/segment-membership/refresh`,
`/crm/campaigns/dispatch-scheduled`, `/crm/automation-rules/dispatch-due`,
`/crm/journeys/evaluate-due`, `/referral/attribute-purchases`; scheduler-service's
`accounting.zero-value-journal-audit` triggered for real via `POST /jobs/:name/trigger` and
confirmed `Job completed` in the service's own log. Zero Postgres errors across every call.

**Status: the reconciled deferred-call-site list from the invoices/journal_entries/payments audits
is now fully closed**, except for the small number of genuinely cross-tenant reads documented
inline at each site above (`ExportScheduleJob.syncSchedules`, `campaigns/dispatch-scheduled`'s and
`automation-rules/dispatch-due`'s due-item source queries, `LoyaltyService.expirePoints`'s initial
scan) — each is a deliberate, now-documented design choice, not a silently-skipped gap.
