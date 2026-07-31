import type { TourDefinition } from '../../schema.js';
import { PERMISSIONS } from '../../../../constants/permissions.js';

const tour: TourDefinition = {
  id: 'sales-quotations-overview',
  version: 1,
  type: 'quick',
  title: 'Quotations — quick overview',
  description: 'A non-binding price quote for a customer, convertible to an invoice once accepted.',
  module: 'sales',
  estimatedMinutes: 1,
  requiredPermissions: [PERMISSIONS.INVOICE_VIEW],
  steps: [
    {
      id: 'intro',
      route: 'sales/quotations',
      title: 'Quotations',
      body: 'A non-binding price quote for a customer, convertible to an invoice once accepted.',
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.INVOICE_VIEW,
    },
    {
      id: 'create',
      route: 'sales/quotations',
      target: '[data-tour-id="sales-quotations-create-button"]',
      title: 'Create a quotation',
      body: 'New Quotation → select customer → add items → Save.',
      placement: 'bottom',
      mode: 'informational',
      requiredPermission: PERMISSIONS.INVOICE_VIEW,
    },
    {
      id: 'convert',
      route: 'sales/quotations',
      title: 'Convert to an invoice',
      body: 'Once the customer accepts, convert it directly — no re-entry needed.',
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.INVOICE_VIEW,
    },
  ],
};

export default tour;
