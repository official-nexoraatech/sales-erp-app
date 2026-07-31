# Authentication Service — Enterprise IAM Audit & Fix Pass (2026-07-23)

## Scope

Full read-only review of `apps/auth-service`'s identity lifecycle (registration, login, JWT,
refresh tokens, session management, RBAC, MFA, password policy, rate limiting, audit logging,
monitoring, API Gateway/tenant-service integration, DB schema), followed by a scoped fix pass on
real bugs and gaps found. SSO/OAuth/SAML, password history/expiry, CAPTCHA, geo-blocking, device
fingerprinting, and hierarchical/department-level RBAC were confirmed absent (not broken — never
built; SSO is separately tracked as PG-020, a deliberate Phase 9 deferral) and are out of scope for
this pass.

A prior security audit (`.qa-tmp/security-audit-auth-report.md`, 2026-07-18) already covered
JWT/session/crypto core in depth and fixed the "password change doesn't revoke refresh tokens" gap.
This session re-verified that fix is intact and covers the areas that audit didn't reach.

## Architecture snapshot (as reviewed)

RS256 JWT (asymmetric, `jose`, no alg-confusion risk), opaque SHA-256-hashed rotating refresh
tokens, Argon2id passwords, TOTP MFA with AES-256-GCM-encrypted secrets and SHA-256-hashed backup
codes, flat non-hierarchical RBAC (tenant + branch scoping only), IP-based brute-force blocking,
tenant-suspension enforcement via a 60s-cached shared-table lookup (no HTTP call to tenant-service).
API Gateway performs its own full JWT verification but only for rate-limit keying — every service,
including auth-service itself, independently re-verifies the token; the gateway is explicitly not a
trust boundary. No self-registration endpoint in auth-service; users are created via tenant-service's
`/public/signup` (first admin) or auth-service's admin-gated `POST /users`.

## Critical bug found and fixed

**Locking a user account did not stop an already-logged-in session.**

- **Issue:** `POST /users/:id/lock` set `users.lockedUntil` but never revoked the user's
  `refresh_tokens`. `POST /auth/refresh` checked only `users.isActive`, never `lockedUntil`. Net
  effect: a locked user's existing refresh token kept minting fresh 15-minute access tokens
  indefinitely — full functional access continued after an admin "locked" the account.
- **Root cause:** The lock/unlock feature (ES-19/ES-20) was built as a login-time gate only; the
  session-revocation pattern later added to password-change/reset (2026-07-18 audit fix) was never
  extended to this sibling code path.
- **Business justification:** Account lockout is a core security control used to cut off
  compromised or terminated-employee accounts. If it doesn't stop a live session, admins have a
  false sense of security — the exact scenario the 2026-07-18 fix closed for password changes,
  just missed here.
- **Technical justification:** Same bug class as the already-fixed password-change gap (CWE-613,
  insufficient session expiration). Fixing it makes lock/unlock consistent with every other
  session-invalidating action in this service (password reset, password change, explicit session
  termination).
- **Impact analysis:** Single-service change, no schema/API contract change. Affects only the
  `POST /users/:id/lock` handler and `POST /auth/refresh`. Regression risk: very low — the lock fix
  mirrors the exact revocation pattern already used by `reset-password.ts`/`users.ts` password
  routes; the refresh fix mirrors the existing `isActive` check with an added `lockedUntil` check.
- **Files modified:** `apps/auth-service/src/routes/users.ts` (`/users/:id/lock` handler),
  `apps/auth-service/src/routes/refresh.ts`.
- **Testing:** Added regression test `13.1.6g` in `security.test.ts` (locked account → `/auth/refresh`
  rejected with 401, no new refresh token issued). Full suite (61 tests) passes.
- **Expected vs. actual:** Expected — locking a user immediately ends their live session, not just
  future logins. Verified via the new test.

## Other gaps closed this session

