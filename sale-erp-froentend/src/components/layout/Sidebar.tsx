import React, { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import {
  X,
  LayoutDashboard,
  Users,
  ShoppingCart,
  ShoppingBag,
  Package,
  Warehouse,
  Building2,
  DollarSign,
  CircleMinus,
  Wrench,
  MessageSquare,
  Mail,
  BarChart3,
  ChevronDown,
  CalendarCheck,
  ClipboardList,
  Settings,
  UserCog,
  WalletCards,
  ChevronLeft,
  ChevronRight,
  LogOut,
  Lock,
  User,
  ShieldCheck,
} from 'lucide-react';
import { useAuth } from '../../hooks/useAuth';
import {
  ANY_REPORT_RULE,
  CONTACT_IMPORT_RULE,
  FEATURE_PERMISSIONS,
  ITEM_IMPORT_RULE,
  type AccessRule,
  canAccessRule,
  getDefaultAuthorizedPath,
  rule,
} from '../../auth/featurePermissions';
import { PERMISSIONS } from '../../auth/permissions';

interface MenuItem {
  label: string;
  icon: React.ReactNode;
  href?: string;
  submenu?: MenuItem[];
  access?: AccessRule;
}

const menuItems: MenuItem[] = [
  {
    label: 'Dashboard',
    icon: <LayoutDashboard size={20} />,
    href: '/dashboard',
    access: rule(FEATURE_PERMISSIONS.dashboard.view),
  },
  {
    label: 'Organization',
    icon: <Building2 size={20} />,
    href: '/organizations',
    access: rule(FEATURE_PERMISSIONS.organization.view),
  },
  {
    label: 'Contacts',
    icon: <Users size={20} />,
    submenu: [
      { label: 'Customers', href: '/contacts/customers', icon: <Users size={18} />, access: rule(FEATURE_PERMISSIONS.customer.view) },
      { label: 'Suppliers', href: '/contacts/suppliers', icon: <Users size={18} />, access: rule(FEATURE_PERMISSIONS.supplier.view) },
      { label: 'Carriers', href: '/contacts/carriers', icon: <Users size={18} />, access: rule(FEATURE_PERMISSIONS.carrier.view) },
    ],
  },
  {
    label: 'Sales',
    icon: <ShoppingCart size={20} />,
    submenu: [
      { label: 'POS', href: '/sales/pos', icon: <ShoppingCart size={18} />, access: rule(FEATURE_PERMISSIONS.pos.create) },
      { label: 'Invoices', href: '/sales/invoices', icon: <ShoppingCart size={18} />, access: rule(FEATURE_PERMISSIONS.sales.view) },
      { label: 'Quotations', href: '/sales/quotations', icon: <ShoppingCart size={18} />, access: rule(FEATURE_PERMISSIONS.sales.view) },
      { label: 'Payment In', href: '/sales/payment-in', icon: <ShoppingCart size={18} />, access: rule(FEATURE_PERMISSIONS.paymentIn.view) },
      { label: 'Sale Orders', href: '/sales/orders', icon: <ShoppingCart size={18} />, access: rule(FEATURE_PERMISSIONS.sales.view) },
    ],
  },
  {
    label: 'Purchase',
    icon: <ShoppingBag size={20} />,
    submenu: [
      { label: 'Bills', href: '/purchase/bills', icon: <ShoppingBag size={18} />, access: rule(FEATURE_PERMISSIONS.purchase.view) },
      { label: 'Orders', href: '/purchase/orders', icon: <ShoppingBag size={18} />, access: rule(FEATURE_PERMISSIONS.purchase.view) },
      { label: 'Payment Out', href: '/purchase/payment-out', icon: <ShoppingBag size={18} />, access: rule(FEATURE_PERMISSIONS.paymentOut.view) },
    ],
  },
  {
    label: 'Items',
    icon: <Package size={20} />,
    submenu: [
      { label: 'Item List', href: '/items', icon: <Package size={18} />, access: rule(FEATURE_PERMISSIONS.item.view) },
      { label: 'Category List', href: '/items/categories', icon: <Package size={18} />, access: rule(FEATURE_PERMISSIONS.category.view) },
      { label: 'Brand List', href: '/items/brands', icon: <Package size={18} />, access: rule(FEATURE_PERMISSIONS.brand.view) },
      { label: 'Unit List', href: '/items/units', icon: <Package size={18} />, access: rule(FEATURE_PERMISSIONS.unit.view) },
    ],
  },
  {
    label: 'Stock',
    icon: <Warehouse size={20} />,
    submenu: [
      { label: 'Transfer', href: '/stock/transfers', icon: <Warehouse size={18} />, access: rule(FEATURE_PERMISSIONS.stockTransfer.view) },
      { label: 'Adjustment', href: '/stock/adjustments', icon: <Warehouse size={18} />, access: rule(FEATURE_PERMISSIONS.stockAdjustment.view) },
    ],
  },
  {
    label: 'Expense',
    icon: <CircleMinus size={20} />,
    submenu: [
      { label: 'Expense List', href: '/expenses', icon: <CircleMinus size={18} />, access: rule(FEATURE_PERMISSIONS.expense.view) },
      { label: 'Category List', href: '/expenses/categories', icon: <CircleMinus size={18} />, access: rule(FEATURE_PERMISSIONS.expense.view) },
      { label: 'Subcategory List', href: '/expenses/subcategories', icon: <CircleMinus size={18} />, access: rule(FEATURE_PERMISSIONS.expense.view) },
      { label: 'Payment Type', href: '/expenses/payment-types', icon: <WalletCards size={18} />, access: rule(FEATURE_PERMISSIONS.expense.view) },
    ],
  },
  {
    label: 'Warehouses',
    icon: <Building2 size={20} />,
    href: '/warehouses',
    access: rule(FEATURE_PERMISSIONS.warehouse.view),
  },
  {
    label: 'Cash & Bank',
    icon: <DollarSign size={20} />,
    submenu: [
      { label: 'Cash In Hand', href: '/cash-bank/cash-in-hand', icon: <DollarSign size={18} />, access: rule(FEATURE_PERMISSIONS.cash.view) },
      { label: 'Cheques', href: '/cash-bank/cheques', icon: <DollarSign size={18} />, access: rule(FEATURE_PERMISSIONS.cash.view) },
      { label: 'Bank', href: '/cash-bank/bank', icon: <DollarSign size={18} />, access: rule(FEATURE_PERMISSIONS.bankAccount.view) },
      { label: 'Bank Accounts', href: '/cash-bank/bank-accounts', icon: <DollarSign size={18} />, access: rule(FEATURE_PERMISSIONS.bankAccount.view) },
    ],
  },
  {
    label: 'Utilities',
    icon: <Wrench size={20} />,
    submenu: [
      { label: 'Import Items', href: '/utilities/import-items', icon: <Wrench size={18} />, access: ITEM_IMPORT_RULE },
      { label: 'Import Contacts', href: '/utilities/import-contacts', icon: <Wrench size={18} />, access: CONTACT_IMPORT_RULE },
      { label: 'Generate Barcode', href: '/utilities/generate-barcode', icon: <Wrench size={18} />, access: rule(FEATURE_PERMISSIONS.item.view) },
    ],
  },
  {
    label: 'Users',
    icon: <Users size={20} />,
    submenu: [
      { label: 'Users', href: '/users', icon: <Users size={18} />, access: rule(FEATURE_PERMISSIONS.user.view) },
      { label: 'Roles', href: '/users/roles', icon: <Users size={18} />, access: rule(FEATURE_PERMISSIONS.role.view) },
      { label: 'Permissions', href: '/users/permissions', icon: <ShieldCheck size={18} />, access: rule([FEATURE_PERMISSIONS.user.view, FEATURE_PERMISSIONS.user.update], 'all') },
    ],
  },
  {
    label: 'Staff Management',
    icon: <UserCog size={20} />,
    submenu: [
      { label: 'Employees', href: '/staff/employees', icon: <UserCog size={18} />, access: rule(FEATURE_PERMISSIONS.staffEmployee.view) },
      { label: 'Attendance', href: '/staff/attendance', icon: <CalendarCheck size={18} />, access: rule(FEATURE_PERMISSIONS.staffAttendance.view) },
      { label: 'Leaves', href: '/staff/leaves', icon: <ClipboardList size={18} />, access: rule(FEATURE_PERMISSIONS.staffLeave.view) },
      { label: 'Payroll', href: '/staff/payroll', icon: <WalletCards size={18} />, access: rule(FEATURE_PERMISSIONS.staffPayroll.view) },
      { label: 'Settings', href: '/staff/settings', icon: <Settings size={18} />, access: rule(FEATURE_PERMISSIONS.staffSetting.view) },
    ],
  },
  {
    label: 'SMS',
    icon: <MessageSquare size={20} />,
    submenu: [
      { label: 'Create SMS', href: '/sms/create', icon: <MessageSquare size={18} />, access: rule(FEATURE_PERMISSIONS.sms.send) },
      { label: 'Templates', href: '/sms/templates', icon: <MessageSquare size={18} />, access: rule(FEATURE_PERMISSIONS.sms.templateView) },
    ],
  },
  {
    label: 'Email',
    icon: <Mail size={20} />,
    submenu: [
      { label: 'Create Email', href: '/email/create', icon: <Mail size={18} />, access: rule(FEATURE_PERMISSIONS.email.send) },
      { label: 'Templates', href: '/email/templates', icon: <Mail size={18} />, access: rule(FEATURE_PERMISSIONS.email.templateView) },
    ],
  },
  {
    label: 'Reports',
    icon: <BarChart3 size={20} />,
    access: ANY_REPORT_RULE,
    submenu: [
      { label: 'Profit and Loss', href: '/reports/profit-and-loss', icon: <BarChart3 size={18} />, access: rule(FEATURE_PERMISSIONS.report.profitLoss) },
      { label: 'Batch Wise', href: '/reports/item-transaction/batch', icon: <BarChart3 size={18} />, access: rule(FEATURE_PERMISSIONS.report.stock) },
      { label: 'Serial/IMEI', href: '/reports/item-transaction/serial', icon: <BarChart3 size={18} />, access: rule(FEATURE_PERMISSIONS.report.stock) },
      { label: 'General', href: '/reports/item-transaction/general', icon: <BarChart3 size={18} />, access: rule(FEATURE_PERMISSIONS.report.stock) },
      { label: 'Purchase', href: '/reports/purchase', icon: <BarChart3 size={18} />, access: rule(FEATURE_PERMISSIONS.report.purchase) },
      { label: 'Item Purchase', href: '/reports/purchase/item', icon: <BarChart3 size={18} />, access: rule(FEATURE_PERMISSIONS.report.purchase) },
      { label: 'Purchase Payment', href: '/reports/purchase/payment', icon: <BarChart3 size={18} />, access: rule(FEATURE_PERMISSIONS.report.purchase) },
      { label: 'Sale', href: '/reports/sale', icon: <BarChart3 size={18} />, access: rule(FEATURE_PERMISSIONS.report.sales) },
      { label: 'Item Sale', href: '/reports/sale/item', icon: <BarChart3 size={18} />, access: rule(FEATURE_PERMISSIONS.report.sales) },
      { label: 'Sale Payment', href: '/reports/sale/payment', icon: <BarChart3 size={18} />, access: rule(FEATURE_PERMISSIONS.report.sales) },
      { label: 'Customer Due', href: '/reports/due/customer', icon: <BarChart3 size={18} />, access: rule(FEATURE_PERMISSIONS.report.customerLedger) },
      { label: 'Supplier Due', href: '/reports/due/supplier', icon: <BarChart3 size={18} />, access: rule(FEATURE_PERMISSIONS.report.supplierLedger) },
      { label: 'Expense', href: '/reports/expense', icon: <BarChart3 size={18} />, access: rule(FEATURE_PERMISSIONS.expense.view) },
      { label: 'Expense Item', href: '/reports/expense/item', icon: <BarChart3 size={18} />, access: rule(FEATURE_PERMISSIONS.expense.view) },
      { label: 'Expense Payment', href: '/reports/expense/payment', icon: <BarChart3 size={18} />, access: rule(FEATURE_PERMISSIONS.expense.view) },
      { label: 'Cash flow', href: '/reports/transactions/cash-flow', icon: <BarChart3 size={18} />, access: rule(FEATURE_PERMISSIONS.cash.view) },
      { label: 'Bank Statement', href: '/reports/transactions/bank-statement', icon: <BarChart3 size={18} />, access: rule(FEATURE_PERMISSIONS.bankAccount.view) },
      { label: 'Supplier Ledger', href: '/reports/ledger/supplier', icon: <BarChart3 size={18} />, access: rule(FEATURE_PERMISSIONS.report.supplierLedger) },
      { label: 'Customer Ledger', href: '/reports/ledger/customer', icon: <BarChart3 size={18} />, access: rule(FEATURE_PERMISSIONS.report.customerLedger) },
      { label: 'GST', href: '/reports/gst', icon: <BarChart3 size={18} />, access: rule(FEATURE_PERMISSIONS.report.gst) },
      { label: 'GSTR-1', href: '/reports/gst/gstr-1', icon: <BarChart3 size={18} />, access: rule(FEATURE_PERMISSIONS.report.gst) },
      { label: 'GSTR-2', href: '/reports/gst/gstr-2', icon: <BarChart3 size={18} />, access: rule(FEATURE_PERMISSIONS.report.gst) },
      { label: 'Stock Transfer', href: '/reports/stock-transfer', icon: <BarChart3 size={18} />, access: rule(FEATURE_PERMISSIONS.stockTransfer.view) },
      { label: 'Item Stock Transfer', href: '/reports/stock-transfer/item', icon: <BarChart3 size={18} />, access: rule(FEATURE_PERMISSIONS.stockTransfer.view) },
      { label: 'Stock Adjustment', href: '/reports/stock-adjustment', icon: <BarChart3 size={18} />, access: rule(FEATURE_PERMISSIONS.stockAdjustment.view) },
      { label: 'Item Stock Adjustment', href: '/reports/stock-adjustment/item', icon: <BarChart3 size={18} />, access: rule(FEATURE_PERMISSIONS.stockAdjustment.view) },
      { label: 'Stock Report', href: '/reports/stock', icon: <BarChart3 size={18} />, access: rule(FEATURE_PERMISSIONS.report.stock) },
      { label: 'Stock Batch Wise', href: '/reports/stock-report/batch', icon: <BarChart3 size={18} />, access: rule(FEATURE_PERMISSIONS.report.stock) },
      { label: 'Stock Serial/IMEI', href: '/reports/stock-report/serial', icon: <BarChart3 size={18} />, access: rule(FEATURE_PERMISSIONS.report.stock) },
      { label: 'Stock General', href: '/reports/stock-report/general', icon: <BarChart3 size={18} />, access: rule(FEATURE_PERMISSIONS.report.stock) },
      { label: 'Low Stock', href: '/reports/low-stock', icon: <BarChart3 size={18} />, access: rule(FEATURE_PERMISSIONS.report.lowStock) },
      { label: 'Inventory Valuation', href: '/reports/inventory-valuation', icon: <BarChart3 size={18} />, access: rule(FEATURE_PERMISSIONS.report.inventoryValuation) },
      { label: 'Top Selling Items', href: '/reports/top-selling-items', icon: <BarChart3 size={18} />, access: rule(FEATURE_PERMISSIONS.report.topSellingItems) },
      { label: 'Day Book', href: '/reports/day-book', icon: <BarChart3 size={18} />, access: rule(FEATURE_PERMISSIONS.report.dayBook) },
      { label: 'Expired Item Report', href: '/reports/expired-items', icon: <BarChart3 size={18} />, access: rule(FEATURE_PERMISSIONS.report.stock) },
      { label: 'Reorder Item Report', href: '/reports/reorder-items', icon: <BarChart3 size={18} />, access: rule(FEATURE_PERMISSIONS.report.lowStock) },
    ],
  },
];

const sectionLabels: Partial<Record<MenuItem['label'], string>> = {
  'Cash & Bank': 'CORE',
  Users: 'MANAGEMENT',
  SMS: 'COMMUNICATION',
  Reports: 'ANALYTICS',
};

export const Sidebar: React.FC<{ isOpen: boolean; onClose: () => void }> = ({
  isOpen,
  onClose,
}) => {
  const [expandedMenu, setExpandedMenu] = useState<string | null>(null);
  const [showProfileMenu, setShowProfileMenu] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  const { user, logout, hasPermission, hasAnyPermission, hasAllPermissions } = useAuth();
  const defaultPath = getDefaultAuthorizedPath(user?.permissions, user?.role);
  const visibleMenuItems = useMemo(() => menuItems
    .map((item) => {
      const submenu = item.submenu?.filter((subitem) =>
        canAccessRule(subitem.access, hasAnyPermission, hasAllPermissions)
      );
      return item.submenu ? { ...item, submenu } : item;
    })
    .filter((item) => {
      if (!canAccessRule(item.access, hasAnyPermission, hasAllPermissions)) return false;
      return !item.submenu || item.submenu.length > 0;
    }), [hasAllPermissions, hasAnyPermission, user?.permissions]);

  useEffect(() => {
    const activeParent = visibleMenuItems.find((item) =>
      item.submenu?.some((subitem) => location.pathname.startsWith(subitem.href || ''))
    );
    if (activeParent) {
      setExpandedMenu(activeParent.label);
    }
    setShowProfileMenu(false);
  }, [location.pathname, visibleMenuItems]);

  const toggleMenu = (label: string) => {
    setExpandedMenu(expandedMenu === label ? null : label);
  };

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const openProfilePanel = (panel: 'profile' | 'password') => {
    setShowProfileMenu(false);
    onClose();
    navigate('/profile', { state: { panel } });
  };

  const isMenuActive = (href?: string, submenu?: MenuItem[]): boolean => {
    if (href) {
      return location.pathname.startsWith(href);
    }
    if (submenu) {
      return submenu.some((item) =>
        location.pathname.startsWith(item.href || '')
      );
    }
    return false;
  };

  return (
    <>
      {/* Overlay */}
      {isOpen && (
        <div
          className="fixed inset-0 bg-black/50 md:hidden"
          onClick={onClose}
          style={{ zIndex: 30 }}
        />
      )}

      {/* Sidebar */}
      <div
        className={`fixed left-0 top-0 flex h-screen w-64 transform flex-col overflow-hidden border-r border-[#e6edf5] bg-white text-slate-700 shadow-[4px_0_18px_rgba(30,64,175,0.06)] transition-transform md:static md:inset-auto md:translate-x-0 ${
          isOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
        style={{ zIndex: 40 }}
      >
        <div className="flex h-20 shrink-0 items-center justify-between gap-2 border-b border-[#edf2f7] px-4">
          <Link to={defaultPath} onClick={onClose} className="flex min-w-0 flex-1 items-center">
            <img src="/texmintra-logo.svg" alt="Texmintra" className="w-44 max-w-full object-contain" />
          </Link>
          <button onClick={onClose} className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 md:hidden" aria-label="Close menu">
            <X size={20} />
          </button>
          <ChevronLeft className="hidden text-[#1684ed] md:block" size={20} />
        </div>

        <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-4">
          {visibleMenuItems.map((item) => (
            <React.Fragment key={item.label}>
              {sectionLabels[item.label] && (
                <p className="mb-2 mt-5 px-3 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400 first:mt-0">
                  {sectionLabels[item.label]}
                </p>
              )}
              <div>
                {item.href && !item.submenu ? (
                  <Link
                    to={item.href}
                    onClick={onClose}
                    title={item.label}
                    className={`flex min-h-10 items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors ${
                      isMenuActive(item.href, item.submenu)
                        ? 'bg-[#eef7ff] font-semibold text-[#1684ed]'
                        : 'font-medium text-slate-500 hover:bg-slate-50 hover:text-slate-800'
                    }`}
                  >
                    <span className="shrink-0 [&_svg]:h-[18px] [&_svg]:w-[18px]">{item.icon}</span>
                    <span className="leading-snug">{item.label}</span>
                  </Link>
                ) : (
                  <button
                    onClick={() => toggleMenu(item.label)}
                    title={item.label}
                    className={`flex min-h-10 w-full items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors ${
                      isMenuActive(item.href, item.submenu)
                        ? 'bg-[#eef7ff] font-semibold text-[#1684ed]'
                        : 'font-medium text-slate-500 hover:bg-slate-50 hover:text-slate-800'
                    }`}
                  >
                    <span className="shrink-0 [&_svg]:h-[18px] [&_svg]:w-[18px]">{item.icon}</span>
                    <span className="flex-1 text-left leading-snug">
                      {item.label}
                    </span>
                    <ChevronDown
                      size={14}
                      className={`transform transition-transform ${
                        expandedMenu === item.label ? 'rotate-180' : ''
                      }`}
                    />
                  </button>
                )}

                {/* Submenu */}
                {item.submenu && expandedMenu === item.label && (
                  <div className="mt-1 space-y-1 pl-8">
                    {item.submenu.map((subitem) => (
                      <Link
                        key={subitem.label}
                        to={subitem.href || '#'}
                        onClick={onClose}
                        title={subitem.label}
                        className={`flex items-center gap-2.5 rounded-md px-3 py-2 text-[13px] transition-colors ${
                          location.pathname === subitem.href ||
                          (!['/items', '/users', '/reports/purchase', '/reports/sale', '/reports/gst', '/reports/stock', '/reports/stock-transfer', '/reports/stock-adjustment', '/reports/expense'].includes(subitem.href || '') && location.pathname.startsWith(subitem.href || ''))
                            ? 'bg-[#eef7ff] font-semibold text-[#1684ed]'
                            : 'font-medium text-slate-500 hover:bg-slate-50 hover:text-slate-800'
                        }`}
                      >
                        <span className="shrink-0 [&_svg]:h-4 [&_svg]:w-4">{subitem.icon}</span>
                        <span>{subitem.label}</span>
                      </Link>
                    ))}
                  </div>
                )}
              </div>
            </React.Fragment>
          ))}
        </nav>

        <div className="relative border-t border-[#edf2f7] p-3">
          {showProfileMenu && (
            <div className="absolute bottom-[76px] left-3 right-3 overflow-hidden rounded-xl border border-slate-200 bg-white py-1.5 shadow-xl">
              {hasPermission(PERMISSIONS.USER_PROFILE_VIEW) && (
                <button
                  type="button"
                  onClick={() => openProfilePanel('profile')}
                  className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm font-medium text-slate-600 hover:bg-slate-50 hover:text-slate-900"
                >
                  <User size={16} />
                  Profile
                </button>
              )}
              {hasPermission(PERMISSIONS.USER_CHANGE_PASSWORD) && (
                <button
                  type="button"
                  onClick={() => openProfilePanel('password')}
                  className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm font-medium text-slate-600 hover:bg-slate-50 hover:text-slate-900"
                >
                  <Lock size={16} />
                  Change Password
                </button>
              )}
              <button
                type="button"
                onClick={handleLogout}
                className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm font-medium text-red-600 hover:bg-red-50"
              >
                <LogOut size={16} />
                Logout
              </button>
            </div>
          )}
          <button
            type="button"
            onClick={() => setShowProfileMenu((current) => !current)}
            className="flex w-full items-center gap-3 rounded-lg border border-slate-200 bg-white px-3 py-2 text-left text-slate-700 hover:bg-slate-50"
          >
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#1684ed] text-sm font-bold text-white">
              {user?.userName?.charAt(0).toUpperCase() || 'U'}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-slate-800">{user?.userName || 'User'}</p>
              <p className="truncate text-xs text-slate-500">{user?.role || user?.organizationName || 'Texmintra'}</p>
            </div>
            <ChevronRight size={16} className={`text-slate-400 transition-transform ${showProfileMenu ? '-rotate-90' : ''}`} />
          </button>
        </div>
      </div>
    </>
  );
};
