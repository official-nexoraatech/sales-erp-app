import type { TourDefinition } from '../../schema.js';
import { PERMISSIONS } from '../../../../constants/permissions.js';

const tour: TourDefinition = {
  id: 'sales-invoices-overview',
  version: 1,
  type: 'quick',
  title: 'Invoices — quick overview',
  description: 'Create and manage customer invoices with automatic GST calculation.',
  module: 'sales',
  estimatedMinutes: 2,
  requiredPermissions: [PERMISSIONS.INVOICE_VIEW],
  steps: [
    {
      id: 'intro',
      route: 'sales/invoices',
      title: 'Invoices',
      body: 'Create and manage customer invoices with automatic GST calculation.',
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.INVOICE_VIEW,
    },
    {
      id: 'create',
      route: 'sales/invoices',
      target: '[data-tour-id="sales-invoices-create-button"]',
      title: 'Create a new invoice',
      body: 'Click "New Invoice" → select customer → add items → Confirm.',
      placement: 'bottom',
      mode: 'informational',
      requiredPermission: PERMISSIONS.INVOICE_VIEW,
    },
    {
      id: 'record-payment',
      route: 'sales/invoices',
      title: 'Record payment for an invoice',
      body: 'Open the invoice → click "Record Payment" → enter amount and mode.',
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.INVOICE_VIEW,
    },
    {
      id: 'cancel',
      route: 'sales/invoices',
      title: 'Cancel an invoice',
      body: 'Open invoice → Actions → Cancel. Only DRAFT invoices can be deleted; CONFIRMED invoices require a Sale Return.',
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.INVOICE_VIEW,
    },
  ],
};

export default tour;
