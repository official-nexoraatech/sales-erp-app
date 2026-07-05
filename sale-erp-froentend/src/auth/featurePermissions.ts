import { PERMISSIONS, type Permission } from './permissions';

export type AccessMode = 'any' | 'all';

export interface AccessRule {
  permissions: Permission[];
  mode?: AccessMode;
}

export type PermissionChecker = (permission: string) => boolean;
export type PermissionListChecker = (permissions: string[]) => boolean;

export const rule = (permissions: Permission | Permission[], mode: AccessMode = 'any'): AccessRule => ({
  permissions: Array.isArray(permissions) ? permissions : [permissions],
  mode,
});

export const canAccessRule = (
  accessRule: AccessRule | undefined,
  hasAnyPermission: PermissionListChecker,
  hasAllPermissions: PermissionListChecker,
) => {
  if (!accessRule || accessRule.permissions.length === 0) return true;
  return accessRule.mode === 'all'
    ? hasAllPermissions(accessRule.permissions)
    : hasAnyPermission(accessRule.permissions);
};

export const isSuperAdminRole = (role?: string) => role?.trim().toLowerCase() === 'super admin';

export const canAccessRuleFromPermissions = (
  accessRule: AccessRule | undefined,
  permissions: string[] = [],
  role?: string,
) => {
  if (!accessRule || accessRule.permissions.length === 0) return true;
  if (isSuperAdminRole(role)) return true;
  const permissionSet = new Set(permissions);
  return accessRule.mode === 'all'
    ? accessRule.permissions.every((permission) => permissionSet.has(permission))
    : accessRule.permissions.some((permission) => permissionSet.has(permission));
};

