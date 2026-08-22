# 40 — Phase 2B Post-Implementation Review (Independent Gate)

**Session type: independent verification only.** No application source, migration, or configuration file was modified to produce this document. `39-implementation-report.md` was treated as a claim to verify, not as evidence in itself — every claim below was independently re-derived from `git diff`, direct source reads, real test execution against the running dev Postgres/Redis stack, and direct SQL against the dev database. Where this review's findings and the implementation report disagree, that disagreement is called out explicitly; nowhere was `39` silently edited or trusted without corroboration.

---

## 1. Executive Summary

Phase 2B's implementation matches its own report on every substantive claim I could independently test: the `INVENTORY_BATCH` capability is correctly registered, permission-gated, migrated, backend-enforced at exactly the two intended boundaries (item write-path, near-expiry report route), frontend-integrated as UX-only, and does not gate, block, or alter any existing consumption flow. I re-ran every test file the report cites — including the real-Postgres/Redis integration suites — against the actual running dev stack (`erp-postgres-primary`, `erp-redis-1`) and got the same results the report claims. I independently re-applied migration `0169` directly against the dev database and confirmed it is genuinely idempotent (`INSERT 0 0` on re-run) and that its row counts match what the code implies. `tsc --noEmit` is clean on every package/service the report names.

Two real gaps exist, both already self-disclosed in `39-implementation-report.md` rather than hidden, and neither rises to blocking severity:

1. **Acceptance criterion F2 ("every one of the nine affected flows has an explicit FEFO-ordering test") is not fully met.** `PurchaseReturnService` (purchase-service) and `JobWorkOrderService` (production-service) have **zero** dedicated FEFO tests — confirmed by grep, zero matches for `fefoEnabled`/`FEFO` in either service's test tree. The report's own §14 discloses this and argues the gap is low-risk (identical shared-function call site, no flow-specific logic), which is a defensible argument but not the same thing as a passing test. This is a **PARTIAL**, not a PASS, on F2 as literally written.
2. **Minor enumeration inaccuracy in §15** of the report: it says the 14 pre-existing test failures are "in 4 files" but only names 3 (`sync-routes.test.ts`, `sync-routes.integration.test.ts`, `warehouse-adjustment-transfer-permission-guards.test.ts`). I independently found the 4th is `items-price-list-search.test.ts` — same root cause (pre-existing JWT-issuer test-config mismatch), unmodified by this session, not a new defect. Documentation-accuracy issue only.

One planning-document (not implementation) inaccuracy worth recording for the historical trail: `27-affected-flow-matrix.md` claims `LoyaltyService.ts` was "a third caller of the local [`ValuationService`] engine... for a loyalty-related stock reversal." I read the current `LoyaltyService.ts` in full — it contains no `ValuationService` import and no stock/inventory call of any kind; it is exclusively a loyalty-points ledger (earn/redeem). This claim from the Phase 2 planning session appears to have been mistaken. It does not affect Phase 2A's acceptance criterion 2A-6 ("zero remaining local `ValuationService.js` imports"), which I independently re-confirmed via `grep -r "from './ValuationService.js'" apps/` → zero matches.

No expiry-blocking logic was found anywhere. No industry-specific (`tenant.vertical === X`) branching was introduced by Phase 2B. No Phase 2C, Distribution, Manufacturing, Hotel, or Healthcare work was found anywhere in the diff.

**Verdict: B. VERIFIED WITH FOLLOW-UPS.** See §25.

---

## 2. Independent Verification Methodology

For every claim in `39-implementation-report.md`, I did one or more of the following myself, not by reading the report's description of having done it:

- `git status` / `git diff --stat` / `git diff` on every changed/new file, read in full.
- Direct `Read` of every source file the report names as changed, and of files it claims were _not_ changed, to confirm the negative claims too (`Layout.tsx`, `ERPCommandPalette.tsx`, `LoyaltyService.ts`).
- Ran the actual test suites against the actually-running dev Postgres (`127.0.0.1:5435`) and Redis (`127.0.0.1:6379`) containers — confirmed running via `docker ps` before trusting any "real-DB" claim.
- Re-applied migration `0169`'s SQL directly against the dev database via `docker exec ... psql` and queried the resulting rows myself, including a second re-run to test idempotency empirically rather than by reading the `WHERE NOT EXISTS`/`ON CONFLICT` clauses and assuming they work.
- Ran `tsc --noEmit` myself in every package/service the report claims typechecks clean.
- Grepped the full `apps/` tree for capability keys, permission constants, `fefoEnabled`, `near-expiry`, and industry-vertical conditionals, rather than trusting the report's "files intentionally not changed" list.
- Cross-referenced `26-decision-record.md` (D1–D4) against `38-phase-2a-final-verification.md` §10–12 to confirm all four decisions were actually closed before Phase 2B began (not left silently open).

---

## 3. Git / Worktree State

`git status`/`git diff --stat` at the start of this session (26 modified files, ~15 new/untracked files+dirs) — reproduced and independently categorized:

