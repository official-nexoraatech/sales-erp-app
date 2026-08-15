import { useEffect, useMemo, useRef, useState } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { PanelLeftClose, ChevronRight, LogOut, X } from 'lucide-react';
import TenantLogo from '../erp/TenantLogo.js';
import ERPDropdownMenu, { type ERPMenuItem } from '../erp/ERPDropdownMenu.js';
import { useTour } from '../../dap/index.js';
import type { NavItem } from '../../lib/navigation.js';
import type { SidebarContentProps } from './sidebar.types.js';

/** Matches NavLink's own default (non-`end`) active semantics, so a parent can tell whether
 * one of its children is the current section without duplicating react-router's matcher. */
function isPathActive(pathname: string, path: string) {
  return pathname === path || pathname.startsWith(`${path}/`);
}

function NavItemLeaf({ item, collapsed }: { item: NavItem; collapsed: boolean }) {
  const Icon = item.icon;
  return (
    <NavLink
      to={item.path}
      title={collapsed ? item.label : undefined}
      className={({ isActive }) =>
        `group relative flex items-center gap-3 rounded-lg text-sm font-medium transition-colors duration-150 ${
          collapsed ? 'justify-center px-0 py-2.5' : 'px-3 py-2'
        } ${
          isActive
            ? 'bg-sidebar-item-active text-sidebar-active'
            : 'text-sidebar hover:bg-sidebar-item-hover'
        }`
      }
    >
      {({ isActive }) => (
        <>
          {isActive && (
            <span className="absolute left-0 top-1/2 h-4 w-0.5 -translate-y-1/2 rounded-full bg-sidebar-active" />
          )}
          <Icon size={16} className="shrink-0" />
          {!collapsed && <span className="truncate">{item.label}</span>}
        </>
      )}
    </NavLink>
  );
}

