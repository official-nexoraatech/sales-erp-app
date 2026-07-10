# NEXORAA ERP — Component Library

**Status:** Target catalog. Every component below is either **Exists** (built, keep, just needs wider adoption per `01_ERP_UI_AUDIT.md`), **Extend** (built, needs additional capability per `02`/`03`), or **New** (does not exist today — build it).
**Location convention:** shared components live in `apps/web-frontend/src/components/erp/` (the `ERP*`-prefixed catalog). `apps/pos-frontend` gets a thin, separate `components/pos/` set (already exists, per `01_ERP_UI_AUDIT.md` §10) that consumes the same design tokens (`05_ERP_THEME_SYSTEM.md`) but not the same React components — POS has different interaction constraints (touch targets, single-screen) that don't map cleanly onto the desktop ERP catalog.
**Rule:** no page may hand-roll a one-off version of anything in this catalog. If an existing component is missing a capability a page needs, extend the component — never fork it.

---

## Legend

| Status | Meaning |
|---|---|
| **Exists** | Built and correct today. Adopt it; do not rebuild. |
| **Extend** | Built, but this document's target state requires new props/behavior. |
| **New** | Does not exist in the codebase today. |

---

## 1. Buttons

| Component | Status | Notes |
|---|---|---|
| `Button` | Exists | 7 variants (primary/secondary/danger/ghost/outline/danger-outline/link), ~98% adopted already — the proof-of-concept that systemic adoption works when a component ships early (`01_ERP_UI_AUDIT.md` §10). No changes. |
| `IconButton` | New | A thin wrapper around `Button` for icon-only actions (row actions, header icons) that enforces a consistent 36px/32px hit target and a mandatory `aria-label` prop (no icon-only button ships without one). |

## 2. Inputs

| Component | Status | Notes |
|---|---|---|
| `ERPInput`, `ERPSelect`, `ERPTextarea`, `ERPSwitch` | Exists | Already correct, already carry `aria-invalid`/`aria-describedby` wiring (`01_ERP_UI_AUDIT.md` §2.4). |
| `ERPGSTINInput` | Exists | Reference implementation for live-validation-as-you-type; template for the components below, not to be modified. |
| `ERPFormField` | Exists | Label + input + error/hint wrapper; mandatory for every field. |
| `ERPDatePicker` | New | Single-date and range modes; keyboard-navigable calendar grid; closes the "bare `<input type=\"date\">`" gap found on `TrialBalancePage` etc. (`01_ERP_UI_AUDIT.md` §2.4). |
| `ERPCurrencyInput` | New | Locale-aware (₹ grouping), numeric keypad on touch, right-aligned. |
| `ERPPhoneInput` | New | Country-code prefix + format mask, validated against `@erp/types`' phone schema. |
| `ERPCheckboxGroup`, `ERPRadioGroup` | New | Keyboard arrow-navigable groups; currently every multi-checkbox/radio set is hand-rolled per page. |
| `ERPAsyncSelect` | Exists | Server-searched select (customer/item pickers etc.) — keep as-is. |

## 3. Cards & Surfaces

