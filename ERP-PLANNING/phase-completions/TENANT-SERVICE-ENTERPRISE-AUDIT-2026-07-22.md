# Tenant Service — Enterprise/SaaS Readiness Audit

Date: 2026-07-22
Scope: `apps/tenant-service` + cross-cutting multi-tenancy architecture (`packages/platform-sdk`, `packages/db-client`, gateway, scheduler)
Status: **Research/audit phase complete. No code changed yet — per instruction, awaiting prioritization before implementation.**

---

## 1. Current Architecture (confirmed by reading, not assumed)

- **Isolation model:** single shared Postgres database/schema for all tenants. Every tenant-scoped table has a plain `tenant_id integer` column. Isolation is enforced **entirely by hand-written `WHERE tenant_id = ...` predicates in application code** — no schema-per-tenant, no separate DB, no Postgres RLS active anywhere (zero `CREATE POLICY` in 102 migrations). A `TenantScopedDatabase.transaction()` helper sets a Postgres GUC (`app.current_tenant_id`) that _would_ back an RLS policy, but no policy exists to read it — confirmed inert by ES-25/ES-36. A second helper (`.insert()`/`.findMany()`) that could have auto-scoped every query is defined but **never called anywhere** — 163 files bypass it via `.raw` and hand-roll their own predicate.
- **Tenant lifecycle actually implemented:** `PROVISIONING → ACTIVE ⇄ SUSPENDED → CLOSED`. There is no `TRIAL` state, no expiry state, and no hard-delete — `CLOSED` is a terminal soft-status flag; nothing is archived or cascaded.
- **Provisioning (`TenantProvisioner.provision()`):** a 10-step synchronous saga (create tenant row → seed roles/permissions → create admin user + Head Office branch → seed org settings → provision S3 bucket (real, fatal) → create ES indices (fire-and-forget) → seed feature flags → assign plan entitlements → seed Chart of Accounts (fire-and-forget) → send welcome email (fire-and-forget)) with no rollback/resume on failure.
- **Suspension enforcement:** real and well-built — `assertTenantActive()` (`packages/platform-sdk`) runs on every request via `authenticate()`, 60s cache + Redis pub/sub cross-process invalidation, exempts only holders of `PLATFORM_TENANT_MANAGE`. This is wired into all 14 backend services, not just tenant-service.
- **Auth/RBAC:** RS256 JWT signed by auth-service, verified by every service via `packages/platform-sdk`. 296 granular permission constants, no role-name special-casing. Tenant-scoping for tenant-service's own resources (organization, branch, SSO config) is sourced from the verified JWT's `tenantId`, never from a URL param — no cross-tenant guessing vector found in this service's routes.
- **Subscription/billing:** plan label (`STARTER|GROWTH|ENTERPRISE`) + an entitlement-template-copy service (`BillingService`) that sets seat/branch caps and writes per-tenant feature-flag rows. `nextBillingDate`/`dunningStartedAt`/`tenant_invoices` schema exists but **nothing reads or acts on it** — no payment gateway, no billing-cycle job, no dunning, no invoice generation. Explicitly documented in the codebase's own PG-027 planning doc as "Session 1 of 3," with Sessions 2/3 never executed.
- **Deployment:** Dockerfile + k8s manifest (2-10 replica HPA, PDB, non-root, Vault-injected secrets, real `/health` liveness+readiness) — solid and complete.

---

## 2. Findings — Ranked

Each is stated as: **Issue → Business impact → Technical impact → Regression risk of fixing.**

### CRITICAL

**F1. Approval-workflow authorization is effectively missing.** `approval.routes.ts` `POST /approvals/:id/approve|reject` has no permission check and no server-side verification that the caller is actually the assigned approver — `processDecision()` in `platform-sdk/workflow.ts` updates a row filtered by `approverId = caller`, but never checks if that update matched any rows, and then unconditionally proceeds to finalize. None of the 20 seeded workflow definitions (High-Value Invoice Approval, High-Value PO Approval, Payroll Release Approval, Financial Year Close Approval, etc.) set `requireAllApprovers: true`, so the single-approver-finalizes path always fires.

