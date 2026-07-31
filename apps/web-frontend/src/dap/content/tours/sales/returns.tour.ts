import type { TourDefinition } from '../../schema.js';
import { PERMISSIONS } from '../../../../constants/permissions.js';

const tour: TourDefinition = {
  id: 'sales-returns-overview',
  version: 1,
  type: 'quick',
  title: 'Sale Returns — quick overview',
  description:
    'Process customer returns — stock is restored and a credit note is created automatically.',
  module: 'sales',
  estimatedMinutes: 1,
  requiredPermissions: [PERMISSIONS.INVOICE_VIEW],
  steps: [
    {
      id: 'intro',
      route: 'sales/returns',
      title: 'Sale Returns',
      body: 'Process customer returns — stock is restored and a credit note is created automatically.',
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.INVOICE_VIEW,
    },
    {
      id: 'create',
      route: 'sales/returns',
      target: '[data-tour-id="sales-returns-create-button"]',
      title: 'Create a return',
      body: 'Click "New Return" → search the original invoice → select returned items → Confirm.',
      placement: 'bottom',
      mode: 'informational',
      requiredPermission: PERMISSIONS.INVOICE_VIEW,
    },
    {
      id: 'apply-credit-note',
      route: 'sales/returns',
      title: 'Apply credit note',
      body: "The credit note appears on the customer account. Apply it on the customer's next invoice.",
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.INVOICE_VIEW,
    },
  ],
};

export default tour;