export const FEATURE_PERMISSIONS = {
  bankAccount: {
    view: PERMISSIONS.BANK_ACCOUNT_VIEW,
    create: PERMISSIONS.BANK_ACCOUNT_CREATE,
  },
  brand: {
    view: PERMISSIONS.BRAND_VIEW,
    create: PERMISSIONS.BRAND_CREATE,
    update: PERMISSIONS.BRAND_UPDATE,
    delete: PERMISSIONS.BRAND_DELETE,
  },
  carrier: {
    view: PERMISSIONS.CARRIER_VIEW,
    create: PERMISSIONS.CARRIER_CREATE,
    update: PERMISSIONS.CARRIER_UPDATE,
    delete: PERMISSIONS.CARRIER_DELETE,
  },
  cash: {
    view: PERMISSIONS.CASH_VIEW,
  },
  category: {
    view: PERMISSIONS.CATEGORY_VIEW,
    create: PERMISSIONS.CATEGORY_CREATE,
    update: PERMISSIONS.CATEGORY_UPDATE,
    delete: PERMISSIONS.CATEGORY_DELETE,
  },
  customer: {
    view: PERMISSIONS.CUSTOMER_VIEW,
    create: PERMISSIONS.CUSTOMER_CREATE,
    update: PERMISSIONS.CUSTOMER_UPDATE,
    delete: PERMISSIONS.CUSTOMER_DELETE,
    ledger: PERMISSIONS.CUSTOMER_LEDGER_VIEW,
  },
  dashboard: {
    view: PERMISSIONS.DASHBOARD_VIEW,
  },
  email: {
    send: PERMISSIONS.EMAIL_SEND,
    templateView: PERMISSIONS.EMAIL_TEMPLATE_VIEW,
    templateCreate: PERMISSIONS.EMAIL_TEMPLATE_CREATE,
    templateUpdate: PERMISSIONS.EMAIL_TEMPLATE_UPDATE,
    templateDelete: PERMISSIONS.EMAIL_TEMPLATE_DELETE,
  },
  expense: {
    view: PERMISSIONS.EXPENSE_VIEW,
    create: PERMISSIONS.EXPENSE_CREATE,
    update: PERMISSIONS.EXPENSE_UPDATE,
    delete: PERMISSIONS.EXPENSE_DELETE,
  },
  item: {
    view: PERMISSIONS.ITEM_VIEW,
    create: PERMISSIONS.ITEM_CREATE,
    update: PERMISSIONS.ITEM_UPDATE,
    delete: PERMISSIONS.ITEM_DELETE,
    stockView: PERMISSIONS.ITEM_STOCK_VIEW,
    import: PERMISSIONS.ITEM_IMPORT,
    templateDownload: PERMISSIONS.ITEM_TEMPLATE_DOWNLOAD,
  },
  organization: {
    view: PERMISSIONS.ORGANIZATION_VIEW,
    create: PERMISSIONS.ORGANIZATION_CREATE,
    update: PERMISSIONS.ORGANIZATION_UPDATE,
    delete: PERMISSIONS.ORGANIZATION_DELETE,
    uploadLogo: PERMISSIONS.ORGANIZATION_LOGO_UPLOAD,
  },
  paymentIn: {
    view: PERMISSIONS.PAYMENT_IN_VIEW,
    create: PERMISSIONS.PAYMENT_IN_CREATE,
  },
  paymentOut: {
    view: PERMISSIONS.PAYMENT_OUT_VIEW,
    create: PERMISSIONS.PAYMENT_OUT_CREATE,
  },
  pos: {
    create: PERMISSIONS.POS_BILLING_CREATE,
  },
  purchase: {
    view: PERMISSIONS.PURCHASE_VIEW,
    create: PERMISSIONS.PURCHASE_CREATE,
    update: PERMISSIONS.PURCHASE_UPDATE,
    delete: PERMISSIONS.PURCHASE_DELETE,
  },
  purchaseReturn: {
    view: PERMISSIONS.PURCHASE_RETURN_VIEW,
    create: PERMISSIONS.PURCHASE_RETURN_CREATE,
  },
  report: {
    customerLedger: PERMISSIONS.REPORT_CUSTOMER_LEDGER_VIEW,
    dayBook: PERMISSIONS.REPORT_DAY_BOOK_VIEW,
    gst: PERMISSIONS.REPORT_GST_VIEW,
    inventoryValuation: PERMISSIONS.REPORT_INVENTORY_VALUATION_VIEW,
    lowStock: PERMISSIONS.REPORT_LOW_STOCK_VIEW,
    profitLoss: PERMISSIONS.REPORT_PROFIT_LOSS_VIEW,
    purchase: PERMISSIONS.REPORT_PURCHASE_VIEW,
    sales: PERMISSIONS.REPORT_SALES_VIEW,
    stock: PERMISSIONS.REPORT_STOCK_VIEW,
    supplierLedger: PERMISSIONS.REPORT_SUPPLIER_LEDGER_VIEW,
    topSellingItems: PERMISSIONS.REPORT_TOP_SELLING_ITEMS_VIEW,
  },
  role: {
    view: PERMISSIONS.ROLE_VIEW,
    create: PERMISSIONS.ROLE_CREATE,
    update: PERMISSIONS.ROLE_UPDATE,
    delete: PERMISSIONS.ROLE_DELETE,
  },
  sales: {
    view: PERMISSIONS.SALES_VIEW,
    create: PERMISSIONS.SALES_CREATE,
    update: PERMISSIONS.SALES_UPDATE,
    delete: PERMISSIONS.SALES_DELETE,
    print: PERMISSIONS.SALES_INVOICE_PRINT,
  },
  salesReturn: {
    view: PERMISSIONS.SALES_RETURN_VIEW,
    create: PERMISSIONS.SALES_RETURN_CREATE,
  },
  sms: {
    send: PERMISSIONS.SMS_SEND,
    templateView: PERMISSIONS.SMS_TEMPLATE_VIEW,
    templateCreate: PERMISSIONS.SMS_TEMPLATE_CREATE,
    templateUpdate: PERMISSIONS.SMS_TEMPLATE_UPDATE,
    templateDelete: PERMISSIONS.SMS_TEMPLATE_DELETE,
  },
  stockAdjustment: {
    view: PERMISSIONS.STOCK_ADJUSTMENT_VIEW,
    create: PERMISSIONS.STOCK_ADJUSTMENT_CREATE,
  },
  stockTransfer: {
    view: PERMISSIONS.STOCK_TRANSFER_VIEW,
    create: PERMISSIONS.STOCK_TRANSFER_CREATE,
  },
  supplier: {
    view: PERMISSIONS.SUPPLIER_VIEW,
    create: PERMISSIONS.SUPPLIER_CREATE,
    update: PERMISSIONS.SUPPLIER_UPDATE,
    delete: PERMISSIONS.SUPPLIER_DELETE,
    ledger: PERMISSIONS.SUPPLIER_LEDGER_VIEW,
  },
  unit: {
    view: PERMISSIONS.UNIT_VIEW,
    create: PERMISSIONS.UNIT_CREATE,
    update: PERMISSIONS.UNIT_UPDATE,
    delete: PERMISSIONS.UNIT_DELETE,
  },
  user: {
    view: PERMISSIONS.USER_VIEW,
    create: PERMISSIONS.USER_CREATE,
    update: PERMISSIONS.USER_UPDATE,
    delete: PERMISSIONS.USER_DELETE,
    profileView: PERMISSIONS.USER_PROFILE_VIEW,
    profileUpdate: PERMISSIONS.USER_PROFILE_UPDATE,
    profileImageUpload: PERMISSIONS.USER_PROFILE_IMAGE_UPLOAD,
    changePassword: PERMISSIONS.USER_CHANGE_PASSWORD,
  },
  warehouse: {
    view: PERMISSIONS.WAREHOUSE_VIEW,
    create: PERMISSIONS.WAREHOUSE_CREATE,
    update: PERMISSIONS.WAREHOUSE_UPDATE,
    delete: PERMISSIONS.WAREHOUSE_DELETE,
  },
} as const;

