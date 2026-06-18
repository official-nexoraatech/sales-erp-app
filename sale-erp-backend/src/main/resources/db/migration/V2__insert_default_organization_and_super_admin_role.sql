INSERT INTO organizations (name, description, status, created_by, created_at, is_deleted)
VALUES ('Billing test organozation', 'Default billing test organization', 'ACTIVE', 'SYSTEM', CURRENT_TIMESTAMP, FALSE)
ON CONFLICT (name) DO NOTHING;

INSERT INTO roles (name, status, organization_id, created_by, created_at, is_deleted)
SELECT 'Super Admin', 'ACTIVE', organization_id, 'SYSTEM', CURRENT_TIMESTAMP, FALSE
FROM (
    SELECT id AS organization_id
    FROM organizations
    WHERE name = 'Billing test organozation'
    LIMIT 1
) organization
WHERE NOT EXISTS (
    SELECT 1
    FROM roles
    WHERE LOWER(name) = LOWER('Super Admin')
);
