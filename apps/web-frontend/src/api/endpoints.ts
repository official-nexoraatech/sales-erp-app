import { apiClient } from './client.js';

// ── Auth ──────────────────────────────────────────────────────────────────────
export const authApi = {
  login: (data: { email: string; password: string; tenantId: number }) =>
    apiClient.post<{ accessToken: string; refreshToken: string }>('auth', '/auth/login', data),
  me: () => apiClient.get<{ id: number; tenantId: number; email: string; firstName: string; lastName: string }>('auth', '/users/me'),
  updateMe: (data: Record<string, unknown>) => apiClient.put('auth', '/users/me', data),
  changePassword: (data: { currentPassword: string; newPassword: string }) => apiClient.put('auth', '/users/me/password', data),
};

// ── Organization ──────────────────────────────────────────────────────────────
export const organizationApi = {
  get: () => apiClient.get('tenant', '/organization'),
  update: (data: Record<string, unknown>) => apiClient.put('tenant', '/organization', data),
  uploadLogoUrl: (data: { fileName: string; contentType: string }) => apiClient.post('tenant', '/organization/logo/upload', data),
};

// ── Branches ──────────────────────────────────────────────────────────────────
export const branchApi = {
  list: () => apiClient.get<{ content: unknown[] }>('tenant', '/branches'),
  getById: (id: number) => apiClient.get('tenant', `/branches/${id}`),
  create: (data: Record<string, unknown>) => apiClient.post('tenant', '/branches', data),
  update: (id: number, data: Record<string, unknown>) => apiClient.put('tenant', `/branches/${id}`, data),
  delete: (id: number) => apiClient.delete('tenant', `/branches/${id}`),
};

// ── Warehouses ────────────────────────────────────────────────────────────────
export const warehouseApi = {
  list: (params?: { branchId?: number }) =>
    apiClient.get<{ content: unknown[] }>('inventory', `/warehouses${params?.branchId ? `?branchId=${params.branchId}` : ''}`),
  getById: (id: number) => apiClient.get('inventory', `/warehouses/${id}`),
  create: (data: Record<string, unknown>) => apiClient.post('inventory', '/warehouses', data),
  update: (id: number, data: Record<string, unknown>) => apiClient.put('inventory', `/warehouses/${id}`, data),
  delete: (id: number) => apiClient.delete('inventory', `/warehouses/${id}`),
};

// ── Users ─────────────────────────────────────────────────────────────────────
export const userApi = {
  list: () => apiClient.get<{ content: unknown[] }>('auth', '/users'),
  getById: (id: number) => apiClient.get('auth', `/users/${id}`),
  create: (data: Record<string, unknown>) => apiClient.post('auth', '/users', data),
  update: (id: number, data: Record<string, unknown>) => apiClient.put('auth', `/users/${id}`, data),
  delete: (id: number) => apiClient.delete('auth', `/users/${id}`),
  resetPassword: (id: number, data: { newPassword: string }) => apiClient.post('auth', `/users/${id}/reset-password`, data),
  lock: (id: number) => apiClient.post('auth', `/users/${id}/lock`),
  unlock: (id: number) => apiClient.post('auth', `/users/${id}/unlock`),
  assignBranches: (id: number, data: { branchIds: number[]; primaryBranchId?: number }) =>
    apiClient.put('auth', `/users/${id}/branches`, data),
};

// ── Customers ─────────────────────────────────────────────────────────────────
export const customerApi = {
  list: (params?: { page?: number; size?: number; search?: string | undefined; status?: string | undefined; customerType?: string | undefined }) => {
    const qs = new URLSearchParams();
    if (params?.page !== undefined) qs.set('page', String(params.page));
    if (params?.size !== undefined) qs.set('size', String(params.size));
    if (params?.search) qs.set('search', params.search);
    if (params?.status) qs.set('status', params.status);
    if (params?.customerType) qs.set('customerType', params.customerType);
    return apiClient.get<{ content: unknown[]; totalElements: number; page: number; size: number }>('sales', `/customers?${qs}`);
  },
  getById: (id: number) => apiClient.get('sales', `/customers/${id}`),
  statement: (id: number) => apiClient.get('sales', `/customers/${id}/statement`),
  outstanding: (id: number) => apiClient.get('sales', `/customers/${id}/outstanding`),
  activity: (id: number) => apiClient.get('sales', `/customers/${id}/activity`),
  create: (data: Record<string, unknown>) => apiClient.post('sales', '/customers', data),
  update: (id: number, data: Record<string, unknown>) => apiClient.put('sales', `/customers/${id}`, data),
  delete: (id: number) => apiClient.delete('sales', `/customers/${id}`),
  merge: (data: { sourceId: number; targetId: number }) => apiClient.post('sales', '/customers/merge', data),
};

// ── Suppliers ─────────────────────────────────────────────────────────────────
export const supplierApi = {
  list: (params?: { page?: number; size?: number; search?: string | undefined; status?: string | undefined }) => {
    const qs = new URLSearchParams();
    if (params?.page !== undefined) qs.set('page', String(params.page));
    if (params?.size !== undefined) qs.set('size', String(params.size));
    if (params?.search) qs.set('search', params.search);
    if (params?.status) qs.set('status', params.status);
    return apiClient.get<{ content: unknown[]; totalElements: number }>('sales', `/suppliers?${qs}`);
  },
  getById: (id: number) => apiClient.get('sales', `/suppliers/${id}`),
  statement: (id: number) => apiClient.get('sales', `/suppliers/${id}/statement`),
  create: (data: Record<string, unknown>) => apiClient.post('sales', '/suppliers', data),
  update: (id: number, data: Record<string, unknown>) => apiClient.put('sales', `/suppliers/${id}`, data),
  delete: (id: number) => apiClient.delete('sales', `/suppliers/${id}`),
};

// ── Categories ────────────────────────────────────────────────────────────────
export const categoryApi = {
  list: () => apiClient.get<{ content: unknown[] }>('inventory', '/categories'),
  create: (data: Record<string, unknown>) => apiClient.post('inventory', '/categories', data),
  update: (id: number, data: Record<string, unknown>) => apiClient.put('inventory', `/categories/${id}`, data),
  delete: (id: number) => apiClient.delete('inventory', `/categories/${id}`),
};

// ── Brands ────────────────────────────────────────────────────────────────────
export const brandApi = {
  list: () => apiClient.get<{ content: unknown[] }>('inventory', '/brands'),
  create: (data: Record<string, unknown>) => apiClient.post('inventory', '/brands', data),
  update: (id: number, data: Record<string, unknown>) => apiClient.put('inventory', `/brands/${id}`, data),
  delete: (id: number) => apiClient.delete('inventory', `/brands/${id}`),
};

// ── Units ─────────────────────────────────────────────────────────────────────
export const unitApi = {
  list: () => apiClient.get<{ content: unknown[] }>('inventory', '/units'),
  create: (data: Record<string, unknown>) => apiClient.post('inventory', '/units', data),
  update: (id: number, data: Record<string, unknown>) => apiClient.put('inventory', `/units/${id}`, data),
};

