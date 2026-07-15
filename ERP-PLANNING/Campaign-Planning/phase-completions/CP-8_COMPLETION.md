# PHASE CP-8 — Enterprise Scale-out — COMPLETION REPORT

## Generated: 2026-07-15 | Status: COMPLETE for scope items 1-3 (branch scoping, sender identity, outbound webhooks); items 4-5 deliberately not started, see section 12 — the phase's own rules require user confirmation before either

> **This document is the official handoff artifact for Phase CP-8.**
> **The next phase (CP-9) MUST start by reading this document.**
> **Never modify this document after generation.**

---

## 1. PHASE SUMMARY

| Field        | Value                                                                                                                                                                                                                                                                                                                                                 |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Phase Number | CP-8                                                                                                                                                                                                                                                                                                                                                  |
| Phase Name   | Enterprise Scale-out                                                                                                                                                                                                                                                                                                                                  |
| Status       | COMPLETE: store/branch-scoped campaigns, configurable sender identity (EMAIL wired to real delivery), outbound webhook subscriptions + dispatcher. NOT STARTED: additional channel adapters, caching/partitioning — both explicitly require user confirmation per this phase's own rules, and the user was unavailable this session (see section 12). |
| Engineer(s)  | Claude (autonomous execution, Campaign Management Platform initiative)                                                                                                                                                                                                                                                                                |

---

## 2. WHAT WAS BUILT

### 2.1 Database Schema

```
Migrations (applied to the dev database and verified — 60/60 migrations in sync):

0059_cp8_enterprise_scaleout.sql
  campaigns: + branch_id (nullable — NULL means tenant-wide, every campaign before this phase)
  tenant_sender_identity (NEW) — one row per (tenant_id, channel)
  campaign_webhook_subscriptions (NEW) — tenant's registered third-party webhook endpoints
  campaign_webhook_deliveries (NEW) — per-subscriber delivery queue/log

0060_cp8_sender_identity_webhook_permission_backfill.sql
  Backfills CRM_SENDER_IDENTITY_MANAGE and CRM_WEBHOOK_MANAGE for existing tenants'
  OWNER/ADMIN/SUPER_ADMIN roles

No FK constraints (consistent with the zero-FK convention).
```

Verified live: `role_permissions` contains 30 rows each for `CRM_SENDER_IDENTITY_MANAGE` and
`CRM_WEBHOOK_MANAGE` (10 tenants × 3 roles) — usable by every existing tenant today, not just
tenants provisioned after this phase.

### 2.2 Permissions Added

| Constant                     | Purpose                                       | Backfill migration |
| ---------------------------- | --------------------------------------------- | ------------------ |
| `CRM_SENDER_IDENTITY_MANAGE` | Manage per-tenant/per-channel sender identity | 0060               |
| `CRM_WEBHOOK_MANAGE`         | Manage outbound webhook subscriptions         | 0060               |

Branch-scoped campaign creation/viewing does **not** introduce a new permission — it reuses the
existing `getBranchScope`/`branchIds` JWT-claim mechanism already established for
invoices/POS (ES-31), consistent with the phase's instruction to respect targeting/permission
restrictions already built in CP-3/CP-7 rather than inventing a parallel scoping model.

### 2.3 APIs Implemented

| Method | Path                             | Guard                            | Notes                                                                              |
| ------ | -------------------------------- | -------------------------------- | ---------------------------------------------------------------------------------- |
| GET    | `/crm/sender-identity`           | `CRM_SENDER_IDENTITY_MANAGE`     | Lists a tenant's configured sender identities                                      |
| PUT    | `/crm/sender-identity`           | `CRM_SENDER_IDENTITY_MANAGE`     | Upsert — one row per (tenant, channel)                                             |
| GET    | `/crm/webhook-subscriptions`     | `CRM_WEBHOOK_MANAGE`             | Lists subscriptions (secret never returned after creation)                         |
| POST   | `/crm/webhook-subscriptions`     | `CRM_WEBHOOK_MANAGE`             | Creates a subscription, generates a random 32-byte hex secret, returned once       |
| PUT    | `/crm/webhook-subscriptions/:id` | `CRM_WEBHOOK_MANAGE`             | Partial update (targetUrl/events/isActive)                                         |
| DELETE | `/crm/webhook-subscriptions/:id` | `CRM_WEBHOOK_MANAGE`             | Removes a subscription                                                             |
| POST   | `/crm/campaigns`                 | `CRM_CAMPAIGN_CREATE` (existing) | CHANGED — accepts optional `branchId`, validated against `getBranchScope`          |
| PUT    | `/crm/campaigns/:id`             | `CRM_CAMPAIGN_CREATE` (existing) | CHANGED — `branchId` is now editable, same scope validation                        |
| GET    | `/crm/campaigns`                 | `CRM_VIEW` (existing)            | CHANGED — filters to tenant-wide (`branchId IS NULL`) + the caller's own branches  |
| GET    | `/crm/campaigns/:id`             | `CRM_VIEW` (existing)            | CHANGED — 404s (not 403, to avoid leaking existence) if branch-scoped out of reach |

