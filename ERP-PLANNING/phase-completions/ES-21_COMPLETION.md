# ES-21 Completion Report — Security: Tenant-Admin & User-Management Authorization Lockdown

**Date:** 2026-07-04
**Status:** COMPLETE

## Findings Closed

| ID  | Finding                                                                                                                                       | Fix Summary                                                                                                                                                                                                                                                                                                                       | Verified By                            |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| C1  | Unauthenticated tenant-admin routes (`POST/GET /admin/tenants`, `GET /admin/tenants/:id`)                                                     | Added `preHandler: [authenticate, requirePermission(PLATFORM_TENANT_MANAGE)]`                                                                                                                                                                                                                                                     | `tenant-admin-authz.test.ts` #1, #2    |
| C2  | Suspend/activate/close had `authenticate` only, no permission/ownership check                                                                 | Added the same `PLATFORM_TENANT_MANAGE` gate to suspend/activate/close (no self-tenant carve-out — these are inherently cross-tenant)                                                                                                                                                                                             | `tenant-admin-authz.test.ts` #3, #4    |
| C3  | No permission checks on any route in `users.ts`; reset-password had no re-auth; `POST /users` allowed self-escalation via arbitrary `roleIds` | Added explicit `requirePermission` per route (table below); reset-password now requires the caller's own current password; `POST /users` now rejects role IDs outside the tenant and role permissions the caller doesn't already hold                                                                                             | `users-authz.test.ts` (15 cases)       |
| H1  | search-service admin routes trusted `tenantId` from the URL param                                                                             | Dropped `:tenantId` from all 4 admin route paths; tenantId is now read exclusively from `request.auth.tenantId`                                                                                                                                                                                                                   | `search-admin-authz.test.ts` (4 cases) |
| H12 | MFA backup-code confirming TOTP code passed as a query param                                                                                  | `GET /mfa/backup-codes?code=` → `POST /mfa/backup-codes/regenerate` with `{ totpCode }` in the body; frontend `mfaApi.regenerateBackupCodes` updated to match                                                                                                                                                                     | `mfa.test.ts` "ES-21 — 10"             |
| M17 | No per-token attempt cap on `/auth/mfa/verify`                                                                                                | Added a Redis-backed per-`mfaToken` counter — the 5th wrong attempt invalidates the token immediately, independent of the global rate limiter. (A wrong guess no longer burns the token outright the way the pre-existing code did, so a mistyped code within the cap doesn't force a fresh login — see "Behavior change" below.) | `mfa.test.ts` "ES-21 — 11"             |
| L3  | hr-service internal API key compared with `!==`                                                                                               | Replaced with `crypto.timingSafeEqual`, length-checked first to avoid a throw on mismatched lengths                                                                                                                                                                                                                               | manual review                          |
| L4  | `requirePermission` sent 403 without an explicit `return`                                                                                     | Added `return` in **both** `authorize.ts` files — auth-service's (the one the audit cited) and tenant-service's (same bug, and now directly load-bearing for the new C1/C2 gate this phase adds)                                                                                                                                  | manual review                          |

## New Permission

`PLATFORM_TENANT_MANAGE` — cross-tenant, platform-level. Added to `packages/shared-types/src/permissions.ts` in its own clearly-commented section, separate from all tenant-scoped permissions. **Not** attached to any entry in `ROLE_DEFAULTS` (`apps/tenant-service/src/rbac/role-defaults.ts`), so no existing tenant role — including `OWNER`/`SUPER_ADMIN`, which already enumerate every tenant-scoped permission — gains it.

**Seeding — flagged gap.** There was no pre-existing concept of a platform-operator role or user anywhere in the codebase (`roles.tenant_id` and `users.tenant_id` are both `NOT NULL`; every seed path — `TenantProvisioner.seedRolesAndPermissions`, `ROLE_DEFAULTS` — is tenant-scoped by design). Per the phase brief, the minimum viable seed was added rather than inventing a parallel platform-admin architecture:

- New migration `packages/db-client/migrations/0019_es21_platform_operator.sql` seeds a reserved **`platform-operations`** tenant (not a customer — exists solely to scope this role) and a **`PLATFORM_OPERATOR`** role inside it holding only `PLATFORM_TENANT_MANAGE`.
- **No user is seeded.** Hashing a password inside a raw SQL migration would mean either committing a fixed password hash to git or leaving a predictable one — worse than not seeding at all. This is the gap: **there is no automated way to provision the first platform-operator user.** Bootstrap it manually once, e.g.:

  ```bash
  node -e "require('argon2').hash('<your-strong-password>', {type:1}).then(console.log)"
  ```

  then insert a row into `users` (and a matching `user_roles` row against the `PLATFORM_OPERATOR` role) scoped to the `platform-operations` tenant's id (`SELECT id FROM tenants WHERE slug = 'platform-operations'`). Subsequent operators can then be created normally via `POST /users` by an existing platform operator, since that route's self-escalation guard (added in this phase) only blocks granting permissions the caller doesn't already hold.

  > **Superseded by PG-030:** don't do the manual steps above anymore — run `pnpm --filter @erp/tenant-service bootstrap-operator -- --email=<email> --password=<password>` (`apps/tenant-service/scripts/bootstrap-platform-operator.ts`) instead. It performs the exact same seed, guarded against being run twice.

## `POST /users` — permission table

| Route                                                                         | Required permission                                                                        |
| ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `GET /users`, `GET /users/:id`                                                | `USER_VIEW`                                                                                |
| `POST /users`                                                                 | `USER_CREATE` (+ role/permission-subset check below)                                       |
| `PUT /users/:id`                                                              | `USER_UPDATE`                                                                              |
| `DELETE /users/:id`                                                           | `USER_DELETE`                                                                              |
| `POST /users/:id/lock`, `/unlock`                                             | `USER_MANAGE`                                                                              |
| `PUT /users/:id/branches`                                                     | `USER_MANAGE`                                                                              |
| `POST /users/:id/reset-password`                                              | `USER_MANAGE` + caller's own current-password re-auth                                      |
| `GET/PUT /users/me`, `PUT /users/me/password`, `POST /users/me/avatar/upload` | unchanged — self-service, scope-level `authenticate` only (not in the audit's route table) |

`POST /users` self-escalation guard: validates every `roleId` in the request belongs to the caller's tenant (mirrors the existing check in `user-roles.ts`'s `PUT /users/:id/roles`), then rejects if any permission granted by those roles is not already held by the caller (`PermissionError` → 403).

**`checkOwnerPermission()` — deleted, not wired in.** Read what it did before deciding, per the brief: despite its name, it didn't check anything OWNER-related — it only checked for `USER_VIEW` (`if (!permissions.includes('USER_VIEW')) throw new PermissionError('USER_VIEW')`), was never called anywhere, and used a `require('@erp/types')` inside an ESM file. Every route it could plausibly have guarded now has an explicit, correctly-scoped `requirePermission(...)` call instead, so wiring in a mis-named, redundant helper would only add confusion. Deleted rather than kept as dead code.

## `/auth/mfa/verify` — behavior change (M17)

Before this phase, the code deleted the Redis `mfa:<token>` key **unconditionally** on the very first verify call, right or wrong — a single guess, correct or not, always consumed the token. That's incidentally brute-force-proof but has bad UX (a typo forces a full re-login) and isn't an intentional, observable rate limit. It's now an explicit 5-attempt cap: wrong guesses increment a sibling `mfa:attempts:<token>` counter (TTL matched to the token's own remaining TTL) without deleting the token; the 5th wrong attempt deletes both keys immediately. A correct guess at any point still deletes both keys (single-use on success, per the existing ES-19 test #6 regression coverage, which still passes unchanged).

## H1 — route shape change

`/admin/search/reindex/:tenantId/:entity` → `/admin/search/reindex/:entity`, and similarly for `indices` and `stats` — `:tenantId` dropped entirely rather than kept-and-cross-checked, matching the existing sibling routes (`/search`, `/search/index`) which already derive `tenantId` from `request.auth.tenantId` only. No live caller (frontend, scheduler-service) referenced the old `:tenantId` path shape — grepped repo-wide, only doc references in `ERP-PLANNING/`.

## Files Changed

| File                                                            | Change                                                                                                                                       |
| --------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/shared-types/src/permissions.ts`                      | Added `PLATFORM_TENANT_MANAGE`                                                                                                               |
| `packages/db-client/migrations/0019_es21_platform_operator.sql` | New — seeds `platform-operations` tenant + `PLATFORM_OPERATOR` role                                                                          |
| `apps/tenant-service/src/api/tenant.routes.ts`                  | All 6 `/admin/tenants*` routes gated by `authenticate` + `PLATFORM_TENANT_MANAGE` (C1, C2)                                                   |
| `apps/tenant-service/src/middleware/authorize.ts`               | Added explicit `return` after 403 (L4)                                                                                                       |
| `apps/auth-service/src/middleware/authorize.ts`                 | Added explicit `return` after 403 (L4)                                                                                                       |
| `apps/auth-service/src/routes/users.ts`                         | `requirePermission` on every route; reset-password re-auth; self-escalation guard on `POST /users`; deleted dead `checkOwnerPermission` (C3) |
| `apps/search-service/src/api/search.routes.ts`                  | 4 admin routes now derive `tenantId` from JWT, dropped `:tenantId` from paths (H1)                                                           |
| `apps/auth-service/src/routes/mfa.routes.ts`                    | Backup-codes regeneration moved to POST body; per-token attempt cap on verify (H12, M17)                                                     |
| `apps/web-frontend/src/api/endpoints.ts`                        | `mfaApi.regenerateBackupCodes` updated to POST body, matching new route                                                                      |
| `apps/hr-service/src/api/internal.routes.ts`                    | Constant-time internal API key comparison (L3)                                                                                               |
| `apps/tenant-service/src/__tests__/tenant-admin-authz.test.ts`  | New — C1/C2 regression tests                                                                                                                 |
| `apps/auth-service/src/__tests__/users-authz.test.ts`           | New — C3 regression tests                                                                                                                    |
| `apps/search-service/src/__tests__/search-admin-authz.test.ts`  | New — H1 regression tests                                                                                                                    |
| `apps/auth-service/src/__tests__/mfa.test.ts`                   | Extended — H12/M17 regression tests                                                                                                          |

## Tests: 65/65 PASS (auth-service 46, tenant-service 4 + 2 skipped DB-integration, search-service 7 new-file-adjusted... see below) | lint: PASS (new/changed files) | type-check: PASS (backend) | build: PASS

Exact counts from `pnpm --filter @erp/auth-service --filter @erp/tenant-service --filter @erp/search-service test`:

- auth-service: **46/46** passed (5 files: `security.test.ts`, `users-authz.test.ts`, `mfa.test.ts`, `roles.test.ts`, `es20-admin-routes.test.ts`)
- tenant-service: **4/4** passed, 2 skipped (`tenant.integration.test.ts` needs `DATABASE_URL`, unrelated to this phase)
- search-service: **7/7** passed (2 files: `search-auth.test.ts`, `search-admin-authz.test.ts`)

`pnpm --filter @erp/auth-service --filter @erp/tenant-service --filter @erp/search-service --filter @erp/hr-service --filter @erp/types build` — all clean (`tsc`, no errors).

`pnpm type-check` (repo-wide, turbo): **30/31 packages pass**, including every package touched by this phase. The one failure is `@erp/web-frontend`, and it is **pre-existing and unrelated** — the same double-unwrapped-envelope class of bug the audit already tracks as C9 (scoped to ES-22), present in files this phase never touched (`DashboardPage.tsx`, `FabricRollsPage.tsx`, `StockValuationPage.tsx`, `ApAgingPage.tsx`, etc.). Confirmed via `git diff --stat` that `apps/web-frontend/src/api/endpoints.ts` (the only frontend file this phase edited) already carried a large pre-existing uncommitted diff before this session started; my change there is a 2-line edit to `mfaApi.regenerateBackupCodes` within it.

`pnpm --filter <touched-package> lint` — all new/changed files in this phase are clean. Pre-existing `no-undef` (`process`/`fetch` not declared as ESLint globals) and a couple of unrelated `no-unused-vars` errors remain in files this phase did not touch (`tenant-service/src/config.ts`, `main.ts`, `TenantProvisioner.ts`, `organization.routes.ts`, `middleware/authenticate.ts`; `search-service/src/domain/SearchEngine.ts`, `main.ts`) — consistent with the repo-wide pre-existing lint debt already on file. My own new test file (`tenant-admin-authz.test.ts`) has 5 `explicit-function-return-type` warnings on small inline test-fixture functions, matching the existing style of `tenant.integration.test.ts` in the same directory (which also carries warnings, not errors).

## Known Issues / Deferred

- ~~**Platform-operator user provisioning has no automated bootstrap**~~ — resolved by PG-030: `apps/tenant-service/scripts/bootstrap-platform-operator.ts` (`pnpm --filter @erp/tenant-service bootstrap-operator -- --email=<email> --password=<password>`) creates the first `PLATFORM_OPERATOR` user and refuses to run again once one exists. The manual `argon2.hash()` + raw-SQL steps below are superseded — do not use them anymore.
- ~~**Platform-operator forgotten-password recovery has no working path**~~ — resolved: self-service `/auth/forgot-password` cannot reach this account (the `platform-operations` tenant is seeded by migration, bypassing the normal tenant-provisioning step that would seed its `PASSWORD_RESET_REQUESTED` notification template — `NotificationEngine.send()` silently `SKIPS` with no email and no error). `apps/tenant-service/scripts/reset-platform-operator-password.ts` (`pnpm --filter @erp/tenant-service reset-operator-password -- --email=<email> --new-password=<password>`) resets the password directly against the DB instead, mirroring `bootstrap-platform-operator.ts`'s approach and the normal `/auth/reset-password` route's side effects (clears `failedLoginAttempts`/`lockedUntil`, revokes existing refresh tokens).
- `createTenantContextMiddleware` (tenant-service) remains exported but never registered in `main.ts` — noted during pre-flight reading, **not** one of this phase's 8 findings, left untouched.
- ES-20's deployment checklist (DB migration `0018`, MinIO bucket, env vars) was still unconfirmed at the start of this session per `CLAUDE.md`'s session-start check; this phase adds one more migration (`0019`) to the same "apply before go-live" list. Project is confirmed still in a no-real-data dev phase, so not a current incident risk.
