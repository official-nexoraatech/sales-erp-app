import type { TourDefinition } from '../../schema.js';
import { PERMISSIONS } from '../../../../constants/permissions.js';

const tour: TourDefinition = {
  id: 'inventory-items-overview',
  version: 1,
  type: 'quick',
  title: 'Items — quick overview',
  description: 'Your product catalog — SKU, barcode, HSN code, and prices.',
  module: 'inventory',
  estimatedMinutes: 1,
  requiredPermissions: [PERMISSIONS.ITEM_VIEW],
  steps: [
    {
      id: 'intro',
      route: 'inventory/items',
      title: 'Items',
      body: 'Your product catalog — SKU, barcode, HSN code, and prices.',
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.ITEM_VIEW,
    },
    {
      id: 'add-item',
      route: 'inventory/items',
      target: '[data-tour-id="inventory-items-create-button"]',
      title: 'Add a new item',
      body: 'New Item → SKU, name, HSN code, sale price → Save.',
      placement: 'bottom',
      mode: 'informational',
      requiredPermission: PERMISSIONS.ITEM_VIEW,
    },
    {
      id: 'discontinue',
      route: 'inventory/items',
      title: 'Discontinuing an item',
      body: 'The "Delete" row action doesn\'t remove the item — it marks it DISCONTINUED so it stops showing up for new sales/purchases while keeping its history intact on past records.',
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.ITEM_VIEW,
    },
  ],
};

export default tour;
