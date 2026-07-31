import type { TourDefinition } from '../../schema.js';
import { PERMISSIONS } from '../../../../constants/permissions.js';

// Deep-dive companion to `purchase-grns-overview`. Grounded against GRNService.ts
// (apps/purchase-service) and the accounting/GST consumer audit. Key findings: GRN approval
// writes stock, valuation (WACC/FIFO), PO status, and supplier balance synchronously in one
// transaction — it does NOT call inventory-service's own API; purchase-service duplicates the
// valuation logic by design (a cross-service HTTP call couldn't share this transaction).
// Accounting and GST effects are eventual (via Kafka), usually within moments. RCM (unregistered
// supplier) GRNs correctly book the self-assessed tax in the General Ledger, but a real payload
// gap means the GST ledger — and therefore GSTR-3B's RCM figures — shows that tax as zero.
const tour: TourDefinition = {
  id: 'purchase-grns-complete-guide',
  version: 1,
  type: 'complete',
  title: 'Goods Receipt Notes — complete guide',
  description:
    'Why "Draft" GRNs need an explicit Approve, exactly what Approve touches, and the RCM/GST quirk worth knowing about.',
  module: 'purchase',
  estimatedMinutes: 7,
  requiredPermissions: [PERMISSIONS.GRN_VIEW],
  steps: [
    {
      id: 'purpose',
      route: 'purchase/grns',
      title: 'Why this page exists',
      body: "A GRN records that goods physically arrived from a supplier — against a specific, previously Approved Purchase Order. It's the real trigger in the purchase cycle, not the PO.",
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.GRN_VIEW,
    },
    {
      id: 'create',
      route: 'purchase/grns/new',
      title: 'Creating a GRN',
      body: "Load a PO (by ID, or pre-filled if you arrived via the PO list's Receive action), pick a warehouse, and enter what was actually received per line. The Receive Qty field caps at what's still outstanding and GRN Rate defaults to the PO rate — but neither is enforced beyond the input's own limits, so double-check before submitting.",
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.GRN_VIEW,
    },
    {
      id: 'draft-status',
      route: 'purchase/grns',
      title: 'Draft ≠ unfinished',
      body: 'A GRN with no price variance is created straight into Draft, not Pending Approval — the same status a half-finished record would show. Either way, stock has not moved. You still need an explicit Approve.',
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.GRN_VIEW,
    },
    {
      id: 'approve',
      route: 'purchase/grns',
      target: '[data-tour-id="grn-approve-row-action"]',
      title: 'Approve & Add Stock',
      body: "This is the one moment everything happens, in a single transaction: stock is added, the item's weighted-average (or FIFO) cost is recalculated, and the originating PO moves to Partially or Fully Received.",
      placement: 'bottom',
      mode: 'informational',
      requiredPermission: PERMISSIONS.GRN_VIEW,
    },
    {
      id: 'reject',
      route: 'purchase/grns',
      title: 'Reject',
      body: "Requires a reason, but that reason is never shown anywhere again after the modal closes — there's no detail page to review it on later, so communicate the reason to your team outside the system if it matters.",
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.GRN_VIEW,
    },
    {
      id: 'variance',
      route: 'purchase/grns',
      title: 'Price variance routing',
      body: 'If the received rate differs from the PO rate by more than 5% on any line, the GRN is flagged with a "Price Variance" badge and routed for approval before stock can move — visible both at creation (inline warning) and on the list.',
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.GRN_VIEW,
    },
    {
      id: 'business-impact',
      route: 'purchase/grns',
      title: 'What Approve touches',
      body: 'More than any other screen in Purchase.',
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.GRN_VIEW,
      calloutTitle: 'Business impact',
      calloutVariant: 'info',
      businessImpact: [
        'Inventory: stock added immediately, synchronously, in the same transaction as the approval click.',
        'Valuation: weighted-average (or FIFO) cost recalculated for every item on the GRN.',
        'Purchase Order: moves to Partially Received or Received depending on whether every line is now fully received.',
        'Supplier balance: increases by the GRN total — this is now what you owe them.',
        'Accounting: usually within moments, posts Dr Inventory + Dr GST Input / Cr Accounts Payable.',
        "GST: writes an ITC-eligible entry to the GST ledger, feeding GSTR-2A/2B/3B — except for RCM (unregistered-supplier) GRNs, where a known payload gap zeroes the GST ledger's RCM tax figures even though the accounting entry itself books correctly.",
      ],
    },
    {
      id: 'common-mistakes',
      route: 'purchase/grns',
      title: 'Common mistakes',
      body: 'The status label is the biggest trap here.',
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.GRN_VIEW,
      calloutTitle: 'Common mistakes',
      calloutVariant: 'warning',
      businessImpact: [
        'Leaving a GRN sitting in "Draft," assuming it\'s just a saved-for-later note — stock is not in until you click Approve.',
        "Trusting the Receive Qty and GRN Rate input limits as real validation — they're HTML-level hints only; always compare against the PO before submitting.",
        "If receiving from an unregistered supplier (RCM), don't rely on GSTR-3B's RCM figures alone to confirm the self-assessed tax was booked — cross-check the journal entry directly.",
      ],
    },
    {
      id: 'best-practices',
      route: 'purchase/grns',
      title: 'Best practices',
      body: 'Approve promptly and keep receipts traceable.',
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.GRN_VIEW,
      calloutTitle: 'Best practices',
      calloutVariant: 'success',
      businessImpact: [
        'Approve a GRN the same day goods are physically checked in — until then, your stock counts and item costs are stale.',
        "Use the PO list's Receive action instead of GRN → New whenever you can; it avoids hand-typing a raw PO ID.",
        "Record the Reject reason somewhere your team can find it later (chat, PO notes) since the system itself won't show it again.",
      ],
    },
  ],
};

export default tour;
