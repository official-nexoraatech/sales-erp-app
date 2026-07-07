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
  isSuperAdminRole,
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
  superAdminOnly?: boolean;
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
    superAdminOnly: true,
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

const sectionLabels: Partial<Record<string, string>> = {
  'Cash & Bank': 'CORE',
  Users: 'MANAGEMENT',
  SMS: 'COMMUNICATION',
  Reports: 'ANALYTICS',
};

/* ── Shared class strings ── */
const NAV_ITEM_BASE =
  'flex min-h-[38px] items-center gap-3 rounded-md text-sm transition-colors duration-150 select-none';

const NAV_INACTIVE =
  'font-medium text-slate-500 hover:bg-slate-100 hover:text-slate-900 ' +
  'dark:text-slate-400 dark:hover:bg-slate-700/60 dark:hover:text-slate-100';

const NAV_ACTIVE =
  'bg-blue-50 font-semibold text-blue-700 ' +
  'dark:bg-blue-900/30 dark:text-blue-400';

/* Sub-nav (submenu links) */
const SUBNAV_INACTIVE =
  'font-medium text-slate-500 hover:bg-slate-100 hover:text-slate-900 ' +
  'dark:text-slate-400 dark:hover:bg-slate-700/60 dark:hover:text-slate-100';

const SUBNAV_ACTIVE =
  'bg-blue-50 font-semibold text-blue-700 ' +
  'dark:bg-blue-900/30 dark:text-blue-400';

/* Subpath exclusions for exact-match routes */
const EXACT_PATHS = new Set([
  '/items', '/users', '/reports/purchase', '/reports/sale',
  '/reports/gst', '/reports/stock', '/reports/stock-transfer',
  '/reports/stock-adjustment', '/reports/expense',
]);

