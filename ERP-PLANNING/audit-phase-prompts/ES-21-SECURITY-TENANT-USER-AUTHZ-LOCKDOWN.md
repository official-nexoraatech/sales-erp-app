# ES-21 — Security: Tenant-Admin & User-Management Authorization Lockdown
## STATUS: ✅ COMPLETE — see phase-completions/ES-21_COMPLETION.md
## Sprint: 5 | Effort: 2–3 days | Risk: Critical
## Depends on: ES-07 (RBAC hardening), ES-19 (2FA/session infra)
## Unlocks: nothing blocked on this, but must ship before any pilot/demo — this is the #1 production blocker
## Source: `ERP-PLANNING/ARCHITECTURE_AUDIT_REPORT.md` findings C1, C2, C3, H1, H12, M17, L3, L4

---

## YOUR ROLE

You are the **Principal Security Engineer** on the NEXORAA Multi-Tenant Cloth Retail ERP.

A full-codebase architecture audit on 2026-07-03 found a **full-platform-compromise chain**: a
low-privilege authenticated user in any tenant can currently reset another user's password
(account takeover), enumerate every tenant on the platform with no authentication at all, and
suspend or close any other tenant. This is not a theoretical risk — it is three concrete missing
`preHandler` guards. Your mission is to close every one of them, and the related smaller
authorization gaps found in the same audit, without breaking any currently-working auth flow.

**Do not redesign the auth architecture. Do not add new features. Patch exactly what is specified
below, the same way the correct pattern is already used elsewhere in these same files.**

---

## ═══════════════════════════════════════════
## PRE-FLIGHT CHECKLIST
## ═══════════════════════════════════════════

- [ ] Read `ERP-PLANNING/ARCHITECTURE_AUDIT_REPORT.md` in full — §2 (C1–C3), §3 (H1, H12), §4 (M17),
      §5 (L3, L4), and §7 ("Security Deep-Dive") which explains why these three findings chain
      together into one exploit
- [ ] Read `ERP-PLANNING/audit-phase-prompts/ES-01-SECURITY-ROUTING-FIXES.md` and its completion
      report — establishes the `authenticate`/`requirePermission` middleware pattern
- [ ] Read `ERP-PLANNING/audit-phase-prompts/ES-07-RBAC-PERMISSION-HARDENING.md` and its completion
      report — the permission-constant naming convention you must follow
- [ ] Read `apps/auth-service/src/middleware/authenticate.ts` and `authorize.ts` in full
- [ ] Read `apps/auth-service/src/routes/users.ts` in full — note `checkOwnerPermission()` defined
      around line 55 and never called anywhere in the file
- [ ] Read `apps/tenant-service/src/api/tenant.routes.ts` in full
- [ ] Read `apps/tenant-service/src/middleware/tenantContext.ts` and `apps/tenant-service/src/main.ts`
      — confirm `createTenantContextMiddleware` is exported but never registered
- [ ] Read `apps/search-service/src/api/search.routes.ts` in full — compare the correct pattern in
      `/search` and `/search/index` (uses `request.auth.tenantId`) against the broken `/admin/*`
      routes (uses `request.params.tenantId`)
- [ ] Read `packages/shared-types/src/permissions.ts` in full — confirm there is currently NO
      `PLATFORM_ADMIN` / `TENANT_MANAGE`-class permission
- [ ] Run `pnpm build` and `pnpm test --filter @erp/auth-service --filter @erp/tenant-service
      --filter @erp/search-service` — confirm a clean baseline before you start

---

## ═══════════════════════════════════════════
## PROJECT CONTEXT
## ═══════════════════════════════════════════

### Auth pattern already correct elsewhere in this codebase — copy it exactly
```typescript
fastify.post('/some-sensitive-route', {
  preHandler: [authenticate, requirePermission(PERMISSIONS.SOME_PERMISSION)],
}, handler)
```
`authenticate` populates `request.auth = { userId, tenantId, roles, permissions }` from the verified
JWT. `requirePermission` checks `request.auth.permissions`. **Tenant scoping for any query must
always come from `request.auth.tenantId` — never from `request.params`, `request.body`, or any
other client-supplied value.** This exact class of bug (URL/body-trusted tenantId) is why both C1/C2
and H1 exist in unrelated services — treat it as the one rule that matters most in this phase.

### What "platform admin" means here
Tenant provisioning/suspend/close are **cross-tenant, platform-level** operations — conceptually
different from every other permission in this system, which is scoped to a single tenant. Do not
reuse an existing tenant-scoped permission for this. You are introducing the platform's first
platform-level (cross-tenant) permission.

