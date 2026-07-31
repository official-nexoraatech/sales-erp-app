# apps/web-frontend — Enterprise-Grade Audit (2026-07-24)

Scope: apps/web-frontend only (the main ERP frontend — POS is a separate app, `apps/pos-frontend`,
already audited 2026-07-24 in a prior session). Read-only research phase — **no code changed yet**.
Six parallel review passes covered: architecture/infra, design system, navigation/auth/tenancy,
forms/data-tables, module-by-module page coverage, and performance/a11y/security/error-handling.

Baseline: this app is materially more mature than a typical audit target. Routing, code-splitting,
error boundaries, RBAC, auth/session-refresh, breadcrumbs, command palette, and the design-token
system are all well-built with no major issues found. Findings below are the real gaps, not a
rewrite recommendation.

## Critical

1. **Query cache / stores never cleared on logout or re-login** — `auth.store.ts` logout(),
   `Layout.tsx` handleLogout(), and `ImpersonationBanner.tsx` stopLogout() never call
   `queryClient.clear()`. The single app-scoped `QueryClient` (`main.tsx:21`) keys queries by name
   only, not by tenant/user id. On a shared/kiosk browser, a second user or tenant logging in
   without a hard refresh can see stale cached data (customers, invoices, dashboard KPIs) from the
   previous session render on screen until background refetch completes. Only the forced-logout
   path (`client.ts:151`, full `location.href` reload) is accidentally safe.
   — _Business impact:_ cross-tenant/cross-user data exposure on screen in shared-terminal retail
   deployments. _Fix:_ call `queryClient.clear()` in every logout/impersonation-exit path.

## High

2. **Report export/view bypasses the gateway entirely.** `ReportViewerPage.tsx:162` does a raw
   `fetch()` to `import.meta.env.VITE_REPORT_URL ?? 'http://localhost:3015'`. `VITE_REPORT_URL` is
   not declared in `.env.example` — it's always undefined, so the hardcoded localhost fallback is
   what actually runs. This duplicates logic `apiClient.getBlob` already provides and loses
   401-refresh/tenant-suspended handling. Will fail outright outside local dev (same bug class as
   the earlier gateway-cutover fixes).
3. **The highest-risk transactional forms have the weakest validation.** Invoice, PO, GRN,
   Journal, Quotation, Sale/Purchase Return, Requisition, RFQ, Stock Adjustment/Transfer forms (13
   files) use raw `useState` with no schema validation, no per-field inline errors, and no `<form>`
   element at all (Enter does nothing) — while 27 master-data forms correctly use
   react-hook-form + zod with proper `aria-invalid`/`aria-describedby` wiring. Errors on invoices/
   journals currently surface only as a single generic toast on submit.
4. **Virtualization is built but unused; large reports render unbounded.** `ERPDataGrid` fully
   supports `react-window` virtualization, but zero pages opt in. Four pages — Trial Balance, TDS,
   Inventory Analytics, Stock Valuation — render every row with no pagination and no
   virtualization; a large tenant's GL/SKU list will freeze the browser tab.
5. **No tenant logo branding.** `TenantThemeSync` covers color/radius tokens only; logo
   upload/display was never built. Header/sidebar/login always show a hardcoded "N" lettermark,
   contrary to what "tenant branding shipped" implied — this is a real, previously undocumented gap.
6. **Access token stored in `localStorage`.** `auth.store.ts` zustand `persist` includes
   `accessToken` (and `realSession.accessToken` for impersonation) in `partialize`. The refresh
   token was correctly moved to an httpOnly cookie, but the access token remains readable by any
   injected script — the more consequential of the two tokens to protect.
7. **No app-wide offline detection.** Only the command palette checks `navigator.onLine`, scoped
   to its own empty state. Unlike POS (which has real offline-first support), a logged-in
   web-frontend user gets zero indication of lost connectivity until an individual request fails.

## Medium

8. `Layout.tsx` (sidebar/header/TenantThemeSync) sits outside any error boundary — only the
   `<Outlet/>` content is wrapped; a crash in nav/theme-sync white-screens the whole app.
