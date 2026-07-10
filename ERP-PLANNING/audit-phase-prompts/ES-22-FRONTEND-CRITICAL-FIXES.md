# ES-22 — Frontend Critical Fixes: Dead Pages, Session Refresh, Error Surfacing
## STATUS: ✅ COMPLETE — see phase-completions/ES-22_COMPLETION.md
## Sprint: 5 | Effort: 3–4 days | Risk: Critical (user-facing, currently broken in normal use)
## Depends on: ES-15 (frontend UX pass)
## Unlocks: nothing blocked on this — but every demo/pilot user will hit these bugs within 15 minutes
## Source: `ERP-PLANNING/ARCHITECTURE_AUDIT_REPORT.md` findings C9, C10, H13, M18, M19, M20, M21, L7

---

## YOUR ROLE

You are the **Principal Frontend Engineer** on the NEXORAA Multi-Tenant Cloth Retail ERP.

The 2026-07-03 architecture audit found that the Customers, Suppliers, and Items list pages
**always render empty regardless of how much data exists**, and that **every user's session breaks
with silent failures roughly 15 minutes after login** because there is no JWT refresh flow. These
are not edge cases — they will be hit by the very first user in the very first demo. This phase
fixes those two show-stoppers plus the surrounding error-handling gaps the audit found while
investigating them.

**This is a bug-fix phase, not a redesign. Do not touch styling, layout, or component structure
beyond what's needed to fix the listed defects.**

---

## ═══════════════════════════════════════════
## PRE-FLIGHT CHECKLIST
## ═══════════════════════════════════════════

- [ ] Read `ERP-PLANNING/ARCHITECTURE_AUDIT_REPORT.md` §2 (C9, C10), §3 (H13), §4 (M18, M19, M20,
      M21), §5 (L7)
- [ ] Read `ERP-PLANNING/audit-phase-prompts/ES-15-FRONTEND-UX-DEPRECIATION.md` and its completion
      report — the empty-state/loading-state/error-boundary conventions you must stay consistent with
- [ ] Read `apps/web-frontend/src/api/client.ts` in full — understand exactly how `apiClient.get()`
      already unwraps the `{ data: {...} }` envelope, so you understand why the double-unwrap in
      Step 1 is wrong
- [ ] Read `apps/web-frontend/src/pages/hr/EmployeesPage.tsx` — this is the **correct** pattern to
      copy for Step 1 (`(data as Record<string,unknown>)?.content`, single unwrap)
- [ ] Read `apps/web-frontend/src/store/auth.store.ts` and `apps/web-frontend/src/api/endpoints.ts`
      — confirm `refreshToken` is stored but `authApi` has no `refresh()` method
- [ ] Read `apps/auth-service/src/routes/refresh.ts` — confirm the backend endpoint already works;
      you are only fixing the frontend caller, not the backend
- [ ] Read `apps/web-frontend/src/components/erp/ERPEmptyState.tsx` — note the unused `type="error"`
      variant (line ~31-35) that Step 3 will finally use
- [ ] Read `apps/pos-frontend/src/POSScreen.tsx` and `apps/pos-frontend/src/main.tsx` in full
- [ ] Read `packages/shared-types/src/validators.ts` (the `GSTIN_REGEX` source of truth)
- [ ] Run `pnpm --filter @erp/web-frontend build` and `pnpm --filter @erp/pos-frontend build` —
      confirm a clean baseline

---

## ═══════════════════════════════════════════
## PROJECT CONTEXT
## ═══════════════════════════════════════════

### Response envelope (already correctly handled by `apiClient`)
```typescript
// Backend sends: { data: { content: [...], totalElements, page, size, totalPages } }
// apiClient.get() already resolves to the INNER object: { content, totalElements, page, size }
// So callers should do: (data as Record<string,unknown>)?.content — NOT data?.data?.content
```

### Stack
React 19 + Vite 6 + React Router 7 + TanStack Query v5 + Zustand v5 + react-hook-form + Zod +
Tailwind v4. Server state lives in TanStack Query; Zustand is for pure client state only
(`auth.store.ts`, `ui.store.ts`) — do not add server data to a Zustand store.