// ── Items ─────────────────────────────────────────────────────────────────────
export const itemApi = {
  list: (params?: { page?: number; size?: number; search?: string | undefined; categoryId?: number | undefined; brandId?: number | undefined; status?: string | undefined }) => {
    const qs = new URLSearchParams();
    if (params?.page !== undefined) qs.set('page', String(params.page));
    if (params?.size !== undefined) qs.set('size', String(params.size));
    if (params?.search) qs.set('search', params.search);
    if (params?.categoryId) qs.set('categoryId', String(params.categoryId));
    if (params?.brandId) qs.set('brandId', String(params.brandId));
    if (params?.status) qs.set('status', params.status);
    return apiClient.get<{ content: unknown[]; totalElements: number }>('inventory', `/items?${qs}`);
  },
  getById: (id: number) => apiClient.get('inventory', `/items/${id}`),
  byBarcode: (barcode: string) => apiClient.get('inventory', `/items/by-barcode/${barcode}`),
  stock: (id: number) => apiClient.get('inventory', `/items/${id}/stock`),
  priceHistory: (id: number) => apiClient.get('inventory', `/items/${id}/price-history`),
  create: (data: Record<string, unknown>) => apiClient.post('inventory', '/items', data),
  update: (id: number, data: Record<string, unknown>) => apiClient.put('inventory', `/items/${id}`, data),
  delete: (id: number) => apiClient.delete('inventory', `/items/${id}`),
  addVariants: (id: number, variants: unknown[]) => apiClient.post('inventory', `/items/${id}/variants`, variants),
  generateBarcode: (id: number, type?: string) => apiClient.post('inventory', `/items/${id}/barcode/generate`, { type }),
};

// ── Price Lists ───────────────────────────────────────────────────────────────
export const priceListApi = {
  list: () => apiClient.get<{ content: unknown[] }>('inventory', '/price-lists'),
  create: (data: Record<string, unknown>) => apiClient.post('inventory', '/price-lists', data),
  updateItems: (id: number, items: unknown[]) => apiClient.put('inventory', `/price-lists/${id}/items`, items),
};

// ── GST ───────────────────────────────────────────────────────────────────────
export const gstApi = {
  rates: () => apiClient.get<{ content: unknown[] }>('gst', '/gst/rates'),
  seedRates: () => apiClient.post('gst', '/gst/seed-rates'),
  validateHsn: (hsnCode: string) => apiClient.post('gst', '/gst/validate-hsn', { hsnCode }),
  searchHsn: (q: string) => apiClient.get<{ content: unknown[] }>('gst', `/gst/hsn/search?q=${encodeURIComponent(q)}`),
  compute: (data: { taxableAmount: number; gstRate: number; cessRate?: number; isInterstate: boolean }) =>
    apiClient.post('gst', '/gst/compute', data),

  // M7.1 GST Ledger
  register: (period: string, type: 'SALES' | 'PURCHASE' | 'ALL' = 'ALL') =>
    apiClient.get<{ content: unknown[]; totalElements: number; period: string }>('gst', `/gst/register?period=${period}&type=${type}`),
  summary: (period: string) =>
    apiClient.get<Record<string, unknown>>('gst', `/gst/summary?period=${period}`),

  // M7.2 GSTR-1
  gstr1: (period: string) =>
    apiClient.get<{ period: string; sections: Record<string, unknown>; validationErrors: string[]; isExportReady: boolean }>('gst', `/gst/gstr1?period=${period}`),
  exportGstr1: (period: string, format: 'JSON' | 'EXCEL' = 'JSON', gstin?: string) =>
    apiClient.post('gst', `/gst/gstr1/export?period=${period}&format=${format}`, gstin ? { gstin } : {}),

  // M7.3 GSTR-3B
  gstr3b: (period: string) =>
    apiClient.get<Record<string, unknown>>('gst', `/gst/gstr3b?period=${period}`),
  exportGstr3b: (period: string) =>
    apiClient.post('gst', `/gst/gstr3b/export?period=${period}`),

  // M7.4 e-Invoice
  generateIrn: (invoiceId: number, payload: Record<string, unknown>) =>
    apiClient.post('gst', `/gst/einvoice/generate/${invoiceId}`, { invoiceId, payload }),
  cancelIrn: (invoiceId: number, reason: string, remark?: string) =>
    apiClient.post('gst', `/gst/einvoice/cancel/${invoiceId}`, { reason, remark }),
  einvoiceStatus: (invoiceId: number) =>
    apiClient.get<Record<string, unknown>>('gst', `/gst/einvoice/status/${invoiceId}`),

  // M7.5 e-Way Bill
  generateEwb: (invoiceId: number, payload: Record<string, unknown>) =>
    apiClient.post('gst', '/gst/eway-bill/generate', { invoiceId, payload }),
  ewbExpiringSoon: () =>
    apiClient.get<{ content: unknown[]; totalElements: number }>('gst', '/gst/eway-bill/expiring-soon'),

  // M7.6 GSTR-2A Reconciliation
  importGstr2a: (period: string, entries: unknown[]) =>
    apiClient.post('gst', '/gst/gstr2a/import', { period, entries }),
  gstr2aReconciliation: (period: string) =>
    apiClient.get<Record<string, unknown>>('gst', `/gst/gstr2a/reconciliation?period=${period}`),

  // M7.7 Return Filing Tracker
  returnsCalendar: (fy: string) =>
    apiClient.get<{ fy: string; calendar: unknown[] }>('gst', `/gst/returns/calendar?fy=${fy}`),
  markFiled: (returnType: string, period: string, referenceNumber?: string) =>
    apiClient.post('gst', `/gst/returns/${returnType}/mark-filed`, { period, referenceNumber }),
  returnsStatus: () =>
    apiClient.get<Record<string, unknown>>('gst', '/gst/returns/status'),
};

// ── Chart of Accounts ─────────────────────────────────────────────────────────
export const accountApi = {
  list: () => apiClient.get<{ content: unknown[] }>('accounting', '/accounts'),
  seed: () => apiClient.post('accounting', '/accounts/seed'),
  tree: () => apiClient.get('accounting', '/accounts/tree'),
  getById: (id: number) => apiClient.get('accounting', `/accounts/${id}`),
  ledger: (id: number) => apiClient.get('accounting', `/accounts/${id}/ledger`),
  create: (data: Record<string, unknown>) => apiClient.post('accounting', '/accounts', data),
  update: (id: number, data: Record<string, unknown>) => apiClient.put('accounting', `/accounts/${id}`, data),
  delete: (id: number) => apiClient.delete('accounting', `/accounts/${id}`),
};

