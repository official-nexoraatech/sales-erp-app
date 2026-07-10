# ES-22 Completion Report — Frontend Critical Fixes
**Date:** 2026-07-04
**Status:** COMPLETE

## Findings Closed

| ID | Finding | Fix Summary | Verified By |
|---|---|---|---|
| C9 | Double envelope unwrap | Audit named 4 files; actual scope was ~100 occurrences across ~55 files (nearly every list/detail page in the app). Removed the redundant `.data` hop everywhere apiClient's single-unwrap contract was double-applied. Also corrected 3 mislabeled API-function return types in `endpoints.ts` (`salesDashboardApi.summary`, `productionApi.listJobWorkOrders`, `arAgingApi`/`apAgingApi`/`stockValuationApi`) that declared a nested `data`/`meta` shape the backend never sends at that level | test + type-check + manual grep verification |
| C10 | No JWT refresh | Added single-flight 401 interceptor in `client.ts` (`refreshAccessToken` + module-level `refreshPromise`), `authApi.refresh()` delegating to it, retry-once semantics, logout+redirect on refresh failure | test (3 cases) + manual |
| H13 | Query errors indistinguishable from empty | Global `QueryCache({onError})` toast in `main.tsx` (skips 401s, which the refresh interceptor already handles) — covers all pages. `isError` → `ERPEmptyState type="error"` branching added to Customers/Suppliers/Items (the phase's named representative pages) | test |
| M18 | String vs object error envelope | Added `sendError()` helper in `apps/sales-service/src/api/http-errors.ts`; normalized 8 bare-string error sites across `invoice.routes.ts`, `pos.routes.ts`, `payment.routes.ts`, `sale-return.routes.ts` | manual review + type-check |
| M19 | pos-frontend no login | Added `LoginScreen.tsx` (tenantId/email/password → `POST /auth/login`, stores `pos_token`), `RequireAuth` route guard in `main.tsx` | manual |
| M20 | pos-frontend unchecked fetch | Added `res.ok` checks to quick-items and customer-search queries in `POSScreen.tsx`, matching the checkout mutation's existing pattern; 401 additionally clears the stored token and redirects to `/login` | manual |
| M21 | GSTIN regex drift | `OrganizationPage.tsx` and `ERPGSTINInput.tsx` both now import `GSTIN_REGEX` from `@erp/types` instead of a local copy; verified the shared regex rejects `0` in the entity-code position | test |
| L7 | No search debounce | Added `useDebounce` hook (`apps/web-frontend/src/hooks/useDebounce.ts`, 250ms), wired into the 7 named pages' query keys — visual input value updates instantly, only the query-triggering value is debounced | manual |

## Scope Note — C9 Was Far Larger Than Documented

The audit named 4 files as examples and asked to grep for "the same pattern... in case it exists elsewhere." An exhaustive repo-wide search found the same root-cause bug (an extra `.data` unwrap on top of `apiClient.get()`'s existing single unwrap) in **~100 occurrences across ~55 files** — effectively every list/detail page in `apps/web-frontend/src/pages/**`. This means, prior to this phase, most of the app's list and detail views (Purchase Orders, GRNs, Invoices, Quotations, Journals, Fixed Assets, Financial Reports, CRM Campaigns, HR pages, Production, etc.) rendered empty regardless of real data — not just the 4 pages the audit spot-checked. All ~100 occurrences were fixed and verified clean via grep (zero remaining matches) plus a full `tsc --noEmit` pass, which additionally caught several occurrences where the "obvious" flat-array fix was wrong because the underlying endpoint is actually paginated (`{content, totalElements}`) — those were corrected to unwrap `.content` instead.

One related but separate issue was surfaced and intentionally left out of scope: `apiClient.get()` returns only `data.data`, discarding any sibling top-level fields (e.g. `meta`, `page`, `pageSize`) the backend sends alongside `data`. This means fields like the stock-valuation report's `meta.totalStockValue` and the AR/AP aging reports' `meta.total`/`meta.generatedAt` were never actually reachable through `apiClient`, independent of the double-unwrap bug. `StockValuationPage.tsx`'s total is now computed client-side from the row data (same pattern already used by `ApAgingPage.tsx`) as a minimal fix; redesigning `apiClient` to preserve sibling envelope fields is a larger change and was not attempted here.

## Files Changed

**Core interceptor / query error surfacing:**
- `apps/web-frontend/src/api/client.ts` — `refreshAccessToken()`, single-flight `performRefresh()`, 401 retry-once logic in `request()`
- `apps/web-frontend/src/api/endpoints.ts` — `authApi.refresh()`; corrected `salesDashboardApi.summary`, `productionApi.listJobWorkOrders`, `arAgingApi`/`apAgingApi` (removed unused `AgingResponse`), `stockValuationApi` (removed unused `StockValuationResponse`) return types
- `apps/web-frontend/src/main.tsx` — global `QueryCache({onError})` toast

**C9 double-unwrap fix:** ~55 files under `apps/web-frontend/src/pages/**` (customers, suppliers, items, sales, purchase, inventory, accounting, hr, production, crm, gst, users, settings, reports, DashboardPage) — mechanical removal of the redundant `.data` hop, plus 12 files where the correct unwrap was `.content` (paginated endpoints) rather than a flat array, plus `apps/web-frontend/src/pages/inventory/StockValuationPage.tsx`'s `totalStockValue` now computed client-side.

**Backend error envelopes (M18):**
- `apps/sales-service/src/api/http-errors.ts` (new) — `sendError()` helper
- `apps/sales-service/src/api/invoice.routes.ts`, `pos.routes.ts`, `payment.routes.ts`, `sale-return.routes.ts`

**pos-frontend (M19, M20):**
- `apps/pos-frontend/src/LoginScreen.tsx` (new)
- `apps/pos-frontend/src/main.tsx` — `/login` route, `RequireAuth` guard
- `apps/pos-frontend/src/POSScreen.tsx` — `res.ok` checks + 401 handling on quick-items/customer-search

**GSTIN dedup (M21):**
- `apps/web-frontend/src/pages/settings/OrganizationPage.tsx`, `apps/web-frontend/src/components/erp/ERPGSTINInput.tsx`

**Debounce (L7):**
- `apps/web-frontend/src/hooks/useDebounce.ts` (new)
- `CustomersPage.tsx`, `hr/EmployeesPage.tsx`, `items/ItemsPage.tsx`, `sales/InvoicesPage.tsx`, `sales/QuotationsPage.tsx`, `suppliers/SuppliersPage.tsx`, `reports/ReportsPage.tsx`

**isError branching (H13):**
- `CustomersPage.tsx`, `SuppliersPage.tsx`, `ItemsPage.tsx` — `<ERPEmptyState type="error">` on query failure

**Test infrastructure (new — none existed for web-frontend):**
- `apps/web-frontend/vitest.config.ts`, `src/setupTests.ts`
- Added `vitest`, `@testing-library/react`, `@testing-library/jest-dom`, `jsdom` as devDependencies; added `test` script
- `src/api/__tests__/client.test.ts`, `src/pages/customers/__tests__/CustomersPage.test.tsx`, `src/pages/suppliers/__tests__/SuppliersPage.test.tsx`, `src/pages/items/__tests__/ItemsPage.test.tsx`, `src/pages/settings/__tests__/OrganizationPage.test.tsx`

## Tests: 9/9 PASS | web-frontend type-check: PASS | web-frontend build: PASS | pos-frontend type-check: PASS | pos-frontend build: PASS | sales-service type-check: PASS | lint: pre-existing repo-wide debt only (see below)

### Test breakdown
1. `client.test.ts` (3 tests): 401 → single refresh → retry with new token; retried-401 doesn't loop; two concurrent 401s single-flight into one refresh call
2. `CustomersPage.test.tsx` (2 tests): mocked `{content:[...]}` response renders rows (C9 regression test); mocked query rejection renders the error empty-state, not "No customers found."
3. `SuppliersPage.test.tsx`, `ItemsPage.test.tsx` (1 test each): same C9 regression pattern
4. `OrganizationPage.test.tsx` (2 tests): GSTIN with `0` in the 9th position is rejected; a valid GSTIN passes

### Lint
`pnpm lint` was already failing before this phase with ~1,100+ pre-existing problems in web-frontend alone (confirmed via `git stash` comparison — the same `no-undef` errors for `URLSearchParams`/`HTMLInputElement`/`document`/etc. exist on the unmodified files), matching the `preexisting_lint_debt` finding from earlier phases (repo-wide missing ESLint browser/Node globals config, not phase-specific). No new lint errors were introduced by this phase's changes — verified by running ESLint scoped to only the files this phase touched/created and confirming every remaining error is either pre-existing (present before the change, per `git stash`) or the same systemic globals gap. One genuinely new lint error (in my own new test file, `no-undef` on `HTMLFormElement`) was fixed by using `fireEvent.click` on the submit button instead of casting the form element.

## Manual Verification
- [x] Session survives past 15 minutes without re-login: verified via unit test simulating an expired-token 401 → refresh → retry cycle (full 15-minute wall-clock wait not performed; the interceptor logic is deterministic and covered by 3 targeted tests including the concurrent-request single-flight case)
- [x] Customers/Suppliers/Items pages show real rows given a mocked paginated API response (regression tests for the exact scenario the audit described — these tests would have caught the original C9 bug)
- [x] `pnpm --filter @erp/web-frontend build`, `pnpm --filter @erp/pos-frontend build`, `pnpm --filter @erp/types build` all pass
- [x] `pnpm --filter @erp/web-frontend type-check`, `pnpm --filter @erp/pos-frontend type-check`, `pnpm --filter @erp/sales-service type-check` all pass with zero errors

## Known Issues / Deferred
- **M18 scope**: only sales-service's bare-string error sites were normalized (the files this phase's named findings pointed at). The same pattern exists in auth-service (`mfa.routes.ts`, `sessions.routes.ts`, `impersonate.routes.ts`, `audit-log.routes.ts`, etc.) and purchase-service (`purchase-order.routes.ts:190`). Flagged for a future phase.
- **H13 scope**: the global toast-on-error now fires for every page, but explicit `isError` → `<ERPEmptyState type="error">` branching (a visually distinct empty state, not just a toast) was only added to the 3 phase-named representative pages (Customers/Suppliers/Items), not all ~102 other list pages that share the same `?? []`-into-empty-state pattern. A follow-up phase could roll this out repeat-application-wide.
- **apiClient sibling-field loss** (surfaced during C9 investigation, not a phase-22 finding): `apiClient.get()` discards any top-level response field other than `data` (e.g. `meta`, bare `page`/`pageSize` siblings). This was already true before this phase and is unrelated to the double-unwrap bug, but it means backend responses that intentionally send `{data, meta}` can never have their `meta` read by the frontend as currently architected. Only the one call site this surfaced as a type error (`StockValuationPage.tsx`) was adjusted (computed client-side instead); other call sites weren't audited for the same issue.
- **pos-frontend session**: the new login screen does not implement the refresh-on-401 flow from C10 (out of scope per the phase's explicit boundary — "makes it able to authenticate, not a complete rewrite"). A POS session will still need a manual re-login after the access-token TTL expires.
- **pos-frontend MFA**: accounts with TOTP enabled cannot log in through the new POS login screen (it surfaces an error asking them to sign in via the main ERP app first) — MFA support for POS was not requested and would be new scope.
- Pre-existing repo-wide lint debt (~1,100+ problems in web-frontend, ~200 in sales-service) was not addressed — out of scope for this phase, matches known findings from earlier phases.
