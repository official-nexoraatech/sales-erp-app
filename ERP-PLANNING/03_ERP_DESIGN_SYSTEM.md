# NEXORAA ERP — Design System

**Status:** Target specification. Standardizes every Workspace, Table, and Form in the ERP into one universal pattern each.
**Precedes:** `04_ERP_COMPONENT_LIBRARY.md` (the components that implement these standards), `06_ERP_DESIGN_TOKENS.md` (the raw values these standards consume).
**Grounding:** Current adoption gaps for every rule below are documented with file:line evidence in `01_ERP_UI_AUDIT.md` §2 (Tables) and §3 (Forms). This document does not repeat that evidence — it defines the target every page must converge to.

---

## PART 1 — DESIGN PHILOSOPHY

**Enterprise first.** Every screen is designed for a professional using it 8 hours a day, 250 days a year — not a first-time visitor. Speed and density win over decoration every time.

**One workspace, one table, one form.** There is exactly one way to build a list page, one way to build a create/edit page, one way to build a detail page. A developer building the 40th module reuses the same three patterns the 1st module used. Local creativity is forbidden; system-wide improvement is welcome — but it improves this document, not a single page.

**Keyboard-first, permission-driven, zero learning curve.** These three tenets (kept from the prior design system doc, which got them right) govern every component decision below: every action reachable without a mouse, every forbidden action invisible rather than disabled, every module behaving like every other module.

**No component invents its own states.** Loading, empty, error, and permission-denied are not per-page decisions — they render identically everywhere because they come from the same shared components (`04_ERP_COMPONENT_LIBRARY.md`), configured with page-specific copy only.

---

## PART 2 — THE WORKSPACE STANDARD

Every page in the ERP is a **Workspace**. A Workspace is composed of the same 9 regions, top to bottom, always in this order. A page is not allowed to skip a region it needs, reorder regions, or invent a 10th region.

```
┌─────────────────────────────────────────────────┐
│ Breadcrumb                                       │
│ Title                          [Action Buttons]  │
│ Description                                      │
├─────────────────────────────────────────────────┤
│ Filter Bar                                       │
├─────────────────────────────────────────────────┤
│                                                   │
│ Content (Table | Form | Detail | Dashboard)      │
│                                                   │
├─────────────────────────────────────────────────┤
│ Pagination                                       │
├─────────────────────────────────────────────────┤
│ Footer (contextual: record count, last-sync, etc)│
└─────────────────────────────────────────────────┘
```

### 2.1 Region Rules

| Region | Rule |
|---|---|
| **Breadcrumb** | Always present except on Dashboard. Rendered by the shared `ERPBreadcrumb`, never hand-built. |
| **Title** | The page's noun, not a sentence ("Customers", not "Manage Your Customers"). `text-xl font-semibold`. |
| **Action Buttons** | Right-aligned, same row as Title. Primary action (usually "+ New X") is always the rightmost, `variant="primary"`. Secondary actions (Export, Import, Bulk Actions trigger) sit left of it as `variant="secondary"`/`"outline"`. Maximum 4 visible buttons; anything beyond collapses into an `ERPDropdownMenu` "More" button. |
| **Description** | Optional, one line, `text-secondary`, only when the page's purpose isn't obvious from its Title (most list/detail pages omit it; complex admin/config pages use it). |
| **Filter Bar** | Present on every list/report Workspace. See Part 3 for the Table Standard's filter requirements — this region is where they render. Absent on pure form/detail Workspaces. |
| **Content** | The Table, Form, Detail layout, or Dashboard grid — see Parts 3–4 and this doc's Report Standard (§6). |
| **Pagination** | Present whenever Content is a paginated table. Absent on forms/detail/dashboard. Always the shared `ERPPagination`, never hand-rolled page-number math. |
| **Footer** | Contextual, optional: record count ("Showing 1-50 of 1,204"), last-synced timestamp for offline-capable views, or nothing. Never decorative. |

### 2.2 Required States

Every Workspace's Content region must implement all five states below. A page that only handles the "happy path" (data loaded, non-empty, permitted) is incomplete, full stop.

