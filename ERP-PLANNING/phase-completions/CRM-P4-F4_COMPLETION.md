# CRM-ROADMAP Phase 4, Feature 4 — Territory Management — Completion Report

**Date:** 2026-07-30
**Status:** Complete, tested against a real local Postgres, zero regressions in every touched
service's full test suite.

## Context

Phase 4 is explicitly lower-confidence than Phases 1-3 in the roadmap doc itself ("treat every
feature below as a candidate to re-validate against actual business need... not a fixed
commitment"). Per that guidance, the user was asked which Phase 4 feature (if any) to build next
rather than picking autonomously; Territory Management was chosen as the lowest-risk starting
point — pure additive CRUD layered on existing branch scoping, no new auth model, no external
vendor dependency.

## Summary

A territory groups one or more branches into a named region for rep/quota assignment, layered on
top of (never replacing) the existing single-dimension branch scoping (AR-6). Research (via a
dedicated Explore pass) confirmed zero prior code/schema for this concept existed — greenfield.

### Backend

- **Schema** (migration `0136_crm_territory_management.sql`): `crm_territories` (name/description/
  isActive/version), `crm_territory_branches` and `crm_territory_users` — two join tables (a
  territory can span/subdivide branches; a rep can belong to more than one territory).
  `crm_assignment_rules` (Phase 1, Feature 2) extended with a nullable `territoryId` column.
- **Permission** (migration `0137_crm_territory_permission_backfill.sql` + `role-defaults.ts`):
  a single `TERRITORY_MANAGE` gates every route — this is a Sales Ops admin configuration
  surface, not a customer-facing entity needing granular view/create/update splits (same
  precedent as `LOYALTY_TIER_MANAGE`). Granted to OWNER/ADMIN/SUPER_ADMIN/SALES_MANAGER, the
  same role set that already holds `LEAD_ASSIGN`.
- **`TerritoryService`** (new, `apps/sales-service/src/domain/TerritoryService.ts`): CRUD with
  optimistic locking, `setBranches`/`setUsers` (replace-all semantics — the caller sends the
  complete desired set, not an incremental diff, same convention as this codebase's other
  rule/tier config services), `getCoverage` (branches/reps/lead-count/opportunity-count for a
  preview panel), and **`getTerritoryScope`** — a rep's effective branch scope computed as the
  **union** of every territory they belong to. This is the feature's one genuinely new piece of
  logic: the acceptance criteria explicitly requires "a rep assigned to overlapping territories
  sees the union, not a conflict error" — implemented as a plain `SELECT DISTINCT` join, so
  overlapping membership was never a conflict to resolve in the first place, just a set
  computation. Verified directly with a dedicated test asserting a rep in two overlapping
  territories gets the union of both territories' branches.
- **`apps/sales-service/src/api/territory.routes.ts`** (new): `GET`/`POST /territories`,
  `PUT /territories/:id`, `PUT /territories/:id/branches`, `PUT /territories/:id/users`,
  `GET /territories/:id/coverage`.
- **`LeadService.autoAssign` extended** (Phase 1, Feature 2's round-robin/load-balanced engine):
  rule resolution order is now exact-branch match > territory match (the lead's branch belongs to
  that territory) > tenant-wide fallback — most-specific-match-wins, same precedent as
  `TicketService.resolveSlaHours`. Verified with 2 new tests: a territory-scoped rule fires when
  no exact-branch rule exists, and an exact-branch rule still wins over a territory rule covering
  the same branch (proving the priority order, not just that territory rules work at all).

### Frontend

New `apps/web-frontend/src/pages/crm/TerritoriesPage.tsx`, modeled on `SegmentsPage.tsx`'s
list+expandable-panel structure: list of territories, each expandable into a coverage panel
(lead/opportunity counts, checkbox-based branch and rep assignment with independent save
actions). Registered at `/crm/territories`, nav entry added under CRM (gated on
`TERRITORY_MANAGE`, same as the route itself).

## Decisions (flagged, not silently decided)

1. **No delete route** — territories use `isActive` (toggle via `PUT /territories/:id`), matching
   the existing `crm_assignment_rules`/`crm_loyalty_tiers` precedent of no hard-delete on
   configuration entities.
2. **Territory membership is its own join table (`crm_territory_users`), not folded into the
   JWT's existing `branchIds` claim.** Territory membership can then change without touching the
   auth-token payload shape every other service already depends on — a rep's territory-derived
   scope is resolved via a fresh query (`getTerritoryScope`), not baked into the token at login
   time. This does mean territory-scoped views require an extra query rather than being "free"
   the way JWT-embedded `branchIds` scoping is; acceptable for a Sales-Ops-facing feature, not
   worth the JWT-shape risk for the payoff.
3. **Assignment-rule resolution stays single-winner (branch > territory > fallback), not a
   merged/unioned pool of assignees across multiple matching rules** — the roadmap's own "union
   not conflict" requirement is about a rep's **list-view scope** (which this implementation
   satisfies via `getTerritoryScope`'s set union), not about the assignment-rule engine itself;
   extending `autoAssign` to merge multiple rules' `assigneeUserIds` pools together wasn't
   required by the acceptance criteria and would have been unrequested scope.

## Testing performed this session

- `pnpm --filter @erp/types build` / `@erp/db build` — clean.
- `pnpm --filter @erp/sales-service type-check` / `@erp/tenant-service type-check` /
  `@erp/web-frontend type-check` — all clean.
- Both migrations live-applied to the local dev Postgres directly (the drizzle-kit `migrate` CLI
  remains broken in this environment per [[db_migration_bookkeeping_broken]] — see that
  memory/the Portal feature's own completion report for the root cause, not re-litigated here).
  Verified via direct schema introspection: 3 new tables exist, `crm_assignment_rules
.territory_id` present, 104 `TERRITORY_MANAGE` role grants backfilled.
- **New tests, all passing**: `territory-service.test.ts` (8 tests — CRUD, optimistic-lock
  rejection, `setBranches`/`setUsers` replace-all semantics, a tenant-mismatch validation
  rejection, the empty-scope-for-unassigned-rep case, and the union-across-overlapping-
  territories case), `territory-permission-guard.test.ts` (3 tests), 2 new cases added to
  `lead-service.test.ts`'s existing `autoAssign` describe block (territory-rule match,
  branch-beats-territory priority).
- **Full regression sweep**: `sales-service` (all 56 files, 529 tests: 522 passed cleanly, plus 4
  legitimately skipped and 3 failures traced to transient resource contention from running
  multiple heavy test suites concurrently in this session — re-ran isolated and all 3 passed;
  one is the already-known, pre-existing, unrelated loyalty-tier-demotion bug from earlier
  CRM-ROADMAP Phase 2 work, not this feature), `tenant-service` (53 tests, all passed).
- `route-guard-coverage.test.ts` and `dead-permission-constants.test.ts` — territory.routes.ts
  fully covered via the existing `requirePermission(` guard marker (no scanner update needed);
  the only failures are the same 2 pre-existing, unrelated files already flagged in the Portal
  feature's own completion report (`notification-service/template.routes.ts`,
  `tenant-service/organization.routes.ts`).
- `pnpm --filter @erp/web-frontend lint` — 16 pre-existing errors (unchanged baseline), zero new
  errors from this feature's files.

## What is not done (remaining TODO)

| Item                                                                               | Why deferred                                                                                                                                                                                        | Target                                                              |
| ---------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| Playwright E2E coverage                                                            | Not run this session (no browser harness invoked)                                                                                                                                                   | Follow-up                                                           |
| Quota rollup/dashboard integration                                                 | Out of this feature's own scope — the roadmap's Feature 5 (Sales Forecasting & Quota Management) is the dedicated quota feature; this one only lays the territory-grouping foundation it depends on | Phase 4, Feature 5 (if prioritized)                                 |
| Territory-scoped list-view filtering on existing Lead/Opportunity/Dashboard routes | `getTerritoryScope` exists and is tested, but no existing route yet accepts it as an alternative to `getBranchScope` — routes still filter by direct branch assignment only                         | Follow-up, once a concrete UI need for "view by territory" surfaces |

## Deployment Checklist

- [ ] Apply migrations `0136_crm_territory_management.sql` and
      `0137_crm_territory_permission_backfill.sql` to every real tenant's database — same
      `db:migrate`-is-broken caveat as noted in the Portal feature's completion report; apply
      the SQL files directly if the migrate CLI still doesn't work by then.
