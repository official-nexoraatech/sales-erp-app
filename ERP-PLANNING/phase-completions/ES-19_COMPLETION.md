# ES-19 Completion Report — Enterprise Security: 2FA & Advanced Auth
**Date:** 2026-07-03
**Status:** COMPLETE

## 2FA Implementation
- TOTP library: `otplib` v12 [USED] — `MFAService` (`apps/auth-service/src/domain/MFAService.ts`)
- Secret encryption: AES-256-GCM via `@erp/utils` `encryptField`/`decryptField` with `FIELD_ENCRYPTION_KEY` [CONFIRMED] — verified in `mfa.test.ts` that the stored `totpSecret` differs from the raw secret and round-trips via `decryptField`
- Backup codes: 10 codes generated on enrollment (10 hex bytes, uppercased); stored as SHA-256 hashes, never plaintext; single-use (burned from the array on redemption)
- QR code: generated with `qrcode` v1.5, `data:image/png;base64,...` data URL returned once at enrollment
- `totpEnabled` stays `false` until `confirmEnrollment` verifies a real TOTP code

## Security Measures
- Suspicious login: 5 failed attempts/10min from the same IP (Redis counter, key `login_fail:{ip}`) → IP inserted into `blocked_ips` for 1 hour + `SUSPICIOUS_LOGIN` row in `security_audit_log` [IMPLEMENTED] — `apps/auth-service/src/middleware/suspicious-login.ts`
- Impersonation: `POST /admin/impersonate` (guarded by `IMPERSONATE_USER`) issues a 1-hour-max access token carrying `impersonatedBy` + `isImpersonation` claims and writes `IMPERSONATION_START`; `POST /admin/impersonate/end` writes `IMPERSONATION_END` [IMPLEMENTED]
- MFA token: 5-minute Redis TTL (`mfa:{token}`), deleted on first read regardless of code outcome (true single-use) [IMPLEMENTED]
- Session management: `active_sessions` row created at login/MFA-verify, re-pointed (not duplicated) on token refresh, deleted on logout or explicit termination; `GET /sessions`, `DELETE /sessions/:id` [IMPLEMENTED]
- Security audit log viewer: `GET /admin/security-audit-log` (guarded by `VIEW_AUDIT_LOG`), paginated, filterable by `action` [IMPLEMENTED]

## Files Changed

