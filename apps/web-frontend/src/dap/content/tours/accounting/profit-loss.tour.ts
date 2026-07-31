import type { TourDefinition } from '../../schema.js';
import { PERMISSIONS } from '../../../../constants/permissions.js';

// Grounded against ProfitLossPage.tsx. Corrected: line items are not clickable — there is no
// drill-through to underlying transactions (confirmed no onClick anywhere on PLRow). Added:
// the real "By Cost Center" toggle, which only appears once at least one cost center exists.
const tour: TourDefinition = {
  id: 'accounting-profit-loss-overview',
  version: 1,
  type: 'quick',
  title: 'Profit & Loss — quick overview',
  description: 'Income and expenses over a period, ending in net profit or loss.',
  module: 'accounting',
  estimatedMinutes: 1,
  requiredPermissions: [PERMISSIONS.PROFIT_LOSS_VIEW],
  steps: [
    {
      id: 'intro',
      route: 'accounting/reports/profit-loss',
      title: 'Profit & Loss',
      body: 'Income and expenses over a From/To date range, ending in net profit or loss.',
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.PROFIT_LOSS_VIEW,
    },
    {
      id: 'date-range',
      route: 'accounting/reports/profit-loss',
      title: 'Select the date range',
      body: "Common ranges: this month, this quarter, this financial year. Defaults to your financial year's start through today.",
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.PROFIT_LOSS_VIEW,
    },
    {
      id: 'not-clickable',
      route: 'accounting/reports/profit-loss',
      title: 'Line items are static — no drill-through yet',
      body: "You can't click a line to see the transactions behind it; for that level of detail, open the specific account's Ledger instead.",
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.PROFIT_LOSS_VIEW,
    },
    {
      id: 'by-cost-center',
      route: 'accounting/reports/profit-loss',
      title: 'By Cost Center view',
      body: 'If your tenant has any active cost centers, a "By Cost Center" toggle appears, breaking Revenue/COGS/OpEx/Net Profit down per cost center — including an "Unassigned" bucket for untagged entries.',
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.PROFIT_LOSS_VIEW,
    },
  ],
};

export default tour;
