# 21 — Implementation Roadmap

Nine phases, `CP-1` through `CP-9`. Each is a separate session (see README golden rules), has a starter
prompt in `phase-prompts/`, and produces a report in `phase-completions/`. Dependencies are sequential
unless noted — do not start CP-N before CP-(N-1) is complete, since each phase's data model/abstraction is
depended on by the next.

## Phase Overview

| Phase | Name                           | Delivers                                                                                                   | Depends on |
| ----- | ------------------------------ | ---------------------------------------------------------------------------------------------------------- | ---------- |
| CP-1  | Foundation Hardening           | FK constraints, optimistic locking usage, baseline test coverage for existing behavior before extending it | none       |
| CP-2  | Channel Abstraction & Media    | Provider adapter interface (refactor existing 4 channels), asset library                                   | CP-1       |
| CP-3  | Segmentation & Personalization | Multi-rule segment UI, expanded field whitelist, expanded token library, fail-safe rendering               | CP-1       |
| CP-4  | Campaign Builder 2.0           | Editing, drafts/autosave, templates, campaign types, multi-step wizard, media picker wiring                | CP-2, CP-3 |
| CP-5  | Scheduling & Automation        | Queue-based dispatch, recurring campaigns, frequency capping, business hours, automation engine            | CP-4       |
| CP-6  | Analytics & A/B Testing        | Delivery webhooks, engagement tracking, dashboards, attribution, A/B testing                               | CP-2, CP-5 |
| CP-7  | Collaboration & Compliance     | Approval workflow, granular permissions, comments/history UI, preference center, consent model             | CP-4       |
| CP-8  | Enterprise Scale-out           | Store scoping, sender identity, outbound webhooks, additional channel adapters                             | CP-6, CP-7 |
| CP-9  | QA & Production Readiness      | Full regression, performance/a11y/security testing, Playwright suite, release checklist                    | all above  |

## CP-1 — Foundation Hardening

**Goal**: make the existing engine safe to extend without regressing it.

