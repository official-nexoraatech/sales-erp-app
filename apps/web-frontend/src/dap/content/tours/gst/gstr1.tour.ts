import type { TourDefinition } from '../../schema.js';
import { PERMISSIONS } from '../../../../constants/permissions.js';

// Grounded against Gstr1Page.tsx / Gstr1Service.ts. Added: GSTIN field now validates format
// (fixed same session — was free text). Added: B2CS/CDNR/HSN sections render as raw JSON, not
// formatted tables like B2B gets — a real, current UI limitation worth setting expectations for.
// Kept accurate: "Export → download JSON → upload on gst.gov.in" — confirmed no live NIC API
// call exists for GSTR-1 itself (unlike e-Invoice, which is a real IRP integration).
const tour: TourDefinition = {
  id: 'gst-gstr1-overview',
  version: 1,
  type: 'quick',
  title: 'GSTR-1 — quick overview',
  description: 'Monthly GST return for all outward supplies — due 11th of next month.',
  module: 'gst',
  estimatedMinutes: 2,
  requiredPermissions: [PERMISSIONS.GSTR1_VIEW],
  steps: [
    {
      id: 'intro',
      route: 'gst/gstr1',
      title: 'GSTR-1 (Sales Return)',
      body: "Monthly GST return for all outward supplies — due 11th of next month. Defaults to last month's period, since that's usually the one due.",
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.GSTR1_VIEW,
    },
    {
      id: 'validation',
      route: 'gst/gstr1',
      title: 'The Ready to Export banner is a real gate',
      body: 'Export stays disabled until validation passes — the banner lists specific issues (like invoices missing required data) you need to fix first, not just a suggestion.',
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.GSTR1_VIEW,
    },
    {
      id: 'json-sections',
      route: 'gst/gstr1',
      title: 'B2CS, CDNR, and HSN show as raw data',
      body: 'The B2B section renders as a proper table, but B2CS, CDNR, and HSN currently display as raw JSON — harder to read, but the underlying figures are real and included in the export.',
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.GSTR1_VIEW,
    },
    {
      id: 'export',
      route: 'gst/gstr1',
      target: '[data-tour-id="gst-gstr1-export-button"]',
      title: 'Export GSTR-1',
      body: "Enter your GSTIN (now format-checked) → Export JSON (NIC) → download → upload manually on the gst.gov.in portal. This app doesn't file it for you — export is the last step here.",
      placement: 'bottom',
      mode: 'informational',
      requiredPermission: PERMISSIONS.GSTR1_VIEW,
    },
    {
      id: 'gstin-check',
      route: 'gst/gstr1',
      title: "B2B vs B2C depends on the customer's GSTIN",
      body: 'An invoice with no GSTIN on the customer record automatically counts as B2C, not B2B — if a business customer is showing up in the wrong section, check their master record.',
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.GSTR1_VIEW,
    },
  ],
};

export default tour;
