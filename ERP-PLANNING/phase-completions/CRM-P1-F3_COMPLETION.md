# CRM-ROADMAP Phase 1, Feature 3 — Customer 360 Command Center — Completion Report

**Date:** 2026-07-29
**Status:** Complete.

## Summary

`HealthScoringService` and `ActivityTimelineService` already existed server-side with no
frontend surface — per the roadmap doc, "the highest value-to-effort ratio in this entire
roadmap; the backend work is already done and stranded." This feature is the thin composition
layer that surfaces both, plus real AR/credit context, on the existing customer detail page:

- New `GET /customers/:id/360` (`apps/sales-service/src/api/customer-360.routes.ts`): a
  read-only composition, **no new tables, no new writes** — calls
  `HealthScoringService.scoreCustomer` (fresh, on-demand, not the batch-job-stale stored
  column), `ActivityTimelineService.build`, and the existing `projection_customer_balance`
  CQRS projection, all via `Promise.allSettled` so one slow/failed sub-service degrades only
  its own section instead of 500ing the page.
- New `CRM_360_VIEW` permission, granted to `SALES_MANAGER`/`CASHIER`/`STAFF` (the same roles
  that already hold `CUSTOMER_VIEW`) — deliberately **not** granted to `DATA_OFFICER`, whose
  role is bulk export/compliance, not the rep-facing command-center this gates.
- Frontend: extended the existing `CustomerViewPage.tsx` (not a new page — see deviation below)
  with a live health-score strip sourced from the fresh 360 call (falls back to the stored
  column while loading), two new financial-snapshot cards (Current Balance, Credit Headroom —
  "No limit set" rather than a divide-by-zero/nonsensical percentage when no limit is
  configured), and a partial-degradation banner if any composed section failed to load.

## Deviations (flagged during implementation, not silently decided)

1. **No new `Customer360Page.tsx` at `pages/sales/customers/`.** That directory doesn't exist
   in this codebase — actual customer pages live at `apps/web-frontend/src/pages/customers/`
   (the same stale-path pattern already found and worked around for `CustomerService.ts`/
   `AccountService.ts` in Features 1–2). Rather than create a parallel page duplicating
   `CustomerViewPage.tsx`'s existing Details/Timeline/Interactions tabs (which already cover
   most of what the spec's "tabbed timeline, right-rail quick actions" describes), this feature
   **evolves that page in place** — same route (`/customers/:id`), so "re-point the customer
   list's View action to this page" is satisfied trivially (it's the same page, now richer).
   This avoids maintaining two customer-detail pages with overlapping responsibility.
2. **The composed endpoint's `timeline` field is returned but not consumed by the frontend.**
   `CustomerViewPage.tsx`'s existing Timeline tab already has its own paginated fetch
   (`crmApi.activityTimeline` → `GET /customers/:id/activity`, built in an earlier phase) with
   working pagination UX. Replacing it with the 360 endpoint's first-page-only snapshot would
   have been a regression, not an improvement, so the tab keeps using its existing dedicated
   call; the composed endpoint's `timeline` data is there for API completeness (matching the
   spec's stated composition) and available to any other future consumer (e.g. a dashboard
   widget) without the frontend being forced to use it today.
3. **`CRM_360_VIEW` granted per-role deliberately, not via a blanket "same as CUSTOMER_VIEW"
   rule** — see the `DATA_OFFICER` exclusion above, called out explicitly in both
   `role-defaults.ts`'s comment and the backfill migration's header comment.

## Acceptance Criteria

- [x] A rep can answer "what's this customer's situation" without leaving one page — order
      history/balance/health score/interaction log all visible on `/customers/:id` without a
      tab switch for the summary figures (health, current balance, credit headroom are all in
      the sticky header/card row above the tabs).
