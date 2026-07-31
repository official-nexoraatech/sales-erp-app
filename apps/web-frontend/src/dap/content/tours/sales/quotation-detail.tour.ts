import type { TourDefinition } from '../../schema.js';
import { PERMISSIONS } from '../../../../constants/permissions.js';

// Detail-page tour — only offered by Help Panel while actually viewing a specific quotation
// (route `sales/quotations/:id` pattern-matches the current URL). Buttons here are status-gated
// the same way as the invoice detail tour — see that file's header comment.
const tour: TourDefinition = {
  id: 'sales-quotation-detail-overview',
  version: 1,
  type: 'quick',
  title: 'This quotation — quick overview',
  description: "What each action on a quotation's own page does, and when it's available.",
  module: 'sales',
  estimatedMinutes: 2,
  requiredPermissions: [PERMISSIONS.INVOICE_VIEW],
  steps: [
    {
      id: 'intro',
      route: 'sales/quotations/:id',
      title: 'This quotation, in full',
      body: 'Which buttons you see here depends on its status — DRAFT, SENT, VIEWED, ACCEPTED, or already CONVERTED to an invoice.',
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.INVOICE_VIEW,
    },
    {
      id: 'send',
      route: 'sales/quotations/:id',
      target: '[data-tour-id="sales-quotation-detail-send-button"]',
      title: 'Send',
      body: 'Only shown while this quotation is a DRAFT. Moves it to SENT — once sent, further changes mean creating a fresh quotation.',
      placement: 'bottom',
      mode: 'informational',
      requiredPermission: PERMISSIONS.INVOICE_CREATE,
    },
    {
      id: 'accept',
      route: 'sales/quotations/:id',
      target: '[data-tour-id="sales-quotation-detail-accept-button"]',
      title: 'Accept',
      body: 'Shown once this quotation is SENT or VIEWED. Marks it ACCEPTED — a status change only, with no accounting, inventory, or GST effect by itself.',
      placement: 'bottom',
      mode: 'informational',
      requiredPermission: PERMISSIONS.QUOTATION_CONVERT,
    },
    {
      id: 'reject',
      route: 'sales/quotations/:id',
      target: '[data-tour-id="sales-quotation-detail-reject-button"]',
      title: 'Reject',
      body: 'Shown alongside Accept. Marks this quotation REJECTED and asks for confirmation first — use it instead of leaving a dead quotation sitting as SENT indefinitely.',
      placement: 'bottom',
      mode: 'informational',
      requiredPermission: PERMISSIONS.QUOTATION_CONVERT,
    },
    {
      id: 'convert',
      route: 'sales/quotations/:id',
      target: '[data-tour-id="sales-quotation-detail-convert-button"]',
      title: 'Convert to Invoice',
      body: 'Shown once this quotation is ACCEPTED. Marks it CONVERTED and takes you straight to a new invoice form pre-filled with its customer and line items.',
      placement: 'bottom',
      mode: 'informational',
      requiredPermission: PERMISSIONS.QUOTATION_CONVERT,
    },
    {
      id: 'create-invoice',
      route: 'sales/quotations/:id',
      target: '[data-tour-id="sales-quotation-detail-create-invoice-button"]',
      title: 'Create Invoice',
      body: 'Shown once this quotation is ACCEPTED or CONVERTED — useful for starting a second invoice against the same quotation, since Convert only pre-fills the form once.',
      placement: 'bottom',
      mode: 'informational',
      requiredPermission: PERMISSIONS.INVOICE_CREATE,
    },
  ],
};

export default tour;
