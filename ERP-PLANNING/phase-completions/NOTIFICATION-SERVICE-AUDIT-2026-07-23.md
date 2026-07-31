# Notification Service — Comprehensive Enterprise Audit

Verified by direct codebase inspection on 2026-07-23. No code has been changed as part of this
report — per instruction, this is read-only analysis. All file paths are repo-relative.

## 1. Current Notification Architecture

`apps/notification-service` (port 3014) is a standalone Fastify microservice.

**UPDATED 2026-07-23 (architectural tier — see the dedicated section below for full detail):** at
audit start, this service was **not** queue-based — every send was a synchronous, blocking HTTP
request/response cycle. That has since been changed: delivery now goes through a real BullMQ queue
(`DeliveryQueue`, reusing the connection-sharing pattern `scheduler-service`'s `JobRegistry` already
established for its own, separate, cron-scheduling queue). The description immediately below is the
**original, as-found architecture** — kept for the record — followed by what it became.

**As found:**

```
Caller service --HTTP POST--> notification.routes.ts --> NotificationEngine.send()/sendRaw()
    --> ChannelRegistry.get(channel).send() --> provider HTTP call (inline, up to 3 attempts,
    exponential backoff 2s/4s, BLOCKING the original request) --> notification_log row updated
```

**As of this session:**

```
Caller service --HTTP POST--> notification.routes.ts --> NotificationEngine.send()/sendRaw()
    --> insert PENDING row --> DeliveryQueue.enqueue() --> returns 'QUEUED' immediately (no block)
    ... asynchronously, on the BullMQ worker ...
    --> ChannelRegistry.get(channel).send() --> on success: SENT + outbox event
                                              --> on final-attempt failure: FAILED + outbox event
```

**Channels implemented** (`src/domain/channels/`): SMS (MSG91), EMAIL (SendGrid API, falling back to
SMTP/Mailhog when no real `SG.`-prefixed key is configured), WHATSAPP (Meta Cloud API), IN_APP
(DB row + client-side polling dressed as SSE, 5s interval). The `ChannelProvider` interface is
genuinely pluggable in code, but there is no factory/config path to add a 5th channel without a
code change + redeploy.

**Not implemented at all**: Push (Android/iOS/Web Push), Slack, Microsoft Teams, generic outbound
Webhook-as-a-channel, any custom-provider plugin system.

