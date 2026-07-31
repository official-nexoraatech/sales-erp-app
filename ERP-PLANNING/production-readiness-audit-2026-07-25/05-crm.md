# CRM Module — Fresh Production-Readiness Audit (2026-07-25)

Scope: `apps/sales-service/src/api/crm.routes.ts` + `apps/sales-service/src/api/integrations.routes.ts`
(webhook subscriptions, generalized from CRM) + `apps/sales-service/src/domain/{SegmentService,CampaignService,WebhookService,WebhookDispatchWorker}.ts`

- `apps/web-frontend/src/pages/crm/*`. Verified live against tenant 2 ("QA E2E Test Co") on
  sales-service:3013 (via gateway :3000), notification-service:3014, and Mailhog:8025. Every claim
  below marked "live-verified" was executed against the running stack in this session, not inferred
  from code alone.

## Summary

The Campaign Management platform (Segments → Campaigns → Send, approval workflow, webhook
subscriptions) is real, deep, and works correctly end-to-end — segment filtering, campaign
creation/approval/send, real email delivery to Mailhog, async delivery-status sync, audit
logging, and outbound webhook firing were all live-verified with matching data, not just "didn't
error." This is a genuinely mature module. However, two severe gaps sit on top of that solid
foundation: **(1) there is no "Leads" concept anywhere in this codebase** — the audit brief's
Leads scenario (create/list/convert a lead) cannot be tested because the feature does not exist,
in code, in the database schema, in navigation, or in any test — and **(2) the SALES_MANAGER
role, the obvious intended owner of CRM, is granted essentially zero CRM permissions** (only
`CRM_LOYALTY_VIEW`), so in practice only OWNER/ADMIN can use any part of this module today. A
third finding: the dedicated CRM permission-guard test suite is silently broken (JWT issuer
mismatch in test setup) and its "positive" assertions are vacuous — it currently proves nothing,
though live testing confirms the routes themselves gate correctly.

## What works (live-verified)

- **Segments — real filter engine, not a stub.** `SegmentService` whitelists customer columns,
  JSON address fields (`state`/`city`/`pincode`), computed purchase-behavior aggregates
  (`orderCount`, `lifetimeValue`, `daysSinceLastPurchase`, `averageOrderValue`), and tenant custom
  fields (`customField:<key>`) — never raw SQL from the client. Live-verified: previewed
  `state=Maharashtra` → `matchingCount: 2`, `state=Karnataka` → `1`, both matching a manual count
  of tenant 2's 24 customers by hand. Created real segment id **100** ("Audit Maharashtra
  Customers"); `GET /crm/segments/100/customers` returned the exact 2 expected customers (ids 880,
  912). CSV export route sanitizes formula-injection (`=`, `+`, `-`, `@` prefixes) — code-reviewed.
