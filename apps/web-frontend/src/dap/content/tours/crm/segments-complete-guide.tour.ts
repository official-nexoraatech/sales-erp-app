import type { TourDefinition } from '../../schema.js';
import { PERMISSIONS } from '../../../../constants/permissions.js';

// Deep-dive companion to `crm-segments-overview`. Grounded against SegmentService.ts /
// SegmentFormPage.tsx. Key finding: segments have no membership snapshot table at all —
// every read (Preview, View Customers, or a campaign about to send) re-runs the rule as live
// SQL against the real customers/invoices tables. This session also fixed the biggest real gap:
// custom segments previously had no way to see who matched after creation despite a working
// backend endpoint (GET /crm/segments/:id/customers) sitting unreachable — "View Customers" now
// wires it up.
const tour: TourDefinition = {
  id: 'crm-segments-complete-guide',
  version: 1,
  type: 'complete',
  title: 'Customer Segments — complete guide',
  description:
    'How segment rules actually compute membership, what fields are available, and the real limitations to know about.',
  module: 'crm',
  estimatedMinutes: 6,
  requiredPermissions: [PERMISSIONS.CRM_SEGMENT_VIEW],
  steps: [
    {
      id: 'purpose',
      route: 'crm/segments',
      title: 'Why this page exists',
      body: 'A segment is a reusable, named group of customers — built once, then targeted by any number of campaigns without redefining the audience each time.',
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.CRM_SEGMENT_VIEW,
    },
    {
      id: 'prebuilt',
      route: 'crm/segments',
      title: 'Six ready-made segments',
      body: 'No-Purchase-60-Days, Gold Tier, High Value, Overdue 30+, Birthdays This Month, New This Month — genuinely computed, not hardcoded lists.',
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.CRM_SEGMENT_VIEW,
    },
    {
      id: 'rule-builder',
      route: 'crm/segments/new',
      title: 'Building a custom segment',
      body: 'Around 20 real customer fields are available — spend/loyalty metrics, health score, location, computed fields like order count and days since last purchase — combined with AND/OR logic. This maps to a genuine SQL filter on the backend, not a cosmetic form.',
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.CRM_SEGMENT_CREATE,
    },
    {
      id: 'no-preview-before-save',
      route: 'crm/segments/new',
      title: 'No preview before you save',
      body: 'Unlike the prebuilt segments\' Preview button, a custom segment you\'re building has no "how many customers would this match" check before you click Create. Values are free text too — a numeric field like Credit Limit accepts any text, and a mismatch only surfaces as a generic error after you submit. Double-check your rules carefully.',
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.CRM_SEGMENT_CREATE,
      calloutTitle: 'Common mistake',
      calloutVariant: 'warning',
    },
    {
      id: 'view-customers',
      route: 'crm/segments',
      target: '[data-tour-id="crm-segment-view-customers-button"]',
      title: 'View Customers',
      body: 'On any custom segment: shows exactly who matches right now. This queries live — the same rule, re-evaluated on demand — so it always reflects current data, never a stale snapshot from when the segment was created.',
      placement: 'bottom',
      mode: 'informational',
      requiredPermission: PERMISSIONS.CRM_SEGMENT_VIEW,
    },
    {
      id: 'export',
      route: 'crm/segments',
      title: 'Export CSV',
      body: 'Downloads the current matching list for either a prebuilt or custom segment — useful for a one-off list outside the app.',
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.CRM_SEGMENT_VIEW,
    },
    {
      id: 'business-impact',
      route: 'crm/segments',
      title: 'How this connects to campaigns',
      body: 'The live-computation model is what makes campaign targeting accurate.',
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.CRM_SEGMENT_VIEW,
      calloutTitle: 'Business impact',
      calloutVariant: 'info',
      businessImpact: [
        "When a campaign sends, it re-resolves the segment's rule against live data at that exact moment — not a snapshot from when you built the segment or the campaign.",
        'A customer who opts out, or makes a new purchase, between segment creation and campaign send is automatically reflected — no manual re-save required.',
        'There is no segment "member count" stored anywhere — every count you see (Preview, View Customers, a campaign\'s recipient estimate) is computed fresh, on demand.',
      ],
    },
    {
      id: 'best-practices',
      route: 'crm/segments',
      title: 'Best practices',
      body: 'Validate before you build a campaign around a segment.',
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.CRM_SEGMENT_VIEW,
      calloutTitle: 'Best practices',
      calloutVariant: 'success',
      businessImpact: [
        "After creating a custom segment, immediately use View Customers to sanity-check it matches who you intended — there's no earlier preview step to catch a mistake.",
        "Keep rule values in the correct format (numbers as numbers, dates as dates) even though the field won't stop you from typing anything.",
        'Re-check View Customers right before sending a campaign to a segment you built a while ago — membership may have shifted since you last looked.',
      ],
    },
  ],
};

export default tour;
