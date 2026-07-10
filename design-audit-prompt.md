# Cloth ERP — Frontend Design Audit & Enterprise UX Implementation Plan

**Date:** 2026-07-05
**Scope:** `apps/web-frontend` (React 19 + TypeScript 5 strict + Tailwind CSS v4 + React Router v7 + TanStack Query v5 + React Hook Form v7 + Zustand)
**Author context:** Live codebase audit performed against the current `main`/`suresh` branch — every finding below is traced to a specific file and line, not generic advice.

---

## 0. Critical Context — Read This First

**A complete, mandatory design system specification already exists:** [`ERP-PLANNING/ERP_FRONTEND_DESIGN_SYSTEM.md`](ERP-PLANNING/ERP_FRONTEND_DESIGN_SYSTEM.md) (2,606 lines, dated 2026-06-30, status "ENFORCED"). It already defines design tokens, typography, icon standards, layout, sidebar/header, breadcrumbs, page headers, KPI cards, filters/toolbars, the data grid standard, the form standard, dialogs, buttons, responsive rules, accessibility, i18n, performance, folder structure, naming, a full component catalog (Part 35), a deviation audit checklist (Part 36), a deviation register (Part 37), and a phased refactoring roadmap (Part 38, Milestones R.1–R.7).

**This document does not replace that spec — it supersedes Part 37's deviation register with a fresh audit, and turns Part 38's roadmap into a concrete, current-state-aware execution plan.** Do not re-derive design tokens, icon rules, or component APIs from scratch; they are already specified. Where this document says "per the design system," it means: implement exactly what `ERP_FRONTEND_DESIGN_SYSTEM.md` already specifies for that concern.

**Important discrepancy found:** [`ERP-PLANNING/audit-phase-prompts/ES-15-FRONTEND-UX-DEPRECIATION.md`](ERP-PLANNING/audit-phase-prompts/ES-15-FRONTEND-UX-DEPRECIATION.md) is marked `STATUS: ✅ COMPLETED` and its brief was explicitly "resolve all frontend UX issues identified in the audit ... mandatory: all tables use ERPDataGrid, all forms use ERPFormField + ERPInput/ERPSelect." The live audit below shows this is **not actually the current state** — the deprecated `DataTable` is still used on every transactional list page, `ERPFormSection` is used in only one of six sampled form pages, and no list page has pagination or sorting wired despite `ERPDataGrid` supporting both. Either regression occurred after ES-15, or the completion report overstated scope. Either way: **treat Part 37 of the design system doc and the ES-15 completion report as stale, and this document's Section 2 as the ground truth for what still needs fixing.**

**What's actually already done (don't rebuild it):**
- Design tokens exist and are wired: `apps/web-frontend/src/styles/tokens.css` — full light/dark CSS custom-property system matching Part 2 of the spec exactly.
- Most of the Part 35 component catalog already exists under `apps/web-frontend/src/components/erp/`: `ERPPageHeader`, `ERPBreadcrumb`, `ERPDataGrid`, `ERPPagination`, `ERPEmptyState`, `ERPTableSkeleton`/`ERPFormSkeleton`/`ERPCardSkeleton`/`ERPDetailSkeleton`, `ERPDropdownMenu`, `ERPFormField`, `ERPInput`, `ERPSelect`, `ERPTextarea`, `ERPSwitch`, `ERPFormSection`, `ERPStickyFooter`, `ERPConfirmModal`, `ERPAsyncSelect`, `ERPDrawer`, `ERPGSTINInput`.
- `lucide-react` is the icon library, `react-hot-toast` for notifications — both already standard, no emoji icons found in the audited sample.
- `Button.tsx` already has 7 variants (primary/secondary/danger/ghost/outline/danger-outline/link) and is used consistently (83 of 84 sampled pages import the shared component; only 1 hand-rolls a raw `<button>`).
- `react-hook-form` + `zod` + `@hookform/resolvers` are already installed and already used correctly (with `zodResolver`) on `LoginPage`/`ResetPasswordPage` — the pattern exists, it's just not applied to entity CRUD forms yet.

