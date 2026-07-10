# [PG-051] POS branch-picker UI

> Template version 1.0. Every gap-prompt file in this tree must follow this exact section order. Do not add sections; do not omit sections that apply. If a section genuinely does not apply to this gap, write "Not applicable — <one-line reason>" instead of deleting it, so the structure stays diffable across files.

**Category:** POS
**Priority:** High
**Complexity:** S — one new screen plus a handful of hardcoded-value replacements; the hard part (server-side branch guard, `branchIds`-on-JWT mechanism) already exists and is verified correct.
**Depends on:** none
**Blocks:** none
**Primary service(s)/package(s):** apps/pos-frontend (all new work); apps/sales-service (read-only, no backend change needed); apps/tenant-service (read-only, existing branch-list endpoint reused)

---

## Overview

- **Business objective:** a cashier at a multi-branch tenant logging into POS today has no way to choose which branch/warehouse they're operating at — `branchId: 1` / `warehouseId: 1` are literal hardcoded values in `apps/pos-frontend/src/POSScreen.tsx` (lines 488-489, 598, 648, 655). For a single-branch tenant this is invisible; for any tenant with more than one physical location, every POS sale, held sale, and offline-created customer is silently attributed to branch 1 regardless of which actual store the till is in — a real data-integrity problem (wrong branch's stock gets decremented, wrong branch's sales figures get inflated) the moment a second branch is onboarded.
- **Current implementation:** The backend already enforces branch scoping correctly and has for some time — `apps/sales-service/src/api/pos.routes.ts`'s `branchInScope()` helper (lines 30-33) rejects a `branchId` outside the caller's JWT `branchIds` on both `POST /pos/sessions/open` (line 123) and `POST /pos/sales` (line 201), returning `403 BRANCH_ACCESS_DENIED`. This guard was shipped as part of OFFLINE-01 (per its inline comment referencing that phase and mirroring `invoice.routes.ts`'s `getBranchScope()` pattern). What's missing is purely client-side: no UI anywhere lets a cashier select a branch, so the hardcoded `1` is the only value ever sent, and the guard is either trivially satisfied (single-branch tenants) or would reject the sale outright the moment a cashier's real assignment doesn't include branch 1.
- **Current architecture:** `apps/pos-frontend/src/auth.ts`'s `getAuthClaims()` (line 75) already decodes the JWT client-side and returns `{ tenantId: number, branchIds: number[] }` — the exact per-user branch-access list this picker needs, already present and already used elsewhere in this app (OFFLINE-05's held-sales/offline-customer Dexie writes). web-frontend already has the equivalent UI pattern fully built: `apps/web-frontend/src/components/erp/BranchSwitcher.tsx` renders nothing if `branchIds.length <= 1` (line 42), otherwise fetches the branch list (`branchApi.list`, scoped to `PERMISSIONS.BRANCH_VIEW`) and lets the user pick, persisting the choice via a small dedicated Zustand store (`apps/web-frontend/src/store/branch.store.ts`, `useBranchStore`, `persist` middleware, `currentBranchId`/`setCurrentBranchId`). The `user.branchIds` mechanism this depends on was previously broken (per project memory `customer_creation_was_broken`: `user.branchIds` was always empty at runtime because `completeLogin()` never copied it from the JWT) — **verified during this audit to be fixed**: `apps/web-frontend/src/pages/auth/LoginPage.tsx` line 109 now sets `branchIds: me.branches?.map((b) => b.branchId) ?? []` explicitly when building the auth-store user object. This package can build on that mechanism with confidence; it is not still broken.
- **Current limitations:** pos-frontend has no equivalent of `BranchSwitcher`/`branch.store.ts` at all — no branch-list fetch, no persisted branch selection, nothing. `warehouseId` has no analogous concept anywhere in web-frontend either (web-frontend's `BranchSwitcher` only picks a branch, not a warehouse) — pos.routes.ts's `OpenSessionSchema`/`POSSaleSchema` both require a `warehouseId` distinct from `branchId`, so this package must also resolve how a cashier picks (or is defaulted into) a warehouse, which has no existing UI precedent anywhere in this codebase to copy.

## Existing Code Analysis

- **What already exists and should be reused:** `getAuthClaims()` in `apps/pos-frontend/src/auth.ts` (line 75) for the current user's `branchIds`. The **pattern** (not the code directly, since pos-frontend has no Zustand) of `BranchSwitcher.tsx`'s core logic: only show a picker when `branchIds.length > 1`, default to the first accessible branch, filter the fetched branch list down to only the IDs the user has access to (`BranchSwitcher.tsx` lines 31-34) rather than trusting the branch-list API's full result set. The existing `tenant`-service `GET /branches` endpoint (`apps/tenant-service/src/api/branch.routes.ts`, called via `branchApi.list` in web-frontend's `api/endpoints.ts` line 90) — reuse this exact endpoint from pos-frontend rather than adding a POS-specific branches endpoint.
- **What should never be modified:** `branchInScope()` and the `403 BRANCH_ACCESS_DENIED` checks in `pos.routes.ts` — those are the correct, already-shipped server-side enforcement this package's UI must respect, not work around. web-frontend's `BranchSwitcher.tsx`/`branch.store.ts` themselves — out of scope, reference-only.
- **Prior related work:** OFFLINE-01 (branch-isolation guard, backend) and OFFLINE-05 (held sales/offline customer creation, which already reads `getAuthClaims().branchIds` for Dexie writes) — both prerequisites this package builds on, neither needs revisiting. project memory's `customer_creation_was_broken` note about `user.branchIds` being empty at runtime — **confirmed fixed** in web-frontend's `LoginPage.tsx` as described above; flagging this explicitly because the task briefing for this package called out verifying it before relying on it.

