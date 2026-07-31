import type { TourDefinition } from '../../schema.js';
import { PERMISSIONS } from '../../../../constants/permissions.js';

// Grounded against SupplierPaymentsPage.tsx / SupplierPaymentFormPage.tsx / SupplierPaymentService.ts.
// Corrected: there is no bill/invoice picker anywhere in the form, and Supplier is a raw numeric
// ID field, not a search/select — the only such field in the whole Purchase module. The old
// "allocate across multiple bills" claim described a UI that doesn't exist; allocation is a real
// backend capability but nothing in the frontend ever calls it.
const tour: TourDefinition = {
  id: 'purchase-payments-overview',
  version: 1,
  type: 'quick',
  title: 'Supplier Payments — quick overview',
  description: 'Record a payment made to a supplier — it reduces their balance immediately.',
  module: 'purchase',
  estimatedMinutes: 1,
  requiredPermissions: [PERMISSIONS.PAYMENT_OUT_VIEW],
  steps: [
    {
      id: 'intro',
      route: 'purchase/payments',
      title: 'Supplier Payments',
      body: "Record money you've paid a supplier — by cash, cheque, or bank transfer.",
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.PAYMENT_OUT_VIEW,
    },
    {
      id: 'record',
      route: 'purchase/payments',
      target: '[data-tour-id="purchase-payments-create-button"]',
      title: 'Record a payment',
      body: "Supplier is entered by numeric ID — there's no search here, so confirm the right supplier on the Suppliers list first. Then pick the mode and enter the amount; there's no bill picker, so this is recorded as one flat payment.",
      placement: 'bottom',
      mode: 'informational',
      requiredPermission: PERMISSIONS.PAYMENT_OUT_VIEW,
    },
    {
      id: 'balance-drops-immediately',
      route: 'purchase/payments',
      title: 'No separate step needed for the balance to update',
      body: "As soon as you record a payment, the supplier's outstanding balance drops and the entry posts to your books. You don't need to allocate it to a specific bill first.",
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.PAYMENT_OUT_VIEW,
    },
  ],
};

export default tour;
