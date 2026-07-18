-- POS search-first redesign, Phase 1: adds the alias/supplier-code/custom-code fields the
-- cashier omnibox searches on (name/SKU/barcode were already searchable; these three were
-- never columns on items at all). idx_items_name_trgm (GIN, fuzzy) already exists from
-- 0007_phase13_indexes.sql — this migration mirrors that same pattern for alias, and adds
-- plain indexes for the two exact/prefix-lookup code columns.
-- Plain CREATE INDEX (not CONCURRENTLY): drizzle-kit migrate always runs each migration
-- file inside a transaction, and CONCURRENTLY cannot run in one (see 0007, 0016).

ALTER TABLE items
  ADD COLUMN IF NOT EXISTS alias varchar(150),
  ADD COLUMN IF NOT EXISTS supplier_code varchar(50),
  ADD COLUMN IF NOT EXISTS custom_code varchar(50);

CREATE INDEX IF NOT EXISTS idx_items_alias_trgm
  ON items USING gin (alias gin_trgm_ops)
  WHERE alias IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_items_supplier_code
  ON items (supplier_code)
  WHERE supplier_code IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_items_custom_code
  ON items (custom_code)
  WHERE custom_code IS NOT NULL;
