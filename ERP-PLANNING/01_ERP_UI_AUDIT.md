# NEXORAA ERP — UI/UX Architecture Audit

**Date:** 2026-07-07
**Scope:** `apps/web-frontend` (primary desktop ERP), `apps/pos-frontend` (cashier POS app)
**Method:** Live, file:line-grounded audit of the current codebase — every finding below traces to a specific file. Nothing here is inferred from screenshots or vibes.
**Relationship to prior audits:** `ERP-PLANNING/ERP_FRONTEND_DESIGN_SYSTEM.md` (2,610 lines) and `design-audit-prompt.md` already document large parts of this system in detail. This document is a fresh, independent pass — it does not assume either is current, and re-verifies every claim against the live code. Where it confirms a prior finding, that's noted; where it diverges, the live code wins.

This is Phase 1 of a 7-document set (`01`–`07`) that defines the target UX architecture for the ERP. Phases 2–7 specify the target state; this document specifies the *current* state and its problems, ranked by severity.

---

## 0.1 Correction Log (post-2026-07-07 implementation work)

Everything below §1 was written 2026-07-07 and has already needed multiple corrections as implementation work proceeded — see `erp_ui_impl_phase*` memory entries for the full trail. The single most significant correction, found 2026-07-08 while extracting `ERPTabs` (see [[erp_ui_impl_phase4_2026_07_08]]):

**[NEW FINDING — P1] The Accounting and GST modules were never migrated to the design system at all.** The migration that closed §2.1/§2.2 (DataTable → ERPDataGrid, hand-rolled row actions → ERPDropdownMenu) reached most of the app but stopped short of two whole modules:
- `apps/web-frontend/src/pages/accounting/` — 2 of 15 pages use `ERPDataGrid`/`ERPFormSection`; the other 13 (`BalanceSheetPage`, `BankReconciliationPage`, `CashFlowPage`, `ChartOfAccountsPage`, `FinancialYearsPage`, `FixedAssetDetailPage`, `FixedAssetsPage`, `JournalsPage`, `LedgerPage`, `OpeningBalancesPage`, `ProfitLossPage`, `TDSPage`, `TrialBalancePage`) do not.
- `apps/web-frontend/src/pages/gst/` — 0 of 8 pages (`EInvoicePage`, `GSTR9Page`, `GstCompliancePage`, `GstConfigPage`, `GstRegisterPage`, `Gstr1Page`, `Gstr2aPage`, `Gstr3bPage`) use them.

Confirmed by a second signal: 41 files app-wide still use raw Tailwind palette classes (`text-red-600`, `bg-gray-100`, `border-indigo-600`, etc.) instead of design tokens — a violation of the design system's own founding rule ("No hardcoded colors anywhere," `ERP_FRONTEND_DESIGN_SYSTEM.md` Part 2). The accounting and GST modules account for 19 of those 41 files. The two deprecated pre-design-system components (`components/ui/DataTable.tsx`, `components/ui/PageHeader.tsx` — the latter now confirmed to have **zero** remaining consumers, same as `DataTable.tsx`) also still carry raw color classes in their own dead-code definitions.

This means §2.1/§2.2's "resolved" status is accurate for the transactional modules it was verified against (Customers, Items, Invoices, Purchase, Inventory) but does **not** generalize to the whole app — Accounting and GST are a distinct, unmigrated island. This is a properly-sized, well-defined remaining migration scope for a future session: 21 pages (13 accounting + 8 GST), each needing the same table/form/token conformance pass already proven on the transactional modules. Not attempted in this pass — 21 files of layout/color migration cannot be safely done without live visual verification (no browser-automation tool available this session), and a wrong guess at "equivalent" styling across that many financial-reporting pages risks silent regressions in exactly the pages where correctness matters most.

---

## 0. Severity Legend

| Severity | Meaning |
|---|---|
| **P0 — Critical** | Breaks core usability or data integrity at real scale. Blocks calling this ERP "enterprise-grade." |
| **P1 — High** | Actively hurts daily power-user workflows or contradicts the product's own stated design law. |
| **P2 — Medium** | Inconsistency or missing convenience that erodes polish and trust, but has a workaround. |
| **P3 — Low** | Cosmetic or edge-case; fix opportunistically. |

