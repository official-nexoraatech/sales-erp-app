# CP-9 Follow-up (2) — Tenant-Configurable Notification Rate Limit (R14) — COMPLETION REPORT

## Generated: 2026-07-15 | Status: R14 resolved, live-verified with measured before/after data

> This is a second follow-up to `CP-9_COMPLETION.md`, produced after the user asked to "make all
> this limit configuration in tenant level, but make some higher limits for tenant as well" —
> directly targeting R14, the top-priority open item left by `CP-9_FOLLOWUP_COMPLETION.md` section 3. Per this initiative's convention, neither prior report is modified — this is a new document.

---

## 1. WHAT WAS WRONG (recap of R14)

`CampaignService.send()` calls `notification-service`'s `/notifications/send-raw-internal` once
per recipient. That route is authenticated via `x-internal-key`, not a JWT, so `request.auth` is
never populated. The service's global `@fastify/rate-limit` plugin (`max: 200, timeWindow: '1
minute'`, keyed by `tenantOrIpKeyGenerator`) falls back to IP-keying for this route — meaning
every tenant's campaign sends shared **one combined 200/min budget**, scoped to the calling host's
IP (in practice, `sales-service`'s own IP, since it's the only caller). A prior live measurement
(300 recipients, single tenant) found exactly 200/300 succeeding and 100/300 failing with a
generic `"Delivery failed"` error — no indication it was a rate limit, and no way for any tenant to
get more throughput even if their business genuinely needed it.

## 2. WHAT WAS BUILT

- **Schema**: `tenant_communication_settings.notification_rate_limit_per_minute` (migration
  `0062`), nullable — `null` means "use the platform default (200/min)", so every tenant that
  never configures one sees no behavior change.
- **notification-service**: new `domain/tenantRateLimit.ts` module (`checkTenantNotificationRateLimit`)
  — a Redis INCR+EXPIRE fixed-window counter, keyed per-tenant (`ratelimit:notif:{tenantId}:{minuteBucket}`),
  reusing the Redis connection the service already held (previously only for tenant-status
  pub/sub). Wired into `send-raw-internal`: looks up the tenant's configured limit (falling back
  to the 200/min default), checks it, and returns `429 TENANT_RATE_LIMIT_EXCEEDED` with a specific
  message if exceeded.
- **sales-service**: `GET`/`PUT /crm/communication-settings` extended to read/write
  `notificationRateLimitPerMinute`. `CampaignService.send()`'s recipient-failure handling now
  surfaces the specific reason (`"Rate limit exceeded — see Campaign Settings to raise this
tenant's notification send limit"` for a 429, or the upstream error message otherwise) on
  `campaign_recipients.error_message`, instead of the previous hardcoded `"Delivery failed"` for
  every failure type.
- **web-frontend**: `CampaignSettingsPage.tsx`'s Approval & Frequency section gained a
  "Notification send rate limit, per minute" field (optional; platform default noted inline).

## 3. A SECOND, DEEPER BUG FOUND DURING LIVE VERIFICATION

Live-verifying the fix (firing 250-recipient batches at bounded concurrency against the real
running services, for a default-limit tenant and a tenant configured with a 500/min override)
initially produced nonsense results — the override tenant got **0/250** through, not more than the
default tenant. Root cause: the pre-existing _global_ `@fastify/rate-limit` plugin described above
still wraps this route (nothing had ever exempted it), so its IP-keyed 200/min ceiling was still
being hit **before** the new per-tenant check ever ran — the exact same bug, one layer up, that the
new tenant-aware check was supposed to fix. Fixed by exempting the route from the global plugin
(`{ config: { rateLimit: false } }`) so only the tenant-aware Redis check applies to it. Added a
regression test (`tenant-rate-limit-route.test.ts`, "exempt from the global IP-keyed rate limiter")
that registers a real `@fastify/rate-limit` instance with a deliberately low global max and proves
`send-raw-internal` is unaffected by it, while a sibling route is — so this class of bug can't
silently reappear if a future route reuses this pattern without the exemption.

## 4. LIVE VERIFICATION — MEASURED, NOT ASSERTED

Both services rebuilt and restarted (with the user's explicit per-restart confirmation, as this
session's established pattern requires). Two real dev tenants (id 2, left on the platform default;
id 9, given a temporary `notificationRateLimitPerMinute = 500` override, reverted after the test)
were each sent 250 real requests directly to the live `send-raw-internal` endpoint, 20 at a time:

| Tenant                            | Total | Succeeded | Rejected (`TENANT_RATE_LIMIT_EXCEEDED`) |
| --------------------------------- | ----- | --------- | --------------------------------------- |
| 2 — default (200/min)             | 250   | **200**   | **50**                                  |
| 9 — configured override (500/min) | 250   | **250**   | **0**                                   |

This is the exact scenario the fix is meant to guarantee: at an identical volume that throttles a
default-limit tenant, a tenant with a configured higher limit is not throttled at all.

## 5. TESTS AND BUILD STATUS

- `tenantRateLimit.test.ts` (8 tests, unit-level counter logic) — pass.
- `tenant-rate-limit-route.test.ts` (5 tests: 429 on default-limit exceed, no throttle on
  override, success within default budget, 401 before rate-limiting on bad internal key, and the
  global-plugin-exemption regression test) — pass.
- Full `notification-service` suite (58 tests), full `sales-service` suite (142 tests), full
  `web-frontend` suite (87/88 — the one failure is the pre-existing, unrelated
  `navigation.test.ts` issue noted in every prior report) — all re-run clean.
- Both services typecheck (`tsc --noEmit`) and build clean; lint shows only pre-existing warnings
  and pre-existing errors in files this work didn't touch (`preexisting_lint_debt`).

## 6. NOT IN SCOPE / NOT CHANGED

- `/notifications/send-internal` (the general single-notification internal route, used outside
  campaigns) has the same IP-keying characteristic but was not touched — it isn't the high-fan-out
  path R14 was about, and touching it wasn't asked for.
- CP-5's fan-out is still synchronous in-request batching (`BATCH_SIZE = 25`), not a background
  worker/queue. That remains a separate, larger, un-scoped design decision noted in R14's original
  text — this fix makes the existing synchronous model tenant-fair and tenant-configurable, it does
  not replace it.
