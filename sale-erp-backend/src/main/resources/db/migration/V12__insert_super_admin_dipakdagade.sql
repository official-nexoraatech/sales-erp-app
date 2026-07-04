-- Seeds an additional Super Admin user reusing the "Super Admin" role
-- created in V11 (no structural changes to the schema).
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
    'Dipal',
    'Admin',
    'dipakdagade',
    'dipakdagade@nexoraa.com',
    NULL,
    'ACTIVE',
    role.id,
    organization.id,
    '$2a$10$gc2NS8Xm8AdSj11lNVCVB.0sAlsvnx33um8bqAvi4yUW.7Kx.oRTC',
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
      WHERE LOWER(existing_user.user_name) = LOWER('dipakdagade')
         OR LOWER(existing_user.email) = LOWER('dipakdagade@nexoraa.com')
  );