---

## 1. Navigation & Wayfinding

### 1.1 [P0] No tenant switcher and no branch switcher in the UI
Grepped for `tenantSwitch`, `branchSwitch`, `currentBranch`, `selectedBranch`, `activeBranch` across `apps/web-frontend/src` — zero matches. There is no tenant/branch Zustand store (only `auth.store.ts`, `ui.store.ts`, `recentSearches.store.ts` exist). Branches exist only as a CRUD settings page (`/settings/branches`), not a live in-header switcher.

This is disqualifying for a *multi-tenant, multi-branch* ERP: a user with access to more than one branch has no way to change their working context without a full re-login. Every enterprise ERP we're benchmarking against (Zoho One, NetSuite, Business Central) treats the org/branch switcher as header-level, always-visible chrome — not a settings page.

### 1.2 [P0] No responsive/mobile collapse for the sidebar
`Layout.tsx` toggles sidebar width between `w-16` and `w-60` via a manual pin button (`useUIStore`) — this is the *only* collapse mechanism. There is no `md:`/media-query-driven drawer-overlay behavior. On a narrow viewport the sidebar does not become an overlay or hide by default; it just keeps occupying fixed width. Combined with finding 5.1 (fixed-grid forms not collapsing either), the app is effectively desktop-only today, contradicting the design system's own §1.1 "Mobile Secondary" tenet, which still promises "responsive breakpoints" for dashboards/approvals.

### 1.3 [P1] Command palette and global search are the same component — no pure command/action mode
`ERPCommandPalette.tsx` handles Ctrl+K, but it is entity-search-first (queries `searchApi.search`, groups by entity, shows saved/recent searches). There's no action-oriented mode ("Create Invoice", "Go to Settings", "Toggle Theme") layered on top — the palette can *find records* but can't *execute commands*. Every reference ERP/SaaS command palette (Linear, GitHub, Notion) treats "search records" and "run a command" as two facets of one palette; here only one facet exists.

### 1.4 [P1] No recent-pages, favorites, or pinned-menu-items feature
Grep for "favorite"/"pinned" across `src` returns zero matches. `recentSearches.store.ts` only tracks recent *search queries*, not recently *visited pages*. For a system that will eventually have 250+ modules, the lack of any personal shortcut mechanism (recent pages, pins, favorites) means every navigation to a non-default page costs a full sidebar traversal, every time, for every user — directly contradicting the "Minimal Clicks" design tenet already written into the existing design system doc.

### 1.5 [P2] Breadcrumb/header are not sticky
The header (`Layout.tsx`) has no `position: sticky`/`fixed` — it stays visible today only because `<main>` is the sole scrollable region. This is incidental correctness, not a designed guarantee; any future change to the layout (e.g. a scrollable content wrapper inside a page) will silently break it.

### 1.6 [P2] Sidebar has 12 top-level groups with no collapsible-group memory or count badges
`navigation.ts` defines 12 top-level groups, 2 levels of nesting, permission-filtered correctly — but no badge counts (e.g. "Approvals (4)"), no collapsible group state persistence beyond the whole-sidebar collapse. At 12 groups today, and a stated target of 250+ modules, this will not scale without per-group collapse + search-to-filter.

