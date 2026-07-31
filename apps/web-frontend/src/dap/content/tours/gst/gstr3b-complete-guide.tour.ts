import type { TourDefinition } from '../../schema.js';
import { PERMISSIONS } from '../../../../constants/permissions.js';

// Deep-dive companion to `gst-gstr3b-overview`. Grounded against Gstr3bService.ts /
// GstLedgerService.ts / GstReturnTrackerService.ts. This is the page whose "Net ITC" figure is
// directly affected by the confirmed Purchase-Return-zero and RCM-ledger-zero bugs found this
// session — the guide states both plainly, since accountants will rely on this number.
const tour: TourDefinition = {
  id: 'gst-gstr3b-complete-guide',
  version: 1,
  type: 'complete',
  title: 'GSTR-3B — complete guide',
  description:
    'How Net ITC and cash-required are really computed, two known figures to double-check, and where "Filed" actually gets recorded.',
  module: 'gst',
  estimatedMinutes: 6,
  requiredPermissions: [PERMISSIONS.GSTR3B_VIEW],
  steps: [
    {
      id: 'purpose',
      route: 'gst/gstr3b',
      title: 'Why this page exists',
      body: 'GSTR-3B is the monthly summary return: total tax you owe on sales, total input tax credit you can claim, and the net cash you actually need to pay.',
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.GSTR3B_VIEW,
    },
    {
      id: 'table31',
      route: 'gst/gstr3b',
      title: 'Table 3.1 — Outward Taxable Supplies',
      body: 'Your sales for the period, minus any credit notes issued — computed live from the GST ledger.',
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.GSTR3B_VIEW,
    },
    {
      id: 'table4',
      route: 'gst/gstr3b',
      title: 'Table 4 — Eligible ITC',
      body: "Net ITC is meant to be purchases minus purchase returns, per CGST/SGST/IGST. Right now, purchase-return entries carry zero tax value due to a known payload gap, so approving a purchase return doesn't actually reduce this figure yet — verify manually if you've had returns this period.",
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.GSTR3B_VIEW,
      calloutTitle: 'Common mistake',
      calloutVariant: 'warning',
    },
    {
      id: 'rcm-caveat',
      route: 'gst/gstr3b',
      title: 'RCM figures can also read zero',
      body: 'If you have unregistered-supplier (reverse-charge) purchases, the same payload-gap class of bug means the RCM tax figures on this page can show zero even though the liability was booked correctly in your General Ledger. Cross-check the journal directly if you deal with RCM regularly.',
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.GSTR3B_VIEW,
      calloutTitle: 'Common mistake',
      calloutVariant: 'warning',
    },
    {
      id: 'itc-setoff',
      route: 'gst/gstr3b',
      title: 'ITC Set-off Computation',
      body: 'A genuinely correct panel — it applies the legally required set-off order (IGST credit used first, then split across CGST/SGST) and ends in a Total Cash Required figure. This is the real number to pay, not a naive subtraction.',
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.GSTR3B_VIEW,
    },
    {
      id: 'export-vs-file',
      route: 'gst/gstr3b',
      target: '[data-tour-id="gst-gstr3b-export-button"]',
      title: 'Export is not the same as Filing',
      body: "This button downloads a JSON snapshot for your own cross-checking or manual portal filing — it does not submit anything to the government, and it doesn't record this period as filed anywhere in the app. For that, use Mark Filed on the GST Compliance page after you've actually filed on the government portal.",
      placement: 'bottom',
      mode: 'informational',
      requiredPermission: PERMISSIONS.GSTR3B_FILE,
    },
    {
      id: 'business-impact',
      route: 'gst/gstr3b',
      title: 'What this number depends on',
      body: "Entirely a live read from other modules' activity.",
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.GSTR3B_VIEW,
      calloutTitle: 'Business impact',
      calloutVariant: 'info',
      businessImpact: [
        'Outward tax comes from confirmed invoices and approved sale returns/credit notes.',
        'ITC comes from approved GRNs — minus purchase returns, though that subtraction is currently a no-op (see above).',
        'Filing this period is tracked separately, on the GST Compliance page, once you actually file with the government.',
      ],
    },
    {
      id: 'best-practices',
      route: 'gst/gstr3b',
      title: 'Best practices',
      body: 'Treat this as a starting point, not a final number, while the known gaps stand.',
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.GSTR3B_VIEW,
      calloutTitle: 'Best practices',
      calloutVariant: 'success',
      businessImpact: [
        "If you've processed any purchase returns or RCM purchases this period, manually verify their tax impact rather than trusting Net ITC at face value.",
        "Use the ITC Set-off panel's Total Cash Required as your actual payment figure — it's the legally correct computation.",
        "Mark Filed on the Compliance page as soon as you've actually filed, so your compliance calendar and GSTR-9 both stay accurate.",
      ],
    },
  ],
};

export default tour;
