import { useState } from 'react';
import { Outlet, NavLink, useNavigate, useLocation } from 'react-router-dom';
import {
  LayoutDashboard, Settings, Building2, Store, Warehouse, Users, Handshake,
  Truck, Package, Tag, BarChart3, FolderOpen, Sparkles, Ruler, DollarSign,
  RefreshCw, Pencil, Search, Layers, ShoppingCart, Receipt, ClipboardList,
  CreditCard, Undo2, Archive, LockOpen, FileText, Calculator,
  ShoppingBag, ClipboardCheck, Wallet, RotateCcw, Banknote,
  PanelLeftClose, PanelLeftOpen, ChevronRight, LogOut, Sun, Moon, Bell,
  BookOpen, Zap, RefreshCcw, CalendarCheck, UserCog, CalendarClock,
  CalendarDays, Wallet2, Scissors, UserCircle2, Megaphone, CalendarRange,
  Factory, QrCode, PackageCheck, TrendingDown, PieChart, Clock,
  Database, Activity, GitBranch, ShieldCheck, Gauge, Inbox, HelpCircle,
} from 'lucide-react';
import { useAuthStore } from '../store/auth.store.js';
import { useUIStore } from '../store/ui.store.js';
import { useTheme } from '../context/ThemeContext.js';
import ERPBreadcrumb from './erp/ERPBreadcrumb.js';
import { HelpPanel } from './help/HelpPanel.js';
import { OnboardingChecklist } from './help/OnboardingChecklist.js';

type LucideIcon = React.ComponentType<{ size?: number; className?: string }>;

interface NavItem {
  label: string;
  path: string;
  icon: LucideIcon;
  children?: NavItem[];
}

interface NavGroup {
  groupLabel: string;
  items: NavItem[];
}

