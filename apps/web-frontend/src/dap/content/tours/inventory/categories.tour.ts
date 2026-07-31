import type { TourDefinition } from '../../schema.js';
import { PERMISSIONS } from '../../../../constants/permissions.js';

const tour: TourDefinition = {
  id: 'inventory-categories-overview',
  version: 1,
  type: 'quick',
  title: 'Categories — quick overview',
  description:
    'Group items for reporting and catalog organization (e.g. Sarees, Shirting, Suiting).',
  module: 'inventory',
  estimatedMinutes: 1,
  requiredPermissions: [PERMISSIONS.CATEGORY_VIEW],
  steps: [
    {
      id: 'intro',
      route: 'inventory/categories',
      title: 'Categories',
      body: 'Group items for reporting and catalog organization (e.g. Sarees, Shirting, Suiting).',
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.CATEGORY_VIEW,
    },
    {
      id: 'add-category',
      route: 'inventory/categories',
      target: '[data-tour-id="inventory-categories-create-button"]',
      title: 'Add a category',
      body: 'New Category → name it → Save.',
      placement: 'bottom',
      mode: 'informational',
      requiredPermission: PERMISSIONS.CATEGORY_VIEW,
    },
    {
      id: 'delete',
      route: 'inventory/categories',
      title: 'Deleting a category',
      body: 'Unlike Items\' "Delete" (which only discontinues), this is a real, permanent delete — it asks for confirmation first. Items already assigned to it keep their data but lose the category link.',
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.CATEGORY_DELETE,
    },
  ],
};

export default tour;
