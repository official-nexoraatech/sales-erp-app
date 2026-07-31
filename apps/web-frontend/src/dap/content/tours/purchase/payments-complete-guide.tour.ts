import type { TourDefinition } from '../../schema.js';
import { PERMISSIONS } from '../../../../constants/permissions.js';

// Deep-dive companion to `purchase-payments-overview`. Grounded against SupplierPaymentService.ts
// (apps/purchase-service) and PaymentAccountingConsumer.ts (apps/accounting-service). Key finding:
// unlike Sales Payments (where the customer balance only drops at a separate allocate() step),
// Supplier Payments reduce the supplier's balance in the SAME transaction as create() — allocation
// exists only to tag which GRNs a payment covers for record-keeping, it never touches the balance
// again.
const tour: TourDefinition = {
  id: 'purchase-payments-complete-guide',
  version: 1,
  type: 'complete',
  title: 'Supplier Payments — complete guide',
  description:
    "Why the supplier balance updates immediately (not at allocation), the form's real fields, and what Mark Bounced actually reverses.",
  module: 'purchase',
  estimatedMinutes: 5,
  requiredPermissions: [PERMISSIONS.PAYMENT_OUT_VIEW],
  steps: [
    {
      id: 'purpose',
      route: 'purchase/payments',
      title: 'Why this page exists',
      body: 'Record money paid to a supplier — by cash, cheque, or bank transfer — and reduce what you owe them.',
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.PAYMENT_OUT_VIEW,
    },
    {
      id: 'create',
      route: 'purchase/payments/new',
      title: 'Recording a payment',
      body: "Supplier is a raw numeric ID field — the only such field in this module; there's no name search or confirmation before you submit, so verify the ID on the Suppliers list first. There's also no bill/invoice picker: this records one flat amount, not an allocation across specific bills.",
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.PAYMENT_OUT_VIEW,
    },
    {
      id: 'balance-and-accounting',
      route: 'purchase/payments',
      title: 'Balance and accounting post together, immediately',
      body: "This differs from Sales Payments (where the customer balance only drops once you allocate to specific invoices). Here, recording a payment both reduces the supplier's balance AND posts Dr Accounts Payable / Cr Cash-Bank in the same step — no allocation required.",
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.PAYMENT_OUT_VIEW,
    },
    {
      id: 'conditional-fields',
      route: 'purchase/payments/new',
      title: 'Mode-specific fields',
      body: "Cheque adds Cheque Number and PDC Clearing Date; UPI/NEFT/RTGS adds a Transaction Reference; Cash needs nothing extra. If you set a Cheque's clearing date in the future, it's automatically tagged as a Post-Dated Cheque (PDC).",
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.PAYMENT_OUT_VIEW,
    },
    {
      id: 'mark-bounced',
      route: 'purchase/payments',
      target: '[data-tour-id="supplier-payment-bounce-row-action"]',
      title: 'Mark Bounced',
      body: "Only shown for cheque payments still in Paid or Partially Allocated status. You'll be asked to confirm and enter the actual reason — this correctly reverses the accounting entry and adds the amount back to the supplier's outstanding balance.",
      placement: 'bottom',
      mode: 'informational',
      requiredPermission: PERMISSIONS.PAYMENT_OUT_VIEW,
    },
    {
      id: 'business-impact',
      route: 'purchase/payments',
      title: 'What recording a payment touches',
      body: 'Everything happens in one step here — no separate allocation needed.',
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.PAYMENT_OUT_VIEW,
      calloutTitle: 'Business impact',
      calloutVariant: 'info',
      businessImpact: [
        'Supplier balance: reduced immediately at creation, not at a separate allocation step.',
        'Accounting: posts Dr Accounts Payable / Cr Cash-Bank immediately.',
        'GST: no effect — a payment is not a taxable event.',
        'Bounced cheque: correctly reverses both the accounting entry and the supplier balance change.',
      ],
    },
    {
      id: 'common-mistakes',
      route: 'purchase/payments',
      title: 'Common mistakes',
      body: 'The missing supplier search is the main trap.',
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.PAYMENT_OUT_VIEW,
      calloutTitle: 'Common mistakes',
      calloutVariant: 'warning',
      businessImpact: [
        "Typing the wrong Supplier ID with no confirmation — there's no name lookup before submit, so an error only surfaces after the API call.",
        "Looking for a bill/invoice selector — it doesn't exist; every payment is recorded as one flat amount.",
        "Forgetting there's no branch selector — the payment is silently recorded against your first assigned branch, which matters if you work across multiple branches.",
      ],
    },
    {
      id: 'best-practices',
      route: 'purchase/payments',
      title: 'Best practices',
      body: 'A little verification before you submit goes a long way.',
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.PAYMENT_OUT_VIEW,
      calloutTitle: 'Best practices',
      calloutVariant: 'success',
      businessImpact: [
        "Confirm the supplier's ID and name on the Suppliers list before recording a payment against them.",
        "Use Mark Bounced the same day a cheque bounces so your books and supplier balance don't silently drift.",
        'For PDC (post-dated cheques), track the clearing date outside the system too until it actually clears.',
      ],
    },
  ],
};

export default tour;