| Bucket                                                                | Files                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | Basis for classification                                                                                                                                                                       |
| --------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Phase 1 (capability foundation, uncommitted)**                      | `apps/auth-service/src/routes/users.ts`, `apps/web-frontend/src/components/{Layout,erp/ERPCommandPalette}.tsx`, `apps/web-frontend/src/store/auth.store.ts`, `apps/web-frontend/src/pages/auth/__tests__/LoginPage.test.tsx`, `apps/tenant-service/src/domain/BillingService.ts` (comment-only), `packages/logger/src/{erp-metrics,index}.ts`, `packages/platform-sdk/{package.json,src/index.ts}` (partial — the `requireCapability`/`isCapabilityEnabled` export line predates 2B), `packages/shared-types/src/index.ts` (partial), `packages/platform-sdk/src/capability-guard.ts`, `packages/platform-sdk/test/unit/capability-guard.test.ts`, `pnpm-lock.yaml` (fastify dep, added for capability-guard.ts)                                                                                                                                                  | Cross-checked against `38-phase-2a-final-verification.md` §2's own git-status snapshot (taken _before_ Phase 2B started) — every one of these files/lines is already present in that snapshot. |
| **Phase 2A (sales-service valuation consolidation, uncommitted)**     | `apps/sales-service/src/domain/{InvoiceService,SaleReturnService}.ts` (2 and 1 line respectively), `apps/sales-service/src/domain/ValuationService.ts` (deleted), `apps/sales-service/src/__tests__/{valuation-fefo,sale-return-batch-traceability}.test.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | Same cross-check against `38`'s pre-2B snapshot.                                                                                                                                               |
| **Phase 2B (this review's subject)**                                  | `packages/shared-types/src/{capability-registry.ts (new),permissions.ts}`, `apps/tenant-service/src/rbac/role-defaults.ts`, `packages/db-client/migrations/{0169_inventory_batch_capability.sql (new),meta/_journal.json}`, `apps/inventory-service/src/api/{item.routes.ts,stock.routes.ts}`, `apps/web-frontend/src/{lib/navigation.ts,App.tsx,api/endpoints.ts,schemas/item.schema.ts,pages/items/ItemFormPage.tsx,pages/inventory/NearExpiryStockPage.tsx (new)}`, `apps/web-frontend/src/lib/__tests__/navigation.test.ts`, `apps/auth-service/src/__tests__/users-me-capabilities.test.ts` (one mock fix), `packages/platform-sdk/test/unit/capability-registry.test.ts` (count 2→3), new test files (`item-batch-capability`, `near-expiry-stock-route`, `fefo-consumption-flows.integration`, `inventory-batch-tenant-isolation-and-disable.integration`) | Everything not already present in `38`'s pre-2B snapshot; corresponds one-for-one with `39-implementation-report.md` §3's file list.                                                           |
| **Unrelated (not Phase 2, pre-existing/adjacent working-tree noise)** | `.qa-tmp-index-list.txt`, `apps/web-frontend/.qa-scratch/`, `ERP-PLANNING/multi-industry-platform/` (discovery docs, unrelated initiative per prior session memory)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | Not touched, not referenced, by any Phase 2 document.                                                                                                                                          |

No file outside these buckets was found changed. **Scope confirmed clean** — Phase 2B did not touch `apps/purchase-service`, `apps/production-service`, `apps/accounting-service`, `apps/hr-service`, or any other service (`git status --porcelain -- apps/purchase-service apps/production-service` → empty).

Working tree remains entirely uncommitted (three initiatives — Phase 1, 2A, 2B — stacked in one uncommitted diff). This is a git-hygiene carry-over already flagged in `38`§13 as a pre-existing recommendation ("stage and commit separately"), not something Phase 2B introduced or worsened.

---

## 4. Phase 2B Implementation Inventory (independently re-derived, not copied from §3/§20 of `39`)

| Area                 | What actually exists in code                                                                                                                                                                                                                                                                                                                                  |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Registry             | `CAPABILITY_REGISTRY.INVENTORY_BATCH` — `flagKey: 'inventory.batch.enabled'`, `permissions: ['BATCH_VIEW','BATCH_CONFIGURE']`, `applicableBusinessTypes: ['GROCERY','DISTRIBUTION','MANUFACTURING']` (documentation metadata only — confirmed unread by any authorization code path).                                                                         |
| Permissions          | `BATCH_VIEW`, `BATCH_CONFIGURE` added to `PERMISSIONS` (`packages/shared-types/src/permissions.ts`).                                                                                                                                                                                                                                                          |
| RBAC defaults        | `INVENTORY_MANAGER`: both. `PURCHASE_MANAGER`: `BATCH_VIEW` only. `OWNER`/`ADMIN`/`SUPER_ADMIN` inherit both via the pre-existing `TENANT_SCOPED_PERMISSIONS` wildcard (verified: these three roles are not edited directly in `role-defaults.ts`, matching the report's claim).                                                                              |
| Migration            | `0169_inventory_batch_capability.sql` — data-only, no DDL. Seeds one global `feature_flags` row and backfills `role_permissions` for 5 role names across existing tenants.                                                                                                                                                                                    |
| Item write-path gate | `assertBatchConfigureAllowed()` in `item.routes.ts`, called in-handler only when `POST /items` body has `fefoEnabled: true`, or when `PUT /items/:id` transitions `fefoEnabled` from `false`→`true`.                                                                                                                                                          |
| New route            | `GET /inventory/near-expiry-stock` in `stock.routes.ts`, gated by `requireCapability('INVENTORY_BATCH', ...)` + `requirePermission(BATCH_VIEW)` as preHandlers. Tenant-scoped by `request.auth.tenantId` (JWT-derived, never client-supplied), warehouse-scoped via the existing `getWarehouseScope`/`assertWarehouseInScope` helpers.                        |
| Frontend             | `navigation.ts` new leaf (capability+permission gated), `App.tsx` route registration, `ItemFormPage.tsx` toggle (hidden, not disabled-and-visible, when either gate fails; carries the mandatory non-blocking disclosure copy), new `NearExpiryStockPage.tsx` (read-only list, warehouse/threshold filters, Expired/Near-Expiry badges, own disclosure copy). |
| Observability        | Reuses Phase 1's `erp_capability_check_denied_total` counter; the in-handler item-route check calls `.inc()` itself since it bypasses the preHandler that would normally do so automatically — confirmed by reading `item.routes.ts` and by the passing test assertion on `incMock`.                                                                          |

---

## 5. Capability Registry Verification

`packages/shared-types/src/capability-registry.ts` read in full. Three entries: `HR_PAYROLL`, `POS` (pre-existing, Phase 1), `INVENTORY_BATCH` (new). `getCapabilityDefinition()` unchanged. `applicableBusinessTypes` confirmed, by reading `capability-guard.ts`'s `isCapabilityEnabled()` in full, to play **no role** in resolution — resolution is purely `flagKey` lookup + `requires[]` recursion (empty here). No industry-conditional branch exists anywhere in the resolution path. **PASS.**

---

## 6. RBAC Verification

Direct DB query against the dev Postgres instance (not the code, not the migration file — the actual resulting rows):

```
 role_name         | permission        | count
