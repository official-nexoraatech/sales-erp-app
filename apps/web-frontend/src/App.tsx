import { lazy, Suspense, type ReactNode } from 'react';
import { Routes, Route, Navigate, useNavigate } from 'react-router-dom';
import { useAuthStore } from './store/auth.store.js';
import Layout from './components/Layout.js';
import { PERMISSIONS } from './constants/permissions.js';
import { NAV_GROUPS, getFirstAccessiblePath } from './lib/navigation.js';
import ERPErrorBoundary from './components/erp/ERPErrorBoundary.js';
import { ERPDetailSkeleton } from './components/erp/ERPSkeleton.js';
import ERPEmptyState from './components/erp/ERPEmptyState.js';

// ── Lazy-loaded pages ────────────────────────────────────────────────────────
const LoginPage = lazy(() => import('./pages/auth/LoginPage.js'));
const ResetPasswordPage = lazy(() => import('./pages/auth/ResetPasswordPage.js'));
const SecuritySettingsPage = lazy(() => import('./pages/auth/SecuritySettingsPage.js'));
const DashboardPage = lazy(() => import('./pages/DashboardPage.js'));
const NotFoundPage = lazy(() => import('./pages/NotFoundPage.js'));
const NoModulesAssignedPage = lazy(() => import('./pages/NoModulesAssignedPage.js'));
const AccountSuspendedPage = lazy(() => import('./pages/AccountSuspendedPage.js'));

// Settings
const OrganizationPage = lazy(() => import('./pages/settings/OrganizationPage.js'));
const SsoConfigPage = lazy(() => import('./pages/settings/SsoConfigPage.js'));
const BranchesPage = lazy(() => import('./pages/settings/BranchesPage.js'));
const BranchFormPage = lazy(() => import('./pages/settings/BranchFormPage.js'));
const WarehousesPage = lazy(() => import('./pages/settings/WarehousesPage.js'));
const WarehouseFormPage = lazy(() => import('./pages/settings/WarehouseFormPage.js'));

// Users
const UsersPage = lazy(() => import('./pages/users/UsersPage.js'));
const UserFormPage = lazy(() => import('./pages/users/UserFormPage.js'));

// Customers
const CustomersPage = lazy(() => import('./pages/customers/CustomersPage.js'));
const CustomerFormPage = lazy(() => import('./pages/customers/CustomerFormPage.js'));
const CustomerViewPage = lazy(() => import('./pages/customers/CustomerViewPage.js'));

// Suppliers
const SuppliersPage = lazy(() => import('./pages/suppliers/SuppliersPage.js'));
const SupplierFormPage = lazy(() => import('./pages/suppliers/SupplierFormPage.js'));

// Inventory — Items
const CategoriesPage = lazy(() => import('./pages/items/CategoriesPage.js'));
const CategoryFormPage = lazy(() => import('./pages/items/CategoryFormPage.js'));
const BrandsPage = lazy(() => import('./pages/items/BrandsPage.js'));
const BrandFormPage = lazy(() => import('./pages/items/BrandFormPage.js'));
const UnitsPage = lazy(() => import('./pages/items/UnitsPage.js'));
const UnitFormPage = lazy(() => import('./pages/items/UnitFormPage.js'));
const ItemsPage = lazy(() => import('./pages/items/ItemsPage.js'));
const ItemFormPage = lazy(() => import('./pages/items/ItemFormPage.js'));
const PriceListsPage = lazy(() => import('./pages/items/PriceListsPage.js'));
const PriceListFormPage = lazy(() => import('./pages/items/PriceListFormPage.js'));

// GST
const GstConfigPage = lazy(() => import('./pages/gst/GstConfigPage.js'));
const GstRegisterPage = lazy(() =>
  import('./pages/gst/GstRegisterPage.js').then((m) => ({ default: m.GstRegisterPage }))
);
const Gstr1Page = lazy(() =>
  import('./pages/gst/Gstr1Page.js').then((m) => ({ default: m.Gstr1Page }))
);
const Gstr3bPage = lazy(() =>
  import('./pages/gst/Gstr3bPage.js').then((m) => ({ default: m.Gstr3bPage }))
);
const GSTR9Page = lazy(() =>
  import('./pages/gst/GSTR9Page.js').then((m) => ({ default: m.GSTR9Page }))
);
const EInvoicePage = lazy(() =>
  import('./pages/gst/EInvoicePage.js').then((m) => ({ default: m.EInvoicePage }))
);
const Gstr2aPage = lazy(() =>
  import('./pages/gst/Gstr2aPage.js').then((m) => ({ default: m.Gstr2aPage }))
);
const GstCompliancePage = lazy(() =>
  import('./pages/gst/GstCompliancePage.js').then((m) => ({ default: m.GstCompliancePage }))
);

// Accounting
const ChartOfAccountsPage = lazy(() => import('./pages/accounting/ChartOfAccountsPage.js'));
const AccountFormPage = lazy(() => import('./pages/accounting/AccountFormPage.js'));
const OpeningBalancesPage = lazy(() => import('./pages/accounting/OpeningBalancesPage.js'));
const JournalsPage = lazy(() => import('./pages/accounting/JournalsPage.js'));
const JournalFormPage = lazy(() => import('./pages/accounting/JournalFormPage.js'));
const JournalDetailPage = lazy(() => import('./pages/accounting/JournalDetailPage.js'));
const LedgerPage = lazy(() => import('./pages/accounting/LedgerPage.js'));
const TrialBalancePage = lazy(() => import('./pages/accounting/TrialBalancePage.js'));
const ProfitLossPage = lazy(() => import('./pages/accounting/ProfitLossPage.js'));
const BalanceSheetPage = lazy(() => import('./pages/accounting/BalanceSheetPage.js'));
const CashFlowPage = lazy(() => import('./pages/accounting/CashFlowPage.js'));
const BankReconciliationPage = lazy(() => import('./pages/accounting/BankReconciliationPage.js'));
const FinancialYearsPage = lazy(() => import('./pages/accounting/FinancialYearsPage.js'));
const FixedAssetsPage = lazy(() => import('./pages/accounting/FixedAssetsPage.js'));
const FixedAssetFormPage = lazy(() => import('./pages/accounting/FixedAssetFormPage.js'));
const FixedAssetDetailPage = lazy(() => import('./pages/accounting/FixedAssetDetailPage.js'));
const TDSPage = lazy(() => import('./pages/accounting/TDSPage.js'));
const CostCentersPage = lazy(() => import('./pages/accounting/CostCentersPage.js'));

