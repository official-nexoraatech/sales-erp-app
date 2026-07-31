# Phase 3 — Intelligence

**Timeframe:** 6–9 months, starts once Phase 1 + 2 are substantially shipped — the AI suite needs
real pipeline/ticket/journey data to score against, and the Portal needs Ticketing (Phase 1) and
Loyalty Tiering (Phase 2) to have something to surface (`09-ROLLBACK-AND-RISK.md` §4).
**Theme:** layer prediction and self-service on top of a now-complete data model.

---

## Feature 1: AI & Predictive Intelligence Suite

**Objective:** Extend `HealthScoringService` from a single score into churn prediction, next-best-
action, and product recommendations — trained on data this ERP already owns.

**Business value:** 9/10. **Priority:** Should Have. **Complexity:** High.

**Technical design:** Batch-scored nightly per tenant (per `07-PERFORMANCE-PLAN.md` §3 — never
synchronous), cached to `crm_health_scores`/`crm_churn_predictions`/`crm_next_best_actions`/
`crm_product_recommendations`. Every score ships with a contributing-factor explanation, not just a
number — this is a stated requirement, not a nice-to-have, because unexplained AI scores erode rep
trust (per the risk register). Start with statistical models (recency/frequency/monetary decay,
collaborative filtering for recommendations), not an LLM dependency — this codebase has zero AI
stack today (`TECH_AUDIT.md` §16) and this feature should not be the one that silently introduces an
external AI vendor dependency without a separate, explicit decision.

**Files/modules likely to change:**

- `packages/db-client/src/schema/crm.ts` (new tables)
- `apps/sales-service/src/domain/HealthScoringService.ts` (extend, this is its natural growth point)
- New: `apps/scheduler-service/` nightly scoring job (existing cron pattern, no new job mechanism)
- Customer 360 page (Phase 1 Feature 3) — extend with recommendation cards + "why" explanation +
  dismiss/feedback control

**Database impact:** `crm_health_scores`, `crm_churn_predictions`, `crm_next_best_actions`,
`crm_product_recommendations`.

**API impact:** No new public write API. Extends Customer 360's existing composed
`GET /customers/:id/360` response (per AR-2's discipline: extend the existing composition, don't add
a parallel endpoint) — plus a lightweight `POST /recommendations/:id/feedback` for the dismiss/accept
signal that improves the model over time.

**UI changes:** Recommendation cards inline on Customer 360 and a rep's daily dashboard, each with a
one-line "why" and a feedback control.

**Testing requirements:** Unit: scoring-model correctness against fixture data with known expected
outputs (this is where a statistical model is easier to test than a black-box one — exploit that).
Integration: nightly job populates the cache tables correctly for a tenant with realistic seeded
history.

**Playwright E2E scenarios:**

1. A customer with a clear churn pattern (long gap after a fast-purchase streak, seeded test data)
   shows a churn-risk flag on Customer 360 with a plausible explanation.
2. Dismissing a recommendation records feedback and doesn't re-surface the identical suggestion
   immediately.
3. A brand-new customer with minimal history shows no false-confidence prediction (a stated edge
   case, not just a UI nicety — a model outputting a "churn risk" score off two data points is a
   correctness bug).

**Edge cases:** Insufficient data volume for a meaningful score (must show "not enough data yet," not
a misleadingly confident number); a customer flagged high-risk who then makes a large purchase
(score must update on next nightly run, not persist stale for a full cycle if that's operationally
unacceptable — decide the acceptable staleness window explicitly).

**Security considerations:** No new attack surface — internal read-only feature. Recommendation
data is not more sensitive than the existing customer/order data it's derived from.

**Performance considerations:** `07-PERFORMANCE-PLAN.md` §3 in full — nightly batch is a hard
requirement, not a suggestion; this is the item most likely to silently regress into synchronous
computation under implementation pressure ("just compute it on page load, it's easier") — resist
that.