// ── Opening Balances ──────────────────────────────────────────────────────────
export const openingBalancesApi = {
  status: () => apiClient.get('accounting', '/opening-balances/status'),
  saveCustomers: (rows: unknown[]) => apiClient.post('accounting', '/opening-balances/customers', rows),
  saveSuppliers: (rows: unknown[]) => apiClient.post('accounting', '/opening-balances/suppliers', rows),
  saveStock: (rows: unknown[]) => apiClient.post('accounting', '/opening-balances/stock', rows),
  saveAccounts: (rows: unknown[]) => apiClient.post('accounting', '/opening-balances/accounts', rows),
  saveCashBank: (rows: unknown[]) => apiClient.post('accounting', '/opening-balances/cash-bank', rows),
  lock: () => apiClient.post('accounting', '/opening-balances/lock'),
};

// ── Stock Levels ──────────────────────────────────────────────────────────────
export const stockApi = {
  list: (params?: { warehouseId?: number | undefined; belowReorder?: boolean | undefined; page?: number; limit?: number }) => {
    const qs = new URLSearchParams();
    if (params?.warehouseId) qs.set('warehouseId', String(params.warehouseId));
    if (params?.belowReorder) qs.set('belowReorder', 'true');
    if (params?.page) qs.set('page', String(params.page));
    if (params?.limit) qs.set('limit', String(params.limit));
    return apiClient.get('inventory', `/inventory/stock?${qs}`);
  },
  byItem: (itemId: number) => apiClient.get('inventory', `/inventory/stock/${itemId}`),
  ledger: (itemId: number, params?: { warehouseId?: number; page?: number; limit?: number }) => {
    const qs = new URLSearchParams();
    if (params?.warehouseId) qs.set('warehouseId', String(params.warehouseId));
    if (params?.page) qs.set('page', String(params.page));
    if (params?.limit) qs.set('limit', String(params.limit));
    return apiClient.get('inventory', `/inventory/ledger/${itemId}?${qs}`);
  },
};

// ── Stock Transfers ───────────────────────────────────────────────────────────
export const stockTransferApi = {
  list: (params?: { page?: number; limit?: number; status?: string | undefined }) => {
    const qs = new URLSearchParams();
    if (params?.page) qs.set('page', String(params.page));
    if (params?.limit) qs.set('limit', String(params.limit));
    if (params?.status) qs.set('status', params.status);
    return apiClient.get('inventory', `/stock-transfers?${qs}`);
  },
  getById: (id: number) => apiClient.get('inventory', `/stock-transfers/${id}`),
  create: (data: Record<string, unknown>) => apiClient.post('inventory', '/stock-transfers', data),
  submit: (id: number) => apiClient.post('inventory', `/stock-transfers/${id}/submit`),
  approve: (id: number) => apiClient.post('inventory', `/stock-transfers/${id}/approve`),
  dispatch: (id: number) => apiClient.post('inventory', `/stock-transfers/${id}/dispatch`),
  receive: (id: number, lines: Array<{ lineId: number; receivedQty: number }>) =>
    apiClient.post('inventory', `/stock-transfers/${id}/receive`, { lines }),
  cancel: (id: number, reason: string) =>
    apiClient.post('inventory', `/stock-transfers/${id}/cancel`, { reason }),
};

// ── Stock Adjustments ─────────────────────────────────────────────────────────
export const stockAdjustmentApi = {
  list: (params?: { page?: number; limit?: number; status?: string | undefined }) => {
    const qs = new URLSearchParams();
    if (params?.page) qs.set('page', String(params.page));
    if (params?.limit) qs.set('limit', String(params.limit));
    if (params?.status) qs.set('status', params.status);
    return apiClient.get('inventory', `/stock-adjustments?${qs}`);
  },
  getById: (id: number) => apiClient.get('inventory', `/stock-adjustments/${id}`),
  create: (data: Record<string, unknown>) => apiClient.post('inventory', '/stock-adjustments', data),
  submit: (id: number) => apiClient.post('inventory', `/stock-adjustments/${id}/submit`),
  approve: (id: number) => apiClient.post('inventory', `/stock-adjustments/${id}/approve`),
  cancel: (id: number, reason: string) =>
    apiClient.post('inventory', `/stock-adjustments/${id}/cancel`, { reason }),
};

// ── Physical Verifications ─────────────────────────────────────────────────────
export const physicalVerifApi = {
  list: (params?: { page?: number; limit?: number }) => {
    const qs = new URLSearchParams();
    if (params?.page) qs.set('page', String(params.page));
    if (params?.limit) qs.set('limit', String(params.limit));
    return apiClient.get('inventory', `/physical-verifications?${qs}`);
  },
  getById: (id: number) => apiClient.get('inventory', `/physical-verifications/${id}`),
  create: (data: Record<string, unknown>) => apiClient.post('inventory', '/physical-verifications', data),
  startCounting: (id: number) =>
    apiClient.post('inventory', `/physical-verifications/${id}/start-counting`),
  updateCounts: (id: number, counts: Array<{ lineId: number; physicalQty: number }>) =>
    apiClient.put('inventory', `/physical-verifications/${id}/counts`, { counts }),
  variances: (id: number) => apiClient.get('inventory', `/physical-verifications/${id}/variances`),
  approve: (id: number) => apiClient.post('inventory', `/physical-verifications/${id}/approve`),
};

// ── Fabric Rolls ──────────────────────────────────────────────────────────────
export const fabricRollApi = {
  list: (itemId?: number) =>
    apiClient.get('inventory', `/fabric-rolls${itemId ? `?itemId=${itemId}` : ''}`),
  receive: (data: Record<string, unknown>) => apiClient.post('inventory', '/fabric-rolls', data),
  cut: (rollId: number, data: Record<string, unknown>) =>
    apiClient.post('inventory', `/fabric-rolls/${rollId}/cut`, data),
  cuts: (rollId: number) => apiClient.get('inventory', `/fabric-rolls/${rollId}/cuts`),
};

// ── Phase 4 — Sales ───────────────────────────────────────────────────────────
export const quotationApi = {
  list: (params?: Record<string, string>) =>
    apiClient.get('sales', `/quotations${params ? `?${new URLSearchParams(params)}` : ''}`),
  getById: (id: number) => apiClient.get('sales', `/quotations/${id}`),
  create: (data: Record<string, unknown>) => apiClient.post('sales', '/quotations', data),
  send: (id: number) => apiClient.post('sales', `/quotations/${id}/send`, {}),
  convert: (id: number) => apiClient.post('sales', `/quotations/${id}/convert`, {}),
  expire: (id: number) => apiClient.post('sales', `/quotations/${id}/expire`, {}),
};

export const invoiceApi = {
  list: (params?: Record<string, string>) =>
    apiClient.get('sales', `/invoices${params ? `?${new URLSearchParams(params)}` : ''}`),
  getById: (id: number) => apiClient.get('sales', `/invoices/${id}`),
  create: (data: Record<string, unknown>) => apiClient.post('sales', '/invoices', data),
  confirm: (id: number, data: { invoiceNumber: string }) => apiClient.post('sales', `/invoices/${id}/confirm`, data),
  cancel: (id: number, data: { reason: string }) => apiClient.post('sales', `/invoices/${id}/cancel`, data),
  duplicate: (id: number) => apiClient.post('sales', `/invoices/${id}/duplicate`, {}),
  activity: (id: number) => apiClient.get('sales', `/invoices/${id}/activity`),
  pdf: (id: number) => apiClient.get('sales', `/invoices/${id}/pdf`),
};

