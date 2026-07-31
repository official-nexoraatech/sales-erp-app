import type { TourDefinition } from '../../schema.js';
import { PERMISSIONS } from '../../../../constants/permissions.js';

const tour: TourDefinition = {
  id: 'inventory-valuation-overview',
  version: 1,
  type: 'quick',
  title: 'Stock Valuation — quick overview',
  description: 'The total value of on-hand stock, using weighted-average cost.',
  module: 'inventory',
  estimatedMinutes: 1,
  requiredPermissions: [PERMISSIONS.REPORT_VIEW],
  steps: [
    {
      id: 'intro',
      route: 'inventory/valuation',
      title: 'Stock Valuation',
      body: 'The total value of on-hand stock, using weighted-average cost.',
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.REPORT_VIEW,
    },
    {
      id: 'by-warehouse',
      route: 'inventory/valuation',
      target: '[data-tour-id="inventory-valuation-warehouse-filter"]',
      title: 'Check valuation by warehouse',
      body: 'See how much stock value sits at each location.',
      placement: 'bottom',
      mode: 'informational',
      requiredPermission: PERMISSIONS.REPORT_VIEW,
    },
    {
      id: 'estimated-badge',
      route: 'inventory/valuation',
      title: 'The "Estimated" badge',
      body: "A row marked Estimated means this warehouse doesn't have its own tracked cost yet — you're seeing the tenant-wide average cost applied proportionally, not a true warehouse-specific figure.",
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.REPORT_VIEW,
    },
  ],
};

export default tour;
