import { createBrowserRouter, Navigate } from 'react-router-dom';
import { LoginPage } from '../pages/auth/LoginPage';
import { DashboardPage } from '../pages/dashboard/DashboardPage';
import { CustomerListPage } from '../pages/contacts/customers/CustomerListPage';
import { CustomerCreatePage } from '../pages/contacts/customers/CustomerCreatePage';
import { CustomerEditPage } from '../pages/contacts/customers/CustomerEditPage';
import { CustomerViewPage } from '../pages/contacts/customers/CustomerViewPage';
import { SupplierListPage } from '../pages/contacts/suppliers/SupplierListPage';
import { SupplierCreatePage } from '../pages/contacts/suppliers/SupplierCreatePage';
import { SupplierEditPage } from '../pages/contacts/suppliers/SupplierEditPage';
import { SupplierViewPage } from '../pages/contacts/suppliers/SupplierViewPage';
import { CarrierListPage } from '../pages/contacts/carriers/CarrierListPage';
import { CarrierCreatePage } from '../pages/contacts/carriers/CarrierCreatePage';
import { CarrierEditPage } from '../pages/contacts/carriers/CarrierEditPage';
import { CarrierViewPage } from '../pages/contacts/carriers/CarrierViewPage';
import { PosPage } from '../pages/sales/pos/PosPage';
import { SaleListPage } from '../pages/sales/invoices/SaleListPage';
import { SaleCreatePage } from '../pages/sales/invoices/SaleCreatePage';
import { SaleEditPage } from '../pages/sales/invoices/SaleEditPage';
import { SaleViewPage } from '../pages/sales/invoices/SaleViewPage';
import { QuotationListPage } from '../pages/sales/quotations/QuotationListPage';
import { QuotationCreatePage } from '../pages/sales/quotations/QuotationCreatePage';
import { PaymentInListPage } from '../pages/sales/payment-in/PaymentInListPage';
import { PaymentInCreatePage } from '../pages/sales/payment-in/PaymentInCreatePage';
import { PaymentInEditPage } from '../pages/sales/payment-in/PaymentInEditPage';
import { PaymentInViewPage } from '../pages/sales/payment-in/PaymentInViewPage';
import { SaleOrderListPage } from '../pages/sales/orders/SaleOrderListPage';
import { SaleOrderCreatePage } from '../pages/sales/orders/SaleOrderCreatePage';
import { SaleOrderEditPage } from '../pages/sales/orders/SaleOrderEditPage';
import { SaleOrderViewPage } from '../pages/sales/orders/SaleOrderViewPage';
import { PurchaseListPage } from '../pages/purchase/bills/PurchaseListPage';
import { PurchaseCreatePage } from '../pages/purchase/bills/PurchaseCreatePage';
import { PurchaseEditPage } from '../pages/purchase/bills/PurchaseEditPage';
import { PurchaseViewPage } from '../pages/purchase/bills/PurchaseViewPage';
import { PaymentOutListPage } from '../pages/purchase/payment-out/PaymentOutListPage';
import { PaymentOutCreatePage } from '../pages/purchase/payment-out/PaymentOutCreatePage';
import { PaymentOutEditPage } from '../pages/purchase/payment-out/PaymentOutEditPage';
import { PaymentOutViewPage } from '../pages/purchase/payment-out/PaymentOutViewPage';
import { PurchaseOrderListPage } from '../pages/purchase/orders/PurchaseOrderListPage';
import { PurchaseOrderCreatePage } from '../pages/purchase/orders/PurchaseOrderCreatePage';
import { PurchaseOrderEditPage } from '../pages/purchase/orders/PurchaseOrderEditPage';
import { PurchaseReturnListPage } from '../pages/purchase/returns/PurchaseReturnListPage';
import { PurchaseReturnCreatePage } from '../pages/purchase/returns/PurchaseReturnCreatePage';
import { PurchaseReturnViewPage } from '../pages/purchase/returns/PurchaseReturnViewPage';
import { ItemListPage } from '../pages/items/ItemListPage';
import { ItemCreatePage } from '../pages/items/ItemCreatePage';
import { ItemEditPage } from '../pages/items/ItemEditPage';
import { ItemViewPage } from '../pages/items/ItemViewPage';
import { ItemStockPage } from '../pages/items/ItemStockPage';
import { MasterListPage } from '../pages/items/MasterListPage';
import { MasterFormPage } from '../pages/items/MasterFormPage';
import { UnitListPage } from '../pages/items/UnitListPage';
import { UnitFormPage } from '../pages/items/UnitFormPage';
import { StockTransferListPage } from '../pages/stock/transfers/StockTransferListPage';
import { StockTransferCreatePage } from '../pages/stock/transfers/StockTransferCreatePage';
import { StockTransferViewPage } from '../pages/stock/transfers/StockTransferViewPage';
import { StockAdjustmentListPage } from '../pages/stock/adjustments/StockAdjustmentListPage';
import { StockAdjustmentCreatePage } from '../pages/stock/adjustments/StockAdjustmentCreatePage';
import { StockAdjustmentViewPage } from '../pages/stock/adjustments/StockAdjustmentViewPage';
import { ExpenseListPage } from '../pages/expense/ExpenseListPage';
import { ExpenseCreatePage } from '../pages/expense/ExpenseCreatePage';
import { ExpenseEditPage } from '../pages/expense/ExpenseEditPage';
import { ExpenseViewPage } from '../pages/expense/ExpenseViewPage';
import { ExpenseMasterListPage } from '../pages/expense/ExpenseMasterListPage';
import { ExpenseMasterFormPage } from '../pages/expense/ExpenseMasterFormPage';
import { ExpenseMasterViewPage } from '../pages/expense/ExpenseMasterViewPage';
import { CashInHandPage } from '../pages/cash-bank/CashInHandPage';
import { BankTransactionsPage } from '../pages/cash-bank/BankTransactionsPage';
import { BankAccountsPage } from '../pages/cash-bank/BankAccountsPage';
import { ChequesPage } from '../pages/cash-bank/ChequesPage';
import { WarehouseListPage } from '../pages/warehouses/WarehouseListPage';
import { WarehouseFormPage } from '../pages/warehouses/WarehouseFormPage';
import { WarehouseViewPage } from '../pages/warehouses/WarehouseViewPage';
import { OrganizationListPage } from '../pages/organizations/OrganizationListPage';
import { OrganizationCreatePage } from '../pages/organizations/OrganizationCreatePage';
import { OrganizationEditPage } from '../pages/organizations/OrganizationEditPage';
import { OrganizationViewPage } from '../pages/organizations/OrganizationViewPage';
import { ImportPage } from '../pages/utilities/ImportPage';
import { GenerateBarcodePage } from '../pages/utilities/GenerateBarcodePage';
import { UserProfilePage } from '../pages/users/UserProfilePage';
import { UserListPage } from '../pages/users/UserListPage';
import { UserCreatePage } from '../pages/users/UserCreatePage';
import { RolesPage } from '../pages/users/RolesPage';
import { RoleFormPage } from '../pages/users/RoleFormPage';
import { UserPermissionsPage } from '../pages/users/UserPermissionsPage';
import { StaffAttendancePage } from '../pages/staff/StaffAttendancePage';
import { StaffEmployeeFormPage } from '../pages/staff/StaffEmployeeFormPage';
import { StaffEmployeeViewPage } from '../pages/staff/StaffEmployeeViewPage';
import { StaffEmployeesPage } from '../pages/staff/StaffEmployeesPage';
import { StaffLeavesPage } from '../pages/staff/StaffLeavesPage';
import { StaffPayrollPage } from '../pages/staff/StaffPayrollPage';
import { StaffSettingsPage } from '../pages/staff/StaffSettingsPage';
import { CreateSmsPage } from '../pages/sms/CreateSmsPage';
import { CreateEmailPage } from '../pages/email/CreateEmailPage';
import { MessageTemplateListPage } from '../pages/common/MessageTemplateListPage';
import { MessageTemplateFormPage } from '../pages/common/MessageTemplateFormPage';
import { ReportPage } from '../pages/reports/ReportPage';
import { ProfitLossReportPage } from '../pages/reports/ProfitLossReportPage';
import { AppLayout } from '../components/layout/AppLayout';
import { ProtectedRoute } from '../components/layout/ProtectedRoute';
import { getDefaultAuthorizedPath } from '../auth/featurePermissions';
import { PERMISSIONS } from '../auth/permissions';
import { useAuth } from '../hooks/useAuth';

