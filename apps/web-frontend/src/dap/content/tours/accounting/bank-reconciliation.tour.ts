import type { TourDefinition } from '../../schema.js';
import { PERMISSIONS } from '../../../../constants/permissions.js';

// Grounded against BankReconciliationPage.tsx / BankReconciliationService.ts. Major correction:
// the previous version described an "Import Statement" (CSV/Excel upload) button and an
// "Auto-Match" button — NEITHER EXISTS. There's a backend import endpoint the frontend never
// calls, and no auto-match endpoint exists at all. Matching here is 100% manual, one pair at a
// time. Also: this page only ever reconciles a single hardcoded bank account (BANK_ACCOUNT_ID=1
// in the code, an acknowledged placeholder) — there's no account selector despite the Chart of
// Accounts supporting multiple bank accounts. Matching itself has zero accounting effect —
// confirmed no journal/financial_entries write anywhere in the match path.
const tour: TourDefinition = {
  id: 'accounting-bank-reconciliation-overview',
  version: 1,
  type: 'quick',
  title: 'Bank Reconciliation — quick overview',
  description:
    'Manually pair your bank statement lines against book entries to confirm they agree.',
  module: 'accounting',
  estimatedMinutes: 2,
  requiredPermissions: [PERMISSIONS.BANK_RECONCILIATION_VIEW],
  steps: [
    {
      id: 'intro',
      route: 'accounting/bank-reconciliation',
      title: 'Bank Reconciliation',
      body: 'Confirms your books and your actual bank statement agree — a Bank Items column and a Book Items column, side by side.',
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.BANK_RECONCILIATION_VIEW,
    },
    {
      id: 'one-account-only',
      route: 'accounting/bank-reconciliation',
      title: 'One bank account, currently',
      body: "This page always reconciles the same single bank account — there's no account selector yet, even if you have more than one bank account set up.",
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.BANK_RECONCILIATION_VIEW,
    },
    {
      id: 'manual-match',
      route: 'accounting/bank-reconciliation',
      title: 'Matching is manual, one pair at a time',
      body: "Click an unmatched Bank item, then click the corresponding unmatched Book item — that pairs them. There's no CSV/Excel import and no auto-match; every pair is a deliberate click.",
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.BANK_RECONCILIATION_VIEW,
    },
    {
      id: 'no-accounting-effect',
      route: 'accounting/bank-reconciliation',
      title: "Matching doesn't change your books",
      body: "This is a tracking/audit action only — pairing two items doesn't post, edit, or reverse any journal entry. The financial impact already happened when the original payment or receipt was recorded; this just confirms the bank agrees.",
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.BANK_RECONCILIATION_VIEW,
    },
    {
      id: 'finalize',
      route: 'accounting/bank-reconciliation',
      target: '[data-tour-id="accounting-bank-reconciliation-finalize-button"]',
      title: 'Finalize',
      body: "Once every item is matched, Finalize Reconciliation appears — you'll be asked to confirm, since it locks this statement period against further re-matching.",
      placement: 'bottom',
      mode: 'informational',
      requiredPermission: PERMISSIONS.BANK_RECONCILIATION_VIEW,
    },
  ],
};

export default tour;
