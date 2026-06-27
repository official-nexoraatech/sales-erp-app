export interface Country {
  id: number;
  name?: string;
  countryName?: string;
}

export interface State {
  id: number;
  name?: string;
  stateName?: string;
  countryId?: number;
  countryName?: string;
  stateCode?: string;
  gstCode?: string;
  status?: string;
}

export type OrganizationStatus = 'ACTIVE' | 'INACTIVE';

export interface OrganizationAddress {
  addressLine1: string;
  addressLine2: string;
  city: string;
  stateId: number;
  pincode: string;
  stateName?: string;
}

export interface Organization {
  id: number;
  name: string;
  description?: string;
  logoUrl?: string | null;
  address?: OrganizationAddress | string | null;
  status: OrganizationStatus | string | boolean;
  createdAt?: string;
  createdBy?: string;
}

export interface OrganizationRequest {
  name: string;
  description: string;
  address: OrganizationAddress;
  status: OrganizationStatus;
}

export interface UpdateOrganizationRequest extends OrganizationRequest {
  logoUrl: string;
}

export type OrganizationLogoUploadResponse = string | {
  logoUrl?: string | null;
  url?: string | null;
  fileUrl?: string | null;
  filePath?: string | null;
  path?: string | null;
} | null;

export interface ItemListItem {
  id: number;
  itemName: string;
  itemCode: string;
  sku: string;
  hsnCode?: string;
  categoryId?: number;
  categoryName?: string;
  subCategoryId?: number | null;
  subCategoryName?: string | null;
  brandId?: number;
  brandName?: string;
  baseUnitId?: number;
  baseUnitName?: string;
  purchasePrice?: number;
  purchasePriceWithTax?: number;
  taxPercentage?: number;
  salePrice: number;
  wholesalePrice?: number;
  mrp?: number;
  msp?: number;
  discountPercentage?: number;
  profitMargin?: number;
  batchNo?: string;
  manufacturingDate?: string;
  expiryDate?: string;
  openingQuantity?: number;
  availableQty: number;
  reservedQty?: number;
  minimumStock?: number;
  warehouseId?: number;
  warehouseName?: string;
  status: boolean | string;
  trackingType?: string;
  unitName?: string;
  description?: string;
}

export interface ItemRequest {
  itemName: string;
  itemCode: string;
  sku: string;
  hsnCode: string;
  categoryId: number;
  subCategoryId: number;
  brandId: number;
  baseUnitId: number;
  purchasePrice: number;
  purchasePriceWithTax: number;
  taxPercentage: number;
  salePrice: number;
  wholesalePrice: number;
  mrp: number;
  msp: number;
  discountPercentage: number;
  profitMargin: number;
  batchNo: string;
  manufacturingDate: string;
  expiryDate: string;
  openingQuantity: number;
  minimumStock: number;
  warehouseId: number;
  description: string;
}

export interface ItemStock {
  itemId: number;
  itemName?: string;
  availableQty?: number;
  quantity?: number;
  warehouseName?: string;
  batchNo?: string;
  minimumStock?: number;
}

export interface Warehouse {
  id: number;
  name: string;
  warehouseCode: string;
  status: boolean;
  description?: string;
  address?: string;
  totalItems?: number;
  availableStock?: number;
  worthCost?: number;
  worthSale?: number;
  worthProfit?: number;
  createdBy?: string;
  createdAt?: string;
}

export interface WarehouseRequest {
  name: string;
  warehouseCode: string;
  description: string;
  address: string;
}

export interface CreateUserRequest {
  firstName: string;
  lastName: string;
  userName: string;
  email: string;
  mobileNo: string;
  roleId: number;
  organizationId: number;
  password?: string;
  status: 'ACTIVE' | 'INACTIVE';
}

export type UpdateUserRequest = Omit<CreateUserRequest, 'organizationId'>;

export interface ChangePasswordRequest {
  currentPassword: string;
  newPassword: string;
}

export interface UserProfile {
  id: number;
  firstName: string;
  lastName: string;
  userName: string;
  email: string;
  mobileNo: string;
  status: 'ACTIVE' | 'INACTIVE';
  roleId: number;
  roleName: string;
  organizationId: number;
  organizationName: string;
}

export interface UpdateProfileRequest {
  firstName: string;
  lastName: string;
  userName: string;
  email: string;
  mobileNo: string;
}

export interface UserListItem {
  id: number;
  firstName?: string;
  lastName?: string;
  userName?: string;
  username?: string;
  email?: string;
  mobileNo?: string;
  mobile?: string;
  roleId?: number;
  roleName?: string;
  status?: boolean | string;
  createdAt?: string;
}

