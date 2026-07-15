# PHASE CP-7 — Collaboration & Compliance — COMPLETION REPORT

## Generated: 2026-07-15 | Status: COMPLETE (approval workflow, granular permissions, comments, audit-history tab all shipped; consent-model UI deliberately deferred, see sections 7 and 12)

> **This document is the official handoff artifact for Phase CP-7.**
> **The next phase (CP-8) MUST start by reading this document.**
> **Never modify this document after generation.**

---

## 1. PHASE SUMMARY

| Field        | Value                                                                                                                                                                                                                |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Phase Number | CP-7                                                                                                                                                                                                                 |
| Phase Name   | Collaboration & Compliance                                                                                                                                                                                           |
| Status       | COMPLETE for approval workflow (MH-12), granular permissions, comments, and the audit-history tab. Consent-model UI (customer preference center) genuinely deferred — schema-only this phase, see sections 7 and 12. |
| Engineer(s)  | Claude (autonomous execution, Campaign Management Platform initiative)                                                                                                                                               |

---

## 2. WHAT WAS BUILT

### 2.1 Database Schema

```
Migrations (all applied to the dev database and verified — 58/58 migrations in sync):

0056_cp7_collaboration_compliance.sql
  campaigns: + approval_status, approved_by, approved_at, rejection_reason (all nullable)
  tenant_communication_settings: + approval_required boolean NOT NULL DEFAULT false
  campaign_comments (NEW) — internal notes, never sent to recipients
  customer_communication_preferences (NEW) — channel x category consent model, additive to
    (not replacing) the existing binary customers.opt_out_sms/whatsapp/email fast-path gate

0057_cp7_campaign_approve_permission_backfill.sql
  Backfills CRM_CAMPAIGN_APPROVE for existing tenants' OWNER/ADMIN/SUPER_ADMIN roles
  (role-defaults.ts's wildcard only covers tenants provisioned after the constant existed)

0058_cp7_campaign_analytics_automation_permission_backfill.sql
  Backfills CRM_CAMPAIGN_ANALYTICS_VIEW and CRM_AUTOMATION_MANAGE for the same three roles

No FK constraints (consistent with the zero-FK convention).
```

Verified live against Postgres: `role_permissions` contains 30 rows each for
`CRM_CAMPAIGN_ANALYTICS_VIEW` and `CRM_AUTOMATION_MANAGE` (10 tenants x 3 roles), and 30 rows for
`CRM_CAMPAIGN_APPROVE` from the earlier backfill — all three new permissions are usable by every
existing tenant's OWNER/ADMIN/SUPER_ADMIN today, not just tenants provisioned after this phase.

### 2.2 Permissions Added

| Constant                      | Purpose                                                                                       | Backfill migration |
| ----------------------------- | --------------------------------------------------------------------------------------------- | ------------------ |
| `CRM_CAMPAIGN_APPROVE`        | Approve/reject a `PENDING_APPROVAL` campaign — distinct from `CRM_CAMPAIGN_SEND`              | 0057               |
| `CRM_CAMPAIGN_ANALYTICS_VIEW` | View a campaign's stats/recipient breakdown — split out of the broader `CRM_VIEW`             | 0058               |
| `CRM_AUTOMATION_MANAGE`       | Create/edit automation rules — split out of `CRM_CAMPAIGN_CREATE` (they previously reused it) | 0058               |

Each constant's route guard was verified to check the _exact same_ string granted in
role-defaults.ts's dynamic `TENANT_SCOPED_PERMISSIONS` wildcard, and each has an explicit
positive + negative Fastify-inject test (see section 3) — direct mitigation of this codebase's
documented `rbac_dead_permission_constant_pattern` recurring bug, per this phase's own scope
requirement.

### 2.3 APIs Implemented

