import type { TourDefinition } from '../../schema.js';
import { PERMISSIONS } from '../../../../constants/permissions.js';

// Grounded against ChartOfAccountsPage.tsx / accounts.routes.ts. Corrected: the button is
// labeled "Seed Default CoA", not "Seed Default Accounts". Added: accounts are never truly
// deleted once they have transactions (soft-deactivated only), and parent/child account
// hierarchy is real but reports do NOT roll child balances up into the parent line — each
// account's balance is computed independently.
const tour: TourDefinition = {
  id: 'accounting-chart-of-accounts-overview',
  version: 1,
  type: 'quick',
  title: 'Chart of Accounts — quick overview',
  description: 'The ledger accounts every journal entry, invoice, and payment posts against.',
  module: 'accounting',
  estimatedMinutes: 2,
  requiredPermissions: [PERMISSIONS.ACCOUNT_VIEW],
  steps: [
    {
      id: 'intro',
      route: 'accounting/chart-of-accounts',
      title: 'Chart of Accounts',
      body: 'The ledger accounts every journal entry, invoice, and payment posts against.',
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.ACCOUNT_VIEW,
    },
    {
      id: 'add-account',
      route: 'accounting/chart-of-accounts',
      target: '[data-tour-id="accounting-coa-create-button"]',
      title: 'Add a new account',
      body: 'New Account → select type (Asset/Liability/Income/Expense) → Save. New tenants can instead click "Seed Default CoA" for a standard starter set.',
      placement: 'bottom',
      mode: 'informational',
      requiredPermission: PERMISSIONS.ACCOUNT_VIEW,
    },
    {
      id: 'no-delete',
      route: 'accounting/chart-of-accounts',
      title: 'Accounts are deactivated, never deleted',
      body: "Once an account has any posted transaction, it can't be deleted — only deactivated, which blocks new postings to it while keeping every historical journal entry showing its original name and code.",
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.ACCOUNT_VIEW,
    },
    {
      id: 'hierarchy',
      route: 'accounting/chart-of-accounts',
      title: "Parent/child groups don't roll up on reports",
      body: 'You can organize accounts under a parent (e.g. "Cash in Hand" under "Current Assets"), but Trial Balance, P&L, and Balance Sheet each show every account\'s own balance individually — a parent header account with no direct postings shows ₹0, even if its children have real balances.',
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.ACCOUNT_VIEW,
    },
  ],
};

export default tour;
