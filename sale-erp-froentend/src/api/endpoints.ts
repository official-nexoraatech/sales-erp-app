import axiosClient from './axiosClient';
import type { ApiResponse, PageResponse } from './apiResponse';
export { staffApi } from './staffApi';
export type {
  Attendance,
  AttendanceRequest,
  AttendanceStatus,
  Employee,
  EmployeeAddress,
  EmployeeAddressRequest,
  EmployeeRequest,
  EmployeeStatus,
  EmploymentType,
  LeaveBalance,
  LeaveRequestItem,
  LeaveRequestPayload,
  LeaveStatus,
  Payroll,
  PayrollRequest,
  PayrollStatus,
  StaffListResponse,
  StaffSetting,
  StaffSettingType,
} from '../types/staff.types';
import type { LoginRequest, LoginResponse } from '../types/auth.types';
import type { CustomerDetail, CustomerListItem } from '../types/customer.types';
import type { CreateCustomerRequest, UpdateCustomerRequest } from '../types/customer.types';
import type { SupplierDetail, SupplierListItem } from '../types/supplier.types';
import type { CreateSupplierRequest, UpdateSupplierRequest } from '../types/supplier.types';
import type { Carrier, CreateCarrierRequest, UpdateCarrierRequest } from '../types/carrier.types';
import type {
  BankAccount,
  BankAccountRequest,
  CashSummary,
  ChangePasswordRequest,
  Country,
  CreateUserRequest,
  ExpenseDetail,
  ExpenseListItem,
  ExpenseRequest,
  ItemListItem,
  ItemRequest,
  ItemStock,
  MoneyTransaction,
  Organization,
  OrganizationLogoUploadResponse,
  OrganizationRequest,
  PaymentDetail,
  PaymentListItem,
  PaymentOutRequest,
  PosBillingRequest,
  PurchaseDetail,
  PurchaseListItem,
  PurchaseRequest,
  PurchaseReturnDetail,
  PurchaseReturnListItem,
  PurchaseReturnRequest,
  Role,
  RoleRequest,
  SaleDetail,
  SaleInvoice,
  SaleListItem,
  SaleRequest,
  SimpleMaster,
  SimpleMasterRequest,
  State,
  StockAdjustmentDetail,
  StockAdjustmentListItem,
  StockAdjustmentRequest,
  StockTransferDetail,
  StockTransferListItem,
  StockTransferRequest,
  Unit,
  UnitRequest,
  UpdateProfileRequest,
  UpdateOrganizationRequest,
  UpdateUserRequest,
  UserListItem,
  UserProfile,
  Warehouse,
  WarehouseRequest,
} from '../types/api.types';

export type {
  BankAccount,
  BankAccountRequest,
  CashSummary,
  ChangePasswordRequest,
  Country,
  CreateUserRequest,
  ExpenseDetail,
  ExpenseListItem,
  ExpenseRequest,
  ItemListItem,
  ItemRequest,
  ItemStock,
  MoneyTransaction,
  Organization,
  OrganizationAddress,
  OrganizationLogoUploadResponse,
  OrganizationRequest,
  PaymentDetail,
  PaymentListItem,
  PaymentOutRequest,
  PosBillingRequest,
  PurchaseDetail,
  PurchaseListItem,
  PurchaseRequest,
  PurchaseReturnDetail,
  PurchaseReturnListItem,
  PurchaseReturnRequest,
  Role,
  RoleRequest,
  SaleDetail,
  SaleInvoice,
  SaleListItem,
  SaleRequest,
  SimpleMaster,
  SimpleMasterRequest,
  State,
  StockAdjustmentDetail,
  StockAdjustmentListItem,
  StockAdjustmentRequest,
  StockTransferDetail,
  StockTransferListItem,
  StockTransferRequest,
  Unit,
  UnitRequest,
  UpdateProfileRequest,
  UpdateOrganizationRequest,
  UpdateUserRequest,
  UserListItem,
  UserProfile,
  Warehouse,
  WarehouseRequest,
} from '../types/api.types';

