import { useEffect, useMemo, useState, useCallback } from 'react';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import { Bell, HelpCircle, Compass, Search, Menu, LogOut } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuthStore } from '../store/auth.store.js';
import { authApi } from '../api/endpoints.js';
import { useUIStore } from '../store/ui.store.js';
import { useNotificationStream } from '../hooks/useNotificationStream.js';
import { useKeyboardShortcut } from '../hooks/useKeyboardShortcut.js';
import { useSequenceShortcut } from '../hooks/useSequenceShortcut.js';
import { useMediaQuery, BREAKPOINTS } from '../hooks/useMediaQuery.js';
import { NAV_GROUPS, filterNavGroups, findNavItemByPath } from '../lib/navigation.js';
import ERPBreadcrumb from './erp/ERPBreadcrumb.js';
import ERPConfirmModal from './erp/ERPConfirmModal.js';
import ERPCommandPalette from './erp/ERPCommandPalette.js';
import BranchSwitcher from './erp/BranchSwitcher.js';
import QuickCreateMenu from './erp/QuickCreateMenu.js';
import AppearanceMenu from './erp/AppearanceMenu.js';
import TenantThemeSync from './erp/TenantThemeSync.js';
import ImpersonationBanner from './erp/ImpersonationBanner.js';
import OfflineBanner from './erp/OfflineBanner.js';
import { Kbd } from '@erp/ui';
import { HelpPanel } from './help/HelpPanel.js';
import { TourGuidePanel } from './help/TourGuidePanel.js';
import { OnboardingChecklist } from './help/OnboardingChecklist.js';
import { NotificationsPanel } from './notifications/NotificationsPanel.js';
import { TourProvider, TourOverlay, useTour, useHasUnseenPageTour } from '../dap/index.js';
import SidebarContent from './sidebar/SidebarContent.js';

const ONBOARDING_DISMISSED_KEY = 'erp_onboarding_dismissed';

// `TourProvider` must wrap this component (not live inside it) so LayoutContent itself — not
// just its NavGroupItem descendants — can read `useTour()` to force the desktop rail out of
// its collapsed icon-only mode while a tour is running (see `tourForcesExpanded` below). A
// tour must never explain a sidebar item hidden inside a collapsed rail's click-triggered
// flyout menu, and that flyout only exists in collapsed mode in the first place.
export default function Layout() {
  return (
    <TourProvider>
      <LayoutContent />
    </TourProvider>
  );
}

