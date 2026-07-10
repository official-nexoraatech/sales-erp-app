# Vault Secrets Rollout (PG-004)

Status: Sessions A, B, C complete — every one of the 14 services' boot paths now sources `DATABASE_URL`/`DATABASE_REPLICA_URL`/`JWT_PRIVATE_KEY` (and, for `auth-service`/`hr-service`, `FIELD_ENCRYPTION_KEY`) from Vault in production, falling back to plain env vars in dev/test. `api-gateway` is an unimplemented stub (`export {}` only) — nothing to migrate there. Third-party API keys (MSG91/SendGrid/WhatsApp/NIC) are a deliberate, not-yet-done follow-up — see below.

## What exists now

- `packages/config/src/vault.ts` — `VaultClient`, a minimal KV-v2 client built on Node's native `fetch` (no `node-vault` dependency — `@erp/config` has zero runtime dependencies today and is imported at boot by every service, so a new dependency here has an outsized blast radius). In-process cache, 60s default TTL.
- `packages/config/src/index.ts` — `loadConfigWithSecrets(serviceName, options?)`, an async sibling of `loadConfig()`:
  - `NODE_ENV` other than `production`: identical to `loadConfig()`, zero Vault dependency.
  - `NODE_ENV=production`: requires `VAULT_ADDR`/`VAULT_TOKEN` (read directly from `process.env`, not `loadConfig()`'s dev-default-carrying fields) and fetches `DATABASE_URL`, `DATABASE_REPLICA_URL`, `JWT_PRIVATE_KEY` from `secret/data/erp/<serviceName>`, overriding those three `AppConfig` fields. Throws immediately, naming the missing secret, if Vault is unreachable or a key is absent — no silent fallback to `process.env` in production.
  - `options.extraSecrets`: an array of env-var names that aren't `AppConfig` fields (e.g. `FIELD_ENCRYPTION_KEY`). In production, each is fetched from the same `erp/<serviceName>` path and **written back into `process.env`** under the same key — so pre-existing ad hoc `requireEnv(key)` call sites elsewhere in the service pick up the Vault-sourced value with no changes at the call site. This is how `FIELD_ENCRYPTION_KEY` is handled for both `auth-service` and `hr-service` (see below) without threading config through 6+ call sites.

## Services migrated (Session B)

- **`auth-service`** (`src/config.ts`, `src/main.ts`): `loadAuthConfig()` now calls `await loadConfigWithSecrets('auth-service', { extraSecrets: ['FIELD_ENCRYPTION_KEY'] })` instead of `loadConfig()`. Also removed a since-redundant `jwtPrivateKey`/`jwtPublicKey` override that re-read `process.env` after `base` already provided the (potentially Vault-sourced) value — left in place, it would have clobbered the Vault value back to an empty string in production.
- **`hr-service`** (`src/main.ts`): bootstrap now calls `await loadConfigWithSecrets('hr-service', { extraSecrets: ['FIELD_ENCRYPTION_KEY'] })` instead of `requireEnv('DATABASE_URL')` + ad hoc env reads. `FIELD_ENCRYPTION_KEY`'s 6 existing `requireEnv('FIELD_ENCRYPTION_KEY')` call sites (`employee.routes.ts` x2, `payroll.routes.ts` x3, `Form16Service.ts`, `PayrollEngine.ts` x2) were **not** touched — they keep working via the `process.env` write-back described above.

**Not yet verified live:** Docker Desktop is not running in this environment (`docker ps` fails to reach the daemon), so the acceptance criterion "auth-service and hr-service boot successfully reading from Vault instead of env vars, verified manually against the dev Vault container" is **not yet done**. What's verified instead: 10 unit tests in `vault.test.ts` against a mocked Vault HTTP API (fetch/cache/TTL/missing-secret/unreachable/extraSecrets), plus `tsc --noEmit` clean for `@erp/config`, `auth-service`, `hr-service`. Do the real manual boot-against-Vault check once Docker is available.

## Services migrated (Session C)

The remaining 12 services — `accounting-service`, `gst-service`, `inventory-service`, `production-service`, `purchase-service`, `sales-service`, `report-service`, `scheduler-service`, `search-service`, `event-service`, `notification-service`, `tenant-service` — each swapped their `requireEnv('DATABASE_URL')` (or, for `search-service`, also `requireEnv('ELASTICSEARCH_URL')`) for `await loadConfigWithSecrets(serviceName)`. `notification-service` and `tenant-service` have their own local `config.ts` wrappers (`loadNotificationConfig()`/`loadTenantConfig()`, the same shape as `auth-service`'s `loadAuthConfig()`) — those became `async` and now build on `loadConfigWithSecrets()` instead of `requireEnv()` directly. `api-gateway`'s `main.ts` is a one-line stub (`export {}` — "implementation in later phases") with no config to migrate.

None of these 12 services called `loadConfig()`/`AppConfig` before this session — same finding as `hr-service` in Session B, just confirmed across the entire codebase. The doc's "each service's main.ts changes its first line from `loadConfig()` to `loadConfigWithSecrets()`" description doesn't match any service in this repo; every one uses its own bespoke `requireEnv()`/raw-`process.env` bootstrap, and the actual edit was "swap the `DATABASE_URL` source, leave everything else in that service's config untouched."

**Deliberately not done — third-party API keys:** `gst-service`'s `NIC_API_KEY`/`NIC_USERNAME`/`NIC_PASSWORD` (read via plain `process.env[...]` in `EInvoiceService.ts`/`EwayBillService.ts`, with a runtime `BusinessError` thrown only when e-invoice/e-way-bill features are actually invoked) and `notification-service`'s `MSG91_AUTH_KEY`/`SENDGRID_API_KEY`/`WHATSAPP_ACCESS_TOKEN` (which default to `'test_key'`-style placeholders today, not `requireEnv()`) were **not** added as Vault `extraSecrets`. Doing so would flip these from "optional, only breaks the specific feature that uses it" to "hard-required at boot" for services that today boot fine without them — a real production-behavior change, not a mechanical one, and exactly the tier the original doc says to migrate "after the first three are proven." Left for a deliberate follow-up decision, not silently skipped.

**Verification:** all 12 services' `tsc --noEmit` clean; each service's full existing test suite re-run with zero regressions (accounting-service 17/17, gst-service 23/23, inventory-service 22/22, production-service 5/5, purchase-service 25/25, sales-service 63/63, report-service 118/118, scheduler-service 45/45, search-service 67/67, event-service 28/28, notification-service 7/7, tenant-service 14/14 — all passing, skips are pre-existing).

## Vault path convention

KV-v2, one secret document per service: `secret/data/erp/<service-name>`, containing keys named after the env var they replace (e.g. `DATABASE_URL`, `JWT_PRIVATE_KEY`). Write with, e.g.:

```
vault kv put secret/erp/auth-service DATABASE_URL=... DATABASE_REPLICA_URL=... JWT_PRIVATE_KEY=...
```

## Deviation from the original gap-prompt

- **Logging library:** the gap-prompt calls for a `@erp/logger`-based warn log on env-var fallback in production. `@erp/logger` already depends on `@erp/config` (for `loadConfig()`'s `logLevel` etc.), so `@erp/config` importing `@erp/logger` back would be circular. `loadConfigWithSecrets()` doesn't need this log anyway under the implemented design — production has no fallback path, it fails fast instead — so no warn-log call was added at all.
- **`FIELD_ENCRYPTION_KEY`** (the gap-prompt's priority-3 secret) is **not** part of `AppConfig`/`loadConfig()` today. It's read ad hoc via `requireEnv('FIELD_ENCRYPTION_KEY')` at ~7 call sites in `hr-service` (`employee.routes.ts`, `payroll.routes.ts`, `Form16Service.ts`, `PayrollEngine.ts`) plus separately in `auth-service/src/config.ts`. Migrating it to Vault is not mechanical the way `DATABASE_URL`/`JWT_PRIVATE_KEY` are — it needs its own design decision (add a field to `AppConfig`, or a small helper hr-service/auth-service call directly) before Session B touches hr-service. Flagging this now so Session B doesn't assume it's already wired through `AppConfig`.

## Rollout steps (production)

1. Deploy Vault with a real auth method (AppRole or Kubernetes auth) — **never** the dev-mode root token (`dev-root-token`) used locally.
2. Populate `secret/erp/<service-name>` for all 13 implemented services, at minimum `DATABASE_URL`, `DATABASE_REPLICA_URL`, `JWT_PRIVATE_KEY`; add `FIELD_ENCRYPTION_KEY` for `auth-service` and `hr-service`.
3. Set `VAULT_ADDR`/`VAULT_TOKEN` (or the chosen auth method's equivalent) in the production environment.
4. All 13 implemented services already call `loadConfigWithSecrets()` — nothing left to swap.
5. Verify boot fails, naming the missing secret, if a required path is absent — don't skip this check; it's the whole point of the fail-fast design.

## Not done yet

- Rotation/re-fetch subscription (JWT key, field-encryption key) — the `VaultClient` cache TTL supports periodic re-fetch, but no service subscribes to a refreshed value yet. Not in either PG-004's Acceptance Criteria or any session's scope; flagging as a genuine follow-up, not an oversight.
- Third-party API keys (MSG91/SendGrid/WhatsApp/NIC) — deliberately deferred, see Session C notes above; would change currently-optional keys into hard boot requirements.
- Live manual verification against a running Vault container — Docker unavailable in this environment across Sessions A, B, and C. Unit tests against a mocked Vault HTTP API are the only verification so far.
- `api-gateway` has no implementation at all yet (`export {}` stub) — revisit once it's built.
