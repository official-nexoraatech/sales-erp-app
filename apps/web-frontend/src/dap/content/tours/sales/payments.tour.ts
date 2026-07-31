import type { TourDefinition } from '../../schema.js';
import { PERMISSIONS } from '../../../../constants/permissions.js';

const tour: TourDefinition = {
  id: 'sales-payments-overview',
  version: 1,
  type: 'quick',
  title: 'Customer Payments — quick overview',
  description: 'Record payments received from customers against their invoices.',
  module: 'sales',
  estimatedMinutes: 1,
  // Matches this route's real PermissionRoute in App.tsx exactly (ANY-match array).
  requiredPermissions: [PERMISSIONS.PAYMENT_VIEW, PERMISSIONS.PAYMENT_IN_VIEW],
  steps: [
    {
      id: 'intro',
      route: 'sales/payments',
      title: 'Customer Payments',
      body: 'Record payments received from customers against their invoices.',
      placement: 'center',
      mode: 'informational',
    },
    {
      id: 'record',
      route: 'sales/payments',
      target: '[data-tour-id="sales-payments-create-button"]',
      title: 'Record a payment',
      body: 'Select the customer and invoice(s), enter amount and mode.',
      placement: 'bottom',
      mode: 'informational',
    },
    {
      id: 'allocate',
      route: 'sales/payments',
      title: 'Allocate across multiple invoices',
      body: 'One payment can be split across several outstanding invoices.',
      placement: 'center',
      mode: 'informational',
    },
  ],
};

export default tour;