function LayoutContent() {
  const { sidebarCollapsed, toggleSidebar, setSidebarCollapsed, pushRecentPage, density } =
    useUIStore();
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const { activeTour } = useTour();
  const hasUnseenPageTour = useHasUnseenPageTour();
  const { user, logout, hasPermission } = useAuthStore();
  const navGroups = useMemo(
    () => filterNavGroups(NAV_GROUPS, hasPermission),
    [hasPermission, user?.permissions]
  );

  // Responsive sidebar — ERP-PLANNING/02_ERP_NAVIGATION_ARCHITECTURE.md §5
  const isMobile = useMediaQuery(BREAKPOINTS.mobile);
  const isTablet = useMediaQuery(BREAKPOINTS.tablet);
  const [mobileDrawerOpen, setMobileDrawerOpen] = useState(false);
  // Tablet has no persistent collapsed/expanded preference (it's always icon-only by default),
  // so a click on the toggle button "peeks" the full sidebar as a temporary overlay instead —
  // desktop's collapsed rail has no equivalent peek; reaching a sub-item there opens a small
  // flyout menu (see NavGroupItem) rather than expanding the whole sidebar.
  const [tabletExpanded, setTabletExpanded] = useState(false);
  // A tour must never explain a sidebar item hidden behind the collapsed rail's
  // click-triggered flyout menu — force the full accordion rail for the tour's duration
  // instead. Derived (not a stored toggle), so the user's actual collapsed/expanded
  // preference is restored automatically the moment the tour ends, no bookkeeping needed.
  const tourForcesExpanded = Boolean(activeTour) && !isMobile && !isTablet;
  const effectiveCollapsed = isTablet ? true : tourForcesExpanded ? false : sidebarCollapsed;
  const overlayExpanded = !isMobile && effectiveCollapsed && isTablet && tabletExpanded;
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
    if (isMobile) {
      setMobileDrawerOpen(false);
      return;
    }
    if (isTablet) {
      setTabletExpanded((v) => !v);
      return;
    }
    toggleSidebar();
  }

  const [helpOpen, setHelpOpen] = useState(false);
  const [tourGuideOpen, setTourGuideOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [commandPaletteInitialQuery, setCommandPaletteInitialQuery] = useState('');
  const canSearch = hasPermission('SEARCH_GLOBAL');
  const openCommandPalette = useCallback(() => {
    if (canSearch) {
      setCommandPaletteInitialQuery('');
      setCommandPaletteOpen(true);
    }
  }, [canSearch]);
  const openQuickCreate = useCallback(() => {
    if (canSearch) {
      setCommandPaletteInitialQuery('>create ');
      setCommandPaletteOpen(true);
    }
  }, [canSearch]);
  const goToDashboard = useCallback(() => navigate('/dashboard'), [navigate]);
  useKeyboardShortcut('k', openCommandPalette, { ctrlOrCmd: true });
  useKeyboardShortcut('n', openQuickCreate, { ctrlOrCmd: true, shift: true });
  useSequenceShortcut(['g', 'd'], goToDashboard);
  useKeyboardShortcut('[', () => {
    if (!isMobile && !isTablet) setSidebarCollapsed(true);
  });
  useKeyboardShortcut(']', () => {
    if (!isMobile && !isTablet) setSidebarCollapsed(false);
  });
  useKeyboardShortcut('?', () => {
    setTourGuideOpen(false);
    setHelpOpen((v) => !v);
  });
  const streamedUnreadCount = useNotificationStream();
  const [unreadCount, setUnreadCount] = useState(0);
  useEffect(() => setUnreadCount(streamedUnreadCount), [streamedUnreadCount]);
  const [onboardingVisible, setOnboardingVisible] = useState(
    () => localStorage.getItem(ONBOARDING_DISMISSED_KEY) !== 'true'
  );

  const [logoutConfirmOpen, setLogoutConfirmOpen] = useState(false);

  function handleLogout() {
    // Revoke the refresh token + clear the cookie server-side — best-effort: local
    // state is cleared and navigation happens regardless, so a network failure here
    // never traps the user on a "logged out" screen that's still actually logged in.
    void authApi.logout().catch(() => {});
    logout();
    // Otherwise a second user logging in on this browser without a hard refresh can see
    // this user's cached lists/dashboard render until each query's next background
    // refetch (see WEB-FRONTEND-AUDIT-2026-07-24.md, Critical #1).
    queryClient.clear();
    navigate('/login');
  }

  function dismissOnboarding() {
    localStorage.setItem(ONBOARDING_DISMISSED_KEY, 'true');
    setOnboardingVisible(false);
  }

  const sidebarInner = (
    <SidebarContent
      navGroups={navGroups}
      user={user}
      showLabels={showLabels}
      isMobile={isMobile}
      onToggleCollapse={handleSidebarToggleClick}
      onLogoutClick={() => setLogoutConfirmOpen(true)}
    />
  );

  return (
    <div className="flex flex-col h-screen bg-surface-page overflow-hidden">
      <OfflineBanner />
      <ImpersonationBanner />
      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* Mobile drawer scrim */}
        {isMobile && mobileDrawerOpen && (
          <div
            className="fixed inset-0 bg-black/50 z-[var(--z-overlay)]"
            onClick={() => setMobileDrawerOpen(false)}
          />
        )}

        {/* Sidebar — background/border color is owned by whichever SidebarContent
            (Classic/Modern) renders inside; this shell only controls position/size, shared
            by both styles so the responsive/collapse behavior below never has to be
            duplicated per style. */}
        <aside
          className={`flex flex-col transition-all duration-200 shrink-0 ${
            isMobile
              ? `fixed inset-y-0 left-0 z-[var(--z-modal)] w-60 transform ${mobileDrawerOpen ? 'translate-x-0' : '-translate-x-full'}`
              : // `sticky` (unlike `relative`) always creates its own stacking context, so the
                // header's `sticky` + z-header would otherwise paint over the flyout's z-popover
                // no matter how high — z-index only competes within the nearest ancestor context.
                // Only elevate while previewing (not the pinned states) so this can't outrank
                // higher, less-frequent overlays (help panel, command palette, etc.) that assume
                // the sidebar sits at its default stacking level.
                `relative sticky top-0 h-screen ${overlayExpanded ? 'z-[var(--z-popover)]' : ''} ${effectiveCollapsed ? 'w-16' : 'w-60'}`
          }`}
        >
          {overlayExpanded ? (
            <div className="absolute inset-y-0 left-0 w-60 flex flex-col overflow-hidden rounded-r-xl shadow-token-lg z-[var(--z-popover)] animate-[sidebarFlyoutIn_var(--duration-normal)_ease-out]">
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
                  <span className="hidden sm:inline">
                    <Kbd>Ctrl K</Kbd>
                  </span>
                </button>
              )}
              <div className="relative">
                <button
                  data-tour-id="dashboard-approvals-button"
                  onClick={() => setNotificationsOpen((v) => !v)}
                  aria-label="Notifications"
                  className={`p-2 rounded-lg transition-colors relative ${notificationsOpen ? 'bg-primary text-primary-fg' : 'text-secondary hover:bg-surface-raised'}`}
                >
                  <Bell size={18} />
                  {unreadCount > 0 && (
                    <span className="absolute top-0.5 right-0.5 min-w-[16px] h-4 px-1 flex items-center justify-center rounded-full bg-danger text-white text-[10px] font-semibold leading-none">
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
              <div className="relative">
                <button
                  onClick={() => {
                    setHelpOpen(false);
                    setTourGuideOpen((v) => !v);
                  }}
                  aria-label={
                    hasUnseenPageTour
                      ? 'Open guided tours — a tour is available for this page'
                      : 'Open guided tours'
                  }
                  aria-haspopup="dialog"
                  aria-expanded={tourGuideOpen}
                  title="Guided tours"
                  className={`relative p-2 rounded-lg transition-colors ${tourGuideOpen ? 'bg-primary text-primary-fg' : 'text-secondary hover:bg-surface-raised'}`}
                >
                  <Compass size={18} />
                  {hasUnseenPageTour && !tourGuideOpen && (
                    <span
                      aria-hidden="true"
                      className="absolute top-1 right-1 w-2 h-2 rounded-full bg-brand animate-[tourSpotlightPulse_2s_ease-in-out_infinite]"
                    />
                  )}
                </button>
                {tourGuideOpen && (
                  <TourGuidePanel
                    onClose={() => setTourGuideOpen(false)}
                    onOpenHelp={() => setHelpOpen(true)}
                  />
                )}
              </div>
              <button
                onClick={() => {
                  setTourGuideOpen(false);
                  setHelpOpen((v) => !v);
                }}
                aria-label="Open help panel"
                aria-haspopup="dialog"
                aria-expanded={helpOpen}
                title="Help (press ?)"
                className={`p-2 rounded-lg transition-colors ${helpOpen ? 'bg-primary text-primary-fg' : 'text-secondary hover:bg-surface-raised'}`}
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
          <OnboardingChecklist
            onNavigate={(path) => navigate(path)}
            onDismiss={dismissOnboarding}
          />
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
          <ERPCommandPalette
            open={commandPaletteOpen}
            onClose={() => setCommandPaletteOpen(false)}
            initialQuery={commandPaletteInitialQuery}
          />
        )}

        <TenantThemeSync />
        <TourOverlay />
      </div>
    </div>
  );
}