9. `apiClient.request()` returns `data.data` only, discarding any sibling `meta`/pagination
   fields — mitigated today because every endpoint nests pagination inside `data`, but a latent
   footgun for any new endpoint using the more idiomatic `{data, meta}` shape.
10. No `manualChunks`/bundle-size visibility in `vite.config.ts` — vendor bundle size unmeasured.
11. No generic `Card`/`Accordion`/`Tooltip`/`Chip`/`Progress` primitives — 35 pages hand-roll card
    containers, 7 hand-roll expand/collapse accordions, duplicating styling by hand each time.
12. GST module (7/8 pages) and the CRM/Production modules (0% adoption) were never migrated to
    `ERPPageHeader`/`ERPDataGrid` — still on pre-redesign raw-table UI, inconsistent with Sales/
    Purchase/Inventory/Accounting.
13. 5 admin pages (GstCompliance, DLQ, EventStore, SagaMonitor, SchemaRegistry) hand-roll modal
    overlays with raw `z-50` instead of the shared `Modal` component's token-based z-index — can
    render behind a dropdown or the command palette.
14. `CashFlowPage.tsx` closing-balance block uses raw `bg-gray-900`/`text-white`/hardcoded
    green/red instead of semantic tokens — breaks in light mode and high-contrast mode.
15. Sidebar nav permissions narrower than the route guards they point to in 4 places (Transfers,
    Adjustments, Payments, Audit Logs) — a user with only the secondary permission
    (`STOCK_TRANSFER`, `STOCK_ADJUST`, `PAYMENT_IN_VIEW`, `AUDIT_LOG_VIEW`) can reach the page by
    URL/command-palette but has no sidebar link. Reproduces a known bug class from prior QA.
16. No favorites/pinned-pages concept (Fiori "My Home" equivalent) — only auto-derived MRU
    "recent pages" exists.
17. Feature flags are admin-CRUD only with zero runtime effect on the UI; no subscription-plan
    gating anywhere — every tenant sees the full nav regardless of plan.
18. No Roles/Permissions management UI anywhere under `admin/` — only a raw Users list/form.
19. Notifications is a header-dropdown (last 10, no polling/websocket) with no dedicated
    full-page notification center.
20. `ERPDataGrid` bulk-selection/bulk-actions are fully built but wired up by zero pages.
21. CSV export is a one-prop opt-in on `ERPDataGrid` but present on only 7 of 41 grid pages;
    Invoices, Items, Journals, Stock Levels, Employees have none.
22. Bulk import exists only for Suppliers; no equivalent for Customers, Items, or GL Accounts.
23. No auto-save/draft-save anywhere except a single manual "Save as Draft" button on Invoice.
24. `InvoiceFormPage.tsx` recomputes GST line totals with zero `useMemo`/`useCallback` on every
    keystroke across the whole 631-line file.
25. axe-core is wired into CI and not bit-rotted, but only ~17 of ~195 page test files actually
    call `runAxe()` — most of accounting/purchase/HR/production/GST forms have no a11y test
    coverage at all.
26. Contrast ratios are never CI-checked — axe's own `color-contrast` rule is explicitly disabled
    in tests (jsdom limitation), leaving contrast to manual spot-checks only.
27. No Content-Security-Policy configured anywhere (`index.html` or serving layer) — would
    meaningfully offset the localStorage-token risk in finding 6.
28. No dedicated 500/generic-failure page — ~200 `toast.error()` call sites are the only handling
    for API failures; `ERPErrorBoundary` only offers "Reload page".
29. Retry UX exists only on a handful of admin/niche pages (DLQ, Saga Monitor, Search Analytics,
    E-Invoice) — ordinary CRUD list/detail pages have no "Retry" affordance on a failed query.

## Low (cleanup / polish, not blocking)

- `.env.example` still declares dead `VITE_HR_URL`/`VITE_INVENTORY_API_URL` (zero references).
- `api/endpoints.ts` is a single 2277-line file covering all 15 services.
- No optimistic updates anywhere (`onMutate` in only 3 files) — correctness-safe, just slower UX.
- Recharts consumers on 3 analytics pages inline `<ResponsiveContainer>` instead of the shared
  `ChartCard` wrapper — inconsistent chart chrome.
