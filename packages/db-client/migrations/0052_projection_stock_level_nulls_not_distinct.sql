-- QA session (2026-07-12, Inventory/Physical Verification deep dive): projection_stock_level's
-- unique constraint on (tenant_id, item_id, warehouse_id, variant_id) never actually prevented
-- duplicates for non-variant items, because Postgres treats NULL variant_id as distinct from
-- itself for uniqueness purposes. Every run of scheduler-service's rebuildStockLevelProjection
-- job (projectionRebuildJobs.ts) inserted a brand-new row per non-variant item/warehouse instead
-- of updating the existing one — confirmed live: 8 duplicate rows for a single item/warehouse
-- pair after normal GRN/adjustment/transfer activity. This silently corrupted every reader of
-- the projection: Physical Verification's snapshot (PhysicalVerificationService.startCounting),
-- low-stock queries (idx_psl_below_reorder), and ReorderService. Deduplicate (keep the most
-- recently updated row per group) before adding the corrected constraint, since the old one
-- never actually rejected the duplicates it was supposed to.
DELETE FROM "projection_stock_level" a
USING "projection_stock_level" b
WHERE a.id < b.id
  AND a.tenant_id = b.tenant_id
  AND a.item_id = b.item_id
  AND a.warehouse_id = b.warehouse_id
  AND a.variant_id IS NOT DISTINCT FROM b.variant_id;

ALTER TABLE "projection_stock_level" DROP CONSTRAINT "proj_stock_unique";
ALTER TABLE "projection_stock_level" ADD CONSTRAINT "proj_stock_unique"
  UNIQUE NULLS NOT DISTINCT ("tenant_id", "item_id", "warehouse_id", "variant_id");
