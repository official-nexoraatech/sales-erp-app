import type { TourDefinition } from '../../schema.js';
import { PERMISSIONS } from '../../../../constants/permissions.js';

// Grounded against ApAgingPage.tsx. Same pattern as AR Aging: a real, dedicated page hitting
// its own endpoint — not the generic report-engine "ap-aging" case (which is separately known
// to reference a non-existent grns.paid_amount column). Since this dedicated page is never
// reached via the broken generic path (route ordering always resolves /reports/ap-aging to this
// page), that known issue doesn't affect what you see here. Added: the Supplier filter is a raw
// numeric ID field.
const tour: TourDefinition = {
  id: 'reports-ap-aging-overview',
  version: 1,
  type: 'quick',
  title: 'AP Aging Summary — quick overview',
  description: 'Supplier outstanding payables by overdue period — a real, dedicated report.',
  module: 'reports',
  estimatedMinutes: 1,
  requiredPermissions: [PERMISSIONS.REPORT_VIEW],
  steps: [
    {
      id: 'intro',
      route: 'reports/ap-aging',
      title: 'AP Aging Summary',
      body: 'Supplier outstanding payables by overdue period — genuinely computed from a dedicated backend endpoint.',
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.REPORT_VIEW,
    },
    {
      id: 'buckets',
      route: 'reports/ap-aging',
      title: 'Read the aging buckets',
      body: 'Bills you owe are grouped by 0-30, 31-60, 61-90, and 90+ days overdue, so you can plan supplier payments.',
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.REPORT_VIEW,
    },
    {
      id: 'supplier-filter-is-raw-id',
      route: 'reports/ap-aging',
      title: 'The Supplier filter needs a raw ID, not a name',
      body: "There's no searchable supplier picker here — you'll need to know the supplier's numeric ID. Check the Suppliers page if you're not sure of it.",
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.REPORT_VIEW,
    },
  ],
};

export default tour;
