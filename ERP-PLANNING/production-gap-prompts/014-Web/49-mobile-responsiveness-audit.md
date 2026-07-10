# [PG-053] Mobile Responsiveness Audit & Fixes

> Template version 1.0. Every gap-prompt file in this tree must follow this exact section order. Do not add sections; do not omit sections that apply. If a section genuinely does not apply to this gap, write "Not applicable — <one-line reason>" instead of deleting it, so the structure stays diffable across files.

**Category:** Web
**Priority:** Medium
**Complexity:** L — not because responsive infrastructure needs building (much of it already exists, see below), but because auditing and fixing gaps across ~90 pages one-by-one is inherently a large surface area, even at a realistic (not full-phone-parity) scope.
**Depends on:** none
**Blocks:** none
**Primary service(s)/package(s):** apps/web-frontend

---

## Overview

- **Business objective:** `web-frontend` is a full B2B back-office ERP SPA — data tables, dense dashboards, multi-step forms, a command palette. The business question is not "should this look good on a phone in a coffee shop" (it's not a consumer app) but "can a store manager or approver pull this up on a tablet, or a phone in a pinch, to check a number or approve something, without the layout breaking." Today there is no documented mobile-responsiveness pass, and — per this pass's direct findings below — the picture is **better than the task's initial framing assumed**: real breakpoint infrastructure and a real mobile-aware navigation shell already exist, shipped as part of this codebase's recent design-system work. The actual gap is narrower and more specific than "no mobile support at all": it's inconsistent application of already-existing responsive patterns across individual pages, not a missing foundation.
- **Current implementation — what this pass actually found, grounded in direct reads (correcting the task's framing where it doesn't match reality):**
  - **Real breakpoint infrastructure exists.** `apps/web-frontend/src/hooks/useMediaQuery.ts` exports a working `useMediaQuery(query)` hook plus `BREAKPOINTS = { mobile: '(max-width: 767px)', tablet: '(min-width: 768px) and (max-width: 1023px)' }`, explicitly documented as sourced from `ERP-PLANNING/02_ERP_NAVIGATION_ARCHITECTURE.md §5, §18` — i.e. mobile/tablet breakpoints were a deliberate, specified design decision, not an afterthought.
  - **The navigation shell is already genuinely mobile-aware.** `apps/web-frontend/src/components/Layout.tsx` uses `isMobile`/`isTablet` (via `useMediaQuery`) to drive real behavioral differences: a collapsible/overlay sidebar that becomes a slide-in mobile drawer (`mobileDrawerOpen` state, an `absolute inset-y-0 left-0 w-60 ... shadow-token-lg` drawer panel), keyboard shortcuts for sidebar collapse/expand are disabled on mobile/tablet (`if (!isMobile && !isTablet) setSidebarCollapsed(...)`), and search-bar labels hide on narrow viewports (`<span className="hidden sm:inline">Search...</span>`). This is not a stub — it's a working, considered responsive nav implementation.
  - **Tailwind v4, no custom breakpoint override found.** `apps/web-frontend/package.json` confirms Tailwind v4 (`tailwindcss: ^4.0.0`, `@tailwindcss/vite`), and no `tailwind.config.*` file exists (v4's CSS-first config) — a grep of `packages/design-tokens/tokens.css` for `screens`/`@media`/breakpoint tokens found only the existing `prefers-reduced-motion` media query, no `@theme` screens override. This means Tailwind's **default** breakpoints (`sm:640px, md:768px, lg:1024px, xl:1280px`) are in effect everywhere `md:`/`lg:`/`sm:` classes are used — consistent with, but not identical in cutoff to, `useMediaQuery`'s hand-rolled `768px`/`1024px` mobile/tablet boundaries (close enough in practice, but worth noting as two parallel breakpoint systems that happen to roughly agree rather than one shared source of truth — flag for a future consolidation, not this package's job to fix).
  - **Responsive utility classes are already used broadly, not absent.** A repo-wide grep for `md:|lg:|sm:|grid-cols|flex-col|overflow-x-auto` across `apps/web-frontend/src` returned **185 matches across 91 files** — e.g. `DashboardPage.tsx` alone has 9 responsive-grid declarations (`grid grid-cols-2 md:grid-cols-4 gap-4` for stat tiles, `grid grid-cols-1 lg:grid-cols-3 gap-4` for chart panels) that correctly collapse to a single/double column on narrow viewports.
  - **The gap is real but narrower: individual pages inconsistently apply what already exists.** `apps/web-frontend/src/pages/customers/CustomersPage.tsx` (checked as a representative data-table-heavy page) has **zero** responsive classes anywhere in its JSX — its filter/search toolbar is a bare `<div className="flex gap-3 mb-4">` with no `flex-wrap` and no mobile stacking, meaning on a narrow viewport its filter controls will either overflow or get uncomfortably cramped rather than wrapping/stacking. This is the actual, representative shape of the gap: not "no responsive system," but "this specific page never used the responsive classes/patterns that `DashboardPage.tsx` and `Layout.tsx` already demonstrate work."
  - **`ERPDataGrid` (the shared data-table component used across the app) handles narrow viewports via horizontal scroll only, not a card-view fallback.** Confirmed by direct read of `apps/web-frontend/src/components/erp/ERPDataGrid.tsx`: the table is wrapped in `<div className="overflow-x-auto"><table className="w-full text-sm ...">` (line 228) — on a phone-width viewport, a table with many columns simply scrolls horizontally rather than reflowing into a stacked card layout per row. This is a **reasonable, deliberate, common back-office-ERP pattern** (horizontal-scroll tables are a well-established, low-cost way to keep dense tabular data usable on narrow screens without a second "mobile card" rendering mode to build and maintain) — not a bug, but worth stating explicitly as the chosen tradeoff rather than silently accepting it as an oversight, since a naive "make it mobile-friendly" ask might otherwise assume a card-view rewrite is expected.
- **Current architecture:** the recently-shipped design-system work (density modes, tenant branding, axe-core accessibility — see `ERP-PLANNING/phase-completions/` entries referenced in project memory) already established `useMediaQuery`/`BREAKPOINTS` and `Layout.tsx`'s mobile drawer as the platform's responsive foundation. This package's job is **not** to rebuild any of that — it's to audit individual pages against that already-proven foundation and close the specific, page-by-page gaps (missing `flex-wrap` on toolbars, missing responsive grid collapse on multi-column forms, etc.), and to make an explicit, realistic scope decision about how far "mobile support" should go for a B2B back-office ERP.
- **Current limitations:** no page-by-page audit has ever been done; the two representative checks performed in this pass (`DashboardPage.tsx` — largely fine; `CustomersPage.tsx` — a real, unaddressed gap) suggest inconsistency is the norm across the ~90 pages, not a uniform failure or a uniform success.

## Existing Code Analysis

- **What already exists and should be reused:** `useMediaQuery`/`BREAKPOINTS` (`apps/web-frontend/src/hooks/useMediaQuery.ts`) — do not build a second responsive-detection hook. `Layout.tsx`'s mobile-drawer/overlay-sidebar pattern — do not touch or rebuild the nav shell itself; it already works. `ERPDataGrid`'s existing `overflow-x-auto` wrapper — the deliberate, already-correct choice for how data tables handle narrow viewports; do not attempt a card-view rewrite of this shared component as part of this package (that would be a much larger, separate redesign with its own tradeoffs, not what "mobile responsiveness audit & fixes" as scoped here calls for). `DashboardPage.tsx`'s `grid-cols-2 md:grid-cols-4`-style responsive-grid pattern — the template to apply consistently across other multi-tile/multi-panel pages found lacking it.
- **What should never be modified:** the density-mode system, tenant-branding/theming (`TenantThemeSync`, `tokens.css`), and axe-core accessibility wiring — all recent, working, unrelated design-system investments explicitly called out by the task framing as off-limits for this package (no rebuilding). `Layout.tsx`'s core mobile-drawer/sidebar-collapse logic must not be refactored as part of a page-level audit — if a genuine bug is found in it during this pass, it should be flagged and fixed narrowly, not restructured.
- **Prior related work:** the recent design-system phases (density modes, tenant branding, axe-core accessibility expansion — referenced in this project's own memory of prior sessions) already built the responsive foundation this package audits against; no prior phase-completion report specifically claims a mobile-responsiveness pass was done, and this pass's direct checks confirm that claim gap is real (inconsistent, not absent, coverage) — the "01_ERP_UI_AUDIT.md"/similar audit docs referenced elsewhere in this planning tree should be spot-checked for staleness before trusting any specific page-count claim there, per this repo's own established pattern of audit docs going stale as concurrent work lands (see this tree's own Master Roadmap correction note about the tenant-branding radius-scale claim).

## Architecture

- **Scope decision, stated explicitly rather than picked silently, per this template's own instruction:** given this is a B2B back-office ERP (not a consumer app), full phone-optimized data-entry parity (e.g. redesigning every multi-step invoice-creation form for one-handed phone use) is **not** the right bar and is explicitly **out of scope**. The realistic, recommended target is: **"usable on tablet (768-1023px, matching `BREAKPOINTS.tablet`) for read/browse/approve workflows, and functional-but-not-optimized on phone (<768px) for the same read/approve workflows"** — i.e. a store manager should be able to open this app on a tablet or phone, view a dashboard, look up a customer/invoice/stock level, and approve a pending item (leave request, purchase order, discount override) without the layout breaking or controls becoming unreachable. Complex multi-line-item data-entry (creating a 20-line invoice, a detailed stock adjustment) is explicitly **not** being redesigned for phone-first one-handed entry — that would be a much larger, differently-scoped effort with a different cost/benefit case for a back-office tool.
- **Audit methodology:** rather than redesigning components speculatively, this package should systematically walk the ~90 pages under `apps/web-frontend/src/pages/` at three representative viewport widths (a phone width e.g. 375px, a tablet width e.g. 820px, and confirm no regression at desktop) using the existing `useMediaQuery`/Tailwind breakpoints as the only responsive mechanism — no new breakpoint system, no new detection hook. Prioritize pages by the "read/approve" scope decision above: dashboards, detail/view pages (invoice detail, customer detail, employee detail), and approval-action pages (leave approval, PO approval) are Priority 1; complex multi-line creation/edit forms are Priority 2 (fix egregious breakage like overflow-causing-horizontal-scroll-of-the-whole-page, but don't attempt full redesign); admin/settings/distributed-systems pages (DLQ monitor, saga monitor, schema registry — low real-world mobile-usage likelihood for an ops-only surface) are Priority 3/lowest.
- **Fix pattern (reuse, not invent):** for each page found lacking responsive classes, apply the same small set of already-proven patterns found in this pass: (1) toolbar/filter bars gain `flex-wrap` (and, where dense, an explicit `flex-col sm:flex-row` stack-then-row pattern already implicitly used elsewhere per the 185-occurrence grep); (2) multi-column stat/summary grids gain the `grid-cols-1 md:grid-cols-N` collapse pattern already used in `DashboardPage.tsx`; (3) data tables keep relying on `ERPDataGrid`'s existing `overflow-x-auto` — no per-page table-specific fix needed unless a page wraps `ERPDataGrid` in an outer container that itself clips or fights the scroll (check for this specifically, since an outer `overflow-hidden` container would silently defeat the grid's own scroll wrapper).

## Database Changes

Not applicable — pure frontend responsive-CSS/layout work, no backend or schema involvement.

## Backend

Not applicable — backend-only gap sections do not apply; this is entirely a frontend audit and fix pass.

## Frontend

- **Audit deliverable:** a page-by-page checklist (which of the ~90 pages under `apps/web-frontend/src/pages/` were checked at phone/tablet width, pass/fail, fix applied or deferred-with-reason) — this is itself a real artifact of this package, not just code changes, since "mobile responsiveness" without a record of what was actually checked is not independently verifiable later.
- **Fixes, following the patterns above:** `CustomersPage.tsx`'s filter toolbar (`<div className="flex gap-3 mb-4">` → add `flex-wrap`, confirmed concrete first fix from this pass's direct read) and any other Priority-1 page found with the same bare-`flex`-no-wrap toolbar pattern (a repo-wide grep for `className="flex gap-` without an accompanying `flex-wrap`/`flex-col` on the same or a parent element is a fast way to enumerate candidates before manually checking each at narrow width).
- **No new shared component needed** for the vast majority of fixes — this is Tailwind-class-level tuning of existing pages using existing hooks/utilities, not new component development. A new shared component would only be justified if a genuinely new, repeated pattern emerges across many pages during the audit (e.g. if a "stacked mobile filter bar" wrapper proves useful enough to extract) — do not build one speculatively before the audit surfaces that need.

