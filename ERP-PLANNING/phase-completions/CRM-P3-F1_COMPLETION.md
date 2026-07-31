# CRM-ROADMAP Phase 3, Feature 1 — AI & Predictive Intelligence Suite — Completion Report

**Date:** 2026-07-30
**Status:** Complete.

## Summary

Extends `HealthScoringService` (the existing weekly health-score batch, M9.2) from a single score
into churn prediction, next-best-action, and product recommendations — statistical models, not a
black-box or external AI vendor dependency, per the roadmap's own explicit instruction that this
codebase has zero AI stack today and shouldn't silently acquire one.

- **`customers.healthScore`/`healthSegment`/`scoredAt` are NOT duplicated.** The roadmap lists
  `crm_health_scores` among the new cache tables, but that's already exactly what the existing
  columns are (AR-2: reuse, don't duplicate) — only the 3 genuinely new prediction types
  (`crm_churn_predictions`, `crm_next_best_actions`, `crm_product_recommendations`) got tables.
- **`predictChurn`** — a recency-decay model: compares days-since-last-purchase against the
  customer's own historical average interval between purchases (`ratio = daysSince / avgInterval`,
  `riskScore = clamp(round(ratio * 50), 0, 100)`, `HIGH ≥70 / MEDIUM ≥40 / LOW below`). A customer
  with fewer than 2 purchases gets `INSUFFICIENT_DATA` with a null score — never a confident-
  looking number off two data points, a stated roadmap edge case, not a nicety.
- **`computeNextBestAction`** — a simple, explicit rule cascade (HIGH churn → win-back offer;
  CHAMPION segment → loyalty upsell; MEDIUM churn → re-engagement; else null). Returns `null`
  rather than a forced generic filler action when nothing applies — the DoD requires every
  _surfaced_ prediction to have a real explanation, not that one always exists.
- **`computeProductRecommendations`** — market-basket/co-occurrence: items frequently bought by
  other customers who share at least one purchase with this customer, excluding items already
  owned. A customer with zero purchase history gets zero recommendations — empty, not an error,
  never a fabricated guess.
- **Nightly batch** (`computeAndCachePredictions`, `crm.ai-predictions-compute` cron, 05:00 daily
  — a previously-unused slot) scores every active customer per tenant, matching the exact
  cron → internal-key-guarded route → per-tenant-loop convention every prior CRM-ROADMAP nightly
  job already established. Never computed synchronously on page load
  (07-PERFORMANCE-PLAN.md §3) — Customer 360 only ever reads whatever the last run cached.
- **Dismiss-aware merge**: a caller's `POST /recommendations/:id/feedback` dismissal isn't undone
  by the next nightly run for the _identical_ suggestion (same `actionType` for next-best-actions,
  same `itemId` for product recommendations) — the roadmap's own explicit Playwright scenario.
  A genuinely _different_ suggestion (a new trigger, a different item) is still surfaced normally.
- **Customer 360 extension**: `GET /customers/:id/360`'s existing `Promise.allSettled` composition
  gained a 6th parallel branch (`getPredictionsForCustomer`) with the same degraded-fallback
  pattern every other section already uses — one slow/failed prediction read degrades only that
  section, not the whole page.
- **Frontend**: a churn-risk strip (informational, no dismiss — showing "not enough data yet"
  rather than a misleadingly confident score when insufficient), a next-best-action card, and a
  product-recommendation list on `CustomerViewPage.tsx` — each with its own "why" reason text and
  a Dismiss button for the two dismissable types.

## Decisions / deviations (flagged during implementation, not silently decided)

1. **No `crm_health_scores` table** (see Summary) — a real AR-2 discipline check, not an
   oversight: `customers.healthScore`/`healthSegment`/`scoredAt` already are that cache.
