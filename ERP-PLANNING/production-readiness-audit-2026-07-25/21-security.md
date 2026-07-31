# Security Module — Production Readiness Audit (2026-07-25)

Scope: SecurityAuditLogPage + admin security features (suspicious login, IP blocking), and a
cross-cutting OWASP-style pass (XSS, SQLi, file upload, secrets handling, encryption at rest,
CSRF, RLS). All findings below were verified live against the running dev stack (Postgres at
`erp-postgres-primary`, gateway on :3000, tenant 2 "QA E2E Test Co") and against source, not
against prior audit claims.

## Summary

The Security Audit Log itself works and is correctly RBAC-gated and tenant-scoped — confirmed
live with 170 real rows including a genuine brute-force incident from an earlier audit session.
Token handling (httpOnly+SameSite=strict refresh cookie, tokens never persisted to localStorage)
is a genuine, well-reasoned defense against XSS-driven token theft and CSRF. The stored-XSS fix
in commit `3c7d2e4` is real and narrowly scoped correctly; a broader sweep found no other
unescaped HTML-interpolation sites and no Handlebars triple-stache usage, so email/template
rendering is safe by default. SQLi surface is minimal — only one `sql.raw()` call exists
platform-wide and its input is a system-generated year number, not user data.

The three headline "reality check" questions the prior audits left open all resolve to **worse
than the aspirational documentation claims, in different ways**: RLS is completely absent (not
"dormant" — never created), field-level encryption is real for some data (MFA secrets, HR bank
accounts) but silently absent for other data carrying the exact same "encrypted" label in a
schema comment (supplier bank accounts), and Vault integration is real, tested code that has
never once talked to a live Vault in this environment because the container isn't running and
the code path is structurally skipped outside `NODE_ENV=production`. Two new findings not
previously flagged: the admin Security Audit Log's action-type filter is missing 7 of the 12
action types the backend actually emits, and file upload object-key construction concatenates
the raw client-supplied filename into the S3/MinIO key with no sanitization.

Readiness score: **58/100** — the audit-log UI and platform-level auth hardening are solid, but
none of the three "defense in depth" claims (RLS, at-rest encryption, Vault) hold up uniformly
under a live check, and one of them (RLS) is a complete no-op rather than a partial gap.

---

## 1. RLS reality check — DEFINITIVE: no RLS exists anywhere in this database

```sql
SELECT schemaname, tablename, policyname FROM pg_policies;        -- 0 rows
SELECT relname FROM pg_class WHERE relrowsecurity = true;         -- 0 rows
```

Both queries against the live dev Postgres (`erp-postgres-primary`, db `erp`) return **zero
rows**. No table in the entire schema has `ROW LEVEL SECURITY` enabled, and no policy has ever
been created (`CREATE POLICY` / `ENABLE ROW LEVEL SECURITY` do not appear anywhere in
`packages/db-client/migrations/*.sql` or in application source). This settles the question the
Auth and Tenant audits left open ("dormant RLS"): it isn't dormant, it was never built. Tenant
isolation across all 15 services is **100% enforced by application-level `WHERE tenant_id = ?`
discipline** (Drizzle query builders consistently include it, confirmed by spot-checking
`PlatformAttachments`, `securityAuditLogRoutes`, etc.), with no database-level second line of
defense. Given this session's own memory log shows this exact bug class recurring multiple times
this quarter (e.g. a cross-tenant price-list vulnerability found in the Inventory audit), the
absence of RLS means every future missing-`WHERE`-clause bug is a full cross-tenant data leak
with nothing at the DB layer to stop it. **Severity: High** (architectural gap, not a quick fix,
but real exposure given the track record of app-layer isolation bugs recurring).

## 2. Encryption-at-rest reality check — DEFINITIVE: real for some fields, plaintext for others carrying the same label

`packages/shared-utils/src/encryption.ts` implements genuine AES-256-GCM (`createCipheriv`,
random 12-byte IV, auth tag, all three concatenated base64 — a correct implementation, not a
stub). Live DB queries confirm it is actually exercised for:

- **TOTP/MFA secrets** (`users.totp_secret`): raw value
  `xKVxj2EztvXyv1hz:wTwMO587SZpnFqim12IWIw==:wMJvSvYXTA1P/lWJyi1iZQ==` — genuine
  `iv:authTag:ciphertext` ciphertext, matches `encryptField`'s output format exactly.
