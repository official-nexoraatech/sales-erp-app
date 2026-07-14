# Campaign Management Platform — Planning Directory

## What This Is

This folder is the single source of truth for evolving the ERP's Campaign module (currently a basic
single-channel broadcast tool inside `apps/sales-service`) into an enterprise-grade, omnichannel Campaign
Management platform — usable for the Clothing ERP today, and architected to extend to other industries
later.

This is a **planning and living-documentation project**, not a one-shot implementation. Work proceeds in
phases (see `21_IMPLEMENTATION_ROADMAP.md`); each phase has a copy-paste starter prompt in `phase-prompts/`
and produces a completion report in `phase-completions/`, exactly like the pattern already used in
`ERP-PLANNING/phase-prompts/` and `ERP-PLANNING/phase-completions/` for the original 15-phase build.

This documentation set was originally produced with no code changes. Implementation began 2026-07-15
(CP-1 onward, executed autonomously) — check the status table below and `phase-completions/` for what has
actually shipped versus what is still planning-only.

---

## How To Use This Folder

### If you are starting a new implementation phase

1. Read `00_CURRENT_STATE_ASSESSMENT.md` (what exists today, verified against the live codebase).
2. Read `21_IMPLEMENTATION_ROADMAP.md` to find which phase is next (check `phase-completions/` for what's
   already done).
3. Open the matching file in `phase-prompts/` and paste it as the first message in a **new** Claude Code
   session.
4. At the end of the phase, generate a completion report into `phase-completions/` using
   `PHASE_COMPLETION_TEMPLATE.md` from the parent `ERP-PLANNING/` folder as the format, and update the
   checkboxes in `21_IMPLEMENTATION_ROADMAP.md`.

### If you are doing requirements/analysis work

Read the numbered docs in order — each is self-contained but references earlier ones. Update a doc in
place when a decision changes; don't fork new versions.

### Document Map

| #   | File                                             | Purpose                                                                   |
| --- | ------------------------------------------------ | ------------------------------------------------------------------------- |
| 00  | `00_CURRENT_STATE_ASSESSMENT.md`                 | What the Campaign module actually does today — code-verified, not assumed |
| 01  | `01_VISION_AND_GOALS.md`                         | Why this project exists, product vision, success metrics                  |
| 02  | `02_GAP_ANALYSIS.md`                             | Current vs. target-state gaps across every dimension                      |
| 03  | `03_BUSINESS_REQUIREMENTS.md`                    | Business-level requirements (BR-xx)                                       |
| 04  | `04_FUNCTIONAL_REQUIREMENTS.md`                  | Functional requirements (FR-xx) by capability area                        |
| 05  | `05_NON_FUNCTIONAL_REQUIREMENTS.md`              | Performance, scalability, reliability, a11y, i18n (NFR-xx)                |
| 06  | `06_USER_PERSONAS_AND_STORIES.md`                | Personas + user stories + acceptance criteria                             |
| 07  | `07_FEATURE_BACKLOG.md`                          | MoSCoW-prioritized backlog, the master task list                          |
| 08  | `08_UX_UI_AND_INFORMATION_ARCHITECTURE.md`       | Navigation, layout, campaign builder UX, IA                               |
| 09  | `09_CAMPAIGN_LIFECYCLE_AND_WORKFLOW.md`          | State machine, statuses, transitions, approval gates                      |
| 10  | `10_OMNICHANNEL_REQUIREMENTS.md`                 | Channel abstraction, current + future channel list                        |
| 11  | `11_SEGMENTATION_AND_PERSONALIZATION.md`         | Targeting model, dynamic segments, personalization tokens                 |
| 12  | `12_MEDIA_MANAGEMENT.md`                         | Asset library, uploads, optimization, reuse                               |
| 13  | `13_AUTOMATION_AND_SCHEDULING.md`                | Recurring campaigns, triggers, throttling, send windows                   |
| 14  | `14_ANALYTICS_AND_REPORTING.md`                  | Metrics model, dashboards, A/B testing, attribution                       |
| 15  | `15_ROLES_PERMISSIONS_SECURITY_COMPLIANCE.md`    | RBAC, consent, privacy, audit                                             |
| 16  | `16_INTEGRATION_REQUIREMENTS.md`                 | Provider integrations (SMS/Email/WhatsApp/social/webhooks)                |
| 17  | `17_DATA_MODEL_AND_API_DESIGN.md`                | Schema evolution, new tables, API surface                                 |
| 18  | `18_PERFORMANCE_AND_SCALABILITY.md`              | Volume assumptions, queueing, multi-tenant scale                          |
| 19  | `19_MIGRATION_AND_BACKWARD_COMPATIBILITY.md`     | How existing campaigns/segments survive the migration                     |
| 20  | `20_RISK_ASSESSMENT.md`                          | Technical, business, compliance risks + mitigations                       |
| 21  | `21_IMPLEMENTATION_ROADMAP.md`                   | Phases CP-1..CP-9, milestones, dependencies, status tracker               |
| 22  | `22_DEFINITION_OF_DONE_AND_RELEASE_CHECKLIST.md` | DoD per phase + final release checklist                                   |
| 23  | `23_TESTING_STRATEGY.md`                         | Full QA strategy (unit → security) for the final phase                    |
| 24  | `24_PLAYWRIGHT_TEST_PLAN.md`                     | Concrete E2E test suite design for the Campaign module                    |

