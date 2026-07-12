-- PG-032: True per-warehouse stock valuation for WACC-costed items.
--
-- FIFO-costed items are already genuinely warehouse-scoped via inventory_fifo_layers.warehouse_id,
-- and GET /inventory/valuation computes their per-warehouse cost live from that table (grouped by
-- warehouse_id) rather than from this new table — so this migration does NOT backfill FIFO items
-- here; nothing ever reads FIFO data from inventory_warehouse_valuation.
--
-- For WACC-costed items, items.wacc_cost/current_stock_value are tenant-wide only. This table adds
-- a warehouse dimension, maintained going forward by ValuationService.applyStockIn() /
-- consumeForStockOut() alongside (not instead of) the existing tenant-wide columns.
CREATE TABLE IF NOT EXISTS "inventory_warehouse_valuation" (
  "id" bigserial PRIMARY KEY,
  "tenant_id" integer NOT NULL,
  "item_id" integer NOT NULL,
  "variant_id" integer,
  "warehouse_id" integer NOT NULL,
  "wacc_cost" numeric(15, 2) NOT NULL DEFAULT '0',
  "stock_value" numeric(15, 2) NOT NULL DEFAULT '0',
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "inventory_warehouse_valuation_tenant_item_variant_wh"
    UNIQUE ("tenant_id", "item_id", "variant_id", "warehouse_id")
);

CREATE INDEX IF NOT EXISTS "idx_warehouse_valuation_lookup"
  ON "inventory_warehouse_valuation" ("tenant_id", "item_id", "warehouse_id");

-- Backfill: initial seed uses today's ratio-estimate (tenant-wide items.wacc_cost applied to each
-- warehouse's real quantity, from projection_stock_level) — the same figure GET /inventory/valuation
-- already produces today for WACC items. Real per-warehouse divergence is tracked correctly only
-- from this point forward, as each subsequent stock-in/stock-out updates this table independently
-- of the tenant-wide items.wacc_cost. Only warehouses with real stock on hand are seeded.
INSERT INTO "inventory_warehouse_valuation" ("tenant_id", "item_id", "variant_id", "warehouse_id", "wacc_cost", "stock_value", "updated_at")
SELECT
  psl.tenant_id,
  psl.item_id,
  psl.variant_id,
  psl.warehouse_id,
  i.wacc_cost,
  ROUND(psl.available_qty * i.wacc_cost, 2),
  now()
FROM "projection_stock_level" psl
JOIN "items" i ON i.id = psl.item_id AND i.tenant_id = psl.tenant_id
WHERE i.costing_method = 'WACC'
  AND psl.available_qty > 0;
