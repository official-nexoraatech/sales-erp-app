# CRM-ROADMAP Phase 4, Feature 7 — CTI / Call Center Integration — Completion Report

**Date:** 2026-07-31
**Status:** Complete, tested against a real local Postgres, zero regressions.
**Vendor:** Twilio (user's explicit instruction — no prior Twilio integration existed anywhere
in this codebase; confirmed via research this was a greenfield integration, not a reuse).

## Summary

Click-to-call + call logging. Implemented as a classic two-leg bridge (Twilio rings the rep's
own phone first, from `users.phone`; once answered, a TwiML webhook bridges to the customer's
number) rather than a browser-based softphone — no Twilio Voice JS SDK/WebRTC in this pass,
flagged below as a materially larger, separate undertaking not required by "click-to-call" as
literally specified. No vendor SDK: raw `fetch` against the Twilio REST API, mirroring this
codebase's own established pattern (`WhatsAppChannelProvider`/`SmsChannelProvider` in
notification-service also use plain `fetch`, no SDK).

### The recording-consent question

The user's instruction covered vendor choice (Twilio) but not the call-recording legal/
compliance question flagged as a genuinely open decision in the original blocker discussion.
**Resolved by defaulting recording OFF** (`TWILIO_RECORDING_ENABLED` env var, unset/false by
default) — the code path exists and is fully wired (a `recordingUrl` column, a recording
webhook handler, a `recordingConsentConfirmed` flag), but Twilio is never asked to record a call
unless this is explicitly turned on. **Before setting `TWILIO_RECORDING_ENABLED=true` in any
real environment, confirm your own IVR disclosure/consent flow and data-retention policy** —
this is not something engineering can decide on your behalf, and the flag's own code comment
says so.

### Backend

- **Schema** (migration `0146_crm_call_logs.sql`): a dedicated `crm_call_logs` table — neither
  existing candidate table fit (`customer_interactions` has no duration/recording/disposition
  columns; `crmConversations`' `channel` union is `WHATSAPP|SMS|EMAIL` only, no call-shaped
  fields), so widening either for one feature's sake was rejected in favor of a purpose-built
  table. `twilioCallSid` is the natural idempotency/lookup key for every webhook that follows
  the initial call.