### 1.7 [P3] Help tooltip promises a shortcut that doesn't exist
`Layout.tsx` renders `title="Help (press ?)"` but no global `?` keydown listener exists anywhere (`useKeyboardShortcut.ts`'s own comment confirms Ctrl+K is "the first" global shortcut). Small, but it's a UI lying to the user — the exact kind of trust erosion the design system explicitly warns against.

---

## 2. Tables & List Pages

### 2.1 [RESOLVED 2026-07-07] ~~Every transactional list page uses a `@deprecated` table with no pagination or sorting~~
**Correction:** re-verified against live code on 2026-07-07 while starting implementation (concurrent sessions share this working tree — see `01`'s note in memory). `components/ui/DataTable.tsx` still carries its `@deprecated` docblock but now has **zero consumers in `pages/`** — `grep -rl "components/ui/DataTable" pages` returns nothing. 31 pages now use `ERPDataGrid`, and spot-checking `CustomersPage`, `ItemsPage`, and `InvoicesPage` confirms `pagination={{page, pageSize, total}}` + `onPageChange` are genuinely wired, not just imported, with real `sortable: true` columns. This P0 is closed; `DataTable.tsx` itself is now dead code ready for deletion (see `07_ERP_IMPLEMENTATION_PLAN.md` Phase 6 retirement step). Not every list page has been re-audited for the specific column configuration quality — treat this as "the migration happened," not "every page is pixel-perfect."

### 2.2 [RESOLVED 2026-07-07] ~~Row actions are hand-rolled per page, not a shared pattern~~
**Correction:** re-verified 2026-07-07 — `ERPDropdownMenu` now has 24 consumers in `pages/`, confirmed as genuine row-action usage (not just an unused import) in `CustomersPage.tsx`. This P1 is substantially closed; a handful of the ~93 remaining page files not yet on `ERPDataGrid`/`ERPDropdownMenu` may still hand-roll actions — not re-audited file-by-file.

### 2.3 [P2] Search is inconsistent across list pages
5 of 8 sampled list pages have a debounced search box (`useDebounce`, 250ms); `PurchaseOrdersPage`, `GRNsPage`, `StockTransfersPage` have none — only a status filter. Feature-parity gap, not a broken feature.

### 2.4 [P2] No shared filter bar / date-range picker component
Zero shared `FilterBar`/`DateRangePicker` component exists in `components/erp` or `components/ui`. Every report/filterable page (e.g. `TrialBalancePage`) implements its own bare `<input type="date">`. This is the same "reinvent per page" failure mode as 2.2, applied to filtering instead of row actions.

### 2.5 [P3] Loading/empty states literal-text on legacy pages
Every `DataTable`-based page shows literal `"Loading…"` text and a plain empty row, despite `ERPTableSkeleton`/`ERPEmptyState` already existing and being imported in the same files (just not used for this purpose). Resolves automatically once 2.1 is fixed.

---

## 3. Forms

### 3.1 [P1, downgraded from P0 — 2026-07-07] Uncoordinated form-layout conventions, partially resolved
Originally sampled 6 form pages and found 6 distinct layout conventions, `ERPFormSection` adopted in only 1. **Re-verified 2026-07-07:** `ERPFormSection` now has 10 consumers out of 14 total `*FormPage.tsx` files — real, meaningful adoption progress, presumably from the same concurrent migration work that closed §2.1/§2.2. Not re-sampled page-by-page to confirm container-width/grid consistency on the 10 migrated pages, and the 4 remaining holdouts are unidentified — downgraded to P1 pending a fresh sample, not closed outright.

### 3.2 [P0] Frontend validation is disconnected from backend validation
`react-hook-form` + `zod` + `zodResolver` are correctly used, but only on `LoginPage`/`ResetPasswordPage`. Every sampled entity CRUD form uses bare `register()` with ad-hoc, incomplete rules. Confirmed concrete gap: backend `customer.routes.ts` requires `phone` (10–20 chars) and validates `email` format server-side; `CustomerFormPage.tsx` has no client-side rule for either. `AccountFormPage.tsx` has no format validation at all beyond 4 `required` fields, including its own IFSC/account-number fields. The shared regex/schema package (`@erp/types`, already imported by both frontend and backend) makes this fixable without inventing new validation infrastructure — the frontend just isn't using the zod-schema half of what it already depends on. This is a real data-integrity risk: a user can submit invalid data that round-trips to the server and fails only after a full network round trip, with no client warning.

### 3.3 [P1] Required-field marking is inconsistent
Most forms use the `required` prop (renders `*` correctly). `PurchaseOrderFormPage` hand-types `"Supplier *"` into label text instead. Small, but it means "required" isn't a single reliable visual language across the app.

### 3.4 [P1] Fixed multi-column grids don't collapse on mobile
`OrganizationPage.tsx` and `EmployeeFormPage.tsx` use fixed `grid-cols-2`/`grid-cols-3` with zero responsive prefixes — unusable below tablet width. Same root cause as 3.1, different symptom.

### 3.5 [P2] Modal/Drawer don't trap focus or restore it on close
`Modal.tsx` and `ERPDrawer.tsx` both correctly implement `role="dialog"`, `aria-modal`, and Escape-to-close — but Tab can escape the open dialog, and focus does not return to the triggering element on close. Scoped to exactly 2 files; not a sitewide rebuild.

### 3.6 [P3] No autosave or dirty-state-warning convention exists anywhere
Not present on any sampled form. Not a regression (never existed), but a gap versus the target design system's form standard (see `03_ERP_DESIGN_SYSTEM.md`).

---

## 4. Theme & Design Tokens

### 4.1 [P1] Two independent, drifting token systems (web-frontend vs pos-frontend)
`apps/pos-frontend/src/styles/tokens.css` is a **copy** of `apps/web-frontend`'s token file, not a shared package. The POS redesign (2026-07-05) explicitly deferred unifying them ("copied now, unify later if drift becomes a real problem" — `POS-REDESIGN_COMPLETION.md`). Drift has already started: pos-frontend's `ThemeContext.tsx` is a separate implementation from web-frontend's, and neither shares a token source of truth. Any future brand/tenant-theming change (see `05_ERP_THEME_SYSTEM.md`) must be made twice today.

### 4.2 [P1] No tenant/client branding, accent color, font, radius, or density customization exists
The current token system is a single fixed light/dark pair (`tokens.css` `:root`/`.dark`). There is no mechanism to override brand color, radius, spacing scale, or density per tenant — everything the user's brief asks for under "Theme System" is greenfield, not a refactor of something broken.

### 4.3 [P1] `prefers-reduced-motion` is never referenced
Zero occurrences anywhere in web-frontend or pos-frontend CSS/TS. Any existing animation (dropdown open/close, drawer slide, modal fade) runs unconditionally for users who've asked the OS to reduce motion.

### 4.4 [P2] No accessibility test tooling wired up
No `jest-axe`, `axe-core`, or `eslint-plugin-jsx-a11y` in either frontend's `package.json` or the root ESLint config. Accessibility is currently verified by manual pass only (confirmed in `POS-REDESIGN_COMPLETION.md`'s own "Known Issues" section) — meaning regressions are not caught by CI.

---

## 5. Dashboard, Reports & Charts

### 5.1 [P2] Reports are a hybrid of two patterns, not one
`TrialBalancePage`, `ArAgingPage`, `InventoryAnalyticsPage` etc. follow a consistent `ERPPageHeader` + `ERPDataGrid` scaffold. `SalesAnalyticsPage`/`HRAnalyticsPage` are bespoke Recharts dashboards with their own layout. `ReportsPage.tsx` (a report catalog) links out to a generic `ReportViewerPage` for engine-driven reports. This isn't broken, but it is three converging-not-yet-converged patterns for "look at a report" — worth consolidating under one report-page standard (see `03_ERP_DESIGN_SYSTEM.md` §Report Standard) before the report catalog grows past its current size.

### 5.2 [P3] Only Recharts, ~7-8 chart instances total, no shared chart-wrapper component
All charting funnels through Recharts (`DashboardPage`, `SalesAnalyticsPage`, `HRAnalyticsPage` — only 3 files). No shared `ChartCard`/legend/tooltip wrapper exists; each page configures Recharts primitives directly. Low severity today given the small surface area, but will become a consistency problem as more analytics pages are added.

---

## 6. Settings & Admin

### 6.1 [P1] "Settings" is fragmented across unrelated route namespaces
`pages/settings/` contains only Organization, Branches, Warehouses. Users, GST config/returns, feature flags, tenant admin, and audit logs all live as separate top-level route groups (`/users`, `/gst/*`, `/admin/*`) rather than under a coherent Settings information architecture. There is also no Roles page and no numbering-sequence/tax-config page found at all — either missing or hidden somewhere ungrepped. A user looking for "where do I configure X" has no single mental model to rely on.

---

## 7. POS Frontend (separate app)

### 7.1 [P2] No app-level navigation chrome at all
`apps/pos-frontend` has exactly 3 routes (`/login`, `/`, `/lookup`) and no `Layout`/`Sidebar`/header component. This is arguably correct for a single-purpose cashier terminal (confirmed intentional — the redesign completion report frames it as in-screen navigation via keyboard shortcuts F2/F8/F9/Esc), but it means none of this document's navigation architecture (Phase 2) applies to POS as written; POS needs its own thin navigation profile, not the full ERP shell.

---

## 8. Cross-Cutting Findings

### 8.1 [P0] Two competing RBAC UI mechanisms, only one wired up
`PermissionGate`/`usePermission` are fully built but have zero call sites anywhere in the app. `PermissionRoute` (route-level, `App.tsx`, ~140 call sites) is the only one actually gating access. This is a landmine for any future contributor who reaches for the more idiomatic-looking `PermissionGate` component and gets no actual protection. Not a navigation-architecture problem per se, but every document in this series must treat `PermissionRoute` as the load-bearing mechanism and never suggest consolidating onto `PermissionGate` as incidental cleanup.

### 8.2 [P1] No sidebar-search, no per-item badge counts, and no loading skeleton for the sidebar itself
The sidebar renders synchronously from a static config (`navigation.ts`), so there's no loading-skeleton need today — but the moment nav becomes tenant/subscription/feature-flag-aware (see `02_ERP_NAVIGATION_ARCHITECTURE.md`), it will need one, and none exists to extend.

---

## 9. Severity Summary

**As of 2026-07-07 (post-implementation-start correction):**

| Severity | Count | Items |
|---|---|---|
| P0 | 3 | 1.1 (resolved — Tenant Switcher dropped as inapplicable, not fixed as a bug), 1.2, 3.2, 8.1 |
| P1 | 10 | 1.3, 1.4, 2.2 (resolved), 3.1 (downgraded from P0), 3.3, 3.4, 4.1, 4.2, 4.3, 6.1 |
| P2 | 7 | 1.5, 1.6, 2.3, 2.4, 3.5, 4.4, 5.1, 7.1 |
| P3 | 4 | 1.7, 2.5, 3.6, 5.2 |
| Resolved | 2 | 2.1, 2.2 — see corrections in §2 |

Original (2026-07-07 morning) table for reference: P0×6 (1.1, 1.2, 2.1, 3.1, 3.2, 8.1), P1×9, P2×7, P3×4. §2.1 and §2.2 were found resolved by concurrent work the same day the audit was written; 1.1 (Tenant Switcher) was found architecturally inapplicable and dropped, not fixed; 1.2 (responsive sidebar), 4.1–4.3 (theme system), and the density/appearance pieces of 3.4 have since shipped — see `erp_ui_impl_phase1_2026_07_07.md` / phase-2 memory for what's actually landed vs. still open.

**Reading this table:** the remaining P0s are 1.2 (if not yet shipped when you read this — check `Layout.tsx` for responsive sidebar classes), 3.2 (validation parity — still open, no schema work has started), and 8.1 (the dual RBAC mechanism — a documentation/discipline issue, not something code changes "fix"). Don't trust the counts above without a fresh grep; this file has already been shown to drift from reality within the same day it was written.

---

## 10. What Is Already Right (do not rebuild)

To keep Phase 7's implementation plan honest about actual remaining work:

- Design tokens exist and are correctly wired for light/dark in web-frontend (`tokens.css`).
- `ERPDataGrid`, `ERPFormSection`, `ERPDropdownMenu`, `ERPGSTINInput`, `ERPCommandPalette`, `ERPBreadcrumb`, `ERPPageHeader`, skeleton components, `ERPDrawer`, `ERPConfirmModal` are all built and functionally correct — the gap is adoption, not invention.
- Global search (Elasticsearch-backed, Ctrl+K, saved/recent searches, click-tracking) is fully implemented and wired to real data — a genuine strength versus the reference ERPs, most of which bolt search on late.
- The notification system is real (SSE live stream, not a stub).
- `Button.tsx` (7 variants) is ~98% consistently adopted — proof that systemic adoption is achievable here when a component is introduced early and used from day one.
- POS's token/dark-mode/component redesign (2026-07-05) is complete and independently verified with tests + Playwright screenshots.
