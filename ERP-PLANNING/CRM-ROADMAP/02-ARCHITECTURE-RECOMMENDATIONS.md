# 02 — Architecture Recommendations

Structural decisions the phase docs assume as settled. Each one is a choice _within_ the existing
event-driven microservices architecture (see `00-CODEBASE-AUDIT.md` §1/§7) — none of them propose
changing the pattern, the ORM, or the multi-tenancy model.

---

## AR-1: CRM stays inside `sales-service` — no new `crm-service`

**Decision:** All new CRM tables/routes/domain services (Leads, Accounts/Contacts, Opportunities,
Tickets, Referrals) are added to `apps/sales-service`, following the existing pattern where
Segments/Campaigns/Loyalty/Seasons already live there.

**Why:** CRM entities have a tight read/write relationship with Sales entities (a Lead converts to
a Customer; an Opportunity references Quotations; a Ticket links to an Invoice). Splitting them
into a separate service would turn every one of those relationships into a cross-service call,
which this codebase's own technical debt inventory already flags as a recurring source of
duplicated logic (`00-CODEBASE-AUDIT.md` §6). `sales-service` is already the largest service by
domain surface; that's a sign it's the right _domain_ boundary, not a reason to split it
prematurely.

**Reconsider if:** `sales-service`'s build time, deploy blast-radius, or team-ownership boundaries
become a real operational problem — not before. If reconsidered, the natural split point is CRM's
own bounded context (Leads/Accounts/Opportunities/Tickets), not a per-feature split.

**Exception — Omnichannel Communication Hub (Phase 2):** if inbound message volume ever justifies
it, this is the one candidate for a dedicated service (`inbox-service`) later, because its scaling
profile (webhook ingestion, message threading) differs from the rest of CRM. Not a Phase 2 decision
— start it inside `sales-service` and only split if volume proves it necessary.

## AR-2: The ERP-Native Integration Layer is a shared read module, not a new service and not per-feature duplication

**Decision:** Live inventory/AR visibility inside CRM screens (opportunity line items, Customer 360)
is implemented as a single shared internal module — e.g. `packages/platform-sdk` or a
`sales-service`-local `CustomerFinancialSnapshot` service — called by every CRM feature that needs
it, not re-implemented per feature.

**Why this is Phase 1, not later:** originally scoped as an "enterprise differentiator," it's
promoted to Phase 1 because it's the thing competing CRM platforms (Salesforce/Dynamics) structurally
cannot replicate without a paid connector — shipping it early means every subsequent feature (Pipeline
in Phase 2, AI suite in Phase 3) is built assuming live financial/stock context is already available,
rather than retrofitted later. Building it late would mean re-touching Opportunity, Customer 360, and
the AI suite a second time.

**Why a shared module and not a new service:** `00-CODEBASE-AUDIT.md` §6 already documents that this
codebase has duplicated valuation/balance logic per-consumer before. Opportunity line items and
Customer 360 both need "how many in stock" and "what's the AR ageing" — if each feature queries
`ValuationService`/`PaymentService` independently with its own logic, that's the same bug class
recurring a third time. One composed read module, two consumers.

**What it must NOT do:** write anything. This is a read-composition layer over
`InventoryService`/`ValuationService`/`AccountingService`/`PaymentService`'s existing data — it does
not introduce a new source of truth for stock or AR, and it does not cache stale copies into a new
CRM-owned table.

## AR-3: Journey Builder extends `campaignAutomationRules`, not a parallel automation engine

**Decision:** Multi-step journeys (Phase 2) compile down to the same scheduler-service cron
evaluation mechanism that already drives `campaignAutomationRules`, extended with per-customer
branching state (`crm_journey_enrollments` tracks which node each customer is on).

**Why:** the single-trigger automation already in production (birthday/inactivity/anniversary) is
proof the scheduler-cron mechanism works at this codebase's scale. A journey is a graph of the same
primitive (a trigger condition → a campaign send), not a fundamentally different execution model.
Building a second automation engine (e.g., a dedicated workflow-graph runtime) would mean two
systems doing overlapping jobs with different reliability characteristics.

**Leaf action reuse:** every journey step that sends a message calls `CampaignService.send()` — the
exact function existing campaigns already use — so deliverability, consent-checking
(`customerCommunicationPreferences`), and frequency-cap logic (`tenantCommunicationSettings`) are
inherited for free, not reimplemented.

