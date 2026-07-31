# 01 — Architecture

Grounded in `00_CURRENT_STATE_ASSESSMENT.md`. This is the design for DAP-1 and the shape everything after
it extends — read the ADRs at the bottom for the reasoning behind each non-obvious call.

## 1. Module layout

Everything lives in one new cohesive module, `apps/web-frontend/src/dap/`, not scattered across existing
`hooks/`/`api/`/`components/`. Single-app for now (only web-frontend needs it; POS is a later, explicit
phase — see ADR-6) — not extracted into `packages/` until a second consumer actually exists.

```
apps/web-frontend/src/dap/
├── content/
│   ├── schema.ts              # Zod schemas + inferred TS types: TourDefinition, TourStep, etc.
│   ├── registry.ts            # import.meta.glob auto-discovery — new tour files self-register
│   └── tours/
│       └── cross-module/
│           └── purchase-to-dashboard.tour.ts   # DAP-1 pilot content
├── engine/
│   ├── TourProvider.tsx       # context: active tour/step state, start/next/prev/skip/finish
│   ├── useTour.ts
│   ├── TourOverlay.tsx        # backdrop + spotlight cutout + tooltip card, mounted once in Layout
│   ├── TourSpotlight.tsx      # positions a cutout/ring around a target element
│   ├── TourTooltipCard.tsx    # title/body/business-context + Prev/Next/Skip
│   └── useTourAction.ts       # listens for the interactive-step CustomEvent contract
├── api/
│   ├── tourApi.ts             # fetch wrappers for /dap/progress, /dap/events
│   └── useTourProgress.ts     # React Query hooks
└── index.ts                    # barrel
```

## 2. Content model

```ts
type TourType =
  | 'quick'
  | 'complete'
  | 'interactive'
  | 'advanced'
  | 'role-based'
  | 'whats-new'
  | 'feature-announcement'
  | 'troubleshooting'
  | 'business-workflow';

interface TourDefinition {
  id: string; // stable slug, e.g. 'purchase-to-dashboard-workflow'
  version: number; // bump on any content change that should trigger "What's New"
  type: TourType;
  title: string;
  description: string;
  module: string; // primary module id, or 'cross-module'
  estimatedMinutes: number;
  requiredPermissions?: Permission[]; // ANY-match; tour hidden entirely if user has none of these
  whatsNewSince?: { fromVersion: number; changes: string[] }[];
  steps: TourStep[];
}

interface TourStep {
  id: string;
  route: string; // engine navigates here if the user isn't already on it
  target?: string; // data-tour-id anchor; absent = centered card (pure business-education step)
  title: string;
  body: string; // the "why", not just the "what" — business-education content
  placement?: 'top' | 'bottom' | 'left' | 'right' | 'center';
  mode: 'informational' | 'interactive';
  requiredAction?: {
    // interactive steps only
    type: 'click' | 'route-reached' | 'custom-event';
    selector?: string;
    eventName?: string; // see ADR-5
  };
  requiredPermission?: Permission; // step-level: step is *skipped*, not tour-hidden, if absent
  businessImpact?: string[]; // e.g. ["Posts a journal entry", "Updates the GST register"]
}
```

