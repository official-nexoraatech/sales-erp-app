// CP-7 (Campaign Management Platform initiative): campaign-preference-center.spec.ts is listed
// in the CP-7 phase prompt and 24_PLAYWRIGHT_TEST_PLAN.md deliverables.
//
// Scope decision (documented in the CP-7 completion report): the customer_communication_
// preferences table (channel × category consent model) was added this phase via migration 0056,
// but no API routes or UI were built on top of it. This mirrors the established pattern of
// deliberately deferring a self-contained sub-feature rather than half-building it (see e.g.
// CP-6's deferral of A/B testing/engagement tracking, NH-08's deferred asset library).
//
// The phase prompt also asked, before finalizing the consent-model shape, to flag the actual
// applicable regulatory requirements (India DPDP Act / TRAI) to the user rather than assume them
// — that confirmation has not happened yet (see the completion report), so building a
// customer-facing preference UI on top of a schema that may still need to change based on that
// legal review would risk churn. The existing binary customers.opt_out_sms/whatsapp/email flags
// remain the enforced, non-bypassable fast-path gate in every send path — nothing about consent
// enforcement regresses by deferring this UI.
//
// This file is intentionally skipped rather than omitted, so the CP-7 deliverable list and test
// run output both show the deferral explicitly instead of it going unnoticed.
import { test } from '@playwright/test';

test.skip(
  true,
  'customer_communication_preferences has no API/UI yet — backend-only this phase, see CP-7 completion report section "What Is Not Done"'
);

test('customer-facing preference center: update a channel/category preference and verify it is respected by subsequent campaign targeting', () => {
  // Intentionally unimplemented — see the module-level skip reason above.
});

test('every channel outbound message includes a working unsubscribe mechanism that updates the preference record', () => {
  // Intentionally unimplemented — see the module-level skip reason above.
});