## Architecture

- **New screen:** `BranchSelectScreen.tsx` in `apps/pos-frontend/src/`, inserted into the login flow: `LoginScreen` → (if `getAuthClaims().branchIds.length > 1` and no branch already selected for this device) → `BranchSelectScreen` → `POSScreen` (or `ShiftOpenScreen` if PG-050 has shipped — see cross-reference below). If `branchIds.length <= 1`, skip straight through (mirrors `BranchSwitcher.tsx`'s `<= 1` short-circuit at line 42) — a single-branch tenant's cashier should never see a picker they have no real choice in, matching this repo's existing design decision for the same problem in web-frontend.
- **Persistence:** a new dedicated store, `apps/pos-frontend/src/branchStore.ts` — but per this app's existing convention (no Zustand anywhere in pos-frontend; see PG-050's Architecture section making the same observation), implemented as plain `localStorage` (`pos_branch_id`, `pos_warehouse_id` keys) plus a small helper module, not a Zustand store. Introducing Zustand for this one value would duplicate a whole state-management library into an app that has deliberately avoided one so far — the "existing branchIds-on-user mechanism web-frontend already uses" the task brief points to is the *pattern* (only show if >1 branch, persist the choice, default sensibly), not literally the Zustand library, and pos-frontend's existing `localStorage`-based convention (`auth.ts`) is the right mechanism to extend here for consistency within this specific app.
- **Warehouse resolution:** since there is no existing warehouse-picker UI anywhere in this codebase to copy, and warehouses are typically 1:1 or few:1 with a branch in a retail setting, the pragmatic default is: fetch the warehouse(s) associated with the selected branch (check `apps/tenant-service` or `apps/inventory-service` for a `GET /warehouses?branchId=` style endpoint — if a branch has exactly one warehouse, auto-select it silently; only show a warehouse sub-picker if a branch genuinely has more than one). This keeps the UI proportionate to the actual data model rather than always forcing a second picker step that's a no-op for most tenants.
- **Offline queue interaction:** `PendingSale`/`PendingCustomer`/`HeldSale` records already carry a `branchId` field written at queue time (`apps/pos-frontend/src/db.ts`'s `HeldSale`/`CachedCustomer` interfaces) — once this package's picker replaces the hardcoded `1`, every queue-write call site (currently passing the literal `1`, per the grep findings below) should read from the new persisted branch/warehouse selection instead. No change to the Dexie schema itself is needed — the field already exists, only the value being written changes.
- **Cross-reference with PG-050 (shift/cash-drawer UI):** both packages need a branch (and PG-050 also needs a warehouse) at roughly the same point in the login flow (before the till is usable). Whichever package is implemented first should own the branch/warehouse selection UI; the second package should consume its persisted state rather than re-prompting the cashier a second time. This package (PG-051) is scoped as the canonical home for branch/warehouse selection given its narrower, more clearly-bounded scope (S complexity vs PG-050's M) — if PG-050 lands first with its own inline minimal picker (per that package's own Architecture note), this package's implementation should replace that inline picker with the fuller `BranchSelectScreen` described here and have `ShiftOpenScreen` consume its output, rather than the two coexisting.

## Database Changes

Not applicable — no schema change. `branchId`/`warehouseId` fields already exist on every relevant table (`posSessions`, `invoices`, Dexie's `HeldSale`/`CachedCustomer`).

## Backend

Not applicable in the sense of new backend code — this package is a frontend consumer of already-existing, already-correct backend behavior (`branchInScope()`, `GET /branches`). The only backend-adjacent question is whether a `GET /warehouses?branchId=` (or equivalent) endpoint already exists for the warehouse-resolution step above; if it does not, a minimal read-only endpoint should be added (whichever service owns the `warehouses` table — check `inventory-service` first) rather than pos-frontend inventing a warehouse list from sale/session data. This should be verified and, if missing, added as a small additive route following that service's existing Fastify/Zod/`requirePermission` convention — not a redesign of warehouse management.

## Frontend

- **New screen:** `BranchSelectScreen.tsx` — fetches the tenant's branch list (reusing the same `GET /branches` call web-frontend makes, via `authFetch` against the `tenant`-service base URL — pos-frontend will need a `VITE_TENANT_API_URL` env var if one doesn't already exist; check `apps/pos-frontend`'s existing env-var conventions, e.g. `VITE_AUTH_API_URL`/`VITE_SALES_API_URL`, and add a matching one rather than hardcoding a URL), filters it down to `getAuthClaims().branchIds`, renders a simple list/grid of branch names using `POSButton`/`POSCard` for visual consistency with the rest of this app, and on selection persists `pos_branch_id` (+ resolved `pos_warehouse_id`) to `localStorage` before navigating on.
- **`POSScreen.tsx` changes:** every hardcoded `branchId: 1` / `warehouseId: 1` (lines 488-489, 598, 648, 655) is replaced with values read from the new persisted branch/warehouse selection (via a small helper, e.g. `getSelectedBranch()` colocated with `auth.ts`'s existing helpers).
- **Route guard:** a `RequireBranch` guard in `main.tsx`, modeled on `RequireAuth`'s existing pattern, redirecting to `/branch-select` when `branchIds.length > 1` and no branch is yet persisted for this device — mirrors PG-050's `RequireSession` guard structurally (both packages should feel like the same pattern applied twice, not two different approaches).
- **A "switch branch" affordance** for a cashier who needs to change locations mid-day (e.g. covering a shift at a different till) — a small button/menu item in `POSScreen.tsx`'s header, re-opening `BranchSelectScreen`. This should be gated behind ending any active session first (a branch switch mid-session doesn't make sense given a session is already branch-scoped per PG-050) — coordinate with PG-050's shift-close flow rather than allowing a silent branch swap under an open till.
- **Accessibility:** follow this app's existing axe-core-covered conventions (`aria-label`s, focus order) — same expectation as every other pos-frontend screen.
- **Responsive behavior:** pos-frontend targets a fixed till/tablet viewport, same as every existing screen — no new responsive work required.

## API Contract

- `GET /branches` (**existing, reused as-is**, `apps/tenant-service`) — Request: none beyond auth. Response: `{ content: Array<{ id: number, name: string, ... }>, totalElements: number }` (matches `branchApi.list`'s existing shape in web-frontend's `api/endpoints.ts`). **Note:** FEATURE_INVENTORY.md §8 documents this endpoint as currently missing a backend permission check despite being permission-gated on the frontend nav (tracked separately as PG-013) — this package's read-only call to it is unaffected either way, but is worth knowing about rather than treating as a fresh discovery.
- `GET /warehouses?branchId=` (**verify existence; add if missing**) — Request: `branchId` query param. Response: `{ data: Array<{ id: number, name: string, branchId: number }> }`. Not applicable if the warehouse-resolution step ends up auto-selecting via existing session/sale data without needing a dedicated list call — confirm during implementation which is true before building a new endpoint speculatively.
- No changes to `POST /pos/sessions/open` or `POST /pos/sales` — both already accept and validate `branchId`/`warehouseId` exactly as this package will now correctly supply them.

## Multi-Tenant Considerations

- Branch isolation is the entire subject of this package — the picker must only ever offer branches present in `getAuthClaims().branchIds`, and the server-side `branchInScope()` check remains the authoritative enforcement regardless of what the picker shows (defense in depth: a stale/tampered client-side branch list is still rejected server-side).
- No new feature-flag gating needed — this is core POS correctness, not an opt-in feature.
- Tenant scoping: `GET /branches` is already tenant-scoped server-side (via `req.auth.tenantId`) — no client-side tenant filtering needed beyond what the endpoint already does.

## Integration

- **apps/pos-frontend:** all new UI work described above.
- **apps/tenant-service:** read-only reuse of the existing `GET /branches` endpoint.
- **apps/inventory-service** (or wherever `warehouses` is owned — verify during implementation): possibly one new small read-only endpoint if warehouse-listing doesn't already exist in a form pos-frontend can call.
- **PG-050 (POS shift/cash-drawer UI):** shares the same login-flow insertion point; see the explicit sequencing note in Architecture above.

## Coding Standards

Reuses `authFetch()`, `getAuthClaims()`, and this app's existing `localStorage`-based persistence convention (no new state-management library — see Architecture's explicit reasoning for why Zustand is not introduced here despite web-frontend using it for the equivalent feature). `POSButton`/`POSCard` for visual consistency. No new HTTP-client pattern.

## Performance

Not applicable beyond a single branch-list fetch at login time (already a lightweight, infrequent call in web-frontend's equivalent `BranchSwitcher`) — no caching/pagination concerns beyond what `GET /branches` already provides (`branchApi.list` already supports a `size` param).

## Security

- No new attack surface — this package only lets a user select among branches their own JWT already grants access to (`branchIds`), enforced both client-side (filtering the picker's options) and server-side (`branchInScope()`, unchanged).
- RBAC: reuses whatever permission already gates `GET /branches` server-side (currently none, per the known PG-013 gap noted above — not this package's fix to make, but worth flagging again here since Security is the natural section for it).

## Testing

- **Frontend:** new `apps/pos-frontend/src/__tests__/BranchSelectScreen.test.tsx` covering: renders nothing/auto-skips when `branchIds.length <= 1`, renders a picker when `> 1`, persists the selected branch, filters the fetched list down to the user's own `branchIds` (mirroring `BranchSwitcher`'s own filtering logic, which should get the same test treatment here).
- Extend `apps/pos-frontend/src/__tests__/crossCutting.test.tsx` (or add a new test) confirming `POSScreen.tsx`'s sale/customer/held-sale payloads use the persisted branch/warehouse values instead of the literal `1`.
- **Backend:** no new backend test needed unless a `GET /warehouses?branchId=` endpoint is added, in which case it needs its own basic coverage (tenant-scoping, branch-filtering) in whichever service owns it.

## Acceptance Criteria

- [ ] Every hardcoded `branchId: 1` / `warehouseId: 1` in `POSScreen.tsx` (lines 488-489, 598, 648, 655) is replaced with a value sourced from the new branch-picker state — verifiable by grep showing no remaining literal `1` at those call sites.
- [ ] A cashier whose JWT `branchIds` contains more than one branch is shown `BranchSelectScreen` before reaching `POSScreen` — verifiable manually or via an RTL test asserting the redirect.
- [ ] A cashier whose JWT `branchIds` contains exactly one branch never sees a picker — verifiable via the same test suite, opposite case.
- [ ] A sale submitted after branch selection carries the selected `branchId`, and the server's `branchInScope()` check accepts it (no `403 BRANCH_ACCESS_DENIED` for a legitimately-assigned branch) — verifiable via an integration test or manual sale-completion check.
- [ ] Attempting to select a branch not present in the JWT's `branchIds` is not possible through the UI (the picker's option list is filtered) — verifiable by inspecting the rendered options against a test JWT with a restricted `branchIds` set.

## Deliverables

- **Files to create:** `apps/pos-frontend/src/BranchSelectScreen.tsx`; a small branch/warehouse persistence helper (e.g. `apps/pos-frontend/src/branchStore.ts`, plain localStorage-backed, not Zustand); `apps/pos-frontend/src/__tests__/BranchSelectScreen.test.tsx`.
- **Files to modify:** `apps/pos-frontend/src/main.tsx` (new `/branch-select` route + `RequireBranch` guard), `apps/pos-frontend/src/POSScreen.tsx` (replace all hardcoded `branchId`/`warehouseId` literals), possibly a new warehouse-list endpoint in whichever service owns `warehouses` if one doesn't already exist.
- **Migrations:** none.
- **APIs added/changed:** none required if `GET /branches` and an existing warehouse-list mechanism suffice; possibly one new `GET /warehouses?branchId=` endpoint if verified missing.
- **Events added/changed:** none.
- **Tests added:** `BranchSelectScreen.test.tsx`; extended `crossCutting.test.tsx` coverage for branch/warehouse propagation into sale/customer/held-sale payloads.

---

## Context Preservation (for a fresh AI session with no prior history)

**Previous Work Summary:** pos-frontend has a working server-side branch-isolation guard (OFFLINE-01, `branchInScope()` in `apps/sales-service/src/api/pos.routes.ts`) but no client-side way to select a branch — `branchId`/`warehouseId` are hardcoded to `1` throughout `POSScreen.tsx`. web-frontend has already solved the equivalent problem (`BranchSwitcher.tsx` + `branch.store.ts`) and its `user.branchIds` mechanism, previously broken (empty at runtime), is **confirmed fixed** — `LoginPage.tsx` line 109 now correctly populates `branchIds` from `me.branches` on login.

**Current Objective:** Build a POS-side branch (and warehouse) picker, shown only to cashiers with access to more than one branch, persisted for the POS session/offline queue, replacing every hardcoded `branchId: 1`/`warehouseId: 1` in `POSScreen.tsx`.

**Architecture Snapshot:**
1. `getAuthClaims()` in `apps/pos-frontend/src/auth.ts` (line 75) already decodes `{ tenantId, branchIds }` from the JWT client-side — the exact input this picker needs.
2. `branchInScope()` in `pos.routes.ts` (lines 30-33) is the server-side enforcement this UI must respect, not bypass.
3. pos-frontend has no Zustand/Redux (unlike web-frontend) — use plain `localStorage`, matching `auth.ts`'s existing convention, not a new state library.
4. Warehouse selection has no existing UI precedent anywhere in this codebase — the pragmatic default is auto-select when a branch has exactly one warehouse, only prompt when it has more than one.
5. This package overlaps in scope/timing with PG-050 (shift UI) at the login-flow insertion point — see the explicit sequencing note in this file's Architecture section for who should own the picker if both are worked on around the same time.

**Completed Components:** OFFLINE-01's branch-isolation guard (backend, unchanged by this package). web-frontend's `BranchSwitcher.tsx`/`branch.store.ts` (reference pattern only, not reused code — different app, different state-management convention).

**Pending Components:** Warehouse-list backend endpoint, if verified missing during implementation — scoped small, not a warehouse-management feature. Mid-shift branch-switching UX is a nice-to-have described in Frontend section but not a hard requirement for closing this gap.

**Known Constraints:** No live DB in some recent sessions (see `es24_no_live_db_available` memory) — verify DB/API connectivity before assuming the warehouse-list check can be confirmed against real data.

**Coding Standards:** See "Coding Standards" section above — reuses `authFetch`/`getAuthClaims`/localStorage convention; deliberately does not introduce Zustand into pos-frontend despite web-frontend using it for the equivalent feature (see Architecture's reasoning).

**Reusable Components:** `getAuthClaims()`, `authFetch()` (`auth.ts`), `POSButton`/`POSCard` (`components/pos/`), `GET /branches` (`apps/tenant-service`, already called by web-frontend's `branchApi.list`).

**APIs Already Available:** `GET /branches` (tenant-service). `POST /pos/sessions/open` and `POST /pos/sales` already accept and validate `branchId`/`warehouseId` — no change needed there, just correct values now flowing in.

**Events Already Available:** None relevant to this package.

**Shared Utilities:** Not applicable beyond what's already used in pos-frontend.

**Feature Flags:** Not applicable — core correctness fix, not opt-in.

**Multi-Tenant Rules:** The picker must only ever offer branches in the user's own JWT `branchIds`; server-side `branchInScope()` remains the authoritative check regardless.

**Security Rules:** No new permission constant needed — reuses whatever gates `GET /branches` today (currently ungated server-side, a known separate issue tracked as PG-013, not this package's fix).

**Database State:** No schema change — `branchId`/`warehouseId` columns already exist everywhere needed.

**Testing Status:** No pos-frontend test currently exercises branch selection (it doesn't exist yet). `crossCutting.test.tsx` exists and is the natural place to extend for payload-correctness assertions once the picker replaces the hardcoded values.

**Next Session Plan:** Single session is sufficient — S complexity, narrowly scoped, no schema work.

**Prompt for the Next Session:** "Read `ERP-PLANNING/production-gap-prompts/013-POS/47-pos-branch-picker-ui.md` in full. Check whether PG-050 (shift/cash-drawer UI) has already shipped an inline branch picker — if so, replace it with the fuller `BranchSelectScreen` described here and have PG-050's `ShiftOpenScreen` consume this package's persisted branch/warehouse state instead of prompting separately. Verify whether a warehouse-list endpoint already exists before adding one. Build `BranchSelectScreen.tsx`, wire it into `main.tsx` with a `RequireBranch` guard modeled on the existing `RequireAuth` pattern, and replace every hardcoded `branchId: 1`/`warehouseId: 1` in `POSScreen.tsx` (lines 488-489, 598, 648, 655) with the persisted selection."
