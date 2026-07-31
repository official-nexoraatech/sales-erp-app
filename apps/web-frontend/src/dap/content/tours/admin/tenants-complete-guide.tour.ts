import type { TourDefinition } from '../../schema.js';
import { PERMISSIONS } from '../../../../constants/permissions.js';

// Deep-dive companion to `admin-tenants-overview`. Grounded against TenantProvisioner.ts,
// tenant.routes.ts, admin-users.routes.ts, and packages/platform-sdk/src/tenantStatus.ts.
// Covers exactly what provisioning stands up, how suspend is enforced platform-wide (not a
// cosmetic flag), and the one-shot risk in the tenant-ID reveal at creation.
const tour: TourDefinition = {
  id: 'admin-tenants-complete-guide',
  version: 1,
  type: 'complete',
  title: 'Tenants — complete guide',
  description:
    'What provisioning actually builds, how suspension is enforced platform-wide, and the real limits of this admin surface.',
  module: 'admin',
  estimatedMinutes: 6,
  requiredPermissions: [PERMISSIONS.PLATFORM_TENANT_MANAGE],
  steps: [
    {
      id: 'purpose',
      route: 'admin/tenants',
      title: 'Why this page exists',
      body: 'The platform-operator control panel for every customer organization — create, suspend, activate, close, and reset user passwords across tenant boundaries.',
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.PLATFORM_TENANT_MANAGE,
    },
    {
      id: 'provisioning-pipeline',
      route: 'admin/tenants',
      target: '[data-tour-id="admin-tenants-create-button"]',
      title: 'What provisioning actually stands up',
      body: "One real multi-step pipeline: the tenant record, RBAC roles and permissions, a Head Office branch, the owner's account, baseline organization settings, a starter chart of accounts, an S3/MinIO storage prefix, tenant-scoped search indices, default feature-flag rows, and plan entitlements — plus a fire-and-forget welcome email.",
      placement: 'bottom',
      mode: 'informational',
      requiredPermission: PERMISSIONS.PLATFORM_TENANT_MANAGE,
    },
    {
      id: 'partial-failure-behavior',
      route: 'admin/tenants',
      title: 'Not every step is equally critical',
      body: "Storage provisioning failing aborts the whole thing — a tenant can't function without it. Search-index creation and the welcome email are fire-and-forget: if those fail, provisioning still succeeds and the tenant is usable, just with those two things needing manual follow-up.",
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.PLATFORM_TENANT_MANAGE,
    },
    {
      id: 'tenant-id-one-shot',
      route: 'admin/tenants',
      title: 'The Tenant ID is shown exactly once',
      body: "Right after creation, the success screen shows the new numeric Tenant ID — the login screen requires email, password, AND this ID. There's no straightforward way to look it up again from this page afterward. Copy it immediately, or cross-reference the ID column in the list later.",
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.PLATFORM_TENANT_MANAGE,
      calloutTitle: 'Common mistake',
      calloutVariant: 'warning',
    },
    {
      id: 'suspend-is-real',
      route: 'admin/tenants',
      title: 'Suspend blocks access immediately, everywhere',
      body: "Every service's authentication check calls a shared status guard right after verifying the JWT — a suspended tenant's users are rejected on every authenticated route, in every service, propagated cross-process via cache invalidation within the same request. This is not a flag that takes effect eventually; it's enforced at the door.",
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.PLATFORM_TENANT_MANAGE,
      calloutTitle: 'Business impact',
      calloutVariant: 'info',
    },
    {
      id: 'no-plan-change',
      route: 'admin/tenants',
      title: 'Plan is permanent from this UI',
      body: "Starter/Growth/Enterprise is chosen once at creation. There's no upgrade/downgrade button anywhere in the admin tools — if a tenant's plan needs to change, that has to happen through a different process entirely (not covered by this page).",
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.PLATFORM_TENANT_MANAGE,
    },
    {
      id: 'cross-tenant-reset',
      route: 'admin/tenants',
      title: 'Cross-tenant password reset — a genuinely well-built high-impact flow',
      body: 'From Manage Users on any tenant: you must re-enter your own current password before the reset is allowed (a step-up check), the target user is signed out of every session immediately, and the action is written to the Security Audit Log as ADMIN_PASSWORD_RESET.',
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.PLATFORM_TENANT_MANAGE,
    },
    {
      id: 'best-practices',
      route: 'admin/tenants',
      title: 'Best practices',
      body: 'Treat every action here as platform-wide and immediate.',
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.PLATFORM_TENANT_MANAGE,
      calloutTitle: 'Best practices',
      calloutVariant: 'success',
      businessImpact: [
        "Copy the Tenant ID the moment it's shown — don't navigate away first.",
        "After creating a tenant, verify search and welcome-email delivery separately if they matter immediately — provisioning succeeding doesn't guarantee those two side effects landed.",
        'Only suspend when you mean it right now — every user of that tenant loses access the instant you confirm.',
      ],
    },
  ],
};

export default tour;
