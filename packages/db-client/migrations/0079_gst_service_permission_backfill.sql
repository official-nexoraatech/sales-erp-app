-- Backfill for existing tenants: role-defaults.ts-omission RBAC gaps found in a
-- route-by-route tenant-isolation audit of gst-service (same bug class as migrations
-- 0075/0076/0078 — a route checks a permission constant that role-defaults.ts never
-- granted to a role that should logically have it).
--
-- 1. ACCOUNTANT held EINVOICE_GENERATE but not EINVOICE_CANCEL (einvoice.routes.ts checks
--    them as two separate constants), and held GST_FILE/GSTR1_FILE/GSTR3B_FILE but not
--    GSTR2A_RECONCILE or GST_COMPUTE — GstConfigPage's "Compute" button 403'd, and the
--    whole GSTR-2A reconciliation page (route itself gated on GSTR2A_RECONCILE) was
--    unreachable, despite this role owning the rest of monthly GST compliance.
INSERT INTO "role_permissions" ("role_id", "permission", "tenant_id")
SELECT r.id, p.permission, r.tenant_id
FROM "roles" r
CROSS JOIN (VALUES ('EINVOICE_CANCEL'), ('GSTR2A_RECONCILE'), ('GST_COMPUTE')) AS p(permission)
WHERE r.name = 'ACCOUNTANT'
ON CONFLICT ("role_id", "permission") DO NOTHING;

-- 2. ACCOUNTANT_SUPERVISOR held none of e-Invoice/e-Way Bill/GSTR-2A/GST-compute at all,
--    despite the junior ACCOUNTANT role holding EINVOICE_GENERATE/EWAY_BILL_GENERATE and
--    (after fix 1 above) the full GST set.
INSERT INTO "role_permissions" ("role_id", "permission", "tenant_id")
SELECT r.id, p.permission, r.tenant_id
FROM "roles" r
CROSS JOIN (
  VALUES ('EINVOICE_GENERATE'), ('EINVOICE_CANCEL'), ('EWAY_BILL_GENERATE'),
         ('GSTR2A_RECONCILE'), ('GST_COMPUTE')
) AS p(permission)
WHERE r.name = 'ACCOUNTANT_SUPERVISOR'
ON CONFLICT ("role_id", "permission") DO NOTHING;