export const paymentApi = {
  list: (params?: Record<string, string>) =>
    apiClient.get('sales', `/payments${params ? `?${new URLSearchParams(params)}` : ''}`),
  getById: (id: number) => apiClient.get('sales', `/payments/${id}`),
  create: (data: Record<string, unknown>) => apiClient.post('sales', '/payments', data),
  allocate: (id: number, data: Record<string, unknown>) => apiClient.post('sales', `/payments/${id}/allocate`, data),
  bounceCheque: (id: number, data: { reason: string }) => apiClient.post('sales', `/payments/${id}/bounce`, data),
  customerOutstanding: (customerId: number) => apiClient.get('sales', `/customers/${customerId}/outstanding`),
};

export const saleReturnApi = {
  list: (params?: Record<string, string>) =>
    apiClient.get('sales', `/sale-returns${params ? `?${new URLSearchParams(params)}` : ''}`),
  getById: (id: number) => apiClient.get('sales', `/sale-returns/${id}`),
  create: (data: Record<string, unknown>) => apiClient.post('sales', '/sale-returns', data),
  applyCreditNote: (id: number, data: { invoiceId: number }) => apiClient.post('sales', `/credit-notes/${id}/apply`, data),
  refundCreditNote: (id: number) => apiClient.post('sales', `/credit-notes/${id}/refund`, {}),
};

export const salesDashboardApi = {
  summary: () => apiClient.get<{ data: { pendingQuotations: number; overdueInvoices: number; collectedToday: number } }>('sales', '/dashboard/sales-summary'),
};

export const deliveryChallanApi = {
  list: (params?: Record<string, string>) =>
    apiClient.get('sales', `/delivery-challans${params ? `?${new URLSearchParams(params)}` : ''}`),
  getById: (id: number) => apiClient.get('sales', `/delivery-challans/${id}`),
  create: (data: Record<string, unknown>) => apiClient.post('sales', '/delivery-challans', data),
  dispatch: (id: number) => apiClient.post('sales', `/delivery-challans/${id}/dispatch`, {}),
  convertToInvoice: (id: number) => apiClient.post('sales', `/delivery-challans/${id}/convert-to-invoice`, {}),
};

export const loyaltyApi = {
  balance: (customerId: number) => apiClient.get('sales', `/customers/${customerId}/loyalty`),
  redeem: (data: Record<string, unknown>) => apiClient.post('sales', '/pos/loyalty/redeem', data),
};

// ── Phase 5 — Purchase ────────────────────────────────────────────────────────
export const purchaseOrderApi = {
  list: (params?: Record<string, string>) =>
    apiClient.get('purchase', `/purchase-orders${params ? `?${new URLSearchParams(params)}` : ''}`),
  getById: (id: number) => apiClient.get('purchase', `/purchase-orders/${id}`),
  pendingDelivery: () => apiClient.get('purchase', '/purchase-orders/pending-delivery'),
  create: (data: Record<string, unknown>) => apiClient.post('purchase', '/purchase-orders', data),
  update: (id: number, data: Record<string, unknown>) => apiClient.put('purchase', `/purchase-orders/${id}`, data),
  submit: (id: number) => apiClient.post('purchase', `/purchase-orders/${id}/submit`, {}),
  approve: (id: number, data: { poNumber: string }) => apiClient.post('purchase', `/purchase-orders/${id}/approve`, data),
  cancel: (id: number, data: { reason: string }) => apiClient.post('purchase', `/purchase-orders/${id}/cancel`, data),
  duplicate: (id: number) => apiClient.post('purchase', `/purchase-orders/${id}/duplicate`, {}),
  activity: (id: number) => apiClient.get('purchase', `/purchase-orders/${id}/activity`),
};

export const grnApi = {
  list: (params?: Record<string, string>) =>
    apiClient.get('purchase', `/grns${params ? `?${new URLSearchParams(params)}` : ''}`),
  getById: (id: number) => apiClient.get('purchase', `/grns/${id}`),
  create: (data: Record<string, unknown>) => apiClient.post('purchase', '/grns', data),
  approve: (id: number, data: { grnNumber: string }) => apiClient.post('purchase', `/grns/${id}/approve`, data),
  reject: (id: number, data: { reason: string }) => apiClient.post('purchase', `/grns/${id}/reject`, data),
  landedCosts: (id: number) => apiClient.get('purchase', `/grns/${id}/landed-costs`),
  addLandedCost: (id: number, data: Record<string, unknown>) => apiClient.post('purchase', `/grns/${id}/landed-costs`, data),
  allocateLandedCost: (id: number) => apiClient.post('purchase', `/grns/${id}/allocate`, {}),
};

export const supplierPaymentApi = {
  list: (params?: Record<string, string>) =>
    apiClient.get('purchase', `/supplier-payments${params ? `?${new URLSearchParams(params)}` : ''}`),
  getById: (id: number) => apiClient.get('purchase', `/supplier-payments/${id}`),
  create: (data: Record<string, unknown>) => apiClient.post('purchase', '/supplier-payments', data),
  allocate: (id: number, data: Record<string, unknown>) => apiClient.post('purchase', `/supplier-payments/${id}/allocate`, data),
  bounce: (id: number, data: { reason: string }) => apiClient.post('purchase', `/supplier-payments/${id}/bounce`, data),
  outstanding: (supplierId: number) => apiClient.get('purchase', `/suppliers/${supplierId}/outstanding`),
  statement: (supplierId: number) => apiClient.get('purchase', `/suppliers/${supplierId}/statement`),
};

export const purchaseReturnApi = {
  list: (params?: Record<string, string>) =>
    apiClient.get('purchase', `/purchase-returns${params ? `?${new URLSearchParams(params)}` : ''}`),
  getById: (id: number) => apiClient.get('purchase', `/purchase-returns/${id}`),
  create: (data: Record<string, unknown>) => apiClient.post('purchase', '/purchase-returns', data),
  approve: (id: number) => apiClient.post('purchase', `/purchase-returns/${id}/approve`, {}),
  debitNotes: (params?: Record<string, string>) =>
    apiClient.get('purchase', `/debit-notes${params ? `?${new URLSearchParams(params)}` : ''}`),
};

export const expenseApi = {
  list: (params?: Record<string, string>) =>
    apiClient.get('purchase', `/expenses${params ? `?${new URLSearchParams(params)}` : ''}`),
  getById: (id: number) => apiClient.get('purchase', `/expenses/${id}`),
  create: (data: Record<string, unknown>) => apiClient.post('purchase', '/expenses', data),
  update: (id: number, data: Record<string, unknown>) => apiClient.put('purchase', `/expenses/${id}`, data),
  submit: (id: number) => apiClient.post('purchase', `/expenses/${id}/submit`, {}),
  approve: (id: number) => apiClient.post('purchase', `/expenses/${id}/approve`, {}),
  pay: (id: number, data: Record<string, unknown>) => apiClient.post('purchase', `/expenses/${id}/pay`, data),
};