```
Campaign-Planning/
├── README.md                              ← YOU ARE HERE
├── 00_CURRENT_STATE_ASSESSMENT.md
├── 01_VISION_AND_GOALS.md
├── 02_GAP_ANALYSIS.md
├── 03_BUSINESS_REQUIREMENTS.md
├── 04_FUNCTIONAL_REQUIREMENTS.md
├── 05_NON_FUNCTIONAL_REQUIREMENTS.md
├── 06_USER_PERSONAS_AND_STORIES.md
├── 07_FEATURE_BACKLOG.md
├── 08_UX_UI_AND_INFORMATION_ARCHITECTURE.md
├── 09_CAMPAIGN_LIFECYCLE_AND_WORKFLOW.md
├── 10_OMNICHANNEL_REQUIREMENTS.md
├── 11_SEGMENTATION_AND_PERSONALIZATION.md
├── 12_MEDIA_MANAGEMENT.md
├── 13_AUTOMATION_AND_SCHEDULING.md
├── 14_ANALYTICS_AND_REPORTING.md
├── 15_ROLES_PERMISSIONS_SECURITY_COMPLIANCE.md
├── 16_INTEGRATION_REQUIREMENTS.md
├── 17_DATA_MODEL_AND_API_DESIGN.md
├── 18_PERFORMANCE_AND_SCALABILITY.md
├── 19_MIGRATION_AND_BACKWARD_COMPATIBILITY.md
├── 20_RISK_ASSESSMENT.md
├── 21_IMPLEMENTATION_ROADMAP.md
├── 22_DEFINITION_OF_DONE_AND_RELEASE_CHECKLIST.md
├── 23_TESTING_STRATEGY.md
├── 24_PLAYWRIGHT_TEST_PLAN.md
├── phase-prompts/                         ← one copy-paste starter prompt per implementation phase
│   ├── CP-1_FOUNDATION_HARDENING.md
│   ├── CP-2_CHANNEL_ABSTRACTION.md
│   ├── CP-3_SEGMENTATION_PERSONALIZATION.md
│   ├── CP-4_CAMPAIGN_BUILDER_2.md
│   ├── CP-5_SCHEDULING_AUTOMATION.md
│   ├── CP-6_ANALYTICS_ABTEST.md
│   ├── CP-7_COLLABORATION_COMPLIANCE.md
│   ├── CP-8_ENTERPRISE_SCALEOUT.md
│   └── CP-9_QA_PRODUCTION_READINESS.md
└── phase-completions/                     ← generated after each phase finishes
    └── (empty until CP-1 completes)
```

---

## Golden Rules For This Initiative

1. **Extend, don't replace.** The existing `campaigns` / `campaign_recipients` / `customer_segments` tables
   and their APIs keep working at every phase boundary. New capability is additive (new nullable columns,
   new tables, new endpoints) — see `19_MIGRATION_AND_BACKWARD_COMPATIBILITY.md`.
2. **One phase = one session**, same discipline as the original 15-phase build. Don't blend CP-N and CP-N+1
   work in one sitting.
3. **Every phase ends with a completion report.** Future sessions (human or AI) must be able to resume from
   `phase-completions/` alone.
4. **Ground every claim in the code, not in assumptions.** `00_CURRENT_STATE_ASSESSMENT.md` was produced by
   direct codebase inspection (file paths + line numbers cited); re-verify against current code before
   trusting it if significant time has passed — see the memory-system guidance on stale snapshots.
5. **Industry-agnostic by design, Clothing-first by default.** Wherever a requirement mentions
   clothing-specific concepts (e.g. "size/color preference"), model it as a configurable attribute, not a
   hardcoded field — see `11_SEGMENTATION_AND_PERSONALIZATION.md` and `17_DATA_MODEL_AND_API_DESIGN.md`.
6. **Testing is not an afterthought bolted on at the end** — each phase has its own DoD testing bar
   (`22_DEFINITION_OF_DONE_AND_RELEASE_CHECKLIST.md`); CP-9 is full-system regression + release hardening on
   top of that, not the first time tests are written.

---

## Status

| Phase                               | Status                    | Completion Report                      |
| ----------------------------------- | ------------------------- | -------------------------------------- |
| CP-1 Foundation Hardening           | **Complete** (2026-07-15) | `phase-completions/CP-1_COMPLETION.md` |
| CP-2 Channel Abstraction            | **Complete** (2026-07-15) | `phase-completions/CP-2_COMPLETION.md` |
| CP-3 Segmentation & Personalization | Not started               | —                                      |
| CP-4 Campaign Builder 2.0           | Not started               | —                                      |
| CP-5 Scheduling & Automation        | Not started               | —                                      |
| CP-6 Analytics & A/B Testing        | Not started               | —                                      |
| CP-7 Collaboration & Compliance     | Not started               | —                                      |
| CP-8 Enterprise Scale-out           | Not started               | —                                      |
| CP-9 QA & Production Readiness      | Not started               | —                                      |

_(Update this table as phases complete — it is the fastest way for a new session to know where things
stand.)_
