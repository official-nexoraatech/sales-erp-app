-- One-time backfill: grant the Branch permissions directly to every existing
-- user so nobody is locked out of the feature just because it shipped after
-- their role was set up. New users going forward still need BRANCH_* granted
-- explicitly (via their role or Users > Permissions), same as any other permission.

INSERT INTO user_permission_mapping (user_id, permission_id)
SELECT u.id, p.id
FROM users u
CROSS JOIN permissions p
WHERE p.name IN ('BRANCH_CREATE', 'BRANCH_VIEW', 'BRANCH_UPDATE', 'BRANCH_DELETE')
  AND p.status = 'ACTIVE'
  AND NOT EXISTS (
      SELECT 1
      FROM user_permission_mapping upm
      WHERE upm.user_id = u.id
        AND upm.permission_id = p.id
  );
