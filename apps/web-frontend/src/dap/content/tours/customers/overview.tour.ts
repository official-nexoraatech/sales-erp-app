import type { TourDefinition } from '../../schema.js';
import { PERMISSIONS } from '../../../../constants/permissions.js';

const tour: TourDefinition = {
  id: 'customers-overview',
  version: 1,
  type: 'quick',
  title: 'Customers — quick overview',
  description: 'Manage your customer master — GSTIN, credit limits, outstanding balances.',
  module: 'customers',
  estimatedMinutes: 2,
  requiredPermissions: [PERMISSIONS.CUSTOMER_VIEW],
  steps: [
    {
      id: 'intro',
      route: 'customers',
      title: 'Customers',
      body: 'Manage your customer master — GSTIN, credit limits, outstanding balances.',
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.CUSTOMER_VIEW,
    },
    {
      id: 'add-customer',
      route: 'customers',
      target: '[data-tour-id="customers-create-button"]',
      title: 'Add a new customer',
      body: 'Click "New Customer" → fill name, mobile, GSTIN (for B2B) → Save.',
      placement: 'bottom',
      mode: 'informational',
      requiredPermission: PERMISSIONS.CUSTOMER_VIEW,
    },
    {
      id: 'credit-limit',
      route: 'customers',
      title: 'Set credit limit',
      body: 'Open customer → Edit → set Credit Limit → system will block invoices above this.',
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.CUSTOMER_VIEW,
    },
    {
      id: 'customer-360',
      route: 'customers',
      title: 'View customer account',
      body: 'Click customer name → 360° view: invoices, payments, outstanding, history.',
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.CUSTOMER_VIEW,
    },
  ],
};

export default tour;
