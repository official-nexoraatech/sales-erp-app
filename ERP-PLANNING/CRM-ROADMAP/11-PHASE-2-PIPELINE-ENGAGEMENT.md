# Phase 2 — Pipeline & Engagement

**Timeframe:** 3–6 months, starts after Phase 1 is deployed and its completion report exists.
**Theme:** turn the foundation into a full sales motion and deepen the engagement channels already
live. **Prerequisite:** Phase 1's Contact & Account Hierarchy and ERP-Native Integration Layer must
be in production — Sales Pipeline hard-depends on the first; forecasting/deal-sizing benefits
materially from the second (see `09-ROLLBACK-AND-RISK.md` §4).

---

## Feature 1: Sales Pipeline & Opportunity Management

**Objective:** Give bulk/wholesale/B2B deals a visible, forecastable process — the single biggest
structural gap versus Salesforce/Dynamics identified in the gap analysis.

**Business value:** 10/10 — highest-value feature in this entire roadmap.

**Priority:** Must Have. **Complexity:** High.

**Technical design:** `crm_opportunities` (stage, value, probability, expected close date),
`crm_opportunity_line_items` (reuses the item catalog — no duplicate product model),
`crm_pipeline_stages` (configurable per deal type), `crm_opportunity_history`. Stage-won triggers
the existing `quotation.routes.ts` creation path (AR-2 discipline applied here too: reuse, don't
duplicate, the quotation-creation logic). Stage transitions can require exit criteria (e.g. a
quotation must be attached before "Negotiation → Won" is allowed).

**Files/modules likely to change:**

- `packages/db-client/src/schema/crm.ts` (new tables)
- New: `apps/sales-service/src/api/opportunity.routes.ts`,
  `apps/sales-service/src/domain/OpportunityService.ts`
- `apps/sales-service/src/domain/QuotationService.ts` (called on stage-won, not duplicated)
- New: `apps/web-frontend/src/pages/crm/pipeline/` (Kanban pipeline view, forecast dashboard)
- Opportunity line items call the ERP-Native Integration Layer (Phase 1, Feature 5) for live stock
  badges

**Database impact:** `crm_opportunities`, `crm_opportunity_line_items`, `crm_pipeline_stages`,
`crm_opportunity_history`. Indexes: `(tenant_id, stage, branch_id)`, `(tenant_id,
expected_close_date)` per `07-PERFORMANCE-PLAN.md` §2. `branch_id` implemented from day one per
AR-6.

**API impact:** `/opportunities`, `/opportunities/:id/won`, `/opportunities/:id/lost`,
`/pipeline-stages`. Events: `OPPORTUNITY_CREATED`, `OPPORTUNITY_STAGE_CHANGED`,
`OPPORTUNITY_WON`, `OPPORTUNITY_LOST`.

**UI changes:** Kanban pipeline board with weighted-value column totals; a forecast dashboard
(commit/best-case/pipeline bands) for managers; inline stock/credit badges on line items (Phase 1
Feature 5 integration).

**Testing requirements:** Unit: forecast-weighting math (value × probability by stage), stage
exit-criteria enforcement. Integration: `opportunity.integration.test.ts` — full stage lifecycle
including the won→quotation handoff, verified as a single atomic operation with the outbox event.

**Playwright E2E scenarios:**

1. Create an opportunity, advance through stages via drag-and-drop, mark Won → a Quotation is
   created and linked, visible from both the opportunity and the quotation.
2. Attempt to advance to "Won" without meeting exit criteria (e.g. no quotation attached) → blocked
   with a specific message, not a silent no-op.
3. Mark an opportunity Lost with a reason → appears correctly in loss-reason reporting.
4. Branch-scoped sales rep sees only their branch's pipeline; a branch-unrestricted manager sees all
   — regression-checks AR-6.
5. Opportunity line item shows a live stock badge that matches the actual current stock level
   (cross-verified against Inventory).

