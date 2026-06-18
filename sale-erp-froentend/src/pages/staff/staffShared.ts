import type { AttendanceStatus, EmployeeStatus, EmploymentType, LeaveStatus, PayrollStatus } from '../../api/endpoints';

export const inputClass = 'h-10 w-full rounded border border-gray-300 bg-white px-3 text-sm text-gray-900 outline-none focus:border-blue-300 focus:ring-2 focus:ring-blue-100 disabled:cursor-not-allowed disabled:bg-gray-50';
export const textareaClass = 'mt-1 h-20 w-full rounded border border-gray-300 bg-white p-3 text-sm text-gray-900 outline-none focus:border-blue-300 focus:ring-2 focus:ring-blue-100';
export const labelClass = 'block text-sm text-gray-600';

export const employmentTypes: EmploymentType[] = ['FULL_TIME', 'PART_TIME', 'CONTRACT', 'INTERN'];
export const employeeStatuses: EmployeeStatus[] = ['ACTIVE', 'INACTIVE'];
export const attendanceStatuses: AttendanceStatus[] = ['PRESENT', 'ABSENT', 'HALF_DAY', 'LATE', 'LEAVE'];
export const leaveStatuses: LeaveStatus[] = ['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED'];
export const payrollStatuses: PayrollStatus[] = ['DRAFT', 'GENERATED', 'PAID'];
export const paymentModes = ['Bank Transfer', 'Cash', 'Cheque', 'UPI'];

export const pretty = (value: string) => value.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, (char) => char.toUpperCase());

export const statusClass = (status: string) => {
  if (['ACTIVE', 'APPROVED', 'PRESENT', 'PAID'].includes(status)) return 'bg-green-100 text-green-700';
  if (['PENDING', 'GENERATED', 'LATE', 'HALF_DAY', 'DRAFT'].includes(status)) return 'bg-amber-100 text-amber-700';
  if (['REJECTED', 'ABSENT', 'INACTIVE'].includes(status)) return 'bg-red-100 text-red-700';
  return 'bg-gray-100 text-gray-700';
};

export const fullName = (firstName: string, lastName: string) => `${firstName} ${lastName}`.trim();