| Component | Status | Notes |
|---|---|---|
| `ERPCard` | New | Generic token-based surface container (pos-frontend already has the equivalent `POSCard` — mirror its API for web-frontend, don't share the component across apps). |
| `ERPStatCard` | New | KPI tile: label, value, trend delta (↑/↓ + %), optional sparkline. `DashboardPage` currently hand-builds its KPI cards inline — this extracts that into a reusable primitive. |

## 4. Tables

| Component | Status | Notes |
|---|---|---|
| `ERPDataGrid` | Extend | Sort/pagination/skeleton/empty-state/sticky-header already built (`01_ERP_UI_AUDIT.md` §10). Extend with: resizable columns, column reordering, column-visibility toggle, saved views, advanced filter builder, bulk-action bar, density selector, virtualization, `role="grid"` keyboard nav — per `03_ERP_DESIGN_SYSTEM.md` Part 3. |
| `components/ui/DataTable` | Retire | `@deprecated` today, still the only table in production use. Removed once migration (`07_ERP_IMPLEMENTATION_PLAN.md`) completes — do not add new consumers in the meantime. |
| `ERPPagination` | Exists | Correct, just needs callers (`01_ERP_UI_AUDIT.md` §10). |
| `ERPDropdownMenu` | Exists | Zero current usages — this is the mandated row-actions pattern (`03_ERP_DESIGN_SYSTEM.md` §3.2). |

## 5. Dialogs, Drawers, Dropdowns, Popovers

| Component | Status | Notes |
|---|---|---|
| `Modal` | Extend | Has `role="dialog"`/`aria-modal`/Escape already; add focus trap + focus-restore-on-close (`01_ERP_UI_AUDIT.md` §3.5) — the one concrete, scoped accessibility fix in this whole catalog. |
| `ERPDrawer` | Extend | Same focus-trap/restore fix as `Modal`. |
| `ERPConfirmModal` | Exists | Used for destructive-action confirmation (e.g. logout) — keep. |
| `ERPDropdownMenu` | Exists | Also serves as the "Popover menu" primitive generally (tenant switcher, branch switcher in `02_ERP_NAVIGATION_ARCHITECTURE.md` reuse this, not a new popover component). |
| `Popover` (generic, non-menu content) | New | For things like a saved-view editor or a filter-chip's inline edit UI that isn't a list of actions — thin wrapper sharing `ERPDropdownMenu`'s positioning logic (Floating-UI or equivalent), different content slot. |

## 6. Badges, Alerts, Toasts

| Component | Status | Notes |
|---|---|---|
| `ERPStatusBadge` | New | Standardizes every ad hoc colored-pill-with-text pattern currently scattered per page (invoice status, approval status, sync status) into one component: `variant` (success/warning/danger/info/neutral) always pairs a token color with text — never a bare colored dot (`03_ERP_DESIGN_SYSTEM.md` Part 7). |
| `Alert` (inline banner) | New | Persistent, page-level messages (e.g. "Draft saved," feature-flag notices) — distinct from Toast, which is transient. |
| Toast (`react-hot-toast`) | Exists | Already standard; POS's `ThemedToaster` wrapper pattern (reading theme context to fix portal styling — `01_ERP_UI_AUDIT.md` §10) should be ported to web-frontend if the same portal/dark-mode issue is confirmed there. |

## 7. Timeline, Calendar

| Component | Status | Notes |
|---|---|---|
| `ERPTimeline` | New | Chronological event feed (status changes, comments, approvals) — required by `03_ERP_DESIGN_SYSTEM.md` §4.6 Activity tab. One component, reused across every entity's Detail page. |
| Calendar (full month/week scheduling view) | New | Only if/when a scheduling module (e.g. production planning, HR leave calendar) needs it — not required by any current page; do not build speculatively ahead of a concrete consumer. |

## 8. Charts

| Component | Status | Notes |
|---|---|---|
| Recharts primitives (`AreaChart`, `BarChart`, `PieChart`, `LineChart`) | Exists | Already the sole charting library (`01_ERP_UI_AUDIT.md` §5.2) — do not introduce a second charting library. |
| `ChartCard` | New | Wraps a Recharts chart with a consistent card header, legend, tooltip styling, and loading/empty state — closes the "no shared chart wrapper" gap; every dashboard/analytics chart renders through this, not raw Recharts JSX per page. |

## 9. Tags, Avatar, File Upload

| Component | Status | Notes |
|---|---|---|
| `ERPTag` | New | Small removable/non-removable label chip — used for filter chips (`03_ERP_DESIGN_SYSTEM.md` §5) and multi-value fields (e.g. item categories). |
| `ERPAvatar` | New | User/tenant avatar with initials fallback — used in header profile menu, comments, activity timeline. |
| `ERPFileUpload` | New | Drag-drop zone + file list with progress/error per file — required by the Attachments pattern (`03_ERP_DESIGN_SYSTEM.md` §4.6). |

## 10. Tree, Tabs, Accordion

| Component | Status | Notes |
|---|---|---|
| Tree (Chart of Accounts hierarchy today) | Extend | A tree view already exists for Chart of Accounts (custom `▼/▶` markup, already migrated to Lucide icons per `FRONTEND_DESIGN_COMPLETION_PLAN.md` M-03) — generalize into a reusable `ERPTree` if a second tree consumer appears (e.g. category hierarchy); don't force a premature abstraction for a single current user. |
| `ERPTabs` | New | Standardizes the Tabs pattern used by both Detail pages (`03_ERP_DESIGN_SYSTEM.md` §4.6: Overview/Attachments/Activity/Comments) and large forms (§4.5). |
| `ERPAccordion` | New | Collapsible section, used only per §4.5's rule (Detail-page optional sections, never primary Create-form fields). |

## 11. Navigation-Specific Components (cross-ref `02_ERP_NAVIGATION_ARCHITECTURE.md`)

| Component | Status | Notes |
|---|---|---|
| `ERPBreadcrumb` | Exists | Keep; make the header's `position: sticky` explicit per `02` §6 (a layout fix, not a component fix). |
| `ERPCommandPalette` | Extend | Add action/command mode (`02` §9), recent-pages section (`02` §10). |
| `NotificationsPanel` | Extend | Add type grouping once volume warrants (`02` §15) — not urgent. |
| `Kbd` | New | Single shared component for rendering keyboard-shortcut hints (`⌘K`, `Ctrl+K`) — replaces hand-typed "Ctrl K" text found in the header today. |
| Tenant Switcher, Branch Switcher | New | Header popovers per `02` §14 — genuinely new surface, no prior art to extend. |
| Quick Create menu | New | Header "+ New" per `02` §11. |
| Sidebar (Layout shell) | Extend | Add hover-expand mode, responsive collapse breakpoints, per-group collapse-state persistence, Pinned group (`02` §4, §5, §10). |

---

## 12. What NOT to Build

Per `01_ERP_UI_AUDIT.md` §10 and the design system's "no speculative abstraction" law (CLAUDE.md Part 2 applies here too): do not build `ERPCommandPalette` v2 as a separate component (extend the existing one), do not build a second table component "for reports" (the Report Standard in `03_ERP_DESIGN_SYSTEM.md` Part 6 reuses `ERPDataGrid`), do not build a generic drag-and-drop reordering system for the Pinned-menu feature (`02` §10 explicitly scopes that out of v1).
