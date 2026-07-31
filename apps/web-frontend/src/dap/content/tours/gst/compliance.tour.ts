import type { TourDefinition } from '../../schema.js';
import { PERMISSIONS } from '../../../../constants/permissions.js';

// Major correction: the previous version's own code comment claimed this page was "read-only...
// not an action page" — that was wrong. It has a real, permission-gated "Mark Filed" action with
// a confirmation modal (MarkFiledModal), the only place in the whole GST module that records a
// return as actually filed. Grounded against GstCompliancePage.tsx / GstReturnTrackerService.ts.
const tour: TourDefinition = {
  id: 'gst-compliance-overview',
  version: 1,
  type: 'quick',
  title: 'GST Compliance Dashboard — quick overview',
  description: 'Live filing calendar and due-date tracking — with a real "Mark Filed" action.',
  module: 'gst',
  estimatedMinutes: 2,
  requiredPermissions: [PERMISSIONS.GST_VIEW],
  steps: [
    {
      id: 'intro',
      route: 'gst/compliance',
      title: 'GST Compliance Dashboard',
      body: 'A live, data-driven filing calendar — due dates are computed from real rules (GSTR-1 on the 11th, GSTR-3B on the 20th of the following month), not a static list.',
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.GST_VIEW,
    },
    {
      id: 'fy-field',
      route: 'gst/compliance',
      title: 'Financial year is free text',
      body: 'Type it as e.g. "2025-26" — there\'s no dropdown, same as the GSTR-9 page.',
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.GST_VIEW,
    },
    {
      id: 'mark-filed',
      route: 'gst/compliance',
      target: '[data-tour-id="gst-compliance-mark-filed-button"]',
      title: 'Mark Filed',
      body: "A real action: once you've actually filed a return on the government portal, record it here with an optional ARN/acknowledgement reference. This is the only place in the GST module that records a return's status as genuinely Filed — it doesn't submit anything to the government itself, it just tracks that you did.",
      placement: 'bottom',
      mode: 'informational',
      requiredPermission: PERMISSIONS.GST_VIEW,
    },
    {
      id: 'eway-bill-alert',
      route: 'gst/compliance',
      title: 'e-Way Bill expiry alert',
      body: "Also flags any e-Way Bill expiring within 24 hours — a real, live check, though it doesn't link back to the originating invoice.",
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.GST_VIEW,
    },
  ],
};

export default tour;
