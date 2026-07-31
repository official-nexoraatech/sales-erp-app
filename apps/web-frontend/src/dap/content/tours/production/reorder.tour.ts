import type { TourDefinition } from '../../schema.js';
import { PERMISSIONS } from '../../../../constants/permissions.js';

// Grounded against ReorderService.ts / ReorderReportPage.tsx. Confirms a previously-fixed bug is
// still fixed (real branch derivation, no more hardcoded branchId 1) and documents two fixes
// made this session: Create POs now requires picking a specific warehouse instead of silently
// guessing one, and now tells you by name which selected items were skipped for having no known
// supplier, instead of silently dropping them.
const tour: TourDefinition = {
  id: 'production-reorder-overview',
  version: 1,
  type: 'quick',
  title: 'Reorder Report — quick overview',
  description: 'Items at or below their reorder level, with one-click PO creation.',
  module: 'production',
  estimatedMinutes: 2,
  requiredPermissions: [PERMISSIONS.REORDER_VIEW],
  steps: [
    {
      id: 'intro',
      route: 'production/reorder',
      title: 'Reorder Report',
      body: 'Real, live data: every item here has its actual current stock at or below its configured reorder level — not a stale snapshot.',
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.REORDER_VIEW,
    },
    {
      id: 'review-suggestions',
      route: 'production/reorder',
      title: 'The order quantity is a fixed setting, not a calculated shortfall',
      body: 'Each item orders its pre-configured Reorder Quantity — not "enough to top back up to the reorder level." Adjust an item\'s Reorder Quantity in its own item record if the suggested amount looks wrong.',
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.REORDER_VIEW,
    },
    {
      id: 'pick-a-warehouse',
      route: 'production/reorder',
      title: 'Pick a specific warehouse before creating POs',
      body: '"All Warehouses" is fine for browsing, but Create POs now requires you to select one specific warehouse first — this avoids silently booking stock into the wrong location.',
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.REORDER_VIEW,
    },
    {
      id: 'create-pos',
      route: 'production/reorder',
      target: '[data-tour-id="production-reorder-create-pos-button"]',
      title: 'Create POs from the report',
      body: "Creates real, GST-calculated Draft Purchase Orders, grouped by supplier. Items with no purchase history have no known supplier and can't be auto-ordered — you'll now see exactly which ones were skipped, by name.",
      placement: 'bottom',
      mode: 'informational',
      requiredPermission: PERMISSIONS.REORDER_CREATE_PO,
    },
  ],
};

export default tour;