### Coding Standards
- TypeScript strict — no `any`
- Match existing component patterns exactly (`ERPEmptyState`, `ERPDataGrid`, `ERPErrorBoundary`)
- No new dependencies without checking `packages/shared-types` first for an existing schema/type

---

## ═══════════════════════════════════════════
## OBJECTIVE
## ═══════════════════════════════════════════

1. **[C9]** Fix the double-envelope-unwrap bug that makes Customers/Suppliers/Items lists and the
   Fixed Asset account picker always render empty
2. **[C10]** Implement JWT refresh-on-401 so sessions survive past the 15-minute access-token TTL
3. **[H13]** Surface query errors distinctly from genuine empty states, repo-wide
4. **[M18]** Normalize backend error responses to the `{code, message}` envelope everywhere
5. **[M19]** Give pos-frontend a working login path
6. **[M20]** Fix pos-frontend's unchecked raw `fetch` calls
7. **[M21]** De-duplicate the GSTIN regex to one shared source of truth
8. **[L7]** Debounce search-as-you-type on list pages

---

## ═══════════════════════════════════════════
## SCOPE
## ═══════════════════════════════════════════

### Step 1 — Fix the double-unwrap bug [C9]

Exactly 4 files, each doing `((data as Record<string,unknown>)?.data as Record<string,unknown>)
?.content` where it should do `(data as Record<string,unknown>)?.content` (drop the extra `.data`
hop):
- `apps/web-frontend/src/pages/customers/CustomersPage.tsx:37`
- `apps/web-frontend/src/pages/suppliers/SuppliersPage.tsx:23`
- `apps/web-frontend/src/pages/items/ItemsPage.tsx:32`
- `apps/web-frontend/src/pages/accounting/FixedAssetDetailPage.tsx:82`

Before committing, grep the whole `apps/web-frontend/src/pages/**` tree for the same
`?.data as Record<string,unknown>)?.content` double-hop pattern in case it exists elsewhere
uncaught by the audit's spot-check — fix every occurrence found, not just these 4.

### Step 2 — JWT refresh-on-401 [C10]

`apps/web-frontend/src/api/endpoints.ts`: add `authApi.refresh(refreshToken: string)` calling the
existing `POST /auth/refresh` (or whatever exact path `apps/auth-service/src/routes/refresh.ts`
registers — confirm from the pre-flight read).