// ── Phase 6: Accounting — Journals ───────────────────────────────────────────
export const journalApi = {
  list: (params?: Record<string, string>) =>
    apiClient.get('accounting', `/journals${params ? `?${new URLSearchParams(params)}` : ''}`),
  getById: (id: string) => apiClient.get('accounting', `/journals/${id}`),
  create: (data: Record<string, unknown>) => apiClient.post('accounting', '/journals', data),
  reverse: (id: string, data: { reason?: string }) => apiClient.post('accounting', `/journals/${id}/reverse`, data),
  getLedger: (accountId: number, params?: Record<string, string>) =>
    apiClient.get('accounting', `/accounts/${accountId}/ledger${params ? `?${new URLSearchParams(params)}` : ''}`),
};

// ── Phase 6: Accounting — Financial Reports ───────────────────────────────────
export const reportsApi = {
  trialBalance: (params: { asOfDate?: string }) =>
    apiClient.get('accounting', `/reports/trial-balance?${new URLSearchParams(params as Record<string, string>)}`),
  profitLoss: (params: { fromDate: string; toDate: string }) =>
    apiClient.get('accounting', `/reports/profit-loss?${new URLSearchParams(params)}`),
  balanceSheet: (params: { asOfDate?: string }) =>
    apiClient.get('accounting', `/reports/balance-sheet?${new URLSearchParams(params as Record<string, string>)}`),
  cashFlow: (params: { fromDate: string; toDate: string }) =>
    apiClient.get('accounting', `/reports/cash-flow?${new URLSearchParams(params)}`),
};

// ── Phase 6: Accounting — Bank Reconciliation ─────────────────────────────────
export const bankReconciliationApi = {
  createBankAccount: (data: Record<string, unknown>) => apiClient.post('accounting', '/bank-accounts', data),
  importStatement: (bankAccountId: number, data: Record<string, unknown>) =>
    apiClient.post('accounting', `/bank-reconciliation/${bankAccountId}/import`, data),
  getItems: (bankAccountId: number) =>
    apiClient.get('accounting', `/bank-reconciliation/${bankAccountId}/items`),
  matchItem: (bankAccountId: number, itemId: number, data: { matchedItemId: number }) =>
    apiClient.post('accounting', `/bank-reconciliation/${bankAccountId}/items/${itemId}/match`, data),
  getSummary: (bankAccountId: number) =>
    apiClient.get('accounting', `/bank-reconciliation/${bankAccountId}/summary`),
  finalize: (bankAccountId: number, data: { statementId: number }) =>
    apiClient.post('accounting', `/bank-reconciliation/${bankAccountId}/finalize`, data),
};

// ── Phase 6: Accounting — Financial Years ─────────────────────────────────────
export const financialYearApi = {
  list: () => apiClient.get('accounting', '/financial-years'),
  create: (data: Record<string, unknown>) => apiClient.post('accounting', '/financial-years', data),
  getCloseChecklist: (id: number) => apiClient.get('accounting', `/financial-years/${id}/close-checklist`),
  close: (id: number) => apiClient.post('accounting', `/financial-years/${id}/close`, {}),
  lockPeriod: (id: number, data: { periodMonth: number; periodYear: number }) =>
    apiClient.post('accounting', `/financial-years/${id}/lock-period`, data),
};

// ── Phase 6: Accounting — Fixed Assets ───────────────────────────────────────
export const fixedAssetApi = {
  list: () => apiClient.get('accounting', '/fixed-assets'),
  getById: (id: number) => apiClient.get('accounting', `/fixed-assets/${id}`),
  create: (data: Record<string, unknown>) => apiClient.post('accounting', '/fixed-assets', data),
  update: (id: number, data: Record<string, unknown>) => apiClient.put('accounting', `/fixed-assets/${id}`, data),
  getDepreciationSchedule: (id: number) =>
    apiClient.get('accounting', `/fixed-assets/${id}/depreciation-schedule`),
  dispose: (id: number, data: Record<string, unknown>) =>
    apiClient.post('accounting', `/fixed-assets/${id}/dispose`, data),
  runDepreciation: (data: { periodMonth: number; periodYear: number }) =>
    apiClient.post('accounting', '/fixed-assets/depreciation/run', data),
};

// ── Phase 6: Accounting — TDS ─────────────────────────────────────────────────
export const tdsApi = {
  getLiability: (params: { period?: string }) =>
    apiClient.get('accounting', `/tds/liability?${new URLSearchParams(params as Record<string, string>)}`),
  deduct: (data: Record<string, unknown>) => apiClient.post('accounting', '/tds/deduct', data),
  generateCertificate: (data: Record<string, unknown>) => apiClient.post('accounting', '/tds/certificates', data),
  getCertificates: (supplierId: number) =>
    apiClient.get('accounting', `/tds/certificates/${supplierId}`),
  get26Q: (params: { year: number; quarter: 1 | 2 | 3 | 4 }) =>
    apiClient.get('accounting', `/tds/26q?year=${params.year}&quarter=${params.quarter}`),
};

// ── Phase 6: Accounting — Posting Matrix ─────────────────────────────────────
export const postingMatrixApi = {
  list: () => apiClient.get('accounting', '/posting-matrix'),
  create: (data: Record<string, unknown>) => apiClient.post('accounting', '/posting-matrix', data),
  update: (id: number, data: Record<string, unknown>) => apiClient.put('accounting', `/posting-matrix/${id}`, data),
  deactivate: (id: number) => apiClient.delete('accounting', `/posting-matrix/${id}`),
  seed: () => apiClient.post('accounting', '/posting-matrix/seed', {}),
};

// ── Phase 8: HR — Departments / Designations ──────────────────────────────────
export const departmentApi = {
  list: () => apiClient.get<{ content: unknown[] }>('hr', '/departments'),
  create: (data: Record<string, unknown>) => apiClient.post('hr', '/departments', data),
  update: (id: number, data: Record<string, unknown>) => apiClient.put('hr', `/departments/${id}`, data),
  delete: (id: number) => apiClient.delete('hr', `/departments/${id}`),
};

export const designationApi = {
  list: () => apiClient.get<{ content: unknown[] }>('hr', '/designations'),
  create: (data: Record<string, unknown>) => apiClient.post('hr', '/designations', data),
  update: (id: number, data: Record<string, unknown>) => apiClient.put('hr', `/designations/${id}`, data),
  delete: (id: number) => apiClient.delete('hr', `/designations/${id}`),
};

