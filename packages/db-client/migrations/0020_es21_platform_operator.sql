-- ES-21 — Security: Tenant-Admin & User-Management Authorization Lockdown
--
-- Seeds a reserved "platform-operations" tenant + PLATFORM_OPERATOR role holding
-- only PLATFORM_TENANT_MANAGE. This tenant does not represent a customer — it
-- exists solely to scope the cross-tenant platform-operator role/users who are
-- allowed to call tenant-service's admin endpoints (list/provision/suspend/
-- activate/close tenants). No ordinary tenant role is granted this permission.
--
-- No user is seeded here (see ES-21_COMPLETION.md for why and for the manual
-- bootstrap steps to create the first platform-operator user).

INSERT INTO "tenants" ("name", "slug", "status", "plan", "contact_email", "created_by")
VALUES ('Platform Operations', 'platform-operations', 'ACTIVE', 'ENTERPRISE', 'platform-ops@internal.erp', 0)
ON CONFLICT ("slug") DO NOTHING;

INSERT INTO "roles" ("tenant_id", "name", "description", "is_system")
SELECT t."id", 'PLATFORM_OPERATOR', 'Cross-tenant platform operator — tenant lifecycle management only', true
FROM "tenants" t
WHERE t."slug" = 'platform-operations'
ON CONFLICT ("tenant_id", "name") DO NOTHING;

INSERT INTO "role_permissions" ("role_id", "permission", "tenant_id")
SELECT r."id", 'PLATFORM_TENANT_MANAGE', r."tenant_id"
FROM "roles" r
JOIN "tenants" t ON t."id" = r."tenant_id"
WHERE t."slug" = 'platform-operations' AND r."name" = 'PLATFORM_OPERATOR'
ON CONFLICT ("role_id", "permission") DO NOTHING;
