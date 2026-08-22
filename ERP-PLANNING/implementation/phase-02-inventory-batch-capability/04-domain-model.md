# 04 — Domain Model Impact

## 1. Summary: no new tables, no new columns

Every column this capability needs already exists, shipped by migrations `0165_inventory_batch_expiry_fefo.sql` (2026-08-16): `items.fefo_enabled`, `inventory_fifo_layers.batch_number`, `inventory_fifo_layers.expiry_date`, plus the `idx_fifo_layers_fefo_order` index already shaped for exactly the query this phase adds (`tenant_id, item_id, warehouse_id, expiry_date`). This phase is schema-complete before it starts — confirmed by direct migration read, `01-current-code-evidence.md` §1.

## 2. What actually changes at the domain-model level

Not new entities — new **behavior** on existing entities:

```
items.fefoEnabled: boolean
  BEFORE: column exists, always false, unreachable via any API (dead)
  AFTER:  settable via POST/PUT /items when INVENTORY_BATCH capability is enabled for the tenant;
          rejected (ignored, with a validation note — see 07-api-contracts.md) when not

inventory_fifo_layers (batchNumber, expiryDate)
  BEFORE: written unconditionally by GRNService whenever the GRN line carries the data (unchanged)
  AFTER:  unchanged capture; now also READ in consumption-ordering decisions (see below)

consumeFifoLayers() [ValuationService.ts]
  BEFORE: orderBy(asc(receivedAt))                                    — pure FIFO, always
  AFTER:  orderBy(asc(expiryDate) NULLS LAST, asc(receivedAt))        — when the item being
          consumed has fefoEnabled = true; unchanged orderBy(asc(receivedAt)) otherwise
```

## 3. Why no new `business_types.default_capability_keys` entry is added

That column/table doesn't exist yet (Business Profile foundation is a separate, not-yet-built workstream — `01-current-code-evidence.md`, `00-roadmap-analysis.md` §B). This phase seeds the capability's default state the same way Phase 1 did for `HR_PAYROLL`/`POS`: a global (`tenant_id IS NULL`) row in `feature_flags`, consumed by every tenant through the existing `PlatformFeatureFlags` default-fallback mechanism (`06-database-impact.md`). When the Business Profile foundation lands, `DISTRIBUTION`/`MANUFACTURING` business types' `default_capability_keys` can reference `INVENTORY_BATCH` directly — no rework needed, this phase's registry entry is exactly what that future step will point to.

## 4. Explicitly not modeled (per CLAUDE.md Simplicity First / brief's non-goals)

- No `batches` entity/table — a "batch" remains a `(batchNumber, expiryDate)` pair recorded on an `inventory_fifo_layers` row, not promoted to its own first-class table. No evidence of a need for batch-level metadata beyond number+expiry (e.g. supplier lot certificates) exists in the codebase or this phase's scope.
- No `MULTI_UOM` schema work — already shipped (`0166`), belongs to the separate `MULTI_UOM` capability, not touched here.
- No BOM/recipe/component-lot linkage for a future Manufacturing use — speculative, explicitly out of scope (brief §7 non-goals: "complete Manufacturing ERP").