`apps/web-frontend/src/api/client.ts`: in `request()`, on a 401 response:
1. If a refresh is already in flight (single-flight — use a module-level promise so concurrent
   401s from multiple simultaneous requests don't each trigger their own refresh call), await it.
2. Otherwise call `authApi.refresh()` with the stored refresh token.
3. On success: update the stored access token (and refresh token if rotated — check whether
   `refresh.ts` rotates it), retry the original request once with the new token.
4. On failure (refresh itself 401s/errors): call the existing `logout()` from `auth.store.ts` and
   redirect to the login route.

Do not retry more than once per original request (avoid infinite refresh loops if the new token is
somehow also rejected).

### Step 3 — Surface query errors [H13]

`apps/web-frontend/src/main.tsx`: add a global `QueryCache({ onError })` to the `QueryClient`
construction — on error, toast a user-facing message (reuse whatever toast utility mutations
already use, e.g. `react-hot-toast`), and specifically handle 401 by relying on the Step 2
interceptor rather than double-toasting.

For list pages (start with the ones the audit flagged as representative — Customers, Suppliers,
Items, and any other page using the `?? []` fallback-into-empty-state pattern you find via grep):
destructure `isError` from `useQuery` and branch to `<ERPEmptyState type="error" .../>` instead of
the default empty state when `isError` is true. Do not change the loading-state or success-state
rendering.

### Step 4 — Normalize backend error envelopes [M18]

Grep `apps/*/src/api/*.routes.ts` repo-wide for `reply.code(4` / `reply.code(5` followed by
`.send({ error: '...' })` where `error` is a bare string instead of `{ code, message }`. Known
instances to fix:
- `apps/sales-service/src/api/invoice.routes.ts:335`
- `apps/sales-service/src/api/pos.routes.ts:90,121,142`

Fix each to the spec'd envelope (`ERP_MASTER_SPEC.md` §6.5): `{ error: { code: 'NOT_FOUND',
message: 'Invoice not found' } }` — pick a sensible machine-readable `code` per site consistent
with the existing `ERPError` hierarchy in `packages/shared-types/src/errors.ts`. If a shared
`sendError()` helper doesn't already exist, you may add one small helper in the service's own
codebase (not a new shared package) to prevent the next hand-written route from making the same
mistake — keep it minimal.

### Step 5 — pos-frontend login [M19]

`apps/pos-frontend/src/POSScreen.tsx:62` reads `localStorage.getItem('pos_token')`, which nothing
in the app ever sets. Add a minimal login screen/route (reuse `authApi.login` from
`apps/web-frontend`'s pattern — check whether pos-frontend already depends on the same
`@erp/types`/API-client approach or has its own) that authenticates and stores the resulting token
under the `pos_token` key. Apply the same refresh-on-401 pattern from Step 2 if pos-frontend has
its own `fetch` wrapper, or share `apiClient` from web-frontend if the build setup allows it —
check `apps/pos-frontend/package.json` for what's already available before deciding.

### Step 6 — pos-frontend fetch hygiene [M20]

`apps/pos-frontend/src/POSScreen.tsx:124-131` (quick-items) and `:134-141` (customer-search):
add a `res.ok` check before `res.json()`, matching the pattern already correctly used by the
checkout mutation at `:199-217` in the same file. On `!res.ok`, throw/handle consistently with
however Step 5's login screen surfaces errors.

### Step 7 — GSTIN regex de-duplication [M21]

`apps/web-frontend/src/pages/settings/OrganizationPage.tsx:11` and
`apps/web-frontend/src/components/erp/ERPGSTINInput.tsx:13` both redeclare a local `GSTIN` regex
instead of importing `GSTIN_REGEX` (or the Zod `GSTINSchema` if one exists) from
`packages/shared-types/src/validators.ts:8`. Replace both local declarations with the shared
import. The shared regex is the correct one (9th character excludes `0`) — `OrganizationPage.tsx`'s
local copy is the one that's wrong; verify after the fix that the Organization Settings form
rejects a GSTIN with `0` in the entity-code position, matching backend validation.

### Step 8 — Debounce search inputs [L7]

Add a debounce (150–300ms; check if a debounce hook/utility already exists in
`apps/web-frontend/src/hooks/` before writing a new one) to the `search` state that feeds
`queryKey` in: `CustomersPage.tsx`, `hr/EmployeesPage.tsx`, `items/ItemsPage.tsx`,
`sales/InvoicesPage.tsx`, `sales/QuotationsPage.tsx`, `suppliers/SuppliersPage.tsx`,
`reports/ReportsPage.tsx`. Do not debounce the input's visual `value` (it should still update
instantly as the user types) — only debounce the value that feeds the query.

### OUT OF SCOPE
- Any visual/layout redesign
- Building out a full pos-frontend feature set beyond login — this phase makes it *able* to
  authenticate, not a complete rewrite
- Changing the TanStack Query / Zustand architecture itself

---

## ═══════════════════════════════════════════
## TESTING REQUIREMENTS
## ═══════════════════════════════════════════

Add/extend frontend tests (check existing test setup — Vitest + React Testing Library per
`apps/web-frontend`'s existing `__tests__`/`*.test.tsx` convention):

1. `CustomersPage`/`SuppliersPage`/`ItemsPage`: given a mocked API response with `content: [...]`,
   the rows actually render (this is the literal regression test for C9 — it would have caught it)
2. `apiClient`: a mocked 401 response triggers exactly one refresh call, then retries the original
   request with the new token; a second 401 after refresh does not loop
3. `apiClient`: two concurrent requests that both 401 trigger only one refresh call (single-flight)
4. A list page with a mocked query error renders the error empty-state, not the "no data" empty
   state
5. `OrganizationPage`'s GSTIN field rejects a GSTIN with `0` in the 9th position

Manual verification (record in completion report): log in, wait or force-expire the access token,
confirm the app keeps working without a manual re-login. Navigate to Customers/Suppliers/Items with
seeded data present and confirm rows render.

---

## ═══════════════════════════════════════════
## BUILD VERIFICATION
## ═══════════════════════════════════════════

```bash
pnpm --filter @erp/web-frontend build
pnpm --filter @erp/pos-frontend build
pnpm --filter @erp/types build
pnpm lint
pnpm type-check
pnpm test --filter @erp/web-frontend --filter @erp/pos-frontend
```

---

## ═══════════════════════════════════════════
## VERIFICATION CHECKLIST
## ═══════════════════════════════════════════

- [ ] Customers, Suppliers, Items pages render actual rows given actual data
- [ ] Fixed Asset account picker is populated
- [ ] A session survives past 15 minutes without a manual re-login (verified manually, not just
      by unit test)
- [ ] A failed query renders a visibly different state than a genuine empty result
- [ ] `invoice.routes.ts` / `pos.routes.ts` error responses match the `{error:{code,message}}`
      envelope
- [ ] pos-frontend can complete a login and receive a usable `pos_token`
- [ ] pos-frontend quick-items/customer-search handle a non-OK response without silently rendering
      an empty grid
- [ ] GSTIN validation is identical across `CustomerFormPage`, `SupplierFormPage`,
      `OrganizationPage`, and `ERPGSTINInput`
- [ ] Search inputs on the 7 listed pages no longer fire a request per keystroke

---

## ═══════════════════════════════════════════
## REGRESSION CHECKLIST
## ═══════════════════════════════════════════

- [ ] ES-15's loading-skeleton/empty-state/dark-mode work is untouched on pages you didn't modify
- [ ] `ERPEmptyState`'s `exactOptionalPropertyTypes`-safe pattern (conditional spread, not
      `cond ? {} : undefined`) is preserved in any new usage you add
- [ ] Mutation-side error toasts (already correctly implemented) still work
- [ ] Normal login (no forced expiry) is unaffected
- [ ] All other list pages not touched in Step 1/8 still function identically

---

## ═══════════════════════════════════════════
## DEFINITION OF DONE
## ═══════════════════════════════════════════

- [ ] C9, C10, H13, M18, M19, M20, M21, L7 all closed per the fixes above
- [ ] All new/extended tests pass; manual verification steps recorded in completion report
- [ ] `pnpm lint` and `pnpm type-check` pass repo-wide
- [ ] Completion report saved at `ERP-PLANNING/phase-completions/ES-22_COMPLETION.md`
- [ ] `ERP-PLANNING/ARCHITECTURE_AUDIT_REPORT.md` updated: mark C9, C10, H13, M18, M19, M20, M21,
      L7 as ✅ FIXED with a pointer to the completion report

---

## ═══════════════════════════════════════════
## COMPLETION REPORT TEMPLATE
## ═══════════════════════════════════════════

**Save as:** `ERP-PLANNING/phase-completions/ES-22_COMPLETION.md`

```markdown
# ES-22 Completion Report — Frontend Critical Fixes
**Date:** [YYYY-MM-DD]
**Status:** COMPLETE

## Findings Closed
| ID | Finding | Fix Summary | Verified By |
|---|---|---|---|
| C9 | Double envelope unwrap | Removed extra .data hop in 4(+N found) files | test + manual |
| C10 | No JWT refresh | Added single-flight 401 interceptor | test + manual (session survived Xmin) |
| H13 | Query errors indistinguishable from empty | Global QueryCache onError + isError branching | test |
| M18 | String vs object error envelope | Normalized N routes | manual review |
| M19 | pos-frontend no login | Added login screen | manual |
| M20 | pos-frontend unchecked fetch | Added res.ok checks | manual |
| M21 | GSTIN regex drift | Both files now import shared GSTIN_REGEX | test |
| L7 | No search debounce | Added Xms debounce to 7 pages | manual |

## Files Changed
[Table]

## Tests: [N]/[N] PASS | lint: PASS | type-check: PASS | build: PASS

## Manual Verification
- [ ] Session survived 15+ minutes without re-login: [describe how you forced/waited for expiry]
- [ ] Customers/Suppliers/Items pages show real data with seeded test data

## Known Issues / Deferred
[Be honest]
```