**Edge cases:** An opportunity with zero line items (should this be allowed pre-quotation-stage? —
decide at implementation time, document the rule); a deal that stalls for months (should surface in
the "stage-aged" automation, not silently sit); concurrent stage-change attempts by two reps
(optimistic locking via `version`, matching this codebase's existing concurrency pattern).

**Security considerations:** New permissions: `OPPORTUNITY_VIEW`, `OPPORTUNITY_CREATE`,
`OPPORTUNITY_UPDATE`, `OPPORTUNITY_STAGE_CHANGE`, `OPPORTUNITY_DELETE`. Deal value is
commercially sensitive — confirm it's excluded from any role that shouldn't see margin/pricing
data (cross-reference existing `PRICE_OVERRIDE`/`DISCOUNT_OVERRIDE` permission precedent).

**Performance considerations:** Pipeline board query must be indexed (`07-PERFORMANCE-PLAN.md` §2);
avoid N+1 queries when rendering stock badges across many line items on the board view (batch the
ERP-Native layer call, don't call it per-card).

**Rollback plan:** Additive schema; the won→quotation handoff is the one piece of new _behavior_ on
an existing entity (Quotation) — rollback reverts to opportunities existing but not auto-creating
quotations, no data loss to existing quotations either way.

**Dependencies:** Hard-depends on Phase 1 Feature 1 (Contact & Account Hierarchy). Soft-depends on
Phase 1 Feature 5 (ERP-Native Integration Layer) for the stock/credit badges — buildable without it,
but ships incomplete.

**Acceptance criteria:** A wholesale deal can be tracked from first contact through Won/Lost with an
accurate, branch-scoped forecast view for managers.

**Definition of Done:** Standard DoD plus: forecast math independently verified against a hand-
computed fixture; branch scoping tested for both a scoped and an unscoped user.

---

## Feature 2: Visual Customer Journey Builder

**Objective:** Multi-step, branching, cross-channel automation sequences — today's automation is
single-trigger only.

**Business value:** 8/10. **Priority:** Should Have. **Complexity:** High.

**Technical design:** Per AR-3, journeys compile to the same scheduler-cron mechanism already
driving `campaignAutomationRules`, extended with per-customer branching state
(`crm_journey_enrollments`). Every message-sending step calls `CampaignService.send()` — inherits
consent/frequency-cap enforcement for free.

**Files/modules likely to change:**

- `packages/db-client/src/schema/crm.ts` (new tables)
- New: `apps/sales-service/src/domain/JourneyService.ts`,
  `apps/sales-service/src/api/journey.routes.ts`
- `apps/scheduler-service/` (extend cron evaluation to include journey-step transitions)
- `apps/sales-service/src/domain/CampaignService.ts` (consumed as the leaf action, not modified)
- New: `apps/web-frontend/src/pages/crm/journeys/` (canvas/node-graph editor, per-customer debug
  view)

**Database impact:** `crm_journeys`, `crm_journey_steps`, `crm_journey_enrollments`,
`crm_journey_step_events`. Index: `(journey_id, current_step_id)` — the scheduler's hot-path query
per `07-PERFORMANCE-PLAN.md` §2.

**API impact:** `/journeys`, `/journeys/:id/publish`, `/journeys/:id/enrollments`. Events:
`JOURNEY_STEP_ENTERED`, `JOURNEY_COMPLETED`.

**UI changes:** Drag-and-drop canvas (triggers, delays, branches, actions) built with existing
dependencies — no new graph library unless justified (`05-UI-UX-PLAN.md` §1); per-step
drop-off/funnel analytics.

**Testing requirements:** Unit: branch-condition evaluation logic. Integration:
`journey.integration.test.ts` — a customer enrolled in a 3-step journey with a branch condition
correctly takes the right path and receives the right messages, verified against real
`campaignRecipients` rows created by the underlying `CampaignService.send()` calls.

**Playwright E2E scenarios:**

1. Build a 3-step journey (welcome → wait 3 days → conditional offer) → publish → a test customer
   enrolls and receives step 1's message.
2. A branch condition (e.g. "made a purchase") correctly routes an enrolled customer down the
   matching path.
3. Preview-affected-customer-count safeguard (per `09-ROLLBACK-AND-RISK.md`'s risk mitigation) shows
   before publish, not just after.
4. Feature-flag disable of the journey engine stops all further step evaluation without needing a
   deploy — verifies the rollback mechanism itself.

**Edge cases:** A customer who unsubscribes mid-journey (must exit cleanly, respecting the existing
`customerCommunicationPreferences` gate — a published journey must not become a way to bypass
consent); a journey referencing a deleted/deactivated campaign template; re-entry rules (can a
customer re-enter a completed journey, and under what condition — must be explicit, not accidental).

**Security considerations:** No new attack surface — internal-staff-authored automation only. New
permissions: `JOURNEY_VIEW`, `JOURNEY_CREATE`, `JOURNEY_PUBLISH`, `JOURNEY_DELETE` — publish is
higher-risk than create/edit (can affect a large customer segment at scale), gate accordingly.

**Performance considerations:** `07-PERFORMANCE-PLAN.md` §4 — measure scheduler-service's existing
cron headroom before this ships; the per-tick evaluation cost scales with active enrollments, not
journey count.

**Rollback plan:** Feature-flaggable (per `09-ROLLBACK-AND-RISK.md` §1) — this is the roadmap's
recommended flag-gated feature given its blast radius if a bad journey definition runs at scale.

**Dependencies:** Reuses `campaignAutomationRules`' mechanism (AR-3) — no new schema dependency on
Phase 1, but should ship after the Campaign Studio engagement upgrade (Feature 6 below) so journeys
can branch on open/click events, not just purchase events, from day one.

**Acceptance criteria:** A marketer can build and publish a multi-step branching journey without
engineering involvement, and see per-step conversion.

**Definition of Done:** Standard DoD plus: scheduler load-tested with a realistic enrollment volume
before sign-off; feature flag verified to stop evaluation immediately when toggled off.

---

## Feature 3: Loyalty & Rewards — Tiering Layer

**Objective:** Tiers, redemption catalog, and point expiry on top of the existing points ledger.

**Business value:** 7/10. **Priority:** Should Have. **Complexity:** Medium.

**Technical design:** Extends `LoyaltyService.ts`. Tier derived nightly (or on-transaction) from
rolling lifetime spend/points, stored on the customer record. Redemption is a new transaction type
in the **existing** `loyaltyTransactions` ledger — not a parallel ledger.

**Files/modules likely to change:**

- `packages/db-client/src/schema/sales.ts` (`loyaltyTransactions` — add `expiry_at`),
  `packages/db-client/src/schema/crm.ts` (new tier/redemption tables)
- `apps/sales-service/src/domain/LoyaltyService.ts` (extend, don't replace)
- POS checkout flow (`apps/pos-frontend/`) gains a redemption picker
- New: `apps/web-frontend/src/pages/crm/loyalty/` (tier config, redemption catalog management)

**Database impact:** `crm_loyalty_tiers`, `crm_loyalty_redemptions`, `crm_redemption_catalog`;
`loyaltyTransactions.expiry_at` (additive).

**API impact:** `/loyalty/tiers`, `/loyalty/redemptions`, `/loyalty/redemption-catalog`. Event:
`LOYALTY_TIER_CHANGED`, `LOYALTY_REDEEMED`.

**UI changes:** Tier badge on Customer 360 and POS checkout; redemption picker at point-of-sale.

**Testing requirements:** Unit: tier-threshold evaluation, redemption-debit correctness (must never
allow negative point balance). Integration: `loyalty-tier.integration.test.ts` — this is a
**critical-path** test per `08-TESTING-STRATEGY.md` §2 given its financial adjacency; 100% coverage
required on the debit logic specifically.

**Playwright E2E scenarios:**

1. A customer crosses a tier threshold → tier badge updates on Customer 360 without manual
   intervention.
2. Redeem points at POS checkout → balance debits correctly, discount applies, receipt reflects it.
3. Attempt to redeem more points than available → blocked cleanly, not an overdraw.
4. A point-expiry-warning notification fires for points nearing expiry (test with a short test-only
   expiry window).

**Edge cases:** Simultaneous redemption attempts from two sessions for the same customer (must not
double-spend — needs the same locking discipline as stock deduction); a tier downgrade (customer's
rolling spend drops) — decide and document whether downgrades happen automatically or require
review, since this is customer-experience-sensitive.

**Security considerations:** New permissions: `LOYALTY_TIER_MANAGE`, `LOYALTY_REDEEM`. Redemption at
POS should be cashier-permitted but not cashier-configurable (tier/catalog config is a separate,
higher-privilege permission).

**Performance considerations:** Redemption-catalog lookup at checkout must be fast (POS is a
latency-sensitive UI) — cache the catalog client-side per session, don't refetch per redemption
attempt.

**Rollback plan:** Additive; redemption debit logic rollback = redeploy previous `LoyaltyService`,
existing point balances unaffected since the ledger itself doesn't change shape.

**Dependencies:** None hard from Phase 1. Soft-relationship with Feature 4 (Referral) below, which
reuses this same ledger as its payout rail.

**Acceptance criteria:** Tiers auto-evaluate correctly; redemption at POS never allows a negative
balance under concurrent load.

**Definition of Done:** Standard DoD plus: concurrent-redemption test passes (mirrors the existing
stock-deduction concurrency test's rigor, per `CODING_STANDARDS.md` §6.4).

---

## Feature 4: Referral Program Engine

**Objective:** Referral codes, fraud guardrails, reward payout via the existing loyalty ledger —
genuinely absent today.

**Business value:** 7/10. **Priority:** Should Have. **Complexity:** Low.

**Technical design:** `crm_referral_codes` (per-customer unique code), `crm_referral_events`
(shared→clicked→signed up→purchased funnel), `crm_referral_rewards`. Payout on a qualifying
referee purchase credits both parties through the **existing** `loyaltyTransactions` ledger (via
Feature 3's redemption/credit mechanism) — no new reward rail.

**Files/modules likely to change:**

- `packages/db-client/src/schema/crm.ts` (new tables)
- New: `apps/sales-service/src/api/referral.routes.ts`,
  `apps/sales-service/src/domain/ReferralService.ts`
- `apps/sales-service/src/domain/LoyaltyService.ts` (called for payout, not duplicated)
- New: referral card component in POS receipt footer (QR) and web-frontend Customer 360

**Database impact:** `crm_referral_codes`, `crm_referral_events`, `crm_referral_rewards`.

**API impact:** `/referral-codes`, `/referral/redeem` (customer-triggered, fraud-gated server-side).
Event: `REFERRAL_REDEEMED`.

**UI changes:** "Refer a friend" card (Customer 360, later the Portal in Phase 3); QR code on POS
receipts.

**Testing requirements:** Unit — **critical-path per `08-TESTING-STRATEGY.md` §2**: self-referral
block, one-time-per-referee enforcement, device/address correlation flagging. Integration:
`referral.integration.test.ts` covering the full funnel and the fraud-block cases explicitly, not
just the happy path.

**Playwright E2E scenarios:**

1. Generate a referral code, simulate a referee's first qualifying purchase → both parties credited
   correctly via the loyalty ledger.
2. Attempt self-referral (same customer/device) → blocked.
3. Attempt to redeem the same referral code twice for the same referee → blocked (second attempt is
   a no-op, not a double payout).
4. Referral funnel report shows shared→clicked→purchased counts matching seeded test data exactly.

**Edge cases:** A referee who was already an existing customer before "signing up" via the referral
link (must not falsely count as new-customer acquisition); reward payout timing if the referee's
first order is later cancelled/returned (must claw back or hold the reward — decide the exact rule
at implementation time, document it, don't leave it implicit).

**Security considerations:** New permissions: `REFERRAL_VIEW`, `REFERRAL_CONFIGURE`. Fraud
guardrails are the security-relevant core of this feature — see `06-SECURITY-PLAN.md` §3.

**Performance considerations:** Low — referral volume is inherently bounded by customer count, not a
performance-sensitive feature.

**Rollback plan:** Additive; disabling referral-code generation stops new referrals without
affecting already-issued codes or already-paid rewards.

**Dependencies:** Depends on Feature 3 (Loyalty Tiering) for its payout mechanism — sequence after.

**Acceptance criteria:** A referral program runs end-to-end with fraud protection and correct payout,
with zero double-payout under any tested abuse scenario.

**Definition of Done:** Standard DoD plus: all three fraud-guardrail cases (self-referral,
double-redemption, suspicious-correlation flag) have explicit passing tests, not just documented
intent.

---

## Feature 5: Omnichannel Communication Hub

**Objective:** A two-way inbox — today WhatsApp/SMS/Email are broadcast-only with no reply capture.

**Business value:** 8/10. **Priority:** Should Have. **Complexity:** High.

**Technical design:** Inbound webhooks (WhatsApp Business API, email inbound-parse, SMS two-way)
write into `crm_conversations`/`crm_conversation_messages`, keyed by customer phone/email, using
`tenantSenderIdentity` (existing) to route a reply to the correct inbox. Provider-signature
verification (not shared-secret) per `06-SECURITY-PLAN.md` §2.2, idempotent per the existing
`inbox_events` pattern.

**Files/modules likely to change:**

- `packages/db-client/src/schema/crm.ts` (new tables)
- New: `apps/notification-service/src/api/inbound-webhooks.routes.ts` (or `sales-service`, per
  AR-1's exception clause — decide based on actual inbound volume expectations at implementation
  time)
- New: `apps/sales-service/src/domain/ConversationService.ts`
- New: `apps/web-frontend/src/pages/crm/inbox/` (split-pane: conversation list + thread + Customer
  360 context panel)

**Database impact:** `crm_conversations`, `crm_conversation_messages`, `crm_canned_responses`.
Index: `(tenant_id, customer_id, last_message_at)` per `07-PERFORMANCE-PLAN.md` §2.

**API impact:** `/conversations`, `/conversations/:id/messages`, plus one inbound webhook endpoint
per channel provider. No outbound-event contract change to existing campaign sends.

**UI changes:** Split-pane inbox — conversation list left, thread + Customer 360 context right.

**Testing requirements:** Unit: provider-signature verification logic (must reject a forged
webhook). Integration: `conversation-webhook.integration.test.ts` — inbound message creates/updates
a conversation thread idempotently even under a simulated provider retry.

**Playwright E2E scenarios:**

1. Simulate an inbound WhatsApp reply webhook → appears in the inbox, threaded under the correct
   customer.
2. Assign a conversation to an agent → visible in their queue.
3. Send a canned response → recorded as an outbound message in the same thread.
4. Replay the same inbound webhook payload twice (simulated provider retry) → only one message is
   created, not two.

**Edge cases:** A message from a phone number that doesn't match any existing customer (must handle
gracefully — either create a lead, per Phase 1 Feature 2's capture mechanism, or a clearly-flagged
"unknown sender" state, not a crash); a very long-running conversation thread (pagination, matching
Customer 360's timeline discipline).

**Security considerations:** Full detail in `06-SECURITY-PLAN.md` §2.2 — signature verification,
idempotency. New permissions: `CONVERSATION_VIEW`, `CONVERSATION_REPLY`, `CONVERSATION_ASSIGN`.

**Performance considerations:** Inbound webhook volume is provider-driven and bursty — the endpoint
itself must be fast (write + ack), with any heavier processing (intent classification, if built)
deferred to an async consumer, not inline in the webhook handler.

**Rollback plan:** Additive; disabling inbound webhook endpoints stops new conversation creation
without affecting existing threads (they simply stop receiving new messages).

**Dependencies:** Benefits from Customer 360 (Phase 1 Feature 3) existing as the natural place to
surface conversation history — build after, not before.

**Acceptance criteria:** A customer's WhatsApp reply to a campaign is visible and actionable inside
the ERP, not lost in a provider's own dashboard.

**Definition of Done:** Standard DoD plus: signature-forgery rejection test passes; idempotency-under-
retry test passes.

---

## Feature 6: Campaign Studio — Engagement Tracking Activation

**Objective:** Close the loop on `campaignRecipients.opened_at`/`clicked_at` — schema-complete,
write-incomplete today.

**Business value:** 8/10. **Priority:** Should Have. **Complexity:** Medium.

**Technical design:** Wrap outbound links in campaign message templates with a click-tracking
redirect (`crm_link_clicks` records the click, then updates `campaignRecipients.clickedAt`); an
email/in-app open-tracking pixel updates `openedAt`. `convertedAt` is populated via attribution
matching a subsequent purchase to a recent campaign send (UTM-style tagging).

**Files/modules likely to change:**

- `packages/db-client/src/schema/crm.ts` (new `crm_link_clicks`, `crm_campaign_variants` for A/B)
- `apps/sales-service/src/domain/CampaignService.ts` (extend — wrap links at send time)
- New: `apps/sales-service/src/api/link-tracking.routes.ts` (public redirect endpoint)
- `apps/web-frontend/src/pages/crm/CampaignDetailPage.tsx` (extend with engagement metrics, now
  populated for the first time)

**Database impact:** `crm_link_clicks`, `crm_campaign_variants`. No change to
`campaignRecipients`'s existing columns — this feature is entirely about _writing_ to columns that
already exist.

**API impact:** New public redirect endpoint (`GET /c/:trackingToken` → 302 to the real URL, records
the click first). A/B variant selection logic in `CampaignService.send()`.

**UI changes:** Campaign detail page finally shows real open/click/conversion rates instead of only
sent/delivered.

**Testing requirements:** Unit: link-wrapping/unwrapping correctness (the redirect must never break
the destination URL). Integration: a simulated click updates `clickedAt` exactly once even under
repeated clicks from the same recipient (don't overwrite a first-click timestamp with a later one,
unless that's the deliberately chosen semantic — decide and document).

**Playwright E2E scenarios:**

1. Send a test campaign, click the tracked link → `clickedAt` populates, campaign detail page
   reflects it.
2. A/B test two message variants → the detail page shows performance split correctly attributed per
   variant.
3. **Regression:** all 4 existing `campaign-*.spec.ts` files and `live-crm.spec.ts` still pass
   unmodified — this is the highest-regression-risk feature in Phase 2 per
   `08-TESTING-STRATEGY.md` §5, since it touches a live write path other specs may implicitly depend
   on.

**Edge cases:** A recipient who clicks a tracked link after opting out between send and click (must
not error, the click event itself isn't a new send); link-tracking redirect abused as an open
redirect vector (validate the destination is one this tenant's campaign actually specified, not an
arbitrary attacker-supplied URL — a real security concern for any redirect endpoint).

**Security considerations:** The public redirect endpoint is unauthenticated by necessity (recipients
aren't logged in) — must validate against a known, tenant-owned destination allowlist per campaign,
not an open redirect. This is a genuine new (small) public surface, same caution class as Phase 1's
lead-capture endpoint.

**Performance considerations:** High-QPS-tolerant by design (a redirect + fire-and-forget write) —
must not add latency to the redirect itself; the DB write can be async/best-effort if it ever
threatens redirect latency.

**Rollback plan:** Zero risk to existing send paths — disabling link-wrapping reverts to today's
plain-URL behavior; `opened_at`/`clicked_at` simply stop being written again (§2 of the rollback
doc).

**Dependencies:** None hard. Recommended to ship before Journey Builder (Feature 2) so journeys can
branch on real engagement events from day one.

**Acceptance criteria:** Campaign ROI is measurable for the first time — open/click/conversion rates
are real numbers, not permanently zero.

**Definition of Done:** Standard DoD plus: full existing CRM/campaign E2E regression suite passes
unmodified; open-redirect vulnerability explicitly tested and closed.

---

## Feature 7: Advanced Segmentation Engine

**Objective:** Behavioral/RFM/time-window operators added to the existing static-field segment
builder.

**Business value:** 7/10. **Priority:** Should Have. **Complexity:** Medium.

**Technical design:** Extends `SegmentService.ts` and `customerSegments.filterDefinition`'s rule
vocabulary (new operator types: `BETWEEN_DATES`, `PURCHASED_CATEGORY`, `RFM_SCORE`) — no new engine,
no schema change to the table itself beyond what the JSONB already supports. `crm_segment_membership_cache`
holds nightly-refreshed dynamic-segment membership per `07-PERFORMANCE-PLAN.md` §6.

**Files/modules likely to change:**

- `apps/sales-service/src/domain/SegmentService.ts` (extend operator evaluation)
- `packages/db-client/src/schema/crm.ts` (new `crm_segment_membership_cache` table)
- `apps/web-frontend/src/pages/crm/SegmentFormPage.tsx` (extend the rule-builder UI with new field
  types)

**Database impact:** `crm_segment_membership_cache` only — `customer_segments` itself is unchanged
at the schema level (JSONB already flexible enough).

**API impact:** No new routes — existing `/segments` endpoints gain support for the new operator
vocabulary in their request/response Zod schemas.

**UI changes:** Rule builder gains behavioral/RFM field pickers; a live membership-count preview
(already implied by the feature, verify it exists today — if not, add it here since it's cheap and
high-value for a marketer authoring a segment).

**Testing requirements:** Unit: each new operator's evaluation logic (date-window boundary
conditions are the classic off-by-one risk here — test inclusive/exclusive boundaries explicitly).
Integration: a dynamic segment's nightly refresh produces the same membership a live query would.

**Playwright E2E scenarios:**

1. Build a segment using a behavioral operator ("purchased Category X in last 90 days") → correct
   customers appear in the preview count.
2. A dynamic segment's membership updates after the nightly refresh reflects a customer's new
   qualifying purchase (test with a manually-triggered refresh, not a real overnight wait).
3. **Regression:** existing static-field segments (already in production use) continue to evaluate
   identically — this feature must not change behavior for existing segment definitions.

**Edge cases:** A segment combining old static operators and new behavioral operators in the same
AND/OR tree (must evaluate correctly, not treat them as incompatible); a behavioral operator
referencing a product category that's later deleted (must degrade gracefully, not crash the segment
evaluation).

**Security considerations:** No new permission needed — governed by existing segment permissions.

**Performance considerations:** `07-PERFORMANCE-PLAN.md` §6 — nightly cache refresh, not live
computation, for any segment using a behavioral operator.

**Rollback plan:** Additive; disabling new operator types in the UI reverts to today's static-only
builder with zero impact on existing segments.

**Dependencies:** None hard. Recommended to ship early in Phase 2 since Feature 2 (Journey Builder)
and Feature 6 (Campaign engagement) both benefit from richer segmentation as an input.

**Acceptance criteria:** A marketer can build "customers who bought X but haven't returned in 90
days" without engineering help, and existing segments are provably unaffected.

**Definition of Done:** Standard DoD plus: existing segment regression explicitly verified (not
just new-feature tests).
