import type { TourDefinition } from '../../schema.js';
import { PERMISSIONS } from '../../../../constants/permissions.js';

// Grounded against ArAgingPage.tsx. This is a real, custom-built, dedicated page (not part of
// the generic report viewer, and not affected by the broken-columns finding on the module
// overview) — it hits its own endpoint and genuinely works. Added: the Branch filter is a raw
// numeric ID field, not a searchable name picker.
const tour: TourDefinition = {
  id: 'reports-ar-aging-overview',
  version: 1,
  type: 'quick',
  title: 'AR Aging Summary — quick overview',
  description: 'Customer outstanding invoices by overdue period — a real, dedicated report.',
  module: 'reports',
  estimatedMinutes: 1,
  requiredPermissions: [PERMISSIONS.REPORT_VIEW],
  steps: [
    {
      id: 'intro',
      route: 'reports/ar-aging',
      title: 'AR Aging Summary',
      body: 'Customer outstanding invoices by overdue period — a genuine, dedicated report, not one of the generic report-engine cases with known column issues.',
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.REPORT_VIEW,
    },
    {
      id: 'buckets',
      route: 'reports/ar-aging',
      title: 'Read the aging buckets',
      body: 'Invoices are grouped by how overdue they are (0-30, 31-60, 61-90, 90+ days) so you can prioritize collection.',
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.REPORT_VIEW,
    },
    {
      id: 'branch-filter-is-raw-id',
      route: 'reports/ar-aging',
      title: 'The Branch filter needs a raw ID, not a name',
      body: "There's no searchable branch picker here — you'll need to know the branch's numeric ID. Check the Branches page under Settings if you're not sure of it.",
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.REPORT_VIEW,
    },
  ],
};

export default tour;
