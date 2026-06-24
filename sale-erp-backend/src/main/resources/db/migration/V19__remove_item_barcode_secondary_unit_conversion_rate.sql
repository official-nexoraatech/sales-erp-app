ALTER TABLE items
    DROP CONSTRAINT IF EXISTS fk_items_secondary_unit;

ALTER TABLE items
    DROP COLUMN IF EXISTS barcode;

ALTER TABLE items
    DROP COLUMN IF EXISTS secondary_unit_id;

ALTER TABLE items
    DROP COLUMN IF EXISTS conversion_rate;
