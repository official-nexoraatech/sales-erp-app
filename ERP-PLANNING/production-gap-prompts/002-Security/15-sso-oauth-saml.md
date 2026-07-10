# [PG-020] SSO/OAuth/SAML Integration

> Template version 1.0. Every gap-prompt file in this tree must follow this exact section order. Do not add sections; do not omit sections that apply. If a section genuinely does not apply to this gap, write "Not applicable — <one-line reason>" instead of deleting it, so the structure stays diffable across files.

**Category:** Security
**Priority:** Medium
**Complexity:** L — a real net-new auth path added alongside (not replacing) a mature existing session/2FA/impersonation model, without disturbing any of it
**Depends on:** none
**Blocks:** none
**Primary service(s)/package(s):** apps/auth-service, apps/web-frontend/src/pages/auth

---

## Overview

- **Business objective:** this ERP has zero SSO/OAuth/SAML support — `auth-service` is entirely self-contained (Argon2id password hashing, RS256 JWT, TOTP 2FA, rotating refresh tokens). For most of this product's current customer profile (SMB clothing retailers), that's plausibly fine. But any enterprise customer with an existing corporate identity provider (Okta, Azure AD, Google Workspace) will expect to log in via their existing SSO, not a separate password — and will often make it a hard procurement requirement. This gap blocks that segment of customers entirely, not just as an inconvenience.
- **Current implementation:** confirmed by grep across `apps/auth-service` for `passport|saml|oauth2|OIDC|openid` — zero matches. There is no partial implementation, no stub, no abandoned attempt; this is a clean net-new capability.
- **Current architecture:** `auth-service` owns the entire identity lifecycle today: password hashing, JWT issuance, refresh-token rotation (SHA-256-hashed at rest), per-device session tracking, TOTP 2FA enrollment, account lockout, brute-force blocking, impersonation (PG-018), business-rule engine. Any SSO addition must slot in as an *additional* login path that still terminates in the exact same JWT/session/refresh-token model everything else in this app already depends on — a federated login should still result in a normal, indistinguishable-to-the-rest-of-the-app session.
- **Current limitations:** this is entirely absent, not broken — there is no specific bug to fix, only a capability to add. Because it's explicitly scoped in the master roadmap as a Phase 9 (enterprise) enhancement rather than a Phase 0-8 production-readiness blocker, this package should be read as "here's the plan for when a real enterprise deal needs it," not "this must ship before go-live."

## Existing Code Analysis

