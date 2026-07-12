# Environment Setup — Dev / QA / Staging / Production

How to bring up a **new environment** (a fresh, empty database) from scratch: run migrations, create the first user, and provision the first real tenant. This is different from `docs/go-live-runbook.md`, which covers migrating an _existing_ business's data into an _already-provisioned_ production tenant — this doc is what happens before that tenant exists at all.

## 1. Run migrations

Apply all `packages/db-client/migrations/*.sql` against the environment's database, in order, as part of your normal deploy step. Migration `0020_es21_platform_operator.sql` is required — it seeds a reserved `platform-operations` tenant and a `PLATFORM_OPERATOR` role (holding only the `PLATFORM_TENANT_MANAGE` permission), but deliberately creates **zero users**.

## 2. Bootstrap the first PLATFORM_OPERATOR (once per environment)

```bash
DATABASE_URL="<env-db-url>" pnpm --filter @erp/tenant-service bootstrap-operator -- --email=<ops-email> --password=<strong-password>
```

This runs [`apps/tenant-service/scripts/bootstrap-platform-operator.ts`](../apps/tenant-service/scripts/bootstrap-platform-operator.ts). It refuses to run again once a `PLATFORM_OPERATOR` user exists, so it's safe to run exactly once per environment right after migrations. Log in at `/auth/login` with that email/password and `tenantId` = the id `platform-operations` got in that environment's DB (check with `SELECT id FROM tenants WHERE slug='platform-operations'` — it is **not** guaranteed to be `1` in every environment). This account can only manage tenant lifecycle; it has no sales/inventory/accounting access.

## 3. Provision the environment's first real tenant

Using the operator's token, call `POST /admin/tenants` (tenant-service):

```json
{
  "name": "QA Co",
  "slug": "qa",
  "contactEmail": "qa-admin@yourcompany.com",
  "adminFirstName": "QA",
  "adminLastName": "Admin",
  "adminPassword": "<strong-password>",
  "plan": "STARTER"
}
```

[`TenantProvisioner`](../apps/tenant-service/src/domain/TenantProvisioner.ts) creates the tenant, seeds its roles from `ROLE_DEFAULTS`, and creates one `OWNER`-role user from `contactEmail`/`adminPassword`. That OWNER account — not the platform operator — is what testers/end users actually work with day to day; it can create further users with `POST /users`.

## 4. Seed auth notification templates (per tenant)

Call `POST /api/v2/notifications/templates/seed-auth` with `{ "tenantId": <new-id> }` once per newly provisioned tenant. Without this, that tenant's forgot-password/other auth emails silently no-op (see `ERP-PLANNING/production-gap-prompts/IMPLEMENTATION-NOTES.md`). The `platform-operations` tenant itself was never seeded this way either — see the recovery script below.

## Security model — who can actually run steps 2/5

The bootstrap and password-reset scripts (`bootstrap-platform-operator.ts`, `reset-platform-operator-password.ts`) are **not exposed over HTTP** — there is no route for them, no RBAC check, no application-level auth at all. They connect straight to Postgres using `DATABASE_URL`. The only gate is infrastructure-level:

- Whoever runs them needs a checked-out copy of this repo with shell access (a CI/CD runner, a bastion host, a pod you `kubectl exec` into), **and**
- That environment's `DATABASE_URL` secret.

That is the entire trust boundary — anyone holding the DB credential and shell access can run either script, equivalent to DBA-level trust. This is intentional (the scripts exist for the chicken-and-egg case of no operator account existing yet, or one being locked out), but it means:

- **Keep `DATABASE_URL` for QA/staging/prod out of shared dev `.env` files.** In production this is already handled by Vault (see `docs/vault-rollout.md`) — the same discipline should apply to QA/staging, not just prod.
- **Restrict who can retrieve the secret** to ops/senior engineers via your secrets manager, not the general dev team.
- **Restrict DB network access** (security group/firewall) so holding the credential alone isn't sufficient without also being on a trusted network.
- Neither script writes an audit-log entry — there's no in-app record of who ran a bootstrap/reset or when. Traceability depends entirely on infra-side logs (shell history, CI job logs, DB connection logs), so treat those as the audit trail for this operation.

## 5. Recovering a locked-out/forgotten operator password

```bash
DATABASE_URL="<env-db-url>" pnpm --filter @erp/tenant-service reset-operator-password -- --email=<ops-email> --new-password=<new-password>
```

[`reset-platform-operator-password.ts`](../apps/tenant-service/scripts/reset-platform-operator-password.ts) — scoped strictly to the `platform-operations` tenant's user, so it can't accidentally touch an unrelated user in another tenant that happens to share the same email. Same security model as step 2 applies: DB-credential access is the only gate, and it force-revokes that account's existing sessions.