| State | Rule |
|---|---|
| **Loading** | Skeleton matching the Content's actual shape (`ERPTableSkeleton` for tables, `ERPFormSkeleton` for forms, `ERPCardSkeleton` for dashboards/detail) — never a spinner, never literal "Loading…" text. |
| **Empty** | `ERPEmptyState` with a state-specific icon, one-line explanation, and (if the user has create permission) a primary CTA to create the first record. Distinct copy from the Error state — "no customers yet" reads differently than "failed to load customers." |
| **Error** | `ERPEmptyState` variant (or dedicated `ERPErrorBoundary`, already in use on some report pages — standardize on it everywhere) with a Retry action. Never a raw stack trace or unhandled white screen. |
| **Permission (no access)** | The route itself is unreachable (per `PermissionRoute`, `01_ERP_UI_AUDIT.md` §8.1 — this mechanism is load-bearing, do not touch). A Workspace never needs to render its own "you don't have access" screen for the whole page; it only needs partial-permission handling for individual actions/columns within an otherwise-visible page (e.g. a user can view Invoices but not see the Cost column). |
| **Success (post-action)** | Toast (`react-hot-toast`, already standard) for transient confirmation; inline banner only for state that must persist across a re-render (e.g. "Draft saved 2 minutes ago"). |

---

## PART 3 — THE TABLE STANDARD

One component: `ERPDataGrid`. `components/ui/DataTable.tsx` is retired (already `@deprecated` in code — this document makes that final; see `07_ERP_IMPLEMENTATION_PLAN.md` for the migration sequence). No page may render a table any other way — no bare `<table>`, no third table library.

### 3.1 Required Capabilities (all built into `ERPDataGrid` already — see `01_ERP_UI_AUDIT.md` §10)

