import type { TourDefinition } from '../../schema.js';
import { PERMISSIONS } from '../../../../constants/permissions.js';

// Grounded against SalesAnalyticsPage.tsx. A real, custom-built chart dashboard (Recharts),
// backed by the same report-engine data as the generic viewer's sales-* cases — but this page's
// underlying queries were checked separately and are column-correct, unlike several of the raw
// Sales report cases in the generic viewer.
const tour: TourDefinition = {
  id: 'reports-sales-analytics-overview',
  version: 1,
  type: 'quick',
  title: 'Sales Analytics — quick overview',
  description: 'Revenue trend, top customers, category and salesperson performance — real charts.',
  module: 'reports',
  estimatedMinutes: 1,
  requiredPermissions: [PERMISSIONS.REPORT_VIEW],
  steps: [
    {
      id: 'intro',
      route: 'reports/sales-analytics',
      title: 'Sales Analytics',
      body: 'Four real panels: a revenue trend line, a top-10-customers bar chart, a category-share pie chart, and a salesperson performance table.',
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.REPORT_VIEW,
    },
    {
      id: 'date-range',
      route: 'reports/sales-analytics',
      title: 'Date range filter',
      body: "Applies across all four panels at once. There's no branch or customer-type filter here — this is a tenant-wide view.",
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.REPORT_VIEW,
    },
    {
      id: 'no-export',
      route: 'reports/sales-analytics',
      title: 'No export from this page',
      body: 'Unlike the generic report viewer, there\'s no CSV/Excel download here — if you need the underlying numbers exported, use the equivalent report from the Reports hub instead (e.g. "Sales by Customer").',
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.REPORT_VIEW,
    },
  ],
};

export default tour;
