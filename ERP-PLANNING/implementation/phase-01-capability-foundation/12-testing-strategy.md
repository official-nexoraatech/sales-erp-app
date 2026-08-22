# 12 — Testing Strategy

All new test files live in `packages/platform-sdk/test/unit/` (unit) and `packages/platform-sdk/test/integration/` (integration), following the existing structure confirmed by `packages/platform-sdk/test/unit/PlatformFeatureFlags.test.ts`. Route-level/E2E-style tests mirror `apps/tenant-service/src/__tests__/tenant-admin-authz.test.ts`'s exact skeleton (`01-current-code-evidence.md` §6) inside `packages/platform-sdk`'s own test suite, using the throwaway test route from `06-service-enforcement.md` §3.

## 1. Unit tests

**`packages/platform-sdk/test/unit/capability-registry.test.ts`** (NEW):

- Registry-completeness: every `CAPABILITY_REGISTRY[key].flagKey` matches a known-real flag key (hardcoded reference list of confirmed-seeded keys from `TenantProvisioner.ts`/migration seed data).
- No duplicate `key` values, no self-referential `requires` (a capability listing itself).
- Cycle detection: build a synthetic registry fixture with `A requires B, B requires A` and assert the completeness check throws/fails at test time (proving the DAG-cycle guard works), separately from the real 2-entry production registry (which has no dependencies to cycle).

**`packages/platform-sdk/test/unit/capability-guard.test.ts`** (NEW):

- `isCapabilityEnabled` resolves `true` when the underlying flag is enabled (mock `PlatformFeatureFlags.isEnabled` to return `true`).
- Resolves `false` when disabled.
- Resolves `false` for an unregistered key (fail-closed on unknown key, `04-capability-resolution.md` §5).
- Dependency composition: synthetic fixture, `X requires Y`; `Y` disabled → `X` resolves `false` even though `X`'s own flag is `true`.
- `requireCapability`'s preHandler — **four distinct outcomes** (Decision 5, corrects the earlier two-outcome version of this test list):
  1. Unauthenticated (`request.auth` undefined) → `401 UNAUTHORIZED`.
  2. Capability resolves cleanly disabled → `403 CAPABILITY_NOT_ENABLED` with correct `details.capabilityKey`.
  3. Capability resolves enabled → preHandler resolves without replying (falls through to the next handler), mirroring `requirePermission`'s exact "no reply on success" behavior.
  4. **`isCapabilityEnabled` throws** (mock `PlatformFeatureFlags.isEnabled` to reject, simulating a DB/Redis error) → asserts the response is **`503 CAPABILITY_RESOLUTION_UNAVAILABLE`**, explicitly NOT `403 CAPABILITY_NOT_ENABLED` and NOT an uncaught 500 — proves both the fail-closed guarantee (request is still denied) and the three-way distinction (an infrastructure failure must never be reported as a plan restriction).

## 2. Integration tests

**`packages/platform-sdk/test/integration/capability-resolution.integration.test.ts`** (NEW, `describe.skipIf(!DATABASE_URL)`-gated per existing repo convention):

- Real Postgres + real Redis: seed a `feature_flags` row for a test tenant (`hr.payroll.enabled = true`), assert `isCapabilityEnabled('HR_PAYROLL', tenantId, db, redis)` resolves `true` against the real DB/cache path, not a mock.
- Seed `pos.enabled = false` for a different test tenant, assert `isCapabilityEnabled('POS', ...)` resolves `false`.
- **Tenant isolation**: seed Tenant A with `hr.payroll.enabled = true` and Tenant B with `hr.payroll.enabled = false` (or no row — global default `false`), assert Tenant A resolves `true` and Tenant B resolves `false` in the same test run, proving no cross-tenant leakage through the shared L1/L2 cache.
- **Cache invalidation**: toggle the flag via a direct DB write + `PlatformFeatureFlags.invalidate()` call, assert the change is visible on the next `isCapabilityEnabled` call (not stale from L1/L2) — proves this phase correctly inherits the existing invalidation mechanism rather than needing its own.

## 3. Route-level test (proves the full preHandler chain, using the throwaway test route)