- **Campaigns — full lifecycle live-verified.**
  - Created customer id **914** ("CRM Audit Test Customer...") with a real email.
  - Created campaign id **893** targeting `customerIds:[914]`, channel `EMAIL`. Preview correctly
    showed `recipientCount: 1` and a token-rendered sample message.
  - This tenant has `approvalRequired: true` in communication settings (set by an earlier QA
    session) — `send` correctly rejected with `APPROVAL_REQUIRED` until
    `submit-for-approval` → `approve` were called, then sent successfully
    (`status: SENT, sentCount: 1`).
  - **Real email landed in Mailhog** for `crm.audit.<ts>@example.com`, subject "Notification",
    body exactly `"Hello CRM Audit Test Customer ..., this is a CRM audit test email. Balance:
0.00"` — confirming `{{customerName}}`/`{{balance}}` token substitution works. Sender header
    was `QA Test Sender <qa-test@example.com>` (a prior-session tenant sender-identity override,
    also confirming `CRM_SENDER_IDENTITY_MANAGE`'s effect is real).
  - `campaignRecipients` row transitioned PENDING → SENT asynchronously (via
    `NotificationDeliveryConsumer`), confirmed via `GET /crm/campaigns/893/recipients` and
    `/stats` (`sent:1`).
  - Second campaign (id **894**) repeated the same flow for a webhook test (see below).
  - Draft campaign (id **895**) created and cancelled — `status: CANCELLED` confirmed.
- **Outbound webhooks — real HTTP delivery, HMAC-signed, live-verified with a local echo
  listener** (not just code review). Created webhook subscription (id 4, deleted after test) for
  `CAMPAIGN_SENT` + `CAMPAIGN_CANCELLED` events pointed at a throwaway `127.0.0.1:9999` listener.
  Sending campaign 894 produced a POST within ~1.5s carrying
  `x-webhook-signature: sha256=...`, `x-webhook-event: CAMPAIGN_SENT`, and a correct JSON payload
  (`{"eventType":"CAMPAIGN_SENT","aggregateType":"CAMPAIGN","aggregateId":894,"data":{...sentCount:1,totalRecipients:1...}}`).
  Cancelling campaign 895 produced a matching `CAMPAIGN_CANCELLED` delivery. `WebhookDispatchWorker`
  uses `FOR UPDATE SKIP LOCKED` batch polling with retry/dead-letter (max 5 attempts) — code-reviewed,
  consistent with the outbox-relay pattern used elsewhere in the codebase.
- **Webhook subscription UI is real and wired** (`apps/web-frontend/src/pages/settings/IntegrationsPage.tsx`,
  route gated on `PERMISSIONS.INTEGRATION_WEBHOOK_MANAGE` in `App.tsx`) — this confirms the
  "dead CRM-webhook UI, fixed 2026-07-17" memory claim: it is genuinely fixed, not just claimed
  fixed. One caveat: no delivery-history/log view exists in the UI (see Gaps).
- **Audit logging is real**, not decorative. `GET /api/auth/admin/audit-logs?entityType=campaign`
  returned exact matching entries for every action performed in this session: campaign CREATE,
  SUBMIT_FOR_APPROVAL, APPROVE, and a `customer_interaction` CREATE — with correct `userId`,
  `entityId`, and `afterData`.
- **Domain events published** on segment/campaign/interaction/season create and campaign send
  (`ctx.events.publish(...)`) — code-reviewed throughout `crm.routes.ts`/`CampaignService.ts`;
  consistent with the outbox pattern already verified working elsewhere in this codebase.
- **Validation is clean, no 500s observed.** Live-verified: unsupported segment field →
  422 `VALIDATION_ERROR` ("Unsupported segment field: ..."); empty rules array → 422 (schema
  `min(1)`); campaign with neither `segmentId` nor `customerIds` → 422; campaign targeting a
  non-existent customer id (zero recipients) → 422 `NO_RECIPIENTS` on send, not a 500.
- **RBAC gating mechanism itself works correctly** — every CRM/webhook route is behind
  `requirePermission`, and live-verified 403s (see Bugs below re: who actually holds the
  permission) with a clear `FORBIDDEN — Missing permission: X` message, not a generic error.
- **Tenant scoping is consistent by code review** — every query in `crm.routes.ts`,
  `integrations.routes.ts`, `SegmentService.ts`, and `CampaignService.ts` filters on
  `eq(<table>.tenantId, tenantId)` from the authenticated JWT; `loadSegment()` and campaign lookups
  404 (not leak) when the id belongs to another tenant. Could not live-verify cross-tenant with a
  second real tenant (dev DB currently only has one usable tenant per `TEST_CREDENTIALS.md`; tenant
  1 is documented stale/nonexistent, and `GET /tenants` via the platform operator returned an empty
  list rather than a usable second tenant to test against) — this is a code-review-only conclusion,
  not a live cross-tenant probe.

## Bugs / gaps found

1. **[CRITICAL — feature gap] "Leads" do not exist anywhere in this codebase.** Grepped
   `apps/sales-service/src` and `apps/web-frontend/src` for `lead`/`leads` (case-insensitive): zero
   matches in sales-service; the only frontend hits are an unrelated marketing contact form
   (`apps/web-frontend/src/pages/marketing/ContactPage.tsx:29`, whose own comment reads _"No
   backend lead-capture endpoint exists yet — this simply confirms receipt locally"_) and an
   unrelated DAP tour hook name. There is no `leads` table, no lead routes, no lead nav entry
   (`apps/web-frontend/src/lib/navigation.ts`'s CRM section only lists Segments/Campaigns/
   Seasons/Campaign Settings), and no lead-to-customer conversion flow. **Business impact:** if
   "Leads" is an expected CRM capability (as the audit brief assumed, and as most CRM products
   include), this is a complete, unbuilt feature — not a bug to fix, a scope gap to plan. Every
   other finding in this report concerns the Segments/Campaigns/Webhooks subsystem that does exist.

2. **[CRITICAL — RBAC] SALES_MANAGER (and every non-OWNER/ADMIN role) is locked out of nearly
   the entire CRM module.** `apps/tenant-service/src/rbac/role-defaults.ts`'s `SALES_MANAGER`
   array (lines 32–87) grants only `PERMISSIONS.CRM_LOYALTY_VIEW` among the 16 `CRM_*` /
   `INTEGRATION_WEBHOOK_MANAGE` constants that exist in `packages/shared-types/src/permissions.ts`.
   None of `CRM_VIEW`, `CRM_SEGMENT_VIEW/CREATE`, `CRM_CAMPAIGN_CREATE/SEND/APPROVE`,
   `CRM_INTERACTION_VIEW/CREATE`, `CRM_SEASON_VIEW/MANAGE`, `CRM_AUTOMATION_MANAGE`,
   `CRM_SENDER_IDENTITY_MANAGE`, `CRM_CAMPAIGN_ANALYTICS_VIEW`, or `INTEGRATION_WEBHOOK_MANAGE`
   appear anywhere in `role-defaults.ts` for ANY named role (`grep`-confirmed zero hits). OWNER
   gets everything only because it's granted `TENANT_SCOPED_PERMISSIONS` as a wildcard, not
   because it was deliberately included. Live-verified: a real `sales.manager@qa-e2e.local` JWT
   decoded to `permissions: ['CRM_LOYALTY_VIEW']` only, and got 403 on `GET /crm/segments`,
   `GET /crm/campaigns`, and `POST /crm/segments`. STAFF and CASHIER also 403 on everything CRM
   (expected for them, but SALES_MANAGER should plausibly own this). **Business impact:** unless
   a tenant manually re-grants these permissions per-role, CRM/campaign functionality is
   effectively OWNER/ADMIN-only in production — the same `role-defaults.ts`-omission pattern this
   codebase has hit repeatedly before (see memory: `rbac_dead_permission_constant_pattern`),
   except here it's an entire module's permission set omitted from its obvious owning role, not
   one dead constant.

3. **[MEDIUM — test debt / false coverage] The CRM permission-guard test suite is broken and
   currently verifies nothing on its positive-assertion side.**
   `apps/sales-service/src/__tests__/crm-campaign-permission-guards.test.ts` signs test JWTs with
   `issuer: 'erp-test'` but never sets `process.env.JWT_ISSUER` to match; `verifyAccessToken`
   (`packages/platform-sdk/src/auth.ts`) defaults to `'erp-auth-service'` and rejects every token
   in the file with a 401 (invalid issuer) before permission logic ever runs. Live-run result:
   **7 of 14 tests fail**, and the failures are exactly the 7 "should 403 without the permission"
   assertions (`expect(res.statusCode).toBe(403)` → got 401). The other 7 ("does not 403 with the
   permission") pass, but vacuously — `expect(res.statusCode).not.toBe(403)` is trivially
   satisfied by 401 too, so this half of the suite would pass even if every permission check were
   deleted. Reproduced twice (standalone run and combined with 4 other CRM test files — not a
   parallel-run flake per the `turbo_parallel_test_false_failures` memory pattern, consistently
   the same 7/14 both times). **This is a test-infrastructure bug, not a production RBAC bug** —
   my own live curl testing with real signed tokens against the real running service confirmed
   all 7 of these routes correctly gate on their documented permission constants. But as shipped,
   this test file provides zero actual regression protection for `CRM_CAMPAIGN_APPROVE`,
   `CRM_CAMPAIGN_ANALYTICS_VIEW`, `CRM_AUTOMATION_MANAGE`, `CRM_SENDER_IDENTITY_MANAGE`, and
   `INTEGRATION_WEBHOOK_MANAGE` — a future regression on any of these would not be caught.

4. **[LOW — data/observability] No webhook delivery-history UI.** `IntegrationsPage.tsx` lets a
   tenant create/edit/delete subscriptions but has no view into `webhook_deliveries` (status,
   attempt count, last error) — a tenant integrating an external system has no self-service way
   to see whether their webhook is actually firing/succeeding short of checking their own
   receiving endpoint. The data exists (`webhook_deliveries` table, polled by
   `WebhookDispatchWorker`) but is not exposed via any route or page found in this audit.

5. **[LOW — test data reality] Zero of tenant 2's 24 real customers have an email address.**
   Confirmed via `GET /customers?size=100` — every row has `email: null`. Any real EMAIL-channel
   campaign against this tenant's actual customer base (not a manually created test customer)
   would silently resolve to 0 email-eligible recipients (SMS/WhatsApp use `phone`, which is
   populated, so those channels are unaffected). Likely a QA-seed-data gap rather than an app bug,
   but worth flagging since it would have made this audit's Mailhog verification impossible
   without manually creating customer 914.

## Untested / unknown areas

- **Automation rules (birthday/inactivity/anniversary triggers) and recurring campaigns** —
  code-reviewed only (`CampaignService.fireAutomationRule`, `dispatchRecurringOccurrence`,
  `computeNextFireDate`); not live-fired in this session (would require manipulating
  `lastFiredAt`/waiting for scheduler cron, out of scope for the time available).
  `CRM_AUTOMATION_MANAGE` also has no test-suite-passing coverage (see finding 3).
  - Note: `occurrences`-based series termination is explicitly documented in code as
    "reserved, not yet enforced" (`CampaignService.ts` `RecurrenceRule.occurrences` comment) —
    a recurring campaign with only `occurrences` set (no `endDate`) recurs indefinitely today.
- **SMS/WhatsApp channel delivery** — not live-verified (no SMS/WhatsApp sandbox available in this
  environment); only EMAIL was confirmed end-to-end via Mailhog. `checkChannelLimits` SMS
  character-limit warning logic is code-reviewed but not exercised.
- **Cross-tenant isolation** — code-review-only conclusion (see "What works" caveat above); no
  second live tenant was available to run an actual cross-tenant 404/leak probe.
- **Campaign approval workflow's `CRM_CAMPAIGN_APPROVE`-holding role** — no role in
  `role-defaults.ts` holds this either (same gap as finding 2), so in practice only OWNER/ADMIN can
  approve a campaign under `approvalRequired: true` tenants; not separately itemized since it's the
  same root cause as finding 2.
- **Frequency cap (`maxPerDayFrequencyCap`) and granular per-channel opt-out enforcement** —
  code-reviewed (`applyFrequencyCap`, `applyGranularConsentFilter` in `CampaignService.ts`), logic
  looks correct, but not independently live-verified with a customer configured to hit the cap or
  an opt-out row in this session.
- **Campaign media attachments (image/video/document)** — code-reviewed only
  (`validateMediaForChannel`, `getPrimaryMedia`), not exercised live.

## Readiness score: 62/100

Justification: the engineering quality of what exists (Segments/Campaigns/Webhooks) is genuinely
high — real filter engine, real approval workflow, real signed webhooks, real audit trail, clean
validation, live-verified email delivery with correct token rendering. That alone would score
80+. But the score is capped hard by two structural issues a "production-readiness" label can't
look past: (a) the audited "Leads" capability simply does not exist, which — if leads are an
expected part of this CRM module's contract — means the module is materially incomplete, not just
buggy; and (b) the one role a real tenant would assign to run campaigns (SALES_MANAGER) cannot
use the feature at all out of the box, which alone would block any real-world rollout until fixed.
The broken permission-guard test suite (finding 3) is a moderate deduction on its own — it means
this module's most safety-critical routes (approval, sender-identity, webhook management) have no
working regression protection, discovered only because this audit ran the tests standalone rather
than trusting a prior "tests exist" claim.
