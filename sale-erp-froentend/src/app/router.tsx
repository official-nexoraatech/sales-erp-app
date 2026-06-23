import { createBrowserRouter } from 'react-router-dom';
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
import { PaymentInViewPage } from '../pages/sales/payment-in/PaymentInViewPage';
import { SaleOrderListPage } from '../pages/sales/orders/SaleOrderListPage';
import { SaleOrderCreatePage } from '../pages/sales/orders/SaleOrderCreatePage';
import { SaleOrderEditPage } from '../pages/sales/orders/SaleOrderEditPage';
import { PurchaseListPage } from '../pages/purchase/bills/PurchaseListPage';
import { PurchaseCreatePage } from '../pages/purchase/bills/PurchaseCreatePage';
import { PurchaseEditPage } from '../pages/purchase/bills/PurchaseEditPage';
import { PaymentOutListPage } from '../pages/purchase/payment-out/PaymentOutListPage';
import { PaymentOutCreatePage } from '../pages/purchase/payment-out/PaymentOutCreatePage';
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
import { CashInHandPage } from '../pages/cash-bank/CashInHandPage';
import { BankTransactionsPage } from '../pages/cash-bank/BankTransactionsPage';
import { BankAccountsPage } from '../pages/cash-bank/BankAccountsPage';
import { ChequesPage } from '../pages/cash-bank/ChequesPage';
import { WarehouseListPage } from '../pages/warehouses/WarehouseListPage';
import { WarehouseFormPage } from '../pages/warehouses/WarehouseFormPage';
import { OrganizationListPage } from '../pages/organizations/OrganizationListPage';
import { OrganizationCreatePage } from '../pages/organizations/OrganizationCreatePage';
import { OrganizationEditPage } from '../pages/organizations/OrganizationEditPage';
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
import { Navigate } from 'react-router-dom';
import { PERMISSIONS } from '../auth/permissions';

