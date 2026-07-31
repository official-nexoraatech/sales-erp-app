import type { TourDefinition } from '../../schema.js';
import { PERMISSIONS } from '../../../../constants/permissions.js';

// This page also appears as one stop in the cross-module "purchase-to-dashboard-workflow"
// business-workflow tour — that one explains how a PO fits into the bigger picture; this one
// is the page-specific "what can I do here" Quick Tour. HelpPanel shows both, in separate
// sections ("This page" vs "Business workflows"), not as duplicates.
//
// Grounded against PurchaseOrdersPage.tsx / PurchaseOrderFormPage.tsx / PurchaseOrderDetailPage.tsx
// and PurchaseOrderService.ts. Corrected from an earlier version that described a PDF/Email/
// WhatsApp "send to supplier" flow — no such UI exists anywhere in this module (grep for
// pdf/PDF/email/whatsapp across pages/purchase returns nothing) despite a working backend
// /purchase-orders/:id/pdf route. Also corrected: receiving goods is a real row action
// ("Receive"), not a manual "go find the GRN page" instruction.
const tour: TourDefinition = {
  id: 'purchase-orders-overview',
  version: 1,
  type: 'quick',
  title: 'Purchase Orders — quick overview',
  description: 'Create POs for suppliers — a commitment document, required before receiving goods.',
  module: 'purchase',
  estimatedMinutes: 1,
  requiredPermissions: [PERMISSIONS.PO_VIEW],
  steps: [
    {
      id: 'intro',
      route: 'purchase/orders',
      title: 'Purchase Orders',
      body: "A PO is your formal request to a supplier — it doesn't touch stock, GST, or your books yet. Nothing happens until goods actually arrive via a GRN.",
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.PO_VIEW,
    },
    {
      id: 'create',
      route: 'purchase/orders',
      target: '[data-tour-id="po-create-button"]',
      title: 'Create a purchase order',
      body: 'New PO → select supplier → search and add items (rate and GST rate auto-fill from the item) → Submit.',
      placement: 'bottom',
      mode: 'informational',
      requiredPermission: PERMISSIONS.PO_VIEW,
    },
    {
      id: 'no-edit',
      route: 'purchase/orders',
      title: 'There is no edit for a Draft PO',
      body: "If you spot a typo after saving, there's no edit page — your only options are Cancel and start over, or Duplicate to create a fresh draft copy. Double-check quantities and rates before submitting.",
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.PO_VIEW,
    },
    {
      id: 'receive',
      route: 'purchase/orders',
      title: 'Receiving against an approved PO',
      body: 'Once a PO is Approved, use its "Receive" row action — it opens a Goods Receipt Note pre-filled with this PO. That\'s the only frictionless path; opening GRN → New any other way means typing the PO\'s numeric ID by hand.',
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.PO_VIEW,
    },
  ],
};

export default tour;