const NAV_GROUPS: NavGroup[] = [
  {
    groupLabel: 'WORKSPACE',
    items: [
      { label: 'Home', path: '/dashboard', icon: LayoutDashboard },
    ],
  },
  {
    groupLabel: 'MASTER DATA',
    items: [
      {
        label: 'Settings', path: '/settings', icon: Settings,
        children: [
          { label: 'Organization', path: '/settings/organization', icon: Building2 },
          { label: 'Branches', path: '/settings/branches', icon: Store },
          { label: 'Warehouses', path: '/settings/warehouses', icon: Warehouse },
        ],
      },
      { label: 'Users', path: '/users', icon: Users },
    ],
  },
  {
    groupLabel: 'SALES & CRM',
    items: [
      { label: 'Customers', path: '/customers', icon: Handshake },
      {
        label: 'Sales', path: '/sales', icon: ShoppingCart,
        children: [
          { label: 'Invoices', path: '/sales/invoices', icon: Receipt },
          { label: 'Quotations', path: '/sales/quotations', icon: ClipboardList },
          { label: 'Payments', path: '/sales/payments', icon: CreditCard },
          { label: 'Returns', path: '/sales/returns', icon: Undo2 },
          { label: 'Delivery Challans', path: '/sales/delivery-challans', icon: Archive },
        ],
      },
      {
        label: 'CRM', path: '/crm', icon: Megaphone,
        children: [
          { label: 'Segments', path: '/crm/segments', icon: UserCircle2 },
          { label: 'Campaigns', path: '/crm/campaigns', icon: Megaphone },
          { label: 'Seasons', path: '/crm/seasons', icon: CalendarRange },
        ],
      },
    ],
  },
  {
    groupLabel: 'INVENTORY',
    items: [
      {
        label: 'Inventory', path: '/inventory', icon: Package,
        children: [
          { label: 'Items', path: '/inventory/items', icon: Tag },
          { label: 'Stock Levels', path: '/inventory/stock', icon: BarChart3 },
          { label: 'Categories', path: '/inventory/categories', icon: FolderOpen },
          { label: 'Brands', path: '/inventory/brands', icon: Sparkles },
          { label: 'Units', path: '/inventory/units', icon: Ruler },
          { label: 'Price Lists', path: '/inventory/price-lists', icon: DollarSign },
          { label: 'Transfers', path: '/inventory/transfers', icon: RefreshCw },
          { label: 'Adjustments', path: '/inventory/adjustments', icon: Pencil },
          { label: 'Physical Verification', path: '/inventory/physical-verifications', icon: Search },
          { label: 'Fabric Rolls', path: '/inventory/fabric-rolls', icon: Layers },
        ],
      },
      { label: 'Suppliers', path: '/suppliers', icon: Truck },
    ],
  },
  {
    groupLabel: 'PURCHASE',
    items: [
      {
        label: 'Purchase', path: '/purchase', icon: ShoppingBag,
        children: [
          { label: 'Purchase Orders', path: '/purchase/orders', icon: ClipboardList },
          { label: 'GRNs', path: '/purchase/grns', icon: ClipboardCheck },
          { label: 'Supplier Payments', path: '/purchase/payments', icon: Wallet },
          { label: 'Returns', path: '/purchase/returns', icon: RotateCcw },
          { label: 'Expenses', path: '/purchase/expenses', icon: Banknote },
        ],
      },
    ],
  },
  {
    groupLabel: 'ACCOUNTING',
    items: [
      {
        label: 'GST', path: '/gst', icon: Calculator,
        children: [
          { label: 'GST Config', path: '/gst/config', icon: Calculator },
          { label: 'GST Register', path: '/gst/register', icon: BookOpen },
          { label: 'GSTR-1', path: '/gst/gstr1', icon: FileText },
          { label: 'GSTR-3B', path: '/gst/gstr3b', icon: FileText },
          { label: 'e-Invoice (IRN)', path: '/gst/einvoice', icon: Zap },
          { label: 'GSTR-2A Recon', path: '/gst/gstr2a', icon: RefreshCcw },
          { label: 'Compliance Calendar', path: '/gst/compliance', icon: CalendarCheck },
        ],
      },
      {
        label: 'Accounting', path: '/accounting', icon: FileText,
        children: [
          { label: 'Chart of Accounts', path: '/accounting/chart-of-accounts', icon: FolderOpen },
          { label: 'Opening Balances', path: '/accounting/opening-balances', icon: LockOpen },
          { label: 'Journal Entries', path: '/accounting/journals', icon: FileText },
          { label: 'Trial Balance', path: '/accounting/reports/trial-balance', icon: FileText },
          { label: 'Profit & Loss', path: '/accounting/reports/profit-loss', icon: FileText },
          { label: 'Balance Sheet', path: '/accounting/reports/balance-sheet', icon: FileText },
          { label: 'Cash Flow', path: '/accounting/reports/cash-flow', icon: FileText },
          { label: 'Bank Reconciliation', path: '/accounting/bank-reconciliation', icon: FileText },
          { label: 'Financial Years', path: '/accounting/financial-years', icon: FileText },
          { label: 'Fixed Assets', path: '/accounting/fixed-assets', icon: FileText },
          { label: 'TDS', path: '/accounting/tds', icon: FileText },
        ],
      },
    ],
  },
  {
    groupLabel: 'PRODUCTION',
    items: [
      {
        label: 'Job Work', path: '/production/job-work', icon: Factory,
        children: [
          { label: 'Orders', path: '/production/job-work', icon: ClipboardList },
          { label: 'New Order', path: '/production/job-work/new', icon: Pencil },
        ],
      },
      {
        label: 'Consignment', path: '/production/consignment', icon: PackageCheck,
        children: [
          { label: 'Stock', path: '/production/consignment/stock', icon: Package },
          { label: 'Settlements', path: '/production/consignment/settlements', icon: Wallet },
        ],
      },
      { label: 'Reorder Report', path: '/production/reorder', icon: TrendingDown },
    ],
  },
  {
    groupLabel: 'ANALYTICS',
    items: [
      { label: 'Dashboard', path: '/dashboard', icon: LayoutDashboard },
      {
        label: 'Reports', path: '/reports', icon: PieChart,
        children: [
          { label: 'Reports Browser', path: '/reports', icon: BarChart3 },
          { label: 'Schedules', path: '/reports/schedules', icon: Clock },
        ],
      },
    ],
  },
  {
    groupLabel: 'HR & PAYROLL',
    items: [
      {
        label: 'HR', path: '/hr', icon: UserCog,
        children: [
          { label: 'Employees', path: '/hr/employees', icon: Users },
          { label: 'Attendance', path: '/hr/attendance', icon: CalendarClock },
          { label: 'Leave', path: '/hr/leaves', icon: CalendarDays },
          { label: 'Payroll', path: '/hr/payroll', icon: Wallet2 },
          { label: 'Alterations', path: '/hr/alterations', icon: Scissors },
        ],
      },
    ],
  },
  {
    groupLabel: 'DISTRIBUTED SYSTEMS',
    items: [
      { label: 'Event Store', path: '/admin/distributed/events', icon: Database },
      { label: 'Dead Letter Queue', path: '/admin/distributed/dlq', icon: Inbox },
      { label: 'Saga Monitor', path: '/admin/distributed/sagas', icon: GitBranch },
      { label: 'Schema Registry', path: '/admin/distributed/schemas', icon: ShieldCheck },
      { label: 'Projections', path: '/admin/distributed/projections', icon: Activity },
      { label: 'Performance', path: '/admin/distributed/performance', icon: Gauge },
    ],
  },
];

