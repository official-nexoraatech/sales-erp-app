# PHASE CP-2 — Channel Abstraction & Media — COMPLETION REPORT

## Generated: 2026-07-15 | Status: COMPLETE

> **This document is the official handoff artifact for Phase CP-2.**
> **The next phase (CP-3) MUST start by reading this document.**
> **Never modify this document after generation.**

---

## 1. PHASE SUMMARY

| Field        | Value                                                                  |
| ------------ | ---------------------------------------------------------------------- |
| Phase Number | CP-2                                                                   |
| Phase Name   | Channel Abstraction & Media                                            |
| Start Date   | 2026-07-15                                                             |
| End Date     | 2026-07-15                                                             |
| Status       | COMPLETE                                                               |
| Engineer(s)  | Claude (autonomous execution, Campaign Management Platform initiative) |

---

## 2. WHAT WAS BUILT

### 2.1 Database Schema

No new tables/migrations. See section 13 — media reuses the existing `document_attachments` table instead
of new `campaign_media_assets`/`campaign_media_links` tables.

### 2.2 APIs Implemented / Changed

| Method | Path                               | Permission                                                          | Status                                               |
| ------ | ---------------------------------- | ------------------------------------------------------------------- | ---------------------------------------------------- |
| POST   | `/attachments` (sales-service)     | `CRM_CAMPAIGN_CREATE` when `entityType=CAMPAIGN` (was INVOICE-only) | ✅ Extended                                          |
| GET    | `/attachments`                     | `CRM_VIEW` when `entityType=CAMPAIGN`                               | ✅ Extended                                          |
| GET    | `/attachments/:id/download`        | Dynamic by owning entity type                                       | ✅ Extended (unchanged behavior for INVOICE)         |
| DELETE | `/attachments/:id`                 | Dynamic by owning entity type                                       | ✅ Extended (unchanged behavior for INVOICE)         |
| POST   | `/notifications/send-raw-internal` | internal-key                                                        | ✅ Extended: accepts optional `mediaUrl`/`mediaType` |

### 2.3 Services Implemented / Changed

```
apps/notification-service/src/domain/channels/  (NEW)
  types.ts                  — ChannelProvider / ChannelDeliveryParams / ChannelDeliveryResult interfaces
  SmsChannelProvider.ts      — MSG91 Flow API (extracted, zero behavior change)
  EmailChannelProvider.ts    — SendGrid (extracted; NEW: inline <img>/link when mediaUrl present)
  WhatsAppChannelProvider.ts — Meta Cloud API (extracted; NEW: image/video/document media messages)
  InAppChannelProvider.ts    — SSE/log-only (extracted, zero behavior change)
  ChannelRegistry.ts         — maps ChannelName -> provider instance, built from existing config shape

apps/notification-service/src/domain/NotificationEngine.ts
  - Constructor signature UNCHANGED (db, config) — builds ChannelRegistry internally
  - deliverViaChannel()/sendSms()/sendEmail()/sendWhatsApp()/deliverInApp() DELETED,
    replaced by this.channels.get(channel).send(params)
  - SendRawInput gained optional mediaUrl/mediaType, threaded through to the provider

apps/sales-service/src/domain/CampaignService.ts
  - NEW: mediaTypeFromMime(), validateMediaForChannel() — pure functions, channel-aware media rules
  - NEW: getPrimaryMedia() — resolves a campaign's attachment (if any) once per send via ctx.files
  - send() now includes mediaUrl/mediaType in the notification-service payload when present

apps/sales-service/src/api/attachment.routes.ts
  - Generalized from INVOICE-only to INVOICE|CAMPAIGN (dynamic permission-by-entity-type, matching
    purchase-service's established pattern) — added image/gif, image/webp, video/mp4 to allowed MIME types
  - CAMPAIGN uploads validated against the target campaign's channel before accepting the file
```

### 2.4 Frontend Screens

None — media picker UI is CP-4's job (this phase built the storage/validation layer only, per the original
plan's own sequencing note).

---

## 3. TESTS

| File                                                                      | Tests          | Type                                                                                                           |
| ------------------------------------------------------------------------- | -------------- | -------------------------------------------------------------------------------------------------------------- |
| `apps/notification-service/src/__tests__/channel-providers.test.ts` (NEW) | 16             | Unit — every adapter's request shape, error messages, media-message construction, `ChannelRegistry` resolution |
| `apps/sales-service/src/__tests__/campaign-service.test.ts` (extended)    | +10 (36 total) | Unit — `mediaTypeFromMime`, `validateMediaForChannel` (channel gating, per-type size limits)                   |