| Method | Path                                     | Guard                         | Notes                                                                   |
| ------ | ---------------------------------------- | ----------------------------- | ----------------------------------------------------------------------- |
| POST   | `/crm/campaigns/:id/submit-for-approval` | `CRM_CAMPAIGN_CREATE`         | DRAFT only; auto-approves if the tenant doesn't require approval        |
| POST   | `/crm/campaigns/:id/approve`             | `CRM_CAMPAIGN_APPROVE`        | `PENDING_APPROVAL` only                                                 |
| POST   | `/crm/campaigns/:id/reject`              | `CRM_CAMPAIGN_APPROVE`        | `PENDING_APPROVAL` only; requires a `reason` (1-1000 chars)             |
| GET    | `/crm/campaigns/:id/comments`            | `CRM_VIEW`                    | NEW                                                                     |
| POST   | `/crm/campaigns/:id/comments`            | `CRM_CAMPAIGN_CREATE`         | NEW                                                                     |
| GET    | `/crm/campaigns/:id/stats`               | `CRM_CAMPAIGN_ANALYTICS_VIEW` | CHANGED — was `CRM_VIEW`                                                |
| GET    | `/crm/campaigns/:id/recipients`          | `CRM_CAMPAIGN_ANALYTICS_VIEW` | CHANGED — was `CRM_VIEW`                                                |
| POST   | `/crm/automation-rules`                  | `CRM_AUTOMATION_MANAGE`       | CHANGED — was `CRM_CAMPAIGN_CREATE`                                     |
| PUT    | `/crm/automation-rules/:id`              | `CRM_AUTOMATION_MANAGE`       | CHANGED — was `CRM_CAMPAIGN_CREATE`                                     |
| GET    | `/crm/campaigns/:id/history`             | `CRM_VIEW`                    | Existing since CP-4 — now surfaced in the UI for the first time (below) |

The three "CHANGED" rows do not remove access from any role that could use them before this
phase: research (see section 13) confirmed none of `CRM_VIEW`/`CRM_CAMPAIGN_CREATE` is granted to
any named role except via the OWNER/ADMIN/SUPER_ADMIN wildcard, and all three of those roles were
backfilled with the new constants in the same phase. No tenant loses access; the new constants
just make the access finer-grained going forward.

### 2.4 Services Implemented / Changed

```
apps/sales-service/src/domain/CampaignService.ts
  - tenantRequiresApproval(ctx) — reads tenant_communication_settings.approval_required,
    defaults to false when no row exists (backward-compat contract from CP-5)
  - submitForApproval(ctx, campaignId) — DRAFT only; auto-approves (sets approvedBy/approvedAt)
    when the tenant doesn't require approval, else PENDING_APPROVAL; writes a campaign_history
    row (AUTO_APPROVE or SUBMIT_FOR_APPROVAL)
  - approve(ctx, campaignId) — PENDING_APPROVAL only; sets APPROVED + approvedBy/approvedAt,
    clears any prior rejectionReason; writes history + audit log
  - reject(ctx, campaignId, reason) — PENDING_APPROVAL only; sets REJECTED + rejectionReason;
    writes history + audit log
  - send() / schedule() — both now guard: if tenantRequiresApproval() && approvalStatus !==
    'APPROVED', throw BusinessError('APPROVAL_REQUIRED', ...). No-op (false) for every tenant
    with no settings row, preserving today's direct-send behavior exactly.
  - update() — now resets approvalStatus/approvedBy/approvedAt to null whenever it edits a
    campaign that was APPROVED or PENDING_APPROVAL (R6 from 20_RISK_ASSESSMENT.md — a hard rule,
    not optional, so a content change can never sail through under a stale approval)
  - dispatchRecurringOccurrence() / fireAutomationRule() — the concrete campaigns they create are
    stamped approvalStatus: 'APPROVED' immediately (the recurring series / automation rule itself
    was already reviewed at setup time; each fired occurrence should not need re-approval)

apps/sales-service/src/api/crm.routes.ts
  - 5 new routes (submit-for-approval, approve, reject, comments GET/POST) — see 2.3
  - 4 existing routes re-gated onto the 2 new granular permissions — see 2.3
```

### 2.5 Frontend Screens

