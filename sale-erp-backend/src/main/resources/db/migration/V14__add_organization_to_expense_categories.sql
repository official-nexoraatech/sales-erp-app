ALTER TABLE expense_categories
    ADD COLUMN IF NOT EXISTS organization_id BIGINT;

UPDATE expense_categories
SET organization_id = (
    SELECT id
    FROM organizations
    WHERE is_deleted = FALSE
    ORDER BY id
    LIMIT 1
)
WHERE organization_id IS NULL;

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM expense_categories WHERE organization_id IS NULL) THEN
        RAISE EXCEPTION 'Unable to populate organization_id for existing expense categories';
    END IF;
END $$;

ALTER TABLE expense_categories
    ALTER COLUMN organization_id SET NOT NULL;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'fk_expense_categories_organization'
    ) THEN
        ALTER TABLE expense_categories
            ADD CONSTRAINT fk_expense_categories_organization
            FOREIGN KEY (organization_id) REFERENCES organizations (id);
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_expense_categories_organization_id
    ON expense_categories (organization_id);