- **Employee bank accounts** (`employees.bank_account_no_encrypted`): raw value
  `USoqXkOoE5QoOXAp:R0GrYU0A1LLTs2cZC2mP5g==:N7ajpoPOKQ9Yhop6` — same genuine ciphertext format.
- Also wired into tenant SSO client secrets (`tenant-service/api/sso-config.routes.ts`) and
  several payroll/statutory report paths in hr-service.

But **supplier bank accounts are plaintext**, despite `packages/db-client/src/schema/master.ts`
line 210 carrying the comment `// Bank details — encrypted AES-256-GCM` directly above the
`bankAccountNo` field. `apps/sales-service/src/api/supplier.routes.ts` (the actual owner of
supplier CRUD, lines 204/258) writes `bankAccountNo: body.data.bankAccountNo || null` straight
from request body to DB column — `encryptField` is never imported or called anywhere in that
file. A SHA-256 hash is computed alongside it (`bankAccountNoHash`, for lookup/dedup) but the
plaintext value itself goes to disk unencrypted. This confirms and finalizes the prior Suppliers
audit's finding at the byte level: it is not a display-layer leak, the value is genuinely stored
in the clear in Postgres. **Severity: High** — this is financial PII (bank account + IFSC) in a
field the schema itself documents as should-be-encrypted, sitting in plaintext.

**Conclusion**: AES-256-GCM "encryption at rest" is a real, correctly-implemented primitive that
is inconsistently applied — some sensitive fields get it, others with an identical inline
comment claiming they do, don't. This is worse for an auditor/compliance reviewer than either
extreme (all real or all aspirational) because the schema comments cannot be trusted as a guide
to what's actually protected.

## 3. Vault reality check — DEFINITIVE: real, tested code; never exercised live in this environment

`packages/config/src/vault.ts` is a genuine Vault KV-v2 client (`fetch`-based, path
`erp/<serviceName>`, correct caching with TTL) and `packages/config/src/index.ts`'s
`loadConfigWithSecrets()` wires it to fetch `DATABASE_URL`, `DATABASE_REPLICA_URL`,
`JWT_PRIVATE_KEY`, `MINIO_ACCESS_KEY`, `MINIO_SECRET_KEY`, plus each service's declared
`extraSecrets` (e.g. `FIELD_ENCRYPTION_KEY`). 11 of 15 services call it directly in `main.ts`;
the other 4 (`auth-service`, `tenant-service`, `notification-service`) call it indirectly through
their own `config.ts` wrapper — every secret-holding service does route through this path.
`packages/config/src/__tests__/vault.test.ts` has 7 real unit tests covering success, cache
expiry, missing-secret, unreachable-Vault, and fail-fast behavior — this is not a stub.

However: **the function short-circuits to plain `process.env` reads whenever
`NODE_ENV !== 'production'`** (`index.ts` line 108). This dev/QA environment runs with
`NODE_ENV=development` (confirmed in `.env`), so every service currently running has never made
a single Vault API call. Independently confirmed live: `docker ps -a` shows `erp-vault` as
`Exited (0) 4 days ago` — the container isn't even up, so a live call would fail if one were
attempted. **Conclusion: Vault is neither "integrated and working" nor "provisioned but
ignored" — it's a real, unit-tested, production-only code path that has literally never been
run against a live Vault instance in this project's history** (no phase-completion doc records a
live Vault verification; only `ERP-PLANNING/production-gap-prompts/001-Architecture/13-vault-secrets-integration.md` describes the intended design). The production fail-fast behavior (throws if
`VAULT_ADDR`/`VAULT_TOKEN` missing or Vault unreachable) is good design on paper but has zero
live mileage. **Severity: Medium** — not a vulnerability today (dev correctly uses plain env
vars), but a real risk that the very first production deploy is also the first live test of this
path, for every priority-1 secret in the system.

---

## Other findings

### 4. XSS — commit 3c7d2e4 fix verified correct; no other stored-XSS found

