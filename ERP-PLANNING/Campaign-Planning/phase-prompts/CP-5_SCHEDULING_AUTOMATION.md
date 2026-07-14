Copy everything below the line into the first message of a new Claude Code session.

---

I'm starting **Phase CP-5: Scheduling & Automation** of the Campaign Management Platform initiative. This is
phase 5 of 9. **CP-4 must be complete** — check `phase-completions/CP-4_COMPLETION.md`.

Read in this order:

1. `ERP-PLANNING/Campaign-Planning/README.md`
2. `ERP-PLANNING/Campaign-Planning/00_CURRENT_STATE_ASSESSMENT.md` (send flow + scheduling sections)
3. `ERP-PLANNING/Campaign-Planning/13_AUTOMATION_AND_SCHEDULING.md`
4. `ERP-PLANNING/Campaign-Planning/09_CAMPAIGN_LIFECYCLE_AND_WORKFLOW.md`
5. `ERP-PLANNING/Campaign-Planning/17_DATA_MODEL_AND_API_DESIGN.md` (CP-5 section)
6. `ERP-PLANNING/Campaign-Planning/18_PERFORMANCE_AND_SCALABILITY.md`
7. `ERP-PLANNING/Campaign-Planning/20_RISK_ASSESSMENT.md` (R4, R5, R10, R11)
8. `phase-completions/CP-4_COMPLETION.md`

## Goal for This Phase

Replace in-request/poll-based dispatch with a real background worker, and add recurring campaigns + a
trigger-based automation engine on top of it.

## Scope

1. **Queue-based dispatch**: move recipient fan-out from the in-request `Promise.all` batches-of-25 in
   `CampaignService.send()` to a background worker/queue. Support pause/resume. Reuse whatever background-
   job mechanism this ERP already uses elsewhere (check `apps/scheduler-service` and `apps/event-service`
   for existing patterns, e.g. the DLQ concept, before introducing new queue infrastructure).
2. **Recurring campaigns**: `recurrence_rule`, `parent_recurring_campaign_id` — each firing creates its own
   trackable send record.
3. **Timezone-aware scheduling + business-hours/send-window enforcement**
   (`tenant_communication_settings`).
4. **Frequency capping** enforced inside the single shared `resolveRecipients()` path (not a parallel
   check) — must apply identically to manual, scheduled, recurring, and automated sends.
5. **Automation engine** (`campaign_automation_rules`): implement the 9 triggers listed in
   `13_AUTOMATION_AND_SCHEDULING.md` section "Triggers In Scope". Fold the existing special-cased birthday-
   greeting route (`POST /crm/birthday-greetings/send` in `internal.routes.ts`) into this engine per the
   migration plan in `19_MIGRATION_AND_BACKWARD_COMPATIBILITY.md` — keep the old route working until the
   new trigger is verified equivalent, then deprecate it in a clearly separate follow-up step, not silently.

## Rules

- Any raw SQL touching a Date object must `.toISOString()` first — this exact bug class has recurred before
  in this codebase (scheduler-service, sales-service CRM segments).
- Watch for cross-tenant fair-queueing (don't let one tenant's large campaign starve another's).
- `apps/web-frontend/e2e/live-crm.spec.ts` must still pass.
- Confirm the abandoned-cart trigger's actual source event by checking how this ERP models in-progress
  orders (quotations vs. literal cart) before implementing — don't assume a cart entity exists.

## Definition of Done

See `ERP-PLANNING/Campaign-Planning/22_DEFINITION_OF_DONE_AND_RELEASE_CHECKLIST.md`.

## When Done

Generate `ERP-PLANNING/Campaign-Planning/phase-completions/CP-5_COMPLETION.md`, update status trackers, add
`campaign-scheduling.spec.ts` and `campaign-automation.spec.ts` per `24_PLAYWRIGHT_TEST_PLAN.md`.
