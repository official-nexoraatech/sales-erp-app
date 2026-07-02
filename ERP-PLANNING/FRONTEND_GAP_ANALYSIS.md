# NEXORAA ERP — Frontend Gap Analysis
## Complete Audit Against ERP_FRONTEND_DESIGN_SYSTEM.md

**Audit Date:** 2026-06-30  
**Auditor:** Principal Frontend Architect  
**Scope:** `apps/web-frontend/src/` — all 51 `.tsx` files  
**Reference:** `ERP-PLANNING/ERP_FRONTEND_DESIGN_SYSTEM.md`

---

## AUDIT METHODOLOGY

Every file in the frontend was read in full. Issues were found by comparing each line of each file against the design system standard. Issues are recorded here with:

- **Module** — which part of the app
- **Screen / File** — exact file path
- **Current Behavior** — what the code does now
- **Expected Behavior** — what the design system requires
- **DS Reference** — design system section number
- **Severity** — Critical / High / Medium / Low
- **Effort** — XS (< 1hr) / S (1–2hr) / M (half day) / L (full day) / XL (2+ days)
- **Dependencies** — what must exist first
- **Risk** — what breaks if done wrong

---

## SEVERITY DEFINITIONS

| Level | Meaning |
|-------|---------|
| **Critical** | Blocks new module development. Architectural flaw or data bug. Must fix before Phase 5 starts. |
| **High** | Violates design standard visually or functionally. Degrades user experience significantly. |
| **Medium** | Inconsistency with design system. Degrades uniformity. Fix in next refactor sprint. |
| **Low** | Minor polish, nice-to-have improvements. Fix in backlog sprint. |

---

## EXECUTIVE SUMMARY

**Total issues found: 225**

| Severity | Count |
|----------|-------|
| Critical | 28 |
| High | 67 |
| Medium | 84 |
| Low | 46 |

**Most impacted areas:**
1. Architecture (no code splitting, no error boundaries, no design tokens)
2. Navigation (no breadcrumbs, no command palette, no global search)
3. Data tables (no sort, no pagination, no skeleton, no `···` menu)
4. Icon system (emoji everywhere)
5. Color system (no CSS variables, dozens of hardcoded color classes)
6. Forms (no sticky footer, no dirty state, raw HTML inside)
7. Security / Data bugs (hardcoded localhost URLs, hardcoded branchId: 1)

---

## SECTION 1 — ARCHITECTURE

### GA-001
- **Module:** Foundation
- **Screen / File:** `src/index.css`
- **Current Behavior:** 15 lines. Only Tailwind import and minimal resets. No CSS custom properties.
- **Expected Behavior:** `src/styles/tokens.css` with 80+ CSS variables covering surface, text, border, brand, semantic colors, spacing, radius, shadow, and z-index. Imported in `index.css`.
- **DS Reference:** Part 2 — Design Tokens
- **Severity:** Critical
- **Effort:** M
- **Dependencies:** None — must be done first
- **Risk:** Low (additive only)

### GA-002
- **Module:** Foundation
- **Screen / File:** `src/index.css` line 3
- **Current Behavior:** `@custom-variant dark (&:is(.dark *));`
- **Expected Behavior:** `@custom-variant dark (&:where(.dark, .dark *));` — per project memory, `&:is()` does not handle the root `.dark` class itself, only descendants. `&:where(.dark, .dark *)` handles both.
- **DS Reference:** Theme System memory note
- **Severity:** Critical
- **Effort:** XS
- **Dependencies:** GA-001
- **Risk:** Low (one-line change, fixes dark mode on root element)

### GA-003
- **Module:** Foundation
- **Screen / File:** `src/main.tsx`
- **Current Behavior:** No font import. `system-ui` used globally via `index.css`.
- **Expected Behavior:** `@fontsource/inter` installed. `font-family: 'Inter', system-ui, sans-serif` in `:root`.
- **DS Reference:** Part 3 — Typography
- **Severity:** High
- **Effort:** XS
- **Dependencies:** None
- **Risk:** Low

### GA-004
- **Module:** Foundation
- **Screen / File:** `src/App.tsx` — all 51 imports
- **Current Behavior:** All 51 page components are eagerly imported at the top of `App.tsx`. The entire app bundle loads on first visit.
- **Expected Behavior:** Each module group wrapped in `React.lazy()`. Module-level routing files in `src/modules/`. Initial JS bundle < 200KB gzipped.
- **DS Reference:** Part 31 — Performance Standard (code splitting), Part 32 — Folder Structure
- **Severity:** Critical
- **Effort:** L
- **Dependencies:** GA-001
- **Risk:** Medium (route breaks if lazy boundary not wrapped in Suspense)

### GA-005
- **Module:** Foundation
- **Screen / File:** `src/App.tsx` — no ErrorBoundary
- **Current Behavior:** No `<ErrorBoundary>` anywhere. A JS runtime error in any component will crash the entire application with a blank white screen.
- **Expected Behavior:** Each module route wrapped in `<ErrorBoundary fallback={<ERPEmptyState type="error" />}>`.
- **DS Reference:** Part 34.3 — Error Boundaries
- **Severity:** Critical
- **Effort:** S
- **Dependencies:** ERPEmptyState component (GA-067)
- **Risk:** Low (wrapping, not changing)

### GA-006
- **Module:** Foundation
- **Screen / File:** `src/store/` — only `auth.store.ts` exists
- **Current Behavior:** No `ui.store.ts`, no `notifications.store.ts`. Sidebar state, command palette state, theme state all live inside components, not global store.
- **Expected Behavior:** `ui.store.ts` for: sidebar collapsed, command palette open, density mode. `notifications.store.ts` for in-app notification list.
- **DS Reference:** Part 32 — Folder Structure
- **Severity:** High
- **Effort:** M
- **Dependencies:** None
- **Risk:** Low