export const router = createBrowserRouter([
  {
    path: '/login',
    element: <LoginPage />,
  },
  {
    path: '/',
    element: (
      <ProtectedRoute>
        <AppLayout>
          <Navigate to="/dashboard" replace />
        </AppLayout>
      </ProtectedRoute>
    ),
  },
  {
    path: '/dashboard',
    element: (
      <ProtectedRoute>
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
      <ProtectedRoute>
        <AppLayout>
          <CustomerListPage />
        </AppLayout>
      </ProtectedRoute>
    ),
  },
  {
    path: '/contacts/customers/create',
    element: (
      <ProtectedRoute>
        <AppLayout>
          <CustomerCreatePage />
        </AppLayout>
      </ProtectedRoute>
    ),
  },
  {
    path: '/contacts/customers/:id/edit',
    element: (
      <ProtectedRoute>
        <AppLayout>
          <CustomerEditPage />
        </AppLayout>
      </ProtectedRoute>
    ),
  },
  {
    path: '/contacts/customers/:id',
    element: (
      <ProtectedRoute>
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
      <ProtectedRoute>
        <AppLayout>
          <SupplierListPage />
        </AppLayout>
      </ProtectedRoute>
    ),
  },
  {
    path: '/contacts/suppliers/create',
    element: (
      <ProtectedRoute>
        <AppLayout>
          <SupplierCreatePage />
        </AppLayout>
      </ProtectedRoute>
    ),
  },
  {
    path: '/contacts/suppliers/:id/edit',
    element: (
      <ProtectedRoute>
        <AppLayout>
          <SupplierEditPage />
        </AppLayout>
      </ProtectedRoute>
    ),
  },
  {
    path: '/contacts/suppliers/:id',
    element: (
      <ProtectedRoute>
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
    element: <ProtectedRoute><PosPage /></ProtectedRoute>,
  },
  { path: '/sales/invoices', element: <ProtectedRoute><AppLayout><SaleListPage /></AppLayout></ProtectedRoute> },
  { path: '/sales/invoices/create', element: <ProtectedRoute><AppLayout><SaleCreatePage /></AppLayout></ProtectedRoute> },
  { path: '/sales/invoices/:id/edit', element: <ProtectedRoute><AppLayout><SaleEditPage /></AppLayout></ProtectedRoute> },
  { path: '/sales/invoices/:id', element: <ProtectedRoute><AppLayout><SaleViewPage /></AppLayout></ProtectedRoute> },
  { path: '/sales/quotations', element: <ProtectedRoute><AppLayout><QuotationListPage /></AppLayout></ProtectedRoute> },
  { path: '/sales/quotations/create', element: <ProtectedRoute><AppLayout><QuotationCreatePage /></AppLayout></ProtectedRoute> },
  { path: '/sales/payment-in', element: <ProtectedRoute><AppLayout><PaymentInListPage /></AppLayout></ProtectedRoute> },
  { path: '/sales/payment-in/:id', element: <ProtectedRoute><AppLayout><PaymentInViewPage /></AppLayout></ProtectedRoute> },
  { path: '/sales/orders', element: <ProtectedRoute><AppLayout><SaleOrderListPage /></AppLayout></ProtectedRoute> },
  { path: '/sales/orders/create', element: <ProtectedRoute><AppLayout><SaleOrderCreatePage /></AppLayout></ProtectedRoute> },
  { path: '/sales/orders/:id/edit', element: <ProtectedRoute><AppLayout><SaleOrderEditPage /></AppLayout></ProtectedRoute> },
  { path: '/purchase/bills', element: <ProtectedRoute><AppLayout><PurchaseListPage /></AppLayout></ProtectedRoute> },
  { path: '/purchase/bills/create', element: <ProtectedRoute><AppLayout><PurchaseCreatePage /></AppLayout></ProtectedRoute> },
  { path: '/purchase/bills/:id/edit', element: <ProtectedRoute><AppLayout><PurchaseEditPage /></AppLayout></ProtectedRoute> },
  { path: '/purchase/payment-out', element: <ProtectedRoute><AppLayout><PaymentOutListPage /></AppLayout></ProtectedRoute> },
  { path: '/purchase/payment-out/create', element: <ProtectedRoute><AppLayout><PaymentOutCreatePage /></AppLayout></ProtectedRoute> },
  { path: '/purchase/payment-out/:id', element: <ProtectedRoute><AppLayout><PaymentOutViewPage /></AppLayout></ProtectedRoute> },
  { path: '/purchase/orders', element: <ProtectedRoute><AppLayout><PurchaseOrderListPage /></AppLayout></ProtectedRoute> },
  { path: '/purchase/orders/create', element: <ProtectedRoute><AppLayout><PurchaseOrderCreatePage /></AppLayout></ProtectedRoute> },
  { path: '/purchase/orders/:id/edit', element: <ProtectedRoute><AppLayout><PurchaseOrderEditPage /></AppLayout></ProtectedRoute> },
  { path: '/purchase/returns', element: <ProtectedRoute><AppLayout><PurchaseReturnListPage /></AppLayout></ProtectedRoute> },
  { path: '/purchase/returns/create', element: <ProtectedRoute><AppLayout><PurchaseReturnCreatePage /></AppLayout></ProtectedRoute> },
  { path: '/purchase/returns/:id', element: <ProtectedRoute><AppLayout><PurchaseReturnViewPage /></AppLayout></ProtectedRoute> },
  { path: '/items', element: <ProtectedRoute permissions={PERMISSIONS.ITEM_VIEW}><AppLayout><ItemListPage /></AppLayout></ProtectedRoute> },
  { path: '/items/create', element: <ProtectedRoute permissions={[PERMISSIONS.ITEM_CREATE, PERMISSIONS.CATEGORY_VIEW, PERMISSIONS.BRAND_VIEW, PERMISSIONS.UNIT_VIEW]} requireAll><AppLayout><ItemCreatePage /></AppLayout></ProtectedRoute> },
  { path: '/items/:id/edit', element: <ProtectedRoute permissions={[PERMISSIONS.ITEM_UPDATE, PERMISSIONS.ITEM_VIEW, PERMISSIONS.CATEGORY_VIEW, PERMISSIONS.BRAND_VIEW, PERMISSIONS.UNIT_VIEW]} requireAll><AppLayout><ItemEditPage /></AppLayout></ProtectedRoute> },
  { path: '/items/:id/stock', element: <ProtectedRoute permissions={PERMISSIONS.ITEM_VIEW}><AppLayout><ItemStockPage /></AppLayout></ProtectedRoute> },
  { path: '/items/:id', element: <ProtectedRoute permissions={PERMISSIONS.ITEM_VIEW}><AppLayout><ItemViewPage /></AppLayout></ProtectedRoute> },
  { path: '/items/categories', element: <ProtectedRoute permissions={PERMISSIONS.CATEGORY_VIEW}><AppLayout><MasterListPage type="category" /></AppLayout></ProtectedRoute> },
  { path: '/items/categories/create', element: <ProtectedRoute permissions={PERMISSIONS.CATEGORY_CREATE}><AppLayout><MasterFormPage type="category" mode="create" /></AppLayout></ProtectedRoute> },
  { path: '/items/categories/:id/edit', element: <ProtectedRoute permissions={PERMISSIONS.CATEGORY_UPDATE}><AppLayout><MasterFormPage type="category" mode="edit" /></AppLayout></ProtectedRoute> },
  { path: '/items/brands', element: <ProtectedRoute permissions={PERMISSIONS.BRAND_VIEW}><AppLayout><MasterListPage type="brand" /></AppLayout></ProtectedRoute> },
  { path: '/items/brands/create', element: <ProtectedRoute permissions={[PERMISSIONS.BRAND_CREATE, PERMISSIONS.CATEGORY_VIEW]} requireAll><AppLayout><MasterFormPage type="brand" mode="create" /></AppLayout></ProtectedRoute> },
  { path: '/items/brands/:id/edit', element: <ProtectedRoute permissions={[PERMISSIONS.BRAND_UPDATE, PERMISSIONS.CATEGORY_VIEW]} requireAll><AppLayout><MasterFormPage type="brand" mode="edit" /></AppLayout></ProtectedRoute> },
  { path: '/items/units', element: <ProtectedRoute permissions={PERMISSIONS.UNIT_VIEW}><AppLayout><UnitListPage /></AppLayout></ProtectedRoute> },
  { path: '/items/units/create', element: <ProtectedRoute permissions={PERMISSIONS.UNIT_CREATE}><AppLayout><UnitFormPage mode="create" /></AppLayout></ProtectedRoute> },
  { path: '/items/units/:id/edit', element: <ProtectedRoute permissions={PERMISSIONS.UNIT_UPDATE}><AppLayout><UnitFormPage mode="edit" /></AppLayout></ProtectedRoute> },
  { path: '/stock/transfers', element: <ProtectedRoute><AppLayout><StockTransferListPage /></AppLayout></ProtectedRoute> },
  { path: '/stock/transfers/create', element: <ProtectedRoute><AppLayout><StockTransferCreatePage /></AppLayout></ProtectedRoute> },
  { path: '/stock/transfers/:id', element: <ProtectedRoute><AppLayout><StockTransferViewPage /></AppLayout></ProtectedRoute> },
  { path: '/stock/adjustments', element: <ProtectedRoute><AppLayout><StockAdjustmentListPage /></AppLayout></ProtectedRoute> },
  { path: '/stock/adjustments/create', element: <ProtectedRoute><AppLayout><StockAdjustmentCreatePage /></AppLayout></ProtectedRoute> },
  { path: '/stock/adjustments/:id', element: <ProtectedRoute><AppLayout><StockAdjustmentViewPage /></AppLayout></ProtectedRoute> },
  { path: '/expenses', element: <ProtectedRoute><AppLayout><ExpenseListPage /></AppLayout></ProtectedRoute> },
  { path: '/expenses/create', element: <ProtectedRoute><AppLayout><ExpenseCreatePage /></AppLayout></ProtectedRoute> },
  { path: '/expenses/categories', element: <ProtectedRoute><AppLayout><ExpenseMasterListPage type="category" /></AppLayout></ProtectedRoute> },
  { path: '/expenses/categories/create', element: <ProtectedRoute><AppLayout><ExpenseMasterFormPage type="category" mode="create" /></AppLayout></ProtectedRoute> },
  { path: '/expenses/categories/:id/edit', element: <ProtectedRoute><AppLayout><ExpenseMasterFormPage type="category" mode="edit" /></AppLayout></ProtectedRoute> },
  { path: '/expenses/subcategories', element: <ProtectedRoute><AppLayout><ExpenseMasterListPage type="subcategory" /></AppLayout></ProtectedRoute> },
  { path: '/expenses/subcategories/create', element: <ProtectedRoute><AppLayout><ExpenseMasterFormPage type="subcategory" mode="create" /></AppLayout></ProtectedRoute> },
  { path: '/expenses/subcategories/:id/edit', element: <ProtectedRoute><AppLayout><ExpenseMasterFormPage type="subcategory" mode="edit" /></AppLayout></ProtectedRoute> },
  { path: '/expenses/payment-types', element: <ProtectedRoute><AppLayout><ExpenseMasterListPage type="paymentMethod" /></AppLayout></ProtectedRoute> },
  { path: '/expenses/payment-types/create', element: <ProtectedRoute><AppLayout><ExpenseMasterFormPage type="paymentMethod" mode="create" /></AppLayout></ProtectedRoute> },
  { path: '/expenses/payment-types/:id/edit', element: <ProtectedRoute><AppLayout><ExpenseMasterFormPage type="paymentMethod" mode="edit" /></AppLayout></ProtectedRoute> },
  { path: '/expenses/:id/edit', element: <ProtectedRoute><AppLayout><ExpenseEditPage /></AppLayout></ProtectedRoute> },
  { path: '/expenses/:id', element: <ProtectedRoute><AppLayout><ExpenseViewPage /></AppLayout></ProtectedRoute> },
  { path: '/cash-bank/cash-in-hand', element: <ProtectedRoute><AppLayout><CashInHandPage /></AppLayout></ProtectedRoute> },
  { path: '/cash-bank/cash-summary', element: <ProtectedRoute><AppLayout><CashInHandPage /></AppLayout></ProtectedRoute> },
  { path: '/cash-bank/transactions', element: <ProtectedRoute><AppLayout><CashInHandPage /></AppLayout></ProtectedRoute> },
  { path: '/cash-bank/cheques', element: <ProtectedRoute><AppLayout><ChequesPage /></AppLayout></ProtectedRoute> },
  { path: '/cash-bank/bank', element: <ProtectedRoute><AppLayout><BankTransactionsPage /></AppLayout></ProtectedRoute> },
  { path: '/cash-bank/bank-accounts', element: <ProtectedRoute><AppLayout><BankAccountsPage /></AppLayout></ProtectedRoute> },
  { path: '/warehouses', element: <ProtectedRoute><AppLayout><WarehouseListPage /></AppLayout></ProtectedRoute> },
  { path: '/warehouses/create', element: <ProtectedRoute><AppLayout><WarehouseFormPage mode="create" /></AppLayout></ProtectedRoute> },
  { path: '/warehouses/:id/edit', element: <ProtectedRoute><AppLayout><WarehouseFormPage mode="edit" /></AppLayout></ProtectedRoute> },
  { path: '/organizations', element: <ProtectedRoute permissions={PERMISSIONS.ORGANIZATION_VIEW}><AppLayout><OrganizationListPage /></AppLayout></ProtectedRoute> },
  { path: '/organizations/create', element: <ProtectedRoute permissions={PERMISSIONS.ORGANIZATION_CREATE}><AppLayout><OrganizationCreatePage /></AppLayout></ProtectedRoute> },
  { path: '/organizations/:id/edit', element: <ProtectedRoute permissions={[PERMISSIONS.ORGANIZATION_UPDATE, PERMISSIONS.ORGANIZATION_VIEW]} requireAll><AppLayout><OrganizationEditPage /></AppLayout></ProtectedRoute> },
  { path: '/utilities/import-items', element: <ProtectedRoute><AppLayout><ImportPage type="items" /></AppLayout></ProtectedRoute> },
  { path: '/utilities/import-contacts', element: <ProtectedRoute><AppLayout><ImportPage type="contacts" /></AppLayout></ProtectedRoute> },
  { path: '/utilities/generate-barcode', element: <ProtectedRoute><AppLayout><GenerateBarcodePage /></AppLayout></ProtectedRoute> },
  { path: '/profile', element: <ProtectedRoute permissions={[PERMISSIONS.USER_PROFILE, PERMISSIONS.USER_CHANGE_PASSWORD]}><AppLayout><UserProfilePage /></AppLayout></ProtectedRoute> },
  { path: '/users', element: <ProtectedRoute permissions={PERMISSIONS.USER_MANAGE}><AppLayout><UserListPage /></AppLayout></ProtectedRoute> },
  { path: '/users/create', element: <ProtectedRoute permissions={[PERMISSIONS.USER_MANAGE, PERMISSIONS.ORGANIZATION_VIEW, PERMISSIONS.ROLE_MANAGE]} requireAll><AppLayout><UserCreatePage /></AppLayout></ProtectedRoute> },
  { path: '/users/:id/edit', element: <ProtectedRoute permissions={[PERMISSIONS.USER_MANAGE, PERMISSIONS.ROLE_MANAGE]} requireAll><AppLayout><UserCreatePage mode="edit" /></AppLayout></ProtectedRoute> },
  { path: '/users/roles', element: <ProtectedRoute permissions={PERMISSIONS.ROLE_MANAGE}><AppLayout><RolesPage /></AppLayout></ProtectedRoute> },
  { path: '/users/roles/create', element: <ProtectedRoute permissions={PERMISSIONS.ROLE_MANAGE}><AppLayout><RoleFormPage mode="create" /></AppLayout></ProtectedRoute> },
  { path: '/users/roles/:id/edit', element: <ProtectedRoute permissions={PERMISSIONS.ROLE_MANAGE}><AppLayout><RoleFormPage mode="edit" /></AppLayout></ProtectedRoute> },
  { path: '/users/permissions', element: <ProtectedRoute permissions={PERMISSIONS.USER_MANAGE}><AppLayout><UserPermissionsPage /></AppLayout></ProtectedRoute> },
  { path: '/staff/employees', element: <ProtectedRoute><AppLayout><StaffEmployeesPage /></AppLayout></ProtectedRoute> },
  { path: '/staff/employees/create', element: <ProtectedRoute><AppLayout><StaffEmployeeFormPage /></AppLayout></ProtectedRoute> },
  { path: '/staff/employees/:id/edit', element: <ProtectedRoute><AppLayout><StaffEmployeeFormPage mode="edit" /></AppLayout></ProtectedRoute> },
  { path: '/staff/employees/:id', element: <ProtectedRoute><AppLayout><StaffEmployeeViewPage /></AppLayout></ProtectedRoute> },
  { path: '/staff/attendance', element: <ProtectedRoute><AppLayout><StaffAttendancePage /></AppLayout></ProtectedRoute> },
  { path: '/staff/leaves', element: <ProtectedRoute><AppLayout><StaffLeavesPage /></AppLayout></ProtectedRoute> },
  { path: '/staff/payroll', element: <ProtectedRoute><AppLayout><StaffPayrollPage /></AppLayout></ProtectedRoute> },
  { path: '/staff/settings', element: <ProtectedRoute><AppLayout><StaffSettingsPage /></AppLayout></ProtectedRoute> },
  { path: '/sms/create', element: <ProtectedRoute><AppLayout><CreateSmsPage /></AppLayout></ProtectedRoute> },
  { path: '/sms/templates', element: <ProtectedRoute><AppLayout><MessageTemplateListPage type="sms" /></AppLayout></ProtectedRoute> },
  { path: '/sms/templates/create', element: <ProtectedRoute><AppLayout><MessageTemplateFormPage type="sms" /></AppLayout></ProtectedRoute> },
  { path: '/email/create', element: <ProtectedRoute><AppLayout><CreateEmailPage /></AppLayout></ProtectedRoute> },
  { path: '/email/templates', element: <ProtectedRoute><AppLayout><MessageTemplateListPage type="email" /></AppLayout></ProtectedRoute> },
  { path: '/email/templates/create', element: <ProtectedRoute><AppLayout><MessageTemplateFormPage type="email" /></AppLayout></ProtectedRoute> },
  { path: '/reports/profit-and-loss', element: <ProtectedRoute><AppLayout><ProfitLossReportPage /></AppLayout></ProtectedRoute> },
  { path: '/reports/item-transaction/batch', element: <ProtectedRoute><AppLayout><ReportPage report="batch" /></AppLayout></ProtectedRoute> },
  { path: '/reports/item-transaction/serial', element: <ProtectedRoute><AppLayout><ReportPage report="serial" /></AppLayout></ProtectedRoute> },
  { path: '/reports/item-transaction/general', element: <ProtectedRoute><AppLayout><ReportPage report="general" /></AppLayout></ProtectedRoute> },
  { path: '/reports/purchase', element: <ProtectedRoute><AppLayout><ReportPage report="purchase" /></AppLayout></ProtectedRoute> },
  { path: '/reports/purchase/item', element: <ProtectedRoute><AppLayout><ReportPage report="itemPurchase" /></AppLayout></ProtectedRoute> },
  { path: '/reports/purchase/payment', element: <ProtectedRoute><AppLayout><ReportPage report="purchasePayment" /></AppLayout></ProtectedRoute> },
  { path: '/reports/sale', element: <ProtectedRoute><AppLayout><ReportPage report="sale" /></AppLayout></ProtectedRoute> },
  { path: '/reports/sale/item', element: <ProtectedRoute><AppLayout><ReportPage report="itemSale" /></AppLayout></ProtectedRoute> },
  { path: '/reports/sale/payment', element: <ProtectedRoute><AppLayout><ReportPage report="salePayment" /></AppLayout></ProtectedRoute> },
  { path: '/reports/due/customer', element: <ProtectedRoute><AppLayout><ReportPage report="customerDue" /></AppLayout></ProtectedRoute> },
  { path: '/reports/due/supplier', element: <ProtectedRoute><AppLayout><ReportPage report="supplierDue" /></AppLayout></ProtectedRoute> },
  { path: '/reports/expense', element: <ProtectedRoute><AppLayout><ReportPage report="expense" /></AppLayout></ProtectedRoute> },
  { path: '/reports/expense/item', element: <ProtectedRoute><AppLayout><ReportPage report="expenseItem" /></AppLayout></ProtectedRoute> },
  { path: '/reports/expense/payment', element: <ProtectedRoute><AppLayout><ReportPage report="expensePayment" /></AppLayout></ProtectedRoute> },
  { path: '/reports/transactions/cash-flow', element: <ProtectedRoute><AppLayout><ReportPage report="cashFlow" /></AppLayout></ProtectedRoute> },
  { path: '/reports/transactions/bank-statement', element: <ProtectedRoute><AppLayout><ReportPage report="bankStatement" /></AppLayout></ProtectedRoute> },
  { path: '/reports/ledger/supplier', element: <ProtectedRoute><AppLayout><ReportPage report="supplierLedger" /></AppLayout></ProtectedRoute> },
  { path: '/reports/ledger/customer', element: <ProtectedRoute><AppLayout><ReportPage report="customerLedger" /></AppLayout></ProtectedRoute> },
  { path: '/reports/gst', element: <ProtectedRoute><AppLayout><ReportPage report="gst" /></AppLayout></ProtectedRoute> },
  { path: '/reports/gst/gstr-1', element: <ProtectedRoute><AppLayout><ReportPage report="gstr1" /></AppLayout></ProtectedRoute> },
  { path: '/reports/gst/gstr-2', element: <ProtectedRoute><AppLayout><ReportPage report="gstr2" /></AppLayout></ProtectedRoute> },
  { path: '/reports/stock-transfer', element: <ProtectedRoute><AppLayout><ReportPage report="stockTransfer" /></AppLayout></ProtectedRoute> },
  { path: '/reports/stock-transfer/item', element: <ProtectedRoute><AppLayout><ReportPage report="itemStockTransfer" /></AppLayout></ProtectedRoute> },
  { path: '/reports/stock-adjustment', element: <ProtectedRoute><AppLayout><ReportPage report="stockAdjustment" /></AppLayout></ProtectedRoute> },
  { path: '/reports/stock-adjustment/item', element: <ProtectedRoute><AppLayout><ReportPage report="itemStockAdjustment" /></AppLayout></ProtectedRoute> },
  { path: '/reports/stock', element: <ProtectedRoute><AppLayout><ReportPage report="stock" /></AppLayout></ProtectedRoute> },
  { path: '/reports/stock-report/batch', element: <ProtectedRoute><AppLayout><ReportPage report="stockBatch" /></AppLayout></ProtectedRoute> },
  { path: '/reports/stock-report/serial', element: <ProtectedRoute><AppLayout><ReportPage report="stockSerial" /></AppLayout></ProtectedRoute> },
  { path: '/reports/stock-report/general', element: <ProtectedRoute><AppLayout><ReportPage report="stockGeneral" /></AppLayout></ProtectedRoute> },
  { path: '/reports/low-stock', element: <ProtectedRoute><AppLayout><ReportPage report="lowStock" /></AppLayout></ProtectedRoute> },
  { path: '/reports/inventory-valuation', element: <ProtectedRoute><AppLayout><ReportPage report="inventory" /></AppLayout></ProtectedRoute> },
  { path: '/reports/top-selling-items', element: <ProtectedRoute><AppLayout><ReportPage report="topSelling" /></AppLayout></ProtectedRoute> },
  { path: '/reports/day-book', element: <ProtectedRoute><AppLayout><ReportPage report="dayBook" /></AppLayout></ProtectedRoute> },
  { path: '/reports/expired-items', element: <ProtectedRoute><AppLayout><ReportPage report="expiredItem" /></AppLayout></ProtectedRoute> },
  { path: '/reports/reorder-items', element: <ProtectedRoute><AppLayout><ReportPage report="reorderItem" /></AppLayout></ProtectedRoute> },
  // Catch-all
  {
    path: '*',
    element: <Navigate to="/dashboard" replace />,
  },
]);
