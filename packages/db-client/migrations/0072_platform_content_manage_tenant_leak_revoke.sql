-- Cross-tenant authorization gap found in live QA 2026-07-17: role-defaults.ts's
-- TENANT_SCOPED_PERMISSIONS wildcard only excluded PLATFORM_TENANT_MANAGE, not
-- PLATFORM_CONTENT_MANAGE (added by 0065_faq_items.sql) — so every tenant provisioned since
-- then had its OWNER/SUPER_ADMIN role seeded with PLATFORM_CONTENT_MANAGE, letting any
-- tenant admin edit the public marketing site's global FAQ content (faq_items has no
-- tenant_id at all). PLATFORM_CONTENT_MANAGE is meant to be exactly as restricted as
-- PLATFORM_TENANT_MANAGE: platform-operator only (see 0020_es21_platform_operator.sql,
-- 0065_faq_items.sql). Revoke it from every role outside the reserved platform-operations
-- tenant. role-defaults.ts is fixed alongside this migration so no newly-provisioned tenant
-- gets it again.
DELETE FROM "role_permissions" rp
USING "roles" r
LEFT JOIN "tenants" t ON t."id" = r."tenant_id"
WHERE rp."role_id" = r."id"
  AND rp."permission" = 'PLATFORM_CONTENT_MANAGE'
  AND (t."slug" IS DISTINCT FROM 'platform-operations' OR r."name" <> 'PLATFORM_OPERATOR');
