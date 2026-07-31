import type { TourDefinition } from '../../schema.js';
import { PERMISSIONS } from '../../../../constants/permissions.js';

// Grounded against SegmentsPage.tsx / SegmentFormPage.tsx / SegmentService.ts. Corrected: "Open
// the segment to see matching customers" previously described a feature that didn't exist for
// custom segments — fixed this session by wiring a "View Customers" action to a real backend
// endpoint (GET /crm/segments/:id/customers) that existed but was unreachable from the UI.
const tour: TourDefinition = {
  id: 'crm-segments-overview',
  version: 1,
  type: 'quick',
  title: 'Customer Segments — quick overview',
  description:
    'Group customers by real, live criteria (spend, location, purchase history) for targeted campaigns.',
  module: 'crm',
  estimatedMinutes: 2,
  requiredPermissions: [PERMISSIONS.CRM_SEGMENT_VIEW],
  steps: [
    {
      id: 'intro',
      route: 'crm/segments',
      title: 'Customer Segments',
      body: 'Six ready-made segments (Gold Tier, High Value, Overdue 30+, etc.) plus any custom rule-based segments you build yourself.',
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.CRM_SEGMENT_VIEW,
    },
    {
      id: 'create',
      route: 'crm/segments',
      target: '[data-tour-id="crm-segments-create-button"]',
      title: 'Create a segment',
      body: "Pick real customer fields (spend, city, loyalty points, health score, days since last purchase, and more) and combine them with AND/OR. There's no preview before saving — double-check your rules before clicking Create.",
      placement: 'bottom',
      mode: 'informational',
      requiredPermission: PERMISSIONS.CRM_SEGMENT_VIEW,
    },
    {
      id: 'view-customers',
      route: 'crm/segments',
      target: '[data-tour-id="crm-segment-view-customers-button"]',
      title: 'View Customers',
      body: 'On any custom segment, View Customers shows who currently matches your rules — recalculated live, not a saved snapshot.',
      placement: 'bottom',
      mode: 'informational',
      requiredPermission: PERMISSIONS.CRM_SEGMENT_VIEW,
    },
    {
      id: 'live-not-static',
      route: 'crm/segments',
      title: 'Membership is always live',
      body: "A segment is a saved rule, not a saved list. If a customer makes a new purchase or opts out, that's reflected the next time anyone checks the segment or sends a campaign to it — no re-save needed.",
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.CRM_SEGMENT_VIEW,
    },
  ],
};

export default tour;