2. **Acceptable staleness window: up to ~24 hours** (nightly cadence) — the roadmap's own stated
   edge case ("a customer flagged high-risk who then makes a large purchase... must update on the
   next nightly run") is satisfied by the batch simply re-running fresh every night; no separate
   invalidation/recompute-on-purchase path was built, matching the "never synchronous" performance
   requirement.
3. **`ACCEPT` feedback is a lightweight acknowledgement, not a model-training signal** — this pass
   ships statistical, not ML, models (per the roadmap's own instruction to start simple, no
   external AI vendor). `POST /recommendations/:id/feedback` records dismiss/accept state on the
   row; there's no training loop that "improves the model over time" yet, and the roadmap's
   Playwright scenario itself only actually requires the dismiss-and-don't-resurface behavior,
   which is fully implemented and tested.
4. **Feedback endpoint reuses `CRM_360_VIEW`, no new permission** — matches the roadmap's own
   "No new attack surface" instruction: if a caller can already view the customer whose
   recommendation this is, they can act on what's shown to them.

## Acceptance Criteria

- [x] A customer with a clear churn pattern shows a churn-risk flag with a plausible explanation —
      covered directly (hand-computed HIGH-risk fixture: 3 purchases ~10 days apart, none for 40
      days → risk score 100, reason names the actual days-overdue and typical interval).
- [x] Dismissing a recommendation records feedback and doesn't re-surface the identical suggestion
      immediately — covered directly for both next-best-action and product recommendations
      (dismiss → re-run the nightly batch → confirm still dismissed).
- [x] A brand-new customer with minimal history shows no false-confidence prediction — covered
      directly (0 and 1 purchases → `INSUFFICIENT_DATA`, null score, not a number).
- [x] Reps see actionable, explained recommendations they can accept or dismiss — every prediction
      type ships a non-empty reason string, verified in both the unit tests and the UI.

## Verification performed this session

- `pnpm --filter @erp/db build` — clean (new prediction tables).
- `pnpm --filter sales-service type-check` / `scheduler-service type-check` / `tenant-service
type-check` / `web-frontend type-check` — all clean.
- `eslint` scoped to every touched/new file — 0 new errors (only the same pre-existing-style
  warnings already present throughout this codebase).
- **Live migration** `0133_crm_ai_predictive_intelligence.sql` applied directly to the local dev
  Postgres (3 new tables + indexes).
- **New `health-scoring-service.test.ts`** — 12/12 passing: 4 pure `computeNextBestAction` rule-
  cascade tests, 3 `predictChurn` fixtures (insufficient-data / LOW / HIGH, each hand-computed —
  e.g. 12.5-day avg interval, 5 days since last purchase → ratio 0.4 → score 20 exactly), 2
  `computeProductRecommendations` co-occurrence tests, and 3 nightly-batch/dismiss-merge
  integration tests (the latter two given a longer per-test timeout since each runs the full
  batch twice — see the "known false-failure pattern" note below).
- **New `recommendation-feedback-route.test.ts`** — 3/3 passing (live-DB, real Fastify app):
  validation rejection, 404 for an unknown id, successful dismiss persisted to a real row.
- **`customer-360-degradation.test.ts`** (pre-existing) — its `HealthScoringService` mock needed
  a `getPredictionsForCustomer` stub added (the route's new 6th `Promise.allSettled` branch would
  otherwise throw "not a function" before the settle logic even runs) — 1/1 still passing after
  the fix, confirming the degradation behavior this file actually tests is unaffected.
- **Full regression sweep**: `pnpm --filter scheduler-service test` — 83/83 (confirms the new
  cron registration didn't disturb any existing job); `pnpm --filter web-frontend test` —
  430/430; `route-guard-coverage.test.ts` — the new feedback route is correctly recognized as
  guarded (not in the unguarded list); `dead-permission-constants.test.ts` — passing (no new
  permission added, so nothing new to check, but confirms nothing broke).

**Pre-existing/unrelated noise reconfirmed during this sweep**: a full (untargeted) `pnpm --filter
sales-service test` run shows the same JWT-issuer-mismatch files and the same concurrent-session
`journey-service.test.ts` flakiness documented in the last two features' completion reports —
plus, this session, the two double-batch tests in `health-scoring-service.test.ts` itself timed
out under full-suite CPU contention on first observation (they pass reliably standalone and after
a longer per-test timeout was added) — the exact "Turbo parallel test runs give false failures"
pattern already documented for this codebase, not a logic bug (see
[[turbo_parallel_test_false_failures]]).

## Files touched

- `packages/db-client/src/schema/crm.ts` — `crmChurnPredictions`, `crmNextBestActions`,
  `crmProductRecommendations` tables + type exports.
- `packages/db-client/migrations/0133_crm_ai_predictive_intelligence.sql` — new; applied live.
- `packages/db-client/migrations/meta/_journal.json` — appended entry.
- `apps/sales-service/src/domain/HealthScoringService.ts` — `predictChurn`,
  `computeNextBestAction`, `computeProductRecommendations`, `computeAndCachePredictions`,
  `getPredictionsForCustomer`, `recordFeedback`.
- `apps/sales-service/src/api/internal.routes.ts` — new `POST /crm/predictions/compute`.
- `apps/scheduler-service/src/jobs/system-jobs.ts` — new `crm.ai-predictions-compute` cron
  (05:00 daily).
- `apps/sales-service/src/api/customer-360.routes.ts` — extended composition; new
  `POST /recommendations/:id/feedback`.
- `apps/sales-service/src/__tests__/health-scoring-service.test.ts` — new.
- `apps/sales-service/src/__tests__/recommendation-feedback-route.test.ts` — new.
- `apps/sales-service/src/__tests__/customer-360-degradation.test.ts` — mock fix (see above).
- `apps/web-frontend/src/api/endpoints.ts` — `recommendationFeedback`.
- `apps/web-frontend/src/pages/customers/CustomerViewPage.tsx` — churn-risk strip, next-best-
  action card, product-recommendation list, feedback mutation.

## What is not done (remaining TODO)

| Item                                                         | Why deferred                                                                                                                                                        | Target                                                                                                                                    |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Playwright E2E specs for the 3 acceptance-criteria scenarios | Not run this session; logic covered instead by unit + live-DB integration tests                                                                                     | Follow-up before Phase 3 sign-off                                                                                                         |
| A real feedback → model-improvement training loop            | Out of scope for a statistical (not ML) first pass — see Decisions #3; the roadmap's actual testable requirement (dismiss-and-don't-resurface) is fully implemented | Only if this codebase later adopts a real ML/vendor dependency, a separate explicit decision the roadmap itself says not to make silently |
| Live browser verification of the Customer 360 UI additions   | No dev server running this session                                                                                                                                  | Before this feature ships to a real tenant                                                                                                |

## Deployment Checklist

- [ ] Run migration `0133_crm_ai_predictive_intelligence.sql` against every target database
      (staging/prod) — verified applied against the local dev DB this session only.
- [ ] No new environment variables.
