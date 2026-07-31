# Phase 1 — Foundation

**Timeframe:** 0–3 months. **Theme:** close the gaps that block every later phase, and the one
compliance item that cannot wait. **Ships independently:** yes — every feature below is usable on
its own; none requires a later phase to be valuable.

**Sequencing within this phase:** Contact & Account Hierarchy first (Lead Management and the
ERP-Native layer both benefit from it existing, though neither hard-blocks on it — see
`09-ROLLBACK-AND-RISK.md` §4). Customer 360 and Support & Ticketing can build in parallel once
Accounts land. DLT/TRAI Compliance is independent and should not slip behind product features given
its legal nature.

---

## Feature 1: Contact & Account Hierarchy

**Objective:** Model B2B customers as accounts with multiple contacts and roles instead of one flat
customer row, so wholesale/distributor/corporate-bulk buyers can be represented correctly.

**Business value:** 9/10 — every B2B-shaped feature in later phases (Pipeline, Opportunity scoring)
assumes this exists; without it, Phase 2's Pipeline has nowhere correct to attach a multi-stakeholder
deal.

**Priority:** Must Have. **Complexity:** Medium.

**Technical design:** `crm_accounts` and `crm_account_contacts` tables, `customers.account_id`
nullable FK. Individual/retail (POS) customers get an implicit personal account created lazily on
first B2B-relevant action, not backfilled in bulk — see `03-DATABASE-MIGRATION-PLAN.md` §3. Merge/
dedupe tooling (fuzzy match on phone/email/GSTIN) ships as part of this feature, not deferred,
because duplicate accounts are the most likely first-week bug report once this ships.

**Files/modules likely to change:**

