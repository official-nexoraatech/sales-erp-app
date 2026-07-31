import type { TourDefinition } from '../../schema.js';
import { PERMISSIONS } from '../../../../constants/permissions.js';

const tour: TourDefinition = {
  id: 'inventory-transfers-overview',
  version: 1,
  type: 'quick',
  title: 'Stock Transfers — quick overview',
  description: 'Move stock between warehouses or branches (Draft → Submit → Dispatch → Receive).',
  module: 'inventory',
  estimatedMinutes: 1,
  requiredPermissions: [PERMISSIONS.WAREHOUSE_MANAGE, PERMISSIONS.STOCK_TRANSFER],
  steps: [
    {
      id: 'intro',
      route: 'inventory/transfers',
      title: 'Stock Transfers',
      body: 'Move stock between warehouses or branches (Draft → Submit → Dispatch → Receive).',
      placement: 'center',
      mode: 'informational',
    },
    {
      id: 'create',
      route: 'inventory/transfers',
      target: '[data-tour-id="inventory-transfers-create-button"]',
      title: 'Create a transfer',
      body: 'Select source/destination warehouse and items → Submit.',
      placement: 'bottom',
      mode: 'informational',
    },
    {
      id: 'receive',
      route: 'inventory/transfers',
      title: 'Receive a dispatched transfer',
      body: 'The destination warehouse confirms receipt to complete the transfer.',
      placement: 'center',
      mode: 'informational',
    },
  ],
};

export default tour;