// Sales
const QuotationsPage = lazy(() => import('./pages/sales/QuotationsPage.js'));
const QuotationFormPage = lazy(() => import('./pages/sales/QuotationFormPage.js'));
const QuotationDetailPage = lazy(() => import('./pages/sales/QuotationDetailPage.js'));
const InvoicesPage = lazy(() => import('./pages/sales/InvoicesPage.js'));
const InvoiceFormPage = lazy(() => import('./pages/sales/InvoiceFormPage.js'));
const InvoiceDetailPage = lazy(() => import('./pages/sales/InvoiceDetailPage.js'));
const PaymentsPage = lazy(() => import('./pages/sales/PaymentsPage.js'));
const PaymentFormPage = lazy(() => import('./pages/sales/PaymentFormPage.js'));
const SaleReturnsPage = lazy(() => import('./pages/sales/SaleReturnsPage.js'));
const SaleReturnFormPage = lazy(() => import('./pages/sales/SaleReturnFormPage.js'));
const DeliveryChallansPage = lazy(() => import('./pages/sales/DeliveryChallansPage.js'));
const DeliveryChallanFormPage = lazy(() => import('./pages/sales/DeliveryChallanFormPage.js'));
const DeliveryChallanDetailPage = lazy(() => import('./pages/sales/DeliveryChallanDetailPage.js'));

// Purchase
const PurchaseOrdersPage = lazy(() => import('./pages/purchase/PurchaseOrdersPage.js'));
const PurchaseOrderFormPage = lazy(() => import('./pages/purchase/PurchaseOrderFormPage.js'));
const GRNsPage = lazy(() => import('./pages/purchase/GRNsPage.js'));
const GRNCreatePage = lazy(() => import('./pages/purchase/GRNCreatePage.js'));
const SupplierPaymentsPage = lazy(() => import('./pages/purchase/SupplierPaymentsPage.js'));
const SupplierPaymentFormPage = lazy(() => import('./pages/purchase/SupplierPaymentFormPage.js'));
const PurchaseReturnsPage = lazy(() => import('./pages/purchase/PurchaseReturnsPage.js'));
const PurchaseReturnFormPage = lazy(() => import('./pages/purchase/PurchaseReturnFormPage.js'));
const ExpensesPage = lazy(() => import('./pages/purchase/ExpensesPage.js'));
const ExpenseFormPage = lazy(() => import('./pages/purchase/ExpenseFormPage.js'));

// Inventory — Stock
const StockLevelsPage = lazy(() => import('./pages/inventory/StockLevelsPage.js'));
const StockTransfersPage = lazy(() => import('./pages/inventory/StockTransfersPage.js'));
const StockTransferFormPage = lazy(() => import('./pages/inventory/StockTransferFormPage.js'));
const StockTransferDetailPage = lazy(() => import('./pages/inventory/StockTransferDetailPage.js'));
const StockTransferReceivePage = lazy(
  () => import('./pages/inventory/StockTransferReceivePage.js')
);
const StockAdjustmentsPage = lazy(() => import('./pages/inventory/StockAdjustmentsPage.js'));
const StockAdjustmentFormPage = lazy(() => import('./pages/inventory/StockAdjustmentFormPage.js'));
const PhysicalVerificationPage = lazy(
  () => import('./pages/inventory/PhysicalVerificationPage.js')
);
const PhysicalVerificationDetailPage = lazy(
  () => import('./pages/inventory/PhysicalVerificationDetailPage.js')
);
const FabricRollsPage = lazy(() => import('./pages/inventory/FabricRollsPage.js'));
const StockValuationPage = lazy(() => import('./pages/inventory/StockValuationPage.js'));

// CRM
const SegmentsPage = lazy(() => import('./pages/crm/SegmentsPage.js'));
const SegmentFormPage = lazy(() => import('./pages/crm/SegmentFormPage.js'));
const CampaignsPage = lazy(() => import('./pages/crm/CampaignsPage.js'));
const CampaignFormPage = lazy(() => import('./pages/crm/CampaignFormPage.js'));
const CampaignDetailPage = lazy(() => import('./pages/crm/CampaignDetailPage.js'));
const SeasonsPage = lazy(() => import('./pages/crm/SeasonsPage.js'));
const SeasonFormPage = lazy(() => import('./pages/crm/SeasonFormPage.js'));

// Production — Phase 10
const JobWorkOrdersPage = lazy(() => import('./pages/production/JobWorkOrdersPage.js'));
const JobWorkOrderCreatePage = lazy(() => import('./pages/production/JobWorkOrderCreatePage.js'));
const JobWorkOrderDetailPage = lazy(() => import('./pages/production/JobWorkOrderDetailPage.js'));
const JobWorkQualityCheckPage = lazy(() => import('./pages/production/JobWorkQualityCheckPage.js'));
const ConsignmentStockPage = lazy(() => import('./pages/production/ConsignmentStockPage.js'));
const ConsignmentSettlementsPage = lazy(
  () => import('./pages/production/ConsignmentSettlementsPage.js')
);
const ReorderReportPage = lazy(() => import('./pages/production/ReorderReportPage.js'));
const BarcodeLabelsPage = lazy(() => import('./pages/production/BarcodeLabelsPage.js'));

// Phase 11 — Reports & Analytics
const ReportsPage = lazy(() => import('./pages/reports/ReportsPage.js'));
const ReportViewerPage = lazy(() => import('./pages/reports/ReportViewerPage.js'));
const SchedulesPage = lazy(() => import('./pages/reports/SchedulesPage.js'));
const ArAgingPage = lazy(() => import('./pages/reports/ArAgingPage.js'));
const ApAgingPage = lazy(() => import('./pages/reports/ApAgingPage.js'));
const SalesAnalyticsPage = lazy(() => import('./pages/reports/SalesAnalyticsPage.js'));
const InventoryAnalyticsPage = lazy(() => import('./pages/reports/InventoryAnalyticsPage.js'));
const HRAnalyticsPage = lazy(() => import('./pages/reports/HRAnalyticsPage.js'));

// ES-19 — Enterprise Security: 2FA & Advanced Auth
const SecurityAuditLogPage = lazy(() => import('./pages/admin/SecurityAuditLogPage.js'));

// ES-20 — Audit Trail & Feature Flags
const AuditLogPage = lazy(() => import('./pages/admin/AuditLogPage.js'));
const FeatureFlagsPage = lazy(() => import('./pages/admin/FeatureFlagsPage.js'));

// Platform Admin — cross-tenant tenant management (PLATFORM_TENANT_MANAGE only)
const TenantsPage = lazy(() => import('./pages/admin/TenantsPage.js'));
const TenantFormPage = lazy(() => import('./pages/admin/TenantFormPage.js'));
const AdminTenantUsersPage = lazy(() => import('./pages/admin/AdminTenantUsersPage.js'));

