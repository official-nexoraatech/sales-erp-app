# 02 — Roadmap

No calendar estimates below — this codebase's own convention (see `PG-055_COMPLETION.md`) is to leave
numbers unfabricated until there's a real measurement to cite. Phases are ordered by dependency and
leverage, not a schedule.

## Status

| Phase | Scope                                                                                                                                                                                                                                                                        | Status          |
| ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------- |
| DAP-1 | Foundation (engine, schema, RBAC, progress/events, Help Center entry points) + one real pilot: cross-module business-workflow tour (PO → GRN → Stock → Accounting → GST → Reports → Dashboard)                                                                               | **In progress** |
| DAP-2 | Migrate existing `HELP_CONTENT` (~60 routes) into the new schema; Quick Tour type for Sales, Inventory, Purchase (highest page-count/highest-traffic modules); analytics summary dashboard (deferred from DAP-1, see ADR-7); first role-based variant proven across ≥2 roles | Not started     |
| DAP-3 | Quick/Complete tours for remaining core modules: Accounting, GST, HR, CRM, Reports, Settings, Production — batched by module, one or more per session                                                                                                                        | Not started     |
| DAP-4 | Interactive Walkthroughs + Troubleshooting tours for the highest drop-off/support-burden flows — **prioritized using DAP-2's real analytics data**, not guessed                                                                                                              | Not started     |
| DAP-5 | POS baseline Help Center (closes ADR-6's gap — POS has zero Help affordance today) + POS tours                                                                                                                                                                               | Not started     |
| DAP-6 | Smart Tooltips: build the `Tooltip`/`Popover` component that doesn't exist yet (see `00_CURRENT_STATE_ASSESSMENT.md` §2); apply to calculation-heavy GST/Accounting/Inventory fields                                                                                         | Not started     |
| DAP-7 | Admin/Platform module coverage (Tenants, Audit Logs, Feature Flags, `/admin/distributed/*`) + Auditor/Platform-Admin-oriented tours                                                                                                                                          | Not started     |
| DAP-8 | Localization scaffold; versioning maturity once real tours reach v2+; full-suite Playwright regression hardening                                                                                                                                                             | Not started     |

## Why this order

- DAP-1 must prove the engine on the _hardest_ case (cross-module, mixed informational/interactive,
  RBAC-filtered mid-workflow) before any content-authoring-at-scale phase begins — a bug in the engine
  found after 60 tours exist is 60x the cleanup.
- DAP-2 deliberately pairs content migration with the analytics dashboard: real usage data needs to exist
  before DAP-4 can honestly claim to prioritize "highest drop-off" rather than guess.
- POS (DAP-5) is sequenced after core-web-frontend coverage, not before, because POS currently has no
  baseline Help surface at all (ADR-6) — building tours on top of nothing would repeat the same mistake
  the brief opens by warning against ("not a guided tour library integration" — i.e., don't skip the
  foundation).
- Smart Tooltips (DAP-6) comes after tours, not before, because it needs a real `Tooltip` primitive built
  from scratch (confirmed absent app-wide) — worth building once, informed by whatever spacing/positioning
  lessons the tour engine's `usePopoverPosition` usage surfaces first.

## Definition of done, every phase

Matching this repo's existing bar (`Campaign-Planning/22_DEFINITION_OF_DONE_AND_RELEASE_CHECKLIST.md`):
typecheck clean, lint clean (no new errors beyond the tracked pre-existing baseline), unit tests passing,
Playwright coverage for any new user-facing flow, a phase-completion report in `phase-completions/`, and
`README.md`'s status table updated. No phase is "done" on the strength of an AI session's own claim alone —
each completion report states what was verified how (live run vs. mocked test vs. static read), same
discipline as every `*_COMPLETION.md` already in this repo.
