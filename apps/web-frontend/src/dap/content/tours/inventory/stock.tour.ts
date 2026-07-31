import type { TourDefinition } from '../../schema.js';
import { PERMISSIONS } from '../../../../constants/permissions.js';

const tour: TourDefinition = {
  id: 'inventory-stock-overview',
  version: 1,
  type: 'quick',
  title: 'Stock — quick overview',
  description: 'Real-time on-hand quantity per item, per warehouse.',
  module: 'inventory',
  estimatedMinutes: 1,
  requiredPermissions: [PERMISSIONS.ITEM_VIEW],
  steps: [
    {
      id: 'intro',
      route: 'inventory/stock',
      title: 'Stock',
      body: 'Real-time on-hand quantity per item, per warehouse.',
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.ITEM_VIEW,
    },
    {
      id: 'low-stock',
      route: 'inventory/stock',
      title: 'Finding items that need reordering',
      body: 'Tick "Show only low stock items" to see everything at or below its reorder level — this page has no name/SKU search box, so that checkbox plus the warehouse filter are the two ways to narrow the list.',
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.ITEM_VIEW,
    },
    {
      id: 'filter-warehouse',
      route: 'inventory/stock',
      target: '[data-tour-id="inventory-stock-warehouse-filter"]',
      title: 'Filter by warehouse',
      body: 'See stock at one location instead of the tenant-wide total.',
      placement: 'bottom',
      mode: 'informational',
      requiredPermission: PERMISSIONS.ITEM_VIEW,
    },
  ],
};

export default tour;
