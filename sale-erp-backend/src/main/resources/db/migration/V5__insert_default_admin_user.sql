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
    'Admin',
    'User',
    'admin',
    'admin@nexoraa.com',
    '9999999999',
    'ACTIVE',
    role.id,
    organization.id,
    '$2a$10$7OoGZ23HD2DktKH7TXBl2uvdIKPOlh4mFZJhiCx6C9Vxp6AKPZ9/q',
    'SYSTEM',
    CURRENT_TIMESTAMP,
    FALSE
FROM organizations organization
JOIN roles role
    ON role.organization_id = organization.id
   AND LOWER(role.name) = LOWER('Admin')
   AND role.is_deleted = FALSE
WHERE organization.name = 'Nexoraa Tech'
  AND organization.is_deleted = FALSE
  AND NOT EXISTS (
      SELECT 1
      FROM users existing_user
      WHERE LOWER(existing_user.user_name) = LOWER('admin')
         OR LOWER(existing_user.email) = LOWER('admin@nexoraa.com')
  );

INSERT INTO role_permission_mapping (role_id, permission_id)
SELECT role.id, permission.id
FROM organizations organization
JOIN roles role
    ON role.organization_id = organization.id
   AND LOWER(role.name) = LOWER('Admin')
   AND role.is_deleted = FALSE
JOIN permissions permission
    ON permission.status = 'ACTIVE'
   AND permission.is_deleted = FALSE
WHERE organization.name = 'Nexoraa Tech'
  AND organization.is_deleted = FALSE
ON CONFLICT (role_id, permission_id) DO NOTHING;