| File | Change |
|------|--------|
| `packages/db-client/src/schema/auth.ts` | Added `totpSecret`, `totpEnabled`, `backupCodes` to `users`; new tables `activeSessions`, `securityAuditLog`, `blockedIps` |
| `packages/db-client/migrations/0017_es19_security_2fa.sql` | New migration (raw SQL, follows the repo's `0002+` no-journal-entry convention) |
| `apps/auth-service/src/domain/MFAService.ts` | New — enroll/confirm/verify/backup-code/disable/regenerate |
| `apps/auth-service/src/domain/session.ts` | New — `issueTokensAndSession` (login/MFA-verify), `rotateSession` (refresh re-points the existing session's `refreshTokenId` instead of creating a new row) |
| `apps/auth-service/src/middleware/suspicious-login.ts` | New — `checkIpBlocked`, `recordFailedLoginAndMaybeBlock` |
| `apps/auth-service/src/routes/mfa.routes.ts` | New — `POST /auth/mfa/verify` (public), `POST /mfa/enroll`, `POST /mfa/confirm`, `DELETE /mfa`, `GET /mfa/backup-codes` (authenticated); post-verify token issuance uses `loadUserRolesAndPermissions` |
| `apps/auth-service/src/routes/impersonate.routes.ts` | New — `POST /admin/impersonate`, `POST /admin/impersonate/end`. The impersonation token now carries the **target** user's real roles/permissions (was hardcoded empty in an earlier draft of this same phase — impersonation would otherwise have produced a token with zero permissions) |
| `apps/auth-service/src/routes/sessions.routes.ts` | New — `GET /sessions`, `DELETE /sessions/:sessionId` |
| `apps/auth-service/src/routes/security-audit-log.routes.ts` | New — `GET /admin/security-audit-log` |
| `apps/auth-service/src/domain/roles.ts` | New — `loadUserRolesAndPermissions()`. Fixes a privilege-escalation bug found while wiring this phase (see Known Issues → resolved) |
| `apps/auth-service/src/routes/login.ts` | IP-block check + suspicious-login recording; TOTP challenge branch returns `{requiresMFA, mfaToken}`; token issuance now goes through `issueTokensAndSession`; role/permission loading now goes through `loadUserRolesAndPermissions` |
| `apps/auth-service/src/routes/refresh.ts` | Rotates the `active_sessions` row alongside the refresh token; role/permission loading now goes through `loadUserRolesAndPermissions` |
| `apps/auth-service/src/routes/logout.ts` | Deletes the matching `active_sessions` row on logout |
| `apps/auth-service/src/routes/users.ts` | Added `sanitizeUser()` helper — strips `totpSecret`/`backupCodes` (and `passwordHash`) from all 6 user-facing response sites, replacing the old ad-hoc per-site destructure |
| `apps/auth-service/src/jwt.ts` | `AccessTokenPayload` gained optional `impersonatedBy`/`isImpersonation`; `signAccessToken` accepts a TTL override (used for the 1-hour impersonation token) |
| `apps/auth-service/src/config.ts` | Added `fieldEncryptionKey` |
| `apps/auth-service/src/main.ts` | Wires an `ioredis` client, all new routes, and a `FIELD_ENCRYPTION_KEY` startup guard |
| `apps/auth-service/package.json` | Added `otplib`, `qrcode`, `@erp/utils`; devDep `@types/qrcode` |
| `packages/shared-types/src/permissions.ts` | No change — `IMPERSONATE_USER`/`VIEW_AUDIT_LOG` already existed from ES-07 |
| `apps/web-frontend/src/constants/permissions.ts` | Added `IMPERSONATE_USER`, `VIEW_AUDIT_LOG` (backend-only until now) |
| `apps/web-frontend/src/api/client.ts` | `apiClient.delete` now accepts an optional body (needed for `DELETE /mfa {code, password}`) |
| `apps/web-frontend/src/api/endpoints.ts` | Added `mfaApi`, `sessionsApi`, `adminSecurityApi`; `authApi.login` return type now covers the MFA-challenge shape |
| `apps/web-frontend/src/store/auth.store.ts` | `AuthUser` gained optional `totpEnabled` |
| `apps/web-frontend/src/pages/auth/LoginPage.tsx` | Added the post-password MFA challenge step (TOTP or backup code) |
| `apps/web-frontend/src/pages/auth/SecuritySettingsPage.tsx` | New — 2FA enroll (QR + backup codes)/confirm/disable, active sessions list + terminate / terminate-all-others |
| `apps/web-frontend/src/pages/admin/SecurityAuditLogPage.tsx` | New — paginated, action-filterable audit log viewer |
| `apps/web-frontend/src/App.tsx` | Routes: `/security` (any authenticated user), `/admin/security-audit-log` (permission-gated) |
| `apps/web-frontend/src/components/Layout.tsx` | New "SECURITY" nav group |
| `apps/auth-service/src/__tests__/security.test.ts` | Updated for `loginRoute`'s new `redis` parameter and the extra `blocked_ips`/session/`roles` DB calls introduced by this phase (all 9 pre-existing tests still pass) |
| `apps/auth-service/src/__tests__/mfa.test.ts` | New — 10 tests covering the 9 required scenarios |
| `apps/auth-service/src/__tests__/roles.test.ts` | New — 3 regression tests for the privilege-escalation fix (a user only gets their own role's permissions, not every role in the tenant; role names resolve; permissions de-duplicate across multiple roles) |

## Tests: 22/22 PASS (9 pre-existing + 13 new) | type-check: PASS | build: PASS

Test breakdown (`mfa.test.ts`):
1. `enrollTOTP` stores an encrypted secret, never plaintext (decrypts back to the raw secret)
2. `confirmEnrollment` with a valid code sets `totpEnabled = true`; an invalid code rejects and leaves it `false`
3. Login with 2FA enabled returns `{ requiresMFA: true, mfaToken }`
4. `/auth/mfa/verify` with the correct TOTP code returns an `accessToken`
5. `/auth/mfa/verify` with an incorrect TOTP code → 401
6. `/auth/mfa/verify` rejects an already-used `mfaToken` (single-use)
7. A backup code works once, then fails on a second use
8. Impersonation writes an `IMPERSONATION_START` row to `security_audit_log`
9. 5 failed logins from the same IP block it; the 6th attempt is 429

`pnpm lint`: no new errors introduced. `apps/auth-service/src/routes/users.ts` was refactored (see Files Changed) to *reduce* an existing lint-debt category rather than extend it — see Known Issues.

## Fixed During This Phase (found while wiring ES-19, not part of the original scope)
- **Privilege escalation in `login.ts`/`refresh.ts`:** the permission-loading query filtered `rolePermissions` by `tenantId` only — never by the user's own `roleId`(s). Any authenticated user with at least one role received **every permission assigned to every role in the tenant** (e.g. a STAFF user's JWT would include SUPER_ADMIN's permissions). Pre-existing, predates ES-19. Fixed via a shared `loadUserRolesAndPermissions()` helper (`apps/auth-service/src/domain/roles.ts`) that filters by `inArray(rolePermissions.roleId, roleIds)`, used consistently by `login.ts`, `refresh.ts`, `mfa.routes.ts`, and `impersonate.routes.ts`. As a side effect this also fixes `roleNames` always being empty, so `security_audit_log.actorRole` now populates correctly for impersonation actions. Covered by `roles.test.ts` (3 tests) plus the full `security.test.ts`/`mfa.test.ts` suites re-passing.
- **Impersonation token had hardcoded empty permissions:** an earlier draft of `impersonate.routes.ts` (written in this same phase) signed the impersonation token with `roles: [], permissions: []`, which would have made impersonation functionally useless (authenticated but authorized for nothing). Fixed to load the **target** user's real roles/permissions before signing.

## Known Issues / Follow-ups
- **Environment quirk, not a code defect:** this workspace's `apps/auth-service/vitest.config.ts` alias-resolves `@erp/types` to a stale/truncated `PERMISSIONS` object under Vitest specifically (confirmed correct via `tsc`, `tsx`, and the built `dist`) — worked around locally in `mfa.test.ts` via a scoped `vi.mock('@erp/types', ...)` patch. Worth a deeper look if other phases hit the same thing when testing newer permission constants.
- `GET /mfa/backup-codes` takes the confirming TOTP code as a query parameter per the phase spec's route table; consider moving it to a request body in a future pass to keep it off request logs, even though it's not a secret itself.
- No rate limiting is applied to `/auth/mfa/verify` beyond the account/IP brute-force checks on `/auth/login` — the MFA code itself has no dedicated attempt cap. Low risk given the 5-minute token TTL, but worth adding if this becomes a target.

## Phases Unblocked
ES-20 (audit log viewer already exists here; `VIEW_AUDIT_LOG` permission and `security_audit_log` table are usable directly)