// Phase 12 — Distributed Systems Admin
const DLQPage = lazy(() => import('./pages/admin/distributed/DLQPage.js'));
const SagaMonitorPage = lazy(() => import('./pages/admin/distributed/SagaMonitorPage.js'));
const EventStorePage = lazy(() => import('./pages/admin/distributed/EventStorePage.js'));
const SchemaRegistryPage = lazy(() => import('./pages/admin/distributed/SchemaRegistryPage.js'));
const ProjectionsPage = lazy(() => import('./pages/admin/distributed/ProjectionsPage.js'));
const PerformancePage = lazy(() => import('./pages/admin/distributed/PerformancePage.js'));
const SearchAnalyticsPage = lazy(() => import('./pages/admin/SearchAnalyticsPage.js'));

// HR
const EmployeesPage = lazy(() => import('./pages/hr/EmployeesPage.js'));
const EmployeeFormPage = lazy(() => import('./pages/hr/EmployeeFormPage.js'));
const EmployeeViewPage = lazy(() => import('./pages/hr/EmployeeViewPage.js'));
const AttendancePage = lazy(() => import('./pages/hr/AttendancePage.js'));
const LeavesPage = lazy(() => import('./pages/hr/LeavesPage.js'));
const PayrollPage = lazy(() => import('./pages/hr/PayrollPage.js'));
const PayslipViewPage = lazy(() => import('./pages/hr/PayslipViewPage.js'));
const HolidayCalendarPage = lazy(() => import('./pages/hr/HolidayCalendarPage.js'));
const HolidayFormPage = lazy(() => import('./pages/hr/HolidayFormPage.js'));
const PFChallanPage = lazy(() => import('./pages/hr/PFChallanPage.js'));
const ESIChallanPage = lazy(() => import('./pages/hr/ESIChallanPage.js'));
const Form16Page = lazy(() => import('./pages/hr/Form16Page.js'));
const AlterationsPage = lazy(() => import('./pages/hr/AlterationsPage.js'));
const AlterationFormPage = lazy(() => import('./pages/hr/AlterationFormPage.js'));
const AlterationDetailPage = lazy(() => import('./pages/hr/AlterationDetailPage.js'));

// ── Auth guards ──────────────────────────────────────────────────────────────
function ProtectedRoute({ children }: { children: ReactNode }) {
  const accessToken = useAuthStore((s) => s.accessToken);
  return accessToken ? <>{children}</> : <Navigate to="/login" replace />;
}

function AccessDenied() {
  const navigate = useNavigate();
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const logout = useAuthStore((s) => s.logout);
  const homePath = getFirstAccessiblePath(NAV_GROUPS, hasPermission);

  return (
    <div className="flex flex-col items-center justify-center min-h-[400px]">
      <ERPEmptyState
        type="no-access"
        action={
          homePath
            ? {
                label: 'Go to your workspace',
                onClick: () => navigate(homePath, { replace: true }),
              }
            : { label: 'Log out', onClick: logout }
        }
      />
    </div>
  );
}

// Accepts a single permission or an array (ANY match) — several routes are reachable by more
// than one role-appropriate permission (e.g. PAYMENT_VIEW or PAYMENT_IN_VIEW), mirroring the
// backend's requireAnyPermission. A single-permission check here was found (via live RBAC E2E
// testing) to silently re-introduce backend-fixed access gaps at the frontend route-guard layer.
function PermissionRoute({
  permission,
  element,
}: {
  permission: string | string[];
  element: ReactNode;
}) {
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const permissions = Array.isArray(permission) ? permission : [permission];
  const allowed = permissions.some((p) => hasPermission(p));
  return allowed ? <>{element}</> : <AccessDenied />;
}

/** Lands the user on the first nav item they can actually access (in NAV_GROUPS priority
 * order), instead of always assuming /dashboard — a user without DASHBOARD_VIEW would
 * otherwise land straight on an Access Denied page. */
function IndexRedirect() {
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const firstPath = getFirstAccessiblePath(NAV_GROUPS, hasPermission);
  return <Navigate to={firstPath ?? '/no-access'} replace />;
}

// ── Suspense wrapper for each page ───────────────────────────────────────────
function Page({ children }: { children: ReactNode }) {
  return (
    <ERPErrorBoundary>
      <Suspense fallback={<ERPDetailSkeleton />}>{children}</Suspense>
    </ERPErrorBoundary>
  );
}

