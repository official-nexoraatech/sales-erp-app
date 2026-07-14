Copy everything below the line into the first message of a new Claude Code session.

---

I'm starting **Phase CP-8: Enterprise Scale-out** of the Campaign Management Platform initiative. This is
phase 8 of 9. **CP-6 and CP-7 must both be complete** — check `phase-completions/CP-6_COMPLETION.md` and
`CP-7_COMPLETION.md`.

Read in this order:

1. `ERP-PLANNING/Campaign-Planning/README.md`
2. `ERP-PLANNING/Campaign-Planning/04_FUNCTIONAL_REQUIREMENTS.md` (section M)
3. `ERP-PLANNING/Campaign-Planning/10_OMNICHANNEL_REQUIREMENTS.md` (channel rollout table)
4. `ERP-PLANNING/Campaign-Planning/16_INTEGRATION_REQUIREMENTS.md`
5. `ERP-PLANNING/Campaign-Planning/17_DATA_MODEL_AND_API_DESIGN.md` (CP-8 section)
6. `ERP-PLANNING/Campaign-Planning/18_PERFORMANCE_AND_SCALABILITY.md`
7. `phase-completions/CP-6_COMPLETION.md`, `CP-7_COMPLETION.md`

## Goal for This Phase

Make the platform multi-store/multi-brand ready and open to third-party integration; add channel adapters
by actual demand.

## Scope

1. **Store/branch-scoped campaigns and reporting** (`campaigns.branch_id`), respecting the store/
   salesperson-scoped targeting and permission restrictions already built in CP-3/CP-7.
2. **Configurable sender identity per tenant/channel** (`tenant_sender_identity`).
3. **Outbound webhook subscriptions** for third-party marketing/CRM tools, firing on campaign lifecycle
   events (sent, completed, failed).
4. **Additional channel adapters**, prioritized by actual tenant demand at this point in the project (check
   with me before building all of Telegram/Messenger/Web Push/QR — build what's actually wanted, per
   `10_OMNICHANNEL_REQUIREMENTS.md`'s rollout table, rather than building every listed adapter
   speculatively).
5. **Only if CP-1–CP-7 usage data shows it's actually needed**: segment-membership caching or table
   partitioning per `18_PERFORMANCE_AND_SCALABILITY.md` — do not build this speculatively; confirm the need
   with real numbers first.

## Rules

- Every new table/query is `tenant_id`-scoped, no exceptions.
- Outbound webhooks only expose data the receiving tenant is entitled to see.
- Don't build a channel adapter nobody has asked for yet — confirm actual priority with me first, per this
  initiative's explicit anti-scope-creep principle (R7 in `20_RISK_ASSESSMENT.md`).
- `apps/web-frontend/e2e/live-crm.spec.ts` must still pass.

## Definition of Done

See `ERP-PLANNING/Campaign-Planning/22_DEFINITION_OF_DONE_AND_RELEASE_CHECKLIST.md`.

## When Done

Generate `ERP-PLANNING/Campaign-Planning/phase-completions/CP-8_COMPLETION.md`, update status trackers.