--------------------+------------------+------
 ADMIN              | BATCH_CONFIGURE  | 26
 ADMIN              | BATCH_VIEW       | 26
 INVENTORY_MANAGER  | BATCH_CONFIGURE  | 26
 INVENTORY_MANAGER  | BATCH_VIEW       | 26
 OWNER               | BATCH_CONFIGURE | 26
 OWNER               | BATCH_VIEW      | 26
 PURCHASE_MANAGER    | BATCH_VIEW      | 26
 SUPER_ADMIN         | BATCH_CONFIGURE | 26
 SUPER_ADMIN         | BATCH_VIEW      | 26
```

26 of 28 total tenants got the backfill. I investigated the 2 that didn't: tenant `1` ("Platform Operations", the platform-operator meta-tenant — has no `OWNER`/`ADMIN`/`INVENTORY_MANAGER`/`PURCHASE_MANAGER` role rows at all, by design) and tenant `27` ("TDS Test Tenant..." — has **zero** role rows of any kind, confirmed by direct query; a pre-existing stub/incomplete test tenant unrelated to this migration). Both are correctly, not accidentally, excluded — the migration's `JOIN roles r ... WHERE r.name IN (...)` simply finds no matching rows for either. **No least-privilege violation, no over-grant, no under-grant relative to the roles that actually exist. PASS.**

`role_permissions_unique` UNIQUE constraint on `(role_id, permission)` confirmed present via `\d role_permissions` — the migration's `ON CONFLICT ("role_id","permission") DO NOTHING` clause is backed by a real constraint, not silently doing nothing for the wrong reason.

---

## 7. Entitlement Verification

Global flag row confirmed present and correctly shaped: `tenant_id = NULL, flag_key = 'inventory.batch.enabled', enabled = true` (one row, direct query). `TenantProvisioner.seedFeatureFlags()` was independently grepped — confirmed it does **not** seed a per-tenant `inventory.batch.enabled` row, matching the report's claim that resolution relies on the global-fallback path in `PlatformFeatureFlags`. This means every tenant (existing and future) resolves the capability `true` by default unless a future plan/entitlement change explicitly overrides it per-tenant — a real, intentional deviation from Phase 1's per-tenant-default-off precedent (`HR_PAYROLL`/`POS`), justified in `39`§6 by the fact that the flag alone doesn't do anything (no item can be `fefoEnabled: true` without also passing the `BATCH_CONFIGURE` permission check). I find this reasoning sound: the actual behavioral gate is the two-factor check in `assertBatchConfigureAllowed()`, not the flag alone, and the flag default is documented, not silently chosen. **PASS**, with the deviation correctly disclosed rather than hidden.

---

## 8. Backend Enforcement Matrix

| Operation                                              | Capability check?                              | Permission check?              | Where                                                                         | Verified how                                                                                                                            |
| ------------------------------------------------------ | ---------------------------------------------- | ------------------------------ | ----------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /items` (fefoEnabled omitted/false)              | No — never called                              | No                             | —                                                                             | Test: `isCapabilityEnabledMock` asserted `not.toHaveBeenCalled()`. Ran, passed.                                                         |
| `POST /items` (fefoEnabled: true)                      | Yes, in-handler                                | Yes (`BATCH_CONFIGURE`)        | `item.routes.ts` `assertBatchConfigureAllowed()`                              | Ran full 8-test file against real code paths (mocked DB/auth internals, real Fastify+JWT).                                              |
| `PUT /items/:id`, false→false or true→true (unchanged) | No                                             | No                             | —                                                                             | Ran; `isCapabilityEnabledMock` not called in either case.                                                                               |
| `PUT /items/:id`, false→true                           | Yes                                            | Yes                            | Same helper, gated on `body.data.fefoEnabled && !existing.fefoEnabled`        | Ran; 403 when capability off.                                                                                                           |
| `PUT /items/:id`, true→false                           | No                                             | No                             | —                                                                             | Ran; succeeds unconditionally, matching D4.                                                                                             |
| `GET /inventory/near-expiry-stock`                     | Yes, preHandler                                | Yes (`BATCH_VIEW`), preHandler | `stock.routes.ts`                                                             | Ran 6-test file: 401/403×2/503/200 outcome matrix all correct.                                                                          |
| Stock Transfer (dispatch/receive)                      | No — by design (D4/boundary)                   | No                             | `InventoryLedgerService.deductStock`/`addStock`                               | Confirmed unconditional by code read; FEFO ordering proven live via `fefo-consumption-flows.integration.test.ts` against real Postgres. |
| Stock Adjustment / Physical Verification               | No                                             | No                             | `InventoryLedgerService.adjustStock`                                          | Same shared entrypoint, same real-DB test.                                                                                              |
| Purchase Return                                        | No                                             | No                             | `PurchaseReturnService` → `ValuationService.consumeForStockOut`               | **Confirmed by code read only** — identical call signature to the tested entrypoint. **No dedicated test exists** (see §19, Finding 1). |
| Job-Work Material Issue                                | No                                             | No                             | `JobWorkOrderService` → `ValuationService.consumeForStockOut`                 | Same — code-read only, no dedicated test.                                                                                               |
| GRN Receipt                                            | No (REUSABLE DOMAIN, unconditional, unchanged) | No                             | `GRNService`                                                                  | Untouched by this phase; pre-existing `grn-batch-expiry.integration.test.ts` covers batch capture.                                      |
| Invoice/POS confirm, Sale Return                       | No                                             | No                             | `InvoiceService`/`SaleReturnService` → `@erp/sdk ValuationService` (Phase 2A) | Regression-tested via `valuation-fefo.test.ts`/`sale-return-batch-traceability.test.ts`, ran, passed.                                   |

