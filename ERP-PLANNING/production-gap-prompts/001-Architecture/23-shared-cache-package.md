# [PG-002] Shared Cache Package (`@erp/cache`)

> Template version 1.0. Every gap-prompt file in this tree must follow this exact section order. Do not add sections; do not omit sections that apply. If a section genuinely does not apply to this gap, write "Not applicable — <one-line reason>" instead of deleting it, so the structure stays diffable across files.

**Category:** Architecture
**Priority:** High
**Complexity:** M — the real fix is narrower than the inventory doc implies (see Existing Code Analysis); most of the work is a documentation/consolidation + one migration, not new infrastructure
**Depends on:** none
**Blocks:** none
**Primary service(s)/package(s):** packages/cache-client (published as `@erp/cache`), packages/platform-sdk (`@erp/sdk`, `TenantScopedCache`), apps/auth-service

---

## Overview

- **Business objective:** caching needs to be consistent (namespaced per tenant, TTL-disciplined, invalidation-safe) so a bug in one service's ad hoc Redis usage can't leak data across tenants or leave stale data uninvalidated. Today one call site bypasses the sanctioned pattern entirely, which is the actual live risk this package should close.
- **Current implementation — corrected from FEATURE_INVENTORY.md §7/§8:** the inventory document states "`@erp/cache` package is a stub that throws on use; every service that needs caching (auth, report, scheduler, tenant, production, inventory) bypasses it with direct `ioredis` calls instead." **Half of this is accurate, half is stale.** Verified by direct read:
  - `packages/cache-client/src/index.ts` (published as `@erp/cache` per its own `package.json` `name` field) genuinely is a one-function stub: `createCacheClient()` immediately `throw new Error('Cache client not implemented — implement with ioredis in Milestone 0.4')`. This part of the claim is accurate — **this specific package is dead code with zero real callers.**
  - However, a **second, fully-implemented, tenant-scoped cache class already exists and is already the dominant pattern in use**: `TenantScopedCache` in `packages/platform-sdk/src/cache.ts`, exported from `@erp/sdk` (not `@erp/cache`). It implements `get/set/del/exists/expire/ttl/incr/incrBy/getJson/setJson/invalidate(pattern)/publishInvalidation(channel,key)`, namespaces every key as `tenant:{tenantId}:{key}`, and throws a `SecurityError` if constructed without a tenant ID. It is instantiated once per request via `PlatformContextFactory` (`ctx.cache`) and is what `apps/inventory-service/src/domain/ItemCacheService.ts` and `apps/sales-service/src/domain/CustomerCacheService.ts` actually call — their own code comments say so explicitly ("the codebase's existing 'always go through TenantScopedCache' rule").
- **Current architecture:** `PlatformContextFactory` (`packages/platform-sdk/src/context.ts`) creates one raw `ioredis` `Redis` connection per service at startup (`this.redis = new Redis(config.redisUrl, ...)`, line ~118) and wraps it in `TenantScopedCache` per request-context — this is the correct, single bootstrap point, analogous to how `new Kafka()` is bootstrapped once and wrapped by `PlatformEventConsumer` (see PG-003).
- **Current limitations — the real, narrow gap:** `apps/auth-service/src/routes/login.ts` line 100 calls `redis.setex('mfa:${mfaToken}', MFA_TOKEN_TTL_SECONDS, JSON.stringify({userId, tenantId}))` directly on the raw `ioredis` client, bypassing `TenantScopedCache` entirely, even though `tenantId` is available at that call site and could be namespaced. `apps/report-service/src/domain/ReportEngine.ts` line ~1731 does it more correctly — it constructs `new TenantScopedCache(this.redis, tid)` locally rather than receiving `ctx.cache` — technically correct namespacing but a slightly different construction pattern than the `ctx.cache` convention used elsewhere, worth aligning for consistency. The genuinely broken/unused artifact is the standalone `@erp/cache` package — it should not keep existing as a second, contradictory "official" cache abstraction when `TenantScopedCache` already fills that role and is already the one actually adopted.

## Existing Code Analysis