Content files are plain data modules under `content/tours/{module}/*.tour.ts`, each exporting a single
`TourDefinition`, validated against the Zod schema in a unit test (`registry.test.ts`) so a malformed tour
fails CI, not runtime. `registry.ts` uses Vite's `import.meta.glob('./tours/**/*.tour.ts', { eager: true })`
to auto-collect every file into the registry — adding a new tour never means editing a central list or
touching `HelpPanel.tsx` (see ADR-1's second problem statement).

Anchors: interactive/spotlight steps target elements via a `data-tour-id="…"` attribute, not CSS class or
DOM structure selectors — decouples tour content from incidental markup/styling changes (a class rename
shouldn't silently break a tour). Pages opt in by adding one attribute to the element being highlighted.

## 3. Engine

- **`TourProvider`** — React context near the app root (inside `Layout`, alongside where
  `OnboardingChecklist`/`HelpPanel` already mount). Holds `activeTourId`, `currentStepIndex`, exposes
  `startTour(id)`, `next()`, `prev()`, `skip()`, `finish()`. On `startTour`, filters `steps` by
  `requiredPermission` (skip, don't hide-whole-tour) using the existing `usePermission` hook — no new RBAC
  mechanism, see ADR-2.
- **`TourOverlay`** — one instance, mounted once, renders only when a tour is active. Backdrop + either
  `TourSpotlight` (cutout ring positioned via the existing `usePopoverPosition` hook against
  `[data-tour-id="…"]`) or a centered card when `target` is absent. Focus-trapped via the existing
  `useFocusTrap` hook (same one `Modal`/`HelpPanel` use). Escape = `skip()`, matching the platform-wide
  "Esc closes any overlay" law the 2026-07-15 audit already enforces elsewhere.
- **Motion**: all transitions use `var(--duration-*)` tokens, never bare Tailwind `transition-*` utilities
  or literal ms values — the audit's BUG-T2 (Reduced Motion no-op) was exactly this mistake, already fixed
  once on this surface; the tour overlay must not reintroduce it.
- **Z-index**: new `--z-tour: 800` token (`packages/design-tokens/tokens.css`), between `--z-popover: 700`
  and `--z-toast: 900` — a tour sits above dropdowns/popovers, below toast notifications, and (deliberately)
  below `--z-modal: 600`'s stacking _only when a step's own required action is to open a modal_ — the
  spotlight steps back while the user interacts with a real dialog, then resumes.

## 4. RBAC integration

Two levels, both keyed on existing `PERMISSIONS.*` constants — never on role names (ADR-2):

- **Tour-level**: `requiredPermissions` (ANY-match, mirroring `PermissionRoute`'s own semantics) controls
  whether the tour appears at all in the Help Center / auto-suggest surfaces.
- **Step-level**: `requiredPermission` on an individual step. A user without `GRN_APPROVE` running the
  pilot's business-workflow tour sees every step except "Approve the GRN," which is silently skipped, not
  blocked — the workflow narrative stays coherent instead of dead-ending.

## 5. Progress and resume

New tables, event-service (ADR-3):

```sql
tour_progress (tenant_id, user_id, tour_id, tour_version, status, current_step_id, completed_at, updated_at)
tour_events   (tenant_id, user_id, tour_id, tour_version, step_id NULL, event_type, occurred_at, metadata JSONB)
```

`event_type ∈ {tour_started, step_viewed, step_completed, tour_completed, tour_skipped, tour_abandoned}`.
Dual-write on every transition: `localStorage` first (instant resume even offline/before the network call
lands — same resilience pattern the app's theme preferences already use), then a debounced write to
`PUT /dap/progress/:tourId` / `POST /dap/events`. Backend is the source of truth for cross-device resume;
localStorage is the fast path only.

## 6. Versioning / "What's New"

`tour_progress.tour_version` records which version a user completed. If a tour's current `version` is
higher and defines a `whatsNewSince` entry for the user's completed version, the engine offers a short
"What's New in {tour.title}" prompt (reusing `whatsNewSince.changes`) instead of forcing a full replay —
extending the existing `WhatsNewModal` pattern from app-wide to per-tour.

## 7. Migration plan for existing content

Not part of DAP-1 (see `02_ROADMAP.md`) but designed for now so DAP-1's schema doesn't box it out:
`HELP_CONTENT`'s `{title, description, tasks, guideUrl}` shape maps directly onto a lighter sibling type,
`HelpEntry` (not a `TourDefinition` — contextual per-page help and multi-step tours are different content
types, matching the brief's own distinction between "Smart Tooltips"/Help Center content and full Tours).
DAP-2 moves the ~60-and-growing `HELP_CONTENT` routes out of the `HelpPanel.tsx` object literal into
`content/help/{module}/*.help.ts` files under the same auto-discovery pattern — same migration shape as
the tours, same registry mechanism, no new concepts.

## 8. Architecture Decision Records

**ADR-1 — Build custom on existing primitives, not a tour library, and not a new central content list.**
Decision: no `react-joyride`/`shepherd`/etc. (explicit constraint); anchor via `data-tour-id` +
`usePopoverPosition`; auto-discover content via `import.meta.glob`. Why: a library would fight this app's
own design-token/focus-trap/motion conventions (the 2026-07-15 audit shows what happens when a surface
doesn't use them — silent HC/motion bugs); and `HELP_CONTENT`'s single growing object literal is the
concrete anti-pattern the brief calls out — auto-discovery removes the "every new tour touches one shared
file" bottleneck permanently, not just for this phase.

**ADR-2 — Gate on permissions, never on role names.** Decision: `requiredPermissions`/`requiredPermission`
reference `PERMISSIONS.*` exclusively; the DAP has no concept of "role" anywhere in its code. Why: the
real role set (13 roles, `role-defaults.ts`) already doesn't match the kickoff brief's illustrative list,
and this codebase has a documented history of "granted-but-dead-permission" bugs from exactly this kind of
duplication (see `rbac_dead_permission_constant_pattern` in project memory). Piggybacking on
`usePermission`/`PermissionGate` — the mechanism every route already trusts — means the DAP automatically
tracks any future role/permission changes with zero maintenance, and can't drift out of sync the way a
parallel role-mapping table would.

**ADR-3 — Progress/analytics live in event-service, direct-write tables, not Kafka/outbox.**
Decision: new `tour_progress`/`tour_events` tables + `dap.routes.ts` in `apps/event-service`, following
`search-analytics.routes.ts`'s proven shape exactly (not the outbox/Kafka business-event pipeline). Why:
event-service already owns cross-cutting platform-capability admin surfaces (DLQ, Saga, Schema Registry,
Projections, Performance, all reachable at `/admin/distributed/*`) — a DAP analytics surface is the same
kind of concern, not a business domain, so it doesn't belong in accounting/sales/purchase/etc. Kafka/outbox
is the wrong weight class for high-volume per-step UI telemetry (built for cross-service saga/projection
rebuilding); the search-analytics precedent proves a direct-write table is the right-sized, already-trusted
pattern for exactly this shape of data in this codebase.

**ADR-4 — Content authored as git-versioned TypeScript, not a DB-backed CMS.** Decision confirmed with the
user (see `00_CURRENT_STATE_ASSESSMENT.md` §5) — files now, schema kept plain-data/component-decoupled so
a CMS could be added additively later. Why: a CMS is a real sub-project (tables, admin screens, permissions,
a content-versioning UI) with no current demand signal (no non-engineer content team exists yet); shipping
on files matches how `docs-site` and the current `HELP_CONTENT` are already managed, and PR review gives
free correctness checking (a Zod-validated TS file that's wrong fails CI; a CMS entry that's wrong fails
silently in production).

**ADR-5 — Interactive-mode "required actions" via a DOM CustomEvent contract, not deep component coupling.**
Decision: pages that want an interactive tour step to gate on a real action (e.g., "user must submit this
GRN") dispatch `new CustomEvent('erp:tour-action', { detail: { action: 'grn-submitted' } })` at the natural
point in their existing submit handler; `useTourAction` listens for it while that step is active. Why: at
168-page scale, a tour engine that reaches into arbitrary component internals to detect "did the user
finish this form" would be a permanent maintenance burden and a source of tours silently breaking whenever
an unrelated component refactors. A one-line opt-in event dispatch per interactive step keeps the coupling
in one direction and trivially greppable (`erp:tour-action`).

**ADR-6 — POS is out of scope for DAP-1.** Decision: `apps/pos-frontend` gets no tour engine in this phase.
Why: POS currently has zero Help/Info affordance of any kind (confirmed by both the 2026-07-15 audit and
this session's research) — adding tours before a baseline Help surface exists would build on nothing. This
is a real, tracked gap for a later phase (`02_ROADMAP.md`), not a silent omission.

**ADR-7 — Analytics summary dashboard deferred to DAP-2; the write-path ships in DAP-1.**
Decision: `POST /dap/events` and the `tour_events` table ship in DAP-1 (the engine needs somewhere to send
events, and this proves the schema end-to-end); the aggregate `GET` summary endpoint and its admin-facing
dashboard page (drop-off-by-step, completion-time, most-replayed) are DAP-2. Why: the dashboard is
additive reporting UI, not part of "can a user take a tour and have it resume correctly" — deferring it
keeps DAP-1 to one verifiable vertical slice instead of also shipping an unvalidated reporting surface
with no real usage data yet to validate its design against.
