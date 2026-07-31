# Digital Adoption Platform (DAP) — Planning Directory

## What This Is

This folder is the single source of truth for building an in-house Digital Adoption Platform inside the
ERP: guided tours, contextual tooltips, role-aware business-workflow walkthroughs, a Help Center, progress
tracking, and adoption analytics — a first-class platform capability, not a bolted-on tour library.

This is a **planning and living-documentation project**, mirroring the pattern already used in
`ERP-PLANNING/Campaign-Planning/` and the original 15-phase ERP build: numbered docs for the durable
decisions, `phase-prompts/` for copy-paste session starters, `phase-completions/` for what actually
shipped. Unlike Campaign-Planning, this set intentionally skips a long requirements-gathering stage — the
scope, pilot, and content-authoring model were already decided with the user before this folder was
created (see `00_CURRENT_STATE_ASSESSMENT.md` §5), so documentation stays proportional to what's actually
about to be built rather than speculatively covering every future phase up front.

## How To Use This Folder

1. Read `00_CURRENT_STATE_ASSESSMENT.md` — what exists today (code-verified), and why this isn't
   a greenfield build.
2. Read `01_ARCHITECTURE.md` — the content schema, engine design, and the ADRs behind every non-obvious
   choice (why files not a CMS, why event-service not a new service, why direct-write not Kafka/outbox,
   why DOM CustomEvents for interactive mode).
3. Read `02_ROADMAP.md` for phase status and what's next. Check `phase-completions/` before assuming
   any phase is done.
4. Each phase has a starter prompt in `phase-prompts/` and, once finished, a completion report in
   `phase-completions/` using the parent `ERP-PLANNING/PHASE_COMPLETION_TEMPLATE.md` format.

```
DAP-Planning/
├── README.md                          ← YOU ARE HERE
├── 00_CURRENT_STATE_ASSESSMENT.md     ← what exists today, code-verified
├── 01_ARCHITECTURE.md                 ← content schema, engine, ADRs
├── 02_ROADMAP.md                      ← DAP-1..N phases, status tracker
├── phase-prompts/
│   └── DAP-1_FOUNDATION_AND_PILOT.md
└── phase-completions/
    └── (written as each phase finishes)
```

## Golden Rules For This Initiative

1. **Extend, don't discard.** `HelpPanel.tsx`'s `HELP_CONTENT`, `OnboardingChecklist.tsx`, `WhatsNewModal.tsx`,
   and `apps/docs-site` are real, recently-authored, working systems. The DAP absorbs and evolves them
   (see migration plan in `01_ARCHITECTURE.md` §7) — it does not replace them wholesale.
2. **RBAC-aware means permission-aware, not role-name-aware.** Gate tour/step visibility on
   `PERMISSIONS.*` constants via the existing `usePermission`/`useHasAnyPermission` hooks — the same
   mechanism every route and button in the app already uses. Never hardcode a role name into content;
   the 13-role set in `role-defaults.ts` has changed before and will change again.
3. **No new tour/walkthrough library.** Explicit constraint from the initiative's kickoff. Build on
   existing primitives (`useFocusTrap`, `usePopoverPosition`, `Modal`'s overlay conventions) — see ADR-1.
4. **One phase = one focused session's worth of work**, verified before moving on — same discipline as
   Campaign-Planning's golden rule #2. Full-catalog content authoring happens phase by phase against a
   proven engine, not all at once against an unproven one.
5. **Ground every claim in the code.** `00_CURRENT_STATE_ASSESSMENT.md` was produced by direct codebase
   inspection (file paths cited). Re-verify before trusting it if significant time has passed.
6. **Don't reintroduce fixed bugs.** `THEME_HELP_ENTERPRISE_AUDIT_2026-07-15.md` fixed a real
   Reduced-Motion no-op (BUG-T2) and an HC-mode contrast bug (BUG-T1) across this exact surface. The tour
   overlay must use `var(--duration-*)`-driven transitions and semantic tokens, never bare Tailwind
   `dark:` classes or hardcoded ms literals, or those bugs return for the DAP specifically.

## Status

| Phase                                        | Status                                                                                                                                                                                                                         | Completion Report                       |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------- |
| DAP-1 Foundation & Pilot                     | **Code-complete, unit-tested, backend-verified live. One open item: full in-browser click-through blocked by machine memory exhaustion mid-verification (2026-07-19) — re-run `live-dap-tour.spec.ts` before starting DAP-2.** | `phase-completions/DAP-1_COMPLETION.md` |
| DAP-2 Content Migration & Coverage Expansion | Not started — blocked on DAP-1's live-verification re-run per `02_ROADMAP.md`'s stated phase-ordering rationale                                                                                                                | —                                       |
| DAP-3+                                       | Not started — see `02_ROADMAP.md`                                                                                                                                                                                              | —                                       |

_(Update this table as phases complete.)_

## Also shipped this phase, outside DAP-1's own scope

A severe, platform-wide, pre-existing bug was found and fixed while live-verifying DAP-1:
`packages/platform-sdk/src/http-security.ts` set `Cross-Origin-Resource-Policy: same-origin` across all 15
services, which silently blocks the browser from reading any cross-origin fetch response — breaking every
browser-based test that goes through api-gateway from web-frontend's different origin, likely since the
2026-07-16 gateway cutover. Fixed to `cross-origin`. See DAP-1's completion report §6.3 and §13 for the
full story; this fix still needs its own real-browser confirmation, same blocker as DAP-1's own gap above.
