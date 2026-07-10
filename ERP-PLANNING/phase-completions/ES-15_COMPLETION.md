# ES-15 Completion Report — Frontend UX & Fixed Assets
**Date:** 2026-07-03
**Status:** COMPLETE

## Scope Note — divergence from the spec doc

Before starting, research found the Fixed Asset register was **~70% already built under an earlier "Phase 6"** (`FixedAssetService.ts`, routes, schema, migration `0002_phase6_accounting.sql`, and a list page) — not built for ES-15. Its design intentionally diverges from `ES-15-FRONTEND-UX-DEPRECIATION.md`:

| Spec doc says | Actually built (kept as-is) |
|---|---|
| `accumulated_depreciation BIGINT` in paise | `decimal(15,2)` in rupees — matches every other money column in this codebase |
| New `DepreciationService.ts` writing a `DEPRECIATION_POSTED` outbox event | Depreciation posts directly via `JournalEngine.post()` inside a `db.transaction()` — matches how the rest of `accounting-service` posts (outbox is barely used outside `FinancialYearService.ts`) |
| `status: 'ACTIVE' \| 'DISPOSED' \| 'FULLY_DEPRECIATED'` | `status: 'ACTIVE' \| 'DISPOSED'` only — an asset at salvage value simply stops accruing depreciation (`computeMonthlyDepreciation` returns 0) rather than flipping status |
| `POST /api/v1/accounting/depreciation/run` | `POST /api/v2/fixed-assets/depreciation/run` — this codebase's actual API versioning/naming convention |

User confirmed (2026-07-03): keep the existing design, fill the real gaps rather than rebuild to match the spec doc literally. **Future phases referencing ES-15 should treat this report, not the original spec doc, as authoritative for the Fixed Asset module's actual shape.**

---

## UX Audit Results

- **Pages in scope:** 101 (all of `apps/web-frontend/src/pages/**`)
- **Pages fixed:** 72 (loading skeleton, empty state, and/or dark-mode fixes applied)
- **Pages already compliant, left untouched:** 29
- Breakdown by module (files touched / files in module):
  - accounting: 11/12 (`FixedAssetsPage.tsx` excluded — owned by the Fixed Asset workstream, see below)
  - gst: 8/8
  - hr: 12/14
  - inventory: 6/11
  - sales: 5/8
  - purchase: 0/7 (already compliant)
  - items: 2/6
  - production: 6/6
  - admin/distributed: 6/6
  - crm: 4/4
  - customers: 3/3
  - settings/reports/suppliers/users/root/auth: 9/15
- **Loading skeletons added:** the large majority of the 72 files — most pages had zero loading state before this pass (blank screen or plain "Loading…" text) and now use `ERPTableSkeleton` / `ERPFormSkeleton` / `ERPDetailSkeleton` / `ERPCardSkeleton` matching each page's layout.
- **Empty states swapped to `ERPEmptyState`:** roughly 40 of the 72 files — ad-hoc "No X found" markup replaced with the shared component (icon + title + description + optional gated "Add" action).
- **Dark-mode fixes:** concentrated as predicted in accounting (11 files) and gst (8 files), plus scattered unpaired-class bugs in hr, inventory, crm, sales, settings, suppliers, users. Only classes with **no** `dark:` counterpart at all were touched (a real contrast bug); classes that already had a correct `dark:` pair but weren't using design tokens were left alone as a style inconsistency, not a bug — per the agreed recipe.
- **Raw `fetch()` calls converted to React Query:** all 3 known sites — `ChartOfAccountsPage.tsx` (seed-accounts mutation), `GstConfigPage.tsx` (seed-rates mutation), `ReportViewerPage.tsx` (CSV/Excel download — already wrapped in `useMutation`, added the missing success/error toast).
- **Console errors:** none found (0 `console.log` occurrences pre-existing; no new ones introduced).
- **`ERPErrorBoundary`:** confirmed already centralized in `App.tsx`'s `<Page>` route wrapper — no per-page work needed or done.

