# 01 — Current Code Evidence

Every claim below was independently verified by direct code/grep inspection on 2026-08-18 (this session), not carried forward from `multi-industry-platform/02-gap-analysis.md` G8's claims. Where this corrects that document, it's called out explicitly — this is the same rigor Phase 1's own docs applied to their sources.

---

## 1. Schema — real, already shipped, unused

`packages/db-client/migrations/0165_inventory_batch_expiry_fefo.sql`:

```sql
ALTER TABLE "items" ADD COLUMN "fefo_enabled" boolean DEFAULT false NOT NULL;
ALTER TABLE "inventory_fifo_layers" ADD COLUMN "batch_number" varchar(100);
ALTER TABLE "inventory_fifo_layers" ADD COLUMN "expiry_date" timestamp with time zone;
CREATE INDEX "idx_fifo_layers_fefo_order" ON "inventory_fifo_layers" ("tenant_id","item_id","warehouse_id","expiry_date");
```

All columns nullable/false-defaulted — confirmed zero behavior change to any existing tenant when added (the migration's own comment says so, and it's true: nothing reads `fefo_enabled` at decision time anywhere in the codebase — see §3).

## 2. Capture — real and working, unconditional

`apps/purchase-service/src/domain/GRNService.ts:391-396` (`applyStockIn` call): `batchNumber`/`expiryDate` captured on a GRN line are threaded onto the new `inventory_fifo_layers` row **whenever present on the GRN line**, regardless of `items.fefo_enabled`. This is real, tested code (confirmed by `apps/purchase-service/src/__tests__/grn-batch-expiry.integration.test.ts` existing). **This part needs no change** — it already correctly persists batch/expiry metadata to the ledger.

## 3. `items.fefoEnabled` — dead column, confirmed unreachable

Grepped every `.ts` file repo-wide for `fefoEnabled`: the **only** hit outside test/migration files is a comment in `GRNService.ts` referencing it as future context. `apps/inventory-service/src/api/item.routes.ts`'s `POST /items` and `PUT /items/:id` handlers use `ItemSchema` (Zod) to validate the request body — `fefoEnabled` is not a field in that schema, so **no API request can ever set this column to `true`**. It is a column that exists, defaults `false`, and can never become `true` through any code path in the repository today. `02-gap-analysis.md` G8's claim ("real consuming code, not just schema... GRNService.ts writes batch/expiry on receipt") is correct about capture but silently assumed the enablement toggle was also reachable — it is not. This is the first correction this phase makes.

## 4. FEFO consumption ordering — not implemented, confirmed by direct read

`apps/sales-service/src/domain/ValuationService.ts:243` (`consumeFifoLayers`, the function every stock-deducting sale/transfer ultimately calls):

```ts
.orderBy(asc(inventoryFifoLayers.receivedAt))
```

This is the **only** ordering clause in the function — no reference to `expiryDate`, `batchNumber`, or `fefoEnabled` anywhere in `ValuationService.ts`. Stock consumption is strict FIFO-by-receipt-date for every item, batch-tracked or not. `02-gap-analysis.md` G8 flagged this exact gap as "not independently re-verified... flag for verification before citing FEFO issuance as fully proven" — **this phase performs that verification and confirms the gap is real, not closed.**

## 5. `nearExpiryAlert.job.ts` — real and working, independent of `fefoEnabled`

`apps/inventory-service/src/jobs/nearExpiryAlert.job.ts` + its integration test (`apps/inventory-service/src/__tests__/near-expiry-alert.integration.test.ts`) query `inventory_fifo_layers` directly for rows with a non-null `expiry_date` within a threshold — this works today, already, and does **not** depend on `items.fefoEnabled` at all (it reads whatever `expiryDate` GRN capture happened to record, per §2). No change needed to this file. It is triggered by an internal route, `POST /inventory/near-expiry-alert` (`apps/inventory-service/src/api/stock.routes.ts:52`), called by the scheduler — not user-facing, no nav entry, produces notifications only.

## 6. Multi-UOM (`0166_purchase_unit_conversion.sql`) — same dead-column pattern, out of scope this phase