## API Contract

Not applicable — no backend/API surface is touched by this package.

## Multi-Tenant Considerations

Not applicable beyond the existing tenant-branding system (`TenantThemeSync`, density modes) already being responsive-aware and unaffected by this package — no per-tenant responsive-behavior variation is being introduced.

## Integration

- **web-frontend only.** No other of the 14 services or `pos-frontend` (a separate, already-more-mobile-oriented frontend per prior session findings — not this package's concern) is touched.

## Coding Standards

- Reuses `useMediaQuery`/`BREAKPOINTS` and Tailwind's default `sm:/md:/lg:` breakpoints exclusively — no new responsive-detection mechanism, no new CSS breakpoint system, per this template's Coding Standards guidance to confirm reuse over invention. Any page-level fix should look like the same kind of Tailwind utility-class addition already demonstrated correct in `DashboardPage.tsx`/`Layout.tsx`, not a bespoke per-page solution.

## Performance

Not applicable beyond the general note that this package adds no new JavaScript logic (`useMediaQuery` already exists and is already used elsewhere) — fixes are CSS-class-level, with no runtime performance implication.

## Security

Not applicable — pure layout/CSS work, no new data exposure, permission, or input-validation surface.

## Testing

- Extend `apps/web-frontend`'s existing Playwright E2E suite (per this codebase's prior E2E-suite work) with a small number of viewport-width smoke checks on the Priority-1 pages (dashboard, a detail page, an approval page) at phone (375px) and tablet (820px) widths — asserting no horizontal page-level scroll (`document.documentElement.scrollWidth <= viewport width`) and that key interactive elements (nav toggle, primary action button) remain visible/clickable. This is a smoke-level regression guard, not full visual-regression testing — a full visual-diff pipeline is a separate, larger investment not scoped here.
- Manual verification (per this codebase's `run` skill convention) at phone/tablet widths for every Priority-1 page fixed, since responsive layout bugs are often easier to eyeball than to assert programmatically.

## Acceptance Criteria

- [ ] A documented, explicit scope decision exists (this document) stating mobile support targets "tablet-usable read/approve workflows," not full phone-optimized data entry — done, per the framing above.
- [ ] A page-by-page audit checklist exists covering at minimum every Priority-1 page (dashboards, detail/view pages, approval-action pages).
- [ ] `CustomersPage.tsx`'s filter toolbar (and any other Priority-1 page with the same bare-flex-no-wrap pattern) gains `flex-wrap` and no longer overflows/clips at 375px width.
- [ ] No Priority-1 page exhibits page-level horizontal scroll at 375px or 820px width (verified manually and/or via the new Playwright smoke checks).
- [ ] `ERPDataGrid`'s existing horizontal-scroll pattern is explicitly confirmed as the intended mobile behavior for data tables (not silently "fixed" into a card-view rewrite that wasn't scoped or asked for).
- [ ] `pnpm --filter @erp/web-frontend test` and the extended Playwright suite pass.

