# 21 — File-Level Change Plan

Implementation order (each step independently verifiable before the next, per CLAUDE.md's Goal-Driven Execution).

## Step 1 — Registry & permissions (no runtime effect yet)

| File                                                        | Change                                                                                                                  |
| ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `packages/shared-types/src/capability-registry.ts`          | Add `INVENTORY_BATCH` entry (`03-capability-definition.md` §2)                                                          |
| `packages/shared-types/src/permissions.ts`                  | Add `BATCH_VIEW`, `BATCH_CONFIGURE` (`08-permissions-and-rbac.md` §1)                                                   |
| `apps/tenant-service/src/rbac/role-defaults.ts`             | Grant both to `INVENTORY_MANAGER`/`OWNER`/`ADMIN`; `BATCH_VIEW` to `PURCHASE_MANAGER` (`08-permissions-and-rbac.md` §2) |
| `apps/tenant-service/src/__tests__/role-defaults.test.ts`   | Extend to assert the above                                                                                              |
| `packages/shared-types/src/__tests__/*capability-registry*` | Update hardcoded entry-count assertion (2 → 3) if present                                                               |

**Verify**: typecheck clean, registry-completeness test passes, no runtime behavior changed (nothing reads the new entries yet).

## Step 2 — Migration

| File                                                                                                             | Change                                                                                                                                         |
| ---------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/db-client/migrations/0169_*.sql` (verify next number, `17-migration-and-backward-compatibility.md` §5) | Seed global `inventory.batch.enabled = true`; backfill existing tenants' relevant roles with the two new permissions (`06-database-impact.md`) |
| New or extended migration integration test                                                                       | Idempotency + backfill-coverage assertions (`16-testing-strategy.md` §2)                                                                       |

**Verify**: migration runs clean against a fresh DB and re-runs idempotently; existing tenant's `INVENTORY_MANAGER` role, queried directly, now includes both new permissions.

## Step 3 — Backend: item configuration + consumption ordering

| File                                                                                                                  | Change                                                                                                                                                                                                                                                   |
| --------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/inventory-service/src/schemas/*` (wherever `ItemSchema` is defined — confirm exact path at implementation time) | Add optional `fefoEnabled: boolean`                                                                                                                                                                                                                      |
| `apps/inventory-service/src/api/item.routes.ts`                                                                       | In-handler capability check on `POST /items`/`PUT /items/:id` when `fefoEnabled: true` is present (`05-service-impact.md` §1, `15-security-impact.md` §2 fail-closed requirement); `erpCapabilityCheckDeniedTotal.inc()` call (`18-observability.md` §1) |
| `apps/inventory-service/src/__tests__/*`                                                                              | New/extended tests per `16-testing-strategy.md` §2                                                                                                                                                                                                       |
| `apps/sales-service/src/domain/ValuationService.ts`                                                                   | `consumeFifoLayers()` conditional `orderBy` (`05-service-impact.md` §3)                                                                                                                                                                                  |
| `apps/sales-service/src/__tests__/valuation-service.test.ts` (or equivalent)                                          | New FEFO-ordering tests + regression proof for `fefoEnabled: false` path                                                                                                                                                                                 |

**Verify**: full A–E outcome behavior on the item routes' new field; FEFO ordering test passes; every pre-existing `ValuationService`/item-route test still passes unmodified.

## Step 4 — Backend: new report route

| File                                                                                                                                    | Change                                                                                                                                                                                                 |
| --------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `apps/inventory-service/src/api/item.routes.ts` or a new `apps/inventory-service/src/api/batch.routes.ts`                               | `GET /inventory/near-expiry-stock`, `preHandler: [authenticate, requireCapability('INVENTORY_BATCH', db, redis), requirePermission(BATCH_VIEW)]` (`05-service-impact.md` §1, `07-api-contracts.md` §2) |
| Route registration (`main.ts` or the service's route-plugin index, wherever new route files are wired — confirm at implementation time) | Register the new route file if a separate file was chosen                                                                                                                                              |
| `apps/inventory-service/src/__tests__/near-expiry-stock.test.ts` (new)                                                                  | Full A–E outcome matrix (`16-testing-strategy.md` §2)                                                                                                                                                  |

**Verify**: matches Phase 1's own route-level test pattern exactly (`capability-guard-route.test.ts`); tenant isolation proven.

## Step 5 — Frontend

| File                                                                                                                                             | Change                                                                                     |
| ------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------ |
| `apps/web-frontend/src/lib/navigation.ts`                                                                                                        | New `capabilityKey`-tagged nav item under `INVENTORY` (`09-navigation-and-frontend.md` §1) |
| `apps/web-frontend/src/lib/__tests__/navigation.test.ts`                                                                                         | New tests for the tagged item's visibility                                                 |
| Item form component (exact file TBD at implementation time — under `apps/web-frontend/src/pages/inventory/` or similar, per existing convention) | Conditional `fefoEnabled` toggle section (`09-navigation-and-frontend.md` §2)              |
| New page component + route registration (`apps/web-frontend/src/pages/inventory/NearExpiryStock.tsx` or similar)                                 | Consumes `GET /inventory/near-expiry-stock` (`09-navigation-and-frontend.md` §3)           |
| `apps/web-frontend/src/api/endpoints.ts`                                                                                                         | New API client method for the new route                                                    |

**Verify**: manual in-browser check per `16-testing-strategy.md` §5; RTL tests for the new page and the conditional form section.

## Step 6 — Full regression + sign-off

Per `16-testing-strategy.md` §3 — `git stash -u` comparison, full typecheck, full test suite, matching Phase 1's exact discipline.

## Not touched by this phase (explicit, for the implementing session's confidence)

`apps/purchase-service/*` (zero files), `apps/hr-service/*`, `apps/production-service/*`, `apps/crm-service/*`, `apps/api-gateway/*`, any migration below `0169`, `industries`/`business_types` (don't exist), `tenants.vertical`, any CRM/O2C-split-adjacent file.
