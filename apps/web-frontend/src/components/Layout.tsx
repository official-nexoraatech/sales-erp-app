import { useEffect, useMemo, useState, useCallback } from 'react';
import { Outlet, NavLink, useNavigate, useLocation } from 'react-router-dom';
import {
  PanelLeftClose, PanelLeftOpen, ChevronRight, LogOut, Bell, HelpCircle, Search, Menu, X,
} from 'lucide-react';
import { useAuthStore } from '../store/auth.store.js';
import { useUIStore } from '../store/ui.store.js';
import { useNotificationStream } from '../hooks/useNotificationStream.js';
import { useKeyboardShortcut } from '../hooks/useKeyboardShortcut.js';
import { useSequenceShortcut } from '../hooks/useSequenceShortcut.js';
import { useMediaQuery, BREAKPOINTS } from '../hooks/useMediaQuery.js';
import { NAV_GROUPS, filterNavGroups, findNavItemByPath, type NavItem } from '../lib/navigation.js';
import ERPBreadcrumb from './erp/ERPBreadcrumb.js';
import ERPConfirmModal from './erp/ERPConfirmModal.js';
import ERPCommandPalette from './erp/ERPCommandPalette.js';
import BranchSwitcher from './erp/BranchSwitcher.js';
import QuickCreateMenu from './erp/QuickCreateMenu.js';
import AppearanceMenu from './erp/AppearanceMenu.js';
import TenantThemeSync from './erp/TenantThemeSync.js';
import ImpersonationBanner from './erp/ImpersonationBanner.js';
import Kbd from './erp/Kbd.js';
import { HelpPanel } from './help/HelpPanel.js';
import { OnboardingChecklist } from './help/OnboardingChecklist.js';
import { NotificationsPanel } from './notifications/NotificationsPanel.js';

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
  const { sidebarCollapsed, toggleSidebar, setSidebarCollapsed, pushRecentPage, density } = useUIStore();
  const navigate = useNavigate();
  const location = useLocation();
  const { user, logout, hasPermission } = useAuthStore();
  const navGroups = useMemo(
    () => filterNavGroups(NAV_GROUPS, hasPermission),
    [hasPermission, user?.permissions],
  );

  // Responsive sidebar — ERP-PLANNING/02_ERP_NAVIGATION_ARCHITECTURE.md §5
  const isMobile = useMediaQuery(BREAKPOINTS.mobile);
  const isTablet = useMediaQuery(BREAKPOINTS.tablet);
  const [mobileDrawerOpen, setMobileDrawerOpen] = useState(false);
  const [sidebarHovering, setSidebarHovering] = useState(false);
  const [tabletExpanded, setTabletExpanded] = useState(false);
  const effectiveCollapsed = isTablet ? true : sidebarCollapsed;
  const overlayExpanded = !isMobile && effectiveCollapsed && (sidebarHovering || (isTablet && tabletExpanded));
  const showLabels = isMobile || !effectiveCollapsed || overlayExpanded;

  useEffect(() => {
    setMobileDrawerOpen(false);
    setTabletExpanded(false);
  }, [location.pathname]);

  // Recent pages — ERP-PLANNING/02_ERP_NAVIGATION_ARCHITECTURE.md §10. Only tracks routes that
  // match a known nav leaf (so we always have a real label), not arbitrary detail/edit routes.
  useEffect(() => {
    const item = findNavItemByPath(NAV_GROUPS, location.pathname);
    if (item) pushRecentPage({ path: item.path, label: item.label });
  }, [location.pathname, pushRecentPage]);

  // Density — ERP-PLANNING/05_ERP_THEME_SYSTEM.md §6. 'comfortable' has no CSS override
  // (default --density-multiplier), so it's represented as "no attribute" rather than a
  // third selector — one fewer thing to keep in sync with tokens.css.
  useEffect(() => {
    if (density === 'comfortable') {
      document.documentElement.removeAttribute('data-density');
    } else {
      document.documentElement.setAttribute('data-density', density);
    }
  }, [density]);

  function handleSidebarToggleClick() {
    if (isMobile) { setMobileDrawerOpen(false); return; }
    if (isTablet) { setTabletExpanded((v) => !v); return; }
    toggleSidebar();
  }

  const [helpOpen, setHelpOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [commandPaletteInitialQuery, setCommandPaletteInitialQuery] = useState('');
  const canSearch = hasPermission('SEARCH_GLOBAL');
  const openCommandPalette = useCallback(() => {
    if (canSearch) { setCommandPaletteInitialQuery(''); setCommandPaletteOpen(true); }
  }, [canSearch]);
  const openQuickCreate = useCallback(() => {
    if (canSearch) { setCommandPaletteInitialQuery('>create '); setCommandPaletteOpen(true); }
  }, [canSearch]);
  const goToDashboard = useCallback(() => navigate('/dashboard'), [navigate]);
  useKeyboardShortcut('k', openCommandPalette, { ctrlOrCmd: true });
  useKeyboardShortcut('n', openQuickCreate, { ctrlOrCmd: true, shift: true });
  useSequenceShortcut(['g', 'd'], goToDashboard);
  useKeyboardShortcut('[', () => { if (!isMobile && !isTablet) setSidebarCollapsed(true); });
  useKeyboardShortcut(']', () => { if (!isMobile && !isTablet) setSidebarCollapsed(false); });
  useKeyboardShortcut('?', () => setHelpOpen((v) => !v));
  const streamedUnreadCount = useNotificationStream();
  const [unreadCount, setUnreadCount] = useState(0);
  useEffect(() => setUnreadCount(streamedUnreadCount), [streamedUnreadCount]);
  const [onboardingVisible, setOnboardingVisible] = useState(
    () => localStorage.getItem(ONBOARDING_DISMISSED_KEY) !== 'true',
  );

  const [logoutConfirmOpen, setLogoutConfirmOpen] = useState(false);

  function handleLogout() {
    logout();
    navigate('/login');
  }

  function dismissOnboarding() {
    localStorage.setItem(ONBOARDING_DISMISSED_KEY, 'true');
    setOnboardingVisible(false);
  }

  const userInitial = user?.firstName?.[0]?.toUpperCase() ?? '?';

  const sidebarInner = (
    <>
      {/* Logo row */}
      <div className="flex items-center gap-2 px-4 py-4 border-b border-sidebar-border">
        <div className="w-7 h-7 rounded-md bg-primary flex items-center justify-center text-white font-bold text-sm shrink-0">
          N
        </div>
        {showLabels && (
          <span className="font-bold text-sidebar text-sm truncate">NEXORAA ERP</span>
        )}
        <button
          onClick={handleSidebarToggleClick}
          aria-label={isMobile ? 'Close navigation menu' : effectiveCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          className="ml-auto text-sidebar-muted hover:text-sidebar transition-colors"
        >
          {isMobile
            ? <X size={16} />
            : effectiveCollapsed && !overlayExpanded
              ? <PanelLeftOpen size={16} />
              : <PanelLeftClose size={16} />
          }
        </button>
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto px-2 py-3 space-y-4">
        {navGroups.map((group) => (
          <div key={group.groupLabel}>
            {showLabels && (
              <p className="px-3 mb-1 text-[10px] font-semibold uppercase tracking-widest text-sidebar-muted select-none">
                {group.groupLabel}
              </p>
            )}
            <div className="space-y-0.5">
              {group.items.map((item) => (
                <NavGroupItem key={item.path} item={item} collapsed={!showLabels} />
              ))}
            </div>
          </div>
        ))}
      </nav>

      {/* User area */}
      <div className="px-3 py-3 border-t border-sidebar-border space-y-1">
        {showLabels && user && (
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
          onClick={() => setLogoutConfirmOpen(true)}
          aria-label="Logout"
          title={showLabels ? undefined : 'Logout'}
          className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-sm text-red-400 hover:bg-red-900/20 transition-colors"
        >
          <LogOut size={15} className="shrink-0" />
          {showLabels && 'Logout'}
        </button>
      </div>
    </>
  );

  return (
    <div className="flex flex-col h-screen bg-surface-page overflow-hidden">
      <ImpersonationBanner />
      <div className="flex flex-1 min-h-0 overflow-hidden">
      {/* Mobile drawer scrim */}
      {isMobile && mobileDrawerOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-[var(--z-overlay)]"
          onClick={() => setMobileDrawerOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        onMouseEnter={() => !isMobile && effectiveCollapsed && setSidebarHovering(true)}
        onMouseLeave={() => setSidebarHovering(false)}
        className={`flex flex-col bg-sidebar border-r border-sidebar transition-all duration-200 shrink-0 ${
          isMobile
            ? `fixed inset-y-0 left-0 z-[var(--z-modal)] w-60 transform ${mobileDrawerOpen ? 'translate-x-0' : '-translate-x-full'}`
            : `relative sticky top-0 h-screen ${effectiveCollapsed ? 'w-16' : 'w-60'}`
        }`}
      >
        {overlayExpanded ? (
          <div className="absolute inset-y-0 left-0 w-60 flex flex-col bg-sidebar border-r border-sidebar shadow-token-lg z-[var(--z-popover)]">
            {sidebarInner}
          </div>
        ) : (
          sidebarInner
        )}
      </aside>

      {/* Main area */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Top header */}
        <header className="flex items-center justify-between px-6 py-3 bg-surface-card border-b border-default shrink-0 sticky top-0 z-[var(--z-header)]">
          <div className="flex items-center gap-2 min-w-0">
            {isMobile && (
              <button
                onClick={() => setMobileDrawerOpen(true)}
                aria-label="Open navigation menu"
                className="p-2 -ml-2 rounded-lg text-secondary hover:bg-surface-raised transition-colors shrink-0"
              >
                <Menu size={18} />
              </button>
            )}
            <ERPBreadcrumb />
          </div>
          <div className="flex items-center gap-2">
            <QuickCreateMenu />
            <BranchSwitcher />
            {canSearch && (
              <button
                onClick={openCommandPalette}
                aria-label="Global search"
                title="Search (Ctrl+K)"
                className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm text-secondary hover:bg-surface-raised transition-colors border border-default"
              >
                <Search size={15} />
                <span className="hidden sm:inline">Search...</span>
                <span className="hidden sm:inline"><Kbd>Ctrl K</Kbd></span>
              </button>
            )}
            <div className="relative">
              <button
                onClick={() => setNotificationsOpen((v) => !v)}
                aria-label="Notifications"
                className={`p-2 rounded-lg transition-colors relative ${notificationsOpen ? 'bg-blue-600 text-white' : 'text-secondary hover:bg-surface-raised'}`}
              >
                <Bell size={18} />
                {unreadCount > 0 && (
                  <span className="absolute top-0.5 right-0.5 min-w-[16px] h-4 px-1 flex items-center justify-center rounded-full bg-red-500 text-white text-[10px] font-semibold leading-none">
                    {unreadCount > 99 ? '99+' : unreadCount}
                  </span>
                )}
              </button>
              {notificationsOpen && (
                <NotificationsPanel
                  onClose={() => setNotificationsOpen(false)}
                  onUnreadCountChange={setUnreadCount}
                />
              )}
            </div>
            <AppearanceMenu />
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

      <ERPConfirmModal
        open={logoutConfirmOpen}
        onClose={() => setLogoutConfirmOpen(false)}
        onConfirm={handleLogout}
        title="Log out?"
        description="You will need to sign in again to access your account."
        confirmLabel="Logout"
        variant="warning"
        icon={LogOut}
      />

      {canSearch && (
        <ERPCommandPalette open={commandPaletteOpen} onClose={() => setCommandPaletteOpen(false)} initialQuery={commandPaletteInitialQuery} />
      )}

      <TenantThemeSync />
      </div>
    </div>
  );
}