- Add DB FK constraints (`campaigns.segment_id`, `campaign_recipients.notification_log_id`).
- Verify and start exercising `campaigns.version` for optimistic locking (no UI change yet — this is
  plumbing for CP-4's editing feature).
- Write unit/integration tests for `CampaignService`/`SegmentService` current behavior _before_ any new
  feature work touches them — this is the regression baseline every later phase measures against.
- Confirm `live-crm.spec.ts` passes and document its current coverage explicitly.

## CP-2 — Channel Abstraction & Media

**Goal**: make channels pluggable and enable rich content.

- Extract `ChannelProvider` interface in `notification-service`; migrate SMS/Email/WhatsApp/In-App onto it
  with no behavior change (verified by CP-1's baseline tests).
- Build the media asset library (`campaign_media_assets`, `campaign_media_links`) with channel-aware
  validation.
- Design (interface only) for Push/Web Push/Telegram/Messenger adapters — implement only if time remains
  after the core refactor; these are Should Have, not Must Have, for this phase.

## CP-3 — Segmentation & Personalization

**Goal**: make targeting and message content actually reflect customer behavior.

- Multi-rule segment builder UI (AND/OR), matching existing backend `filter_definition` capability.
- Expand `FIELD_COLUMNS` whitelist (purchase history, preferences, geography, store, salesperson, custom
  attributes via `customer_custom_attributes`).
- Expand personalization token library; implement fail-safe fallback rendering and preview warnings.
- "Save ad-hoc filter as segment" flow.

## CP-4 — Campaign Builder 2.0

**Goal**: the authoring experience becomes enterprise-grade.

- Campaign editing while `DRAFT`/`SCHEDULED` (version-checked).
- Draft autosave.
- Multi-step wizard (Type & Channel → Audience → Content → Personalization → Schedule → Review).
- `campaign_templates` (named, reusable, versioned, multi-language content variants).
- Campaign type taxonomy (tenant-configurable).
- Media picker wired into the builder (consumes CP-2's asset library).
- `campaign_history` table + UI groundwork (full audit-history tab ships fully in CP-7 alongside
  permissions, but the underlying table/logging starts here since editing is what first needs it).
- List pagination.

## CP-5 — Scheduling & Automation

**Goal**: campaigns run themselves when they should, and scale past in-request batching.

- Recipient fan-out moves to a background worker/queue; pause/resume support.
- Recurring campaigns (`recurrence_rule`, `parent_recurring_campaign_id`).
- Timezone-aware scheduling, business-hours/send-window enforcement (`tenant_communication_settings`).
- Frequency capping enforced in the shared recipient-resolution path.
- Automation engine (`campaign_automation_rules`) covering the 9 triggers in `13_AUTOMATION_AND_SCHEDULING
.md`, folding in the existing birthday-greeting special case per the migration plan.

## CP-6 — Analytics & A/B Testing

**Goal**: campaigns become measurable.

- Delivery-webhook receivers (MSG91/SendGrid/WhatsApp), signature-verified, idempotent.
- Engagement tracking (open pixel, click-through link wrapping).
- Attribution (coupon/tracked-link linkage, revenue/ROI).
- Campaign detail Analytics tab (funnel) + cross-campaign comparison view.
- A/B testing (variant split, success-metric-based winner reporting).

## CP-7 — Collaboration & Compliance

**Goal**: the platform is safe to hand to more than one trusted admin, and compliant.

- Approval workflow (optional per tenant), full lifecycle state machine from
  `09_CAMPAIGN_LIFECYCLE_AND_WORKFLOW.md`.
- Granular permissions (`CRM_CAMPAIGN_APPROVE`, `CRM_CAMPAIGN_ANALYTICS_VIEW`, `CRM_AUTOMATION_MANAGE`) —
  apply the R1 double-check (grant + guard use the identical constant) from `20_RISK_ASSESSMENT.md`.
- Comments/internal notes; visible audit-history tab (surfacing CP-4's `campaign_history` table).
- Customer preference center + `customer_communication_preferences` consent model.

## CP-8 — Enterprise Scale-out

**Goal**: multi-store, multi-brand, and third-party-integration ready.

- Store/branch-scoped campaigns and reporting.
- Configurable sender identity per tenant/channel.
- Outbound webhook subscriptions for third-party marketing tools.
- Additional channel adapters as prioritized by actual tenant demand (Telegram, Messenger, Web Push, QR).
- Revisit segment-membership caching/table partitioning only if CP-1–CP-7 usage data shows it's warranted.

## CP-9 — QA & Production Readiness

**Goal**: everything above is verified end-to-end, not just individually.

- Full regression pass across every phase's feature (see `23_TESTING_STRATEGY.md`).
- Complete Playwright suite (see `24_PLAYWRIGHT_TEST_PLAN.md`).
- Performance, accessibility, cross-browser, responsive, and security validation.
- Final release checklist (`22_DEFINITION_OF_DONE_AND_RELEASE_CHECKLIST.md`) signed off.

## Milestone Dependency Graph

```
CP-1 ──┬──► CP-2 ──┬──► CP-4 ──┬──► CP-5 ──┬──► CP-6 ──┐
       └──► CP-3 ──┘           └──► CP-7 ──┘           ├──► CP-8 ──► CP-9
                                                         └───────────┘
```

## Status Tracker

_(Mirrors the table in `README.md` — update both when a phase completes.)_

| Phase | Status       | Started    | Completed  | Report                                 |
| ----- | ------------ | ---------- | ---------- | -------------------------------------- |
| CP-1  | **Complete** | 2026-07-15 | 2026-07-15 | `phase-completions/CP-1_COMPLETION.md` |
| CP-2  | **Complete** | 2026-07-15 | 2026-07-15 | `phase-completions/CP-2_COMPLETION.md` |
| CP-3  | **Complete** | 2026-07-15 | 2026-07-15 | `phase-completions/CP-3_COMPLETION.md` |
| CP-4  | **Complete** | 2026-07-15 | 2026-07-15 | `phase-completions/CP-4_COMPLETION.md` |
| CP-5  | **Complete** | 2026-07-15 | 2026-07-15 | `phase-completions/CP-5_COMPLETION.md` |
| CP-6  | Not started  | —          | —          | —                                      |
| CP-7  | Not started  | —          | —          | —                                      |
| CP-8  | Not started  | —          | —          | —                                      |
| CP-9  | Not started  | —          | —          | —                                      |
