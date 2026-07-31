import type { TourDefinition } from '../../schema.js';
import { PERMISSIONS } from '../../../../constants/permissions.js';

// Grounded against BalanceSheetPage.tsx. Corrected: there is no period-comparison toggle
// (confirmed no compare/toggle logic in the page) — removed that fictional step. Added a real,
// code-documented caveat: an unclosed financial year can make the sheet look permanently
// unbalanced for a tenant with real activity, because Current Year Earnings is computed live
// from an open year's P&L rather than being a fixed number.
const tour: TourDefinition = {
  id: 'accounting-balance-sheet-overview',
  version: 1,
  type: 'quick',
  title: 'Balance Sheet — quick overview',
  description: 'Assets, liabilities, and equity as of a specific date.',
  module: 'accounting',
  estimatedMinutes: 1,
  requiredPermissions: [PERMISSIONS.BALANCE_SHEET_VIEW],
  steps: [
    {
      id: 'intro',
      route: 'accounting/reports/balance-sheet',
      title: 'Balance Sheet',
      body: 'Assets, liabilities, and equity as of a specific date — Assets should always equal Liabilities plus Equity.',
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.BALANCE_SHEET_VIEW,
    },
    {
      id: 'as-of-date',
      route: 'accounting/reports/balance-sheet',
      title: 'Select the as-of date',
      body: "Usually the last day of a month, quarter, or year. There's no separate comparison view — pick a second date and revisit if you need to compare periods.",
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.BALANCE_SHEET_VIEW,
    },
    {
      id: 'current-year-earnings',
      route: 'accounting/reports/balance-sheet',
      title: 'Current Year Earnings is computed live',
      body: "The equity section includes a live Current Year Earnings figure, calculated from your open financial year's profit and loss so far. If your financial year was never created or closed properly, this can make the sheet look unbalanced even when nothing is actually wrong — check Financial Years first.",
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.BALANCE_SHEET_VIEW,
    },
  ],
};

export default tour;
