import type { TourDefinition } from '../../schema.js';
import { PERMISSIONS } from '../../../../constants/permissions.js';

// Flagship multi-page workflow tour proving the redesigned engine (real spotlight targets,
// floating-ui positioning, interactive click-gating) works end-to-end across a list page, a
// create form, and a different module's list page — not just single-page "quick" tours. Real
// button/field targets and route/permission constants were read directly from
// InvoicesPage.tsx, InvoiceFormPage.tsx, and InvoiceDetailPage.tsx, not assumed — see
// ERP-PLANNING/DAP-Planning/00_CURRENT_STATE_ASSESSMENT.md §3 for why that matters here.
//
// The tour can't land on the just-created invoice's own detail page (`/sales/invoices/:id`,
// a dynamic id the engine has no way to know ahead of time — `TourStep.route` only supports
// static paths), so after the interactive "Save as Draft" step it follows the same pattern
// the existing purchase-to-dashboard tour uses: jump to a real, static page (Payments) and
// describe the next real steps (Confirm Invoice → Record Payment → Print/Download PDF, all
// real buttons on the invoice detail page) rather than fabricating a spotlight target that
// wouldn't exist on the page the tour is actually showing.
const tour: TourDefinition = {
  id: 'sales-invoice-workflow',
  version: 1,
  type: 'business-workflow',
  title: 'Sales → Invoice: from blank form to a paid, printed invoice',
  description:
    'Follow a sales invoice from the Invoices list through creation — selecting a customer, adding items, saving — to confirmation, payment, and printing.',
  module: 'cross-module',
  estimatedMinutes: 4,
  steps: [
    {
      id: 'intro',
      route: 'dashboard',
      title: 'Creating and collecting on an invoice',
      body: 'This tour follows one sales invoice from a blank form all the way to a recorded payment — the same sequence you’ll use for every real sale.',
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.DASHBOARD_VIEW,
    },
    {
      id: 'invoices-list',
      route: 'sales/invoices',
      target: '[data-tour-id="sales-invoices-create-button"]',
      title: 'Step 1 — Start a new invoice',
      body: '"+ New Invoice" opens a blank invoice form. Click it to continue.',
      placement: 'bottom',
      mode: 'informational',
      requiredPermission: PERMISSIONS.INVOICE_VIEW,
    },
    {
      id: 'select-customer',
      route: 'sales/invoices/new',
      target: '[data-tour-id="sales-invoice-new-customer-select"]',
      title: 'Step 2 — Select the customer',
      body: 'Type to search — the customer’s GST state also sets the invoice’s Place of Supply, which determines CGST/SGST vs IGST.',
      placement: 'bottom',
      mode: 'informational',
      requiredPermission: PERMISSIONS.INVOICE_CREATE,
    },
    {
      id: 'add-item',
      route: 'sales/invoices/new',
      target: '[data-tour-id="sales-invoice-new-item-search"]',
      title: 'Step 3 — Add line items',
      body: 'Search and click an item to add it as a line — quantity, price, discount, and GST rate are all editable per line once added.',
      placement: 'top',
      mode: 'informational',
      requiredPermission: PERMISSIONS.INVOICE_CREATE,
    },
    {
      id: 'save-invoice',
      route: 'sales/invoices/new',
      target: '[data-tour-id="sales-invoice-new-save-button"]',
      title: 'Step 4 — Save as Draft',
      body: '"Save as Draft" creates the invoice — a draft invoice doesn’t affect stock or accounts yet. Save it now if you\'re ready, or just click Next to continue the tour without saving.',
      placement: 'top',
      mode: 'informational',
      requiredPermission: PERMISSIONS.INVOICE_CREATE,
    },
    {
      id: 'confirm-and-pay',
      route: 'sales/payments',
      title: 'Step 5 — Confirm, then record payment',
      body: 'On the invoice\'s own detail page, "Confirm Invoice" makes it official — that\'s when it starts appearing in reports and can be paid against. Once confirmed, "Record Payment" on that same invoice opens this page pre-filled to log what the customer paid.',
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.PAYMENT_VIEW,
    },
    {
      id: 'print',
      route: 'sales/payments',
      title: 'Step 6 — Print or download',
      body: '"Print / Download PDF" on the invoice detail page generates the customer-facing invoice document at any point after it’s saved — draft or confirmed.',
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.PAYMENT_VIEW,
    },
    {
      id: 'reports',
      route: 'reports/sales-analytics',
      title: "That's the whole flow",
      body: 'Invoice → Confirm → Payment → Print. Every confirmed invoice — and every payment against it — feeds straight into Sales Analytics and AR Aging automatically, no extra step required.',
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.REPORT_VIEW,
    },
  ],
};

export default tour;
