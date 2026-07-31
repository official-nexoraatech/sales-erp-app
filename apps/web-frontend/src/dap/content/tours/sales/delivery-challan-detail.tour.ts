import type { TourDefinition } from '../../schema.js';
import { PERMISSIONS } from '../../../../constants/permissions.js';

// Detail-page tour — only offered by Help Panel while actually viewing a specific delivery
// challan (route `sales/delivery-challans/:id` pattern-matches the current URL).
const tour: TourDefinition = {
  id: 'sales-challan-detail-overview',
  version: 1,
  type: 'quick',
  title: 'This delivery challan — quick overview',
  description: "What each action on a challan's own page does, and when it's available.",
  module: 'sales',
  estimatedMinutes: 1,
  requiredPermissions: [PERMISSIONS.INVOICE_VIEW],
  steps: [
    {
      id: 'intro',
      route: 'sales/delivery-challans/:id',
      title: 'This challan, in full',
      body: "A dispatch record — which buttons you see depends on whether it's still DRAFT, already DISPATCHED, or CONVERTED to an invoice.",
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.INVOICE_VIEW,
    },
    {
      id: 'dispatch',
      route: 'sales/delivery-challans/:id',
      target: '[data-tour-id="sales-challan-detail-dispatch-button"]',
      title: 'Dispatch',
      body: 'Only shown while this challan is a DRAFT. Flips it to DISPATCHED — a status change only, with no stock or accounting effect.',
      placement: 'bottom',
      mode: 'informational',
      requiredPermission: PERMISSIONS.INVOICE_CREATE,
    },
    {
      id: 'convert',
      route: 'sales/delivery-challans/:id',
      target: '[data-tour-id="sales-challan-detail-convert-button"]',
      title: 'Convert to Invoice',
      body: 'Shown while this challan is DRAFT or DISPATCHED. Opens a new invoice pre-filled with its customer and items — still without GST or pricing, which this document never carries.',
      placement: 'bottom',
      mode: 'informational',
      requiredPermission: PERMISSIONS.INVOICE_CREATE,
    },
    {
      id: 'view-invoice',
      route: 'sales/delivery-challans/:id',
      target: '[data-tour-id="sales-challan-detail-view-invoice-button"]',
      title: 'View Invoice',
      body: 'Shown once this challan has already been converted — jumps straight to the resulting invoice to confirm pricing and tax landed the way you expected.',
      placement: 'bottom',
      mode: 'informational',
      requiredPermission: PERMISSIONS.INVOICE_VIEW,
    },
  ],
};

export default tour;
