import type { TourDefinition } from '../../schema.js';
import { PERMISSIONS } from '../../../../constants/permissions.js';

// Grounded against Gstr3bPage.tsx / Gstr3bService.ts. Corrected the oversimplified
// "Net tax = 3.1 total − 4A total" claim — real computation includes a proper ITC Set-off
// Computation panel following GST Act §49 ordering, with an explicit Total Cash Required figure.
// Also flags the known Purchase-Return-zeroing bug, since it directly affects this page's Net
// ITC number, and clarifies "Export" is a JSON download, not a live filing action.
const tour: TourDefinition = {
  id: 'gst-gstr3b-overview',
  version: 1,
  type: 'quick',
  title: 'GSTR-3B — quick overview',
  description: 'Monthly summary return — shows net tax payable after ITC. Due 20th of next month.',
  module: 'gst',
  estimatedMinutes: 2,
  requiredPermissions: [PERMISSIONS.GSTR3B_VIEW],
  steps: [
    {
      id: 'intro',
      route: 'gst/gstr3b',
      title: 'GSTR-3B (Summary Return)',
      body: 'Monthly summary return — shows net tax payable after ITC. Due 20th of next month.',
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.GSTR3B_VIEW,
    },
    {
      id: 'review',
      route: 'gst/gstr3b',
      title: 'Review tax liability',
      body: 'Section 3.1 shows your outward tax (sales minus credit notes). Section 4 shows eligible ITC from purchases.',
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.GSTR3B_VIEW,
    },
    {
      id: 'itc-setoff',
      route: 'gst/gstr3b',
      title: 'ITC Set-off Computation',
      body: "A real panel following the legally-required set-off order (IGST credit first, then CGST, then SGST) — ending in a Total Cash Required figure. This is the actual amount you'll need to pay, not a simple subtraction.",
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.GSTR3B_VIEW,
    },
    {
      id: 'itc-caveat',
      route: 'gst/gstr3b',
      title: "Net ITC doesn't yet reflect purchase returns",
      body: "Net ITC is supposed to be purchases minus purchase returns — but a known payload gap means purchase-return entries currently carry zero tax value, so a return doesn't actually reduce this figure yet. Double-check manually if you've processed purchase returns this period.",
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.GSTR3B_VIEW,
      calloutTitle: 'Common mistake',
      calloutVariant: 'warning',
    },
    {
      id: 'export',
      route: 'gst/gstr3b',
      target: '[data-tour-id="gst-gstr3b-export-button"]',
      title: 'Export JSON',
      body: 'Downloads the return data as JSON — cross-check the figures, then file and pay on the GST portal yourself. This button does not file anything with the government.',
      placement: 'bottom',
      mode: 'informational',
      requiredPermission: PERMISSIONS.GSTR3B_VIEW,
    },
  ],
};

export default tour;
