import type { TourDefinition } from '../../schema.js';
import { PERMISSIONS } from '../../../../constants/permissions.js';

// Deep-dive companion to `accounting-opening-balances-overview`. Grounded against
// OpeningBalanceValidator.ts's own explicit code comment and opening-balances.routes.ts. This
// is the single most surprising finding in the whole Accounting audit, so it gets its own
// complete guide: locking this wizard does NOT post to financial_entries anywhere — it only
// validates the staging data's own internal debit=credit balance. The number that actually
// drives Trial Balance / Balance Sheet / Cash Flow is accounts.openingBalance, set directly on
// each Chart of Accounts record, which the wizard's own "Accounts" step never writes to.
const tour: TourDefinition = {
  id: 'accounting-opening-balances-complete-guide',
  version: 1,
  type: 'complete',
  title: 'Opening Balances — complete guide',
  description:
    "The wizard vs. the real ledger: why locking this page doesn't automatically make your reports correct, and what actually does.",
  module: 'accounting',
  estimatedMinutes: 6,
  requiredPermissions: [PERMISSIONS.OPENING_BALANCE_LOCK],
  steps: [
    {
      id: 'purpose',
      route: 'accounting/opening-balances',
      title: 'Why this page exists',
      body: 'When you move to this ERP mid-year, you need a way to carry forward every balance from your old system: what customers owe you, what you owe suppliers, your stock value, and your account balances.',
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.OPENING_BALANCE_LOCK,
    },
    {
      id: 'five-steps',
      route: 'accounting/opening-balances',
      title: 'Five independent steps',
      body: 'Customers, Suppliers, Stock, Accounts, Cash & Bank — each its own form, each saved separately. You can leave and come back; nothing is lost between sessions until you lock.',
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.OPENING_BALANCE_LOCK,
    },
    {
      id: 'the-real-surprise',
      route: 'accounting/opening-balances',
      title: 'This wizard is a staging area — not the ledger itself',
      body: 'Here\'s the important part: locking this wizard does not post anything to your actual accounting ledger. It only checks that the numbers you entered here balance against themselves. The wizard\'s own "Accounts" step writes to a separate staging table, not to the field your reports actually read.',
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.OPENING_BALANCE_LOCK,
      calloutTitle: 'Business impact',
      calloutVariant: 'warning',
    },
    {
      id: 'what-reports-actually-read',
      route: 'accounting/opening-balances',
      title: 'What Trial Balance and Balance Sheet actually read',
      body: "Every account in the Chart of Accounts has its own Opening Balance field — that's the number every report uses. Set it there, on each account, when you create or edit it. This wizard is a useful planning and validation tool for getting those numbers right, but it doesn't write them for you.",
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.OPENING_BALANCE_LOCK,
    },
    {
      id: 'lock',
      route: 'accounting/opening-balances',
      target: '[data-tour-id="accounting-opening-balances-lock-button"]',
      title: 'Lock',
      body: "Validates that every completed step's own debits equal credits, then permanently closes the wizard to further edits. You'll be asked to confirm. If it fails, you'll see a Trial Balance Mismatch breakdown showing exactly where the difference is.",
      placement: 'bottom',
      mode: 'informational',
      requiredPermission: PERMISSIONS.OPENING_BALANCE_LOCK,
    },
    {
      id: 'business-impact',
      route: 'accounting/opening-balances',
      title: "What locking touches — and what it doesn't",
      body: 'A narrower effect than the name suggests.',
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.OPENING_BALANCE_LOCK,
      calloutTitle: 'Business impact',
      calloutVariant: 'info',
      businessImpact: [
        "Locking prevents further edits to the wizard's own staged data — it does not post any journal entry.",
        "Trial Balance, Balance Sheet, and Cash Flow are driven by each account's own Opening Balance field, set separately in the Chart of Accounts.",
        "Editing an account's Opening Balance directly (via the Chart of Accounts) is not blocked by locking this wizard — there's no cross-check between the two.",
      ],
    },
    {
      id: 'common-mistakes',
      route: 'accounting/opening-balances',
      title: 'Common mistakes',
      body: 'This is the one to get right before you rely on any report.',
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.OPENING_BALANCE_LOCK,
      calloutTitle: 'Common mistakes',
      calloutVariant: 'warning',
      businessImpact: [
        "Assuming locking this wizard automatically makes your Trial Balance/Balance Sheet correct — it does not; you still need to set each account's Opening Balance directly.",
        "Locking before double-checking every step's numbers — the wizard can't be reopened afterward.",
        "Forgetting that Opening Balance on an individual account can still be edited after the wizard is locked — it's not protected by the same lock.",
      ],
    },
    {
      id: 'best-practices',
      route: 'accounting/opening-balances',
      title: 'Best practices',
      body: 'Treat this as a checklist, then verify the real numbers separately.',
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.OPENING_BALANCE_LOCK,
      calloutTitle: 'Best practices',
      calloutVariant: 'success',
      businessImpact: [
        "Use this wizard to plan and validate your go-live numbers, but confirm the Chart of Accounts' individual Opening Balance fields match before you rely on any report.",
        'Complete all five steps before locking, even if some show a zero balance — leaving a step incomplete makes the "Ready" summary misleading.',
        "Run a Trial Balance right after go-live to sanity-check your actual account-level opening balances, not just the wizard's own internal check.",
      ],
    },
  ],
};

export default tour;
