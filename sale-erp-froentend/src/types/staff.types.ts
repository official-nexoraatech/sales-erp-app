export type EmployeeStatus = 'ACTIVE' | 'INACTIVE';
export type EmploymentType = 'FULL_TIME' | 'PART_TIME' | 'CONTRACT' | 'INTERN';
export type AttendanceStatus = 'PRESENT' | 'ABSENT' | 'HALF_DAY' | 'LATE' | 'LEAVE';
export type LeaveStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED';
export type PayrollStatus = 'DRAFT' | 'GENERATED' | 'PAID';

export interface EmployeeAddressRequest {
  addressLine1: string;
  addressLine2?: string;
  city: string;
  stateId: number;
  countryId: number;
  pincode: string;
}

export interface EmployeeAddress extends EmployeeAddressRequest {
  id?: number;
  stateName?: string;
  countryName?: string;
}

export interface Employee {
  id: number;
  employeeCode: string;
  firstName: string;
  lastName: string;
  gender: string;
  dob: string;
  mobile: string;
  email: string;
  address?: EmployeeAddress | string;
  department: string;
  designation: string;
  joiningDate: string;
  employmentType: EmploymentType;
  reportingManager: string;
  basicSalary: number;
  hra: number;
  allowance: number;
  deductions: number;
  paymentMode: string;
  bankName: string;
  accountNumber: string;
  ifscCode: string;
  accountHolderName: string;
  status: EmployeeStatus;
}

export type EmployeeRequest = Omit<Employee, 'id' | 'address'> & {
  address?: EmployeeAddressRequest;
};

export interface Attendance {
  id: number;
  employeeId: number;
  employeeName: string;
  employeeCode: string;
  department: string;
  date: string;
  checkIn: string;
  checkOut: string;
  totalHours: number;
  status: AttendanceStatus;
  note: string;
}

export interface AttendanceRequest {
  employeeId: number;
  date: string;
  checkIn: string;
  checkOut: string;
  status: AttendanceStatus;
  note: string;
}

export interface LeaveRequestItem {
  id: number;
  employeeId: number;
  employeeName: string;
  employeeCode: string;
  leaveType: string;
  fromDate: string;
  toDate: string;
  days: number;
  reason: string;
  status: LeaveStatus;
}

export interface LeaveRequestPayload {
  employeeId: number;
  leaveType: string;
  fromDate: string;
  toDate: string;
  reason: string;
}

export interface LeaveBalance {
  leaveType: string;
  allotted: number;
  used: number;
  remaining: number;
}

export interface Payroll {
  id: number;
  employeeId: number;
  employeeName: string;
  employeeCode: string;
  payrollMonth: string;
  basicSalary: number;
  hra: number;
  allowance: number;
  overtimeAmount: number;
  deductions: number;
  tax: number;
  grossPay: number;
  netPay: number;
  paymentDate: string;
  status: PayrollStatus;
}

export interface PayrollRequest {
  employeeId: number;
  payrollMonth: string;
  basicSalary: number;
  hra: number;
  allowance: number;
  overtimeAmount: number;
  deductions: number;
  tax: number;
  paymentDate: string;
  status: PayrollStatus;
}

export interface StaffSetting {
  id: number;
  name: string;
  description: string;
  status: EmployeeStatus;
}

export type StaffSettingType = 'departments' | 'designations' | 'shifts' | 'holidays' | 'leaveTypes' | 'salaryComponents';

export interface StaffListResponse<T> {
  content: T[];
  page: number;
  size: number;
  totalElements: number;
  totalPages: number;
  last: boolean;
}