// ── Phase 8: HR — Employees ────────────────────────────────────────────────────
export const employeeApi = {
  list: (params?: { search?: string | undefined; departmentId?: number | undefined; employmentType?: string | undefined; status?: string | undefined }) => {
    const qs = new URLSearchParams();
    if (params?.search) qs.set('search', params.search);
    if (params?.departmentId) qs.set('departmentId', String(params.departmentId));
    if (params?.employmentType) qs.set('employmentType', params.employmentType);
    if (params?.status) qs.set('status', params.status);
    return apiClient.get<{ content: unknown[] }>('hr', `/employees?${qs.toString()}`);
  },
  getById: (id: number) => apiClient.get('hr', `/employees/${id}`),
  create: (data: Record<string, unknown>) => apiClient.post('hr', '/employees', data),
  update: (id: number, data: Record<string, unknown>) => apiClient.put('hr', `/employees/${id}`, data),
  exit: (id: number, data: { exitDate: string; exitReason: string }) => apiClient.post('hr', `/employees/${id}/exit`, data),
};

// ── Phase 8: HR — Attendance ───────────────────────────────────────────────────
export const attendanceApi = {
  shifts: () => apiClient.get<{ content: unknown[] }>('hr', '/shifts'),
  createShift: (data: Record<string, unknown>) => apiClient.post('hr', '/shifts', data),
  mark: (data: Record<string, unknown>) => apiClient.post('hr', '/attendance/mark', data),
  bulkMark: (data: Record<string, unknown>) => apiClient.post('hr', '/attendance/bulk-mark', data),
  getForEmployee: (employeeId: number, month?: string) =>
    apiClient.get<{ content: unknown[] }>('hr', `/attendance/${employeeId}${month ? `?month=${month}` : ''}`),
  correct: (id: number, data: Record<string, unknown>) => apiClient.put('hr', `/attendance/${id}/correct`, data),
  report: (month: string) => apiClient.get('hr', `/attendance/report?month=${month}`),
  teamSummary: (month: string) => apiClient.get('hr', `/attendance/team-summary?month=${month}`),
};

// ── Phase 8: HR — Leave ────────────────────────────────────────────────────────
export const leaveApi = {
  types: () => apiClient.get<{ content: unknown[] }>('hr', '/leave-types'),
  seedTypes: () => apiClient.post('hr', '/leave-types/seed', {}),
  balance: (employeeId: number) => apiClient.get('hr', `/employees/${employeeId}/leave-balance`),
  apply: (data: Record<string, unknown>) => apiClient.post('hr', '/leave-applications', data),
  approve: (id: number) => apiClient.post('hr', `/leave-applications/${id}/approve`, {}),
  reject: (id: number, data: { rejectionReason: string }) => apiClient.post('hr', `/leave-applications/${id}/reject`, data),
  cancel: (id: number) => apiClient.post('hr', `/leave-applications/${id}/cancel`, {}),
  pendingApprovals: () => apiClient.get<{ content: unknown[] }>('hr', '/approvals/leaves/pending'),
  list: (params?: { employeeId?: number; startDate?: string; endDate?: string }) => {
    const qs = new URLSearchParams();
    if (params?.employeeId) qs.set('employeeId', String(params.employeeId));
    if (params?.startDate) qs.set('startDate', params.startDate);
    if (params?.endDate) qs.set('endDate', params.endDate);
    return apiClient.get<{ content: unknown[] }>('hr', `/leave-applications?${qs.toString()}`);
  },
};

// ── Phase 8: HR — Payroll ──────────────────────────────────────────────────────
export const payrollApi = {
  salaryStructures: () => apiClient.get<{ content: unknown[] }>('hr', '/salary-structures'),
  createSalaryStructure: (data: Record<string, unknown>) => apiClient.post('hr', '/salary-structures', data),
  setEmployeeSalary: (data: Record<string, unknown>) => apiClient.post('hr', '/employee-salaries', data),
  runs: () => apiClient.get<{ content: unknown[] }>('hr', '/payroll-runs'),
  getRun: (id: number) => apiClient.get('hr', `/payroll-runs/${id}`),
  createRun: (data: { periodMonth: number; periodYear: number; workingDays?: number }) =>
    apiClient.post('hr', '/payroll-runs', data),
  calculate: (id: number) => apiClient.post('hr', `/payroll-runs/${id}/calculate`, {}),
  approve: (id: number) => apiClient.post('hr', `/payroll-runs/${id}/approve`, {}),
  disburse: (id: number) => apiClient.post('hr', `/payroll-runs/${id}/disburse`, {}),
  bulkSend: (id: number) => apiClient.post('hr', `/payroll-runs/${id}/bulk-send`, {}),
  getSlip: (id: number) => apiClient.get<Record<string, unknown>>('hr', `/payroll-slips/${id}`),
  slipPdf: (id: number) => apiClient.get('hr', `/payroll-slips/${id}/pdf`),
};

export const holidayApi = {
  list: (year?: number) => apiClient.get<{ content: unknown[]; totalElements: number }>('hr', `/holidays${year ? `?year=${year}` : ''}`),
  create: (data: { name: string; holidayDate: string; holidayType: string; branchId?: number }) =>
    apiClient.post<unknown>('hr', '/holidays', data),
  delete: (id: string) => apiClient.delete<unknown>('hr', `/holidays/${id}`),
  seed: () => apiClient.post<{ message: string; seeded: number }>('hr', '/holidays/seed', {}),
};

// ── Phase 8: HR — Alteration Orders ───────────────────────────────────────────
export const alterationApi = {
  list: (params?: { status?: string | undefined; assignedToId?: number | undefined }) => {
    const qs = new URLSearchParams();
    if (params?.status) qs.set('status', params.status);
    if (params?.assignedToId) qs.set('assignedToId', String(params.assignedToId));
    return apiClient.get<{ content: unknown[] }>('hr', `/alterations?${qs.toString()}`);
  },
  getById: (id: number) => apiClient.get('hr', `/alterations/${id}`),
  create: (data: Record<string, unknown>) => apiClient.post('hr', '/alterations', data),
  update: (id: number, data: Record<string, unknown>) => apiClient.put('hr', `/alterations/${id}`, data),
  assign: (id: number, data: { tailorId: number }) => apiClient.post('hr', `/alterations/${id}/assign`, data),
  updateStatus: (id: number, data: { status: string }) => apiClient.post('hr', `/alterations/${id}/status`, data),
  deliver: (id: number, data: { paymentAmount: number }) => apiClient.post('hr', `/alterations/${id}/deliver`, data),
  tailorQueue: (tailorId: number) => apiClient.get<{ content: unknown[] }>('hr', `/alterations/tailor/${tailorId}`),
  overdue: () => apiClient.get<{ content: unknown[] }>('hr', '/alterations/overdue'),
};

// ── Phase 8: HR — Tailor Work Log ─────────────────────────────────────────────
export const tailorWorkLogApi = {
  log: (data: Record<string, unknown>) => apiClient.post('hr', '/tailor-work-log', data),
  list: (employeeId: number, month?: string) =>
    apiClient.get<{ content: unknown[] }>('hr', `/tailor-work-log?employeeId=${employeeId}${month ? `&month=${month}` : ''}`),
  summary: (month: string) => apiClient.get('hr', `/tailor-work-log/summary?month=${month}`),
};

