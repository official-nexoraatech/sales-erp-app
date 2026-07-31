import type { TourDefinition } from '../../schema.js';
import { PERMISSIONS } from '../../../../constants/permissions.js';

// Grounded against warehouse.routes.ts / WarehousesPage.tsx / WarehouseFormPage.tsx. Same
// pattern as Branches: no Active/Inactive toggle exists in the UI, only a soft-delete. Fixed
// this session: Delete is now hidden for the default-warehouse row (backend always rejects it),
// and the confirm dialog now warns that a warehouse with any stock movement history can't be
// deleted at all.
const tour: TourDefinition = {
  id: 'settings-warehouses-overview',
  version: 1,
  type: 'quick',
  title: 'Warehouses — quick overview',
  description:
    'Physical stock locations — immediately usable for stock, transfers, and POS once created.',
  module: 'settings',
  estimatedMinutes: 2,
  requiredPermissions: [PERMISSIONS.WAREHOUSE_VIEW],
  steps: [
    {
      id: 'intro',
      route: 'settings/warehouses',
      title: 'Warehouses',
      body: 'A new warehouse works immediately — stock transfers, adjustments, physical verification, and POS can all target it right away, no separate activation step.',
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.WAREHOUSE_VIEW,
    },
    {
      id: 'add-warehouse',
      route: 'settings/warehouses',
      target: '[data-tour-id="settings-warehouses-create-button"]',
      title: 'Add a warehouse',
      body: 'Name, code, and the Branch it belongs to — every warehouse is scoped to exactly one branch.',
      placement: 'bottom',
      mode: 'informational',
      requiredPermission: PERMISSIONS.WAREHOUSE_MANAGE,
    },
    {
      id: 'default-and-delete',
      route: 'settings/warehouses',
      title: 'Default warehouse, and what blocks deletion',
      body: 'Marking one Default automatically un-marks the previous default for that branch. Delete is a hard block if the warehouse has ever had stock movement (the record needs to stay for audit purposes) — the Default warehouse can never be deleted at all, so Delete no longer appears on that row.',
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.WAREHOUSE_MANAGE,
    },
    {
      id: 'no-deactivate',
      route: 'settings/warehouses',
      title: 'No "deactivate" — and it wouldn\'t fully stop stock movement anyway',
      body: "There's no Active/Inactive toggle in this UI. Even the underlying isActive flag, where it exists, is only checked by the POS warehouse picker — stock transfers and adjustments don't check it at all. Deleting is the only real way to retire a warehouse, and it's blocked once there's stock history.",
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.WAREHOUSE_VIEW,
    },
  ],
};

export default tour;
