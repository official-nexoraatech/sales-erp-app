# 08 — Permissions and RBAC

## No change

Zero new permission constant, zero `role-defaults.ts` change, zero change to who can call `POST /admin/tenants` (still gated by the existing `PLATFORM_ADMIN` preHandler array, `PERMISSIONS.PLATFORM_TENANT_MANAGE`, unchanged). `industries`/`business_types` are read-only reference data with no dedicated access-control surface in this phase (no route reads or writes them directly — they're consumed internally by `setTenantBusinessType()` during provisioning, itself gated by the existing tenant-provisioning permission chain, not a new one).