### Coding Standards
- TypeScript strict — no `any`
- No `console.log` — use `packages/logger`
- `/* global process */` at top of files using `process.env`
- Never log passwords, tokens, TOTP codes, or API keys — user ID is fine, email/phone is not for
  security-event logs

---

## ═══════════════════════════════════════════
## OBJECTIVE
## ═══════════════════════════════════════════

1. **[C1]** Add authentication to `apps/tenant-service`'s fully-unauthenticated admin routes
2. **[C2]** Add platform-level authorization (not just `authenticate`) to tenant suspend/activate/close
3. **[C3]** Add `requirePermission` to every route in `apps/auth-service/src/routes/users.ts`, with
   extra hardening on password-reset and role-assignment
4. **[H1]** Fix search-service's admin routes to derive `tenantId` from the JWT, not the URL
5. **[H12]** Move the MFA backup-codes confirming TOTP code from a query param to the request body
6. **[M17]** Add a strict per-token attempt cap on `/auth/mfa/verify`
7. **[L3]** Use a constant-time comparison for the hr-service internal API key
8. **[L4]** Add an explicit `return` after the 403 in `requirePermission`

---

## ═══════════════════════════════════════════
## SCOPE
## ═══════════════════════════════════════════

### Step 1 — New platform-level permission [C1, C2]

`packages/shared-types/src/permissions.ts`: add a new constant, clearly separated from tenant-scoped
permissions with a comment explaining it is cross-tenant:
```typescript
// Platform-level permissions — cross-tenant, not scoped to request.auth.tenantId.
// Only assignable to a platform-operator role, never a tenant's own Owner/Admin role.
PLATFORM_TENANT_MANAGE: 'PLATFORM_TENANT_MANAGE',
```
Do not attach this permission to any existing tenant role seed data. If there is no existing
concept of a "platform operator" role/user in the seed data, add the minimum needed (a role row
gated behind this permission) — check `packages/db-client` seed scripts and
`ERP-PLANNING/TEST_CREDENTIALS.md` for how other privileged roles are seeded, and follow the same
pattern. Flag in your completion report if platform-operator provisioning has no existing seed
mechanism at all — that itself is a gap worth recording, not silently working around.

### Step 2 — Lock down tenant-admin routes [C1, C2]

`apps/tenant-service/src/api/tenant.routes.ts`:
- `POST /admin/tenants`, `GET /admin/tenants`, `GET /admin/tenants/:id` (currently **no
  `preHandler` at all**, lines ~23, 50, 61): add
  `preHandler: [authenticate, requirePermission(PERMISSIONS.PLATFORM_TENANT_MANAGE)]`
- `PATCH /admin/tenants/:id/suspend`, `/activate`, `/close` (currently `preHandler: [authenticate]`
  only, lines ~69, 91, 105): add the same permission check. Do **not** add an "is this the caller's
  own tenant" check instead of a permission check — suspend/close are inherently cross-tenant
  platform operations; the fix is restricting who can call them, not scoping them to self.

### Step 3 — Lock down auth-service user-management routes [C3]

`apps/auth-service/src/routes/users.ts`: every route currently relies only on whatever
`preHandler` is applied at the router-registration scope in `main.ts` (just `authenticate`). Add
explicit `requirePermission(...)` to each, using the existing `USER_VIEW` / `USER_CREATE` /
`USER_UPDATE` / `USER_DELETE` / `USER_MANAGE` constants already defined in
`packages/shared-types/src/permissions.ts`:

