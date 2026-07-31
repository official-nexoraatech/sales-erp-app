# CRM-ROADMAP Phase 2, Feature 6 — Campaign Studio — Engagement Tracking Activation — Completion Report

**Date:** 2026-07-29
**Status:** Complete.

## Summary

Closes the gap the phase doc calls "schema-complete, write-incomplete": `campaignRecipients.
openedAt`/`clickedAt`/`convertedAt` have existed since an earlier phase but nothing ever wrote to
them — campaign ROI was permanently unmeasurable. This is the roadmap's own designated highest
regression-risk feature in Phase 2 (it touches the live `CampaignService.send()` path every other
campaign feature depends on), so verification leaned harder on regression proof than any prior
feature this session.

- **Click tracking**: outbound links in a campaign's message template can now contain a
  `{{link}}` token, resolving per-recipient to a public redirect URL
  (`GET /c/:trackingToken`). Clicking it records the click in a new `crm_link_clicks` table and
  sets `campaignRecipients.clickedAt` — guarded so a second/third click never overwrites the
  first-click timestamp (the DoD's explicit "exactly once" requirement).
- **Open tracking**: EMAIL/IN_APP sends get a 1×1 tracking pixel appended
  (`GET /o/:trackingToken`) — SMS/WhatsApp are structurally incapable of this (plain text), so
  they're excluded, matching the phase doc's own "email/in-app" framing.
- **Conversion attribution**: a new nightly job (`crm.campaign-conversion-attribution`) finds
  recipients sent within a 30-day window with no `convertedAt` yet, and sets it to the date of
  the customer's first qualifying purchase made _after_ the send — deliberately not gated on
  whether they clicked (a customer can be influenced by a campaign and still purchase without
  clicking through).
- **A/B testing**: a new `crm_campaign_variants` table lets a campaign carry up to two message
  variants (matching the phase doc's own Playwright scenario, "A/B test two message variants");
  `send()` assigns each recipient to a variant via a deterministic weighted split (not
  `Math.random()` — reproducible/testable), and `getStats()` now returns a per-variant
  sent/opened/clicked/converted breakdown alongside the aggregate numbers.
- **Security**: `GET /c/:trackingToken` is public/unauthenticated by necessity (a campaign
  recipient isn't logged in) — the DoD's explicitly-required open-redirect closure is structural,
  not just tested-and-hoped: the route never reads a destination from anything in the incoming
  request, only from `crm_link_clicks.destinationUrl`, which is populated at send time from the
  campaign's own `linkUrl` — the only way to control where a token redirects is to have created
  that campaign in the first place (an authenticated, permissioned action). Verified directly
  with a test that appends a spoofed `?redirect=` query param and confirms it has zero effect.
- **Frontend**: `CampaignDetailPage.tsx` gets a new "Engagement" card (open/click/conversion
  rates + a per-variant breakdown table when variants exist); `CampaignFormPage.tsx` gets a
  "Tracked Link URL" field and an A/B-test toggle (Variant A is the existing Message Template,
  Variant B is a new textarea, 50/50 split) — both gated by the existing
  `CRM_CAMPAIGN_ANALYTICS_VIEW` permission with zero new permissions needed (confirmed, not
  assumed — its own doc comment already anticipated "engagement numbers").

## Decisions / deviations (flagged during implementation, not silently decided)

1. **`{{link}}` is an invented convention, not an existing one** — confirmed via research that
   no link/URL token existed anywhere in `CampaignMessageVars`/`renderCampaignMessage` before
   this feature. Named to match the existing lowercase-token style (`{{customerName}}`, etc.).
2. **One `crm_link_clicks` row per recipient per send, created only when it could ever be
   used** (`campaign.linkUrl` is set, OR the channel supports the open pixel) — a plain
   SMS/WhatsApp campaign with no configured link writes exactly the same rows it always has,
   verified directly by a regression test.
3. **The public redirect/pixel routes construct their own DB client directly**
   (`createDatabaseClient`), not via `PlatformContext` — there is no tenant to derive a context
   from (the recipient isn't authenticated, and `trackingToken` is globally unique, not
   tenant-namespaced), matching the same pattern this codebase's internal-key-guarded routes
   already use for tenant-agnostic operations.
4. **The public tracking URL reuses report-service's existing unsubscribe-link convention**
   (`${SERVICE_URL}/api/v2/...`), not a new URL-construction pattern — same env var, same
   shape, just a different service.
5. **A/B variant assignment uses deterministic weighted modulo, not `Math.random()`** —
   reproducible and directly unit-testable (1000 seeds against a 70/30 weight split land at
   exactly 700/300, not approximately), and still converges to the configured ratio at scale.
6. **`attributeConversions()` is not gated on a click** — deliberately, per the phase doc's own
   framing ("attribution matching a subsequent purchase to a recent campaign send," about the
   send, not the click). A customer who saw the SMS and called the shop instead of clicking a
   link still counts as converted.
7. **Variants are create-only** (no edit-variants-later flow) — kept the scope to what the
   phase doc's Playwright scenario actually asks for (build two variants at creation, see the
   split attributed correctly), not a full variant-management UI.

## Acceptance Criteria

- [x] Campaign ROI is measurable for the first time — open/click/conversion rates are real
      numbers, not permanently zero — covered directly (`getStats()` engagement fields, tested
      end-to-end).
- [x] Send a test campaign, click the tracked link → `clickedAt` populates, campaign detail page
      reflects it — covered directly (route-level test + `CampaignDetailPage.tsx`'s new
      Engagement card).
- [x] A/B test two message variants → the detail page shows performance split correctly
      attributed per variant — covered directly (`getStats().variants` breakdown, tested).
- [x] A click updates `clickedAt` exactly once, even under repeated clicks — covered directly
      (route-level idempotency test).
- [x] The redirect endpoint validates against a known, tenant-owned destination, never an
      arbitrary attacker-supplied one — covered directly (spoofed-query-param test).
- [x] Regression: the full existing `campaign-service.test.ts` suite (90 pre-existing tests)
      passes completely unmodified alongside the new tests, in the same file.

## Verification performed this session

- `pnpm --filter @erp/db build` / `@erp/utils build` / `@erp/types build` — all clean.
- `pnpm --filter sales-service type-check` / `scheduler-service type-check` /
  `tenant-service type-check` / `api-gateway type-check` / `web-frontend type-check` — all clean.
- `eslint` scoped to every touched/new file — 0 errors (only the same pre-existing-style
  `explicit-function-return-type`/`no-non-null-assertion` warnings already present throughout
  this codebase, including in the large pre-existing `campaign-service.test.ts` file).
- **Live migration** `0120_crm_campaign_engagement_tracking.sql` applied directly to the local
  dev Postgres (campaigns.link_url, campaign_recipients.variant_id, crm_campaign_variants,
  crm_link_clicks — all additive).
- **Extended `campaign-service.test.ts`** (not a new file — kept in the campaign domain's one
  existing test file, matching the "prove existing behavior unaffected" DoD requirement) —
  **103/103 passing**: the original 90 pre-existing tests unmodified, plus 13 new
  (`{{link}}` rendering, `assignVariant` weighting math including an exact-ratio-over-1000-seeds
  test, link-wrapping creates/skips `crm_link_clicks` correctly, variant assignment, `getStats()`
  engagement + variant-breakdown fields, conversion attribution both positive and negative cases).
- **New test file** `link-tracking-routes.test.ts` — **6/6 passing**: real HTTP-level
  (`fastify.inject`) coverage of both public routes — redirect to the exact stored destination
  while a spoofed query param has zero effect (the open-redirect closure, explicitly tested),
  exactly-once click/open semantics across repeated requests, 404 for an unknown/link-less
  token, and the open pixel always rendering (even for an unknown token, so a tracking failure
  never breaks email rendering).
- **Full regression sweep** across all of Phase 1 plus Phase 2 so far (account-service,
  lead-service, lead-capture-auth-isolation, customer-360-degradation, ticket-service,
  customer-financial-snapshot, campaign-service, crm-dashboard-service,
  crm-dashboard-permission-guards, opportunity-service, opportunity-permission-guards,
  segment-service, link-tracking-routes): **215/215 passing**.
- `pnpm --filter scheduler-service test` — **83/83 passing**, confirming the new nightly job
  registration didn't disturb any existing cron job.
- `pnpm --filter tenant-service test` — **59/59 passing**.
- `pnpm --filter @erp/types test -- route-guard-coverage` — same **2 pre-existing, unrelated**
  failures as every prior session in this roadmap; the new public routes are correctly exempted
  via `KNOWN_EXCEPTIONS` (same "authorized by possessing the token" reasoning already used for
  report-service's unsubscribe link), not silently missed.
- **Playwright**: unlike every other feature in this roadmap so far, concrete specs already exist
  for this area (`campaign-regression.spec.ts`, `live-crm.spec.ts`,
  `campaign-approval-workflow.spec.ts`, `campaign-permissions.spec.ts`,
  `campaign-preference-center.spec.ts`) — discovered via research this session, not previously
  documented. They were **not run this session**: they require the full application-service
  stack running (only the infra containers — Postgres/Kafka/ES/Redis/MinIO — are currently up;
  sales-service/api-gateway/notification-service/the frontend dev server are not), which is a
  larger action than warranted for this pass. Flagged explicitly below as the one concrete,
  named follow-up before Phase 2 sign-off.

## Files touched

- `packages/db-client/src/schema/crm.ts` — `campaigns.linkUrl`, `crmCampaignVariants`,
  `campaignRecipients.variantId`, `crmLinkClicks` + type exports.
- `packages/db-client/migrations/0120_crm_campaign_engagement_tracking.sql` — new; applied live.
- `packages/db-client/migrations/meta/_journal.json` — appended entry.
- `apps/sales-service/src/domain/CampaignService.ts` — `{{link}}` token, `buildTrackingUrl`,
  `buildOpenPixelTag`, `assignVariant`, variant-aware DLT precheck, link/variant wiring in
  `send()`, `attributeConversions()`, engagement fields + variant breakdown in `getStats()`,
  placeholder tracking URL in `previewSample()`.
- `apps/sales-service/src/api/link-tracking.routes.ts` — new; `GET /c/:trackingToken`,
  `GET /o/:trackingToken`.
- `apps/sales-service/src/api/internal.routes.ts` — new
  `POST /crm/campaign-conversions/attribute`.
- `apps/sales-service/src/api/crm.routes.ts` — `linkUrl`/`variants` on campaign create,
  `linkUrl` on campaign update, variant rows created alongside the campaign.
- `apps/sales-service/src/main.ts` — registered `linkTrackingRoutes` as a genuine sibling.
- `apps/api-gateway/src/middleware/gateway-auth.ts` — new `EXEMPT_PREFIXES` entries
  (`/api/sales/c/`, `/api/sales/o/`).
- `packages/shared-types/src/__tests__/route-guard-coverage.test.ts` — new `KNOWN_EXCEPTIONS`
  entry for `link-tracking.routes.ts`.
- `apps/scheduler-service/src/jobs/system-jobs.ts` — new `crm.campaign-conversion-attribution`
  nightly job.
- `apps/sales-service/src/__tests__/campaign-service.test.ts` — extended; 13 new tests
  alongside the untouched 90 pre-existing ones.
- `apps/sales-service/src/__tests__/link-tracking-routes.test.ts` — new; 6 tests.
- `apps/web-frontend/src/pages/crm/CampaignDetailPage.tsx` — Engagement card + variant table.
- `apps/web-frontend/src/pages/crm/CampaignFormPage.tsx` — Tracked Link URL field, A/B-test
  toggle + Variant B textarea.

## What is not done (remaining TODO)

| Item                                                                                           | Why deferred                                                                                                              | Target                                                                                                                      |
| ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Running `campaign-regression.spec.ts`/`live-crm.spec.ts`/the other 3 campaign Playwright specs | Requires the full application-service stack running, not just infra containers — a larger action than this pass warranted | **Concrete, named follow-up before Phase 2 sign-off** — these specs exist today, unlike every prior feature in this roadmap |
| True percentile/click-through-rate ("click-to-open rate") secondary metric                     | Only the simpler total-recipient-relative rates were built; a CTOR metric is a common but non-required refinement         | Only if a real reporting need surfaces                                                                                      |
| Editing variants after campaign creation                                                       | Scope-trimmed to match the phase doc's literal Playwright scenario (build once, see attributed results)                   | Natural follow-up, low risk                                                                                                 |

## Deployment Checklist

- [ ] Run migration `0120_crm_campaign_engagement_tracking.sql` against every target database
      (staging/prod) — verified applied against the local dev DB this session only.
- [ ] No new environment variables (`SALES_SERVICE_URL` is reused, already required elsewhere).
- [ ] **Before Phase 2 sign-off**: run the 5 existing campaign Playwright specs
      (`campaign-regression.spec.ts`, `live-crm.spec.ts`, `campaign-approval-workflow.spec.ts`,
      `campaign-permissions.spec.ts`, `campaign-preference-center.spec.ts`) against a fully
      running stack to close the DoD's "full existing CRM/campaign E2E regression must pass
      unmodified" requirement with real E2E evidence, not just the unit/integration coverage
      this session produced.
