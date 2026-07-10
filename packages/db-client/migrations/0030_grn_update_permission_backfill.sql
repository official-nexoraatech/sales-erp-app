-- Backfill GRN_UPDATE for existing OWNER/ADMIN/SUPER_ADMIN/PURCHASE_MANAGER roles.
--
-- Root cause: purchase-service's attachment.routes.ts gated GRN attachment upload/delete on
-- PO_UPDATE (not a GRN-specific permission), because no GRN_UPDATE permission existed at all
-- until now. role-defaults.ts now grants GRN_UPDATE to PURCHASE_MANAGER (and it's included
-- automatically for OWNER/ADMIN/SUPER_ADMIN via their full-permission spread), but
-- role-defaults.ts is only applied at tenant-provisioning time — this backfills tenants that
-- already exist.
INSERT INTO "role_permissions" ("role_id", "permission", "tenant_id")
SELECT r.id, 'GRN_UPDATE', r.tenant_id
FROM "roles" r
WHERE r.name IN ('OWNER', 'ADMIN', 'SUPER_ADMIN', 'PURCHASE_MANAGER')
ON CONFLICT ("role_id", "permission") DO NOTHING;
