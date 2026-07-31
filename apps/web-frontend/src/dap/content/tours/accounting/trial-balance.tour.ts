import type { TourDefinition } from '../../schema.js';
import { PERMISSIONS } from '../../../../constants/permissions.js';

// Grounded against TrialBalancePage.tsx. Corrected: there is no financial-year selector or
// date range — just a single "As of" date, point-in-time. Also notes: Trial Balance is
// verified column-correct in both the Accounting module's own report and the cross-module
// Reports Hub's equivalent — safe to trust either.
const tour: TourDefinition = {
  id: 'accounting-trial-balance-overview',
  version: 1,
  type: 'quick',
  title: 'Trial Balance — quick overview',
  description: "Every account's debit and credit total for a period — must always balance.",
  module: 'accounting',
  estimatedMinutes: 1,
  requiredPermissions: [PERMISSIONS.TRIAL_BALANCE_VIEW],
  steps: [
    {
      id: 'intro',
      route: 'accounting/reports/trial-balance',
      title: 'Trial Balance',
      body: "Every account's debit and credit total, as of a single date — this is the first check for whether your books are internally consistent.",
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.TRIAL_BALANCE_VIEW,
    },
    {
      id: 'select-date',
      route: 'accounting/reports/trial-balance',
      title: 'Pick a single "As of" date',
      body: "There's no financial-year selector or from/to range here — just one date. It shows the cumulative position up to and including that day.",
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.TRIAL_BALANCE_VIEW,
    },
    {
      id: 'imbalance',
      route: 'accounting/reports/trial-balance',
      title: 'Investigate an imbalance',
      body: 'If debits ≠ credits, the banner shows the exact difference — this points to a posting error and is worth investigating immediately rather than ignoring.',
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.TRIAL_BALANCE_VIEW,
    },
  ],
};

export default tour;
