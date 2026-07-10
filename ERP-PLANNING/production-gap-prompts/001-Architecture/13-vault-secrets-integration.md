# [PG-004] Vault Secrets Integration

> Template version 1.0. Every gap-prompt file in this tree must follow this exact section order. Do not add sections; do not omit sections that apply. If a section genuinely does not apply to this gap, write "Not applicable — <one-line reason>" instead of deleting it, so the structure stays diffable across files.

**Category:** Architecture
**Priority:** High
**Complexity:** L — touches every service's config bootstrap and requires a dev/prod fallback story, but no schema/API surface
**Depends on:** none
**Blocks:** none
**Primary service(s)/package(s):** packages/config (`@erp/config`), docker-compose.yml, all 14 apps' `main.ts` bootstrap, new packages/config secrets loader

---

## Overview

- **Business objective:** every secret in this system — DB credentials, JWT signing keys, third-party API keys (MSG91, SendGrid, Meta WhatsApp, NIC e-invoice/e-way-bill) — is currently a plain environment variable, readable by anyone with shell access to a container or CI runner, with no rotation mechanism and no audit trail of who read what secret when. This is a standard pre-production-audit finding for any system handling financial/tax-authority credentials (NIC e-invoice) and PII-adjacent third-party API keys.
- **Current implementation:** `docker-compose.yml` provisions a real Vault container (`hashicorp/vault:1.18`, dev mode, `VAULT_DEV_ROOT_TOKEN_ID=dev-root-token`, healthcheck via `vault status`). `packages/config/src/index.ts`'s `AppConfig` interface already carries `vaultAddr`/`vaultToken` fields, populated from `VAULT_ADDR`/`VAULT_TOKEN` env vars in `loadConfig()`. `.env.example` documents both (`VAULT_ADDR=http://localhost:8200`, `VAULT_TOKEN=dev-root-token`).
- **Current architecture:** despite the above plumbing, **zero application code anywhere under `apps/` calls Vault** — confirmed by an exhaustive grep for `vault`/`Vault`/`VAULT` (case-insensitive) across every service's `src/` directory, which returns no matches at all. `loadConfig()`'s `vaultAddr`/`vaultToken` fields are populated but never read by anything downstream of `AppConfig` itself. Every actual secret consumer (`FIELD_ENCRYPTION_KEY`, `JWT_PRIVATE_KEY`/`JWT_PUBLIC_KEY`, `MSG91_AUTH_KEY`, `SENDGRID_API_KEY`, `WHATSAPP_ACCESS_TOKEN`, `NIC_API_KEY`/`NIC_PASSWORD`, `DATABASE_URL`) reads directly from `process.env` at each service's own config-loading point.
- **Current limitations:** this is purely aspirational infrastructure — the Vault container can be started, healthy, and completely irrelevant to the running application. There is no Vault client wrapper, no secret-path convention, no rotation strategy, and no distinction between "dev fallback to env vars" and "prod must use Vault" behavior.

## Existing Code Analysis

- **What already exists and should be reused:** `loadConfig()` / `AppConfig` (`packages/config/src/index.ts`) is the single existing config-bootstrap point every service already calls at startup — this package extends it, it does not replace it. The Vault dev-mode container and its env vars (`VAULT_ADDR`, `VAULT_TOKEN`) already exist in `docker-compose.yml`/`.env.example` and need no infra change, only a client to actually call them.
- **What should never be modified:** do not change the shape of `AppConfig`'s existing fields (`databaseUrl`, `jwtPublicKey`, etc.) — services already destructure these by name throughout their `main.ts` files; this package changes *where the value comes from* (Vault vs. env var), not the interface shape consumers see.
- **Prior related work:** none — no phase-completion report references Vault integration.

## Architecture

