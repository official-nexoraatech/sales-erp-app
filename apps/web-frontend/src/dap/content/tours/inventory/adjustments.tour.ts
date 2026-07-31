import type { TourDefinition } from '../../schema.js';
import { PERMISSIONS } from '../../../../constants/permissions.js';

const tour: TourDefinition = {
  id: 'inventory-adjustments-overview',
  version: 1,
  type: 'quick',
  title: 'Stock Adjustments — quick overview',
  description:
    'Correct stock discrepancies found during physical counts (Draft → Submit → Approve).',
  module: 'inventory',
  estimatedMinutes: 1,
  // Matches this route's real PermissionRoute in App.tsx exactly (ANY-match array).
  requiredPermissions: [PERMISSIONS.WAREHOUSE_MANAGE, PERMISSIONS.STOCK_ADJUST],
  steps: [
    {
      id: 'intro',
      route: 'inventory/adjustments',
      title: 'Stock Adjustments',
      body: 'Correct stock discrepancies found during physical counts (Draft → Submit → Approve).',
      placement: 'center',
      mode: 'informational',
    },
    {
      id: 'create',
      route: 'inventory/adjustments',
      target: '[data-tour-id="inventory-adjustments-create-button"]',
      title: 'Create an adjustment',
      body: 'Select the item and warehouse, then enter the corrected quantity.',
      placement: 'bottom',
      mode: 'informational',
    },
    {
      id: 'submit',
      route: 'inventory/adjustments',
      title: 'Submit for approval',
      body: 'An approver must confirm before stock actually changes.',
      placement: 'center',
      mode: 'informational',
    },
  ],
};

export default tour;