- `packages/db-client/src/schema/crm.ts` (new tables)
- `apps/sales-service/src/api/customer.routes.ts` (extend, don't replace)
- `apps/sales-service/src/domain/CustomerService.ts` (account_id wiring)
- New: `apps/sales-service/src/api/account.routes.ts`, `apps/sales-service/src/domain/AccountService.ts`
- `apps/web-frontend/src/pages/sales/customers/` (new Account detail page + contacts table)
- `apps/web-frontend/src/api/endpoints/accountApi.ts` (new)

**Database impact:** `crm_accounts`, `crm_account_contacts`, `crm_contact_roles` (new tables, see
`03-DATABASE-MIGRATION-PLAN.md`); `customers.account_id integer NULL` (additive). Indexes:
`(tenant_id, account_id)` on contacts.

**API impact:** New `/accounts`, `/accounts/:id/contacts`, `/accounts/:id/merge`. Existing
`/customers` routes unchanged in shape, gain an optional `accountId` field.

**UI changes:** New Account detail page with an inline contacts table (role, primary flag, last
contacted); "add contact" without leaving the page. Customer list gains an optional account grouping
view.

**Testing requirements:** Unit tests for dedupe-match scoring (must not be 100%-confidence-only —
needs a "suggested, not auto-merged" threshold). Integration test: creating a contact under an
account, converting an implicit personal account when a POS customer later becomes B2B.

**Playwright E2E scenarios:**

1. Create a B2B account with two contacts (Billing, Decision Maker) → both appear on the account
   detail page with correct roles.
2. Attempt to create a duplicate account (matching GSTIN) → dedupe suggestion surfaces, does not
   silently create a duplicate.
3. Existing POS customer flow (no account) still completes a sale end-to-end unmodified — regression
   check against `live-crm.spec.ts`'s existing customer-creation coverage.
4. Merge two accounts → contacts, interaction history, and past orders all correctly re-point to the
   surviving account.

**Edge cases:** Two contacts marked "primary" on the same account (must be exclusive, not silently
allowed); merging accounts with conflicting outstanding-balance records (must not silently drop
either balance); a contact with no email/phone (still a valid contact — a name-only stakeholder
record is legitimate for many wholesale relationships).

**Security considerations:** No new trust boundary — same internal-staff RBAC. New permissions:
`ACCOUNT_VIEW`, `ACCOUNT_CREATE`, `ACCOUNT_UPDATE`, `ACCOUNT_MERGE` (merge is higher-risk than
create/update — restrict to Sales Manager+ by default, not general Sales Rep).

**Performance considerations:** Dedupe-match query must not full-scan `customers` per keystroke —
debounce + indexed lookup on phone/GSTIN, not a fuzzy-match-everything approach at write time.

**Rollback plan:** Additive schema, `account_id` nullable — redeploy previous version, existing
customer flows unaffected (see `09-ROLLBACK-AND-RISK.md` §2).

**Dependencies:** None (foundation feature). **Blocks:** Sales Pipeline (Phase 2).

**Acceptance criteria:** A B2B customer can have 3+ contacts with distinct roles; the customer list
and Customer 360 both correctly show account-level aggregation; POS/retail flow is provably
unaffected by the full existing E2E suite passing unmodified.

**Definition of Done:** Standard DoD (`CODING_STANDARDS.md` §10) plus: dedupe suggestion tested with
both a true-positive and a false-positive case; merge is reversible via audit log (not literally
undoable, but fully traceable — who merged what into what, when).

---

## Feature 2: Lead Management & Capture

**Objective:** Capture and qualify interest before it becomes a paying customer.

**Business value:** 9/10 — currently zero pre-purchase visibility; this is the single most-requested
capability gap versus any competing CRM.

**Priority:** Must Have. **Complexity:** Medium.

**Technical design:** `crm_leads` with a stage enum (`NEW → CONTACTED → QUALIFIED →
CONVERTED/LOST`), `crm_lead_activities` for the interaction log, `crm_lead_sources` for attribution,
`crm_assignment_rules` for round-robin/load-based routing. Convert-to-customer creates a
`Customer`(+`Account` if B2B-flagged) and links back via `converted_from_lead_id` for attribution —
reuses `CustomerService.createCustomer()`, does not duplicate customer-creation logic.

**Files/modules likely to change:**

- `packages/db-client/src/schema/crm.ts` (new tables)
- New: `apps/sales-service/src/api/lead.routes.ts`, `apps/sales-service/src/domain/LeadService.ts`
- `apps/sales-service/src/domain/CustomerService.ts` (extend with `createFromLead()`)
- New: `apps/web-frontend/src/pages/crm/leads/` (Kanban board, Lead detail, capture widget)
- `apps/web-frontend/src/lib/navigation.ts` (add Leads to existing CRM nav group)

**Database impact:** `crm_leads`, `crm_lead_activities`, `crm_lead_sources`, `crm_assignment_rules`.
Indexes: `(tenant_id, stage, assigned_to)`, `(tenant_id, created_at)` — see `07-PERFORMANCE-PLAN.md`
§2.

**API impact:** `POST /leads/capture` (public, unauthenticated — see `06-SECURITY-PLAN.md` §2.1),
`GET/POST /leads`, `POST /leads/:id/convert`, `POST /leads/:id/activities`. Event: `LEAD_CAPTURED`,
`LEAD_CONVERTED`, `LEAD_ASSIGNED`.

**UI changes:** Kanban board by stage with drag-to-advance; Lead detail page with activity log;
capture widget embeddable in the marketing site and POS checkout ("would you like updates?" flow).

**Testing requirements:** Unit: assignment-rule routing logic (round-robin fairness, load-balance
correctness). Integration: `lead.integration.test.ts` covering capture → assignment → convert, and
verifying `LEAD_CONVERTED`'s outbox event carries full context (not just IDs, per the outbox-payload
convention).

**Playwright E2E scenarios:**

1. Public capture form submission → lead appears in the Kanban "New" column within a reasonable
   time.
2. Drag a lead from "New" to "Qualified" → activity log records the stage change with actor and
   timestamp.
3. Convert a qualified lead → a Customer record exists, linked back to the lead; the lead shows
   "Converted" status; navigating from the lead to the customer works.
4. Rate-limit test: rapid-fire capture submissions from one source are throttled, not silently
   accepted unbounded.
5. Duplicate-lead detection: submitting the same phone number twice surfaces a dedupe warning
   against the existing lead (not a silent duplicate).

**Edge cases:** Lead capture with only a phone number, no name (must still be a valid lead — not
every capture form collects a name); a lead assigned to a since-deactivated user (assignment rule
must skip inactive users); converting a lead that duplicates an _existing customer_ (not another
lead) — must offer merge-into-existing-customer, not blind duplicate creation.

