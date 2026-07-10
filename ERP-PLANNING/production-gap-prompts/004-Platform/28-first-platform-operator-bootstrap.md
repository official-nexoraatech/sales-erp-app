# [PG-030] First Platform-Operator Bootstrap Mechanism

> Template version 1.0. Every gap-prompt file in this tree must follow this exact section order. Do not add sections; do not omit sections that apply. If a section genuinely does not apply to this gap, write "Not applicable — <one-line reason>" instead of deleting it, so the structure stays diffable across files.

**Category:** Platform
**Priority:** High
**Complexity:** S — one CLI script, tightly guarded by a zero-existing-operator check; no new table, no new route required for the minimum viable fix (a gated API endpoint is offered as an alternative, not an addition).
**Depends on:** none
**Blocks:** none
**Primary service(s)/package(s):** apps/tenant-service, packages/db-client

---

## Overview

- **Business objective:** `PLATFORM_TENANT_MANAGE` is the one permission that can provision, suspend, activate, or close any tenant on the platform. Today, nothing can create the first user who holds it — meaning the very first deployment of this platform has no legitimate, auditable way to get a working platform-operator account. Confirmed and flagged as a known gap by the phase that introduced the role itself.

- **Current implementation:** Confirmed by reading `packages/db-client/migrations/0020_es21_platform_operator.sql` — its own header comment states: *"No user is seeded here (see ES-21_COMPLETION.md for why and for the manual bootstrap steps to create the first platform-operator user)."* The migration seeds a reserved `platform-operations` tenant (`slug = 'platform-operations'`) and a `PLATFORM_OPERATOR` role scoped to it, holding only `PLATFORM_TENANT_MANAGE` — but zero `users` rows. `ERP-PLANNING/phase-completions/ES-21_COMPLETION.md` (lines 22-29) documents the actual current process: an operator manually hashes a password with a one-off `node -e "require('argon2').hash(...)"` command, then hand-writes `INSERT INTO users ...` and `INSERT INTO user_roles ...` SQL directly against the `platform-operations` tenant's id looked up via `SELECT id FROM tenants WHERE slug = 'platform-operations'`. That same completion report's "Known Issues / Deferred" section (line 90) explicitly flags this as unresolved: *"Platform-operator user provisioning has no automated bootstrap... A future phase should decide whether this warrants a proper platform-admin provisioning flow or a documented one-time manual step is acceptable long-term."* This package is that decision being made and implemented.

- **Current architecture:** Every other user-creation path in this codebase (`TenantProvisioner.createAdminUser()` for tenant admin users, `POST /users` in auth-service for ordinary users) is tenant-scoped and requires an already-authenticated caller with sufficient permission (`USER_MANAGE` or equivalent) to invoke it — there is no "first user of a system" bootstrap pattern anywhere else in this codebase to copy, because every other tenant *does* get its first user automatically via `TenantProvisioner.createAdminUser()` (called from within `provision()`, `apps/tenant-service/src/domain/TenantProvisioner.ts:236-293`, which hashes the password with the same Argon2id parameters this package should reuse). The `platform-operations` "tenant" is a special case precisely because it is not provisioned through the normal `TenantProvisioner.provision()` flow at all — it is seeded directly via SQL migration, bypassing the admin-user-creation step entirely.

