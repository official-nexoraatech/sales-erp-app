Copy everything below the line into the first message of a new Claude Code session.

---

I'm starting **Phase CP-3: Segmentation & Personalization** of the Campaign Management Platform initiative.
This is phase 3 of 9. **CP-1 must be complete** (CP-3 does not depend on CP-2, so it can run in parallel
with or after CP-2 — confirm which has actually happened by checking `phase-completions/`).

Read in this order:

1. `ERP-PLANNING/Campaign-Planning/README.md`
2. `ERP-PLANNING/Campaign-Planning/00_CURRENT_STATE_ASSESSMENT.md` (section 5, segmentation)
3. `ERP-PLANNING/Campaign-Planning/11_SEGMENTATION_AND_PERSONALIZATION.md`
4. `ERP-PLANNING/Campaign-Planning/17_DATA_MODEL_AND_API_DESIGN.md` (CP-3 section)
5. `ERP-PLANNING/Campaign-Planning/19_MIGRATION_AND_BACKWARD_COMPATIBILITY.md`
6. `ERP-PLANNING/Campaign-Planning/phase-completions/CP-1_COMPLETION.md`

## Goal for This Phase

Make targeting reflect real customer behavior, and make message personalization richer and safer.

## Scope

1. **Multi-rule segment builder UI**: the backend `customer_segments.filter_definition` already supports an
   array of rules with AND/OR logic — the current UI (`SegmentFormPage.tsx`) only ever submits one rule.
   Build the UI to actually expose this existing backend capability (add/remove rules, AND/OR toggle).
2. **Expand the `FIELD_COLUMNS` whitelist** in `SegmentService.ts` per the categories in
   `11_SEGMENTATION_AND_PERSONALIZATION.md`: purchase history aggregates, preferences, loyalty tier,
   geography, store/salesperson affiliation, custom attributes (new `customer_custom_attributes` table).
   For aggregate fields (e.g. average order value), write them as safe parameterized subqueries, not string-
   concatenated SQL — check for injection risk explicitly given these are user-configurable filter values.
3. **Expand the personalization token library** in `renderCampaignMessage()` per the token table in
   `11_SEGMENTATION_AND_PERSONALIZATION.md`, and implement fail-safe fallback rendering
   (`personalization_token_fallbacks` table) plus preview-time warnings for recipients that would hit a
   fallback.
4. "Save this ad-hoc filter as a segment" flow from wherever recipient targeting happens today.

## Rules

- Do not redesign the `filter_definition` jsonb shape — extend the whitelist and the UI, keep the storage
  contract.
- New fields must have safe SQL generation — no raw string interpolation of user-supplied filter values.
- Remember the raw-SQL Date-interpolation bug pattern from this codebase's history: any date field must be
  `.toISOString()`'d before use in a raw SQL template, never passed as a raw Date object.
- `apps/web-frontend/e2e/live-crm.spec.ts` must still pass.

## Definition of Done

See `ERP-PLANNING/Campaign-Planning/22_DEFINITION_OF_DONE_AND_RELEASE_CHECKLIST.md`.

## When Done

Generate `ERP-PLANNING/Campaign-Planning/phase-completions/CP-3_COMPLETION.md`, update status trackers.