- **Business impact:** any authenticated employee (`STAFF`, `CASHIER`, anyone) can self-approve their own high-value invoice/PO/discount override, release payroll, or close a financial year — a direct financial-controls bypass.
- **Technical impact:** the codebase's own `route-guard-coverage.test.ts` documents an explicit exception for this file claiming record-level authorization applies — that claim is true for the two GET routes but false for approve/reject.
- **Regression risk of fixing:** low — the fix is additive (check that the update actually affected a row; reject with 403 if not) and doesn't change behavior for legitimate approvers already exercised by existing tests.
- **Untested today** — no test calls approve/reject with a non-approver.

**F2. `activate()` never clears suspension metadata.** Setting `suspendedAt/suspendedBy/suspendedReason: undefined` is silently dropped by Drizzle (`undefined` keys are filtered from `SET`), so after a suspend→reactivate cycle, `status` correctly flips to `ACTIVE` but the three columns permanently retain stale values, misleading anyone reading the raw row into thinking the tenant is still/was-just suspended.

- **Business impact:** low directly, but this data feeds admin UI/audit displays — a reactivated tenant would visibly show a stale suspension reason forever.
- **Fix:** use `sql\`NULL\``or explicit`null`instead of`undefined`.
- **Regression risk:** none — purely corrects a no-op into the intended clear.

**F3. `close()` has no status guard in its `WHERE` clause**, unlike `suspend()`/`activate()`, and `suspend()`'s `version` bump is a no-op (`version: tenants.version` self-assigns rather than incrementing) — unlike `organization.routes.ts`/`branch.routes.ts`, which correctly do `version: existing.version + 1`. Net effect: tenant status transitions have no real optimistic-concurrency protection, and `close` in particular relies solely on a route-level pre-check with a narrow TOCTOU window.

- **Business impact:** double-close / suspend-vs-close race is unlikely in practice (admin-driven, low frequency) but is a real correctness gap in a lifecycle that's supposed to be carefully gated.
- **Fix:** add `status`-conditioned WHERE to `close()`, fix `version` to increment.
- **Regression risk:** low — tightens an already-intended guard; existing single-caller tests are unaffected.

**F4. Non-fatal provisioning steps can leave a tenant `ACTIVE` with critical missing data.** Chart-of-Accounts seeding, ES index creation, and welcome email are fire-and-forget; if CoA seeding fails, the tenant still goes `ACTIVE`, and every accounting journal post fails forever with no visible signal beyond digging into the `provisioningSteps` JSON.

- **Business impact:** a subset of provisioned tenants could be silently broken for accounting from day one.
- **Fix options:** (a) make CoA seeding fatal like S3, (b) add a background reconciliation job that retries/reports degraded-but-active tenants, (c) surface `provisioningSteps` health in the admin tenant list.
- **Regression risk:** option (a) is the simplest and lowest-risk; needs a decision on whether CoA failure should block activation (business call, not purely technical).

**F5. No rollback/resume on fatal provisioning failure.** If the S3 step throws, roles/permissions/admin-user/Head-Office-branch are already committed; the tenant is stuck in `PROVISIONING`/`FAILED` forever with orphaned rows and no automated cleanup or retry entrypoint (the test suite manually deletes the rows itself, which is really documenting the gap).

- **Business impact:** a failed signup leaves debris that only direct DB access can clean up; a customer who hit a transient S3 blip can never retry through the API.
- **Fix:** either wrap the whole provision() in one DB transaction with S3 rolled into a saga-compensation step, or add a `POST /admin/tenants/:id/resume-provisioning` admin action. This is a bigger architectural change — flagging for prioritization, not proposing to silently do it.

### HIGH

**F6. `approval.routes.ts` accepts an unvalidated `nodeId`** via raw body casting, bypassing its own Zod schema, defaulting to `'node_1'` — should be added to the existing Zod schemas and rejected if missing/invalid.