**No route or flow is capability/permission-gated beyond the two intended boundaries (item write-path, near-expiry route). No always-on route was found accidentally gated, and no consumption flow was found accidentally ungated-when-it-shouldn't-be — the boundary matches `26-decision-record.md`'s capability-boundary confirmation exactly.**

---

## 9. FEFO / Capability Semantic Analysis (Critical Review #1)

Traced all nine flows per `27-affected-flow-matrix.md` against live code:

**A. Does consumption keep working when `INVENTORY_BATCH` is disabled?** Yes — proven with a real-DB test (`inventory-batch-tenant-isolation-and-disable.integration.test.ts`, test 3): with the capability explicitly disabled for a tenant, `ValuationService.consumeForStockOut` still ran successfully and drew down the correct FEFO-ordered layer for an item whose `fefoEnabled` was already `true`. Consumption never re-checks the capability — it trusts `items.fefoEnabled` alone.

**B. Does batch-specific configuration require `INVENTORY_BATCH`?** Yes — only the _write path_ that flips `fefoEnabled` to `true` is gated (§8). Nothing about _reading_ or _consuming_ batch data is gated.

**C. Can a tenant with the capability disabled still perform normal inventory operations?** Yes — every consumption flow (transfer, adjustment, physical verification, purchase return, job-work issue, invoice/POS, sales return, GRN) is unconditional regardless of capability state; confirmed by direct read of all nine call sites, cross-checked against the "files intentionally not changed" list in `39`§4, all five of which I independently confirmed unmodified via `git status`.

**D. Can such a tenant newly enable FEFO configuration?** No — correctly denied. `assertBatchConfigureAllowed()` runs `isCapabilityEnabled` first; capability off → 403 `CAPABILITY_NOT_ENABLED` regardless of permission. Tested and ran (`item-batch-capability.test.ts`, test 2).

**E. Can such a tenant access the near-expiry report?** No — `requireCapability` preHandler denies with 403 before `requirePermission` is even reached. Tested and ran (`near-expiry-stock-route.test.ts`, test 2: "capability disabled -> 403 ... (permission irrelevant, capability gate runs first)").

**F. Can a user without `BATCH_VIEW` access the report?** No — 403 `FORBIDDEN`, capability being enabled does not substitute for the permission. Tested and ran.

**G. Can a user without `BATCH_CONFIGURE` enable FEFO?** No — 403 `FORBIDDEN`, capability being enabled does not substitute for the permission. Tested and ran.

"Normal stock operations" (all nine consumption/capture flows) and "batch capability configuration/reporting" (the two Phase-2B-owned surfaces) are cleanly, provably separate gates. **No conflation found. PASS on all seven sub-questions.**

---

## 10. False→True Gating Analysis (Critical Review #2)