function NavGroupItem({ item, collapsed }: { item: NavItem; collapsed: boolean }) {
  const location = useLocation();
  const navigate = useNavigate();
  const { activeStep } = useTour();
  const containerRef = useRef<HTMLDivElement>(null);
  const isChildActive = useMemo(
    () => item.children?.some((child) => isPathActive(location.pathname, child.path)) ?? false,
    [item.children, location.pathname]
  );
  const [open, setOpen] = useState(isChildActive);
  const Icon = item.icon;

  // Auto-expand the section that contains the active route (e.g. deep-linking into
  // /sales/invoices/123) without ever auto-collapsing a group the user opened manually.
  useEffect(() => {
    if (isChildActive) setOpen(true);
  }, [isChildActive]);

  // Tour-awareness: a tour step must never explain a sidebar item hidden inside a collapsed
  // accordion. The accordion's children are always in the DOM (collapsed via grid-rows, not
  // conditional rendering — see the `open` div below), so this works purely via DOM
  // membership — no naming convention needed between nav config and tour content.
  useEffect(() => {
    if (!activeStep?.target) return;
    const targetEl = document.querySelector(activeStep.target);
    if (targetEl && containerRef.current?.contains(targetEl)) {
      setOpen(true);
      targetEl.scrollIntoView({ block: 'nearest' });
    }
  }, [activeStep]);

  if (!item.children) {
    return <NavItemLeaf item={item} collapsed={collapsed} />;
  }

  const activeIndicator = isChildActive && (
    <span className="absolute left-0 top-1/2 h-4 w-0.5 -translate-y-1/2 rounded-full bg-sidebar-active" />
  );

  // Collapsed rail: the inline accordion below has nowhere to render, so a click opens this
  // group's children as a flyout menu anchored to the icon instead — the sidebar itself never
  // expands just to reach a sub-item (that's a deliberate, explicit "expand" click on the
  // toggle button, not an incidental side effect of navigating).
  if (collapsed) {
    const menuItems: ERPMenuItem[] = item.children.map((child) => ({
      label: child.label,
      icon: child.icon,
      onClick: () => navigate(child.path),
    }));
    return (
      <ERPDropdownMenu
        items={menuItems}
        align="left"
        ariaLabel={item.label}
        triggerTitle={item.label}
        triggerClassName={`group relative w-full flex items-center justify-center px-0 py-2.5 rounded-lg text-sm font-medium transition-colors duration-150 ${
          isChildActive
            ? 'bg-sidebar-item-active text-sidebar-active'
            : 'text-sidebar hover:bg-sidebar-item-hover'
        }`}
        trigger={
          <>
            {activeIndicator}
            <Icon size={16} className="shrink-0" />
          </>
        }
      />
    );
  }

  return (
    <div ref={containerRef}>
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className={`group relative w-full flex items-center gap-3 rounded-lg text-sm font-medium transition-colors duration-150 px-3 py-2 ${
          isChildActive
            ? 'bg-sidebar-item-active text-sidebar-active'
            : 'text-sidebar hover:bg-sidebar-item-hover'
        }`}
      >
        {activeIndicator}
        <Icon size={16} className="shrink-0" />
        <span className="flex-1 text-left truncate">{item.label}</span>
        <ChevronRight
          size={14}
          className={`text-sidebar-muted transition-transform duration-200 ease-out shrink-0 ${open ? 'rotate-90' : ''}`}
        />
      </button>
      <div
        className="grid overflow-hidden transition-[grid-template-rows] duration-200 ease-out"
        style={{ gridTemplateRows: open ? '1fr' : '0fr' }}
      >
        <div className="min-h-0 overflow-hidden">
          <div className="ml-[19px] mt-1 mb-0.5 space-y-0.5 border-l border-sidebar-border pl-3">
            {item.children.map((child) => {
              const ChildIcon = child.icon;
              return (
                <NavLink
                  key={child.path}
                  to={child.path}
                  className={({ isActive }) =>
                    `flex items-center gap-2 px-2 py-1.5 rounded-md text-[13px] leading-tight transition-colors duration-150 ${
                      isActive
                        ? 'text-sidebar-active font-semibold bg-sidebar-item-active'
                        : 'text-sidebar-muted hover:text-sidebar hover:bg-sidebar-item-hover'
                    }`
                  }
                >
                  <ChildIcon size={14} className="shrink-0" />
                  <span className="truncate">{child.label}</span>
                </NavLink>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

/** The current/original Nexoraa sidebar, preserved verbatim as the "classic" alternative to
 * ModernSidebarContent — see the dual-sidebar personalization feature. */
export default function ClassicSidebarContent({
  navGroups,
  user,
  showLabels,
  isMobile,
  onToggleCollapse,
  onLogoutClick,
}: SidebarContentProps) {
  const userInitial = user?.firstName?.[0]?.toUpperCase() ?? '?';

  return (
    <div className="flex flex-col h-full bg-sidebar border-r border-sidebar">
      {/* Logo row — the icon + brand label + toggle button only fit side-by-side once the rail
          is at its full 240px width (showLabels). At the 64px collapsed width there isn't room
          for all three (they used to silently overflow the row, pushing the toggle button off
          the visible rail and under the header where it couldn't be clicked), so collapsed mode
          renders a single centered button that both shows the brand mark and expands the sidebar. */}
      {showLabels ? (
        <div className="flex items-center gap-2 px-4 py-4 border-b border-sidebar-border">
          <TenantLogo
            className="w-7 h-7 rounded-md object-cover shrink-0"
            fallback={
              <div className="w-7 h-7 rounded-md bg-primary flex items-center justify-center text-white font-bold text-sm shrink-0">
                N
              </div>
            }
          />
          <span className="font-bold text-sidebar text-sm truncate">NEXORAA ERP</span>
          <button
            onClick={onToggleCollapse}
            aria-label={isMobile ? 'Close navigation menu' : 'Collapse sidebar'}
            className="ml-auto p-1.5 rounded-md text-sidebar-muted hover:text-sidebar hover:bg-sidebar-item-hover transition-colors shrink-0"
          >
            {isMobile ? <X size={16} /> : <PanelLeftClose size={16} />}
          </button>
        </div>
      ) : (
        <div className="flex items-center justify-center py-4 border-b border-sidebar-border">
          <button
            onClick={onToggleCollapse}
            aria-label="Expand sidebar"
            title="Expand sidebar"
            className="w-8 h-8 rounded-md hover:opacity-90 transition-opacity"
          >
            <TenantLogo
              className="w-8 h-8 rounded-md object-cover"
              fallback={
                <div className="w-8 h-8 rounded-md bg-primary flex items-center justify-center text-white font-bold text-sm">
                  N
                </div>
              }
            />
          </button>
        </div>
      )}

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto px-2 py-3 space-y-4">
        {navGroups.map((group, groupIndex) => (
          <div key={group.groupLabel}>
            {showLabels ? (
              <p className="px-3 mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-sidebar-muted select-none">
                {group.groupLabel}
              </p>
            ) : groupIndex > 0 ? (
              <div className="mx-2 mb-3 h-px bg-sidebar-border" />
            ) : null}
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
              <p className="font-medium text-sidebar truncate">
                {user.firstName} {user.lastName}
              </p>
              <p className="text-xs text-sidebar-muted truncate">{user.email}</p>
            </div>
          </div>
        )}
        <button
          onClick={onLogoutClick}
          aria-label="Logout"
          title={showLabels ? undefined : 'Logout'}
          className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-sm text-danger hover:bg-danger-bg transition-colors"
        >
          <LogOut size={15} className="shrink-0" />
          {showLabels && 'Logout'}
        </button>
      </div>
    </div>
  );
}
