import type { TourDefinition } from '../../schema.js';
import { PERMISSIONS } from '../../../../constants/permissions.js';

// Grounded against auth-service/src/routes/{users,user-roles}.ts / UsersPage.tsx /
// UserFormPage.tsx. Corrected: "email and role → they receive an invite" was fictional — no
// invite email is ever sent; the admin sets the new user's password directly. Fixed this
// session: editing a user's role/branch previously looked like it worked (visible, editable
// fields, a success toast) but silently discarded the change — now both actually save via the
// real (previously unwired) role-assignment and branch-assignment endpoints.
const tour: TourDefinition = {
  id: 'users-overview',
  version: 1,
  type: 'quick',
  title: 'Users — quick overview',
  description:
    'Your team members — create accounts directly, with real branch-scoped access control.',
  module: 'users',
  estimatedMinutes: 2,
  requiredPermissions: [PERMISSIONS.USER_VIEW],
  steps: [
    {
      id: 'intro',
      route: 'users',
      title: 'Users',
      body: 'Real, tenant-scoped accounts with genuine role-based permissions — no search or pagination on this list yet, it loads every user in the tenant at once.',
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.USER_VIEW,
    },
    {
      id: 'create-user',
      route: 'users',
      target: '[data-tour-id="users-create-button"]',
      title: 'Create a user — no invite email is sent',
      body: "You set the new user's password directly on this form and share it with them yourself. There's no invite-email flow — they can change their own password afterward via Forgot Password.",
      placement: 'bottom',
      mode: 'informational',
      requiredPermission: PERMISSIONS.USER_CREATE,
    },
    {
      id: 'role-and-branch',
      route: 'users',
      title: 'Role and branch are both real, enforced restrictions',
      body: "A role grants real permissions, checked server-side on every request. Assigning a branch genuinely restricts what data that user can see and act on — but only once you assign at least one. Leaving branch blank means the user sees every branch's data, not none.",
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.USER_VIEW,
      calloutTitle: 'Common mistake',
      calloutVariant: 'warning',
    },
    {
      id: 'deactivate',
      route: 'users',
      title: "Deactivate doesn't log them out instantly",
      body: "A deactivated user's current session keeps working for a short while (until their access token naturally expires, usually under 15 minutes) — they're not kicked out mid-session. Their next login or token refresh is blocked.",
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.USER_DELETE,
    },
  ],
};

export default tour;