### Bug found and fixed mid-verification
The mechanical sweep's `ERPEmptyState action={cond ? {...} : undefined}` pattern violates this repo's `exactOptionalPropertyTypes: true` TS setting (the `action` prop is optional but doesn't accept an explicit `undefined`). This showed up as 11 type errors across `SchemaRegistryPage.tsx`, `CampaignsPage.tsx`, `SeasonsPage.tsx`, `SegmentsPage.tsx`, `CustomerViewPage.tsx`, `AlterationsPage.tsx`, `HolidayCalendarPage.tsx`, `PayrollPage.tsx`, `ConsignmentSettlementsPage.tsx`, `ConsignmentStockPage.tsx`, `JobWorkOrdersPage.tsx` — all fixed by switching to a conditional prop spread (`{...(cond ? { action: {...} } : {})}`), which correctly omits the key instead of setting it to `undefined`.

---

## Fixed Assets

- **Depreciation methods:** SLM + WDV — already implemented (`FixedAssetService.computeMonthlyDepreciation`), unchanged.
- **Monthly depreciation runner:** already implemented (`FixedAssetService.postMonthlyDepreciation` / `runMonthlyDepreciationBatch`), unchanged.
- **Ledger posting:** direct `JournalEngine.post()` in-transaction (kept — see scope note above), not outbox.
- **Gaps filled this phase:**
  1. `ACCOUNTANT` role was missing `FIXED_ASSET_VIEW/CREATE/UPDATE/DISPOSE` permissions — granted in `role-defaults.ts`.
  2. No "Accumulated Depreciation" contra-asset default account existed — added `1590 Accumulated Depreciation` (`accountType: 'CONTRA'`) to `default-accounts.ts`, required for the new asset form's account picker to have a real option (new tenants only; dev phase, no prod backfill needed).
  3. `FixedAssetsPage.tsx` had a field-name bug — its interface/JSX read `asset.assetName`/`asset.assetCategory` but the API returns Drizzle columns `name`/`category`, so those two table columns rendered blank. Fixed, plus removed dead `location` field and unreachable `IMPAIRED` status color (schema only has `ACTIVE`/`DISPOSED`).
  4. Built the missing frontend: `FixedAssetFormPage.tsx` (create/edit, with account pickers filtered from `accountApi.list()`), `FixedAssetDetailPage.tsx` (summary + depreciation schedule table + dispose flow via `ERPConfirmModal`), and a "Run Depreciation" month/year-picker flow on the list page. Routes `/accounting/fixed-assets/new`, `/accounting/fixed-assets/:id`, `/accounting/fixed-assets/:id/edit` registered in `App.tsx`.
  5. 6 new unit tests in `apps/accounting-service/src/__tests__/depreciation.test.ts` covering SLM calc, WDV calc, book-value decrement, schedule-row accuracy, the fully-depreciated/no-op case, and tenant isolation in the batch runner.

---

## Files Changed

Representative files (72 pages touched in the UX sweep, pattern described above rather than enumerated in full):

| File | Change |
|---|---|
| `apps/tenant-service/src/rbac/role-defaults.ts` | Granted 4 `FIXED_ASSET_*` permissions to `ACCOUNTANT` |
| `apps/accounting-service/src/domain/default-accounts.ts` | Added `1590 Accumulated Depreciation` default account |
| `apps/accounting-service/src/__tests__/depreciation.test.ts` | New — 6 tests |
| `apps/web-frontend/src/pages/accounting/FixedAssetsPage.tsx` | Field-mismatch bug fix + Run Depreciation flow |
| `apps/web-frontend/src/pages/accounting/FixedAssetFormPage.tsx` | New — create/edit form |
| `apps/web-frontend/src/pages/accounting/FixedAssetDetailPage.tsx` | New — detail + schedule + dispose |
| `apps/web-frontend/src/App.tsx` | 3 new fixed-asset routes |
| `apps/web-frontend/src/pages/accounting/*` (11 files), `pages/gst/*` (8) | Skeleton/empty-state/dark-mode/raw-fetch fixes |
| `apps/web-frontend/src/pages/hr/*` (12), `pages/inventory/*` (6) | Skeleton/empty-state/dark-mode fixes |
| `apps/web-frontend/src/pages/sales/*` (5), `pages/items/*` (2) | Skeleton/empty-state/dark-mode fixes |
| `apps/web-frontend/src/pages/production/*` (6), `pages/admin/distributed/*` (6), `pages/crm/*` (4), `pages/customers/*` (3) | Skeleton/empty-state/dark-mode fixes |
| `apps/web-frontend/src/pages/settings/*`, `reports/*`, `suppliers/*`, `users/*`, `DashboardPage.tsx` (9 files) | Skeleton/empty-state/dark-mode/toast fixes |

---

## Tests: 6/6 PASS (depreciation) | full suite 15/18 pass, 3 pre-existing skipped

## Build / Type-check: PASS
- `@erp/db` build: PASS
- `@erp/accounting-service` build + type-check: PASS
- `@erp/tenant-service` build + type-check: PASS
- `@erp/web-frontend` type-check (`tsc --noEmit`, this repo's actual `build` script): PASS

## Lint: PRE-EXISTING FAILURE, not introduced by ES-15
`pnpm lint` fails with ~223 errors across `web-frontend`, `accounting-service`, and `tenant-service` — but every category is confirmed pre-existing:
- `no-undef` for `process`, `fetch`, `document`, `URL`, `Blob`, `localStorage`, `React`, `crypto` — a monorepo-wide ESLint env-config gap (missing `node`/`browser` globals), reproducible in files nobody touched this session (e.g. `apps/tenant-service/src/main.ts`, `apps/web-frontend/src/pages/reports/ArAgingPage.tsx`).
- Scattered pre-existing unused imports (e.g. `formatDatetime` imported-but-unused in 5 `pages/sales/*.tsx` files including `DeliveryChallansPage.tsx`, which this phase never touched — proves the pattern predates ES-15).
Fixing this is a monorepo-wide lint-config/cleanup effort well outside this phase's scope; flagging for a dedicated follow-up rather than silently expanding ES-15 to cover it.

## Manual verification
No browser-automation tool was available in this environment, so the plan's "toggle dark mode on every page" and full click-through checks could not be performed visually. What was verified: `pnpm --filter @erp/web-frontend dev` boots cleanly, and `/accounting/fixed-assets` and `/accounting/fixed-assets/new` both serve HTTP 200 via the SPA. **The UI has not been visually exercised in a browser — recommend a manual pass before considering this phase fully verified end-to-end.**