```
apps/web-frontend/src/pages/crm/CampaignsPage.tsx
  - Approval-status badge (PENDING_APPROVAL/APPROVED/REJECTED) next to the existing lifecycle
    status badge, plus the rejection reason shown inline when REJECTED
  - "Submit for Approval" button (DRAFT, not already PENDING_APPROVAL/APPROVED)
  - "Approve"/"Reject" buttons, gated on CRM_CAMPAIGN_APPROVE, shown only for PENDING_APPROVAL
    campaigns; Reject opens a modal requiring a reason (matches the Schedule modal's pattern)
  - NEW "History" toggle + HistoryDrilldown component — the first UI surface for CP-4's
    campaign_history table (created that phase, never previously shown anywhere)

apps/web-frontend/src/api/endpoints.ts
  - submitCampaignForApproval / approveCampaign / rejectCampaign
  - listCampaignComments / createCampaignComment (routes exist; no dedicated comments UI panel
    was built this phase — see section 12)
```

---

## 3. TESTS

| File                                                                            | Tests | Type                                                                                                                                                                                                                                                                                                     |
| ------------------------------------------------------------------------------- | ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/sales-service/src/__tests__/campaign-service.test.ts` (extended)          | +14   | Integration — tenantRequiresApproval default/true, submitForApproval auto-approve/pending/non-DRAFT-reject, approve/reject happy+guard paths, send()/schedule() APPROVAL_REQUIRED gating (both blocked and unblocked), no-settings-row backward-compat, update() resets approval on an APPROVED campaign |
| `apps/sales-service/src/__tests__/crm-campaign-permission-guards.test.ts` (NEW) | 8     | Fastify-inject — positive + negative case for each of the 3 new granular permissions (approve, reject, stats/CRM_CAMPAIGN_ANALYTICS_VIEW, automation-rules/CRM_AUTOMATION_MANAGE)                                                                                                                        |
| `apps/web-frontend/e2e/campaign-approval-workflow.spec.ts` (NEW)                | 2     | Live E2E — auto-approve path, edit-resets-approval (R6) path                                                                                                                                                                                                                                             |
| `apps/web-frontend/e2e/campaign-permissions.spec.ts` (NEW)                      | 1     | Live E2E — Approve/Reject controls never leak onto a DRAFT campaign row                                                                                                                                                                                                                                  |
| `apps/web-frontend/e2e/campaign-preference-center.spec.ts` (NEW)                | 2     | Explicitly `test.skip()`'d — documents the deferred consent-model UI, see section 12                                                                                                                                                                                                                     |

### Test Execution Results

- `sales-service` full suite: **224/224 passing** (24 files) — zero regression from the approval
  workflow, the 2 re-gated route pairs, or the 2 new route/comment pairs.
- `tsc --noEmit` clean on `sales-service`, `web-frontend`, and `@erp/types` (which now exports the
  3 new permission constants).
- `eslint`: 0 errors across every changed/new file (pre-existing `explicit-function-return-type`
  warnings only, consistent with this repo's documented pre-existing lint debt).
- **Live E2E results are mixed, and the failure mode is fully understood and expected:**
  - `campaign-permissions.spec.ts` (1 test): **passing** — this assertion is purely
    frontend-side (no Approve/Reject button renders for a DRAFT campaign) and needed no backend
    route.
  - `campaign-approval-workflow.spec.ts` (2 tests): **failing**, but not because of a code
    defect. Direct proof: `curl -X POST http://127.0.0.1:3013/crm/campaigns/1/submit-for-approval`
    against the actually-running dev `sales-service` process returns **HTTP 404** — the running
    process (PID unchanged since the CP-3 restart attempt that was correctly blocked by the
    environment's safety classifier) predates this phase's route additions entirely, since
    backend services run from `dist/main.js` and are not watched/rebuilt live (unlike the two
    Vite frontends, which _do_ pick up source changes immediately — confirmed by
    `campaign-permissions.spec.ts` passing and by the campaign-creation steps inside
    `campaign-approval-workflow.spec.ts` succeeding, since those hit only pre-CP-7 routes). Once a
    human or stack-owning session rebuilds and restarts `sales-service`, these two tests are
    expected to pass without further changes — they were iterated on live against the actual UI
    up to the exact point of the 404 (segment selection, campaign creation, and row-matching all
    verified working) before this was confirmed to be an infrastructure-staleness issue, not a
    test-authoring issue.
- **A genuine, pre-existing (non-CP-7) bug was found and documented (not fixed) while authoring
  `campaign-approval-workflow.spec.ts`:** `CampaignFormPage.tsx`'s segment `<select>` renders its
  6 `PREBUILT_SEGMENTS` options with `value={s.id}` where `s.id` is `null` for every prebuilt
  entry (they're virtual/computed, never a `customer_segments` row). React omits a `null` `value`
  prop from the DOM entirely, so the browser falls back to using the option's _text_ as its value;
  `Number(thatText)` is `NaN`, which serializes to JSON `null`, which fails
  `CampaignCreateSchema`'s `segmentId: z.number().optional()` (no `.nullable()`). **Net effect:
  selecting any of the 6 prebuilt segments when creating a campaign has never worked** — only
  custom (DB-backed) segments can actually be used to target a campaign via this form. This is
  unrelated to the approval workflow and was not fixed as part of this phase's diff (see
  `Surgical Changes` in `CLAUDE.md`); it's flagged here and in section 7 for a future session.

---

## 7. KNOWN ISSUES AND TECHNICAL DEBT

| Issue                                                                                                                                                                   | Severity        | Resolution Plan                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Verification debt now spans CP-2 through CP-7 (6 phases) — `sales-service` has still not been rebuilt+restarted since before CP-2                                       | **Critical**    | Same standing recommendation as every prior phase: a human or stack-owning session must rebuild+restart before any further live E2E work can validate anything past CP-1. Directly proven by the `curl` 404 above.                                                                                                                                                                                                                                                                                                                                                                                            |
| **Prebuilt-segment campaign targeting has never worked** (`CampaignFormPage.tsx`'s segment `<select>`, discovered while authoring this phase's E2E tests)               | **Medium-High** | Pre-existing, not introduced by CP-7. Fix: give prebuilt `<option>`s a stable string `value` (e.g. their `code`), and either (a) extend `CampaignCreateSchema.segmentId` to accept a code and resolve it server-side via the existing `loadSegment()` helper (already used by `/crm/segments/:id/customers                                                                                                                                                                                                                                                                                                    | export`), or (b) resolve the prebuilt segment to a real `customer_segments`row at creation time. Not fixed this phase per`CLAUDE.md`'s Surgical Changes rule — flagged for CP-8/CP-9 or a dedicated fix session. |
| **`tenant_communication_settings.approval_required` has no admin-facing route or UI** — the only way to opt a tenant into requiring approval today is a direct DB write | Medium          | The phase's own scope item 1 says approval is "optional per tenant," which this satisfies at the data/logic layer, but there is genuinely no self-service way for a tenant admin to turn it on. A minimal settings GET/PUT route (mirroring how `frequencyCap` on the same table has also had no UI since CP-5) is a reasonable CP-8 addition if this initiative continues to prioritize admin self-service.                                                                                                                                                                                                  |
| Consent-model (`customer_communication_preferences`) has schema only — no API routes, no UI, no unsubscribe-link wiring in outbound messages                            | Medium-High     | Deliberate — see section 12. The phase prompt explicitly asked to flag actual DPDP Act/TRAI applicability to the user before finalizing this shape; that confirmation has not happened in this autonomous session (the user is unavailable per the standing authorization, and this is not the kind of data-loss/security/irreversible-damage blocker that authorization carves out for pausing). The schema built is deliberately generic (channel x category, additive, non-enforcing) so it carries minimal risk of needing a breaking change once that legal review happens — see the flag in section 12. |
| `campaign_comments` has working routes but no dedicated UI panel                                                                                                        | Low             | The API exists and is tested at the type/route level; a comments thread UI on the campaign detail view is straightforward follow-up work, deferred to keep this phase's frontend surface focused on the approval workflow (the higher-priority Must-Have)                                                                                                                                                                                                                                                                                                                                                     |

---

## 12. WHAT IS NOT DONE (REMAINING TODO)

| Item                                                                            | Why deferred                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Customer preference center (API + UI)**                                       | Schema (`customer_communication_preferences`) shipped this phase; no routes or UI on top of it. The phase prompt's own instructions asked to flag applicable regulatory requirements (India DPDP Act / TRAI) to the user before finalizing the consent-model shape, given real legal weight (risk R9). That confirmation genuinely has not happened — this session has operated under the standing full-autonomy authorization from earlier in the initiative, which explicitly carves out pausing only for blockers with data-loss/security/irreversible-architectural-damage stakes; a compliance-shape question, while important, was judged not to meet that bar on its own, especially since the schema built is additive/non-enforcing and doesn't replace the existing enforced opt-out gate. **This is flagged here explicitly for the user to review before any preference-center UI or unsubscribe-link wiring is built on top of it** — the current schema (channel x category, `consented` boolean, `consent_source`, `consent_recorded_at`) is a reasonable generic default but has not been validated against DPDP/TRAI's actual requirements (e.g. TRAI's specific consent-registration-via-DLT mechanics for commercial communication in India, which this schema does not model at all). |
| Outbound unsubscribe-link mechanism per channel                                 | Depends on the preference center above existing first — deferred together.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Admin/self-service toggle for `tenant_communication_settings.approval_required` | See section 7 — no route exists yet; only a direct DB write can enable per-tenant approval today.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Comments UI panel on the campaign detail/list view                              | Routes exist and are reachable; no frontend panel was built — see section 7.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Fix for the prebuilt-segment campaign-targeting bug                             | Pre-existing, discovered incidentally this phase, out of scope for a surgical CP-7 diff — see section 7.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |

