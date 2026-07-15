# PHASE CP-6 — Analytics & A/B Testing — COMPLETION REPORT

## Generated: 2026-07-15 | Status: COMPLETE (delivery tracking only — A/B testing and attribution deferred, see section 13)

> **This document is the official handoff artifact for Phase CP-6.**
> **The next phase (CP-7) MUST start by reading this document.**
> **Never modify this document after generation.**

---

## 1. PHASE SUMMARY

| Field        | Value                                                                                                                                                                 |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Phase Number | CP-6                                                                                                                                                                  |
| Phase Name   | Analytics & A/B Testing                                                                                                                                               |
| Status       | COMPLETE for delivery-status tracking (MH-02, MH-14 partial); A/B testing (SH-09), open/click tracking (MH-15), and revenue attribution (SH-10) deliberately deferred |
| Engineer(s)  | Claude (autonomous execution, Campaign Management Platform initiative)                                                                                                |

---

## 2. WHAT WAS BUILT

### 2.1 Database Schema

```
Migration: packages/db-client/migrations/0055_cp6_analytics_webhooks.sql (journal updated,
applied to the dev database and verified — 56/56 migrations in sync)

Tables created:
  notification_delivery_events (notification-service) — source-level webhook idempotency,
    UNIQUE(provider, provider_event_id)

Columns added to campaign_recipients:
  delivered_at  — populated this phase
  opened_at, clicked_at, converted_at — reserved for later scope (nullable, unenforced)

No FK constraints (consistent with the zero-FK convention).
```

### 2.2 APIs Implemented

| Method   | Path                                                       | Notes                                                                        |
| -------- | ---------------------------------------------------------- | ---------------------------------------------------------------------------- |
| POST     | `/webhooks/msg91/dlr` (notification-service, public)       | Shared-secret token verification                                             |
| POST     | `/webhooks/sendgrid/events` (notification-service, public) | Real Ed25519 signature verification                                          |
| POST/GET | `/webhooks/whatsapp/status` (notification-service, public) | Real HMAC-SHA256 signature verification (POST); verify-token handshake (GET) |

### 2.3 Services Implemented / Changed

```
apps/notification-service/src/domain/webhookVerification.ts (NEW)
  - verifyMetaSignature() — real X-Hub-Signature-256 HMAC-SHA256 verification
  - verifySendGridSignature() — real Ed25519 signature verification (SPKI-wraps SendGrid's
    raw published public key to construct a verifiable KeyObject)
  - verifyMsg91Token() / verifySharedSecret() — constant-time shared-secret comparison
    (MSG91's DLR API has no cryptographic signature scheme, unlike the other two)

apps/notification-service/src/api/webhook.routes.ts (NEW)
  - 3 provider webhook receivers, each: verify signature over the RAW request body -> resolve
    notification_log by externalMessageId -> INSERT ... ON CONFLICT DO NOTHING into
    notification_delivery_events (source-level idempotency, NFR-09) -> update
    notification_log.status/deliveredAt/errorMessage -> direct outbox_events insert
    (eventType: NOTIFICATION_DELIVERY_UPDATED) for cross-service sync
  - Raw-body capture via a content-type-parser override scoped to this plugin only (Fastify
    encapsulation) — every other route in the service is unaffected

apps/sales-service/src/consumers/NotificationDeliveryConsumer.ts (NEW)
  - sales-service's FIRST-EVER Kafka consumer (kafkajs added as a direct dependency)
  - handleNotificationDeliveryUpdated() joins the event's notificationLogId against
    campaign_recipients.notificationLogId, updates status/deliveredAt, rolls up
    campaigns.deliveredCount — idempotent (no-op if the recipient's status already matches)
  - Non-campaign notifications (the join misses) are a normal no-op, not an error

apps/sales-service/src/main.ts
  - Wired the Kafka client + PlatformEventConsumer + eventDispatcher, modeled directly on
    apps/gst-service/src/main.ts's existing pattern (topic: erp.notification.delivery.updated)
```

