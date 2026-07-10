# ES-19 — Enterprise Security: 2FA & Advanced Auth
## STATUS: ✅ COMPLETED
## Sprint: 4 | Effort: 4–5 days | Risk: High
## Depends on: ES-07 (RBAC hardening)
## Unlocks: ES-20

---

## YOUR ROLE

You are the **Principal Security Engineer** on the NEXORAA Multi-Tenant Cloth Retail ERP.
Your mission: implement TOTP-based Two-Factor Authentication (2FA), session management improvements, suspicious login detection, and admin impersonation with full audit trail.

---

## ═══════════════════════════════════════════
## PRE-FLIGHT CHECKLIST
## ═══════════════════════════════════════════

- [ ] Read `ERP-PLANNING/TECH_AUDIT.md`
- [ ] Read `ERP-PLANNING/CODING_STANDARDS.md`
- [ ] Read `ERP-PLANNING/phase-completions/ES-01_COMPLETION.md` — rate limiting, JWT setup
- [ ] Read `ERP-PLANNING/phase-completions/ES-07_COMPLETION.md` — IMPERSONATE_USER permission
- [ ] Read `apps/auth-service/src/` — full directory structure
- [ ] Read `apps/auth-service/src/domain/AuthService.ts` — full file
- [ ] Read `apps/auth-service/src/api/auth.routes.ts` — all existing auth routes
- [ ] Read `packages/db-client/src/schema/auth.ts` — users, sessions, refresh_tokens tables
- [ ] Check: does `users` table have `totp_secret TEXT` and `totp_enabled BOOLEAN` columns?
- [ ] Check: does a `login_attempts` or `security_events` table exist?
- [ ] Read `apps/web-frontend/src/pages/auth/` — existing login/register pages
- [ ] Run `pnpm build` — confirm clean baseline

---

## ═══════════════════════════════════════════
## COMPLETED PHASES
## ═══════════════════════════════════════════

| Phase | Status | Key Changes Relevant to You |
|-------|--------|----------------------------|
| ES-01 ✅ | Security | Rate limit 10/15min; JWT RS256 wired on search-service |
| ES-07 ✅ | RBAC | IMPERSONATE_USER permission defined |

---

## ═══════════════════════════════════════════
## PROJECT CONTEXT
## ═══════════════════════════════════════════

### Tech Stack
Node.js 20 + TypeScript 5 strict | Fastify 4 | PostgreSQL 16 + Drizzle ORM | `jose` (JWT) |
`otplib` (TOTP) | `qrcode` (QR generation) | AES-256-GCM | Redis 7 | React 18 + Vite 5 | Vitest

### Auth Architecture
```
JWT RS256: access token (15min) + refresh token (7d)
Access token payload: { sub, tenantId, email, roles, permissions, userId }
request.auth: set by authenticate() middleware

Login flow:
  POST /auth/login → if 2FA enabled → returns { requiresMFA: true, mfaToken: '...' }
                   → POST /auth/mfa/verify { mfaToken, totpCode } → returns { accessToken, refreshToken }
  Token refresh: POST /auth/token/refresh
  Logout: POST /auth/logout (invalidates refresh token)
```

### Security Rules
- TOTP secret: encrypted at rest using AES-256-GCM with `FIELD_ENCRYPTION_KEY`
- NEVER return TOTP secret in plaintext after setup (only show once during enrollment)
- MFA token (short-lived): 5-minute TTL, stored in Redis, single-use
- Impersonation: write to `security_audit_log` on every impersonation start/end
- Suspicious login: IP-based detection — 5 failed logins from same IP in 10 min → block IP for 1 hour

### `/* global process */` pattern
At top of every file using `process.env`

### Auth Pattern for sensitive auth routes
```typescript
fastify.post('/auth/admin/impersonate', {
  preHandler: [authenticate, requirePermission(PERMISSIONS.IMPERSONATE_USER)],
}, handler)
```

### Coding Standards
- TypeScript strict — no `any`
- No `console.log` — use `packages/logger`
- Log security events with structured data (NOT PII — use user ID, not email, in logs)
- `/* global process */` at top of files using `process.env`

---

## ═══════════════════════════════════════════
## OBJECTIVE
## ═══════════════════════════════════════════

1. TOTP-based 2FA (Google Authenticator compatible)
2. 2FA enrollment flow (QR code + backup codes)
3. Admin impersonation with audit trail
4. Suspicious login detection (IP-based)
5. Session management (active sessions list + remote logout)
6. Security audit log viewer

---

## ═══════════════════════════════════════════
## SCOPE
## ═══════════════════════════════════════════

### IN SCOPE

**Step 1 — Schema additions**

`packages/db-client/src/schema/auth.ts`:

Add to `users` table:
```sql
totp_secret TEXT,           -- encrypted AES-256-GCM ciphertext
totp_enabled BOOLEAN NOT NULL DEFAULT false,
backup_codes TEXT[],        -- array of encrypted backup code hashes
```