const DefaultAuthorizedRedirect = () => {
  const { user } = useAuth();

  return (
    <Navigate
      to={getDefaultAuthorizedPath(user?.permissions, user?.role)}
      replace
    />
  );
};

export const router = createBrowserRouter([
  {
    path: '/login',
    element: <LoginPage />,
  },
  {
    path: '/',
    element: (
      <ProtectedRoute>
        <DefaultAuthorizedRedirect />
      </ProtectedRoute>
    ),
  },
  {
    path: '/dashboard',
    element: (
      <ProtectedRoute permissions={PERMISSIONS.DASHBOARD_VIEW}>
        <AppLayout>
          <DashboardPage />
        </AppLayout>
      </ProtectedRoute>
    ),
  },
  // Customers
  {
    path: '/contacts/customers',
    element: (
      <ProtectedRoute permissions={PERMISSIONS.CUSTOMER_VIEW}>
        <AppLayout>
          <CustomerListPage />
        </AppLayout>
      </ProtectedRoute>
    ),
  },
  {
    path: '/contacts/customers/create',
    element: (
      <ProtectedRoute permissions={PERMISSIONS.CUSTOMER_CREATE}>
        <AppLayout>
          <CustomerCreatePage />
        </AppLayout>
      </ProtectedRoute>
    ),
  },
  {
    path: '/contacts/customers/:id/edit',
    element: (
      <ProtectedRoute permissions={[PERMISSIONS.CUSTOMER_UPDATE, PERMISSIONS.CUSTOMER_VIEW]} requireAll>
        <AppLayout>
          <CustomerEditPage />
        </AppLayout>
      </ProtectedRoute>
    ),
  },
  {
    path: '/contacts/customers/:id',
    element: (
      <ProtectedRoute permissions={PERMISSIONS.CUSTOMER_VIEW}>
        <AppLayout>
          <CustomerViewPage />
        </AppLayout>
      </ProtectedRoute>
    ),
  },
  // Suppliers
  {
    path: '/contacts/suppliers',
    element: (
      <ProtectedRoute permissions={PERMISSIONS.SUPPLIER_VIEW}>
        <AppLayout>
          <SupplierListPage />
        </AppLayout>
      </ProtectedRoute>
    ),
  },
  {
    path: '/contacts/suppliers/create',
    element: (
      <ProtectedRoute permissions={PERMISSIONS.SUPPLIER_CREATE}>
        <AppLayout>
          <SupplierCreatePage />
        </AppLayout>
      </ProtectedRoute>
    ),
  },
  {
    path: '/contacts/suppliers/:id/edit',
    element: (
      <ProtectedRoute permissions={[PERMISSIONS.SUPPLIER_UPDATE, PERMISSIONS.SUPPLIER_VIEW]} requireAll>
        <AppLayout>
          <SupplierEditPage />
        </AppLayout>
      </ProtectedRoute>
    ),
  },
  {
    path: '/contacts/suppliers/:id',
    element: (
      <ProtectedRoute permissions={PERMISSIONS.SUPPLIER_VIEW}>
        <AppLayout>
          <SupplierViewPage />
        </AppLayout>
      </ProtectedRoute>
    ),
  },
  // Carriers
  {
    path: '/contacts/carriers',
    element: <ProtectedRoute permissions={PERMISSIONS.CARRIER_VIEW}><AppLayout><CarrierListPage /></AppLayout></ProtectedRoute>,
  },
  {
    path: '/contacts/carriers/create',
    element: <ProtectedRoute permissions={PERMISSIONS.CARRIER_CREATE}><AppLayout><CarrierCreatePage /></AppLayout></ProtectedRoute>,
  },
  {
    path: '/contacts/carriers/:id/edit',
    element: <ProtectedRoute permissions={[PERMISSIONS.CARRIER_UPDATE, PERMISSIONS.CARRIER_VIEW]} requireAll><AppLayout><CarrierEditPage /></AppLayout></ProtectedRoute>,
  },
  {
    path: '/contacts/carriers/:id',
    element: <ProtectedRoute permissions={PERMISSIONS.CARRIER_VIEW}><AppLayout><CarrierViewPage /></AppLayout></ProtectedRoute>,
  },
  {
    path: '/sales/pos',
    element: <ProtectedRoute permissions={PERMISSIONS.POS_BILLING_CREATE}><PosPage /></ProtectedRoute>,
  },
  { path: '/sales/invoices', element: <ProtectedRoute permissions={PERMISSIONS.SALES_VIEW}><AppLayout><SaleListPage /></AppLayout></ProtectedRoute> },
  { path: '/sales/invoices/create', element: <ProtectedRoute permissions={PERMISSIONS.SALES_CREATE}><AppLayout><SaleCreatePage /></AppLayout></ProtectedRoute> },
  { path: '/sales/invoices/:id/edit', element: <ProtectedRoute permissions={[PERMISSIONS.SALES_UPDATE, PERMISSIONS.SALES_VIEW]} requireAll><AppLayout><SaleEditPage /></AppLayout></ProtectedRoute> },
  { path: '/sales/invoices/:id', element: <ProtectedRoute permissions={PERMISSIONS.SALES_VIEW}><AppLayout><SaleViewPage /></AppLayout></ProtectedRoute> },
  { path: '/sales/quotations', element: <ProtectedRoute permissions={PERMISSIONS.SALES_VIEW}><AppLayout><QuotationListPage /></AppLayout></ProtectedRoute> },
  { path: '/sales/quotations/create', element: <ProtectedRoute permissions={PERMISSIONS.SALES_CREATE}><AppLayout><QuotationCreatePage /></AppLayout></ProtectedRoute> },
  { path: '/sales/payment-in', element: <ProtectedRoute permissions={PERMISSIONS.PAYMENT_IN_VIEW}><AppLayout><PaymentInListPage /></AppLayout></ProtectedRoute> },
  { path: '/sales/payment-in/create', element: <ProtectedRoute permissions={PERMISSIONS.PAYMENT_IN_CREATE}><AppLayout><PaymentInCreatePage /></AppLayout></ProtectedRoute> },
  { path: '/sales/payment-in/:id/edit', element: <ProtectedRoute permissions={[PERMISSIONS.PAYMENT_IN_UPDATE, PERMISSIONS.PAYMENT_IN_VIEW]} requireAll><AppLayout><PaymentInEditPage /></AppLayout></ProtectedRoute> },
  { path: '/sales/payment-in/:id', element: <ProtectedRoute permissions={PERMISSIONS.PAYMENT_IN_VIEW}><AppLayout><PaymentInViewPage /></AppLayout></ProtectedRoute> },
  { path: '/sales/orders', element: <ProtectedRoute permissions={PERMISSIONS.SALES_VIEW}><AppLayout><SaleOrderListPage /></AppLayout></ProtectedRoute> },
  { path: '/sales/orders/create', element: <ProtectedRoute permissions={PERMISSIONS.SALES_CREATE}><AppLayout><SaleOrderCreatePage /></AppLayout></ProtectedRoute> },
  { path: '/sales/orders/:id/edit', element: <ProtectedRoute permissions={[PERMISSIONS.SALES_UPDATE, PERMISSIONS.SALES_VIEW]} requireAll><AppLayout><SaleOrderEditPage /></AppLayout></ProtectedRoute> },
  { path: '/sales/orders/:id', element: <ProtectedRoute permissions={PERMISSIONS.SALES_VIEW}><AppLayout><SaleOrderViewPage /></AppLayout></ProtectedRoute> },
  { path: '/purchase/bills', element: <ProtectedRoute permissions={PERMISSIONS.PURCHASE_VIEW}><AppLayout><PurchaseListPage /></AppLayout></ProtectedRoute> },
  { path: '/purchase/bills/create', element: <ProtectedRoute permissions={PERMISSIONS.PURCHASE_CREATE}><AppLayout><PurchaseCreatePage /></AppLayout></ProtectedRoute> },
  { path: '/purchase/bills/:id/edit', element: <ProtectedRoute permissions={[PERMISSIONS.PURCHASE_UPDATE, PERMISSIONS.PURCHASE_VIEW]} requireAll><AppLayout><PurchaseEditPage /></AppLayout></ProtectedRoute> },
  { path: '/purchase/bills/:id', element: <ProtectedRoute permissions={PERMISSIONS.PURCHASE_VIEW}><AppLayout><PurchaseViewPage /></AppLayout></ProtectedRoute> },
  { path: '/purchase/payment-out', element: <ProtectedRoute permissions={PERMISSIONS.PAYMENT_OUT_VIEW}><AppLayout><PaymentOutListPage /></AppLayout></ProtectedRoute> },
  { path: '/purchase/payment-out/create', element: <ProtectedRoute permissions={PERMISSIONS.PAYMENT_OUT_CREATE}><AppLayout><PaymentOutCreatePage /></AppLayout></ProtectedRoute> },
  { path: '/purchase/payment-out/:id/edit', element: <ProtectedRoute permissions={[PERMISSIONS.PAYMENT_OUT_UPDATE, PERMISSIONS.PAYMENT_OUT_VIEW]} requireAll><AppLayout><PaymentOutEditPage /></AppLayout></ProtectedRoute> },
  { path: '/purchase/payment-out/:id', element: <ProtectedRoute permissions={PERMISSIONS.PAYMENT_OUT_VIEW}><AppLayout><PaymentOutViewPage /></AppLayout></ProtectedRoute> },
  { path: '/purchase/orders', element: <ProtectedRoute permissions={PERMISSIONS.PURCHASE_VIEW}><AppLayout><PurchaseOrderListPage /></AppLayout></ProtectedRoute> },
  { path: '/purchase/orders/create', element: <ProtectedRoute permissions={PERMISSIONS.PURCHASE_CREATE}><AppLayout><PurchaseOrderCreatePage /></AppLayout></ProtectedRoute> },
  { path: '/purchase/orders/:id/edit', element: <ProtectedRoute permissions={[PERMISSIONS.PURCHASE_UPDATE, PERMISSIONS.PURCHASE_VIEW]} requireAll><AppLayout><PurchaseOrderEditPage /></AppLayout></ProtectedRoute> },
  { path: '/purchase/orders/:id', element: <ProtectedRoute permissions={PERMISSIONS.PURCHASE_VIEW}><AppLayout><PurchaseViewPage /></AppLayout></ProtectedRoute> },
  { path: '/purchase/returns', element: <ProtectedRoute permissions={PERMISSIONS.PURCHASE_RETURN_VIEW}><AppLayout><PurchaseReturnListPage /></AppLayout></ProtectedRoute> },
  { path: '/purchase/returns/create', element: <ProtectedRoute permissions={PERMISSIONS.PURCHASE_RETURN_CREATE}><AppLayout><PurchaseReturnCreatePage /></AppLayout></ProtectedRoute> },
  { path: '/purchase/returns/:id', element: <ProtectedRoute permissions={PERMISSIONS.PURCHASE_RETURN_VIEW}><AppLayout><PurchaseReturnViewPage /></AppLayout></ProtectedRoute> },
  { path: '/items', element: <ProtectedRoute permissions={PERMISSIONS.ITEM_VIEW}><AppLayout><ItemListPage /></AppLayout></ProtectedRoute> },
  { path: '/items/create', element: <ProtectedRoute permissions={[PERMISSIONS.ITEM_CREATE, PERMISSIONS.CATEGORY_VIEW, PERMISSIONS.BRAND_VIEW, PERMISSIONS.UNIT_VIEW]} requireAll><AppLayout><ItemCreatePage /></AppLayout></ProtectedRoute> },
  { path: '/items/:id/edit', element: <ProtectedRoute permissions={[PERMISSIONS.ITEM_UPDATE, PERMISSIONS.ITEM_VIEW, PERMISSIONS.CATEGORY_VIEW, PERMISSIONS.BRAND_VIEW, PERMISSIONS.UNIT_VIEW]} requireAll><AppLayout><ItemEditPage /></AppLayout></ProtectedRoute> },
  { path: '/items/:id/stock', element: <ProtectedRoute permissions={PERMISSIONS.ITEM_STOCK_VIEW}><AppLayout><ItemStockPage /></AppLayout></ProtectedRoute> },
  { path: '/items/:id', element: <ProtectedRoute permissions={PERMISSIONS.ITEM_VIEW}><AppLayout><ItemViewPage /></AppLayout></ProtectedRoute> },
  { path: '/items/categories', element: <ProtectedRoute permissions={PERMISSIONS.CATEGORY_VIEW}><AppLayout><MasterListPage type="category" /></AppLayout></ProtectedRoute> },
  { path: '/items/categories/create', element: <ProtectedRoute permissions={PERMISSIONS.CATEGORY_CREATE}><AppLayout><MasterFormPage type="category" mode="create" /></AppLayout></ProtectedRoute> },
  { path: '/items/categories/:id/edit', element: <ProtectedRoute permissions={[PERMISSIONS.CATEGORY_UPDATE, PERMISSIONS.CATEGORY_VIEW]} requireAll><AppLayout><MasterFormPage type="category" mode="edit" /></AppLayout></ProtectedRoute> },
  { path: '/items/brands', element: <ProtectedRoute permissions={PERMISSIONS.BRAND_VIEW}><AppLayout><MasterListPage type="brand" /></AppLayout></ProtectedRoute> },
  { path: '/items/brands/create', element: <ProtectedRoute permissions={[PERMISSIONS.BRAND_CREATE, PERMISSIONS.CATEGORY_VIEW]} requireAll><AppLayout><MasterFormPage type="brand" mode="create" /></AppLayout></ProtectedRoute> },
  { path: '/items/brands/:id/edit', element: <ProtectedRoute permissions={[PERMISSIONS.BRAND_UPDATE, PERMISSIONS.CATEGORY_VIEW]} requireAll><AppLayout><MasterFormPage type="brand" mode="edit" /></AppLayout></ProtectedRoute> },
  { path: '/items/units', element: <ProtectedRoute permissions={PERMISSIONS.UNIT_VIEW}><AppLayout><UnitListPage /></AppLayout></ProtectedRoute> },
  { path: '/items/units/create', element: <ProtectedRoute permissions={PERMISSIONS.UNIT_CREATE}><AppLayout><UnitFormPage mode="create" /></AppLayout></ProtectedRoute> },
  { path: '/items/units/:id/edit', element: <ProtectedRoute permissions={[PERMISSIONS.UNIT_UPDATE, PERMISSIONS.UNIT_VIEW]} requireAll><AppLayout><UnitFormPage mode="edit" /></AppLayout></ProtectedRoute> },
  { path: '/stock/transfers', element: <ProtectedRoute permissions={PERMISSIONS.STOCK_TRANSFER_VIEW}><AppLayout><StockTransferListPage /></AppLayout></ProtectedRoute> },
  { path: '/stock/transfers/create', element: <ProtectedRoute permissions={PERMISSIONS.STOCK_TRANSFER_CREATE}><AppLayout><StockTransferCreatePage /></AppLayout></ProtectedRoute> },
  { path: '/stock/transfers/:id/edit', element: <ProtectedRoute permissions={[PERMISSIONS.STOCK_TRANSFER_CREATE, PERMISSIONS.STOCK_TRANSFER_VIEW]} requireAll><AppLayout><StockTransferCreatePage /></AppLayout></ProtectedRoute> },
  { path: '/stock/transfers/:id', element: <ProtectedRoute permissions={PERMISSIONS.STOCK_TRANSFER_VIEW}><AppLayout><StockTransferViewPage /></AppLayout></ProtectedRoute> },
  { path: '/stock/adjustments', element: <ProtectedRoute permissions={PERMISSIONS.STOCK_ADJUSTMENT_VIEW}><AppLayout><StockAdjustmentListPage /></AppLayout></ProtectedRoute> },
  { path: '/stock/adjustments/create', element: <ProtectedRoute permissions={PERMISSIONS.STOCK_ADJUSTMENT_CREATE}><AppLayout><StockAdjustmentCreatePage /></AppLayout></ProtectedRoute> },
  { path: '/stock/adjustments/:id/edit', element: <ProtectedRoute permissions={[PERMISSIONS.STOCK_ADJUSTMENT_CREATE, PERMISSIONS.STOCK_ADJUSTMENT_VIEW]} requireAll><AppLayout><StockAdjustmentCreatePage /></AppLayout></ProtectedRoute> },
  { path: '/stock/adjustments/:id', element: <ProtectedRoute permissions={PERMISSIONS.STOCK_ADJUSTMENT_VIEW}><AppLayout><StockAdjustmentViewPage /></AppLayout></ProtectedRoute> },
  { path: '/expenses', element: <ProtectedRoute permissions={PERMISSIONS.EXPENSE_VIEW}><AppLayout><ExpenseListPage /></AppLayout></ProtectedRoute> },
  { path: '/expenses/create', element: <ProtectedRoute permissions={PERMISSIONS.EXPENSE_CREATE}><AppLayout><ExpenseCreatePage /></AppLayout></ProtectedRoute> },
  { path: '/expenses/categories', element: <ProtectedRoute permissions={PERMISSIONS.EXPENSE_VIEW}><AppLayout><ExpenseMasterListPage type="category" /></AppLayout></ProtectedRoute> },
  { path: '/expenses/categories/create', element: <ProtectedRoute permissions={PERMISSIONS.EXPENSE_CREATE}><AppLayout><ExpenseMasterFormPage type="category" mode="create" /></AppLayout></ProtectedRoute> },
  { path: '/expenses/categories/:id/edit', element: <ProtectedRoute permissions={PERMISSIONS.EXPENSE_UPDATE}><AppLayout><ExpenseMasterFormPage type="category" mode="edit" /></AppLayout></ProtectedRoute> },
  { path: '/expenses/categories/:id', element: <ProtectedRoute permissions={PERMISSIONS.EXPENSE_VIEW}><AppLayout><ExpenseMasterViewPage type="category" /></AppLayout></ProtectedRoute> },
  { path: '/expenses/subcategories', element: <ProtectedRoute permissions={PERMISSIONS.EXPENSE_VIEW}><AppLayout><ExpenseMasterListPage type="subcategory" /></AppLayout></ProtectedRoute> },
  { path: '/expenses/subcategories/create', element: <ProtectedRoute permissions={PERMISSIONS.EXPENSE_CREATE}><AppLayout><ExpenseMasterFormPage type="subcategory" mode="create" /></AppLayout></ProtectedRoute> },
  { path: '/expenses/subcategories/:id/edit', element: <ProtectedRoute permissions={PERMISSIONS.EXPENSE_UPDATE}><AppLayout><ExpenseMasterFormPage type="subcategory" mode="edit" /></AppLayout></ProtectedRoute> },
  { path: '/expenses/subcategories/:id', element: <ProtectedRoute permissions={PERMISSIONS.EXPENSE_VIEW}><AppLayout><ExpenseMasterViewPage type="subcategory" /></AppLayout></ProtectedRoute> },
  { path: '/expenses/payment-types', element: <ProtectedRoute permissions={PERMISSIONS.EXPENSE_VIEW}><AppLayout><ExpenseMasterListPage type="paymentMethod" /></AppLayout></ProtectedRoute> },
  { path: '/expenses/payment-types/create', element: <ProtectedRoute permissions={PERMISSIONS.EXPENSE_CREATE}><AppLayout><ExpenseMasterFormPage type="paymentMethod" mode="create" /></AppLayout></ProtectedRoute> },
  { path: '/expenses/payment-types/:id/edit', element: <ProtectedRoute permissions={PERMISSIONS.EXPENSE_UPDATE}><AppLayout><ExpenseMasterFormPage type="paymentMethod" mode="edit" /></AppLayout></ProtectedRoute> },
  { path: '/expenses/payment-types/:id', element: <ProtectedRoute permissions={PERMISSIONS.EXPENSE_VIEW}><AppLayout><ExpenseMasterViewPage type="paymentMethod" /></AppLayout></ProtectedRoute> },
  { path: '/expenses/:id/edit', element: <ProtectedRoute permissions={[PERMISSIONS.EXPENSE_UPDATE, PERMISSIONS.EXPENSE_VIEW]} requireAll><AppLayout><ExpenseEditPage /></AppLayout></ProtectedRoute> },
  { path: '/expenses/:id', element: <ProtectedRoute permissions={PERMISSIONS.EXPENSE_VIEW}><AppLayout><ExpenseViewPage /></AppLayout></ProtectedRoute> },
  { path: '/cash-bank/cash-in-hand', element: <ProtectedRoute permissions={PERMISSIONS.CASH_VIEW}><AppLayout><CashInHandPage /></AppLayout></ProtectedRoute> },
  { path: '/cash-bank/cash-summary', element: <ProtectedRoute permissions={PERMISSIONS.CASH_VIEW}><AppLayout><CashInHandPage /></AppLayout></ProtectedRoute> },
  { path: '/cash-bank/transactions', element: <ProtectedRoute permissions={PERMISSIONS.CASH_VIEW}><AppLayout><CashInHandPage /></AppLayout></ProtectedRoute> },
  { path: '/cash-bank/cheques', element: <ProtectedRoute permissions={PERMISSIONS.CASH_VIEW}><AppLayout><ChequesPage /></AppLayout></ProtectedRoute> },
  { path: '/cash-bank/bank', element: <ProtectedRoute permissions={PERMISSIONS.BANK_ACCOUNT_VIEW}><AppLayout><BankTransactionsPage /></AppLayout></ProtectedRoute> },
  { path: '/cash-bank/bank-accounts', element: <ProtectedRoute permissions={PERMISSIONS.BANK_ACCOUNT_VIEW}><AppLayout><BankAccountsPage /></AppLayout></ProtectedRoute> },
  { path: '/warehouses', element: <ProtectedRoute permissions={PERMISSIONS.WAREHOUSE_VIEW}><AppLayout><WarehouseListPage /></AppLayout></ProtectedRoute> },
  { path: '/warehouses/create', element: <ProtectedRoute permissions={PERMISSIONS.WAREHOUSE_CREATE}><AppLayout><WarehouseFormPage mode="create" /></AppLayout></ProtectedRoute> },
  { path: '/warehouses/:id/edit', element: <ProtectedRoute permissions={[PERMISSIONS.WAREHOUSE_UPDATE, PERMISSIONS.WAREHOUSE_VIEW]} requireAll><AppLayout><WarehouseFormPage mode="edit" /></AppLayout></ProtectedRoute> },
  { path: '/warehouses/:id', element: <ProtectedRoute permissions={PERMISSIONS.WAREHOUSE_VIEW}><AppLayout><WarehouseViewPage /></AppLayout></ProtectedRoute> },
  { path: '/organizations', element: <ProtectedRoute permissions={PERMISSIONS.ORGANIZATION_VIEW}><AppLayout><OrganizationListPage /></AppLayout></ProtectedRoute> },
  { path: '/organizations/create', element: <ProtectedRoute permissions={PERMISSIONS.ORGANIZATION_CREATE}><AppLayout><OrganizationCreatePage /></AppLayout></ProtectedRoute> },
  { path: '/organizations/:id/edit', element: <ProtectedRoute permissions={[PERMISSIONS.ORGANIZATION_UPDATE, PERMISSIONS.ORGANIZATION_VIEW]} requireAll><AppLayout><OrganizationEditPage /></AppLayout></ProtectedRoute> },
  { path: '/organizations/:id', element: <ProtectedRoute permissions={PERMISSIONS.ORGANIZATION_VIEW}><AppLayout><OrganizationViewPage /></AppLayout></ProtectedRoute> },
  { path: '/utilities/import-items', element: <ProtectedRoute permissions={[PERMISSIONS.ITEM_IMPORT, PERMISSIONS.ITEM_TEMPLATE_DOWNLOAD]}><AppLayout><ImportPage type="items" /></AppLayout></ProtectedRoute> },
  { path: '/utilities/import-contacts', element: <ProtectedRoute permissions={[PERMISSIONS.CONTACT_IMPORT, PERMISSIONS.CONTACT_TEMPLATE_DOWNLOAD]}><AppLayout><ImportPage type="contacts" /></AppLayout></ProtectedRoute> },
  { path: '/utilities/generate-barcode', element: <ProtectedRoute permissions={PERMISSIONS.ITEM_VIEW}><AppLayout><GenerateBarcodePage /></AppLayout></ProtectedRoute> },
  { path: '/profile', element: <ProtectedRoute permissions={[PERMISSIONS.USER_PROFILE_VIEW, PERMISSIONS.USER_CHANGE_PASSWORD]}><AppLayout><UserProfilePage /></AppLayout></ProtectedRoute> },
  { path: '/users', element: <ProtectedRoute permissions={PERMISSIONS.USER_VIEW}><AppLayout><UserListPage /></AppLayout></ProtectedRoute> },
  { path: '/users/create', element: <ProtectedRoute permissions={[PERMISSIONS.USER_CREATE, PERMISSIONS.ORGANIZATION_VIEW, PERMISSIONS.ROLE_VIEW]} requireAll><AppLayout><UserCreatePage /></AppLayout></ProtectedRoute> },
  { path: '/users/:id/edit', element: <ProtectedRoute permissions={[PERMISSIONS.USER_UPDATE, PERMISSIONS.ROLE_VIEW]} requireAll><AppLayout><UserCreatePage mode="edit" /></AppLayout></ProtectedRoute> },
  { path: '/users/roles', element: <ProtectedRoute permissions={PERMISSIONS.ROLE_VIEW}><AppLayout><RolesPage /></AppLayout></ProtectedRoute> },
  { path: '/users/roles/create', element: <ProtectedRoute permissions={PERMISSIONS.ROLE_CREATE}><AppLayout><RoleFormPage mode="create" /></AppLayout></ProtectedRoute> },
  { path: '/users/roles/:id/edit', element: <ProtectedRoute permissions={[PERMISSIONS.ROLE_UPDATE, PERMISSIONS.ROLE_VIEW]} requireAll><AppLayout><RoleFormPage mode="edit" /></AppLayout></ProtectedRoute> },
  { path: '/users/permissions', element: <ProtectedRoute permissions={[PERMISSIONS.USER_UPDATE, PERMISSIONS.USER_VIEW]} requireAll><AppLayout><UserPermissionsPage /></AppLayout></ProtectedRoute> },
  { path: '/staff/employees', element: <ProtectedRoute permissions={PERMISSIONS.STAFF_EMPLOYEE_VIEW}><AppLayout><StaffEmployeesPage /></AppLayout></ProtectedRoute> },
  { path: '/staff/employees/create', element: <ProtectedRoute permissions={PERMISSIONS.STAFF_EMPLOYEE_CREATE}><AppLayout><StaffEmployeeFormPage /></AppLayout></ProtectedRoute> },
  { path: '/staff/employees/:id/edit', element: <ProtectedRoute permissions={[PERMISSIONS.STAFF_EMPLOYEE_UPDATE, PERMISSIONS.STAFF_EMPLOYEE_VIEW]} requireAll><AppLayout><StaffEmployeeFormPage mode="edit" /></AppLayout></ProtectedRoute> },
  { path: '/staff/employees/:id', element: <ProtectedRoute permissions={PERMISSIONS.STAFF_EMPLOYEE_VIEW}><AppLayout><StaffEmployeeViewPage /></AppLayout></ProtectedRoute> },
  { path: '/staff/attendance', element: <ProtectedRoute permissions={PERMISSIONS.STAFF_ATTENDANCE_VIEW}><AppLayout><StaffAttendancePage /></AppLayout></ProtectedRoute> },
  { path: '/staff/leaves', element: <ProtectedRoute permissions={PERMISSIONS.STAFF_LEAVE_VIEW}><AppLayout><StaffLeavesPage /></AppLayout></ProtectedRoute> },
  { path: '/staff/payroll', element: <ProtectedRoute permissions={PERMISSIONS.STAFF_PAYROLL_VIEW}><AppLayout><StaffPayrollPage /></AppLayout></ProtectedRoute> },
  { path: '/staff/settings', element: <ProtectedRoute permissions={PERMISSIONS.STAFF_SETTING_VIEW}><AppLayout><StaffSettingsPage /></AppLayout></ProtectedRoute> },
  { path: '/sms/create', element: <ProtectedRoute permissions={PERMISSIONS.SMS_SEND}><AppLayout><CreateSmsPage /></AppLayout></ProtectedRoute> },
  { path: '/sms/templates', element: <ProtectedRoute permissions={PERMISSIONS.SMS_TEMPLATE_VIEW}><AppLayout><MessageTemplateListPage type="sms" /></AppLayout></ProtectedRoute> },
  { path: '/sms/templates/create', element: <ProtectedRoute permissions={PERMISSIONS.SMS_TEMPLATE_CREATE}><AppLayout><MessageTemplateFormPage type="sms" /></AppLayout></ProtectedRoute> },
  { path: '/sms/templates/:id/edit', element: <ProtectedRoute permissions={[PERMISSIONS.SMS_TEMPLATE_UPDATE, PERMISSIONS.SMS_TEMPLATE_VIEW]} requireAll><AppLayout><MessageTemplateFormPage type="sms" mode="edit" /></AppLayout></ProtectedRoute> },
  { path: '/email/create', element: <ProtectedRoute permissions={PERMISSIONS.EMAIL_SEND}><AppLayout><CreateEmailPage /></AppLayout></ProtectedRoute> },
  { path: '/email/templates', element: <ProtectedRoute permissions={PERMISSIONS.EMAIL_TEMPLATE_VIEW}><AppLayout><MessageTemplateListPage type="email" /></AppLayout></ProtectedRoute> },
  { path: '/email/templates/create', element: <ProtectedRoute permissions={PERMISSIONS.EMAIL_TEMPLATE_CREATE}><AppLayout><MessageTemplateFormPage type="email" /></AppLayout></ProtectedRoute> },
  { path: '/email/templates/:id/edit', element: <ProtectedRoute permissions={[PERMISSIONS.EMAIL_TEMPLATE_UPDATE, PERMISSIONS.EMAIL_TEMPLATE_VIEW]} requireAll><AppLayout><MessageTemplateFormPage type="email" mode="edit" /></AppLayout></ProtectedRoute> },
  { path: '/reports/profit-and-loss', element: <ProtectedRoute permissions={PERMISSIONS.REPORT_PROFIT_LOSS_VIEW}><AppLayout><ProfitLossReportPage /></AppLayout></ProtectedRoute> },
  { path: '/reports/item-transaction/batch', element: <ProtectedRoute permissions={PERMISSIONS.REPORT_STOCK_VIEW}><AppLayout><ReportPage report="batch" /></AppLayout></ProtectedRoute> },
  { path: '/reports/item-transaction/serial', element: <ProtectedRoute permissions={PERMISSIONS.REPORT_STOCK_VIEW}><AppLayout><ReportPage report="serial" /></AppLayout></ProtectedRoute> },
  { path: '/reports/item-transaction/general', element: <ProtectedRoute permissions={PERMISSIONS.REPORT_STOCK_VIEW}><AppLayout><ReportPage report="general" /></AppLayout></ProtectedRoute> },
  { path: '/reports/purchase', element: <ProtectedRoute permissions={PERMISSIONS.REPORT_PURCHASE_VIEW}><AppLayout><ReportPage report="purchase" /></AppLayout></ProtectedRoute> },
  { path: '/reports/purchase/item', element: <ProtectedRoute permissions={PERMISSIONS.REPORT_PURCHASE_VIEW}><AppLayout><ReportPage report="itemPurchase" /></AppLayout></ProtectedRoute> },
  { path: '/reports/purchase/payment', element: <ProtectedRoute permissions={PERMISSIONS.REPORT_PURCHASE_VIEW}><AppLayout><ReportPage report="purchasePayment" /></AppLayout></ProtectedRoute> },
  { path: '/reports/sale', element: <ProtectedRoute permissions={PERMISSIONS.REPORT_SALES_VIEW}><AppLayout><ReportPage report="sale" /></AppLayout></ProtectedRoute> },
  { path: '/reports/sale/item', element: <ProtectedRoute permissions={PERMISSIONS.REPORT_SALES_VIEW}><AppLayout><ReportPage report="itemSale" /></AppLayout></ProtectedRoute> },
  { path: '/reports/sale/payment', element: <ProtectedRoute permissions={PERMISSIONS.REPORT_SALES_VIEW}><AppLayout><ReportPage report="salePayment" /></AppLayout></ProtectedRoute> },
  { path: '/reports/due/customer', element: <ProtectedRoute permissions={PERMISSIONS.REPORT_CUSTOMER_LEDGER_VIEW}><AppLayout><ReportPage report="customerDue" /></AppLayout></ProtectedRoute> },
  { path: '/reports/due/supplier', element: <ProtectedRoute permissions={PERMISSIONS.REPORT_SUPPLIER_LEDGER_VIEW}><AppLayout><ReportPage report="supplierDue" /></AppLayout></ProtectedRoute> },
  { path: '/reports/expense', element: <ProtectedRoute permissions={PERMISSIONS.EXPENSE_VIEW}><AppLayout><ReportPage report="expense" /></AppLayout></ProtectedRoute> },
  { path: '/reports/expense/item', element: <ProtectedRoute permissions={PERMISSIONS.EXPENSE_VIEW}><AppLayout><ReportPage report="expenseItem" /></AppLayout></ProtectedRoute> },
  { path: '/reports/expense/payment', element: <ProtectedRoute permissions={PERMISSIONS.EXPENSE_VIEW}><AppLayout><ReportPage report="expensePayment" /></AppLayout></ProtectedRoute> },
  { path: '/reports/transactions/cash-flow', element: <ProtectedRoute permissions={PERMISSIONS.CASH_VIEW}><AppLayout><ReportPage report="cashFlow" /></AppLayout></ProtectedRoute> },
  { path: '/reports/transactions/bank-statement', element: <ProtectedRoute permissions={PERMISSIONS.BANK_ACCOUNT_VIEW}><AppLayout><ReportPage report="bankStatement" /></AppLayout></ProtectedRoute> },
  { path: '/reports/ledger/supplier', element: <ProtectedRoute permissions={PERMISSIONS.REPORT_SUPPLIER_LEDGER_VIEW}><AppLayout><ReportPage report="supplierLedger" /></AppLayout></ProtectedRoute> },
  { path: '/reports/ledger/customer', element: <ProtectedRoute permissions={PERMISSIONS.REPORT_CUSTOMER_LEDGER_VIEW}><AppLayout><ReportPage report="customerLedger" /></AppLayout></ProtectedRoute> },
  { path: '/reports/gst', element: <ProtectedRoute permissions={PERMISSIONS.REPORT_GST_VIEW}><AppLayout><ReportPage report="gst" /></AppLayout></ProtectedRoute> },
  { path: '/reports/gst/gstr-1', element: <ProtectedRoute permissions={PERMISSIONS.REPORT_GST_VIEW}><AppLayout><ReportPage report="gstr1" /></AppLayout></ProtectedRoute> },
  { path: '/reports/gst/gstr-2', element: <ProtectedRoute permissions={PERMISSIONS.REPORT_GST_VIEW}><AppLayout><ReportPage report="gstr2" /></AppLayout></ProtectedRoute> },
  { path: '/reports/stock-transfer', element: <ProtectedRoute permissions={PERMISSIONS.STOCK_TRANSFER_VIEW}><AppLayout><ReportPage report="stockTransfer" /></AppLayout></ProtectedRoute> },
  { path: '/reports/stock-transfer/item', element: <ProtectedRoute permissions={PERMISSIONS.STOCK_TRANSFER_VIEW}><AppLayout><ReportPage report="itemStockTransfer" /></AppLayout></ProtectedRoute> },
  { path: '/reports/stock-adjustment', element: <ProtectedRoute permissions={PERMISSIONS.STOCK_ADJUSTMENT_VIEW}><AppLayout><ReportPage report="stockAdjustment" /></AppLayout></ProtectedRoute> },
  { path: '/reports/stock-adjustment/item', element: <ProtectedRoute permissions={PERMISSIONS.STOCK_ADJUSTMENT_VIEW}><AppLayout><ReportPage report="itemStockAdjustment" /></AppLayout></ProtectedRoute> },
  { path: '/reports/stock', element: <ProtectedRoute permissions={PERMISSIONS.REPORT_STOCK_VIEW}><AppLayout><ReportPage report="stock" /></AppLayout></ProtectedRoute> },
  { path: '/reports/stock-report/batch', element: <ProtectedRoute permissions={PERMISSIONS.REPORT_STOCK_VIEW}><AppLayout><ReportPage report="stockBatch" /></AppLayout></ProtectedRoute> },
  { path: '/reports/stock-report/serial', element: <ProtectedRoute permissions={PERMISSIONS.REPORT_STOCK_VIEW}><AppLayout><ReportPage report="stockSerial" /></AppLayout></ProtectedRoute> },
  { path: '/reports/stock-report/general', element: <ProtectedRoute permissions={PERMISSIONS.REPORT_STOCK_VIEW}><AppLayout><ReportPage report="stockGeneral" /></AppLayout></ProtectedRoute> },
  { path: '/reports/low-stock', element: <ProtectedRoute permissions={PERMISSIONS.REPORT_LOW_STOCK_VIEW}><AppLayout><ReportPage report="lowStock" /></AppLayout></ProtectedRoute> },
  { path: '/reports/inventory-valuation', element: <ProtectedRoute permissions={PERMISSIONS.REPORT_INVENTORY_VALUATION_VIEW}><AppLayout><ReportPage report="inventory" /></AppLayout></ProtectedRoute> },
  { path: '/reports/top-selling-items', element: <ProtectedRoute permissions={PERMISSIONS.REPORT_TOP_SELLING_ITEMS_VIEW}><AppLayout><ReportPage report="topSelling" /></AppLayout></ProtectedRoute> },
  { path: '/reports/day-book', element: <ProtectedRoute permissions={PERMISSIONS.REPORT_DAY_BOOK_VIEW}><AppLayout><ReportPage report="dayBook" /></AppLayout></ProtectedRoute> },
  { path: '/reports/expired-items', element: <ProtectedRoute permissions={PERMISSIONS.REPORT_STOCK_VIEW}><AppLayout><ReportPage report="expiredItem" /></AppLayout></ProtectedRoute> },
  { path: '/reports/reorder-items', element: <ProtectedRoute permissions={PERMISSIONS.REPORT_LOW_STOCK_VIEW}><AppLayout><ReportPage report="reorderItem" /></AppLayout></ProtectedRoute> },
  // Catch-all
  {
    path: '*',
    element: (
      <ProtectedRoute>
        <DefaultAuthorizedRedirect />
      </ProtectedRoute>
    ),
  },
]);
