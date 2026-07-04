-- Platform-level Super Admin: seeded as a regular role/user row in the existing
-- schema (no structural changes). The "Super Admin" role name is what grants
-- access to the /api/v2/admin/** endpoints (see BillTopUserDetails.isSuperAdmin()).
INSERT INTO roles (name, status, organization_id, created_by, created_at, is_deleted)
SELECT 'Super Admin', 'ACTIVE', organization_id, 'SYSTEM', CURRENT_TIMESTAMP, FALSE
FROM (
    SELECT id AS organization_id
    FROM organizations
    WHERE name = 'Nexoraa Tech'
    LIMIT 1
) organization
WHERE NOT EXISTS (
    SELECT 1
    FROM roles
    WHERE LOWER(name) = LOWER('Super Admin')
);

INSERT INTO users (
    first_name,
    last_name,
    user_name,
    email,
    mobile_no,
    status,
    role_id,
    organization_id,
    password,
    created_by,
    created_at,
    is_deleted
)
SELECT
    'Super',
    'Admin',
    'superadmin',
    'superadmin@nexoraa.com',
    '9999999998',
    'ACTIVE',
    role.id,
    organization.id,
    '$2a$10$CPYmtAseOAIYWOb3anlPPu3z7b8PRvdOrzrfpjcU.eUxjqUrs03yq',
    'SYSTEM',
    CURRENT_TIMESTAMP,
    FALSE
FROM organizations organization
JOIN roles role
    ON role.organization_id = organization.id
   AND LOWER(role.name) = LOWER('Super Admin')
   AND role.is_deleted = FALSE
WHERE organization.name = 'Nexoraa Tech'
  AND organization.is_deleted = FALSE
  AND NOT EXISTS (
      SELECT 1
      FROM users existing_user
      WHERE LOWER(existing_user.user_name) = LOWER('superadmin')
         OR LOWER(existing_user.email) = LOWER('superadmin@nexoraa.com')
  );

INSERT INTO role_permission_mapping (role_id, permission_id)
SELECT role.id, permission.id
FROM organizations organization
JOIN roles role
    ON role.organization_id = organization.id
   AND LOWER(role.name) = LOWER('Super Admin')
   AND role.is_deleted = FALSE
JOIN permissions permission
    ON permission.status = 'ACTIVE'
   AND permission.is_deleted = FALSE
WHERE organization.name = 'Nexoraa Tech'
  AND organization.is_deleted = FALSE
ON CONFLICT (role_id, permission_id) DO NOTHING;
