import type { TourDefinition } from '../../schema.js';
import { PERMISSIONS } from '../../../../constants/permissions.js';

// Corrected: the real event types logged here are IMPERSONATION_START/END, MFA_ENABLED/DISABLED,
// SESSION_TERMINATED, ADMIN_PASSWORD_RESET, and SUSPICIOUS_LOGIN — confirmed by grepping every
// write to the security_audit_log table. "Role/permission changes" is not one of the logged
// event types (that lands in the regular Audit Logs page instead, if anywhere) — removed that
// claim.
const tour: TourDefinition = {
  id: 'admin-security-audit-log-overview',
  version: 1,
  type: 'quick',
  title: 'Security Audit Log — quick overview',
  description:
    'Account and session security events — a separate table from the business-data Audit Logs.',
  module: 'admin',
  estimatedMinutes: 2,
  requiredPermissions: [PERMISSIONS.VIEW_AUDIT_LOG],
  steps: [
    {
      id: 'intro',
      route: 'admin/security-audit-log',
      title: 'Security Audit Log',
      body: 'A specific, real set of events: platform-operator impersonation start/end, MFA enabled/disabled, forced session termination, admin-initiated password resets, and suspicious-login flags.',
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.VIEW_AUDIT_LOG,
    },
    {
      id: 'not-a-role-change-log',
      route: 'admin/security-audit-log',
      title: 'Not where role/permission changes show up',
      body: "Don't look here for who changed a role's permissions — that isn't one of the event types this page tracks. It's specifically account and session security, not authorization configuration.",
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.VIEW_AUDIT_LOG,
    },
    {
      id: 'admin-password-reset',
      route: 'admin/security-audit-log',
      title: 'Cross-tenant password resets are logged here',
      body: "When a platform operator resets a user's password in any tenant, it's recorded here as ADMIN_PASSWORD_RESET — a genuine accountability trail for a high-impact platform action.",
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.VIEW_AUDIT_LOG,
    },
  ],
};

export default tour;