**F7. Plan-based feature-flag gating is almost entirely decorative.** `BillingService` writes real per-tenant feature-flag rows on plan assignment, but only 2-3 routes in the entire codebase actually call `.isEnabled()` on any of the flags the plan templates set (e.g. `gst.e-invoice.enabled`, `pos.enabled`, `hr.payroll.enabled` are never checked anywhere). Changing a tenant's plan changes database rows with no behavioral effect for nearly every advertised feature. The repo's own DAP tour already tells admins this is cosmetic.

- **Business impact:** this directly undercuts "SaaS Ready" — a customer downgraded to STARTER still has every ENTERPRISE feature functionally available, so plan tiers don't gate value.
- This is a big cross-service effort (each domain route needs its own gate), not a tenant-service-only fix — flagging as a roadmap item requiring prioritization across services, not something to silently start rewriting.

**F8. Plan downgrade doesn't revoke flags.** `assignPlanEntitlements()` only ever sets `enabled: true` for flags in the _new_ plan's list; it never disables flags that were true under the old plan but aren't in the new one. Compounds F7 once real gating exists.

**F9. TOCTOU race in seat/branch-limit enforcement.** `assertUnderUserLimit`/`assertUnderBranchLimit` do a count-then-insert with no lock — concurrent requests right at the cap can both pass and overshoot the plan limit.

- **Fix:** wrap in a transaction with `SELECT ... FOR UPDATE` on a per-tenant advisory lock, or add a partial unique/check constraint. Low risk, but touches auth-service's user-creation path too (cross-service).

**F10. RLS is fully dormant / no systemic guard against a missing `WHERE tenant_id`.** This is the single most consequential _architectural_ gap for "enterprise SaaS" positioning — there is no automated backstop (no RLS, no lint rule, no enforced repository pattern) preventing a future route from leaking cross-tenant data; the only defense today is manual code review and one-off audit phases (ES-05, ES-21) that already caught two real cross-tenant leaks in the past (search-service trusting a URL param; a permission-leak migration). Already explicitly deferred in ES-36 as "a dedicated security-hardening phase, not a sub-task."

- Not something to fix inside tenant-service alone — it's platform-wide. Flagging for explicit prioritization decision: do we want to scope a dedicated RLS-enablement phase now, given the task's "SaaS Ready" bar explicitly expects it?