**Security considerations:** `POST /leads/capture` is the first unauthenticated write endpoint in
this codebase — full treatment in `06-SECURITY-PLAN.md` §2.1 (rate limit, CAPTCHA, strict Zod, no
PII in logs). New permissions: `LEAD_VIEW`, `LEAD_CREATE`, `LEAD_UPDATE`, `LEAD_ASSIGN`,
`LEAD_CONVERT`, `LEAD_DELETE`.

**Performance considerations:** Kanban board query must be indexed by `(tenant_id, stage)` — do not
let this become a full-table scan as lead volume grows; funnel/velocity reports should query
aggregates, not compute client-side from a full lead list.

**Rollback plan:** Additive tables, feature-flaggable capture endpoint (disable the public route
without a deploy if abused). See `09-ROLLBACK-AND-RISK.md` §2.

**Dependencies:** Soft-benefits from Contact & Account Hierarchy (Feature 1) for B2B conversion, but
does not hard-block on it — a lead can convert into an accountless customer, matching today's flat
model, and be linked to an account later.

**Acceptance criteria:** A lead can be captured, assigned, advanced through stages, and converted to
a customer with full attribution preserved; the public capture endpoint survives a basic abuse test
without degrading the rest of the platform.

**Definition of Done:** Standard DoD plus: public endpoint load-tested for rate-limit correctness;
dedupe warning verified against both lead-vs-lead and lead-vs-existing-customer cases.

---

## Feature 3: Customer 360 Command Center

**Objective:** Surface `HealthScoringService` and `ActivityTimelineService` — which already exist
server-side with no frontend — into one unified profile page.

**Business value:** 10/10 — highest value-to-effort ratio in this entire roadmap; the backend work is
already done and stranded.

**Priority:** Must Have. **Complexity:** Low.

**Technical design:** A single composed read endpoint (`GET /customers/:id/360`) calling
`HealthScoringService`, `ActivityTimelineService`, and existing sales/accounting/loyalty reads **in
parallel** (`07-PERFORMANCE-PLAN.md` §1) — no new source of truth, no new write path. If (and only
if) measured latency proves it necessary, fall back to a materialized
`crm_customer_360_view`refreshed on relevant events — build the live-composed version first.

**Files/modules likely to change:**

- New: `apps/sales-service/src/api/customer-360.routes.ts` (thin composition layer)
- `apps/sales-service/src/domain/HealthScoringService.ts`, `ActivityTimelineService.ts` (no
  behavior change expected — being consumed, not modified)
- New: `apps/web-frontend/src/pages/sales/customers/Customer360Page.tsx` (single scrollable page:
  sticky header stats, tabbed timeline, right-rail quick actions)
- Existing customer list "View" action re-pointed to this page

**Database impact:** None required initially (pure read composition). Contingent:
`crm_customer_360_view` materialized view only if performance testing requires it.

**API impact:** One new composed endpoint. No changes to any existing endpoint's contract.

**UI changes:** New hub page replacing today's plain customer detail page — becomes the link target
from Leads, Opportunities (Phase 2), and Tickets (Feature 4 below), per `05-UI-UX-PLAN.md` §2.

**Testing requirements:** Unit: none new (composing existing tested services). Integration: verify
the composed endpoint degrades gracefully if one sub-service call is slow/fails (partial render, not
a full 500) — this is the one piece of new logic worth testing directly.

**Playwright E2E scenarios:**

1. Open Customer 360 for a customer with order/payment/interaction history → all sections render
   with correct data (cross-check against the same data visible on the existing Invoice/Payment
   list pages, to catch composition bugs).
2. Health score trend displays and matches what `HealthScoringService` returns directly (spot-check
   against a known test fixture).
3. "Log Interaction" quick action from the 360 page creates a `customer_interactions` row visible
   immediately in the timeline without a page reload.
4. A customer with zero history (brand new) renders a sensible empty state, not a broken layout.

**Edge cases:** Customer with an extremely long interaction history (pagination/virtualization, not
an unbounded render); a customer whose account was merged (Feature 1) — 360 page must show the
unified post-merge history, not fragment across the two original records.

**Security considerations:** Read-only composition over already-permission-gated services — no new
attack surface. `CRM_360_VIEW` permission gates the whole page.

**Performance considerations:** The central concern of this feature — see `07-PERFORMANCE-PLAN.md`
§1 in full. Parallel fetch is mandatory, not optional.

