import type { TourDefinition } from '../../schema.js';
import { PERMISSIONS } from '../../../../constants/permissions.js';

// New tour — this page previously had zero coverage. Grounded against LedgerPage.tsx. Route is
// dynamic (`accounting/accounts/:id/ledger`), reached only via "View Ledger" from an account row
// in the Chart of Accounts, not from a standalone nav link — the intro step says so.
const tour: TourDefinition = {
  id: 'accounting-ledger-overview',
  version: 1,
  type: 'quick',
  title: 'Account Ledger — quick overview',
  description: "One account's full transaction history with a running balance.",
  module: 'accounting',
  estimatedMinutes: 1,
  requiredPermissions: [PERMISSIONS.LEDGER_VIEW],
  steps: [
    {
      id: 'intro',
      route: 'accounting/accounts/:id/ledger',
      title: 'Account Ledger',
      body: 'Every posted transaction that touched this one account, in date order, with a running balance — reached from "View Ledger" on an account in the Chart of Accounts.',
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.LEDGER_VIEW,
    },
    {
      id: 'date-range',
      route: 'accounting/accounts/:id/ledger',
      title: 'From / To date range',
      body: 'Defaults to this financial year (April 1st) through today — widen it to see older activity.',
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.LEDGER_VIEW,
    },
    {
      id: 'journal-link',
      route: 'accounting/accounts/:id/ledger',
      title: 'Click a Journal ID',
      body: "Each row's Journal column is a real link — click it to open that journal's full detail, including every other account it touched.",
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.LEDGER_VIEW,
    },
  ],
};

export default tour;