| Capability | Behavior |
|---|---|
| **Sticky header** | Column headers pin to the top of the scrollable table region. |
| **Sticky action column** | The row-actions column (rightmost) pins horizontally when the table scrolls sideways on narrow viewports. |
| **Resizable columns** | Drag the column border; width persists per-user, per-table (localStorage, keyed by table id). |
| **Column reordering** | Drag column header to reorder; persists the same way as resize. |
| **Column visibility** | A "Columns" toggle (in the Filter Bar, not per-column chrome) opens a checklist of hideable columns. Primary identifying column (e.g. Customer Name) is never hideable. |
| **Saved views** | A named combination of filters + sort + column visibility/order, saved per-user (server-persisted, same mechanism as Favorites in `02_ERP_NAVIGATION_ARCHITECTURE.md` §10). A view selector sits at the left of the Filter Bar. |
| **Filter builder / advanced filters** | Simple filters (status chips, date range) inline in the Filter Bar; an "Advanced Filters" trigger opens a drawer for multi-condition AND/OR filtering on any column. |
| **Search** | One debounced (250ms) search box, always in the same position (left of Filter Bar), searching the table's primary text columns server-side. This closes the 3-page gap found in `01_ERP_UI_AUDIT.md` §2.3 — search is not optional per-page, it is required on every list Workspace. |
| **Sorting** | Click column header to sort; shift-click for secondary sort key. Server-side when the endpoint supports it, client-side fallback otherwise — but the column must be marked `sortable` either way; unsortable columns simply don't render the sort affordance. |
| **Pagination** | Always wired — no list page ships without page/pageSize/total connected to `ERPPagination`. This is the single highest-priority fix from `01_ERP_UI_AUDIT.md` §2.1. |
| **Bulk actions** | Row checkboxes → a bulk-action bar replaces the Filter Bar when ≥1 row is selected (Approve, Export, Delete, etc., permission-filtered per action). |
| **Export** | CSV/XLSX export respecting current filters+column visibility, triggered from the Filter Bar's overflow menu. |
| **Import** | Only on pages where bulk import is a real workflow (Items, Customers, Opening Balances) — not a universal requirement, but where present, always the same import-wizard pattern (see Form Standard §4.6 Wizard). |
| **Density selector** | Comfortable / Compact toggle in the Filter Bar overflow menu, persisted per-user globally (not per-table) — enterprise users who prefer compact want it everywhere, not table-by-table. |
| **Virtualization** | Required for any table whose result set can exceed ~500 rows even after pagination controls exist (e.g. a 100-per-page view is still 100 DOM rows — virtualize once row count × complexity causes jank; profile, don't guess). |
| **Infinite scroll** | Optional, opt-in per table — only for feed-like views (activity timeline, audit log), never for a table that also needs sorting/filtering (pagination and infinite scroll are mutually exclusive per table). |
| **Row hover / selection / expansion** | Hover: `surface-subtle` row tint. Selection: checkbox column, `brand-primary-subtle` row tint. Expansion: optional chevron-triggered sub-row for master-detail (e.g. Invoice line items) — not built as a separate table. |
| **Keyboard navigation** | Arrow keys move focus cell-to-cell (grid pattern), Enter opens the row (or the primary action), Space toggles row selection, matches WCAG's grid `role="grid"` pattern. |

### 3.2 Row Actions

Always `ERPDropdownMenu` ("⋮" trigger, rightmost sticky column) once a row has more than 1 action. A row with exactly 1 primary action (e.g. "View") may render it as a direct icon button instead of forcing a 1-item menu. Never a hand-rolled `flex gap-2` of ghost buttons — this retires the pattern found in every sampled page in `01_ERP_UI_AUDIT.md` §2.2.

---

## PART 4 — THE FORM STANDARD

One layout system for every Create/Edit page, built on the existing `ERPFormSection` + `ERPFormField` + `ERPInput`/`ERPSelect`/`ERPTextarea` primitives (`01_ERP_UI_AUDIT.md` §10 confirms these are already built correctly — the fix is adoption, not invention).

### 4.1 Container & Grid

- **Container width:** full width of the content area, no arbitrary `max-w-2xl`/`max-w-3xl` cap. `ERPFormSection`'s own `columns` prop (1–4) does the column layout, not a page-level width constraint. This directly retires the `01_ERP_UI_AUDIT.md` §3.1 finding.
- **Grid:** every field grid starts `grid-cols-1` (mobile) and widens via `md:`/`lg:` prefixes — no fixed unconditional `grid-cols-2`/`grid-cols-3` anywhere (closes §3.4).
- **Spacing:** `--space-2xl` between sections, `--space-lg` between fields within a section, `--space-sm` between a field's label and input.

### 4.2 Sections

`ERPFormSection` is the only grouping primitive — no native `<fieldset>`, no plain `<section>`/`<div>` grouping (closes §3.1). Each section has a header + optional one-line description, and its own `columns` prop independent of sibling sections (e.g. "Basic Info" at 2 columns, "Address" at 1 column for a full-width text area).

### 4.3 Validation

- Every entity form defines a `zod` schema, importing shared primitives from `@erp/types` (already used by the backend — `01_ERP_UI_AUDIT.md` §3.2) rather than re-deriving regex rules. `useForm` wires `resolver: zodResolver(schema)`, the pattern already proven on `LoginPage`/`ResetPasswordPage`.
- **Inline errors** render directly under the field, `text-danger`, appearing on blur (not on every keystroke) and re-validating on change once an error is showing.
- Required fields mark via the `required` prop only — never hand-typed asterisks in label text (closes §3.3).
- High-friction fields (GSTIN, PAN, IFSC) use `ERPGSTINInput`'s live-validation-as-you-type pattern as the template (already the one correct reference implementation per `01_ERP_UI_AUDIT.md` §10).

### 4.4 Autosave & Dirty State

- **Autosave:** opt-in per form, only for genuinely long forms where data loss is costly (multi-line Purchase Orders, Payroll runs) — saves a draft every 30s of inactivity after the first edit, shown via a small "Saved" / "Saving…" indicator near the form title. Not a blanket requirement for every form (a 4-field Customer Quick-Create doesn't need it).
- **Dirty state warning:** universal — any form with unsaved changes blocks in-app navigation away (a confirm dialog) and sets `beforeunload` for browser-level navigation/close. This is a zero-invention addition (standard React Router `useBlocker` + `beforeunload`), currently absent everywhere per the audit.

### 4.5 Tabs vs. Accordion vs. Wizard

Three layout escalation levels, chosen by field count and interdependency — never mixed within one form:

| Pattern | When |
|---|---|
| **Single scroll (sections stacked)** | Default. Under ~20 fields, no sequential dependency. |
| **Tabs** | 20+ fields naturally grouping into 3-6 independent categories a user jumps between non-sequentially (e.g. Item: Basic / Pricing / Tax / Inventory / Attachments). |
| **Accordion** | Used only inside a Detail page's read view for optional/rarely-needed sections (e.g. "Advanced Settings," collapsed by default) — not for primary Create/Edit forms, where hiding required fields behind a collapsed accordion is a usability trap. |
| **Wizard** | Reserved for genuinely sequential, branching, multi-step creation flows where step N's options depend on step N-1's answers (e.g. Tenant onboarding, Bulk Import). Each step is its own `ERPFormSection` set; a persistent step indicator lives above the Content region. |

### 4.6 Attachments, Audit, History, Comments, Approval

These are **Detail-page** concerns, not Create-form concerns — they appear once a record exists, as tabs or a right-side panel on the Detail/View page, never inside the initial creation form:

- **Attachments:** drag-drop file zone + list, using the shared `ERPFileUpload` (see `04_ERP_COMPONENT_LIBRARY.md`).
- **Audit Information:** created-by/at, last-modified-by/at — a small `text-tertiary` line, always in the same position (top-right of the Detail page header, below Action Buttons).
- **History / Activity Timeline:** a chronological event feed (status changes, edits, approvals) in a dedicated "Activity" tab — one shared `ERPTimeline` component, not per-module bespoke markup.
- **Comments:** attached to the record, threaded, permission-gated by the same RBAC as the record itself.
- **Approval Status:** a `ERPStatusBadge` (see `04_ERP_COMPONENT_LIBRARY.md`) in the Detail header, plus an Approval History section inside the Activity tab — never a separate, disconnected "approvals" page fragment.

---

## PART 5 — SEARCH, FILTER & PAGINATION STANDARD

(Cross-referenced from Part 3; stated once here since it applies beyond tables — e.g. the command palette in `02_ERP_NAVIGATION_ARCHITECTURE.md` §9 reuses the same debounce/highlight conventions.)

- **Debounce:** 250ms, one shared `useDebounce` hook (already exists, already correctly used on 5/8 sampled pages per the audit — extend to all).
- **Filter Bar composition, left to right:** Search box → Saved View selector → Quick filter chips (status, date range) → Advanced Filters trigger → overflow menu (Columns, Density, Export/Import).
- **Pagination:** page-size options `[25, 50, 100]`, default 50. URL-synced (`?page=`/`?size=`) so back/forward and shared links restore state (closes `02_ERP_NAVIGATION_ARCHITECTURE.md` §17's flagged gap).

---

## PART 6 — THE REPORT STANDARD

Consolidates the 3 converging-not-yet-converged patterns found in `01_ERP_UI_AUDIT.md` §5.1 into one:

- **Tabular reports** (Trial Balance, AR/AP Aging, Stock Valuation, GSTR returns): Workspace = Filter Bar (date range + branch, minimum) + `ERPDataGrid` (export-heavy, sort/filter usually less critical than a transactional table, but still built on the same component — never a separate report-only table implementation).
- **Analytical dashboards** (Sales Analytics, HR Analytics): Workspace = Filter Bar (date range) + a KPI-card row + a chart grid, using the shared `ERPStatCard` + a `ChartCard` wrapper around Recharts (new — closes the "no shared chart wrapper" gap in `01_ERP_UI_AUDIT.md` §5.2).
- **Report catalog/viewer** (`ReportsPage` → `ReportViewerPage`): stays as the entry point for parametrized/engine-driven reports; `ReportViewerPage`'s rendered output must itself resolve to one of the two patterns above, never a third bespoke layout.

---

## PART 7 — ACCESSIBILITY BASELINE (applies to every part above)

WCAG 2.1 AA minimum, AAA for login/payment/approval flows (kept from existing design system — correct, not revised). Concretely, per this document's components:

- Every `ERPDataGrid` implements `role="grid"` keyboard navigation (Part 3.1).
- Every `Modal`/`ERPDrawer`/dropdown/command-palette traps focus and restores it to the trigger on close — closes `01_ERP_UI_AUDIT.md` §3.5, the one concrete accessibility defect currently in production.
- Every form field has a programmatically associated label (`ERPFormField` already does this correctly per the audit — keep as the enforced primitive).
- Color is never the sole carrier of meaning — status always pairs a token color with an icon and/or text label (e.g. `ERPStatusBadge` always renders text, not just a colored dot).
- All animation respects `prefers-reduced-motion` (closes `01_ERP_UI_AUDIT.md` §4.3).
