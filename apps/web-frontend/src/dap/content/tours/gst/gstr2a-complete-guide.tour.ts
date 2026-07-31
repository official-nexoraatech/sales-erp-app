import type { TourDefinition } from '../../schema.js';
import { PERMISSIONS } from '../../../../constants/permissions.js';

// Deep-dive companion to `gst-gstr2a-overview`. Grounded against Gstr2aService.ts. The whole
// point of this guide is to correct the framing implied by the page's name: this is manual
// import + real reconciliation against your own books, not a live government sync.
const tour: TourDefinition = {
  id: 'gst-gstr2a-complete-guide',
  version: 1,
  type: 'complete',
  title: 'GSTR-2A Reconciliation — complete guide',
  description:
    "Why this isn't a live government feed, how the ±1% match actually works, and what each status means.",
  module: 'gst',
  estimatedMinutes: 5,
  requiredPermissions: [PERMISSIONS.GSTR2A_RECONCILE],
  steps: [
    {
      id: 'purpose',
      route: 'gst/gstr2a',
      title: 'Why this page exists',
      body: "GSTR-2A is the government's record of what your suppliers say they sold you. Comparing it against your own purchase records catches missed GRNs, unfiled supplier invoices, and amount mismatches before they become an ITC problem.",
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.GSTR2A_RECONCILE,
    },
    {
      id: 'not-live',
      route: 'gst/gstr2a',
      title: 'This is not a live government feed',
      body: "There's no automatic sync with gst.gov.in. You download your GSTR-2A JSON from the government portal yourself, then upload it here — the app reconciles it against your own books, it doesn't fetch it for you.",
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.GSTR2A_RECONCILE,
    },
    {
      id: 'import',
      route: 'gst/gstr2a',
      target: '[data-tour-id="gst-gstr2a-import-button"]',
      title: 'Import 2A (JSON)',
      body: "Upload the downloaded file for a period. It accepts either a bare array or a wrapped { data: [...] } shape. Duplicates against a prior import for the same period are automatically skipped, and you'll see counts of both imported and skipped rows.",
      placement: 'bottom',
      mode: 'informational',
      requiredPermission: PERMISSIONS.GSTR2A_RECONCILE,
    },
    {
      id: 'matching-rule',
      route: 'gst/gstr2a',
      title: 'The matching rule',
      body: 'Entries are matched by GSTIN and invoice number, with a ±1% tolerance on the GST amount — small rounding differences count as Matched, not Mismatch.',
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.GSTR2A_RECONCILE,
    },
    {
      id: 'statuses',
      route: 'gst/gstr2a',
      title: 'What each status means',
      body: "Matched: both sides agree. Books Only: it's in your purchase register but the supplier hasn't reported it — nothing to fix on your end, but ITC on it is at risk until they file. GSTR2A Only: the government has it, you don't — check for a missed GRN. Amount Mismatch: raise a debit note or correct the GRN.",
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.GSTR2A_RECONCILE,
    },
    {
      id: 'no-drill-down',
      route: 'gst/gstr2a',
      title: 'No drill-down to the source GRN',
      body: "The entry lists don't link back to the originating GRN or purchase record — you'll need to search for it separately by supplier/invoice number if you need to investigate further.",
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.GSTR2A_RECONCILE,
    },
    {
      id: 'business-impact',
      route: 'gst/gstr2a',
      title: 'Business impact',
      body: "This reconciliation is advisory — it flags issues, it doesn't change any figures.",
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.GSTR2A_RECONCILE,
      calloutTitle: 'Business impact',
      calloutVariant: 'info',
      businessImpact: [
        "Importing and reconciling never changes your GST ledger or ITC figures — it's a comparison tool only.",
        'A "Books Only" entry is a real early-warning sign: that ITC could be disallowed if the supplier never files it.',
        "Unlike the government's real GSTR-2A, this reconciliation is only as current as your last manual upload.",
      ],
    },
    {
      id: 'best-practices',
      route: 'gst/gstr2a',
      title: 'Best practices',
      body: 'Make this a monthly habit, not a year-end scramble.',
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.GSTR2A_RECONCILE,
      calloutTitle: 'Best practices',
      calloutVariant: 'success',
      businessImpact: [
        "Import and reconcile monthly, right after downloading 2A from the portal — mismatches are easier to chase down while they're recent.",
        'Follow up on "Books Only" entries promptly; a supplier who hasn\'t filed can usually still be nudged before their own deadline.',
        'Keep a note of which invoice numbers you\'ve investigated, since there\'s no in-app way to mark an entry as "followed up."',
      ],
    },
  ],
};

export default tour;