export interface Role {
  id: number;
  name: string;
  status: boolean | 'ACTIVE' | 'INACTIVE';
  createdAt?: string;
}

export interface RoleRequest {
  name: string;
  status: 'ACTIVE' | 'INACTIVE';
  organizationId?: number;
}

export interface PosBillingRequest {
  customerId: number;
  warehouseId: number;
  paymentMethodId: number;
  items: Array<{ itemId: number; quantity: number }>;
}

export interface SimpleMaster {
  id: number;
  name: string;
  description?: string;
  categoryId?: number;
  categoryName?: string;
  createdAt?: string;
  createdBy?: string;
}

export interface SimpleMasterRequest {
  name: string;
  description: string;
  categoryId?: number;
}

export type ExpenseMasterStatus = 'ACTIVE' | 'INACTIVE';

export interface ExpenseCategory {
  id: number;
  organizationId?: number;
  name: string;
  description?: string;
  status: ExpenseMasterStatus;
}

export interface ExpenseCategoryRequest {
  name: string;
  description: string;
  status: ExpenseMasterStatus;
}

export interface ExpenseSubCategory {
  id: number;
  expenseCategoryId: number;
  expenseCategoryName?: string;
  name: string;
  description?: string;
  status: ExpenseMasterStatus;
}

export interface ExpenseSubCategoryRequest extends ExpenseCategoryRequest {
  expenseCategoryId: number;
}

export interface PaymentMethod {
  id: number;
  organizationId?: number;
  name: string;
  description?: string;
  status: ExpenseMasterStatus;
}

export type PaymentMethodRequest = ExpenseCategoryRequest;

export interface Unit {
  id: number;
  name: string;
  shortName: string;
  createdAt?: string;
  createdBy?: string;
}

export interface UnitRequest {
  name: string;
  shortName: string;
}

export interface SaleListItem {
  saleId: number;
  invoiceNo: string;
  customerName: string;
  invoiceDate: string;
  grandTotal: number;
  paidAmount: number;
  dueAmount: number;
  status?: string;
}

export interface SaleRequest {
  customerId: number;
  invoiceDate: string;
  warehouseId: number;
  stateId: number;
  salesPersonId: number;
  roundOff?: number;
  notes: string;
  items: Array<{ itemId: number; quantity: number; unitPrice: number; discountPercent: number; taxPercent: number }>;
}

export interface SaleDetail {
  saleId: number;
  invoiceNo: string;
  invoiceDate: string;
  customer: { id: number; name: string };
  warehouse: { id: number; name: string };
  subTotal: number;
  discountAmount: number;
  taxAmount: number;
  roundOff?: number;
  grandTotal: number;
  paidAmount: number;
  dueAmount: number;
  status: string;
  notes?: string;
  items: Array<{ itemId: number; itemName: string; batchId: number; batchNo: string; qty: number; unitPrice: number; discountAmount: number; taxAmount: number; totalAmount: number }>;
}

export interface SaleInvoice {
  invoiceNo: string;
  customerName: string;
  grandTotal: number;
}

export interface SalesCreateResponse {
  saleId: number;
  invoiceNo: string;
  subTotal: number;
  discountAmount: number;
  taxAmount: number;
  roundOff?: number;
  grandTotal: number;
  paidAmount: number;
  dueAmount: number;
}

export interface QuotationCreateResponse {
  quotationId: number;
  quotationNo: string;
  subTotal: number;
  discountAmount: number;
  taxAmount: number;
  roundOff: number;
  grandTotal: number;
  status: string;
}

export interface QuotationListItem {
  quotationId: number;
  quotationNo: string;
  quotationDate: string;
  validUntil?: string;
  customerName: string;
  grandTotal: number;
  status: string;
  convertedSaleId?: number;
  convertedInvoiceNo?: string;
}

export interface QuotationRequest {
  customerId: number;
  quotationDate: string;
  validUntil?: string;
  warehouseId: number;
  stateId: number;
  salesPersonId: number;
  roundOff: number;
  status: string;
  notes: string;
  items: Array<{ itemId: number; quantity: number; unitPrice: number; discountPercent: number; taxPercent: number }>;
}

