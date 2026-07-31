# CRM-ROADMAP Phase 1, Feature 8 — CRM Dashboards & KPI Tracking — Completion Report

**Date:** 2026-07-29
**Status:** Complete. **This is the last Phase 1 feature — Phase 1 is now fully implemented (Features 1–8).**

## Summary

The manager-facing counterpart to Feature 3's rep-facing Customer 360: one composed read
endpoint aggregating Lead funnel, Ticket SLA compliance, and Campaign performance — no new
tables, live aggregation only, per the phase doc's "measure before projecting" instruction
(already applied identically to Customer 360).

- **New `apps/sales-service/src/domain/CrmDashboardService.ts`** — three pure aggregation
  functions, each branch-scope-aware (AR-6) and zero-data-safe (returns `0`/`null`, never
  `NaN`/`undefined`, when a denominator is empty):
  - `getLeadFunnel()` — per-stage lead counts + percentages of the branch-scoped total.
  - `getTicketSlaCompliance()` — % of tickets _resolved_ in the period that met their SLA,
    checked directly against `resolvedAt <= slaDueAt` rather than the persisted `slaBreached`
    flag (that flag is only set by the periodic sweep job for tickets still open past due — a
    ticket resolved late but before the next sweep run would never have it set, undercounting
    breaches if relied on here).
  - `getCampaignPerformance()` — sums `campaigns`' own pre-aggregated counters
    (`totalRecipients`/`sentCount`/`deliveredCount`/`failedCount`) across non-DRAFT campaigns,
    rather than re-deriving them from a fresh `campaign_recipients` GROUP BY — those columns are
    already `CampaignService`'s source of truth, so summing them avoids a second, potentially
    drifting aggregation path.
- **New `GET /crm/dashboard` route** (`crm-dashboard.routes.ts`) — gated by a new
  `CRM_DASHBOARD_VIEW` permission to open the endpoint at all, but each section is _further_
  gated by the permission that already governs that data (`LEAD_VIEW`/`TICKET_VIEW`/
  `CRM_CAMPAIGN_ANALYTICS_VIEW`) and simply omitted (`null`, listed in a `hiddenSections` array)
  if the caller lacks it — never a 403 for the whole dashboard. A manager without `TICKET_VIEW`
  still sees their lead funnel; this is the literal "widget hidden, not erroring" acceptance
  criterion, satisfied server-side since this is one combined endpoint, not three.
- **Both `crm_leads` and `crm_tickets` already had `branch_id`** (added under AR-6 in Features 2
  and 4, ahead of this feature needing it) — no migration needed for branch-scoping; only the
  new `CRM_DASHBOARD_VIEW` permission needed a backfill migration.
- **Frontend**: `CrmDashboardPage.tsx` — a date-range filter plus three `ChartCard`s (lead-funnel
  bar chart, ticket-SLA compliance stat, campaign-performance stat), reusing the app's one
  existing `recharts`/`ChartCard`/`ERPStatCard` dashboard convention (`DashboardPage.tsx`) rather
  than introducing a new charting pattern. Each card renders only if its data isn't `null` —
  since the backend already omits hidden sections, no separate client-side permission check was
  needed to satisfy the hidden-widget requirement.

## Decisions / deviations (flagged during implementation, not silently decided)

1. **Named `CRM_DASHBOARD_VIEW`, not the roadmap doc's implied bare `DASHBOARD_VIEW`** — that
   constant already exists and gates report-service's unrelated org-wide KPI dashboard
   (`GET /api/v2/dashboard/kpis|charts|alerts`, migration `0023`). Same disambiguation reasoning
   as Feature 1's `CRM_ACCOUNT_VIEW` vs. Chart-of-Accounts' `ACCOUNT_VIEW`.
2. **One combined endpoint, not three** — the phase doc specifies a single `GET /crm/dashboard`.
   Per-section permission hiding is implemented server-side (each section computed only if the
   caller holds its permission, `Promise.all` over the three, `hiddenSections` reported) rather
   than splitting into three endpoints the frontend could `enabled: hasPermission(...)`-gate
   individually — avoids three round-trips for what the phase doc treats as one aggregate view.
