import type { TourDefinition } from '../../schema.js';
import { PERMISSIONS } from '../../../../constants/permissions.js';

// Detail-page tour — only offered by Help Panel while actually viewing a specific PO (route
// `purchase/orders/:id` pattern-matches the current URL; see routeMatch.ts). Purchase Orders are
// the only area in the whole Purchase module with a detail page at all — GRNs, Returns, Payments,
// and Expenses have list + create only, no drill-down. Each action button here is conditionally
// rendered by the PO's own status, per PurchaseOrderDetailPage.tsx.
const tour: TourDefinition = {
  id: 'purchase-order-detail-overview',
  version: 1,
  type: 'quick',
  title: 'This purchase order — quick overview',
  description: "What each action on a PO's own page does, and when it's available.",
  module: 'purchase',
  estimatedMinutes: 2,
  requiredPermissions: [PERMISSIONS.PO_VIEW],
  steps: [
    {
      id: 'intro',
      route: 'purchase/orders/:id',
      title: 'This PO, in full',
      body: "Line items, totals, and every action available at this PO's current status — which buttons you see depends on whether it's Draft, Submitted, Approved, or already Received.",
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.PO_VIEW,
    },
    {
      id: 'submit',
      route: 'purchase/orders/:id',
      target: '[data-tour-id="po-detail-submit-button"]',
      title: 'Submit',
      body: "Only shown while this PO is Draft. Moves it to Submitted so it's ready for approval — no stock or accounting effect.",
      placement: 'bottom',
      mode: 'informational',
      requiredPermission: PERMISSIONS.PO_CREATE,
    },
    {
      id: 'approve',
      route: 'purchase/orders/:id',
      target: '[data-tour-id="po-detail-approve-button"]',
      title: 'Approve',
      body: 'Shown once this PO is Submitted. Asks for a PO Number (free text) and runs a supplier credit-limit check — can be blocked if the supplier is over their limit.',
      placement: 'bottom',
      mode: 'informational',
      requiredPermission: PERMISSIONS.PO_APPROVE,
    },
    {
      id: 'duplicate',
      route: 'purchase/orders/:id',
      target: '[data-tour-id="po-detail-duplicate-button"]',
      title: 'Duplicate',
      body: "Always available. Since there's no edit page for a PO at any status, this is your way to fix a mistake — it creates a brand-new Draft copy of this PO for you to adjust.",
      placement: 'bottom',
      mode: 'informational',
      requiredPermission: PERMISSIONS.PO_CREATE,
    },
    {
      id: 'cancel',
      route: 'purchase/orders/:id',
      target: '[data-tour-id="po-detail-cancel-button"]',
      title: 'Cancel',
      body: 'Shown at any status except Received, Closed, or Cancelled. Requires a free-text reason and cannot be undone.',
      placement: 'bottom',
      mode: 'informational',
      requiredPermission: PERMISSIONS.PO_CANCEL,
    },
  ],
};

export default tour;
