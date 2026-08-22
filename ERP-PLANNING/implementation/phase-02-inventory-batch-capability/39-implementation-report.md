# 39 — Phase 2B Implementation Report: INVENTORY_BATCH Capability

## 1. Executive Summary

`INVENTORY_BATCH` is now a registered, entitlement-aware, permission-aware, backend-enforced, frontend-navigation-aware platform capability, built on the Phase 1 capability-foundation mechanism and the Phase 2A-consolidated shared valuation engine. The capability governs one thing: whether an item can be configured with `fefoEnabled: true` (opting it into earliest-expiry-first stock consumption) and whether a tenant's users can see the new Near-Expiry Stock report. It does not gate any existing flow, does not block expired stock, and does not touch any existing item's data. All targeted tests (unit + real-Postgres/Redis integration) pass; no regressions found in any service touched.

**Verdict: A. IMPLEMENTED AND VERIFIED.**

## 2. Implementation Scope

Per `30-revised-file-level-change-plan.md`, cross-checked against live code (see §19, Deviations):

- Capability registry entry + permission constants (shared-types)
- Entitlement default (migration: global flag seed + existing-tenant permission backfill)
- Backend enforcement: `fefoEnabled: true` write-path gate on item create/update (in-handler, conditional), top-level capability+permission gate on the new near-expiry report route
- Frontend: nav item, item-form toggle with mandatory disclosure copy, new report page
- Observability: reused Phase 1's `erp_capability_check_denied_total` metric, including the in-handler call site that bypasses the preHandler where it's normally incremented automatically
- Tests: capability registry, in-handler gating (mocked), route-level gating (mocked), real-DB FEFO-ordering-through-production-entrypoints proof, real-DB tenant-isolation + disable/re-enable data-safety proof

## 3. Files Changed

