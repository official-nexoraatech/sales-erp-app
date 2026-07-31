import type { TourDefinition } from '../../schema.js';
import { PERMISSIONS } from '../../../../constants/permissions.js';

// Grounded against GRNsPage.tsx / GRNCreatePage.tsx / GRNService.ts. Corrected from an earlier
// version that described a PO search/select — creation is manual numeric PO-ID entry (a "Load
// PO" button), unless you arrive via the PO list's "Receive" row action, which pre-fills it.
// Also corrected: a zero-variance GRN is created straight into DRAFT, not PENDING_APPROVAL —
// "Draft" here does not mean "unfinished," it means "stock has not moved yet, waiting on you
// to click Approve."
const tour: TourDefinition = {
  id: 'purchase-grns-overview',
  version: 1,
  type: 'quick',
  title: 'Goods Receipt Notes (GRN) — quick overview',
  description: 'Record goods received from suppliers — this is the step that actually moves stock.',
  module: 'purchase',
  estimatedMinutes: 1,
  requiredPermissions: [PERMISSIONS.GRN_VIEW],
  steps: [
    {
      id: 'intro',
      route: 'purchase/grns',
      title: 'Goods Receipt Notes (GRN)',
      body: 'A GRN is the real trigger in the purchase cycle: approving one adds stock, recalculates item cost, and updates the PO — a Purchase Order by itself never does any of that.',
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.GRN_VIEW,
    },
    {
      id: 'create',
      route: 'purchase/grns',
      target: '[data-tour-id="grn-create-button"]',
      title: 'Create a GRN',
      body: 'Fastest path: use "Receive" on an approved PO in the Purchase Orders list — it pre-fills the PO here. Starting from this button instead means typing the PO\'s numeric ID and clicking Load PO; there\'s no search yet.',
      placement: 'bottom',
      mode: 'informational',
      requiredPermission: PERMISSIONS.GRN_VIEW,
    },
    {
      id: 'draft-means-unapproved',
      route: 'purchase/grns',
      title: '"Draft" doesn\'t mean unfinished',
      body: 'Most GRNs land in Draft status immediately after creation — not Pending Approval. Stock is NOT added yet. You still need to open it and click "Approve & Add Stock" before it counts.',
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.GRN_VIEW,
    },
    {
      id: 'variance',
      route: 'purchase/grns',
      title: 'Price variance',
      body: "If the rate you're receiving at differs from the PO's rate by more than 5%, that line is flagged and the GRN is routed for approval before stock moves.",
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.GRN_VIEW,
    },
  ],
};

export default tour;
