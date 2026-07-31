import type { TourDefinition } from '../../schema.js';
import { PERMISSIONS } from '../../../../constants/permissions.js';

// Grounded against ReportsPage.tsx / ReportViewerPage.tsx / ReportEngine.ts / ReportRegistry.ts.
// The single most important correction in this tour: a comprehensive, column-by-column audit of
// every report definition found that 43 of 77 report cases (56%) reference database columns
// that don't exist and will error at runtime. This is not evenly spread — Inventory (13/13),
// Purchase (9/12), Sales (9/19), several Financial ledger reports, and 4/6 HR reports are hit
// hardest; GST (6/6) and the newer Analytics dashboards (6/6) are fully correct. Fixed this
// session: the hub now only lists reports you actually hold permission for (previously showed
// all 77 regardless, leading to a 403 only after clicking Run); "Export to PDF" removed from
// this tour since no PDF export exists on the generic report viewer.
const tour: TourDefinition = {
  id: 'reports-overview',
  version: 1,
  type: 'quick',
  title: 'Reports — quick overview',
  description:
    'Browse and run reports — a real, working system, but with a significant number of currently-broken reports.',
  module: 'reports',
  estimatedMinutes: 3,
  requiredPermissions: [PERMISSIONS.REPORT_VIEW],
  steps: [
    {
      id: 'intro',
      route: 'reports',
      title: 'Reports',
      body: "Browse 77 reports across 7 categories, searchable and filterable. You'll now only see reports you actually have permission to run — no more finding out you're blocked only after filling in parameters.",
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.REPORT_VIEW,
    },
    {
      id: 'many-reports-are-broken',
      route: 'reports',
      title: 'A significant number of these reports will error when run',
      body: "This is important: roughly half of the reports listed here reference database columns that don't currently exist, and will fail with an error instead of showing data. This is most common in Inventory and Purchase reports, and several older Financial ledger reports (Day Book, Account Ledger, Bank Book, Journal Report). If a report errors, that's a real data/configuration issue worth reporting — not something you did wrong.",
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.REPORT_VIEW,
      calloutTitle: 'Common mistake',
      calloutVariant: 'warning',
    },
    {
      id: 'reliable-categories',
      route: 'reports',
      title: 'GST and the Analytics dashboards are fully reliable',
      body: 'Every GST report, and the newer chart-based Sales/Inventory/HR Analytics dashboards, are verified correct against the real database. Trust these first if you need a number today.',
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.REPORT_VIEW,
    },
    {
      id: 'run',
      route: 'reports',
      title: 'Run a report',
      body: 'Pick one, set the date/branch/etc. parameters, and Run Report. Some reports run instantly; others queue in the background and show a "generating your data" message — both are real, just different response times depending on how much data the report scans.',
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.REPORT_VIEW,
    },
    {
      id: 'export',
      route: 'reports',
      title: 'Export results',
      body: 'CSV and Excel export are both real, working file downloads from the results screen. There is no PDF export on this generic report viewer today.',
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.REPORT_VIEW,
    },
  ],
};

export default tour;