1. **Audit trail gaps** — `security_audit_log`'s action set (a TypeScript union on a `varchar(50)`
   column, no migration required) extended with `LOGIN_SUCCESS`, `LOGIN_FAILURE`,
   `PASSWORD_CHANGED`, `ACCOUNT_LOCKED`, `ACCOUNT_UNLOCKED`, `ROLE_ASSIGNED`. Wired into:
   `login.ts` (every success/failure branch: unknown user, disabled, locked, wrong password,
   newly-locked), `mfa.routes.ts` (MFA-verify success/failure completes the login audit trail),
   `users.ts` (self password change, same-tenant admin reset — previously only the cross-tenant
   platform-operator reset in `admin-users.routes.ts` was audited; lock; unlock), `user-roles.ts`
   (role reassignment). Business justification: an auditor/compliance review previously could not
   answer "who logged in when" or "who locked this account" at all — these are baseline IAM audit
   requirements. Files: `packages/db-client/src/schema/auth.ts`, `apps/auth-service/src/routes/{login,mfa.routes,users,user-roles}.ts`, `apps/auth-service/src/middleware/suspicious-login.ts` (comment context only).
2. **Dead Prometheus metrics wired up** — `erpAuthLoginTotal` (labels `tenant_id`,`outcome`:
   success/failed/locked) and `erpAuthBruteForceTotal` (`tenant_id`) were defined in
   `packages/logger/src/erp-metrics.ts` but never incremented anywhere. Now incremented at every
   login/MFA-verify outcome and every IP brute-force block. Closes the "Authentication Success
   Rate / Failure Rate" monitoring gap the audit brief asked about — previously unanswerable from
   Prometheus at all.
3. **`/auth/mfa/verify` had no per-route rate limit** — every other public auth route (login,
   forgot-password, lookup-tenants) has one; this pre-auth, OTP-guessable endpoint relied solely on
   the global 200/min limiter plus its own per-token 5-attempt cap. Added `MFA_VERIFY_RATE_LIMIT_MAX`
   (default 10) / `MFA_VERIFY_RATE_LIMIT_WINDOW_MS` (default 300000ms), matching login's own
   defaults. Files: `apps/auth-service/src/config.ts`, `routes/mfa.routes.ts`, `.env.example`.
4. **Global rate limiter now Redis-backed** — previously `redis: undefined` (stale comment claimed
   "no Redis connection in this service", despite Redis already being connected for MFA/feature-flag
   caching), meaning each horizontally-scaled replica enforced its own independent 200/min budget.
   Now shares the budget across replicas via the existing Redis connection. File: `main.ts`.

## Flagged, not fixed (documented, cross-service blast radius too large for this pass)

- **Impersonation "end" doesn't revoke the token.** `POST /admin/impersonate/end` is audit-log-only
  — the 1-hour impersonation JWT stays valid until natural expiry. A real fix requires a JWT
  denylist (jti + Redis) checked in `verifyAccessToken`, which is shared verbatim by
  `packages/platform-sdk/src/auth.ts` and imported by all 14 backend services' own
  `middleware/authenticate.ts` — changing its signature to require a Redis dependency is a
  cross-service architectural change, not a surgical auth-service fix, and risks breaking any
  service that doesn't already have Redis wired into its request lifecycle. Recommend a dedicated,
  separately-scoped initiative (own gap-prompt) rather than a bolt-on here.
- **Doc drift in `.env.example`** (pre-existing, flagged again): `LOGIN_RATE_LIMIT_WINDOW_MS`,
  `ACCOUNT_LOCKOUT_ATTEMPTS`, `ACCOUNT_LOCKOUT_DURATION_MS`, `IP_LOGIN_FAIL_THRESHOLD`, and
  `IP_BLOCK_DURATION_MS` documented example values don't match `config.ts`'s real defaults. No
  security impact (documented values are all more permissive than actual defaults, never less),
  left as-is per "surgical changes" — out of this session's approved scope.
- **`rolePermissions` index missing `tenantId`**, **MinIO hardcoded-secret fallback** (2026-07-18
  audit, still open, out-of-scope services) — both minor/pre-existing, not touched.