**Rollback plan:** Zero schema risk (no new tables in the baseline design). Rollback is simply
reverting the frontend route and the one new backend endpoint — no data migration involved at all.

**Dependencies:** None hard — benefits from Feature 1 (Account Hierarchy) for correctly unified
B2B views, and becomes the natural surface for Feature 4 (Tickets) and Phase 2's Pipeline/Referral
features to link into.

**Acceptance criteria:** A rep can answer "what's this customer's situation" without leaving one
page — order history, balance, health score, and interaction log all visible without a tab switch.

**Definition of Done:** Standard DoD plus: p95 page load measured and documented; parallel-fetch
verified (not sequential) via a network-waterfall check during implementation review.

---

## Feature 4: Support & Ticketing

**Objective:** Real ticket entity with SLA, status, and assignment — replacing the untracked
`customer_interactions` COMPLAINT type.

**Business value:** 9/10 — the largest customer-experience gap identified in the gap analysis.

**Priority:** Must Have. **Complexity:** Medium.

**Technical design:** `crm_tickets` with a status machine (`Open → In Progress → Waiting on Customer
→ Resolved → Closed`), `crm_ticket_messages` (internal notes vs. customer-visible replies),
`crm_ticket_sla_rules` (by ticket type/customer tier), `crm_csat_responses`. Auto-links to the
customer's most recent order within a configurable window on creation. SLA breach fires
`TICKET_SLA_BREACHED`, consumed by `notification-service` for escalation.

**Files/modules likely to change:**

- `packages/db-client/src/schema/crm.ts` (new tables)
- New: `apps/sales-service/src/api/ticket.routes.ts`, `apps/sales-service/src/domain/TicketService.ts`
- New: `apps/scheduler-service/` cron job for SLA-breach sweep (follows the existing 33-cron-job
  pattern, does not introduce a new job-scheduling mechanism)
- New: `apps/web-frontend/src/pages/crm/tickets/` (inbox-style list with SLA countdown chips, detail
  with message thread + order/invoice context panel)

**Database impact:** `crm_tickets`, `crm_ticket_messages`, `crm_ticket_sla_rules`,
`crm_csat_responses`. Indexes: `(tenant_id, status, sla_due_at)`, `(tenant_id, customer_id)` — see
`07-PERFORMANCE-PLAN.md` §2.

**API impact:** `/tickets`, `/tickets/:id/messages`, `/tickets/:id/resolve`, `/tickets/:id/csat`.
Events: `TICKET_CREATED`, `TICKET_ASSIGNED`, `TICKET_SLA_BREACHED`, `TICKET_RESOLVED`.

**UI changes:** New inbox-style ticket list (SLA countdown chip per row); ticket detail with message
thread and a live order/invoice context panel pulled from `sales-service`.

**Testing requirements:** Unit: SLA-due-date calculation per ticket type/tier. Integration:
`ticket.integration.test.ts` — creation, assignment, SLA-breach sweep firing the event, resolution,
CSAT capture.

**Playwright E2E scenarios:**

1. Create a ticket manually from Customer 360 → appears in the inbox with correct SLA countdown.
2. Assign a ticket → assignee sees it in their queue; reassignment is logged.
3. Let a ticket's SLA elapse (test clock manipulation or a short test-only SLA window) → escalation
   notification fires, `TICKET_SLA_BREACHED` event verified in the outbox.
4. Resolve a ticket → customer-visible reply thread shows correctly; internal notes never leak into
   the customer-visible view (this is the one assertion worth being paranoid about).
5. CSAT survey capture on close → response recorded and visible in ticket detail.

**Edge cases:** A ticket with no linked order (general inquiry, not order-specific — must still be
valid); reopening a "Closed" ticket (must be an explicit action, not implicit from a new customer
reply — decide and document the exact reopen rule); an internal note posted by a since-removed
employee (must still render, attributed correctly, not broken by a dangling FK).

**Security considerations:** Internal-notes-vs-customer-visible-reply separation is the critical
security/privacy boundary here — get the message-visibility flag tested explicitly, not assumed.
New permissions: `TICKET_VIEW`, `TICKET_CREATE`, `TICKET_UPDATE`, `TICKET_ASSIGN`,
`TICKET_RESOLVE`, `TICKET_DELETE`.