- **What already exists and should be reused:** `TenantScopedCache` (`packages/platform-sdk/src/cache.ts`) — do not build a second cache abstraction. `PlatformContextFactory`'s single `ioredis` connection bootstrap (`context.ts`) — do not add a second Redis connection pool per service.
- **What should never be modified:** `ItemCacheService` (inventory-service) and `CustomerCacheService` (sales-service) already correctly consume `TenantScopedCache` via `ctx.cache` — leave their call sites untouched, they are the reference pattern, not part of the gap.
- **Prior related work:** none — no phase-completion report in `ERP-PLANNING/phase-completions/` mentions `@erp/cache` or `TenantScopedCache` by name.

## Architecture

- **Decision:** delete/deprecate `packages/cache-client` (`@erp/cache`) rather than implementing it. Building out a second real cache client would violate "avoid duplicate implementations" — `TenantScopedCache` already is the real, working, tenant-safe implementation the inventory doc assumed didn't exist. Formally retire the redundant package: remove it from the workspace (or mark it `deprecated` in its `package.json` `description` field with a pointer to `@erp/sdk`'s `TenantScopedCache`, if any external doc still references the `@erp/cache` name and a hard delete would break a doc link — verify via grep for `@erp/cache` imports before deleting; this pass found zero real importers besides the package's own source).
- **Migration:** move the one confirmed direct-`ioredis` bypass (`auth-service/src/routes/login.ts`'s MFA-token `setex`) onto `TenantScopedCache`, since `tenantId` is already in scope there. Align `report-service/src/domain/ReportEngine.ts`'s local `new TenantScopedCache(this.redis, tid)` construction to receive it from context the same way other services do, if a `PlatformContext` is already available at that call site (verify at implementation time — `ReportEngine` may be constructed outside a per-request context in some call paths, e.g. scheduled/async report generation, in which case the local construction is the correct pattern and should stay, just confirmed intentional rather than left as an unreviewed inconsistency).
- **Component interactions:** no new components. `TenantScopedCache` continues to be constructed per-request by `PlatformContextFactory` and threaded through `ctx.cache`; the only change is one additional call site (`login.ts`) adopting it and the removal of the unused `@erp/cache` package from the dependency graph.

## Database Changes

Not applicable — no schema change; this is a Redis-usage-pattern and package-hygiene fix only.

## Backend

- **Routes/handlers changed:** `apps/auth-service/src/routes/login.ts` — replace the raw `redis.setex(...)` MFA-token write with `ctx.cache.setJson('mfa:' + mfaToken, { userId: user.id, tenantId }, MFA_TOKEN_TTL_SECONDS)` (or `.set()` with a `JSON.stringify`'d value if a `PlatformContext` isn't already threaded into this route — verify auth-service's route registration pattern for whether `ctx` is available here or whether this route only has a raw `redis` handle passed in, in which case construct `new TenantScopedCache(redis, tenantId)` locally, matching the report-service pattern). Read the token back the same way wherever the MFA-confirm step consumes it (`mfa.routes.ts` likely — verify and update the corresponding read call site to use the same cache abstraction, since a mismatched key-prefix between write and read would break MFA login entirely).
- **Package removal:** delete `packages/cache-client/` from the workspace (`pnpm-workspace.yaml` / root `package.json` workspaces glob already covers `packages/*`, so removing the directory is sufficient — no separate workspace-config edit needed) — or, if any doc/README explicitly instructs developers to use `@erp/cache`, update that doc instead of leaving a dangling reference.
- **Validation/authorization/telemetry:** not applicable beyond the MFA-token call site fix — no new routes, no new permission checks.
- **Idempotency/caching:** this package IS the caching consistency fix — no other idempotency concern.

## Frontend

Not applicable — backend-only gap.

## API Contract

Not applicable — no API surface changes; `login.ts`'s MFA-challenge response shape (`{ data: { requiresMFA: true, mfaToken } }`) is unchanged, only the storage backend for the token changes.

## Multi-Tenant Considerations

- This is precisely the tenant-isolation fix: the raw `ioredis` `setex('mfa:${mfaToken}', ...)` call has no tenant namespace in its Redis key today (only in its JSON value) — if two tenants' users somehow generated colliding random tokens (astronomically unlikely given `generateSecureToken(32)`, but the point of `TenantScopedCache`'s enforced `tenant:{tenantId}:` prefix is to make this a structural guarantee rather than a probability argument). Moving this call to `TenantScopedCache` makes the key itself tenant-scoped, consistent with every other cached value in the system.

## Integration

- **auth-service:** the one real call-site migration.
- **report-service:** construction-pattern alignment (confirm-or-fix).
- **inventory-service, sales-service:** no changes — already correct, used as the reference pattern.
- **No other service** needs a code change for this package — `scheduler-service`, `tenant-service`, `production-service` named in the (partially stale) inventory claim were checked; their `ioredis` imports are either the same single per-service bootstrap connection (not a bypass) or unrelated to per-request caching (e.g. BullMQ's own Redis connection in `scheduler-service/src/JobRegistry.ts`, which is a job-queue backend, not application caching, and is correctly out of scope for this package).

## Coding Standards

- Reuses `TenantScopedCache` and `PlatformContextFactory` exactly as documented in the Enterprise Architecture Guidance ("check `@erp/sdk` ... before any package introduces a new utility"). This package introduces zero new utilities — it removes a redundant one and fixes one inconsistent call site.
- No new pattern is introduced.

## Performance

- No performance change expected — `TenantScopedCache`'s methods are thin wrappers over the same `ioredis` calls the bypassed code was already making; the only difference is key-prefixing and going through one extra method call.

## Security

- Closes the one concrete tenant-namespace gap in Redis key construction (the MFA-token bypass). No RBAC implication — this is infrastructure-layer, not permission-layer.

## Testing

- Add/extend `apps/auth-service/src/__tests__/mfa-token-cache.test.ts` (new, or extend an existing MFA test file if one already covers `mfa.routes.ts`) asserting the MFA-challenge token round-trips correctly through `TenantScopedCache` (write via login, read via confirm) and that the underlying Redis key is namespaced with the acting tenant's ID (assert via a raw Redis `KEYS tenant:*:mfa:*` check in the test, using the same real-Redis-container test setup this repo's CI already provides).
- Add a lint/CI guard (a simple `grep`-based check in a new small script, or a `depcheck`-style workspace assertion) that fails if any file outside `packages/platform-sdk` and `packages/cache-client` itself imports `@erp/cache`, so a deleted-but-still-referenced package doesn't silently reappear.
- No new integration/E2E tests needed beyond the above — this is a narrow, well-contained fix.

## Acceptance Criteria

- [x] `packages/cache-client` is removed from the workspace (or its `package.json` carries an explicit `"deprecated"` marker pointing at `@erp/sdk`'s `TenantScopedCache`, if a hard delete is judged too risky at implementation time — document which choice was made and why). — hard-deleted; zero real importers existed. `apps/auth-service/vitest.config.ts`'s dangling `@erp/cache` alias removed too.
- [x] `grep -r "from '@erp/cache'"` across `apps/` and `packages/` (excluding the package's own source) returns zero results, confirming no real caller existed to break.
- [x] `apps/auth-service/src/routes/login.ts`'s MFA-token write and its corresponding read in `mfa.routes.ts` both go through `TenantScopedCache`, verified by the new test asserting the tenant-namespaced Redis key. — see IMPLEMENTATION-NOTES.md for the tenantId-prefix-in-token design needed since `/auth/mfa/verify` never receives `tenantId` in its request body.
- [x] `pnpm --filter @erp/auth-service test` passes, including the new MFA-cache test. — 51/51 tests pass (also fixed 2 pre-existing test-fixture gaps this change surfaced; see IMPLEMENTATION-NOTES.md).
- [ ] `pnpm build` at the workspace root succeeds with the package removed (confirms nothing else depended on it). — not run: `pnpm-lock.yaml` is already out of sync with unrelated in-flight package.json changes elsewhere in this working tree (pre-existing, not from this change), so a full install/build was judged too risky to run unattended. `auth-service`'s own `tsc --noEmit` is clean and no `node_modules` symlink to the deleted package exists.

## Deliverables

- **Files to create:** `apps/auth-service/src/__tests__/mfa-token-cache.test.ts` (new or extended).
- **Files to modify:** `apps/auth-service/src/routes/login.ts`, `apps/auth-service/src/routes/mfa.routes.ts` (the corresponding read side), `apps/report-service/src/domain/ReportEngine.ts` (construction-pattern alignment, if applicable after verification).
- **Files to delete:** `packages/cache-client/` (entire package), or its `package.json` marked deprecated as a fallback.
- **Migrations:** none.
- **APIs added/changed:** none (internal storage-backend change only).
- **Events added/changed:** none.
- **Tests added:** `mfa-token-cache.test.ts`, plus the workspace-hygiene grep guard.

---

## Context Preservation (for a fresh AI session with no prior history)

**Previous Work Summary:** the codebase actually already has a working, tenant-namespaced Redis cache abstraction (`TenantScopedCache` in `@erp/sdk`) that most services correctly use via `ctx.cache`. A separate, older, genuinely-stubbed package (`packages/cache-client`, published as `@erp/cache`) throws on use and has zero real callers — it predates `TenantScopedCache` and was never wired up or removed. One real call site (`auth-service`'s MFA-token storage) bypasses the sanctioned cache abstraction entirely with a raw `ioredis.setex()` call.

**Current Objective:** remove the dead `@erp/cache` package (don't implement it — it's redundant), and migrate the one confirmed bypass call site onto `TenantScopedCache`.

**Architecture Snapshot:** `PlatformContextFactory` (`packages/platform-sdk/src/context.ts`) creates one `ioredis` connection per service at boot and constructs `TenantScopedCache` per request as `ctx.cache`; keys are namespaced `tenant:{tenantId}:{key}`; `ItemCacheService`/`CustomerCacheService` are the reference consumers to copy the pattern from.

**Completed Components:** `TenantScopedCache` itself (already built, already adopted by most services) — this package does not build it, only finishes its adoption and removes its dead sibling.

**Pending Components:** none follow from this package.

**Known Constraints:** verify before deleting `packages/cache-client` that no external doc or onboarding guide instructs new developers to use `@erp/cache` by name — if one exists, update it in the same change.

**Coding Standards:** see Coding Standards section — zero new patterns, pure consolidation onto the existing `TenantScopedCache`.

**Reusable Components:** `TenantScopedCache` (`packages/platform-sdk/src/cache.ts`), `PlatformContextFactory` (`packages/platform-sdk/src/context.ts`), `ItemCacheService`/`CustomerCacheService` as reference consumers.

**APIs Already Available:** not applicable.

**Events Already Available:** not applicable.

**Shared Utilities:** `@erp/sdk`'s `TenantScopedCache`.

**Feature Flags:** not applicable.

**Multi-Tenant Rules:** every cache key must be tenant-namespaced via `TenantScopedCache`'s enforced `tenant:{tenantId}:` prefix — no direct `ioredis` calls with a hand-rolled key should exist anywhere after this package.

**Security Rules:** not applicable beyond the MFA-token namespace fix described above.

**Database State:** not applicable.

**Testing Status:** no test today asserts the MFA-token cache is tenant-namespaced — this package adds the first one.

**Next Session Plan:** single session — this is well-scoped (M complexity) and does not need splitting.

**Prompt for the Next Session:** "Implement `ERP-PLANNING/production-gap-prompts/001-Architecture/23-shared-cache-package.md` (PG-002). Note this file already corrects a stale claim in FEATURE_INVENTORY.md/the master roadmap: `@erp/cache` is dead code to delete, not a stub to implement — the real, working cache abstraction (`TenantScopedCache` in `@erp/sdk`) already exists and is already used by most services. Re-verify by grepping for `@erp/cache` importers and for `redis.setex`/`redis.set` calls outside `TenantScopedCache` before starting, since concurrent work may have already touched this."
