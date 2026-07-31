import type { TourDefinition } from '../../schema.js';
import { PERMISSIONS } from '../../../../constants/permissions.js';

const tour: TourDefinition = {
  id: 'inventory-physical-verifications-overview',
  version: 1,
  type: 'quick',
  title: 'Physical Verification — quick overview',
  description: 'Count physical stock and compare against system records to find variances.',
  module: 'inventory',
  estimatedMinutes: 1,
  requiredPermissions: [PERMISSIONS.WAREHOUSE_MANAGE],
  steps: [
    {
      id: 'intro',
      route: 'inventory/physical-verifications',
      title: 'Physical Verification',
      body: 'Count physical stock and compare against system records to find variances.',
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.WAREHOUSE_MANAGE,
    },
    {
      id: 'start-count',
      route: 'inventory/physical-verifications',
      target: '[data-tour-id="inventory-physical-verifications-create-button"]',
      title: 'Start a verification count',
      body: 'Choose a warehouse and count sheet to begin.',
      placement: 'bottom',
      mode: 'informational',
      requiredPermission: PERMISSIONS.WAREHOUSE_MANAGE,
    },
    {
      id: 'post-variances',
      route: 'inventory/physical-verifications',
      title: 'Review and post variances',
      body: 'Confirmed variances flow into a Stock Adjustment automatically.',
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.WAREHOUSE_MANAGE,
    },
  ],
};

export default tour;
