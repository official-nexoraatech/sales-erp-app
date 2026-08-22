# 13 — Migration and Backward Compatibility

## Why this phase carries near-zero backward-compatibility risk

Every prior phase in this planning set (Business Profile, Commerce Core generalization) touched live schema or live route behavior, requiring careful staged rollout. **This phase touches neither.** It adds new files (`capability-registry.ts`, `capability-guard.ts`, test files) and one new export line to `packages/platform-sdk/src/index.ts` — no existing function signature changes, no existing route's `preHandler` chain changes, no existing table changes.

## Existing tenants — explicit confirmation

- **Existing Grocery tenants**: unaffected — no Grocery-specific code path exists in this phase; `HR_PAYROLL`/`POS` capabilities are checked against the same `feature_flags` rows Grocery tenants already have, but nothing calls `requireCapability` against a real Grocery route yet.
- **Existing Clothing/Retail tenants**: identical — unaffected for the same reason.
- **Existing roles/permissions**: untouched — `requirePermission`, `ROLE_DEFAULTS`, `permissions.ts` are read-only referenced (for the registry's `permissions` metadata field, §2 model doc), never modified.
- **Existing JWT behavior**: untouched — `AccessTokenPayload`, token issuance/verification code in `auth-service` is not touched by this phase (§8, frontend doc's Option A was explicitly not chosen partly for this reason).
- **Existing navigation**: untouched — `NAV_GROUPS` entries are not modified; `filterNavItem`'s new parameter is additive and the new field is optional, so `Layout.tsx`'s one call site needs a one-line update (pass the new argument) but behavior for every existing nav item is byte-for-byte identical (empty `capabilityKey` never fails the new check).
- **Existing feature flags**: untouched — no flag's `enabled` value, key, or seeding logic changes.
- **Existing APIs**: untouched — zero routes gain a new preHandler in this phase.
- **Existing integrations**: untouched — no consumer, scheduler job, or external integration is modified.

## Migration strategy

None required — see `10-database-and-migrations.md`.

## Rollout strategy

See `15-rollout-and-rollback.md` — because nothing production-facing changes, the elaborate shadow-mode ceremony the governing prompt describes for capability _enforcement_ rollout is not needed for capability _mechanism_ delivery. That ceremony becomes relevant in the next phase, when real routes are wired.

## Rollback strategy

Trivial — revert the new files and the one-line export addition. No data migration to reverse (none was made), no route behavior to restore (none was changed).
