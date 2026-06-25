INSERT INTO organizations (name, description, status, created_by, created_at, is_deleted)
VALUES ('Nexoraa Tech', 'Nexoraa technosolve it service private limited', 'ACTIVE', 'SYSTEM', CURRENT_TIMESTAMP, FALSE)
ON CONFLICT (name) DO NOTHING;

INSERT INTO roles (name, status, organization_id, created_by, created_at, is_deleted)
SELECT 'Admin', 'ACTIVE', organization_id, 'SYSTEM', CURRENT_TIMESTAMP, FALSE
FROM (
    SELECT id AS organization_id
    FROM organizations
    WHERE name = 'Nexoraa Tech'
    LIMIT 1
) organization
WHERE NOT EXISTS (
    SELECT 1
    FROM roles
    WHERE LOWER(name) = LOWER('Admin')
);
