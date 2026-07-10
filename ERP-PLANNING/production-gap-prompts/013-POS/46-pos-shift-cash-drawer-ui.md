# [PG-050] POS shift / cash-drawer frontend UI

> Template version 1.0. Every gap-prompt file in this tree must follow this exact section order. Do not add sections; do not omit sections that apply. If a section genuinely does not apply to this gap, write "Not applicable — <one-line reason>" instead of deleting it, so the structure stays diffable across files.

**Category:** POS
**Priority:** High
**Complexity:** M — no schema or business-logic work (fully built server-side); the work is entirely new screens/flows plus wiring a hardcoded value to real state.
**Depends on:** none (PG-051's branch-picker is a natural companion but not a hard prerequisite — see Architecture note below)
**Blocks:** none
**Primary service(s)/package(s):** apps/pos-frontend (all new work); apps/sales-service (read-only — no backend change needed, endpoints already exist)

---

## Overview

- **Business objective:** every POS session in this system today runs against `sessionId = 1`, a literal hardcoded constant in the frontend (`apps/pos-frontend/src/POSScreen.tsx:98`, `const [sessionId] = useState(1)`). The backend's shift/cash-drawer model (open with a starting cash float, close with a counted-cash variance check, session summary) is fully implemented and correct — it's simply unreachable. In practice this means: no cashier ever declares an opening float, no one ever reconciles the till at end of day, and every sale silently posts against session id 1 regardless of which physical till or which cashier is actually working. For a retail business, end-of-day cash reconciliation is a basic control — its absence is a real audit/loss-prevention gap, not a cosmetic one.
- **Current implementation:** Backend — `apps/sales-service/src/api/pos.routes.ts`: `POST /pos/sessions/open` (lines 119-146, `OpenSessionSchema` requires `branchId`, `warehouseId`, `openingCash`), `POST /pos/sessions/:id/close` (lines 149-179, `CloseSessionSchema` requires `closingCash`, computes `expectedCash = openingCash + totalSales` and `cashVariance = closingCash - expectedCash` server-side), `GET /pos/sessions/:id/summary` (lines 182-194, returns the full session row). All three are gated by `requirePermission(PERMISSIONS.POS_MANAGE)`. The `posSessions` Drizzle table (`packages/db-client/src/schema/sales.ts:218-243`) already has every column this needs: `status` ('OPEN'/'CLOSED'), `openingCash`, `closingCash`, `expectedCash`, `cashVariance`, `totalSales`, `totalTransactions`, `openedBy`, `closedBy`, `openedAt`, `closedAt`. `POST /pos/sales` (line 197) already validates `sessionId` refers to an `OPEN` session (lines 213-222, returns `400 NO_OPEN_SESSION` otherwise) and increments `totalSales`/`totalTransactions` on that session (lines 354-361) on every sale. Frontend — `POSScreen.tsx:98` hardcodes `sessionId` to `1` and never calls any of the three session endpoints; there is no shift-open screen, no shift-close screen, no summary view, anywhere in `apps/pos-frontend/src`.
- **Current architecture:** pos-frontend is a 3-route React SPA (`apps/pos-frontend/src/main.tsx`): `/login` (`LoginScreen.tsx`), `/` and `*` (`POSScreen.tsx`, wrapped in a `RequireAuth` guard that only checks `getAccessToken()`), and `/lookup` (`LookupScreen.tsx`). There is no concept of "does this user have an open session" anywhere in the routing or component tree. Auth/session-adjacent state is plain `localStorage` + module-level functions in `apps/pos-frontend/src/auth.ts` (no Redux/Zustand in this app, unlike web-frontend) — `getAccessToken()`, `getAuthClaims()` (decodes the JWT for `tenantId`/`branchIds`), `authFetch()` (attaches bearer token, handles 401-refresh). Offline/reference data lives in Dexie (`apps/pos-frontend/src/db.ts`), which is the wrong layer for shift state — a shift is an online, server-authoritative concept (cash counted at a physical till, reconciled against server-recorded sales), not offline-cached reference data.
- **Current limitations:** No frontend code anywhere calls `/pos/sessions/open`, `/pos/sessions/:id/close`, or `/pos/sessions/:id/summary`. `sessionId` is a `useState(1)` that is never read from or written to any persistent store, so even if a cashier's browser were closed and reopened, there'd be no way to know which (if any) session is "theirs." `branchId: 1` / `warehouseId: 1` are separately hardcoded at `POSScreen.tsx:488-489`, `598`, `648`, `655` — those are shift-open's own required inputs and are covered by PG-051 (branch-picker), not duplicated here, but this package's shift-open screen needs *a* branchId/warehouseId to submit, so it either depends on PG-051 shipping first or (more practically, see Architecture below) carries its own minimal branch/warehouse selection inline until PG-051 lands.

## Existing Code Analysis

- **What already exists and should be reused:** All three backend endpoints, unchanged. `authFetch()` from `apps/pos-frontend/src/auth.ts` for every new API call (matches how `ReceiptOverlay.tsx` and `POSScreen.tsx` already call `SALES_API` endpoints). `getAuthClaims()` (auth.ts line 75) already decodes `tenantId` and `branchIds` from the JWT — reuse for shift-open's branch selection instead of adding a second JWT-decode path. `POSButton`/`POSInput`/`POSDialog`/`POSCard` components in `apps/pos-frontend/src/components/pos/` for visual consistency (every existing POS screen uses these, not raw HTML inputs). The `localStorage`-based persistence pattern already used by `auth.ts` (`ACCESS_TOKEN_KEY`/`REFRESH_TOKEN_KEY` constants) and by `ReceiptOverlay.tsx` (`pos_paper_size` key) — the active `sessionId` should be persisted the same way (a `pos_session_id` localStorage key), not via a new state-management library. This app deliberately has no Zustand/Redux; introducing one just for session state would be exactly the kind of "new pattern for a single use" this repo's guidelines warn against — plain localStorage + a small React context (or even just prop-drilling from `main.tsx`, given the app's small size) is proportionate.
- **What should never be modified:** `POST /pos/sales`'s existing `NO_OPEN_SESSION` check (lines 213-222) — that's the correct server-side guard this UI work is finally making reachable; do not relax or bypass it from the frontend. The `posSessions` table schema — every column this package needs already exists, no migration required. `PaymentService`/`InvoiceService`/`LoyaltyService` domain logic in sales-service — entirely out of scope.
- **Prior related work:** OFFLINE-01 through OFFLINE-07 (see project memory) built pos-frontend's offline sync, token-refresh, and branch-isolation-guard work, but none of them touched shift/session UI — `sessionId` was already hardcoded to `1` before, during, and after all of that work, confirmed by grep (only test files and this one `useState(1)` reference it). No completion report in `ERP-PLANNING/phase-completions/` covers shift UI.

## Architecture

- **New flow, inserted between login and the POS screen:** `LoginScreen` → (if no active OPEN session for this user) → **ShiftOpenScreen** (declare opening cash float) → `POSScreen` (unchanged sale flow) → (cashier-initiated) **ShiftCloseScreen** (count closing cash, see variance) → **ShiftSummaryScreen** (read-only recap, "Start new shift" or logout).
- This requires **one new backend endpoint** the current API surface doesn't have: a way to ask "does the current user already have an open session?" Today the only way to find a session is by numeric `:id`, which the frontend has no way to know after a page reload. Add `GET /pos/sessions/active` (tenant + `openedBy = req.auth.userId` + `status = 'OPEN'`, most-recent-first, same `requirePermission(PERMISSIONS.POS_MANAGE)` guard as the other three routes) to `pos.routes.ts`. This is a small, additive read endpoint following the exact same query pattern already used in the file (`and(eq(...), eq(...))` via Drizzle) — not a new architectural pattern.
- **Routing:** add `/shift/open`, `/shift/close`, `/shift/summary` routes to `main.tsx`, each wrapped in the existing `RequireAuth` guard. Add a second guard, `RequireSession`, alongside the existing `RequireAuth` in `main.tsx`: on mount, call `GET /pos/sessions/active`; if none found, redirect to `/shift/open`; if found, store its `id` (see below) and render the requested route. This mirrors the existing `RequireAuth` pattern exactly (a thin wrapper component checking one condition before rendering `children`) rather than inventing a different guard style.
- **Session-id persistence:** on successful `POST /pos/sessions/open`, store the returned `id` in `localStorage` under a new `pos_session_id` key (same pattern as `auth.ts`'s token keys), and read it back into `POSScreen.tsx`'s `sessionId` state in place of the current `useState(1)`. On `POST /pos/sessions/:id/close` success, clear that key.
- **Branch/warehouse for shift-open:** if PG-051 (branch-picker) has already shipped, ShiftOpenScreen reuses whatever branch-selection state PG-051 introduces (do not build a second one). If this package ships first, ShiftOpenScreen includes its own minimal inline branch/warehouse `<select>` (populated from `getAuthClaims().branchIds`, calling the same `tenant`-service branch-list endpoint web-frontend's `BranchSwitcher.tsx` already calls) — sized as a small, deliberately temporary piece of this package's own scope, not a parallel branch-picker feature to maintain long-term. Whichever package lands second should collapse the two into one.
- **No saga/outbox/Kafka event is introduced.** Shift open/close is a single-service, single-transaction operation today (confirmed: no `outbox_events` write, no Kafka publish anywhere in `pos.routes.ts`'s session handlers) — this package doesn't change that. If a future package wants shift-close to post an accounting journal entry for cash variance, that's a separate, explicitly-scoped addition, not silently bundled into this UI package.

## Database Changes

Not applicable — no schema change. Every column `ShiftOpenScreen`/`ShiftCloseScreen`/`ShiftSummaryScreen` need already exists on `posSessions` (`packages/db-client/src/schema/sales.ts:218-243`).

## Backend

- **New route:** `GET /pos/sessions/active` in `apps/sales-service/src/api/pos.routes.ts`, alongside the existing three session routes. Handler: `requirePermission(PERMISSIONS.POS_MANAGE)` preHandler (matches the other three); query `posSessions` where `tenantId = req.auth.tenantId AND openedBy = req.auth.userId AND status = 'OPEN'`, order by `openedAt` desc, limit 1; return `{ data: session ?? null }` (200 either way — "no active session" is a normal state, not an error, matching this file's existing convention of `sendError` only for genuine failure states).
- No change to `POST /pos/sessions/open`, `POST /pos/sessions/:id/close`, `GET /pos/sessions/:id/summary`, or `POST /pos/sales` — all three already do exactly what this frontend work needs.
- **Validation:** the new endpoint needs no request body (query is entirely derived from `req.auth`), so no new Zod schema beyond what's already imported in the file.
- **Authorization:** reuses `PERMISSIONS.POS_MANAGE` — the same constant every other session route already checks. **Flag, don't silently use, the following inconsistency found during this audit:** `packages/shared-types/src/permissions.ts` (and its hand-mirrored copy `apps/web-frontend/src/constants/permissions.ts`) already declare `POS_OPEN_SHIFT`, `POS_CLOSE_SHIFT`, and `POS_CASH_DRAWER` as distinct permission constants (lines 124-128), but grep across the entire repo shows **zero call sites** for any of the three — no backend route checks them, no frontend `PermissionGate` references them. They are dead constants, the same "declared but never wired" pattern already documented for other permissions (see project memory `rbac_dead_permission_constant_pattern`). This package deliberately does **not** wire the new shift screens to those granular constants, because doing so would require also changing the three *existing, already-shipped* backend routes' `requirePermission(PERMISSIONS.POS_MANAGE)` checks to match — a backend RBAC change that's out of scope for a frontend-UI package and would risk locking out any role currently granted `POS_MANAGE` but not the newer granular constants. Recommendation: file a follow-up RBAC-remediation item (same shape as PG-014) to either wire up or delete `POS_OPEN_SHIFT`/`POS_CLOSE_SHIFT`/`POS_CASH_DRAWER`, decided independently of this package.
- **Idempotency:** not applicable in the OFFLINE-02 `operationId` sense — shift open/close are online-only, deliberate, infrequent actions (once or twice per cashier per day), not high-frequency offline-queued operations.
- **Audit logging/telemetry:** no new Prometheus counter or OTel span is strictly required (session open/close is low-frequency and already durably recorded via the `posSessions` row itself, which is a de facto audit trail with `openedBy`/`closedBy`/timestamps) — do not add telemetry infrastructure that wasn't asked for.

## Frontend

- **New screens (all in `apps/pos-frontend/src/`, following the existing top-level-screen convention like `LoginScreen.tsx`/`LookupScreen.tsx`, not nested under `components/pos/`):**
  - `ShiftOpenScreen.tsx` — form: opening cash amount (`POSInput`, numeric), branch/warehouse selector (see Architecture note on PG-051 overlap), submit button (`POSButton`) calling `POST /pos/sessions/open`; on success, persist `pos_session_id` to localStorage and navigate to `/`.
  - `ShiftCloseScreen.tsx` — reachable from a new "End Shift" action (e.g. a button in `POSScreen.tsx`'s existing header alongside the theme toggle/sync-status icons, not a new nav system). Fetches the current session's `expectedCash` context (either from a client-side running total or by calling `GET /pos/sessions/:id/summary` first), form: closing cash counted (`POSInput`), calls `POST /pos/sessions/:id/close`; on success, clear `pos_session_id` and navigate to `/shift/summary`.
  - `ShiftSummaryScreen.tsx` — read-only recap of the just-closed session (`expectedCash`, `closingCash`, `cashVariance`, `totalSales`, `totalTransactions`, opened/closed timestamps) rendered via existing `POSCard`, with a "Start New Shift" button that navigates to `/shift/open` and a "Logout" option.
- **`POSScreen.tsx` changes:** replace `const [sessionId] = useState(1)` (line 98) with a value read from `localStorage.getItem('pos_session_id')` (via a small helper, e.g. a `useActiveSession()` hook colocated with `auth.ts`'s existing helpers) — if absent, the `RequireSession` route guard (see Architecture) should already have redirected away from this screen before it renders, so `POSScreen` itself can trust the value is present once mounted rather than re-implementing the check.
- **State management:** plain `localStorage` + component state, matching this app's existing pattern (no Zustand/Redux introduced — see Architecture note above on why that would be disproportionate for this app's size).
- **Permission gating:** the new routes should be reachable by any authenticated POS user with `POS_MANAGE` (matching backend enforcement) — do not gate the frontend route on the dead `POS_OPEN_SHIFT`/`POS_CLOSE_SHIFT` constants (see Backend section) since the backend doesn't check them; a frontend gate on a permission the backend ignores would just be misleading UI, not real protection.
- **Accessibility:** follow the same `aria-label`/focus-management conventions already present in `ReceiptOverlay.tsx` and `POSDialog.tsx` (this app has an established axe-core test harness per project memory — new screens should be added to that harness's coverage, not exempted).
- **Responsive behavior:** pos-frontend targets a fixed in-store till/tablet viewport (not phone-responsive) — matches every other existing POS screen's assumption, no new responsive work needed beyond what `POSInput`/`POSButton` already provide.

## API Contract

- `GET /pos/sessions/active` (**new**) — Request: none (auth via bearer token). Response `200`: `{ data: { id: number, sessionNumber: string, branchId: number, warehouseId: number, status: 'OPEN', openingCash: string, totalSales: string, totalTransactions: number, openedAt: string } | null }`. No error codes beyond the standard `401`/`403` auth failures.
- `POST /pos/sessions/open` (**existing, unchanged**) — Request: `{ branchId: number, warehouseId: number, openingCash: number }`. Response `201`: `{ data: { id: number, sessionNumber: string } }`. Errors: `403 BRANCH_ACCESS_DENIED`.
- `POST /pos/sessions/:id/close` (**existing, unchanged**) — Request: `{ closingCash: number }`. Response `200`: `{ data: { expectedCash: number, cashVariance: number } }`. Errors: `404 NOT_FOUND`.
- `GET /pos/sessions/:id/summary` (**existing, unchanged**) — Response `200`: `{ data: <full posSessions row> }`. Errors: `404 NOT_FOUND`.

## Multi-Tenant Considerations

- `GET /pos/sessions/active` filters by `tenantId` (from `req.auth.tenantId`, never client-supplied) exactly like the three existing session routes — no new isolation pattern.
- Branch isolation: `POST /pos/sessions/open` already calls `branchInScope()` (pos.routes.ts line 30-33) to reject a `branchId` outside the caller's JWT `branchIds` — this package's ShiftOpenScreen must only offer branches the user actually has access to (from `getAuthClaims().branchIds`), so a cashier is never shown a branch selection that the backend would reject anyway.
- No feature-flag gating is needed — this is core POS functionality, not an opt-in feature.

## Integration

- **apps/pos-frontend:** all new screens/routes/state described above.
- **apps/sales-service:** one new read-only route (`GET /pos/sessions/active`); no other backend service is touched (no accounting-service journal posting for cash variance in this pass — explicitly deferred, see Architecture).
- **apps/tenant-service:** ShiftOpenScreen's branch/warehouse selector reads from the same `GET /branches` endpoint web-frontend's `BranchSwitcher.tsx` already calls (`apps/tenant-service/src/api/branch.routes.ts`) — reused, not duplicated. Note: FEATURE_INVENTORY §8 flags `GET /branches` as currently missing a backend permission check (a known, separate issue tracked as PG-013) — this package's frontend call to that endpoint is unaffected by that gap either way, but it's worth being aware the endpoint's own auth is a pending fix elsewhere, not something to "discover" as new during this package's implementation.

## Coding Standards

Reuses Fastify + Zod + `requirePermission()` for the one new backend route (matches every other route in `pos.routes.ts`). Reuses `authFetch()`, `POSButton`/`POSInput`/`POSCard`/`POSDialog`, and the existing `localStorage`-based persistence convention on the frontend — no new state-management library, no new HTTP-client wrapper. `@erp/logger` is already used service-wide in sales-service; no new logging pattern needed for one additive read route.

## Performance

Not applicable beyond what already exists — `GET /pos/sessions/active` is a single indexed lookup (the `posSessions` table already has `idx_pos_sessions_tenant_status` and `idx_pos_sessions_branch` indexes per the schema, lines 241-243 of `sales.ts`) called once per app load/session-guard check, not a hot path.

## Security

- RBAC: `POS_MANAGE` on the new route, matching the three existing session routes — no weakening of the existing permission model.
- The dead `POS_OPEN_SHIFT`/`POS_CLOSE_SHIFT`/`POS_CASH_DRAWER` constants are flagged above as a known pre-existing RBAC-granularity gap, explicitly not fixed by this package (see Backend section's reasoning).
- Audit: the `posSessions` row itself (`openedBy`, `closedBy`, timestamps, cash amounts) already serves as a durable audit record once this UI makes it reachable — no additional audit-log table write is needed for this package's scope.
- Input validation: `openingCash`/`closingCash` are already validated server-side as non-negative numbers (`OpenSessionSchema`/`CloseSessionSchema`) — the frontend forms should mirror those constraints (numeric, non-negative) for good UX but the server remains the source of truth.

## Testing

- **Backend:** add a test for `GET /pos/sessions/active` to `apps/sales-service/src/__tests__/` (wherever the existing POS-route tests live, or a new `pos-sessions.test.ts`) covering: returns the most recent OPEN session for the caller, returns `null` when none exists, never returns another tenant's or another user's session.
- **Frontend:** new test files `apps/pos-frontend/src/__tests__/ShiftOpenScreen.test.tsx`, `ShiftCloseScreen.test.tsx`, `ShiftSummaryScreen.test.tsx` following this app's existing RTL+vitest convention (see `LookupScreen.test.tsx` for the established pattern). Extend `apps/pos-frontend/src/__tests__/crossCutting.test.tsx` (which already exercises `queueSale`) with a case confirming `POSScreen` reads `sessionId` from the persisted value rather than a hardcoded constant.
- **E2E:** if pos-frontend has Playwright coverage (check before assuming), add a shift-open → sale → shift-close → summary happy-path flow; otherwise note this as a gap for PG-054 (E2E coverage expansion) rather than building a new E2E harness inside this package.

## Acceptance Criteria

- [ ] `sessionId` in `POSScreen.tsx` is no longer a hardcoded `useState(1)` — verifiable by reading the file and confirming the constant is gone.
- [ ] A cashier with no open session is redirected to `/shift/open` before reaching `POSScreen` — verifiable by clearing `pos_session_id` from localStorage and reloading the app.
- [ ] `POST /pos/sessions/open` is reachable from the UI and a real row appears in `pos_sessions` with the entered `openingCash` — verifiable by a DB query after submitting the form.
- [ ] `POST /pos/sessions/:id/close` is reachable from the UI, and the displayed variance in `ShiftSummaryScreen` matches `closingCash - (openingCash + totalSales)` computed server-side — verifiable by comparing the UI's displayed number to the API response.
- [ ] `GET /pos/sessions/active` returns `null` for a user with no open session and the correct row for one with an open session — verifiable via a direct API call/test.
- [ ] No sale can be completed without an active session — this is already true server-side (`NO_OPEN_SESSION` check); verify the frontend now surfaces that state gracefully instead of the sale simply failing with an opaque error.

## Deliverables

- **Files to create:** `apps/pos-frontend/src/ShiftOpenScreen.tsx`, `ShiftCloseScreen.tsx`, `ShiftSummaryScreen.tsx`; a small `useActiveSession` helper (colocated in `auth.ts` or a new `session.ts`); test files listed above.
- **Files to modify:** `apps/pos-frontend/src/main.tsx` (new routes + `RequireSession` guard), `apps/pos-frontend/src/POSScreen.tsx` (remove hardcoded `sessionId`, add "End Shift" action), `apps/sales-service/src/api/pos.routes.ts` (new `GET /pos/sessions/active` route).
- **Migrations:** none.
- **APIs added/changed:** `GET /pos/sessions/active` (new); no changes to existing session/sale endpoints.
- **Events added/changed:** none.
- **Tests added:** backend `pos-sessions.test.ts` (or equivalent); frontend `ShiftOpenScreen.test.tsx`, `ShiftCloseScreen.test.tsx`, `ShiftSummaryScreen.test.tsx`; extended `crossCutting.test.tsx` coverage.

---

## Context Preservation (for a fresh AI session with no prior history)

**Previous Work Summary:** pos-frontend is a fully working offline-capable POS SPA (cart, discounts, split payments, loyalty, held sales, barcode scan, receipt print/resend, OFFLINE-01 through OFFLINE-07 sync work). The one glaring gap: shift/cash-drawer management is 100% built server-side (`apps/sales-service/src/api/pos.routes.ts`) but has zero frontend entry point — every sale runs against `sessionId = 1`, a literal hardcoded value at `POSScreen.tsx:98`.

**Current Objective:** Build the missing frontend shift-open/shift-close/shift-summary flow, add the one missing backend endpoint needed to make it work after a page reload (`GET /pos/sessions/active`), and remove the hardcoded `sessionId`.

**Architecture Snapshot:**
1. Backend session endpoints already exist and are correct: `POST /pos/sessions/open`, `POST /pos/sessions/:id/close`, `GET /pos/sessions/:id/summary`, all in `pos.routes.ts`, all gated by `PERMISSIONS.POS_MANAGE`.
2. `posSessions` Drizzle table (`packages/db-client/src/schema/sales.ts:218-243`) already has every column needed — no migration required.
3. pos-frontend has no Zustand/Redux — state is plain React state + `localStorage`, managed via `apps/pos-frontend/src/auth.ts`'s existing pattern. Follow that pattern for session persistence (`pos_session_id` key), don't introduce a new state library.
4. pos-frontend is a tiny 3-route SPA (`main.tsx`) — adding 3 more routes plus a `RequireSession` guard (modeled directly on the existing `RequireAuth` guard) is the right scale of change.
5. `branchId`/`warehouseId` are separately hardcoded to `1` elsewhere in `POSScreen.tsx` — that's PG-051's scope (branch-picker), not this package's, though ShiftOpenScreen needs *some* branch/warehouse input and should coordinate with whichever of PG-050/PG-051 ships first (see Architecture section's explicit note).

**Completed Components:** OFFLINE-01 through OFFLINE-07 (token refresh, sale idempotency, held sales/customer offline, stock-conflict resolution) — all unrelated to shift UI and must not be touched.

**Pending Components:** Any accounting-service integration for cash-variance journal entries is explicitly NOT part of this package — shift close today only records the variance on the `posSessions` row itself, no Kafka event, no outbox write; adding that would be a separate, explicitly-scoped package.

**Known Constraints:** No live DB was available in some recent sessions (see project memory `es24_no_live_db_available`) — re-verify DB connectivity before assuming migration/query testing can run end-to-end; this package needs no migration but does need a live Postgres to test the new `GET /pos/sessions/active` route against real data.

**Coding Standards:** See "Coding Standards" section above — Fastify/Zod/`requirePermission` on the one new backend route; `POSButton`/`POSInput`/`POSCard`/`POSDialog` + plain localStorage state on the frontend, matching every existing pos-frontend screen.

**Reusable Components:** `authFetch()`, `getAuthClaims()` (`auth.ts`), `POSButton`/`POSInput`/`POSCard`/`POSDialog` (`components/pos/`), the `RequireAuth` route-guard pattern in `main.tsx`.

**APIs Already Available:** `POST /pos/sessions/open`, `POST /pos/sessions/:id/close`, `GET /pos/sessions/:id/summary` — all pre-existing and correct, call them as-is.

**Events Already Available:** None relevant — shift open/close does not currently publish any Kafka event, and this package doesn't add one.

**Shared Utilities:** `@erp/logger` (backend only, already used in `pos.routes.ts`).

**Feature Flags:** Not applicable — core functionality, not opt-in.

**Multi-Tenant Rules:** `GET /pos/sessions/active` must filter by `tenantId` from `req.auth`, never a client-supplied value — matches every other route in this file.

**Security Rules:** `PERMISSIONS.POS_MANAGE` on the new route (matching the existing three). Note the dead `POS_OPEN_SHIFT`/`POS_CLOSE_SHIFT`/`POS_CASH_DRAWER` constants in `packages/shared-types/src/permissions.ts` (lines 124-128) are NOT wired to anything and this package deliberately does not wire them either — that's a separate RBAC-remediation decision, not this package's call to make unilaterally.

**Database State:** `posSessions` table fully migrated and in use already (it's how `POST /pos/sales` validates an open session today, even with the hardcoded `sessionId = 1`).

**Testing Status:** No frontend test currently exercises shift open/close (they don't exist yet). Backend `pos.routes.ts` session handlers have no dedicated test file found during this audit — check `apps/sales-service/src/__tests__/` for POS-route coverage before assuming none exists, and add to whichever file already covers `/pos/sessions/*` if one is found.

**Next Session Plan:** Single session is sufficient — this is an M-complexity, additive-only UI package with no schema or cross-service work.

**Prompt for the Next Session:** "Read `ERP-PLANNING/production-gap-prompts/013-POS/46-pos-shift-cash-drawer-ui.md` in full. Implement the new `GET /pos/sessions/active` route in `apps/sales-service/src/api/pos.routes.ts`, then build `ShiftOpenScreen.tsx`, `ShiftCloseScreen.tsx`, and `ShiftSummaryScreen.tsx` in `apps/pos-frontend/src/`, wire them into `main.tsx` with a `RequireSession` guard modeled on the existing `RequireAuth` guard, and remove the hardcoded `sessionId` from `POSScreen.tsx:98`. Check whether PG-051 (branch-picker) has already shipped before deciding whether ShiftOpenScreen needs its own inline branch selector or can reuse PG-051's."