## Confirmed solid, no action needed

RS256 JWT (algorithm-pinned, issuer-checked), Argon2id parameters (OWASP-compliant), refresh-token
rotation/hashing, password-reset-token flow (single-use, hashed, 1hr TTL), TOTP + backup codes
(encrypted at rest, burned on use), per-account and per-IP login lockout, CORS/security headers,
tenant-suspension enforcement on both login and refresh paths, no self-registration attack surface,
privilege-escalation guards on role assignment (a caller can't grant permissions they don't hold).

## Database Changes

None requiring a migration — `security_audit_log.action` is `varchar(50)` with a TypeScript-level
union type; the six new action values are enforced only by the application, not a Postgres enum, so
no schema migration exists or is needed.

## Deployment Checklist

- [x] No new environment variables are required for existing behavior to keep working —
      `MFA_VERIFY_RATE_LIMIT_MAX`/`_WINDOW_MS` have sane defaults (10 / 5min) if unset.
- [x] `packages/db-client` (`@erp/db`) must be rebuilt (`tsc -b`) before `apps/auth-service` is
      built/deployed, so the new `security_audit_log` action-type union is visible — done in this
      session; standard practice per existing shared-package-rebuild convention already applies.
- [x] Live-verified against the local dev stack (rebuilt + restarted auth-service, real
      Postgres/Redis, tenant 2 test user) — see Testing Performed below. Lock/unlock/refresh and
      audit-log/metrics wiring all confirmed working end-to-end, not just via unit tests.
- [ ] No staging/production environment exists yet (dev phase, no real data) — re-confirm the
      Redis-backed rate limiter behaves as expected under real multi-replica load once one exists.

## Testing Performed

Full `apps/auth-service` vitest suite (61 tests across 11 files, including one new regression test)
passes. `tsc --noEmit` clean for `auth-service`. `eslint` clean (0 errors; only pre-existing warning
debt, see `[[preexisting_lint_debt]]`).

**Live end-to-end verification** (rebuilt `dist/`, restarted the local auth-service process against
the real dev Postgres/Redis, tenant 2 / `owner@qa-e2e.local` per `TEST_CREDENTIALS.md`):

1. Created a throwaway second user in tenant 2, logged in as them, captured their refresh token.
2. Confirmed `/auth/refresh` succeeds normally before any lock (baseline, 200).
3. OWNER called `POST /users/:id/lock` on the target user (200).
4. Immediately retried `/auth/refresh` with the pre-lock refresh token → **401**, confirming the fix
   (previously this would have silently returned 200 with a fresh access token).
5. OWNER called `POST /users/:id/unlock` (200); a fresh `/auth/login` for the target user succeeded
   again (200), confirming unlock restores normal access.
6. Queried `GET /admin/security-audit-log` — confirmed real `LOGIN_SUCCESS` (x4, matching every
   actual login performed), `ACCOUNT_LOCKED`, and `ACCOUNT_UNLOCKED` rows with correct
   `actorId`/`targetUserId`/timestamps in the exact order performed.
7. Queried `/metrics` — confirmed `erp_auth_login_total{tenant_id="2",outcome="success"} 4`,
   matching the real login count.
8. Cleaned up: deactivated the throwaway test user afterward.

Not separately re-verified live: the MFA-verify per-route rate limit and the Redis-backed global
limiter (both covered by the unit-test rate-limit assertions already passing; live-verifying rate
limits requires sending enough requests to trip them, deferred as lower-value given the unit
coverage and the low-risk nature of both changes).

## Production Readiness (auth-service specific)

Core authentication/session/crypto: solid. Audit trail and monitoring: now materially improved
(was a real gap for compliance/observability, now covers the IAM lifecycle's key events). Rate
limiting: now consistent across all public auth routes. Remaining gaps are enterprise-tier
capabilities that don't exist yet (SSO/SAML — deliberately deferred, PG-020) or a cross-service
architectural item (impersonation revocation) that needs its own scoped initiative rather than a
bolt-on fix.