**Rollback plan:** Feature-flaggable per the risk register (§3, "wrong predictions are a trust
problem, not just a bug") — disable the recommendation surface independently of the underlying
scoring job if predictions prove unreliable in production.

**Dependencies:** Requires Customer 360 (Phase 1) as its display surface; benefits materially from
Phase 2's richer interaction data (journey steps, ticket history) as model inputs, though it can
ship with Phase 1-only data at reduced accuracy if sequencing pressure requires it.

**Acceptance criteria:** Reps see actionable, explained recommendations they can accept or dismiss;
zero false-confident predictions on low-data customers.

**Definition of Done:** Standard DoD plus: every prediction surfaced in the UI has a non-empty,
specific explanation string — no bare scores without rationale ship.

---

## Feature 2: Self-Service Customer Portal

**Objective:** Customer-facing order/ticket/loyalty/referral self-service — this codebase's first
authenticated non-employee surface.

**Business value:** 7/10. **Priority:** Should Have. **Complexity:** High.

**Technical design:** Per AR-5, a new `CUSTOMER` auth role (not part of the 13 staff defaults),
issued via the existing `auth-service` JWT mechanism but scoped strictly to `customerId`. Every
portal route filters `WHERE customer_id = :selfCustomerId` server-side from the JWT claim, never
from client input. Read-mostly over existing sales/accounting/loyalty/ticket data.

**Files/modules likely to change:**

- `apps/auth-service/` (new `CUSTOMER` role, portal-scoped token issuance — likely a distinct login
  endpoint, not the staff `/auth/login`)
- New: `apps/sales-service/src/api/portal.routes.ts` (or a thin new frontend-only app — decide at
  implementation time based on how distinct the portal's operational needs are from the existing
  `sales-service` API surface)
- New: `apps/web-frontend/src/portal/` or a new `apps/customer-portal/` frontend — separate route
  tree / layout from staff `Layout.tsx`, per `05-UI-UX-PLAN.md` §3
- `packages/shared-types/src/__tests__/route-guard-coverage.test.ts` — portal routes added, not
  exempted (per `06-SECURITY-PLAN.md` §2.3)

**Database impact:** `crm_portal_sessions` if not reusing `auth-service`'s existing session model —
decide at implementation time (AR-5 leaves this open deliberately, since it depends on how
`auth-service`'s current session/refresh-token infrastructure generalizes to a second, differently-
scoped user population).

**API impact:** `/portal/orders`, `/portal/tickets`, `/portal/loyalty`, `/portal/preferences` — a
**separate route namespace** from the internal-staff equivalents even where underlying data
overlaps, because the authorization model differs fundamentally (self-only vs. tenant-wide).

**UI changes:** A lightweight, mobile-first customer-facing shell: order timeline, ticket list with
thread view, loyalty card, referral sharing, communication preferences — copy register shifts to
customer-facing language per `05-UI-UX-PLAN.md` §5 (name things by what a customer recognizes).

**Testing requirements:** Unit: JWT claim extraction and query-scoping logic. Integration —
**critical-path, 100% coverage required per `08-TESTING-STRATEGY.md` §2**:
`portal-auth-boundary.integration.test.ts` proving customer A cannot access customer B's data by ID
manipulation on every single portal route, not a sample.

**Playwright E2E scenarios:**

1. Customer logs into the portal → sees only their own orders/tickets/loyalty balance.
2. **Security-critical:** attempt to access another customer's order/ticket by directly manipulating
   a URL/ID → blocked with a 403/404, not data leakage.
3. Customer raises a ticket from the portal → appears correctly in the internal ticket inbox
   (Phase 1 Feature 4), assignable by staff.
4. Customer updates communication preferences from the portal → reflected in
   `customerCommunicationPreferences`, respected by the next campaign send.
5. Support-agent impersonation of a portal session for debugging → audit-logged, matching the
   existing platform-operator impersonation pattern (per AR-5).

**Edge cases:** A customer with no linked `Account`/`Contact` (pure POS/retail history) — portal must
still function with a degraded-but-correct view, not require B2B account structure; a customer whose
email/phone is shared with another household member (identity/access edge case worth documenting
even if not fully solved in this phase — flag explicitly rather than silently ignore).

**Security considerations:** The single highest-risk item in this entire roadmap — full treatment in
`06-SECURITY-PLAN.md` §2.3. Do not ship without a dedicated security review pass distinct from
normal PR review.

**Performance considerations:** `07-PERFORMANCE-PLAN.md` §7 — different traffic shape than internal
ERP usage; per-customer rate limiting required.

**Rollback plan:** New route namespace and new auth role — rollback is disabling portal login
issuance and removing the frontend route; zero impact on internal staff flows since nothing existing
is modified, only extended.

**Dependencies:** Requires Support & Ticketing (Phase 1 Feature 4) and Loyalty Tiering (Phase 2
Feature 3) to have something real to surface.

**Acceptance criteria:** A customer can self-serve order status and support without calling anyone,
provably unable to access any other customer's data.

**Definition of Done:** Standard DoD plus: dedicated security review sign-off (not just standard PR
review) before production release; portal routes present in `route-guard-coverage.test.ts`'s
coverage, not `KNOWN_EXCEPTIONS`.

---

## Feature 3: Campaign ROI & Attribution Reporting

**Objective:** Revenue attributed to a specific campaign/journey, building on Phase 2's engagement-
tracking activation.

**Business value:** 7/10. **Priority:** Should Have. **Complexity:** Medium.

**Technical design:** Extends the `convertedAt` attribution logic started in Phase 2 Feature 6 —
matches a purchase to a recent campaign send/click within an attribution window, surfaces spend-vs-
revenue on the Campaign Detail page and a new cross-campaign ROI report.

**Files/modules likely to change:** `apps/sales-service/src/domain/CampaignService.ts` (attribution-
matching logic), `apps/web-frontend/src/pages/crm/CampaignsPage.tsx` (ROI column/report view).

**Database impact:** None beyond what Phase 2 Feature 6 already added (`crm_link_clicks`,
`campaignRecipients.convertedAt`) — this feature is reporting on top of that data, not new capture.

**API impact:** `GET /crm/campaigns/roi-report` — aggregate, read-only.

**UI changes:** ROI column on the campaign list; a dedicated cross-campaign comparison report.

**Testing requirements:** Unit: attribution-window matching logic (a purchase 40 days after a click
should not attribute to a campaign with a 30-day window — boundary conditions matter here).
Integration: attribution correctly matches a seeded purchase to the right campaign, and correctly
does _not_ attribute an unrelated purchase.

**Playwright E2E scenarios:**

1. A customer clicks a campaign link, then purchases within the attribution window → campaign
   detail shows the attributed revenue.
2. A purchase outside the attribution window is correctly excluded from that campaign's numbers.
3. Cross-campaign ROI report ranks campaigns correctly by a hand-verified fixture dataset.

**Edge cases:** A customer who clicks two different campaigns' links before purchasing (attribution
model must have an explicit rule — e.g. last-click — documented, not ambiguous); a returned/cancelled
order that was previously attributed (must reverse the attribution, not leave stale revenue
counted).

