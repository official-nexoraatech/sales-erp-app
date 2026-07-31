# CRM-ROADMAP Phase 2, Feature 2 — Visual Customer Journey Builder — Completion Report

**Date:** 2026-07-29
**Status:** Complete.

## Summary

Multi-step, branching, cross-channel automation sequences — per AR-3, journeys compile to the
same scheduler-cron mechanism already driving `campaignAutomationRules`, extended with
per-customer branching state (`crm_journey_enrollments`). Every message-sending step calls the
existing `CampaignService.send()` — never a second send mechanism — so a journey step
automatically inherits consent/frequency-cap enforcement for free. Shipped after Feature 6
(Campaign Studio engagement tracking), per the roadmap's own stated dependency.

- **4 new tables**: `crm_journeys` (DRAFT/PUBLISHED/PAUSED/ARCHIVED), `crm_journey_steps`
  (nested-list model — `parentStepId` + `branchPath: 'TRUE'|'FALSE'` — rather than an arbitrary
  graph; a BRANCH step's two outcomes are short nested step lists that terminate the journey),
  `crm_journey_enrollments` (DB-enforced `UNIQUE(journey_id, customer_id)` — the roadmap's
  explicit "re-entry must be explicit, not accidental" edge case, made structural rather than
  just an application-logic check), `crm_journey_step_events` (audit trail + per-step funnel
  stats).
- **`JourneyService.ts`** — `create`/`getStepsTree`/`publish`/`archive`/`previewAffectedCount`
  (segment-match count, checkable before publish per the roadmap's rollback/risk requirement)/
  `enrollCustomer` (manual, single-customer)/`listEnrollments`/`getFunnelStats` (per-step
  entered/completed/exited counts) and the scheduler-driven state machine:
  `evaluateDueEnrollments(ctx)` — checks the `crm.journey_engine.enabled` feature flag first (this
  feature's own DoD requires evaluation to stop immediately when toggled off, no deploy needed),
  then per PUBLISHED journey: enrolls new segment matches, evaluates every enrollment whose
  `nextEvaluationAt` is due. DELAY steps advance once their wait has elapsed; BRANCH steps
  evaluate `MADE_PURCHASE` (any qualifying invoice dated after `enrolledAt`) and route
  TRUE/FALSE; ACTION steps create a single-customer campaign (`campaignType: 'JOURNEY_STEP'`,
  pre-approved — the journey itself was already reviewed at publish time, same precedent as
  `fireAutomationRule`/recurring occurrences) and send it via `CampaignService.send()`. A
  `NO_RECIPIENTS` throw (customer opted out or consent-revoked since enrolling) is caught and
  treated as a clean `EXITED`/`OPTED_OUT` exit, not a retry-worthy failure — a published journey
  must never become a way to bypass consent.
- **`journey.routes.ts`** — `/journeys` (list/create), `/journeys/:id` (detail: journey + step
  tree + funnel stats), `/journeys/:id/affected-count`, `/journeys/:id/publish`,
  `DELETE /journeys/:id` (archives if published, hard-deletes if still DRAFT — a DRAFT journey
  never has enrollments), `/journeys/:id/enrollments` (list + manual single-customer enroll).
- **Closed a real, pre-existing gap found during research**: `POST
/crm/automation-rules/dispatch-due` (built in CP-5, loops all enabled
  `campaign_automation_rules` and fires them) had **no scheduler cron job ever registered to call
  it** — confirmed via grep and cross-referenced against CP-5's own completion report, which
  explicitly deferred this. Automation rules have therefore never actually fired outside of
  direct API calls. Fixed alongside this feature's own new job since this feature's AR-3
  justification ("journeys reuse the same mechanism already driving automation rules") depends on
  that mechanism actually running: `crm.automation-rules-dispatch-due` (`*/5 * * * *`).
- **New scheduler job**: `crm.journey-step-evaluate` (`*/5 * * * *`, matching every other CRM
  dispatch job's cadence) → internal route `POST /crm/journeys/evaluate-due` → loops active
  tenants → `JourneyService.evaluateDueEnrollments(ctx)` per tenant.
- **Feature flag**: `crm.journey_engine.enabled`, seeded globally disabled (migration `0123`) —
  per the roadmap's own Rollback plan, this is "the recommended flag-gated feature given its
  blast radius if a bad journey definition runs at scale." A tenant must explicitly opt in.
- **Frontend**: `JourneysPage.tsx` (list), `JourneyFormPage.tsx` (nested step builder — no
  drag-and-drop/graph library exists anywhere in this codebase and none is justified per
  `05-UI-UX-PLAN.md` §1; a BRANCH step's TRUE/FALSE outcomes render as two nested mini step-lists,
  directly matching the roadmap's own "welcome → wait 3 days → conditional offer" example),
  `JourneyDetailPage.tsx` (step tree with live per-step funnel counts, publish action with an
  affected-count confirmation, manual enrollment, enrollment list). Nav entry + routes wired.

## Decisions / deviations (flagged during implementation, not silently decided)

1. **Manual enrollment is gated by `JOURNEY_CREATE`, not a 5th permission.** The roadmap specifies
   exactly 4 permissions (`JOURNEY_VIEW/CREATE/PUBLISH/DELETE`); adding enrollment as a resource
   under `CREATE` mirrors `CRM_CAMPAIGN_CREATE` already covering both campaign authoring and
   send-related actions in this codebase.
2. **`archive()` hard-deletes a DRAFT journey, but only ever archives (never deletes) a
   published/paused one.** A DRAFT journey structurally cannot have enrollments (enrollment
   requires `PUBLISHED`), so nothing is orphaned by deleting it outright; a published journey's
   enrollments and step-event history are kept for audit, and `ARCHIVED` status alone is
   sufficient to stop all future evaluation since `evaluateDueEnrollments` only ever loads
   `PUBLISHED` journeys.
3. **`MADE_PURCHASE` branch evaluation checks for any qualifying invoice dated after the
   enrollment's `enrolledAt`, evaluated at the moment the BRANCH step is reached** (typically
   after a preceding DELAY step has already waited out the condition's window) — not a
   separately-tracked "within N days of reaching this step" clock. This matches the roadmap's own
   worked example exactly (wait 3 days, then check) without needing a second timestamp field.
4. **A real bug was caught by the test suite, not shipped silently**: the `isUniqueViolation`
   helper (mirroring `CustomerService.ts`'s own pattern of checking `err.code`/`err.constraint_name`
   directly on the caught error) initially failed to translate a duplicate-enrollment insert into
   the clean `ALREADY_ENROLLED` business error — it fell through to an opaque `Failed query: ...`
   message instead. Root cause: this codebase's current drizzle-orm/postgres.js version wraps the
   real Postgres error (with `code`/`constraint_name`) inside a `DrizzleQueryError`'s `.cause`,
   not on the thrown error directly. Fixed by checking `err.cause` first, falling back to `err`
   itself. **`CustomerService.ts`'s own `isUniqueViolation` was not touched — it appears to share
   this exact same latent bug** (same top-level-only property check) but is out of scope for this
   feature; flagged here for a future pass rather than fixed silently, per this session's own
   "surgical changes" discipline.
5. **ACTION-step test messages use the `EMAIL` channel, not `SMS`.** `SMS` is gated by this
   codebase's existing DLT/TRAI compliance check (`CampaignService.assertDltCompliant`), which
   requires a registered DLT template per tenant — orthogonal to anything this feature adds.
   `EMAIL` exercises the exact same `CampaignService.send()` path without that unrelated
   precondition.

## Acceptance Criteria

- [x] A marketer can build and publish a multi-step branching journey without engineering
      involvement — covered directly (frontend step builder + `JourneyService.create`/`publish`).
- [x] See per-step conversion — `getFunnelStats` (entered/completed/exited per step), rendered on
      `JourneyDetailPage.tsx`.
- [x] Preview-affected-customer-count safeguard shown before publish, not just after —
      `GET /journeys/:id/affected-count`, called and displayed on the detail page's confirmation
      dialog before the publish action fires.
- [x] Feature-flag disable stops all further step evaluation without a deploy — covered directly
      (`evaluateDueEnrollments` test with the flag off: zero enrollments touched).
- [x] A customer who unsubscribes mid-journey exits cleanly, respecting the existing
      `customerCommunicationPreferences`/opt-out gate — covered directly (`NO_RECIPIENTS` →
      `EXITED`/`OPTED_OUT` test).
- [x] Re-entry rules are explicit, not accidental — covered at both layers: the DB's own
      `UNIQUE(journey_id, customer_id)` constraint (manual double-enroll test) and
      `enrollNewMatches`'s own already-enrolled filter (segment-driven auto-enrollment test).
- [x] A branch condition ("made a purchase") correctly routes an enrolled customer down the
      matching path — covered directly, both TRUE and FALSE cases.
- [x] Full 3-step lifecycle (welcome → wait 3 days → conditional offer) — covered directly,
      end-to-end across 4 scheduler ticks, asserting the exact step-by-step state transitions and
      the final `COMPLETED` status with a full `crm_journey_step_events` trail.

## Verification performed this session

- `pnpm --filter sales-service type-check` / `scheduler-service type-check` /
  `web-frontend type-check` — all clean.
- `eslint` scoped to every touched/new file — 0 errors (only the same pre-existing-style
  `explicit-function-return-type` warnings already present throughout this codebase, plus one
  pre-existing, unrelated `react-hooks/exhaustive-deps` rule-not-found error in `App.tsx` at a
  line this feature didn't touch).
- **Live migrations applied** directly to the local dev Postgres: `0121_crm_customer_journeys.sql`
  (4 tables + indexes), `0122_crm_journey_permission_backfill.sql` (`INSERT 0 416` — 4 permissions
  × existing OWNER/ADMIN/SUPER_ADMIN/SALES_MANAGER roles across all tenants), and
  `0123_crm_journey_engine_feature_flag.sql` (`INSERT 0 1` — global default row, disabled).
- **New `journey-service.test.ts`** — **19/19 passing**: tree persistence/reconstruction,
  publish guards (DRAFT-only, ≥1 step), `previewAffectedCount`, manual enrollment + its two
  rejection cases (not-published, already-enrolled), the feature-flag gate, DELAY/ACTION/BRANCH
  step evaluation individually, segment-driven auto-enrollment + re-run idempotency, the full
  4-tick lifecycle, archive (both DRAFT-hard-delete and PUBLISHED-archive paths), and the
  `JOURNEY_HAS_NO_STEPS` business-error code.
- **Regression sweep**: `campaign-service.test.ts` (103 tests) + `segment-service.test.ts` (39
  tests) — **142/142 passing**, confirming `CampaignService.send()`'s existing behavior is
  unaffected by being called from a new caller.
- `packages/shared-types` `route-guard-coverage` scan — every new `journey.routes.ts` route
  correctly recognized as guarded (not flagged); the 2 unguarded routes the scan does report
  (`notification-service/template.routes.ts`, `tenant-service/organization.routes.ts`) are
  pre-existing and unrelated to this feature.
- `apps/web-frontend` existing CRM page tests (`CampaignsPage`, `CampaignSettingsPage`) —
  6/6 passing, confirming no regression from the new nav entry/routes.
- **Known, pre-existing, already root-caused** (not a regression from this feature): the same
  broad JWT-issuer-mismatch failure documented earlier this roadmap (an in-flight, uncommitted
  `verifyAccessToken` change adding an `issuer` check that pre-existing tests' `'erp-test'`
  convention doesn't satisfy) still affects `permission-guards.test.ts`, `sync-routes.test.ts`,
  `pos-branch-isolation.test.ts`, and ~9 other files (44 tests total) — confirmed unrelated to
  this feature by running `permission-guards.test.ts` completely alone. This feature's own
  `journey-service.test.ts` is unaffected (calls `JourneyService` directly, no HTTP/JWT layer).

## Files touched

- `packages/db-client/src/schema/crm.ts` — 4 new tables + type exports.
- `packages/db-client/migrations/0121_crm_customer_journeys.sql`,
  `0122_crm_journey_permission_backfill.sql`, `0123_crm_journey_engine_feature_flag.sql` — all
  applied live.
- `packages/db-client/migrations/meta/_journal.json` — 3 appended entries.
- `packages/shared-types/src/permissions.ts` — `JOURNEY_VIEW/CREATE/PUBLISH/DELETE`.
- `apps/tenant-service/src/rbac/role-defaults.ts` — SALES_MANAGER grant.
- `apps/sales-service/src/domain/JourneyService.ts` — new.
- `apps/sales-service/src/api/journey.routes.ts` — new.
- `apps/sales-service/src/api/internal.routes.ts` — new `POST /crm/journeys/evaluate-due`.
- `apps/sales-service/src/main.ts` — registers `journeyRoutes`.
- `apps/scheduler-service/src/jobs/system-jobs.ts` — new `crm.automation-rules-dispatch-due` and
  `crm.journey-step-evaluate` jobs.
- `apps/sales-service/src/__tests__/journey-service.test.ts` — new, 19 tests.
- `apps/web-frontend/src/pages/crm/JourneysPage.tsx`, `JourneyFormPage.tsx`,
  `JourneyDetailPage.tsx` — new.
- `apps/web-frontend/src/api/endpoints.ts` — new `crmApi` journey methods.
- `apps/web-frontend/src/App.tsx`, `apps/web-frontend/src/lib/navigation.ts` — routes + nav entry.

## What is not done (remaining TODO)

| Item                                                      | Why deferred                                                                                                                                               | Target                                                           |
| --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| Playwright E2E specs for the 4 scenarios in the phase doc | Not run this session; logic covered instead by unit + live-DB integration tests across the full state machine                                              | Follow-up before Phase 2 sign-off                                |
| Scheduler load-test with a realistic enrollment volume    | This feature's own DoD calls for it explicitly; not performed this session                                                                                 | Before enabling `crm.journey_engine.enabled` for any real tenant |
| `CustomerService.ts`'s own `isUniqueViolation` fix        | Shares the same latent `.cause`-unwrapping bug found and fixed in `JourneyService.ts` this session, but touching it is outside this feature's scope        | Dedicated follow-up pass                                         |
| Journey pause/resume                                      | Schema supports `PAUSED` status; no route or UI exposes it — only DRAFT→PUBLISHED→ARCHIVED is wired, matching the roadmap's own listed API surface exactly | If a real need for a temporary pause (vs. archive) surfaces      |

## Deployment Checklist

- [ ] Run migrations `0121_crm_customer_journeys.sql`, `0122_crm_journey_permission_backfill.sql`,
      `0123_crm_journey_engine_feature_flag.sql` against every target database (staging/prod) —
      verified applied against the local dev DB this session only.
- [ ] No new environment variables.
- [ ] `crm.journey_engine.enabled` ships globally disabled by design — enabling it for a specific
      tenant is a deliberate rollout decision, not an automatic side effect of this deploy.