## Deliverables

- **Files to create:** a page-by-page audit checklist (format TBD at implementation time — could live as a section in this document's own tracking, or a lightweight separate tracking file, following whatever convention this planning tree already uses for tracking large multi-page audits), new/extended Playwright viewport-smoke-check spec file.
- **Files to modify:** `apps/web-frontend/src/pages/customers/CustomersPage.tsx` (confirmed fix: add `flex-wrap` to the filter toolbar) plus whichever other Priority-1 pages the audit finds with the same or similar gaps (exact list only known after the audit is performed — this document intentionally does not pre-guess the full fix list beyond the one concretely confirmed page, per this template's "verify via grep/read before writing" instruction, which this pass has already partially done for two representative pages but not all ~90).
- **Migrations:** none.
- **APIs added/changed:** none.
- **Events added/changed:** none.
- **Tests added:** Playwright viewport-smoke-check spec covering Priority-1 pages at phone/tablet widths.

---

## Context Preservation (for a fresh AI session with no prior history)

**Previous Work Summary:** this ERP's `web-frontend` already has real, working responsive infrastructure — `useMediaQuery`/`BREAKPOINTS` (`apps/web-frontend/src/hooks/useMediaQuery.ts`, sourced from a documented navigation-architecture spec) and a genuinely mobile-aware `Layout.tsx` (collapsible/overlay sidebar becoming a slide-in mobile drawer, hidden search labels on narrow viewports, keyboard-shortcut gating on mobile/tablet). Tailwind v4 (CSS-first, no custom `tailwind.config.*`, default `sm:640/md:768/lg:1024/xl:1280` breakpoints) is in use, and a repo-wide grep found 185 responsive-class occurrences across 91 files — this is **not** a greenfield mobile-support gap. Direct checks of two representative pages found `DashboardPage.tsx` already correctly responsive (9 `grid-cols-N md:grid-cols-M`-style declarations) while `CustomersPage.tsx` (a data-table-heavy page) has **zero** responsive classes, including a bare `flex gap-3 mb-4` filter toolbar with no `flex-wrap` that will overflow/clip on narrow viewports. The shared `ERPDataGrid` component handles narrow-viewport data tables via an `overflow-x-auto` horizontal-scroll wrapper (not a card-view fallback) — a deliberate, reasonable, already-in-place choice for a back-office ERP, not a bug to fix.

**Current Objective:** perform a real, page-by-page mobile/tablet-responsiveness audit across `apps/web-frontend/src/pages/` (~90 pages), applying already-proven, already-existing patterns (`useMediaQuery`/Tailwind breakpoints, `flex-wrap` toolbars, `grid-cols-N md:grid-cols-M` collapse) to close gaps found — explicitly scoped to "tablet-usable read/approve workflows," not full phone-optimized multi-line-item data entry, since this is a B2B back-office ERP, not a consumer app. Do not rebuild any of the existing density-mode/tenant-branding/axe-core/nav-shell design-system work — this package audits against that foundation, it doesn't replace it.

**Architecture Snapshot:** (1) `useMediaQuery`/`BREAKPOINTS` and Tailwind's default breakpoints are two parallel-but-roughly-agreeing responsive mechanisms already in place — use both as they exist, don't unify them as part of this package (flag for a future consolidation); (2) `Layout.tsx` already solves the nav-shell mobile problem correctly; (3) `ERPDataGrid`'s horizontal-scroll pattern is the deliberate, accepted mobile behavior for data tables platform-wide; (4) `DashboardPage.tsx` is the positive reference example, `CustomersPage.tsx` is the confirmed-gap reference example — both should be read before starting the audit, as concrete before/after examples of what "done" and "not done" look like in this codebase.

**Completed Components:** breakpoint hook + mobile nav shell + widespread (if inconsistent) responsive-grid usage on dashboards — all pre-existing, confirmed working, do not rebuild.

**Pending Components:** the full ~90-page audit itself (only 2 pages were spot-checked in this planning pass — `DashboardPage.tsx` and `CustomersPage.tsx` — as representative examples, not an exhaustive audit); a possible future consolidation of the two parallel breakpoint systems (`useMediaQuery`'s hand-rolled values vs. Tailwind's defaults) is explicitly out of scope here.

**Known Constraints:** full phone-optimized data-entry parity is out of scope by explicit product-shape decision (back-office B2B tool, not consumer app) — do not let the audit scope-creep into redesigning complex multi-line forms for one-handed phone use.

**Coding Standards:** reuse `useMediaQuery`/`BREAKPOINTS` and Tailwind's existing breakpoints exclusively; match the exact Tailwind-utility-class style already demonstrated in `DashboardPage.tsx`/`Layout.tsx` for any new responsive class added to a page found lacking one.

**Reusable Components:** `useMediaQuery` (`apps/web-frontend/src/hooks/useMediaQuery.ts`), `Layout.tsx`'s mobile-drawer pattern (reference only, do not modify), `ERPDataGrid`'s `overflow-x-auto` wrapper (reference only, do not rewrite into a card view), `DashboardPage.tsx`'s `grid-cols-N md:grid-cols-M` pattern (the template to replicate on other pages).

**APIs Already Available:** not applicable — no backend/API involvement.

**Events Already Available:** not applicable.

**Shared Utilities:** `useMediaQuery`/`BREAKPOINTS` only new-ish utility relevant here (already exists, already used elsewhere) — no other new shared utility needed.

**Feature Flags:** none — this is a universal UX-quality fix, not an opt-in feature.

**Multi-Tenant Rules:** not applicable — no tenant-specific responsive behavior is being introduced; existing tenant-branding/theming is unaffected.

**Security Rules:** not applicable — no new permission/data-exposure surface.

**Database State:** not applicable — no schema involvement.

**Testing Status:** no existing viewport/responsive-specific test coverage found; `apps/web-frontend`'s existing Playwright E2E smoke suite (per prior session's "first E2E suite" work) is the natural place to add a small number of viewport-width smoke checks, not a full visual-regression pipeline.

**Next Session Plan:** given L complexity from sheer page count, split as: (1) session A — complete the page-by-page audit checklist across all ~90 pages (read/screenshot at phone+tablet width, record pass/fail per page, no fixes yet); (2) session B — apply fixes to all Priority-1 pages found failing, plus the Playwright smoke-check additions; (3) session C (optional, lower priority) — Priority-2 page fixes (egregious-breakage-only on complex creation/edit forms), Priority-3 admin/ops pages only if time permits.

**Prompt for the Next Session:** "Before implementing `ERP-PLANNING/production-gap-prompts/014-Web/49-mobile-responsiveness-audit.md` (PG-053), re-read `apps/web-frontend/src/pages/DashboardPage.tsx` (positive example) and `apps/web-frontend/src/pages/customers/CustomersPage.tsx` (confirmed-gap example) as calibration before auditing further pages — this document's scope is explicitly 'tablet-usable read/approve workflows,' not full phone-optimized data entry, and explicitly does not touch `Layout.tsx`'s nav shell, `ERPDataGrid`'s horizontal-scroll table pattern, or any density-mode/tenant-branding/axe-core work, all of which are already correct and out of scope. Start with session A (the full page-by-page audit checklist) per the Next Session Plan before making any fixes."
