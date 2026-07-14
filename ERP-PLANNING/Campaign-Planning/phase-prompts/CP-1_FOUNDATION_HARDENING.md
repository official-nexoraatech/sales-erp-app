Copy everything below the line into the first message of a new Claude Code session.

---

I'm starting **Phase CP-1: Foundation Hardening** of the Campaign Management Platform initiative. This is
phase 1 of 9 (see `ERP-PLANNING/Campaign-Planning/21_IMPLEMENTATION_ROADMAP.md`).

Before doing anything, read in this order:

1. `ERP-PLANNING/Campaign-Planning/README.md`
2. `ERP-PLANNING/Campaign-Planning/00_CURRENT_STATE_ASSESSMENT.md`
3. `ERP-PLANNING/Campaign-Planning/02_GAP_ANALYSIS.md`
4. `ERP-PLANNING/Campaign-Planning/17_DATA_MODEL_AND_API_DESIGN.md` (CP-1 section)
5. `ERP-PLANNING/Campaign-Planning/19_MIGRATION_AND_BACKWARD_COMPATIBILITY.md`
6. `ERP-PLANNING/Campaign-Planning/20_RISK_ASSESSMENT.md`
7. `ERP-PLANNING/CODING_STANDARDS.md` and `ERP-PLANNING/ERP_MASTER_SPEC.md` (this ERP's general architecture
   rules — this initiative extends them, doesn't override them)
8. Any prior file in `ERP-PLANNING/Campaign-Planning/phase-completions/` (none should exist yet for CP-1).

## Goal for This Phase

Make the existing Campaign engine (`apps/sales-service/src/domain/CampaignService.ts` and
`SegmentService.ts`) safe to extend in later phases, without changing its user-visible behavior at all.

## Scope

1. Add explicit DB FK constraints: `campaigns.segment_id → customer_segments.id`,
   `campaign_recipients.notification_log_id → notification_log.id` (currently informal references — verify
   current data has no orphans before adding the constraint; this is a dev-phase project with no real data
   per project memory, so this should be low-risk, but check current state first).
2. Start using `campaigns.version` for optimistic locking on any update path that exists today (there isn't
   an edit endpoint yet — this is plumbing for CP-4, so this task may be limited to confirming the column
   is read correctly wherever campaigns are updated today, e.g. status transitions in `send()`/`schedule()`/
   `cancel()`).
3. Write unit tests for `CampaignService` and `SegmentService`'s **current** behavior — recipient
   resolution (segment vs explicit list, opt-out filtering per channel), status transition guards, message
   rendering/token substitution, prebuilt segment SQL, custom segment rule evaluation. This is the
   regression baseline every later phase is measured against — be thorough, since gaps here become blind
   spots for the rest of the initiative.
4. Confirm `apps/web-frontend/e2e/live-crm.spec.ts` passes and document what it currently covers (and, by
   implication, what it doesn't) in your completion report.

## Rules

- No behavior change. This phase is purely hardening + test coverage + safe schema tightening.
- Do not touch the frontend.
- Do not start any CP-2 work (channel abstraction) even if it looks related.
- Follow `19_MIGRATION_AND_BACKWARD_COMPATIBILITY.md`'s additive-only migration rules.

## Definition of Done

See `ERP-PLANNING/Campaign-Planning/22_DEFINITION_OF_DONE_AND_RELEASE_CHECKLIST.md` (per-phase section).

## When Done

Generate `ERP-PLANNING/Campaign-Planning/phase-completions/CP-1_COMPLETION.md` using
`ERP-PLANNING/PHASE_COMPLETION_TEMPLATE.md` as the format, and update the status tracker in
`ERP-PLANNING/Campaign-Planning/README.md` and `21_IMPLEMENTATION_ROADMAP.md`.
