import type { TourDefinition } from '../../schema.js';
import { PERMISSIONS } from '../../../../constants/permissions.js';

// Multi-step wizard (customer/supplier/stock/accounts/cash-bank balances, each its own
// "Save & Next" step) — no single element represents the whole page, so left centered
// rather than pointing at one arbitrary wizard step's button.
//
// Grounded against OpeningBalancesPage.tsx and a real, surprising backend finding
// (OpeningBalanceValidator.ts) worth its own step: locking this wizard does NOT post to
// financial_entries at all — it only validates the staging data's own internal debit=credit
// balance. The number that actually appears on Trial Balance/Balance Sheet is a separate field
// (each account's own Opening Balance, set in the Chart of Accounts), which this wizard's
// "Accounts" step does not write to. See `accounting-opening-balances-complete-guide` for the
// full explanation — this quick tour keeps that nuance to one clear step.
const tour: TourDefinition = {
  id: 'accounting-opening-balances-overview',
  version: 1,
  type: 'quick',
  title: 'Opening Balances — quick overview',
  description:
    'Enter your starting bank balance and outstanding customer/supplier amounts when moving to this ERP.',
  module: 'accounting',
  estimatedMinutes: 2,
  requiredPermissions: [PERMISSIONS.OPENING_BALANCE_LOCK],
  steps: [
    {
      id: 'intro',
      route: 'accounting/opening-balances',
      title: 'Opening Balances',
      body: "A guided, 5-step wizard for entering the balances you're carrying over from your previous system: Customers, Suppliers, Stock, Accounts, Cash & Bank.",
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.OPENING_BALANCE_LOCK,
    },
    {
      id: 'steps',
      route: 'accounting/opening-balances',
      title: 'Five independent steps',
      body: 'Each tab is its own form with its own "Save & Next" — you can complete them in any order and come back later; nothing requires finishing in one sitting.',
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.OPENING_BALANCE_LOCK,
    },
    {
      id: 'wizard-is-staging',
      route: 'accounting/opening-balances',
      title: 'This wizard is a staging area, not the ledger',
      body: 'The figures that actually show up on your Trial Balance and Balance Sheet come from the Opening Balance field on each account in the Chart of Accounts — not directly from this wizard\'s "Accounts" step. Use this wizard to plan and validate your numbers, but confirm the Chart of Accounts reflects them too.',
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.OPENING_BALANCE_LOCK,
    },
    {
      id: 'lock',
      route: 'accounting/opening-balances',
      title: 'Lock',
      body: "Once every step's debits equal credits, Lock Opening Balances closes the wizard permanently — you'll be asked to confirm, since none of the wizard steps can be edited again afterward.",
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.OPENING_BALANCE_LOCK,
    },
  ],
};

export default tour;
