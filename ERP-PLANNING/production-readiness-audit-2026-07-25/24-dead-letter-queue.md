# DLQ Admin Feature — Production Readiness Audit (2026-07-25)

## Scope note (important correction to the assignment premise)

The task named `apps/search-service/src/api/dead-letters.routes.ts` as the backend behind
`apps/web-frontend/src/pages/admin/distributed/DLQPage.tsx`. **That pairing is factually wrong.**
There are two entirely separate DLQ-shaped features in this codebase:

1. **`apps/event-service/src/api/dlq.routes.ts`** — mounted at `/api/v2/admin/dlq/*`, gated by
   `DLQ_VIEW`/`DLQ_MANAGE`. This is what `dlqApi` in `apps/web-frontend/src/api/endpoints.ts`
   (lines 1940-1959) calls, and it is what **`DLQPage.tsx`** (the audit target,
   `apps/web-frontend/src/pages/admin/distributed/DLQPage.tsx`) actually renders.
2. **`apps/search-service/src/api/dead-letters.routes.ts`** — mounted at
   `/api/v2/admin/search/dead-letters`, gated by `SEARCH_REINDEX`. This is a _different_,
   narrower page: `apps/web-frontend/src/pages/admin/SearchAnalyticsPage.tsx`, via
   `searchDeadLettersApi` (endpoints.ts:1814-1822). It is filtered to only
   `headers->>'consumer' = 'search-service'` rows.

Both were audited (the search-service one more lightly, since it isn't the page named in scope),
but all UI/UX findings below are about **`DLQPage.tsx` + `event-service`'s `dlq.routes.ts`**,
the real pairing.

Also a correction/refinement to today's stated architectural premise: `dlq_items` does **not**
have exactly one writer. There are two:

- `OutboxRelayWorker.processBatch()` (`apps/event-service/src/outbox/OutboxRelayWorker.ts:189`)
  — writes on Kafka **publish** failure, for any of the 15 services' outbox events.
- `search-service`'s own Kafka consumer, `eventDispatcher` in `apps/search-service/src/main.ts:92`
  — writes on **its own** Elasticsearch-sync **consume**-side failure.

Grepping the whole `apps/` tree for `insert(dlqItems)` / `dlqItems).values` confirms these are the
_only_ two write sites in the entire codebase. `dlq.routes.ts`'s queries carry no consumer filter,
so `DLQPage.tsx` shows the union of both. Every other service's Kafka consumer (accounting, gst,
sales, purchase, hr, scheduler, ...) still has no path into `dlq_items` at all for its own
business-logic handler failures — those still silently no-op via the broken `inbox_events`
FAILED-status update, as already established. **This audit tests the DLQ admin page/API against
its real, narrow scope: outbox-publish failures (all services) + search-index-sync failures
(search-service only).**

---

## What works (verified live, 2026-07-25, tenant 2 "QA E2E Test Co" + local Postgres/Kafka/Prometheus)

- **DB reality confirmed**: `SELECT COUNT(*) FROM dlq_items` = 0 rows, for any tenant, right now
  (`docker exec erp-postgres-primary psql -U erp -d erp`). No historical rows to act on from any
  session.
- **API contract works correctly end-to-end for the empty state**, tested live through the
  gateway (`http://localhost:3000/api/event/api/v2/admin/dlq/...`) with a real OWNER JWT:
  - `GET /admin/dlq/summary` → `{"data":[]}` (200)
  - `GET /admin/dlq/:topic` on a topic with no rows → `{"data":[],"meta":{"page":1,"size":50,"total":0,"totalPages":0}}` (200)
  - `POST /admin/dlq/:topic/replay` on a topic with 0 PENDING rows → `{"data":{"replayed":0,"failed":0,"topic":"..."}}` (200, correctly a no-op, not an error)
  - `POST /admin/dlq/:id/discard` on a non-existent id → `404 NOT_FOUND`
  - `GET /admin/dlq/:topic/:id` on a non-existent id → `404 NOT_FOUND`
