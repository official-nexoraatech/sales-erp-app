import type { TourDefinition } from '../../schema.js';
import { PERMISSIONS } from '../../../../constants/permissions.js';

// Major correction: the previous version described a manual "Generate IRN" button (open a
// confirmed invoice → Generate IRN) and a "Cancel an e-invoice" action — NEITHER EXISTS
// anywhere in the frontend. Grounded against EInvoicePage.tsx / EInvoiceService.ts: IRN
// generation is auto-triggered on B2B invoice confirmation, and the only manual write action on
// this page is Retry (for a failed/pending attempt). Cancellation must be done on the government
// portal directly — the page's own status legend says so. Unlike GSTR-1/3B/9's exports, this IS
// a real, live integration with the government NIC IRP system (sandbox or production, based on
// configured credentials) — worth being precise about, since it's the one part of this module
// that actually talks to a government API.
const tour: TourDefinition = {
  id: 'gst-einvoice-overview',
  version: 1,
  type: 'quick',
  title: 'e-Invoicing — quick overview',
  description:
    'Real-time IRN generation with the government e-Invoice system for B2B invoices above the threshold.',
  module: 'gst',
  estimatedMinutes: 2,
  requiredPermissions: [PERMISSIONS.GST_VIEW],
  steps: [
    {
      id: 'intro',
      route: 'gst/einvoice',
      title: 'e-Invoicing',
      body: "Unlike GSTR-1/3B/9's manual JSON exports, this genuinely connects to the government's NIC e-Invoice portal — a real API call, not a simulation.",
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.GST_VIEW,
    },
    {
      id: 'automatic',
      route: 'gst/einvoice',
      title: 'IRN generation is automatic, not a button you click',
      body: 'When a B2B invoice above the ₹5 Lakh threshold is confirmed, the IRN is requested automatically from the government system. There\'s no manual "Generate" action anywhere in the app — this page is for monitoring and looking up status, not triggering generation yourself.',
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.GST_VIEW,
    },
    {
      id: 'retry',
      route: 'gst/einvoice',
      title: 'Retry',
      body: "The one real write action here: if an invoice's IRN attempt shows Failed or Pending, Retry re-submits it to the government system.",
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.GST_VIEW,
    },
    {
      id: 'lookup',
      route: 'gst/einvoice',
      target: '[data-tour-id="gst-einvoice-lookup-button"]',
      title: 'Status Lookup',
      body: 'Enter an Invoice ID to check its IRN, acknowledgement number, e-Way Bill status, and signed QR — a read-only lookup for one invoice at a time.',
      placement: 'bottom',
      mode: 'informational',
      requiredPermission: PERMISSIONS.GST_VIEW,
    },
    {
      id: 'cancel-on-portal',
      route: 'gst/einvoice',
      title: 'Cancelling an e-invoice happens on the government portal',
      body: "There's no in-app cancel button. If an IRN needs to be cancelled (must be done within 24 hours per GST rules), that's done directly on the government e-Invoice portal, not from here.",
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.GST_VIEW,
    },
  ],
};

export default tour;
