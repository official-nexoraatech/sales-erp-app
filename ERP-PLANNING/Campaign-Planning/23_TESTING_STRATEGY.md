# 23 — Testing Strategy (Final Phase Focus)

This is the strategy CP-9 executes in full, but per `22_DEFINITION_OF_DONE_AND_RELEASE_CHECKLIST.md`, each
phase already ships its own subset of this — CP-9 is a comprehensive regression and hardening pass, not the
first time any of this runs.

## Test Pyramid for This Module

```
        ┌─────────────────────────┐
        │   Playwright E2E (24)    │  ← full user journeys, real backend, per 24_PLAYWRIGHT_TEST_PLAN.md
        ├─────────────────────────┤
        │   Integration tests      │  ← route + service + DB, per-phase
        ├─────────────────────────┤
        │   Component tests        │  ← wizard steps, segment builder, template picker
        ├─────────────────────────┤
        │   Unit tests              │  ← CampaignService, SegmentService, channel adapters, token renderer
        └─────────────────────────┘
```

## 1. Unit Testing

- `CampaignService`: recipient resolution (segment vs. explicit list, opt-out filtering, frequency capping
  once CP-5 ships), status transition guards (per `09_CAMPAIGN_LIFECYCLE_AND_WORKFLOW.md`'s transition
  table — every illegal transition must be rejected, every legal one allowed), message rendering
  (token substitution + fallback behavior).
- `SegmentService`: rule evaluation for every operator × every whitelisted field, AND/OR logic combinations,
  prebuilt segment SQL correctness.
- Channel adapters (CP-2): each adapter's `send`/`parseDeliveryWebhook`/`validateMedia` in isolation, with
  the provider HTTP call mocked — verifies the adapter contract, not the third-party API itself.
- Automation trigger evaluation (CP-5): each trigger's condition logic in isolation.
- Analytics rollup logic (CP-6): webhook event → recipient status → campaign aggregate, including
  idempotency (redelivered webhook doesn't double-count).

## 2. Component Testing

- Multi-step campaign builder: each step's validation, autosave behavior, step navigation guards (can't
  proceed past an invalid step).
- Segment rule builder: adding/removing rules, AND/OR toggle, live count debounce.
- Template picker, media picker: selection state, preview rendering.
- Analytics dashboard components: funnel chart, comparison table — rendered with mock data.

## 3. Integration Testing

- Each new/changed API endpoint against a real (test) database: request validation (Zod), permission
  enforcement (authorized vs. unauthorized actor), audit log write, response shape.
- End-to-end recipient fan-out through the CP-5 queue/worker (not mocked) — verify a campaign with N
  recipients ends with N `campaign_recipients` rows in the correct terminal states.
- Webhook receivers (CP-6): valid signature accepted and processed idempotently; invalid signature rejected;
  replayed webhook doesn't double-count.
- Automation triggers (CP-5): simulate the triggering event (e.g. advance a customer's birthday date in
  test data) and verify a campaign is created and sent through the same path as a manual campaign.

## 4. End-to-End (E2E) Testing

See `24_PLAYWRIGHT_TEST_PLAN.md` for the concrete suite. Principle: extend `live-crm.spec.ts`'s pattern of
driving the real backend (not mocked), not replace it.

## 5. Regression Testing

- The full existing test suite (unit + integration + E2E) from _before_ this initiative started must still
  pass after every phase — this is the CP-1 baseline established specifically to make regression checking
  possible.
- Cross-module regression: verify campaigns/segments still integrate correctly with Customers (opt-out
  flags), Sales (purchase-history-derived targeting fields), and Notification-service (all 4 original
  channels) after every phase that touches shared code.

## 6. Performance Testing

- Load-test recipient fan-out at the volume assumptions in `18_PERFORMANCE_AND_SCALABILITY.md` (~10,000
  recipients) — measure end-to-end completion time and confirm no HTTP timeout risk remains post-CP-5.
  Reuse this ERP's existing load-test approach/tooling if one exists (see the PG-055 load-test fix in
  memory) rather than introducing a new tool.
- Segment query performance with the expanded field whitelist (CP-3) at realistic customer-table sizes.
- Webhook receiver throughput (CP-6) under burst delivery-status callbacks.

## 7. Accessibility Testing

- axe-core scan on every new/changed page (builder wizard, template library, media library, analytics
  dashboard, preference center), matching the bar already established elsewhere in the ERP
  (`playwright_first_e2e_suite_gotchas`, `erp_ui_redesign_docset_2026_07_07`).

## 8. Cross-Browser & Responsive Testing

- Builder wizard and analytics dashboard verified on the ERP's existing supported-browser matrix, at mobile/
  tablet/desktop breakpoints — rich-media previews (Email HTML, WhatsApp media) specifically checked on
  mobile, since this module has never had rich media before.

## 9. Security Validation

- Webhook signature verification (CP-6) explicitly tested with valid, invalid, and replayed payloads.
- Media upload validation (CP-2) tested with oversized files, wrong MIME types, and files exceeding
  per-channel limits — server-side rejection confirmed even when client-side validation is bypassed.
- Permission boundary testing (see #10 below) doubles as a security check for privilege escalation.

## 10. Permission & Role Testing

- For every permission in `15_ROLES_PERMISSIONS_SECURITY_COMPLIANCE.md`, test both the positive case
  (holder can perform the action) and negative case (non-holder is rejected server-side, not just hidden in
  UI) — explicitly guards against the R1 dead-permission-constant recurrence.
- Store/salesperson-scoped restriction (`US-05`) tested to confirm a scoped user cannot target/see customers
  outside their scope even via direct API calls, not just via the UI.

## 11. Error Handling & Recovery Testing

- Partial send failure (some recipients fail mid-campaign): confirm campaign lands in a resumable state,
  not silently reported as fully successful.
- Provider misconfiguration (missing credentials): confirm the pre-send warning (per `20_RISK_ASSESSMENT.md`
  R2) actually surfaces, not just a buried per-recipient error.
- Webhook delivery failure/retry from the provider side: confirm idempotent reprocessing doesn't corrupt
  analytics.
- Automation trigger misfire (e.g. a trigger condition that matches zero customers): confirm it's a no-op,
  not an error state.

## Test Data & Environment Notes

- This is a dev-phase project (per `project_dev_phase_no_data.md` memory) — free to use realistic synthetic
  test data and reset schemas as needed; re-confirm this assumption before CP-9 if production data/tenants
  exist by then.
- Reuse `ERP-PLANNING/TEST_CREDENTIALS.md` test users/tenants rather than creating new ones per phase.
