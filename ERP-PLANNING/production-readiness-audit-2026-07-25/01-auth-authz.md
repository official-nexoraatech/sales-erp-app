# Production-Readiness Audit — Authentication & Authorization

**Scope:** `apps/auth-service`, `apps/web-frontend/src/pages/auth`, `apps/api-gateway/src/middleware/gateway-auth.ts`
**Method:** Fresh ground-up review — read every route/middleware/domain file in scope, then live-verified against the running stack (api-gateway :3000, auth-service :3010, Postgres, Redis, Mailhog) using tenant 2 ("QA E2E Test Co") test users. Prior audit claims in `ERP-PLANNING/` were treated as unverified leads only; several are corrected below.
**Date:** 2026-07-25

---

## Summary

The auth module is one of the more mature parts of this codebase. Live testing confirmed: RS256-signed JWTs with correct claims for multiple roles, working refresh-token rotation and logout, a real account-lockout + IP-based brute-force blocker (verified by actually tripping it), a fully functional password-reset flow end-to-end (Mailhog delivery → token → password change verified via login), correct multi-tenant data isolation on the user-list endpoint, live-verified RBAC enforcement (permitted vs. 403-denied roles), real audit-log rows for login success/failure/suspicious-login/impersonation, and a fully built impersonation feature — which corrects a prior memory note claiming impersonation was "documented, not built." The platform-wide error-handler registration-order bug (historically the most severe finding in this codebase) is confirmed fixed in auth-service: `registerErrorHandler` is called before any route registration in `main.ts`. All 61 auth-service unit tests and all 51 api-gateway tests pass. No Critical or High severity issues were found this pass; the issues found are Medium-or-below and mostly about consistency/hardening rather than exploitable holes.

---

## What works (verified live)

