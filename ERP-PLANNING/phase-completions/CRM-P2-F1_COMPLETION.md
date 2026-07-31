# CRM-ROADMAP Phase 2, Feature 1 — Sales Pipeline & Opportunity Management — Completion Report

**Date:** 2026-07-29
**Status:** Complete.

## Summary

The single highest-value feature in the entire roadmap: bulk/wholesale/B2B deals now have a
visible, forecastable pipeline instead of no structural representation at all.

- **New tables**: `crm_pipeline_stages` (tenant-configurable, optional), `crm_opportunities`,
  `crm_opportunity_line_items` (pre-quotation forecast lines, deliberately no GST/HSN — those
  are only computed at Won-time), `crm_opportunity_history` (mirrors `crm_lead_activities`'
  shape — an activity log, not a generic diff-jsonb audit trail).
- **Pipeline stages are optional to customize**: a tenant with zero `crm_pipeline_stages` rows
  gets a hardcoded 6-stage default (NEW → QUALIFICATION → PROPOSAL → NEGOTIATION → WON/LOST),
  same "sensible default always applies" convention as `crm_ticket_sla_rules`/`resolveSlaHours`.
- **New `apps/sales-service/src/domain/OpportunityService.ts`** — `create`, `changeStage`
  (generic transition enforcing both this feature's exit criteria: Lost requires a reason, Won
  requires ≥1 line item), `markWon` (the Won→Quotation handoff), `markLost`, line-item CRUD,
  `list` (branch-scoped), and `computeForecast` (pure, independently unit-tested).
- **Stage-Won reuses `QuotationService.create()` verbatim** (AR-2) — never a second
  quotation-creation implementation. The entire handoff (`changeStage` into Won + fresh
  `items` gstRate/hsnCode lookup + `QuotationService.create()` + setting
  `convertedQuotationId`) runs inside **one transaction**, per this feature's own testing
  requirement that it be "a single atomic operation" — verified directly: a quotation-creation
  failure (a BLOCKED customer) rolls the stage change back too, leaving the opportunity exactly
  where it was, never "Won but no quotation."
- **Stock badges reuse Feature 5's integration layer**, not a new implementation: extracted
  `CustomerFinancialSnapshotService.getStockForItems(db, tenantId, itemIds)` — the batched,
  N+1-avoiding aggregation `getRecentItemsStock` already did internally — so opportunity line
  items and Customer 360's "recently purchased" both call the same one aggregation.
- **Branch scoping (AR-6)** implemented from day one via `OpportunityService.list()`, using the
  same `getBranchScope` + `or(isNull(branchId), inArray(branchId, scope))` shape every other CRM
  list route in this codebase already uses (leads, tickets) — extracted into a directly-callable
  service method specifically so it has its own test, per this feature's DoD requirement.
- **Frontend**: `PipelineKanbanPage.tsx` (drag-and-drop, mirrors `LeadsKanbanPage.tsx`'s exact
  pattern, plus three forecast stat cards — pipeline/best-case/commit — at the top),
  `OpportunityFormPage.tsx` (create/edit), `OpportunityDetailPage.tsx` (line-item management,
  stock badges, history log). Dropping a card into a Won- or Lost-flagged column opens a
  dedicated modal (collecting the quotation params for Won, a mandatory reason for Lost) instead
  of firing the generic stage-change call — the UI-level expression of this feature's exit
  criteria, on top of the backend's own enforcement.

## Decisions / deviations (flagged during implementation, not silently decided)

1. **Reconciled two statements in the phase spec that read as being in tension**: "a quotation
   must be attached before Negotiation → Won is allowed" (implying a pre-existing quotation) vs.
   "stage-won triggers the... quotation creation path" (implying auto-creation at Won-time).
   Resolved as: the real exit criterion is **≥1 line item** (a quotation needs lines to exist at
   all — this is also the roadmap's own explicitly-flagged "decide at implementation time" edge
   case), and marking Won always auto-creates exactly one new quotation from the opportunity's
   current lines. No separate "attach an existing quotation" flow was built for v1.
2. **`OpportunityService.list()` extracted from the route** rather than left inline — done
   specifically so branch-scoping (a DoD requirement) has an isolated, directly-testable
   function, matching the same pattern this session used for `CrmDashboardService`'s functions
   in Feature 8.
