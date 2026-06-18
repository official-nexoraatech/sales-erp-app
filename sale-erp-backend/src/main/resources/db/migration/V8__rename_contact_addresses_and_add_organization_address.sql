DO $$
BEGIN
    IF to_regclass('public.addresses') IS NULL AND to_regclass('public.contact_addresses') IS NOT NULL THEN
        ALTER TABLE contact_addresses RENAME TO addresses;
    END IF;
END $$;

DO $$
BEGIN
    IF to_regclass('public.addresses') IS NOT NULL THEN
        IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_contact_addresses_organization')
           AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_addresses_organization') THEN
            ALTER TABLE addresses RENAME CONSTRAINT fk_contact_addresses_organization TO fk_addresses_organization;
        END IF;

        IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_contact_addresses_contact')
           AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_addresses_contact') THEN
            ALTER TABLE addresses RENAME CONSTRAINT fk_contact_addresses_contact TO fk_addresses_contact;
        END IF;

        IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_contact_addresses_state')
           AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_addresses_state') THEN
            ALTER TABLE addresses RENAME CONSTRAINT fk_contact_addresses_state TO fk_addresses_state;
        END IF;

        IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_contact_addresses_country')
           AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_addresses_country') THEN
            ALTER TABLE addresses RENAME CONSTRAINT fk_contact_addresses_country TO fk_addresses_country;
        END IF;
    END IF;
END $$;

ALTER TABLE organizations ADD COLUMN IF NOT EXISTS address_id BIGINT;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uk_organizations_address') THEN
        ALTER TABLE organizations ADD CONSTRAINT uk_organizations_address UNIQUE (address_id);
    END IF;
END $$;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'organizations'
          AND column_name = 'address'
    ) THEN
        INSERT INTO addresses (
            organization_id,
            address_type,
            address_line1,
            created_by,
            created_at,
            is_deleted
        )
        SELECT
            organization.id,
            'ORGANIZATION',
            LEFT(organization.address, 250),
            COALESCE(organization.created_by, 'SYSTEM'),
            CURRENT_TIMESTAMP,
            FALSE
        FROM organizations organization
        WHERE organization.address_id IS NULL
          AND organization.address IS NOT NULL
          AND BTRIM(organization.address) <> ''
          AND NOT EXISTS (
              SELECT 1
              FROM addresses address
              WHERE address.organization_id = organization.id
                AND address.contact_id IS NULL
                AND address.address_type = 'ORGANIZATION'
          );
    END IF;
END $$;

UPDATE organizations organization
SET address_id = address.id
FROM addresses address
WHERE organization.address_id IS NULL
  AND address.organization_id = organization.id
  AND address.contact_id IS NULL
  AND address.address_type = 'ORGANIZATION';

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_organizations_address') THEN
        ALTER TABLE organizations
            ADD CONSTRAINT fk_organizations_address
                FOREIGN KEY (address_id) REFERENCES addresses (id);
    END IF;
END $$;

ALTER TABLE organizations DROP COLUMN IF EXISTS address;
