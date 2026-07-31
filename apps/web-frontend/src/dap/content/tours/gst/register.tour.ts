import type { TourDefinition } from '../../schema.js';
import { PERMISSIONS } from '../../../../constants/permissions.js';

// New tour — this page (gst/register) previously had zero coverage despite being a real,
// filterable, exportable GST ledger. Grounded against GstRegisterPage.tsx / GstLedgerService.ts.
const tour: TourDefinition = {
  id: 'gst-register-overview',
  version: 1,
  type: 'quick',
  title: 'GST Register — quick overview',
  description:
    'An append-only log of every GST-relevant entry, sourced from your sales and purchase activity.',
  module: 'gst',
  estimatedMinutes: 2,
  requiredPermissions: [PERMISSIONS.GST_VIEW],
  steps: [
    {
      id: 'intro',
      route: 'gst/register',
      title: 'GST Ledger Register',
      body: 'A raw, append-only log of every GST entry — sales, purchases, credit notes, purchase returns — written automatically as those transactions happen elsewhere in the app.',
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.GST_VIEW,
    },
    {
      id: 'filters',
      route: 'gst/register',
      title: 'Period and Type filters',
      body: "Pick a month, and narrow by All / Sales Only / Purchase Only. There's no separate filter for returns or RCM entries yet, even though the summary cards below break those out.",
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.GST_VIEW,
    },
    {
      id: 'no-drill-down',
      route: 'gst/register',
      title: 'No drill-down to the source document',
      body: "Each row shows a document number, but it's not clickable — you can't jump from here to the actual invoice, GRN, or return.",
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.GST_VIEW,
    },
    {
      id: 'export',
      route: 'gst/register',
      target: '[data-tour-id="gst-register-export-button"]',
      title: 'Export CSV',
      body: "Downloads exactly what's currently on screen for the selected period and type — useful for your own records or handing to an accountant.",
      placement: 'bottom',
      mode: 'informational',
      requiredPermission: PERMISSIONS.GST_VIEW,
    },
  ],
};

export default tour;
