# ES-36 — RBAC Audit Phase E: Branch-Level Record Permissions + RLS
## STATUS: ✅ PARTIALLY COMPLETE (RLS enablement deliberately deferred — see below)
## Sprint: Enterprise RBAC Refactor (Phase E of 5) | Effort: 1 day (of a larger estimate) | Risk: Medium
## Depends on: ES-35
## Unlocks: ES-37

---

## YOUR ROLE

You are the **Principal Backend Engineer** on the NEXORAA Multi-Tenant Cloth Retail ERP,
continuing the 5-phase enterprise RBAC audit and refactor.

---

## OBJECTIVE

Add real branch-level (record-level) authorization — today, branch assignment data exists
(`userBranches` join table) but is never read for authorization; a `SALES_MANAGER` can see
every invoice tenant-wide regardless of which branch they're assigned to. Plus add
Postgres RLS as defense-in-depth (today: zero `CREATE POLICY` statements exist anywhere;
tenant isolation is 100% hand-written `WHERE tenant_id = ...` predicates).

---

## SUB-AUDIT FIRST

Before implementing, checked `packages/db-client/src/schema/*` for existing `branch_id`
columns: found in 8 schema files (`sales.ts`, `purchase.ts`, `master.ts`, `hr.ts`, `gst.ts`,
`tenant.ts`, `report.ts`, `production.ts`) — branch scoping is a broad, cross-cutting
concern touching most transactional tables, not a handful. Given that, this phase builds
the **primitive** (JWT claim, decode, a reusable scope-decision function) and demonstrates
it working end-to-end on **one** representative, high-value path (`invoices`), rather than
attempting a full rollout to every branch-scoped table in one phase — the same "build the
pattern, then roll out" split already used for Phase D's frontend UI gating.

---

## WHAT WAS BUILT

### 1. `branchIds` now flows through the JWT
- `apps/auth-service/src/domain/roles.ts` — `loadUserRolesAndPermissions()` now also
  queries `userBranches` and returns `branchIds: number[]` alongside `roleNames`/`permissions`.
- `apps/auth-service/src/jwt.ts` — `AccessTokenPayload` gained `branchIds: number[]`,
  signed and decoded like every other claim.
- All 4 token-issuing call sites updated: `routes/login.ts`, `routes/refresh.ts`,
  `routes/mfa.routes.ts` (post-MFA-verify token), `routes/impersonate.routes.ts`
  (impersonation token carries the target user's own `branchIds`, consistent with how it
  already carries their roles/permissions).

### 2. Shared branch-scope decision function
`packages/platform-sdk/src/auth.ts` — `getBranchScope(auth): number[] | 'all'`:
- Returns `'all'` (no restriction) if the caller holds the new `BRANCH_SCOPE_BYPASS`
  permission (added to `permissions.ts`; `OWNER`/`SUPER_ADMIN` get it automatically via
  their full permission set, same as every other permission).
- Returns `'all'` if the caller has **zero** branch assignments — deliberately, so
  single-branch tenants and users who haven't been assigned a branch yet behave exactly as
  before this feature existed, rather than being silently locked out of everything.
- Otherwise returns the caller's `branchIds` array, for the route to filter on.

Because `AuthPayload` (and thus `request.auth`) is now defined once in `@erp/sdk` (per
ES-35's middleware consolidation), `branchIds` and `getBranchScope` are immediately
available to all 13 consolidated services with no further per-service plumbing.

### 3. Demonstrated end-to-end on `GET /invoices`
`apps/sales-service/src/api/invoice.routes.ts` — the invoice list route now does:
```ts
const branchScope = getBranchScope(req.auth);
if (branchScope !== 'all') conditions.push(inArray(invoices.branchId, branchScope));
```
A `SALES_MANAGER` assigned to branches `[3, 5]` now only sees invoices from those
branches; `OWNER`/`SUPER_ADMIN` (or anyone explicitly granted `BRANCH_SCOPE_BYPASS`) see
every branch's invoices, unchanged from today.

### 4. RLS — investigated, deliberately **not enabled** in this phase
Writing the RLS migration surfaced a real, live-breaking risk: `TenantScopedDatabase.raw`
(used by the vast majority of routes, including the exact `GET /invoices` route just
modified — confirmed zero `.transaction()` calls anywhere in `invoice.routes.ts`) never
sets the `app.current_tenant_id` Postgres session GUC outside an explicit
`.transaction()` block. Enabling `ROW LEVEL SECURITY` with a policy that requires that GUC
would make every non-transactional query — the majority of this codebase's read paths —
silently return **zero rows**, not add defense-in-depth. This is exactly the gap the
architecture audit's M14 finding already flagged ("`TenantScopedDatabase.raw` queries
never set the RLS session GUC") and deferred to "a dedicated security-hardening phase."

**Decision: ship the working, tested app-layer branch filter now; do not enable RLS until
the GUC-per-request plumbing gap is closed first** (see Deployment Checklist below for the
precise follow-up). Shipping a fail-open RLS policy (permissive when the GUC is unset)
would provide false security assurance without real protection; shipping a fail-closed one
would break the app. Neither is acceptable to land silently in this phase.

---

## VERIFICATION CHECKLIST

- [x] `getBranchScope`: unit-tested (restricts by default, bypasses with
      `BRANCH_SCOPE_BYPASS`, defaults to `'all'` for zero-branch users) — 3 new tests
- [x] `verifyAccessToken`/JWT round-trip: extended existing test to assert `branchIds`
      survives sign→verify
- [x] All 14 services (13 consolidated + auth-service) + `@erp/sdk`: `type-check` clean
- [x] `apps/sales-service` `type-check` clean after wiring `getBranchScope` into
      `invoice.routes.ts`
- [ ] Live end-to-end branch-isolation test (real DB, two users in different branches) —
      **not run**, no live Postgres available in this session (consistent with this repo's
      existing precedent of skipping DB-gated tests when infra isn't available)
- [x] Completion report saved at `ERP-PLANNING/phase-completions/ES-36_COMPLETION.md`,
      explicit about what shipped vs. deferred