**Performance considerations:** SLA-breach sweep job must be indexed (`sla_due_at`), not a full-table
scan every tick — this runs frequently by nature.

**Rollback plan:** Additive schema; disable the SLA-sweep cron job independently of the rest of the
feature if it misbehaves (it's the one component with a recurring side effect — notifications — so
isolate its rollback from the ticket CRUD rollback).

**Dependencies:** None hard. Feeds Customer 360 (Feature 3) as a timeline source once both exist —
sequence Feature 3 slightly ahead so Tickets has a surface to link into on day one, though neither
strictly blocks the other.

**Acceptance criteria:** A complaint raised via any channel becomes a tracked ticket with a visible
SLA clock; resolution closes the loop with the customer notified; CSAT is captured.

**Definition of Done:** Standard DoD plus: internal/customer-visible message separation has an
explicit passing test (not just implicit trust in the UI hiding it correctly).

---

## Feature 5: ERP-Native Integration Layer

**Objective:** Surface live inventory and AR/credit visibility inside CRM screens — the actual
competitive moat versus a bolt-on CRM.

**Business value:** 10/10 — the one feature in this roadmap that's structurally unreplicable by
Salesforce/Dynamics without a paid connector.

**Priority:** Must Have. **Complexity:** Medium.

**Technical design:** Per AR-2, a single shared read-composition module (not a new service, not
duplicated per consumer) that Customer 360 (Feature 3) and Phase 2's Opportunity line items both
call. Reads directly from `InventoryService`/`ValuationService`/`AccountingService`/`PaymentService`
— never caches a stale copy into a new CRM-owned table.

**Files/modules likely to change:**

