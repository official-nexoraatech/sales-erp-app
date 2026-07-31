# CRM-ROADMAP Phase 3, Feature 6 — Field-level RBAC for CRM Records — Completion Report

**Date:** 2026-07-30
**Status:** Complete.

## Summary

Extends this codebase's existing route-level/page-level RBAC with response-shaping depth: a
specific field can now be restricted by permission independently of the route it lives on. Scoped
to the one field the roadmap's own objective names concretely — Opportunity `value` (deal size),
flagged as commercially sensitive back in Phase 2 Feature 1's own security note.

- **New `OPPORTUNITY_VALUE_VIEW` permission**, deliberately separate from `OPPORTUNITY_VIEW`
  (see the deal's existence/stage/pipeline position) and from `OPPORTUNITY_UPDATE`/`CREATE`
  (change it). Verified against `role-defaults.ts` before adding anything: today, every one of
  the 10 system roles holding `OPPORTUNITY_VIEW` (only `SALES_MANAGER`, plus `OWNER`/`ADMIN`/
  `SUPER_ADMIN` via their "every tenant-scoped permission" default) already sees comparable
  pricing data via `INVOICE_VIEW`/`QUOTATION_VIEW`/`PRICE_OVERRIDE` — so this feature changes
  nothing for today's roles. Its actual value is protecting a **future tenant-created custom
  role** that gets `OPPORTUNITY_VIEW` without also getting full pricing visibility, which this
  codebase's custom-role feature makes possible even though no default role currently does it.
- **New shared utility** `packages/platform-sdk/src/field-visibility.ts` —
  `omitFieldsWithoutPermission`/`omitFieldsFromListWithoutPermission`, generic and reusable
  across any future field-level gate, not opportunity-specific. Omits the field entirely rather
  than nulling it (per the roadmap's own explicit reasoning: null can be mistaken for "no value"
  rather than "no access").
- **Applied at the API layer** (a response-serialization filter, not a new authorization system)
  to all three routes that ever return the `value` field: `GET /opportunities` (list),
  `GET /opportunities/:id` (detail), and `GET /opportunities/forecast`.
- **Derived-value leak edge case resolved, not left open** (the roadmap's own explicit DoD
  requirement): the forecast endpoint's `pipelineValue`/`weightedValue`/`commitValue` are a direct
  sum of `value` across every open deal — gated by the same permission as the raw field, not
  treated as a "safe" aggregate. A caller without the permission gets an empty object back from
  that endpoint, not a number computed from data they can't otherwise see.
- **Frontend contract change handled explicitly**, per the roadmap's own stated requirement that
  the frontend "must handle the field's potential absence gracefully":
  - `PipelineKanbanPage.tsx` — Kanban cards and per-stage/forecast totals render "—" instead of
    "₹NaN" when `value` is absent; a stage total is only summed when every opportunity in it
    actually carries the field (all-or-nothing per caller permission, not partial).
  - `OpportunityDetailPage.tsx` — same "—" treatment on the Value stat card.
  - `OpportunityFormPage.tsx` — a real bug found and fixed before it could ship: the edit form's
    `reset()` defaulted a hidden `value` to `0`, and `onSubmit` unconditionally sent whatever the
    form held. Saving _any_ other field change (e.g. just the deal name) as a caller lacking
    `OPPORTUNITY_VALUE_VIEW` would have silently overwritten the real deal value with 0 in the
    database. Fixed by detecting the hidden case, showing an explicit "Hidden — you don't have
    permission to view or edit deal value" message instead of the input, and stripping `value`
    from the submit payload entirely so the server-side "missing key = don't touch this column"
    behavior (already correct in `PUT /opportunities/:id`) preserves the real value.

## Decisions / deviations (flagged during implementation, not silently decided)

1. **Scope held to the one concretely-named field (`value`), not broadened to line-item
   pricing.** The roadmap's objective line also mentions "cost basis" generically, and Opportunity
   line items carry `unitPrice`/`discountPct`/`discountAmount`. The only _concrete_ gap this
   feature traces back to is Phase 2 Feature 1's specific security note about deal `value` —
   extending to line-item pricing as well would be a real scope increase without a similarly
   concrete trigger, so it's deliberately left for a follow-up if a specific need for it surfaces.
2. **A real, pre-existing-shipped bug caught and fixed in the edit form** (see Summary above) —
   this wasn't hypothetical: without the fix, deploying this feature's backend change alone (route
   omitting `value`) would have turned an ordinary "rename this deal" edit into a silent value-
   wipe for any future custom role missing the new permission. Caught by tracing the frontend
   contract change through to its actual submit path, not just the display path.
3. **No schema change** — this is a pure response-serialization concern, matching the roadmap's own
   "Database impact: None." The new permission is data-only (role_permissions rows), backfilled via
   migration 0131 for existing tenants (role-defaults.ts grants only apply at new-tenant-
   provisioning time — same recurring gap as every prior permission addition this session).

## Acceptance Criteria

- [x] A user without margin-visibility permission views an Opportunity → the field is absent, not
      shown as blank/zero — covered directly, both list and detail routes, live-DB integration
      test asserting `'value' in response === false`.
- [x] A user with the permission sees the real value — covered directly, same tests.
- [x] The derived-value leak edge case is resolved and tested, not left open — covered directly
      (forecast route, both permission states tested).

## Verification performed this session

- `pnpm --filter @erp/sdk build` / `@erp/types build` — clean (required for the new permission
  constant and platform-sdk export to type-check downstream).
- `pnpm --filter sales-service type-check` / `tenant-service type-check` / `web-frontend
type-check` — all clean.
- `eslint` scoped to every touched/new file — 0 new errors (only the same pre-existing-style
  `explicit-function-return-type`/`no-non-null-assertion` warnings already present throughout
  this codebase).
- **Live migration** `0131_opportunity_value_view_permission_backfill.sql` applied directly to the
  local dev Postgres (`INSERT 0 104` — `OPPORTUNITY_VALUE_VIEW` backfilled to
  `OWNER`/`ADMIN`/`SUPER_ADMIN`/`SALES_MANAGER` across every existing tenant).
- **New `packages/platform-sdk/src/__tests__/field-visibility.test.ts`** — 8/8 passing, filter-
  logic correctness per permission combination (has it / lacks it / multi-field / list / empty
  list / no mutation of the source object).
- **New `apps/sales-service/src/__tests__/opportunity-field-visibility.test.ts`** — 6/6 passing,
  live-DB integration: a real Fastify app + real Postgres row, two callers with different
  permission sets hitting `GET /opportunities`, `GET /opportunities/:id`, and
  `GET /opportunities/forecast`, asserting the exact response-shape difference the DoD requires.
- **`opportunity-permission-guards.test.ts`** (pre-existing) — 6/6 still passing unmodified.
- **`opportunity-service.test.ts`** (pre-existing) — 14/14 still passing unmodified.
- **`dead-permission-constants.test.ts`** (shared-types) — passing; confirms
  `OPPORTUNITY_VALUE_VIEW` is actually referenced in enforcement code, not a dead grant (the exact
  recurring bug class this session has hit and fixed multiple times before).
- **Full regression sweep**: `pnpm --filter tenant-service test` — 59/59; `pnpm --filter @erp/sdk
test` — 161/165 (4 pre-existing skips, unrelated); `pnpm --filter web-frontend test` — 430/430.

**Pre-existing, unrelated issues found during this sweep (not fixed, not this feature's scope):**

- Running `sales-service`'s full test suite (not just the opportunity-scoped files above) surfaces
  12 files failing with 401s from a hardcoded `'erp-test'` JWT issuer that doesn't match
  `verifyAccessToken`'s default (`erp-auth-service`) in this environment — reproduces standalone,
  unrelated to any file this feature touched, and several of the affected files show as modified/
  untracked in git status (likely a concurrent session's in-progress work — see
  [[concurrent_sessions_on_same_repo]]). Left untouched.
- `route-guard-coverage.test.ts` (shared-types) flags 7 unguarded routes in
  `notification-service/template.routes.ts` and `tenant-service/organization.routes.ts` — both
  files show as modified/untracked, unrelated to Opportunity/CRM work. Left untouched.
- Did not verify the frontend changes in a live browser session (no dev server was running, and
  standing up the full stack plus a custom low-permission test role was out of scope for this
  pass) — relied on type-checking, lint, and live-DB integration tests that exercise the exact API
  contract the frontend renders against (an absent `value` key triggers the same "—" code path a
  real hidden-permission response would).

## Files touched

- `packages/shared-types/src/permissions.ts` — `OPPORTUNITY_VALUE_VIEW`.
- `apps/tenant-service/src/rbac/role-defaults.ts` — `SALES_MANAGER` grant.
- `packages/db-client/migrations/0131_opportunity_value_view_permission_backfill.sql` — new;
  applied live.
- `packages/db-client/migrations/meta/_journal.json` — appended entry.
- `packages/platform-sdk/src/field-visibility.ts` — new.
- `packages/platform-sdk/src/index.ts` — exports it.
- `packages/platform-sdk/src/__tests__/field-visibility.test.ts` — new.
- `apps/sales-service/src/api/opportunity.routes.ts` — field filter applied to list/detail/
  forecast routes.
- `apps/sales-service/src/__tests__/opportunity-field-visibility.test.ts` — new.
- `apps/web-frontend/src/api/endpoints.ts` — forecast response type's 3 fields made optional.
- `apps/web-frontend/src/pages/crm/PipelineKanbanPage.tsx` — `value?`, graceful "—" rendering.
- `apps/web-frontend/src/pages/crm/OpportunityDetailPage.tsx` — graceful "—" rendering.
- `apps/web-frontend/src/pages/crm/OpportunityFormPage.tsx` — hidden-value-safe edit form (the
  silent-overwrite bug fix).

## What is not done (remaining TODO)

| Item                                                                                             | Why deferred                                                                                       | Target                                     |
| ------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| Playwright E2E specs for the 2 acceptance-criteria scenarios                                     | Not run this session; logic covered instead by unit + live-DB integration tests                    | Follow-up before Phase 3 sign-off          |
| Field-level gating on Opportunity line-item pricing (`unitPrice`/`discountPct`/`discountAmount`) | Deliberately out of scope — no concrete flagged gap for it, unlike deal `value` (see Decisions #1) | Only if a real need surfaces               |
| Live browser verification of the 3 frontend pages                                                | No dev server running this session; deferred to a session with the full stack up                   | Before this feature ships to a real tenant |

## Deployment Checklist

- [ ] Run migration `0131_opportunity_value_view_permission_backfill.sql` against every target
      database (staging/prod) — verified applied against the local dev DB this session only.
- [ ] No new environment variables.
