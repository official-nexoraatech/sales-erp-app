ALTER TABLE brands
    DROP CONSTRAINT IF EXISTS fk_brands_organization;

DROP INDEX IF EXISTS idx_brands_organization_id;

ALTER TABLE brands
    DROP COLUMN IF EXISTS organization_id;
