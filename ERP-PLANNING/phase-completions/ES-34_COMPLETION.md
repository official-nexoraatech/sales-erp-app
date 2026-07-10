# ES-34 Completion Report — RBAC Audit Phase B: Login Redirect & Access UX
**Date:** 2026-07-04
**Status:** COMPLETE

## What Was Done

### 1–2. Shared navigation module + login/index redirect
- New `apps/web-frontend/src/lib/navigation.ts`: `NAV_GROUPS`, `NavItem`/`NavGroup` types,
  `filterNavItem`, `filterNavGroups` (moved verbatim out of `Layout.tsx`), plus new
  `getFirstAccessiblePath(groups, hasPermission): string | null`.
- `Layout.tsx` now imports this shared module instead of defining its own copy — removed
  ~190 lines of duplicated nav config/logic and the icon imports that moved with it.
- `LoginPage.tsx`'s `completeLogin()`: after `setUser(...)`, computes
  `getFirstAccessiblePath(NAV_GROUPS, hasPermission)` and navigates there, falling back to
  `/no-access` if the user has no accessible module.
- `App.tsx`'s index route (`/`) now renders a new `IndexRedirect` component doing the same
  computation, instead of an unconditional `<Navigate to="/dashboard" />`.

**Edge case caught by testing:** the first draft of `getFirstAccessiblePath` treated
"Security Settings" (a nav item with no `permission` field, intentionally visible to every
logged-in user) as an always-accessible destination — meaning a genuinely zero-permission
user would land on `/security` instead of `/no-access`. Fixed: the function now only
considers permission-gated leaves for the landing-page/no-access decision; a
permission-less item is a personal utility page, not "a module the user was granted."
Caught by the new unit test `returns null when the user has no permissions at all` before
this shipped.

### 3. "No Modules Assigned" page
New `apps/web-frontend/src/pages/NoModulesAssignedPage.tsx`, same `ERPEmptyState` pattern
as `NotFoundPage.tsx` (reusing the existing `type="no-access"` preset), with a "Log out"
action. Routed at `/no-access` inside the authenticated `Layout` shell.

### 4. Stale permissions after token refresh
`apps/web-frontend/src/api/client.ts`'s `performRefresh()` now re-decodes the refreshed
access token's JWT payload and calls `setUser({ ...user, roles, permissions })`, mirroring
what `completeLogin()` already does at initial login. Wrapped in try/catch — a malformed
payload keeps the previous permissions rather than breaking the refresh flow.

### 5. `/security` route — confirmed intentional, not a gap
Read `SecuritySettingsPage.tsx`: it manages only the current user's own MFA enrollment and
their own active sessions, no tenant-wide configuration. Being reachable by any logged-in
user regardless of RBAC permissions is correct. No change made; documented so this isn't
re-flagged as a gap in a future audit pass.

### 6. `WAREHOUSE_MANAGE` vs. fine-grained inventory permissions — investigated, deferred
Found two separate generations of stock permission constants in `permissions.ts`:
`STOCK_TRANSFER`/`STOCK_ADJUST`/`STOCK_ADJUST_APPROVE` (assigned to `INVENTORY_MANAGER` in
`role-defaults.ts`, but never checked by any backend route) and
`STOCK_TRANSFER_VIEW`/`STOCK_ADJUSTMENT_VIEW`/`STOCK_ADJUSTMENT_MANAGE`/
`PHYSICAL_VERIFICATION_VIEW` (defined, wired to nothing). Every backend route in
`transfer.routes.ts`, `adjustment.routes.ts`, and `physical-verification.routes.ts` checks
only `WAREHOUSE_MANAGE` — which `INVENTORY_MANAGER` doesn't even hold, only `OWNER`/`ADMIN`.
**Pre-existing functional gap, not introduced by this phase:** the role literally named
"Inventory Manager" cannot use stock transfers, adjustments, or physical verification
today. Swapping only the frontend nav/route permission (as originally planned) without
also fixing backend route guards and role-default assignments would have hidden the nav
item from users who currently *do* have access via `WAREHOUSE_MANAGE`, while still leaving
`INVENTORY_MANAGER` blocked. Reverted the frontend swap back to `WAREHOUSE_MANAGE` (no
behavior change) and carried this forward as a concrete finding for ES-35 (Phase C), where
the grep-verify-before-consolidate process for duplicate permission constants already
applies.

## Files Changed

| File | Change |
|------|--------|
| `apps/web-frontend/src/lib/navigation.ts` | New file |
| `apps/web-frontend/src/components/Layout.tsx` | Imports nav config/helpers from `lib/navigation.js` |
| `apps/web-frontend/src/pages/auth/LoginPage.tsx` | Redirects to first accessible path, not hardcoded `/dashboard` |
| `apps/web-frontend/src/App.tsx` | New `IndexRedirect`; added `/no-access` route |
| `apps/web-frontend/src/pages/NoModulesAssignedPage.tsx` | New file |
| `apps/web-frontend/src/api/client.ts` | `performRefresh()` re-decodes and re-applies JWT permissions |

## New Test Files

| File | Tests |
|------|-------|
| `apps/web-frontend/src/lib/__tests__/navigation.test.ts` | 6: no-permission → null, DASHBOARD_VIEW → `/dashboard`, skips inaccessible earlier groups, drills into nested children, skips fully-inaccessible parent, `filterNavGroups` drops empty groups |

## Test Results

**6/6 new tests pass** (1 initially failed on first run, catching the Security Settings
edge case above — fixed before completion). Full web-frontend suite: **15/15 pass** (9
pre-existing + 6 new), no regressions. `pnpm type-check` clean.

**Lint:** fixed one new finding introduced by this phase (`navigation.ts` used
`React.ComponentType` with no import — replaced with
`import type { ComponentType } from 'react'`). All remaining lint output (1132
problems/251 errors) is pre-existing missing-ESLint-globals debt
(`fetch`/`atob`/`localStorage`/`HTMLInputElement`/`RequestInit` as `no-undef`, plus
widespread `explicit-function-return-type` warnings) — confirmed present in files this
phase didn't touch.

## Deployment Checklist

No database migrations, no environment variable changes — frontend-only routing/UX change.

- [x] `pnpm --filter @erp/web-frontend type-check` clean
- [x] 15/15 tests pass
- [x] Manually reasoned through 3 landing scenarios via unit tests (full-access,
      single-module, zero-permission) — no live multi-role login environment was available
      in this session to click through manually; recommend a manual pass with real test
      users before this reaches production

## Phases Unblocked

ES-35 (Phase C, now carrying the `WAREHOUSE_MANAGE`/fine-grained stock permission
duplication as a concrete finding), ES-31, ES-32.