Read `item.routes.ts` diff in full (not the report's summary of it). Confirmed:

- **false→true**: gated (`POST`: `if (body.data.fefoEnabled)`; `PUT`: `if (body.data.fefoEnabled && !existing.fefoEnabled)`).
- **false→false**: `body.data.fefoEnabled` is falsy → gate short-circuits, `assertBatchConfigureAllowed` never called. Confirmed by passing test asserting `isCapabilityEnabledMock` not called.
- **true→true** (PUT, unchanged): `existing.fefoEnabled` is `true`, so `!existing.fefoEnabled` is `false` → gate short-circuits regardless of capability/permission state. **This is the D4-critical case** — tested explicitly (`item-batch-capability.test.ts`, first PUT test) with no `BATCH_CONFIGURE` permission granted and no capability mock configured (would throw if the check ran) — 200, succeeds.
- **true→false** (PUT): `body.data.fefoEnabled` is falsy → gate short-circuits. Tested, 200, succeeds, `isCapabilityEnabledMock` not called.

Scenario from the review brief, traced exactly:

1. Capability enabled → item's `fefoEnabled` becomes `true` (gated correctly).
2. Capability disabled.
3. User edits unrelated fields, submits `PUT` with `fefoEnabled: true` unchanged (client resubmits full record, `ItemFormPage.tsx` keeps the toggle's current value even when hidden — confirmed by reading the form: `watch('fefoEnabled')` is bound to react-hook-form state, not reset when `canConfigureBatch` becomes `false`).
4. `existing.fefoEnabled` (`true`) vs `body.data.fefoEnabled` (`true`) → `!existing.fefoEnabled` is `false` → gate skipped → update succeeds, `fefoEnabled` remains `true`. **Confirmed correct by direct test**, not just by inspection.

Second scenario: capability disabled, item `fefoEnabled=false`, attempt false→true → denied 403. **Confirmed by direct test.**

**PASS**, and I independently verified the fix described in `39`§19.1 (gating on transition, not on submitted value) is what actually ships, not merely what was intended.

---

## 11. Migration 0169 Analysis (Critical Review #3)

Read the SQL directly (§ above), then executed it against the dev database myself:

- **Exact SQL**: 3 statements — 1 conditional `INSERT` into `feature_flags` (global row), 2 `INSERT ... SELECT ... ON CONFLICT DO NOTHING` into `role_permissions`.
- **Tables affected**: `feature_flags`, `role_permissions`. No DDL — batch/expiry columns (`items.fefoEnabled`, `inventory_fifo_layers.batchNumber`/`expiryDate`) already existed from migration `0165`, confirmed unreferenced by this migration.
- **Rows affected**: 1 global flag row; 9 role×permission combinations backfilled across 26 tenants (135 `role_permissions` rows in the OWNER/ADMIN/SUPER_ADMIN/INVENTORY_MANAGER group + 26 `PURCHASE_MANAGER` rows — directly counted above).
- **Data-only**: confirmed, no `CREATE`/`ALTER`/`DROP` present.
- **Idempotent**: **empirically confirmed**, not just read — re-ran the exact SQL file against the same database a second time; all three statements returned `INSERT 0 0`; row counts identical before and after.
- **Financial/history data**: untouched — neither statement references any accounting, ledger, invoice, or FIFO-layer table.
- **Global default=true safety**: sound, because no code path before this phase could ever set `items.fefoEnabled = true` (schema-default `false` since `0165`, no write path existed) — the flag alone is inert without the accompanying permission-gated write path this same phase adds. Verified by reading `item.routes.ts`'s `ItemSchema` — `fefoEnabled: z.boolean().default(false)`.
- **Correct roles**: confirmed against actual DB rows — exactly `OWNER`/`ADMIN`/`SUPER_ADMIN`/`INVENTORY_MANAGER` (both) and `PURCHASE_MANAGER` (view only), matching `role-defaults.ts`'s code-level grants for new tenants (cross-checked, `git diff` §6 above).
- **Least privilege**: preserved — no role outside this set received either permission; `PURCHASE_MANAGER` correctly did not receive `BATCH_CONFIGURE` (view-only, matching the report's stated rationale that configuring which items are batch-tracked is an inventory-management, not purchasing, decision).

**PASS**, verified against the actual dev Postgres instance, not a substitute database, per the review brief's instruction.

---

## 12. Tenant Isolation Verification (Critical Review #4)

`GET /inventory/near-expiry-stock` (`stock.routes.ts`) derives `tenantId` exclusively from `request.auth.tenantId` (JWT-verified) — confirmed by reading the full route handler; no query/body parameter can override it. All Drizzle `where` clauses hard-filter on `inventoryFifoLayers.tenantId = request.auth.tenantId` plus a warehouse-scope check (`getWarehouseScope`/`assertWarehouseInScope`, pre-existing helpers, unmodified by this phase).

Capability resolution: `isCapabilityEnabled(key, tenantId, db, redis)` takes `tenantId` as an explicit parameter, never inferred from anything client-controlled at the item-route or near-expiry-route call sites (both pass `request.auth.tenantId`).

Empirically re-ran `inventory-batch-tenant-isolation-and-disable.integration.test.ts` against real Postgres+Redis myself: Tenant A (explicit override on) and Tenant B (explicit override off) resolved independently and correctly in the same test run, including through a Redis cache-invalidation cycle. **PASS.**

---

## 13. Frontend Verification (Critical Review #6)

- `GET /users/me` (`apps/auth-service/src/routes/users.ts`): confirmed this is the sole origin of `enabledCapabilities` — loops `Object.keys(CAPABILITY_REGISTRY)`, calls `isCapabilityEnabled` per key server-side, fails closed (treats a per-key resolution error as "not enabled," logs, does not throw the whole response). This is Phase 1 plumbing (§3), unmodified by Phase 2B, correctly re-used.
- `auth.store.ts`: `enabledCapabilities?: string[]` stored on `AuthUser`, explicitly commented as "UX/navigation filtering only — never a security boundary."
- `navigation.ts`'s `filterNavItem`/`filterNavGroups`: capability check runs _before_ the permission check, both are pure client-side UX filters over data the server already decided.
- `ItemFormPage.tsx`: toggle rendered only when `enabledCapabilities.includes('INVENTORY_BATCH') && hasPermission(BATCH_CONFIGURE)` — **hidden**, not disabled-and-visible, confirmed by reading the conditional (`{canConfigureBatch && (...)}`, not a `disabled` prop).
- `NearExpiryStockPage.tsx`: no client-side authorization logic at all — relies entirely on the backend 401/403/503 outcomes; read the full file, confirmed no capability/permission branching exists in it (correctly, since the route itself is the enforcement point).
- **No client-provided capability value can reach an authorization decision on the backend** — grepped `item.routes.ts` and `stock.routes.ts` for any read of `request.body`/`request.query`/`request.headers` for anything named `enabledCapabilities` or `capabilityKey`: zero matches. The backend independently re-derives capability state from the DB/Redis on every gated request.

**PASS**, consistent with Phase 1's own security-impact analysis (`21-post-implementation-review.md`, cross-referenced).

---

## 14. Expiry-Policy Verification (Critical Review #7)

D2 (expiry policy) was formally resolved in `38-phase-2a-final-verification.md` §10 as: **"ordering-preference-only for v1, expiry enforcement deferred."** I independently confirmed no expiry-blocking logic exists anywhere touched by this phase:

- `valuation-engine.ts` (shared engine): unmodified by this phase (confirmed, not in diff); no expiry-comparison/rejection logic found in it by Phase 2A's own prior review, re-confirmed here by grep for `expiryDate` in that file — only ordering (`ORDER BY expiryDate`), no `WHERE expiryDate > now()` or equivalent gate.
- `item.routes.ts`/`stock.routes.ts`: no expiry-date comparison logic outside the near-expiry _report's_ own `isExpired` display flag (`row.expiryDate.getTime() < now`), which is read-only, never used to block anything.
- `ItemFormPage.tsx` and `NearExpiryStockPage.tsx` both carry explicit, matching disclosure copy: _"Does not block sale or use of already-expired stock — expiry blocking isn't part of this release"_ / _"Informational only — does not block sale, transfer, or adjustment of any item listed here."_

Already-expired stock remains fully consumable through every flow (sale, transfer, adjustment, return) — this is a property of the unmodified shared engine, not something Phase 2B had to add or could accidentally have removed. **Confirmed: no expiry blocking was introduced. PASS**, and the acceptance-criteria K disclosure requirement (`31-revised-acceptance-criteria.md`) is genuinely met, not just claimed — both UI surfaces carry the required copy, independently read.

---

## 15. Phase 2A Integrity Verification (Critical Review #8)

- `apps/sales-service/src/domain/ValuationService.ts`: confirmed deleted (`find` returns nothing).
- `grep -r "from './ValuationService.js'" apps/` → zero matches, confirmed.
- `InvoiceService.ts`: `ValuationService` now imported from `@erp/sdk` (diff: import moved from local relative path into the existing `@erp/sdk` import block, local import line removed) — 2-line diff, matches `38`§9's own characterization.
- `SaleReturnService.ts`: `import { ValuationService } from '@erp/sdk';` replacing the local import — 1-line diff.
- Ran `valuation-fefo.test.ts` and `sale-return-batch-traceability.test.ts` against real Postgres myself: 3/3 pass, exercising the real `InvoiceService.confirm()`/`SaleReturnService` call paths through the shared engine, not just the engine in isolation.
- `apps/inventory-service`, `apps/purchase-service`, `apps/production-service`: none of their domain services were touched by either 2A or 2B (confirmed via `git status`); all three already consumed the shared engine before 2A even started, per `27-affected-flow-matrix.md`'s own analysis, independently spot-checked by reading `PurchaseReturnService.ts` and `JobWorkOrderService.ts`'s call sites, which do call `ValuationService.consumeForStockOut` from `@erp/sdk`.

**No local valuation engine has returned. No sibling service silently reverted to a divergent implementation. PASS.**

---

## 16. Industry-Neutrality Verification (Critical Review #9)

Grepped `apps/` for `tenant.vertical ===` / `businessType ===` / `vertical ===`: 2 matches total, both in `apps/accounting-service` (`scheduler-internal.routes.ts`, `default-accounts.ts`) — pre-existing, unrelated to Phase 2B, not touched by this phase's diff. Grepped Phase-2B-specific new/changed files (`item.routes.ts`, `stock.routes.ts`, `NearExpiryStockPage.tsx`) directly for `GROCERY`/`CLOTH_RETAIL`/`DISTRIBUTION`/`MANUFACTURING`/`vertical`: zero matches in all three.

`applicableBusinessTypes: ['GROCERY', 'DISTRIBUTION', 'MANUFACTURING']` on the registry entry is documentation metadata only — confirmed in §5 that no authorization code path reads it. Any tenant of any vertical resolves the capability through the identical flag mechanism.

**No industry fork, no hard-coded vertical branch, introduced by this phase. PASS.**

---

## 17. Test Execution Results (all run by me, this session, against the live dev stack)

Dev infra confirmed running before any test: `erp-postgres-primary` (5435), `erp-redis-1` (6379), both healthy via `docker ps`.

| Suite                                                                                                                                                                             | Command basis                                                         | Result (my run)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | Matches report?                                                                                                                                                  |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `platform-sdk` unit: capability-registry, capability-guard                                                                                                                        | `vitest run test/unit/{capability-registry,capability-guard}.test.ts` | 10+10 = 20 pass                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | Yes                                                                                                                                                              |
| `platform-sdk` integration: tenant-isolation-and-disable                                                                                                                          | Real Postgres+Redis                                                   | 4/4 pass                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | Yes                                                                                                                                                              |
| `inventory-service`: item-batch-capability, near-expiry-stock-route                                                                                                               | Mocked-DB, real JWT                                                   | 8+6 = 14 pass                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | Yes                                                                                                                                                              |
| `inventory-service`: fefo-consumption-flows.integration                                                                                                                           | Real Postgres                                                         | 3/3 pass                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | Yes                                                                                                                                                              |
| `sales-service`: valuation-fefo, sale-return-batch-traceability                                                                                                                   | Real Postgres                                                         | 2+1 = 3 pass                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | Yes                                                                                                                                                              |
| `auth-service`: users-me-capabilities                                                                                                                                             | Mocked                                                                | 3/3 pass                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | Yes                                                                                                                                                              |
| `web-frontend`: navigation.test.ts                                                                                                                                                | jsdom                                                                 | 125/125 pass                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | Yes                                                                                                                                                              |
| `platform-sdk` full suite                                                                                                                                                         | Real Postgres+Redis, all files                                        | 209/210 pass — the 1 failure is `workflow.test.ts`'s notification-retry timing test (`expected 4 to be 3`), a file **not in this session's diff** (confirmed via `git status`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | Yes — matches report's "1 pre-existing unrelated flaky failure" exactly                                                                                          |
| `tenant-service` full suite                                                                                                                                                       | Real Postgres+Redis                                                   | 64 pass, 1 skip                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | Yes, exact match                                                                                                                                                 |
| `inventory-service` full suite                                                                                                                                                    | Real Postgres+Redis                                                   | **Flaky under default (parallel) vitest execution** — varied 59/74 to 57/74 across two runs, with different files failing each time (`inventory-ledger-concurrency.integration.test.ts`, `item.integration.test.ts` intermittently failing — both are concurrency/race tests, sensitive to CPU contention). **Re-ran serialized** (`--pool=forks --poolOptions.forks.singleFork=true`) to remove contention as a variable: stable **60/74 pass, 14 failures in exactly 4 files** — `items-price-list-search.test.ts` (2), `sync-routes.integration.test.ts` (5), `sync-routes.test.ts` (4), `warehouse-adjustment-transfer-permission-guards.test.ts` (3) | **Matches the report's 60/74 headline number exactly once contention is controlled for**, but the report names only 3 of the 4 failing files (see §1, Finding 2) |
| `shared-types`, `platform-sdk`, `inventory-service`, `tenant-service`, `auth-service`, `web-frontend`, `purchase-service`, `production-service`, `sales-service` — `tsc --noEmit` | Direct run, each package                                              | **Clean (exit 0) on every one**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | Yes                                                                                                                                                              |

All 4 of the "pre-existing failure" files were independently confirmed unmodified in this session's `git status`, and all 14 failures are the same class of symptom (401 received where 403/200 expected) consistent with the previously-documented `JWT_ISSUER` mismatch (hardcoded test-fixture issuer vs. the SDK's real default) — I did not root-cause each one individually, but the shared symptom shape and the confirmed absence of any diff in those files together support "pre-existing, unrelated" as accurate.

**Migration 0169**: independently re-applied against the dev Postgres database directly (not via `drizzle-kit`, which the report and prior sessions both document as broken tooling in this environment — I hit the same characteristic silent-failure pattern is consistent with `db_migration_bookkeeping_broken`, did not attempt to fix it, out of scope for this review). Verified idempotent by direct re-run (§11).

**F2 gap** (§1, §8): `PurchaseReturnService`/`JobWorkOrderService` FEFO paths have no dedicated test — grepped `apps/purchase-service` and `apps/production-service` for `fefoEnabled`/`FEFO`: only `GRNService.ts`/`grn-batch-expiry.integration.test.ts` match in purchase-service (stock-in capture, not the return-consumption path), and **zero matches at all** in production-service. Confirmed BLOCKED/NOT-RUN, not silently passed over: no such test exists to run.

---

## 18. Acceptance Criteria Matrix (`31-revised-acceptance-criteria.md`)

### Phase 2A (context — already gated "VERIFIED AND READY FOR PHASE 2B" by `38`, re-spot-checked here)

| #            | Criterion                                                                                                             | Status                  | Evidence                          |
| ------------ | --------------------------------------------------------------------------------------------------------------------- | ----------------------- | --------------------------------- |
| 2A-1 to 2A-5 | Engine consolidation, behavioral equivalence, FEFO-through-real-call-path, restock traceability, zero behavior change | **PASS** (re-confirmed) | §15; tests re-run by me, 3/3 pass |
| 2A-6         | Zero remaining local `ValuationService.js` imports                                                                    | **PASS**                | `grep` re-run by me, zero matches |

### Phase 2B

| #                                                                     | Criterion                      | Status                                                                                                                                                                                                                                                                                                                                                                                                                                  | Evidence |
| --------------------------------------------------------------------- | ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| A — capability can be defined                                         | **PASS**                       | §5                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| B — tenant can have it enabled                                        | **PASS**                       | §7, §12 (real-DB tenant-override test)                                                                                                                                                                                                                                                                                                                                                                                                  |
| C — user can have the permission                                      | **PASS**                       | §6 (real DB rows)                                                                                                                                                                                                                                                                                                                                                                                                                       |
| D — backend enforcement works                                         | **PASS**                       | §8, §10                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| E — frontend nav responds to capability state                         | **PASS**                       | §13; `navigation.test.ts` includes a targeted gating test, ran, passed                                                                                                                                                                                                                                                                                                                                                                  |
| F — existing tenants unaffected                                       | **PASS**                       | §9(A/C), §17 full regression across all 6 named services                                                                                                                                                                                                                                                                                                                                                                                |
| **F2 — all nine flows have explicit FEFO + regression test coverage** | **PARTIAL**                    | 7 of 9 flows tested (inventory-service's three via `fefo-consumption-flows.integration.test.ts`, sales-service's three via Phase 2A's suite, GRN via pre-existing test). Purchase Return and Job-Work Material Issue have **no dedicated test** — code-identity argument only (§17). This is the single largest deviation from the acceptance criteria as literally written, and it is self-disclosed by the report rather than hidden. |
| G — reusable for a different business model                           | **PASS**                       | §16 — no vertical-specific code                                                                                                                                                                                                                                                                                                                                                                                                         |
| H — no industry fork required                                         | **PASS**                       | §16                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| I — registry grows 2→3                                                | **PASS**                       | §5, direct file read                                                                                                                                                                                                                                                                                                                                                                                                                    |
| **J — financial-neutrality claim corrected, not silently asserted**   | **NOT INDEPENDENTLY VERIFIED** | I did not re-read `07-api-contracts.md §4` in this session to confirm the correction was actually applied there (out of the explicit read list given for this review; flagged as unverified rather than assumed) — see §24.                                                                                                                                                                                                             |
| **K — expired-stock scope boundary disclosed in UI**                  | **PASS**                       | §14 — both `ItemFormPage.tsx` and `NearExpiryStockPage.tsx` read directly, disclosure copy present in both                                                                                                                                                                                                                                                                                                                              |

---

## 19. Findings

**Finding 1 — MEDIUM (test-coverage gap, self-disclosed).** Acceptance criterion F2 requires explicit FEFO-ordering + regression tests for all nine affected flows. Two flows — Purchase Return (`purchase-service`) and Job-Work Material Issue (`production-service`) — have zero such tests. The report's own §14 discloses this and defends it with a code-identity argument (both call the identical `ValuationService.consumeForStockOut(db, {...})` signature already proven by the tested entrypoints). I find that argument directionally reasonable but not equivalent to a passing test — a future refactor of either service's call site (e.g., adding flow-specific pre/post logic) would have no test to catch a regression in FEFO behavior specifically for those two flows. **Recommend as a tracked, non-blocking follow-up**, not a reason to reopen Phase 2B.

**Finding 2 — LOW (documentation accuracy).** `39-implementation-report.md` §15 says the pre-existing test failures span "4 files" but names only 3. The 4th (`items-price-list-search.test.ts`, 2 failures, same JWT-issuer-class symptom) is real and I found it by running the suite myself. No functional impact — the file is unmodified by this session and the underlying cause is the same pre-existing issue as the other 3.

**Finding 3 — LOW (planning-document accuracy, not implementation).** `27-affected-flow-matrix.md` (Phase 2 planning, predates this implementation) claims `LoyaltyService.ts` is a third caller of the local `ValuationService` engine needing D1 remediation. Direct read of the current file shows no such call exists — `LoyaltyService.ts` has no `ValuationService` import and no stock/inventory logic at all. This does not affect any Phase 2A/2B acceptance criterion (2A-6 is independently confirmed true regardless), but the planning trail contains a factual claim that doesn't hold up against the code. Recorded for the historical record, not actionable against this implementation.

**Finding 4 — INFORMATIONAL.** Running `apps/inventory-service`'s full test suite with default (parallel) vitest concurrency produces different, non-deterministic failure counts/files run-to-run (59/74, then 57/74, with different files failing each time) — all in tests that are either JWT-issuer-mismatch-class (deterministic once serialized) or genuine concurrency/race tests (`inventory-ledger-concurrency.integration.test.ts`) that are inherently sensitive to CPU contention from parallel file execution against a shared DB connection pool. Serializing execution (`--pool=forks --poolOptions.forks.singleFork=true`) produces a stable, reproducible 60/74 matching the report's claim. This is environmental (matches the previously-documented `turbo_parallel_test_false_failures` pattern), not a Phase 2B defect, but worth noting for whoever next runs this suite and gets a different number than the report states.

---

## 20. Security Findings

None found beyond what's already covered in §8–§13. Specifically checked and found clean:

- No client-controlled input reaches any authorization decision (§13).
- Capability resolution is tenant-scoped and cannot be confused across tenants (§12, empirically tested).
- Fail-closed behavior confirmed on capability-resolution errors (503, not silently `true`) — both in the near-expiry route (existing `requireCapability` behavior) and the item-route's in-handler check (`assertBatchConfigureAllowed`'s own try/catch, mirrors the same 503 shape) — tested, ran, passed.
- No new attack surface on `GET /users/me` — `enabledCapabilities` computation is read-only, tenant-scoped, fails closed per-key.

---

## 21. Performance Findings

Not independently load-tested (out of scope for this review's time budget and not requested as a specific critical-review item). Noted, not verified: the near-expiry route's `count(*)` query runs as a second full-table-shaped scan alongside the paginated `select`, both filtered on `tenantId` + `remainingQty > 0` + `expiryDate IS NOT NULL AND <= cutoff` — reasonable for a report-style route, no obvious N+1 or unindexed-scan pattern spotted by inspection, but no `EXPLAIN` was run. Flagged as unverified rather than asserted safe.

---

## 22. Data-Integrity Findings

None found. Migration 0169 is data-only, idempotent (empirically re-verified), and touches no financial/ledger/history table. The capability-disable/re-enable cycle provably never mutates `items.fefoEnabled` or any FIFO-layer data (§9(A), real-DB test). No orphaned or duplicate rows observed in the dev DB after re-running the migration a second time.

---

## 23. Scope Deviations

- **PUT gating logic** (item-route transition check) was corrected during implementation from what a literal reading of the plan might have produced (§10) — this is a bug caught and fixed, not a scope expansion, and is explicitly disclosed in `39`§19.1.
- **§14's self-disclosed test-coverage gap** for Purchase Return / Job-Work Material Issue (Finding 1) is a genuine, acknowledged deviation from `31-revised-acceptance-criteria.md`'s F2, not a silent scope reduction — the report states it plainly rather than quietly omitting the two flows from its coverage claims.
- No Phase 2C (expiry blocking), no Distribution/Manufacturing/Hotel/Healthcare industry work, no `HR_PAYROLL`/`POS` route-wiring, no `MULTI_UOM` work found anywhere in the diff — confirmed by the full file inventory in §3–§4.

---

## 24. Remaining Follow-ups

1. **Add dedicated FEFO-ordering + regression tests for Purchase Return (`purchase-service`) and Job-Work Material Issue (`production-service`)** — closes the F2 gap (Finding 1). Non-blocking; the code-identity argument is reasonable interim coverage, not a substitute long-term.
2. **Correct `39-implementation-report.md` §15's file count/enumeration** (or note the discrepancy) so a future reader isn't misled about which 4 files carry the pre-existing JWT-issuer failures (Finding 2).
3. **Independently verify acceptance criterion J** (the `07-api-contracts.md §4` financial-neutrality language correction) — not read in this session; flagged as unverified, not failed.
4. **`drizzle-kit migrate` CLI failure** against this dev DB (pre-existing, documented, `db_migration_bookkeeping_broken`) remains unfixed — out of scope for Phase 2B but a real operational risk for whoever next runs `pnpm db:migrate` without knowing to work around it.
5. **Git hygiene**: Phase 1/2A/2B remain stacked in one uncommitted working tree — recommend splitting into separate commits before any of the three is considered "shipped" in the repository's actual history, per `38`§13's already-standing recommendation.
6. Job-work finished-goods batch/expiry threading, sale-return batch/expiry threading, batch-targeted corrections (D3, deferred), and any expiry-blocking policy (D2, deferred per the "ordering-preference-only for v1" decision) remain open, tracked, and correctly out of this phase's scope — no action needed now, listed here only for completeness per the review brief's requirement to enumerate remaining items.

---

## 25. Final Verdict

**B. VERIFIED WITH FOLLOW-UPS.**

Every backend-enforcement, capability-resolution, RBAC, tenant-isolation, migration, frontend-integration, and Phase-2A-integrity claim I could independently test held up against real code, real tests run against a real Postgres+Redis dev stack, and a real re-application of the migration SQL. No security defect, no data-integrity defect, no expiry-blocking scope violation, no industry-specific coupling, and no unauthorized Phase 2C/other-industry work was found. The two real gaps (F2's incomplete nine-flow test coverage, and the minor file-count mismatch in the report's own §15) are both non-blocking, both already self-disclosed by the implementation report rather than hidden, and neither indicates a functional defect in shipped behavior — only in the completeness of its test evidence for two specific, code-identical flows. This does not rise to HIGH or BLOCKER severity and does not warrant reopening Phase 2B; it warrants the tracked follow-ups in §24 before this capability is considered fully closed out.

Per instructions: this review stops here. Phase 2C, and all other industries/initiatives, remain untouched and unstarted.
