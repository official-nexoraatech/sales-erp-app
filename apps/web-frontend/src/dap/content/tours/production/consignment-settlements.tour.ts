import type { TourDefinition } from '../../schema.js';
import { PERMISSIONS } from '../../../../constants/permissions.js';

// Grounded against ConsignmentService.ts / ConsignmentSettlementsPage.tsx. Important correction:
// createSettlement() sums soldQty × agreedRate across consignment stock records — but soldQty is
// only ever written by recordSale(), which is confirmed dead code with no route/caller anywhere
// (see consignment-stock.tour.ts). The practical result: every settlement created against
// today's data computes ₹0 / 0 units sold, regardless of real sales activity. This is a real,
// currently-live gap — described honestly here rather than promised as working.
const tour: TourDefinition = {
  id: 'production-consignment-settlements-overview',
  version: 1,
  type: 'quick',
  title: 'Consignment Settlements — quick overview',
  description:
    'Calculates what you owe a consignor — currently limited by an unresolved sales-tracking gap.',
  module: 'production',
  estimatedMinutes: 2,
  requiredPermissions: [PERMISSIONS.CONSIGNMENT_VIEW],
  steps: [
    {
      id: 'intro',
      route: 'production/consignment/settlements',
      title: 'Consignment Settlements',
      body: "A settlement totals up what you owe a consignor for their consigned stock you've sold in a period — sold quantity × the agreed rate per unit.",
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.CONSIGNMENT_VIEW,
    },
    {
      id: 'known-zero-issue',
      route: 'production/consignment/settlements',
      title: 'Currently computes ₹0 for every settlement',
      body: 'Because of the same sales-tracking gap noted on the Consignment Stock page — the mechanism that would mark consigned stock as sold isn\'t connected to any real sales flow — the "sold quantity" this page sums is never populated. Every settlement you create today will total ₹0 and 0 units, regardless of actual sales. Track what you owe a consignor manually until this is resolved.',
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.CONSIGNMENT_VIEW,
      calloutTitle: 'Common mistake',
      calloutVariant: 'warning',
    },
    {
      id: 'run-settlement',
      route: 'production/consignment/settlements',
      target: '[data-tour-id="production-consignment-settlements-create-button"]',
      title: 'Create Settlement',
      body: 'Pick a supplier and a date range — the system pulls matching consignment records and totals them.',
      placement: 'bottom',
      mode: 'informational',
      requiredPermission: PERMISSIONS.CONSIGNMENT_SETTLE,
    },
    {
      id: 'mark-settled',
      route: 'production/consignment/settlements',
      target: '[data-tour-id="production-consignment-settlements-mark-settled-button"]',
      title: 'Mark Settled',
      body: "A status flip with a payment reference you type in — it doesn't post any accounting entry or actually transfer money. Paying the consignor happens outside the system; this just records that you did.",
      placement: 'bottom',
      mode: 'informational',
      requiredPermission: PERMISSIONS.CONSIGNMENT_SETTLE,
    },
  ],
};

export default tour;