// ── Phase 10 — Production (Job Work / Barcode / Consignment / Reorder) ────────
export const productionApi = {
  // Job Work Orders
  listJobWorkOrders: (params?: { status?: string }) => {
    const qs = new URLSearchParams();
    if (params?.status) qs.set('status', params.status);
    return apiClient.get<{ data: unknown[] }>('production', `/api/v2/job-work-orders?${qs}`);
  },
  getJobWorkOrder: (id: number) =>
    apiClient.get('production', `/api/v2/job-work-orders/${id}`),
  getJobWorkDashboard: () =>
    apiClient.get('production', '/api/v2/job-work-orders/dashboard'),
  createJobWorkOrder: (data: Record<string, unknown>) =>
    apiClient.post('production', '/api/v2/job-work-orders', data),
  issueMaterials: (id: number) =>
    apiClient.post('production', `/api/v2/job-work-orders/${id}/issue-materials`, {}),
  startQualityCheck: (id: number) =>
    apiClient.post('production', `/api/v2/job-work-orders/${id}/start-quality-check`, {}),
  submitQualityChecks: (id: number, data: Record<string, unknown>) =>
    apiClient.post('production', `/api/v2/job-work-orders/${id}/quality-checks`, data),
  completeJobWorkOrder: (id: number, data: { receivedQty: number; rejectedQty: number; scrapQty: number }) =>
    apiClient.post('production', `/api/v2/job-work-orders/${id}/complete`, data),
  cancelJobWorkOrder: (id: number, data: { cancellationReason: string }) =>
    apiClient.post('production', `/api/v2/job-work-orders/${id}/cancel`, data),

  // Barcodes
  generateBarcodes: (data: Record<string, unknown>) =>
    apiClient.post('production', '/api/v2/barcodes/generate', data),
  getBarcodesByItem: (itemId?: number) => {
    const qs = itemId ? `?itemId=${itemId}` : '';
    return apiClient.get('production', `/api/v2/barcodes/batches${qs}`);
  },
  getPrintData: (batchId: number) =>
    apiClient.get('production', `/api/v2/barcodes/print/${batchId}`),
  deactivateBarcode: (id: number) =>
    apiClient.post('production', `/api/v2/barcodes/${id}/deactivate`, {}),
  lookupByBarcode: (value: string) =>
    apiClient.get('production', `/api/v2/items/by-barcode/${encodeURIComponent(value)}`),

  // Consignment
  receiveConsignment: (data: Record<string, unknown>) =>
    apiClient.post('production', '/api/v2/consignment/receive', data),
  listConsignmentStock: (params?: { supplierId?: number }) => {
    const qs = params?.supplierId ? `?supplierId=${params.supplierId}` : '';
    return apiClient.get('production', `/api/v2/consignment/stock${qs}`);
  },
  returnConsignment: (id: number, data: { returnQty: number }) =>
    apiClient.post('production', `/api/v2/consignment/return/${id}`, data),
  listConsignmentSettlements: (params?: { supplierId?: number }) => {
    const qs = params?.supplierId ? `?supplierId=${params.supplierId}` : '';
    return apiClient.get('production', `/api/v2/consignment/settlements${qs}`);
  },
  createConsignmentSettlement: (data: Record<string, unknown>) =>
    apiClient.post('production', '/api/v2/consignment/settlements', data),
  settleConsignment: (id: number, data: { paymentReference: string }) =>
    apiClient.post('production', `/api/v2/consignment/settle/${id}`, data),

  // Reorder
  getReorderRequired: (params?: { warehouseId?: number }) => {
    const qs = params?.warehouseId ? `?warehouseId=${params.warehouseId}` : '';
    return apiClient.get('production', `/api/v2/inventory/reorder-required${qs}`);
  },
  createReorderPOs: (data: Record<string, unknown>) =>
    apiClient.post('production', '/api/v2/inventory/reorder/create-pos', data),
};

// ── Phase 9 — CRM ─────────────────────────────────────────────────────────────
export const crmApi = {
  // Interactions
  logInteraction: (customerId: number, data: Record<string, unknown>) =>
    apiClient.post('sales', `/customers/${customerId}/interactions`, data),
  listInteractions: (customerId: number) =>
    apiClient.get('sales', `/customers/${customerId}/interactions`),
  followUps: () => apiClient.get('sales', '/crm/follow-ups'),

  // Health
  healthSegments: () => apiClient.get('sales', '/crm/segments/health'),

  // Segments
  listSegments: () => apiClient.get('sales', '/crm/segments'),
  createSegment: (data: Record<string, unknown>) => apiClient.post('sales', '/crm/segments', data),
  previewSegment: (data: Record<string, unknown>) => apiClient.post('sales', '/crm/segments/preview', data),
  segmentCustomers: (idOrCode: string | number, params?: { page?: number; size?: number }) => {
    const qs = new URLSearchParams();
    if (params?.page !== undefined) qs.set('page', String(params.page));
    if (params?.size !== undefined) qs.set('size', String(params.size));
    return apiClient.get('sales', `/crm/segments/${idOrCode}/customers?${qs}`);
  },

  // Campaigns
  listCampaigns: (params?: { status?: string }) => {
    const qs = new URLSearchParams();
    if (params?.status) qs.set('status', params.status);
    return apiClient.get('sales', `/crm/campaigns?${qs}`);
  },
  getCampaign: (id: number) => apiClient.get('sales', `/crm/campaigns/${id}`),
  createCampaign: (data: Record<string, unknown>) => apiClient.post('sales', '/crm/campaigns', data),
  sendCampaign: (id: number) => apiClient.post('sales', `/crm/campaigns/${id}/send`, {}),
  scheduleCampaign: (id: number, data: { scheduledAt: string }) => apiClient.post('sales', `/crm/campaigns/${id}/schedule`, data),
  cancelCampaign: (id: number) => apiClient.post('sales', `/crm/campaigns/${id}/cancel`, {}),
  campaignStats: (id: number) => apiClient.get('sales', `/crm/campaigns/${id}/stats`),
  birthdayStats: () => apiClient.get('sales', '/crm/campaigns/birthday-stats'),

  // Seasons
  listSeasons: () => apiClient.get('sales', '/crm/seasons'),
  activeSeason: () => apiClient.get('sales', '/crm/seasons/active'),
  createSeason: (data: Record<string, unknown>) => apiClient.post('sales', '/crm/seasons', data),
  updateSeason: (id: number, data: Record<string, unknown>) => apiClient.put('sales', `/crm/seasons/${id}`, data),

  // Activity timeline (on customers)
  activityTimeline: (customerId: number, params?: { page?: number; size?: number }) => {
    const qs = new URLSearchParams();
    if (params?.page !== undefined) qs.set('page', String(params.page));
    if (params?.size !== undefined) qs.set('size', String(params.size));
    return apiClient.get('sales', `/customers/${customerId}/activity?${qs}`);
  },
};