- **What already exists and should be reused:** the entire post-authentication pipeline — JWT issuance (`packages/platform-sdk`'s signing logic), refresh-token rotation, per-device session tracking, 2FA state, and every downstream `requirePermission()` check. None of this should change; SSO is purely a new way to *arrive at* an authenticated session, not a new session model.
- **What should never be modified:** the existing password + TOTP 2FA login path must keep working unchanged for tenants that don't opt into SSO — this is additive, and for most tenants (SMB retailers with no corporate IdP) will likely never be used at all.
- **Prior related work:** none.

## Architecture

- **Recommended approach:** OIDC (OpenID Connect) as the primary protocol — it's the modern standard most IdPs (Okta, Azure AD, Google Workspace, Auth0) support cleanly, and maps naturally onto this app's existing JWT model (an OIDC ID token can be validated and its claims mapped to a local user record, then a normal app-native JWT issued from that point on — the app never needs to trust or pass through the IdP's token beyond the initial handshake). SAML2 support can be a second, later addition for the subset of enterprise IdPs that only offer SAML (some legacy Azure AD / ADFS configurations) — don't build both simultaneously; ship OIDC first and treat SAML as a follow-up scoped separately if a real deal requires it.
- **Per-tenant configuration:** SSO must be an opt-in, per-tenant configuration (client ID/secret, issuer URL, at minimum) — reuse the existing tenant feature-flag/settings infrastructure (`einvoice_enabled`, `whatsapp_enabled`, etc. pattern) for an `sso_enabled` flag plus a new tenant-scoped SSO-config table, rather than a single, global SSO configuration that would only support one IdP for the whole platform.
- **Login flow:** on the login page, if the tenant (identified by subdomain, email domain, or an explicit tenant-selection step — confirm which tenant-identification mechanism this app's login flow already uses before designing this, since it changes how "which IdP to redirect to" gets decided) has SSO configured, show an "Sign in with SSO" option alongside (not replacing) the existing email/password form. On successful OIDC callback, map the IdP's verified email/subject claim to an existing local user record (matched by email within that tenant) — do not auto-provision new users from SSO in v1 (a user must already exist, created through the normal admin user-management flow); auto-provisioning ("just-in-time" user creation) is a reasonable v2 enhancement but expands blast radius (a misconfigured IdP could create unintended accounts) and should be a deliberate, separate decision.
- **2FA interaction:** decide explicitly whether SSO-authenticated sessions still require this app's own TOTP 2FA on top of the IdP's own authentication strength (many enterprise customers will already enforce MFA at the IdP level and consider a second MFA prompt redundant/annoying) — recommend making this tenant-configurable (`sso_bypasses_local_mfa` flag) rather than a single hardcoded behavior, since different enterprise customers will have different expectations here.
- **Impersonation interaction:** confirm impersonation (PG-018) continues to work unchanged for SSO-authenticated users — since impersonation issues its own app-native token independent of how the target user originally logged in, this should already be compatible without extra work, but verify explicitly rather than assuming.

## Database Changes

- New table: tenant-scoped SSO configuration (`tenant_id`, `provider` enum, `issuer_url`, `client_id`, `client_secret` — encrypted at rest, following this codebase's existing field-level-encryption convention already used for PAN/bank data in hr-service, rather than storing it in plaintext, since a client secret is at least as sensitive), `enabled` boolean, `bypass_local_mfa` boolean.
- New column or table linking a local `users` row to an external IdP subject claim (`sso_subject`, unique per tenant+provider) for the email-based matching described above.

## Backend

- New routes in `auth-service`: `GET /auth/sso/:tenantId/login` (redirect to the tenant's configured IdP authorization endpoint), `GET /auth/sso/callback` (OIDC callback handler: validate ID token signature against the IdP's published JWKS, extract email/subject claims, match to an existing local user, issue this app's own normal JWT + refresh token exactly as the password-login path does today).
- Tenant-service (or auth-service, whichever already owns tenant-level settings CRUD): CRUD routes for the new SSO-config table, gated on an admin-level permission (a new `SSO_CONFIG_MANAGE`-shaped constant, added correctly from day one — do not repeat the PG-014 dead-constant mistake by defining it without immediately wiring a real route to check it).
- Reuse the existing account-lockout/brute-force-blocking infrastructure's *absence* correctly — SSO logins bypass password-guessing risk entirely (the IdP handles that), so this new path should not be subject to the same per-IP password-attempt throttling, but should have its own reasonable rate limiting on the callback route to prevent callback-endpoint abuse.

## Frontend

- Login page: conditionally render an "Sign in with SSO" button/flow based on tenant SSO configuration (requires resolving which tenant a not-yet-authenticated user belongs to before rendering the login form — confirm the existing mechanism, likely a tenant-slug in the URL or an initial "enter your organization" step).
- New admin settings page (or a tab within existing Organization Settings): SSO configuration form (issuer URL, client ID/secret, enable toggle, bypass-local-MFA toggle), gated on the new `SSO_CONFIG_MANAGE` permission.

## API Contract

- `GET /auth/sso/:tenantId/login` → `302` redirect to IdP.
- `GET /auth/sso/callback?code=...&state=...` → on success, sets the same refresh-token cookie/response shape the existing password-login route uses, then redirects to the app; on failure (unmatched user, invalid token), redirects to login with an error state — explicitly does NOT auto-create a user (v1 scope).
- New CRUD for tenant SSO config, admin-gated.

## Multi-Tenant Considerations

- SSO configuration is entirely per-tenant — one tenant's IdP settings must never be reachable or inferable by another tenant. The `tenantId` in the login-initiation URL must be validated against the requesting context before redirecting to any configured IdP, to prevent an open-redirect-via-tenant-confusion issue.

## Integration

- Purely `auth-service` (new routes) and `web-frontend` (new UI); no other backend service is touched, since every other service already just trusts `auth-service`'s issued JWT regardless of how the session originated.

## Coding Standards

- Reuses the existing JWT/refresh-token issuance code path as the terminal step of SSO login (no new session/token model) and the existing field-level-encryption convention for the new client-secret column.

## Performance

Not applicable — SSO login is a low-frequency, interactive-only flow.

## Security

- OWASP-relevant: open-redirect risk (validate `tenantId`/`state` parameters carefully on the callback route), JWKS-signature-validation correctness (must actually validate the IdP's signed ID token, not just trust unsigned claims), and secret-at-rest protection for the stored client secret (must use the existing encryption convention, not plaintext).
- Explicit v1 decision to not auto-provision users on first SSO login reduces the blast radius of IdP misconfiguration.

## Testing

- Unit tests for OIDC callback handling (mock IdP responses: valid token → session issued; invalid signature → rejected; unmatched email → rejected without creating a user).
- Integration test for the tenant-scoped SSO-config CRUD, permission-gated correctly from the start.

## Acceptance Criteria

- [ ] A tenant with SSO configured can log in via their IdP and receive a normal app JWT/refresh-token session, indistinguishable downstream from a password login.
- [ ] A tenant without SSO configured sees no change to their existing login experience.
- [ ] An IdP-authenticated identity with no matching local user is rejected, not auto-provisioned (v1 scope).
- [ ] SSO client secrets are stored encrypted at rest, not in plaintext.
- [ ] Impersonation (PG-018) continues to work unchanged for users who originally logged in via SSO.

## Deliverables

- **Files to create:** `apps/auth-service/src/routes/sso.routes.ts` (or equivalent), SSO-config CRUD routes, a new OIDC-client helper module, `web-frontend`'s SSO login button/flow and admin SSO-config page.
- **Files to modify:** `packages/db-client` schema (new SSO-config table + `sso_subject` column/table), `packages/shared-types/src/permissions.ts` (new `SSO_CONFIG_MANAGE`-shaped constant, wired to a real route immediately), tenant-service or auth-service settings routes (whichever owns this).
- **Migrations:** new SSO-config table, new `sso_subject` linking column/table.
- **APIs added/changed:** new SSO login/callback routes, new SSO-config CRUD.
- **Events added/changed:** none required, though an audit-log event for SSO-config changes (mirroring existing audit conventions for sensitive settings changes) is reasonable to add.
- **Tests added:** OIDC callback unit tests, SSO-config CRUD permission tests.

---

## Context Preservation (for a fresh AI session with no prior history)

**Previous Work Summary:** `auth-service` is entirely self-contained today (password + TOTP 2FA + JWT + refresh tokens); zero SSO/OAuth/SAML code exists anywhere in the codebase — confirmed by grep, not a partial/abandoned attempt.

**Current Objective:** add OIDC-based SSO as an additional, tenant-opt-in login path that terminates in the exact same JWT/refresh-token session model every other login path already uses, without auto-provisioning users in v1 and without disturbing the existing password/2FA/impersonation flows.

**Architecture Snapshot:** JWT + rotating refresh tokens is the app-wide session model every downstream service trusts; tenant-scoped feature flags already exist as a pattern to reuse for `sso_enabled`; field-level encryption already exists (hr-service PAN/bank data) as the pattern to reuse for storing SSO client secrets.

**Completed Components:** none — this is entirely net-new.

**Pending Components:** SAML2 support (explicitly deferred to a later, separate package if a real deal requires it); JIT user auto-provisioning (explicitly deferred past v1).

**Known Constraints:** this is a Phase 9 (enterprise) enhancement per the master roadmap, not a production-readiness blocker — don't let it consume priority over Phase 0-8 items unless a specific customer commitment changes that.

**Coding Standards:** OIDC via a standard, well-maintained library (do not hand-roll JWKS validation); reuses existing JWT-issuance and field-level-encryption conventions.

**Reusable Components:** the existing JWT/refresh-token issuance logic (`packages/platform-sdk`), the existing per-tenant feature-flag pattern, the existing field-level-encryption helper (hr-service).

**APIs Already Available:** the existing password-login route as the terminal-step template (SSO callback should issue tokens identically).

**Events Already Available:** the existing audit-logging convention, if extended to SSO-config changes.

**Shared Utilities:** `@erp/sdk` (JWT issuance), `@erp/types` (new permission constant).

**Feature Flags:** new `sso_enabled` (per-tenant), `sso_bypasses_local_mfa` (per-tenant, if that design is adopted).

**Multi-Tenant Rules:** SSO config and the `tenantId` in the login-initiation URL must be validated to prevent cross-tenant open-redirect or config leakage.

**Security Rules:** new `SSO_CONFIG_MANAGE`-shaped permission, wired to a real route from day one (learn from PG-014's dead-constant lesson).

**Database State:** requires two schema additions (SSO-config table, subject-linking column/table) — no existing table reused as-is.

**Testing Status:** zero existing coverage (capability doesn't exist yet).

**Next Session Plan:** given Complexity L, split as: session A — schema + tenant SSO-config CRUD + admin UI; session B — OIDC login/callback routes + JWT issuance integration; session C — frontend login-page SSO button + end-to-end manual verification with a real or sandbox IdP (e.g. a free-tier Okta/Auth0 dev tenant).

**Prompt for the Next Session:** "Implement `ERP-PLANNING/production-gap-prompts/002-Security/15-sso-oauth-saml.md` (PG-020). This is a Phase 9 enterprise enhancement, not a production-readiness blocker — confirm with the user/product owner that a specific deal or requirement justifies prioritizing it now before starting. If confirmed, start with session A (schema + tenant config CRUD) since everything else depends on knowing how a tenant's SSO settings are structured and stored."
