import type { TourDefinition } from '../../schema.js';
import { PERMISSIONS } from '../../../../constants/permissions.js';

// Deep-dive companion to `accounting-bank-reconciliation-overview`. Grounded against
// BankReconciliationService.ts / BankReconciliationPage.tsx. Corrects the same fictional
// Import/Auto-Match claims the quick tour corrects, and goes deeper on the single-account
// limitation and the fact that matching has zero accounting effect.
const tour: TourDefinition = {
  id: 'accounting-bank-reconciliation-complete-guide',
  version: 1,
  type: 'complete',
  title: 'Bank Reconciliation — complete guide',
  description:
    'What matching really is (manual, no accounting effect), the single-account limitation, and what Finalize actually locks.',
  module: 'accounting',
  estimatedMinutes: 5,
  requiredPermissions: [PERMISSIONS.BANK_RECONCILIATION_VIEW],
  steps: [
    {
      id: 'purpose',
      route: 'accounting/bank-reconciliation',
      title: 'Why this page exists',
      body: 'Your books and your actual bank statement are two independent records — this page is where you confirm, line by line, that they agree.',
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.BANK_RECONCILIATION_VIEW,
    },
    {
      id: 'single-account',
      route: 'accounting/bank-reconciliation',
      title: 'Only one bank account, currently',
      body: "This page reconciles a single, fixed bank account — there's no account selector, even if your Chart of Accounts has several bank accounts set up. Keep that in mind if your organization uses more than one.",
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.BANK_RECONCILIATION_VIEW,
    },
    {
      id: 'no-import-no-autmatch',
      route: 'accounting/bank-reconciliation',
      title: 'No CSV import, no auto-match — both were removed from tour claims',
      body: 'Earlier guidance for this page described an "Import Statement" button and an "Auto-Match" button — neither exists in the app today, and there\'s no auto-matching capability on the backend either. Every match is a deliberate, manual click.',
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.BANK_RECONCILIATION_VIEW,
    },
    {
      id: 'match',
      route: 'accounting/bank-reconciliation',
      title: 'How matching works',
      body: "Click an Unmatched item in the Bank column, then click its counterpart in the Book column — that pairs them and both move to Matched. There's no bulk-select.",
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.BANK_RECONCILIATION_DO,
    },
    {
      id: 'zero-accounting-effect',
      route: 'accounting/bank-reconciliation',
      title: 'Matching never touches your books',
      body: "This is purely a tracking and audit action — matching two items doesn't create, edit, or reverse any journal entry. The actual financial impact already happened when the underlying payment or receipt was first recorded; this page just proves the bank agrees with it.",
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.BANK_RECONCILIATION_VIEW,
      calloutTitle: 'Business impact',
      calloutVariant: 'info',
    },
    {
      id: 'finalize',
      route: 'accounting/bank-reconciliation',
      target: '[data-tour-id="accounting-bank-reconciliation-finalize-button"]',
      title: 'Finalize Reconciliation',
      body: "Only appears once everything is matched. Flips the statement to Finalized, so this period's items can no longer be re-matched. You'll be asked to confirm.",
      placement: 'bottom',
      mode: 'informational',
      requiredPermission: PERMISSIONS.BANK_RECONCILIATION_DO,
    },
    {
      id: 'common-mistakes',
      route: 'accounting/bank-reconciliation',
      title: 'Common mistakes',
      body: 'Expecting more automation than exists today.',
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.BANK_RECONCILIATION_VIEW,
      calloutTitle: 'Common mistakes',
      calloutVariant: 'warning',
      businessImpact: [
        "Looking for an import/upload button for your bank statement — it doesn't exist yet; items need to already be present as Bank-side rows.",
        "Assuming matching fixes a bookkeeping error — it doesn't adjust anything; if the book entry is wrong, correct it separately, then match.",
        "Forgetting this page only ever shows one bank account — if a transaction is missing, check you're looking at the right account first.",
      ],
    },
    {
      id: 'best-practices',
      route: 'accounting/bank-reconciliation',
      title: 'Best practices',
      body: 'Reconcile regularly, not just at year-end.',
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.BANK_RECONCILIATION_VIEW,
      calloutTitle: 'Best practices',
      calloutVariant: 'success',
      businessImpact: [
        "Match items weekly or monthly rather than letting a large backlog build up — it's much easier to spot a real discrepancy in a small batch.",
        "Investigate any item that stays Unmatched for more than a statement cycle — it usually means something wasn't recorded, or was recorded twice.",
        'Finalize promptly once everything matches, so the period is cleanly closed off in your own records.',
      ],
    },
  ],
};

export default tour;
