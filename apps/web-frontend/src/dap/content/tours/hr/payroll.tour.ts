import type { TourDefinition } from '../../schema.js';
import { PERMISSIONS } from '../../../../constants/permissions.js';

// Grounded against payroll.routes.ts / PayrollEngine.ts / PayrollPage.tsx / PayslipViewPage.tsx.
// Major correction: there's no "Generate Salary Slips → email or WhatsApp to all employees"
// action — slips are created automatically by Calculate, viewed one at a time, and the only
// export is a browser print (a real PDF-generation endpoint exists but no button calls it).
// Also corrects "Submit for Approval" — the real button is just "Approve", gated by a permission
// distinct from who can Calculate.
const tour: TourDefinition = {
  id: 'hr-payroll-overview',
  version: 1,
  type: 'quick',
  title: 'Payroll — quick overview',
  description: 'Calculate real, attendance-driven salaries and post them to your books.',
  module: 'hr',
  estimatedMinutes: 2,
  requiredPermissions: [PERMISSIONS.PAYROLL_VIEW],
  steps: [
    {
      id: 'intro',
      route: 'hr/payroll',
      title: 'Payroll',
      body: 'A real calculation — actual attendance, approved leave, active salary structure, and India-standard PF/ESI/Professional Tax/TDS rules — not a flat estimate.',
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.PAYROLL_VIEW,
    },
    {
      id: 'start-run',
      route: 'hr/payroll',
      target: '[data-tour-id="hr-payroll-create-button"]',
      title: 'New Payroll Run',
      body: 'Pick the month, then Calculate. Employees with incomplete data (missing salary structure, etc.) are skipped with a clear toast, not silently dropped.',
      placement: 'bottom',
      mode: 'informational',
      requiredPermission: PERMISSIONS.PAYROLL_PROCESS,
    },
    {
      id: 'approve-then-disburse',
      route: 'hr/payroll',
      target: '[data-tour-id="hr-payroll-approve-button"]',
      title: 'Approve, then Disburse',
      body: "Two separate, separately-permissioned steps — by design, the person who calculates payroll usually can't also approve it. Approve posts Dr Salary Expense / Cr Salary Payable; Disburse (now with a confirmation showing the total and employee count) posts Dr Salary Payable / Cr Bank.",
      placement: 'bottom',
      mode: 'informational',
      requiredPermission: PERMISSIONS.PAYROLL_APPROVE,
    },
    {
      id: 'net-pay-only',
      route: 'hr/payroll',
      title: 'The journal entry is net-pay only',
      body: "Accounting only sees the net amount actually paid out — there's no separate PF Payable, ESI Payable, or TDS Payable liability booked. Those statutory amounts exist on the payslip and PF/ESI challans, not as ledger entries.",
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.PAYROLL_VIEW,
    },
    {
      id: 'view-slips',
      route: 'hr/payroll',
      title: 'View Slips',
      body: 'Slips exist automatically once you Calculate — there\'s no separate "generate" step. Open one at a time from here; the only export is your browser\'s Print dialog, not a downloadable PDF or an automatic email/WhatsApp send to employees.',
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.PAYROLL_VIEW,
    },
  ],
};

export default tour;
