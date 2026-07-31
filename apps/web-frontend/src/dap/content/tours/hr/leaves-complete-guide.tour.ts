import type { TourDefinition } from '../../schema.js';
import { PERMISSIONS } from '../../../../constants/permissions.js';

// Deep-dive companion to `hr-leaves-overview`. Grounded against leave.routes.ts,
// internal.routes.ts (accrual job), PayrollEngine.ts. Key finding worth its own step: approval
// writes real attendance rows (status LEAVE) for the approved dates, but payroll's own LOP
// calculation reads the leave-applications table directly, not those attendance rows — both
// exist and should agree, but they're two separate reads, not one.
const tour: TourDefinition = {
  id: 'hr-leaves-complete-guide',
  version: 1,
  type: 'complete',
  title: 'Leave Applications — complete guide',
  description:
    "How balances actually accrue and deduct, and the real (if slightly indirect) link to payroll's unpaid-leave calculation.",
  module: 'hr',
  estimatedMinutes: 6,
  requiredPermissions: [PERMISSIONS.LEAVE_VIEW],
  steps: [
    {
      id: 'purpose',
      route: 'hr/leaves',
      title: 'Why this page exists',
      body: 'Employees request time off against a real balance; approving genuinely deducts it and marks those days as paid, not unpaid, when payroll runs.',
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.LEAVE_VIEW,
    },
    {
      id: 'balance-is-real',
      route: 'hr/leaves',
      title: 'Balances accrue monthly, not a static number',
      body: "A real backend job adds each leave type's annual entitlement divided by 12 to every employee's balance on the 1st of each month, capped at the yearly total — plus a year-end carry-forward job. This isn't something you configure per employee by hand.",
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.LEAVE_VIEW,
    },
    {
      id: 'apply',
      route: 'hr/leaves',
      target: '[data-tour-id="hr-leaves-apply-button"]',
      title: 'Apply',
      body: 'Employee, leave type, date range, and a reason — creates a Pending application. No balance effect yet.',
      placement: 'bottom',
      mode: 'informational',
      requiredPermission: PERMISSIONS.LEAVE_VIEW,
    },
    {
      id: 'approve',
      route: 'hr/leaves',
      target: '[data-tour-id="hr-leaves-approve-button"]',
      title: 'Approve — two real effects at once',
      body: "Increments the employee's Used Days on their leave balance, and separately inserts real attendance rows marked LEAVE for each day in the range — both happen atomically in the same action.",
      placement: 'bottom',
      mode: 'informational',
      requiredPermission: PERMISSIONS.LEAVE_APPROVE,
    },
    {
      id: 'reject',
      route: 'hr/leaves',
      target: '[data-tour-id="hr-leaves-reject-button"]',
      title: 'Reject',
      body: 'Now opens a real reason field — previously this posted a hardcoded "Rejected by manager" with no way to actually explain the decision.',
      placement: 'bottom',
      mode: 'informational',
      requiredPermission: PERMISSIONS.LEAVE_APPROVE,
    },
    {
      id: 'payroll-link',
      route: 'hr/leaves',
      title: 'How this reaches payroll',
      body: "When payroll runs, its LOP calculation reads approved leave-application rows directly for the period — not the LEAVE-status attendance rows approval also wrote. Both should tell the same story, but they're two separate lookups under the hood, not one shared source. Approve leave applications before running payroll for that period.",
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.LEAVE_VIEW,
      calloutTitle: 'Business impact',
      calloutVariant: 'info',
    },
    {
      id: 'common-mistakes',
      route: 'hr/leaves',
      title: 'Common mistakes',
      body: 'Timing and visibility are the two traps here.',
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.LEAVE_VIEW,
      calloutTitle: 'Common mistakes',
      calloutVariant: 'warning',
      businessImpact: [
        'Running payroll before clearing pending leave approvals for that period — any leave still Pending at that point counts as unpaid absence (LOP), not paid leave.',
        "Looking for a list of past approved/rejected/cancelled applications on this page — there isn't one; only the Pending queue is shown here.",
        "There's no Cancel action for an employee's own leave application anywhere in the UI, even though the underlying API supports it — an approved or pending leave can't currently be withdrawn from this page.",
      ],
    },
    {
      id: 'best-practices',
      route: 'hr/leaves',
      title: 'Best practices',
      body: 'Clear the queue before payroll, every period.',
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.LEAVE_VIEW,
      calloutTitle: 'Best practices',
      calloutVariant: 'success',
      businessImpact: [
        'Make clearing Pending Approvals a standard step right before running payroll each period.',
        "Give a real, specific rejection reason now that there's a field for it — it helps the employee understand and avoids repeat requests for the same dates.",
        "Check an employee's leave balance table on their profile before approving a large request, especially near year-end when accrual caps matter.",
      ],
    },
  ],
};

export default tour;