3. **Campaign performance sums `campaigns`' own counters, not a `campaign_recipients` GROUP BY**
   — deliberate, to avoid a second aggregation path that could drift from the numbers
   `CampaignService`'s per-campaign `getStats()` already reports (no tenant/branch-wide campaign
   rollup existed anywhere before this feature — confirmed by inspection, not assumed).
4. **SLA compliance checks `resolvedAt <= slaDueAt` directly, not the `slaBreached` column** —
   flagged above; the column is written only by the async sweep job and would undercount
   already-resolved-but-late tickets that got resolved before the next sweep tick.
5. **`campaigns.branchId`/`crmTickets.branchId`/`crmLeads.branchId` are all nullable** — every
   aggregation query uses the same `or(isNull(branchId), inArray(branchId, scope))` shape the
   existing `lead.routes.ts`/`ticket.routes.ts` list endpoints already use, not a bare
   `inArray(...)`, so a branch-scoped manager still sees unassigned/tenant-wide rows, matching
   existing list-route behavior exactly rather than introducing new semantics for the dashboard.

## Acceptance Criteria

- [x] A sales/support manager can see lead funnel and ticket SLA health without building a
      report manually — the single `GET /crm/dashboard` response covers both plus campaign
      performance.
- [x] Dashboard loads with plausible figures against seeded data / a zero-data tenant shows a
      sensible empty state, not NaN/undefined — covered directly:
      `crm-dashboard-service.test.ts` asserts `percentage`/`complianceRate`/`deliveryRate` are
      `0`/`null` (never `NaN`) for an empty tenant, and the frontend renders an explicit
      `ERPEmptyState` for each zero-data section.
- [x] Filtering by date range updates all widgets consistently — `from`/`to` params thread
      through to all three aggregation queries identically; covered directly by a dedicated test
      proving a lead outside the range is excluded.
- [x] A manager without `TICKET_VIEW` sees the ticket-SLA widget hidden, not erroring — covered
      directly by `crm-dashboard-permission-guards.test.ts` (4 tests: base-permission 403,
      all-hidden, partial-hidden, none-hidden).
- [x] Branch-scoping verified for a branch-restricted test user (explicit DoD requirement) —
      covered directly: a lead scoped to a different branch is excluded when the caller's
      `branchScope` is restricted to one branch, while an unassigned (null-branch) lead remains
      visible.

## Verification performed this session

- `pnpm --filter @erp/db build` / `@erp/utils build` / `@erp/types build` — all clean.
- `pnpm --filter sales-service type-check` / `tenant-service type-check` /
  `web-frontend type-check` — all clean.
- `eslint` scoped to every touched/new file — 0 errors (only the same pre-existing-style
  `explicit-function-return-type`/`no-non-null-assertion` warnings already present throughout
  this codebase).
- **Live migration** `0116_crm_dashboard_permission_backfill.sql` applied directly to the local
  dev Postgres (104 rows — `CRM_DASHBOARD_VIEW` backfilled for OWNER/ADMIN/SUPER_ADMIN/
  SALES_MANAGER across all existing tenants).
- **New test file** `crm-dashboard-service.test.ts` — **8/8 passing**: lead-funnel fixture match,
  zero-lead-tenant safety, branch-scoping (excludes another branch, keeps unassigned visible),
  date-range filtering, ticket-SLA fixture match (on-time + no-rule-compliant vs. late-breach),
  zero-resolved-tenant safety, campaign-performance fixture match (DRAFT excluded), zero-campaign
  safety.
- **New test file** `crm-dashboard-permission-guards.test.ts` — **4/4 passing**: base
  `CRM_DASHBOARD_VIEW` 403, all-sections-hidden, partial-hidden (holds only `TICKET_VIEW`),
  none-hidden (holds all four permissions) — signed with the same `JWT_ISSUER`-aware workaround
  used for this session's other new JWT-based tests, sidestepping the documented concurrent-session
  issuer mismatch (see below).
