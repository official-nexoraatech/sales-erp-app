# NEXORAA ERP — Navigation Architecture

**Status:** Target specification (supersedes ad hoc current behavior documented in `01_ERP_UI_AUDIT.md`)
**Scope:** `apps/web-frontend` primarily. `apps/pos-frontend` gets a reduced profile — see §16.
**Relationship to existing code:** `Layout.tsx`, `navigation.ts`, `ERPCommandPalette.tsx`, `ERPBreadcrumb.tsx`, `NotificationsPanel.tsx`, `ThemeContext.tsx` already implement large parts of this correctly (see `01_ERP_UI_AUDIT.md` §10). This document is the law they must fully conform to; it does not ask for a rebuild where one isn't needed.

---

## 1. Sidebar Philosophy

The sidebar is the **primary wayfinding surface** for an 8-hour/day power user, not a marketing nav bar. It optimizes for:
1. **Recognition over recall** — a user should never need to remember where something lives; they scan a stable, alphabetically-grouped, always-in-the-same-place structure.
2. **Progressive disclosure** — 12+ top-level modules stay legible via collapsible groups, not by flattening or hiding modules behind menus-within-menus.
3. **Permission truth** — a hidden item is hidden because the user cannot use it, never because of a layout accident. Absence of a menu item is a legitimate way to communicate "not available to you."

The sidebar is never the only way to reach a destination. Every route reachable via sidebar must also be reachable via the command palette (§9) in ≤ 3 keystrokes — the sidebar is for browsing, the command palette is for retrieval.

---

## 2. Navigation Hierarchy & Nesting

- **Maximum nesting: 2 levels** (Group → Item → optional Children). No level-3 flyouts. If a module needs a 3rd level, it is not a nav problem — it belongs inside that module's own workspace (tabs, sub-pages), not the sidebar. This matches the current `navigation.ts` structure and must not regress.
- A **Group** is a section header (e.g. "SALES & CRM"), never itself clickable/routable.
- An **Item** is a routable leaf or a parent with Children. An Item with Children is not itself a route target — clicking it expands/collapses, it does not navigate (avoids the "which do I click" ambiguity common in Fiori/NetSuite).
- Items within a Group are ordered by frequency of use, not alphabetically — Dashboard/Workspace items first, administrative items last.

## 3. Menu Grouping & Module Organization

- Groups map 1:1 to a business domain (Sales & CRM, Inventory, Purchase, Accounting, Production, HR & Payroll, Analytics, Security, Platform Admin, etc.) — never to a technical/service boundary. A user should never need to know that "Distributed Systems" (DLQ/saga/schema-registry) is its own microservice; group it under an "Operations" or "System Health" heading a non-engineer can parse, or gate it entirely behind an internal-admin role so ordinary tenant users never see it.
- **Section headers** (Group labels) are uppercase, small-caps-weight, non-interactive, `text-tertiary` token color, with 24px top padding to the previous group and 8px bottom padding to the first item — enough whitespace to read as a section break without wasting vertical rhythm at 12+ groups.
- A **"WORKSPACE"** group always pins to the top: Dashboard, My Approvals, My Tasks — the personal, cross-module landing items every role needs regardless of permission set.

## 4. Sidebar Modes