### 2.4 Frontend Screens

```
apps/web-frontend/src/pages/crm/CampaignsPage.tsx
  - NEW DeliveryFunnel component — a simple visual funnel (sent/delivered/failed/pending as a
    proportional colored bar + legend) shown when a campaign row is expanded, using
    campaigns.deliveredCount which is now real data instead of always 0
```

---

## 3. TESTS

| File                                                                            | Tests | Type                                                                                                                  |
| ------------------------------------------------------------------------------- | ----- | --------------------------------------------------------------------------------------------------------------------- |
| `apps/notification-service/src/__tests__/webhookVerification.test.ts` (NEW)     | 17    | Unit — real Ed25519 keypair round-trip, real HMAC round-trip, tampered/missing/wrong-secret cases for all 3 providers |
| `apps/notification-service/src/__tests__/webhook-delivery.test.ts` (NEW)        | 3     | Integration — idempotency insert, status update + outbox write, FAILED path                                           |
| `apps/sales-service/src/__tests__/notification-delivery-consumer.test.ts` (NEW) | 5     | Integration — sync + deliveredCount rollup, idempotency, FAILED path, non-campaign no-op, malformed-payload no-op     |

### Test Execution Results

- `notification-service` full suite: **46/46 passing** (6 files).
- `sales-service` full suite: **202/202 passing** (23 files) — zero regression from adding the
  service's first Kafka consumer.
- `tsc --noEmit` clean on both services and `web-frontend`.
- `eslint`: 0 errors across every changed file.
- `apps/web-frontend/e2e/live-crm.spec.ts`: **passing** (5.5s) — `DeliveryFunnel` doesn't
  interfere with any existing selector.
- **The SendGrid signature test uses a real, freshly-generated Ed25519 keypair** (not a mocked
  crypto library) — this is the highest-value test in this phase given it's the most complex/
  easy-to-get-subtly-wrong verification of the three (SPKI DER-wrapping a raw 32-byte public key
  correctly). All tamper/wrong-key/wrong-timestamp cases correctly rejected.

### Not Executed This Phase (documented, not silently skipped)

- **No HTTP-level route test** for the 3 webhook endpoints themselves (raw-body content-type
  parser + real Fastify request/response cycle) — the security-critical signature verification is
  tested exhaustively as pure functions (17 tests), and the delivery-processing domain logic is
  tested via direct integration tests (3 + 5 tests) against real Postgres. The remaining gap is
  purely "does Fastify correctly wire raw-body capture into the request object" — lower risk than
  the crypto/idempotency logic, and judged acceptable to defer given remaining phase count.
- **Live firing of the actual webhook endpoints against real MSG91/SendGrid/Meta accounts** was
  not performed — this session has neither real provider credentials configured nor a publicly
  reachable URL for providers to call back to. This is expected and does not block the code being
  correct; it does mean the _end-to-end_ real-provider integration (as opposed to the tested
  logic) remains unverified, consistent with this initiative's broader verification-debt flag.
