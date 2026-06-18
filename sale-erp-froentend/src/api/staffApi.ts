import axiosClient from './axiosClient';
import type { ApiResponse } from './apiResponse';
import type {
  Attendance,
  AttendanceRequest,
  Employee,
  EmployeeRequest,
  LeaveBalance,
  LeaveRequestItem,
  LeaveRequestPayload,
  LeaveStatus,
  Payroll,
  PayrollRequest,
  StaffListResponse,
  StaffSetting,
  StaffSettingType,
} from '../types/staff.types';

const basePath = '/api/v1/staff';

export const staffApi = {
  getEmployees: (params?: { page?: number; size?: number; search?: string; status?: string; department?: string }) =>
    axiosClient.get<ApiResponse<StaffListResponse<Employee>>, ApiResponse<StaffListResponse<Employee>>>(`${basePath}/employees`, { params }),
  getEmployeeById: (id: number) =>
    axiosClient.get<ApiResponse<Employee>, ApiResponse<Employee>>(`${basePath}/employees/${id}`),
  createEmployee: (payload: EmployeeRequest) =>
    axiosClient.post<ApiResponse<void>, ApiResponse<void>>(`${basePath}/employees`, payload),
  updateEmployee: (id: number, payload: EmployeeRequest) =>
    axiosClient.put<ApiResponse<void>, ApiResponse<void>>(`${basePath}/employees/${id}`, payload),
  deleteEmployee: (id: number) =>
    axiosClient.delete<ApiResponse<void>, ApiResponse<void>>(`${basePath}/employees/${id}`),

  getAttendance: (params?: { date?: string; department?: string; employee?: string; status?: string }) =>
    axiosClient.get<ApiResponse<Attendance[]>, ApiResponse<Attendance[]>>(`${basePath}/attendance`, { params }),
  markAttendance: (payload: AttendanceRequest) =>
    axiosClient.post<ApiResponse<void>, ApiResponse<void>>(`${basePath}/attendance`, payload),
  updateAttendance: (id: number, payload: AttendanceRequest) =>
    axiosClient.put<ApiResponse<void>, ApiResponse<void>>(`${basePath}/attendance/${id}`, payload),
  getAttendanceSummary: (params?: { month?: number | string; year?: number | string }) =>
    axiosClient.get<ApiResponse<Array<{ status: string; count: number }>>, ApiResponse<Array<{ status: string; count: number }>>>(`${basePath}/attendance/summary`, { params }),

  getLeaves: (params?: { employee?: string; leaveType?: string; status?: string; fromDate?: string; toDate?: string }) =>
    axiosClient.get<ApiResponse<LeaveRequestItem[]>, ApiResponse<LeaveRequestItem[]>>(`${basePath}/leaves`, { params }),
  createLeave: (payload: LeaveRequestPayload) =>
    axiosClient.post<ApiResponse<void>, ApiResponse<void>>(`${basePath}/leaves`, payload),
  approveLeave: (id: number) =>
    axiosClient.put<ApiResponse<void>, ApiResponse<void>>(`${basePath}/leaves/${id}/approve`),
  rejectLeave: (id: number, reason?: string) =>
    axiosClient.put<ApiResponse<void>, ApiResponse<void>>(`${basePath}/leaves/${id}/reject`, reason ? { reason } : {}),
  cancelLeave: (id: number) =>
    axiosClient.put<ApiResponse<void>, ApiResponse<void>>(`${basePath}/leaves/${id}/cancel`),
  updateLeaveStatus: (id: number, status: LeaveStatus) => {
    if (status === 'APPROVED') return staffApi.approveLeave(id);
    if (status === 'REJECTED') return staffApi.rejectLeave(id);
    if (status === 'CANCELLED') return staffApi.cancelLeave(id);
    return Promise.reject(new Error('Unsupported leave status transition'));
  },
  getLeaveBalances: (employeeId?: number) =>
    axiosClient.get<ApiResponse<LeaveBalance[]>, ApiResponse<LeaveBalance[]>>(`${basePath}/leaves/balance`, { params: { employeeId } }),

  getPayroll: (params?: { month?: string; year?: string }) =>
    axiosClient.get<ApiResponse<Payroll[]>, ApiResponse<Payroll[]>>(`${basePath}/payroll`, { params }),
  getPayrollById: (id: number) =>
    axiosClient.get<ApiResponse<Payroll>, ApiResponse<Payroll>>(`${basePath}/payroll/${id}`),
  createPayroll: (payload: PayrollRequest) =>
    axiosClient.post<ApiResponse<void>, ApiResponse<void>>(`${basePath}/payroll`, payload),
  markPayrollPaid: (id: number) =>
    axiosClient.put<ApiResponse<void>, ApiResponse<void>>(`${basePath}/payroll/${id}/mark-paid`),

  getSettings: (type: StaffSettingType) =>
    axiosClient.get<ApiResponse<StaffSetting[]>, ApiResponse<StaffSetting[]>>(`${basePath}/settings/${type}`),
  createSetting: (type: StaffSettingType, payload: Omit<StaffSetting, 'id'>) =>
    axiosClient.post<ApiResponse<void>, ApiResponse<void>>(`${basePath}/settings/${type}`, payload),
  updateSetting: (type: StaffSettingType, id: number, payload: Omit<StaffSetting, 'id'>) =>
    axiosClient.put<ApiResponse<void>, ApiResponse<void>>(`${basePath}/settings/${type}/${id}`, payload),
  deleteSetting: (type: StaffSettingType, id: number) =>
    axiosClient.delete<ApiResponse<void>, ApiResponse<void>>(`${basePath}/settings/${type}/${id}`),

  getDepartments: () => staffApi.getSettings('departments'),
  getDesignations: () => staffApi.getSettings('designations'),
};
