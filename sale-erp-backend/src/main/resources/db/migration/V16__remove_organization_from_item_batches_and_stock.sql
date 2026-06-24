ALTER TABLE item_batches
    DROP CONSTRAINT IF EXISTS fk_item_batches_organization;

DROP INDEX IF EXISTS idx_item_batches_organization_id;

ALTER TABLE item_batches
    DROP COLUMN IF EXISTS organization_id;

ALTER TABLE stock
    DROP CONSTRAINT IF EXISTS fk_stock_organization;

DROP INDEX IF EXISTS idx_stock_organization_id;

ALTER TABLE stock
    DROP COLUMN IF EXISTS organization_id;

CREATE INDEX IF NOT EXISTS idx_item_batches_item_id
    ON item_batches (item_id);

CREATE INDEX IF NOT EXISTS idx_stock_item_id
    ON stock (item_id);

CREATE INDEX IF NOT EXISTS idx_stock_item_warehouse_batch_id
    ON stock (item_id, warehouse_id, batch_id);
