ALTER TABLE addresses
    DROP CONSTRAINT IF EXISTS fk_addresses_country;

ALTER TABLE addresses
    DROP COLUMN IF EXISTS country_id;
