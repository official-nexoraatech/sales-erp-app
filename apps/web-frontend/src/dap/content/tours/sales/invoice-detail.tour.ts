import type { TourDefinition } from '../../schema.js';
import { PERMISSIONS } from '../../../../constants/permissions.js';

// Detail-page tour — only offered by Help Panel while actually viewing a specific invoice
// (route `sales/invoices/:id` pattern-matches the current URL; see routeMatch.ts). Each
// action button here is conditionally rendered by the invoice's own status — a DRAFT invoice
// won't show Record Payment, a PAID one won't show Confirm — so steps say "if you see this"
// rather than assuming every button is present on every invoice.
const tour: TourDefinition = {
  id: 'sales-invoice-detail-overview',
  version: 1,
  type: 'quick',
  title: 'This invoice — quick overview',
  description: "What each action on an invoice's own page does, and when it's available.",
  module: 'sales',
  estimatedMinutes: 2,
  requiredPermissions: [PERMISSIONS.INVOICE_VIEW],
  steps: [
    {
      id: 'intro',
      route: 'sales/invoices/:id',
      title: 'This invoice, in full',
      body: "Line items, totals, and every action available at this invoice's current status — which of the buttons below you actually see depends on whether it's DRAFT, CONFIRMED, or already paid.",
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.INVOICE_VIEW,
    },
    {
      id: 'confirm',
      route: 'sales/invoices/:id',
      target: '[data-tour-id="sales-invoice-detail-confirm-button"]',
      title: 'Confirm Invoice',
      body: "Only shown while this invoice is a DRAFT. This is the moment it becomes real — stock deducts, accounting posts, GST records, and the customer's balance increases, all at once.",
      placement: 'bottom',
      mode: 'informational',
      requiredPermission: PERMISSIONS.INVOICE_CREATE,
    },
    {
      id: 'record-payment',
      route: 'sales/invoices/:id',
      target: '[data-tour-id="sales-invoice-detail-record-payment-button"]',
      title: 'Record Payment',
      body: "Shown once this invoice is CONFIRMED or PARTIALLY_PAID. Opens the payment form pre-filled with this invoice's customer and remaining balance.",
      placement: 'bottom',
      mode: 'informational',
      requiredPermission: PERMISSIONS.PAYMENT_CREATE,
    },
    {
      id: 'print',
      route: 'sales/invoices/:id',
      target: '[data-tour-id="sales-invoice-detail-print-button"]',
      title: 'Print / Download PDF',
      body: 'Shown once this invoice has a real invoice number — CONFIRMED, PARTIALLY_PAID, PAID, or OVERDUE. Generates the customer-facing document.',
      placement: 'bottom',
      mode: 'informational',
      requiredPermission: PERMISSIONS.INVOICE_VIEW,
    },
    {
      id: 'cancel',
      route: 'sales/invoices/:id',
      target: '[data-tour-id="sales-invoice-detail-cancel-button"]',
      title: 'Cancel',
      body: "Shown for DRAFT or CONFIRMED invoices. Always asks for a reason, and reverses the accounting entry automatically — but won't put physically-returned goods back on the shelf. Use a Sale Return for that instead.",
      placement: 'bottom',
      mode: 'informational',
      requiredPermission: PERMISSIONS.INVOICE_CANCEL,
    },
  ],
};

export default tour;