- [x] Parallel fetch, not sequential — `Promise.allSettled` over four independent calls
      (health, timeline, balance, account), not a chain of `await`s. Verified by code review,
      not a live network-waterfall trace (no browser harness run this session — see "What is
      not done").
- [x] The composed endpoint degrades gracefully (partial render, not a full 500) if one
      sub-service fails — the one piece of genuinely new logic in this feature, and the one
      thing directly tested (`customer-360-degradation.test.ts`): health mocked to reject,
      timeline/financial still populate correctly, response is 200 with `degraded: ['health']`.
- [x] A customer with no credit limit configured doesn't divide-by-zero or show a nonsensical
      percentage — `creditHeadroom` is `null` (rendered as "No limit set") unless
      `creditLimitEnabled && creditLimit > 0`.
- [x] A customer whose account was merged (Feature 1) shows unified history, not fragmented —
      **true by construction, not extra code**: Feature 1's merge re-points `customers.account_id`
      and `crm_account_contacts`, it never splits or duplicates a customer's own transaction
      history across two rows, so there was never a fragmentation risk for a single customer's
      360 view to begin with. Documented here rather than silently assumed.
- [x] `CRM_360_VIEW` gates the whole page/endpoint.

## Verification performed this session

- `pnpm --filter @erp/types build` / `pnpm --filter @erp/db build` — clean.
- `pnpm --filter sales-service type-check` / `pnpm --filter tenant-service type-check` /
  `pnpm --filter web-frontend type-check` — all clean.
- `eslint` scoped to every touched/new file — 0 errors (pre-existing-style warnings only).
- **Live migration** applied directly to the local dev Postgres:
  `0109_crm_360_permission_backfill.sql` (78 rows inserted).
- `customer-360-degradation.test.ts` — **1/1 passing**, mocking `HealthScoringService` to
  reject and `ActivityTimelineService` to resolve, asserting the route still returns 200 with
  the failed section flagged in `degraded` and the successful sections fully populated.
- Re-ran `lead-service.test.ts` (10), `account-service.test.ts` (5), and
  `lead-capture-auth-isolation.test.ts` (4) from Features 1–2 to confirm no regression — **all
  20 still passing**.
- `pnpm --filter @erp/types test -- route-guard-coverage` — `customer-360.routes.ts` is
  **not** in the failure list; the test's 2 failures are the same pre-existing ones from
  Features 1–2's sessions, in files this feature never touched.
- **Root-caused this session's recurring 401-instead-of-expected-status test failures**
  (flagged as unexplained concurrent-session noise in Features 1–2's reports): a concurrent,
  uncommitted change to `packages/platform-sdk/src/auth.ts`'s `verifyAccessToken` added an
  `issuer` check (`JWT_ISSUER` env var, defaulting to `'erp-auth-service'`), but every existing
  JWT-based route test in this service still signs tokens with `issuer: 'erp-test'` — a
  guaranteed mismatch. Confirmed by re-running the pre-existing, previously-passing
  `customer-block-unblock.test.ts` (3 of 5 tests now fail 401 identically) with zero other
  changes. This is **not a bug in this feature** and was not fixed (touching a concurrent
  session's in-flight auth work is out of scope) — this session's own new test
  (`customer-360-degradation.test.ts`) signs with the matching issuer explicitly, with a
  comment explaining why, so it isn't blocked by the same issue.

## Files touched

- `packages/shared-types/src/permissions.ts` — new `CRM_360_VIEW`.
- `packages/db-client/migrations/0109_crm_360_permission_backfill.sql` — new; backfills
  `CRM_360_VIEW` for existing tenants' `SALES_MANAGER`/`CASHIER`/`STAFF` roles.
- `packages/db-client/migrations/meta/_journal.json` — appended entry.
- `apps/tenant-service/src/rbac/role-defaults.ts` — added `CRM_360_VIEW` to
  `SALES_MANAGER`/`CASHIER`/`STAFF` (not `DATA_OFFICER` — see deviation above).
- `apps/sales-service/src/api/customer-360.routes.ts` — new.
- `apps/sales-service/src/main.ts` — registered `customer360Routes`.
- `apps/sales-service/src/__tests__/customer-360-degradation.test.ts` — new; 1 test.
- `apps/web-frontend/src/api/endpoints.ts` — new `customerApi.get360`.
- `apps/web-frontend/src/pages/customers/CustomerViewPage.tsx` — health strip now sourced from
  the fresh 360 call; two new financial-snapshot cards; partial-degradation banner.

## What is not done (remaining TODO)

| Item                                                                                | Why deferred                                                                                                                             | Target                                |
| ----------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- |
| Playwright E2E specs for the 4 scenarios in the phase doc                           | Not run this session (no browser harness invoked); the one piece of new logic (degradation) covered instead by a direct route-level test | Follow-up before Phase 1 sign-off     |
| p95 latency measurement (DoD asks it be "measured and documented")                  | No live load-test/browser harness run this session                                                                                       | Follow-up before Phase 1 sign-off     |
| Materialized `crm_customer_360_view`                                                | Explicitly contingent on the above p95 measurement proving it necessary — spec says build live-composed first, this is exactly that      | Only if measurement shows it's needed |
| Pagination/virtualization for a customer with an extremely long interaction history | The Timeline tab's existing pagination (built in an earlier phase) already handles this; not new work for this feature                   | N/A — already covered                 |

## Deployment Checklist

- [ ] Run migration `0109_crm_360_permission_backfill.sql` against every target database
      (staging/prod) — verified applied against the local dev DB this session only.
- [ ] No new environment variables.
