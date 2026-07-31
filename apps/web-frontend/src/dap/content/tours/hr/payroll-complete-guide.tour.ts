import type { TourDefinition } from '../../schema.js';
import { PERMISSIONS } from '../../../../constants/permissions.js';

// Deep-dive companion to `hr-payroll-overview`. Grounded against PayrollEngine.ts,
// payroll.routes.ts, PostingMatrixService.ts, EmployeeLoanService.ts. Key findings: calculation
// is genuinely formula-driven against real attendance/leave/loan data with correct India-standard
// PF/ESI/PT/TDS rules; the Calculate→Approve→Disburse split enforces real segregation of duties;
// the accounting journal only ever books net pay, never statutory liability lines; and payslip
// PDF/bulk-send backend endpoints exist but have no UI hook.
const tour: TourDefinition = {
  id: 'hr-payroll-complete-guide',
  version: 1,
  type: 'complete',
  title: 'Payroll — complete guide',
  description:
    "Exactly what the calculation includes, why Calculate and Approve are different people's jobs, and what the accounting entry does and doesn't capture.",
  module: 'hr',
  estimatedMinutes: 7,
  requiredPermissions: [PERMISSIONS.PAYROLL_VIEW],
  steps: [
    {
      id: 'purpose',
      route: 'hr/payroll',
      title: 'Why this page exists',
      body: 'Runs monthly salary calculation for every active employee, from real attendance and leave data, through to a real bank-transfer-triggering disbursement.',
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.PAYROLL_VIEW,
    },
    {
      id: 'what-the-calc-includes',
      route: 'hr/payroll',
      title: 'What Calculate actually computes',
      body: "Present/Late/Half-Day attendance days, approved leave days, and unpaid-leave (LOP) days derived from what's left — salary is pro-rated by (present + paid leave) / working days. Then PF (12% of basic, capped), ESI (0.75/3.25% split, only if gross ≤ ₹21,000), Professional Tax (by branch state), TDS (real FY slabs, ₹75,000 standard deduction), and any active loan EMI are all deducted.",
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.PAYROLL_VIEW,
    },
    {
      id: 'calculate',
      route: 'hr/payroll',
      target: '[data-tour-id="hr-payroll-calculate-button"]',
      title: 'Calculate',
      body: 'Can be re-run freely while the run is Draft or Calculated — nothing is locked yet. Employees with incomplete data (no active salary structure, etc.) are skipped and named in a toast, not silently dropped from the run.',
      placement: 'bottom',
      mode: 'informational',
      requiredPermission: PERMISSIONS.PAYROLL_PROCESS,
    },
    {
      id: 'segregation-of-duties',
      route: 'hr/payroll',
      target: '[data-tour-id="hr-payroll-approve-button"]',
      title: 'Approve is a genuinely separate role',
      body: "By design, the permission to Calculate payroll and the permission to Approve/Disburse it are different — the same role typically can't do both. This is real segregation of duties, not an accident of the permission list.",
      placement: 'bottom',
      mode: 'informational',
      requiredPermission: PERMISSIONS.PAYROLL_APPROVE,
    },
    {
      id: 'lock-after-approve',
      route: 'hr/payroll',
      title: 'Approved and Disbursed runs are locked',
      body: "Once a run is Approved (or Disbursed), attempting to Calculate it again is blocked outright — there's no accidental re-calculation after the numbers are signed off.",
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.PAYROLL_VIEW,
    },
    {
      id: 'disburse',
      route: 'hr/payroll',
      target: '[data-tour-id="hr-payroll-disburse-button"]',
      title: 'Disburse',
      body: 'The confirmation dialog now states the exact net amount and employee count before you commit. This is the step that actually posts the bank-side journal entry.',
      placement: 'bottom',
      mode: 'informational',
      requiredPermission: PERMISSIONS.PAYROLL_APPROVE,
    },
    {
      id: 'loan-emi',
      route: 'hr/payroll',
      title: 'Loan EMI deduction is real, but only one-directional in accounting',
      body: "If an employee has an active loan, its EMI is automatically deducted here, capped at the loan's remaining balance — genuinely reduces what they're owed, and reduces the loan's outstanding balance in HR's own records. But no accounting entry is posted for the EMI itself; only the original loan disbursement was ever journaled.",
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.PAYROLL_VIEW,
    },
    {
      id: 'business-impact',
      route: 'hr/payroll',
      title: 'What each step posts to accounting',
      body: 'Two real entries, net-pay only.',
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.PAYROLL_VIEW,
      calloutTitle: 'Business impact',
      calloutVariant: 'info',
      businessImpact: [
        'Approve: Dr Salaries & Wages Expense / Cr Salary Payable, for total net pay.',
        'Disburse: Dr Salary Payable / Cr Bank, for the same total.',
        'PF, ESI, Professional Tax, and TDS amounts appear on payslips and statutory challans, but are never booked as separate liability lines in the General Ledger.',
        "Loan EMI reduces net pay and the loan's outstanding balance, but posts no journal entry of its own.",
      ],
    },
    {
      id: 'common-mistakes',
      route: 'hr/payroll',
      title: 'Common mistakes',
      body: 'Expecting more automation on the output side than exists today.',
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.PAYROLL_VIEW,
      calloutTitle: 'Common mistakes',
      calloutVariant: 'warning',
      businessImpact: [
        'Looking for a "generate and email all slips" button — it doesn\'t exist; open View Slips and view them one at a time.',
        "Expecting a downloadable payslip PDF — today's only export is your browser's Print dialog.",
        "Assuming PF/ESI/TDS show up as accounting liabilities — they don't; check the PF/ESI Challan pages and Form 16 for those figures instead.",
      ],
    },
    {
      id: 'best-practices',
      route: 'hr/payroll',
      title: 'Best practices',
      body: 'Attendance and leave hygiene before you calculate.',
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.PAYROLL_VIEW,
      calloutTitle: 'Best practices',
      calloutVariant: 'success',
      businessImpact: [
        'Finalize attendance and clear pending leave approvals for the period before running Calculate — both directly feed the LOP math.',
        'Review the "skipped employees" toast carefully after Calculate — it names exactly who was left out and usually why (missing salary structure).',
        'Recalculate freely while still Draft/Calculated if something looks off — nothing is locked until Approve.',
      ],
    },
  ],
};

export default tour;
