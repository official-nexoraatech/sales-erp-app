import React, { useEffect, useState } from 'react';
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
} from 'lucide-react';
import { useAuth } from '../../hooks/useAuth';

interface MenuItem {
  label: string;
  icon: React.ReactNode;
  href?: string;
  submenu?: MenuItem[];
}

const menuItems: MenuItem[] = [
  {
    label: 'Dashboard',
    icon: <LayoutDashboard size={20} />,
    href: '/dashboard',
  },
  {
    label: 'Organization',
    icon: <Building2 size={20} />,
    href: '/organizations',
  },
  {
    label: 'Contacts',
    icon: <Users size={20} />,
    submenu: [
      { label: 'Customers', href: '/contacts/customers', icon: <Users size={18} /> },
      { label: 'Suppliers', href: '/contacts/suppliers', icon: <Users size={18} /> },
      { label: 'Carriers', href: '/contacts/carriers', icon: <Users size={18} /> },
    ],
  },
  {
    label: 'Sales',
    icon: <ShoppingCart size={20} />,
    submenu: [
      { label: 'POS', href: '/sales/pos', icon: <ShoppingCart size={18} /> },
      { label: 'Invoices', href: '/sales/invoices', icon: <ShoppingCart size={18} /> },
      { label: 'Quotations', href: '/sales/quotations', icon: <ShoppingCart size={18} /> },
      { label: 'Payment In', href: '/sales/payment-in', icon: <ShoppingCart size={18} /> },
      { label: 'Sale Orders', href: '/sales/orders', icon: <ShoppingCart size={18} /> },
    ],
  },
  {
    label: 'Purchase',
    icon: <ShoppingBag size={20} />,
    submenu: [
      { label: 'Bills', href: '/purchase/bills', icon: <ShoppingBag size={18} /> },
      { label: 'Orders', href: '/purchase/orders', icon: <ShoppingBag size={18} /> },
      { label: 'Payment Out', href: '/purchase/payment-out', icon: <ShoppingBag size={18} /> },
    ],
  },
  {
    label: 'Items',
    icon: <Package size={20} />,
    submenu: [
      { label: 'Item List', href: '/items', icon: <Package size={18} /> },
      { label: 'Category List', href: '/items/categories', icon: <Package size={18} /> },
      { label: 'Brand List', href: '/items/brands', icon: <Package size={18} /> },
      { label: 'Unit List', href: '/items/units', icon: <Package size={18} /> },
    ],
  },
  {
    label: 'Stock',
    icon: <Warehouse size={20} />,
    submenu: [
      { label: 'Transfer', href: '/stock/transfers', icon: <Warehouse size={18} /> },
      { label: 'Adjustment', href: '/stock/adjustments', icon: <Warehouse size={18} /> },
    ],
  },
  {
    label: 'Expense',
    icon: <CircleMinus size={20} />,
    submenu: [
      { label: 'Expense List', href: '/expenses', icon: <CircleMinus size={18} /> },
      { label: 'Category List', href: '/expenses/categories', icon: <CircleMinus size={18} /> },
      { label: 'Subcategory List', href: '/expenses/subcategories', icon: <CircleMinus size={18} /> },
    ],
  },
  {
    label: 'Warehouses',
    icon: <Building2 size={20} />,
    href: '/warehouses',
  },
  {
    label: 'Cash & Bank',
    icon: <DollarSign size={20} />,
    submenu: [
      { label: 'Cash In Hand', href: '/cash-bank/cash-in-hand', icon: <DollarSign size={18} /> },
      { label: 'Cheques', href: '/cash-bank/cheques', icon: <DollarSign size={18} /> },
      { label: 'Bank', href: '/cash-bank/bank', icon: <DollarSign size={18} /> },
    ],
  },
  {
    label: 'Utilities',
    icon: <Wrench size={20} />,
    submenu: [
      { label: 'Import Items', href: '/utilities/import-items', icon: <Wrench size={18} /> },
      { label: 'Import Contacts', href: '/utilities/import-contacts', icon: <Wrench size={18} /> },
      { label: 'Generate Barcode', href: '/utilities/generate-barcode', icon: <Wrench size={18} /> },
    ],
  },
  {
    label: 'Users',
    icon: <Users size={20} />,
    submenu: [
      { label: 'Users', href: '/users', icon: <Users size={18} /> },
      { label: 'Roles', href: '/users/roles', icon: <Users size={18} /> },
    ],
  },
  {
    label: 'Staff Management',
    icon: <UserCog size={20} />,
    submenu: [
      { label: 'Employees', href: '/staff/employees', icon: <UserCog size={18} /> },
      { label: 'Attendance', href: '/staff/attendance', icon: <CalendarCheck size={18} /> },
      { label: 'Leaves', href: '/staff/leaves', icon: <ClipboardList size={18} /> },
      { label: 'Payroll', href: '/staff/payroll', icon: <WalletCards size={18} /> },
      { label: 'Settings', href: '/staff/settings', icon: <Settings size={18} /> },
    ],
  },
  {
    label: 'SMS',
    icon: <MessageSquare size={20} />,
    submenu: [
      { label: 'Create SMS', href: '/sms/create', icon: <MessageSquare size={18} /> },
      { label: 'Templates', href: '/sms/templates', icon: <MessageSquare size={18} /> },
    ],
  },
  {
    label: 'Email',
    icon: <Mail size={20} />,
    submenu: [
      { label: 'Create Email', href: '/email/create', icon: <Mail size={18} /> },
      { label: 'Templates', href: '/email/templates', icon: <Mail size={18} /> },
    ],
  },
  {
    label: 'Reports',
    icon: <BarChart3 size={20} />,
    submenu: [
      { label: 'Profit and Loss', href: '/reports/profit-and-loss', icon: <BarChart3 size={18} /> },
      { label: 'Batch Wise', href: '/reports/item-transaction/batch', icon: <BarChart3 size={18} /> },
      { label: 'Serial/IMEI', href: '/reports/item-transaction/serial', icon: <BarChart3 size={18} /> },
      { label: 'General', href: '/reports/item-transaction/general', icon: <BarChart3 size={18} /> },
      { label: 'Purchase', href: '/reports/purchase', icon: <BarChart3 size={18} /> },
      { label: 'Item Purchase', href: '/reports/purchase/item', icon: <BarChart3 size={18} /> },
      { label: 'Purchase Payment', href: '/reports/purchase/payment', icon: <BarChart3 size={18} /> },
      { label: 'Sale', href: '/reports/sale', icon: <BarChart3 size={18} /> },
      { label: 'Item Sale', href: '/reports/sale/item', icon: <BarChart3 size={18} /> },
      { label: 'Sale Payment', href: '/reports/sale/payment', icon: <BarChart3 size={18} /> },
      { label: 'Customer Due', href: '/reports/due/customer', icon: <BarChart3 size={18} /> },
      { label: 'Supplier Due', href: '/reports/due/supplier', icon: <BarChart3 size={18} /> },
      { label: 'Expense', href: '/reports/expense', icon: <BarChart3 size={18} /> },
      { label: 'Expense Item', href: '/reports/expense/item', icon: <BarChart3 size={18} /> },
      { label: 'Expense Payment', href: '/reports/expense/payment', icon: <BarChart3 size={18} /> },
      { label: 'Cash flow', href: '/reports/transactions/cash-flow', icon: <BarChart3 size={18} /> },
      { label: 'Bank Statement', href: '/reports/transactions/bank-statement', icon: <BarChart3 size={18} /> },
      { label: 'Supplier Ledger', href: '/reports/ledger/supplier', icon: <BarChart3 size={18} /> },
      { label: 'Customer Ledger', href: '/reports/ledger/customer', icon: <BarChart3 size={18} /> },
      { label: 'GST', href: '/reports/gst', icon: <BarChart3 size={18} /> },
      { label: 'GSTR-1', href: '/reports/gst/gstr-1', icon: <BarChart3 size={18} /> },
      { label: 'GSTR-2', href: '/reports/gst/gstr-2', icon: <BarChart3 size={18} /> },
      { label: 'Stock Transfer', href: '/reports/stock-transfer', icon: <BarChart3 size={18} /> },
      { label: 'Item Stock Transfer', href: '/reports/stock-transfer/item', icon: <BarChart3 size={18} /> },
      { label: 'Stock Adjustment', href: '/reports/stock-adjustment', icon: <BarChart3 size={18} /> },
      { label: 'Item Stock Adjustment', href: '/reports/stock-adjustment/item', icon: <BarChart3 size={18} /> },
      { label: 'Stock Report', href: '/reports/stock', icon: <BarChart3 size={18} /> },
      { label: 'Stock Batch Wise', href: '/reports/stock-report/batch', icon: <BarChart3 size={18} /> },
      { label: 'Stock Serial/IMEI', href: '/reports/stock-report/serial', icon: <BarChart3 size={18} /> },
      { label: 'Stock General', href: '/reports/stock-report/general', icon: <BarChart3 size={18} /> },
      { label: 'Low Stock', href: '/reports/low-stock', icon: <BarChart3 size={18} /> },
      { label: 'Inventory Valuation', href: '/reports/inventory-valuation', icon: <BarChart3 size={18} /> },
      { label: 'Top Selling Items', href: '/reports/top-selling-items', icon: <BarChart3 size={18} /> },
      { label: 'Day Book', href: '/reports/day-book', icon: <BarChart3 size={18} /> },
      { label: 'Expired Item Report', href: '/reports/expired-items', icon: <BarChart3 size={18} /> },
      { label: 'Reorder Item Report', href: '/reports/reorder-items', icon: <BarChart3 size={18} /> },
    ],
  },
];

