import type { TourDefinition } from '../../schema.js';
import { PERMISSIONS } from '../../../../constants/permissions.js';

const tour: TourDefinition = {
  id: 'inventory-units-overview',
  version: 1,
  type: 'quick',
  title: 'Units — quick overview',
  description: 'Units of measure (meters, pieces, kg) used on items and transactions.',
  module: 'inventory',
  estimatedMinutes: 1,
  requiredPermissions: [PERMISSIONS.UNIT_VIEW],
  steps: [
    {
      id: 'intro',
      route: 'inventory/units',
      title: 'Units',
      body: 'Units of measure (meters, pieces, kg) used on items and transactions.',
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.UNIT_VIEW,
    },
    {
      id: 'add-unit',
      route: 'inventory/units',
      target: '[data-tour-id="inventory-units-create-button"]',
      title: 'Add a unit',
      body: 'New Unit → name and abbreviation → Save.',
      placement: 'bottom',
      mode: 'informational',
      requiredPermission: PERMISSIONS.UNIT_VIEW,
    },
    {
      id: 'no-delete',
      route: 'inventory/units',
      title: 'Units can be edited but not deleted',
      body: "Unlike Categories and Brands, there's no delete action for units at all — once created, a unit is permanent. Double-check the name and abbreviation before saving.",
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.UNIT_VIEW,
    },
  ],
};

export default tour;