- Dashboard/ReportViewer use a raw spinner in one sub-state instead of `ERPSkeleton` (both also
  use skeletons elsewhere in the same file).
- Minor heading-scale inconsistency: `ERPPageHeader` uses `text-xl font-semibold`, but Dashboard/
  Reports/Schedules pages use `text-2xl font-bold` for the same page tier.

## What's already solid (verified, not re-flagged)

Routing/code-splitting (all ~195 pages lazy-loaded), protected routes + dedicated Access-Denied/
Suspended/No-Modules pages, RBAC via a single `usePermission` hook (zero ad-hoc role-string checks
found), breadcrumbs, command palette (recent/saved search, autocomplete, keyboard shortcut),
session-refresh-on-401, sticky header/column in ERPDataGrid, single icon library (lucide-react)
app-wide, near-zero hardcoded hex colors, tenant color/radius theme sync with cross-tab
`BroadcastChannel`, file-upload client-side validation, no XSS-risky `dangerouslySetInnerHTML`
usage, no stub/"coming soon" pages anywhere.

## Suggested priority order for implementation

1. Critical #1 (query-cache clear on logout) — small, high-impact, isolated fix.
2. High #2 (report gateway bypass), #6 (token storage) — both small, isolated, real bugs/risk.
3. High #4 (virtualize/paginate the 4 unbounded report pages) — isolated per page.
4. High #3 (transactional-form validation rebuild) — largest single item, 13 files, should be its
   own dedicated effort (one form at a time, per CLAUDE.md implementation rules).
5. Medium items, grouped by theme (error-boundary/offline/CSP; GST/CRM/Production design-system
   migration; ERPDataGrid feature adoption — bulk actions/export/import).
6. Low items opportunistically alongside whatever else touches those files.

## Implementation status (2026-07-24, same-day follow-up)

All 1 Critical + 6 High items were implemented, one at a time, each verified via `tsc --noEmit`,
a production `vite build`, and the full vitest suite (418/418 passing) after every file.

- **Critical #1 — fixed.** `queryClient.clear()` now runs on every logout/impersonation-exit path
  (`Layout.tsx`, `NoModulesAssignedPage.tsx`, `App.tsx`'s `AccessDenied`, `ImpersonationBanner.tsx`,
  and the automatic 401-triggered impersonation revert in `api/client.ts`). Query client extracted
  to `src/lib/queryClient.ts` so non-component code can import the same instance.
- **High #2 — fixed.** `ReportViewerPage.tsx`'s CSV/Excel export now goes through a new
  `apiClient.postBlob` + `reportsEngineApi.runBlob`, routed through the gateway with auth headers,
  instead of a raw `fetch` to a hardcoded `localhost:3015` fallback.
- **High #4 — fixed.** `TrialBalancePage`, `TDSPage`, `StockValuationPage`, `InventoryAnalyticsPage`
  now pass `virtualized`/`virtualizedHeight` to `ERPDataGrid`. Since virtualized mode doesn't
  support a table `footer`, the totals those pages showed there now render in a summary strip
  above the grid instead (TrialBalance's totals were already duplicated in its banner).
- **High #5 — fixed.** Tenant logo branding built end-to-end: `organizationApi.uploadLogo`/
  `logoBlob` (the backend endpoint already existed, unused by the frontend — `uploadLogoUrl` was
  dead code calling a JSON shape the backend no longer accepts), a new `TenantLogo` component
  wired into both sidebar states in `Layout.tsx` (replacing the hardcoded "N"), and an upload UI
  in `OrganizationPage.tsx`'s Branding section. Shared `useOrganization`/`useObjectUrl` hooks
  extracted so `TenantThemeSync` and the new logo code read the same cache entry. Login-page
  branding remains out of scope — the logo endpoint requires auth, so it can't render pre-login
  without a new public backend endpoint.
- **High #7 — fixed.** New `useOnlineStatus` hook + `OfflineBanner` component mounted in
  `Layout.tsx`, above `ImpersonationBanner`.
- **High #6 — fixed.** Access token removed from `localStorage` persistence (`auth.store.ts`'s
  `partialize`); it now lives in memory only. A new `AuthBootstrap` gate in `App.tsx` silently
  exchanges the httpOnly refresh cookie for a fresh access token via `performRefresh()` (now
  exported from `client.ts`) on every page load, so a reload no longer forces re-login. A reload
  mid-impersonation can't resume (the impersonated token was never persisted either) — it now
  cleanly falls back to the admin's real session instead of leaving mismatched state.