export const LOCATION_LOOKUP_RULE = rule([PERMISSIONS.COUNTRY_VIEW, PERMISSIONS.STATE_VIEW], 'all');
export const ITEM_IMPORT_RULE = rule([PERMISSIONS.ITEM_IMPORT, PERMISSIONS.ITEM_TEMPLATE_DOWNLOAD]);
export const CONTACT_IMPORT_RULE = rule([PERMISSIONS.CONTACT_IMPORT, PERMISSIONS.CONTACT_TEMPLATE_DOWNLOAD]);
export const ANY_REPORT_RULE = rule(Object.values(FEATURE_PERMISSIONS.report));

export const DEFAULT_ROUTE_RULES: Array<{ path: string; access: AccessRule }> = [
  { path: '/dashboard', access: rule(FEATURE_PERMISSIONS.dashboard.view) },
  { path: '/contacts/customers', access: rule(FEATURE_PERMISSIONS.customer.view) },
  { path: '/contacts/suppliers', access: rule(FEATURE_PERMISSIONS.supplier.view) },
  { path: '/contacts/carriers', access: rule(FEATURE_PERMISSIONS.carrier.view) },
  { path: '/sales/pos', access: rule(FEATURE_PERMISSIONS.pos.create) },
  { path: '/sales/invoices', access: rule(FEATURE_PERMISSIONS.sales.view) },
  { path: '/sales/payment-in', access: rule(FEATURE_PERMISSIONS.paymentIn.view) },
  { path: '/purchase/bills', access: rule(FEATURE_PERMISSIONS.purchase.view) },
  { path: '/purchase/payment-out', access: rule(FEATURE_PERMISSIONS.paymentOut.view) },
  { path: '/items', access: rule(FEATURE_PERMISSIONS.item.view) },
  { path: '/items/categories', access: rule(FEATURE_PERMISSIONS.category.view) },
  { path: '/items/brands', access: rule(FEATURE_PERMISSIONS.brand.view) },
  { path: '/items/units', access: rule(FEATURE_PERMISSIONS.unit.view) },
  { path: '/stock/transfers', access: rule(FEATURE_PERMISSIONS.stockTransfer.view) },
  { path: '/stock/adjustments', access: rule(FEATURE_PERMISSIONS.stockAdjustment.view) },
  { path: '/expenses', access: rule(FEATURE_PERMISSIONS.expense.view) },
  { path: '/warehouses', access: rule(FEATURE_PERMISSIONS.warehouse.view) },
  { path: '/cash-bank/cash-in-hand', access: rule(FEATURE_PERMISSIONS.cash.view) },
  { path: '/cash-bank/bank-accounts', access: rule(FEATURE_PERMISSIONS.bankAccount.view) },
  { path: '/users', access: rule(FEATURE_PERMISSIONS.user.view) },
  { path: '/users/roles', access: rule(FEATURE_PERMISSIONS.role.view) },
  { path: '/sms/templates', access: rule(FEATURE_PERMISSIONS.sms.templateView) },
  { path: '/email/templates', access: rule(FEATURE_PERMISSIONS.email.templateView) },
  { path: '/reports/profit-and-loss', access: rule(FEATURE_PERMISSIONS.report.profitLoss) },
];

export const getDefaultAuthorizedPath = (permissions: string[] = [], role?: string) =>
  DEFAULT_ROUTE_RULES.find((entry) => canAccessRuleFromPermissions(entry.access, permissions, role))?.path || '/dashboard';