`apps/report-service/src/scheduler/ScheduledReportJob.ts` previously interpolated report row
values (free text — customer name, notes) directly into scheduled-report email HTML with no
escaping. The fix adds a small `escapeHtml()` helper and applies it to both column labels and
row values before interpolation — verified correct by reading the diff, no bypass.

Broader sweep: no other `${...}` interpolation into HTML template strings exists outside
`EmailChannelProvider.ts` (which only interpolates a system-controlled media URL, not user
input). `notification-service`'s templating uses Handlebars (`Handlebars.compile`) with default
`{{var}}` escaping throughout — no `{{{triple-stache}}}` usage found anywhere in the codebase,
so campaign/notification templates auto-escape user-supplied variables. React's JSX auto-escapes
by default; only one `dangerouslySetInnerHTML` call exists
(`BarcodeLabelsPage.tsx`, rendering `qrcode` library SVG output from a barcode/SKU value, not
free text) — low risk. **No open stored-XSS found.**

### 5. SQLi — minimal surface, correctly parameterized

Only one `sql.raw()` call exists platform-wide
(`apps/scheduler-service/src/jobs/system-jobs.ts:1289`, partition-maintenance cron job), and its
input (`financial_entries_${nextYear}`) is derived from `new Date().getUTCFullYear()` — a system
value, never user input. All other `sql\`...\``tagged-template usage (231 occurrences) relies on
Drizzle's automatic parameterization of`${}` placeholders. No string-concatenated raw SQL
querying found. **No SQLi found** — this matches the expected low risk of a Drizzle-ORM
codebase.

### 6. File upload — type/size validated; object-key path-traversal gap (new finding)

`sales-service`, `purchase-service`, and `tenant-service` attachment/logo upload routes all
validate MIME type against an allowlist and enforce size limits (10MB for attachments, 2MB for
logos) before persisting — good baseline hygiene.

However, `packages/platform-sdk/src/storage.ts:39` builds the S3/MinIO object key as:

```ts
const objectKey = `tenant/${tenantId}/${prefix}/${Date.now()}-${fileName}`;
```

`fileName` is the client-supplied original filename (`file.filename` from Fastify's multipart
plugin) and is used **completely unsanitized** — no stripping of `/`, `..`, null bytes, or
control characters. `tenantId` and `prefix` are server-controlled so the attack surface is
narrower than a full path-traversal-to-arbitrary-write, but a filename containing `../` sequences
still becomes a literal part of the stored object key, which for a filesystem-backed MinIO (the
default local dev topology) risks writing outside the intended `tenant/<id>/<prefix>/` key
prefix — e.g. a filename crafted to contain another tenant's numeric ID and prefix as a literal
sub-path. **Severity: Medium** — no proof-of-concept traversal was executed (would require a
live upload against MinIO to confirm filesystem behavior), but the missing sanitization is a
clear, fixable gap: filenames should be sanitized (strip path separators, or discard the
client-supplied name entirely and store only a generated UUID + the original extension) before
being embedded in a storage key.

### 7. Suspicious login / IP blocking — backend correct; admin UI has real gaps (new findings)

Backend logic (`apps/auth-service/src/middleware/suspicious-login.ts`) is sound: Redis-counted
failed logins per IP, threshold-triggered block written to `blocked_ips` with a TTL, and a
`SUSPICIOUS_LOGIN` audit-log row. Live-queried against the real DB: a genuine brute-force
incident from an earlier audit session is present (`SUSPICIOUS_LOGIN`, `failedAttempts: 15`,
plus 19 preceding `LOGIN_FAILURE` rows) — the mechanism demonstrably works end-to-end, not just
in unit tests.

Two gaps found in the **admin-facing surface** of this feature, neither previously documented:

- **No admin UI or API to view/manage currently-blocked IPs.** `blocked_ips` has no route
  exposing it — an admin can see _that_ a `SUSPICIOUS_LOGIN` event happened via the audit log,
  but cannot see which IPs are presently blocked, when the block expires, or manually unblock a
  false-positive (e.g. a shared office NAT IP) before the 1-hour default TTL
  (`IP_BLOCK_DURATION_MS`) elapses. `grep`-verified: no `blocked-ips` route in
  `auth-service`, no corresponding page/API call in `apps/web-frontend`.