---

## 13. ARCHITECTURE DECISIONS MADE IN THIS PHASE

| Decision                                                                                                                                                                                                                              | Why                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | Alternatives Considered                                                                                                                                                                                                                                                                                   |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Approval is enforced at `send()`/`schedule()` time, not at `submitForApproval()` time, and auto-approves when the tenant opts out.**                                                                                                | Matches `09_CAMPAIGN_LIFECYCLE_AND_WORKFLOW.md`'s state machine and guarantees the "no behavior change for a tenant that doesn't opt in" contract from `19_MIGRATION_AND_BACKWARD_COMPATIBILITY.md` — every existing campaign flow (create → send) still works with zero extra required steps unless a tenant explicitly sets `approval_required = true`.                                                                                                                         | Enforcing at `submitForApproval()` only (rejected: a caller could skip calling it entirely and hit `send()` directly, so the real guard has to live in `send()`/`schedule()` regardless — `submitForApproval()` is a convenience/UX step, not the actual gate).                                           |
| **`update()` unconditionally resets approval status on any APPROVED/PENDING_APPROVAL campaign it edits**, per R6 in `20_RISK_ASSESSMENT.md`, framed as a hard rule not optional.                                                      | An approver is approving specific content; letting a post-approval edit silently keep `APPROVED` would let anyone with edit access bypass the entire approval gate by editing after approval. This was called out explicitly as non-negotiable in the phase prompt.                                                                                                                                                                                                               | Only reset on content-affecting fields, e.g. not on a `campaignType` change (rejected: adds fragile field-by-field judgment calls for marginal benefit; the existing SCHEDULED→DRAFT reset on edit from CP-4 already sets the precedent of resetting broadly on any edit).                                |
| **`CRM_CAMPAIGN_ANALYTICS_VIEW` and `CRM_AUTOMATION_MANAGE` split out of `CRM_VIEW`/`CRM_CAMPAIGN_CREATE`**, going beyond the phase prompt's literal 3-permission list (which also named these two alongside `CRM_CAMPAIGN_APPROVE`). | The phase prompt's scope item 2 explicitly lists all three; only `CRM_CAMPAIGN_APPROVE` had been wired in an earlier session before this summary/continuation point. Completing the other two was necessary to actually satisfy the phase's stated Definition of Done rather than leave it partially done.                                                                                                                                                                        | Leave `CRM_CAMPAIGN_ANALYTICS_VIEW`/`CRM_AUTOMATION_MANAGE` unadded and note it as future work (rejected: the phase prompt is unambiguous that all three are this phase's scope, and the backfill-migration mechanics are already proven/cheap to repeat).                                                |
| **Recurring-occurrence and automation-fired campaigns are stamped `APPROVED` at creation**, bypassing the approval gate for that specific occurrence.                                                                                 | The recurring series or the automation rule itself is the thing a human reviews and approves at setup time; requiring re-approval of every individual fired occurrence (potentially daily/weekly, unattended) would make CP-5's automation features unusable for any tenant that also enables approval.                                                                                                                                                                           | Require approval per occurrence too (rejected: defeats the purpose of automation — a human would have to babysit every single fire event).                                                                                                                                                                |
| **Consent-model (`customer_communication_preferences`) built generic/additive rather than DPDP/TRAI-specific**, and the compliance-shape confirmation flagged rather than blocked on.                                                 | Building a schema that hardcodes assumptions about a specific regulatory regime without the user's confirmation risks a breaking rebuild once that confirmation arrives (India DPDP Act rules were still being operationalized as of this session's date, and TRAI's DLT-based consent framework has specific technical requirements this schema does not attempt to model). A generic, additive, non-enforcing shape is the lowest-risk default that can be extended either way. | Build a DPDP/TRAI-specific model now on assumptions (rejected: real legal risk if wrong, and the phase prompt explicitly asked not to assume this); skip the table entirely until confirmation arrives (rejected: the schema is genuinely useful groundwork and low-risk since it's additive/unenforced). |