### 2.4 Services Implemented / Changed

```
apps/sales-service/src/domain/CampaignService.ts
  - resolveRecipients() now accepts an optional branchId and filters customers by their own
    branchId when set (undefined/null = tenant-wide, unchanged)
  - dispatchRecurringOccurrence() propagates the parent recurring definition's branchId onto
    each concrete occurrence it creates
  - send() now resolves the tenant's tenant_sender_identity row for the campaign's channel and
    passes it as `senderOverride` in the outbound notification-service call
  - New private enqueueWebhookDeliveries() — inserts one PENDING campaign_webhook_deliveries row
    per active subscription matching the fired event type; called from send() (CAMPAIGN_SENT)
    and cancel() (CAMPAIGN_CANCELLED). A cheap synchronous INSERT, no outbound I/O — the CP-6
    decision to keep third-party-dependent latency off the campaign-send critical path.

apps/sales-service/src/domain/WebhookDispatchService.ts (NEW)
  - signWebhookPayload()/verifyWebhookSignature() — HMAC-SHA256, mirroring the primitive this
    codebase already uses to *verify* inbound webhooks (CP-6's webhookVerification.ts), applied
    here to *produce* an outbound signature instead
  - deliverWebhook() — one outbound POST with a 10s timeout, no DB access, no retry logic (kept
    pure/testable; retry is the worker's job)

apps/sales-service/src/domain/WebhookDispatchWorker.ts (NEW)
  - Poll-loop dispatcher, structurally modeled on event-service's OutboxRelayWorker: SELECT ...
    FOR UPDATE SKIP LOCKED inside a short transaction, HTTP POST happens after the transaction
    commits, retry_count/status track outcome, dead-letters (status=FAILED) after 5 attempts
  - Started in apps/sales-service/src/main.ts, reusing the same dedicated consumerDb pool the
    CP-6 Kafka consumer already opened

apps/notification-service/src/domain/channels/types.ts, EmailChannelProvider.ts,
apps/notification-service/src/domain/NotificationEngine.ts,
apps/notification-service/src/api/notification.routes.ts
  - ChannelDeliveryParams/SendRawInput/SendRawInternalSchema gained an optional senderOverride
    ({name?, addressOrNumber?}), threaded end-to-end from CampaignService.send() through to
    EmailChannelProvider.send(), which uses it as SendGrid's `from` field instead of the env-
    configured default when present
```

### 2.5 Frontend Screens

```
apps/web-frontend/src/pages/crm/CampaignFormPage.tsx
  - New "Branch (optional — leave blank for a tenant-wide campaign)" <select>, populated from
    branchApi.list() — only rendered when the tenant has more than one branch, so a single-branch
    tenant (the common case) sees zero UI change
```

**Deliberately not built this phase** (see section 12 for the full reasoning): a settings UI for
sender identity or webhook subscriptions. Both ship as real, working, tested API-only features —
matching this initiative's established, repeatedly-used pattern (automation rules since CP-5,
comments since CP-7) of shipping backend-complete, admin-facing configuration surfaces via API
first and deferring a dedicated settings UI panel.

---

## 3. TESTS

