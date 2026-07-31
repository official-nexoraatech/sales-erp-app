import type { TourDefinition } from '../../schema.js';
import { PERMISSIONS } from '../../../../constants/permissions.js';

// Grounded against leave.routes.ts / PayrollEngine.ts / LeavesPage.tsx. Added: real balance
// deduction and monthly accrual (not a static number), and the real mechanism connecting an
// approved leave to payroll's paid-vs-unpaid calculation. Fixed this session: Reject previously
// posted a hardcoded reason ("Rejected by manager") with no way for the approver to explain why —
// now opens a real reason field.
const tour: TourDefinition = {
  id: 'hr-leaves-overview',
  version: 1,
  type: 'quick',
  title: 'Leave Applications — quick overview',
  description:
    'Employees apply for leave against a real, accruing balance; managers approve or reject.',
  module: 'hr',
  estimatedMinutes: 2,
  requiredPermissions: [PERMISSIONS.LEAVE_VIEW],
  steps: [
    {
      id: 'intro',
      route: 'hr/leaves',
      title: 'Leave Applications',
      body: "Real leave-type balances, not just a request log — each employee's balance accrues monthly and is genuinely deducted on approval.",
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.LEAVE_VIEW,
    },
    {
      id: 'apply',
      route: 'hr/leaves',
      target: '[data-tour-id="hr-leaves-apply-button"]',
      title: 'Apply for leave',
      body: 'Select employee, leave type, and dates → Submit. Starts as Pending.',
      placement: 'bottom',
      mode: 'informational',
      requiredPermission: PERMISSIONS.LEAVE_VIEW,
    },
    {
      id: 'approve-reject',
      route: 'hr/leaves',
      target: '[data-tour-id="hr-leaves-approve-button"]',
      title: 'Approve or Reject',
      body: "Approving deducts real days from the employee's balance and marks those dates as paid leave — so payroll won't count them as unpaid absence. Rejecting now opens a real reason field for the approver to explain why.",
      placement: 'bottom',
      mode: 'informational',
      requiredPermission: PERMISSIONS.LEAVE_APPROVE,
    },
    {
      id: 'no-history-view',
      route: 'hr/leaves',
      title: 'No history view yet',
      body: "This page only shows the Apply form and currently-Pending approvals — approved, rejected, or cancelled applications aren't listed anywhere in the HR UI once they leave the pending queue.",
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.LEAVE_VIEW,
    },
  ],
};

export default tour;