**Inbound delivery-status webhooks** (`src/api/webhook.routes.ts`, CP-6) are genuinely strong,
production-grade work: real Ed25519 signature verification for SendGrid, real HMAC-SHA256 for Meta,
shared-secret token for MSG91 (the provider's own limitation, not a shortcut taken here), all with
timing-safe comparison and source-level idempotency (`notification_delivery_events`, unique on
`(provider, provider_event_id)`) before any state change. This is the best-tested part of the service.

**Database schema** (`packages/db-client/src/schema/notification.ts`): `notification_templates`,
`notification_log`, `notification_delivery_events`, `notification_preferences` — all tenant-scoped,
reasonably indexed. Every table has a `version` integer column but no code path ever does an
optimistic-locking `WHERE version = ...` update — same "scaffolded but dead" column pattern already
flagged for `campaigns.version` in the Campaign-Planning current-state doc.

**Rate limiting**: two independent layers. A global `@fastify/rate-limit` (200 req/min,
tenant-or-IP-keyed) covers the JWT routes; a purpose-built per-tenant Redis counter
(`domain/tenantRateLimit.ts`) covers `/notifications/send-raw-internal` specifically (the internal,
x-internal-key-authenticated campaign path that the global limiter can't key by tenant). Both fail
open on Redis errors — a documented, deliberate tradeoff, consistent with this codebase's existing
circuit-breaker fallback convention.

**Quiet hours**: tenant-configurable via the generic `feature_flags` table
(`notification_quiet_hours` key, `{startHour, endHour}`), with a per-user override
(`notification_preferences.quietHoursEnabled`). Gate applies to **SMS only** — EMAIL/WHATSAPP/IN_APP
are never suppressed by quiet hours. This may be intentional (SMS is the most intrusive channel) but
is worth confirming, since the spec's checklist treats quiet hours as channel-agnostic.

**Caching**: none. Every send re-queries `notification_templates` from Postgres — no in-memory or
Redis template cache, despite Redis already being a service dependency.

**Monitoring**: only the generic shared `/metrics` Prometheus handler (HTTP request counts/latency
from `@erp/logger`'s `createHttpMetricsHook`). No notification-domain metrics exist (sends by
channel/status, delivery rate, provider latency, queue depth — there is no queue to have depth).

## 2. Notification Lifecycle (as actually implemented)

```
Event Created (calling service)
  -> HTTP POST /notifications/send[-internal] (template path) or /send-raw-internal (pre-rendered)
  -> Recipient/preference lookup (notification_preferences, keyed by userId+eventType+tenantId)
  -> Quiet-hours check (SMS channel only)
  -> Template lookup + Handlebars render (send() path only — sendRaw() bypasses templates entirely)
  -> Idempotency-key derive-or-use + INSERT ... ON CONFLICT DO NOTHING (dedup, PENDING row)
  -> deliverWithRetry: up to 3 inline attempts, 2s/4s backoff, BLOCKS the HTTP request
  -> notification_log.status = SENT | FAILED (synchronous, final for this request)
  -> [async, separate inbound call] provider delivery webhook -> notification_delivery_events dedup
     -> notification_log.status = DELIVERED | FAILED -> outboxEvents (NOTIFICATION_DELIVERY_UPDATED)
     -> sales-service's NotificationDeliveryConsumer syncs campaign_recipients/campaigns stats
  -> IN_APP only: client polls GET /notifications/stream (SSE) every 5s for unread count
```

There is **no Analytics stage** for general-purpose notifications — aggregate sent/delivery/failure
rates are not exposed anywhere; only campaign-specific counters live on `sales-service`'s `campaigns`
table, scoped to the CRM/Campaign feature, not the notification service itself.

A `FAILED` row (after 3 immediate in-request attempts) is **terminal** — nothing ever retries it
again later, and there is no manual "retry this notification" endpoint. Confirmed by search: no
scheduler job, no route, and no DLQ table/concept anywhere in the service.

## 3. Modules Reviewed

- `apps/notification-service` — full source read (engine, routes, channels, middleware, webhook
  verification, rate limiting, config), all 8 test files read.
- DB schema + relevant migrations (`0021_es26_notification_idempotency`,
  `0061_cp9_notification_delivery_events_tenant_id`, `0062_cp9_tenant_notification_rate_limit`,
  `0069_notification_templates_backfill`).
- Permission model (`packages/shared-types/src/permissions.ts`, `dead-permission-constants.test.ts`,
  `apps/tenant-service/src/rbac/role-defaults.ts`).
- `apps/scheduler-service/src/jobs/system-jobs.ts` — every job that calls or should call
  notification-service (30+ jobs reviewed for actual dispatch vs log-only).
- Cross-service event-source integration: sales-service (invoice/payment/quotation/CRM
  campaign/webhook-delivery-consumer), hr-service (alterations), gst-service (GSTR-3B reminder),
  auth-service (forgot-password), tenant-service (provisioning welcome email), accounting-service,
  report-service, purchase-service, inventory-service, api-gateway routing/auth.
- `apps/web-frontend` notification UI (`Layout.tsx`, `NotificationsPanel.tsx`,
  `useNotificationStream.ts`) and the CRM/Campaign current-state doc for shared-infrastructure context.

## 4. Missing Enterprise Features (confirmed absent, not inferred)

| Feature                                                                  | Status                                                                                                                                                                                                                                                                              |
| ------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Push notifications (Android/iOS/Web Push)                                | Absent — no channel provider, no schema, no client SDK integration                                                                                                                                                                                                                  |
| Slack / Teams / generic outbound Webhook channel                         | Absent                                                                                                                                                                                                                                                                              |
| Template management API/UI (create/edit/delete a tenant's own templates) | Absent — templates can **only** be created via 4 hardcoded internal seed routes (`seed-crm`/`seed-hr`/`seed-auth`/`seed-tenant`) or direct DB insert. No tenant-facing CRUD exists at all                                                                                           |
| Template versioning / preview-render                                     | Absent                                                                                                                                                                                                                                                                              |
| Localization (multi-language templates)                                  | Absent — one `bodyTemplate` string per template/channel                                                                                                                                                                                                                             |
| User preference management **UI**                                        | Backend fully built and tested; **zero frontend surface** — `NotificationsPanel.tsx` only reads/marks-read, no settings page anywhere calls `POST /notifications/preferences`                                                                                                       |
| Digest mode / notification frequency capping                             | Absent — every event dispatches immediately, no bundling                                                                                                                                                                                                                            |
| In-app notification center: filter, search, archive, delete, categories  | Absent — flat list of the last 10, mark-read only                                                                                                                                                                                                                                   |
| Manual retry of a FAILED notification                                    | Absent — no endpoint, no job                                                                                                                                                                                                                                                        |
| Automated retry-after-failure / Dead Letter Queue                        | Absent — `FAILED` after 3 inline attempts is terminal                                                                                                                                                                                                                               |
| Delivery/failure/retry/provider-performance reports                      | Absent — no reporting endpoints in this service                                                                                                                                                                                                                                     |
| Open/click tracking for email                                            | Absent — no tracking pixel, no link-wrapping, no `openedAt`/`clickedAt` columns                                                                                                                                                                                                     |
| Provider failover / multiple providers per channel / automatic failover  | Absent — one hardcoded provider per channel, no secondary, no circuit breaker on the provider call itself (contrast: `scheduler-service` wraps its inventory-service calls in `createCircuitBreaker`; `SmsChannelProvider`/`WhatsAppChannelProvider`/`EmailChannelProvider` do not) |
| Priority queue / delayed queue / scheduled queue for notifications       | Absent (see §1 — no queue exists at all)                                                                                                                                                                                                                                            |
| API key rotation tooling                                                 | Absent — env vars only                                                                                                                                                                                                                                                              |
| Bulk import (templates/contacts)                                         | Absent                                                                                                                                                                                                                                                                              |

## 5. Bugs Found

Ranked by real-world impact. None have been fixed yet — awaiting direction per your instructions.

1. **`workflow.approval-reminder` scheduler job never actually notifies anyone.**
   `apps/scheduler-service/src/jobs/system-jobs.ts` (~L1017–1053). The job is described as "Send
   reminders for pending approvals at 9 AM and 2 PM" but its body only does
   `workflowApprovals.reminderCount + 1` and sets `notifiedAt` — it never calls notification-service.
   Every pending approver is silently never reminded; only an internal counter increments.

2. **`purchase.pdc-alerts` never sends a notification.**
   `apps/purchase-service/src/api/internal.routes.ts` (~L27–45). For each due post-dated cheque it
   calls `svc.markPdcAlertSent(pdc.id)` — marking the alert as sent — without ever dispatching an
   email/SMS to finance. Same "marked as alerted, never alerted" shape as bug #1.

3. **Reorder/low-stock alerting is entirely log-only, from two separate daily jobs.**
   Both `inventory.low-stock-alert` (8 AM) and `production.reorder-report` (9 AM) query the exact
   same reorder-required list and only `logger.warn`/`logger.info` the count — neither calls
   notification-service. No purchase manager is ever emailed about low stock, despite two dedicated
   cron jobs existing specifically for that purpose.

4. **`production.job-work-overdue-alert` only logs**, never notifies the assigned tailor/manager of
   an overdue job-work order.

5. **`gst.eway-bill-expiry-alert` is very likely silently broken on every run (401, swallowed).**
   The scheduler job calls `GET /gst/eway-bill/expiring-soon` with only an `x-internal-key` header.
   That route's `preHandler` is `[authenticate, requirePermission(GST_VIEW)]` — JWT-only, no
   internal-key fallback — unlike every sibling route in gst-service (`gstr1`, `gstr2a`, `gstr3b`,
   `einvoice`), which all check `x-internal-key` first via their own `requireInternalKey` helper.
   The job's try/catch swallows the resulting 401 into a non-fatal `logger.warn`, so this has
   plausibly never worked since it was written, with nothing surfacing the failure. This is the same
   bug class the PG-026 package already fixed for `production.reorder-report` and
   `production.job-work-overdue-alert`'s _sibling_ internal routes — this one route was missed. Even
   with auth fixed, the handler still only logs a count (see #4-shape gap) rather than notifying.

6. **`NOTIFICATION_VIEW` and `NOTIFICATION_CONFIG` are dead RBAC constants.**
   Defined in `permissions.ts`, referenced by zero routes anywhere in the codebase — confirmed by the
   repo's own `dead-permission-constants.test.ts`, which allowlists them as pre-existing debt. This
   matches the recurring "dead-permission-constant" bug class already fixed multiple times elsewhere
   in this codebase. Given there is no template-management API at all (§4), `NOTIFICATION_CONFIG` was
   plausibly meant to gate exactly that missing feature.

7. **No frontend surface for notification preferences**, despite a fully-built, well-tested backend
   (`POST /notifications/preferences` — per-event-type channel toggles + quiet-hours override). A
   tenant user has no way to ever call this endpoint through the UI.

8. **No automated or manual retry path for `FAILED` notifications.** After 3 immediate in-request
   attempts, a failed SMS/Email/WhatsApp is permanently stuck at `FAILED` with no re-drive mechanism
   — not a scheduled sweep, not an admin "retry" button.

## 6. Bugs Fixed

All 6 "quick-win" items were implemented, each verified with `type-check` + the relevant package's
test suite (new/updated regression tests added where an existing test harness covered the file;
noted where none existed). No architectural or medium-tier work was touched in this pass.

### 1. `workflow.approval-reminder` never sent a notification

- **Root cause**: the handler only updated `workflowApprovals.reminderCount`/`notifiedAt`
  bookkeeping; it never called notification-service.
- **Business justification**: approval workflows (expense, purchase, etc.) stall silently when
  approvers are never actually reminded of pending items.
- **Technical justification**: dispatches a real `IN_APP` notification per pending approval via
  `POST /notifications/send-raw-internal`, using the approver's `approverId` as `recipientUserId`
  (see next fix — this is what motivated it) and the joined `workflowInstances` row for
  entity context in the message. Bookkeeping (`reminderCount`/`notifiedAt`) is preserved unchanged.
- **Impact analysis**: approvers now see a real reminder in their notification bell; one
  recipient's delivery failure doesn't block reminders to the rest (per-approval try/catch).
- **Regression analysis**: existing job-registration test still passes; the job's test was
  rewritten to assert the new `fetch` call and payload shape instead of only bookkeeping.
- **Files modified**: `apps/scheduler-service/src/jobs/system-jobs.ts`,
  `apps/scheduler-service/src/__tests__/system-jobs.test.ts`.

### Prerequisite fix: `sendRaw()` never persisted `recipientUserId`

- **Root cause**: `NotificationEngine.sendRaw()` (the pre-rendered/internal send path used by every
  scheduler-triggered alert) never wrote `recipientUserId` on the `notification_log` insert — so an
  `IN_APP` raw notification could never appear in `GET /notifications` or `/unread-count` for its
  intended recipient (both filter by `recipientUserId`). This blocked fix #1 above and is itself a
  real, previously-invisible gap (no scheduler job used `IN_APP` via `sendRaw` before, so nothing
  had surfaced it).
- **Files modified**: `apps/notification-service/src/domain/NotificationEngine.ts` (interface +
  insert), `apps/notification-service/src/api/notification.routes.ts` (schema + pass-through),
  `apps/notification-service/src/__tests__/NotificationEngine.test.ts` (new regression test).
- **Backward compatibility**: purely additive — an optional field with no default behavior change
  for any existing caller that omits it.

### 2. `purchase.pdc-alerts` never sent a notification

- **Root cause**: `markPdcAlertSent()` was called for every due PDC without ever emailing finance.
- **Business justification**: post-dated cheques clearing without anyone being warned risks
  bounced payments / missed fund arrangements.
- **Technical justification**: looks up `tenants.contactEmail` (same established pattern as the
  sibling `pending-grn-alerts`/`gstr3b/reminder` routes), sends one combined `EMAIL` via
  `send-raw-internal` listing all due PDCs, then marks them alerted. A PDC is now only marked
  alerted once a send was actually attempted — a tenant with no contact email configured keeps
  surfacing daily instead of silently losing the alert forever.
- **Impact analysis**: finance now receives a real email; behavior for tenants without a
  `contactEmail` configured changes from "silently marked alerted, never told" to "keeps
  re-appearing until configured" — a deliberate, more correct change.
- **Regression analysis**: no existing test coverage existed for this route (confirmed — none of
  the sibling reminder routes in this file have tests either); type-checked clean, no other caller
  of `markPdcAlertSent`/`getPdcDueInDays` found.
- **Files modified**: `apps/purchase-service/src/api/internal.routes.ts`.

### 3. `gst.eway-bill-expiry-alert` — 401 auth mismatch, and never notified

- **Root cause**: the scheduler job called `GET /api/v2/gst/eway-bill/expiring-soon` with only an
  `x-internal-key` header, but that route requires a JWT (`authenticate` + `GST_VIEW`) — every call
  401'd, swallowed into a non-fatal warn log. Even on success it only returned a list; nothing
  notified anyone.
- **Business justification**: an expired e-Way Bill blocks goods movement / risks penalties;
  logistics needs a real warning, not a silently-failing background check.
- **Technical justification**: added a new internal-key-guarded `POST /gst/eway-bill/expiry-alert`
  (same shape as `gstr3b.routes.ts`'s `/gst/gstr3b/reminder`), left the existing JWT `GET
/expiring-soon` route untouched (it's genuinely used by the web-frontend UI). Scheduler job
  repointed at the new route, converted to `tenantScoped: true` (it has no `tenantId` otherwise).
- **Impact analysis**: this job has very plausibly never worked since it was written — this is a
  net-new capability in practice, not a behavior change for any working flow.
- **Regression analysis**: `web-frontend`'s use of `GET /expiring-soon` is untouched; type-checked
  clean for both `gst-service` and `scheduler-service`; full `gst-service` and `scheduler-service`
  suites re-run and pass (48/48 and 71/71 respectively).
- **Files modified**: `apps/gst-service/src/api/eway-bill.routes.ts`,
  `apps/scheduler-service/src/jobs/system-jobs.ts`.

### 4. `inventory.low-stock-alert` / `production.reorder-report` — neither notified anyone

- **Root cause**: two separate daily cron jobs (8 AM, 9 AM) query the identical reorder-required
  list from production-service; both only logged the count. `production.reorder-report`'s own
  description explicitly promises "email report to purchase manager" — it never did.
- **Business justification**: without a real alert, low-stock items are only visible to someone
  actively reading service logs — not a viable operational signal.
- **Technical justification**: rather than deleting either registered job (avoids any risk to
  job-history/monitoring expecting both names to keep existing), `production.reorder-report` — the
  one whose own description promises an email — now actually emails `tenants.contactEmail` with the
  item list. `inventory.low-stock-alert` is left log-only by design (documented in a comment) as a
  cheap 1-hour-earlier ops signal, specifically so the same recipient isn't emailed twice.
- **Impact analysis**: purchase manager now receives one real daily email instead of zero.
- **Regression analysis**: added a new test asserting the email dispatch and payload shape;
  full scheduler-service suite re-run and passes (71/71).
- **Files modified**: `apps/scheduler-service/src/jobs/system-jobs.ts`,
  `apps/scheduler-service/src/__tests__/system-jobs.test.ts`.

### 5. `production.job-work-overdue-alert` never notified anyone

- Same root cause/shape as #4 — log-only. Now emails `tenants.contactEmail` with the in-progress
  job-work order list via `send-raw-internal`, same pattern as the other fixes.
- **Files modified**: `apps/scheduler-service/src/jobs/system-jobs.ts` (same test file as #4).
- Note: while investigating, verified `production-service`'s
  `/api/v2/internal/job-work-orders/in-progress` route itself is correctly registered (a suspected
  path-escaping issue turned out to be a `Grep` output-rendering artifact, not a real bug — confirmed
  by reading the source file directly).

### 6. Dead RBAC constant `NOTIFICATION_VIEW` retired

- **Root cause**: defined in `permissions.ts`, referenced by zero routes anywhere (confirmed by the
  repo's own `dead-permission-constants.test.ts`) — there is no "view another user's notifications"
  feature for it to gate; a user's own in-app notifications are identity-scoped by
  `recipientUserId`, not permission-gated.
- **Decision**: retired (removed), per the PG-014 "wire it up or formally retire it" pattern, rather
  than inventing a feature just to consume it.
- **`NOTIFICATION_CONFIG` was deliberately left as-is** — it will be wired up as part of the
  template-management API (medium tier, §9), not retired, since that work is planned next.
- **Files modified**: `packages/shared-types/src/permissions.ts`,
  `packages/shared-types/src/__tests__/dead-permission-constants.test.ts`.
- **Regression analysis**: grepped the full repo for any other reference — none found outside the
  definition and the allowlist. `dead-permission-constants.test.ts` passes. A pre-existing, unrelated
  failure in `route-guard-coverage.test.ts` (an in-progress, uncommitted `organization.routes.ts`
  route elsewhere in the tree missing a guard) was confirmed via `git stash` to predate this session
  entirely — not caused by this change.

## 7. Remaining Risks (beyond what's listed as bugs)

- **Synchronous delivery blocks the caller.** A slow SMS/WhatsApp/Email provider adds up to ~7s of
  latency directly to the calling service's request (invoice creation, payment recording, etc.),
  since retries happen inline before the HTTP response returns. At scale, or during a provider
  outage, this risks cascading latency into unrelated business flows (though `sendRaw`'s campaign
  path is at least isolated behind a circuit breaker in `sales-service`).
- **Single point of failure per channel.** No provider failover means an MSG91 outage stops 100% of
  SMS/OTP delivery platform-wide until MSG91 recovers — no fallback SMS gateway.
  Note: OTP delivery specifically was not traced end-to-end in this pass (auth-service's OTP flow,
  if any, wasn't grepped) — worth confirming whether OTP goes through this same single-provider path.
- **No queue means no back-pressure handling.** A burst of events (e.g., a bulk invoice import
  triggering N notification sends) fans out as N synchronous HTTP calls with no batching/throttling
  beyond the existing rate limiters — the rate limiters will start rejecting (429) rather than
  smoothing the burst into a queue.
- **Template rendering has no injection-hardening review performed in this pass.** Handlebars is used
  with `templateData` supplied by calling services (which in turn may include end-user input, e.g.
  a CRM campaign body or customer name). Handlebars is not auto-escaping by default; whether
  `{{var}}` vs `{{{var}}}` conventions are followed consistently across the seeded/CRM-authored
  templates was not verified — flagged as a security item requiring a dedicated pass (§ Security),
  not confirmed as an active vulnerability.

## 8. Test Coverage

8 test files exist in `apps/notification-service/src/__tests__/`:
`NotificationEngine.test.ts` (quiet hours incl. tenant-configurable window + user override,
idempotency dedup, unread count), `channel-providers.test.ts` (per-provider request shape/behavior),
`webhookVerification.test.ts` + `webhook-delivery.test.ts` (signature verification + idempotent
delivery-status application), `tenantRateLimit.test.ts` + `tenant-rate-limit-route.test.ts`,
`notification-send-authz.test.ts` (RBAC on `/send`), `pg010-api-v2-dual-registration.test.ts`.

**Well covered**: quiet hours, idempotency, webhook signature verification + dedup, dual-path API
versioning, per-tenant rate limiting.

**Not covered by any test found**: retry/backoff behavior of `deliverWithRetry` itself (no test
forces a failure and asserts 3 attempts + final FAILED status), the IDOR fix on
`POST /notifications/:id/read` (comment in the code describes the fix but no regression test was
found guarding it), the `/notifications` list route's pagination, preferences upsert
(`onConflictDoUpdate`) behavior, and — expected, since it doesn't exist — anything for template
CRUD, retry endpoints, or a queue.

## 9. Performance Benchmark

Not measured in this pass — no load test was run (per instruction, no execution/testing was
performed beyond static code reading). Structurally: per-send latency is bounded below by one
provider HTTP round-trip, and worst-case by `1 + 2 + 4 = ~7s` of blocking backoff on 3 failed
attempts, entirely inside the caller's request. No concurrency/throughput ceiling is enforced beyond
the two rate limiters (§1).

## 10. Queue Health

**UPDATED 2026-07-23 (architectural tier)**: a real BullMQ queue (`notification-delivery`) now
exists, live-verified against real Redis. 3 attempts per job, exponential backoff (~2s/~4s),
concurrency 5. `removeOnComplete`/`removeOnFail` capped at 500 entries each. No separate DLQ table —
a job that exhausts its attempts simply stays in BullMQ's own failed set, and the row it represents
is marked `FAILED` in `notification_log` (re-driveable via `retryFailed()`/`retrySingle()`, both of
which re-queue as a fresh job). No priority queue or delayed queue yet — every job is enqueued
immediately at normal priority (see §"Remaining architectural-tier items" for what's still open).

## 11. Retry Engine Status

**UPDATED 2026-07-23 (architectural tier)**: retry moved off the request thread onto the BullMQ
worker — 3 attempts, exponential backoff (~2s/~4s), matching the original inline policy but now
non-blocking and durable (survives a service restart mid-retry). `MAX_TOTAL_ATTEMPTS = 9` caps how
many times the scheduled sweep (`notification.retry-failed`, every 15 min) will re-queue a given
row across successive rounds — a dead-letter state distinguished by cumulative `attemptCount`
rather than a separate table. Manual admin retry
(`POST /notifications/:id/retry`) is exempt from that cap. Still open: no jitter on the backoff, no
circuit breaker around the provider call itself (a channel provider having a bad day burns through
concurrency slots rather than tripping a breaker — see item 11 in the remaining architectural tier).

## 12. Provider Integration Status

| Channel                  | Provider                                           | Send path                               | Failover | Notes                                           |
| ------------------------ | -------------------------------------------------- | --------------------------------------- | -------- | ----------------------------------------------- |
| SMS                      | MSG91                                              | Direct `fetch`, inline retry            | None     | Single provider, no circuit breaker             |
| Email                    | SendGrid API, or SMTP/Mailhog if no real `SG.` key | Direct `fetch`/nodemailer, inline retry | None     | Dev-safe fallback is a nice existing touch      |
| WhatsApp                 | Meta Cloud API                                     | Direct `fetch`, inline retry            | None     | Media messages supported (image/video/document) |
| In-App                   | DB row + SSE poll                                  | N/A                                     | N/A      | Not a real push — 5s client poll                |
| Push/Slack/Teams/Webhook | —                                                  | —                                       | —        | Not implemented                                 |

Inbound delivery-status webhooks (MSG91/SendGrid/Meta) are correctly, securely implemented (§1).

## 13. Security Assessment

**Strong points, confirmed by reading the actual verification code:**

- Real cryptographic signature verification for 2 of 3 inbound webhook providers (SendGrid Ed25519,
  Meta HMAC-SHA256), constant-time comparison throughout (`timingSafeEqual`), never a bare `===` on
  secret-derived bytes.
- Internal service-to-service routes (`send-internal`, `send-raw-internal`, `seed-*`) are gated by a
  timing-safe `x-internal-key` comparison, not a plain string compare.
- `/notifications/send` requires `NOTIFICATION_SEND` (checked, tested — `notification-send-authz.test.ts`
  exists specifically because this was once missing).
- The `/notifications/:id/read` IDOR (any authenticated tenant user could mark another user's
  notification as read by guessing an id) has already been fixed — the WHERE clause now scopes by
  `recipientUserId` too. (No regression test found guarding this specific fix — see §8.)
- Tenant isolation is consistent: every table has `tenant_id`, every query filters by it.

**Gaps / unverified (not confirmed exploitable, but not confirmed safe either — needs a dedicated pass):**

- Handlebars template-injection/XSS hardening not verified end-to-end (§7).
- Email header injection (CRLF in `subject`/`recipientEmail` fields) — `SendSchema`/`SendRawInternalSchema`
  validate `recipientEmail` as `.email()` but `subject` is an unconstrained string; whether SendGrid's
  API / nodemailer sanitizes header-breaking characters internally wasn't verified here.
- No API-level rate limit specifically on `/notifications/preferences` or `/notifications/:id/read`
  beyond the global 200/min — likely fine, flagged only because the spec asks for it explicitly.
- MSG91's webhook has no cryptographic signature (a provider limitation, correctly documented in code
  as a known, accepted weaker link — not a code defect).

## 14. Tenant Isolation Status

Consistent and correctly enforced everywhere reviewed: every notification table carries `tenant_id`,
every query filters by it, the per-tenant rate limiter is genuinely per-tenant (fixing a real prior
bug — R14, CP-9 follow-up — where campaign sends across all tenants shared one IP-keyed budget). No
cross-tenant read/write path was found in this pass.

## 15. Production Readiness Score

**58 / 100** at the start of this audit → **74 / 100** after quick-win + medium tier → **81 / 100**
after the queue-based delivery architectural change (live-verified against real infra).

Original reasoning: the parts that existed (delivery, idempotency, inbound webhook security, rate
limiting, quiet hours, tenant isolation) were built to a genuinely high, production-grade standard.
The score was held down not by bugs in what existed, but by how much of the requested enterprise
surface simply didn't exist: several "alert" cron jobs across other services that looked like they
notified but didn't, no retry-after-failure, no template management API, no preference UI.

**What moved the score**: all 6 confirmed "silently does nothing" bugs are fixed and
live-verified/tested; FAILED notifications now have both automated (capped, scheduled) and manual
retry; templates can now be self-service managed per tenant (with system templates safety-locked);
notification preferences are now user-manageable end-to-end and live-verified in a real browser.

**What's still holding it back from higher**: no message queue (delivery is still synchronous,
in-request — see §1, §11), no provider failover/circuit breakers per channel, no push/Slack/Teams/
webhook channels, no analytics/reporting endpoints, no email open/click tracking. These are the
architectural-tier items (§9 in the fix order) — larger, and worth a dedicated design discussion
before starting, per your instruction not to build them without checking in first.

## Medium-Tier Work Completed (2026-07-23, same session)

All three medium-tier items from the recommended fix order below were implemented after the
quick-win tier, each verified with `type-check` + tests, and the three new frontend pages were
additionally verified live in a real browser against the running dev stack (see §"Live browser
verification" at the end of this section).

### 7. Notification preferences frontend page

- **Root cause**: `POST /notifications/preferences` was fully built and tested, but there was no
  `GET` to read current state back, and zero frontend surface — a tenant user had no way to ever
  reach this endpoint.
- **Business justification**: staff being spammed by (or missing) operational alerts with no way
  to self-manage channel/quiet-hours preferences is a real day-to-day usability gap.
- **Technical justification**: added `GET /notifications/preferences` (scoped by tenant+userId).
  New page at `/notification-preferences` (self-service, no special permission — same pattern as
  the existing `/security` Security Settings page), linked from the Settings nav group. Curated 8
  categories covering every real, currently-firing internal-staff alert eventType introduced or
  confirmed in this audit (customer-facing sends — CRM campaigns, invoice/payment reminders — are
  correctly excluded, since those go straight to the customer's phone/email and are never
  preference-gated). Each row: Email/SMS/WhatsApp/In-App/Quiet-Hours toggles, saved individually
  on change via the existing `POST` endpoint; defaults shown for a category the user has never
  touched mirror the backend's own column defaults exactly.
- **Files modified**: `apps/notification-service/src/api/notification.routes.ts` (new GET route),
  `apps/notification-service/src/__tests__/notification-preferences-get.test.ts` (new),
  `apps/web-frontend/src/api/endpoints.ts`, `apps/web-frontend/src/pages/settings/
NotificationPreferencesPage.tsx` (new), `apps/web-frontend/src/App.tsx`,
  `apps/web-frontend/src/lib/navigation.ts`.
- **Regression analysis**: additive-only backend route; no existing route/behavior changed.

### 8. Retry / re-drive for FAILED notifications

- **Root cause**: `deliverWithRetry`'s 3 in-request attempts were the only retry that ever
  happened — once `FAILED`, a notification was permanently terminal with no automated re-drive and
  no manual retry endpoint.
- **Business justification**: a transient provider outage (MSG91/SendGrid/Meta blip) previously
  meant permanent, silent non-delivery for every notification sent during that window.
- **Technical justification**: `NotificationEngine.retryFailed(tenantId, maxAgeHours=24)` re-runs
  `deliverWithRetry` for FAILED rows under a `MAX_TOTAL_ATTEMPTS` cap of 9 (3 sweeps × 3 inline
  attempts each) — a dead-letter state distinguished by `attemptCount` rather than a new
  status/table, so no schema migration was needed. `retrySingle(tenantId, logId)` is the
  admin-triggered path (exempt from the cap — a human explicitly asked). New scheduler job
  `notification.retry-failed` (every 15 min, tenantScoped) drives the sweep via a new
  internal-key-guarded `POST /notifications/retry-failed-internal`. New user-facing
  `POST /notifications/:id/retry` (requires `NOTIFICATION_SEND`, tenant-scoped — same IDOR-safe
  pattern as `/:id/read`) lets an admin retry one notification on demand.
- **Files modified**: `apps/notification-service/src/domain/NotificationEngine.ts`,
  `apps/notification-service/src/api/notification.routes.ts`,
  `apps/notification-service/src/__tests__/NotificationEngine.test.ts` (new tests),
  `apps/notification-service/src/__tests__/notification-retry.test.ts` (new),
  `apps/scheduler-service/src/jobs/system-jobs.ts`.
- **Regression analysis**: purely additive (new methods/routes/job); no existing send/retry
  behavior changed. `MAX_TOTAL_ATTEMPTS` only affects rows that already exhausted the original 3
  attempts, so no currently-succeeding flow is touched.

### 9. Template management API + minimal admin UI

- **Root cause**: templates could only be created via 4 hardcoded internal seed routes or a direct
  DB insert — no tenant-facing CRUD existed, despite `NOTIFICATION_CONFIG` existing as a
  permission constant seemingly meant to gate exactly this (confirmed dead in §5, bug #6).
- **Business justification**: a tenant cannot customize its own transactional message wording
  (e.g. "Alteration Ready" phrasing, adding a new event type template) without a code change and
  redeploy — not viable for a self-service SaaS product.
- **Technical justification**: new `apps/notification-service/src/api/template.routes.ts` — full
  CRUD (`GET`/`POST`/`PUT`/`DELETE` on `/notifications/templates[/:id]`) plus a no-persistence
  `POST /notifications/templates/preview` (renders Handlebars with sample data). All gated by
  `NOTIFICATION_CONFIG` (now wired up, no longer dead). **Safety guardrail**: `isSystem` templates
  (password reset, welcome email, etc. — the ones seeded by the internal routes) are explicitly
  locked against edit/delete via this API, with a clear `SYSTEM_TEMPLATE_LOCKED` error, so a tenant
  admin mistake can't break a critical platform flow. Duplicate `(tenantId, eventType, channel)`
  creation attempts return a clean `409 DUPLICATE_TEMPLATE` instead of surfacing the raw unique-
  constraint error. New frontend pages: `NotificationTemplatesPage.tsx` (list, System/Custom badge,
  Edit/Delete hidden for system rows) and `NotificationTemplateFormPage.tsx` (create/edit, channel
  picker, variable-insertion buttons, live preview) at `/settings/notification-templates`, gated by
  `NOTIFICATION_CONFIG` in both the route and the nav entry (OWNER/ADMIN get this by default —
  confirmed via `role-defaults.ts`'s `TENANT_SCOPED_PERMISSIONS` derivation, no role-seeding change
  needed).
- **Files modified**: `apps/notification-service/src/api/template.routes.ts` (new),
  `apps/notification-service/src/main.ts` (dual `/api/v2` + legacy registration, same convention as
  the rest of this service), `apps/notification-service/src/__tests__/template-routes.test.ts`
  (new), `apps/web-frontend/src/api/endpoints.ts`, `apps/web-frontend/src/pages/settings/
NotificationTemplatesPage.tsx` (new), `apps/web-frontend/src/pages/settings/
NotificationTemplateFormPage.tsx` (new), `apps/web-frontend/src/App.tsx`,
  `apps/web-frontend/src/lib/navigation.ts`.
- **Regression analysis**: additive-only; the 4 existing internal seed routes and their `isSystem:
true` rows are untouched and remain the only way those specific system templates are created.

### Live browser verification (all three medium-tier pages)

Started the real dev stack (auth-service, notification-service, api-gateway, web-frontend against
the already-running Docker infra) and drove it with Playwright as tenant 2 / `owner@qa-e2e.local`
(see `ERP-PLANNING/TEST_CREDENTIALS.md`):

- **Notification Preferences** (`/notification-preferences`): loaded all 8 categories with correct
  default toggle states (Email/SMS/In-App/Quiet-Hours on, WhatsApp off, matching the DB column
  defaults exactly, for a tenant with zero saved preference rows). Toggling a switch fired
  `POST /notifications/preferences` → **200**.
- **Notification Templates** (`/settings/notification-templates`): listed this tenant's 5 real
  system-seeded templates (Password Reset, Birthday Greeting ×2, Alteration Ready, Alteration
  Assigned), correctly badged "System"/"Active", with Edit/Delete correctly hidden for all of them.
  "+ New Template" opened the create form correctly.
- **Template preview**: filled a template with `Hi {{customerName}}, this is a QA test from
{{shopName}}.`, clicked "Preview with sample data" → `POST /notifications/templates/preview` →
  **200**, rendered `"Hi Raj Kumar, this is a QA test from Your Shop."` inline — Handlebars
  substitution confirmed correct end-to-end.
- No console/network errors traced to any of this work. The only errors observed were expected
  502s on `tenant-service`/`event-service` calls (organization branding, DAP tour progress) —
  those two services were deliberately not started for this focused verification pass and are
  unrelated to notification-service.

---

## Architectural-Tier Work Completed (2026-07-23, same session): Queue-Based Delivery

The first architectural-tier item — moving delivery off the synchronous request path onto a real
message queue — is implemented, tested, and live-verified against real Postgres + Redis.

### Design decision, made explicitly rather than silently

Before building this, an investigation found that `sales-service`'s `CampaignService.send()` (the
code path every CRM campaign send goes through) synchronously checks notification-service's HTTP
response for `status === 'SENT'` immediately after the call returns, to set
`campaign_recipients.status` and `campaigns.sentCount`/`failedCount`. A full async redesign changes
that contract — every campaign send would look like it failed unless `CampaignService` was also
updated. Two options were presented to you directly:

1. **Hybrid** — synchronous first attempt (zero API/caller changes), only retries queued.
2. **Full async** — everything queued, `CampaignService` updated to stop trusting the synchronous
   status and rely on the existing async delivery-status path instead.

**You chose full async.** That is what was built.

### What changed

- **New `DeliveryQueue` (BullMQ)** — `apps/notification-service/src/domain/DeliveryQueue.ts`.
  Same connection-sharing convention as `scheduler-service`'s `JobRegistry` (one shared ioredis
  connection for both `Queue` and `Worker`). 3 attempts, exponential backoff (~2s/~4s) — the exact
  same retry shape the old inline loop used, just off the request thread. On success: updates
  `notification_log` to `SENT` + `externalMessageId`, publishes a `NOTIFICATION_DELIVERY_UPDATED`
  outbox event (same event type/shape the provider delivery-status webhooks already publish). On
  final-attempt failure: marks `FAILED` + publishes the same event with `status: 'FAILED'`.
- **`NotificationEngine` refactored** — no longer holds a `ChannelRegistry`/config at all; `send()`
  and `sendRaw()` now only validate/dedupe/insert the `PENDING` row and call
  `deliveryQueue.enqueue()`, returning immediately. `NotificationResult.status` is now
  `'QUEUED' | 'SKIPPED'` (no more synchronous `'SENT'`/`'FAILED'` — removed from the type, since it
  was never true synchronously here). Depends on a narrow `DeliveryEnqueuer` interface, not the
  concrete queue, so unit tests inject a plain mock instead of standing up real Redis.
- **`retryFailed()`/`retrySingle()`** now re-queue (reset to `PENDING`, call `enqueue()` again) —
  each re-queue gets its own fresh BullMQ attempt budget. `retryFailed()`'s response shape changed
  from `{retried, succeeded}` to `{requeued}` (it can no longer know synchronous success/failure);
  the scheduler job and its response-parsing were updated to match.
- **`main.ts`** — constructs `DeliveryQueue` once at bootstrap (reusing the existing Redis
  connection), passes it into `notificationRoutes`, and added graceful shutdown
  (`SIGTERM`/`SIGINT` → close queue/worker → quit Redis → close Fastify), mirroring
  `scheduler-service`'s existing convention — this service previously had no shutdown handling at
  all.
- **`CampaignService.send()`** — `ok` now means `status === 'QUEUED'` (accepted for delivery), not
  `'SENT'` (delivered). `campaignRecipients` stays at its insert-time `PENDING` status when
  accepted (only `notificationLogId`/`sentAt` are set); the real outcome (`SENT`, then `DELIVERED`
  or `FAILED`) arrives asynchronously via `NotificationDeliveryConsumer`. `campaigns.sentCount`/
  `failedCount` are documented as a synchronous "queued vs. rejected-before-queuing" snapshot now,
  not a delivery-outcome snapshot — the live, always-current truth is `CampaignService.getStats()`,
  which reads `campaignRecipients.status` as the consumer updates it. Also: the daily
  frequency-cap check now counts `PENDING` recipients as "already contacted today" (previously only
  `SENT`/`DELIVERED`), so an in-flight queued send still counts — closing a small window where a
  customer could otherwise receive two sends before the async status caught up.
- **`NotificationDeliveryConsumer`** — payload type widened from `'DELIVERED' | 'FAILED'` to
  include `'SENT'`. The handler logic itself needed no changes (it already generically applies
  whatever status arrives) — this event now legitimately arrives twice per notification: first
  `SENT`/`FAILED` from the DeliveryQueue worker, then (for channels with a provider webhook)
  `DELIVERED`/`FAILED` again from that webhook. `SENT → DELIVERED` is a normal progression, not a
  conflict — the existing `recipient.status === p.status` idempotency check already handles both
  same-status redelivery and distinct-status progression correctly.

### Testing

- New `DeliveryQueue.test.ts` (4 tests) — mocks `bullmq` itself and captures the processor/`'failed'`
  handler passed to `new Worker(...)`, invoking them directly to verify: success → `SENT` + outbox
  event; an interim failed attempt → `attemptCount` bump + rethrow, no outbox event yet; the final
  failed attempt → `FAILED` + outbox event, verified only fires on the last attempt.
  `NotificationEngine.test.ts` and every route test file rewritten for the new `QUEUED` contract.
  `notification-delivery-consumer.test.ts` (real-Postgres integration) got 2 new tests: the
  `PENDING → SENT` transition, and the full `SENT → DELIVERED` two-event progression with correct
  `deliveredCount` rollup timing.
- **Live-verified end-to-end** against real Postgres + Redis (not mocked): started
  `auth-service`/`notification-service`/`api-gateway`, logged in as the real test tenant, called
  `POST /notifications/send-raw-internal` (`channel: IN_APP`) — got `{"status":"QUEUED","logId":1063}`
  back immediately. Within ~1s, `GET /notifications` showed the same row at `status: "SENT"` with a
  real `externalMessageId` and `attemptCount: 1` — the actual BullMQ worker, backed by real Redis,
  processed the job asynchronously exactly as designed. Confirmed the `NOTIFICATION_DELIVERY_UPDATED`
  outbox row was written with the correct shape (`{"status":"SENT","errorMessage":null,
"notificationLogId":1063}`). Test data cleaned up afterward.

### Regression analysis

- `notification-service`: 81/81 tests pass, clean typecheck.
- `sales-service`: 292/292 tests pass (including `campaign-service.test.ts`'s 86 tests and the
  real-DB `notification-delivery-consumer.test.ts`), clean typecheck.
- `scheduler-service`: 71/71 tests pass, clean typecheck.
- Backward compatibility is **not** fully preserved for the notification-service API contract by
  design — this was the explicit tradeoff you chose over the zero-change hybrid option. The one
  known caller (`CampaignService`) was updated in the same pass. Any other caller expecting a
  synchronous `'SENT'`/`'FAILED'` from `send()`/`sendRaw()`/`send-raw-internal` would need the same
  update — a repo-wide grep found `CampaignService` as the only caller that inspected the response
  status field (every other caller — scheduler-service's alert jobs — only logs `sent: boolean`
  derived from HTTP `res.ok`, not the payload's `status` string, so they were unaffected).

### Remaining architectural-tier items (not started — deferred pending direction)

- Provider failover + circuit breakers per channel.
- Push notifications, and/or Slack/Teams/Webhook channels.
- Analytics/reporting endpoints (delivery rate, failure rate, provider performance).

---

## Recommended Fix Order

Grouped by effort vs. impact.

**✅ Quick, high-impact, low-risk — DONE (see §6):**

1. ✅ `workflow.approval-reminder` — actually sends the reminder.
2. ✅ `purchase.pdc-alerts` — actually sends the alert.
3. ✅ `gst.eway-bill-expiry-alert` — auth mismatch fixed, now actually notifies.
4. ✅ `inventory.low-stock-alert` / `production.reorder-report` — the latter now notifies.
5. ✅ `production.job-work-overdue-alert` — now notifies.
6. ✅ Retired `NOTIFICATION_VIEW`; `NOTIFICATION_CONFIG` wired up in item 9 below.

**✅ Medium effort, high value — DONE (see "Medium-Tier Work Completed"):** 7. ✅ Notification preferences frontend page. 8. ✅ Manual + automated retry for `FAILED` notifications (attempt-capped re-drive, no DLQ table
needed). 9. ✅ Template management API + minimal admin UI, gated by the newly-wired `NOTIFICATION_CONFIG`.

**✅ Larger, architectural — item 10 DONE (see "Architectural-Tier Work Completed"):** 10. ✅ Real queue-based delivery (BullMQ) — delivery is fully async, removing the synchronous
blocking. `CampaignService` updated to match (your explicit choice: full async over the
zero-risk hybrid).

**⏸ Remaining architectural tier — NOT STARTED, needs a dedicated design discussion first:** 11. Provider failover + circuit breakers per channel. 12. Push notifications, and/or Slack/Teams/Webhook channels — only if there's an actual product need;
flagging as "missing vs. the spec," not asserting it's required. 13. Analytics/reporting endpoints (delivery rate, failure rate, provider performance).