- **RBAC enforced correctly, live**: `CASHIER` (no `DLQ_VIEW`) → `403 {"code":"FORBIDDEN","message":"Missing permission: DLQ_VIEW"}`. `OWNER`'s JWT was decoded and confirmed to carry both `DLQ_VIEW` and `DLQ_MANAGE`. Role matrix in `apps/tenant-service/src/rbac/role-defaults.ts`: `DLQ_MANAGE` → OWNER/ADMIN/SUPER_ADMIN only (via the "all tenant-scoped permissions" wildcard); `DLQ_VIEW` (view-only, no mutate) → additionally ACCOUNTANT, ACCOUNTANT_SUPERVISOR, AUDITOR. This is a sane admin/finance-tier split, and the frontend correctly hides the Replay/Discard buttons for view-only holders (`hasPermission(PERMISSIONS.DLQ_MANAGE)` guards in `DLQPage.tsx:159,263`) while the backend independently re-enforces the same check server-side (`requirePermission(PERMISSIONS.DLQ_MANAGE)` in `dlq.routes.ts`) — real defense in depth, not UI-only.
- **Multi-tenant isolation is correct**: every query in `dlq.routes.ts` (summary, list, get-by-id, replay, discard) filters on `eq(dlqItems.tenantId, request.auth.tenantId)` pulled from the verified JWT, not from client input. No cross-tenant read/write path found.
- **Replay is a genuine Kafka republish, not a status-flip stub**: `worker.publishRaw()` (`OutboxRelayWorker.ts:270-282`) calls the real `producer.send()` with the item's original topic/payload/headers. Confirmed by reading the implementation, not just trusting a comment.
- **Prometheus alerting claim re-verified and holds**: `erp_dlq_depth` gauge is defined, exposed on `/metrics` (`curl http://localhost:3023/metrics` shows the `# HELP`/`# TYPE` lines), and is refreshed every poll cycle by `OutboxRelayWorker.refreshGauges()` (`OutboxRelayWorker.ts:97-114`), which queries `dlq_items WHERE status='PENDING' GROUP BY topic` — i.e. it covers the _same_ narrow scope as the admin page (both writers), consistently. `infrastructure/docker/prometheus/alert-rules.yml:35-45` has a real `DLQDepthHigh` alert (`sum(erp_dlq_depth) by (topic) > 10` for 2m, routed to `slack-infra-alerts`, with a runbook pointing at this exact admin page). The 2026-07-23 "fixed" claim is accurate for this narrow scope — but by the same token, the alert can only ever fire for outbox-publish or search-sync failures; a business-logic pileup in accounting/gst/sales consumers would never move this gauge and would never page anyone.
- **The search-service sibling feature also works live**: `GET /api/v2/admin/search/dead-letters` on port 3017 directly → 200, `{"content":[],"totalElements":0,...}`. Its own test suite (`apps/search-service/src/__tests__/dead-letters-routes.test.ts`) passes 7/7 including the 403-without-permission case.
- **Confirmation dialogs exist for both destructive actions** (Replay All Pending, Discard) — `useConfirm()` calls in `DLQPage.tsx:166-171` and `270-275` with accurate, specific warning copy ("it will re-trigger whatever side effects the original message caused" / "This cannot be undone").

## Could not live-trigger a fresh dead letter

Zero historical `dlq_items` rows exist for any tenant, so there was nothing pre-existing to act
on. Forcing a _fresh_ one would require either (a) killing the Kafka broker mid-publish, which
would disrupt the shared running dev environment other work depends on, or (b) hand-producing a
malformed message directly onto a real topic that other services also consume (e.g. an
`erp.invoice.*` topic is consumed by both search-service and accounting-service), risking
destabilizing an unrelated consumer for a read-only audit. Both were judged too invasive. Instead,
correctness of the replay/discard code paths was verified by (1) direct code reading of
`publishRaw`, (2) the existing purpose-built unit test `apps/event-service/src/__tests__/dlq-replay.test.ts`
(success / Kafka-throws / partial-failure cases) which exercises the exact logic — though see the
Medium finding below, this test currently fails for an unrelated reason and needs a fix before it
can be trusted again — and (3) live testing of every endpoint's contract in the zero-rows state,
which is the state this environment is actually in today.

---

## Bugs / gaps found

### 1. HIGH — Page and tour copy overstate the feature's actual coverage, creating false operator confidence

**Evidence:**

- `DLQPage.tsx:96`: subtitle _"Inspect and replay failed Kafka messages"_ — no scope qualifier.
- `DLQPage.tsx:129`: empty-state copy _"Failed Kafka messages will appear here grouped by topic."_
- `dlq.tour.ts:23`: _"Each item is a message that a consumer failed to process after its normal retries — held here so it isn't silently lost."_
- `dlq-complete-guide.tour.ts:23`: _"When a Kafka consumer fails to process a message after its normal retries, it lands here instead of being silently dropped — this is the safety net for that failure class."_

None of this is true for the overwhelming majority of "a Kafka consumer fails to process a
message" cases in this platform. Per the write-site grep above, only (a) outbox-relay
**publish**-side failures and (b) search-service's own ES-**sync** failures ever reach this table.
A consumer-side business-logic failure in accounting-service, gst-service, sales-service,
purchase-service, hr-service, or scheduler-service — e.g. an invoice event that crashes
`InvoiceAccountingConsumer` — does **not** land here; it silently no-ops via the separate, broken
`inbox_events` FAILED-status path (established earlier this session).

**Business impact:** An operator who checks this page, sees "0 pending across 0 topics," and
reads copy that says this is "the safety net for that failure class" will reasonably conclude the
platform has zero stuck event-processing failures right now. That conclusion would be wrong for
every service except search-service and the outbox relay itself. This is exactly the kind of
false-confidence gap that turns a monitoring feature into a liability — it actively discourages
looking elsewhere (e.g. at `inbox_events` FAILED counts, or service logs) because the "DLQ" page
implies it already has that covered.