**The gap is adoption, not invention.** The remaining work is: finish migrating list/form pages onto the components that already exist, wire up features those components already support (sorting, pagination), and close a validation-parity gap that has a ready-made fix (a shared zod package already used by the backend).

---

## 1. Executive Summary

The Cloth ERP frontend has a solid, already-specified design system and roughly two-thirds of its target component library built. The problem is **inconsistent adoption**: six different form-layout patterns exist for the same "grouped form section" concept, a component explicitly marked `@deprecated` is still the only table implementation used by every transactional list page, and frontend validation is disconnected from the backend's — despite the backend's validation rules already living in a shared package the frontend already depends on.

None of the findings below require new architecture, new dependencies, or backend changes. This is a **conformance and completion pass** against an existing standard, executed page-by-page and component-by-component, in the priority order in Section 14. Business logic, API contracts, RBAC, and routing are untouched by every recommendation in this document — see Section 16 for exactly why each is safe.

Headline numbers from the live audit:
- **0 of 8** sampled transactional list pages (Customers, Invoices, Quotations, Purchase Orders, GRNs, Stock Transfers, Items, Suppliers) have pagination or sorting wired, though the underlying `ERPDataGrid` component supports both.
- **1 of 6** sampled form pages uses the shared `ERPFormSection` grouping component; the other 5 use three different ad-hoc patterns (plain `<section>`, native `<fieldset>`, bare `<div>`).
- **Frontend/backend validation mismatch confirmed** on real fields: e.g. `CustomerFormPage` has no rule for `phone` or `email`, while the backend (`apps/sales-service/src/api/customer.routes.ts`) requires `phone` (min 10 chars) and validates `email` format — a customer can be entered in the UI with no phone number and no client-side warning, then fail silently until the API round-trip returns a 400.
- Two independent, non-overlapping RBAC mechanisms exist (`PermissionGate`/`usePermission` — built, unused; `PermissionRoute` — the one actually gating all ~140 routes). Any redesign must treat `PermissionRoute` in `App.tsx` as load-bearing and leave it untouched.

---

## 2. UI Audit Findings

### 2.1 Forms — the flagged `/inventory/items/new` issue and beyond