function NavItemLeaf({ item, collapsed }: { item: NavItem; collapsed: boolean }) {
  const Icon = item.icon;
  return (
    <NavLink
      to={item.path}
      title={collapsed ? item.label : undefined}
      className={({ isActive }) =>
        `flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
          isActive
            ? 'bg-sidebar-item-active text-sidebar-active'
            : 'text-sidebar hover:bg-sidebar-item-hover'
        }`
      }
    >
      <Icon size={16} className="shrink-0" />
      {!collapsed && <span>{item.label}</span>}
    </NavLink>
  );
}

function NavGroupItem({ item, collapsed }: { item: NavItem; collapsed: boolean }) {
  const [open, setOpen] = useState(false);
  const Icon = item.icon;

  if (!item.children) {
    return <NavItemLeaf item={item} collapsed={collapsed} />;
  }

  return (
    <div>
      <button
        onClick={() => setOpen((o) => !o)}
        title={collapsed ? item.label : undefined}
        className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium text-sidebar hover:bg-sidebar-item-hover transition-colors"
      >
        <Icon size={16} className="shrink-0" />
        {!collapsed && (
          <>
            <span className="flex-1 text-left">{item.label}</span>
            <ChevronRight
              size={14}
              className={`text-sidebar-muted transition-transform duration-150 ${open ? 'rotate-90' : ''}`}
            />
          </>
        )}
      </button>
      {open && !collapsed && (
        <div className="ml-4 mt-1 space-y-0.5 border-l border-sidebar-border pl-3">
          {item.children.map((child) => {
            const ChildIcon = child.icon;
            return (
              <NavLink
                key={child.path}
                to={child.path}
                className={({ isActive }) =>
                  `flex items-center gap-2 px-2 py-1.5 rounded-md text-sm transition-colors ${
                    isActive
                      ? 'text-sidebar-active font-semibold'
                      : 'text-sidebar-muted hover:text-sidebar hover:bg-sidebar-item-hover'
                  }`
                }
              >
                <ChildIcon size={14} className="shrink-0" />
                <span>{child.label}</span>
              </NavLink>
            );
          })}
        </div>
      )}
    </div>
  );
}

const ONBOARDING_DISMISSED_KEY = 'erp_onboarding_dismissed';

