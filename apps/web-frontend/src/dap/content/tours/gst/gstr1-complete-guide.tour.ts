import type { TourDefinition } from '../../schema.js';
import { PERMISSIONS } from '../../../../constants/permissions.js';

// Deep-dive companion to `gst-gstr1-overview`. Grounded against Gstr1Service.ts / Gstr1Page.tsx.
// Notes the fixed B2CS/B2CL threshold bug (now correct, per an in-code comment) plus a real,
// current caveat: B2CL routing doesn't check interstate-vs-intrastate the way the actual GST
// rule requires — any B2C invoice over ₹2.5L goes to B2CL regardless of the customer's state.
const tour: TourDefinition = {
  id: 'gst-gstr1-complete-guide',
  version: 1,
  type: 'complete',
  title: 'GSTR-1 — complete guide',
  description:
    'How B2B/B2CS/B2CL/HSN sections are actually computed, what "Export" really does, and one classification nuance to double-check.',
  module: 'gst',
  estimatedMinutes: 6,
  requiredPermissions: [PERMISSIONS.GSTR1_VIEW],
  steps: [
    {
      id: 'purpose',
      route: 'gst/gstr1',
      title: 'Why this page exists',
      body: 'GSTR-1 is your monthly declaration of everything you sold, split into the categories the government return requires: B2B, B2CS (small B2C), B2CL (large B2C), credit notes, and an HSN summary.',
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.GSTR1_VIEW,
    },
    {
      id: 'computed-live',
      route: 'gst/gstr1',
      title: 'Computed fresh every time, not cached',
      body: "Every time you open this page or change the period, it re-reads your GST ledger and rebuilds every section from scratch — there's no stale-data risk from a cache, but it also means a very large period can take a moment.",
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.GSTR1_VIEW,
    },
    {
      id: 'b2cs-b2cl-split',
      route: 'gst/gstr1',
      title: 'The B2CS / B2CL split',
      body: "A B2C sale is B2CS (aggregated by state and rate) if it's ₹2.5 Lakh or less, and B2CL (listed per-invoice) if it's more. Worth knowing: the real GST rule restricts B2CL to interstate sales only — this app currently routes any B2C invoice over the threshold into B2CL regardless of whether it's interstate. Double-check large intrastate B2C sales land correctly.",
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.GSTR1_VIEW,
      calloutTitle: 'Common mistake',
      calloutVariant: 'warning',
    },
    {
      id: 'b2b-vs-b2c',
      route: 'gst/gstr1',
      title: 'What decides B2B vs B2C',
      body: "It's the customer's GSTIN, not their name or type — an invoice for a business customer with no GSTIN on file still counts as B2C. Fix it at the customer record, not on the invoice.",
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.GSTR1_VIEW,
    },
    {
      id: 'validation',
      route: 'gst/gstr1',
      title: 'Validation gates export',
      body: 'The "Ready to Export" banner is a real check, not decoration — Export stays disabled and the banner lists specific issues until they\'re resolved.',
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.GSTR1_VIEW,
    },
    {
      id: 'export',
      route: 'gst/gstr1',
      target: '[data-tour-id="gst-gstr1-export-button"]',
      title: 'Export JSON (NIC)',
      body: 'Downloads a JSON file formatted for the NIC/government portal, using the GSTIN you enter (now format-validated). This app does not upload it for you — the last step is always manual, on gst.gov.in.',
      placement: 'bottom',
      mode: 'informational',
      requiredPermission: PERMISSIONS.GSTR1_FILE,
    },
    {
      id: 'business-impact',
      route: 'gst/gstr1',
      title: 'What this page reads from and affects',
      body: "Purely a reporting view — it reads, it doesn't write.",
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.GSTR1_VIEW,
      calloutTitle: 'Business impact',
      calloutVariant: 'info',
      businessImpact: [
        'Reads live from the GST ledger, which is populated automatically when invoices are confirmed and sale returns/credit notes are approved.',
        "Exporting has no effect on your data — it's a snapshot download, not a state change.",
        "GSTR-9 (the annual return) separately re-derives its own numbers from the same ledger — it doesn't reuse this page's output directly.",
      ],
    },
    {
      id: 'best-practices',
      route: 'gst/gstr1',
      title: 'Best practices',
      body: 'Catch data issues before export, not after.',
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.GSTR1_VIEW,
      calloutTitle: 'Best practices',
      calloutVariant: 'success',
      businessImpact: [
        "Keep customer GSTIN fields accurate — it's the single biggest lever over B2B vs B2C classification.",
        'Cross-check large intrastate B2C invoices manually given the B2CL threshold nuance above.',
        "Review the B2CS/CDNR/HSN raw-JSON sections carefully before export — they're correct but harder to eyeball than B2B's formatted table.",
      ],
    },
  ],
};

export default tour;