export const Sidebar: React.FC<{ isOpen: boolean; onClose: () => void }> = ({
  isOpen,
  onClose,
}) => {
  const [expandedMenu, setExpandedMenu] = useState<string | null>(null);
  const [showProfileMenu, setShowProfileMenu] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  const { user, logout } = useAuth();

  useEffect(() => {
    const activeParent = menuItems.find((item) =>
      item.submenu?.some((subitem) => location.pathname.startsWith(subitem.href || ''))
    );
    if (activeParent) {
      setExpandedMenu(activeParent.label);
    }
    setShowProfileMenu(false);
  }, [location.pathname]);

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
        className={`fixed left-0 top-0 flex h-screen w-72 transform flex-col overflow-hidden bg-[#25282d] text-white shadow-xl transition-transform md:static md:inset-auto md:translate-x-0 ${
          isOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
        style={{ zIndex: 40 }}
      >
        <div className="flex h-24 items-center justify-between border-b border-white/[0.08] px-7">
          <Link to="/dashboard" onClick={onClose} className="flex items-center gap-3">
            {user?.organizationLogoUrl ? (
              <img src={user.organizationLogoUrl} alt="BillTop" className="h-12 w-12 object-contain" />
            ) : (
              <div className="flex h-12 w-12 items-center justify-center text-3xl font-black italic tracking-tight text-[#ff2f85]">
                B
              </div>
            )}
            <span className="sr-only">BillTop</span>
          </Link>
          <button onClick={onClose} className="rounded-full p-2 text-white/80 hover:bg-white/10 md:hidden" aria-label="Close menu">
            <X size={24} />
          </button>
          <ChevronLeft className="hidden text-white/30 md:block" size={22} />
        </div>

        <nav className="flex-1 space-y-1 overflow-y-auto px-5 py-5">
          {menuItems.map((item) => (
            <div key={item.label}>
              {item.href && !item.submenu ? (
                <Link
                  to={item.href}
                  onClick={onClose}
                  className={`flex min-h-12 items-center gap-4 rounded-xl px-4 py-3 transition-colors ${
                    isMenuActive(item.href, item.submenu)
                      ? 'bg-[#3a2b35] text-[#ff7ab6] shadow-[0_8px_22px_rgba(0,0,0,0.18)]'
                      : 'text-white/90 hover:bg-white/[0.08] hover:text-white'
                  }`}
                >
                  <span className="shrink-0">{item.icon}</span>
                  <span className="text-base font-bold leading-snug">{item.label}</span>
                </Link>
              ) : (
                <button
                  onClick={() => toggleMenu(item.label)}
                  className={`flex min-h-12 w-full items-center gap-4 rounded-xl px-4 py-3 transition-colors ${
                    isMenuActive(item.href, item.submenu)
                      ? 'bg-[#3a2b35] text-[#ff7ab6] shadow-[0_8px_22px_rgba(0,0,0,0.18)]'
                      : 'text-white/90 hover:bg-white/[0.08] hover:text-white'
                  }`}
                >
                  <span className="shrink-0">{item.icon}</span>
                  <span className="flex-1 text-left text-base font-bold leading-snug">
                    {item.label}
                  </span>
                  <ChevronDown
                    size={16}
                    className={`transform transition-transform ${
                      expandedMenu === item.label ? 'rotate-180' : ''
                    }`}
                  />
                </button>
              )}

              {/* Submenu */}
              {item.submenu && expandedMenu === item.label && (
                <div className="mt-1 space-y-1 pl-11">
                  {item.submenu.map((subitem) => (
                    <Link
                      key={subitem.label}
                      to={subitem.href || '#'}
                      onClick={onClose}
                      className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors ${
                        location.pathname === subitem.href ||
                        (!['/items', '/users', '/reports/purchase', '/reports/sale', '/reports/gst', '/reports/stock', '/reports/stock-transfer', '/reports/stock-adjustment', '/reports/expense'].includes(subitem.href || '') && location.pathname.startsWith(subitem.href || ''))
                          ? 'bg-[#3a2b35] text-[#ff7ab6]'
                          : 'text-white/75 hover:bg-white/[0.08] hover:text-white'
                      }`}
                    >
                      <span className="shrink-0">{subitem.icon}</span>
                      <span className="font-semibold">{subitem.label}</span>
                    </Link>
                  ))}
                </div>
              )}
            </div>
          ))}
        </nav>

        <div className="relative border-t border-white/[0.08] p-5">
          {showProfileMenu && (
            <div className="absolute bottom-[92px] left-5 right-5 overflow-hidden rounded-2xl border border-white/[0.08] bg-[#1d2025] py-2 shadow-2xl">
              <button
                type="button"
                onClick={() => openProfilePanel('profile')}
                className="flex w-full items-center gap-3 px-4 py-3 text-left text-sm font-semibold text-white/90 hover:bg-white/[0.08] hover:text-white"
              >
                <User size={16} />
                Profile
              </button>
              <button
                type="button"
                onClick={() => openProfilePanel('password')}
                className="flex w-full items-center gap-3 px-4 py-3 text-left text-sm font-semibold text-white/90 hover:bg-white/[0.08] hover:text-white"
              >
                <Lock size={16} />
                Change Password
              </button>
              <button
                type="button"
                onClick={handleLogout}
                className="flex w-full items-center gap-3 px-4 py-3 text-left text-sm font-semibold text-red-300 hover:bg-red-500/10 hover:text-red-200"
              >
                <LogOut size={16} />
                Logout
              </button>
            </div>
          )}
          <button
            type="button"
            onClick={() => setShowProfileMenu((current) => !current)}
            className="flex w-full items-center gap-3 rounded-2xl bg-white/[0.08] px-4 py-3 text-left text-white shadow-[0_8px_24px_rgba(0,0,0,0.18)] hover:bg-white/[0.12]"
          >
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#ff2f85] text-sm font-bold text-white">
              {user?.userName?.charAt(0).toUpperCase() || 'U'}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-bold">{user?.userName || 'User'}</p>
              <p className="truncate text-xs text-white/70">{user?.role || user?.organizationName || 'BillTop'}</p>
            </div>
            <ChevronRight size={18} className={`text-white/70 transition-transform ${showProfileMenu ? '-rotate-90' : ''}`} />
          </button>
        </div>
      </div>
    </>
  );
};