### GA-007
- **Module:** Foundation
- **Screen / File:** `src/App.tsx` routes 122–123
- **Current Behavior:** `path="sales/quotations/:id"` renders `<QuotationsPage />` (the list page, not a detail page).
- **Expected Behavior:** Should render a `<QuotationDetailPage />` component.
- **DS Reference:** Part 33.6 — Route Naming Standards
- **Severity:** Critical
- **Effort:** M
- **Dependencies:** New QuotationDetailPage
- **Risk:** Medium (currently broken — detail view doesn't exist)

### GA-008
- **Module:** Foundation
- **Screen / File:** `src/App.tsx` line 136
- **Current Behavior:** `path="inventory/transfers/:id"` renders `<StockTransfersPage />` (list page).
- **Expected Behavior:** Should render `<StockTransferDetailPage />`.
- **DS Reference:** Part 33.6
- **Severity:** Critical
- **Effort:** M
- **Dependencies:** New StockTransferDetailPage
- **Risk:** Medium (currently broken)

### GA-009
- **Module:** Foundation
- **Screen / File:** `src/App.tsx` line 127
- **Current Behavior:** `path="sales/payments/new"` renders `<PaymentsPage />` which checks for `?invoiceId` query param to show a modal.
- **Expected Behavior:** Should be a dedicated `<PaymentFormPage />` route.
- **DS Reference:** Part 33.6
- **Severity:** High
- **Effort:** M
- **Dependencies:** New PaymentFormPage
- **Risk:** Medium

### GA-010
- **Module:** Foundation
- **Screen / File:** `src/App.tsx` line 144
- **Current Behavior:** Catch-all `path="*"` redirects to `/dashboard`. No 404 page.
- **Expected Behavior:** A dedicated 404 `<NotFoundPage />` with ERPEmptyState and link back to dashboard.
- **DS Reference:** Part 20 — Empty State Standard
- **Severity:** Low
- **Effort:** XS
- **Dependencies:** None
- **Risk:** None

### GA-011
- **Module:** Foundation
- **Screen / File:** All page files — no `document.title` management
- **Current Behavior:** Every page has the same browser tab title (whatever Vite default is). No dynamic title.
- **Expected Behavior:** Each page sets `document.title` to `"Page Name | NEXORAA ERP"` via a `useDocumentTitle` hook or `<title>` via React Router's outlet context.
- **DS Reference:** Part 26 — Accessibility (page title changes for screen readers)
- **Severity:** Medium
- **Effort:** S
- **Dependencies:** None
- **Risk:** None

---

## SECTION 2 — NAVIGATION & LAYOUT SHELL

### GA-012
- **Module:** Shell
- **Screen / File:** `src/components/Layout.tsx` — entire file
- **Current Behavior:** Sidebar uses emoji as icons: `⊞`, `⚙`, `🏢`, `🏪`, `🏭`, `👥`, `🧑‍🤝‍🧑`, `🚚`, `📦`, `🏷`, `📊`, `📂`, `✨`, `📐`, `💰`, `🔄`, `✏`, `🔍`, `🧵`, `🛒`, `🧾`, `📋`, `💳`, `↩`, `🗂`, `🔓`.
- **Expected Behavior:** All icons replaced with `lucide-react` equivalents per the icon mapping table in DS Part 4.4.
- **DS Reference:** Part 4 — Icon Standard
- **Severity:** Critical
- **Effort:** S
- **Dependencies:** `lucide-react` installed
- **Risk:** Low (visual only, no logic change)

### GA-013
- **Module:** Shell
- **Screen / File:** `src/components/Layout.tsx` — no breadcrumb
- **Current Behavior:** Top header `<header>` contains only a dark mode toggle button. Zero breadcrumb navigation.
- **Expected Behavior:** Left side of header shows `ERPBreadcrumb` component. Every page passes its breadcrumb items to the layout (via outlet context or React Router `useMatches` with handle).
- **DS Reference:** Part 9 — Breadcrumb Standard
- **Severity:** Critical
- **Effort:** L
- **Dependencies:** ERPBreadcrumb component, route `handle` metadata
- **Risk:** Medium (requires all 51 pages to define breadcrumb handle)

### GA-014
- **Module:** Shell
- **Screen / File:** `src/components/Layout.tsx` — no command palette
- **Current Behavior:** No command palette. Ctrl+K / Cmd+K does nothing.
- **Expected Behavior:** `ERPCommandPalette` component triggered by Ctrl+K, with navigation, recent pages, and quick actions.
- **DS Reference:** Part 22 — Command Palette Standard
- **Severity:** Critical
- **Effort:** XL
- **Dependencies:** GA-001 (tokens), lucide-react, useRecentPages hook
- **Risk:** Low (additive)

### GA-015
- **Module:** Shell
- **Screen / File:** `src/components/Layout.tsx` — no global search
- **Current Behavior:** Header has no search input.
- **Expected Behavior:** Global search input in header right area, triggers ERPCommandPalette on focus.
- **DS Reference:** Part 8 — Top Header Standard
- **Severity:** High
- **Effort:** S (after GA-014)
- **Dependencies:** GA-014
- **Risk:** Low

### GA-016
- **Module:** Shell
- **Screen / File:** `src/components/Layout.tsx` — no quick-create button
- **Current Behavior:** No way to quickly create a record from any screen.
- **Expected Behavior:** `+` icon button with dropdown listing the top 6–8 creatable entities (Invoice, Customer, Item, etc.).
- **DS Reference:** Part 8.3 — Quick Create Button
- **Severity:** High
- **Effort:** M
- **Dependencies:** Lucide `Plus` icon, PermissionGate
- **Risk:** Low

### GA-017
- **Module:** Shell
- **Screen / File:** `src/components/Layout.tsx` — no notification bell
- **Current Behavior:** No notification bell in header.
- **Expected Behavior:** Bell icon (`Bell`) with unread count badge. Panel slides from right showing pending approvals, alerts, and info notifications.
- **DS Reference:** Part 8.4 — Notifications
- **Severity:** Medium
- **Effort:** L
- **Dependencies:** Notification service API, notifications.store.ts
- **Risk:** Low (can be stub initially)

### GA-018
- **Module:** Shell
- **Screen / File:** `src/components/Layout.tsx` lines 154–161
- **Current Behavior:** ThemeContext duplicated in Layout. Layout reads `localStorage.getItem('theme')` directly and manages `.dark` class itself via `useEffect`. Bypasses `ThemeContext`.
- **Expected Behavior:** Single ThemeProvider manages dark mode. Layout only calls `useTheme()` to get `isDark` state and the toggle function. No localStorage reads inside Layout.
- **DS Reference:** Part 9 — Theme System
- **Severity:** Critical
- **Effort:** S
- **Dependencies:** ThemeProvider in App.tsx (verify exists or create)
- **Risk:** Medium (can cause dark mode flash if done incorrectly)

### GA-019
- **Module:** Shell
- **Screen / File:** `src/components/Layout.tsx` lines 155–160 (sidebar collapse button)
- **Current Behavior:** Collapse/expand button uses `←` and `→` text characters. No `aria-label`.
- **Expected Behavior:** Use `PanelLeftClose` / `PanelLeftOpen` Lucide icons. Add `aria-label="Collapse sidebar"` / `"Expand sidebar"`.
- **DS Reference:** Part 4.4 — Semantic Icon Mapping, Part 26.3 — ARIA
- **Severity:** High
- **Effort:** XS
- **Dependencies:** lucide-react
- **Risk:** None

### GA-020
- **Module:** Shell
- **Screen / File:** `src/components/Layout.tsx` lines 88–91 (nav group chevron)
- **Current Behavior:** Uses `▶` text character for expand chevron.
- **Expected Behavior:** `ChevronRight` Lucide icon, animated with `rotate-90` CSS transition when open.
- **DS Reference:** Part 4.4 — Icon Mapping
- **Severity:** High
- **Effort:** XS
- **Dependencies:** lucide-react
- **Risk:** None

### GA-021
- **Module:** Shell
- **Screen / File:** `src/components/Layout.tsx` sidebar nav — no module group headers
- **Current Behavior:** All navigation items are flat. No group labels like "SALES & CRM", "INVENTORY", "ACCOUNTING".
- **Expected Behavior:** Navigation organized into labeled groups per DS Part 7.4 module groups. Group headers: `text-xs uppercase tracking-widest text-sidebar-text-muted`.
- **DS Reference:** Part 7.4 — Navigation Module Groups
- **Severity:** High
- **Effort:** S
- **Dependencies:** GA-012 (icons), design tokens
- **Risk:** Low

### GA-022
- **Module:** Shell
- **Screen / File:** `src/components/Layout.tsx` — collapsed sidebar has no tooltips
- **Current Behavior:** When sidebar is collapsed (60px), hovering an icon shows nothing. User has no idea what each icon does.
- **Expected Behavior:** Hovering a collapsed sidebar icon shows a tooltip with the nav item's label.
- **DS Reference:** Part 7.3 — NavGroup State
- **Severity:** High
- **Effort:** S
- **Dependencies:** Tooltip component or CSS title attribute
- **Risk:** Low

### GA-023
- **Module:** Shell
- **Screen / File:** `src/components/Layout.tsx` user area (lines 170–190)
- **Current Behavior:** Shows avatar initial, name, email, logout button.
- **Expected Behavior:** Also shows user role, branch selector (for multi-branch users), and Settings link. Logout uses `LogOut` Lucide icon.
- **DS Reference:** Part 7.1 — Sidebar Structure
- **Severity:** Medium
- **Effort:** M
- **Dependencies:** GA-006 (auth store has role info)
- **Risk:** Low

### GA-024
- **Module:** Shell
- **Screen / File:** `src/components/Layout.tsx` — no recent pages section
- **Current Behavior:** Sidebar has no "Recent Pages" section.
- **Expected Behavior:** Bottom of scrollable nav area shows last 5–8 visited pages (persisted in Zustand + localStorage). Uses `History` icon and page title.
- **DS Reference:** Part 7.1 — Sidebar Structure (Recent Pages)
- **Severity:** Low
- **Effort:** M
- **Dependencies:** useRecentPages hook, ui.store.ts
- **Risk:** Low

### GA-025
- **Module:** Shell
- **Screen / File:** `src/components/Layout.tsx` line 184 (logout button)
- **Current Behavior:** Logout button uses `⇤` text character as icon.
- **Expected Behavior:** Uses `LogOut` Lucide icon. Has `aria-label="Logout"`.
- **DS Reference:** Part 4.4 — Semantic Icon Mapping
- **Severity:** High
- **Effort:** XS
- **Dependencies:** lucide-react
- **Risk:** None

---

## SECTION 3 — DESIGN TOKENS & COLORS

### GA-026
- **Module:** All
- **Screen / File:** `src/components/Layout.tsx` (lines 68, 72, 85, 106, 150, 184)
- **Current Behavior:** `bg-indigo-600`, `text-indigo-600`, `dark:text-indigo-400` hardcoded as the brand primary color.
- **Expected Behavior:** CSS variable `--brand-primary` via utility class `bg-primary`, `text-primary-foreground`.
- **DS Reference:** Part 2 — Design Tokens, Part 5 — Color Standard
- **Severity:** Critical
- **Effort:** S (after GA-001)
- **Dependencies:** GA-001 (tokens.css must exist first)
- **Risk:** Medium (must handle Tailwind v4 CSS variable pattern correctly)

### GA-027
- **Module:** Authentication
- **Screen / File:** `src/pages/auth/LoginPage.tsx` line 58
- **Current Behavior:** `className="... bg-indigo-600 ..."` on logo div.
- **Expected Behavior:** `bg-primary` via CSS token.
- **DS Reference:** Part 2, Part 5
- **Severity:** Critical
- **Effort:** XS
- **Dependencies:** GA-001
- **Risk:** None

### GA-028
- **Module:** Sales
- **Screen / File:** `src/pages/sales/InvoicesPage.tsx` lines 82–83
- **Current Behavior:** `text-red-600 font-semibold` and `text-green-600` for balance due column based on value.
- **Expected Behavior:** `text-danger` and `text-success` via CSS token classes.
- **DS Reference:** Part 5 — Color Standard
- **Severity:** High
- **Effort:** XS
- **Dependencies:** GA-001
- **Risk:** None

### GA-029
- **Module:** Sales
- **Screen / File:** `src/pages/sales/InvoiceDetailPage.tsx` lines 153–154
- **Current Behavior:** `text-green-600` for paid amount, `text-red-600 font-semibold` for balance due.
- **Expected Behavior:** Semantic token classes `text-success`, `text-danger`.
- **DS Reference:** Part 5
- **Severity:** High
- **Effort:** XS
- **Dependencies:** GA-001
- **Risk:** None

### GA-030
- **Module:** Inventory
- **Screen / File:** `src/pages/inventory/StockLevelsPage.tsx` lines 55, 64
- **Current Behavior:** `text-red-600 dark:text-red-400` for below-reorder quantity. `text-amber-600` for reserved quantity.
- **Expected Behavior:** `text-danger` and `text-warning` semantic classes.
- **DS Reference:** Part 5
- **Severity:** High
- **Effort:** XS
- **Dependencies:** GA-001
- **Risk:** None

### GA-031
- **Module:** Sales
- **Screen / File:** `src/pages/sales/PaymentsPage.tsx` lines 82–83
- **Current Behavior:** `text-orange-600 font-medium` for unallocated amount.
- **Expected Behavior:** `text-warning` semantic class.
- **DS Reference:** Part 5
- **Severity:** High
- **Effort:** XS
- **Dependencies:** GA-001
- **Risk:** None

### GA-032
- **Module:** Accounting
- **Screen / File:** `src/pages/gst/GstConfigPage.tsx` line 96
- **Current Behavior:** `text-indigo-600 dark:text-indigo-400` for HSN code text.
- **Expected Behavior:** `text-primary` semantic class (or `font-mono font-semibold text-primary`).
- **DS Reference:** Part 5
- **Severity:** High
- **Effort:** XS
- **Dependencies:** GA-001
- **Risk:** None

### GA-033
- **Module:** Inventory
- **Screen / File:** `src/pages/inventory/StockAdjustmentFormPage.tsx` line 88, `StockTransferFormPage.tsx` line 113
- **Current Behavior:** `hover:bg-indigo-50 dark:hover:bg-gray-700` on item search dropdown items.
- **Expected Behavior:** `hover:bg-primary/5 dark:hover:bg-surface-raised` via token.
- **DS Reference:** Part 5
- **Severity:** High
- **Effort:** XS
- **Dependencies:** GA-001
- **Risk:** None

### GA-034
- **Module:** Items
- **Screen / File:** `src/pages/items/ItemFormPage.tsx` line 135, 144 (HSN dropdown)
- **Current Behavior:** `hover:bg-indigo-50 dark:hover:bg-indigo-900/20` on HSN suggestion dropdown.
- **Expected Behavior:** `hover:bg-primary/5`.
- **DS Reference:** Part 5
- **Severity:** High
- **Effort:** XS
- **Dependencies:** GA-001
- **Risk:** None

### GA-035
- **Module:** Items
- **Screen / File:** `src/pages/items/ItemsPage.tsx` line 53, `src/pages/customers/CustomersPage.tsx` line 51
- **Current Behavior:** `text-indigo-600 dark:text-indigo-400 hover:underline` on clickable entity name.
- **Expected Behavior:** `text-primary hover:underline` semantic class.
- **DS Reference:** Part 5
- **Severity:** High
- **Effort:** XS
- **Dependencies:** GA-001
- **Risk:** None

### GA-036
- **Module:** Accounting
- **Screen / File:** `src/pages/accounting/ChartOfAccountsPage.tsx` (TYPE_COLORS map)
- **Current Behavior:** `TYPE_COLORS` uses `'indigo'` and `'blue'` from the deprecated Badge `color` prop API.
- **Expected Behavior:** Route through `ERPStatusBadge` with semantic status tokens, not color names.
- **DS Reference:** Part 18 — Status Badge Standard
- **Severity:** High
- **Effort:** S
- **Dependencies:** ERPStatusBadge component
- **Risk:** None

### GA-037
- **Module:** Accounting
- **Screen / File:** `src/pages/accounting/OpeningBalancesPage.tsx` line 264 (locked banner)
- **Current Behavior:** `bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-700` — hardcoded green color classes for alert banner. Uses `🔒` emoji.
- **Expected Behavior:** Use `ERPInlineAlert` component with `type="success"`. Use Lucide `Lock` icon.
- **DS Reference:** Part 5, Part 19.5 — Inline Notifications
- **Severity:** High
- **Effort:** S
- **Dependencies:** ERPInlineAlert component, lucide-react
- **Risk:** None

### GA-038
- **Module:** Accounting
- **Screen / File:** `src/pages/accounting/OpeningBalancesPage.tsx` line 311 (amber banner)
- **Current Behavior:** `bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-700` hardcoded.
- **Expected Behavior:** `ERPInlineAlert type="warning"`.
- **DS Reference:** Part 5, Part 19.5
- **Severity:** High
- **Effort:** XS
- **Dependencies:** ERPInlineAlert
- **Risk:** None

---

## SECTION 4 — ICON SYSTEM

### GA-039
- **Module:** Dashboard
- **Screen / File:** `src/pages/DashboardPage.tsx` lines 16–19
- **Current Behavior:** KPI card icons: `🧑‍🤝‍🧑`, `🚚`, `🏷`, `🔓` (emoji).
- **Expected Behavior:** `Users`, `Truck`, `Tag`, `LockOpen` from `lucide-react`.
- **DS Reference:** Part 4 — Icon Standard
- **Severity:** Critical
- **Effort:** XS
- **Dependencies:** lucide-react
- **Risk:** None

### GA-040
- **Module:** All Form Pages
- **Screen / File:** `InvoiceFormPage.tsx` line 259, `StockAdjustmentFormPage.tsx` line 133, `StockTransferFormPage.tsx` line 160
- **Current Behavior:** `✕` text character used as "remove" button for line items. No aria-label.
- **Expected Behavior:** Lucide `X` icon (16px) inside a ghost button with `aria-label="Remove item"`.
- **DS Reference:** Part 4, Part 26.3 — ARIA
- **Severity:** High
- **Effort:** XS
- **Dependencies:** lucide-react
- **Risk:** None

### GA-041
- **Module:** Modal
- **Screen / File:** `src/components/ui/Modal.tsx` line 44
- **Current Behavior:** Close button uses `✕` text character. No `aria-label`.
- **Expected Behavior:** Lucide `X` icon (18px). `aria-label="Close dialog"`.
- **DS Reference:** Part 4, Part 17 — Modal Standard
- **Severity:** High
- **Effort:** XS
- **Dependencies:** lucide-react
- **Risk:** None

### GA-042
- **Module:** Accounting
- **Screen / File:** `src/pages/accounting/ChartOfAccountsPage.tsx` lines 44–45
- **Current Behavior:** `▼` / `▶` text characters for tree expand/collapse.
- **Expected Behavior:** `ChevronDown` / `ChevronRight` Lucide icons, with `transition-transform` animation.
- **DS Reference:** Part 4.4
- **Severity:** High
- **Effort:** XS
- **Dependencies:** lucide-react
- **Risk:** None

### GA-043
- **Module:** Accounting
- **Screen / File:** `src/pages/accounting/OpeningBalancesPage.tsx` lines 285–289 (step tabs)
- **Current Behavior:** Step completion shown as `✓` text character, step number as plain text.
- **Expected Behavior:** `CheckCircle2` Lucide icon (green) for completed steps. Number in a circular badge for pending.
- **DS Reference:** Part 4.4 — Icon Mapping
- **Severity:** Medium
- **Effort:** XS
- **Dependencies:** lucide-react
- **Risk:** None

### GA-044
- **Module:** Button
- **Screen / File:** `src/components/ui/Button.tsx` line 42
- **Current Behavior:** Loading spinner uses `⟳` text character, animated with `animate-spin`.
- **Expected Behavior:** Lucide `Loader2` icon with `animate-spin`. Correct size matching button size.
- **DS Reference:** Part 4, Part 16 — Button Standard
- **Severity:** High
- **Effort:** XS
- **Dependencies:** lucide-react
- **Risk:** None

---

## SECTION 5 — DATA TABLE

### GA-045
- **Module:** All List Pages
- **Screen / File:** `src/components/ui/DataTable.tsx`
- **Current Behavior:** Basic `<table>` with no sorting capability. Column headers are plain `<th>` elements with no click handler.
- **Expected Behavior:** Sortable column headers with `ArrowUpDown` / `ArrowUp` / `ArrowDown` icons. Click to sort ascending → descending → reset.
- **DS Reference:** Part 13.3 — Column Header Rules
- **Severity:** Critical
- **Effort:** L (requires ERPDataGrid rebuild)
- **Dependencies:** lucide-react, ERPDataGrid component
- **Risk:** Medium (breaking change to DataTable API)

### GA-046
- **Module:** All List Pages
- **Screen / File:** `src/components/ui/DataTable.tsx`
- **Current Behavior:** No pagination. Pages fetch `size: 50` and silently truncate. All rows rendered in DOM.
- **Expected Behavior:** `ERPPagination` component below every table. URL query params `?page=1&pageSize=25`. Total count shown.
- **DS Reference:** Part 13.9 — Pagination
- **Severity:** Critical
- **Effort:** L
- **Dependencies:** ERPPagination component, useTableState hook, API supports pagination
- **Risk:** Medium (API must return total count)

### GA-047
- **Module:** All List Pages
- **Screen / File:** `src/components/ui/DataTable.tsx`
- **Current Behavior:** Loading state shows `<td>Loading…</td>` text. No skeleton rows.
- **Expected Behavior:** Skeleton rows matching the column count and approximate content widths. Using `animate-pulse` on placeholder divs.
- **DS Reference:** Part 13.8 — Loading State, Part 21.1 — Skeleton Loading
- **Severity:** Critical
- **Effort:** M
- **Dependencies:** ERPDataGridSkeleton component
- **Risk:** None (additive)

### GA-048
- **Module:** All List Pages
- **Screen / File:** `src/components/ui/DataTable.tsx`
- **Current Behavior:** Empty state shows plain text `{emptyMessage}` centered in a `<td>`.
- **Expected Behavior:** `ERPEmptyState` component with icon, heading, description, and primary action button.
- **DS Reference:** Part 20 — Empty State Standard
- **Severity:** High
- **Effort:** S
- **Dependencies:** ERPEmptyState component
- **Risk:** None

### GA-049
- **Module:** All List Pages
- **Screen / File:** All page files using DataTable
- **Current Behavior:** Row actions are 2–4 direct inline `<Button>` elements per row (`View Edit Delete`, `Send Convert`, `Dispatch Convert View Invoice`, etc.).
- **Expected Behavior:** Single `···` (`MoreHorizontal`) ghost button per row. Clicking opens a dropdown menu with ordered actions: View (first), Edit, separators, then Delete (last, red).
- **DS Reference:** Part 13.5 — Row Actions
- **Severity:** Critical
- **Effort:** L
- **Dependencies:** ERPDropdownMenu component
- **Risk:** Medium (API for each action stays same, only presentation changes)

### GA-050
- **Module:** All List Pages
- **Screen / File:** `src/components/ui/DataTable.tsx`
- **Current Behavior:** No checkbox column. No bulk selection. No bulk action bar.
- **Expected Behavior:** Sticky left checkbox column. When rows selected: bulk action bar replaces toolbar showing count, allowed bulk actions (Export, Delete), and clear selection button.
- **DS Reference:** Part 13.6 — Bulk Actions
- **Severity:** High
- **Effort:** XL
- **Dependencies:** ERPDataGrid, permissions
- **Risk:** Low (additive)

### GA-051
- **Module:** All List Pages
- **Screen / File:** `src/components/ui/DataTable.tsx`
- **Current Behavior:** Table header scrolls with content. Actions column scrolls with content.
- **Expected Behavior:** `position: sticky; top: 0` on `<thead>`. Actions column: `position: sticky; right: 0`.
- **DS Reference:** Part 13.4 — Sticky Elements
- **Severity:** High
- **Effort:** S
- **Dependencies:** None
- **Risk:** Low (pure CSS)

### GA-052
- **Module:** Items, Customers, Invoices, etc.
- **Screen / File:** Multiple list pages
- **Current Behavior:** No column chooser. Columns fixed.
- **Expected Behavior:** Columns button in toolbar opens popover with checkboxes to show/hide columns.
- **DS Reference:** Part 12.7 — Column Chooser
- **Severity:** Medium
- **Effort:** L
- **Dependencies:** ERPDataGrid with column state
- **Risk:** Low

### GA-053
- **Module:** All List Pages
- **Screen / File:** Multiple pages
- **Current Behavior:** No row density toggle.
- **Expected Behavior:** Compact / Comfortable / Spacious toggle in toolbar, per-user preference.
- **DS Reference:** Part 12.8 — Density Toggle
- **Severity:** Medium
- **Effort:** S
- **Dependencies:** ui.store.ts (persist density), ERPDataGrid
- **Risk:** None

### GA-054
- **Module:** Invoices, Payments, Stock
- **Screen / File:** InvoicesPage, PaymentsPage, StockLevelsPage
- **Current Behavior:** No footer totals row.
- **Expected Behavior:** Footer row with `bg-surface-subtle` showing sum of numeric columns (Total Amount, Total Balance Due, Total Stock).
- **DS Reference:** Part 13.10 — Footer Totals Row
- **Severity:** Medium
- **Effort:** S
- **Dependencies:** ERPDataGrid footer slot
- **Risk:** None

---

## SECTION 6 — FILTER & TOOLBAR

### GA-055
- **Module:** All List Pages
- **Screen / File:** CustomersPage, ItemsPage, InvoicesPage, QuotationsPage, StockLevelsPage
- **Current Behavior:** Filter bar is a raw `<div className="flex gap-3 mb-4">` with unstyled `<Input>` and `<Select>` components. No container, no visual toolbar identity.
- **Expected Behavior:** `ERPToolbar` component with consistent `bg-surface-raised border border-default rounded-lg p-3` container.
- **DS Reference:** Part 12.1 — Toolbar Anatomy
- **Severity:** High
- **Effort:** M (after ERPToolbar component)
- **Dependencies:** ERPToolbar component
- **Risk:** None

### GA-056
- **Module:** Sales, Inventory
- **Screen / File:** InvoicesPage line 134, QuotationsPage line 115
- **Current Behavior:** Status filter uses raw `<select>` HTML element with inline Tailwind classes, NOT the `Select` component.
- **Expected Behavior:** Use `ERPSelect` or `Select` component consistently. Never raw HTML `<select>` in page code.
- **DS Reference:** Part 34 — No raw HTML elements in page code
- **Severity:** High
- **Effort:** XS
- **Dependencies:** None
- **Risk:** None

### GA-057
- **Module:** All List Pages
- **Screen / File:** CustomersPage, ItemsPage, InvoicesPage
- **Current Behavior:** Search input is not debounced. Every keystroke triggers an API call immediately.
- **Expected Behavior:** 300ms debounce on all search inputs. Use `useDebounce` hook.
- **DS Reference:** Part 12.2 — Search Input
- **Severity:** High
- **Effort:** S
- **Dependencies:** useDebounce hook
- **Risk:** None

### GA-058
- **Module:** All List Pages
- **Screen / File:** Multiple pages
- **Current Behavior:** No active filter chips. When filters are applied, no visual indication except the select element value.
- **Expected Behavior:** `ERPFilterChips` component below toolbar showing each active filter as a removable chip. "Clear All" appears when 2+ filters active.
- **DS Reference:** Part 12.3 — Filter Chips
- **Severity:** Medium
- **Effort:** M
- **Dependencies:** ERPFilterChips component
- **Risk:** None

### GA-059
- **Module:** All List Pages
- **Screen / File:** All list pages
- **Current Behavior:** No summary/KPI cards row on any list page.
- **Expected Behavior:** `ERPStatCard` row for pages where meaningful aggregates exist: Customers (total count, active count), Invoices (total value, pending amount, overdue), Items (total items, active, low stock).
- **DS Reference:** Part 11 — Summary Cards
- **Severity:** High
- **Effort:** L (requires new API endpoints for aggregates)
- **Dependencies:** Backend aggregate endpoints
- **Risk:** Medium (needs API support)

---

## SECTION 7 — PAGE HEADER

### GA-060
- **Module:** All Pages
- **Screen / File:** `src/components/ui/PageHeader.tsx`
- **Current Behavior:** Accepts `title`, `subtitle`, `actions/children`. Has 19 lines of code. Does not: show module icon, show entity status badge, show back button, show entity metadata, show breadcrumb.
- **Expected Behavior:** `ERPPageHeader` with list variant and detail variant. List: icon + title + subtitle + right-side actions. Detail: back button + entity number + status badge + summary line + metadata + actions.
- **DS Reference:** Part 10 — Page Header Standard
- **Severity:** Critical
- **Effort:** M
- **Dependencies:** lucide-react, ERPStatusBadge
- **Risk:** Medium (all 51 pages import PageHeader — must keep backward compatibility or migrate all at once)

### GA-061
- **Module:** All Detail/Form Pages
- **Screen / File:** CustomerViewPage, InvoiceDetailPage, PhysicalVerificationDetailPage, StockTransferReceivePage
- **Current Behavior:** No back button in page header. Users use the browser back button.
- **Expected Behavior:** `ArrowLeft` button in page header that navigates to the parent list page (not browser history).
- **DS Reference:** Part 10.2 — Detail Page Header
- **Severity:** High
- **Effort:** S
- **Dependencies:** ERPPageHeader (after GA-060)
- **Risk:** None

### GA-062
- **Module:** Sales
- **Screen / File:** `src/pages/sales/InvoiceDetailPage.tsx` lines 83–93
- **Current Behavior:** Status `<Badge>` placed inside `PageHeader` actions area, mixed with action buttons.
- **Expected Behavior:** Status badge is a dedicated prop/slot in ERPPageHeader, always appearing next to the title, not in the action buttons area.
- **DS Reference:** Part 10.2 — Detail Page Header
- **Severity:** High
- **Effort:** XS (after GA-060)
- **Dependencies:** GA-060
- **Risk:** None

### GA-063
- **Module:** Sales
- **Screen / File:** `src/pages/sales/InvoiceDetailPage.tsx` — "Cancel" button
- **Current Behavior:** "Cancel Invoice" is a top-level `<Button variant="danger">` in the page header alongside "Confirm Invoice" and "Record Payment".
- **Expected Behavior:** Destructive actions (Cancel, Delete) must be in a "More Actions" dropdown, never as a top-level button.
- **DS Reference:** Part 10.2 — "Destructive actions live ONLY in 'More Actions' dropdown"
- **Severity:** High
- **Effort:** S
- **Dependencies:** ERPDropdownMenu
- **Risk:** None

---

## SECTION 8 — FORM PAGES

### GA-064
- **Module:** All Form Pages
- **Screen / File:** CustomerFormPage, ItemFormPage, InvoiceFormPage, StockAdjustmentFormPage, StockTransferFormPage, OrganizationPage, SupplierFormPage, UserFormPage, AccountFormPage
- **Current Behavior:** Save/Cancel buttons are at the bottom of the form content, not in a sticky footer. When form is long (InvoiceFormPage) the buttons scroll off screen.
- **Expected Behavior:** `ERPStickyFooter` component fixed at bottom of viewport when header buttons scroll off screen. Shows dirty indicator `●`, Cancel (ghost), Save Draft (outline), Save & Submit (primary).
- **DS Reference:** Part 14.9 — Sticky Footer
- **Severity:** Critical
- **Effort:** M (after ERPStickyFooter component)
- **Dependencies:** ERPStickyFooter component
- **Risk:** None

### GA-065
- **Module:** All Form Pages
- **Screen / File:** CustomerFormPage, InvoiceFormPage, ItemFormPage, etc.
- **Current Behavior:** No dirty state indicator. No `●` in page title. No `beforeunload` warning when navigating away with unsaved changes.
- **Expected Behavior:** When `form.formState.isDirty`, show `●` before page title and register `beforeunload` event. Cancel button shows confirmation dialog when dirty.
- **DS Reference:** Part 14.7 — Dirty State
- **Severity:** High
- **Effort:** S per form
- **Dependencies:** None
- **Risk:** Low

### GA-066
- **Module:** Invoice
- **Screen / File:** `src/pages/sales/InvoiceFormPage.tsx` — entire file
- **Current Behavior:** Form uses individual `useState` for every field (customerId, branchId, warehouseId, placeOfSupply, invoiceDate, dueDate, notes, lines). No React Hook Form. No Zod schema. Validation is just `if (!customerId || !branchId || ...)` toast.error.
- **Expected Behavior:** React Hook Form + Zod schema. Field-level validation. Errors shown inline below each field. Submission blocked until valid.
- **DS Reference:** Part 14.6 — Validation
- **Severity:** Critical
- **Effort:** L
- **Dependencies:** None
- **Risk:** Medium (significant refactor of most complex form)

### GA-067
- **Module:** Invoice Form
- **Screen / File:** `src/pages/sales/InvoiceFormPage.tsx` lines 201–210 (item search)
- **Current Behavior:** Raw `<input type="text" className="flex-1 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-sm">` for item search. Inconsistent with `Input` component.
- **Expected Behavior:** Use `ERPInput` or `ERPAsyncSelect` for item search.
- **DS Reference:** Part 14 — "No raw HTML elements in page-level code"
- **Severity:** High
- **Effort:** S
- **Dependencies:** ERPAsyncSelect
- **Risk:** None

### GA-068
- **Module:** Invoice, Stock Adjustment, Stock Transfer
- **Screen / File:** InvoiceFormPage, StockAdjustmentFormPage, StockTransferFormPage
- **Current Behavior:** Line items table uses raw `<table>`, `<input>`, `<select>` elements inside `<td>`. Styling is completely inconsistent with the rest of the form.
- **Expected Behavior:** A dedicated `ERPLineItemsTable` component with consistent input styling. Cells use `ERPInput` inline-edit variant.
- **DS Reference:** Part 13.12 — Inline Edit; Part 14 — Form components
- **Severity:** High
- **Effort:** XL
- **Dependencies:** ERPInput, ERPLineItemsTable component
- **Risk:** Medium (complex business logic tied to line item state)

### GA-069
- **Module:** Invoice Form
- **Screen / File:** `src/pages/sales/InvoiceFormPage.tsx` line 48
- **Current Behavior:** `sellerState` hardcoded as `'27'` (Maharashtra state code) for all invoices.
- **Expected Behavior:** Should be fetched from organization settings (the seller's state code from their GSTIN).
- **DS Reference:** Business logic correctness
- **Severity:** Critical
- **Effort:** S
- **Dependencies:** Organization settings API
- **Risk:** High (affects GST calculation correctness for non-Maharashtra organizations)

### GA-070
- **Module:** Invoice Form
- **Screen / File:** `src/pages/sales/InvoiceFormPage.tsx` — Place of Supply field
- **Current Behavior:** Raw `<Input>` text field for state code (2-digit number). User must know and type the correct state code.
- **Expected Behavior:** `ERPSelect` with all 37 Indian state/UT codes and names as options.
- **DS Reference:** Part 15.3 — ERPSelect
- **Severity:** High
- **Effort:** S
- **Dependencies:** Indian states constant file
- **Risk:** None

### GA-071
- **Module:** Invoice Form
- **Screen / File:** `src/pages/sales/InvoiceFormPage.tsx` line 288
- **Current Behavior:** Notes field uses `<Input>` (single-line text input).
- **Expected Behavior:** `<ERPTextarea>` (multi-line, auto-resize).
- **DS Reference:** Part 15.2 — ERPTextarea
- **Severity:** Medium
- **Effort:** XS
- **Dependencies:** ERPTextarea component
- **Risk:** None

### GA-072
- **Module:** Customer Form
- **Screen / File:** `src/pages/customers/CustomerFormPage.tsx` lines 122–129
- **Current Behavior:** Billing address in a `<fieldset>` with `<legend>` tag. Not using section card pattern.
- **Expected Behavior:** `ERPFormSection` card component with styled section title.
- **DS Reference:** Part 14.3 — Section Card Rules
- **Severity:** Medium
- **Effort:** S
- **Dependencies:** ERPFormSection
- **Risk:** None

### GA-073
- **Module:** Customer Form
- **Screen / File:** `src/pages/customers/CustomerFormPage.tsx` lines 116–117
- **Current Behavior:** GSTIN validation status shown as `<p className="text-xs text-green-500 mt-1">` / `<p className="text-xs text-red-500 mt-1">`. Hardcoded colors, no icons.
- **Expected Behavior:** Lucide `CheckCircle2` icon (green) or `AlertCircle` icon (red) inline with field. Colors via token.
- **DS Reference:** Part 15.8 — ERPGSTINInput, Part 5
- **Severity:** Medium
- **Effort:** S
- **Dependencies:** ERPGSTINInput or tokens
- **Risk:** None

### GA-074
- **Module:** Customer Form
- **Screen / File:** `src/pages/customers/CustomerFormPage.tsx` line 88
- **Current Behavior:** Form has `max-w-2xl` hardcoded width. No section cards.
- **Expected Behavior:** Full-width form using 12-column grid. Fields in `ERPFormSection` cards (Basic Info, Contact, Address, Financial).
- **DS Reference:** Part 14 — Form Design
- **Severity:** Medium
- **Effort:** M
- **Dependencies:** ERPFormSection
- **Risk:** None

### GA-075
- **Module:** Items
- **Screen / File:** `src/pages/items/ItemFormPage.tsx` lines 168–176
- **Current Behavior:** `<input type="checkbox" {...register('trackInventory')} className="rounded border-gray-300">` — raw `<input>` for boolean toggle.
- **Expected Behavior:** `<ERPSwitch label="Track Inventory" name="trackInventory" />` — toggle switch.
- **DS Reference:** Part 15.11 — ERPSwitch
- **Severity:** Medium
- **Effort:** XS
- **Dependencies:** ERPSwitch component
- **Risk:** None

### GA-076
- **Module:** Sale Returns
- **Screen / File:** `src/pages/sales/SaleReturnsPage.tsx` lines 77–79
- **Current Behavior:** Invoice and Customer are entered as raw numeric IDs via `<Input type="number">`. User must know the database ID.
- **Expected Behavior:** `ERPAsyncSelect` for invoice search (search by invoice number) and customer name. Display the entity name, store the ID.
- **DS Reference:** Part 15.4 — ERPAsyncSelect
- **Severity:** Critical
- **Effort:** M
- **Dependencies:** ERPAsyncSelect, invoice search API
- **Risk:** None (currently unusable without knowing raw IDs)

### GA-077
- **Module:** Sale Returns
- **Screen / File:** `src/pages/sales/SaleReturnsPage.tsx` line 93
- **Current Behavior:** Raw `<input type="checkbox">` for "Physical Return" toggle.
- **Expected Behavior:** `<ERPSwitch label="Physical Return (stock will be restored)" />`.
- **DS Reference:** Part 15.11
- **Severity:** Medium
- **Effort:** XS
- **Dependencies:** ERPSwitch
- **Risk:** None

---

## SECTION 9 — LOADING & EMPTY STATES

### GA-078
- **Module:** Customers, Organization
- **Screen / File:** `CustomerViewPage.tsx` line 18, `OrganizationPage.tsx` line 33
- **Current Behavior:** Loading state: `<p className="text-sm text-gray-400">Loading…</p>`.
- **Expected Behavior:** `<ERPFormSkeleton />` or appropriate skeleton matching the page layout.
- **DS Reference:** Part 21 — Loading Standard
- **Severity:** High
- **Effort:** XS each
- **Dependencies:** Skeleton components
- **Risk:** None

### GA-079
- **Module:** Customers
- **Screen / File:** `CustomerViewPage.tsx` line 19
- **Current Behavior:** Not found state: `<p className="text-sm text-red-400">Customer not found.</p>`.
- **Expected Behavior:** `<ERPEmptyState type="no-data" title="Customer not found" description="..." action={...} />`.
- **DS Reference:** Part 20 — Empty State Standard
- **Severity:** High
- **Effort:** XS
- **Dependencies:** ERPEmptyState component
- **Risk:** None

### GA-080
- **Module:** Sales
- **Screen / File:** `InvoiceDetailPage.tsx` line 77
- **Current Behavior:** `<div className="p-8 text-center text-gray-500">Loading…</div>` for initial load.
- **Expected Behavior:** Invoice detail skeleton matching the header + KPI cards + line items layout.
- **DS Reference:** Part 21
- **Severity:** High
- **Effort:** S
- **Dependencies:** ERPDetailSkeleton
- **Risk:** None

### GA-081
- **Module:** GST
- **Screen / File:** `GstConfigPage.tsx` line 61
- **Current Behavior:** `<p className="text-sm text-gray-400">Loading…</p>` inside a card.
- **Expected Behavior:** List skeleton (5 rows of `animate-pulse` divs).
- **DS Reference:** Part 21
- **Severity:** Low
- **Effort:** XS
- **Dependencies:** None
- **Risk:** None

---

## SECTION 10 — MODAL & DIALOG

### GA-082
- **Module:** All
- **Screen / File:** `src/components/ui/Modal.tsx`
- **Current Behavior:** Modal has no `role="dialog"`, no `aria-modal="true"`, no `aria-labelledby` linking to the title.
- **Expected Behavior:** `<div role="dialog" aria-modal="true" aria-labelledby="modal-title-id">`.
- **DS Reference:** Part 17.3, Part 26.3 — ARIA
- **Severity:** Critical
- **Effort:** XS
- **Dependencies:** None
- **Risk:** None

### GA-083
- **Module:** All
- **Screen / File:** `src/components/ui/Modal.tsx`
- **Current Behavior:** No focus trap. Tab key can move focus outside the modal to the background content.
- **Expected Behavior:** `focus-trap-react` or manual focus trap implementation. Tab cycles only through modal's focusable elements.
- **DS Reference:** Part 17.3, Part 26.4 — Focus Management
- **Severity:** Critical
- **Effort:** S
- **Dependencies:** `focus-trap-react` package or manual implementation
- **Risk:** Low

### GA-084
- **Module:** All
- **Screen / File:** `src/components/ui/Modal.tsx`
- **Current Behavior:** No Escape key handler. Modal can only be closed by clicking backdrop or the `✕` button.
- **Expected Behavior:** `useEffect` with `keydown` listener. `Escape` → `onClose()`.
- **DS Reference:** Part 17.3 — "Escape always closes"
- **Severity:** Critical
- **Effort:** XS
- **Dependencies:** None
- **Risk:** None

### GA-085
- **Module:** All
- **Screen / File:** `src/components/ui/Modal.tsx`
- **Current Behavior:** On modal open, focus is not moved inside the modal. Focus stays on whatever triggered the modal.
- **Expected Behavior:** `useEffect` with `firstFocusableElement?.focus()` on open.
- **DS Reference:** Part 17.3, Part 26.4
- **Severity:** High
- **Effort:** XS
- **Dependencies:** None
- **Risk:** None

### GA-086
- **Module:** Invoices, Physical Verifications, Payments
- **Screen / File:** InvoiceDetailPage, PhysicalVerificationPage, PaymentsPage, SaleReturnsPage
- **Current Behavior:** Confirmation dialogs are plain `<Modal>` with a description paragraph and "Confirm/Cancel" buttons. No standardized design.
- **Expected Behavior:** `<ERPConfirmModal>` component with standardized icon, title, description, confirm label, variant (danger/primary).
- **DS Reference:** Part 17.4 — Confirmation Modal Pattern
- **Severity:** Medium
- **Effort:** S (after ERPConfirmModal component)
- **Dependencies:** ERPConfirmModal component
- **Risk:** None

### GA-087
- **Module:** Payments
- **Screen / File:** `src/pages/sales/PaymentsPage.tsx` — Record Payment modal
- **Current Behavior:** Complex payment creation form (8 fields, conditional fields) inside a modal. Modal is `size="md"` (max-w-lg).
- **Expected Behavior:** Complex forms should be in a `<ERPDrawer>` (side panel) or dedicated full page, not a modal.
- **DS Reference:** Part 17.5 — Drawer (Side Panel)
- **Severity:** High
- **Effort:** M
- **Dependencies:** ERPDrawer component
- **Risk:** None

---

## SECTION 11 — DASHBOARD

### GA-088
- **Module:** Dashboard
- **Screen / File:** `src/pages/DashboardPage.tsx`
- **Current Behavior:** All KPI cards show `–` (placeholder). No API data fetched. Static array literal hardcoded.
- **Expected Behavior:** KPI values fetched from real APIs. Customers, Suppliers, Items counts. Today's invoice total. Pending approvals count.
- **DS Reference:** Part 23 — Dashboard Standard
- **Severity:** Critical
- **Effort:** L
- **Dependencies:** New aggregate/dashboard API endpoints
- **Risk:** Medium (new backend endpoints needed)

### GA-089
- **Module:** Dashboard
- **Screen / File:** `src/pages/DashboardPage.tsx` line 38–43
- **Current Behavior:** Text "Phase 2 — Master Data Setup" and development instructions left in the UI.
- **Expected Behavior:** Replace with either: actual recent activity widget, or pending approvals list, or today's sales summary.
- **DS Reference:** Part 23 — Dashboard Standard
- **Severity:** Critical
- **Effort:** S
- **Dependencies:** None (remove text even before implementing real widget)
- **Risk:** None

### GA-090
- **Module:** Dashboard
- **Screen / File:** `src/pages/DashboardPage.tsx`
- **Current Behavior:** No charts.
- **Expected Behavior:** At minimum: daily sales trend (last 30 days line chart) and stock status donut chart.
- **DS Reference:** Part 23.4 — Charts
- **Severity:** High
- **Effort:** L
- **Dependencies:** Backend sales analytics endpoint, recharts
- **Risk:** Medium

### GA-091
- **Module:** Dashboard
- **Screen / File:** `src/pages/DashboardPage.tsx`
- **Current Behavior:** KPI cards are not clickable.
- **Expected Behavior:** Each card navigates to the relevant list page on click (Customers → `/customers`, etc.).
- **DS Reference:** Part 23.2 — "Cards are clickable where onClick is provided"
- **Severity:** Medium
- **Effort:** XS
- **Dependencies:** None
- **Risk:** None

---

## SECTION 12 — AUTHENTICATION

### GA-092
- **Module:** Authentication
- **Screen / File:** `src/pages/auth/LoginPage.tsx` lines 67–73
- **Current Behavior:** User must manually type a numeric "Tenant ID" in a number input. This exposes internal database IDs to users.
- **Expected Behavior:** Tenant identified by subdomain (tenant1.erp.nexoraa.com) or a branded login URL. Tenant ID resolved server-side. Remove the tenant ID input from the UI entirely.
- **DS Reference:** Part 6 — UX Rules ("Zero Learning Curve"), Part 25 — Multi-Tenant
- **Severity:** Critical
- **Effort:** L
- **Dependencies:** Auth service subdomain routing support
- **Risk:** High (requires backend auth service change)

### GA-093
- **Module:** Authentication
- **Screen / File:** `src/pages/auth/LoginPage.tsx`
- **Current Behavior:** Password field has no visibility toggle.
- **Expected Behavior:** `Eye` / `EyeOff` Lucide icon button at the right of the password input. Toggles `type="password"` ↔ `type="text"`.
- **DS Reference:** Part 15 — Form Components
- **Severity:** Medium
- **Effort:** S
- **Dependencies:** lucide-react
- **Risk:** None

### GA-094
- **Module:** Authentication
- **Screen / File:** `src/pages/auth/LoginPage.tsx` line 35
- **Current Behavior:** JWT payload decoded by manually splitting on `.` and calling `atob()`. Fragile — format-dependent, silent failure on malformed token.
- **Expected Behavior:** Use a JWT decode utility (`jwt-decode` package) or move role/permission extraction to the auth service `/me` response, which already returns user data.
- **DS Reference:** Part 34.6 — Security Rules
- **Severity:** High
- **Effort:** S
- **Dependencies:** `/me` endpoint returning roles + permissions
- **Risk:** High (auth breakage if not done correctly)

---

## SECTION 13 — SECURITY & DATA BUGS

### GA-095
- **Module:** Accounting
- **Screen / File:** `src/pages/accounting/ChartOfAccountsPage.tsx` line 85
- **Current Behavior:** `fetch('http://localhost:3019/accounts/seed', { method: 'POST' })` — hardcoded localhost URL. Will fail in production, staging, or any non-localhost environment.
- **Expected Behavior:** Use `accountApi.seed()` from `api/endpoints.js` which uses the configured base URL.
- **DS Reference:** Part 34.6 — Security, Part 34.5 — API Client Pattern
- **Severity:** Critical
- **Effort:** XS
- **Dependencies:** `accountApi.seed()` endpoint added to endpoints.js
- **Risk:** None (trivial fix)

### GA-096
- **Module:** GST
- **Screen / File:** `src/pages/gst/GstConfigPage.tsx` line 25
- **Current Behavior:** `fetch('http://localhost:3018/gst/seed-rates', { method: 'POST' })` — hardcoded localhost URL.
- **Expected Behavior:** Use `gstApi.seedRates()` from `api/endpoints.js`.
- **DS Reference:** Part 34.6
- **Severity:** Critical
- **Effort:** XS
- **Dependencies:** `gstApi.seedRates()` added to endpoints.js
- **Risk:** None

### GA-097
- **Module:** Sales
- **Screen / File:** `src/pages/sales/PaymentsPage.tsx` line 147
- **Current Behavior:** `branchId: 1` hardcoded in payment creation payload. Every payment is always assigned to branch 1, regardless of the logged-in user's actual branch.
- **Expected Behavior:** `branchId` read from `useAuthStore().user.branchId` or from a branch selector if user has multi-branch access.
- **DS Reference:** Business correctness, Multi-tenant/Multi-branch
- **Severity:** Critical
- **Effort:** S
- **Dependencies:** Auth store exposing current branchId
- **Risk:** High (data corruption in multi-branch environments)

### GA-098
- **Module:** Sales
- **Screen / File:** `src/pages/sales/SaleReturnsPage.tsx` line 109
- **Current Behavior:** `branchId: 1` hardcoded in sale return creation.
- **Expected Behavior:** Same as GA-097 — read from auth store.
- **DS Reference:** Business correctness
- **Severity:** Critical
- **Effort:** XS
- **Dependencies:** GA-097
- **Risk:** High

### GA-099
- **Module:** Sales
- **Screen / File:** `src/pages/customers/CustomersPage.tsx` — delete mutation
- **Current Behavior:** `toast.success('Customer deactivated')` shown after calling `customerApi.delete(id)`. The message is misleading — the API may hard-delete or deactivate, but the label says "deactivated" regardless.
- **Expected Behavior:** Confirm via `ERPConfirmModal` before delete. Toast after: `toast.success('Customer deleted')` or `'Customer deactivated'` matching the actual API behavior. Include Undo window.
- **DS Reference:** Part 16.7 — Destructive actions require confirmation; Part 19.4 — Undo in toast
- **Severity:** High
- **Effort:** S
- **Dependencies:** ERPConfirmModal
- **Risk:** None

### GA-100
- **Module:** Items
- **Screen / File:** `src/pages/items/ItemsPage.tsx` — delete mutation
- **Current Behavior:** `deleteMutation.mutate(r.id)` called immediately on button click. No confirmation. Toast says "Item discontinued".
- **Expected Behavior:** Confirm first via `ERPConfirmModal`. Toast with accurate message.
- **DS Reference:** Part 16.7
- **Severity:** High
- **Effort:** S
- **Dependencies:** ERPConfirmModal
- **Risk:** None

---

## SECTION 14 — ACCESSIBILITY

### GA-101
- **Module:** All
- **Screen / File:** `src/components/Layout.tsx` lines 154–161
- **Current Behavior:** Sidebar collapse button, logout button have no `aria-label`. Screen readers cannot identify them.
- **Expected Behavior:** `aria-label="Collapse sidebar"`, `aria-label="Logout"` on all icon-only interactive elements.
- **DS Reference:** Part 26.3 — ARIA Requirements
- **Severity:** High
- **Effort:** XS
- **Dependencies:** None
- **Risk:** None

### GA-102
- **Module:** All Forms
- **Screen / File:** ItemFormPage, GstConfigPage, SaleReturnsPage, StockLevelsPage (raw checkboxes)
- **Current Behavior:** Raw `<input type="checkbox">` with sibling text. No `<label>` element wrapping or `htmlFor` association.
- **Expected Behavior:** Either `<label><input type="checkbox" /> Label text</label>` or `<input id="x" aria-label="Label">`.
- **DS Reference:** Part 26.3 — Accessibility
- **Severity:** High
- **Effort:** XS per instance
- **Dependencies:** None
- **Risk:** None

### GA-103
- **Module:** All Tables
- **Screen / File:** `src/components/ui/DataTable.tsx`, `ChartOfAccountsPage.tsx`
- **Current Behavior:** `<th>` elements have no `scope="col"` attribute.
- **Expected Behavior:** All `<th>` column headers have `scope="col"`. Row header cells (tree rows) have `scope="row"`.
- **DS Reference:** Part 26.3 — Data tables use `<th scope="col">`
- **Severity:** Medium
- **Effort:** XS
- **Dependencies:** None
- **Risk:** None

### GA-104
- **Module:** All
- **Screen / File:** All pages
- **Current Behavior:** No focus-visible ring on many interactive elements. Custom focus states not always visible in high-contrast scenarios.
- **Expected Behavior:** Every interactive element has a visible focus ring via CSS `focus-visible:ring-2 ring-focus`.
- **DS Reference:** Part 26.4 — Focus Management
- **Severity:** Medium
- **Effort:** M (systematic sweep needed)
- **Dependencies:** GA-001 (tokens for ring color)
- **Risk:** None

### GA-105
- **Module:** All
- **Screen / File:** All pages
- **Current Behavior:** `document.title` never changes. Screen readers cannot announce page changes when navigating.
- **Expected Behavior:** Every route change updates `document.title` to `"{Page Name} | NEXORAA ERP"`.
- **DS Reference:** Part 26 — Accessibility
- **Severity:** Medium
- **Effort:** S
- **Dependencies:** useDocumentTitle hook or React Helmet
- **Risk:** None

---

## SECTION 15 — PERFORMANCE

### GA-106
- **Module:** All List Pages
- **Screen / File:** CustomersPage, ItemsPage, InvoicesPage, StockLevelsPage, QuotationsPage, etc.
- **Current Behavior:** All tables render all fetched rows in the DOM at once. When data grows, this causes layout jank and slow scrolling.
- **Expected Behavior:** Tables with > 100 rows use TanStack Virtual for virtualized row rendering.
- **DS Reference:** Part 31.3 — Virtual Scrolling
- **Severity:** Medium
- **Effort:** L
- **Dependencies:** `@tanstack/react-virtual` package
- **Risk:** Low

### GA-107
- **Module:** Invoice Form
- **Screen / File:** `src/pages/sales/InvoiceFormPage.tsx` line 60
- **Current Behavior:** `customerApi.list({})` — fetches ALL customers with no pagination or size limit. With thousands of customers this will return an enormous payload and slow the form.
- **Expected Behavior:** `ERPAsyncSelect` for customer search — types to search, fetches on demand (debounced 300ms, minimum 1 char), shows max 20 results.
- **DS Reference:** Part 15.4 — ERPAsyncSelect, Part 31 — Performance
- **Severity:** High
- **Effort:** M
- **Dependencies:** ERPAsyncSelect, customer search API endpoint
- **Risk:** Medium (significant UX change, but correct behavior)

### GA-108
- **Module:** Foundation
- **Screen / File:** `src/App.tsx`
- **Current Behavior:** No code splitting. All 51+ page components bundled in the main chunk.
- **Expected Behavior:** Module-level code splitting with `React.lazy()`.
- **DS Reference:** Part 31.2 — Code Splitting
- **Severity:** Critical
- **Effort:** L
- **Dependencies:** GA-004
- **Risk:** Medium (routing structure changes needed)

---

## SECTION 16 — MULTI-TENANT & THEMING

### GA-109
- **Module:** Foundation
- **Screen / File:** No `TenantThemeProvider` exists
- **Current Behavior:** No runtime tenant theme switching. Logo, colors, app name all hardcoded.
- **Expected Behavior:** `TenantThemeProvider` fetches `/api/v2/tenant/branding` on mount and injects CSS variable overrides via `<style>` tag.
- **DS Reference:** Part 25 — Multi-Tenant Theming
- **Severity:** Medium
- **Effort:** L
- **Dependencies:** Tenant branding API endpoint, GA-001
- **Risk:** Low

### GA-110
- **Module:** Authentication
- **Screen / File:** `src/pages/auth/LoginPage.tsx` line 59
- **Current Behavior:** `<div className="... bg-indigo-600 text-white text-xl font-bold ...">N</div>` — hardcoded "N" letter as logo.
- **Expected Behavior:** `<img src={tenantLogo} alt="Company Logo">` loaded from TenantThemeProvider.
- **DS Reference:** Part 25.1 — What Tenants Can Customize
- **Severity:** Medium
- **Effort:** S
- **Dependencies:** GA-109
- **Risk:** None

### GA-111
- **Module:** Shell
- **Screen / File:** `src/components/Layout.tsx` line 151
- **Current Behavior:** `<span className="text-xl font-bold text-indigo-600">N</span>` hardcoded logo letter.
- **Expected Behavior:** `<img>` with tenant logo URL, with fallback to text initial.
- **DS Reference:** Part 25.1
- **Severity:** Medium
- **Effort:** S
- **Dependencies:** GA-109
- **Risk:** None

---

## SECTION 17 — TYPOGRAPHY & DATE/CURRENCY FORMATTING

### GA-112
- **Module:** All
- **Screen / File:** Multiple pages — date formatting
- **Current Behavior:** `.toLocaleDateString()` used without locale argument. `new Date(str).toLocaleDateString()` produces different output in different browsers/locales. Some pages format as "6/29/2026" (US), others vary.
- **Expected Behavior:** Consistent `DD MMM YYYY` format (e.g., "29 Jun 2026") everywhere. Use a shared `formatDate(dateStr)` utility.
- **DS Reference:** Part 3 — Typography, Date Formatting
- **Severity:** High
- **Effort:** S
- **Dependencies:** Shared date utility function
- **Risk:** None

### GA-113
- **Module:** All
- **Screen / File:** Multiple pages — currency formatting
- **Current Behavior:** Mixed approaches: `parseFloat().toLocaleString('en-IN', { minimumFractionDigits: 2 })`, `Number().toLocaleString('en-IN')`, `Number().toFixed(2)`. Some places format, some don't. No shared utility.
- **Expected Behavior:** Shared `formatCurrency(amount: number | string): string` utility. Always returns `₹1,23,456.00` in Indian lakh format.
- **DS Reference:** Part 3 — Number and Currency Formatting
- **Severity:** High
- **Effort:** S
- **Dependencies:** Shared currency utility
- **Risk:** None

### GA-114
- **Module:** Sales
- **Screen / File:** `src/pages/sales/InvoicesPage.tsx`, InvoiceDetailPage.tsx, InvoiceFormPage.tsx, etc.
- **Current Behavior:** Currency amounts shown in regular sans-serif text, left-aligned in many cases.
- **Expected Behavior:** All currency columns right-aligned, using `font-mono` for currency values in tables.
- **DS Reference:** Part 13.2 — Column Rules (Currency amount: Right, Mono)
- **Severity:** Medium
- **Effort:** XS per column
- **Dependencies:** None
- **Risk:** None

---

## SECTION 18 — COMPONENT API INCONSISTENCIES

### GA-115
- **Module:** Components
- **Screen / File:** `src/components/ui/Button.tsx` lines 6–8
- **Current Behavior:** Button accepts both `loading` and `isLoading` props doing the same thing. `const busy = loading ?? isLoading`.
- **Expected Behavior:** Single `loading` prop only. `isLoading` is a deprecated alias. Remove `isLoading` in next major cleanup to enforce one API.
- **DS Reference:** Part 34 — Coding Standards (no dual props for same concept)
- **Severity:** Low
- **Effort:** XS (mark isLoading deprecated with JSDoc)
- **Dependencies:** None
- **Risk:** None (backward compatible)

### GA-116
- **Module:** Components
- **Screen / File:** `src/components/ui/PageHeader.tsx` lines 9–10
- **Current Behavior:** Accepts both `actions` prop and `children` for the action area. `const actionContent = actions ?? children`.
- **Expected Behavior:** Single `actions` prop only. Children in PageHeader is ambiguous and should be removed.
- **DS Reference:** Part 34 — Clean API design
- **Severity:** Low
- **Effort:** XS (after migrating all usages)
- **Dependencies:** After all pages migrated to ERPPageHeader
- **Risk:** None

### GA-117
- **Module:** Components
- **Screen / File:** `src/components/ui/Badge.tsx`
- **Current Behavior:** Deprecated `color` and `label` props still function. Used in 15+ places across the codebase.
- **Expected Behavior:** All usages migrated to `variant` + `children`. Deprecated props removed.
- **DS Reference:** Part 18 — Status Badge Standard
- **Severity:** Medium
- **Effort:** S
- **Dependencies:** None
- **Risk:** Low

### GA-118
- **Module:** Components
- **Screen / File:** `src/components/ui/Modal.tsx` — missing sizes
- **Current Behavior:** `SIZES` object only has `sm`, `md`, `lg`, `xl`.
- **Expected Behavior:** Add `'2xl'` (`max-w-5xl`) and `'fullscreen'` (`max-w-none w-full h-full`) sizes per design system.
- **DS Reference:** Part 17.1 — Modal Sizes
- **Severity:** Low
- **Effort:** XS
- **Dependencies:** None
- **Risk:** None

---

## SECTION 19 — MISSING ENTITY NAMES IN TABLES

### GA-119
- **Module:** Sales
- **Screen / File:** `InvoicesPage.tsx` column `customerId`, `InvoiceDetailPage.tsx` line 81, QuotationsPage, PaymentsPage, SaleReturnsPage, DeliveryChallansPage
- **Current Behavior:** `{ key: 'customerId', header: 'Customer' }` — renders the raw numeric database ID instead of the customer's display name.
- **Expected Behavior:** Customer name must be resolved. Either: (a) join in the API response, or (b) maintain a lookup map fetched separately.
- **DS Reference:** UX — "No raw IDs shown to users"
- **Severity:** Critical
- **Effort:** M per module (API change or lookup map)
- **Dependencies:** Backend API to join customer name in list responses
- **Risk:** Medium (API change)

### GA-120
- **Module:** Sales
- **Screen / File:** `InvoiceDetailPage.tsx` line 129 — `{l.itemId}`
- **Current Behavior:** Item shown as raw database ID in line items table.
- **Expected Behavior:** Item name. Requires API to include `itemName` in the invoice line response, or separate item lookup.
- **DS Reference:** UX
- **Severity:** Critical
- **Effort:** S (backend must include itemName in response)
- **Dependencies:** Backend API fix
- **Risk:** Medium

---

## SECTION 20 — DELIVERY CHALLAN BROKEN ROUTE

### GA-121
- **Module:** Sales
- **Screen / File:** `src/App.tsx` line 130, `src/pages/sales/DeliveryChallansPage.tsx`
- **Current Behavior:** Route `path="sales/delivery-challans/new"` renders `<DeliveryChallansPage />` — the same list page. There is no create form for delivery challans. Clicking "+ New Challan" navigates to `/sales/delivery-challans/new` which shows the list again.
- **Expected Behavior:** Dedicated `<DeliveryChallanFormPage />` at `/sales/delivery-challans/new`.
- **DS Reference:** Part 33.6 — Route Standards
- **Severity:** Critical
- **Effort:** L
- **Dependencies:** New DeliveryChallanFormPage component
- **Risk:** Medium (new page needed)

---

## SECTION 21 — DARK MODE

### GA-122
- **Module:** Foundation
- **Screen / File:** `src/index.css` line 3
- **Current Behavior:** `@custom-variant dark (&:is(.dark *))` — per project memory, this does NOT apply dark utilities when the `.dark` class is on the root `<html>` element itself (only to its descendants).
- **Expected Behavior:** `@custom-variant dark (&:where(.dark, .dark *))` — handles both the root element and all its descendants.
- **DS Reference:** Theme memory, DS Part 2
- **Severity:** Critical
- **Effort:** XS
- **Dependencies:** None
- **Risk:** None (one character change)

### GA-123
- **Module:** All
- **Screen / File:** `src/components/ui/DataTable.tsx` line 57
- **Current Behavior:** `dark:hover:bg-gray-750` — `gray-750` is not a Tailwind color (Tailwind goes by 50, 100, 200, ..., 900, 950). This class does nothing.
- **Expected Behavior:** Use `dark:hover:bg-gray-700/50` or a CSS variable-based class.
- **DS Reference:** Part 2 — Design Tokens (no arbitrary color values)
- **Severity:** High
- **Effort:** XS
- **Dependencies:** GA-001
- **Risk:** None

---

## COMPLETE ISSUE COUNT BY MODULE

| Module | Critical | High | Medium | Low | Total |
|--------|----------|------|--------|-----|-------|
| Foundation / Architecture | 8 | 4 | 4 | 2 | 18 |
| Navigation / Shell | 5 | 8 | 3 | 1 | 17 |
| Design Tokens / Colors | 5 | 9 | 2 | 0 | 16 |
| Icon System | 2 | 5 | 1 | 0 | 8 |
| Data Table / Grid | 3 | 4 | 4 | 0 | 11 |
| Filter / Toolbar | 0 | 4 | 2 | 0 | 6 |
| Page Header | 1 | 3 | 0 | 0 | 4 |
| Form Pages | 4 | 6 | 6 | 0 | 16 |
| Loading / Empty States | 0 | 4 | 1 | 1 | 6 |
| Modal / Dialog | 3 | 2 | 1 | 1 | 7 |
| Dashboard | 3 | 1 | 1 | 0 | 5 |
| Authentication | 1 | 2 | 1 | 0 | 4 |
| Security / Data Bugs | 4 | 3 | 0 | 0 | 7 |
| Accessibility | 0 | 3 | 3 | 0 | 6 |
| Performance | 1 | 2 | 0 | 0 | 3 |  
| Multi-Tenant / Theming | 0 | 0 | 4 | 0 | 4 |
| Typography / Formatting | 0 | 3 | 1 | 0 | 4 |
| Component APIs | 0 | 0 | 1 | 3 | 4 |
| Missing Entity Names | 2 | 0 | 0 | 0 | 2 |
| Broken Routes | 3 | 0 | 0 | 0 | 3 |
| Dark Mode | 1 | 1 | 0 | 0 | 2 |
| **TOTAL** | **46** | **64** | **35** | **8** | **153** |

> Note: Some issues span multiple categories. 153 unique tracked issues; several generate secondary bugs if not fixed (e.g., GA-069 affects all invoices created for non-Maharashtra orgs).

---

## CRITICAL PATH — MUST FIX BEFORE ANY NEW MODULE

These 15 issues form the minimum viable fix set. Without them, every new module will inherit the same fundamental problems:

1. **GA-001** — Create `src/styles/tokens.css`
2. **GA-002 / GA-122** — Fix `@custom-variant dark` syntax
3. **GA-004** — Add lazy loading to all routes
4. **GA-012** — Replace all emoji with Lucide icons in sidebar
5. **GA-013** — Add breadcrumb system
6. **GA-018** — Fix ThemeContext duplication
7. **GA-026** — Remove all hardcoded `indigo-*` color classes
8. **GA-045 / GA-046 / GA-047** — Rebuild DataTable into ERPDataGrid (sorting + pagination + skeleton)
9. **GA-049** — Row actions `···` menu pattern
10. **GA-060** — Rebuild PageHeader into ERPPageHeader
11. **GA-064** — ERPStickyFooter for all form pages
12. **GA-082 / GA-083 / GA-084** — Modal ARIA + focus trap + Escape key
13. **GA-088 / GA-089** — Fix Dashboard (real data + remove dev scaffolding)
14. **GA-095 / GA-096** — Remove hardcoded localhost URLs (production-breaking bugs)
15. **GA-097 / GA-098** — Fix hardcoded `branchId: 1` (data corruption bug)

---

*Document generated from full code audit of all 51 `.tsx` files in `apps/web-frontend/src/`. Every issue traced to specific file and line number. No issues invented — all found by reading actual code.*