- **Current limitations:** No CLI script, no seed script, and no gated API endpoint exists to create a `PLATFORM_OPERATOR` user. The only documented path is manual `argon2.hash()` + raw SQL, which: (a) requires direct database access (fine for a single self-hosted deployment, unworkable in a managed/hosted-service context where operators shouldn't need raw DB credentials), (b) has no built-in guard against being run twice or by mistake in a way that creates unintended additional platform-level accounts, and (c) leaves no audit trail (the existing `PlatformAuditLogger` records nothing about this, since it happens outside all API/service code).

## Existing Code Analysis

- **What already exists and should be reused:**
  - `TenantProvisioner.createAdminUser()`'s Argon2id hashing parameters (`apps/tenant-service/src/domain/TenantProvisioner.ts:237-242`: `argon2.argon2id`, `memoryCost: 65536`, `timeCost: 3`, `parallelism: 4`) — reuse the exact same parameters for the bootstrap operator's password, not a different hashing config.
  - The `platform-operations` tenant + `PLATFORM_OPERATOR` role, already seeded by migration `0020_es21_platform_operator.sql` — this package only needs to find that tenant/role (`SELECT id FROM tenants WHERE slug = 'platform-operations'`, `SELECT id FROM roles WHERE tenant_id = ? AND name = 'PLATFORM_OPERATOR'`), never re-create it.
  - `user_roles`/`user_branches`-style raw insert pattern already used in `TenantProvisioner.createAdminUser()` (lines 280-289, raw `db.execute(...)` inserts) — note `platform-operations` has no branches (it isn't a real operating tenant), so only the `user_roles` insert is needed, not a `user_branches` one.
  - Once one `PLATFORM_OPERATOR` exists, `ES-21_COMPLETION.md` (line 29) already confirms the follow-on path: *"Subsequent operators can then be created normally via `POST /users` by an existing platform operator, since that route's self-escalation guard... only blocks granting permissions the caller doesn't already hold."* This package therefore only needs to solve the **very first** operator — everything after that already works via existing, normal, audited user-creation flows. This is exactly why the package is scoped Small, not Medium/Large.

- **What should never be modified:** `packages/db-client/migrations/0020_es21_platform_operator.sql` itself — it deliberately does not seed a user, for the exact reason it states (hashing inside a raw SQL migration means committing a fixed or predictable password hash to git, which is worse than not seeding at all). This package must not "fix" that migration by adding a hardcoded user to it. The normal `POST /users` route and its self-escalation guard (auth-service) are out of scope — they already work correctly for every operator after the first.

- **Prior related work:** `ES-21_COMPLETION.md` is the direct origin of this gap and the primary source for this document — it did the analysis, made the "don't seed a password hash in SQL" call correctly, and explicitly deferred the automation decision to a future phase. This package is that future phase.

## Architecture

- **Chosen mechanism: a one-time, gated CLI script**, not a gated API endpoint, for these reasons:
  - A gated *API* endpoint (`POST /admin/bootstrap-platform-operator`, reachable with no auth token, only guarded by "zero platform operators exist yet") is a genuinely dangerous shape for an unauthenticated network-reachable endpoint to have in production — even gated by a one-time check, it is a standing attack surface for as long as the service is deployed with zero operators seeded (e.g. a fresh production deploy before anyone has run the bootstrap step is a live window where anyone who can reach the service over the network could race to create the first operator account). A CLI script run against the database/service host directly has no such network-exposure window — it requires the same level of access (server/deployment access) that creating the underlying database already requires.
  - This mirrors how the `platform-operations` tenant itself is bootstrapped today — via a migration/deployment-time action, not a runtime API call — so a CLI script is the more consistent shape, not a new paradigm.
  - **If the team's actual deployment model is different** (e.g. a fully managed SaaS control plane with no direct server/DB access for whoever needs to become the first operator), a gated API endpoint becomes the right choice instead — see the Alternative below, included because this is a legitimate judgment call dependent on deployment topology this document cannot fully know in advance. **Flag this choice to the user/product owner if the deployment model isn't "operator has server/DB access" (self-hosted, single ops team) — the recommendation below assumes that model, consistent with everything else about how this platform is currently deployed (see `infrastructure/` — no managed control-plane pattern exists today).**
- **Script design:** `node scripts/bootstrap-platform-operator.mjs --email <email> --password <password>` (or an interactive prompt if no `--password` flag is given, to avoid the password landing in shell history — reuse whatever CLI-argument-parsing convention, if any, `tools/` already establishes in this monorepo; check before introducing a new one).
  1. Connects to the DB using the same `DATABASE_URL` every service already uses (via `@erp/db`'s `createDatabaseClient`, the same client `TenantProvisioner` itself uses — no new DB connection pattern).
  2. Looks up the `platform-operations` tenant by slug; if it doesn't exist, fails with a clear message ("run migration 0020 first").
  3. **Guardrail (the "can't be re-triggered" requirement):** queries `SELECT COUNT(*) FROM users u JOIN user_roles ur ON ur.user_id = u.id JOIN roles r ON r.id = ur.role_id WHERE r.tenant_id = <platform-operations tenant id> AND r.name = 'PLATFORM_OPERATOR'`. If this count is `> 0`, the script refuses to run and exits non-zero with a message directing the operator to use the normal `POST /users` flow (via an existing operator) instead. This is the entire safety mechanism — it needs no new column, no lock file, no separate "bootstrap already ran" flag, because the fact of an operator existing *is* the completion marker, and it's already queryable from existing tables.
  4. Hashes the given password with the exact Argon2id parameters `TenantProvisioner.createAdminUser()` uses.
  5. Inserts the `users` row (`tenantId: <platform-operations tenant id>`) and the `user_roles` row, in a single DB transaction (so a mid-failure never leaves a user with no role, or a role grant with no user).
  6. Prints the created user's id/email and exits 0. Never prints the password back.
- **Alternative considered and available if deployment model requires it: a gated first-run API endpoint** — `POST /admin/bootstrap` in tenant-service, with the exact same zero-existing-operator guard as step 3 above, executed as the route handler's very first action before touching the request body. No `authenticate`/`requirePermission` preHandler (there is no valid token to present, by definition, before any operator exists) — the *only* guard is the DB-side existence check. This is objectively less safe than the CLI approach for the network-exposure-window reason stated above, but is documented here as the fallback if the CLI approach turns out to be operationally infeasible for this deployment (e.g. a managed hosting model where nobody but the SaaS provider itself has DB/server access, and even the SaaS provider wants a repeatable, non-DB-credential-requiring bootstrap ritual per environment).

## Database Changes

- Not applicable — no schema change. The guardrail query (Architecture, step 3) uses only existing tables (`tenants`, `users`, `roles`, `user_roles`), all already present via migration `0020_es21_platform_operator.sql` and earlier.

## Backend

- **New file:** `scripts/bootstrap-platform-operator.mjs` (or `.ts` run via `tsx`, matching whatever convention the existing `tenant-service` dev script uses — `"dev": "tsx watch --env-file ../../.env src/main.ts"` per `apps/tenant-service/package.json:8` — so a `tsx --env-file ../../.env scripts/bootstrap-platform-operator.ts` invocation is consistent with the rest of the repo's tooling). Location: top-level `scripts/` if this repo already has a convention for cross-cutting operational scripts (check `tools/` and any existing `scripts/` directory before deciding placement), otherwise `apps/tenant-service/scripts/` since it's tenant-service's domain data being written.
- **If the Alternative (gated API endpoint) is chosen instead:** `POST /admin/bootstrap` in `apps/tenant-service/src/api/tenant.routes.ts` (or a new `bootstrap.routes.ts` if kept separate for clarity, given its unusual "no auth" nature makes it worth being visually distinct from every other route in the file, all of which are `PLATFORM_ADMIN`-gated) — request body `{ email, password }`, same Zod validation convention as `CreateTenantSchema`. Returns `403 BusinessError('OPERATOR_ALREADY_EXISTS', ...)` if the guard trips, `201` with the created user's id/email on success.
- **Validation:** password strength — reuse whatever minimum the normal auth-service signup/admin-user-creation path enforces (per `FEATURE_INVENTORY.md` §5.8, "Argon2id password hashing (12-char minimum, no complexity rules, no reuse history)") rather than inventing a different bar for this one path.
- **Audit:** unlike the current fully-manual process (which leaves no trace), this script/endpoint should log (via `@erp/logger`) the bootstrap event with a timestamp and the created email — not full `PlatformAuditLogger` audit-log integration (that class is tenant-scoped and keyed to an acting user, which doesn't exist yet at the moment of bootstrap — using it here would be forcing a square peg into a round hole; a structured log line is sufficient and honest about what this moment actually is).
- **Idempotency:** the guard itself (step 3) is the idempotency mechanism — running the script twice is safe: the second run sees `COUNT(*) > 0` and refuses, rather than creating a duplicate/second operator silently.

## Frontend

- Not applicable — this is a pre-authentication, operational bootstrap concern with no user-facing UI (there is no logged-in session to show a UI to, by definition, until this step has run). Not applicable — backend-only gap.

## API Contract

- If the CLI script approach is used (recommended): Not applicable — no HTTP API, this is a local/deployment-time script.
- If the Alternative gated-endpoint approach is used: `POST /admin/bootstrap` → body `{ email: string, password: string }` → `201 { data: { userId, email, message: 'Platform operator created' } }`; `403 { error: { code: 'OPERATOR_ALREADY_EXISTS', message: '...' } }` if one already exists; `400` on validation failure (weak password, malformed email, missing `platform-operations` tenant).

## Multi-Tenant Considerations

- The created user is scoped to the reserved `platform-operations` tenant (`tenants.slug = 'platform-operations'`), the same tenant every subsequent `PLATFORM_OPERATOR` is scoped to via the normal `POST /users` flow — no new tenant-isolation concern introduced, this package only automates reaching a state the system already assumes is possible.
- This user must never be assignable via any ordinary tenant's `POST /users` (that route is tenant-scoped to the calling admin's own tenant per existing RBAC — verify this remains true, since a bug here would let an ordinary tenant admin accidentally create a cross-tenant platform operator, which would be a serious privilege-escalation issue entirely separate from this package's own scope but worth a sanity-check regression test given how close the two code paths are).

## Integration

- **tenant-service:** owns the `platform-operations` tenant/role/user data this script writes into — the script should use `@erp/db`'s `createDatabaseClient` directly (same as every service) rather than going through tenant-service's HTTP API, since by definition no valid token exists yet to call that API with (unless the Alternative gated-endpoint approach is chosen, in which case it's a normal tenant-service route).
- **Not touched:** every other service. This is a narrowly-scoped, one-time operational concern.

## Coding Standards

- Reuses `TenantProvisioner.createAdminUser()`'s exact Argon2id parameters — no new hashing configuration invented.
- Reuses `@erp/db`'s `createDatabaseClient` — no new DB connection mechanism.
- `@erp/logger` for the bootstrap log line.
- The CLI-script shape itself has no precedent in this monorepo (no `scripts/` directory with prior operational scripts was found in the initial pass — verify before implementing, since if one exists it should be followed rather than starting a new convention) — this is the one genuinely new pattern this package introduces, justified because no existing tool in this codebase currently needs to run outside the context of an authenticated HTTP request against a live service.

## Performance

- Not applicable — a one-time, operator-run, low-frequency action with no performance-sensitive path.

## Security

- **This is fundamentally a security-sensitive package** — it is the one deliberate hole in the platform's authentication model (a way to create a privileged account with no prior authentication). The entire design is built around making that hole as narrow as possible: guarded by a DB-side "does one already exist" check that cannot be bypassed by racing the check (wrap the guard-check + insert in a single transaction with `SELECT ... FOR UPDATE` on the relevant `roles` row, or an application-level advisory lock, to close the theoretical race window where two bootstrap attempts run concurrently before either commits — flag this explicitly in the implementation, since a naive check-then-insert without locking has a real, if narrow, TOCTOU race).
- If the Alternative (API endpoint) is chosen: this is a genuinely unauthenticated, network-reachable route for as long as it remains reachable with zero operators existing — strongly recommend it self-disables (returns 404, not just 403, once an operator exists) rather than merely rejecting, so it doesn't even reveal its own existence in the post-bootstrap state, and consider whether it should be reachable only from an internal network/localhost via infrastructure-level restriction (a decision for whoever owns deployment topology, flagged here rather than assumed).
- Password strength requirements should not be weaker than the rest of the platform's (12-char minimum per the existing convention) — a weak first-operator password undermines the entire platform's security regardless of how well-guarded the bootstrap mechanism itself is.

## Testing

- **Unit/integration:** run the script twice against a test database — first run succeeds and creates the user+role; second run refuses with a clear error and creates nothing (verify via `SELECT COUNT(*)` unchanged). New test file, e.g. `apps/tenant-service/src/__tests__/bootstrap-platform-operator.test.ts` (or co-located with the script if it lives outside `apps/tenant-service/src`).
- **Race-condition test (if feasible):** two concurrent invocations against the same empty state — assert exactly one succeeds and one fails, never both succeeding (validates the locking/transaction guard from the Security section).
- **If the Alternative endpoint is built:** `fastify.inject()` test — first call `201`s, second call `403`s (or `404`s, per the Security recommendation), matching the existing authz-test style in `apps/tenant-service/src/__tests__/tenant-admin-authz.test.ts`.

## Acceptance Criteria

- [ ] Running the bootstrap script against a freshly-migrated database (with migration `0020` applied, zero platform operators) creates exactly one user with the `PLATFORM_OPERATOR` role, scoped to the `platform-operations` tenant.
- [ ] Running it a second time refuses and creates no additional user/role rows — verifiable via `SELECT COUNT(*) FROM users WHERE tenant_id = (SELECT id FROM tenants WHERE slug='platform-operations')` staying at 1.
- [ ] The created operator can successfully authenticate via the normal auth-service login flow and successfully call `POST /admin/tenants` (i.e., the bootstrap produces a fully functional account through the platform's existing, unmodified auth path — no special-cased login logic needed).
- [ ] The created operator can then create a second operator via the normal `POST /users` flow (confirming `ES-21_COMPLETION.md`'s claim that everything after the first operator already works).
- [ ] No password or password hash appears in script stdout/logs.
- [ ] The manual-SQL bootstrap process documented in `ES-21_COMPLETION.md` is superseded — update that document's "Known Issues / Deferred" line (line 90) to point to this package's script instead of the raw-SQL instructions, once implemented.

## Deliverables

- **Files to create:**
  - `scripts/bootstrap-platform-operator.ts` (or wherever placement is confirmed correct per the Backend section's note — check for an existing `scripts/`/`tools/` convention first).
  - `apps/tenant-service/src/__tests__/bootstrap-platform-operator.test.ts`.
- **Files to modify:**
  - `ERP-PLANNING/phase-completions/ES-21_COMPLETION.md` — update the "Known Issues / Deferred" note to reference this package's resolution instead of the manual-SQL steps, once shipped (documentation-only change, keep surgical).
  - If the Alternative gated-endpoint approach is chosen instead of the CLI script: `apps/tenant-service/src/api/tenant.routes.ts` or a new `bootstrap.routes.ts`, plus `apps/tenant-service/src/main.ts` to register it.
- **Migrations:** none.
- **APIs added/changed:** none, if the CLI approach is used (recommended). `POST /admin/bootstrap` only if the Alternative is chosen instead.
- **Events added/changed:** none.
- **Tests added:** double-run refusal test, race-condition test, end-to-end login-and-use-the-account test.

---

## Context Preservation (for a fresh AI session with no prior history)

**Previous Work Summary:** ES-21 introduced `PLATFORM_TENANT_MANAGE` and the cross-tenant `PLATFORM_OPERATOR` role, seeded via migration `0020_es21_platform_operator.sql` into a reserved `platform-operations` tenant — but deliberately seeded zero users (hashing a password inside a SQL migration would mean committing a fixed/predictable hash to git). `ES-21_COMPLETION.md` documents the current manual workaround (hand-run `argon2.hash()` + raw `INSERT` SQL) and explicitly flags automating this as a deferred decision for a future phase. That future phase is this package.

**Current Objective:** Build a narrow, safely-guarded, one-time bootstrap mechanism (a CLI script, recommended over a gated API endpoint for the reasons in Architecture) that creates exactly the first `PLATFORM_OPERATOR` user and refuses to run again once one exists — with everything after that first operator already working via the existing, unmodified `POST /users` flow.

**Architecture Snapshot:**
1. The `platform-operations` tenant + `PLATFORM_OPERATOR` role already exist (migration `0020`) — this package only needs to find them, never re-create them.
2. `TenantProvisioner.createAdminUser()` (`apps/tenant-service/src/domain/TenantProvisioner.ts:236-293`) is the canonical example of user+role creation in this codebase, including the exact Argon2id parameters to reuse — but it is tenant-provisioning-flow-specific and not directly callable for this case (it also creates a Head-Office branch, which `platform-operations` doesn't need).
3. Once one `PLATFORM_OPERATOR` exists, the normal `POST /users` route (auth-service) already works correctly for creating additional ones — this package solves only the zero-to-one bootstrap.
4. The guardrail against re-running is a plain existence check against already-existing tables (`users`/`roles`/`user_roles`), not a new flag/column — the completion state is naturally observable from data that already exists.

**Completed Components:** `PLATFORM_TENANT_MANAGE` permission, `PLATFORM_OPERATOR` role + reserved tenant (migration `0020`), the normal `POST /users` self-escalation-guarded creation flow for subsequent operators — all pre-existing, none built by this package.

**Pending Components:** Not applicable — this package, once shipped, fully closes the gap it addresses. No follow-on package is implied.

**Known Constraints:** This package assumes a deployment model where whoever bootstraps the platform has server/DB access (self-hosted / single-ops-team model, consistent with how this repo is currently deployed per `infrastructure/`) — if that assumption is wrong for the actual target deployment, the Alternative (gated API endpoint) should be built instead, and that choice should be confirmed with whoever owns deployment topology before implementation, not assumed.

**Coding Standards:** See Coding Standards section — reuses existing Argon2id parameters and DB client; the CLI-script shape itself is new to this repo (verify no existing `scripts/` convention is being duplicated before introducing it).

**Reusable Components:** `TenantProvisioner.createAdminUser()`'s Argon2id hashing config, `@erp/db`'s `createDatabaseClient`.

**APIs Already Available:** `POST /users` (auth-service) — already correctly handles every operator *after* the first; not modified by this package.

**Events Already Available:** Not applicable — this package deliberately does not integrate with `PlatformAuditLogger` (see Backend section for why), only a structured log line.

**Shared Utilities:** `@erp/logger`, `@erp/db`, `argon2` (already a `tenant-service` dependency per its `package.json`).

**Feature Flags:** Not applicable.

**Multi-Tenant Rules:** The created user is scoped to the reserved `platform-operations` tenant only — same isolation rule every other `PLATFORM_OPERATOR` user already follows.

**Security Rules:** This package's core content *is* its security design — see the Security section's guidance on TOCTOU-race locking and (if the Alternative endpoint is chosen) the self-disabling/network-exposure considerations. Do not weaken password requirements below the platform's existing 12-char-minimum Argon2id standard.

**Database State:** Requires migration `0020_es21_platform_operator.sql` already applied (it necessarily already is, in any environment where this gap is being felt, since the role/tenant must exist for the gap to even be observable). No new migration needed.

**Testing Status:** No existing test covers this path (it has been a manual, untested, undocumented-in-code process until now). `apps/tenant-service/src/__tests__/tenant-admin-authz.test.ts` is the closest style precedent for any route-level test if the Alternative endpoint approach is chosen.

**Next Session Plan:** Single session — this is a well-bounded, S-complexity package.

**Prompt for the Next Session:** "Resume `ERP-PLANNING/production-gap-prompts/004-Platform/28-first-platform-operator-bootstrap.md` (PG-030). Before writing any code, confirm (1) whether any `PLATFORM_OPERATOR` user already exists in the target environment's database (if so, this package's guard should already refuse to run — verify that's the actual desired behavior, not an obstacle), and (2) check for any pre-existing `scripts/` or `tools/` convention in this monorepo for one-off operational scripts, to place the new bootstrap script consistently rather than starting a new location convention."
