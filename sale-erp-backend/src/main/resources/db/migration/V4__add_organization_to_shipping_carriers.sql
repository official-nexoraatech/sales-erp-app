ALTER TABLE shipping_carriers
    ADD COLUMN IF NOT EXISTS organization_id BIGINT;

ALTER TABLE shipping_carriers
    ADD COLUMN IF NOT EXISTS whatsapp_no VARCHAR(20);

UPDATE shipping_carriers
SET organization_id = (
    SELECT id
    FROM organizations
    ORDER BY id
    LIMIT 1
)
WHERE organization_id IS NULL;

ALTER TABLE shipping_carriers
    ALTER COLUMN organization_id SET NOT NULL;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'fk_shipping_carriers_organization'
    ) THEN
        ALTER TABLE shipping_carriers
            ADD CONSTRAINT fk_shipping_carriers_organization
            FOREIGN KEY (organization_id) REFERENCES organizations (id);
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_shipping_carriers_organization_id
    ON shipping_carriers (organization_id);