New table `active_sessions`:
```sql
id UUID PRIMARY KEY DEFAULT gen_random_uuid()
tenant_id UUID NOT NULL
user_id UUID NOT NULL
device_info VARCHAR(500)    -- user agent
ip_address INET NOT NULL
created_at TIMESTAMPTZ DEFAULT NOW()
last_seen_at TIMESTAMPTZ DEFAULT NOW()
refresh_token_id UUID       -- links to refresh_tokens table
```

New table `security_audit_log`:
```sql
id UUID PRIMARY KEY DEFAULT gen_random_uuid()
tenant_id UUID NOT NULL
actor_id UUID NOT NULL       -- who performed the action
actor_role VARCHAR(50)
target_user_id UUID          -- who was impersonated/affected
action VARCHAR(50) NOT NULL  -- 'IMPERSONATION_START' | 'IMPERSONATION_END' | 'MFA_ENABLED' | 'MFA_DISABLED' | 'SESSION_TERMINATED' | 'SUSPICIOUS_LOGIN'
ip_address INET
details JSONB
created_at TIMESTAMPTZ DEFAULT NOW()
INDEX: (tenant_id, actor_id, created_at DESC)
INDEX: (tenant_id, action, created_at DESC)
```

New table `blocked_ips`:
```sql
id UUID PRIMARY KEY DEFAULT gen_random_uuid()
ip_address INET NOT NULL
blocked_until TIMESTAMPTZ NOT NULL
reason VARCHAR(100)
created_at TIMESTAMPTZ DEFAULT NOW()
UNIQUE: (ip_address)
```

Migration: `000X_es19_security_2fa.sql`

**Step 2 — 2FA Enrollment**

`apps/auth-service/src/domain/MFAService.ts` (new file):

```typescript
export class MFAService {
  // Initiate enrollment: generate secret, return QR code data URL + backup codes
  async enrollTOTP(userId: string, tenantId: string): Promise<{ qrCodeDataUrl: string; backupCodes: string[] }>
  
  // Verify and activate: user must confirm with a valid TOTP code before enrollment is complete
  async confirmEnrollment(userId: string, totpCode: string): Promise<void>
  
  // Verify TOTP code during login or sensitive operations
  async verifyTOTP(userId: string, totpCode: string): Promise<boolean>
  
  // Use backup code (one-time use; burn after use)
  async useBackupCode(userId: string, code: string): Promise<boolean>
  
  // Disable 2FA (requires current TOTP or backup code + password confirm)
  async disableTOTP(userId: string, totpCode: string): Promise<void>
}
```

Use `otplib` for TOTP generation/verification.
Use `qrcode` for QR code image generation.
Encrypt TOTP secret with AES-256-GCM before storing.

**Step 3 — 2FA Login Flow**

`apps/auth-service/src/domain/AuthService.ts`:

Modify `login(email, password, tenantId)`:
```typescript
// After password verification:
if (user.totpEnabled) {
  // Generate short-lived MFA token
  const mfaToken = generateSecureToken(); // UUID or random hex
  await redis.setex(`mfa:${mfaToken}`, 300, JSON.stringify({ userId, tenantId })); // 5 min TTL
  return { requiresMFA: true, mfaToken };
}
// Else: return accessToken + refreshToken as usual
```

New route: `POST /auth/mfa/verify`
Body: `{ mfaToken: string, code: string }` (code = TOTP or backup code)
- Validate mfaToken from Redis (not expired, not already used)
- Delete from Redis after use (single-use)
- Verify TOTP or backup code
- Issue accessToken + refreshToken

**Step 4 — 2FA Management Routes**

```
POST /auth/mfa/enroll     — initiate enrollment (returns QR + backup codes)
POST /auth/mfa/confirm    — confirm enrollment with TOTP code
DELETE /auth/mfa          — disable 2FA (requires TOTP + password)
GET /auth/mfa/backup-codes — regenerate backup codes (requires TOTP)
```

All routes require `authenticate`.

**Step 5 — Admin Impersonation**

`apps/auth-service/src/domain/AuthService.ts`:

```typescript
async impersonate(targetUserId: string, reason: string, ctx: AuthContext): Promise<{ accessToken: string }> {
  // Generate a short-lived access token (1 hour max) for targetUser
  // The token payload includes: { ..., impersonatedBy: ctx.userId, isImpersonation: true }
  // Write to security_audit_log: action = 'IMPERSONATION_START'
  // Return: one-time impersonation access token
}
```

Route: `POST /auth/admin/impersonate`
Guard: `authenticate` + `requirePermission(PERMISSIONS.IMPERSONATE_USER)`
Body: `{ targetUserId: string, reason: string }`

Route: `POST /auth/admin/impersonate/end` — end impersonation session
Action: write `IMPERSONATION_END` to audit log.

**Step 6 — Suspicious Login Detection**

`apps/auth-service/src/middleware/suspicious-login.ts`:

Before processing login:
1. Check if IP is in `blocked_ips` and `blocked_until > NOW()` → return 429
2. Count failed logins from this IP in last 10 minutes (from `security_audit_log` or a Redis counter)
3. If ≥ 5 failures: insert into `blocked_ips` for 1 hour; write `SUSPICIOUS_LOGIN` to audit log; return 429

