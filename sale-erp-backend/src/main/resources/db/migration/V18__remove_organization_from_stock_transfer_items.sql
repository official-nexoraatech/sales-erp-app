ALTER TABLE stock_transfer_items
    DROP CONSTRAINT IF EXISTS fk_stock_transfer_items_organization;

DROP INDEX IF EXISTS idx_stock_transfer_items_organization_id;

ALTER TABLE stock_transfer_items
    DROP COLUMN IF EXISTS organization_id;

CREATE INDEX IF NOT EXISTS idx_stock_transfer_items_transfer_id
    ON stock_transfer_items (stock_transfer_id);
