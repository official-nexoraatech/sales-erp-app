import type { TourDefinition } from '../../schema.js';
import { PERMISSIONS } from '../../../../constants/permissions.js';

// Deep-dive companion to `purchase-expenses-overview`. Grounded against ExpenseService.ts
// (apps/purchase-service) and ExpenseAccountingConsumer.ts (apps/accounting-service). Key finding:
// GST recorded on an expense line is baked into totalAmount but never broken out or claimed as
// ITC anywhere — there is no GST-service consumer for EXPENSE_APPROVED/EXPENSE_PAID at all
// (confirmed by grep). Also: the frontend form only supports one line item per Expense record —
// there's no "Add Line" button, despite the backend schema supporting multiple lines.
const tour: TourDefinition = {
  id: 'purchase-expenses-complete-guide',
  version: 1,
  type: 'complete',
  title: 'Purchase Expenses — complete guide',
  description:
    'The Draft→Submit→Approve→Paid workflow, what each step posts to your books, and two real limitations: one line per expense, and GST on an expense is never claimed as input credit.',
  module: 'purchase',
  estimatedMinutes: 5,
  requiredPermissions: [PERMISSIONS.EXPENSE_VIEW],
  steps: [
    {
      id: 'purpose',
      route: 'purchase/expenses',
      title: 'Why this page exists',
      body: "Track business costs that aren't tied to receiving inventory — freight, courier, rent, staff reimbursement — through a real approval workflow, not a free-text log.",
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.EXPENSE_VIEW,
    },
    {
      id: 'create',
      route: 'purchase/expenses/new',
      title: 'Recording an expense',
      body: 'One description, one amount, one GST rate — that\'s it. There\'s no "Add Line" button, so an expense with several cost types (say, freight plus insurance) needs a separate Expense record for each.',
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.EXPENSE_VIEW,
    },
    {
      id: 'submit',
      route: 'purchase/expenses',
      target: '[data-tour-id="expense-submit-row-action"]',
      title: 'Submit',
      body: "Moves Draft to Submitted. No accounting effect yet — it's just a hand-off for approval.",
      placement: 'bottom',
      mode: 'informational',
      requiredPermission: PERMISSIONS.EXPENSE_VIEW,
    },
    {
      id: 'approve',
      route: 'purchase/expenses',
      target: '[data-tour-id="expense-approve-row-action"]',
      title: 'Approve',
      body: 'This is where it hits your books: posts Dr Operating Expenses / Cr Accounts Payable for the full amount, accruing the liability even though nothing has been paid yet.',
      placement: 'bottom',
      mode: 'informational',
      requiredPermission: PERMISSIONS.EXPENSE_VIEW,
    },
    {
      id: 'mark-paid',
      route: 'purchase/expenses',
      title: 'Mark Paid',
      body: 'A separate step from Approve — pick a payment mode and date. This clears the liability: posts Dr Accounts Payable / Cr Cash-Bank.',
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.EXPENSE_VIEW,
    },
    {
      id: 'business-impact',
      route: 'purchase/expenses',
      title: 'What each step posts',
      body: 'Two clean accounting entries — and one gap worth knowing about.',
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.EXPENSE_VIEW,
      calloutTitle: 'Business impact',
      calloutVariant: 'info',
      businessImpact: [
        'Approve: Dr Operating Expenses / Cr Accounts Payable, for the full amount including any GST.',
        'Mark Paid: Dr Accounts Payable / Cr Cash-Bank, clearing the liability.',
        "GST: even if you enter a GST rate on the line, it is never separately claimed as input tax credit anywhere in the system — it's simply folded into the total expense amount.",
        'Reports: appears in expense-related views (verify against live figures — the raw Expense Report query has known data issues).',
      ],
    },
    {
      id: 'common-mistakes',
      route: 'purchase/expenses',
      title: 'Common mistakes',
      body: 'The single-line limit catches people most often.',
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.EXPENSE_VIEW,
      calloutTitle: 'Common mistakes',
      calloutVariant: 'warning',
      businessImpact: [
        "Trying to record multiple cost types in one Expense — the form silently only keeps the last line item you typed since there's no way to add more.",
        "Assuming GST entered on an expense is claimed as input credit — it isn't; treat it as a cost, not a recoverable tax, for GST return purposes.",
        "Forgetting there's no branch selector — the expense is recorded against your first assigned branch by default.",
      ],
    },
    {
      id: 'best-practices',
      route: 'purchase/expenses',
      title: 'Best practices',
      body: 'Split it up, and track GST separately if it matters.',
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.EXPENSE_VIEW,
      calloutTitle: 'Best practices',
      calloutVariant: 'success',
      businessImpact: [
        "Split multi-cost-type purchases into one Expense record per cost type from the start — it's easier than trying to work around it later.",
        'If an expense carries meaningful GST you intend to claim, track that separately outside the system until ITC claiming is supported here.',
        "Approve and pay expenses promptly — until Approve, the cost isn't reflected in your liabilities at all.",
      ],
    },
  ],
};

export default tour;