interface SidebarProps {
  isOpen: boolean;
  onClose: () => void;
  collapsed: boolean;
  onToggleCollapsed: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  isOpen,
  onClose,
  collapsed,
  onToggleCollapsed,
}) => {
  const [expandedMenu, setExpandedMenu] = useState<string | null>(null);
  const [showProfileMenu, setShowProfileMenu] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  const { user, logout, hasPermission, hasAnyPermission, hasAllPermissions } = useAuth();
  const defaultPath = getDefaultAuthorizedPath(user?.permissions, user?.role);
  const isSuperAdmin = isSuperAdminRole(user?.role);
  const organizationLogoUrl = user?.organizationLogoUrl?.trim();
  const organizationLogoAlt = user?.organizationName ? `${user.organizationName} logo` : 'Organization logo';

  const visibleMenuItems = useMemo(() =>
    menuItems
      .map((item) => {
        const submenu = item.submenu?.filter((sub) =>
          canAccessRule(sub.access, hasAnyPermission, hasAllPermissions)
        );
        return item.submenu ? { ...item, submenu } : item;
      })
      .filter((item) => {
        if (item.superAdminOnly && !isSuperAdmin) return false;
        if (!canAccessRule(item.access, hasAnyPermission, hasAllPermissions)) return false;
        return !item.submenu || item.submenu.length > 0;
      }),
    [hasAllPermissions, hasAnyPermission, isSuperAdmin, user?.permissions],
  );

  useEffect(() => {
    const activeParent = visibleMenuItems.find((item) =>
      item.submenu?.some((sub) => location.pathname.startsWith(sub.href || ''))
    );
    if (activeParent) setExpandedMenu(activeParent.label);
    setShowProfileMenu(false);
  }, [location.pathname, visibleMenuItems]);

  const toggleMenu = (label: string) => {
    if (collapsed) {
      onToggleCollapsed();
      setExpandedMenu(label);
      return;
    }
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
    if (href) return location.pathname.startsWith(href);
    if (submenu) return submenu.some((item) => location.pathname.startsWith(item.href || ''));
    return false;
  };

  const isSubActive = (href?: string) => {
    if (!href) return false;
    if (EXACT_PATHS.has(href)) return location.pathname === href;
    return location.pathname === href || location.pathname.startsWith(href + '/');
  };

  return (
    <>
      {/* Mobile overlay */}
      {isOpen && (
        <div
          className="fixed inset-0 bg-black/50 dark:bg-black/70 md:hidden"
          onClick={onClose}
          style={{ zIndex: 30 }}
          aria-hidden="true"
        />
      )}

      {/* Sidebar panel */}
      <aside
        className={[
          'fixed left-0 top-0 flex h-screen flex-col overflow-hidden',
          'border-r border-slate-200 bg-white text-slate-700',
          'shadow-[4px_0_18px_rgba(30,64,175,0.05)] transition-all duration-300',
          'dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300',
          'dark:shadow-[4px_0_18px_rgba(0,0,0,0.4)]',
          collapsed ? 'md:w-16' : 'md:w-64',
          isOpen ? 'w-64 translate-x-0' : 'w-64 -translate-x-full',
          'md:static md:inset-auto md:translate-x-0',
        ].join(' ')}
        style={{ zIndex: 40 }}
        aria-label="Main navigation"
      >
        {/* Sidebar header */}
        <div className="flex h-16 shrink-0 items-center justify-between gap-2 border-b border-slate-200 px-3 dark:border-slate-700">
          {!collapsed && (
            <Link to={defaultPath} onClick={onClose} className="flex h-11 min-w-0 flex-1 items-center overflow-hidden">
              {organizationLogoUrl ? (
                <img
                  src={organizationLogoUrl}
                  alt={organizationLogoAlt}
                  className="h-full max-w-full w-auto object-contain object-left dark:brightness-110"
                />
              ) : (
                <span className="truncate text-sm font-semibold text-slate-800 dark:text-slate-100">
                  {user?.organizationName || 'Organization'}
                </span>
              )}
            </Link>
          )}
          {/* Mobile close */}
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:text-slate-500 dark:hover:bg-slate-700 dark:hover:text-slate-300 md:hidden"
            aria-label="Close menu"
          >
            <X size={18} />
          </button>
          {/* Desktop collapse toggle */}
          <button
            onClick={onToggleCollapsed}
            className={[
              'hidden md:flex items-center justify-center rounded-lg p-1.5',
              'text-blue-600 hover:bg-blue-50 dark:text-blue-400 dark:hover:bg-slate-700',
              'transition-colors',
              collapsed ? 'mx-auto' : '',
            ].join(' ')}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            title={collapsed ? 'Expand' : 'Collapse'}
          >
            {collapsed ? <ChevronRight size={18} /> : <ChevronLeft size={18} />}
          </button>
        </div>

        {/* Navigation */}
        <nav className={`flex-1 overflow-y-auto py-3 ${collapsed ? 'px-1.5' : 'px-2.5'}`}>
          {visibleMenuItems.map((item) => (
            <React.Fragment key={item.label}>
              {/* Section label */}
              {!collapsed && sectionLabels[item.label] && (
                <p className="mb-1.5 mt-4 px-2.5 text-[10px] font-bold uppercase tracking-widest text-slate-400 dark:text-slate-600 first:mt-0">
                  {sectionLabels[item.label]}
                </p>
              )}

              <div className={collapsed ? 'relative group/nav' : ''}>
                {/* Leaf link */}
                {item.href && !item.submenu ? (
                  <Link
                    to={item.href}
                    onClick={onClose}
                    title={item.label}
                    className={[
                      NAV_ITEM_BASE,
                      collapsed ? 'justify-center px-2 py-2' : 'px-2.5 py-2',
                      isMenuActive(item.href) ? NAV_ACTIVE : NAV_INACTIVE,
                    ].join(' ')}
                  >
                    <span className="shrink-0 [&_svg]:h-[18px] [&_svg]:w-[18px]">{item.icon}</span>
                    {!collapsed && <span className="leading-snug">{item.label}</span>}
                  </Link>
                ) : (
                  /* Group button */
                  <button
                    onClick={() => toggleMenu(item.label)}
                    title={item.label}
                    className={[
                      NAV_ITEM_BASE,
                      'w-full',
                      collapsed ? 'justify-center px-2 py-2' : 'px-2.5 py-2',
                      isMenuActive(item.href, item.submenu) ? NAV_ACTIVE : NAV_INACTIVE,
                    ].join(' ')}
                  >
                    <span className="shrink-0 [&_svg]:h-[18px] [&_svg]:w-[18px]">{item.icon}</span>
                    {!collapsed && (
                      <>
                        <span className="flex-1 text-left leading-snug">{item.label}</span>
                        <ChevronDown
                          size={13}
                          className={`shrink-0 transition-transform duration-200 ${
                            expandedMenu === item.label ? 'rotate-180' : ''
                          }`}
                        />
                      </>
                    )}
                  </button>
                )}

                {/* Collapsed tooltip */}
                {collapsed && (
                  <div
                    className="pointer-events-none absolute left-full top-1/2 z-50 ml-2.5 -translate-y-1/2 whitespace-nowrap rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-medium text-white opacity-0 shadow-xl transition-opacity group-hover/nav:opacity-100 dark:bg-slate-700"
                    role="tooltip"
                  >
                    {item.label}
                    {item.submenu && (
                      <div className="mt-1.5 space-y-0.5 border-t border-white/20 pt-1.5">
                        {item.submenu.map((sub) => (
                          <div key={sub.label} className="text-[11px] text-slate-300">{sub.label}</div>
                        ))}
                      </div>
                    )}
                    <span className="absolute right-full top-1/2 -translate-y-1/2 border-4 border-transparent border-r-slate-900 dark:border-r-slate-700" />
                  </div>
                )}

                {/* Submenu (expanded) */}
                {!collapsed && item.submenu && expandedMenu === item.label && (
                  <div className="mt-0.5 space-y-0.5 pl-7 pb-1">
                    {item.submenu.map((sub) => (
                      <Link
                        key={sub.label}
                        to={sub.href || '#'}
                        onClick={onClose}
                        title={sub.label}
                        className={[
                          'flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-[13px] transition-colors duration-150',
                          isSubActive(sub.href) ? SUBNAV_ACTIVE : SUBNAV_INACTIVE,
                        ].join(' ')}
                      >
                        <span className="shrink-0 [&_svg]:h-3.5 [&_svg]:w-3.5">{sub.icon}</span>
                        <span>{sub.label}</span>
                      </Link>
                    ))}
                  </div>
                )}
              </div>
            </React.Fragment>
          ))}
        </nav>

        {/* Profile section */}
        <div className="relative border-t border-slate-200 p-2.5 dark:border-slate-700">
          {/* Profile flyout menu */}
          {showProfileMenu && !collapsed && (
            <div className="absolute bottom-[76px] left-2.5 right-2.5 overflow-hidden rounded-xl border border-slate-200 bg-white py-1.5 shadow-xl dark:border-slate-700 dark:bg-slate-800">
              {hasPermission(PERMISSIONS.USER_PROFILE_VIEW) && (
                <button
                  type="button"
                  onClick={() => openProfilePanel('profile')}
                  className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm font-medium text-slate-600 hover:bg-slate-50 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-700 dark:hover:text-white transition-colors"
                >
                  <User size={15} /> Profile
                </button>
              )}
              {hasPermission(PERMISSIONS.USER_CHANGE_PASSWORD) && (
                <button
                  type="button"
                  onClick={() => openProfilePanel('password')}
                  className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm font-medium text-slate-600 hover:bg-slate-50 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-700 dark:hover:text-white transition-colors"
                >
                  <Lock size={15} /> Change Password
                </button>
              )}
              <div className="my-1 border-t border-slate-100 dark:border-slate-700" />
              <button
                type="button"
                onClick={handleLogout}
                className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm font-medium text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-900/20 transition-colors"
              >
                <LogOut size={15} /> Logout
              </button>
            </div>
          )}

          {collapsed ? (
            /* Collapsed avatar with tooltip + flyout */
            <div className="group/profile relative flex justify-center">
              <button
                type="button"
                onClick={() => setShowProfileMenu((c) => !c)}
                className="flex h-9 w-9 items-center justify-center rounded-full bg-blue-600 text-sm font-bold text-white hover:bg-blue-700 dark:bg-blue-500 dark:hover:bg-blue-400 transition-colors"
                title={user?.userName || 'User'}
                aria-label="Profile menu"
              >
                {user?.userName?.charAt(0).toUpperCase() || 'U'}
              </button>
              <div className="pointer-events-none absolute left-full top-1/2 z-50 ml-2.5 -translate-y-1/2 whitespace-nowrap rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-medium text-white opacity-0 shadow-xl transition-opacity group-hover/profile:opacity-100 dark:bg-slate-700">
                {user?.userName || 'User'}
              </div>
              {showProfileMenu && (
                <div className="absolute bottom-12 left-full z-50 ml-2 w-48 overflow-hidden rounded-xl border border-slate-200 bg-white py-1.5 shadow-xl dark:border-slate-700 dark:bg-slate-800">
                  {hasPermission(PERMISSIONS.USER_PROFILE_VIEW) && (
                    <button type="button" onClick={() => openProfilePanel('profile')} className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm font-medium text-slate-600 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-700 transition-colors">
                      <User size={15} /> Profile
                    </button>
                  )}
                  {hasPermission(PERMISSIONS.USER_CHANGE_PASSWORD) && (
                    <button type="button" onClick={() => openProfilePanel('password')} className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm font-medium text-slate-600 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-700 transition-colors">
                      <Lock size={15} /> Change Password
                    </button>
                  )}
                  <div className="my-1 border-t border-slate-100 dark:border-slate-700" />
                  <button type="button" onClick={handleLogout} className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm font-medium text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-900/20 transition-colors">
                    <LogOut size={15} /> Logout
                  </button>
                </div>
              )}
            </div>
          ) : (
            /* Expanded profile card */
            <button
              type="button"
              onClick={() => setShowProfileMenu((c) => !c)}
              className={[
                'flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition-colors',
                'border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100',
                'dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700',
              ].join(' ')}
            >
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-blue-600 text-sm font-bold text-white dark:bg-blue-500">
                {user?.userName?.charAt(0).toUpperCase() || 'U'}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-slate-800 dark:text-slate-100">
                  {user?.userName || 'User'}
                </p>
                <p className="truncate text-xs text-slate-500 dark:text-slate-400">
                  {user?.role || user?.organizationName || 'Organization'}
                </p>
              </div>
              <ChevronRight
                size={15}
                className={`shrink-0 text-slate-400 dark:text-slate-500 transition-transform duration-200 ${
                  showProfileMenu ? '-rotate-90' : ''
                }`}
              />
            </button>
          )}
        </div>
      </aside>
    </>
  );
};
