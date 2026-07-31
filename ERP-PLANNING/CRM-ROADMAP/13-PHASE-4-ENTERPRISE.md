# Phase 4 — Enterprise

**Timeframe:** 9–12+ months. **Theme:** capabilities that matter once volume and org complexity
justify them — not before. **Confidence:** lower than Phases 1–3; treat every feature below as a
candidate to re-validate against actual business need at the time Phase 3 completes, not a fixed
commitment. Specs here are intentionally lighter — enough to scope and estimate, not a fully
implementation-ready blueprint the way Phases 1–3 are, matching this phase's genuinely lower
near-term confidence.

---

## Feature 1: Field Sales / Distributor CRM

**Objective:** Route planning, GPS check-in/out, offline visit logging for reps covering physical
territory (FMCG/apparel distribution) — table stakes in Indian distribution, absent from this
platform and from Salesforce's core product without a paid add-on.

**Business value:** 8/10. **Priority:** Nice to Have. **Complexity:** High.

**Technical design:** Reuses the offline-first sync architecture already proven for POS (idempotency,
conflict resolution — per prior offline-first roadmap work) rather than building new offline infra.
`crm_field_visits`, `crm_visit_routes`.

**Files/modules likely to change:** New mobile-first frontend surface (evaluate PWA-extension of
Phase 3 Feature 4's mobile work vs. a genuinely separate app); `apps/sales-service/` for visit/route
APIs.

**Database impact:** `crm_field_visits`, `crm_visit_routes` — both need `tenant_id`, branch/territory
scoping from day one (AR-6 precedent).

**API impact:** `/field-visits`, `/visit-routes` — offline-sync-aware (delta sync, conflict
resolution matching the existing POS pattern, not a naive last-write-wins).

**UI changes:** Map + checklist mobile view; route assignment UI for distribution managers.

**Testing requirements:** Integration tests for offline-sync conflict scenarios, mirroring the rigor
of existing POS offline idempotency tests.

**Playwright E2E scenarios:** Visit logged offline syncs correctly on reconnect; a route with
multiple stops shows correct completion state; GPS check-in records accurate location data.

**Edge cases:** Two reps' visit logs conflicting after simultaneous offline edits (same conflict
class POS already solved — reuse the resolution strategy, don't invent a new one).

**Security considerations:** Location data is sensitive — access scoped to the rep's own visits and
their manager, not tenant-wide by default.

**Performance considerations:** Offline-first by design; sync payload size matters for
low-connectivity field conditions.

**Rollback plan:** Additive; disabling the feature stops new visit logging without affecting
existing CRM data.

**Dependencies:** Benefits from Contact & Account Hierarchy (Phase 1) for correctly modeling
distributor accounts.

**Acceptance criteria:** A field rep can complete a route offline and have it sync correctly.

**Definition of Done:** Standard DoD plus offline-conflict test parity with existing POS coverage.

---

## Feature 2: WhatsApp Commerce

**Objective:** Browse-and-order catalog inside a WhatsApp chat, not just broadcast messages.

**Business value:** 8/10. **Priority:** Nice to Have. **Complexity:** High.

**Technical design:** Meta WhatsApp Business Commerce API integration; order webhooks land in
`sales-service` and create a quotation/order through the existing creation path (same reuse
discipline as every other feature in this roadmap — no parallel order-creation logic).

**Files/modules likely to change:** `apps/notification-service/` (Meta API integration point,
consistent with where WhatsApp is already integrated), `apps/sales-service/` (order webhook
consumer).

**Database impact:** `crm_whatsapp_catalog_orders` (tracking table linking WhatsApp-originated orders
to the real order record).

**API impact:** New inbound webhook for WhatsApp commerce order events.

**UI changes:** Catalog is provider-hosted (Meta), minimal ERP-side UI beyond an order-source
indicator on existing order screens.

**Testing requirements:** Webhook signature verification (same discipline as Phase 2's Omnichannel
Inbox), order-creation-from-webhook integration test.

**Playwright E2E scenarios:** A simulated WhatsApp commerce order webhook creates a correctly-priced
order visible in the standard order list, tagged with its WhatsApp origin.

**Edge cases:** Catalog pricing drift between Meta's cached catalog and live ERP pricing at order
time (must reconcile or reject, not silently honor a stale price).

**Security considerations:** Signature verification mandatory, mirrors §2.2 of the security plan.

**Performance considerations:** Low — order volume from this channel is unlikely to be
performance-critical initially.

**Rollback plan:** Additive; disabling the webhook stops new WhatsApp-sourced orders without
affecting existing ones.

**Dependencies:** Benefits from Omnichannel Inbox (Phase 2) infrastructure for webhook handling
patterns.

**Acceptance criteria:** A customer can complete a purchase inside WhatsApp that lands correctly in
the ERP's order pipeline.

**Definition of Done:** Standard DoD plus price-reconciliation edge case explicitly resolved.

---

## Feature 3: Festival Intelligence AI

**Objective:** AI-suggested campaign timing and stock pre-positioning ahead of Diwali/wedding
season, extending the existing `businessSeasons` entity rather than requiring manual season
creation.

**Business value:** 7/10. **Priority:** Nice to Have. **Complexity:** High.

**Technical design:** Extends `businessSeasons.stockMultiplier`/`loyaltyMultiplier` with a
predictive suggestion — a nightly/seasonal job analyzing prior-year sales patterns to propose
multiplier values and campaign timing, reviewed and approved by a merchandiser rather than
auto-applied.

**Files/modules likely to change:** `apps/sales-service/src/domain/` (season-prediction logic,
likely a new module rather than modifying `businessSeasons` handling directly).

**Database impact:** Additive — a suggestion/approval field set on `businessSeasons` or a companion
table, decided at implementation time.

**API impact:** Extends existing `businessSeasons` endpoints with a suggestion-review action.

**UI changes:** Suggestion review UI on the existing Seasons page.

**Testing requirements:** Unit tests on the prediction logic against historical fixture data.

**Playwright E2E scenarios:** A suggested season (with proposed multipliers) appears for
merchandiser review; approving it activates the season identically to a manually-created one.

**Edge cases:** A tenant with insufficient prior-year history for a meaningful prediction (must not
fabricate a confident suggestion from thin data — same discipline as Phase 3's AI suite).

**Security considerations:** None new.

**Performance considerations:** Batch/nightly, not real-time.

**Rollback plan:** Additive, suggestion-only (never auto-applies) — trivially safe to disable.

**Dependencies:** Benefits from the AI suite's (Phase 3) modeling discipline and infrastructure.

**Acceptance criteria:** Merchandisers get useful, data-grounded season suggestions instead of
guessing multipliers manually.

**Definition of Done:** Standard DoD plus low-data-confidence edge case explicitly handled.

---

## Feature 4: Territory Management

**Objective:** Geographic/vertical territory assignment and quota rules at scale, beyond the current
single-dimension branch scoping.

**Business value:** 5/10. **Priority:** Nice to Have. **Complexity:** Medium.

**Technical design:** A territory model layered on top of existing branch scoping (AR-6's precedent)
rather than replacing it — territories can span or subdivide branches depending on tenant structure.

**Database impact / API impact / UI changes:** New `crm_territories` table, territory-based
assignment rules extending Phase 1's `crm_assignment_rules`, a territory management UI for
Sales Ops admins.

**Testing / Playwright:** Territory-scoped list views return correctly filtered results; a rep
assigned to overlapping territories sees the union, not a conflict error.

**Edge cases:** Territory boundary changes mid-quarter (existing assignments should not silently
reassign without an explicit migration action).

**Security considerations:** Extends existing branch-scoping RBAC pattern — no new authorization
model.

**Performance considerations:** Indexed territory lookups, same discipline as branch scoping.

**Rollback plan:** Additive; tenants not using territories are entirely unaffected (branch scoping
alone continues to work as today).

**Dependencies:** Builds on branch scoping (AR-6) applied consistently across Phases 1–3.

**Acceptance criteria:** A multi-region tenant can assign reps and quotas by territory, not just
branch.

**Definition of Done:** Standard DoD.

---

## Feature 5: Sales Forecasting & Quota Management

**Objective:** Formal quota-setting and rollup, beyond the Pipeline's (Phase 2) derived forecast.

**Business value:** 6/10. **Priority:** Nice to Have. **Complexity:** Medium.

**Technical design:** `crm_sales_quotas` (per rep/team/territory/period), a rollup view comparing
actual (from Opportunities won + Invoices) against quota.

**Database impact / API impact / UI changes:** New quota table, `/quotas` CRUD, a quota-vs-actual
dashboard extending Phase 1's CRM Dashboard (Feature 8).

**Testing / Playwright:** Quota rollup math verified against a fixture dataset; a rep's individual
quota attainment displays correctly alongside team rollup.

**Edge cases:** Mid-period quota changes (must not silently recompute historical attainment against
a changed target without an explicit versioning/audit trail).

**Security considerations:** Quota figures are commercially sensitive — same field-level RBAC
consideration as Opportunity value (Phase 3 Feature 6).

**Performance considerations:** Rollup aggregation should reuse existing dashboard-projection
patterns if volume warrants.

**Rollback plan:** Additive, no risk to existing pipeline/invoice data.

**Dependencies:** Requires Sales Pipeline (Phase 2 Feature 1) as its actual-vs-quota input.

**Acceptance criteria:** Sales leadership can set and track quota attainment without a spreadsheet.

**Definition of Done:** Standard DoD.

---

## Feature 6: Partner / Channel Portal

**Objective:** Distributor self-service ordering and co-op marketing — a B2B extension of the
Self-Service Portal (Phase 3) concept to a different user population (partners, not end customers).

**Business value:** 6/10. **Priority:** Nice to Have. **Complexity:** High.

**Technical design:** A third auth scope alongside staff and `CUSTOMER` — a `PARTNER` role, following
the exact same isolation discipline AR-5 established for the customer portal (self-scoped data
access, no inherited staff permissions).

**Database impact / API impact / UI changes:** Reuses much of the Portal's (Phase 3) technical
pattern; new `/partner/*` route namespace, partner-facing frontend shell.

**Testing / Playwright:** Same authorization-boundary rigor as the Customer Portal — a partner must
not access another partner's data, tested explicitly as a critical path.

**Edge cases / Security considerations:** Identical risk class to the Customer Portal (AR-5,
`06-SECURITY-PLAN.md` §2.3) — apply the same mandatory security review gate before shipping.

**Performance considerations:** Same per-user rate-limiting discipline as the Customer Portal.

**Rollback plan:** New route namespace and role — isolated rollback, no impact on staff or customer
portal flows.

**Dependencies:** Directly reuses the Self-Service Portal's (Phase 3) architecture and lessons
learned — should not be built until that portal has been live and validated in production.

**Acceptance criteria:** A distributor partner can self-serve ordering without staff involvement,
provably isolated from other partners' data.

**Definition of Done:** Standard DoD plus mandatory security review, same gate as the Customer
Portal.

---

## Feature 7: CTI / Call Center Integration

**Objective:** Click-to-call and automatic call logging against the customer record.

**Business value:** 5/10. **Priority:** Nice to Have. **Complexity:** High.

**Technical design:** Third-party CTI provider integration (specific vendor not yet chosen — this is
a genuine open decision, not a details-TBD placeholder); call events write to
`customer_interactions` (existing table, `CALL` type) or the newer conversation model
(Phase 2 Feature 5) depending on which better fits by the time this is built.

**Database impact / API impact / UI changes:** Likely no new core CRM table — reuses existing
interaction/conversation logging; new inbound webhook from the CTI provider; click-to-call button on
Customer 360/Leads/Opportunities.

**Testing / Playwright:** Call-event webhook creates a correctly-attributed interaction record;
click-to-call initiates a call through the provider's API correctly.

**Edge cases:** Missed/voicemail calls still logged (not just connected calls); call recording
consent/compliance (jurisdiction-dependent — flag as a legal question to resolve before building,
not an engineering default to assume).

**Security considerations:** Call recordings, if stored, are sensitive — access control and
retention policy need explicit decisions before this ships, not left implicit.

**Performance considerations:** Low — call volume is inherently bounded.

**Rollback plan:** Additive integration; disabling it stops new call logging without affecting
history.

**Dependencies:** Benefits from the Omnichannel Inbox's (Phase 2) conversation model if that's the
chosen integration point.

**Acceptance criteria:** Calls are logged against the right customer without manual data entry.

**Definition of Done:** Standard DoD plus explicit resolution of the recording-consent/retention
question before implementation, not after.

---

## Feature 8: Public CRM API, Developer Portal & BI/Data-Warehouse Export

**Objective:** A first-class external API surface beyond today's outbound-only webhooks, plus
scheduled export for external BI tools.

**Business value:** 5/10. **Priority:** Nice to Have. **Complexity:** Medium.

**Technical design:** A versioned, API-key-authenticated public API surface over read-mostly CRM
data (distinct from the internal staff JWT model — a third authentication mechanism, API keys, not
user sessions). BI export reuses `scheduler-service`'s existing export-job infrastructure
(`TECH_AUDIT.md` §18) for scheduled dumps to a destination (S3/MinIO-compatible, consistent with
existing object storage) that external tools (Power BI, Looker) can read.

**Database impact:** `crm_api_keys` (tenant-scoped, permission-scoped) if not already generalized
elsewhere in the platform — check for an existing platform-wide API-key mechanism before building a
CRM-specific one.

**API impact:** New versioned public API namespace, rate-limited per key, documented via a developer
portal (new, or extending the existing `docs-site` app if that's a better fit given it's already a
real, if under-linked, documentation surface per prior audit findings).

**UI changes:** API key management UI (generate/revoke), export-schedule configuration UI.

**Testing / Playwright:** API key authentication and scoping tests (a key scoped to read-only Leads
must not be usable to write Opportunities); export job produces correctly-formatted output matching
a fixture.

**Edge cases:** A revoked API key must fail immediately, not on next cache refresh; export jobs
against a very large dataset need the same async-job discipline as Phase 1's import tooling.

**Security considerations:** API keys are a new credential type in this codebase — storage
(hashed, not plaintext, matching password-storage discipline), rotation, and scoping all need the
same rigor as JWT-based auth, not a lighter-weight afterthought because it's "just an API key."

**Performance considerations:** Rate limiting per key; export jobs must not compete with production
query load — schedule during low-traffic windows or use the replica DB connection
(`DATABASE_REPLICA_URL`, already configured per `TECH_AUDIT.md` §20) for export queries.

**Rollback plan:** Additive; disabling API key issuance or a specific export schedule has zero
impact on internal CRM functionality.

**Dependencies:** Benefits from every other CRM entity existing first — this is a surface over the
complete CRM dataset, built last for a reason.

**Acceptance criteria:** A tenant can generate a scoped API key and pull CRM data into an external
BI tool without engineering involvement per request.

**Definition of Done:** Standard DoD plus API-key credential storage reviewed with the same rigor as
password storage.
