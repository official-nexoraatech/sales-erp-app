import type { TourDefinition } from '../../schema.js';
import { PERMISSIONS } from '../../../../constants/permissions.js';

// Grounded against ConsignmentService.ts / ConsignmentStockPage.tsx. Important, honest addition:
// the method that would mark consigned stock as sold (recordSale()) has no route and no caller
// anywhere in the codebase — confirmed dead code. Selling a consigned item through a normal
// invoice/POS sale does NOT update this page's Sold quantity today. Flagged clearly so users
// don't rely on this page reflecting real sales activity.
const tour: TourDefinition = {
  id: 'production-consignment-stock-overview',
  version: 1,
  type: 'quick',
  title: 'Consignment Stock — quick overview',
  description: 'Track goods received on consignment — not owned until sold.',
  module: 'production',
  estimatedMinutes: 2,
  requiredPermissions: [PERMISSIONS.CONSIGNMENT_VIEW],
  steps: [
    {
      id: 'intro',
      route: 'production/consignment/stock',
      title: 'Consignment Stock',
      body: "Goods a supplier has placed with you but that you don't own until you sell them — tracked in its own record, separate from your regular item stock.",
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.CONSIGNMENT_VIEW,
    },
    {
      id: 'receive-stock',
      route: 'production/consignment/stock',
      target: '[data-tour-id="production-consignment-stock-receive-button"]',
      title: 'Receive consignment stock',
      body: "Record supplier, item, warehouse, quantity, and the agreed rate per unit. This isn't posted to your books — the code comment is explicit: it's not owned until sold.",
      placement: 'bottom',
      mode: 'informational',
      requiredPermission: PERMISSIONS.CONSIGNMENT_RECEIVE,
    },
    {
      id: 'sold-tracking-gap',
      route: 'production/consignment/stock',
      title: 'Selling consigned stock does not update this page yet',
      body: "This is important: there's no working connection between a normal sale and this page's Sold quantity. Selling a consigned item through an invoice or POS sale reduces regular item stock as usual, but does not mark it sold here — the Sold column on consignment records is not currently reachable from any real sales flow.",
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.CONSIGNMENT_VIEW,
      calloutTitle: 'Common mistake',
      calloutVariant: 'warning',
    },
    {
      id: 'return',
      route: 'production/consignment/stock',
      target: '[data-tour-id="production-consignment-stock-return-button"]',
      title: 'Return',
      body: "For an Active record with quantity still available, return some or all of it to the supplier. Prompts for a quantity — there's no separate confirmation step, so double-check the number before submitting.",
      placement: 'bottom',
      mode: 'informational',
      requiredPermission: PERMISSIONS.CONSIGNMENT_RETURN,
    },
  ],
};

export default tour;