const normalizeLocationResponse = <T,>(response: ApiResponse<T[]> | T[]): ApiResponse<T[]> => {
  if (Array.isArray(response)) {
    return {
      success: true,
      message: '',
      data: response,
      timestamp: new Date().toISOString(),
    };
  }
  return response;
};

export const authApi = {
  login: (payload: LoginRequest) =>
    axiosClient.post<ApiResponse<LoginResponse>, ApiResponse<LoginResponse>>('/api/v1/auth/login', payload),
};

export const locationApi = {
  getCountries: async () =>
    normalizeLocationResponse(await axiosClient.get<ApiResponse<Country[]> | Country[], ApiResponse<Country[]> | Country[]>('/api/v1/countries')),
  getStates: async (countryId: number) =>
    normalizeLocationResponse(await axiosClient.get<ApiResponse<State[]> | State[], ApiResponse<State[]> | State[]>('/api/v1/states', { params: { countryId } })),
};

const normalizeOrganizationList = (response: ApiResponse<Organization[] | PageResponse<Organization>> | Organization[]) => {
  if (Array.isArray(response)) {
    return {
      success: true,
      message: '',
      data: { content: response, page: 0, size: response.length, totalElements: response.length, totalPages: 1, last: true } as PageResponse<Organization>,
      timestamp: new Date().toISOString(),
    };
  }
  const data: any = response.data;
  if (Array.isArray(data)) {
    return { ...response, data: { content: data, page: 0, size: data.length, totalElements: data.length, totalPages: 1, last: true } as PageResponse<Organization> };
  }
  return response as ApiResponse<PageResponse<Organization>>;
};