- New: a `CustomerFinancialSnapshot` module — location decided at implementation time between
  `packages/platform-sdk` (if genuinely cross-service-reusable) and a `sales-service`-local module
  (if the composition stays within one service's process boundary) — see AR-2 for the full
  reasoning on why this must be one module, not two.
- `apps/sales-service/src/domain/HealthScoringService.ts` / the Customer 360 endpoint (Feature 3)
  becomes its first consumer.

**Database impact:** None — this is explicitly a read-only composition layer, no new tables (AR-2).

**API impact:** No new public endpoint of its own; it's consumed internally by Customer 360's
composed response and (Phase 2) Opportunity line items.

**UI changes:** Inline badges on Customer 360 and (Phase 2) Opportunity/Quotation line items — "12
in stock", "AR 45 days overdue" — not a separate screen to check.

**Testing requirements:** Unit: the composition logic itself (correct aggregation of stock/AR data).
Integration: verify it reflects real-time changes (a stock adjustment or payment posted mid-session
is visible on next fetch, not stale-cached).

**Playwright E2E scenarios:**

1. Adjust stock for an item, then view a customer's 360 page showing that item context (if
   applicable to the account's typical purchases) → reflects the adjustment without a service
   restart.
2. Record a payment reducing a customer's AR balance → Customer 360's credit-headroom figure updates
   correctly.
3. A customer past their credit limit shows a clear, correctly-colored flag (not just a number
   without context).

**Edge cases:** A customer with no credit limit configured (must not divide-by-zero or show a
nonsensical percentage); an item with stock split across multiple warehouses (aggregate correctly,
don't show only one warehouse's count misleadingly).

**Security considerations:** Read-only, inherits the permission checks of the underlying services it
calls — no new permission constant needed beyond what gates Customer 360 itself.

**Performance considerations:** This is the piece most likely to slow down Customer 360 if built
naively — parallel fetch, no N+1 queries against inventory/accounting per line item.

**Rollback plan:** No schema to roll back. Revert the module and its Customer 360 integration;
zero data risk since nothing is written.

**Dependencies:** None hard, but Feature 3 (Customer 360) is its first real consumer — build them
together or Feature 3 immediately after.

**Acceptance criteria:** A rep viewing a customer can see live stock relevance and AR status without
switching to Inventory or Accounting screens.

**Definition of Done:** Standard DoD plus: explicit verification this introduces zero new
cross-service data duplication (code review checklist item, given `00-CODEBASE-AUDIT.md` §6's
documented history of this exact bug class).

---

## Feature 6: DLT/TRAI SMS Compliance

**Objective:** Enforce India's legal requirement that promotional SMS use pre-registered DLT
templates — currently unaddressed anywhere in the codebase.

**Business value:** 7/10 on a normal value scale, but non-deferrable — this is risk mitigation, not
a feature bet.

**Priority:** Must Have (compliance). **Complexity:** Medium.

**Technical design:** Per AR-8, enforcement lives inside `notification-service`'s existing
`NotificationEngine.sendSms()` path, gated against a new `crm_dlt_templates` table (tenant-configured
DLT template IDs/headers). Non-compliant promotional SMS is **rejected**, not sent with a warning.

**Files/modules likely to change:**

- `packages/db-client/src/schema/crm.ts` (new `crm_dlt_templates` table)
- `apps/notification-service/src/domain/NotificationEngine.ts` (add the gate to `sendSms()`)
- New: `apps/web-frontend/src/pages/crm/settings/DltTemplatesPage.tsx` (tenant configures registered
  templates)

**Database impact:** `crm_dlt_templates` (new table): tenant_id, template_id, header, message
pattern, registered status.

**API impact:** `/dlt-templates` CRUD, admin-only. `CampaignService.send()` (existing) gains a
pre-send validation call for SMS-channel campaigns.

**UI changes:** New settings page for DLT template configuration; a validation error surfaced at
campaign-creation time (not silently at send time) if an SMS campaign's content doesn't match a
registered template.

**Testing requirements:** Unit: template-matching logic (message content vs. registered pattern).
Integration: a non-compliant SMS send attempt is rejected end-to-end, not just at the API layer —
verify `NotificationEngine` itself refuses it even if called directly.

**Playwright E2E scenarios:**

1. Configure a DLT template → create an SMS campaign matching it → sends successfully.
2. Create an SMS campaign with content that doesn't match any registered template → blocked at
   creation/preview time with a clear, specific error (not a generic failure).
3. Existing non-promotional (transactional) SMS flows (e.g. OTP, order confirmation) are unaffected
   — this gate applies to promotional category only, verified against
   `customerCommunicationPreferences.category`.

**Edge cases:** A tenant with zero registered templates attempting any promotional SMS (must block
cleanly with actionable guidance, not a cryptic error); a template that's registered but expired
(if the DLT system supports expiry — flag for implementation-time confirmation with the SMS
provider's actual API capabilities).

**Security considerations:** This _is_ the security/compliance consideration for this feature — no
additional attack surface, but incorrect implementation (advisory instead of blocking) is itself the
risk, per `09-ROLLBACK-AND-RISK.md`'s risk register.

**Performance considerations:** Template-match check must not add meaningful latency to campaign
send — it's a lookup against a small per-tenant table, not a heavy computation.

**Rollback plan:** Explicitly the one feature where "rollback" means a documented, audit-logged
emergency-override path, not a casual flag flip — see `09-ROLLBACK-AND-RISK.md` §1.

**Dependencies:** None. Independent of every other Phase 1 feature — must not be deprioritized
behind them.

**Acceptance criteria:** No promotional SMS can be sent from this platform without matching a
tenant-registered DLT template; transactional SMS is unaffected.

**Definition of Done:** Standard DoD plus: explicit sign-off that the gate is blocking, not advisory
— this is a binary check, not a judgment call, before this feature is considered done.

---

## Feature 7: Data Import / Dedupe / Merge Tooling

**Objective:** Clean CSV import and duplicate-customer merge, needed for onboarding both new tenants
and the new Lead/Account entities.

**Business value:** 6/10. **Priority:** Must Have (onboarding blocker). **Complexity:** Low.

**Technical design:** Extends whatever import mechanism `scheduler-service` already uses (per
`TECH_AUDIT.md` §18, scheduler-service owns "import/export engine") for Customer/Account/Lead CSV
import, with the same dedupe-matching logic built for Feature 1's account merge (reused, not
reimplemented).

**Files/modules likely to change:** `apps/scheduler-service/` (extend existing import engine),
`apps/web-frontend/src/pages/crm/import/` (new import wizard UI).

**Database impact:** None beyond what Features 1/2 already add — this feature is tooling on top of
those tables, not new tables of its own (an import-job-status table may already exist in
scheduler-service — verify before adding a new one).

**API impact:** Extends existing import endpoints if `scheduler-service` has them; otherwise new
`/import/customers`, `/import/leads`.

**UI changes:** CSV upload wizard with column mapping, a dedupe-preview step before commit (reusing
Feature 1's merge-suggestion UI pattern).

**Testing requirements:** Unit: CSV parsing/validation edge cases (malformed rows, missing required
columns). Integration: a batch import with intentional duplicates correctly flags them for review
rather than silently creating duplicates.

**Playwright E2E scenarios:**

1. Upload a valid CSV of leads → all rows created correctly, mapped to the right fields.
2. Upload a CSV containing rows that duplicate existing customers → dedupe warnings shown before
   commit, not after.
3. Upload a malformed CSV (missing required column) → clear, specific error before any rows are
   committed (all-or-nothing, not partial import silently leaving the dataset inconsistent).

**Edge cases:** Extremely large CSV files (needs the same async-job pattern scheduler-service already
uses for other bulk operations, not a synchronous request that times out); partially-successful
imports (must report exactly which rows failed and why, not just a count).

**Security considerations:** Uploaded files are hostile input — validate size limits, content type,
and row count before processing; no PII from failed rows logged at info/debug level.

**Performance considerations:** Large imports must run as an async background job (existing
scheduler-service pattern), not block the request thread.

**Rollback plan:** An import job's rollback is deleting the rows it created within a defined window
— tag imported rows with an `import_batch_id` specifically so this is possible cleanly.

**Dependencies:** Depends on Feature 1's dedupe-matching logic existing first.

**Acceptance criteria:** A tenant can bulk-import leads/accounts from CSV with dedupe protection and
clear per-row error reporting.

**Definition of Done:** Standard DoD plus: `import_batch_id` tagging verified to make a clean
rollback possible.

---

## Feature 8: CRM Dashboards & KPI Tracking

**Objective:** Pipeline/funnel/ticket-SLA visibility in one manager-facing view.

**Business value:** 8/10. **Priority:** Must Have. **Complexity:** Medium.

**Technical design:** Aggregation queries against the new Lead/Ticket tables (Pipeline/Opportunity
aggregates join in once Phase 2 ships — this dashboard is built to extend, not rebuilt per phase).
Follows the existing dashboard pattern (`projection_dashboard_daily`-style precomputation) if
real-time aggregation proves too slow — same "measure before projecting" discipline as Customer 360.

**Files/modules likely to change:** New `apps/sales-service/src/api/crm-dashboard.routes.ts`; new
`apps/web-frontend/src/pages/crm/CrmDashboardPage.tsx` (reuses `recharts`, already installed, no new
charting library).

**Database impact:** None initially (live aggregation); contingent projection table if needed.

**API impact:** `GET /crm/dashboard` — read-only aggregate endpoint.

**UI changes:** New dashboard page: lead funnel, ticket SLA compliance, campaign performance summary
(existing data), all in one view — the manager-facing counterpart to Customer 360's rep-facing view.

**Testing requirements:** Unit: aggregation math (funnel percentages, SLA compliance rate).
Integration: dashboard numbers match a hand-computed fixture dataset exactly.

**Playwright E2E scenarios:**

1. Dashboard loads and shows non-zero, plausible figures against seeded test data.
2. Filtering by date range updates all widgets consistently (no stale widget left showing the
   previous range).
3. A manager without `TICKET_VIEW` permission sees the ticket-SLA widget hidden, not erroring.

**Edge cases:** Zero-data tenant (brand new) — dashboard must show a sensible empty state, not
NaN/undefined percentages from a zero-denominator funnel calculation.

**Security considerations:** Aggregate data must still respect branch scoping (AR-6) — a
branch-scoped manager should see only their branch's aggregates, not tenant-wide numbers.

**Performance considerations:** The main risk — see Customer 360's precedent; measure before adding
a projection table.

**Rollback plan:** Read-only feature, no schema risk in the baseline design — trivial rollback.

**Dependencies:** Benefits from Features 2 (Leads) and 4 (Tickets) existing first; extend, don't
rebuild, once Phase 2's Pipeline data is available.

**Acceptance criteria:** A sales/support manager can see lead funnel and ticket SLA health without
building a report manually.

**Definition of Done:** Standard DoD plus: branch-scoping verified for a branch-restricted test user.
