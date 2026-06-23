ALTER TABLE payment_methods
    ADD COLUMN IF NOT EXISTS organization_id BIGINT;

UPDATE payment_methods
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
    IF EXISTS (SELECT 1 FROM payment_methods WHERE organization_id IS NULL) THEN
        RAISE EXCEPTION 'Unable to populate organization_id for existing payment methods';
    END IF;
END $$;

ALTER TABLE payment_methods
    ALTER COLUMN organization_id SET NOT NULL;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'fk_payment_methods_organization'
    ) THEN
        ALTER TABLE payment_methods
            ADD CONSTRAINT fk_payment_methods_organization
            FOREIGN KEY (organization_id) REFERENCES organizations (id);
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_payment_methods_organization_id
    ON payment_methods (organization_id);