---

## 14. RISKS FOR NEXT PHASE

| Risk                                                                                                                                                                       | Impact       | Mitigation                                                                                                                                                                                                                                                                        |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Verification debt spans 6 phases now (CP-2 through CP-7) — CP-7 specifically changed 4 existing routes' permission gates                                                   | **Critical** | Strongly recommend a rebuild+restart+verify pass before CP-8. This is the single most important item before any further phase — untested permission-gate changes on live traffic are exactly the kind of change most likely to silently break real users if something was missed. |
| The consent-model's regulatory shape has not been confirmed by the user — building a preference-center UI on top of it before that confirmation risks rework               | Medium-High  | Do not build the preference-center UI in CP-8 until the user has reviewed section 12's flag; if CP-8 needs to proceed regardless, treat the current schema as provisional and expect a follow-up migration.                                                                       |
| `tenant_communication_settings.approval_required` has no self-service toggle — a tenant genuinely wanting the approval workflow cannot turn it on without direct DB access | Medium       | Candidate for a small, focused CP-8 addition if enterprise/scale-out tenants need this — flagged in section 7.                                                                                                                                                                    |
| The prebuilt-segment campaign-targeting bug affects real campaign creation today for any tenant that tries to use one of the 6 prebuilt segments                           | Medium-High  | Not CP-7's introduction, but now formally tracked (section 7) rather than silently latent — recommend fixing early in CP-8 or a dedicated bug-fix pass given it affects a Must-Have creation path.                                                                                |