Confirmed root cause of the reported symptom: [`ItemFormPage.tsx:101`](apps/web-frontend/src/pages/items/ItemFormPage.tsx#L101) renders `<form className="max-w-3xl space-y-6">` — a hard 768px cap with no `mx-auto`, no side content, and no responsive widening. On any viewport wider than ~800px (accounting for sidebar + padding), everything right of 768px is dead space.

This is not an isolated bug — it's a symptom of six different, uncoordinated form-layout conventions found across just six sampled pages:

| Page | Container width | Field grid | Grouping pattern |
|---|---|---|---|
| `ItemFormPage.tsx` | `max-w-3xl` | fixed `grid-cols-2`, no responsive prefix | plain `<section>` + manual `<h2>` |
| `CustomerFormPage.tsx` | `max-w-2xl` | fixed `grid-cols-2` | mixes plain `<div>` grids **and** `ERPFormSection` in the same page |
| `SupplierFormPage.tsx` | `max-w-2xl` | fixed `grid-cols-2` | native `<fieldset>`/`<legend>` |
| `AccountFormPage.tsx` | `max-w-2xl` | fixed `grid-cols-2` + ungrouped full-width inputs | native `<fieldset>` |
| `AlterationFormPage.tsx` | `max-w-3xl`, no `<form>` element at all | `grid-cols-2` + a separate `grid-cols-12` for line items | plain `<div>` with card classes |
| `PurchaseOrderFormPage.tsx` | none (full width) | responsive `grid-cols-1 lg:grid-cols-3` / `lg:grid-cols-2` | none — inline `*` in label text instead of the `required` prop |

No shared `FormPageLayout`/`PageContainer` wrapper exists anywhere in the codebase (confirmed via grep — zero matches). `ERPFormSection` already supports a configurable 1–4 column grid via its `columns` prop and a header/description slot — it is simply not used consistently.

### 2.2 Tables and list pages

`apps/web-frontend/src/components/ui/DataTable.tsx` carries an explicit `@deprecated Use ERPDataGrid from components/erp instead` docblock, yet it is the component actually rendering **every** transactional list page sampled (Customers, Invoices, Quotations, Purchase Orders, GRNs, Stock Transfers, Items, Suppliers). `ERPDataGrid` — sortable, paginated, with real skeleton/empty-state defaults, sticky header — is currently only consumed by report-type pages (AR/AP Aging, Stock Valuation, Inventory Analytics).

Consequences of this, confirmed live:
- No sorting anywhere in the transactional UI.
- No pagination UI anywhere; every list page fetches its entire result set client-side (`CustomersPage` fetches a fixed `page:0,size:50`; others fetch unbounded). This will degrade badly once tenants have real data volume.
- Loading state on every `DataTable`-based page is literal text `"Loading…"`; empty state is a plain text row — `ERPEmptyState`/skeleton components exist and are imported elsewhere in the same files but only for the top-level query-error branch, not for empty-data or loading.
- Row actions are hand-rolled per page as a `flex gap-2` of individual ghost buttons (`CustomersPage.tsx:81-87`, `InvoicesPage.tsx:106-124`) rather than the `ERPDropdownMenu` "more actions" pattern — `ERPDropdownMenu` has zero usages inside any page today.
- Search is inconsistent: `CustomersPage`, `ItemsPage`, `SuppliersPage`, `InvoicesPage`, `QuotationsPage` have a debounced (250ms, via the shared `useDebounce` hook) search box; `PurchaseOrdersPage`, `GRNsPage`, `StockTransfersPage` have no search box at all, only a status filter — a feature-parity gap, not a bug in what exists.

### 2.3 Validation

- `react-hook-form` + `zod` + `@hookform/resolvers/zod` are installed and correctly used — but only on `LoginPage`/`ResetPasswordPage`. Every sampled entity CRUD form (`CustomerFormPage`, `SupplierFormPage`, `AccountFormPage`, `ItemFormPage`) uses bare `register()` with ad-hoc inline rules, and most fields carry no rule at all beyond `required` on a handful of fields.
- No shared validation module exists under `apps/web-frontend/src` (confirmed via glob — none named `validation`/`validators`/`schema`).
- The regex constants that *are* used (`GSTIN_REGEX`, `PAN_REGEX`, `PINCODE_REGEX`, `IFSC_REGEX`, `BANK_ACCOUNT_REGEX`, `HSN_REGEX`) come from `packages/shared-types/src/validators.ts` (published as `@erp/types`) — **the same package the backend already imports for its own zod schemas** (e.g. `apps/sales-service/src/api/supplier.routes.ts` uses `OptionalGSTINSchema`/`OptionalPANSchema`/`OptionalIFSCSchema`/`OptionalBankAccountSchema` directly from it). The frontend only imports the raw regex constants from this package, not the zod schemas — meaning the parity mechanism already exists and is half-wired.
- Confirmed field-level mismatches: backend `customer.routes.ts` requires `phone` (min 10 chars, max 20) and validates `email` format server-side; `CustomerFormPage.tsx` has no client rule for either. Backend requires 6-digit `pincode` via regex; same gap. `AccountFormPage.tsx` has no format validation at all beyond four `required` fields — not even for its own bank IFSC/account-number fields when the "is bank account" checkbox is active.
- `ERPGSTINInput.tsx` is the one exception — it does real-time, as-you-type validation with a live checkmark/✕ icon, using `GSTIN_REGEX` from `@erp/types`. It's a working template for what every validated field should look like.

### 2.4 Accessibility

Concentrated correctly in shared primitives, not scattered per-page: `aria-*` (59 occurrences/23 files), `aria-invalid`/`aria-describedby` specifically (17/8 files), mostly inside `ERPInput`, `ERPSelect`, `ERPGSTINInput`, `ERPTextarea`, `Input`, `Select`. `Modal.tsx` and `ERPDrawer.tsx` both have `role="dialog"`, `aria-modal`, Escape-to-close, and initial-focus-on-open — but **neither traps focus (Tab can escape the dialog) nor restores focus to the trigger element on close**. This is the most concrete, scoped accessibility gap found (two files, not a sitewide rewrite).

### 2.5 Responsive design

Not uniformly missing — 310 responsive-prefixed classes (`sm:`/`md:`/`lg:`/`xl:`) across 89 page files. Dashboard/analytics pages collapse correctly (`DashboardPage.tsx` grids go `grid-cols-4` → `md:grid-cols-2` → base `grid-cols-1`-style stacking). The gap is specifically **form pages**: `OrganizationPage.tsx` and `EmployeeFormPage.tsx` use fixed `grid-cols-2`/`grid-cols-3` with zero responsive prefixes, so they do not collapse to a single column on mobile/tablet — the same root cause as the form-layout inconsistency in 2.1.

### 2.6 RBAC and routing (constraints, not findings to fix)

Two independent permission-gating mechanisms exist: `PermissionGate`/`usePermission` (component-level, exported and exercised only by their own definition files — **currently unused anywhere in the app**) and `PermissionRoute` (`App.tsx:175-178`, route-level, wraps all ~140 protected routes, e.g. `App.tsx:226`). All actual access control today runs through `PermissionRoute` plus permission checks embedded in individual page/button render logic. **Any redesign must leave `PermissionRoute` and its ~140 call sites untouched** — do not consolidate onto `PermissionGate` as part of this UI work; that would be a functional RBAC change, explicitly out of scope per the user's constraints.

---

## 3. UX Issues

1. A customer/supplier/account can be submitted with an invalid phone, email, or pincode with zero client-side warning, then bounce off the backend after a full round-trip — the exact "frontend accepts, backend rejects" failure mode the requirements call out.
2. Users cannot sort or page through any transactional list — as real data volume grows this becomes a genuine usability wall, not just a polish issue.
3. Forms visually contradict each other module-to-module: three different section/grouping visual styles, three different container widths, inconsistent required-field marking (prop-driven asterisk in most places, hand-typed `"Supplier *"` label text in `PurchaseOrderFormPage`).
4. Row actions differ in placement and pattern per page — no "familiar once you've learned one screen" guarantee, which directly contradicts the existing design system's own stated goal (Part 1.1, "Zero Learning Curve").
5. Keyboard users can Tab out of an open modal/drawer, and focus doesn't return to the triggering element on close — a real (if narrowly scoped) accessibility defect.
6. Two settings/HR form pages become unusable on narrow viewports (fixed multi-column grids that don't collapse).

---

## 4. Component Audit

| Component | State | Action |
|---|---|---|
| `components/ui/DataTable.tsx` | Deprecated, but the only table in production use on transactional pages | Retire — migrate every consumer to `ERPDataGrid` (Section 6) |
| `components/erp/ERPDataGrid.tsx` | Built, supports sort/pagination/skeleton/empty-state/sticky header | Wire up `pagination`/`onPageChange`/`sortable` props on every migrated page — currently built but literally never invoked with those props anywhere in `pages/` |
| `components/erp/ERPPagination.tsx` | Built, correct, but only ever reachable through `ERPDataGrid` and never actually triggered (zero `onPageChange={` call sites found) | No changes needed — just needs a caller |
| `components/erp/ERPFormSection.tsx` | Built, supports column-count prop and header/description slot | Adopt as the single grouping primitive; retire ad-hoc `<fieldset>`/plain-`<div>`/plain-`<section>` patterns |
| `components/ui/Button.tsx` | Complete, 7 variants, already ~98% consistently adopted | No changes needed |
| `components/erp/ERPDropdownMenu.tsx` | Built, zero usages in any page | Adopt for table row "more actions" per Section 6 |
| `components/ui/Modal.tsx`, `components/erp/ERPDrawer.tsx` | Missing focus trap + focus restoration only | Small, scoped fix — do not rebuild |
| `components/erp/ERPGSTINInput.tsx` | Fully correct reference implementation for live field validation | Use as the template for other validated inputs — do not modify |
| `PermissionGate.tsx` / `usePermission.ts` | Built, unused | Leave as-is; do not repurpose or remove — out of scope |

No component in the existing catalog needs to be rebuilt from scratch. The Part 35 catalog in the design system doc lists some components that do not yet exist in this codebase (`ERPDatePicker`, `ERPCurrencyInput`, `ERPPhoneInput`, `ERPCheckboxGroup`, `ERPRadioGroup`, `ERPStatCard`, `ERPStatusBadge`, `ERPToolbar`, `ERPFilterChips`, `ERPCommandPalette`, etc.) — these are legitimate future-phase items but are **not required** to fix the concrete issues in Section 2; do not build them speculatively as part of this pass (see Section 14 for what's actually in scope now vs. later).

---

## 5. Form Audit

Standardize every form page on:
- **Container:** a single shared width convention. Recommend `max-w-full` for the content area with `ERPFormSection`'s internal grid doing the column work (matches `PurchaseOrderFormPage`'s already-responsive pattern) rather than an arbitrary `max-w-2xl`/`max-w-3xl` cap — this directly fixes the reported `/inventory/items/new` symptom without inventing a new layout primitive.
- **Grouping:** `ERPFormSection` everywhere, with its `columns` prop (1–4) driving field layout instead of hand-written `grid-cols-N` divs. Retire every native `<fieldset>` and plain `<section>`/`<div>` grouping block found in Section 2.1.
- **Required indicator:** always via the `required` prop on `Input`/`Select`/`ERPInput`/`ERPSelect` (which already renders the `*` — `Input.tsx:19`), never hand-typed into label text (`PurchaseOrderFormPage`'s `"Supplier *"` pattern must go).
- **Responsive collapse:** every field grid must include a `grid-cols-1` mobile base with `md:`/`lg:` breakpoints widening it — matching what `PurchaseOrderFormPage` and the Dashboard already do correctly.

---

## 6. Table Audit

Every transactional list page migrates from `DataTable` to `ERPDataGrid`, in the priority order given in Section 14. For each migrated page:
- Pass `pagination={{page, pageSize, total}}` + `onPageChange` + `onPageSizeChange` — wiring the page's existing `useQuery` params (`page`/`size`) that are already sent to the API (confirmed present, e.g. `CustomersPage` already fetches `page:0,size:50` — the API call already supports paging, only the UI control is missing).
- Mark appropriate columns `sortable: true` and wire the resulting `sortKey`/`sortDir` into the query params if the backend list endpoint supports server-side sort, otherwise rely on `ERPDataGrid`'s existing client-side sort.
- Replace the hand-rolled `flex gap-2` action-button row with `ERPDropdownMenu`, preserving the exact same permission-gated conditionals that currently decide which actions render.
- Let `ERPDataGrid`'s built-in `ERPTableSkeleton`/`ERPEmptyState` defaults replace the `"Loading…"` text and plain empty rows — no custom loading/empty markup needed per page.
- Add a search box (via the existing `useDebounce` hook, 250ms, same pattern as `CustomersPage`) to the three pages currently missing one (`PurchaseOrdersPage`, `GRNsPage`, `StockTransfersPage`) for feature parity — this is a scope addition the user's own audit request implies ("Search Standard... all search fields should follow one standard") but keep it to reusing the existing hook, not building a new search system.

---

## 7. Validation Audit

Confirmed gap: backend validation rules for Customer/Supplier/Item already live in code the frontend can reach (`packages/shared-types/src/validators.ts`, some already re-exported as zod schemas like `OptionalGSTINSchema`), but frontend forms only cherry-pick the raw regex constants and skip the zod schemas entirely, and several fields (phone, email, pincode on Customer; all bank fields on Account) have no frontend rule at all.

## 8. Accessibility Audit

Scoped to two fixes: add a focus trap and focus-restore-on-close to `Modal.tsx` and `ERPDrawer.tsx` (both already have the dialog role, aria-modal, and Escape handling — this is additive, not a rebuild). Everything else audited (labels, aria-invalid/describedby on inputs) is already in reasonable shape and concentrated correctly in shared components.

## 9. Responsive Audit

Fix in place: `OrganizationPage.tsx` and `EmployeeFormPage.tsx`'s fixed multi-column grids, plus every form page picking up the new `ERPFormSection`-driven responsive grid from Section 5 — no separate responsive-specific work needed once Section 5/6 land, since the fix is the same grid-column convention change.

---

## 10. Reusable Component Plan

No new components are required to fix the concrete findings in Section 2. In scope now: finish wiring existing components (`ERPDataGrid` pagination/sort props, `ERPFormSection` adoption, `ERPDropdownMenu` for row actions, focus-trap addition to `Modal`/`ERPDrawer`). Out of scope for this pass (legitimate later-phase catalog items per the existing design system's Part 35, only build when a concrete page needs one): `ERPDatePicker`, `ERPCurrencyInput`, `ERPPhoneInput`, `ERPStatCard`, `ERPStatusBadge`, `ERPToolbar`/`ERPFilterChips`, `ERPCommandPalette`.

## 11. Design System Proposal

Adopt `ERP-PLANNING/ERP_FRONTEND_DESIGN_SYSTEM.md` as-is; it already answers every question in the user's brief (labels, spacing, states, input behavior, typography, etc.) in exhaustive detail. The only proposal this document adds is: **replace its Part 37 deviation register with the audit in Section 2 above**, since Part 37 is five days stale and no longer matches the codebase (some "critical" items it lists, like the icon system and core component build-out, are already done; some it doesn't mention at all, like the validation-parity gap, are still open).

## 12. Validation Architecture

Centralize on one pattern, reusing what already exists rather than adding a new library:
1. For each entity form, define a `zod` schema in a new `apps/web-frontend/src/schemas/<entity>.schema.ts`, importing shared primitives (`GSTINSchema`, `PANSchema`, `OptionalIFSCSchema`, etc.) from `@erp/types` instead of re-deriving regex rules by hand.
2. Wire each form's `useForm` call to `resolver: zodResolver(schema)` — the exact pattern already proven working in `LoginPage.tsx`/`ResetPasswordPage.tsx`.
3. Where a backend route's zod schema (e.g. `customer.routes.ts`'s inline schema) isn't already expressed via a reusable `@erp/types` export, add it there once, so both frontend and backend import the identical rule — closing the parity gap at the source instead of duplicating rules in two places.
4. `ERPGSTINInput`'s live-validation-as-you-type pattern is the reference for how a field should surface errors; reuse its interaction pattern (not its code) for other high-friction fields as they're migrated.

## 13. Priority Matrix

| Priority | Item |
|---|---|
| Critical | Frontend/backend validation parity for Customer/Supplier/Item forms (data-integrity risk) |
| Critical | Migrate the 8 transactional list pages off deprecated `DataTable` onto `ERPDataGrid`, with pagination wired (perf risk grows with real data volume) |
| High | Standardize form container width + `ERPFormSection` adoption across all form pages (fixes the reported `/inventory/items/new` symptom and five other pages found with the same class of issue) |
| High | Row actions → `ERPDropdownMenu` on migrated list pages |
| Medium | Add search box to the 3 list pages missing one |
| Medium | Focus trap + focus restore on `Modal`/`ERPDrawer` |
| Low | Fix fixed-grid responsive collapse on `OrganizationPage`/`EmployeeFormPage` (subsumed by the Section 5 form-layout fix) |

## 14. Implementation Phases

Continuing the existing roadmap's numbering (`ERP_FRONTEND_DESIGN_SYSTEM.md` Part 38 Milestones R.1–R.4 are effectively done; this resumes at R.5):

- **Phase A (≈ R.5, revised):** Migrate `ItemsPage`/`ItemFormPage`, `CustomersPage`/`CustomerFormPage`, `InvoicesPage` — highest-traffic pages first, proving the `ERPDataGrid` + `ERPFormSection` + validation-schema pattern end-to-end on 3 modules before rolling out further.
- **Phase B:** Roll the proven pattern to remaining list/form pages: Suppliers, Quotations, Purchase Orders, GRNs, Stock Transfers, Accounts.
- **Phase C:** Modal/Drawer focus-trap fix (independent, can run in parallel with A/B).
- **Phase D:** Remaining form pages (HR, Production, GST, Reports-adjacent forms) for full-catalog consistency.

## 15. Estimated Impact

- Eliminates the concrete data-integrity failure mode (frontend-accepted/backend-rejected submissions) for the highest-traffic entities.
- Removes the empty-space/poor-layout complaint across every form page, not just the one reported.
- Makes every transactional list usable at real data volume (pagination/sort), which the current implementation cannot do today past a small row count.
- Zero risk to business logic, APIs, or RBAC — every change is presentation-layer only (see Section 16).

## 16. Risk Assessment

- **RBAC:** Untouched. `PermissionRoute` and per-button permission checks are read, not modified, when migrating a page's table/form — the same permission booleans just get passed to `ERPDropdownMenu` items instead of individual buttons.
- **API contracts:** Untouched. Pagination/sort wiring reads query params the pages already send; validation schemas mirror existing backend rules, they don't add new ones.
- **Routing:** Untouched — no route paths, lazy-loading, or `App.tsx` route tree structure changes in this plan.
- **Regression surface:** Confined to presentation components (table rendering, form layout, validation error display) — the actual submit handlers, API calls, and mutation logic are not touched.

## 17. Regression Prevention Checklist

- [ ] Every migrated list page: confirm the same rows, same data, same row-action permission gating render identically before/after migration.
- [ ] Every migrated form: confirm the exact same fields submit the exact same payload shape to the exact same endpoint.
- [ ] Confirm `PermissionRoute` route wrapping in `App.tsx` is unchanged for every route touched.
- [ ] Confirm no page's `useQuery`/`useMutation` call signature changes (only the rendering component around it changes).
- [ ] Run `pnpm --filter @erp/web-frontend type-check` and `pnpm --filter @erp/web-frontend test` after each page migration.

## 18. Testing Checklist

- [ ] For each migrated form: submit valid data → success toast, correct API payload (verify via network tab or existing test mocks).
- [ ] For each migrated form: submit each newly-validated field with an invalid value → inline error appears, matching the backend's actual rule (not just "required").
- [ ] For each migrated list page: pagination controls change the visible rows and the query params sent.
- [ ] For each migrated list page: sorting a sortable column re-orders rows correctly.
- [ ] Keyboard test: Tab through a form page end-to-end without landing on a hidden/disabled element; open a Modal/Drawer, confirm Tab stays inside it and focus returns to the trigger button on close.
- [ ] Resize to a mobile viewport (375px) on every migrated form page — confirm single-column collapse, no horizontal overflow.

## 19. Coding Standards to Follow

Existing project docs already govern this work and must be followed as-is: [`ERP-PLANNING/CODING_STANDARDS.md`](ERP-PLANNING/CODING_STANDARDS.md), [`ERP-PLANNING/ERP_FRONTEND_DESIGN_SYSTEM.md`](ERP-PLANNING/ERP_FRONTEND_DESIGN_SYSTEM.md) (all 39 parts), and this repository's root `CLAUDE.md` (surgical changes only, no speculative abstractions, no unrelated refactors).

## 20. Definition of Done

A page is "done" for this initiative when:
- Its table (if any) uses `ERPDataGrid` with pagination and sorting wired, `ERPDropdownMenu` for row actions, and no custom loading/empty markup.
- Its form (if any) uses `ERPFormSection` for all grouping, a full-width responsive container, and a `zod` schema (via `zodResolver`) whose rules are verified to match the corresponding backend route's validation field-for-field.
- It passes the Regression Prevention Checklist (Section 17) and Testing Checklist (Section 18).
- No business logic, API contract, RBAC gate, or route changed as a side effect.

The initiative is fully done when every page in Section 14's phases meets the above and `ERP-PLANNING/ERP_FRONTEND_DESIGN_SYSTEM.md` Part 37's deviation register can be regenerated showing 0 Critical and 0 High items remaining.
