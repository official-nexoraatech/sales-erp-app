-- ES-35/ES-37 RBAC audit: role-defaults.ts permission corrections never backfilled for
-- existing tenants. ROLE_DEFAULTS is only applied at tenant-provisioning time, so tenants
-- provisioned before these fixes landed still have the old, wrong permission set seeded in
-- role_permissions. Consolidates the four pending backfills flagged in ES-35_COMPLETION.md
-- and ES-37_COMPLETION.md into one migration, per ES-37's own recommendation.

-- SALES_MANAGER: role-defaults.ts grants CUSTOMER_EDIT, but PUT /customers/:id was the only
-- route ever checked — existing tenants seeded before the fix are missing it, so their
-- Sales Managers cannot edit customer records.
INSERT INTO "role_permissions" ("role_id", "permission", "tenant_id")
SELECT r.id, 'CUSTOMER_EDIT', r.tenant_id
FROM "roles" r
WHERE r.name = 'SALES_MANAGER'
ON CONFLICT ("role_id", "permission") DO NOTHING;

-- INVENTORY_MANAGER: ITEM_EDIT (PUT /items/:id's real check) plus the category/brand/unit
-- update+delete permissions role-defaults.ts now grants but existing tenants never received.
INSERT INTO "role_permissions" ("role_id", "permission", "tenant_id")
SELECT r.id, p.permission, r.tenant_id
FROM "roles" r
CROSS JOIN (VALUES ('ITEM_EDIT'), ('CATEGORY_UPDATE'), ('CATEGORY_DELETE'), ('BRAND_UPDATE'), ('UNIT_UPDATE')) AS p(permission)
WHERE r.name = 'INVENTORY_MANAGER'
ON CONFLICT ("role_id", "permission") DO NOTHING;

-- PURCHASE_MANAGER: SUPPLIER_EDIT (PUT /suppliers/:id's real check).
INSERT INTO "role_permissions" ("role_id", "permission", "tenant_id")
SELECT r.id, 'SUPPLIER_EDIT', r.tenant_id
FROM "roles" r
WHERE r.name = 'PURCHASE_MANAGER'
ON CONFLICT ("role_id", "permission") DO NOTHING;
