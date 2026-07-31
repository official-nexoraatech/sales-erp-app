import type { TourDefinition } from '../../schema.js';
import { PERMISSIONS } from '../../../../constants/permissions.js';

// Important reframe: the previous version called this "auto-drafted" — it is not. This app has
// no live connection to the government portal for 2A data; you download your GSTR-2A JSON from
// gst.gov.in yourself and upload it here. What IS real: a genuine ±1% tolerance reconciliation
// engine matching your upload against your own purchase-side gst_ledger entries. Grounded
// against Gstr2aPage.tsx / Gstr2aService.ts.
const tour: TourDefinition = {
  id: 'gst-gstr2a-overview',
  version: 1,
  type: 'quick',
  title: 'GSTR-2A — quick overview',
  description:
    'Upload your downloaded GSTR-2A data and reconcile it against your own purchase records.',
  module: 'gst',
  estimatedMinutes: 2,
  requiredPermissions: [PERMISSIONS.GSTR2A_RECONCILE],
  steps: [
    {
      id: 'intro',
      route: 'gst/gstr2a',
      title: 'GSTR-2A Reconciliation',
      body: "This isn't fetched automatically from the government — download your GSTR-2A JSON from the gst.gov.in portal first, then bring it here to reconcile against what you've recorded as purchases.",
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.GSTR2A_RECONCILE,
    },
    {
      id: 'import',
      route: 'gst/gstr2a',
      target: '[data-tour-id="gst-gstr2a-import-button"]',
      title: 'Import 2A (JSON)',
      body: 'Upload the JSON file for a period. Duplicate entries are automatically skipped and the import summary tells you how many were added vs. skipped.',
      placement: 'bottom',
      mode: 'informational',
      requiredPermission: PERMISSIONS.GSTR2A_RECONCILE,
    },
    {
      id: 'matching',
      route: 'gst/gstr2a',
      title: 'A real ±1% tolerance match',
      body: "Entries are matched by GSTIN and invoice number, with amounts allowed to differ by up to 1% and still count as Matched — small rounding differences won't create false mismatches.",
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.GSTR2A_RECONCILE,
    },
    {
      id: 'follow-up',
      route: 'gst/gstr2a',
      title: 'Act on each status',
      body: "Books Only means the supplier hasn't filed it yet — follow up with them. GSTR2A Only means it's on the government record but missing from your GRNs — check if one was skipped. Amount Mismatch means raise a debit note or correct the GRN.",
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.GSTR2A_RECONCILE,
    },
  ],
};

export default tour;
