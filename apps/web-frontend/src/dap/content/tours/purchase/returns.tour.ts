import type { TourDefinition } from '../../schema.js';
import { PERMISSIONS } from '../../../../constants/permissions.js';

// Grounded against PurchaseReturnsPage.tsx / PurchaseReturnFormPage.tsx / PurchaseReturnService.ts.
// Corrected: creation is manual numeric GRN-ID entry (a "Load GRN" button), not a search/select —
// there's no "Create Return" shortcut anywhere on the GRN pages either. Unlike a Sale Return
// (which applies immediately), a Purchase Return has a real Draft stage — creating one does
// nothing until you separately Approve it.
const tour: TourDefinition = {
  id: 'purchase-returns-overview',
  version: 1,
  type: 'quick',
  title: 'Purchase Returns — quick overview',
  description:
    'Return goods to a supplier against a specific GRN — nothing moves until you Approve.',
  module: 'purchase',
  estimatedMinutes: 1,
  requiredPermissions: [PERMISSIONS.PURCHASE_RETURN_VIEW],
  steps: [
    {
      id: 'intro',
      route: 'purchase/returns',
      title: 'Purchase Returns',
      body: 'Return goods you received back to the supplier — damaged, wrong item, excess, or quality issue. Every return is tied to the specific GRN it came from.',
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.PURCHASE_RETURN_VIEW,
    },
    {
      id: 'create',
      route: 'purchase/returns',
      target: '[data-tour-id="purchase-returns-create-button"]',
      title: 'Create a purchase return',
      body: "Enter the GRN's ID and click Load GRN — there's no search yet, so grab the ID from the GRN list first. Then enter the quantity to return per line and a reason.",
      placement: 'bottom',
      mode: 'informational',
      requiredPermission: PERMISSIONS.PURCHASE_RETURN_VIEW,
    },
    {
      id: 'draft-then-approve',
      route: 'purchase/returns',
      title: 'Draft, then Approve',
      body: "Creating a return only saves it as Draft — nothing happens to stock or the supplier's balance yet. Approving is the real action: it deducts the stock and auto-generates a debit note. You'll be asked to confirm, since it can't be undone.",
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.PURCHASE_RETURN_VIEW,
    },
    {
      id: 'debit-notes-tab',
      route: 'purchase/returns',
      title: 'Debit Notes tab',
      body: "Every approved return generates a debit note automatically, visible in the second tab. It reduces what you owe the supplier — but this list is read-only; there's no drill-down back to the return that created it.",
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.PURCHASE_RETURN_VIEW,
    },
  ],
};

export default tour;
