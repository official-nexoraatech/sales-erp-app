# 24 — Playwright Test Plan

## Baseline

`apps/web-frontend/e2e/live-crm.spec.ts` already exists and covers: create segment → preview → create
campaign targeting it → preview real recipients → Send Now → confirm SENT status. This is the regression
anchor (per `19_MIGRATION_AND_BACKWARD_COMPATIBILITY.md`) — every spec below is **added alongside it**, and
this baseline spec must keep passing (with only label/selector updates as the UI evolves, never assertion
weakening) through every phase.

Follow this repo's established Playwright gotchas (`playwright_first_e2e_suite_gotchas` memory):
`vite.config.ts` vs `vitest.config.ts` precedence, CORS preflight handling, and the `{data: ...}` response
envelope wrapping this app's API uses — new specs must account for the same envelope shape.

## Suite Structure

```
apps/web-frontend/e2e/
├── live-crm.spec.ts                    (existing, unmodified in intent)
├── campaign-crud.spec.ts               (CP-4)
├── campaign-drafts.spec.ts             (CP-4)
├── campaign-templates.spec.ts          (CP-4)
├── campaign-media.spec.ts              (CP-2/CP-4)
├── campaign-scheduling.spec.ts         (CP-5)
├── campaign-automation.spec.ts         (CP-5)
├── campaign-personalization.spec.ts    (CP-3)
├── segment-builder.spec.ts             (CP-3)
├── campaign-approval-workflow.spec.ts  (CP-7)
├── campaign-permissions.spec.ts        (CP-7)
├── campaign-analytics.spec.ts          (CP-6)
├── campaign-ab-testing.spec.ts         (CP-6)
├── campaign-preference-center.spec.ts  (CP-7)
└── campaign-regression.spec.ts         (CP-9 — cross-cutting, see below)
```

## Coverage By Spec

### `campaign-crud.spec.ts` (CP-4)

- Create a campaign through the full multi-step wizard, verify it lands in `DRAFT`.
- Edit a `DRAFT` campaign (change name, channel, audience, content) and verify changes persist.
- Edit a `SCHEDULED` campaign and verify it requires re-confirmation of schedule (per `09_...` transition
  table).
- Attempt to edit a `RUNNING`/`COMPLETED` campaign and verify it's rejected (UI disables it; also verify the
  API rejects it directly, not just the UI).
- Delete/cancel flows for each valid source status; verify invalid cancel attempts are rejected.
- List page pagination with > 1 page of campaigns.

### `campaign-drafts.spec.ts` (CP-4)

- Start a campaign, fill partial content, navigate away without submitting, return, verify autosaved state.
- Verify autosave doesn't fire excessively (e.g. assert debounce via network call count over a typing burst).

### `campaign-templates.spec.ts` (CP-4)

- Create a reusable template, use it in a new campaign, verify content pre-fills correctly.
- Edit a template and verify existing campaigns that already used it are unaffected (templates are copied
  at use-time, not live-linked, unless the CP-4 implementation decides otherwise — assert whichever
  behavior is actually implemented, and update this doc to match).
- Multi-language variant selection.

### `campaign-media.spec.ts` (CP-2/CP-4)

- Upload an image/video/PDF to the asset library, attach it to a campaign.
- Attempt to attach media exceeding a channel's size/type limit and verify a clear validation error at
  review time, not a silent send failure.
- Reuse an existing asset across two different campaigns.

### `campaign-scheduling.spec.ts` (CP-5)

- Schedule a one-time campaign for a future time, verify it dispatches (using the test environment's
  accelerated/mocked clock if this repo has one, or a short real-time wait consistent with existing E2E
  patterns).
- Create a recurring campaign, verify multiple firings each produce their own trackable send record.
- Verify a campaign scheduled inside a configured quiet-hours window is deferred to the next valid window.
- Verify frequency capping: a customer targeted by two campaigns exceeding the cap receives only the
  allowed number, with the rest correctly recorded as capped/skipped (not silently dropped without a
  record).

### `campaign-automation.spec.ts` (CP-5)

- Enable the birthday automation trigger, seed a customer with today's birthday, verify a campaign/send is
  auto-generated and appears in the campaign list tagged as automated.
