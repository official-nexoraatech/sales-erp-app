import type { TourDefinition } from '../../schema.js';
import { PERMISSIONS } from '../../../../constants/permissions.js';

// Deep-dive companion to `gst-einvoice-overview`. Grounded against EInvoiceService.ts /
// EInvoicePage.tsx. This is the one page in the GST module confirmed to make a real outbound
// call to the government NIC IRP system (sandbox or production, based on configured
// credentials) — worth explaining precisely, in contrast to GSTR-1/3B/9's local-only exports.
const tour: TourDefinition = {
  id: 'gst-einvoice-complete-guide',
  version: 1,
  type: 'complete',
  title: 'e-Invoicing — complete guide',
  description:
    'How IRN generation actually triggers, what Retry does, and why cancellation happens outside this app.',
  module: 'gst',
  estimatedMinutes: 5,
  requiredPermissions: [PERMISSIONS.GST_VIEW],
  steps: [
    {
      id: 'purpose',
      route: 'gst/einvoice',
      title: 'Why this page exists',
      body: 'B2B invoices above the e-invoicing threshold need a government-issued IRN (Invoice Reference Number) to be legally valid. This page monitors that process and lets you retry a failed attempt.',
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.GST_VIEW,
    },
    {
      id: 'real-integration',
      route: 'gst/einvoice',
      title: 'A real government API call — not a simulation',
      body: "Unlike GSTR-1/3B/9's JSON exports (which you upload manually), IRN generation is a genuine outbound call to the government NIC e-Invoice portal, using your tenant's configured API credentials. If those credentials aren't set up, generation fails cleanly rather than faking a result.",
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.GST_VIEW,
    },
    {
      id: 'automatic-trigger',
      route: 'gst/einvoice',
      title: 'IRN generation triggers automatically',
      body: 'When a qualifying B2B invoice is confirmed, IRN generation is requested automatically — there is no manual "Generate" button anywhere in this app, on this page or the invoice itself.',
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.GST_VIEW,
    },
    {
      id: 'retry',
      route: 'gst/einvoice',
      target: '[data-tour-id="gst-einvoice-retry-button"]',
      title: 'Retry',
      body: 'Shown only for invoices in Failed or Pending IRN status. Re-submits the same invoice to the government system — useful after a transient network issue or once a data problem (like an invalid GSTIN) has been fixed.',
      placement: 'bottom',
      mode: 'informational',
      requiredPermission: PERMISSIONS.EINVOICE_GENERATE,
    },
    {
      id: 'lookup',
      route: 'gst/einvoice',
      target: '[data-tour-id="gst-einvoice-lookup-button"]',
      title: 'Status Lookup',
      body: 'Enter an Invoice ID to see its IRN, acknowledgement number, e-Way Bill link, and signed QR code — a read-only check for a single invoice, useful when a customer or auditor asks about one specific document.',
      placement: 'bottom',
      mode: 'informational',
      requiredPermission: PERMISSIONS.GST_VIEW,
    },
    {
      id: 'cancellation',
      route: 'gst/einvoice',
      title: 'Cancellation happens on the government portal',
      body: 'Per GST rules, an IRN can only be cancelled within 24 hours of generation — and that cancellation must be done directly on the government e-Invoice portal. There\'s no in-app cancel button; the page\'s own status legend explicitly says "Cancel via Portal."',
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.GST_VIEW,
    },
    {
      id: 'business-impact',
      route: 'gst/einvoice',
      title: 'What a successful IRN generation means',
      body: 'A legal requirement, not just a status label.',
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.GST_VIEW,
      calloutTitle: 'Business impact',
      calloutVariant: 'info',
      businessImpact: [
        "Without a valid IRN, a qualifying B2B invoice is not considered a valid tax invoice under GST law — this isn't optional paperwork.",
        "A failed IRN attempt doesn't block the invoice from existing in the system, but it does leave it non-compliant until retried successfully.",
        'The ₹5 Lakh threshold and ₹50K e-Way Bill trigger shown on this page are fixed display values, not editable tenant settings.',
      ],
    },
    {
      id: 'common-mistakes',
      route: 'gst/einvoice',
      title: 'Common mistakes',
      body: "Looking for buttons that don't exist is the most common one.",
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.GST_VIEW,
      calloutTitle: 'Common mistakes',
      calloutVariant: 'warning',
      businessImpact: [
        'Looking for a "Generate IRN" button on an invoice — it doesn\'t exist; generation only happens automatically on confirm.',
        'Trying to cancel an e-invoice from within this app — you must go to the government portal directly, and only within 24 hours.',
        'Ignoring a Failed status because the invoice still "looks fine" in the app — a failed IRN is a real compliance gap that needs a Retry or manual fix.',
      ],
    },
    {
      id: 'best-practices',
      route: 'gst/einvoice',
      title: 'Best practices',
      body: 'Check this page regularly if you issue many qualifying B2B invoices.',
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.GST_VIEW,
      calloutTitle: 'Best practices',
      calloutVariant: 'success',
      businessImpact: [
        'Review this list for Failed/Pending rows daily if e-invoicing volume is high — Retry promptly rather than letting a backlog build.',
        "If Retry keeps failing, check the customer's GSTIN and invoice details first — many NIC rejections trace back to bad master data.",
        "Cancel within the 24-hour window on the government portal if an e-invoiced sale is voided — after that window, you'll need a credit note instead.",
      ],
    },
  ],
};

export default tour;
