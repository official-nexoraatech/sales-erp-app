import type { TourDefinition } from '../../schema.js';
import { PERMISSIONS } from '../../../../constants/permissions.js';

const tour: TourDefinition = {
  id: 'inventory-brands-overview',
  version: 1,
  type: 'quick',
  title: 'Brands — quick overview',
  description: 'The brand master used on item records.',
  module: 'inventory',
  estimatedMinutes: 1,
  requiredPermissions: [PERMISSIONS.BRAND_VIEW],
  steps: [
    {
      id: 'intro',
      route: 'inventory/brands',
      title: 'Brands',
      body: 'The brand master used on item records.',
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.BRAND_VIEW,
    },
    {
      id: 'add-brand',
      route: 'inventory/brands',
      target: '[data-tour-id="inventory-brands-create-button"]',
      title: 'Add a brand',
      body: 'New Brand → name it → Save.',
      placement: 'bottom',
      mode: 'informational',
      requiredPermission: PERMISSIONS.BRAND_VIEW,
    },
    {
      id: 'delete',
      route: 'inventory/brands',
      title: 'Deleting a brand',
      body: 'A real, permanent delete, with a confirmation prompt first. Items already assigned to it keep their data but lose the brand link.',
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.BRAND_UPDATE,
    },
  ],
};

export default tour;
