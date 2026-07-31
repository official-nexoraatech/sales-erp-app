# 00 — Current State Assessment

Code-verified 2026-07-19 (direct file reads + a full-repo research pass). This is not a greenfield build —
read this before designing or re-deriving anything below.

## 1. What already exists and works

`apps/web-frontend/src/components/help/` (7 files: 4 components + 3 tests):

- **`HelpPanel.tsx`** (~1170 lines) — a right-side drawer, opened via the `?` shortcut or header icon.
  Real dialog semantics (`role="dialog"`, `aria-modal`, focus trap via the shared `useFocusTrap` hook,
  Escape-to-close), real cross-route search, a keyboard-shortcuts link, a What's New link, and a
  permission-gated "System diagnostics" link (`PERMISSIONS.PERFORMANCE_VIEW`). Content is
  `HELP_CONTENT: Record<route, {title, description, tasks, guideUrl?}>` — currently **~60 routes**
  hardcoded as one object literal inside the component file (lines 40–910 as of this session's
  uncommitted diff), each `guideUrl` pointing into `apps/docs-site`.
- **`OnboardingChecklist.tsx`** — a floating first-run checklist, 7 static steps (org → branches → team →
  customers → items → opening balances → first invoice), each navigating to a route on click. Completion
  state: `localStorage['erp_onboarding_completed']` (a `Set<string>`), no backend persistence, no
  cross-device sync. This is the closest thing to "progress tracking" that exists today, and it is
  checklist-only — no DOM targeting, no spotlight/overlay, no step-by-step in-page guidance.
- **`WhatsNewModal.tsx`** — dated release-note entries, real content not placeholders. This already
  satisfies the "What's New Tour" requirement in spirit, just not per-tour-versioned (see ADR-4).
- **`ShortcutsModal.tsx`** — static keyboard-shortcut list, built on the shared `Modal` component.

`apps/docs-site` — a real, substantial documentation site, hand-authored **static HTML/CSS/vanilla-JS**
(not React, not MDX; only dependency is Vite itself, used purely as a static server on port 5175). 12
module pages under `public/{module}/index.html`, each with Client/Super Admin/Developer/Audit tracks
addressed by URL hash, plus shared chrome (`public/shared/docs-shell.js`) providing dark mode, print, and
a **client-side-only** search that indexes just the currently-loaded page's DOM — no cross-module index,
no backend search API, no JSON manifest of any kind. `HelpPanel` consumes it the only way it's consumable:
hardcoded `${DOCS_SITE_URL}/{module}/index.html#{module}/{track}/{page}` links, opened in a new tab.

**A prior session's audit already reached the DAP gap analysis independently:**
`ERP-PLANNING/THEME_HELP_ENTERPRISE_AUDIT_2026-07-15.md` (essential reading) code-verified this exact
surface and found: _"Guided tours/onboarding: Partial — static checklist exists, not a
spotlight/walkthrough tour"_ (§2.2), _"Tooltips: Missing — no `Tooltip`/`role='tooltip'` component exists
anywhere"_ (§2.2), and _"Role-based help content: Missing — `HELP_CONTENT` has zero permission/role
checks"_ (§2.2). That session **explicitly chose to skip building a guided tour** — quoting its own
summary: _"a full tour was judged the largest, most speculative remaining item"_ — a deliberate scope cut
by the user, not an oversight. This DAP initiative is the follow-up to that decision, now at much larger
scope, not a correction of a missed requirement.

## 2. What is genuinely greenfield

Confirmed by full-repo search, not assumed:

- **No tour/walkthrough library anywhere** — grepped every `package.json` for
  `joyride|shepherd|intro.js|reactour|driver.js`: zero matches. (Also: not needed — building custom was
  an explicit constraint from the start.)
- **No spotlight, tour, or walkthrough component exists** in either frontend.
- **No reusable `Tooltip` or `Popover` component exists** anywhere in `packages/ui` or either app — only
  native `title=` attributes and recharts' own chart-hover tooltip. `usePopoverPosition` (a positioning
  _hook_, used internally by `Combobox`/`Select`/`DatePicker`) is the one reusable piece — real anchor-math
  for placing an overlay next to a target element, not a rendered component.
