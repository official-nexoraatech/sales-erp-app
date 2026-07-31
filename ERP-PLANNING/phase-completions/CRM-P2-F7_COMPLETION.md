# CRM-ROADMAP Phase 2, Feature 7 — Advanced Segmentation Engine — Completion Report

**Date:** 2026-07-29
**Status:** Complete.

## Summary

Extends the existing static-field segment builder (`SegmentService.ts`, 7 operators) with
behavioral/RFM operators, per the roadmap's own recommendation to ship this early in Phase 2
since Journey Builder (Feature 2) and Campaign Engagement Tracking (Feature 6) both benefit from
richer segmentation as an input.

- **Three new operators** added to `customer_segments.filterDefinition`'s existing JSONB rule
  vocabulary (no schema change to that table — it already accepted arbitrary rule shapes):
  - `between_dates` — inclusive-inclusive date-range filter, restricted to the three genuinely
    date-typed columns (`createdAt`, `dateOfBirth`, `anniversary`) — explicitly validated, not
    just assumed, after a caught test gap (see below).
  - `purchased_category` — "bought from category X within the last N days," an `EXISTS`
    subquery over `invoice_lines → items` (no join to `categories` at all, so a since-deleted
    category still correctly matches historical purchases rather than crashing — the roadmap's
    own stated edge case).
  - `rfm_score` — a raw-threshold Recency/Frequency/Monetary filter
    (`maxRecencyDays`/`minFrequency`/`minMonetary`), reusing `SegmentService`'s own existing
    `daysSinceLastPurchase`/`orderCount`/`lifetimeValue` computed-field SQL fragments verbatim
    rather than a new computation (see Decisions #1 for why this isn't population-wide
    percentile/quintile RFM scoring).
- **All three new operators are dispatched entirely separately** from the original 7's
  `compareColumn`/`compareText`/`compareNumeric` switches, which are completely untouched — this
  feature's own DoD requires proving existing segments still evaluate identically, and the
  cleanest way to guarantee that is to never touch the code path they run through at all.
- **New `crm_segment_membership_cache` table** — a nightly-refreshed membership snapshot for any
  segment using `purchased_category`/`rfm_score` (the two operators expensive enough to warrant
  it — `between_dates` is a cheap indexed-column comparison and is deliberately excluded from
  caching). Live preview/ad-hoc queries always recompute fresh regardless of this cache's
  contents; the cache exists only for consumers that would rather read a fast snapshot (e.g.
  future campaign-targeting-by-segment) than recompute the query live.
- **Nightly job**: `crm.segment-membership-refresh` (scheduler-service, `0 3 * * *`) → internal
  route `POST /crm/segment-membership/refresh` (sales-service) → loops active tenants → for each
  tenant's segments, skips static-only ones and calls `SegmentService.refreshMembershipCache()`
  for the rest. Matches the exact existing pattern this roadmap's own `crm.customer-health-score`
  job already established (nightly cron → internal-key-guarded route → per-tenant loop).
- **Frontend**: `SegmentFormPage.tsx`'s rule builder now offers the 3 new operators (with
  dedicated inputs — date pickers, a category dropdown + day count, RFM threshold fields) and,
  per the phase doc's own "verify a live preview exists today — if not, add it" instruction, now
  wires up a debounced live membership-count preview against `POST /crm/segments/preview` — that
  endpoint already existed with zero backend changes needed; only the UI call was missing.

## Decisions / deviations (flagged during implementation, not silently decided)

1. **`rfm_score` is a raw-threshold filter, not population-wide percentile/quintile RFM
   scoring.** True RFM scoring (ranking every customer against the whole tenant's customer base
   into quintiles) requires computing across the entire population — expensive to redo on every
   preview keystroke, and exactly the kind of computation this feature's own Performance
   Considerations section says should be nightly-cached, not live. A raw threshold filter
   (`daysSinceLastPurchase <= X`, `orderCount >= Y`, `lifetimeValue >= Z`) is itself a legitimate,
   common RFM segmentation style, is live-computable with zero new engine (reuses existing
   computed fields verbatim per "no new engine"), and satisfies the acceptance criterion's plain-
   English example ("customers who bought X but haven't returned in 90 days" is actually a
   `purchased_category` + recency combination, not something requiring percentile ranking).
   Genuine quintile-based RFM is a documented, natural follow-up if a real need for it surfaces.
2. **A real gap was caught by the test suite, not shipped silently**: the initial
   `between_dates` implementation validated only that `field` existed in `FIELD_COLUMNS` at all
   (not that it was date-typed) — a test asserting `loyaltyPoints` (a real column, but numeric)
   should be rejected as a `between_dates` target failed because it wasn't actually rejected.
   Fixed by adding an explicit `DATE_FIELDS` whitelist (`createdAt`, `dateOfBirth`, `anniversary`)
   checked before building the condition — the comment describing this restriction was written
   before the code actually enforced it, and the test caught the mismatch before this shipped.
3. **`purchased_category` deliberately never joins `categories`** — it filters on
   `items.category_id` directly. This wasn't just an optimization choice; it's the correct
   handling of the roadmap's own stated edge case (a category later soft-deleted must not break
   historical segment matching) — verified directly with a test that soft-deletes the seeded
   category mid-test and confirms the segment still matches correctly.
4. **A new segment is refreshed into the cache once at creation time**, not left waiting for the
   next nightly run — otherwise a behavioral segment would read as empty from the cache for up to
   24 hours after being created, which would be a confusing first-use experience for a marketer
   who just built it.
