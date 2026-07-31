import type { TourDefinition } from '../../schema.js';
import { PERMISSIONS } from '../../../../constants/permissions.js';

// Deep-dive companion to `sales-returns-overview`. Grounded against SaleReturnService.ts
// (apps/sales-service): unlike invoices, a sale return has no separate confirm step — creating
// it immediately approves it. Stock is restored only when the "Physical Return" switch is on
// and a warehouse is set; a credit note is generated automatically but this app currently has
// no page to view or print it afterward (the return list only shows its reference number).
const tour: TourDefinition = {
  id: 'sales-returns-complete-guide',
  version: 1,
  type: 'complete',
  title: 'Sale Returns — complete guide',
  description:
    'How a sale return works end to end: why it approves instantly, when stock actually comes back, and what it books to accounting and GST.',
  module: 'sales',
  estimatedMinutes: 6,
  requiredPermissions: [PERMISSIONS.INVOICE_VIEW],
  steps: [
    {
      id: 'purpose',
      route: 'sales/returns',
      title: 'Why this page exists',
      body: "A sale return records goods a customer sends back — defective, wrong item shipped, or a change of mind — against a specific invoice, and issues a credit note for the amount. It's used by whoever handles customer service or accounts, whenever a completed sale needs to be partly or fully reversed.",
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.INVOICE_VIEW,
    },
    {
      id: 'when-to-use',
      route: 'sales/returns',
      title: 'When to use a Sale Return vs. Cancel',
      body: "Cancel is for an invoice the customer never actually received or paid for. Sale Return is for goods that were delivered and are now coming back — it's the only action that correctly restores stock to the warehouse when the customer physically returns the item.",
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.INVOICE_VIEW,
    },
    {
      id: 'prerequisites',
      route: 'sales/returns',
      title: 'Before you start',
      body: "Have the original invoice's ID on hand — this form looks it up by number, not by customer name.",
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.INVOICE_VIEW,
      calloutTitle: 'Before you start',
      calloutVariant: 'warning',
      businessImpact: [
        "You'll need the invoice's internal ID number — this form doesn't offer a customer or invoice-number search, only a direct ID lookup.",
        'Only CONFIRMED invoices can have a return filed against them.',
        'Decide upfront whether the goods are physically coming back — that decision (the Physical Return switch) is what determines whether stock is restored.',
      ],
    },
    {
      id: 'load-invoice',
      route: 'sales/returns/new',
      target: '[data-tour-id="sales-return-new-load-invoice-button"]',
      title: 'Load Invoice',
      body: "Type the invoice ID and click Load — this pulls in every line from that invoice so you can choose how much of each to return. Note that items show only by their internal item number here, not by name, so keep the invoice open in another tab if you need to double-check what you're returning.",
      placement: 'bottom',
      mode: 'informational',
      requiredPermission: PERMISSIONS.INVOICE_CANCEL,
    },
    {
      id: 'physical-return',
      route: 'sales/returns/new',
      target: '[data-tour-id="sales-return-new-physical-switch"]',
      title: 'Physical Return switch',
      body: 'On (the default) means the goods are actually coming back to the warehouse — stock gets restored. Off means this is a billing-only adjustment (e.g. a price correction or goodwill credit) with no physical goods movement, so stock is left untouched.',
      placement: 'bottom',
      mode: 'informational',
      requiredPermission: PERMISSIONS.INVOICE_CANCEL,
    },
    {
      id: 'create-save',
      route: 'sales/returns/new',
      target: '[data-tour-id="sales-return-new-save-button"]',
      title: 'Create Return',
      body: 'Unlike an invoice, there\'s no separate "confirm" step — clicking this immediately approves the return and applies every effect (stock, accounting, GST, credit note) in one action. There\'s no draft stage to review first, so check the return quantities and reason before submitting.',
      placement: 'top',
      mode: 'informational',
      requiredPermission: PERMISSIONS.INVOICE_CANCEL,
    },
    {
      id: 'business-impact',
      route: 'sales/returns',
      title: 'What creating a return touches',
      body: 'Everything happens in the same instant you click Create Return.',
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.INVOICE_VIEW,
      calloutTitle: 'Business impact',
      calloutVariant: 'info',
      businessImpact: [
        'Inventory: stock is restored to the chosen warehouse, but only if Physical Return is on — a billing-only return never touches stock.',
        'Accounting: posts Sales Returns & Allowances against Accounts Receivable, reducing what the customer owes.',
        'GST: records a credit note entry for GST reporting.',
        'Reports: AR Aging and Trial Balance reflect it immediately.',
        'Dashboard: reduces net sales figures for the period.',
        'Customer Outstanding: decreases immediately by the return amount.',
      ],
    },
    {
      id: 'common-mistakes',
      route: 'sales/returns',
      title: 'Common mistakes',
      body: 'The lack of a confirm step is the biggest one.',
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.INVOICE_VIEW,
      calloutTitle: 'Common mistakes',
      calloutVariant: 'warning',
      businessImpact: [
        "Submitting without double-checking return quantities — there's no draft stage to catch a mistake before it's approved.",
        'Leaving Physical Return on for a purely financial adjustment, which incorrectly adds stock that was never actually returned.',
        "Losing track of the credit note afterward — the return list shows its reference number (e.g. CN-142) but there's currently no page to open or print it from; keep a note of the return date and amount if you need to reference it later.",
      ],
    },
    {
      id: 'best-practices',
      route: 'sales/returns',
      title: 'Best practices',
      body: 'A little care up front avoids a correction later.',
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.INVOICE_VIEW,
      calloutTitle: 'Best practices',
      calloutVariant: 'success',
      businessImpact: [
        "Confirm with the customer exactly which items and quantities are coming back before opening this form — there's no edit after submission.",
        "Pick the most specific Reason available (Defective / Wrong Item / Quality Issue) rather than defaulting to Other — it's what shows up in return-reason reporting.",
        'Keep the original invoice open alongside this form so item names and quantities are easy to verify.',
      ],
    },
  ],
};

export default tour;