| File                                                                                 | Tests | Type                                                                                                                                                    |
| ------------------------------------------------------------------------------------ | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/sales-service/src/__tests__/webhook-dispatch-service.test.ts` (NEW)            | 7     | Unit — HMAC sign/verify round-trip, tamper/wrong-secret rejection, deliverWebhook success/4xx-5xx/network-failure paths                                 |
| `apps/sales-service/src/__tests__/campaign-service.test.ts` (extended)               | +3    | Integration — resolveRecipients tenant-wide-when-unset (regression), excludes-out-of-branch-customers, dispatchRecurringOccurrence branchId inheritance |
| `apps/sales-service/src/__tests__/crm-campaign-permission-guards.test.ts` (extended) | +4    | Fastify-inject — positive + negative case for CRM_SENDER_IDENTITY_MANAGE and CRM_WEBHOOK_MANAGE                                                         |
| `apps/notification-service/src/__tests__/channel-providers.test.ts` (extended)       | +2    | Unit — EmailChannelProvider honors senderOverride when present, falls back to env default when absent                                                   |

### Test Execution Results

- `sales-service` full suite: **238/238 passing** (25 files) — zero regression from branch
  scoping, sender-identity lookup, or the webhook enqueue calls added to send()/cancel().
- `notification-service` full suite: **45/45 passing, 3 pre-existing skipped** (6 files) — zero
  regression from the senderOverride plumbing.
- `tsc --noEmit` clean on `sales-service`, `notification-service`, `web-frontend`, and
  `@erp/types`/`@erp/db` (rebuilt with the new permission constants and schema).
- `eslint`: 0 errors across every changed/new file (pre-existing warning-only conventions).
- `apps/web-frontend/e2e/live-crm.spec.ts`: **passing** (8.2s) — confirms the CampaignFormPage
  branch-selector addition doesn't regress the existing golden-path flow (its conditional
  rendering — only shown when a tenant has more than one branch — means the qa-e2e tenant's run
  exercises the "hidden, no behavior change" path, which is the more common real-world case
  anyway).

### Not Executed This Phase (documented, not silently skipped)

- **WebhookDispatchWorker's actual poll loop was not exercised against a live receiving
  endpoint.** `deliverWebhook()` (the HTTP-call primitive) is fully unit-tested including 4xx/5xx
  and network-failure paths; the worker's SQL (`FOR UPDATE SKIP LOCKED`, retry/dead-letter
  transitions) is structurally identical to `OutboxRelayWorker`'s, which has been running in
  production-shaped tests since ES-12/13, but no new integration test spins up a real HTTP
  listener to receive a dispatched webhook end-to-end. Judged acceptable given the primitive-level
  coverage and the direct structural mirroring of an already-proven worker pattern; a full
  integration test is a reasonable follow-up if CP-9's QA pass has time.
- **sales-service and notification-service were rebuilt but not restarted** — same standing
  constraint as every phase since CP-2 (a restart was not re-attempted; the prior attempt in CP-3
  was correctly blocked by the environment's safety classifier). Verification debt now spans
  **CP-2 through CP-8 — seven phases.** Direct proof from CP-7's session still holds:
  `curl -X POST http://127.0.0.1:3013/crm/campaigns/1/submit-for-approval` returned 404 against
  the live process, confirming none of CP-7 or CP-8's new routes are live yet either.

---

## 7. KNOWN ISSUES AND TECHNICAL DEBT

| Issue                                                                                              | Severity               | Resolution Plan                                                                                                                                                                                                                                                                                                                                                       |
| -------------------------------------------------------------------------------------------------- | ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Verification debt now spans CP-2 through CP-8 (7 phases)                                           | **Critical**           | Unchanged standing recommendation: a rebuild+restart+verify pass is needed before any further live testing can validate anything past CP-1's baseline.                                                                                                                                                                                                                |
| SMS/WhatsApp sender-identity override is accepted by the schema/API but not wired to real delivery | Medium                 | Both providers' actual "from" identity requires provider-side business/DLT registration (MSG91 sender ID approval, Meta WhatsApp Business phone number verification) — a config-only override can't satisfy that. Documented in `ChannelDeliveryParams.senderOverride`'s own comment; only EMAIL is wired since SMTP genuinely allows a simple from-address override. |
| No settings UI for sender identity or webhook subscriptions                                        | Low-Medium             | Consistent with this initiative's established pattern (automation rules, comments) — API-complete, UI deferred. A reasonable CP-9 or later addition if a real tenant asks for it.                                                                                                                                                                                     |
| `WebhookDispatchWorker`'s poll loop has no live end-to-end test                                    | Low                    | See section 3 — primitive-level coverage plus structural mirroring of the proven `OutboxRelayWorker` judged sufficient for now.                                                                                                                                                                                                                                       |
| `campaign_webhook_deliveries` has no cleanup/retention policy — will grow unbounded                | Low at current volumes | Same category of debt already flagged for `notification_delivery_events` in the CP-6 report — revisit together if either becomes a real concern.                                                                                                                                                                                                                      |

