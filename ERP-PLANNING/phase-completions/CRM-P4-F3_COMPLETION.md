# CRM-ROADMAP Phase 4, Feature 3 — Festival Intelligence AI — Completion Report

**Date:** 2026-07-30
**Status:** Complete, tested against a real local Postgres, zero regressions in every touched
service's full test suite.

## Summary

AI-suggested campaign timing and stock/loyalty multipliers ahead of a season, extending the
existing `businessSeasons` entity (`crm.ts:879-905`) rather than requiring manual season
creation from scratch each year. Statistical, not ML/vendor — same discipline as Phase 3's
`HealthScoringService`: a nightly job compares last year's same-`seasonType` season window's
invoice volume against the 30 days immediately before it, and proposes next year's multipliers/
dates from that ratio. Never auto-applied — a suggestion only becomes a real `businessSeasons`
row when a merchandiser (mapped to the `SALES_MANAGER` role — see RBAC fix below) explicitly
approves it.

### Backend

- **Schema** (migration `0140_crm_festival_suggestions.sql`): `crm_festival_suggestions` —
  `status: 'PENDING'|'APPROVED'|'REJECTED'|'INSUFFICIENT_DATA'`, all suggested-value columns
  nullable (null exactly when `status = 'INSUFFICIENT_DATA'`, same "a number next to 'not enough
  data' implies false confidence" reasoning as `crmChurnPredictions.riskScore`), unique on
  `(tenantId, seasonType, suggestedYear)`.
- **`FestivalIntelligenceService`** (new): `computeAndCacheSuggestions` — for each of the 4
  `seasonType` values, finds the most recent _completed_ prior season of that type; if none
  exists, **writes no row at all** (nothing to suggest against yet — a different case from "ran
  one but it didn't have enough orders," which does write an `INSUFFICIENT_DATA` row, mirroring
  `HealthScoringService`'s own distinction between "no purchases" and "too few purchases").
  Below `MIN_PRIOR_SEASON_ORDERS` (5) orders in the season window → `INSUFFICIENT_DATA` with a
  specific reason string. Otherwise computes:
  - `suggestedStockMultiplier` = season-window avg daily revenue ÷ the preceding-30-days
    baseline avg daily revenue, clamped to `[1, 5]` so a near-zero baseline can't produce an
    absurd ratio.
  - `suggestedLoyaltyMultiplier` = a straight carry-forward of last year's _actual configured_
    multiplier — the most directly defensible "prior-year based" signal, deliberately not a
    second derived statistic that could be wrong in its own new way.
  - `suggestedStartDate`/`suggestedEndDate` = last year's dates shifted forward exactly 1 year
    (a documented, simple limitation — see below).
  - **Never overwrites a suggestion a merchandiser already reviewed** (`APPROVED`/`REJECTED`) —
    same "don't silently resurface/recompute over a human decision" discipline as the
    dismiss-aware merge in `HealthScoringService.computeAndCachePredictions`.
    `approve(...)` creates the real `businessSeasons` row (accepting merchandiser overrides for
    any suggested value — the roadmap's own "reviewed and approved... not auto-applied"
    requirement means the suggestion is a starting point, not a mandate) and links it back via
    `createdSeasonId`. `reject(...)` just marks the suggestion reviewed.
- **Nightly cron precedent mirrored exactly** (3 layers, same as Phase 3's AI suite):
  `POST /crm/festival-suggestions/compute` (internal route, `requireInternalKey`, loops active
  tenants), `crm.festival-suggestions-compute` cron (`0 6 * * *`, `system-jobs.ts`, wrapped in
  try/catch, never throws), fetch-and-log wiring identical to `crm.ai-predictions-compute`'s
  own shape. Deliberately kept genuinely nightly rather than inventing a "seasonal" cadence — the
  compute logic itself is a cheap no-op for most tenants on most nights (no completed prior
  season to compare against), so a special cadence would be unrequested scheduling complexity.
- **Routes** (added to the existing `crm.routes.ts`, alongside season CRUD):
  `GET /crm/festival-suggestions` (`CRM_SEASON_VIEW`), `POST /crm/festival-suggestions/:id/
approve` and `/reject` (`CRM_SEASON_MANAGE`) — reusing the existing season permissions rather
  than inventing `CRM_SEASON_APPROVE`, since approving a suggestion is conceptually a season
  mutation.
- **A real, pre-existing RBAC gap found and fixed** (migration `0141_crm_season_rbac_gap_fix
.sql` + `role-defaults.ts`): `CRM_SEASON_VIEW`/`CRM_SEASON_MANAGE` were never granted to any
  named role — only reachable via OWNER/ADMIN/SUPER_ADMIN's `TENANT_SCOPED_PERMISSIONS`
  wildcard (already flagged as a known gap in
  `ERP-PLANNING/production-readiness-audit-2026-07-25/05-crm.md`). This directly blocked this
  feature's own acceptance criteria — "merchandisers get useful suggestions" needs a non-OWNER
  role able to view/approve them at all, and this system has no dedicated "merchandiser" role.
  `SALES_MANAGER` was granted both permissions (existing tenants backfilled, new tenants via
  `role-defaults.ts`), matching the reasoning it already owns every other CRM Sales Ops action.

### Frontend

New "Suggested Seasons" panel added to the existing `SeasonsPage.tsx`, above the active-season
banner: shows every `PENDING` suggestion with its reason/basis text, suggested dates and
multipliers, a season-name input, and Approve/Reject buttons. No new page — this is the first
"review and approve a system-generated numeric suggestion" UI in the app (the Phase 3 AI suite
only ever had a Dismiss action, never Accept-with-adjustment).

## Decisions (flagged, not silently decided)

1. **Suggested dates are simply "last year's dates + 1 year," with no lunar/festival-calendar
   awareness.** Diwali and other lunar festivals shift date by ~10-11 days each Gregorian year;
   this feature does not model that. A merchandiser reviewing the suggestion can freely adjust
   the dates before approving — this is a starting point, not an authoritative calendar, and
   building real festival-calendar logic would be a much larger, separate undertaking than this
   pass's actual requirement.
2. **Loyalty multiplier is a carry-forward, not a second computed ratio** — deliberately simpler
   and more directly defensible than deriving it statistically the way the stock multiplier is.
3. **No new `CRM_SEASON_APPROVE` permission** — reused `CRM_SEASON_MANAGE`, since approving a
   suggestion is conceptually the same action class as any other season mutation.

## Testing performed this session

- `pnpm --filter @erp/types build` / `@erp/db build` — clean.
- `pnpm --filter @erp/sales-service type-check` / `@erp/scheduler-service type-check` /
  `@erp/web-frontend type-check` — all clean.
- Both migrations live-applied directly to the local dev Postgres (same `db:migrate`-is-broken
  caveat as every other feature shipped this session).
- **New tests, all passing**: `festival-intelligence-service.test.ts` (7 tests) — no-prior-season
  writes nothing, thin-data produces `INSUFFICIENT_DATA` with the correct reason string,
  a real season-vs-baseline computation produces a sensible clamped multiplier and correctly
  carries forward last year's loyalty multiplier, a reviewed (rejected) suggestion is never
  silently recomputed back to `PENDING` on the next run, `approve()` creates a real season row
  and links back to it, `approve()` rejects a non-`PENDING` suggestion and an unknown id.
- **Full regression sweep** (run sequentially, one suite at a time, per the lesson from earlier
  this session — see [[turbo_parallel_test_false_failures]]): `sales-service` (549/550 — the one
  remaining failure is the same already-known, pre-existing, unrelated loyalty-tier-demotion
  bug), `tenant-service` (53/53), `scheduler-service` (83/83, including `system-jobs.test.ts`
  unaffected by the new cron registration).
- `route-guard-coverage.test.ts` / `dead-permission-constants.test.ts` — the new festival routes
  fully covered via the existing `requirePermission(` guard marker; only the same 2 pre-existing,
  unrelated failures already flagged in the Portal feature's completion report remain.
- `pnpm --filter @erp/sales-service lint` / `@erp/web-frontend lint` / `@erp/scheduler-service
lint` — all at their pre-existing error-count baseline (2, 16, 1 respectively); the 1
  scheduler-service error is in an untouched file (`scheduler.routes.ts`).

## What is not done (remaining TODO)

| Item                                           | Why deferred                                                        | Target                                    |
| ---------------------------------------------- | ------------------------------------------------------------------- | ----------------------------------------- |
| Lunar/festival-calendar-aware date suggestions | Genuinely separate, much larger scope than this pass                | Follow-up, if real business need surfaces |
| Playwright E2E coverage                        | Not run this session                                                | Follow-up                                 |
| A dedicated "merchandiser" role                | This system has no such role; SALES_MANAGER used as the closest fit | Only if org-structure needs it            |

## Deployment Checklist

- [ ] Apply migrations `0140_crm_festival_suggestions.sql` and `0141_crm_season_rbac_gap_fix.sql`
      to every real tenant's database — same `db:migrate`-is-broken caveat as every other
      feature shipped this session; apply the SQL files directly if the migrate CLI still
      doesn't work by then.
