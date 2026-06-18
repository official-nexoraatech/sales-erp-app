ALTER TABLE brands
    ADD COLUMN IF NOT EXISTS category_id BIGINT;

INSERT INTO categories (organization_id, name, description, status, created_by, created_at, is_deleted)
SELECT organization.id,
       'General',
       'Default category for existing brands',
       'ACTIVE',
       'SYSTEM',
       CURRENT_TIMESTAMP,
       FALSE
FROM organizations organization
WHERE EXISTS (
    SELECT 1
    FROM brands brand
    WHERE brand.organization_id = organization.id
      AND brand.category_id IS NULL
)
AND NOT EXISTS (
    SELECT 1
    FROM categories category
    WHERE category.organization_id = organization.id
      AND LOWER(category.name) = LOWER('General')
      AND category.is_deleted = FALSE
);

UPDATE brands brand
SET category_id = category.id
FROM (
    SELECT DISTINCT ON (organization_id)
           id,
           organization_id
    FROM categories
    WHERE status = 'ACTIVE'
      AND is_deleted = FALSE
    ORDER BY organization_id,
             CASE WHEN LOWER(name) = LOWER('General') THEN 0 ELSE 1 END,
             id
) category
WHERE brand.organization_id = category.organization_id
  AND brand.category_id IS NULL;

ALTER TABLE brands
    ALTER COLUMN category_id SET NOT NULL;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'fk_brands_category'
    ) THEN
        ALTER TABLE brands
            ADD CONSTRAINT fk_brands_category
            FOREIGN KEY (category_id) REFERENCES categories (id);
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_brands_category_id
    ON brands (category_id);
