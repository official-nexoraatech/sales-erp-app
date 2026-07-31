import type { TourDefinition } from '../../schema.js';
import { PERMISSIONS } from '../../../../constants/permissions.js';

const tour: TourDefinition = {
  id: 'inventory-fabric-rolls-overview',
  version: 1,
  type: 'quick',
  title: 'Fabric Rolls — quick overview',
  description:
    'Roll-level tracking for fabric stock — receive a roll, then cut it into sold lengths.',
  module: 'inventory',
  estimatedMinutes: 1,
  requiredPermissions: [PERMISSIONS.ITEM_VIEW],
  steps: [
    {
      id: 'intro',
      route: 'inventory/fabric-rolls',
      title: 'Fabric Rolls',
      body: 'Roll-level tracking for fabric stock — receive a roll, then cut it into sold lengths.',
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.ITEM_VIEW,
    },
    {
      id: 'receive',
      route: 'inventory/fabric-rolls',
      target: '[data-tour-id="inventory-fabric-rolls-create-button"]',
      title: 'Receive a fabric roll',
      body: 'Record the roll number and total length received.',
      placement: 'bottom',
      mode: 'informational',
      requiredPermission: PERMISSIONS.ITEM_VIEW,
    },
    {
      id: 'cut',
      route: 'inventory/fabric-rolls',
      title: 'Cut a roll for a sale',
      body: 'Deducts the cut length from the roll’s remaining balance.',
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.ITEM_VIEW,
    },
  ],
};

export default tour;