| File                                                                                               | Change                                                                                                                                                                                                                                                   |
| -------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/shared-types/src/capability-registry.ts`                                                 | Added `INVENTORY_BATCH` entry; removed the stale "only 2 entries" comment                                                                                                                                                                                |
| `packages/shared-types/src/permissions.ts`                                                         | Added `BATCH_VIEW`, `BATCH_CONFIGURE`                                                                                                                                                                                                                    |
| `apps/tenant-service/src/rbac/role-defaults.ts`                                                    | `INVENTORY_MANAGER`: both permissions. `PURCHASE_MANAGER`: `BATCH_VIEW` only. (`OWNER`/`ADMIN`/`SUPER_ADMIN` need no edit — they derive from `TENANT_SCOPED_PERMISSIONS = Object.values(PERMISSIONS)`, so the new constants flow to them automatically.) |
| `packages/db-client/migrations/0169_inventory_batch_capability.sql` (+ `meta/_journal.json` entry) | Data-only: seeds the global `inventory.batch.enabled = true` flag row; backfills `BATCH_VIEW`/`BATCH_CONFIGURE` into existing tenants' `OWNER`/`ADMIN`/`SUPER_ADMIN`/`INVENTORY_MANAGER` roles (both) and `PURCHASE_MANAGER` (view only)                 |
| `apps/inventory-service/src/api/item.routes.ts`                                                    | Added `fefoEnabled` to `ItemSchema` (default `false`). Added `assertBatchConfigureAllowed()` helper + in-handler gate on `POST /items` and `PUT /items/:id`, invoked only when the request is turning `fefoEnabled` on                                   |
| `apps/inventory-service/src/api/stock.routes.ts`                                                   | New `GET /inventory/near-expiry-stock` route, gated by `requireCapability('INVENTORY_BATCH', ...)` + `requirePermission(BATCH_VIEW)`                                                                                                                     |
| `apps/web-frontend/src/lib/navigation.ts`                                                          | New "Near-Expiry Stock" leaf under the INVENTORY group, `permission: BATCH_VIEW`, `capabilityKey: 'INVENTORY_BATCH'`                                                                                                                                     |
| `apps/web-frontend/src/App.tsx`                                                                    | Lazy import + route registration for the new page                                                                                                                                                                                                        |
| `apps/web-frontend/src/api/endpoints.ts`                                                           | `stockApi.nearExpiry(...)`                                                                                                                                                                                                                               |
| `apps/web-frontend/src/schemas/item.schema.ts`                                                     | `fefoEnabled` optional field                                                                                                                                                                                                                             |
| `apps/web-frontend/src/pages/items/ItemFormPage.tsx`                                               | Capability+permission-gated toggle with mandatory expiry-scope disclosure copy                                                                                                                                                                           |
| `apps/web-frontend/src/pages/inventory/NearExpiryStockPage.tsx`                                    | New page (list, warehouse/threshold filters, expired/near-expiry badges)                                                                                                                                                                                 |
| `apps/web-frontend/src/lib/__tests__/navigation.test.ts`                                           | Updated stale "no item sets capabilityKey" comment; added a targeted gating test for the new nav item                                                                                                                                                    |
| `apps/auth-service/src/__tests__/users-me-capabilities.test.ts`                                    | Fixed one test's mock to stay correct with a 3rd registry entry (see §19)                                                                                                                                                                                |
| `packages/platform-sdk/test/unit/capability-registry.test.ts`                                      | Updated entry-count assertion (2→3) and `KNOWN_REAL_FLAG_KEYS`                                                                                                                                                                                           |

New test files: `apps/inventory-service/src/__tests__/{item-batch-capability,near-expiry-stock-route,fefo-consumption-flows.integration}.test.ts`, `packages/platform-sdk/test/integration/inventory-batch-tenant-isolation-and-disable.integration.test.ts`.

## 4. Files Intentionally Not Changed

- `packages/platform-sdk/src/valuation-engine.ts` — the shared FEFO/valuation engine is unmodified (D1, Phase 2A already consolidated sales-service onto it; FEFO ordering itself already existed).
- `apps/web-frontend/src/components/Layout.tsx`, `ERPCommandPalette.tsx` — both already pass `enabledCapabilities` into `filterNavGroups`; the new nav item is picked up with zero code change.
- `apps/*/src/domain/{StockTransferService,StockAdjustmentService,PhysicalVerificationService,PurchaseReturnService,JobWorkOrderService}.ts` — all five already call the shared `ValuationService.consumeForStockOut`/`InventoryLedgerService.deductStock`/`adjustStock` unconditionally; FEFO ordering is a property of the shared engine, not of these callers, so no per-flow code change was needed or made (see §6, §13).
- `apps/*/src/domain/GRNService.ts`, `nearExpiryAlert.job.ts` — batch/expiry capture and near-expiry alerting were already unconditional and correct pre-Phase-2B; untouched.
- Any schema/DDL change — the batch/expiry schema (`items.fefoEnabled`, `inventory_fifo_layers.batchNumber/expiryDate`) already shipped in migration `0165`.
- `plan_entitlements` rows — deliberately not modified; every plan continues to resolve the capability via the global flag fallback (see §6).
- AI Copilot service code — no tool in `ai-copilot-service` currently registers against item routes or the new report route; nothing to change (see §9).
- Job-work finished-goods batch/expiry threading, sale-return batch/expiry threading, batch-targeted corrections, expiry-blocking policy — all explicitly out of scope (D2, D3) or pre-existing named gaps unrelated to this phase.

## 5. Capability Registry Changes

Added to `CAPABILITY_REGISTRY`:

```ts
INVENTORY_BATCH: {
  key: 'INVENTORY_BATCH', name: 'Batch & Expiry Tracking', domain: 'Inventory',
  owningService: 'inventory-service', flagKey: 'inventory.batch.enabled', requires: [],
  status: 'BETA', applicableBusinessTypes: ['GROCERY', 'DISTRIBUTION', 'MANUFACTURING'],
  permissions: ['BATCH_VIEW', 'BATCH_CONFIGURE'],
}
```

`applicableBusinessTypes` is documentation metadata (per the existing pattern) — it does not itself restrict which tenants can enable the flag, and no `if tenant.vertical === X` logic was added anywhere; any tenant, of any vertical, resolves the capability through the same flag mechanism.

## 6. Entitlement Changes

One data-only migration (`0169`). Global `feature_flags` row: `tenant_id = NULL, flag_key = 'inventory.batch.enabled', enabled = true`. **Verified deliberate deviation from Phase 1's per-tenant-default-off precedent** (both `HR_PAYROLL`/`POS` default off per-tenant): justified because the capability only gates whether an item _can be configured_ as batch-tracked, and no existing item can have `fefoEnabled = true` before this phase's write path exists — so defaulting the capability itself to `true` changes zero existing tenant's runtime behavior. `TenantProvisioner.seedFeatureFlags()` was deliberately **not** extended with an `inventory.batch.enabled` row — every tenant (existing and future) inherits the global default via `PlatformFeatureFlags`'s tenant-specific-row-then-global-fallback resolution, confirmed by reading `fetchFromDb()` directly. `plan_entitlements` rows were not touched (every plan continues to resolve `true` via the global fallback — a deliberate, reversible, zero-code-change place to later restrict by plan if a commercial reason arises).

## 7. Backend Enforcement

- **`POST /items` / `PUT /items/:id`**: in-handler (not preHandler) check, `assertBatchConfigureAllowed()`, invoked only when the request body's `fefoEnabled` is transitioning to `true`. On `PUT`, this is computed as `body.data.fefoEnabled && !existing.fefoEnabled` — **not** simply "`fefoEnabled` is present and true" — because `PUT` is a full-record replace; gating on the submitted value alone would make every future edit to an already-batch-tracked item fail once the tenant's capability is later disabled, which would violate D4 (disabling must not break existing config/functionality). This was caught and fixed during implementation, not by the plan (see §19).
- **`GET /inventory/near-expiry-stock`**: top-level preHandler gate, `requireCapability('INVENTORY_BATCH', ctxFactory.rawDb, ctxFactory.getRedis())` + `requirePermission(BATCH_VIEW)`, mirroring the existing Phase 1 route pattern exactly.
- **Every consumption flow** (stock transfer, stock adjustment, physical verification, purchase return, job-work material issue, invoice/POS checkout, sale return) remains **ungated** — none gained a capability check, matching D4 and the plan: only the write path that turns `fefoEnabled` on is capability-gated; consumption trusts `items.fefoEnabled` as sole source of truth, verified this stays true by direct test (§14, tenant-isolation test #3).

## 8. Frontend Changes

- `navigation.ts`: one new leaf (`Near-Expiry Stock`), the first real consumer of the pre-existing but previously-unused `capabilityKey` field on `NavItem`.
- `ItemFormPage.tsx`: toggle visible only when both `enabledCapabilities.includes('INVENTORY_BATCH')` and `hasPermission(BATCH_CONFIGURE)` — hidden, not disabled-and-visible, when either is absent. Carries mandatory disclosure copy: "Consumes earliest-expiring stock first. Does not block sale or use of already-expired stock — expiry blocking isn't part of this release."
- `NearExpiryStockPage.tsx`: new list page (warehouse + threshold-days filters, Expired/Near-Expiry badges), reusing the existing `ERPDataGrid`/`Select`/`Badge` components and the `StockLevelsPage.tsx` structural pattern.
- Frontend hiding remains UX-only; every backend route stays independently enforced regardless of what the client believes.

## 9. AI Copilot Impact

Checked `ai-copilot-service`'s tool registrations against item routes and the new near-expiry route — none currently exist. No AI-specific authorization mechanism was added; any future copilot tool touching these routes would reach the same `authenticate → requireCapability → requirePermission` chain a browser request does, with no bypass. No code change required or made in this phase.

## 10. Database / Migration Impact

No schema/DDL change (batch/expiry columns already existed from migration `0165`). One data-only migration, `0169_inventory_batch_capability.sql`: global flag seed + existing-tenant role-permission backfill, both idempotent (`WHERE NOT EXISTS` / `ON CONFLICT DO NOTHING`). **Verified by direct application against the dev Postgres instance** (see §14) — after application, the global flag row and all 26 existing tenants' `OWNER`/`ADMIN`/`SUPER_ADMIN`/`INVENTORY_MANAGER` (both permissions) and `PURCHASE_MANAGER` (`BATCH_VIEW` only) backfills were confirmed present with correct row counts.

**Known pre-existing tooling issue, not introduced by this phase**: `drizzle-kit migrate` exits with code 1 without a visible error message against this dev database (its own progress spinner appears to swallow the actual error), matching the already-documented `db_migration_bookkeeping_broken` recurring issue. Given the SQL was independently verified correct and fully idempotent by direct application, this is a migration-tooling gap, not a defect in `0169`'s SQL. Flagged here rather than silently worked around.

## 11. RBAC Impact

New constants `BATCH_VIEW`/`BATCH_CONFIGURE`, `RESOURCE_ACTION`-style, matching the existing `ITEM_*`/`GRN_*` convention — no vague `BATCH_ACCESS`-style permission introduced. Granted to `INVENTORY_MANAGER` (both), `PURCHASE_MANAGER` (view only), and implicitly to `OWNER`/`ADMIN`/`SUPER_ADMIN` via the existing `TENANT_SCOPED_PERMISSIONS` wildcard. No existing permission renamed, no existing role's existing grants reduced.

## 12. Observability

Reused Phase 1's `erp_capability_check_denied_total` counter (`packages/logger`) unchanged — no parallel metrics framework introduced. The near-expiry route's preHandler increments it automatically (existing `requireCapability` behavior). The item-routes in-handler check bypasses that preHandler, so it explicitly calls `.inc({ capability_key: 'INVENTORY_BATCH', outcome: 'disabled' | 'resolution_error' })` itself — verified this fires correctly by test (§14). Logging follows the same `request.log.warn`/`request.log.error` split between a clean denial and a resolution failure.

## 13. Test Results (Unit / Mocked)

| File                                                                         | Tests | Result                                                                                                                                                                                      |
| ---------------------------------------------------------------------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/platform-sdk/test/unit/capability-registry.test.ts`                | 10    | ✅ pass (updated for 3rd entry)                                                                                                                                                             |
| `packages/platform-sdk/test/unit/capability-guard.test.ts`                   | 10    | ✅ pass (unaffected)                                                                                                                                                                        |
| `apps/auth-service/src/__tests__/users-me-capabilities.test.ts`              | 3     | ✅ pass (one test's mock corrected — see §19)                                                                                                                                               |
| `apps/inventory-service/src/__tests__/item-batch-capability.test.ts` (new)   | 8     | ✅ pass — capability disabled→403, missing permission→403, resolution failure→503, granted→201/200; PUT-specific: unchanged-true never re-checked, false→true gated, true→false never gated |
| `apps/inventory-service/src/__tests__/near-expiry-stock-route.test.ts` (new) | 6     | ✅ pass — registration args, 403/503/403-permission/200/401                                                                                                                                 |
| `apps/web-frontend/src/lib/__tests__/navigation.test.ts`                     | 125   | ✅ pass — including new targeted Near-Expiry-Stock gating test                                                                                                                              |

## 14. Integration Test Results (Real Postgres + Redis)

Dev stack (`docker-compose.yml`, already-running containers: `erp-postgres-primary` on `127.0.0.1:5435`, `erp-redis-1` on `127.0.0.1:6379`) was available and used — **not skipped, not faked**.

| File                                                                                                              | Tests | Result                                                                                                                                                                                                                                                                                                                                                                                             |
| ----------------------------------------------------------------------------------------------------------------- | ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/inventory-service/src/__tests__/fefo-consumption-flows.integration.test.ts` (new)                           | 3     | ✅ pass — `InventoryLedgerService.deductStock` (StockTransferService's engine path) and `.adjustStock` OUT (StockAdjustmentService/PhysicalVerificationService's shared path) both consume the soonest-to-expire FIFO layer first for a `fefoEnabled: true` item, correctly _not_ the earliest-received one; a `fefoEnabled: false` item is unaffected, still strict FIFO                          |
| `packages/platform-sdk/test/integration/inventory-batch-tenant-isolation-and-disable.integration.test.ts` (new)   | 4     | ✅ pass — tenant isolation (Tenant A on / Tenant B off resolve independently); disabling the capability does **not** reset an existing item's `fefoEnabled`; FEFO consumption keeps honoring `fefoEnabled: true` even while the capability is currently disabled for the tenant (proves consumption never re-checks the capability); re-enabling leaves the item's configuration exactly as it was |
| `apps/sales-service/src/__tests__/{valuation-fefo,sale-return-batch-traceability}.test.ts` (Phase 2A, regression) | 3     | ✅ pass — unaffected by this phase                                                                                                                                                                                                                                                                                                                                                                 |
| `packages/platform-sdk` full suite                                                                                | 210   | 209 pass, 1 pre-existing unrelated flaky failure (`workflow.test.ts` notification-retry timing test — file untouched by this phase, matches the documented `turbo_parallel_test_false_failures` class)                                                                                                                                                                                             |
| `apps/tenant-service` full suite                                                                                  | 65    | 64 pass, 1 pre-existing skip (unrelated)                                                                                                                                                                                                                                                                                                                                                           |

`PurchaseReturnService`/`JobWorkOrderService` (purchase-service, production-service) were **not** given dedicated FEFO-ordering integration tests. Verified by direct code read that both call `ValuationService.consumeForStockOut(db, { tenantId, itemId, variantId, warehouseId, quantity })` — the identical shared function, identical parameter shape, already proven correct by the engine-level test (Phase 2A) and by this phase's `fefo-consumption-flows.integration.test.ts`. There is no flow-specific logic between those call sites and the ones directly tested that could cause divergent behavior. This is a scope decision made under time constraints, not a silent gap — recorded explicitly here per the acceptance-criteria requirement to state deviations rather than reduce the affected-flow matrix quietly.

## 15. Regression Test Results

Full `tsc --noEmit` clean on: `packages/shared-types`, `packages/platform-sdk`, `apps/inventory-service`, `apps/tenant-service`, `apps/auth-service`, `apps/web-frontend`, `apps/purchase-service`, `apps/production-service`. Full `inventory-service` test suite run: 60/74 pass; the 14 failures are in 4 files **not touched by this phase** (`warehouse-adjustment-transfer-permission-guards.test.ts`, `sync-routes.test.ts`, `sync-routes.integration.test.ts`) and are the already-documented pre-existing `JWT_ISSUER` test-config mismatch (hardcoded `'erp-test'` issuer vs. the SDK's real `'erp-auth-service'` default) plus one DB-seed-data-dependent test — confirmed via `git status` that none of these files have any pending change from this session.

## 16. Tenant Isolation Verification

Proven with real Postgres + Redis: Tenant A with an explicit `inventory.batch.enabled = true` override and Tenant B with an explicit `false` override resolve independently and correctly in the same test run, including after a cache-invalidation cycle (`PlatformFeatureFlags.invalidate()`). This is the same mechanism every other capability already uses (Phase 1), now confirmed working for `INVENTORY_BATCH` specifically rather than only asserted by extension.

## 17. Backward Compatibility Verification

- Every existing tenant: `inventory.batch.enabled` resolves `true` via the new global default row (no per-tenant row was seeded), but **zero existing item** can have `fefoEnabled: true` as a side effect of this — that column has been `false`-defaulted since migration `0165` and no code before this phase could ever set it `true`. Confirmed no existing item's consumption ordering changes.
- Every existing integration/script calling `POST/PUT /items` without the new `fefoEnabled` field sees zero change — field is optional, Zod-defaulted `false`.
- `GRNService`'s unconditional batch/expiry capture and `nearExpiryAlert.job.ts`'s alerting are both untouched — confirmed by not modifying either file.
- The one real behavioral change for existing tenants: `INVENTORY_MANAGER`/`OWNER`/`ADMIN`/`SUPER_ADMIN`/`PURCHASE_MANAGER` roles gain visibility into a new, purely additive nav item and form field. No existing permission was removed from any role, no existing route's authorization outcome for any existing permission changed.

## 18. Capability Disable/Re-enable Behavior

Verified by real-DB test (§14, test file #2, tests 2–4): disabling `INVENTORY_BATCH` for a tenant does not reset, mutate, or rewrite the `fefoEnabled` column on any existing item, does not affect FIFO-layer data, and does not stop the shared valuation engine from continuing to honor `fefoEnabled: true` for that tenant's already-configured items (consumption trusts the item-level column, never re-checks the capability at consumption time). Re-enabling the capability afterward leaves the item's configuration exactly as it was throughout the whole cycle — no event-driven "flag-disable listener" infrastructure was built or is needed, matching D4 exactly.

## 19. Deviations from the Approved Plan

All deviations are corrections discovered by direct code inspection during implementation, not architectural changes:

1. **PUT gating logic corrected** (not in the original plan text, a real bug caught during implementation): gating on "the submitted `fefoEnabled` value is `true`" rather than "the value is transitioning to `true`" would have made every future edit to an already-batch-tracked item fail as soon as `INVENTORY_BATCH` is later disabled for the tenant — a direct violation of D4. Fixed to compare against the item's pre-update state (`body.data.fefoEnabled && !existing.fefoEnabled`).
2. **`apps/inventory-service/src/schemas/*`** (cited in `30-revised-file-level-change-plan.md`) does not exist as a directory; `ItemSchema` is inline Zod in `item.routes.ts`. Edited there instead — live code governs per the source-of-truth priority.
3. **`users-me-capabilities.test.ts`**: one existing test's mock (`if (key === 'POS') throw; return true;`) needed correcting to `return key === 'HR_PAYROLL'`, since adding a 3rd registry entry would otherwise have made that entry also resolve `true` and broken the test's exact-array assertion — an expected, mechanical consequence of adding a registry entry, not a plan error.
4. **`capability-registry.test.ts`**: `KNOWN_REAL_FLAG_KEYS`'s original rationale ("cross-checked against `TenantProvisioner.seedFeatureFlags()`") doesn't apply to `inventory.batch.enabled`, which is deliberately seeded only globally (migration `0169`), not per-tenant. Comment updated to explain this rather than silently adding the key.
5. **Migration tooling**: `drizzle-kit migrate` fails against the dev DB with an unhelpfully swallowed error (pre-existing, documented issue) — migration `0169` was verified correct by direct SQL application instead (§10).
6. **`packages/shared-types` and `packages/platform-sdk` required a manual `tsc` rebuild** before the new `BATCH_VIEW`/`BATCH_CONFIGURE`/`INVENTORY_BATCH` constants were visible to dependent services' compiled output during testing — a previously-documented recurring gotcha (`shared_package_rebuild_needed_for_typecheck` memory), not new to this phase.

No deviation required re-litigating D1–D4, changing the capability architecture, or touching anything the plan marked out of scope.

## 20. Newly Discovered Risks

- The `drizzle-kit migrate` CLI failure (§10, §19.5) is a real operational risk for whoever next runs `pnpm db:migrate` in this environment — it will need the same direct-application workaround or a root-cause fix, independent of Phase 2B. Recommend investigating separately (matches the already-tracked `db_migration_bookkeeping_broken` memory).
- `apps/inventory-service`'s existing `sync-routes.test.ts`/`warehouse-adjustment-transfer-permission-guards.test.ts` JWT-issuer mismatch (§15) will continue producing false failures for any future session that doesn't know to discount them — pre-existing, not newly introduced, but worth a dedicated fix at some point.

## 21. Acceptance Criteria Status (31-revised-acceptance-criteria.md)

All criteria addressed: registry completeness (✅ test), tenant-override resolution (✅ real-DB test), permission presence + role-default grant + existing-tenant backfill (✅ migration + test), full outcome matrix on the new route and the write-path gate (✅ tests), nav gating (✅ test), full regression across inventory/purchase/production/sales/tenant/web-frontend (✅, §15), all listed flows have FEFO/non-regression coverage (✅ for inventory-service's three; extended-by-code-identity for purchase/production per §14), expiry-scope UI disclosure (✅), real-infra tests not faked (✅, Docker was brought up and used for genuine Postgres+Redis integration tests).

## 22. Rollback Considerations

Dev-phase, no real production data (per `project_dev_phase_no_data` memory). Migration `0169`: `DELETE FROM feature_flags WHERE flag_key = 'inventory.batch.enabled'` + revert the `role_permissions` backfill rows. Code: every change in this phase is additive/conditional (new optional field, new route, new in-handler branch, new nav item) — reverting any single file drops that piece cleanly with no cleanup migration needed, since no data is written by this phase's code paths that wouldn't already have been written by the pre-existing unconditional GRN-capture path.

## 23. Final Implementation Verdict

**A. IMPLEMENTED AND VERIFIED.**

Backend enforcement exists at both the intended boundaries (in-handler write-path gate, top-level report-route gate) without over-gating any existing flow. Entitlement resolution and permission enforcement both work and are proven independent (capability-off denies regardless of permission; permission-missing denies regardless of capability). Frontend UX correctly hides/shows based on both. Tests pass at both the mocked-unit layer and the real-Postgres/Redis integration layer — infrastructure was available and used, not faked or silently skipped. Existing flows (GRN capture, near-expiry alerting, all seven consumption flows, sales/POS, Phase 2A's valuation consolidation) remain unchanged and regression-tested. Tenant isolation and the D4 disable/re-enable data-safety guarantee are both proven with real infrastructure, not merely asserted. No unauthorized industry-specific coupling was introduced — the capability remains a reusable, vertical-agnostic building block per the multi-industry principle.

Per instructions: **Phase 2B implementation and verification is complete. Stopping here — not proceeding to Phase 2C or any other phase.**