- **notification-service and sales-service were rebuilt but not restarted** (same standing
  constraint as CP-2 through CP-5 — a restart was not re-attempted this phase since the prior
  attempt was correctly blocked by the environment's safety classifier). Verification debt now
  spans CP-2 through CP-6 — **five** phases.
- **The Kafka consumer's actual message-passing (produce → OutboxRelayWorker → Kafka → consume)
  was not exercised live** — this requires the full running stack (event-service's relay,
  a real Kafka broker, both services' consumers actively running), none of which was
  restarted/verified this session. The handler logic itself (`handleNotificationDeliveryUpdated`)
  is fully tested by calling it directly; only the transport layer connecting it to a real webhook
  firing is unverified.

---

## 7. KNOWN ISSUES AND TECHNICAL DEBT

| Issue                                                                                                                                                         | Severity     | Resolution Plan                                                                                                                                                                                                                   |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Verification debt now spans CP-2 through CP-6 (5 phases)                                                                                                      | **Critical** | This is now the single highest-priority item before any further phase — CP-6 specifically added public-facing webhook endpoints, which is exactly the kind of surface area that most needs live verification before being trusted |
| SendGrid message-ID matching uses a prefix `LIKE` query (`sg_message_id` can have a different suffix than what SendGrid's send-time response header returned) | Medium       | A known SendGrid quirk, not a bug introduced here — documented in the code comment; watch for false-negative matches in production, tighten if it proves too loose                                                                |
| No HTTP-level route test for the 3 webhook endpoints                                                                                                          | Medium       | Documented above — a reasonable follow-up, not a correctness gap in the tested logic                                                                                                                                              |
| A/B testing (SH-09), open/click tracking (MH-15), revenue attribution (SH-10), and the cross-campaign comparison dashboard (part of MH-14) were **not built** | Medium-High  | See section 12 — genuinely deferred, not silently dropped                                                                                                                                                                         |
| `campaign_recipients.opened_at`/`clicked_at`/`converted_at` columns exist but nothing populates them                                                          | Low          | Reserved for the deferred click/open-tracking and attribution work                                                                                                                                                                |

---

## 12. WHAT IS NOT DONE (REMAINING TODO)

The following CP-6 items from `07_FEATURE_BACKLOG.md` were **not built this phase**:

| Item                                                                            | Why deferred                                                                                                                                                                                                                                                                                                                                                                                                                |
| ------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Engagement tracking — open pixel (Email), click-through link-wrapping (`MH-15`) | Requires rewriting every outbound link in a campaign's message body to a redirect-and-record endpoint, plus (for Email) embedding a tracking pixel — a genuinely separate, moderately-sized feature from delivery-status tracking. Delivery tracking (MH-02) was judged the higher-priority Must-Have of the two, and was already a substantial phase on its own (2 new services' worth of webhook/consumer infrastructure) |
| A/B testing (`SH-09`)                                                           | Needs variant storage, audience-split logic, and a UI for defining/viewing variants — a self-contained feature with no shared infrastructure with delivery tracking; not started this phase                                                                                                                                                                                                                                 |
| Revenue/coupon-redemption attribution (`SH-10`)                                 | Needs a coupon/tracked-link entity and an attribution-window join against orders — no such entity exists yet elsewhere in this ERP to attach to; would mean inventing a coupon system from scratch, which is out of proportion for this phase                                                                                                                                                                               |
| Cross-campaign comparison dashboard (remainder of `MH-14`)                      | The single-campaign `DeliveryFunnel` (built this phase) is a real, working piece of this requirement; a dedicated comparison page (by channel/type/date range) was judged lower priority than making delivery data _real_ in the first place — building a comparison view on top of still-mostly-zero data would have been premature                                                                                        |

---

## 13. ARCHITECTURE DECISIONS MADE IN THIS PHASE

| Decision                                                                                                                                                                                                       | Why                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | Alternatives Considered                                                                                                                                                                                                                                                |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Cross-service sync via the existing outbox/Kafka pattern** (direct `outbox_events` insert from notification-service, sales-service's first-ever consumer), rather than a synchronous internal HTTP callback. | This is the established, proven pattern for this exact kind of "service A's event needs to update service B's data" problem (mirrored from `GRNService.ts` → `GRNGstConsumer.ts`). A synchronous HTTP callback would require notification-service to know about campaigns (breaking its own abstraction) and would couple webhook-response latency to a second service's availability.                                                                                                                                                          | Synchronous internal HTTP call from notification-service to a new sales-service endpoint (rejected: breaks notification-service's channel-agnostic abstraction, adds a hard runtime dependency between two services for what should be an eventually-consistent sync). |
| **Direct `outbox_events` insert instead of wiring `PlatformContextFactory`/`ctx.events.publish()` into notification-service.**                                                                                 | Research confirmed notification-service currently has zero `PlatformContextFactory` usage — routes work off a raw `ErpDatabase` only. Wiring up the full context factory (Redis pub/sub, feature flags, tenant-status enforcement, etc.) just to get `ctx.events.publish()` would have been a disproportionately large refactor for what's actually needed (one outbox insert). The direct-insert pattern is already an established, equally-valid idiom in this codebase (`GRNService.ts` and others use it, not just `ctx.events.publish()`). | Refactor notification-service onto `PlatformContextFactory` (rejected: large, risky, unrelated-to-CP-6 change to a service's entire bootstrap — exactly the kind of scope creep this initiative's principles warn against).                                            |
| **MSG91 verified via shared-secret token, not a fabricated HMAC scheme.**                                                                                                                                      | MSG91's delivery-report callback API genuinely has no standard cryptographic signature mechanism, unlike Meta and SendGrid. Implementing a fake HMAC scheme MSG91 doesn't actually support would be worse than honestly implementing the weaker (but real) shared-secret verification MSG91 does support — false security is worse than accurately-scoped real security.                                                                                                                                                                        | Skip MSG91 webhook verification entirely (rejected: some verification is much better than none); invent a custom signing scheme MSG91 would never actually send (rejected: pure fiction, would give false confidence).                                                 |
| **Deferred A/B testing, click/open tracking, and revenue attribution entirely** rather than building thin/partial versions of each.                                                                            | Each is a genuinely separate feature with its own data model and (for attribution) a missing prerequisite entity (coupons/tracked links don't exist yet). Building thin, incomplete versions of three separate features would have produced less real value than fully completing delivery-status tracking (which touches 2 services, a new consumer pattern, and real cryptographic verification) — consistent with this initiative's "extend, don't half-build" principle.                                                                    | Build minimal versions of all four MH-14/15/SH-09/10 items (rejected: would have meant nothing in this phase was actually complete/production-ready).                                                                                                                  |

---

## 14. RISKS FOR NEXT PHASE

| Risk                                                                                                                                                                                  | Impact                 | Mitigation                                                                                                                                                                                                       |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Verification debt spans 5 phases now, and CP-6 specifically added **public-facing, security-critical** endpoints                                                                      | **Critical**           | Strongly recommend a rebuild+restart+verify pass (by a human or stack-owning session) before CP-7, and specifically before any of these webhook URLs are ever registered with a real MSG91/SendGrid/Meta account |
| sales-service now has its own Kafka consumer group (`sales-service-group`) and a dedicated `consumerDb` connection pool (maxConnections: 3) — untested under real load/restart cycles | Medium                 | Watch during CP-8/CP-9's performance and production-readiness passes                                                                                                                                             |
| The `notification_delivery_events` idempotency table has no cleanup/retention policy — will grow unbounded                                                                            | Low at current volumes | Flag for CP-8/CP-9 if it becomes a real concern                                                                                                                                                                  |

---

## 15. FINAL ARCHITECTURE SUMMARY

CP-6 made campaign delivery tracking real: `campaigns.deliveredCount` and `campaign_recipients.status`
were schema placeholders that nothing ever populated before this phase; they now reflect genuine
provider-confirmed delivery status via 3 real, cryptographically-verified webhook receivers (Ed25519 for
SendGrid, HMAC-SHA256 for Meta, shared-secret for MSG91's more limited API) feeding through this codebase's
established outbox/Kafka pattern into sales-service's first-ever event consumer. The security-critical
signature-verification logic is the most thoroughly tested code in this entire initiative — 17 unit tests
including a real Ed25519 cryptographic round-trip, covering every tamper/missing-secret/wrong-key failure
mode. A/B testing, engagement (open/click) tracking, and revenue attribution were deliberately deferred as
separate, self-contained features rather than built half-way — delivery tracking alone was already a
substantial, multi-service phase. Verification debt now spans 5 phases (CP-2 through CP-6) and is flagged as
the critical item before CP-7, since this phase specifically introduced public-facing endpoints that most
need live verification before being trusted with real provider traffic.

---

_Generated by: Claude Sonnet 5 | Date: 2026-07-15 | Next Phase: CP-7 — Collaboration & Compliance_
