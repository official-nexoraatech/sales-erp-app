import type { TourDefinition } from '../../schema.js';
import { PERMISSIONS } from '../../../../constants/permissions.js';

// Grounded against InventoryAnalyticsPage.tsx. Corrected: this page is a table with status
// badges, not charts — despite living alongside Sales/HR Analytics, which are chart-based.
// Its underlying query is one of the newer, verified-correct ones (unlike the legacy Inventory
// category in the generic report viewer, which is entirely broken).
const tour: TourDefinition = {
  id: 'reports-inventory-analytics-overview',
  version: 1,
  type: 'quick',
  title: 'Inventory Analytics — quick overview',
  description: 'Fast/slow/stockout classification by item — a table, not a chart.',
  module: 'reports',
  estimatedMinutes: 1,
  requiredPermissions: [PERMISSIONS.REPORT_VIEW],
  steps: [
    {
      id: 'intro',
      route: 'reports/inventory-analytics',
      title: 'Inventory Analytics',
      body: 'A real, working query — but presented as a table with color-coded FAST/SLOW/STOCKOUT badges, not charts like its Sales/HR siblings.',
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.REPORT_VIEW,
    },
    {
      id: 'threshold-filter',
      route: 'reports/inventory-analytics',
      title: 'The only filter is a movement threshold',
      body: '"Fast mover threshold (units/30d)" is the sole control on this page — no date range, no warehouse or category filter.',
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.REPORT_VIEW,
    },
    {
      id: 'stockout-banner',
      route: 'reports/inventory-analytics',
      title: 'Stockout warning banner',
      body: 'A banner appears automatically whenever any item is classified STOCKOUT — a quick way to spot urgent items without scanning the whole table.',
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.REPORT_VIEW,
    },
  ],
};

export default tour;