- **High #3 — fixed, all 13 forms.** Rather than a full react-hook-form/`useFieldArray` rewrite of
  every dynamic line-item table (high regression risk on revenue-critical documents with complex
  GST/computed-line logic, for a session with no live backend to test against), each form got: a
  real zod schema (new `src/schemas/sales-transactions.schema.ts`,
  `purchase-transactions.schema.ts`, `accounting-transactions.schema.ts`,
  `inventory-transactions.schema.ts`), validated via `.safeParse()` on submit through a shared
  `toFieldErrors()` helper (`src/lib/zodFieldErrors.ts`) that maps zod issues to inline
  `error={...}` props on the existing shared Input/Select/Combobox components (all already wired
  for `aria-invalid`/`aria-describedby`) and to per-line-cell red-border highlights; a real
  `<form onSubmit>` wrapper so Enter submits.
  Forms done: `sales/{InvoiceFormPage,QuotationFormPage,DeliveryChallanFormPage,
SaleReturnFormPage}`, `purchase/{PurchaseInvoiceFormPage,PurchaseOrderFormPage,
PurchaseReturnFormPage,RequisitionFormPage,RfqFormPage,GRNCreatePage}`,
  `accounting/JournalFormPage`, `inventory/{StockAdjustmentFormPage,StockTransferFormPage}`.
  Two cross-cutting bugs surfaced and fixed by wrapping these pages in `<form>`:
  - Every non-submit `<button>` inside each form (add-item, remove-line, Load Invoice/GRN/PO,
    Cancel) needed an explicit `type="button"` — without it, HTML defaults an unlabeled button
    inside a form to `type="submit"`, so clicking "remove line" would have submitted the whole
    document.
  - `packages/ui/src/Combobox.tsx` (used by every async item/customer/supplier/GRN picker) didn't
    call `preventDefault()` on Enter in two states (dropdown not yet open; dropdown open but
    nothing highlighted yet) — inside a `<form>`, pressing Enter while typing a search query would
    submit the parent document instead of just interacting with the picker. Fixed at the shared
    component, so every other current/future consumer benefits, not just these 13 pages. Plain-
    `<input>` item-search boxes (not using Combobox) got an equivalent per-field `onKeyDown` guard.
    Also fixed in passing, since the exact same lines were being restructured: `InvoiceFormPage.tsx`
    and `QuotationFormPage.tsx`/`PurchaseOrderFormPage.tsx`'s unmemoized per-keystroke GST
    recomputation (Medium #24) is now wrapped in `useMemo`.
    Validation requirements were kept exactly matched to each form's pre-existing behavior (e.g.
    Requisition/RFQ's optional due-date and RFQ's no-minimum-suppliers-invited were _not_ newly
    required) — no new business-rule restrictions were introduced beyond what each form already
    enforced via ad hoc `if` checks.

**Not done this session (deferred to a later pass, per user's explicit scope choice):** all
Medium/Low findings (GST/CRM/Production design-system migration, ERPDataGrid bulk-select/export/
import adoption, auto-save, axe coverage expansion, CSP, dedicated 500 page, generic retry UX,
nav-permission/route-guard mismatches, favorites, feature-flag runtime gating, Roles/Permissions
admin UI, notification center, `Card`/`Accordion` primitives, and the remaining Low items).

**Verification caveat:** all fixes were verified via `tsc --noEmit`, a production `vite build`,
and the full vitest suite (418/418 passing, including the pre-existing axe-accessibility tests).
No live browser / real backend stack verification was performed this session — recommend a
smoke test against a running dev stack before considering this production-signed-off, particularly
for the auth-bootstrap silent-refresh flow (Critical/High #6) and the tenant-logo upload flow
(High #5), which depend on live backend behavior (httpOnly cookie refresh; MinIO/S3 signed URLs)
that unit tests and a production build can't exercise.