---

## 15. FINAL ARCHITECTURE SUMMARY

CP-7 made campaign governance real: campaigns can now require explicit sign-off before they reach
real customers, gated by a tenant-level opt-in that defaults to today's exact direct-send
behavior for every existing tenant. The approval gate lives at the two places that actually matter
(`send()`/`schedule()`), not just at the optional `submitForApproval()` convenience step, closing
off any bypass. Editing an approved campaign unconditionally resets its approval status — a hard
rule, not a judgment call, directly closing the R6 risk this initiative's own risk assessment
flagged. Three new granular permissions (`CRM_CAMPAIGN_APPROVE`, `CRM_CAMPAIGN_ANALYTICS_VIEW`,
`CRM_AUTOMATION_MANAGE`) were added, backfilled for every existing tenant (not just future ones —
this codebase's most common recurring bug class), and each has explicit positive/negative
Fastify-inject test coverage. CP-4's `campaign_history` table, built three phases ago but never
surfaced anywhere, finally has a UI. The consent-model schema was intentionally built generic and
additive rather than guessed at DPDP/TRAI specifics, with that gap flagged explicitly for the user
rather than silently assumed away — a real compliance question this session could not responsibly
resolve alone. Two genuine findings surfaced during this phase's own testing: verification debt
now spans 6 phases with direct `curl` proof of a 404 on the live process, and a pre-existing,
unrelated bug in prebuilt-segment campaign targeting was caught and documented rather than
silently worked around. Both are handed off explicitly rather than left for a future session to
rediscover.

---

_Generated by: Claude Sonnet 5 | Date: 2026-07-15 | Next Phase: CP-8 — Enterprise Scale-out_
