# RBAC Architecture

**Status as of:** 2026-07-04, after the 5-phase Enterprise RBAC Audit (ES-33 through
ES-37). This document replaces the stale RBAC claims in `TECH_AUDIT.md` (§15, which only
claimed route-level frontend guarding — see ES-37 for how far past that this now goes) and
supersedes ES-07's narrower "add 7 backend permissions" scope as the canonical description
of how authorization works in this codebase.

---

## 1. Model

- **296 backend permission constants** (`packages/shared-types/src/permissions.ts`), flat
  strings grouped by domain via comments (not a typed hierarchy). Mirrored on the frontend
  in `apps/web-frontend/src/constants/permissions.ts` — **these two files must be kept in
  sync by hand**; ES-35/ES-37 found and fixed 6+ cases where a backend permission had no
  frontend mirror at all (`CUSTOMER_DELETE`, `QUOTATION_CONVERT`, `PO_CANCEL`,
  `ITEM_DELETE`, full `CATEGORY_*`/`BRAND_*`/`UNIT_*` CRUD sets, `SUPPLIER_DELETE`). There
  is no automated check for this drift yet — see §7.
- **Roles are DB-backed and tenant-scoped**: `roles` / `userRoles` / `rolePermissions`
  tables (`packages/db-client/src/schema/auth.ts`). A user can hold multiple roles
  simultaneously (permissions union across all held roles). No role inheritance. Tenants
  can define custom roles in addition to the 13 system defaults.
- **Defaults are code, materialized once**: `apps/tenant-service/src/rbac/role-defaults.ts`
  (`ROLE_DEFAULTS`) is applied at tenant-provisioning time by `TenantProvisioner`. Changing
  `ROLE_DEFAULTS` does **not** retroactively update already-provisioned tenants — every
  fix in this audit that touched `role-defaults.ts` (see §6) needs a one-time backfill
  migration before reaching a tenant that already exists, the same way
  `0023_dashboard_view_permission_backfill.sql` did once before.
- **`OWNER`/`SUPER_ADMIN`** get literally every permission (`Object.values(PERMISSIONS)`).
  `ADMIN` gets all but 3 explicitly excluded (`FINANCIAL_YEAR_CLOSE`, `PAYROLL_PROCESS`,
  `IMPERSONATE_USER`). There is no code-level role-name bypass anywhere — "admin sees
  everything" is a pure consequence of having every permission, not a special case in the
  auth middleware.

## 2. Backend Enforcement