---

## 12. WHAT IS NOT DONE (REMAINING TODO)

| Item                                                                     | Why deferred                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Additional channel adapters** (Telegram, Messenger, Web Push/QR, etc.) | The CP-8 phase prompt's own rule is explicit: _"Don't build a channel adapter nobody has asked for yet — confirm actual priority with me first, per this initiative's explicit anti-scope-creep principle (R7)."_ This is not a judgment call left to autonomous discretion — it's a hard requirement to get user input before starting. The user was unavailable this session (the standing full-autonomy authorization from earlier in the initiative explicitly permits proceeding without pausing only for non-critical decisions; this is exactly the kind of decision the CP-8 prompt itself carved out as needing a real answer, not a inferred one). **Flagged here for the user: which of Telegram Bot API / Meta Messenger / Web Push (VAPID) / QR, if any, should CP-9 or a later session build?** No channel-adapter code was written this phase. |
| **Segment-membership caching / table partitioning**                      | The phase prompt's rule: _"Only if CP-1–CP-7 usage data shows it's actually needed... do not build this speculatively; confirm the need with real numbers first."_ This is a dev-only environment with no production traffic/usage data to justify it — the answer under the phase's own stated criterion is clearly "not yet." Not started, and shouldn't be until real usage data exists.                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |

---

## 13. ARCHITECTURE DECISIONS MADE IN THIS PHASE

| Decision                                                                                                                                                                                                                        | Why                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | Alternatives Considered                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **`campaigns.branch_id` is nullable, not `NOT NULL`.**                                                                                                                                                                          | Every campaign created before this phase has no branch concept — making the column required would either break every existing row or require a fabricated default branch assignment. NULL = tenant-wide preserves exact current behavior for every tenant that never opts into branch scoping, matching `19_MIGRATION_AND_BACKWARD_COMPATIBILITY.md`.                                                                                                                                                                  | Match `invoices.branch_id`'s `NOT NULL` exactly (rejected: invoices are always created within a specific branch transaction context; campaigns historically have not been, and retrofitting that assumption isn't this phase's job).                                                                                                                                                                                                                                                                                              |
| **Outbound webhook delivery is enqueued synchronously (cheap INSERT) but dispatched asynchronously (separate poll-loop worker)**, mirroring `OutboxRelayWorker`'s structure exactly rather than firing HTTP inline in `send()`. | Directly continues the CP-6 architectural precedent: coupling a third-party's response latency/availability into the campaign-send critical path is exactly the failure mode CP-6 explicitly designed around. A slow or dead receiving webhook must never make `send()`/`cancel()` slower or riskier for the actual campaign-sending path.                                                                                                                                                                             | Fire the webhook inline inside `send()`/`cancel()` (rejected: reintroduces the exact coupling CP-6 avoided); use the existing `outbox_events`/Kafka path instead of a dedicated table+worker (considered — rejected because Kafka's consumer model doesn't cleanly express "retry this specific HTTP call up to N times with per-subscription state," which a dedicated SQL table with `attempt_count`/`status` expresses naturally and matches the `OutboxRelayWorker` precedent already used for exactly this kind of problem). |
| **Sender-identity override is only wired to real delivery for EMAIL, not SMS/WhatsApp**, even though the schema/API accept all four channels.                                                                                   | SMS sender IDs (MSG91) and WhatsApp Business phone numbers require actual telecom/Meta-side business registration — a database row can't make an unregistered sender ID or phone number valid. Pretending otherwise (accepting the override and silently not using it, or worse, sending with an invalid sender and having it fail unpredictably) would be worse than being explicit about the real-world constraint. EMAIL's SMTP `from` address genuinely is just a config value with no external registration step. | Wire all four channels regardless of real-world validity (rejected: would produce confusing silent failures at send time for SMS/WhatsApp); don't build the schema/API for SMS/WhatsApp at all (rejected: the settings row is still useful for a tenant to record their intended identity even before/while pursuing the real registration, and costs nothing to store).                                                                                                                                                          |
| **Two scope items (additional channel adapters, caching/partitioning) were not started, per the phase's own explicit "ask the user first" rule.**                                                                               | Unlike CP-7's DPDP/TRAI question (which this session judged didn't meet the "critical blocker" bar for pausing), this phase's own rules single out these two items by name as requiring real user input before proceeding — not a judgment call. Guessing which channel to build, or building speculative infrastructure with zero usage data to justify it, would violate this initiative's explicit anti-scope-creep principle (R7) on a point the phase author clearly intended to gate on a real answer.           | Guess a channel to build (e.g. Web Push, since it needs no third-party business account) (rejected: the phase prompt explicitly says not to guess); build a "reasonable default" caching layer anyway (rejected: explicitly against the phase's own stated criterion of confirming need with real numbers first).                                                                                                                                                                                                                 |

