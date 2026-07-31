import type { TourDefinition } from '../../schema.js';
import { PERMISSIONS } from '../../../../constants/permissions.js';

// Grounded against GSTR9Page.tsx / GSTR9Engine.ts. Added: the year field is free-text
// (e.g. "2025-26"), not a picker — same inconsistency as Compliance's FY field. Added: the page
// has an honest, real incompleteness disclosure (table9Complete) worth calling out since it's a
// genuinely good pattern, not something to gloss over as "just works."
const tour: TourDefinition = {
  id: 'gst-gstr9-overview',
  version: 1,
  type: 'quick',
  title: 'GSTR-9 — quick overview',
  description: 'Yearly consolidation of GST activity for a financial year.',
  module: 'gst',
  estimatedMinutes: 2,
  requiredPermissions: [PERMISSIONS.GSTR9_VIEW],
  steps: [
    {
      id: 'intro',
      route: 'gst/gstr9',
      title: 'GSTR-9 (Annual Return)',
      body: "Recomputes a full financial year's GST activity directly from the ledger — it doesn't just add up your filed GSTR-1/3B numbers, it re-derives them independently.",
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.GSTR9_VIEW,
    },
    {
      id: 'year-field',
      route: 'gst/gstr9',
      title: 'Type the financial year',
      body: 'This is a free-text field, not a dropdown — enter it as e.g. "2025-26". A typo here (like "2025-2026") won\'t be caught until the data doesn\'t load.',
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.GSTR9_VIEW,
    },
    {
      id: 'readiness-check',
      route: 'gst/gstr9',
      title: 'A real readiness check, not just a label',
      body: 'The page cross-checks against your GST Compliance Calendar and tells you exactly how many monthly periods are still unfiled — and separately warns if the tax-paid table (Table 9) is incomplete because some periods were never marked Filed.',
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.GSTR9_VIEW,
    },
    {
      id: 'export',
      route: 'gst/gstr9',
      target: '[data-tour-id="gst-gstr9-export-button"]',
      title: 'Download JSON',
      body: "Downloads the annual data for manual filing — same as GSTR-1/3B, this doesn't submit anything to the government on its own.",
      placement: 'bottom',
      mode: 'informational',
      requiredPermission: PERMISSIONS.GSTR9_VIEW,
    },
  ],
};

export default tour;