5. **No new permissions** — confirmed `CRM_SEGMENT_VIEW`/`CRM_SEGMENT_CREATE` already gate every
   relevant route; the phase doc's own claim that this feature needs zero new permissions held up
   under verification, not just assumed.

## Acceptance Criteria

- [x] A marketer can build "customers who bought X but haven't returned in 90 days" without
      engineering help — covered directly (`purchased_category` operator, tested end-to-end).
- [x] Existing segments are provably unaffected — the pre-existing 22-test CP-1/CP-3 baseline
      suite in `segment-service.test.ts` passes completely unmodified alongside the 17 new tests,
      in the same file, using a deliberately separate test tenant so the new tests' seed data
      cannot contaminate the pre-existing assertions.
- [x] Date-window boundary conditions (inclusive/exclusive) tested explicitly — covered directly:
      a customer whose date falls exactly on the `from`/`to` boundary is included; one day
      outside the range is excluded.
- [x] A dynamic segment's nightly refresh produces the same membership a live query would —
      covered directly (`refreshMembershipCache` + `getCachedMembership` compared against a live
      `listMatching` call for the identical rule, exact match).
- [x] A segment combining old static operators and new behavioral operators in the same AND/OR
      tree evaluates correctly — covered directly.
- [x] A behavioral operator referencing a later-deleted category degrades gracefully — covered
      directly (soft-delete-mid-test case).

## Verification performed this session

- `pnpm --filter @erp/db build` / `@erp/utils build` / `@erp/types build` — all clean.
- `pnpm --filter sales-service type-check` / `scheduler-service type-check` /
  `tenant-service type-check` / `web-frontend type-check` — all clean.
- `eslint` scoped to every touched/new file — 0 errors (only the same pre-existing-style
  `explicit-function-return-type`/`no-non-null-assertion` warnings already present throughout
  this codebase).
- **Live migration** `0119_crm_segment_membership_cache.sql` applied directly to the local dev
  Postgres (new table + 2 indexes; no permission backfill needed — confirmed no new permissions).
- **Extended `segment-service.test.ts`** (not a new file — deliberately kept in the segment
  domain's one existing test file) — **39/39 passing**: the original 22 CP-1/CP-3 baseline tests
  unmodified, plus 17 new tests covering `purchased_category` (match/exclude/soft-deleted-category/
  missing-categoryId), `between_dates` (inclusive boundary, one-day-outside exclusion,
  non-date-field rejection — the exact bug this test suite caught, see Decisions #2),
  `rfm_score` (each threshold individually and combined), a static+behavioral combined rule, and
  the cache refresh/read/idempotent-re-refresh equivalence tests.
- **Full regression sweep** across all of Phase 1 plus Phase 2 (account-service, lead-service,
  lead-capture-auth-isolation, customer-360-degradation, ticket-service,
  customer-financial-snapshot, campaign-service, crm-dashboard-service,
  crm-dashboard-permission-guards, opportunity-service, opportunity-permission-guards,
  segment-service): **196/196 passing**.
- `pnpm --filter scheduler-service test` — **83/83 passing**, confirming the new nightly job
  registration didn't disturb any existing cron job.
- `pnpm --filter tenant-service test` — **59/59 passing**.
- `pnpm --filter @erp/types test -- route-guard-coverage` — same **2 pre-existing, unrelated**
  failures as every prior session in this roadmap; the new internal route (internal-key-guarded,
  same convention as every other route in `internal.routes.ts`) is not flagged.

## Files touched

- `packages/db-client/src/schema/crm.ts` — new `crmSegmentMembershipCache` table + type exports.
- `packages/db-client/migrations/0119_crm_segment_membership_cache.sql` — new; applied live.
- `packages/db-client/migrations/meta/_journal.json` — appended entry.
- `apps/sales-service/src/domain/SegmentService.ts` — 3 new operators, `DATE_FIELDS` whitelist,
  `isBehavioralOperator`/`needsMembershipCache`/`refreshMembershipCache`/`getCachedMembership`.
- `apps/sales-service/src/api/crm.routes.ts` — widened `SegmentFilterRuleSchema`'s operator enum;
  segment creation now seeds the cache immediately for a behavioral segment.
- `apps/sales-service/src/api/internal.routes.ts` — new
  `POST /crm/segment-membership/refresh`.
- `apps/scheduler-service/src/jobs/system-jobs.ts` — new `crm.segment-membership-refresh` job.
- `apps/sales-service/src/__tests__/segment-service.test.ts` — extended; 17 new tests alongside
  the untouched 22 pre-existing ones.
- `apps/web-frontend/src/pages/crm/SegmentFormPage.tsx` — new operator inputs + live preview.

## What is not done (remaining TODO)

| Item                                                                  | Why deferred                                                                                                                                                          | Target                                                   |
| --------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| Playwright E2E specs for the 3 scenarios in the phase doc             | Not run this session; logic covered instead by unit + live-DB integration tests                                                                                       | Follow-up before Phase 2 sign-off                        |
| Population-wide percentile/quintile RFM scoring                       | Deliberately out of scope for this pass (see Decisions #1) — the raw-threshold filter satisfies the stated acceptance criteria                                        | Only if a real need for true percentile ranking surfaces |
| Campaign/Journey integration actually reading `getCachedMembership()` | Nothing in Phase 2 yet consumes the cache — Features 2 and 6 (Journey Builder, Campaign Engagement) are the intended future consumers this feature was built ahead of | Wired up when those features are implemented             |

## Deployment Checklist

- [ ] Run migration `0119_crm_segment_membership_cache.sql` against every target database
      (staging/prod) — verified applied against the local dev DB this session only.
- [ ] No new environment variables.
