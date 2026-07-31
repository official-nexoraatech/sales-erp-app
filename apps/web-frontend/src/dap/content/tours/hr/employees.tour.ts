import type { TourDefinition } from '../../schema.js';
import { PERMISSIONS } from '../../../../constants/permissions.js';

// Grounded against EmployeeFormPage.tsx / EmployeeViewPage.tsx. Corrected: the employee form has
// NO salary fields at all — salary is set from the Payroll page's separate "Set Employee Salary"
// modal, not from the employee record. Added: the real Loans panel (backend always existed,
// frontend was missing until this codebase's 07-15 fix) now lives on this page, and Record Exit
// is a soft termination, not deletion — there's no delete action for an employee anywhere.
const tour: TourDefinition = {
  id: 'hr-employees-overview',
  version: 1,
  type: 'quick',
  title: 'Employees — quick overview',
  description:
    'The employee master — personal details, employment info, bank/tax details, documents, and loans.',
  module: 'hr',
  estimatedMinutes: 2,
  requiredPermissions: [PERMISSIONS.EMPLOYEE_VIEW],
  steps: [
    {
      id: 'intro',
      route: 'hr/employees',
      title: 'Employees',
      body: "The employee master — three tabs on the form (Basic, Employment, Bank & Tax), plus documents and loans managed from the employee's own detail page.",
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.EMPLOYEE_VIEW,
    },
    {
      id: 'add-employee',
      route: 'hr/employees',
      target: '[data-tour-id="hr-employees-create-button"]',
      title: 'Add a new employee',
      body: "New Employee → personal, employment, and bank/tax details. There's no salary field here — set that separately from the Payroll page once the employee is created.",
      placement: 'bottom',
      mode: 'informational',
      requiredPermission: PERMISSIONS.EMPLOYEE_VIEW,
    },
    {
      id: 'exit-not-delete',
      route: 'hr/employees',
      target: '[data-tour-id="hr-employee-record-exit-button"]',
      title: "Record Exit — there's no delete",
      body: "On the employee's own detail page, while Active. This is a soft termination requiring an exit date and reason — there's no way to delete an employee record at all, so their attendance and payroll history is always preserved.",
      placement: 'bottom',
      mode: 'informational',
      requiredPermission: PERMISSIONS.EMPLOYEE_UPDATE,
    },
    {
      id: 'loans',
      route: 'hr/employees',
      target: '[data-tour-id="hr-employee-disburse-loan-button"]',
      title: 'Employee Loans',
      body: "On the employee's detail page. A real loan: disbursing posts a real accounting entry, and the EMI is automatically deducted from that employee's payroll each period until it's paid off or closed. Note: EMI deductions reduce the loan balance in HR's records, but don't post their own accounting entry — only the original disbursement does.",
      placement: 'bottom',
      mode: 'informational',
      requiredPermission: PERMISSIONS.EMPLOYEE_LOAN_MANAGE,
    },
  ],
};

export default tour;
