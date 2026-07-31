import type { TourDefinition } from '../../schema.js';
import { PERMISSIONS } from '../../../../constants/permissions.js';

// Grounded against ExpensesPage.tsx / ExpenseFormPage.tsx / ExpenseService.ts. Corrected: there is
// no PO/GRN attachment field anywhere in the form (grep for purchaseOrderId/grnId/landedCost
// across ExpenseFormPage.tsx returns nothing) — the earlier "attach it to a PO/GRN" step described
// a feature that isn't built, even though the backend has landed-cost endpoints purchase-service
// never calls from any page.
const tour: TourDefinition = {
  id: 'purchase-expenses-overview',
  version: 1,
  type: 'quick',
  title: 'Purchase Expenses — quick overview',
  description:
    'Record standalone business expenses (freight, loading, rent, etc.) through an approval workflow.',
  module: 'purchase',
  estimatedMinutes: 1,
  requiredPermissions: [PERMISSIONS.EXPENSE_VIEW],
  steps: [
    {
      id: 'intro',
      route: 'purchase/expenses',
      title: 'Purchase Expenses',
      body: "Track costs that aren't tied to receiving inventory — courier, rent, freight, staff reimbursements. Each one goes through Draft → Submit → Approve → Paid.",
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.EXPENSE_VIEW,
    },
    {
      id: 'record',
      route: 'purchase/expenses',
      target: '[data-tour-id="purchase-expenses-create-button"]',
      title: 'Record an expense',
      body: "New Expense → description, amount, and GST rate if any. There's only one line item per expense — if you have several cost types (say, freight plus insurance), record them as separate Expense entries.",
      placement: 'bottom',
      mode: 'informational',
      requiredPermission: PERMISSIONS.EXPENSE_VIEW,
    },
    {
      id: 'approve-then-pay',
      route: 'purchase/expenses',
      title: 'Approve, then Mark Paid',
      body: 'Submitting and approving posts it to your books as an accrued liability. Marking it Paid separately clears that liability against cash or bank — these are two distinct steps, not one.',
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.EXPENSE_VIEW,
    },
  ],
};

export default tour;