export interface QuotationDetail {
  quotationId: number;
  quotationNo: string;
  quotationDate: string;
  validUntil?: string;
  customer: { id: number; name: string };
  warehouse: { id: number; name: string };
  stateId?: number;
  salesPersonId?: number;
  subTotal: number;
  discountAmount: number;
  taxAmount: number;
  roundOff: number;
  grandTotal: number;
  status: string;
  notes?: string;
  convertedSaleId?: number;
  convertedInvoiceNo?: string;
  items: Array<{ itemId: number; itemName: string; qty: number; unitPrice: number; discountPercent: number; discountAmount: number; taxPercent: number; taxAmount: number; totalAmount: number }>;
}

export interface PaymentListItem {
  paymentId: number;
  paymentNo: string;
  partyName?: string;
  customerName?: string;
  supplierName?: string;
  amount: number;
  paymentDate: string;
}

export interface PaymentDetail {
  paymentId: number;
  paymentNo: string;
  paymentType: string;
  party: { id: number; name: string };
  paymentMethod: { id: number; name: string };
  paymentDate: string;
  referenceNo?: string;
  amount: number;
  notes?: string;
  saleIds?: number[];
  purchaseIds?: number[];
}

export interface PaymentOutRequest {
  supplierId: number;
  paymentDate: string;
  paymentMethodId: number;
  referenceNo: string;
  amount: number;
  notes: string;
  purchaseIds: number[];
}

export interface PaymentInRequest {
  customerId: number;
  paymentDate: string;
  paymentMethodId: number;
  referenceNo: string;
  amount: number;
  notes: string;
  saleIds: number[];
}

export interface PurchaseCreateResponse {
  purchaseId: number;
  purchaseNo: string;
  subTotal: number;
  discountAmount: number;
  taxAmount: number;
  grandTotal: number;
  paidAmount: number;
  dueAmount: number;
}

export interface PurchaseListItem {
  purchaseId: number;
  purchaseNo?: string;
  purchaseCode?: string;
  supplierName: string;
  purchaseDate: string;
  grandTotal: number;
  paidAmount?: number;
  dueAmount?: number;
  status?: string;
}

export interface PurchaseRequest {
  supplierId: number;
  purchaseDate: string;
  referenceNo: string;
  warehouseId: number;
  carrierId: number;
  stateId: number;
  notes: string;
  items: Array<{
    itemId: number;
    batchNo: string;
    manufacturingDate: string;
    expiryDate: string;
    quantity: number;
    unitPrice: number;
    discountPercent: number;
    taxPercent: number;
  }>;
}

export interface PurchaseDetail {
  purchaseId: number;
  purchaseNo?: string;
  purchaseCode?: string;
  purchaseDate: string;
  referenceNo?: string;
  supplier: { id: number; name: string };
  warehouse: { id: number; name: string };
  carrier?: { id: number; name: string };
  subTotal: number;
  discountAmount: number;
  taxAmount: number;
  grandTotal: number;
  paidAmount?: number;
  dueAmount?: number;
  status?: string;
  notes?: string;
  items: Array<{
    itemId: number;
    itemName: string;
    batchNo?: string;
    manufacturingDate?: string;
    expiryDate?: string;
    qty?: number;
    quantity?: number;
    unitPrice: number;
    discountAmount?: number;
    discountPercent?: number;
    taxAmount?: number;
    taxPercent?: number;
    totalAmount?: number;
  }>;
}

export interface PurchaseReturnListItem {
  returnId: number;
  returnNo?: string;
  supplierName: string;
  returnDate: string;
  totalAmount?: number;
  grandTotal?: number;
  balance?: number;
  reason?: string;
}

export interface PurchaseReturnRequest {
  purchaseId: number;
  supplierId: number;
  returnDate: string;
  reason: string;
  items: Array<{ itemId: number; batchId: number; quantity: number; rate: number }>;
}

export interface PurchaseReturnDetail {
  returnId: number;
  returnNo?: string;
  purchaseId?: number;
  supplier: { id: number; name: string };
  returnDate: string;
  reason?: string;
  totalAmount?: number;
  items: Array<{ itemId: number; itemName: string; batchId?: number; quantity: number; rate: number; totalAmount?: number }>;
}

export interface StockTransferListItem {
  transferId: number;
  transferNo?: string;
  transferCode?: string;
  transferDate: string;
  fromWarehouseName?: string;
  toWarehouseName?: string;
  notes?: string;
  createdBy?: string;
  createdAt?: string;
}

export interface StockTransferRequest {
  fromWarehouseId: number;
  toWarehouseId: number;
  transferDate: string;
  notes: string;
  items: Array<{ itemId: number; quantity: number }>;
}

export interface StockTransferDetail extends StockTransferListItem {
  fromWarehouse?: { id: number; name: string };
  toWarehouse?: { id: number; name: string };
  items: Array<{ itemId: number; itemName: string; quantity: number; availableQty?: number; unitName?: string }>;
}