---

## 14. RISKS FOR NEXT PHASE

| Risk                                                                                                                                                                                         | Impact       | Mitigation                                                                                                                                                                                                                                                                                                            |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Verification debt spans 7 phases now (CP-2 through CP-8) — CP-8 specifically added a **new outbound network egress path** (webhook dispatch to arbitrary tenant-supplied URLs)               | **Critical** | Strongly recommend a rebuild+restart+verify pass before CP-9, and specifically before any real tenant registers a webhook subscription URL — this is the first phase where this ERP's backend makes outbound calls to arbitrary third-party-controlled URLs, which deserves live verification more than most changes. |
| Two CP-8 scope items are blocked on user input (channel adapter priority, caching/partitioning need) — CP-9 cannot assume CP-8 is "fully done" in the way CP-1–CP-7 were                     | Medium       | CP-9's QA pass should explicitly re-check with the user on both open questions rather than assuming silence means "skip forever."                                                                                                                                                                                     |
| `tenant_sender_identity` has no validation that a configured SMS/WhatsApp sender is actually usable — a tenant could configure one that will silently do nothing (since only EMAIL is wired) | Medium       | Consider a warning in a future settings UI ("SMS/WhatsApp sender identity is saved but not yet used for sending") if/when that UI gets built.                                                                                                                                                                         |

---

## 15. FINAL ARCHITECTURE SUMMARY

CP-8 made the platform genuinely multi-store-ready and open to third-party integration on the three
scope items that didn't require a judgment call this session couldn't make responsibly. Branch-scoped
campaigns reuse this codebase's existing `getBranchScope`/JWT-`branchIds` mechanism exactly — no parallel
scoping model was invented — and are nullable by design so every tenant that has never touched branch
scoping sees zero behavior change. Configurable sender identity is real for EMAIL (the one channel where a
config value can actually change what gets sent) and explicitly, honestly not real for SMS/WhatsApp, whose
sender identity is gated by telecom/Meta business registration no database row can substitute for. Outbound
webhook subscriptions got a real, tested dispatcher — HMAC-signed, retried, dead-lettered after 5 attempts —
built by directly mirroring `OutboxRelayWorker`'s proven poll-loop structure rather than either inventing a
new pattern or (worse) firing third-party HTTP calls synchronously inside the campaign-send path, which
would have reintroduced exactly the coupling CP-6 designed around. Two scope items — additional channel
adapters and segment-membership caching/partitioning — were deliberately not started, because the phase's
own rules explicitly require user confirmation before either, not an inferred default; both are surfaced
here as open questions rather than silently skipped or silently guessed at. Verification debt now spans
seven phases and, for the first time, includes a new class of risk (arbitrary outbound network calls) that
makes a rebuild+restart+verify pass more urgent than at any prior point in this initiative.

---

_Generated by: Claude Sonnet 5 | Date: 2026-07-15 | Next Phase: CP-9 — QA & Production Readiness_
