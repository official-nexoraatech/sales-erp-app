-- ES-13 Migration: Inventory valuation (FIFO / WACC costing) + COGS

-- Step 1: Costing config + running valuation on items
ALTER TABLE "items"
  ADD COLUMN IF NOT EXISTS "costing_method" varchar(10) NOT NULL DEFAULT 'WACC',
  ADD COLUMN IF NOT EXISTS "wacc_cost" numeric(15, 2) NOT NULL DEFAULT '0',
  ADD COLUMN IF NOT EXISTS "current_stock_value" numeric(15, 2) NOT NULL DEFAULT '0';

-- Step 2: Cost used for each STOCK_OUT movement
ALTER TABLE "inventory_ledger"
  ADD COLUMN IF NOT EXISTS "cogs_per_unit" numeric(15, 2);

-- Step 3: FIFO cost layers — one row per STOCK_IN for FIFO-costed items
CREATE TABLE IF NOT EXISTS "inventory_fifo_layers" (
  "id" bigserial PRIMARY KEY,
  "tenant_id" integer NOT NULL,
  "item_id" integer NOT NULL,
  "variant_id" integer,
  "warehouse_id" integer NOT NULL,
  "received_at" timestamptz NOT NULL,
  "original_qty" numeric(15, 3) NOT NULL,
  "remaining_qty" numeric(15, 3) NOT NULL,
  "unit_cost" numeric(15, 2) NOT NULL,
  "source_ledger_id" integer NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "idx_fifo_layers_consume_order"
  ON "inventory_fifo_layers" ("tenant_id", "item_id", "warehouse_id", "received_at");