`items.purchaseUnitId`/`purchaseUnitConversionFactor` and `grnLines.receivedQtyBaseUnit` (migration `0166`) show the identical pattern: schema shipped, zero references in `item.routes.ts`'s `ItemSchema`, zero conversion logic found in `GRNService.ts` beyond the schema comment. This is a second, separate capability (`MULTI_UOM`) with the same shape of work — explicitly **not** bundled into this phase (see `00-overview.md` §6), but the pattern this phase establishes (register → complete plumbing → gate → nav) applies to it directly as a fast-follow.

## 7. No feature flag exists for either

`packages/db-client/migrations/0022_es28_seed_feature_flag_defaults.sql` and `TenantProvisioner.ts:420-438`'s hardcoded default-flags list were both read in full — neither contains `inventory.batch.enabled`, `inventory.multi-uom.enabled`, or any batch/UOM-related key. No tenant, existing or new, has any flag governing this behavior today. This confirms the capability genuinely does not exist yet in any form — it is not a matter of "wire an existing flag," a new flag must be introduced (§`03-capability-definition.md`).

## 8. No permissions exist for batch operations

Grepped `packages/shared-types/src/permissions.ts` for `BATCH_`/`FEFO_` — zero matches. `21-capability-resolution-architecture.md` §4's worked example registry entry for `INVENTORY_BATCH` lists `permissions: ['BATCH_VIEW', 'BATCH_CREATE', 'BATCH_ADJUST']` as an illustrative example — none of these constants exist in the real `permissions.ts` today (same situation Phase 1 found and corrected for its own `POS`/`HR_PAYROLL` entries, `20-implementation-report.md` §16 deviation 5).

## 9. No navigation entry exists

Grepped `apps/web-frontend/src/lib/navigation.ts` for `Batch`/`Expiry` — zero matches (the only near-hit, "GRNs," is the existing goods-receipt nav item, unrelated). `capabilityKey` field exists on `NavItem` (Phase 1) but is used by zero `NAV_GROUPS` entries (confirmed in Phase 1's own `21-post-implementation-review.md` §5).

## 10. Route/service map (for `05-service-impact.md`)

| Concern                                               | Service             | File                              | Current state                                  |
| ----------------------------------------------------- | ------------------- | --------------------------------- | ---------------------------------------------- |
| Item create/update (where `fefoEnabled` would be set) | `inventory-service` | `src/api/item.routes.ts`          | No field for it                                |
| Batch/expiry capture on receipt                       | `purchase-service`  | `src/domain/GRNService.ts`        | Works, unconditional                           |
| Stock consumption ordering                            | `sales-service`     | `src/domain/ValuationService.ts`  | Pure FIFO by `receivedAt`, no expiry awareness |
| Near-expiry alerting                                  | `inventory-service` | `src/jobs/nearExpiryAlert.job.ts` | Works, independent of `fefoEnabled`            |

**This alone is the single strongest piece of evidence for choosing this capability**: it already spans three services with no shared code path, giving `requireCapability`/`isCapabilityEnabled` a genuine, non-contrived test of `21-capability-resolution-architecture.md` §1's rule that a capability's implementation "may live inside one service, span several, or not correspond to any single service at all."

## 11. Correction to `19-first-industry-recommendation.md` re: Manufacturing

That document states `production-service` has "BOM/routing concepts partially present." Direct evidence found otherwise: `apps/production-service/src/domain/` contains exactly `BarcodeService.ts`, `ConsignmentService.ts`, `JobWorkOrderService.ts`, `ReorderService.ts` — no BOM, routing, work-center, or MRP file. Grepped `permissions.ts` for `BOM_|WORK_ORDER|PRODUCTION|MATERIAL_CONSUMPTION` — the only matches are `JOB_WORK_*` (7 constants, all about outsourced job-work orders, not in-house manufacturing routing). The NAV_GROUPS "PRODUCTION" group (`navigation.ts:611-663`) contains Job Work, Consignment, Reorder Report, and Barcode Labels only — confirming the same. **Manufacturing (BOM/MRP/Work Centers) is entirely net-new domain modeling**, not an extension of existing gap-flagged code as previously estimated — this materially changes its ranking relative to Distribution (see `02-business-requirements.md`).
