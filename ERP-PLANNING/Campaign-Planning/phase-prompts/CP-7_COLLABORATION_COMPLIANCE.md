Copy everything below the line into the first message of a new Claude Code session.

---

I'm starting **Phase CP-7: Collaboration & Compliance** of the Campaign Management Platform initiative.
This is phase 7 of 9. **CP-4 must be complete** — check `phase-completions/CP-4_COMPLETION.md`.

Read in this order:

1. `ERP-PLANNING/Campaign-Planning/README.md`
2. `ERP-PLANNING/Campaign-Planning/09_CAMPAIGN_LIFECYCLE_AND_WORKFLOW.md`
3. `ERP-PLANNING/Campaign-Planning/15_ROLES_PERMISSIONS_SECURITY_COMPLIANCE.md`
4. `ERP-PLANNING/Campaign-Planning/17_DATA_MODEL_AND_API_DESIGN.md` (CP-7 section)
5. `ERP-PLANNING/Campaign-Planning/20_RISK_ASSESSMENT.md` (R1, R6, R9)
6. `phase-completions/CP-4_COMPLETION.md`

## Goal for This Phase

Add approval workflow, granular permissions, collaboration (comments/history), and the compliance/consent
model.

## Scope

1. **Approval workflow**, optional per tenant, implementing the full state machine in
   `09_CAMPAIGN_LIFECYCLE_AND_WORKFLOW.md` (`DRAFT → PENDING_APPROVAL → APPROVED → SCHEDULED/RUNNING`, with
   `PAUSED`/`ARCHIVED` states from CP-5/this phase). **Editing an approved/scheduled campaign must reset
   approval status** — this is a hard rule (R6), not optional.
2. **Granular permissions**: `CRM_CAMPAIGN_APPROVE`, `CRM_CAMPAIGN_ANALYTICS_VIEW`, `CRM_AUTOMATION_MANAGE`.
   For each: verify the constant granted in role-defaults is the _exact same_ constant checked by the
   route/UI guard — this codebase has a proven recurring bug (`rbac_dead_permission_constant_pattern`) where
   these silently diverge. Write an explicit test for both the positive and negative case per permission.
3. **Comments/internal notes** on campaigns; **visible audit-history tab** surfacing CP-4's
   `campaign_history` table (who did what, when, including edit diffs).
4. **Customer preference center** + `customer_communication_preferences` (channel × category consent
   model, more granular than the existing binary `customers.opt_out_*` flags, which remain the fast-path
   enforcement gate — do not remove them).
5. Before finalizing the consent-model shape, flag to me (the user) for confirmation on the actual
   applicable regulatory requirements (India DPDP Act / TRAI) rather than assuming — this has real legal
   weight (R9).

## Rules

- Approval is opt-in per tenant; a tenant that doesn't enable it sees no behavior change from today.
- Opt-out enforcement (`customers.opt_out_sms/whatsapp/email`) remains the non-bypassable fast-path gate in
  every send path — the new preference center is additive, not a replacement.
- `apps/web-frontend/e2e/live-crm.spec.ts` must still pass, including with approval left disabled by
  default in test tenants.

## Definition of Done

See `ERP-PLANNING/Campaign-Planning/22_DEFINITION_OF_DONE_AND_RELEASE_CHECKLIST.md`.

## When Done

Generate `ERP-PLANNING/Campaign-Planning/phase-completions/CP-7_COMPLETION.md`, update status trackers, add
`campaign-approval-workflow.spec.ts`, `campaign-permissions.spec.ts`, `campaign-preference-center.spec.ts`
per `24_PLAYWRIGHT_TEST_PLAN.md`.
