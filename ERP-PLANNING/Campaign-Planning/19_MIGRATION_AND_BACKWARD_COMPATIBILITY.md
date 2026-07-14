# 19 — Migration & Backward Compatibility Plan

## Compatibility Contract

1. **No existing column is renamed or dropped.** Every schema change across all 9 phases is additive
   (nullable new columns, new tables) — verified against `17_DATA_MODEL_AND_API_DESIGN.md` per phase.
2. **No existing endpoint's request/response shape breaks.** `POST /crm/campaigns`, `GET /crm/campaigns`,
   `POST /crm/campaigns/preview`, `POST /crm/campaigns/:id/send`, `POST /crm/campaigns/:id/schedule`,
   `POST /crm/campaigns/:id/cancel`, `GET /crm/campaigns/:id/stats`, `GET /crm/campaigns/:id/recipients`,
   and the equivalent segment endpoints all keep working exactly as today. New fields are additive to
   responses (old clients ignore fields they don't know about); new request fields are optional with
   sensible defaults matching today's behavior.
3. **No existing status value is removed.** `DRAFT`/`SCHEDULED`/`SENDING`/`SENT`/`CANCELLED`/`FAILED` keep
   meaning what they mean today. New lifecycle states (`PENDING_APPROVAL`, `APPROVED`, `PAUSED`, `ARCHIVED`)
   are additive; if `RUNNING`/`COMPLETED` become the UI-facing labels for `SENDING`/`SENT` (per
   `09_CAMPAIGN_LIFECYCLE_AND_WORKFLOW.md`), the underlying stored values and any code checking them by
   string must be updated together, in one phase, with the existing E2E test (`live-crm.spec.ts`) re-run to
   confirm no regression.
4. **The existing E2E test is the regression gate.** `apps/web-frontend/e2e/live-crm.spec.ts` must pass,
   unmodified in intent (its assertions may need updates only if UI labels change, never if underlying
   behavior changes), at the end of every phase. `24_PLAYWRIGHT_TEST_PLAN.md` extends it; it is never
   replaced wholesale.
5. **Tenants that opt out of new features see no behavior change.** Approval workflow (CP-7), business-hours
   enforcement (CP-5), and frequency capping (CP-5) are all tenant-configurable and default to today's
   behavior (no approval required, no quiet hours, no cap) unless a tenant explicitly turns them on.

## Data Migration Notes

- New tables (media assets, templates, automation rules, analytics events, comments, preferences) start
  empty — no backfill needed since the current module has no data of these kinds to migrate.
- The one genuine migration-with-data concern: if `SENDING`/`SENT` values are ever renamed to `RUNNING`/
  `COMPLETED` at the storage level (rather than kept as internal values with new UI labels), existing rows
  must be migrated in the same transaction as the schema change, and every place in the codebase that
  string-matches the old values (grep for `'SENDING'`/`'SENT'` across `apps/sales-service`,
  `apps/web-frontend`, and `apps/scheduler-service` before making this change) must be updated together —
  do this as a single, well-tested CP-4/CP-7 sub-task, not incrementally.
- The birthday-greeting special case (`POST /crm/birthday-greetings/send`, outside `CampaignService` today)
  is folded into the unified automation engine in CP-5. Until CP-5 ships, the existing route keeps working
  unchanged — it is deprecated (marked as legacy in code comments, not removed) only once the automation
  engine's birthday trigger is verified to produce equivalent behavior, then removed in a follow-up cleanup
  step with its own test verification, not silently.

## Rollback Considerations

- Every phase should be deployable independently and rollback-able independently — a phase should not leave
  the schema in a state where reverting the phase's code (but not its migration) breaks production. Prefer
  expand-then-contract: add new nullable columns/tables in one deploy, start using them in a subsequent
  deploy, only ever remove/deprecate old paths in a third, separate step once the new path is verified in
  production.

## What This Means For Phase Prompts

Every `phase-prompts/CP-N_*.md` file explicitly instructs: "verify the existing `live-crm.spec.ts` E2E test
still passes before considering this phase done," and "do not rename/remove any existing column, endpoint,
or status value — additive only, per `19_MIGRATION_AND_BACKWARD_COMPATIBILITY.md`."