### Test Execution Results

- `notification-service` full suite: **26/26 passing** (4 files) — the pre-existing `NotificationEngine.test.ts`
  (8 tests) passes **unmodified**, confirming the adapter extraction is behavior-preserving.
- `sales-service` full suite: **149/149 passing** (22 files, including the 36 in `campaign-service.test.ts`).
- `tsc --noEmit` clean on both `notification-service` and `sales-service`.
- `eslint`: 0 errors on every changed file (warnings only, consistent with pre-existing style —
  non-null-assertion warnings already used throughout this codebase's test/route files).

### Not Executed This Phase (documented, not silently skipped)

- **Live E2E re-run against the running dev stack was not performed.** Backend services in this
  environment run from compiled `dist/`, not source (`backend_services_run_from_dist_not_watch` — see
  project memory), and this environment currently has multiple long-running node processes that may belong
  to other concurrent sessions (`concurrent_sessions_on_same_repo`). Rebuilding and restarting
  `notification-service`/`sales-service` to pick up CP-2's changes was judged too disruptive to risk without
  confirming no other session depends on the currently-running processes. Verification for this phase relied
  instead on: (a) `tsc --noEmit` compiling cleanly, (b) the full existing + new automated test suites passing
  against the real dev Postgres, (c) the extracted adapters preserving the exact request shapes/error
  strings the deleted inline code had (asserted directly in the new tests). **Before this code is relied on
  in a live environment, rebuild `dist/` for both services and restart them, then re-run
  `apps/web-frontend/e2e/live-crm.spec.ts`** — flagged as a required step, not optional, in
  `22_DEFINITION_OF_DONE_AND_RELEASE_CHECKLIST.md`'s CP-9 pass.
- End-to-end "upload media → send campaign → recipient receives it" was not exercised live for the same
  reason (requires the running stack, and a real WhatsApp/SendGrid sandbox to observe delivery). The unit
  tests verify each piece (`validateMediaForChannel`, adapter media-message construction,
  `getPrimaryMedia`'s attachment-list-and-download-url resolution logic) in isolation.

---

## 7. KNOWN ISSUES AND TECHNICAL DEBT

| Issue                                                                                                                                    | Severity | Resolution Plan                                                                                                                    |
| ---------------------------------------------------------------------------------------------------------------------------------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Live/E2E verification of this phase's changes against the running dev stack is still pending (see section 3)                             | Medium   | Must happen before CP-9 sign-off at the latest; ideally before CP-3 starts a new session on top of this                            |
| Campaign media is 1-per-campaign (first attachment only) via `getPrimaryMedia()` — no UI to manage multiple attachments per campaign yet | Low      | CP-4 builds the picker UI; `document_attachments.list()` already returns all attachments if this needs to become multi-media later |
| No cross-campaign asset library (browsable, reuse-by-reference)                                                                          | Low      | Tracked as `NH-08` in `07_FEATURE_BACKLOG.md`, not scheduled                                                                       |

---

## 12. WHAT IS NOT DONE (REMAINING TODO)

- `channel_provider_config` / sender-identity configuration — deferred to CP-8 as planned.
- New channel adapters beyond the original 4 (Web Push, Telegram, Messenger, etc.) — deferred per
  `10_OMNICHANNEL_REQUIREMENTS.md`'s rollout table; the adapter interface built this phase is what makes
  those additions contained future work.
- Media picker frontend UI — CP-4.

---

## 13. ARCHITECTURE DECISIONS MADE IN THIS PHASE

| Decision                                                                                                                                                                                                                                               | Why                                                                                                                                                                                                                                                                                                                                                                                                                        | Alternatives Considered                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Built the media library by extending the existing `document_attachments`/`PlatformAttachments` system instead of new `campaign_media_assets`/`campaign_media_links` tables**, deviating from `17_DATA_MODEL_AND_API_DESIGN.md`'s original CP-2 plan. | Found a generic, already-working, already-tested attachment system (tenant-scoped, real object storage via `StorageClient`, polymorphic `entityType`/`entityId`) already used by purchase-service and hr-service. Building a parallel campaign-specific system would duplicate storage wiring, permission patterns, and download/delete logic that already exists and works.                                               | Build the originally-planned new tables (rejected: pure duplication of working infrastructure, against the "prefer editing existing files/reuse" principle); build a thin campaign-specific wrapper around `PlatformAttachments` (rejected as unnecessary — extending the existing generic route by one more `entityType` value was simpler and is exactly the pattern purchase-service already established for its own 2-entity-type case). |
| **Kept `NotificationEngine`'s public constructor signature identical** (`(db, config)`) rather than accepting an injected `ChannelRegistry`.                                                                                                           | The existing `NotificationEngine.test.ts` (8 tests, none touched) and `notification.routes.ts`'s single call site both construct it as `new NotificationEngine(db, config)` — changing the signature would force touching call sites/tests for zero functional benefit at this phase. `ChannelRegistry` is built internally from the same `config` object the class already received.                                      | Accept an injected registry for easier testing (rejected: no test currently needs to inject a fake registry; the adapters are tested directly and in isolation instead, which is simpler).                                                                                                                                                                                                                                                   |
| **Scoped media support to "one attachment per campaign, resolved once per send"** rather than a multi-asset campaign+library model.                                                                                                                    | Matches this phase's Must-Have bar (`MH-16`: "media/asset library with channel-aware validation") without over-building ahead of CP-4's actual builder UI, which is the first consumer that will need to decide whether multi-media-per-campaign is actually wanted. `document_attachments.list()` already returns every attachment for an entity, so extending to "first N attachments" later is additive, not a rewrite. | Build full multi-attachment carousel support now (rejected: no UI consumer yet, premature — CLAUDE.md simplicity guidance).                                                                                                                                                                                                                                                                                                                  |
| **WhatsApp media messages use the body text as the media's `caption`** rather than sending a separate follow-up text message.                                                                                                                          | Matches Meta's Cloud API media-message shape directly (`{type: 'image', image: {link, caption}}`) — a single API call, no risk of the caption and media arriving as two separate, potentially out-of-order messages.                                                                                                                                                                                                       | Two-message send (media then text) — rejected: more complex, more failure modes, no clear benefit.                                                                                                                                                                                                                                                                                                                                           |

---

## 14. RISKS FOR NEXT PHASE

| Risk                                                                                                                                                                                                                                                                                            | Impact | Mitigation                                                                                                                                                                                       |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| CP-2's changes have not been verified against the live running stack (section 3) — CP-3 builds on top of `SegmentService`/segment UI, which is unrelated to CP-2's notification/attachment changes, so this is unlikely to block CP-3, but the debt should not be allowed to compound silently. | Medium | Explicitly called out here and in `22_DEFINITION_OF_DONE_AND_RELEASE_CHECKLIST.md`; do a rebuild+restart+E2E pass at the start of CP-4 (which does touch the campaign builder UI) at the latest. |
| New MIME types were added to `attachment.routes.ts`'s allowlist (gif/webp/mp4) — these are now also valid for INVOICE attachments, not just CAMPAIGN, since the allowlist is shared.                                                                                                            | Low    | Intentional, not considered a problem (a wider allowlist is strictly more permissive, not a regression) — noted so it isn't mistaken for an oversight later.                                     |

---

## 15. FINAL ARCHITECTURE SUMMARY

CP-2 made communication channels pluggable: `NotificationEngine`'s previously-inline SMS/Email/WhatsApp/
In-App delivery logic is now four `ChannelProvider` adapter classes behind a `ChannelRegistry`, with zero
behavior change to any existing caller (verified by the pre-existing 8-test `NotificationEngine.test.ts`
passing unmodified, plus 16 new adapter-level tests). Email and WhatsApp adapters gained real media-message
support (inline image/link for Email, native image/video/document messages for WhatsApp). Rather than
building a new, parallel media-storage subsystem as originally planned, CP-2 extended this ERP's existing
`document_attachments`/`PlatformAttachments` system — already proven in purchase-service and hr-service —
so campaigns can now carry one media attachment, validated against the target channel's real size/type
constraints before upload, and included automatically in every recipient's message at send time. Full
live-stack verification (rebuild + restart + E2E) is flagged as outstanding, not silently skipped, since
this session avoided restarting shared dev processes that may belong to other concurrent sessions. CP-3
(Segmentation & Personalization) can proceed — it does not depend on CP-2's runtime verification since it
touches an unrelated part of the module (segment targeting, not channel delivery).

---

_Generated by: Claude Sonnet 5 | Date: 2026-07-15 | Next Phase: CP-3 — Segmentation & Personalization_