**Fix direction (not applied — audit only):** Either (a) scope the copy explicitly — e.g. "Failed
Kafka _publishes_ and search-index syncs" instead of "failed Kafka messages" / "a consumer failed
to process," or (b) add a visible banner noting this view does not cover other services'
consumer-side processing failures, until the `inbox_events` FAILED path is actually fixed and
wired to the same table.

### 2. MEDIUM — DLQ's own automated regression tests are currently broken (false-red, not false-green, but zero real coverage)

**Evidence (all reproduced live via `pnpm --filter <pkg> test`):**

- `apps/event-service/src/__tests__/dlq-replay.test.ts` — all 3 tests fail: `expected 200, got 401`.
- `apps/event-service/src/__tests__/permission-granularity.test.ts` — all 20 tests fail the same
  way, including the ones named `'DLQ (view)' permission boundary` and `'DLQ (manage)' permission boundary`.

**Root cause:** both files mint their own test JWTs with `.setIssuer('erp-test')` (or omit it),
but `verifyAccessToken` in `packages/platform-sdk/src/auth.ts:31-32` now requires the issuer claim
to equal `process.env['JWT_ISSUER'] ?? 'erp-auth-service'` — a defense-in-depth fix (referenced in
that file's own comment as "F17") that was applied to the shared SDK but never propagated to these
test files' token-minting helpers. Every request in these two suites now fails auth verification
before it ever reaches the permission check, so they fail with 401 instead of the 200/403 they're
asserting.

This is **not unique to DLQ** — it's a platform-sdk-wide test-token rot that likely affects other
event-service tests using the same self-signed-JWT pattern — but it directly means DLQ's replay
success/failure/partial-failure logic and its DLQ_VIEW/DLQ_MANAGE RBAC boundary currently have
**zero working automated regression coverage**, even though both behave correctly right now per
live manual testing above. A future regression in either area would not be caught by CI.

### 3. LOW — No pagination controls in the DLQPage.tsx item list

`dlqApi.list(topic)` is called with no `page`/`size` args (`DLQPage.tsx:62`), so it's always
page 1 / size 50 (the backend default). There's no "load more" or page control in the JSX. If a
topic ever accumulates more than 50 items in one status, items beyond the first 50 are not
individually viewable or discardable through this UI (bulk "Replay All Pending" is unaffected —
it queries and processes all PENDING rows server-side regardless of what the frontend has
fetched). Low severity given current real-world volumes (0 today, and the narrow write-scope
above), but worth fixing before this table could plausibly grow large.

### 4. LOW — Dead client code

`dlqApi.getById` is defined in `endpoints.ts:1951-1952` but never called anywhere in `DLQPage.tsx`
(the detail modal is populated from the already-fetched list row, not a dedicated fetch). Harmless,
but an orphaned endpoint.

### 5. INFO — PLATFORM_OPERATOR cannot see DLQ for any tenant

`operator@platform.local`'s JWT carries only `PLATFORM_TENANT_MANAGE` and
`PLATFORM_CONTENT_MANAGE` — no `DLQ_VIEW`/`DLQ_MANAGE` in any tenant (confirmed by decoding a live
login token). This is consistent with the platform's existing design split (`PLATFORM_ONLY_PERMISSIONS`
are reserved exclusively for that role; tenant-scoped functional permissions are deliberately
withheld from it — see `role-defaults.ts:1-14`), so it is **not** classified as a bug. It is,
however, worth flagging: DLQ health is inherently a cross-tenant infra-reliability signal (the
`DLQDepthHigh` Slack alert already treats it that way), yet the only people who can act on it
per-tenant are that tenant's own OWNER/ADMIN/SUPER_ADMIN — a platform ops responder paged by
`DLQDepthHigh` has no in-app way to inspect or replay the item without impersonating a tenant user
first.

---

## Readiness score: 58/100

**Justification.** The feature that exists works correctly for what it actually does: RBAC is
real and enforced both client- and server-side, tenant isolation is airtight, replay genuinely
republishes to Kafka rather than faking success, the empty/404/403 states all behave exactly as
they should, and the Prometheus alert wired to it is real and consistent in scope with the table
it reads. None of that is inflated or fake.

The score is held down, not because the narrow mechanism is broken, but because of what an
operator would reasonably infer from using it:

- It only ever covers a small slice — outbox-publish failures plus one service's own
  index-sync failures — of what "Kafka message processing failure" means across a 15-service
  platform, and (Finding #1) **the page's own copy claims broader coverage than that**, actively
  working against an operator's ability to notice the gap. A DLQ console that can create false
  confidence about system health is worse than one that is honestly labeled as narrow.
- Its regression test suite is currently red for reasons unrelated to the feature's own logic
  (Finding #2), so the one thing that would normally catch a future break in replay/RBAC behavior
  currently would not.
- Minor UX ceiling (no pagination) if item volume ever grows.

If Finding #1's copy were fixed to accurately describe scope, and #2's test-token issuer bug were
fixed, this would be an 80+/100 feature. As shipped today, it is a well-built mechanism wrapped in
copy that overstates its own reliability guarantee — which is the more dangerous failure mode for
a monitoring/ops tool.