- **No `Stepper` component exists.**
- **`apps/pos-frontend` has zero Help/Info affordance of any kind** — not even for its own documented
  F-key shortcuts (confirmed independently by both the audit doc and this session's research). POS is
  entirely out of DAP-1's scope but is a real, known gap for a later phase.
- **No prior DAP/tour/walkthrough planning document exists anywhere in `ERP-PLANNING/`** (word-boundary
  and exact-phrase search across all subdirectories, including `production-gap-prompts/`).

## 3. RBAC — the mechanism the DAP must plug into, not duplicate

- **286 permission constants**, single source of truth: `packages/shared-types/src/permissions.ts`.
  `apps/web-frontend/src/constants/permissions.ts` is a 3-line re-export
  (`export { PERMISSIONS, type Permission } from '@erp/types';`) — the pattern any new `TOUR_*`
  permission (if ever needed) must follow.
- **Hooks**: `usePermission(permission): boolean`, `useHasAnyPermission(permissions[]): boolean`
  (`apps/web-frontend/src/hooks/usePermission.ts`), thin wrappers over
  `useAuthStore(s => s.hasPermission(...))`, itself a flat `user.permissions.includes(permission)` check
  (`store/auth.store.ts`).
- **Gate component**: `<PermissionGate permission="X" fallback={...}>`
  (`components/PermissionGate.tsx`). **Route guard**: `PermissionRoute` (inline in `App.tsx:257-266`,
  deliberately ANY-match on `string | string[]` — a comment there documents this as a fix for a past RBAC
  bug where single-permission gating was too strict).
- **Role defaults** (seed data at tenant provisioning): `apps/tenant-service/src/rbac/role-defaults.ts` —
  **13 real roles**: `OWNER, ADMIN, SALES_MANAGER, CASHIER, PURCHASE_MANAGER, ACCOUNTANT,
INVENTORY_MANAGER, HR_MANAGER, STAFF, ACCOUNTANT_SUPERVISOR, AUDITOR, DATA_OFFICER, SUPER_ADMIN`. This
  list does **not** match the illustrative role list in the DAP kickoff brief (which names roles like
  "Branch Manager", "Warehouse Manager", "Customer Portal User", "Viewer" that don't exist in this
  codebase yet) — see ADR-2 for how the architecture avoids depending on any specific role list at all.

Relevant real permission constants for the DAP-1 pilot workflow (grepped directly, not guessed):
`GRN_VIEW/CREATE/UPDATE/APPROVE/CANCEL`, `STOCK_VIEW/ADJUST/TRANSFER/PHYSICAL_VERIFY/REPORT_VIEW`,
`ACCOUNT_VIEW/CREATE/UPDATE`, `JOURNAL_VIEW/CREATE`, `REPORT_VIEW`, `DASHBOARD_VIEW`. Purchase-order and
GST-specific constants exist under different prefixes than guessed (e.g. `PO_APPROVE` appears in the audit
doc's prose, not `PURCHASE_ORDER_APPROVE`) — exact names for every pilot step get grepped fresh at content-
authoring time in DAP-1, not assumed from this doc.

## 4. Analytics — three unrelated systems, one is the right template

- **(a) Frontend analytics stub**: `apps/web-frontend/src/lib/analytics.ts` — pluggable
  `AnalyticsProvider` (`track`/`page`), defaults to a no-op, only ever called from the public marketing
  site's `SEO.tsx`. Not wired to a real provider. Usable later as a provider-agnostic escape hatch, not
  load-bearing for DAP-1.
- **(b) Kafka + outbox event-sourcing** (`apps/event-service/src/outbox/OutboxRelayWorker.ts`) — the
  mechanism for cross-service **business** events (`INVOICE_CONFIRMED`, `STOCK_DEDUCTED`, etc.), with a
  full admin console already live at `/admin/distributed/*` (DLQ, Saga Orchestrator, Schema Registry,
  Projections, Performance). **Wrong weight class for tour telemetry** — built for saga/projection
  rebuilding across services, not high-volume, single-service UI interaction logging. Not used by the DAP.
- **(c) Direct-write analytics table** — `apps/search-service/src/api/search-analytics.routes.ts` +
  `apps/web-frontend/src/pages/admin/SearchAnalyticsPage.tsx`. A dedicated Postgres table written directly
  on every interaction (no Kafka), one permission-gated summary endpoint, one React Query-powered admin
  page (`ERPPageHeader` + `StatCard` grid). **This is the DAP's template** — see ADR-3.

## 5. Decisions already made with the user (do not re-litigate)

Confirmed via `AskUserQuestion` before this folder was created:

1. **Pilot scope (DAP-1)**: a cross-module **business-workflow** tour —
   Purchase Order → GRN → Stock → Accounting → GST → Reports → Dashboard — not a single-module tour.
   Chosen specifically because it proves cross-module linkage and the "business education" requirement in
   one pass, and because it's the exact worked example the kickoff brief itself used.
2. **Content authoring model**: git-versioned TypeScript files (extending the existing `HELP_CONTENT`
   pattern, properly extracted and schema-validated), reviewed via normal PR flow — **not** a DB-backed
   CMS with an admin UI. A CMS was explicitly considered and deferred: it's real added scope (new tables,
   admin screens, permissions, a content-versioning UI) that would be its own sub-project before any tour
   content could ship. The content schema is kept plain-data and component-decoupled so a CMS could be
   layered on additively later without a rewrite, if that need materializes.
3. **Pacing**: write the architecture, then continue straight into the DAP-1 pilot implementation without
   pausing for review — the user explicitly chose "keep going" over "pause after the doc."

## 6. Design-system primitives available to build on (not reinvent)

`useFocusTrap` (focus containment, already used by `Modal`/`ERPDrawer`/`ERPCommandPalette`/`HelpPanel`),
`usePopoverPosition` (anchor-relative placement math, from `packages/ui`), `Modal`'s overlay conventions
(backdrop, body-scroll lock, `role="dialog"`, z-index tier), `ERPEmptyState`, `ERPPageHeader`, `StatCard`.
Z-index scale (`packages/design-tokens/tokens.css`): `--z-modal: 600`, `--z-popover: 700`,
`--z-toast: 900` — **no tour/tooltip tier exists yet** (see ADR-1).

## 7. Full page inventory (what "every page" actually means)

168 page components across 17 modules in `apps/web-frontend/src/pages/` (+ 4 root pages), plus
`apps/pos-frontend` (separate app, currently zero Help affordance):

| Module     | Pages |     | Module     | Pages |
| ---------- | ----- | --- | ---------- | ----- |
| accounting | 18    |     | crm        | 8     |
| hr         | 15    |     | gst        | 8     |
| sales      | 13    |     | production | 8     |
| inventory  | 11    |     | reports    | 8     |
| purchase   | 11    |     | settings   | 8     |
| items      | 10    |     | auth       | 4     |
| admin      | 7     |     | customers  | 3     |
| marketing  | 6     |     | suppliers  | 2     |
|            |       |     | users      | 2     |

This is the real scope "every page" maps to — it's the denominator `02_ROADMAP.md`'s phases work through,
not the illustrative module list in the kickoff brief (which includes items like "Job Work", "Consignment",
and "Barcode" that are real, but live as pages _inside_ `production/`, not separate top-level modules).