export interface StockAdjustmentListItem {
  adjustmentId: number;
  adjustmentNo?: string;
  adjustmentCode?: string;
  adjustmentDate: string;
  warehouseName?: string;
  reason?: string;
  createdBy?: string;
  createdAt?: string;
}

export interface StockAdjustmentRequest {
  warehouseId: number;
  adjustmentDate: string;
  reason: string;
  items: Array<{ itemId: number; currentQty: number; actualQty: number }>;
}

export interface StockAdjustmentDetail extends StockAdjustmentListItem {
  warehouse?: { id: number; name: string };
  items: Array<{ itemId: number; itemName: string; currentQty: number; actualQty: number; unitName?: string }>;
}

export interface ExpenseListItem {
  expenseId: number;
  expenseNo?: string;
  expenseNumber?: string;
  expenseDate: string;
  categoryName?: string;
  subCategoryName?: string;
  amount: number;
  paymentType?: string;
  paymentMethodName?: string;
  createdBy?: string;
  createdAt?: string;
  notes?: string;
}

export interface ExpenseRequest {
  expenseCategoryId: number;
  expenseDate: string;
  amount: number;
  paymentMethodId: number;
  notes: string;
}

export interface ExpenseDetail extends ExpenseListItem {
  expenseCategory?: { id: number; name: string };
  paymentMethod?: { id: number; name: string };
}

export interface BankAccount {
  id: number;
  bankName: string;
  accountName: string;
  accountNumber: string;
  ifscCode: string;
  branchName: string;
  openingBalance: number;
  currentBalance?: number;
}

export interface BankAccountRequest {
  bankName: string;
  accountName: string;
  accountNumber: string;
  ifscCode: string;
  branchName: string;
  openingBalance: number;
}

export interface MoneyTransaction {
  id?: number;
  transactionId?: number;
  type: string;
  date?: string;
  transactionDate?: string;
  partyName?: string;
  amount: number;
  note?: string;
  createdBy?: string;
}

export interface CashSummary {
  balance?: number;
  cashInHand?: number;
  totalCashIn?: number;
  totalCashOut?: number;
}

export interface DashboardTrendPoint {
  period?: string;
  label?: string;
  month?: string;
  sales?: number;
  purchases?: number;
  saleAmount?: number;
  purchaseAmount?: number;
}

export interface DashboardTrendingItem {
  itemId: number;
  itemName: string;
  quantity: number;
  totalAmount: number;
  percentage?: number;
}

export interface DashboardRecentInvoice {
  saleId: number;
  invoiceDate: string;
  saleCode: string;
  customerName: string;
  grandTotal: number;
  balance: number;
  status: string;
}

export interface DashboardLowStockItem {
  itemId: number;
  itemName: string;
  brand?: string;
  category?: string;
  minimumStock: number;
  currentStock: number;
  unit?: string;
}

export interface DashboardSummary {
  todaySales?: number;
  todayPurchase?: number;
  todayExpense?: number;
  todayCollection?: number;
  cashInHand?: number;
  bankBalance?: number;
  stockValue?: number;
  totalCustomers?: number;
  totalSuppliers?: number;
  lowStockItems?: number | DashboardLowStockItem[];
  pendingSaleOrders?: number;
  completedSaleOrders?: number;
  paymentReceivables?: number;
  paymentPayables?: number;
  pendingPurchaseOrders?: number;
  completedPurchaseOrders?: number;
  totalExpense?: number;
  saleVsPurchase?: DashboardTrendPoint[];
  trendingItems?: DashboardTrendingItem[];
  recentInvoices?: DashboardRecentInvoice[];
  lowStockDetails?: DashboardLowStockItem[];
  generatedAt?: string;
}

export interface StockReportItem {
  itemId: number;
  itemName: string;
  warehouseId?: number;
  warehouseName?: string;
  batchId?: number;
  batchNo?: string;
  availableQty: number;
  reorderLevel: number;
  stockValue?: number;
  brandName?: string;
  categoryName?: string;
  unitName?: string;
}

export interface TopSellingItem {
  itemId: number;
  itemName: string;
  quantity: number;
  totalAmount: number;
}

export interface PermissionSummary {
  id: number;
  name: string;
  description: string;
}

export interface AssignedPermission extends PermissionSummary {
  groupName: string;
  endpoint?: string;
  status?: string;
}

export type PermissionGroups = Record<string, PermissionSummary[]>;

export interface AssignUserPermissionsRequest {
  userId: number;
  permissionIds: number[];
}