- Toggle a trigger off and verify it stops firing.
- Verify an automated send still respects opt-out (a customer opted out of the channel receives nothing).

### `campaign-personalization.spec.ts` (CP-3)

- Create a campaign using several personalization tokens against a segment with mixed data completeness;
  verify preview correctly flags recipients that would hit a fallback value.
- Verify sent/previewed messages render tokens correctly for a recipient with complete data.

### `segment-builder.spec.ts` (CP-3)

- Build a multi-rule segment with AND logic, verify resulting count matches expectation against known test
  data.
- Build a multi-rule segment with OR logic, verify count.
- Use a newly-added targeting field (e.g. purchase history) and verify correct matching.
- Save an ad-hoc campaign-builder filter as a reusable segment.

### `campaign-approval-workflow.spec.ts` (CP-7)

- With tenant approval enabled: create a campaign, submit for approval, verify it cannot be sent by the
  creator alone; approve as a second user with approve permission, verify it can then be scheduled/sent.
- Reject with a reason, verify the campaign returns to `DRAFT` with the reason visible.
- Edit an already-approved campaign and verify approval status resets (guards against R6 in
  `20_RISK_ASSESSMENT.md`).
- With tenant approval disabled: verify the original direct-send behavior is unchanged (regression check
  against `19_MIGRATION_AND_BACKWARD_COMPATIBILITY.md`).

### `campaign-permissions.spec.ts` (CP-7)

- For each new granular permission, verify both positive (holder can act) and negative (non-holder is
  rejected — assert via direct API call, not just hidden UI) cases.
- Verify store/salesperson-scoped users cannot target or view customers outside their scope.

### `campaign-analytics.spec.ts` (CP-6)

- Simulate a delivery webhook (valid signature) and verify the campaign's delivered count updates.
- Simulate a replayed/duplicate webhook and verify no double-count.
- Simulate an invalid-signature webhook and verify it's rejected.
- Verify the analytics dashboard funnel renders sent/delivered/opened/clicked correctly for seeded data.
- Verify cross-campaign comparison view filters correctly by channel/type/date range.

### `campaign-ab-testing.spec.ts` (CP-6)

- Create an A/B test campaign with 2 variants, verify audience split matches configured percentages
  (statistically, over a large enough seeded audience).
- Verify the reported winner matches the seeded success-metric data.

### `campaign-preference-center.spec.ts` (CP-7)

- Customer-facing (or admin-on-behalf-of-customer, depending on CP-7's actual UI decision) preference
  update: change channel/category preference, verify subsequent campaign targeting respects it immediately.
- Verify every channel's outbound message includes a working unsubscribe mechanism, and that using it
  updates the preference record.

### `campaign-regression.spec.ts` (CP-9)

- Re-runs the critical assertions from every spec above in a single consolidated smoke pass, plus:
- Full lifecycle walk: `DRAFT → PENDING_APPROVAL → APPROVED → SCHEDULED → RUNNING → COMPLETED → ARCHIVED`
  in one test, asserting each transition.
- Cross-module check: an opted-out customer created via the Customers module is correctly excluded from a
  campaign created via the Campaigns module (verifies the two modules' shared opt-out data stays
  consistent).
- Cross-browser matrix run (per this repo's existing Playwright browser config) and mobile-viewport run for
  the builder wizard and analytics dashboard.

## Non-Functional Checks Embedded in the Suite

- Accessibility: run axe-core assertions (consistent with existing ERP a11y-testing convention) on the
  wizard, segment builder, template library, media library, analytics dashboard, and preference center as
  part of their respective specs, not as a separate afterthought suite.
- Performance smoke check: assert the recipient-count/preview call in the builder responds within the
  `NFR-01` budget during CI runs, catching regressions early rather than only at CP-9's dedicated load test.

## Maintenance Note

As each phase ships, add its spec file to this suite in that same phase (per `22_DEFINITION_OF_DONE_AND
_RELEASE_CHECKLIST.md`'s "tests written alongside code" rule) — CP-9 is where the full suite is run
together and hardened, not where it's written from scratch.