- **Regression sweep across Features 1–8** (account-service, lead-service,
  lead-capture-auth-isolation, customer-360-degradation, ticket-service,
  customer-financial-snapshot, campaign-service, crm-dashboard-service,
  crm-dashboard-permission-guards): **137/137 passing**.
- `pnpm --filter tenant-service test` — **59/59 passing (1 pre-existing skip)**.
- `pnpm --filter @erp/types test -- route-guard-coverage` — same **2 pre-existing, unrelated**
  failures as every prior session in this roadmap; `crm-dashboard.routes.ts` is not flagged.
- **Not caused by this session, as in Feature 7's report**: the broader, unscoped sales-service
  test suite still shows pre-existing 401-vs-403 failures in files this roadmap never touched,
  traced previously to an in-flight, uncommitted JWT-issuer change in `packages/platform-sdk` from
  a concurrent session.

## Files touched

- `packages/shared-types/src/permissions.ts` — new `CRM_DASHBOARD_VIEW`.
- `apps/tenant-service/src/rbac/role-defaults.ts` — SALES_MANAGER gains `CRM_DASHBOARD_VIEW`.
- `packages/db-client/migrations/0116_crm_dashboard_permission_backfill.sql` — new; applied live.
- `packages/db-client/migrations/meta/_journal.json` — appended entry.
- `apps/sales-service/src/domain/CrmDashboardService.ts` — new; the three aggregation functions.
- `apps/sales-service/src/api/crm-dashboard.routes.ts` — new; `GET /crm/dashboard`.
- `apps/sales-service/src/main.ts` — registered `crmDashboardRoutes`.
- `apps/sales-service/src/__tests__/crm-dashboard-service.test.ts` — new; 8 tests.
- `apps/sales-service/src/__tests__/crm-dashboard-permission-guards.test.ts` — new; 4 tests.
- `apps/web-frontend/src/api/endpoints.ts` — new `crmDashboardApi`.
- `apps/web-frontend/src/pages/crm/CrmDashboardPage.tsx` — new.
- `apps/web-frontend/src/lib/navigation.ts` — new "Dashboard" nav item (first under CRM).
- `apps/web-frontend/src/App.tsx` — new `/crm/dashboard` route.

## What is not done (remaining TODO)

| Item                                                           | Why deferred                                                                                                                                                                                           | Target                                |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------- |
| Playwright E2E specs for the 3 scenarios in the phase doc      | Not run this session; logic covered instead by unit + HTTP-injection tests against a mocked DB                                                                                                         | Follow-up before Phase 1 sign-off     |
| Materialized `projection_dashboard_daily`-style precomputation | Explicitly contingent on live aggregation proving too slow in practice — phase doc's own "measure before projecting" discipline; not measured this session (no production-scale data available in dev) | Only if real latency data warrants it |

## Deployment Checklist

- [ ] Run migration `0116_crm_dashboard_permission_backfill.sql` against every target database
      (staging/prod) — verified applied against the local dev DB this session only.
- [ ] No new environment variables.

---

## Phase 1 (Foundation) — now fully complete

All 8 "Must Have" features are shipped and verified:

1. Contact & Account Hierarchy
2. Lead Management & Capture
3. Customer 360 Command Center
4. Support & Ticketing
5. ERP-Native Integration Layer
6. DLT/TRAI SMS Compliance
7. Data Import / Dedupe / Merge Tooling
8. CRM Dashboards & KPI Tracking

Per the roadmap README's own sequencing rule, Phase 2 should not begin until Phase 1 is fully
deployed (migrations 0105–0116 run against every target environment — see each feature's
individual Deployment Checklist above) and this phase's Playwright E2E backlog (noted as
deferred in every one of the 8 completion reports) is addressed, or a deliberate decision is made
to carry that gap into Phase 2 rather than block on it.
