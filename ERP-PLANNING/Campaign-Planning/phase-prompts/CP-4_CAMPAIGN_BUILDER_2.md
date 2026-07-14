Copy everything below the line into the first message of a new Claude Code session.

---

I'm starting **Phase CP-4: Campaign Builder 2.0** of the Campaign Management Platform initiative. This is
phase 4 of 9. **CP-2 and CP-3 must both be complete** — check `phase-completions/CP-2_COMPLETION.md` and
`CP-3_COMPLETION.md`; if either is missing, stop and tell me.

Read in this order:

1. `ERP-PLANNING/Campaign-Planning/README.md`
2. `ERP-PLANNING/Campaign-Planning/04_FUNCTIONAL_REQUIREMENTS.md` (sections A, D)
3. `ERP-PLANNING/Campaign-Planning/08_UX_UI_AND_INFORMATION_ARCHITECTURE.md`
4. `ERP-PLANNING/Campaign-Planning/09_CAMPAIGN_LIFECYCLE_AND_WORKFLOW.md`
5. `ERP-PLANNING/Campaign-Planning/17_DATA_MODEL_AND_API_DESIGN.md` (CP-4 section)
6. `ERP-PLANNING/Campaign-Planning/19_MIGRATION_AND_BACKWARD_COMPATIBILITY.md`
7. `phase-completions/CP-1_COMPLETION.md`, `CP-2_COMPLETION.md`, `CP-3_COMPLETION.md`

## Goal for This Phase

Turn the create-only single-form campaign builder into an editable, multi-step, template-driven authoring
experience.

## Scope

1. **Campaign editing** while `DRAFT`/`SCHEDULED`, version-checked against `campaigns.version` (optimistic
   locking, plumbed in CP-1). Editing an `APPROVED`/`SCHEDULED` campaign should reset it to `DRAFT` — but
   full approval-state handling ships in CP-7; for now, just ensure editing is safe and auditable.
2. **Draft autosave** (debounced).
3. **Multi-step wizard**: Type & Channel → Audience → Content → Personalization → Schedule → Review, per
   `08_UX_UI_AND_INFORMATION_ARCHITECTURE.md`. Reuse the existing "Preview Recipients" pattern inside the
   Review step rather than building a new preview mechanism.
4. **`campaign_templates`** table + UI (named, reusable, versioned, category-tagged, multi-language content
   variants).
5. **Campaign type taxonomy** (tenant-configurable `campaign_type` field + seeded default list for
   Clothing, per `04_FUNCTIONAL_REQUIREMENTS.md` section A).
6. **Media picker** wired into the Content step, consuming CP-2's asset library.
7. **`campaign_history`** table + basic logging (full audit UI ships in CP-7, but start writing history
   entries now since editing is what first generates them).
8. **List pagination** on the Campaigns page.

## Rules

- No existing endpoint's request/response shape breaks — new fields are additive.
- `apps/web-frontend/e2e/live-crm.spec.ts` must still pass (update only labels/selectors if the UI genuinely
  changed, never weaken assertions).
- Follow this ERP's existing create-record UX standardization pattern already shipped elsewhere
  (page-based, not modal-based, per the `erp_create_record_ux_standardization` precedent) rather than
  inventing a new UI pattern for the wizard.
- Every new frontend surface must be accessible (axe-core clean) and dark-mode compatible, consistent with
  the rest of the redesigned ERP UI.

## Definition of Done

See `ERP-PLANNING/Campaign-Planning/22_DEFINITION_OF_DONE_AND_RELEASE_CHECKLIST.md`.

## When Done

Generate `ERP-PLANNING/Campaign-Planning/phase-completions/CP-4_COMPLETION.md`, update status trackers, and
add the new Playwright specs (`campaign-crud.spec.ts`, `campaign-drafts.spec.ts`, `campaign-templates.spec.ts`,
`campaign-media.spec.ts`) per `24_PLAYWRIGHT_TEST_PLAN.md`.
