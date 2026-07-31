import type { TourDefinition } from '../../schema.js';
import { PERMISSIONS } from '../../../../constants/permissions.js';

// Grounded against audit-log.routes.ts / AuditLogPage.tsx. Added: the entity-type filter is a
// hardcoded 4-value list (invoice/sales_return/customer/item) even though the audit_log table
// records changes across far more entity types — there's no way to filter to those from this
// page. Also clarifies the real difference from Security Audit Log, a separate table entirely.
const tour: TourDefinition = {
  id: 'admin-audit-logs-overview',
  version: 1,
  type: 'quick',
  title: 'Audit Logs — quick overview',
  description: 'A real, live record of who changed business data, when, with before/after values.',
  module: 'admin',
  estimatedMinutes: 2,
  requiredPermissions: [PERMISSIONS.VIEW_AUDIT_LOG, PERMISSIONS.AUDIT_LOG_VIEW],
  steps: [
    {
      id: 'intro',
      route: 'admin/audit-logs',
      title: 'Audit Logs',
      body: 'Business-data changes — who edited what field on which invoice, customer, item, or sale return, and what it was before and after.',
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.VIEW_AUDIT_LOG,
    },
    {
      id: 'filter',
      route: 'admin/audit-logs',
      title: 'Entity-type filter is limited',
      body: "The dropdown only offers Invoice, Sale Return, Customer, and Item — even though far more record types are actually logged. If you need something else, you'll have to scan the unfiltered list.",
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.VIEW_AUDIT_LOG,
    },
    {
      id: 'history',
      route: 'admin/audit-logs',
      title: 'Expand a row for the full diff',
      body: 'Click a row to see the before/after JSON for exactly what changed, plus the actor and their IP address.',
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.VIEW_AUDIT_LOG,
    },
    {
      id: 'not-security-log',
      route: 'admin/audit-logs',
      title: 'Not the same as Security Audit Log',
      body: 'This is business-data history. For login/session/MFA/impersonation events, use Security Audit Log instead — it reads from a completely separate table, not a filtered view of this one.',
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.VIEW_AUDIT_LOG,
    },
  ],
};

export default tour;