**`packages/platform-sdk/test/integration/capability-guard-route.test.ts`** (NEW), skeleton mirrors `tenant-admin-authz.test.ts` exactly (RSA keypair + `signToken` + `buildApp` + `app.inject`):

| #   | Scenario                                                                                                                           | Expected                                                                                                                                                                                                                                                            |
| --- | ---------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Capability enabled + permission granted (test route with both `requireCapability` and `requirePermission` in its preHandler chain) | 200                                                                                                                                                                                                                                                                 |
| 2   | Capability enabled + permission denied                                                                                             | The existing, unchanged permission contract — 403 `FORBIDDEN` (`11-api-contracts.md` §2b) — proves `requireCapability` passing through correctly hands off to `requirePermission` without altering its contract                                                     |
| 3   | Capability disabled (permission irrelevant — capability check runs first per the decided ordering, `05-platform-sdk.md` §7)        | 403 `CAPABILITY_NOT_ENABLED`                                                                                                                                                                                                                                        |
| 4   | No `Authorization` header at all                                                                                                   | 401 `UNAUTHORIZED`                                                                                                                                                                                                                                                  |
| 5   | Capability enabled for Tenant A, disabled for Tenant B — same test process, two signed tokens with different `tenantId`            | Tenant A → 200, Tenant B → 403, in the same test run (isolation proof at the HTTP layer, not just the resolver layer)                                                                                                                                               |
| 6   | Resolution throws (simulated DB/Redis failure) with a valid, otherwise-capable token                                               | **503 `CAPABILITY_RESOLUTION_UNAVAILABLE`**, never 403 and never 500 — proves Decision 5's three-way distinction at the full HTTP layer, not just the unit-test mock level; also proves the request is still denied (fail-closed) despite the different status code |

## 4. Explicit mapping to the governing prompt's 10-case E2E list (§19)

The governing prompt's 10 E2E scenarios assume real HR/Production route wiring, which this phase does not build (`00-overview.md`). Mapped to what Phase 1 _can_ prove today, using the test route:

| Governing-prompt scenario                                            | Phase 1 status                                                                                                                                                                                                               |
| -------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Capability enabled + permission granted → SUCCESS                 | Proven via test route + a permission-layered variant of case 1 above                                                                                                                                                         |
| 2. Capability enabled + permission absent → PERMISSION_DENIED        | Proven — add `requirePermission` to the test route's preHandler chain for one test case, mirroring `05-platform-sdk.md` §7's composition                                                                                     |
| 3. Capability disabled + permission granted → CAPABILITY_NOT_ENABLED | Proven — case 2 above                                                                                                                                                                                                        |
| 4. Capability disabled + permission absent → CAPABILITY_NOT_ENABLED  | Proven — capability check runs first per the decided ordering, so this collapses to the same case as #3                                                                                                                      |
| 5. Tenant A config must not affect Tenant B                          | Proven — case 4 above / integration test's isolation case                                                                                                                                                                    |
| 6. Direct service access must still enforce capability               | Proven in principle — `app.inject()` in these tests calls the Fastify app directly, with no gateway in the loop at all, which is structurally the same trust path as a real direct-to-service call (`05-platform-sdk.md` §8) |
| 7. Gateway bypass must still enforce capability                      | Same evidence as #6 — there is no gateway-dependent code path to bypass, by design                                                                                                                                           |
| 8. AI tool call follows the same authorization path                  | Not a new test in this phase — verified by code inspection, not a new integration test, since no real route exists yet for a tool to call (`09-ai-copilot-impact.md`)                                                        |
| 9. Existing Grocery tenant continues functioning                     | Proven by running the full existing test suite unmodified (§5 below) — zero production route touched                                                                                                                         |
| 10. Existing Clothing/Retail tenant continues functioning            | Same as #9                                                                                                                                                                                                                   |

## 5. Regression proof (backward compatibility)

Run the full existing test suite (`turbo run test` at repo root) unmodified before and after this phase's changes — must be 100% identical pass/fail results, since this phase adds new files and one new export line (`17-file-level-change-plan.md`) but modifies zero existing production logic. Any difference is a bug in this phase's implementation, not an expected side effect.
