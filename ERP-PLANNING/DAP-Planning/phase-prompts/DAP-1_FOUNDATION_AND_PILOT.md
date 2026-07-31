Copy everything below the line into the first message of a new Claude Code session.

---

I'm starting **Phase DAP-1: Foundation & Pilot** of the Digital Adoption Platform initiative. This is
phase 1 of 8 (see `ERP-PLANNING/DAP-Planning/02_ROADMAP.md`).

Before doing anything, read in this order:

1. `ERP-PLANNING/DAP-Planning/README.md`
2. `ERP-PLANNING/DAP-Planning/00_CURRENT_STATE_ASSESSMENT.md`
3. `ERP-PLANNING/DAP-Planning/01_ARCHITECTURE.md` (all 7 ADRs — they explain _why_, not just _what_)
4. `ERP-PLANNING/DAP-Planning/02_ROADMAP.md`
5. `ERP-PLANNING/THEME_HELP_ENTERPRISE_AUDIT_2026-07-15.md` — the prior session's gap analysis of this
   exact surface; do not re-derive it.
6. Any prior file in `ERP-PLANNING/DAP-Planning/phase-completions/` (none should exist yet for DAP-1).
7. Check `apps/web-frontend/src/components/help/HelpPanel.tsx`'s current `HELP_CONTENT` for uncommitted
   changes before touching it — this file has a history of concurrent-session edits (see project memory:
   "Concurrent sessions on same repo").

## Goal for This Phase

Prove the DAP architecture end-to-end with one real, fully-built, fully-tested vertical slice — not stubs
across many modules. Success is a user starting the pilot tour from the Help Center, walking a real
cross-module business workflow with correct RBAC filtering and real business-education content, having
progress persist and resume across a reload, and analytics events landing in the database — verified live,
not just by passing tests.

## Scope

1. **Engine** — build `apps/web-frontend/src/dap/` per `01_ARCHITECTURE.md` §1–3: content schema (Zod +
   types), `import.meta.glob` registry, `TourProvider`/`useTour`, `TourOverlay`/`TourSpotlight`/
   `TourTooltipCard`. Reuse `useFocusTrap`, `usePopoverPosition`, and `Modal`'s overlay/motion/z-index
   conventions — do not reinvent them. Add the `--z-tour` token to `packages/design-tokens/tokens.css`.
2. **RBAC** — tour-level and step-level permission filtering per §4, using `usePermission` only. No new
   role-based logic, no hardcoded role names anywhere in `dap/`.
3. **Backend** — `tour_progress` + `tour_events` tables (new migration in `packages/db-client/migrations/`,
   next sequential number) and `apps/event-service/src/api/dap.routes.ts` per §5–6 and ADR-3/ADR-7: `GET`/
   `PUT /dap/progress`, `POST /dap/events`. No analytics summary/dashboard endpoint yet — that's DAP-2.
4. **Help Center integration** — add "Start Tour"/"Restart Tour" entries to `HelpPanel.tsx` for the pilot
   tour. Do not touch the ~60 existing `HELP_CONTENT` entries or their structure — that migration is DAP-2.
5. **Pilot content** — one `business-workflow`-type tour,
   `content/tours/cross-module/purchase-to-dashboard.tour.ts`: Purchase Order → GRN → Stock → Accounting →
   GST → Reports → Dashboard. Mix informational and at least one real interactive step (per ADR-5's
   CustomEvent contract). Every step needs real `businessImpact` content, not filler — this is the
   "business education, not just UI description" requirement from the initiative's brief.
6. **Tests** — unit tests for the engine (schema validation, permission filtering, progress dual-write,
   registry auto-discovery) and a Playwright E2E spec covering: launch tour from Help Center, step
   forward/back, an RBAC-filtered step correctly skipped for a lower-privilege test user, reload mid-tour
   resumes at the correct step, completion persists.
7. **Verify live** — run the actual dev stack, actually take the tour in a browser as more than one role
   (at minimum: a role with full pilot-workflow permissions, and one missing at least one permission along
   the way, e.g. `CASHIER`) before claiming this phase done. Static/mocked-test-only verification is not
   sufficient for a first-of-its-kind UI surface — say explicitly in the completion report what was
   live-verified vs. test-only, matching this repo's own reporting convention.

## Rules

- Follow `CLAUDE.md`: surgical changes, no speculative abstraction beyond what §1–8 of the architecture
  doc specifies, state assumptions rather than guessing when something in the architecture doc turns out
  to be wrong once real code is touched (permission constant names, exact table/column conventions in
  `@erp/db`, etc.) — note the correction in this phase's completion report, don't silently improvise.
  Also run this repo's CLAUDE.md session-start deployment-checklist scan
  (`scripts/check-pending-deployment-checklists.sh`) if starting a fresh session for this phase.
- Do not start DAP-2 work (HELP_CONTENT migration, additional modules, analytics dashboard) even if it
  looks related or convenient to do while a file is already open.
- Do not modify `role-defaults.ts` or add new `PERMISSIONS.*` constants unless the pilot workflow genuinely
  has no existing permission to gate a step on — check thoroughly first (see `00_CURRENT_STATE_ASSESSMENT.md`
  §3 for the constants already confirmed to exist).
- Match existing conventions exactly: Fastify route patterns in `event-service`'s other `*.routes.ts` files,
  Drizzle schema conventions in `@erp/db`, React Query patterns already used elsewhere in `web-frontend`.

## Definition of Done

See `ERP-PLANNING/DAP-Planning/02_ROADMAP.md`'s "Definition of done, every phase" section.

## When Done

Generate `ERP-PLANNING/DAP-Planning/phase-completions/DAP-1_COMPLETION.md` using
`ERP-PLANNING/PHASE_COMPLETION_TEMPLATE.md` as the format, and update the status tracker in
`ERP-PLANNING/DAP-Planning/README.md` and `02_ROADMAP.md`.
