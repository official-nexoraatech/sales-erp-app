# 16 — Acceptance Criteria

- [ ] `packages/shared-types/src/capability-registry.ts` exists, exports `CapabilityDefinition`, `CAPABILITY_REGISTRY` (exactly 2 entries: `HR_PAYROLL`, `POS`), `getCapabilityDefinition`.
- [ ] Both registry entries' `flagKey` values (`hr.payroll.enabled`, `pos.enabled`) and `permissions` values are verified against real code (`permissions.ts`, `TenantProvisioner.ts`/migration seed data) before merge — not left as this plan's illustrative placeholders.
- [ ] `packages/platform-sdk/src/capability-guard.ts` exists, exports `requireCapability(capabilityKey, db, redis)` and `isCapabilityEnabled(capabilityKey, tenantId, db, redis)`.
- [ ] `requireCapability` replies directly (`reply.code().send()`), never throws — verified by test, matching `requirePermission`'s pattern exactly.
- [ ] `requireCapability` distinguishes three outcomes, verified by test for each (Decision 5, corrects the earlier two-outcome criterion): capability disabled → 403 `CAPABILITY_NOT_ENABLED`; resolution failure (caught exception) → 503 `CAPABILITY_RESOLUTION_UNAVAILABLE`; capability enabled → falls through with no reply. An infrastructure failure is never reported as `CAPABILITY_NOT_ENABLED`.
- [ ] The existing, live `requirePermission`/`FORBIDDEN` contract is verified unchanged by this phase — a test asserts "capability enabled + permission denied" still returns the existing `403 FORBIDDEN` shape, not a new code.
- [ ] `packages/platform-sdk/src/index.ts` exports the two new symbols.
- [ ] Zero changes to any existing route file, schema file, migration, or `NAV_GROUPS` entry.
- [ ] Unit tests (`12-testing-strategy.md` §1) pass: registry completeness, cycle detection, resolution logic, fail-closed-on-unknown-key.
- [ ] Integration tests (§2) pass against a real Postgres+Redis: real flag resolution, tenant isolation, cache invalidation inheritance.
- [ ] Route-level tests (§3) pass using the throwaway test route: all 4 scenarios (200 / 403 CAPABILITY_NOT_ENABLED / 401 / tenant-isolation).
- [ ] Full existing repo test suite (`turbo run test`) passes with zero new failures and zero new skips, proving backward compatibility.
- [ ] `apps/web-frontend/src/lib/navigation.ts`'s `NavItem`/`filterNavItem`/`filterNavGroups` gain the new optional `capabilityKey` field and parameter, with a passing unit/RTL test proving existing (untagged) nav items are unaffected.
- [ ] `Layout.tsx`'s call site updated to pass the new (possibly empty-set, in this phase) `enabledCapabilities` argument — compiles, existing nav rendering unchanged in a manual smoke check.
- [ ] `BillingService.ts` gains the single-owner-rule docblock comment (`07-entitlement-integration.md` §3) — comment-only change, no logic touched.
- [x] Frontend capability-delivery mechanism decided (`08-frontend-navigation.md` §2 — `authApi.me()`/`GET /users/me` extension, not a JWT claim).
- [x] Error contract decided (`11-api-contracts.md` §2 — 403 for both `CAPABILITY_NOT_ENABLED` and `PERMISSION_DENIED`).
- [ ] Fail-closed-on-resolution-error path (`try/catch` in `requireCapability`, `05-platform-sdk.md` §2) is implemented and covered by the dedicated test case (`12-testing-strategy.md` §1 item 4 / §3 item 6) — returns 503, not 403, not 500.
- [ ] New Prometheus counter (`erp_capability_check_denied_total`, labelled `capability_key` AND `outcome` per Decision 5) registered via `getOrCreateCounter`, confirmed idempotent under repeated test imports.
- [ ] Log-level distinction implemented: `warn` for capability-disabled, `error` for resolution-failure (`14-observability-and-audit.md` §1) — not a single undifferentiated log level for both.
- [ ] No audit_log/security_audit_log write added (deliberate, matches precedent — confirm this wasn't accidentally added).

## Phase 1 is considered DONE when

All boxes above are checked, the full test suite is green, and a reviewer can confirm via `git diff` that zero files outside the list in `17-file-level-change-plan.md` were touched.
