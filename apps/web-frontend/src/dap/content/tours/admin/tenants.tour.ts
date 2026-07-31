import type { TourDefinition } from '../../schema.js';
import { PERMISSIONS } from '../../../../constants/permissions.js';

// Grounded against TenantProvisioner.ts / tenant.routes.ts / TenantsPage.tsx /
// AdminTenantUsersPage.tsx. Confirmed provisioning, suspend/activate/close, and cross-tenant
// password reset are all real end-to-end. Added: suspend genuinely blocks API access platform-
// wide, immediately, not just a status flag — and there's no plan-change capability anywhere in
// this UI, plan is set once at creation. Fixed this session: Activate now asks for confirmation
// (previously fired immediately, inconsistent with Suspend/Close).
const tour: TourDefinition = {
  id: 'admin-tenants-overview',
  version: 1,
  type: 'quick',
  title: 'Tenants — quick overview',
  description:
    'Create, suspend, and manage every customer organization — every action here is real and platform-wide.',
  module: 'admin',
  estimatedMinutes: 2,
  requiredPermissions: [PERMISSIONS.PLATFORM_TENANT_MANAGE],
  steps: [
    {
      id: 'intro',
      route: 'admin/tenants',
      title: 'Tenants',
      body: "Platform-operator only — no tenant's own Owner or Admin can reach this page, no matter how senior.",
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.PLATFORM_TENANT_MANAGE,
    },
    {
      id: 'create-tenant',
      route: 'admin/tenants',
      target: '[data-tour-id="admin-tenants-create-button"]',
      title: 'Create a new tenant',
      body: '"+ New Tenant" runs a real multi-step pipeline in one go: org record, RBAC roles, a Head Office branch, the owner account, a starter chart of accounts, storage, search indices, and billing entitlements. The new tenant\'s numeric ID is shown only once, right after creation — copy it immediately, since the login screen needs it and there\'s no easy way to look it up again from this list.',
      placement: 'bottom',
      mode: 'informational',
      requiredPermission: PERMISSIONS.PLATFORM_TENANT_MANAGE,
    },
    {
      id: 'suspend-tenant',
      route: 'admin/tenants',
      title: 'Suspend',
      body: 'Immediately blocks every user of that tenant from every authenticated route, across every service — not just a status label that takes effect later. Requires a typed reason.',
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.PLATFORM_TENANT_MANAGE,
    },
    {
      id: 'activate-tenant',
      route: 'admin/tenants',
      title: 'Activate',
      body: 'Restores full access immediately. Now asks for confirmation before firing, matching Suspend and Close.',
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.PLATFORM_TENANT_MANAGE,
    },
    {
      id: 'no-plan-change',
      route: 'admin/tenants',
      title: 'No plan-change action exists',
      body: "A tenant's plan (Starter/Growth/Enterprise) is set once at creation and can't be changed from this page or any other admin UI today — there's no upgrade/downgrade action.",
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.PLATFORM_TENANT_MANAGE,
    },
    {
      id: 'manage-users',
      route: 'admin/tenants',
      title: 'Manage Users — cross-tenant password reset',
      body: "From a tenant's Manage Users screen, you can reset any of that tenant's users' passwords — but only after re-entering your own password as a step-up check. It signs that user out everywhere and is logged to the Security Audit Log.",
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.PLATFORM_TENANT_MANAGE,
    },
  ],
};

export default tour;