- **Login, 3+ roles, correct JWT claims.** Logged in as OWNER, CASHIER, ACCOUNTANT, STAFF, and AUDITOR via `POST http://localhost:3000/api/auth/auth/login`. Decoded each access token: header `{"alg":"RS256"}`, payload carries `sub`, `tenantId`, `email`, `roles`, `permissions` (role-scoped — OWNER got 291 perms, CASHIER 16, ACCOUNTANT 50), `branchIds`, `iss: erp-auth-service`, `exp - iat = 900` (15 min, matches `JWT_ACCESS_TOKEN_TTL_SECONDS` default).
- **Refresh token rotation.** `POST /auth/refresh` with the httpOnly cookie: old refresh token is revoked (`revokedAt` set), a new one issued, and the `active_sessions` row is re-pointed (`rotateSession`) rather than duplicated. Verified the _old_ cookie stops working after refresh.
- **Logout.** `POST /auth/logout` revokes the refresh token, deletes the `active_sessions` row, clears the cookie. Verified a refresh attempt after logout returns 401.
- **Account lockout / brute-force IP block — actually tripped it.** Ran 15 failed logins against `staff@qa-e2e.local` from the same IP. Confirmed via `redis-cli` that `login_fail:127.0.0.1` incremented to the configured threshold, confirmed a real row was inserted into `blocked_ips` (`reason: BRUTE_FORCE_IP`), and confirmed a subsequent login attempt **with correct credentials** was rejected with `429 {"error":"Too many failed login attempts from this IP","retryAfterSeconds":31}`. Note: this environment's `.env` overrides the code defaults — `ACCOUNT_LOCKOUT_ATTEMPTS=15`, `IP_LOGIN_FAIL_THRESHOLD=15`, `IP_BLOCK_DURATION_MS=60000` (vs. code defaults of 5/5/3600000) — a deliberately relaxed dev config, not a bug.
- **Password reset — full live round trip.** `POST /auth/forgot-password` → email landed in Mailhog (`http://localhost:8025`) with subject "Reset your password" → extracted the real token from the raw email body → `POST /auth/reset-password` with that token succeeded → confirmed **old password now rejected** (401) and **new password accepted** (200). Password restored to the original test credential afterward so `TEST_CREDENTIALS.md` stays valid for other sessions.
- **MFA (TOTP) — code-reviewed, unit-tested, not live-clicked.** `MFAService` + `mfa.routes.ts` implement enroll/confirm/disable/backup-codes, a tenant-scoped Redis cache for the pre-auth MFA challenge token (prefixed with `tenantId.` so `/auth/mfa/verify` can reconstruct tenant scoping without receiving `tenantId` directly), and a 5-attempt cap per MFA token independent of the global rate limiter. 15 tests pass in `mfa.test.ts` + `mfa-token-cache.test.ts`. Not live-tested end-to-end because no seeded test user has `totpEnabled=true` (see Untested section).
- **RBAC enforcement — verified both directions.** `AUDITOR` (holds `AUDIT_LOG_VIEW`/`VIEW_AUDIT_LOG`) successfully fetched `GET /admin/security-audit-log`. `CASHIER` (holds neither) got a clean `403 {"error":"Forbidden — missing permission: one of VIEW_AUDIT_LOG, AUDIT_LOG_VIEW"}`. Read `apps/tenant-service/src/rbac/role-defaults.ts` (555 lines) — it is unusually well-maintained, with inline comments documenting a long history of "dead permission constant" bugs found and fixed (the exact bug class this audit was asked to specifically watch for). Cross-checked every `requirePermission`/`requireAnyPermission` call in `apps/auth-service/src/routes/*.ts` against `ROLE_DEFAULTS` — found no new instance of the dead-constant pattern in this module.
- **Multi-tenant isolation.** `GET /users` as tenant-2 OWNER returned 23 users, **all** `tenantId: 2` — no cross-tenant leakage. Attempting `GET /users/1` (an ID that doesn't belong to tenant 2) returned a clean `404 {"error":{"code":"NOT_FOUND",...}}`, not another tenant's data. Every query in `auth-service` scopes by `tenantId` taken from the verified JWT, never from a client-supplied param.
- **JWT security.** Algorithm is genuinely RS256 (`jose` `importPKCS8`/`importSPKI`, `SignJWT`/`jwtVerify` both pinned to `algorithms: ['RS256']`). Crafted an `alg: none` token with a valid-looking payload and no signature — correctly rejected with `401 Invalid or expired access token` (jose's algorithm allowlist blocks it; there is no algorithm-confusion hole). Gateway (`gateway-auth.ts`) does its **own independent, real, signature-verified** check rather than trusting a header — confirmed by reading the code and its test suite (`gateway-auth.test.ts`, 15/15 passing, including "returns 401 for a token signed with a different key").
- **Audit logging — real rows, not aspirational.** After generating test events, queried `GET /admin/security-audit-log` and saw genuine `LOGIN_FAILURE`, `LOGIN_SUCCESS`, `SUSPICIOUS_LOGIN` rows with real `actorId`/`targetUserId`/`ipAddress`/`createdAt`. Triggered `IMPERSONATION_START` live (see below) and confirmed it's logged too.
- **Impersonation — fully built and working (corrects prior memory).** `POST /admin/impersonate` (gated on `PERMISSIONS.IMPERSONATE_USER`, which only OWNER holds by default — `role-defaults.ts` explicitly excludes it from ADMIN) issued a token for a target CASHIER user with `impersonatedBy: 2, isImpersonation: true` in the payload, and wrote an `IMPERSONATION_START` audit row. `POST /admin/impersonate/end` exists and logs `IMPERSONATION_END`. The prior memory note `[QA Auth Service comprehensive 2026-07-23]` calling this "documented, not built" is **out of date** — it is live and working as of this session.
- **Error handling.** `registerErrorHandler` is called in `main.ts` **before** any `fastify.register()`/route calls (with an explicit comment explaining why order matters — this is the historically-buggy pattern, confirmed fixed here). Protected-route errors (e.g., `NotFoundError` on `/users/1`) return the structured `{"error":{"code":"NOT_FOUND","message":...,"details":...}}` shape. Gateway 401s use the same nested shape.
- **Tests.** `pnpm --filter @erp/auth-service test`: **61/61 passed** across 11 files (roles, forgot-password + its rate limit, lookup-tenants, PG-010 dual-registration, ES-20 admin-route guards, users-authz (15 tests), security/brute-force lockout, audit-log-permission-guard, MFA token cache tenant-namespacing, MFA). `pnpm --filter @erp/api-gateway test`: **51/51 passed** across 7 files, including `gateway-rate-limit.test.ts` (tenant-isolation of the rate-limit bucket, and a specific test that a forged-tenantId token can't be used to attack another tenant's quota) and `gateway-auth.test.ts` (15 tests).

---

## Bugs / gaps found

### 1. Password-reset email link points to a dead URL by default (Medium)

**Evidence:** `apps/auth-service/src/config.ts:42` — `frontendUrl: process.env['FRONTEND_URL'] ?? 'http://localhost:3000'`. `FRONTEND_URL` is not set in `.env` and not documented in `.env.example`. `apps/auth-service/src/routes/forgot-password.ts:83` builds the reset link as `${config.frontendUrl}/reset-password?token=...`. Live-verified: the real email delivered to Mailhog contained `http://localhost:3000/reset-password?token=...` (the **api-gateway** port). `curl http://localhost:3000/reset-password` → `401`. The actual reset-password page lives on web-frontend: `curl http://localhost:5173/reset-password` → `200`.
**Business impact:** In this dev/QA environment (and any environment that doesn't explicitly set `FRONTEND_URL`), a user who requests a password reset and clicks the emailed link lands on a dead page and cannot complete the reset through the UI. The backend logic itself is correct — I completed the full reset by extracting the token directly from Mailhog's raw body and calling the API — but the emailed link a real user would click is broken.
**Fix suggestion:** set `FRONTEND_URL` in `.env`/`.env.example`, and/or change the code default to the frontend dev port rather than the gateway port.

### 2. Inconsistent error-response shape across auth-service's own public routes (Medium)

**Evidence:** `login.ts`, `refresh.ts`, `logout.ts`, `forgot-password.ts`, `reset-password.ts`, and `mfaVerifyRoute` in `mfa.routes.ts` all manually call `reply.code(4xx).send({ error: 'some string', details?: ... })` instead of throwing a typed `ERPError`/`ValidationError`/`BusinessError`. This bypasses `registerErrorHandler`'s structured shape. Live-verified: `POST /auth/login` with missing fields → `{"error":"Invalid request","details":{"formErrors":[],"fieldErrors":{"email":["Invalid email"],...}}}` (flat `error: string`), while `GET /users/1` (not found) → `{"error":{"code":"NOT_FOUND","message":"User not found","details":{...}}}` (nested `error: {code, message, details}`).
**Business impact:** Any frontend/API consumer has to branch on which auth-service endpoint it's calling to know whether `error` is a string or an object — a real integration footgun, and a partial regression of the intent behind the PG-059/error-handler-registration-order fix (which was meant to make every business error return one consistent shape).
**Fix suggestion:** either route these six handlers' failure paths through the same typed-error mechanism, or explicitly document these public/pre-auth routes as an intentional exception.

### 3. No JWT key rotation support / no JWKS (Low-Medium)

**Evidence:** `apps/auth-service/src/jwt.ts` loads exactly one static RSA key pair at process startup (`importPKCS8`/`importSPKI`) with no `kid` header on signed tokens and no mechanism to validate against more than one currently-valid key. Grepped the service for `jwks`/`kid`/`JWK` — no matches.
**Business impact:** Rotating the signing key (e.g., after a suspected compromise) requires either accepting an instant break of every outstanding session across all 15 services the moment the new key is deployed, or a manual, error-prone coordinated rollout — there's no dual-key grace-period path. This is a real gap for a production security posture, though not an active vulnerability.

### 4. No OpenAPI/Swagger documentation (Low)

**Evidence:** No `@fastify/swagger` (or equivalent) registration found anywhere in `apps/auth-service`. The API contract exists only in source code and tests.
**Business impact:** Slower integration for any new consumer of this API; no machine-readable contract to validate against.

### 5. Password policy is length-only, no composition rule (Low / informational)

**Evidence:** `apps/auth-service/src/routes/users.ts:37` and `reset-password.ts:11` both use `z.string().min(12).max(128)` with no uppercase/lowercase/digit/special-character requirement.
**Note:** This is arguably correct per current NIST 800-63B guidance (length beats composition rules), so I'm not scoring it as a defect — flagging only so it's a deliberate decision, not an oversight, if a compliance requirement (e.g., a specific industry standard) later mandates composition rules.

### 6. SSO configuration exists; SSO login does not (Informational — corrects prior memory)

**Evidence:** `apps/tenant-service/src/api/sso-config.routes.ts` and `apps/web-frontend/src/pages/settings/SsoConfigPage.tsx` implement full CRUD for storing an IdP's SSO configuration, gated by `SSO_CONFIG_MANAGE`. But grepping `apps/auth-service/src` for `sso`/`saml`/`oauth callback` patterns found nothing — there is no `/auth/sso/*` login route, no SAML assertion consumer, no OAuth callback handler. The `users` table has `ssoProvider`/`ssoSubject` columns but they're unpopulated (`null` on every user I fetched).
**Refinement of prior memory:** the earlier note "SSO... documented, not built" undersold what exists — the _configuration_ layer is real and built — but the actual authentication flow (a user logging in _via_ SSO) genuinely does not exist yet. A tenant can configure an IdP today and it will do nothing at login time.

---

## Untested / unknown areas

- **MFA end-to-end via a real browser/authenticator.** No seeded test user in `TEST_CREDENTIALS.md` has TOTP enabled, so I could not drive `enroll → confirm → login-with-code` live. Confidence here rests on the 15 passing unit tests plus a full code read, not live verification.
- **Concurrent-session limits.** `GET /sessions` / `DELETE /sessions/:id` work and were read closely, but I found no cap on the number of simultaneous `active_sessions` rows per user — did not attempt to determine if unlimited concurrent logins is by design or a gap, given time constraints.
- **Login route's rate limit at its real (non-dev) threshold.** `.env` overrides `LOGIN_RATE_LIMIT_MAX` to `1000` (15-min window) for local convenience, so the production default (10 attempts/5 min per `config.ts`) was not exercised live. The mechanism itself (a per-route `@fastify/rate-limit` config block) is confirmed correctly wired by reading `login.ts` and by the passing `forgot-password-rate-limit.test.ts`, which exercises the same pattern on a sibling route.
- **Cross-tenant `PLATFORM_OPERATOR` admin flows** (`apps/auth-service/src/routes/admin-users.routes.ts` — an operator resetting a user's password in a tenant they don't belong to). Read the code (double-password-check pattern, correctly gated on `PLATFORM_TENANT_MANAGE`) but did not live-test with `operator@platform.local`, out of time budget for this pass.
- **Web-frontend auth pages** (`LoginPage.tsx`, `ResetPasswordPage.tsx`, `SecuritySettingsPage.tsx`, `SignupPage.tsx`) were partially read (confirmed MFA-aware login flow, org-lookup step, remembered-login localStorage) but not click-tested in an actual browser this session — verification here was API-level only.
- **Key compromise / emergency rotation runbook** — no such document or mechanism found; noted as a gap (#3) but didn't search further for an operational runbook that might exist outside code.

---

## Readiness score: 85/100

**Justification:** No Critical or High severity issues surfaced despite deliberately adversarial live testing (brute-force to actual lockout, `alg:none` tampering, cross-tenant ID guessing, direct DB/Redis inspection to catch a silently-broken protection). Every core flow — login, refresh, logout, RBAC, tenant isolation, audit logging, password reset, impersonation — was independently reproduced against the live stack, not just read in source, and all of it held up including the two mechanisms (brute-force IP block, password-reset round trip) that are exactly the kind of thing that looks right in code but silently no-ops in practice elsewhere in this codebase. Test coverage is real and comprehensive (112/112 relevant tests passing). Deductions: −5 for the broken password-reset link default (a real, live-confirmed user-facing break, if a cheap one to fix), −5 for the inconsistent error-response shape across six public routes (a genuine integration footgun and a partial regression of prior error-handling work), −3 for no key-rotation/JWKS story, −2 for no API documentation.

---

_Report generated 2026-07-25. Test data mutations (owner password reset, staff account failed-attempt counter, IP block on 127.0.0.1) were reverted/expired before this report was finalized; `TEST_CREDENTIALS.md` values remain valid._
