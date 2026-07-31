import type { TourDefinition } from '../../schema.js';
import { PERMISSIONS } from '../../../../constants/permissions.js';

// Deep-dive companion to `gst-compliance-overview`. Grounded against
// GstReturnTrackerService.ts / GstCompliancePage.tsx / EwayBillService.ts. Corrects the previous
// version's own inaccurate self-description ("read-only... not an action page") — Mark Filed is
// a real, consequential action and deserves full treatment here.
const tour: TourDefinition = {
  id: 'gst-compliance-complete-guide',
  version: 1,
  type: 'complete',
  title: 'GST Compliance Dashboard — complete guide',
  description:
    'How due dates are computed, what Mark Filed really records, and why it matters for GSTR-9.',
  module: 'gst',
  estimatedMinutes: 5,
  requiredPermissions: [PERMISSIONS.GST_VIEW],
  steps: [
    {
      id: 'purpose',
      route: 'gst/compliance',
      title: 'Why this page exists',
      body: 'A single dashboard tracking every GSTR-1 and GSTR-3B period for a financial year — due, filed, overdue — plus e-Way Bills about to expire.',
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.GST_VIEW,
    },
    {
      id: 'real-due-dates',
      route: 'gst/compliance',
      title: 'Due dates are real rules, not a static list',
      body: "GSTR-1 is due the 11th of the following month, GSTR-3B the 20th, GSTR-9 December 31st of the following financial year — computed and compared against today's date live, including exactly how many days overdue a period is.",
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.GST_VIEW,
    },
    {
      id: 'fy-field',
      route: 'gst/compliance',
      title: 'Financial year is typed, not picked',
      body: 'Enter it as e.g. "2025-26" in the free-text field — there\'s no calendar/dropdown here, same pattern as GSTR-9.',
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.GST_VIEW,
    },
    {
      id: 'mark-filed',
      route: 'gst/compliance',
      target: '[data-tour-id="gst-compliance-mark-filed-button"]',
      title: 'Mark Filed',
      body: "The only place in the whole GST module that records a period as genuinely filed. Enter an optional ARN/acknowledgement reference and confirm — this is bookkeeping, not a government submission. Do this only after you've actually filed on the portal.",
      placement: 'bottom',
      mode: 'informational',
      requiredPermission: PERMISSIONS.GST_FILE,
    },
    {
      id: 'why-it-matters-for-gstr9',
      route: 'gst/compliance',
      title: 'This status feeds GSTR-9',
      body: "GSTR-9 (the annual return) reads exactly which periods you've marked Filed here to decide how complete its own Table 9 (tax actually paid) is — if you skip Mark Filed, GSTR-9 will honestly report those periods as unfiled, even if you really did file them elsewhere.",
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.GST_VIEW,
      calloutTitle: 'Business impact',
      calloutVariant: 'info',
    },
    {
      id: 'eway-bill-alert',
      route: 'gst/compliance',
      title: 'e-Way Bill expiry alert',
      body: 'A separate, live check for e-Way Bills expiring within 24 hours. It shows the raw e-Way Bill number with no link to the originating invoice, so you may need to search for it separately.',
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.GST_VIEW,
    },
    {
      id: 'common-mistakes',
      route: 'gst/compliance',
      title: 'Common mistakes',
      body: 'Skipping this page after filing is the biggest one.',
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.GST_VIEW,
      calloutTitle: 'Common mistakes',
      calloutVariant: 'warning',
      businessImpact: [
        'Filing a return on the government portal but forgetting to Mark Filed here — your compliance calendar and GSTR-9 will both show it as still pending.',
        'Typing the financial year in the wrong format (e.g. "2025-2026" instead of "2025-26") and getting no data with no clear error.',
        "Assuming the e-Way Bill alert links to the invoice — it doesn't; note the number and search separately.",
      ],
    },
    {
      id: 'best-practices',
      route: 'gst/compliance',
      title: 'Best practices',
      body: 'Make Mark Filed part of your filing routine, not an afterthought.',
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.GST_VIEW,
      calloutTitle: 'Best practices',
      calloutVariant: 'success',
      businessImpact: [
        'Mark Filed immediately after you file on the government portal, with the real ARN — future-you will want that reference.',
        'Check this dashboard weekly as due dates approach, not just on the day something is due.',
        'Review the e-Way Bill expiry list daily if you regularly ship goods — a lapsed e-Way Bill has real compliance consequences.',
      ],
    },
  ],
};

export default tour;