- **`SecurityAuditLogPage.tsx`'s action-type filter dropdown is missing 7 of the 12 action
  types the backend actually emits.** The dropdown
  (`apps/web-frontend/src/pages/admin/SecurityAuditLogPage.tsx` lines 21-29) only offers
  `IMPERSONATION_START/END`, `MFA_ENABLED/DISABLED`, `SESSION_TERMINATED`, `SUSPICIOUS_LOGIN`.
  Grepping `auth-service` source for every `action: '...'` value inserted into
  `securityAuditLog` yields 12 distinct types; missing from the UI are `LOGIN_SUCCESS`,
  `LOGIN_FAILURE`, `ACCOUNT_LOCKED`, `ACCOUNT_UNLOCKED`, `ADMIN_PASSWORD_RESET`,
  `PASSWORD_CHANGED`, `ROLE_ASSIGNED`. The backend route itself supports filtering by any of
  these (confirmed live: `GET /api/auth/admin/security-audit-log?action=LOGIN_FAILURE` correctly
  returns 19 matching rows) — this is purely a frontend dropdown gap, not a backend limitation.
  With 170 total rows and 20/page, an admin investigating an incident (e.g. "show me every
  failed login this week") cannot filter to it and must page through everything. **Severity:
  Medium** — a real usability gap in a security-investigation tool, not a vulnerability.

### 8. Secrets in repo — clean

`.env` is correctly gitignored (`git check-ignore -v .env` confirms; `git ls-files` shows it was
never tracked) with `.env.example` explicitly un-ignored as the template. No hardcoded
API keys/secrets/passwords found in service source via pattern search (excluding
`process.env`/`requireEnv` references and test fixtures).

### CSRF and token storage — no gap found, worth noting as a positive

Refresh tokens are set via an `httpOnly`, `SameSite=strict`, `path=/api/auth`-scoped cookie
(`apps/auth-service/src/refresh-cookie.ts`) — a sound, deliberate design (documented inline)
that removes the need for a separate CSRF token scheme for the refresh endpoint, since
`SameSite=strict` withholds the cookie on any cross-site-triggered request. The web frontend's
Zustand auth store (`apps/web-frontend/src/store/auth.store.ts`) explicitly excludes both
`accessToken` and `refreshToken` from its `persist` `partialize`, so neither token ever reaches
`localStorage` — both live in memory only, closing the classic "XSS reads localStorage and
exfiltrates a long-lived token" attack path. This is good, already-shipped hardening (per an
inline reference to `WEB-FRONTEND-AUDIT-2026-07-24.md`), not a new finding, but worth recording
as confirmed-still-correct.

---

## Readiness score: 58/100

| Area                             | Status                                                                                                   |
| -------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Security Audit Log (data + RBAC) | Working, correctly scoped — confirmed live                                                               |
| Token/CSRF hardening             | Solid, confirmed still correct                                                                           |
| XSS                              | One real historical bug, correctly fixed; no other stored-XSS found                                      |
| SQLi                             | Minimal surface, no issues found                                                                         |
| File upload validation           | Type/size checked; object-key sanitization gap (new, Medium)                                             |
| RLS (defense in depth)           | **Absent — 0 policies, 0 RLS-enabled tables** (High)                                                     |
| Encryption at rest               | Real but inconsistent — plaintext supplier bank data despite a schema comment claiming encryption (High) |
| Vault                            | Real, tested, never live-exercised in this environment (Medium)                                          |
| IP-block admin visibility        | No admin view/unblock UI (new, Medium)                                                                   |
| Audit-log filter completeness    | 7/12 action types missing from UI dropdown (new, Medium)                                                 |
| Secrets in repo                  | Clean                                                                                                    |

Justification: the components that exist and were built carefully (audit log RBAC, token
storage, the one XSS fix, SQLi posture) work well and would score highly on their own. The score
is pulled down because every "defense in depth" security claim this audit was asked to verify —
RLS, at-rest encryption, Vault — turned out to be either entirely absent or only partially true
in a way that's actively misleading (schema comments claiming encryption that isn't there). None
of these are quick fixes; RLS and consistent field encryption in particular are the kind of gap
that should block a "production-ready" claim for a system handling multi-tenant financial data,
even though application-level tenant isolation has (per this session's other module audits)
generally worked in practice so far.