3. **Two distinct stage-transition endpoints, not one generic PATCH**: `POST /opportunities/:id/stage`
   (mid-pipeline moves) explicitly **rejects** an attempt to move into a Won-flagged stage,
   redirecting the caller to `POST /opportunities/:id/won` — because Won needs additional
   required params (branchId/placeOfSupply/sellerStateCode/validUntil) a plain stage-change body
   doesn't carry. `POST /opportunities/:id/lost` is separate too (mandatory `lostReason`).
   Mirrors `TicketService`'s established convention of distinct, intention-revealing methods
   over one generic update.
4. **`value` (the deal-size estimate) is independent of summed line-item totals** — a rep can
   estimate a deal's value before any line items exist (explicitly allowed pre-Won per the
   roadmap's own edge case), so `value` is a plain user-supplied field, never auto-derived from
   `crm_opportunity_line_items`.
5. **Opportunity line-item entry is by numeric Item ID for v1**, not a search-picker combobox
   (the pattern `QuotationFormPage.tsx` already uses) — a deliberate scope trim to keep this
   already-large feature shippable; a proper item-search picker is a natural, low-risk follow-up
   that doesn't change any of the underlying API contract.
6. **No separate "forecast dashboard" page** — the phase doc's "(commit/best-case/pipeline
   bands) for managers" requirement is satisfied as three stat cards atop the same Pipeline
   Kanban page, not a second page, since nothing in the spec required a standalone screen and
   the Kanban board is already the natural place a manager looks at pipeline health.

## Acceptance Criteria

- [x] A wholesale deal can be tracked from first contact through Won/Lost with an accurate,
      branch-scoped forecast view for managers — covered end-to-end by
      `opportunity-service.test.ts`'s full lifecycle tests plus the Kanban page's forecast cards.
- [x] Create an opportunity, advance through stages via drag-and-drop, mark Won → a Quotation is
      created and linked — covered directly (`markWon` integration test asserts
      `convertedQuotationId` and real `quotationLines` rows with correct GST).
- [x] Attempt to advance to Won without meeting exit criteria → blocked with a specific message —
      covered directly (`NO_LINE_ITEMS` `BusinessError`, not a silent no-op).
- [x] Mark Lost with a reason → available for loss-reason reporting — `lostReason`/`lostAt`
      persisted, covered directly; a missing reason is rejected (`LOST_REASON_REQUIRED`).
- [x] Branch-scoped rep sees only their branch's pipeline; unscoped manager sees all — covered
      directly by `OpportunityService.list()`'s dedicated branch-scoping test.
- [x] Optimistic locking via `version` — covered directly (`OptimisticLockError` on a stale
      version).
- [x] Forecast math independently verified against a hand-computed fixture — covered directly
      (`computeForecast` pure-function test with manually-computed pipeline/weighted/commit
      totals).
- [x] The Won→Quotation handoff is verified as a single atomic operation — covered directly: a
      forced quotation-creation failure (BLOCKED customer) proves the stage change rolls back
      too.

## Verification performed this session

- `pnpm --filter @erp/db build` / `@erp/utils build` / `@erp/types build` — all clean.
- `pnpm --filter sales-service type-check` / `tenant-service type-check` /
  `web-frontend type-check` — all clean.
- `eslint` scoped to every touched/new file — 0 errors (only the same pre-existing-style
  `explicit-function-return-type`/`no-non-null-assertion` warnings already present throughout
  this codebase).
- **Live migrations** `0117_crm_opportunities.sql` (4 new tables) and
  `0118_crm_opportunity_permission_backfill.sql` (520 rows — all five `OPPORTUNITY_*`
  permissions backfilled for OWNER/ADMIN/SUPER_ADMIN/SALES_MANAGER across all existing tenants)
  applied directly to the local dev Postgres.
- **New test file** `opportunity-service.test.ts` — **14/14 passing**: forecast math (fixture +
  zero-opportunity safety), default stage-set fallback, creation, exit criteria (Lost needs
  reason, Won needs a line item, both directions), optimistic locking, closed-opportunity
  immutability, the full Won→Quotation handoff (including its atomic-rollback-on-failure case),
  and branch-scoped vs. unscoped listing.