## AR-4: Workflow & Approval engine generalizes the existing campaign approval gate — sequenced after, not before, Support Ticketing

**Decision:** The generic approval engine (Phase 2/3, lower priority — see gap analysis) is built by
_generalizing_ `campaigns.approvalStatus`/`tenantCommunicationSettings.approvalRequired` into a
reusable `crm_approval_chains`/`crm_approval_requests` pair, with the existing campaign approval flow
migrated onto it as its first consumer (not left as a parallel bespoke implementation).

**Why sequenced late:** generalizing an approval engine before there's a second real consumer (e.g.
ticket-refund approval) risks over-engineering for a hypothetical. Support Ticketing (Phase 1) ships
first with a simple status machine and no generic approval hook; if refund-approval need is confirmed
real once tickets are live, that becomes the second consumer that justifies generalizing.

## AR-5: Self-Service Customer Portal is a new trust boundary — separate auth scope, not reused staff roles

**Decision:** The Portal (Phase 3) authenticates customers via a new `CUSTOMER` role that is
**not** part of the existing 13 system default roles used by staff (`role-defaults.ts`), and does
not inherit `BRANCH_SCOPE_BYPASS` or any staff permission by default. It reuses `auth-service`'s
JWT/RS256 mechanism (same library, same verification middleware pattern) but issues tokens scoped
only to the logged-in customer's own `customerId`, enforced at the query layer the same way
`tenant_id` is enforced today (every portal query includes `WHERE customer_id = :selfCustomerId`,
non-negotiable, no admin-override path in portal-facing code).

**Why this needs its own security review pass:** this is the first time this codebase exposes any
authenticated surface to a non-employee. Every other JWT issued today is for an internal user with
tenant-assigned permissions. Getting the portal's authorization boundary wrong is a customer-data
leak, not an internal-tooling bug — treat the portal's route guards with the same rigor as
`route-guard-coverage.test.ts` applies internally, and add portal routes to that same CI backstop
rather than exempting them.

## AR-6: New CRM tables with a branch dimension implement branch scoping from day one

**Decision:** `crm_leads`, `crm_opportunities`, and `crm_tickets` all get a `branch_id` column and
real `getBranchScope()` enforcement on their list/detail routes at initial build time — following
the `campaigns` table's CP-8 precedent, not the majority-of-tables precedent of "add it later."

**Why:** `00-CODEBASE-AUDIT.md` §6 documents branch scoping as implemented on exactly one route
(`GET /invoices`) despite 8 schema files needing it — retrofitting has proven to be a recurring,
expensive, separate audit pass in this codebase's history. Building it in from the start on these
three tables costs one `getBranchScope()` call and an `inArray()` filter per list route; retrofitting
it later costs a full audit phase, as it has every time before.

## AR-7: Every new permission ships with both mirrors and a backfill migration, enforced as a PR checklist item, not a trust exercise

**Decision:** No feature spec in this roadmap is "done" (see each phase doc's DoD) until: the
permission constant exists in `packages/shared-types/src/permissions.ts`, its mirror exists in
`apps/web-frontend/src/constants/permissions.ts`, the actual backend route's `requirePermission()`
call has been grepped and matches (not inferred from the constant name), and — if it's granted to a
default role — a `NNNN_<feature>_permission_backfill.sql` migration exists for already-provisioned
tenants.

**Why:** this exact bug class has recurred four separate times in this codebase per
`RBAC_ARCHITECTURE.md` §4. This roadmap adds ~25-30 new permission constants across its features;
without an explicit checklist item, the probability of a fifth occurrence across that many new
constants is high, not low.

## AR-8: DLT/TRAI SMS compliance is infrastructure/config work inside `notification-service`, not a CRM feature

**Decision:** DLT template pre-registration and header enforcement (Phase 1) is implemented as a
guard inside `notification-service`'s existing MSG91 SMS send path (`NotificationEngine.sendSms()`),
not as a new CRM-domain table. A `crm_dlt_templates` table (tenant-configured DLT template
IDs/headers) is the only new CRM-side artifact; enforcement itself belongs where SMS actually gets
sent.

**Why called out separately:** this is the one Phase 1 item that is a legal requirement, not a
product bet — sequencing and ownership matter more than for any other feature in this kit. See
`06-SECURITY-PLAN.md` for the compliance detail.
