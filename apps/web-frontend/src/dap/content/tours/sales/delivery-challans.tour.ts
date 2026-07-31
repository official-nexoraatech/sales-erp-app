import type { TourDefinition } from '../../schema.js';
import { PERMISSIONS } from '../../../../constants/permissions.js';

const tour: TourDefinition = {
  id: 'sales-delivery-challans-overview',
  version: 1,
  type: 'quick',
  title: 'Delivery Challans — quick overview',
  description:
    'A delivery document for goods sent without an immediate sale (e.g. on approval, job work).',
  module: 'sales',
  estimatedMinutes: 1,
  requiredPermissions: [PERMISSIONS.INVOICE_VIEW],
  steps: [
    {
      id: 'intro',
      route: 'sales/delivery-challans',
      title: 'Delivery Challans',
      body: 'A delivery document for goods sent without an immediate sale (e.g. on approval, job work).',
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.INVOICE_VIEW,
    },
    {
      id: 'create',
      route: 'sales/delivery-challans',
      target: '[data-tour-id="sales-delivery-challans-create-button"]',
      title: 'Create a delivery challan',
      body: 'Select customer and items being delivered → Confirm.',
      placement: 'bottom',
      mode: 'informational',
      requiredPermission: PERMISSIONS.INVOICE_VIEW,
    },
    {
      id: 'convert',
      route: 'sales/delivery-challans',
      title: 'Convert to an invoice later',
      body: 'If the goods are eventually sold, convert the challan directly.',
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.INVOICE_VIEW,
    },
  ],
};

export default tour;