- **`CallService`** (new): `initiateCall` (rejects with a clear `ValidationError` if the rep has
  no phone set in their profile — never silently fails), `handleStatusCallback`/
  `handleRecordingCallback` (both resolve the tenant by looking up the globally-unique Twilio
  CallSid directly — Twilio's webhooks carry no tenantId of their own, and a single shared
  platform-wide Twilio account is assumed, same "one vendor credential, not per-tenant" model as
  the existing WhatsApp/MSG91 integrations), `listCalls` (identity-scoped unless `CALL_LOG_VIEW`),
  `addNotes` (ownership-checked via the `WHERE` clause, same "404 not 403 on mismatch" pattern
  used throughout this session's other identity-scoped features).
- **`verifyTwilioSignature`** (new, in the existing `inboundWebhookVerification.ts`): Twilio's
  actual protocol — base64(HMAC-**SHA1**(authToken, url + sorted form-param pairs)) — genuinely
  different from every other provider already verified in that file (Meta/HMAC-SHA256-over-raw-
  body), so it's its own function, not a reuse. Verified against the exact configured
  `TWILIO_*_WEBHOOK_URL` env var, never a URL reconstructed from the request — this service runs
  behind api-gateway, so Fastify's own view of the request URL is never what Twilio was actually
  told to call.
- **Routes**: `POST /calls/initiate`, `GET /calls`, `PUT /calls/:id/notes` (staff-facing,
  `CALL_INITIATE`/`CALL_LOG_VIEW`), plus three public Twilio webhooks added to the existing
  `inbound-webhooks.routes.ts` (`/webhooks/twilio/voice` returns bridge TwiML,
  `/webhooks/twilio/status` updates call status/duration, `/webhooks/twilio/recording` updates
  the recording URL only when `TWILIO_RECORDING_ENABLED=true`). A new
  `application/x-www-form-urlencoded` content-type parser was added alongside the existing JSON
  one, since Twilio posts form-encoded, never JSON.
- Gateway `EXEMPT_PATHS` extended with the three Twilio webhook paths.

### Frontend

Added directly to the existing `CustomerViewPage.tsx` rather than a new page: a "Call" button
next to the customer's phone number (visible with `CALL_INITIATE`), and a new "Calls" tab
showing call history (status, duration, notes — visible with `CALL_LOG_VIEW`).

## Env vars the user needs to add (per their own instruction — no `.env` changes made here)

`TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_CALLER_NUMBER` (the Twilio phone number calls
are placed from), `TWILIO_VOICE_WEBHOOK_URL`/`TWILIO_STATUS_WEBHOOK_URL`/
`TWILIO_RECORDING_WEBHOOK_URL` (the exact public gateway URLs configured in the Twilio console —
must match verbatim, see `CallService.loadTwilioConfig`'s own comment on why), and optionally
`TWILIO_RECORDING_ENABLED` (leave unset/false until the consent question above is resolved).

## Decisions (flagged, not silently decided)

1. **No browser softphone (Twilio Voice JS SDK/WebRTC)** — the two-leg PSTN bridge satisfies
   "click-to-call" literally and needs zero new browser permissions/SDK integration; a full
   in-browser dialer is a materially larger, separate feature.
2. **Recording is off by default** — see the dedicated section above.
3. **Single platform-wide Twilio account, not per-tenant sub-accounts** — matches this
   codebase's existing vendor-credential model (WhatsApp/MSG91 are also single, platform-wide
   credentials).
4. **`CALL_LOG_VIEW` also gates tenant-wide call visibility (no manager-hierarchy scoping)** —
   same precedent as `ROUTE_MANAGE` (Feature 1) and `TERRITORY_MANAGE`/`QUOTA_MANAGE` — no
   manager-hierarchy concept exists anywhere in this codebase.

## Testing performed this session

- `pnpm --filter @erp/db build` / `@erp/types build` — clean.
- Migrations `0146`/`0147` live-applied to the local dev Postgres.
- Type-check clean: `sales-service`, `api-gateway`, `web-frontend`.
- **New tests, all passing**: `call-service.test.ts` (8, real DB — rejects a phone-less rep,
  creates a real call log from a mocked Twilio response, throws on a non-OK Twilio response,
  status callback updates by CallSid and sets `endedAt` on a terminal status, unknown-CallSid
  callback is a safe no-op, recording callback is a no-op while disabled, `listCalls` scoping,
  `addNotes` ownership check), `call-routes-permission-guard.test.ts` (3), `verifyTwilioSignature`
  (+6 in the existing `inbound-webhook-verification.test.ts`, now 17 total in that file) —
  accepts a correctly-signed request, rejects wrong auth token / wrong URL (proving the
  configured-URL-not-reconstructed choice actually matters) / tampered param / missing signature
  / unconfigured auth token.
- **Fixed the same route-guard-coverage gap class Feature 1 already caught for Feature 8**: the
  3 new Twilio webhook routes were flagged unguarded; added to `KNOWN_EXCEPTIONS` in
  `route-guard-coverage.test.ts` (public, provider-signature-verified — same shape as the
  existing WhatsApp/email/SMS entries in that same file).
- **Full regression sweep**: `sales-service` full run showed 48 failures across 15 files on
  first pass — 2 more files than this session's known 13-file JWT-issuer baseline
  (`campaign-service.test.ts`, `journey-service.test.ts`) plus one extra failing case in
  `loyalty-service.test.ts`. The run's own collect-phase duration (571s vs. a normal ~80s) was
  the same CPU-contention signature documented earlier this session
  ([[turbo_parallel_test_false_failures]]) — confirmed by re-running exactly those 3 files
  standalone: all pass except `loyalty-service.test.ts`'s single already-known pre-existing
  failure. Zero real regressions from this feature. `web-frontend` full suite: 442/442, no
  `dark:` variant issues from the new `CustomerViewPage.tsx` additions.
- `pnpm --filter @erp/sales-service lint` — at its pre-existing 2-error baseline, no new errors.

## What is not done (remaining TODO)

| Item                                          | Why deferred                                                                | Target                                              |
| --------------------------------------------- | --------------------------------------------------------------------------- | --------------------------------------------------- |
| Browser-based softphone (Twilio Voice JS SDK) | Materially larger scope than click-to-call as specified                     | Only if a real need for in-browser dialing surfaces |
| Per-tenant Twilio sub-accounts                | Single shared platform credential matches existing vendor-integration model | Only if a tenant needs their own billing/number     |
| Recording enablement + IVR consent disclosure | Genuine legal/compliance decision, explicitly not engineering's to make     | User's own compliance review                        |
| Playwright E2E coverage                       | Not run this session                                                        | Follow-up                                           |

## Deployment Checklist

- [ ] Apply migrations `0146_crm_call_logs.sql` and `0147_crm_call_log_permission_backfill.sql`
      to every real tenant's database (same `db:migrate`-is-broken caveat as every other feature
      shipped this session).
- [ ] Add the Twilio env vars listed above to sales-service's `.env` (user's own action, per
      their instruction).
- [ ] Configure the three webhook URLs in the Twilio console to match `TWILIO_VOICE_WEBHOOK_URL`/
      `TWILIO_STATUS_WEBHOOK_URL`/`TWILIO_RECORDING_WEBHOOK_URL` exactly — a mismatch here silently
      breaks signature verification (401s every webhook), not a visible startup error.