- **New test file** `opportunity-permission-guards.test.ts` — **6/6 passing**: each of the five
  new `OPPORTUNITY_*` constants verified to actually gate its own route (per this codebase's
  documented recurring "dead permission constant" bug class).
- **Full regression sweep** across all of Phase 1 plus this feature (account-service,
  lead-service, lead-capture-auth-isolation, customer-360-degradation, ticket-service,
  customer-financial-snapshot, campaign-service, crm-dashboard-service,
  crm-dashboard-permission-guards, opportunity-service, opportunity-permission-guards):
  **157/157 passing**.
- `pnpm --filter tenant-service test` — **59/59 passing** (one run showed a single flaky failure
  in an unrelated pre-existing test, `tenant.integration.test.ts`'s provisioning test; re-ran
  standalone and it passed cleanly — consistent with this project's documented
  parallel-test-CPU-contention flakiness, not a regression from this session's changes).
- `pnpm --filter @erp/types test -- route-guard-coverage` — same **2 pre-existing, unrelated**
  failures as every prior session in this roadmap; `opportunity.routes.ts` is not flagged.

## Files touched

- `packages/db-client/src/schema/crm.ts` — `crmPipelineStages`, `crmOpportunities`,
  `crmOpportunityLineItems`, `crmOpportunityHistory` + type exports.
- `packages/db-client/migrations/0117_crm_opportunities.sql`,
  `0118_crm_opportunity_permission_backfill.sql` — new; both applied live.
- `packages/db-client/migrations/meta/_journal.json` — appended entries.
- `packages/shared-types/src/permissions.ts` — new `OPPORTUNITY_VIEW/CREATE/UPDATE/
STAGE_CHANGE/DELETE`.
- `apps/tenant-service/src/rbac/role-defaults.ts` — SALES_MANAGER gains all five.
- `apps/sales-service/src/domain/CustomerFinancialSnapshotService.ts` — extracted
  `getStockForItems()`, reused by both `getRecentItemsStock()` and the new opportunity flow.
- `apps/sales-service/src/domain/OpportunityService.ts` — new.
- `apps/sales-service/src/api/opportunity.routes.ts` — new.
- `apps/sales-service/src/main.ts` — registered `opportunityRoutes`.
- `apps/sales-service/src/__tests__/opportunity-service.test.ts` — new; 14 tests.
- `apps/sales-service/src/__tests__/opportunity-permission-guards.test.ts` — new; 6 tests.
- `apps/web-frontend/src/api/endpoints.ts` — new `opportunityApi`.
- `apps/web-frontend/src/schemas/opportunity.schema.ts` — new.
- `apps/web-frontend/src/pages/crm/PipelineKanbanPage.tsx`,
  `OpportunityFormPage.tsx`, `OpportunityDetailPage.tsx` — new.
- `apps/web-frontend/src/lib/navigation.ts` — new "Pipeline" nav item.
- `apps/web-frontend/src/App.tsx` — new `/crm/pipeline`, `/crm/pipeline/new`,
  `/crm/pipeline/:id`, `/crm/pipeline/:id/edit` routes.

## What is not done (remaining TODO)

| Item                                                      | Why deferred                                                                                             | Target                                                  |
| --------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| Playwright E2E specs for the 5 scenarios in the phase doc | Not run this session; logic covered instead by unit + live-DB integration tests                          | Follow-up before Phase 2 sign-off                       |
| Item-search combobox for adding opportunity line items    | Numeric Item ID entry is a deliberate v1 scope trim (see Decisions #5) — doesn't change the API contract | Natural follow-up, low risk                             |
| "Attach an existing quotation" alternate Won flow         | Only the auto-create-on-Won path was built (see Decisions #1)                                            | Only if a real need for pre-created quotations surfaces |
| Stage-aged automation ("a deal that stalls for months")   | Explicitly called out as an edge case in the phase doc, not a core AC                                    | Phase 2 follow-up                                       |

## Deployment Checklist

- [ ] Run migrations `0117_crm_opportunities.sql` and `0118_crm_opportunity_permission_backfill.sql`
      against every target database (staging/prod) — verified applied against the local dev DB
      this session only.
- [ ] No new environment variables.