| Mode | Width | Trigger | Behavior |
|---|---|---|---|
| **Expanded** | 240px | Default; manual pin toggle | Icon + label + chevron (if has children) + tooltip suppressed |
| **Compact (collapsed)** | 64px | Manual pin toggle | Icon only, label shown as tooltip on hover, children fly out as a popover menu anchored to the icon (not inline expansion, since there's no room) |
| **Hover-expand** | 64px → 240px on hover | Only active when pinned-compact | Sidebar temporarily overlays content at 240px on mouseenter, retracts on mouseleave with a 150ms delay (prevents flicker on diagonal mouse movement toward content) |
| **Mobile drawer** | 0 (hidden) → 280px overlay | Hamburger icon in header, or swipe-from-edge | Full-height overlay with a scrim; closes on route change, scrim click, or Escape |

State (`sidebarCollapsed`, per-group collapsed state) persists per-user via the existing `useUIStore` (zustand+persist) pattern — extend it, do not replace it.

## 5. Responsive Collapse Rules

This is the single biggest gap versus current code (`01_ERP_UI_AUDIT.md` §1.2 — no responsive collapse exists today).

| Breakpoint | Sidebar behavior |
|---|---|
| `< 768px` (mobile) | Sidebar is a hidden drawer by default (§4). Header shows a hamburger trigger. |
| `768–1023px` (tablet) | Sidebar defaults to **Compact** mode automatically (not user-chosen) to preserve content width; user can still manually pin Expanded, which then behaves as an overlay rather than pushing content. |
| `≥ 1024px` (desktop/laptop) | Sidebar defaults to **Expanded**, user's last manual choice is honored via persisted state. |
| `≥ 1920px` (ultra-wide) | Sidebar stays at 240px/64px (never scales up); reclaimed width goes to content max-width (§7), not to the sidebar. |

## 6. Sticky Behavior

- **Header:** `position: sticky; top: 0` — must be an explicit CSS rule, not incidental correctness from the scroll container (current code relies on `<main>` being the only scrollable region — fragile, must be made explicit per `01_ERP_UI_AUDIT.md` §1.5).
- **Sidebar:** `position: sticky; top: 0; height: 100vh` — never scrolls with page content; its own item list scrolls internally if it overflows viewport height (12+ groups already approaches this on 1080p laptop screens).
- **Breadcrumb:** lives inside the sticky header, not separately sticky.
- **Table headers, form section headers:** see `03_ERP_DESIGN_SYSTEM.md` (Table Standard, Form Standard) for content-level stickiness — out of scope here.

## 7. Content Width & Ultra-Wide Behavior

- Content area has no hard max-width by default — data-dense enterprise UI should use available space (design system §1.1 "Maximum Data Density").
- Exception: single-column content (a single form, a detail page with no side panel) caps at `1440px` centered, so a 3440px ultra-wide monitor doesn't stretch a 6-field form into unreadable line lengths. Multi-column/table/dashboard pages have no cap.
- Ultra-wide (`≥ 2560px`): dashboards and list pages may promote a 4th/5th grid column (e.g. KPI cards go from `md:grid-cols-4` to `2xl:grid-cols-5`) rather than leaving dead margin space.

## 8. Scrollbar Rules

- One scroll container per view: `<main>`. Sidebar scrolls independently only if its content overflows. No nested scroll regions inside page content except: data tables with `max-height` + sticky header, and code/log viewers.
- Custom scrollbar styling (thin, token-colored, `overlay` on hover) applies uniformly via a single global CSS class — never per-component ad hoc scrollbar CSS.

## 9. Global Search & Command Palette

Current implementation (`ERPCommandPalette.tsx`) is strong — Elasticsearch-backed, Ctrl+K, saved/recent searches, click-tracking (`01_ERP_UI_AUDIT.md` §10) — and is kept as the foundation. Target state adds an **action mode**:

- **Trigger:** `Ctrl/Cmd+K` from anywhere (existing, keep). Header search button is a secondary trigger (existing, keep).
- **Two modes in one palette, switched by prefix** (this is the actual gap — today only entity search exists):
  - Default / no prefix: entity search (existing behavior — customers, invoices, items, etc.)
  - `>` prefix: action/command mode — "Create Invoice," "Go to Settings," "Toggle Theme," "Switch Branch" — a static+dynamic registry of commands, permission-filtered the same way nav items are.
- Every sidebar-reachable route must have a corresponding command-mode entry — enforced by generating the command registry from `navigation.ts`, not hand-maintaining a duplicate list.
- Result grouping, recency, and analytics tracking (already built) extend to command-mode results with no separate infrastructure.

## 10. Recent Pages, Favorites, Pinned Menu

None of these exist today (`01_ERP_UI_AUDIT.md` §1.4) — this is new surface, not a fix.

- **Recent pages:** a lightweight client-side store (extend `useUIStore`, not a new store) tracks the last 8 visited routes (title + icon + path), shown as a "Recent" section at the top of the command palette's default (no-query) state and optionally as a compact strip under the WORKSPACE group in the sidebar.
- **Favorites:** any list-page row or detail page can be starred; favorites are tenant+user scoped, persisted server-side (not just localStorage, so they survive device switches) via a small `user-preferences` table/endpoint — this is the one piece of this document that requires new backend surface, flagged explicitly for `07_ERP_IMPLEMENTATION_PLAN.md`.
- **Pinned menu:** a user can pin any sidebar Item to a "PINNED" group that always renders first, above WORKSPACE. Pinning is drag-free (a "Pin" action in the item's right-click/long-press context menu) — no drag-and-drop reordering in v1, that's a nice-to-have, not a requirement.

## 11. Quick Create

- A single **"+ New"** control lives in the header (currently absent — `01_ERP_UI_AUDIT.md` §1.3 flags header gaps generally). Clicking it opens a permission-filtered dropdown of the top ~8 most-created entity types for that role (Invoice, Customer, Item, Purchase Order, etc.), each item navigating straight to that entity's create route.
- Reachable via command palette too: typing `>create` or `>new` in action mode surfaces the same list — one registry, two entry points, per §9.

## 12. Keyboard Shortcuts

**Status: implemented 2026-07-08.** All six shortcuts below are registered in `Layout.tsx`. `Ctrl/Cmd+Shift+N` opens the command palette pre-seeded with `>create ` (reuses the existing action-mode infrastructure — see `ERPCommandPalette`'s `initialQuery` prop — rather than building separate imperative open-control plumbing for `QuickCreateMenu`). `G` then `D` is a new `useSequenceShortcut` hook (1s window, ignores modifier-held presses and editable-field focus, unit-tested). `[`/`]` collapse/expand the sidebar, guarded to desktop only (no-op on tablet/mobile where the sidebar has different mechanics). `useKeyboardShortcut` gained a `shift` option — deliberately opt-in only (checked when explicitly `true`, ignored otherwise) since many characters (`?` included) already imply Shift was held to produce that `e.key`, and a naive "shift must be absent" default would have broken the existing `?` shortcut.

| Shortcut | Action |
|---|---|
| `Ctrl/Cmd + K` | Open command palette (existing) |
| `Ctrl/Cmd + Shift + N` | Quick create (§11) |
| `G` then `D` | Go to Dashboard (Gmail/Linear-style "go to" sequence, 1s window between keys) |
| `[` / `]` | Collapse / expand sidebar |
| `Esc` | Close any open overlay (modal, drawer, palette, dropdown) — already correct at the component level, just needs to be documented as a law, not just an accident of each component's own implementation |
| `?` | Open the shortcuts cheat-sheet (currently promised by a stale tooltip and never implemented — `01_ERP_UI_AUDIT.md` §1.7; this closes that gap) |

Every shortcut must be discoverable without memorization: the `?` cheat-sheet is the single source of truth, and any UI element offering a shortcut (tooltips, menu items) must display its kbd hint using one shared `<Kbd>` component (see `04_ERP_COMPONENT_LIBRARY.md`), never hand-typed text.

## 13. States

Every nav item (sidebar, command palette, breadcrumb) must render one of these states, visually distinct via tokens only (no hardcoded colors — see `06_ERP_DESIGN_TOKENS.md`):

| State | Rule |
|---|---|
| **Active** | Current route. Left accent bar (3px, `--brand-primary`) + `surface-subtle` background + `text-primary` + bold icon. Exactly one item active at a time (parent auto-highlights when a child is active, via a lighter treatment, not the same accent bar). |
| **Hover** | `surface-subtle` background, no accent bar, 100ms transition. |
| **Selected** (multi-select contexts only, e.g. bulk table rows — not sidebar) | Checkbox + row tint, defined in `03_ERP_DESIGN_SYSTEM.md` Table Standard. |
| **Disabled** | Only for temporarily-unavailable-but-visible items (e.g. a module whose backend dependency is down) — `text-disabled`, `cursor-not-allowed`, tooltip explains why. Rare; permission-hidden items are removed entirely (see below), not disabled. |
| **Loading (skeleton)** | Sidebar renders synchronously today from a static config, so this doesn't apply yet — but the moment nav becomes tenant/subscription/feature-flag-aware (§14), a skeleton (matching item height/icon placeholder) must render during the fetch, never a blank sidebar or layout shift. |
| **Empty** | A Group with zero visible items (all children permission-filtered out) renders nothing — not an empty section header. Verify `filterNavGroups` already does this (it should, per the audit); if any group ever slips through empty, that's a bug against this rule. |
| **Permission-hidden** | Item does not render in the DOM at all — never `disabled`-and-visible. Matches the existing design system's "Permission-Driven Rendering" tenet and the audited `filterNavGroups`/`filterNavItem` behavior. Keep as-is. |

## 14. Branch-Aware, Feature-Flag-Aware, Subscription-Aware Menu

This is new: the current nav config is static and has no branch/subscription awareness (`01_ERP_UI_AUDIT.md` §1.1).

**Correction (2026-07-07, verified against live code before implementation):** the originally-specified "Tenant Switcher" is **not architecturally applicable** and is removed from scope. `packages/db-client/src/schema/auth.ts` has `users.tenant_id` as a single required column with no `user_tenants`/membership join table; the JWT (`apps/auth-service/src/jwt.ts`) carries one `tenantId`, not a list; `POST /auth/login` requires `tenantId` as a login input, not a post-login choice. A user account belongs to exactly one tenant — there is nothing to switch between. (The one cross-tenant mechanism that exists, `impersonate.routes.ts`, is a platform-admin-only feature, not a self-service switcher, and is out of scope here.)

- **Branch switching:** a header-level Branch Switcher (only rendered when the user's `branchIds` has >1 entry) is a popover; selecting a branch updates `currentBranchId` in a new `branch.store.ts` (zustand, persisted). **Scope for v1:** this sets the *default* branch that create-forms and branch-scoped UI pre-select (replacing the current hardcoded `branchIds[0]` pattern found in `CustomerFormPage`/`SupplierFormPage`/`JobWorkOrderCreatePage`) — it does not yet filter list-page query results by branch, since no list endpoint accepts a branch-narrowing query param today (backend already scopes every branch-aware query to the user's *full* `branchIds` set via `getBranchScope()` + `inArray()`, not to a single selected branch). Wiring per-endpoint branch filtering is real, separate backend work, out of scope for the navigation-chrome pass — flagged in `07_ERP_IMPLEMENTATION_PLAN.md`.
- **Prerequisite bug fix (found during implementation, not previously known):** `apps/web-frontend/src/pages/auth/LoginPage.tsx`'s `completeLogin()` never populates `user.branchIds` — `GET /users/me` returns a `branches` array of row objects, not a `branchIds` field, and `completeLogin` spreads `me` without mapping it. Every consumer of `user?.branchIds` has always silently fallen back to `?? []`. This must be fixed before the Branch Switcher can render at all (see `07_ERP_IMPLEMENTATION_PLAN.md` Phase 1).
- **Feature-flag-aware:** nav items backed by an unreleased/disabled feature flag are filtered exactly like a permission check — same `filterNavItem` function, feature flags become one more predicate alongside RBAC permissions, not a separate mechanism.
- **Subscription-aware:** modules not included in a tenant's subscription tier render as a locked/greyed item with a "Upgrade to unlock" affordance (this is the one case where *showing* a disabled item is correct UX — it drives upsell, per the design system's own carve-out for showing what a user lacks access to "when the UX specifically benefits from it").

## 15. Notification Panel

Current implementation is real (SSE live stream, real unread counts — `01_ERP_UI_AUDIT.md` §10) and is kept as-is structurally. Additions:
- Group notifications by type (Approvals, System, Mentions) with a filter tab row inside the panel, once notification volume in a real tenant exceeds ~15/day (not needed at current low volume — flag for `07_ERP_IMPLEMENTATION_PLAN.md` as a later-phase item, not urgent).
- Notification bell badge count must be branch-aware once §14's branch switching ships (a notification scoped to Branch B shouldn't inflate the badge while viewing Branch A) — cross-reference with branch store.

## 16. POS Frontend Navigation Profile

POS (`apps/pos-frontend`) intentionally does **not** inherit this document's sidebar/header/command-palette architecture — confirmed correct in `01_ERP_UI_AUDIT.md` §7.1. A cashier terminal optimizes for zero-chrome, keyboard-shortcut-driven single-screen operation (F2/F8/F9/Esc), which is the right call for that workflow. The only shared surface between POS and the main ERP nav system is:
- The token system (must converge — see `05_ERP_THEME_SYSTEM.md` §Cross-App Tokens, closing the drift flagged in `01_ERP_UI_AUDIT.md` §4.1).
- The `<Kbd>` shortcut-hint component (§12), reused for POS's own F-key hints.

Do not add a sidebar, breadcrumb, or command palette to POS. That would be solving a problem POS doesn't have.

## 17. Context, Back, and Forward Navigation

- **Back/forward:** the app relies on browser history (React Router) — never a custom back-stack. Every state-changing filter/sort/pagination action on a list page must be reflected in the URL (query params), so back/forward genuinely restores prior view state instead of landing on a reset page. **`CustomersPage` implemented 2026-07-08** as the reference pattern (`hooks/useUrlParam.ts`'s `useUrlParams`) — search/status/type/page/size all round-trip through the URL, deep-links restore correctly, tested. **Two real bugs found and fixed while building this, both worth knowing before replicating the pattern to more pages**: (1) a naive per-key `useUrlParam(key)` hook with an unmemoized setter caused an actual infinite render loop when used inside a `useEffect` dependency array — the setter must be `useCallback`-stabilized; (2) `useSearchParams`'s setter computes its next value from a `prev` closed over at the last render, so two independent hook instances (or two effects) each calling their own `setSearchParams` in the same tick silently race — one write clobbers the other. The fix was consolidating to ONE hook (`useUrlParams`) that patches multiple keys atomically per call, and routing every user action (search debounce settling, a filter `onChange`, a page change) through exactly one `setUrlState(...)` call, never two in the same tick. Still only applied to `CustomersPage` — replicate carefully to other list pages using this hook, not a fresh per-page reimplementation.
- **Context navigation:** breadcrumbs are the only "where am I in the hierarchy" affordance; they must always be clickable up to (but not including) the current page, and reflect the sidebar hierarchy exactly (Group is not shown in breadcrumb since it's not a route — breadcrumb starts at the top-level Item).

## 18. Desktop / Laptop / Tablet / Mobile / Ultra-Wide Summary Matrix

| Device class | Width | Sidebar | Content |
|---|---|---|---|
| Mobile | `< 768px` | Hidden drawer (§4) | Single column, forms cap at 100% width |
| Tablet | `768–1023px` | Compact, auto | 2-column max on dashboards/forms |
| Laptop | `1024–1439px` | Expanded default | Standard grid per page type |
| Desktop | `1440–2559px` | Expanded default | Standard grid, single-column content capped at 1440px (§7) |
| Ultra-wide | `≥ 2560px` | Expanded, fixed width | Extra grid column on dashboards/lists (§7); single-column content still caps at 1440px, centered |

## 19. Animation

- Sidebar expand/collapse: 200ms `ease-out` width transition, respecting `prefers-reduced-motion` (instant, no transition, if set — closes the gap flagged in `01_ERP_UI_AUDIT.md` §4.3).
- Hover-expand (§4): 150ms delay before expand, no delay on retract-cancel (moving back into the sidebar cancels retraction instantly).
- Group collapse/expand: 150ms height transition via `grid-template-rows` trick (not `height: auto`, which can't animate) or a measured-height approach — no animation library dependency required.
- Command palette open/close: 120ms scale+fade, matching `Modal`/`ERPDrawer`'s existing timing (do not introduce a third timing curve).

All durations come from `06_ERP_DESIGN_TOKENS.md`'s `--duration-*` tokens — never hardcoded `ms` values in component code.