- **Vault client wrapper location:** `packages/config/src/vault.ts` (new file), exporting a `loadSecret(path: string, key: string): Promise<string>` function built on the official `node-vault` client (or a minimal raw `fetch`-based client against Vault's HTTP API if a new dependency is undesirable — recommend the official `node-vault` package since it is small and this touches every service's boot path, where a broken hand-rolled HTTP client would be a bad place to debug). Authenticate using the KV-v2 secrets engine at a per-tenant-irrelevant, per-service path convention: `secret/data/erp/<service-name>/<key>` (global platform secrets, not tenant-scoped — this system's secrets are operational/platform-level, not per-tenant data).
- **Which secrets migrate first (in priority order):**
  1. `DATABASE_URL` / `DATABASE_REPLICA_URL` — DB credentials, the highest-blast-radius secret in the system.
  2. `JWT_PRIVATE_KEY` (RS256 signing key) — compromise of this key means forged tokens for every tenant.
  3. `FIELD_ENCRYPTION_KEY` (AES-256-GCM key encrypting HR's PAN/bank-account fields) — compromise means decryptable PII at rest.
  4. Third-party API keys: `MSG91_AUTH_KEY`, `SENDGRID_API_KEY`, `WHATSAPP_ACCESS_TOKEN`, `NIC_API_KEY`/`NIC_USERNAME`/`NIC_PASSWORD` — lower blast radius (external service abuse, not internal data compromise) but still real secrets, migrate after the first three are proven.
- **Dev-vs-prod fallback behavior:** `loadConfig()` gains an optional async variant, `loadConfigWithSecrets(serviceName): Promise<AppConfig>`, that: in `NODE_ENV=development`/`test`, reads straight from `process.env` exactly as today (zero behavior change for local dev — no developer should need a running Vault to `pnpm dev`); in `NODE_ENV=production`, requires `VAULT_ADDR`+`VAULT_TOKEN` (or a Kubernetes service-account-based Vault auth method — out of scope detail for this pass, flag as a follow-up decision at deploy time) and fails fast (throws, refusing to boot) if a required secret can't be fetched from Vault, rather than silently falling back to a possibly-stale env var in prod. This mirrors the existing `requireEnv()` fail-fast pattern already in `packages/config/src/index.ts`.
- **Component interactions:** each service's `main.ts` changes its first line from `const config = loadConfig(serviceName)` to `const config = await loadConfigWithSecrets(serviceName)` — a one-line, mechanical change per service, with the function signature otherwise identical (same `AppConfig` shape returned).

## Database Changes

Not applicable — no schema change.

## Backend

- **New file:** `packages/config/src/vault.ts` — `VaultClient` class wrapping `node-vault`, with a `getSecret(path, key)` method and a small in-process TTL cache (60s default) to avoid a Vault round-trip on every request that indirectly touches config (most config reads happen once at boot, but some — like a rotated JWT key — may need periodic re-fetch; see Rotation below).
- **Modified file:** `packages/config/src/index.ts` — add `loadConfigWithSecrets()` alongside (not replacing) the existing synchronous `loadConfig()`, so any code path that doesn't need Vault (tests, local scripts) keeps working unchanged.
- **Modified files:** all 14 services' `main.ts` — swap the config-loading call as described above. This is the bulk of the "L" complexity — mechanical but touches every service.
- **Rotation strategy:** JWT signing keys and the field-encryption key should support rotation without a full redeploy — implement this as a periodic re-fetch (every 5 minutes, configurable) inside the `VaultClient`'s cache, with the consuming service (auth-service for JWT keys, hr-service for the field-encryption key) subscribing to a refreshed value rather than capturing it once at boot. Database credentials and third-party API keys can rotate via redeploy (simpler, acceptable given their lower rotation frequency in practice).
- **Telemetry:** log (at `warn` level, via `@erp/logger`) whenever a service falls back to an env var in a non-development `NODE_ENV`, so a misconfigured Vault integration surfaces in logs rather than silently degrading to a less-secure path.

## Frontend

Not applicable — backend-only gap; no frontend ever holds these secrets.

## API Contract

Not applicable — no new HTTP endpoints; this is a boot-time config-loading change.

## Multi-Tenant Considerations

- Not applicable in the tenant-isolation sense — these are platform-level operational secrets, not tenant data. No per-tenant secret exists in this system today (verify this remains true — if a future feature needs per-tenant third-party credentials, e.g. a tenant's own SendGrid key, that would need its own Vault path convention under `secret/data/erp/tenant/<tenantId>/<key>` and its own gap-prompt, out of scope here).

## Integration

- **All 14 backend services:** each swaps its config-bootstrap call (mechanical, one line).
- **auth-service specifically:** owns JWT key rotation subscription.
- **hr-service specifically:** owns field-encryption-key rotation subscription (its AES-256-GCM encryption of PAN/bank-account fields, per `FEATURE_INVENTORY.md` §5.7, is the highest-sensitivity data this key protects).
- **notification-service:** consumes the third-party API keys (MSG91/SendGrid/WhatsApp) migrated last, per the priority order above.
- **gst-service:** consumes NIC e-invoice/e-way-bill credentials, also migrated in the third-party-keys tier.

## Coding Standards

- Extends `@erp/config`'s existing `loadConfig()` pattern rather than introducing a second, competing config-loading convention — every service already calls this package at boot, so this is the correct extension point per the Enterprise Architecture Guidance's "reuse over rebuild."
- Uses `@erp/logger`'s `createLogger()` for the fallback-warning log, matching every other service's logging convention.

## Performance

- Vault calls are boot-time only (plus a periodic background refresh for rotating secrets) — no per-request latency impact on any API route. The in-process TTL cache prevents a Vault outage from cascading into per-request failures for already-cached secrets.

## Security

- Directly closes a real, currently-live gap: plain-env-var secrets in a system handling GST filings (NIC credentials), payroll PII (field-encryption key), and financial data (DB credentials). Fail-fast-in-production behavior (refuse to boot rather than silently degrade) is the correct posture for a secrets-management gap — matches OWASP API Security Top 10's API8:2023 (Security Misconfiguration) remediation guidance.
- The Vault dev-mode root token (`dev-root-token`) must never be used outside local development — call this out explicitly in the rollout runbook this package should produce (see Deliverables) so a production Vault deployment uses a real auth method (AppRole or Kubernetes auth), not a static root token.

## Testing

- New `packages/config/src/__tests__/vault.test.ts`: mock the Vault HTTP API (or run against the real dev-mode Vault container this repo's `docker-compose.yml` already provides, matching the "real Postgres+Redis containers" convention this repo's CI already uses for other integration tests) — assert `loadSecret()` fetches and caches correctly, assert TTL expiry triggers a re-fetch, assert the production fail-fast behavior when Vault is unreachable.
- Extend each of the 14 services' existing startup/health-check tests (where they exist) to assert `loadConfigWithSecrets()` returns the same `AppConfig` shape as `loadConfig()` did before, in `NODE_ENV=test` (env-var fallback path), to confirm zero behavior change for the test suite itself.

## Acceptance Criteria

- [x] `packages/config/src/vault.ts` exists and `loadConfigWithSecrets()` is exported from `@erp/config`.
- [x] In `NODE_ENV=development`/`test`, every service boots identically to today with zero Vault dependency (verified by re-running every migrated service's full existing test suite, 2026-07-10 — all pass, no Vault container involved).
- [ ] In a `NODE_ENV=production`-simulated run with the Vault dev container populated with the four priority-1 secrets (DB URL, JWT key, field-encryption key) at their documented paths, at least auth-service and hr-service boot successfully reading from Vault instead of env vars (verified manually, since a full prod-mode CI run isn't in scope here). **Still not done** — Docker Desktop unreachable in this environment across all three implementation sessions (2026-07-10); only verified against a mocked Vault HTTP API in `vault.test.ts`. Do this once Docker is available; see `docs/vault-rollout.md`.
- [x] If Vault is unreachable in a `NODE_ENV=production`-simulated run, the service fails to boot with a clear error naming the missing secret, rather than silently falling back to `process.env` (verified via mocked-Vault unit tests, not yet against a real container — see item above).
- [x] `pnpm --filter @erp/config test` passes including the new Vault tests.

## Deliverables

- **Files to create:** `packages/config/src/vault.ts`, `packages/config/src/__tests__/vault.test.ts`, a short rollout runbook (markdown, location: `ERP-PLANNING/` alongside this file or a new `docs/vault-rollout.md` — pick the location consistent with where other runbook-style docs already live in this repo at implementation time).
- **Files to modify:** `packages/config/src/index.ts` (add `loadConfigWithSecrets`), all 14 services' `main.ts` (swap config-bootstrap call), `.env.example` (document the Vault secret-path convention alongside existing `VAULT_ADDR`/`VAULT_TOKEN` vars).
- **Migrations:** none.
- **APIs added/changed:** none.
- **Events added/changed:** none.
- **Tests added:** `vault.test.ts`; startup-path assertions added to services' existing test suites where feasible.

---

## Context Preservation (for a fresh AI session with no prior history)

**Previous Work Summary:** Vault runs in `docker-compose.yml` (dev mode) and `@erp/config`'s `AppConfig` already carries `vaultAddr`/`vaultToken` fields — but no application code has ever called Vault. Every secret today is a plain env var read directly by each service's config bootstrap.

**Current Objective:** build a small Vault client wrapper in `@erp/config`, migrate the highest-value secrets (DB creds, JWT signing key, field-encryption key, then third-party API keys) to be fetched from Vault in production while falling back to env vars in dev/test with zero behavior change, and implement periodic re-fetch for the two rotation-sensitive secrets (JWT key, field-encryption key).

**Architecture Snapshot:** `loadConfig(serviceName)` in `packages/config/src/index.ts` is the one function every service's `main.ts` already calls at boot; extend it with an async `loadConfigWithSecrets()` sibling rather than replacing it.

**Completed Components:** the Vault container and its env-var plumbing (infra-only, already done, needs no further work).

**Pending Components:** per-tenant secrets (if ever needed) are explicitly out of scope — this system currently has only platform-level secrets.

**Known Constraints:** local dev must never require a running Vault — the env-var fallback path in non-production `NODE_ENV` is mandatory, not optional.

**Coding Standards:** extends `@erp/config`'s existing convention; no new config-loading pattern introduced.

**Reusable Components:** `loadConfig()`/`AppConfig`/`requireEnv()` (`packages/config/src/index.ts`), `@erp/logger`'s `createLogger()`.

**APIs Already Available:** not applicable.

**Events Already Available:** not applicable.

**Shared Utilities:** `@erp/config`, `@erp/logger`.

**Feature Flags:** not applicable.

**Multi-Tenant Rules:** not applicable — platform-level secrets only.

**Security Rules:** production must fail fast on an unreachable Vault for a required secret, never silently fall back to env vars.

**Database State:** not applicable.

**Testing Status:** no Vault-related test exists today — this package adds the first ones.

**Next Session Plan:** given L complexity, split as: (1) session A — `vault.ts` client + `loadConfigWithSecrets()` + its tests; (2) session B — migrate auth-service and hr-service (the two rotation-sensitive, highest-priority secrets) end-to-end and verify manually against the dev Vault container; (3) session C — migrate the remaining 12 services' `main.ts` bootstrap calls (mechanical) and the third-party-key tier.

**Prompt for the Next Session:** "Implement `ERP-PLANNING/production-gap-prompts/001-Architecture/13-vault-secrets-integration.md` (PG-004), starting with session A (Vault client + loadConfigWithSecrets + tests) per the Next Session Plan. Re-verify that no application code calls Vault yet before starting, per the roadmap's standing re-verification rule."