// ── Phase 11 — Reports Engine ─────────────────────────────────────────────────
export const reportsEngineApi = {
  list: () => apiClient.get<{ grouped: Record<string, unknown[]>; total: number }>('report', '/api/v2/reports'),
  getDefinition: (slug: string) => apiClient.get<unknown>('report', `/api/v2/reports/${slug}`),
  run: (slug: string, params: Record<string, string | number>, format: 'JSON' | 'CSV' | 'EXCEL' = 'JSON', async = false) =>
    apiClient.post<unknown>('report', `/api/v2/reports/${slug}/run`, { params, format, async }),
  runHistory: () => apiClient.get<unknown[]>('report', '/api/v2/reports/run-history'),
  runStatus: (runId: number) => apiClient.get<unknown>('report', `/api/v2/reports/run-history/${runId}`),
};

// ── ES-05 — AR / AP Aging Reports ────────────────────────────────────────────

export interface AgingRow {
  customerName?: string;
  supplierName?: string;
  days0to30: number;
  days31to60: number;
  days61to90: number;
  days90plus: number;
  totalOutstanding: number;
}

export interface AgingResponse {
  data: AgingRow[];
  meta: { total: number; generatedAt: string };
}

export const arAgingApi = {
  get: (asOf: string, branchId?: string) => {
    const qs = new URLSearchParams({ asOf });
    if (branchId) qs.set('branchId', branchId);
    return apiClient.get<AgingResponse>('report', `/api/v1/reports/ar-aging?${qs}`);
  },
};

export const apAgingApi = {
  get: (asOf: string, supplierId?: string) => {
    const qs = new URLSearchParams({ asOf });
    if (supplierId) qs.set('supplierId', supplierId);
    return apiClient.get<AgingResponse>('report', `/api/v1/reports/ap-aging?${qs}`);
  },
};

// ── Phase 11 — Report Schedules ───────────────────────────────────────────────
export const reportSchedulesApi = {
  list: () => apiClient.get<unknown[]>('report', '/api/v2/report-schedules'),
  create: (data: { reportSlug: string; params?: Record<string, string>; format?: string; cronExpression: string; recipients: string[] }) =>
    apiClient.post<unknown>('report', '/api/v2/report-schedules', data),
  delete: (id: number) => apiClient.delete<unknown>('report', `/api/v2/report-schedules/${id}`),
};

// ── Phase 11 — Dashboard (Owner Dashboard) ───────────────────────────────────
export const dashboardApi = {
  kpis: () => apiClient.get<unknown>('report', '/api/v2/dashboard/kpis'),
  charts: () => apiClient.get<unknown>('report', '/api/v2/dashboard/charts'),
  alerts: () => apiClient.get<unknown>('report', '/api/v2/dashboard/alerts'),
};

// ── Phase 11 — POS Analytics ─────────────────────────────────────────────────
export const posAnalyticsApi = {
  today: () => apiClient.get<unknown>('report', '/api/v2/pos-analytics'),
};

// ── Phase 12 — Event Store ────────────────────────────────────────────────────
export const eventStoreApi = {
  query: (params: { aggregateType?: string; aggregateId?: string; eventType?: string; from?: string; to?: string; limit?: number; offset?: number }) => {
    const qs = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => { if (v !== undefined) qs.set(k, String(v)); });
    return apiClient.get<unknown[]>('event', `/api/v2/admin/events/store?${qs}`);
  },
  replay: (aggregateType: string, aggregateId: string) =>
    apiClient.post<unknown>('event', `/api/v2/admin/events/replay/${aggregateType}/${aggregateId}`),
};

// ── Phase 12 — DLQ Management ─────────────────────────────────────────────────
export const dlqApi = {
  summary: () => apiClient.get<Array<{ topic: string; pending: number; replayed: number; discarded: number; total: number }>>('event', '/api/v2/admin/dlq/summary'),
  list: (topic: string, params?: { page?: number; size?: number }) => {
    const qs = new URLSearchParams();
    if (params?.page !== undefined) qs.set('page', String(params.page));
    if (params?.size !== undefined) qs.set('size', String(params.size));
    return apiClient.get<unknown>('event', `/api/v2/admin/dlq/${encodeURIComponent(topic)}?${qs}`);
  },
  getById: (topic: string, id: number) =>
    apiClient.get<unknown>('event', `/api/v2/admin/dlq/${encodeURIComponent(topic)}/${id}`),
  replay: (topic: string) =>
    apiClient.post<{ replayed: number; topic: string }>('event', `/api/v2/admin/dlq/${encodeURIComponent(topic)}/replay`),
  discard: (id: number) =>
    apiClient.post<unknown>('event', `/api/v2/admin/dlq/${id}/discard`),
};

// ── Phase 12 — Saga Monitoring ────────────────────────────────────────────────
export const sagaAdminApi = {
  summary: () => apiClient.get<unknown>('event', '/api/v2/admin/sagas/summary'),
  list: (params?: { status?: string; sagaType?: string; page?: number; size?: number }) => {
    const qs = new URLSearchParams();
    Object.entries(params ?? {}).forEach(([k, v]) => { if (v !== undefined) qs.set(k, String(v)); });
    return apiClient.get<unknown>('event', `/api/v2/admin/sagas?${qs}`);
  },
  getById: (id: string) => apiClient.get<unknown>('event', `/api/v2/admin/sagas/${id}`),
  retry: (id: string) => apiClient.post<unknown>('event', `/api/v2/admin/sagas/${id}/retry`),
  compensate: (id: string) => apiClient.post<unknown>('event', `/api/v2/admin/sagas/${id}/compensate`),
};

// ── Phase 12 — Schema Registry ────────────────────────────────────────────────
export const schemaRegistryApi = {
  catalog: () => apiClient.get<unknown[]>('event', '/api/v2/schema-registry/catalog'),
  getLatest: (eventType: string) => apiClient.get<unknown>('event', `/api/v2/schema-registry/schemas/${encodeURIComponent(eventType)}`),
  getVersion: (eventType: string, version: number) =>
    apiClient.get<unknown>('event', `/api/v2/schema-registry/schemas/${encodeURIComponent(eventType)}/${version}`),
  register: (data: { eventType: string; schemaVersion: number; jsonSchema: Record<string, unknown>; compatibilityMode?: string; description?: string }) =>
    apiClient.post<unknown>('event', '/api/v2/schema-registry/schemas', data),
  check: (eventType: string, data: { jsonSchema: Record<string, unknown>; compatibilityMode?: string }) =>
    apiClient.post<unknown>('event', `/api/v2/schema-registry/schemas/${encodeURIComponent(eventType)}/check`, data),
};

// ── Phase 12 — Projections ────────────────────────────────────────────────────
export const projectionAdminApi = {
  list: () => apiClient.get<unknown[]>('event', '/api/v2/admin/projections'),
  getByName: (name: string) => apiClient.get<unknown>('event', `/api/v2/admin/projections/${name}`),
  rebuild: (name: string) => apiClient.post<unknown>('event', `/api/v2/admin/projections/${name}/rebuild`),
};

// ── Phase 12 — Performance ────────────────────────────────────────────────────
export const performanceAdminApi = {
  baselines: () => apiClient.get<unknown[]>('event', '/api/v2/admin/performance/baselines'),
  targets: () => apiClient.get<unknown[]>('event', '/api/v2/admin/performance/targets'),
};