// ── App ──────────────────────────────────────────────────────────────────────
export default function App() {
  return (
    <Routes>
      <Route
        path="/login"
        element={
          <Page>
            <LoginPage />
          </Page>
        }
      />
      <Route
        path="/reset-password"
        element={
          <Page>
            <ResetPasswordPage />
          </Page>
        }
      />
      <Route
        path="/account-suspended"
        element={
          <Page>
            <AccountSuspendedPage />
          </Page>
        }
      />

      <Route
        path="/"
        element={
          <ProtectedRoute>
            <Layout />
          </ProtectedRoute>
        }
      >
        <Route index element={<IndexRedirect />} />
        <Route
          path="no-access"
          element={
            <Page>
              <NoModulesAssignedPage />
            </Page>
          }
        />
        <Route
          path="dashboard"
          element={
            <Page>
              <PermissionRoute
                permission={PERMISSIONS.DASHBOARD_VIEW}
                element={<DashboardPage />}
              />
            </Page>
          }
        />
        <Route
          path="security"
          element={
            <Page>
              <SecuritySettingsPage />
            </Page>
          }
        />

        {/* Settings */}
        <Route
          path="settings/organization"
          element={
            <Page>
              <PermissionRoute
                permission={PERMISSIONS.ORGANIZATION_VIEW}
                element={<OrganizationPage />}
              />
            </Page>
          }
        />
        <Route
          path="settings/sso"
          element={
            <Page>
              <PermissionRoute
                permission={PERMISSIONS.SSO_CONFIG_MANAGE}
                element={<SsoConfigPage />}
              />
            </Page>
          }
        />
        <Route
          path="settings/branches"
          element={
            <Page>
              <PermissionRoute permission={PERMISSIONS.BRANCH_VIEW} element={<BranchesPage />} />
            </Page>
          }
        />
        <Route
          path="settings/branches/new"
          element={
            <Page>
              <PermissionRoute
                permission={PERMISSIONS.BRANCH_MANAGE}
                element={<BranchFormPage />}
              />
            </Page>
          }
        />
        <Route
          path="settings/branches/:id/edit"
          element={
            <Page>
              <PermissionRoute
                permission={PERMISSIONS.BRANCH_MANAGE}
                element={<BranchFormPage />}
              />
            </Page>
          }
        />
        <Route
          path="settings/warehouses"
          element={
            <Page>
              <PermissionRoute
                permission={PERMISSIONS.WAREHOUSE_VIEW}
                element={<WarehousesPage />}
              />
            </Page>
          }
        />
        <Route
          path="settings/warehouses/new"
          element={
            <Page>
              <PermissionRoute
                permission={PERMISSIONS.WAREHOUSE_MANAGE}
                element={<WarehouseFormPage />}
              />
            </Page>
          }
        />
        <Route
          path="settings/warehouses/:id/edit"
          element={
            <Page>
              <PermissionRoute
                permission={PERMISSIONS.WAREHOUSE_MANAGE}
                element={<WarehouseFormPage />}
              />
            </Page>
          }
        />

        {/* Users */}
        <Route
          path="users"
          element={
            <Page>
              <PermissionRoute permission={PERMISSIONS.USER_VIEW} element={<UsersPage />} />
            </Page>
          }
        />
        <Route
          path="users/new"
          element={
            <Page>
              <PermissionRoute permission={PERMISSIONS.USER_CREATE} element={<UserFormPage />} />
            </Page>
          }
        />
        <Route
          path="users/:id/edit"
          element={
            <Page>
              <PermissionRoute permission={PERMISSIONS.USER_UPDATE} element={<UserFormPage />} />
            </Page>
          }
        />

        {/* Customers */}
        <Route
          path="customers"
          element={
            <Page>
              <PermissionRoute permission={PERMISSIONS.CUSTOMER_VIEW} element={<CustomersPage />} />
            </Page>
          }
        />
        <Route
          path="customers/new"
          element={
            <Page>
              <PermissionRoute
                permission={PERMISSIONS.CUSTOMER_CREATE}
                element={<CustomerFormPage />}
              />
            </Page>
          }
        />
        <Route
          path="customers/:id"
          element={
            <Page>
              <PermissionRoute
                permission={PERMISSIONS.CUSTOMER_VIEW}
                element={<CustomerViewPage />}
              />
            </Page>
          }
        />
        <Route
          path="customers/:id/edit"
          element={
            <Page>
              <PermissionRoute
                permission={PERMISSIONS.CUSTOMER_UPDATE}
                element={<CustomerFormPage />}
              />
            </Page>
          }
        />

        {/* Suppliers */}
        <Route
          path="suppliers"
          element={
            <Page>
              <PermissionRoute permission={PERMISSIONS.SUPPLIER_VIEW} element={<SuppliersPage />} />
            </Page>
          }
        />
        <Route
          path="suppliers/new"
          element={
            <Page>
              <PermissionRoute
                permission={PERMISSIONS.SUPPLIER_CREATE}
                element={<SupplierFormPage />}
              />
            </Page>
          }
        />
        <Route
          path="suppliers/:id/edit"
          element={
            <Page>
              <PermissionRoute
                permission={PERMISSIONS.SUPPLIER_EDIT}
                element={<SupplierFormPage />}
              />
            </Page>
          }
        />

        {/* Inventory — Items */}
        <Route
          path="inventory/categories"
          element={
            <Page>
              <PermissionRoute
                permission={PERMISSIONS.CATEGORY_VIEW}
                element={<CategoriesPage />}
              />
            </Page>
          }
        />
        <Route
          path="inventory/categories/new"
          element={
            <Page>
              <PermissionRoute
                permission={PERMISSIONS.CATEGORY_CREATE}
                element={<CategoryFormPage />}
              />
            </Page>
          }
        />
        <Route
          path="inventory/categories/:id/edit"
          element={
            <Page>
              <PermissionRoute
                permission={PERMISSIONS.CATEGORY_UPDATE}
                element={<CategoryFormPage />}
              />
            </Page>
          }
        />
        <Route
          path="inventory/brands"
          element={
            <Page>
              <PermissionRoute permission={PERMISSIONS.BRAND_VIEW} element={<BrandsPage />} />
            </Page>
          }
        />
        <Route
          path="inventory/brands/new"
          element={
            <Page>
              <PermissionRoute permission={PERMISSIONS.BRAND_CREATE} element={<BrandFormPage />} />
            </Page>
          }
        />
        <Route
          path="inventory/brands/:id/edit"
          element={
            <Page>
              <PermissionRoute permission={PERMISSIONS.BRAND_UPDATE} element={<BrandFormPage />} />
            </Page>
          }
        />
        <Route
          path="inventory/units"
          element={
            <Page>
              <PermissionRoute permission={PERMISSIONS.UNIT_VIEW} element={<UnitsPage />} />
            </Page>
          }
        />
        <Route
          path="inventory/units/new"
          element={
            <Page>
              <PermissionRoute permission={PERMISSIONS.UNIT_CREATE} element={<UnitFormPage />} />
            </Page>
          }
        />
        <Route
          path="inventory/units/:id/edit"
          element={
            <Page>
              <PermissionRoute permission={PERMISSIONS.UNIT_UPDATE} element={<UnitFormPage />} />
            </Page>
          }
        />
        <Route
          path="inventory/items"
          element={
            <Page>
              <PermissionRoute permission={PERMISSIONS.ITEM_VIEW} element={<ItemsPage />} />
            </Page>
          }
        />
        <Route
          path="inventory/items/new"
          element={
            <Page>
              <PermissionRoute permission={PERMISSIONS.ITEM_CREATE} element={<ItemFormPage />} />
            </Page>
          }
        />
        <Route
          path="inventory/items/:id/edit"
          element={
            <Page>
              <PermissionRoute permission={PERMISSIONS.ITEM_EDIT} element={<ItemFormPage />} />
            </Page>
          }
        />
        <Route
          path="inventory/price-lists"
          element={
            <Page>
              <PermissionRoute
                permission={PERMISSIONS.PRICE_LIST_VIEW}
                element={<PriceListsPage />}
              />
            </Page>
          }
        />
        <Route
          path="inventory/price-lists/new"
          element={
            <Page>
              <PermissionRoute permission={PERMISSIONS.ITEM_EDIT} element={<PriceListFormPage />} />
            </Page>
          }
        />

        {/* GST */}
        <Route
          path="gst/config"
          element={
            <Page>
              <PermissionRoute permission={PERMISSIONS.GST_VIEW} element={<GstConfigPage />} />
            </Page>
          }
        />
        <Route
          path="gst/register"
          element={
            <Page>
              <PermissionRoute permission={PERMISSIONS.GST_VIEW} element={<GstRegisterPage />} />
            </Page>
          }
        />
        <Route
          path="gst/gstr1"
          element={
            <Page>
              <PermissionRoute permission={PERMISSIONS.GSTR1_VIEW} element={<Gstr1Page />} />
            </Page>
          }
        />
        <Route
          path="gst/gstr3b"
          element={
            <Page>
              <PermissionRoute permission={PERMISSIONS.GSTR3B_VIEW} element={<Gstr3bPage />} />
            </Page>
          }
        />
        <Route
          path="gst/gstr9"
          element={
            <Page>
              <PermissionRoute permission={PERMISSIONS.GSTR9_VIEW} element={<GSTR9Page />} />
            </Page>
          }
        />
        <Route
          path="gst/einvoice"
          element={
            <Page>
              <PermissionRoute permission={PERMISSIONS.GST_VIEW} element={<EInvoicePage />} />
            </Page>
          }
        />
        <Route
          path="gst/gstr2a"
          element={
            <Page>
              <PermissionRoute permission={PERMISSIONS.GSTR2A_RECONCILE} element={<Gstr2aPage />} />
            </Page>
          }
        />
        <Route
          path="gst/compliance"
          element={
            <Page>
              <PermissionRoute permission={PERMISSIONS.GST_VIEW} element={<GstCompliancePage />} />
            </Page>
          }
        />

        {/* Accounting */}
        <Route
          path="accounting/chart-of-accounts"
          element={
            <Page>
              <PermissionRoute
                permission={PERMISSIONS.ACCOUNT_VIEW}
                element={<ChartOfAccountsPage />}
              />
            </Page>
          }
        />
        <Route
          path="accounting/accounts/new"
          element={
            <Page>
              <PermissionRoute
                permission={PERMISSIONS.ACCOUNT_CREATE}
                element={<AccountFormPage />}
              />
            </Page>
          }
        />
        <Route
          path="accounting/accounts/:id/edit"
          element={
            <Page>
              <PermissionRoute
                permission={PERMISSIONS.ACCOUNT_UPDATE}
                element={<AccountFormPage />}
              />
            </Page>
          }
        />
        <Route
          path="accounting/accounts/:id/ledger"
          element={
            <Page>
              <PermissionRoute permission={PERMISSIONS.LEDGER_VIEW} element={<LedgerPage />} />
            </Page>
          }
        />
        <Route
          path="accounting/opening-balances"
          element={
            <Page>
              <PermissionRoute
                permission={PERMISSIONS.OPENING_BALANCE_LOCK}
                element={<OpeningBalancesPage />}
              />
            </Page>
          }
        />
        <Route
          path="accounting/journals"
          element={
            <Page>
              <PermissionRoute permission={PERMISSIONS.JOURNAL_VIEW} element={<JournalsPage />} />
            </Page>
          }
        />
        <Route
          path="accounting/journals/new"
          element={
            <Page>
              <PermissionRoute
                permission={PERMISSIONS.JOURNAL_CREATE}
                element={<JournalFormPage />}
              />
            </Page>
          }
        />
        <Route
          path="accounting/journals/:id"
          element={
            <Page>
              <PermissionRoute
                permission={PERMISSIONS.JOURNAL_VIEW}
                element={<JournalDetailPage />}
              />
            </Page>
          }
        />
        <Route
          path="accounting/reports/trial-balance"
          element={
            <Page>
              <PermissionRoute
                permission={PERMISSIONS.TRIAL_BALANCE_VIEW}
                element={<TrialBalancePage />}
              />
            </Page>
          }
        />
        <Route
          path="accounting/reports/profit-loss"
          element={
            <Page>
              <PermissionRoute
                permission={PERMISSIONS.PROFIT_LOSS_VIEW}
                element={<ProfitLossPage />}
              />
            </Page>
          }
        />
        <Route
          path="accounting/reports/balance-sheet"
          element={
            <Page>
              <PermissionRoute
                permission={PERMISSIONS.BALANCE_SHEET_VIEW}
                element={<BalanceSheetPage />}
              />
            </Page>
          }
        />
        <Route
          path="accounting/reports/cash-flow"
          element={
            <Page>
              <PermissionRoute permission={PERMISSIONS.CASH_FLOW_VIEW} element={<CashFlowPage />} />
            </Page>
          }
        />
        <Route
          path="accounting/bank-reconciliation"
          element={
            <Page>
              <PermissionRoute
                permission={PERMISSIONS.BANK_RECONCILIATION_VIEW}
                element={<BankReconciliationPage />}
              />
            </Page>
          }
        />
        <Route
          path="accounting/financial-years"
          element={
            <Page>
              <PermissionRoute
                permission={PERMISSIONS.FINANCIAL_YEAR_VIEW}
                element={<FinancialYearsPage />}
              />
            </Page>
          }
        />
        <Route
          path="accounting/fixed-assets"
          element={
            <Page>
              <PermissionRoute
                permission={PERMISSIONS.FIXED_ASSET_VIEW}
                element={<FixedAssetsPage />}
              />
            </Page>
          }
        />
        <Route
          path="accounting/fixed-assets/new"
          element={
            <Page>
              <PermissionRoute
                permission={PERMISSIONS.FIXED_ASSET_CREATE}
                element={<FixedAssetFormPage />}
              />
            </Page>
          }
        />
        <Route
          path="accounting/fixed-assets/:id/edit"
          element={
            <Page>
              <PermissionRoute
                permission={PERMISSIONS.FIXED_ASSET_UPDATE}
                element={<FixedAssetFormPage />}
              />
            </Page>
          }
        />
        <Route
          path="accounting/fixed-assets/:id"
          element={
            <Page>
              <PermissionRoute
                permission={PERMISSIONS.FIXED_ASSET_VIEW}
                element={<FixedAssetDetailPage />}
              />
            </Page>
          }
        />
        <Route
          path="accounting/tds"
          element={
            <Page>
              <PermissionRoute permission={PERMISSIONS.TDS_VIEW} element={<TDSPage />} />
            </Page>
          }
        />
        <Route
          path="accounting/cost-centers"
          element={
            <Page>
              <PermissionRoute
                permission={PERMISSIONS.COST_CENTER_VIEW}
                element={<CostCentersPage />}
              />
            </Page>
          }
        />

        {/* Sales */}
        <Route
          path="sales/quotations"
          element={
            <Page>
              <PermissionRoute permission={PERMISSIONS.INVOICE_VIEW} element={<QuotationsPage />} />
            </Page>
          }
        />
        <Route
          path="sales/quotations/new"
          element={
            <Page>
              <PermissionRoute
                permission={PERMISSIONS.INVOICE_CREATE}
                element={<QuotationFormPage />}
              />
            </Page>
          }
        />
        <Route
          path="sales/quotations/:id"
          element={
            <Page>
              <PermissionRoute
                permission={PERMISSIONS.INVOICE_VIEW}
                element={<QuotationDetailPage />}
              />
            </Page>
          }
        />
        <Route
          path="sales/invoices"
          element={
            <Page>
              <PermissionRoute permission={PERMISSIONS.INVOICE_VIEW} element={<InvoicesPage />} />
            </Page>
          }
        />
        <Route
          path="sales/invoices/new"
          element={
            <Page>
              <PermissionRoute
                permission={PERMISSIONS.INVOICE_CREATE}
                element={<InvoiceFormPage />}
              />
            </Page>
          }
        />
        <Route
          path="sales/invoices/:id"
          element={
            <Page>
              <PermissionRoute
                permission={PERMISSIONS.INVOICE_VIEW}
                element={<InvoiceDetailPage />}
              />
            </Page>
          }
        />
        <Route
          path="sales/payments"
          element={
            <Page>
              <PermissionRoute
                permission={[PERMISSIONS.PAYMENT_VIEW, PERMISSIONS.PAYMENT_IN_VIEW]}
                element={<PaymentsPage />}
              />
            </Page>
          }
        />
        <Route
          path="sales/payments/new"
          element={
            <Page>
              <PermissionRoute
                permission={PERMISSIONS.PAYMENT_CREATE}
                element={<PaymentFormPage />}
              />
            </Page>
          }
        />
        <Route
          path="sales/returns"
          element={
            <Page>
              <PermissionRoute
                permission={PERMISSIONS.INVOICE_VIEW}
                element={<SaleReturnsPage />}
              />
            </Page>
          }
        />
        <Route
          path="sales/returns/new"
          element={
            <Page>
              <PermissionRoute
                permission={PERMISSIONS.INVOICE_CANCEL}
                element={<SaleReturnFormPage />}
              />
            </Page>
          }
        />
        <Route
          path="sales/delivery-challans"
          element={
            <Page>
              <PermissionRoute
                permission={PERMISSIONS.INVOICE_VIEW}
                element={<DeliveryChallansPage />}
              />
            </Page>
          }
        />
        <Route
          path="sales/delivery-challans/new"
          element={
            <Page>
              <PermissionRoute
                permission={PERMISSIONS.INVOICE_CREATE}
                element={<DeliveryChallanFormPage />}
              />
            </Page>
          }
        />
        <Route
          path="sales/delivery-challans/:id"
          element={
            <Page>
              <PermissionRoute
                permission={PERMISSIONS.INVOICE_VIEW}
                element={<DeliveryChallanDetailPage />}
              />
            </Page>
          }
        />

        {/* Purchase */}
        <Route
          path="purchase/orders"
          element={
            <Page>
              <PermissionRoute permission={PERMISSIONS.PO_VIEW} element={<PurchaseOrdersPage />} />
            </Page>
          }
        />
        <Route
          path="purchase/orders/new"
          element={
            <Page>
              <PermissionRoute
                permission={PERMISSIONS.PO_CREATE}
                element={<PurchaseOrderFormPage />}
              />
            </Page>
          }
        />
        <Route
          path="purchase/grns"
          element={
            <Page>
              <PermissionRoute permission={PERMISSIONS.GRN_VIEW} element={<GRNsPage />} />
            </Page>
          }
        />
        <Route
          path="purchase/grns/new"
          element={
            <Page>
              <PermissionRoute permission={PERMISSIONS.GRN_CREATE} element={<GRNCreatePage />} />
            </Page>
          }
        />
        <Route
          path="purchase/payments"
          element={
            <Page>
              <PermissionRoute
                permission={PERMISSIONS.PAYMENT_OUT_VIEW}
                element={<SupplierPaymentsPage />}
              />
            </Page>
          }
        />
        <Route
          path="purchase/payments/new"
          element={
            <Page>
              <PermissionRoute
                permission={PERMISSIONS.PAYMENT_OUT_CREATE}
                element={<SupplierPaymentFormPage />}
              />
            </Page>
          }
        />
        <Route
          path="purchase/returns"
          element={
            <Page>
              <PermissionRoute
                permission={PERMISSIONS.PURCHASE_RETURN_VIEW}
                element={<PurchaseReturnsPage />}
              />
            </Page>
          }
        />
        <Route
          path="purchase/returns/new"
          element={
            <Page>
              <PermissionRoute
                permission={PERMISSIONS.PURCHASE_RETURN_CREATE}
                element={<PurchaseReturnFormPage />}
              />
            </Page>
          }
        />
        <Route
          path="purchase/expenses"
          element={
            <Page>
              <PermissionRoute permission={PERMISSIONS.EXPENSE_VIEW} element={<ExpensesPage />} />
            </Page>
          }
        />
        <Route
          path="purchase/expenses/new"
          element={
            <Page>
              <PermissionRoute
                permission={PERMISSIONS.EXPENSE_CREATE}
                element={<ExpenseFormPage />}
              />
            </Page>
          }
        />

        {/* Inventory — Stock */}
        <Route
          path="inventory/stock"
          element={
            <Page>
              <PermissionRoute permission={PERMISSIONS.ITEM_VIEW} element={<StockLevelsPage />} />
            </Page>
          }
        />
        <Route
          path="inventory/transfers"
          element={
            <Page>
              <PermissionRoute
                permission={[PERMISSIONS.WAREHOUSE_MANAGE, PERMISSIONS.STOCK_TRANSFER]}
                element={<StockTransfersPage />}
              />
            </Page>
          }
        />
        <Route
          path="inventory/transfers/new"
          element={
            <Page>
              <PermissionRoute
                permission={[PERMISSIONS.WAREHOUSE_MANAGE, PERMISSIONS.STOCK_TRANSFER]}
                element={<StockTransferFormPage />}
              />
            </Page>
          }
        />
        <Route
          path="inventory/transfers/:id"
          element={
            <Page>
              <PermissionRoute
                permission={[PERMISSIONS.WAREHOUSE_MANAGE, PERMISSIONS.STOCK_TRANSFER]}
                element={<StockTransferDetailPage />}
              />
            </Page>
          }
        />
        <Route
          path="inventory/transfers/:id/receive"
          element={
            <Page>
              <PermissionRoute
                permission={[PERMISSIONS.WAREHOUSE_MANAGE, PERMISSIONS.STOCK_TRANSFER]}
                element={<StockTransferReceivePage />}
              />
            </Page>
          }
        />
        <Route
          path="inventory/adjustments"
          element={
            <Page>
              <PermissionRoute
                permission={[PERMISSIONS.WAREHOUSE_MANAGE, PERMISSIONS.STOCK_ADJUST]}
                element={<StockAdjustmentsPage />}
              />
            </Page>
          }
        />
        <Route
          path="inventory/adjustments/new"
          element={
            <Page>
              <PermissionRoute
                permission={[PERMISSIONS.WAREHOUSE_MANAGE, PERMISSIONS.STOCK_ADJUST]}
                element={<StockAdjustmentFormPage />}
              />
            </Page>
          }
        />
        <Route
          path="inventory/physical-verifications"
          element={
            <Page>
              <PermissionRoute
                permission={PERMISSIONS.WAREHOUSE_MANAGE}
                element={<PhysicalVerificationPage />}
              />
            </Page>
          }
        />
        <Route
          path="inventory/physical-verifications/:id"
          element={
            <Page>
              <PermissionRoute
                permission={PERMISSIONS.WAREHOUSE_MANAGE}
                element={<PhysicalVerificationDetailPage />}
              />
            </Page>
          }
        />
        <Route
          path="inventory/fabric-rolls"
          element={
            <Page>
              <PermissionRoute permission={PERMISSIONS.ITEM_VIEW} element={<FabricRollsPage />} />
            </Page>
          }
        />
        <Route
          path="inventory/valuation"
          element={
            <Page>
              <PermissionRoute
                permission={PERMISSIONS.REPORT_VIEW}
                element={<StockValuationPage />}
              />
            </Page>
          }
        />

        {/* CRM */}
        <Route
          path="crm/segments"
          element={
            <Page>
              <PermissionRoute
                permission={PERMISSIONS.CRM_SEGMENT_VIEW}
                element={<SegmentsPage />}
              />
            </Page>
          }
        />
        <Route
          path="crm/segments/new"
          element={
            <Page>
              <PermissionRoute
                permission={PERMISSIONS.CRM_SEGMENT_CREATE}
                element={<SegmentFormPage />}
              />
            </Page>
          }
        />
        <Route
          path="crm/campaigns"
          element={
            <Page>
              <PermissionRoute permission={PERMISSIONS.CRM_VIEW} element={<CampaignsPage />} />
            </Page>
          }
        />
        <Route
          path="crm/campaigns/new"
          element={
            <Page>
              <PermissionRoute
                permission={PERMISSIONS.CRM_CAMPAIGN_CREATE}
                element={<CampaignFormPage />}
              />
            </Page>
          }
        />
        <Route
          path="crm/campaigns/:id"
          element={
            <Page>
              <PermissionRoute permission={PERMISSIONS.CRM_VIEW} element={<CampaignDetailPage />} />
            </Page>
          }
        />
        <Route
          path="crm/campaigns/:id/edit"
          element={
            <Page>
              <PermissionRoute
                permission={PERMISSIONS.CRM_CAMPAIGN_CREATE}
                element={<CampaignFormPage />}
              />
            </Page>
          }
        />
        <Route
          path="crm/seasons"
          element={
            <Page>
              <PermissionRoute permission={PERMISSIONS.CRM_SEASON_VIEW} element={<SeasonsPage />} />
            </Page>
          }
        />
        <Route
          path="crm/seasons/new"
          element={
            <Page>
              <PermissionRoute
                permission={PERMISSIONS.CRM_SEASON_MANAGE}
                element={<SeasonFormPage />}
              />
            </Page>
          }
        />
        <Route
          path="crm/seasons/:id/edit"
          element={
            <Page>
              <PermissionRoute
                permission={PERMISSIONS.CRM_SEASON_MANAGE}
                element={<SeasonFormPage />}
              />
            </Page>
          }
        />

        {/* Production — Phase 10 */}
        <Route
          path="production/job-work"
          element={
            <Page>
              <PermissionRoute
                permission={PERMISSIONS.JOB_WORK_VIEW}
                element={<JobWorkOrdersPage />}
              />
            </Page>
          }
        />
        <Route
          path="production/job-work/new"
          element={
            <Page>
              <PermissionRoute
                permission={PERMISSIONS.JOB_WORK_CREATE}
                element={<JobWorkOrderCreatePage />}
              />
            </Page>
          }
        />
        <Route
          path="production/job-work/:id"
          element={
            <Page>
              <PermissionRoute
                permission={PERMISSIONS.JOB_WORK_VIEW}
                element={<JobWorkOrderDetailPage />}
              />
            </Page>
          }
        />
        <Route
          path="production/job-work/:id/qc"
          element={
            <Page>
              <PermissionRoute
                permission={PERMISSIONS.JOB_WORK_QUALITY_CHECK}
                element={<JobWorkQualityCheckPage />}
              />
            </Page>
          }
        />
        <Route
          path="production/consignment/stock"
          element={
            <Page>
              <PermissionRoute
                permission={PERMISSIONS.CONSIGNMENT_VIEW}
                element={<ConsignmentStockPage />}
              />
            </Page>
          }
        />
        <Route
          path="production/consignment/settlements"
          element={
            <Page>
              <PermissionRoute
                permission={PERMISSIONS.CONSIGNMENT_VIEW}
                element={<ConsignmentSettlementsPage />}
              />
            </Page>
          }
        />
        <Route
          path="production/reorder"
          element={
            <Page>
              <PermissionRoute
                permission={PERMISSIONS.REORDER_VIEW}
                element={<ReorderReportPage />}
              />
            </Page>
          }
        />
        <Route
          path="production/barcode-labels"
          element={
            <Page>
              <PermissionRoute
                permission={PERMISSIONS.BARCODE_GENERATE}
                element={<BarcodeLabelsPage />}
              />
            </Page>
          }
        />

        {/* HR */}
        <Route
          path="hr/employees"
          element={
            <Page>
              <PermissionRoute permission={PERMISSIONS.EMPLOYEE_VIEW} element={<EmployeesPage />} />
            </Page>
          }
        />
        <Route
          path="hr/employees/new"
          element={
            <Page>
              <PermissionRoute
                permission={PERMISSIONS.EMPLOYEE_CREATE}
                element={<EmployeeFormPage />}
              />
            </Page>
          }
        />
        <Route
          path="hr/employees/:id"
          element={
            <Page>
              <PermissionRoute
                permission={PERMISSIONS.EMPLOYEE_VIEW}
                element={<EmployeeViewPage />}
              />
            </Page>
          }
        />
        <Route
          path="hr/employees/:id/edit"
          element={
            <Page>
              <PermissionRoute
                permission={PERMISSIONS.EMPLOYEE_UPDATE}
                element={<EmployeeFormPage />}
              />
            </Page>
          }
        />
        <Route
          path="hr/attendance"
          element={
            <Page>
              <PermissionRoute
                permission={PERMISSIONS.ATTENDANCE_VIEW}
                element={<AttendancePage />}
              />
            </Page>
          }
        />
        <Route
          path="hr/leaves"
          element={
            <Page>
              <PermissionRoute permission={PERMISSIONS.LEAVE_VIEW} element={<LeavesPage />} />
            </Page>
          }
        />
        <Route
          path="hr/payroll"
          element={
            <Page>
              <PermissionRoute permission={PERMISSIONS.PAYROLL_VIEW} element={<PayrollPage />} />
            </Page>
          }
        />
        <Route
          path="hr/payroll-slips/:id"
          element={
            <Page>
              <PermissionRoute
                permission={PERMISSIONS.VIEW_SALARY_DETAILS}
                element={<PayslipViewPage />}
              />
            </Page>
          }
        />
        <Route
          path="hr/holidays"
          element={
            <Page>
              <PermissionRoute
                permission={PERMISSIONS.HR_MANAGE}
                element={<HolidayCalendarPage />}
              />
            </Page>
          }
        />
        <Route
          path="hr/holidays/new"
          element={
            <Page>
              <PermissionRoute permission={PERMISSIONS.HR_MANAGE} element={<HolidayFormPage />} />
            </Page>
          }
        />
        <Route
          path="hr/pf-challans"
          element={
            <Page>
              <PermissionRoute permission={PERMISSIONS.HR_STATUTORY} element={<PFChallanPage />} />
            </Page>
          }
        />
        <Route
          path="hr/esi-challans"
          element={
            <Page>
              <PermissionRoute permission={PERMISSIONS.HR_STATUTORY} element={<ESIChallanPage />} />
            </Page>
          }
        />
        <Route
          path="hr/form16"
          element={
            <Page>
              <PermissionRoute
                permission={PERMISSIONS.VIEW_SALARY_DETAILS}
                element={<Form16Page />}
              />
            </Page>
          }
        />
        <Route
          path="hr/alterations"
          element={
            <Page>
              <PermissionRoute
                permission={PERMISSIONS.ALTERATION_VIEW}
                element={<AlterationsPage />}
              />
            </Page>
          }
        />
        <Route
          path="hr/alterations/new"
          element={
            <Page>
              <PermissionRoute
                permission={PERMISSIONS.ALTERATION_CREATE}
                element={<AlterationFormPage />}
              />
            </Page>
          }
        />
        <Route
          path="hr/alterations/:id"
          element={
            <Page>
              <PermissionRoute
                permission={PERMISSIONS.ALTERATION_VIEW}
                element={<AlterationDetailPage />}
              />
            </Page>
          }
        />

        {/* Phase 11 — Reports & Analytics */}
        <Route
          path="reports"
          element={
            <Page>
              <PermissionRoute permission={PERMISSIONS.REPORT_VIEW} element={<ReportsPage />} />
            </Page>
          }
        />
        <Route
          path="reports/schedules"
          element={
            <Page>
              <PermissionRoute
                permission={PERMISSIONS.REPORT_SCHEDULE}
                element={<SchedulesPage />}
              />
            </Page>
          }
        />
        <Route
          path="reports/ar-aging"
          element={
            <Page>
              <PermissionRoute permission={PERMISSIONS.REPORT_VIEW} element={<ArAgingPage />} />
            </Page>
          }
        />
        <Route
          path="reports/ap-aging"
          element={
            <Page>
              <PermissionRoute permission={PERMISSIONS.REPORT_VIEW} element={<ApAgingPage />} />
            </Page>
          }
        />
        {/* ES-17 — Analytics dashboards */}
        <Route
          path="reports/sales-analytics"
          element={
            <Page>
              <PermissionRoute
                permission={PERMISSIONS.REPORT_VIEW}
                element={<SalesAnalyticsPage />}
              />
            </Page>
          }
        />
        <Route
          path="reports/inventory-analytics"
          element={
            <Page>
              <PermissionRoute
                permission={PERMISSIONS.REPORT_VIEW}
                element={<InventoryAnalyticsPage />}
              />
            </Page>
          }
        />
        <Route
          path="reports/hr-analytics"
          element={
            <Page>
              <PermissionRoute permission={PERMISSIONS.REPORT_VIEW} element={<HRAnalyticsPage />} />
            </Page>
          }
        />
        <Route
          path="reports/:slug"
          element={
            <Page>
              <PermissionRoute
                permission={PERMISSIONS.REPORT_VIEW}
                element={<ReportViewerPage />}
              />
            </Page>
          }
        />

        {/* ES-19 — Enterprise Security */}
        <Route
          path="admin/security-audit-log"
          element={
            <Page>
              <PermissionRoute
                permission={PERMISSIONS.VIEW_AUDIT_LOG}
                element={<SecurityAuditLogPage />}
              />
            </Page>
          }
        />

        {/* ES-20 — Audit Trail & Feature Flags */}
        <Route
          path="admin/audit-logs"
          element={
            <Page>
              <PermissionRoute
                permission={[PERMISSIONS.VIEW_AUDIT_LOG, PERMISSIONS.AUDIT_LOG_VIEW]}
                element={<AuditLogPage />}
              />
            </Page>
          }
        />
        <Route
          path="admin/feature-flags"
          element={
            <Page>
              <PermissionRoute
                permission={PERMISSIONS.FEATURE_FLAG_VIEW}
                element={<FeatureFlagsPage />}
              />
            </Page>
          }
        />

        {/* Platform Admin — cross-tenant tenant management */}
        <Route
          path="admin/tenants"
          element={
            <Page>
              <PermissionRoute
                permission={PERMISSIONS.PLATFORM_TENANT_MANAGE}
                element={<TenantsPage />}
              />
            </Page>
          }
        />
        <Route
          path="admin/tenants/new"
          element={
            <Page>
              <PermissionRoute
                permission={PERMISSIONS.PLATFORM_TENANT_MANAGE}
                element={<TenantFormPage />}
              />
            </Page>
          }
        />
        <Route
          path="admin/tenants/:tenantId/users"
          element={
            <Page>
              <PermissionRoute
                permission={PERMISSIONS.PLATFORM_TENANT_MANAGE}
                element={<AdminTenantUsersPage />}
              />
            </Page>
          }
        />

        {/* Phase 12 — Distributed Systems Admin */}
        <Route
          path="admin/distributed/events"
          element={
            <Page>
              <PermissionRoute
                permission={PERMISSIONS.EVENT_STORE_VIEW}
                element={<EventStorePage />}
              />
            </Page>
          }
        />
        <Route
          path="admin/distributed/dlq"
          element={
            <Page>
              <PermissionRoute permission={PERMISSIONS.DLQ_VIEW} element={<DLQPage />} />
            </Page>
          }
        />
        <Route
          path="admin/distributed/sagas"
          element={
            <Page>
              <PermissionRoute permission={PERMISSIONS.SAGA_VIEW} element={<SagaMonitorPage />} />
            </Page>
          }
        />
        <Route
          path="admin/distributed/schemas"
          element={
            <Page>
              <PermissionRoute
                permission={PERMISSIONS.SCHEMA_REGISTRY_VIEW}
                element={<SchemaRegistryPage />}
              />
            </Page>
          }
        />
        <Route
          path="admin/distributed/projections"
          element={
            <Page>
              <PermissionRoute
                permission={PERMISSIONS.PROJECTION_VIEW}
                element={<ProjectionsPage />}
              />
            </Page>
          }
        />
        <Route
          path="admin/distributed/performance"
          element={
            <Page>
              <PermissionRoute
                permission={PERMISSIONS.PERFORMANCE_VIEW}
                element={<PerformancePage />}
              />
            </Page>
          }
        />

        {/* Global Search — analytics + index sync health */}
        <Route
          path="admin/search-analytics"
          element={
            <Page>
              <PermissionRoute
                permission={PERMISSIONS.SEARCH_REINDEX}
                element={<SearchAnalyticsPage />}
              />
            </Page>
          }
        />

        {/* 404 */}
        <Route
          path="*"
          element={
            <Page>
              <NotFoundPage />
            </Page>
          }
        />
      </Route>
    </Routes>
  );
}
