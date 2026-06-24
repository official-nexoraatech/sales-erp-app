ALTER TABLE item_prices
    DROP CONSTRAINT IF EXISTS fk_item_prices_organization;

DROP INDEX IF EXISTS idx_item_prices_organization_id;

ALTER TABLE item_prices
    DROP COLUMN IF EXISTS organization_id;

CREATE INDEX IF NOT EXISTS idx_item_prices_item_id
    ON item_prices (item_id);