| Route | Required permission |
|---|---|
| `GET /users`, `GET /users/:id` | `USER_VIEW` |
| `POST /users` | `USER_CREATE` |
| `PUT /users/:id` | `USER_UPDATE` |
| `DELETE /users/:id` | `USER_DELETE` |
| `POST /users/:id/lock`, `/unlock` | `USER_MANAGE` |
| `PUT /users/:id/branches` | `USER_MANAGE` |
| `POST /users/:id/reset-password` | `USER_MANAGE` **plus** re-derive: this is the highest-risk
  route in the file — additionally require the caller to supply their own current password (not the
  target's) as a re-auth step before allowing a reset of someone else's password. If self-service
  "forgot password" already exists as a separate unauthenticated flow (`forgot-password.ts`/
  `reset-password.ts` routes), this admin-reset endpoint is for admins resetting OTHER users'
  passwords — confirm that distinction in the code before changing behavior, and preserve the
  self-service flow exactly as-is. |

Also: wire up the existing-but-unused `checkOwnerPermission()` helper (line ~55) if its purpose is
to prevent a user from downgrading/locking their own OWNER-role account, or delete it if it's dead
code superseded by the `requirePermission` additions above — read what it actually does before
deciding, and note your decision in the completion report.

For `POST /users` (creates a new user with `roleIds`): add a check that the caller cannot assign a
role containing a permission the caller does not themselves hold (prevents self-escalation via
"create a new admin for myself"). If a similar check already exists elsewhere in the roles domain
(`apps/auth-service/src/domain/roles.ts` — ES-19 fixed a privilege-escalation bug there per the
audit's "Verified FINE" notes), reuse that logic rather than writing a new check.

### Step 4 — Fix search-service tenant-trust bug [H1]

`apps/search-service/src/api/search.routes.ts`: `POST /admin/search/reindex/:tenantId/:entity`,
`POST/DELETE /admin/search/indices/:tenantId`, `GET /admin/search/stats/:tenantId/:entity` (lines
~52–125) currently take `tenantId` from `request.params`. Change all four to read
`request.auth.tenantId` instead (drop `:tenantId` from the route path, or keep it in the path for
readability but assert `request.params.tenantId === request.auth.tenantId` and 403 on mismatch —
pick whichever the existing route-registration style in this file makes more consistent with its
siblings, and match that). Keep the existing `SEARCH_REINDEX` permission check.

### Step 5 — MFA hardening [H12, M17]

`apps/auth-service/src/routes/mfa.routes.ts`:
- `GET /mfa/backup-codes` (line ~144): change to `POST /mfa/backup-codes/regenerate` accepting
  `{ totpCode }` in the request body instead of a query param. Update any frontend caller
  (`apps/web-frontend/src/pages/auth/SecuritySettingsPage.tsx`, built in ES-19) to match.
- `POST /auth/mfa/verify` (line ~58): add a per-`mfaToken` attempt counter in Redis (same store
  already used for the token itself) — 5 wrong attempts against one `mfaToken` invalidates that
  token immediately (forcing the user to log in again), independent of the global rate limiter.

### Step 6 — Small hardening items [L3, L4]

- `apps/hr-service/src/api/internal.routes.ts:14`: replace `key !== expected` with
  `!crypto.timingSafeEqual(Buffer.from(key), Buffer.from(expected))` — guard against length
  mismatch throwing (pad or length-check first).
- `apps/auth-service/src/middleware/authorize.ts:12-14`: add an explicit `return` after
  `reply.code(403).send(...)`. This audit traced Fastify 4.29.1's hook chain and confirmed this is
  not currently exploitable, but make it explicit for robustness against a future Fastify upgrade.

### OUT OF SCOPE
- OAuth/SSO, hardware keys, biometric auth (unchanged from ES-19's scope)
- Building a full platform-operator admin UI/console — a permission and a route guard are in
  scope; a dedicated frontend for platform operators is not
- Rewriting `checkOwnerPermission()` beyond wiring it in or removing it per Step 3

---

## ═══════════════════════════════════════════
## TESTING REQUIREMENTS
## ═══════════════════════════════════════════

`apps/tenant-service/src/__tests__/tenant-admin-authz.test.ts` (new):
1. `GET /admin/tenants` with no token → 401
2. `GET /admin/tenants` with a valid token lacking `PLATFORM_TENANT_MANAGE` → 403
3. `PATCH /admin/tenants/:id/suspend` as an authenticated ordinary tenant user → 403 (this is the
   regression test for the exact exploit the audit found)
4. `PATCH /admin/tenants/:id/suspend` as a platform-operator role → 200

`apps/auth-service/src/__tests__/users-authz.test.ts` (new):
1. Each of `GET/POST/PUT/DELETE /users*` and `/users/:id/reset-password` → 403 for a token without
   the matching permission
2. `POST /users/:id/reset-password` by an admin with `USER_MANAGE` but wrong/no current-password
   confirmation → 401/403 (per whatever re-auth mechanism you implement)
3. `POST /users` attempting to assign a role with a permission the caller doesn't hold → 403

`apps/search-service/src/__tests__/search-admin-authz.test.ts` (new or extend existing):
1. Tenant A's token calling `/admin/search/indices/{tenantB_id}` (or the equivalent post-fix route
   shape) → 403, not 200 acting on tenant B's index

`apps/auth-service/src/__tests__/mfa.test.ts` (extend existing ES-19 suite):
1. `/mfa/backup-codes/regenerate` no longer accepts a query-param code (send it in body instead)
2. 6th wrong `/auth/mfa/verify` attempt against the same `mfaToken` → mfaToken invalidated, further
   attempts (even correct) fail and require fresh login

---

## ═══════════════════════════════════════════
## BUILD VERIFICATION
## ═══════════════════════════════════════════

```bash
pnpm --filter @erp/auth-service build
pnpm --filter @erp/tenant-service build
pnpm --filter @erp/search-service build
pnpm --filter @erp/hr-service build
pnpm --filter @erp/types build
pnpm --filter @erp/web-frontend build
pnpm lint
pnpm type-check
pnpm test --filter @erp/auth-service --filter @erp/tenant-service --filter @erp/search-service
```

---

## ═══════════════════════════════════════════
## VERIFICATION CHECKLIST
## ═══════════════════════════════════════════

- [ ] The exact 4-step exploit chain in `ARCHITECTURE_AUDIT_REPORT.md` §7 no longer works: a fresh
      lowest-role test user cannot enumerate tenants, cannot reset another user's password, and
      cannot suspend/close another tenant
- [ ] `PLATFORM_TENANT_MANAGE` permission exists and is not attached to any ordinary tenant role
- [ ] Every route in `users.ts` has an explicit `requirePermission`
- [ ] search-service admin routes use `request.auth.tenantId`, never `request.params.tenantId`
- [ ] MFA backup-code regeneration no longer accepts the code via query string
- [ ] `/auth/mfa/verify` invalidates a token after 5 wrong attempts
- [ ] Internal API key comparison is constant-time
- [ ] All new tests pass; `pnpm lint` and `pnpm type-check` pass

---

## ═══════════════════════════════════════════
## REGRESSION CHECKLIST
## ═══════════════════════════════════════════

- [ ] Existing tenant provisioning flow (used by whatever legitimately creates tenants today —
      check how `TEST_CREDENTIALS.md`'s tenants were created) still works for a properly-permissioned
      caller
- [ ] Ordinary self-service `/auth/forgot-password` / `/auth/reset-password` flow (unauthenticated,
      email-token based) is untouched and still works — do not confuse it with the admin
      reset-password route you're gating in Step 3
- [ ] Normal login, 2FA enrollment/verify, and session management from ES-19 all still work
- [ ] `/search` and `/search/index` (the already-correct routes) are unchanged
- [ ] hr-service internal routes still authenticate correctly with a valid key

---

## ═══════════════════════════════════════════
## DEFINITION OF DONE
## ═══════════════════════════════════════════

- [ ] C1, C2, C3, H1, H12, M17, L3, L4 all closed per the fixes above
- [ ] All new tests pass; full regression suite green
- [ ] `pnpm lint` and `pnpm type-check` pass repo-wide
- [ ] Completion report saved at `ERP-PLANNING/phase-completions/ES-21_COMPLETION.md`
- [ ] `ERP-PLANNING/ARCHITECTURE_AUDIT_REPORT.md` §2/§3/§4/§5 updated: mark C1, C2, C3, H1, H12,
      M17, L3, L4 as ✅ FIXED with a one-line pointer to the completion report

---

## ═══════════════════════════════════════════
## COMPLETION REPORT TEMPLATE
## ═══════════════════════════════════════════

**Save as:** `ERP-PLANNING/phase-completions/ES-21_COMPLETION.md`

```markdown
# ES-21 Completion Report — Security: Tenant-Admin & User-Management Authorization Lockdown
**Date:** [YYYY-MM-DD]
**Status:** COMPLETE

## Findings Closed
| ID | Finding | Fix Summary | Verified By |
|---|---|---|---|
| C1 | Unauthenticated tenant-admin routes | Added authenticate + PLATFORM_TENANT_MANAGE | test: tenant-admin-authz.test.ts #1 |
| C2 | No permission check on suspend/close | Added PLATFORM_TENANT_MANAGE check | test #3, #4 |
| C3 | No permission checks on users.ts | Added requirePermission per route + re-auth on reset-password | test: users-authz.test.ts |
| H1 | search-service URL-trusted tenantId | Now reads request.auth.tenantId | test: search-admin-authz.test.ts |
| H12 | MFA backup codes via query param | Moved to POST body | test: mfa.test.ts |
| M17 | No MFA verify attempt cap | 5-attempt cap invalidates mfaToken | test: mfa.test.ts |
| L3 | Non-constant-time key compare | timingSafeEqual | manual review |
| L4 | Missing return after 403 | Added | manual review |

## New Permission
`PLATFORM_TENANT_MANAGE` — [describe how it's seeded/assigned]

## Files Changed
[Table]

## Tests: [N]/[N] PASS | lint: PASS | type-check: PASS | build: PASS

## Known Issues / Deferred
[Be honest — e.g. if platform-operator role provisioning has no UI yet, say so]
```