- **`packages/platform-sdk/src/auth.ts`** is the single shared implementation
  (`verifyAccessToken()`, `checkPermission()`, `getBranchScope()`) — consolidated in ES-35
  from 12+ near-duplicated per-service copies (one of which, `report-service`, had a fully
  hand-rolled RS256 verifier). Framework-agnostic by design (no Fastify dependency,
  matching this SDK's existing convention).
- Every service's `middleware/authenticate.ts`/`authorize.ts` is now a thin wrapper around
  the shared functions — kept per-service only because the `declare module 'fastify'`
  augmentation and Fastify request/reply typing can't live in a framework-agnostic package.
  `auth-service` is the one exception: it mints tokens (its own `jwt.ts` + signing key), a
  different concern from verification, deliberately not consolidated.
- **Pattern**: `preHandler: [authenticate, requirePermission(PERMISSIONS.X)]` (or a
  plugin-level `authenticate` hook + per-route `requirePermission`). Internal/
  service-to-service routes use `requireInternalKey()` (timing-safe `x-internal-key`
  header compare) instead of a user JWT — never mix the two on the same route.
- **A CI backstop exists**: `packages/shared-types/src/__tests__/route-guard-coverage.test.ts`
  scans every service's route files and fails if a business route has no recognizable
  guard. This directly closes the architecture audit's root-cause finding ("auth is opt-in
  per route, not framework-enforced") — it's what caught the 4 gaps fixed in ES-33/ES-35
  (gst-service, scheduler-service, notification-service, search-service, report-service,
  tenant-service). **Any new route needs a guard or a documented, reasoned exception in
  that test's `KNOWN_EXCEPTIONS` map** — it will fail CI otherwise.

## 3. Frontend Enforcement

- **Single source of truth for navigation**: `apps/web-frontend/src/lib/navigation.ts`
  (`NAV_GROUPS`, `filterNavGroups()`, `getFirstAccessiblePath()`). Both the sidebar
  (`Layout.tsx`) and the post-login/index redirect (`LoginPage.tsx`, `App.tsx`'s
  `IndexRedirect`) filter off the exact same config — no more risk of the sidebar and the
  redirect logic drifting apart (ES-34).
- **Route guards**: `App.tsx`'s `PermissionRoute` wraps every page route in a specific
  permission check; `ProtectedRoute` only checks "is logged in." A route's permission is
  the *page-level* gate — it does not imply every button on that page shares the same
  permission (see §4 for why that distinction mattered).
- **Permission source of truth**: `useAuthStore` (Zustand), `hasPermission(permission)` —
  a flat array-includes check against `user.permissions`, decoded from the JWT at login
  and **re-decoded on every token refresh** (fixed in ES-34 — previously the permission
  list went stale mid-session until the user logged out and back in).
- **UI-level gating pattern** (rolled out to ~50 files in ES-37):
  ```tsx
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const canEditX = hasPermission(PERMISSIONS.X_EDIT);
  // ...
  {canEditX && <Button onClick={...}>Edit</Button>}
  ```
  Unauthorized actions are **hidden**, not disabled, matching the original requirement —
  the one documented exception is status-dependent disable+permission combos (e.g.
  `PayrollPage.tsx`'s "Approve" button: hidden without the permission, disabled until the
  record's status allows it).
- **`No Modules Assigned` page** (`NoModulesAssignedPage.tsx`, route `/no-access`): shown
  when a user's permission-filtered nav is empty, instead of the old behavior of bouncing
  a zero-permission new user into a `/dashboard` Access Denied screen right after login.

## 4. The Recurring Bug Class This Audit Found — Read Before Adding a New Permission

**Four separate times** (`CUSTOMER_UPDATE`/`CUSTOMER_EDIT`, `ITEM_UPDATE`/`ITEM_EDIT`,
`SUPPLIER_UPDATE`/`SUPPLIER_EDIT`, and a variant with `OPENING_BALANCE_LOCK` vs
`ACCOUNT_VIEW`), this audit found **two similarly-named permission constants where the
frontend route/role-default used one and the actual backend route enforced the other** —
meaning a role could reach a page or see a button, but every actual save/action 403'd.
This happened because permission names were added ad-hoc across many prior phases (ES-01
through ES-27) without a single check cross-referencing "what does the route actually
require" against "what does the frontend/role-defaults assume."

**Before adding a new permission constant or assigning one to a role**, grep the actual
`requirePermission(...)` call on the backend route the frontend action hits — don't infer
it from a similarly-named constant already in `role-defaults.ts` or `App.tsx`. This is
exactly the discipline ES-37 used to find all three additional cases; it's cheap (one grep
per action) and it's the only reliable way to avoid adding a fifth instance of this bug.

## 5. Record-Level (Branch) Scoping — Partial

- `AuthPayload`/`AccessTokenPayload` now carry `branchIds: number[]` (from the existing
  `userBranches` join table, populated at login/refresh/MFA-verify/impersonation — ES-36).
- `getBranchScope(auth): number[] | 'all'` (`@erp/sdk`) is the shared decision function:
  restricts to the caller's assigned branches, unless they hold `BRANCH_SCOPE_BYPASS`
  (only `OWNER`/`ADMIN`/`SUPER_ADMIN` by default) or have zero branch assignments (so
  single-branch tenants and not-yet-assigned users aren't locked out).
- **Demonstrated on one path only**: `sales-service`'s `GET /invoices` list route. The
  other 7 schema files with `branch_id` columns (`purchase`, `master`, `hr`, `gst`,
  `tenant`, `report`, `production`) need the same `getBranchScope()` +
  `inArray(table.branchId, scope)` treatment applied to their routes — not started.
- **RLS deliberately not enabled.** `TenantScopedDatabase.raw` (the majority of this
  codebase's query path) never sets the Postgres session GUC outside an explicit
  `.transaction()` block. Enabling `ROW LEVEL SECURITY` today would make every
  non-transactional query silently return zero rows — a live-breaking regression, not
  defense-in-depth. This is the same gap the architecture audit's **M14** finding already
  identified and deferred. **Do not add `CREATE POLICY` statements until the GUC-per-request
  plumbing is fixed** (either make `TenantScopedDatabase.raw` always run through a
  lightweight enclosing transaction, or audit/rewrite every non-transactional call site).

## 6. Known Pending Backfill Migrations (dev environment: no-op today, required before prod)

`ROLE_DEFAULTS` changes only apply to newly-provisioned tenants. This audit changed it four
times — write **one consolidated backfill migration** covering all of them before any
tenant relying on these roles reaches production:

- `SALES_MANAGER`: `CUSTOMER_UPDATE` → `CUSTOMER_EDIT` (ES-35)
- `INVENTORY_MANAGER`: `ITEM_UPDATE` → `ITEM_EDIT`; added `CATEGORY_UPDATE`,
  `CATEGORY_DELETE`, `BRAND_UPDATE`, `UNIT_UPDATE` (ES-37)
- `PURCHASE_MANAGER`: `SUPPLIER_UPDATE` → `SUPPLIER_EDIT` (ES-37)

## 7. Explicitly Deferred / Not Done — Tracked, Not Silently Dropped

- **RLS enablement** — blocked on the GUC-per-request gap (§5). Correctly a dedicated
  security-hardening phase, not a sub-task of this audit.
- **Branch-scoping rollout** beyond `sales-service`'s invoice list (§5) — the pattern is
  proven and reusable, just not applied to the other 7 branch-scoped table groups yet.
- **`WAREHOUSE_MANAGE` vs. fine-grained stock permissions** (`STOCK_TRANSFER_VIEW`,
  `STOCK_ADJUSTMENT_VIEW`, `PHYSICAL_VERIFICATION_VIEW`, plus an older generation
  `STOCK_TRANSFER`/`STOCK_ADJUST`) — `INVENTORY_MANAGER` still can't use transfers/
  adjustments/physical verification (only `OWNER`/`ADMIN` can, since the backend checks
  only `WAREHOUSE_MANAGE`). Fixing this needs route-guard rewrites across 3 route files
  plus a `role-defaults.ts` update — flagged in ES-34/ES-35, not fixed.
- **No automated frontend/backend permission-constant sync check.** The 6+ missing-mirror
  bugs in this audit were all found by hand (reading route files while gating buttons).
  Worth a follow-up: a test that diffs `packages/shared-types/src/permissions.ts` against
  `apps/web-frontend/src/constants/permissions.ts` and fails on any one-sided constant,
  the same way `route-guard-coverage.test.ts` catches missing backend guards.
- **A 3rd/4th duplicated internal-key-check implementation** (`inventory-service`'s
  `reservation.routes.ts`/`stock.routes.ts` inline `timingSafeEqual` checks, distinct from
  both the shared `requireInternalKey()` helper and `report-service`'s locally-named
  `checkInternalKey`) — functionally correct, just unconsolidated. Low priority.

## 8. Manual Testing Checklist (consolidated across all 5 phases)

- [ ] Log in as a user with zero permissions → lands on `/no-access`, not a broken
      `/dashboard` Access Denied screen.
- [ ] Log in as a user with exactly one module's permission → lands on that module, not
      `/dashboard`.
- [ ] Log in as `OWNER`/`ADMIN` → sidebar shows everything, all buttons visible.
- [ ] Pick 3–4 roles with narrow permission sets (e.g. `CASHIER`, `STAFF`) → confirm
      sidebar items with no permission are fully hidden (not just disabled), and parent
      groups with zero visible children don't render an empty group header.
- [ ] For each of `SALES_MANAGER`, `INVENTORY_MANAGER`, `PURCHASE_MANAGER`: confirm they
      can now actually save an edited customer/item/supplier (previously silently 403'd
      before this audit's fixes — needs the backfill migration from §6 applied first if
      testing against an existing/already-provisioned tenant).
- [ ] Mid-session permission change (edit a user's role in another tab, then perform an
      action in the original tab after the access token naturally refreshes) → new
      permission set takes effect without requiring logout/login.
- [ ] Attempt direct URL navigation to a page the current role can't access → `AccessDenied`
      renders inline (not a raw error), sidebar never showed it as an option in the first
      place.
- [ ] `pnpm --filter @erp/types test -- route-guard-coverage` passes — if it doesn't, a new
      route shipped without a permission guard.