**Step 7 — Session Management**

Route: `GET /auth/sessions` — list user's active sessions
Route: `DELETE /auth/sessions/:sessionId` — terminate session (remote logout)

Frontend: `apps/web-frontend/src/pages/auth/SecuritySettingsPage.tsx`
- Current 2FA status + Enable/Disable button
- QR code display during enrollment
- Backup codes display (one-time)
- Active sessions list: Device, IP, Last Seen, "Terminate" button
- "Terminate All Other Sessions" button

**Step 8 — Security Audit Log Viewer**

Route: `GET /auth/admin/security-audit-log` — paginated audit log
Guard: `requirePermission(PERMISSIONS.VIEW_AUDIT_LOG)` (from ES-07)

Frontend: `apps/web-frontend/src/pages/admin/SecurityAuditLogPage.tsx`
- `ERPDataGrid`: Action, Actor, Target, IP, Timestamp, Details
- Filter by action type, date range

### OUT OF SCOPE
- OAuth/SSO integration (SAML, Google, Azure AD)
- U2F / hardware security keys
- Biometric authentication
- IP allowlist per tenant (config-level feature)

---

## ═══════════════════════════════════════════
## TESTING REQUIREMENTS
## ═══════════════════════════════════════════

`apps/auth-service/src/__tests__/mfa.test.ts`:
1. Enroll 2FA → TOTP secret stored encrypted (not plaintext)
2. Confirm enrollment with valid TOTP code → `users.totp_enabled = true`
3. Login with 2FA enabled → returns `{ requiresMFA: true, mfaToken }`
4. `/auth/mfa/verify` with correct TOTP → returns accessToken
5. `/auth/mfa/verify` with incorrect TOTP → 401
6. `/auth/mfa/verify` with already-used mfaToken → 401 (single-use)
7. Use backup code → succeeds; that code no longer works on second use
8. Impersonation → `security_audit_log` has `IMPERSONATION_START` row
9. 5 failed login attempts from same IP → IP blocked for 1 hour → 6th attempt is 429

---

## ═══════════════════════════════════════════
## BUILD VERIFICATION
## ═══════════════════════════════════════════

```bash
pnpm --filter @erp/auth-service build
pnpm --filter @erp/auth-service type-check
pnpm --filter @erp/db-client build
pnpm --filter @erp/web-frontend build
pnpm lint
pnpm test --filter @erp/auth-service
```

---

## ═══════════════════════════════════════════
## VERIFICATION CHECKLIST
## ═══════════════════════════════════════════

- [ ] TOTP secret stored as encrypted ciphertext in DB (not plaintext)
- [ ] 2FA login flow: password correct + no MFA → direct token; 2FA enabled → MFA challenge
- [ ] QR code renders correctly in `SecuritySettingsPage.tsx`
- [ ] Backup codes work once each
- [ ] Impersonation creates `IMPERSONATION_START` audit log entry
- [ ] 5 failed logins from one IP → 429 on 6th attempt
- [ ] Security audit log visible in admin UI
- [ ] 9 tests pass
- [ ] `pnpm lint` passes

---

## ═══════════════════════════════════════════
## REGRESSION CHECKLIST
## ═══════════════════════════════════════════

- [ ] Login without 2FA still works for users who haven't enrolled
- [ ] JWT validation in search-service (ES-01) still works
- [ ] Rate limit of 10/15min (ES-01) still active on login route
- [ ] IMPERSONATE_USER permission from ES-07 correctly required on impersonation route

---

## ═══════════════════════════════════════════
## DEFINITION OF DONE
## ═══════════════════════════════════════════

- [ ] TOTP 2FA enrollment + verification flow complete
- [ ] Backup codes functional (single-use)
- [ ] Admin impersonation with audit trail
- [ ] Suspicious IP detection and blocking
- [ ] Security settings UI with session management
- [ ] 9 tests pass
- [ ] Completion report saved at `ERP-PLANNING/phase-completions/ES-19_COMPLETION.md`

---

## ═══════════════════════════════════════════
## COMPLETION REPORT TEMPLATE
## ═══════════════════════════════════════════

**Save as:** `ERP-PLANNING/phase-completions/ES-19_COMPLETION.md`

```markdown
# ES-19 Completion Report — Enterprise Security: 2FA
**Date:** [YYYY-MM-DD]
**Status:** COMPLETE

## 2FA Implementation
- TOTP library: otplib [USED]
- Secret encryption: AES-256-GCM with FIELD_ENCRYPTION_KEY [CONFIRMED]
- Backup codes: [N] codes generated on enrollment; single-use
- QR code: generated with `qrcode` library

## Security Measures
- Suspicious login: 5 failures/10min → IP blocked 1h [IMPLEMENTED]
- Impersonation audit: [IMPLEMENTED — writes to security_audit_log]
- MFA token TTL: 5 minutes, single-use [IMPLEMENTED]

## Files Changed
[Table]

## Tests: 9/9 PASS | lint: PASS | build: PASS

## Phases Unblocked
ES-20 (audit log viewer uses VIEW_AUDIT_LOG from ES-07; feature flags can gate 2FA)
```