**F11. Audit logging is narrow.** Only the three lifecycle transitions (suspend/activate/close) are written to `audit_log`. Tenant **creation**, subscription/**plan changes**, and organization/branch/SSO **config changes** are not audit-logged at all — only transient outbox events, which aren't a durable compliance trail.

- **Business impact:** "Audit Logs" is explicitly in the requested enterprise checklist; today a tenant's GSTIN/bank-details/SSO-issuer change has no who/when/before-after record.
- **Fix:** extend the existing `logTenantLifecycleAudit` pattern to `TenantProvisioner.provision()`, `BillingService.assignPlanEntitlements()`, and the PUT/DELETE handlers in `organization.routes.ts`/`branch.routes.ts`/`sso-config.routes.ts`. Additive, low regression risk, but touches 5 files.

### MEDIUM

**F12. Dead/duplicate company-profile columns.** `tenants.gstin/pan/registeredAddress` are defined but never read or written by any route — `organizationSettings` has its own, actually-used copies. Ambiguous source of truth; should be removed or documented as deprecated.

**F13. Two independent, overlapping settings stores** (`tenants.settings.{timezone,currency,...}` vs `organizationSettings.{timezone,currency,...}`) can silently drift — changing timezone via `PUT /organization` never updates `tenants.settings`, which is what plan-entitlement checks read.

**F14. Logo upload doesn't actually work end-to-end.** `POST /organization/logo/upload` returns an upload URL but nothing persists it — and `UpdateOrgSchema` has no `logoUrl` field at all, so there is currently **no way to ever set `logoUrl` through the API**, despite it being a real, read-back column.

**F15. No consistent pagination convention** across tenant-service list endpoints — `GET /admin/tenants`, `usage-overview`, `/approvals/pending`, `/faqs` are all unpaginated; `/branches` is conditionally paginated. Fine at current scale, will not scale to thousands of tenants/branches.

**F16. Rate limiting is in-memory, per-pod, uncoordinated.** With a 2-10 replica HPA, the effective limit is `200 × replica_count`/min, not the intended 200/min — no Redis store configured for this service's rate limiter.

**F17. JWT issuer claim set at signing but not checked at verification** (`platform-sdk`'s `verifyAccessToken` omits the `issuer` option that auth-service's own verifier includes). Defense-in-depth gap, not currently exploitable (single signing key).

**F18. Two error-response bypass points** (`usage.routes.ts`, `search-sync.internal.routes.ts`) hand-roll error envelopes instead of using the shared `@erp/types` error classes — currently matches the global envelope by coincidence, will drift if the envelope changes.

**F19. `branch.routes.ts` PUT/DELETE mutating queries re-address by `id` alone** after an initial tenant-scoped SELECT proves ownership — not currently exploitable (branch IDs are a single global PK space and the check-then-act happens within one request) but a maintenance hazard if the code is ever reordered.

**F20. `config.ts` lets `JWT_PUBLIC_KEY` default to `''`** instead of failing fast at startup — a missing key would only surface as a confusing runtime auth failure rather than an immediate boot-time error.

**F21. No license-key / device-limit / concurrent-session concept exists at all.** This is a complete absence, not a bug — expected for an internally-deployed multi-tenant ERP rather than shrink-wrapped software, but explicitly called out in your checklist ("License Management"). Needs a business decision on whether this is actually wanted before any implementation is justified.

### LOW / Documentation

**F22.** Two gap-prompt docs (`002-Security/01-tenant-suspension-enforcement.md`, `004-Platform/27-tenant-provisioning-s3-bootstrap.md`) describe gaps that have since been closed by later work but were never marked resolved — stale tracker hygiene, not a code issue.

**F23.** `TenantScopedDatabase.insert()`/`.findMany()` scoping helpers are dead code (never called; 163 files bypass via `.raw`) — either wire them in as the systemic guard from F10, or remove them; leaving them as unused-but-present is misleading (looks like a safety net that isn't one).

---

## 3. What's Genuinely Good (don't touch)

- Suspension/closure enforcement (`assertTenantActive`) is real, tested, cross-process-consistent, and correctly exempts only the platform operator.
- Tenant-scoping for tenant-service's own resources is sourced from the verified JWT everywhere — no cross-tenant read/write path found in this service.
- Duplicate-tenant/slug/email protection is a real Postgres unique constraint, race-safe by construction.
- Seat/branch limit enforcement is real (modulo the TOCTOU race in F9).
- Deployment (Dockerfile, k8s HPA/PDB, health probes, Vault secrets) is solid.
- Middleware/error-handler registration order in `main.ts` is correct (the platform-wide bug class this repo has hit before is **not** present here).
- Branch soft-delete pattern (`deletedAt`/`deletedBy`, Head Office protection) is properly implemented.
- API versioning is clean — tenant-service has no hardcoded legacy paths (unlike report-service).

---

## 3.5 Fixes Implemented (2026-07-22/23 session)

**Batch 1 (critical + tenant-service-contained bugs):**

- **F1** — Approval-workflow authorization bypass fixed: `processDecision()` now verifies the decision update actually matched an eligible, pending approver row before proceeding; throws `NOT_ELIGIBLE_APPROVER` (403) otherwise. Regression test added.
- **F2/F3** — `activate()` now clears suspension metadata with real `null`s (not `undefined`, which Drizzle silently dropped); `suspend()`/`activate()`/`close()` all correctly increment `version`; `close()` gained the same status-guarded WHERE clause suspend/activate already had.
- **F6** — `nodeId` is now a required, Zod-validated field on approve/reject, not an unvalidated raw-body cast.
- **F9** — Added `acquireTenantLimitLock()` (Postgres advisory transaction lock) to platform-sdk; wrapped the seat-limit (auth-service) and branch-limit (tenant-service) check+insert in a single locked transaction each, closing the TOCTOU race.
- **F11** — Tenant creation now writes a `TENANT_CREATED` audit_log entry; organization/branch/SSO-config create/update/delete routes now call `ctx.audit.log()` (previously only suspend/activate/close were audited).

**Batch 2 (remaining low/medium findings):**

- **F17** — `verifyAccessToken()` now checks the JWT `iss` claim (matching auth-service's own `erp-auth-service` default) — closes an asymmetry where the issuer was set at signing but never verified at any relying-party service. Verified across all consumers (tenant-service, auth-service, api-gateway, platform-sdk — 8 test files needed their token-minting helpers updated to set an issuer).
- **F19** — `branch.routes.ts` PUT/DELETE now re-scope the mutating UPDATE statement by `tenantId`, not just `id` — defense-in-depth, no longer relies solely on the preceding SELECT.
- **F20** — `JWT_PUBLIC_KEY` now fails fast at service boot (`requireEnv`) instead of silently defaulting to `''` and only failing on the first real request.
- **F22** — The two stale gap-prompt docs (PG-012 tenant-suspension-enforcement, PG-029 S3-bootstrap) marked RESOLVED with a note on what actually shipped instead.
- **F14** — Turned out to be a two-layer bug: no way to persist a logo URL, _and_ the "presigned upload URL" was fake (no signature — MinIO would reject it). Rewrote as a real server-side upload (`@fastify/multipart` + `StorageClient.uploadFile`), renamed `organizationSettings.logoUrl` → `logoObjectKey` (migration `0101`) since the bucket is private, and added `GET /organization/logo` (302 redirect to a freshly-signed URL) mirroring hr-service's existing employee-photo pattern. Fixed a cross-service ripple in `sales-service/invoice.routes.ts`. 8 new tests.
- **F18** — `usage.routes.ts` and `search-sync.internal.routes.ts`'s hand-rolled `reply.code(...).send(...)` validation-error responses now throw `ValidationError`/`BusinessError` like every other route in the service (status code for the usage-period check changed 400→422 to match the codebase-wide convention; test updated). Left `checkInternalKey`'s 401 alone — that hand-rolled pattern is the deliberate, repeated convention across every `internal.routes.ts` in the codebase, not an inconsistency.
- **F13** — Investigation found the original premise didn't hold: `tenants.settings`' locale fields (timezone/currency/etc.) were write-once at provisioning and never read back by anything — only `maxUsers`/`maxBranches` from that same JSON blob are ever consumed. Removed the dead fields at the source (schema + `TenantProvisioner`) rather than building a sync mechanism for values nothing reads.

Also fixed incidentally: a local dev DB migration-bookkeeping drift (20 migration files existed on disk but weren't applied) that was blocking test verification.

**Still open, deliberately not touched:** F4/F5 (provisioning rollback/atomicity — needs a business decision on fail-hard-vs-recoverable), F7/F8 (feature-flag enforcement rollout — cross-service), F10 (RLS enablement — platform-wide architectural initiative), F21 (license/device-limit management — needs a business decision on whether it's wanted at all), F12 (dead `tenants.gstin/pan/registeredAddress` columns — a smaller version of the same "dead field" pattern as the old F13, not yet actioned), F15 (pagination consistency — touches many endpoints/API contracts), F16 (rate-limit Redis-backing — needs infra decision), F23 (unused `TenantScopedDatabase.insert/findMany` helpers — wire in or remove, a judgment call).

## 4. Recommended Priority (for discussion, not decided)

1. **F1** (approval bypass) — highest business risk, should be fixed first regardless of what else is deferred.
2. **F2/F3/F6** — small, low-risk, self-contained correctness fixes, good to batch together.
3. **F11** (audit logging gaps) — directly requested in the enterprise checklist, additive, moderate size.
4. **F9** (TOCTOU on limits) — small, contained.
5. **F4/F5** (provisioning robustness) — larger design decisions needed first (fatal vs recoverable CoA seeding; resume-vs-transaction strategy).
6. **F7/F8/F10/F21** — genuine cross-service/architectural initiatives (feature-gate enforcement, RLS rollout, license management) that deserve their own scoped phases rather than being bundled into a single "tenant service" pass.
7. **F12–F20** — cleanup/hygiene, low urgency, safe to batch whenever convenient.