export default function Layout() {
  const { sidebarCollapsed, toggleSidebar } = useUIStore();
  const navigate = useNavigate();
  const location = useLocation();
  const { user, logout } = useAuthStore();
  const { isDark, toggleTheme } = useTheme();

  const [helpOpen, setHelpOpen] = useState(false);
  const [onboardingVisible, setOnboardingVisible] = useState(
    () => localStorage.getItem(ONBOARDING_DISMISSED_KEY) !== 'true',
  );

  function handleLogout() {
    logout();
    navigate('/login');
  }

  function dismissOnboarding() {
    localStorage.setItem(ONBOARDING_DISMISSED_KEY, 'true');
    setOnboardingVisible(false);
  }

  const userInitial = user?.firstName?.[0]?.toUpperCase() ?? '?';

  return (
    <div className="flex h-screen bg-surface-page overflow-hidden">
      {/* Sidebar */}
      <aside
        className={`flex flex-col bg-sidebar border-r border-sidebar transition-all duration-200 shrink-0 ${
          sidebarCollapsed ? 'w-16' : 'w-60'
        }`}
      >
        {/* Logo row */}
        <div className="flex items-center gap-2 px-4 py-4 border-b border-sidebar-border">
          <div className="w-7 h-7 rounded-md bg-primary flex items-center justify-center text-white font-bold text-sm shrink-0">
            N
          </div>
          {!sidebarCollapsed && (
            <span className="font-bold text-sidebar text-sm truncate">NEXORAA ERP</span>
          )}
          <button
            onClick={toggleSidebar}
            aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            className="ml-auto text-sidebar-muted hover:text-sidebar transition-colors"
          >
            {sidebarCollapsed
              ? <PanelLeftOpen size={16} />
              : <PanelLeftClose size={16} />
            }
          </button>
        </div>

        {/* Navigation */}
        <nav className="flex-1 overflow-y-auto px-2 py-3 space-y-4">
          {NAV_GROUPS.map((group) => (
            <div key={group.groupLabel}>
              {!sidebarCollapsed && (
                <p className="px-3 mb-1 text-[10px] font-semibold uppercase tracking-widest text-sidebar-muted select-none">
                  {group.groupLabel}
                </p>
              )}
              <div className="space-y-0.5">
                {group.items.map((item) => (
                  <NavGroupItem key={item.path} item={item} collapsed={sidebarCollapsed} />
                ))}
              </div>
            </div>
          ))}
        </nav>

        {/* User area */}
        <div className="px-3 py-3 border-t border-sidebar-border space-y-1">
          {!sidebarCollapsed && user && (
            <div className="flex items-center gap-2 px-2 py-1.5 text-sm text-sidebar mb-1">
              <div className="w-7 h-7 rounded-full bg-primary flex items-center justify-center text-white font-semibold text-xs shrink-0">
                {userInitial}
              </div>
              <div className="min-w-0">
                <p className="font-medium text-sidebar truncate">{user.firstName} {user.lastName}</p>
                <p className="text-xs text-sidebar-muted truncate">{user.email}</p>
              </div>
            </div>
          )}
          <button
            onClick={handleLogout}
            aria-label="Logout"
            title={sidebarCollapsed ? 'Logout' : undefined}
            className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-sm text-red-400 hover:bg-red-900/20 transition-colors"
          >
            <LogOut size={15} className="shrink-0" />
            {!sidebarCollapsed && 'Logout'}
          </button>
        </div>
      </aside>

      {/* Main area */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Top header */}
        <header className="flex items-center justify-between px-6 py-3 bg-surface-card border-b border-default shrink-0">
          <ERPBreadcrumb />
          <div className="flex items-center gap-2">
            <button
              onClick={() => {}}
              aria-label="Notifications"
              className="p-2 rounded-lg text-secondary hover:bg-surface-raised transition-colors relative"
            >
              <Bell size={18} />
            </button>
            <button
              onClick={toggleTheme}
              aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
              className="p-2 rounded-lg text-secondary hover:bg-surface-raised transition-colors"
            >
              {isDark ? <Sun size={18} /> : <Moon size={18} />}
            </button>
            <button
              onClick={() => setHelpOpen((v) => !v)}
              aria-label="Open help panel"
              title="Help (press ?)"
              className={`p-2 rounded-lg transition-colors ${helpOpen ? 'bg-blue-600 text-white' : 'text-secondary hover:bg-surface-raised'}`}
            >
              <HelpCircle size={18} />
            </button>
          </div>
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-y-auto p-6">
          <Outlet />
        </main>
      </div>

      {/* Help Panel (slides in from right) */}
      {helpOpen && (
        <HelpPanel currentPath={location.pathname} onClose={() => setHelpOpen(false)} />
      )}

      {/* Onboarding checklist (bottom-right, shown to new tenants) */}
      {onboardingVisible && (
        <OnboardingChecklist onNavigate={(path) => navigate(path)} onDismiss={dismissOnboarding} />
      )}
    </div>
  );
}