export const organizationApi = {
  getAll: async (search = '') =>
    normalizeOrganizationList(await axiosClient.get<ApiResponse<Organization[] | PageResponse<Organization>> | Organization[], ApiResponse<Organization[] | PageResponse<Organization>> | Organization[]>('/api/v1/organizations', { params: { search } })),
  create: (payload: OrganizationRequest) =>
    axiosClient.post<ApiResponse<void>, ApiResponse<void>>('/api/v1/organizations', payload),
  update: (id: number, payload: UpdateOrganizationRequest) =>
    axiosClient.put<ApiResponse<void>, ApiResponse<void>>(`/api/v1/organizations/${id}`, payload),
  delete: (id: number) =>
    axiosClient.delete<ApiResponse<void>, ApiResponse<void>>(`/api/v1/organizations/${id}`),
  uploadLogo: (id: number, file: File) => {
    const formData = new FormData();
    formData.append('file', file);
    return axiosClient.post<ApiResponse<OrganizationLogoUploadResponse>, ApiResponse<OrganizationLogoUploadResponse>>(`/api/v1/organizations/${id}/logo`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
  },
};

export const customerApi = {
  getAll: (params?: any) =>
    axiosClient.get<ApiResponse<PageResponse<CustomerListItem>>, ApiResponse<PageResponse<CustomerListItem>>>('/api/v1/customers', { params }),
  getById: (id: number) =>
    axiosClient.get<ApiResponse<CustomerDetail>, ApiResponse<CustomerDetail>>(`/api/v1/customers/${id}`),
  create: (payload: CreateCustomerRequest) =>
    axiosClient.post<ApiResponse<void>, ApiResponse<void>>('/api/v1/customers', payload),
  update: (id: number, payload: UpdateCustomerRequest) =>
    axiosClient.put<ApiResponse<void>, ApiResponse<void>>(`/api/v1/customers/${id}`, payload),
  delete: (id: number) =>
    axiosClient.delete<ApiResponse<void>, ApiResponse<void>>(`/api/v1/customers/${id}`),
};

export const supplierApi = {
  getAll: (params?: any) =>
    axiosClient.get<ApiResponse<PageResponse<SupplierListItem>>, ApiResponse<PageResponse<SupplierListItem>>>('/api/v1/suppliers', { params }),
  getById: (id: number) =>
    axiosClient.get<ApiResponse<SupplierDetail>, ApiResponse<SupplierDetail>>(`/api/v1/suppliers/${id}`),
  create: (payload: CreateSupplierRequest) =>
    axiosClient.post<ApiResponse<void>, ApiResponse<void>>('/api/v1/suppliers', payload),
  update: (id: number, payload: UpdateSupplierRequest) =>
    axiosClient.put<ApiResponse<void>, ApiResponse<void>>(`/api/v1/suppliers/${id}`, payload),
  delete: (id: number) =>
    axiosClient.delete<ApiResponse<void>, ApiResponse<void>>(`/api/v1/suppliers/${id}`),
};

export const carrierApi = {
  getAll: (params?: any) =>
    axiosClient.get<ApiResponse<PageResponse<Carrier>>, ApiResponse<PageResponse<Carrier>>>('/api/v1/carriers', { params }),
  getById: (id: number) =>
    axiosClient.get<ApiResponse<Carrier>, ApiResponse<Carrier>>(`/api/v1/carriers/${id}`),
  create: (payload: CreateCarrierRequest) =>
    axiosClient.post<ApiResponse<void>, ApiResponse<void>>('/api/v1/carriers', payload),
  update: (id: number, payload: UpdateCarrierRequest) =>
    axiosClient.put<ApiResponse<void>, ApiResponse<void>>(`/api/v1/carriers/${id}`, payload),
  delete: (id: number) =>
    axiosClient.delete<ApiResponse<void>, ApiResponse<void>>(`/api/v1/carriers/${id}`),
};

export const dashboardApi = {
  getSummary: () =>
    axiosClient.get<ApiResponse>('/api/v1/dashboard/summary'),
};

export const itemApi = {
  getAll: (params?: any) =>
    axiosClient.get<ApiResponse<PageResponse<ItemListItem>>, ApiResponse<PageResponse<ItemListItem>>>('/api/v1/items', { params }),
  getById: (id: number) =>
    axiosClient.get<ApiResponse<ItemListItem>, ApiResponse<ItemListItem>>(`/api/v1/items/${id}`),
  getStock: (id: number) =>
    axiosClient.get<ApiResponse<ItemStock>, ApiResponse<ItemStock>>(`/api/v1/items/${id}/stock`),
  create: (payload: ItemRequest) =>
    axiosClient.post<ApiResponse<void>, ApiResponse<void>>('/api/v1/items', payload),
  update: (id: number, payload: ItemRequest) =>
    axiosClient.put<ApiResponse<void>, ApiResponse<void>>(`/api/v1/items/${id}`, payload),
  delete: (id: number) =>
    axiosClient.delete<ApiResponse<void>, ApiResponse<void>>(`/api/v1/items/${id}`),
};

const normalizeMasterList = (response: ApiResponse<SimpleMaster[] | PageResponse<SimpleMaster>>) => {
  const data: any = response.data;
  if (Array.isArray(data)) return { ...response, data: { content: data, page: 0, size: data.length, totalElements: data.length, totalPages: 1, last: true } as PageResponse<SimpleMaster> };
  return response as ApiResponse<PageResponse<SimpleMaster>>;
};

const normalizeUnitList = (response: ApiResponse<Unit[] | PageResponse<Unit>> | Unit[]) => {
  if (Array.isArray(response)) return { success: true, message: '', data: { content: response, page: 0, size: response.length, totalElements: response.length, totalPages: 1, last: true } as PageResponse<Unit>, timestamp: new Date().toISOString() };
  const data: any = response.data;
  if (Array.isArray(data)) return { ...response, data: { content: data, page: 0, size: data.length, totalElements: data.length, totalPages: 1, last: true } as PageResponse<Unit> };
  return response as ApiResponse<PageResponse<Unit>>;
};

export const categoryApi = {
  getAll: async (params?: any) => normalizeMasterList(await axiosClient.get<ApiResponse<SimpleMaster[] | PageResponse<SimpleMaster>>, ApiResponse<SimpleMaster[] | PageResponse<SimpleMaster>>>('/api/v1/categories', { params })),
  create: (payload: SimpleMasterRequest) => axiosClient.post<ApiResponse<void>, ApiResponse<void>>('/api/v1/categories', payload),
  update: (id: number, payload: SimpleMasterRequest) => axiosClient.put<ApiResponse<void>, ApiResponse<void>>(`/api/v1/categories/${id}`, payload),
  delete: (id: number) => axiosClient.delete<ApiResponse<void>, ApiResponse<void>>(`/api/v1/categories/${id}`),
};

export const brandApi = {
  getAll: async (params?: any) => normalizeMasterList(await axiosClient.get<ApiResponse<SimpleMaster[] | PageResponse<SimpleMaster>>, ApiResponse<SimpleMaster[] | PageResponse<SimpleMaster>>>('/api/v1/brands', { params })),
  create: (payload: SimpleMasterRequest) => axiosClient.post<ApiResponse<void>, ApiResponse<void>>('/api/v1/brands', payload),
  update: (id: number, payload: SimpleMasterRequest) => axiosClient.put<ApiResponse<void>, ApiResponse<void>>(`/api/v1/brands/${id}`, payload),
  delete: (id: number) => axiosClient.delete<ApiResponse<void>, ApiResponse<void>>(`/api/v1/brands/${id}`),
};

export const unitApi = {
  getAll: async (params?: any) => normalizeUnitList(await axiosClient.get<ApiResponse<Unit[] | PageResponse<Unit>> | Unit[], ApiResponse<Unit[] | PageResponse<Unit>> | Unit[]>('/api/v1/units', { params })),
  create: (payload: UnitRequest) => axiosClient.post<ApiResponse<void>, ApiResponse<void>>('/api/v1/units', payload),
  update: (id: number, payload: UnitRequest) => axiosClient.put<ApiResponse<void>, ApiResponse<void>>(`/api/v1/units/${id}`, payload),
  delete: (id: number) => axiosClient.delete<ApiResponse<void>, ApiResponse<void>>(`/api/v1/units/${id}`),
};

export const warehouseApi = {
  getAll: (search = '') =>
    axiosClient.get<ApiResponse<Warehouse[]>, ApiResponse<Warehouse[]>>('/api/v1/warehouses', { params: { search } }),
  create: (payload: WarehouseRequest) =>
    axiosClient.post<ApiResponse<void>, ApiResponse<void>>('/api/v1/warehouses', payload),
  update: (id: number, payload: WarehouseRequest) =>
    axiosClient.put<ApiResponse<void>, ApiResponse<void>>(`/api/v1/warehouses/${id}`, payload),
  delete: (id: number) =>
    axiosClient.delete<ApiResponse<void>, ApiResponse<void>>(`/api/v1/warehouses/${id}`),
};

export const excelImportApi = {
  downloadContactsTemplate: () =>
    axiosClient.get<Blob, Blob>('/api/v1/contacts/excel/template', { responseType: 'blob' }),
  importContacts: (file: File) => {
    const formData = new FormData();
    formData.append('file', file);
    return axiosClient.post<ApiResponse<void>, ApiResponse<void>>('/api/v1/contacts/excel/import', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
  },
  downloadItemsTemplate: () =>
    axiosClient.get<Blob, Blob>('/api/v1/items/excel/template', { responseType: 'blob' }),
  importItems: (file: File, warehouseId: number, baseUnitId: number) => {
    const formData = new FormData();
    formData.append('file', file);
    return axiosClient.post<ApiResponse<void>, ApiResponse<void>>('/api/v1/items/excel/import', formData, {
      params: { warehouseId, baseUnitId },
      headers: { 'Content-Type': 'multipart/form-data' },
    });
  },
};

export const usersApi = {
  getAll: async (params?: any) => normalizeUserList(await axiosClient.get<ApiResponse<UserListItem[] | PageResponse<UserListItem>> | UserListItem[], ApiResponse<UserListItem[] | PageResponse<UserListItem>> | UserListItem[]>('/api/v1/users', { params })),
  create: (payload: CreateUserRequest) =>
    axiosClient.post<ApiResponse<void>, ApiResponse<void>>('/api/v1/users', payload),
  update: (id: number, payload: UpdateUserRequest) =>
    axiosClient.put<ApiResponse<void>, ApiResponse<void>>(`/api/v1/users/${id}`, payload),
  delete: (id: number) =>
    axiosClient.delete<ApiResponse<void>, ApiResponse<void>>(`/api/v1/users/${id}`),
  getProfile: () =>
    axiosClient.get<ApiResponse<UserProfile>, ApiResponse<UserProfile>>('/api/v1/users/profile'),
  updateProfile: (payload: UpdateProfileRequest) =>
    axiosClient.put<ApiResponse<void>, ApiResponse<void>>('/api/v1/users/update-profile', payload),
  changePassword: (payload: ChangePasswordRequest) =>
    axiosClient.put<ApiResponse<void>, ApiResponse<void>>('/api/v1/users/change-password', payload),
};

const normalizeUserList = (response: ApiResponse<UserListItem[] | PageResponse<UserListItem>> | UserListItem[]) => {
  if (Array.isArray(response)) return { success: true, message: '', data: { content: response, page: 0, size: response.length, totalElements: response.length, totalPages: 1, last: true } as PageResponse<UserListItem>, timestamp: new Date().toISOString() };
  const data: any = response.data;
  if (Array.isArray(data)) return { ...response, data: { content: data, page: 0, size: data.length, totalElements: data.length, totalPages: 1, last: true } as PageResponse<UserListItem> };
  return response as ApiResponse<PageResponse<UserListItem>>;
};

const normalizeRoleList = (response: ApiResponse<Role[] | PageResponse<Role>>) => {
  const data: any = response.data;
  if (Array.isArray(data)) return { ...response, data: { content: data, page: 0, size: data.length, totalElements: data.length, totalPages: 1, last: true } as PageResponse<Role> };
  return response as ApiResponse<PageResponse<Role>>;
};

export const rolesApi = {
  getAll: async (search = '') =>
    normalizeRoleList(await axiosClient.get<ApiResponse<Role[] | PageResponse<Role>>, ApiResponse<Role[] | PageResponse<Role>>>('/api/v1/roles', { params: { search } })),
  getByOrganizationId: async (organizationId: number) =>
    normalizeRoleList(await axiosClient.get<ApiResponse<Role[]>, ApiResponse<Role[]>>(`/api/v1/roles/organization/${organizationId}`)),
  getById: (id: number) =>
    axiosClient.get<ApiResponse<Role>, ApiResponse<Role>>(`/api/v1/roles/${id}`),
  create: (payload: RoleRequest) =>
    axiosClient.post<ApiResponse<void>, ApiResponse<void>>('/api/v1/roles', payload),
  update: (id: number, payload: RoleRequest) =>
    axiosClient.put<ApiResponse<void>, ApiResponse<void>>(`/api/v1/roles/${id}`, payload),
  delete: (id: number) =>
    axiosClient.delete<ApiResponse<void>, ApiResponse<void>>(`/api/v1/roles/${id}`),
};

export const posApi = {
  createBill: (payload: PosBillingRequest) =>
    axiosClient.post<ApiResponse<void>, ApiResponse<void>>('/api/v1/pos/billing', payload),
};

export const salesApi = {
  getAll: (params?: any) => axiosClient.get<ApiResponse<PageResponse<SaleListItem>>, ApiResponse<PageResponse<SaleListItem>>>('/api/v1/sales', { params }),
  getById: (id: number) => axiosClient.get<ApiResponse<SaleDetail>, ApiResponse<SaleDetail>>(`/api/v1/sales/${id}`),
  create: (payload: SaleRequest) => axiosClient.post<ApiResponse<void>, ApiResponse<void>>('/api/v1/sales', payload),
  update: (id: number, payload: SaleRequest) => axiosClient.put<ApiResponse<void>, ApiResponse<void>>(`/api/v1/sales/${id}`, payload),
  cancel: (id: number) => axiosClient.put<ApiResponse<void>, ApiResponse<void>>(`/api/v1/sales/${id}/cancel`),
  getInvoice: (id: number) => axiosClient.get<ApiResponse<SaleInvoice>, ApiResponse<SaleInvoice>>(`/api/v1/sales/${id}/invoice`),
};

export const paymentInApi = {
  getAll: (params?: any) =>
    axiosClient.get<ApiResponse<PageResponse<PaymentListItem>>, ApiResponse<PageResponse<PaymentListItem>>>('/api/v1/payment-in', { params }),
  getById: (id: number) =>
    axiosClient.get<ApiResponse<PaymentDetail>, ApiResponse<PaymentDetail>>(`/api/v1/payment-in/${id}`),
};

export const purchaseApi = {
  getAll: (params?: any) =>
    axiosClient.get<ApiResponse<PageResponse<PurchaseListItem>>, ApiResponse<PageResponse<PurchaseListItem>>>('/api/v1/purchases', { params }),
  getById: (id: number) =>
    axiosClient.get<ApiResponse<PurchaseDetail>, ApiResponse<PurchaseDetail>>(`/api/v1/purchases/${id}`),
  create: (payload: PurchaseRequest) =>
    axiosClient.post<ApiResponse<void>, ApiResponse<void>>('/api/v1/purchases', payload),
  update: (id: number, payload: PurchaseRequest) =>
    axiosClient.put<ApiResponse<void>, ApiResponse<void>>(`/api/v1/purchases/${id}`, payload),
  cancel: (id: number) =>
    axiosClient.put<ApiResponse<void>, ApiResponse<void>>(`/api/v1/purchases/${id}/cancel`),
};

export const paymentOutApi = {
  getAll: (params?: any) =>
    axiosClient.get<ApiResponse<PageResponse<PaymentListItem>>, ApiResponse<PageResponse<PaymentListItem>>>('/api/v1/payment-out', { params }),
  getById: (id: number) =>
    axiosClient.get<ApiResponse<PaymentDetail>, ApiResponse<PaymentDetail>>(`/api/v1/payment-out/${id}`),
  create: (payload: PaymentOutRequest) =>
    axiosClient.post<ApiResponse<void>, ApiResponse<void>>('/api/v1/payment-out', payload),
};

export const purchaseReturnApi = {
  getAll: (params?: any) =>
    axiosClient.get<ApiResponse<PageResponse<PurchaseReturnListItem>>, ApiResponse<PageResponse<PurchaseReturnListItem>>>('/api/v1/purchase-returns', { params }),
  getById: (id: number) =>
    axiosClient.get<ApiResponse<PurchaseReturnDetail>, ApiResponse<PurchaseReturnDetail>>(`/api/v1/purchase-returns/${id}`),
  create: (payload: PurchaseReturnRequest) =>
    axiosClient.post<ApiResponse<void>, ApiResponse<void>>('/api/v1/purchase-returns', payload),
};

export const stockTransferApi = {
  getAll: (params?: any) =>
    axiosClient.get<ApiResponse<PageResponse<StockTransferListItem>>, ApiResponse<PageResponse<StockTransferListItem>>>('/api/v1/stocks/transfers', { params }),
  getById: (id: number) =>
    axiosClient.get<ApiResponse<StockTransferDetail>, ApiResponse<StockTransferDetail>>(`/api/v1/stocks/transfers/${id}`),
  create: (payload: StockTransferRequest) =>
    axiosClient.post<ApiResponse<void>, ApiResponse<void>>('/api/v1/stocks/transfers', payload),
};

export const stockAdjustmentApi = {
  getAll: (params?: any) =>
    axiosClient.get<ApiResponse<PageResponse<StockAdjustmentListItem>>, ApiResponse<PageResponse<StockAdjustmentListItem>>>('/api/v1/stocks/adjustments', { params }),
  getById: (id: number) =>
    axiosClient.get<ApiResponse<StockAdjustmentDetail>, ApiResponse<StockAdjustmentDetail>>(`/api/v1/stocks/adjustments/${id}`),
  create: (payload: StockAdjustmentRequest) =>
    axiosClient.post<ApiResponse<void>, ApiResponse<void>>('/api/v1/stocks/adjustments', payload),
};

export const expenseApi = {
  getAll: (params?: any) =>
    axiosClient.get<ApiResponse<PageResponse<ExpenseListItem>>, ApiResponse<PageResponse<ExpenseListItem>>>('/api/v1/expenses', { params }),
  getById: (id: number) =>
    axiosClient.get<ApiResponse<ExpenseDetail>, ApiResponse<ExpenseDetail>>(`/api/v1/expenses/${id}`),
  create: (payload: ExpenseRequest) =>
    axiosClient.post<ApiResponse<void>, ApiResponse<void>>('/api/v1/expenses', payload),
  update: (id: number, payload: ExpenseRequest) =>
    axiosClient.put<ApiResponse<void>, ApiResponse<void>>(`/api/v1/expenses/${id}`, payload),
  delete: (id: number) =>
    axiosClient.delete<ApiResponse<void>, ApiResponse<void>>(`/api/v1/expenses/${id}`),
};

const normalizeArray = <T,>(response: ApiResponse<T[] | PageResponse<T>>) => {
  const data: any = response.data;
  if (Array.isArray(data)) return { ...response, data: { content: data, page: 0, size: data.length, totalElements: data.length, totalPages: 1, last: true } as PageResponse<T> };
  return response as ApiResponse<PageResponse<T>>;
};

export const bankAccountApi = {
  getAll: async () => normalizeArray(await axiosClient.get<ApiResponse<BankAccount[] | PageResponse<BankAccount>>, ApiResponse<BankAccount[] | PageResponse<BankAccount>>>('/api/v1/bank-accounts')),
  create: (payload: BankAccountRequest) => axiosClient.post<ApiResponse<void>, ApiResponse<void>>('/api/v1/bank-accounts', payload),
  getTransactions: async (id: number) => normalizeArray(await axiosClient.get<ApiResponse<MoneyTransaction[] | PageResponse<MoneyTransaction>>, ApiResponse<MoneyTransaction[] | PageResponse<MoneyTransaction>>>(`/api/v1/bank-accounts/${id}/transactions`)),
};

export const cashApi = {
  getSummary: () => axiosClient.get<ApiResponse<CashSummary>, ApiResponse<CashSummary>>('/api/v1/cash/summary'),
  getTransactions: async () => normalizeArray(await axiosClient.get<ApiResponse<MoneyTransaction[] | PageResponse<MoneyTransaction>>, ApiResponse<MoneyTransaction[] | PageResponse<MoneyTransaction>>>('/api/v1/cash/transactions')),
};

export const reportsApi = {
  topSellingItems: () => axiosClient.get<ApiResponse<any>, ApiResponse<any>>('/api/v1/reports/top-selling-items'),
  supplierLedger: (supplierId: number) => axiosClient.get<ApiResponse<any>, ApiResponse<any>>(`/api/v1/reports/supplier-ledger/${supplierId}`),
  stocks: () => axiosClient.get<ApiResponse<any>, ApiResponse<any>>('/api/v1/reports/stocks'),
  sales: (params?: any) => axiosClient.get<ApiResponse<any>, ApiResponse<any>>('/api/v1/reports/sales', { params }),
  purchases: (params?: any) => axiosClient.get<ApiResponse<any>, ApiResponse<any>>('/api/v1/reports/purchases', { params }),
  profitLoss: (params?: any) => axiosClient.get<ApiResponse<any>, ApiResponse<any>>('/api/v1/reports/profit-loss', { params }),
  lowStock: () => axiosClient.get<ApiResponse<any>, ApiResponse<any>>('/api/v1/reports/low-stock'),
  inventoryValuation: () => axiosClient.get<ApiResponse<any>, ApiResponse<any>>('/api/v1/reports/inventory-valuation'),
  gst: (params?: any) => axiosClient.get<ApiResponse<any>, ApiResponse<any>>('/api/v1/reports/gst', { params }),
  dayBook: (params?: any) => axiosClient.get<ApiResponse<any>, ApiResponse<any>>('/api/v1/reports/day-book', { params }),
  customerLedger: (customerId: number) => axiosClient.get<ApiResponse<any>, ApiResponse<any>>(`/api/v1/reports/customer-ledger/${customerId}`),
};
