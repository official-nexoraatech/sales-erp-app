import type { TourDefinition } from '../../schema.js';
import { PERMISSIONS } from '../../../../constants/permissions.js';

// Grounded against HRAnalyticsPage.tsx. Real chart dashboard, backed by verified-correct
// queries (unlike several of the legacy HR report cases in the generic viewer, like
// payroll-report and employee-master-report, which are broken).
const tour: TourDefinition = {
  id: 'reports-hr-analytics-overview',
  version: 1,
  type: 'quick',
  title: 'HR Analytics — quick overview',
  description: 'Headcount, salary cost trend, hiring activity, and diversity — real charts.',
  module: 'reports',
  estimatedMinutes: 1,
  requiredPermissions: [PERMISSIONS.REPORT_VIEW],
  steps: [
    {
      id: 'intro',
      route: 'reports/hr-analytics',
      title: 'HR Analytics',
      body: 'Four real panels: department headcount, gender diversity, salary cost trend, and new hires vs. exits — all genuinely computed, verified-correct queries.',
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.REPORT_VIEW,
    },
    {
      id: 'date-range',
      route: 'reports/hr-analytics',
      title: 'Date range applies selectively',
      body: 'The salary-cost and hires/exits panels respect the date range filter; headcount and gender diversity are always current-snapshot, with no date param.',
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.REPORT_VIEW,
    },
    {
      id: 'no-export',
      route: 'reports/hr-analytics',
      title: 'No export from this page',
      body: 'Same as Sales Analytics — no CSV/Excel download here. Use the equivalent report from the Reports hub if you need the raw numbers.',
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.REPORT_VIEW,
    },
  ],
};

export default tour;