**Security considerations:** No new attack surface — read-only aggregate reporting, same permission
model as existing campaign viewing.

**Performance considerations:** Attribution matching should run as part of the existing purchase-
completion flow or a near-real-time consumer, not a heavy report-time join across the full order
history each time the report is viewed.

**Rollback plan:** Read-only reporting feature — trivial rollback, no data risk.

**Dependencies:** Hard-depends on Phase 2 Feature 6 (Campaign engagement tracking activation).

**Acceptance criteria:** Marketing can see real revenue-per-campaign, not just sent/delivered counts.

**Definition of Done:** Standard DoD plus: attribution-window edge cases explicitly tested, order-
cancellation reversal verified.

---

## Feature 4: Mobile CRM

**Objective:** Give reps and managers CRM access away from a desktop.

**Business value:** 7/10. **Priority:** Should Have. **Complexity:** High.

**Technical design:** Given `TECH_AUDIT.md` §11 confirms zero mobile infrastructure exists (no React
Native/Flutter/Capacitor anywhere in this codebase) and §2 confirms both frontends are Vite SPAs, the
lowest-risk path consistent with this codebase's stated minimalism (`05-UI-UX-PLAN.md` §1 — no new
heavy dependency without justification) is a **responsive-first PWA** extension of
`web-frontend`'s existing CRM pages (Customer 360, Pipeline, Tickets, Leads), not a new native app or
new framework. Revisit native only if PWA proves insufficient for a real field-usage need (e.g.
offline — see Phase 4's Field Sales feature, which is the actual offline-capable mobile surface).

**Files/modules likely to change:** `apps/web-frontend/` — responsive breakpoint work on existing
CRM pages (already a DoD requirement per `CODING_STANDARDS.md` §10, this feature is closing any gaps
that slipped through), PWA manifest/service-worker addition if not already present.

**Database impact:** None.

**API impact:** None — reuses every existing CRM endpoint.

**UI changes:** Mobile-optimized layouts for Customer 360, Pipeline Kanban (likely a list view on
small screens, Kanban doesn't translate well to a phone), Ticket inbox, Lead capture.

**Testing requirements:** Playwright's existing `mobile-responsive-smoke.spec.ts` pattern (already in
this codebase's E2E suite) extended to cover the new CRM pages specifically.

**Playwright E2E scenarios:**

1. Customer 360, Pipeline, and Ticket inbox all render usably at common phone viewport sizes (extend
   the existing `mobile-responsive-smoke.spec.ts`).
2. Pipeline's Kanban degrades to a usable list/filter view on narrow viewports rather than an
   unusable squeezed board.
3. PWA install prompt and offline-shell behavior (if implemented) function correctly.

**Edge cases:** Touch-target sizing on the Kanban drag-and-drop interaction (drag-and-drop is
notoriously poor on mobile — consider a tap-to-advance alternative for small screens rather than
forcing drag interaction).

**Security considerations:** No new attack surface — same auth, same permissions, just a different
viewport.

**Performance considerations:** Mobile network conditions are a real constraint this codebase's
existing desktop-oriented pages may not have been tuned for — bundle size and request waterfall on
Customer 360 (already the most composition-heavy page in the roadmap) deserve specific mobile
performance testing.

**Rollback plan:** CSS/responsive-layer changes only — trivial to revert, zero data risk.

**Dependencies:** Benefits from every other CRM page existing first (it's a presentation-layer
feature over the full CRM surface, not a new capability).

**Acceptance criteria:** A rep can meaningfully use Customer 360, Pipeline, and Tickets from a phone
browser.

**Definition of Done:** Standard DoD plus: extended `mobile-responsive-smoke.spec.ts` coverage for
every new CRM page shipped in this roadmap.

---

## Feature 5: Multi-language Communication

**Objective:** Regional-language templates for SMS/WhatsApp/Email campaigns.

**Business value:** 6/10. **Priority:** Should Have. **Complexity:** Medium.

**Technical design:** Extends `campaignTemplates` with a `language` dimension and a per-customer
preferred-language field (new column on `customers` or a `crm_customer_preferences` addition).
`CampaignService.send()` selects the matching-language variant at send time, falling back to a
tenant default if the customer's preferred language has no template.

**Files/modules likely to change:** `packages/db-client/src/schema/crm.ts` (`campaignTemplates` +
language column, or a new `crm_campaign_template_translations` table if templates need multiple
simultaneous language variants — decide at implementation time based on whether templates are
1:1-per-language or need a translation-set model), `apps/sales-service/src/domain/CampaignService.ts`.

**Database impact:** Additive column(s) on `campaignTemplates` and `customers`, or a new join table
for the translation-set model.

**API impact:** Existing campaign/template endpoints gain a `language` field — additive to the
request/response schema, not a breaking change.

**UI changes:** Language selector in the template editor and customer profile; a preview-per-
language view before sending.

**Testing requirements:** Unit: fallback logic when a customer's preferred language has no matching
template variant.

**Playwright E2E scenarios:**

1. Create a template with two language variants → a campaign sent to a mixed-language customer list
   delivers the correct variant to each recipient.
2. A customer with a preferred language that has no template variant falls back to the tenant
   default without erroring.

**Edge cases:** A customer's preferred language changing mid-campaign-send (use the value at send
time, document that this isn't retroactive); right-to-left or non-Latin script rendering in email
templates (verify the existing Handlebars template rendering handles this correctly, don't assume).

**Security considerations:** None new.

**Performance considerations:** Negligible — a lookup, not a computation.

**Rollback plan:** Additive; campaigns without language variants continue to send the single
existing template exactly as today.

**Dependencies:** None hard.

**Acceptance criteria:** A tenant serving customers across multiple languages can send correctly-
localized campaigns without manual per-language campaign duplication.

**Definition of Done:** Standard DoD plus: fallback-to-default behavior explicitly tested.

---

## Feature 6: Field-level RBAC for CRM Records

**Objective:** Restrict sensitive fields (e.g. deal margin, cost basis) by role, not just gate whole
pages/routes.

**Business value:** 6/10. **Priority:** Should Have. **Complexity:** Medium.

**Technical design:** Extends this codebase's existing RBAC model (`RBAC_ARCHITECTURE.md`) from
route-level/page-level gating to field-level response filtering on specific CRM endpoints (notably
Opportunity value/margin, per Phase 2 Feature 1's security note about commercial sensitivity). This
is new _depth_ on the existing model, not a new authorization system — implemented as a response-
serialization filter keyed off the caller's permissions, applied at the API layer.

**Files/modules likely to change:** `apps/sales-service/src/api/opportunity.routes.ts` (and any
other route carrying a field identified as needing this), a shared field-filtering utility likely
belonging in `packages/platform-sdk` given its cross-route reusability.

**Database impact:** None — this is a response-shaping concern, not a schema concern.

**API impact:** Response shape for gated endpoints varies by caller's permissions (a field is
omitted, not nulled, for callers without access — omission is safer than null, since null can be
mistaken for "no value" rather than "no access").

**UI changes:** Frontend must handle the field's potential absence gracefully (not assume it's
always present) — a small but real frontend contract change for any screen displaying a
field-filtered response.

**Testing requirements:** Unit: filter-logic correctness per permission combination. Integration: two
test users with different permission sets calling the same endpoint receive correctly different
response shapes.

**Playwright E2E scenarios:**

1. A user without margin-visibility permission views an Opportunity → the margin field is absent
   from the UI, not shown as blank/zero (which would be misleading, not just hidden).
2. A user with the permission sees the real value.

**Edge cases:** A field that's field-level-gated but also used in a calculation the UI displays
(e.g. a probability-weighted forecast that depends on value) — decide whether the _computed_ result
is also gated or only the raw field, and document the choice explicitly since it's easy to leak the
raw value indirectly through a visible derived number.

**Security considerations:** This feature _is_ a security feature — the main risk is the "leak
through a derived value" edge case above; treat it as seriously as the field-omission itself.

**Performance considerations:** Negligible — a serialization-time filter, not a query-time cost.

**Rollback plan:** Additive; disabling the filter reverts to today's behavior (full field visibility
to anyone with route-level access) — document that this is a deliberate, reviewable rollback (it
reduces security, not just a feature), not a casual toggle.

**Dependencies:** Most relevant to Phase 2's Opportunity value/margin field — can ship any time after
Phase 2 Feature 1, not blocking anything else.

**Acceptance criteria:** Sensitive CRM fields are invisible, not just visually hidden, to roles
without the specific permission.

**Definition of Done:** Standard DoD plus: derived-value leak edge case explicitly resolved and
tested, not left as an open question.
