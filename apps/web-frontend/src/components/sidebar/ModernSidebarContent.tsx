import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { NavLink, useLocation } from 'react-router-dom';
import { ChevronRight, LogOut, Moon, PanelLeftClose, Sun, X } from 'lucide-react';
import { Switch } from '@erp/ui';
import TenantLogo from '../erp/TenantLogo.js';
import { useTheme } from '../../context/ThemeContext.js';
import type { NavItem } from '../../lib/navigation.js';
import type { SidebarContentProps } from './sidebar.types.js';

/** Matches NavLink's own default (non-`end`) active semantics — same helper as
 * ClassicSidebarContent, kept local rather than shared since it's a two-line pure function. */
function isPathActive(pathname: string, path: string) {
  return pathname === path || pathname.startsWith(`${path}/`);
}

// Column-browser layout (Finder/VS-Code-explorer style): a parent item never expands in place —
// clicking it opens its children as a new column flush against the previous one. Widths are
// fixed so a column's horizontal offset is pure arithmetic, no ref-measuring needed.
//
// These must match the *rendered* pixel width of the `w-60`/`w-16` Tailwind classes used for
// the rail (Layout.tsx's <aside>) and each column below — NOT Tailwind's default assumption of
// a 16px root font-size. This app's index.css sets `:root { font-size: 14px }`, so `w-60`
// (15rem) actually renders at 210px and `w-16` (4rem) at 56px. Using 240/64 here left a ~30px
// gap between the rail and the first flyout column.
const SIDEBAR_EXPANDED_WIDTH = 210;
const SIDEBAR_COLLAPSED_WIDTH = 56;
const COLUMN_WIDTH = 210;

const itemRowClass = (active: boolean, collapsed: boolean) =>
  `group relative flex items-center gap-3 rounded-lg text-sm font-medium transition-colors duration-150 ${
    collapsed ? 'justify-center px-0 py-2.5' : 'px-3 py-2'
  } ${active ? 'bg-primary-subtle text-brand' : 'text-secondary hover:bg-surface-raised hover:text-primary'}`;

/** One item in the always-visible rail (column 0). Leaves navigate directly; parents open
 * column 1 instead of expanding in place. */
function NavRailItem({
  item,
  collapsed,
  isOpen,
  onOpenChild,
  onNavigate,
}: {
  item: NavItem;
  collapsed: boolean;
  isOpen: boolean;
  onOpenChild: (item: NavItem) => void;
  onNavigate: () => void;
}) {
  const location = useLocation();
  const Icon = item.icon;
  const isChildActive = useMemo(
    () => item.children?.some((child) => isPathActive(location.pathname, child.path)) ?? false,
    [item.children, location.pathname]
  );

  if (!item.children) {
    return (
      <NavLink
        to={item.path}
        onClick={onNavigate}
        title={collapsed ? item.label : undefined}
        className={({ isActive }) => itemRowClass(isActive, collapsed)}
      >
        <Icon size={19} className="shrink-0" />
        {!collapsed && <span className="truncate">{item.label}</span>}
      </NavLink>
    );
  }

  const active = isOpen || isChildActive;
  return (
    <button
      onClick={() => onOpenChild(item)}
      aria-haspopup="true"
      aria-expanded={isOpen}
      title={collapsed ? item.label : undefined}
      className={itemRowClass(active, collapsed)}
    >
      <Icon size={19} className="shrink-0" />
      {!collapsed && (
        <>
          <span className="flex-1 text-left truncate">{item.label}</span>
          <ChevronRight size={14} className="shrink-0 text-secondary" />
        </>
      )}
    </button>
  );
}

/** A single flyout column, portaled to <body> so its `position: fixed` is always relative to
 * the viewport (never clipped/re-anchored by an ancestor transform — e.g. the mobile drawer's
 * translate-x). Shows `parent`'s children; a child with its own children opens the next column
 * instead of expanding in place, same rule as the rail. */
function ColumnPanel({
  parent,
  left,
  depth,
  openChildPath,
  onSelectLeaf,
  onOpenChild,
  panelRef,
}: {
  parent: NavItem;
  left: number;
  depth: number;
  openChildPath: string | undefined;
  onSelectLeaf: () => void;
  onOpenChild: (item: NavItem, depth: number) => void;
  panelRef: (el: HTMLDivElement | null) => void;
}) {
  const location = useLocation();
  const ParentIcon = parent.icon;

  return createPortal(
    <div
      ref={panelRef}
      role="menu"
      aria-label={parent.label}
      style={{ left }}
      className="fixed inset-y-0 w-60 flex flex-col bg-surface-card border-r border-default shadow-token-lg z-[var(--z-popover)] transition-[left] duration-200 ease-out animate-[sidebarFlyoutIn_var(--duration-normal)_ease-out]"
    >
      <div className="flex items-center gap-2.5 px-4 py-4 border-b border-default shrink-0">
        <ParentIcon size={18} className="text-brand shrink-0" />
        <span className="font-semibold text-sm text-primary truncate">{parent.label}</span>
      </div>
      <div className="flex-1 overflow-y-auto px-2.5 py-3 space-y-0.5">
        {(parent.children ?? []).map((child) => {
          const ChildIcon = child.icon;
          if (child.children) {
            const isOpen = openChildPath === child.path;
            const childActive =
              isOpen ||
              child.children.some((grandchild) => isPathActive(location.pathname, grandchild.path));
            return (
              <button
                key={child.path}
                onClick={() => onOpenChild(child, depth)}
                aria-haspopup="true"
                aria-expanded={isOpen}
                className={itemRowClass(childActive, false)}
              >
                <ChildIcon size={17} className="shrink-0" />
                <span className="flex-1 text-left truncate">{child.label}</span>
                <ChevronRight size={14} className="shrink-0 text-secondary" />
              </button>
            );
          }
          return (
            <NavLink
              key={child.path}
              to={child.path}
              onClick={onSelectLeaf}
              className={({ isActive }) => itemRowClass(isActive, false)}
            >
              <ChildIcon size={17} className="shrink-0" />
              <span className="truncate">{child.label}</span>
            </NavLink>
          );
        })}
      </div>
    </div>,
    document.body
  );
}

/** New default sidebar — a lighter, more spacious SaaS-style rail than ClassicSidebarContent,
 * built for the dual-sidebar personalization feature. Consumes the exact same navGroups/
 * permissions/routes/theme/logout as Classic; only presentation differs (see sidebar.types.ts).
 * Sub-items render as cascading flyout columns (Finder/VS-Code-explorer style) rather than an
 * in-place accordion — see the dual-sidebar personalization feature's follow-up request. */
export default function ModernSidebarContent({
  navGroups,
  user,
  showLabels,
  isMobile,
  onToggleCollapse,
  onLogoutClick,
}: SidebarContentProps) {
  const { mode, setMode } = useTheme();
  const location = useLocation();
  const userInitial = user?.firstName?.[0]?.toUpperCase() ?? '?';
  const isDark = mode === 'dark';

  // The chain of currently-open parent items — openChain[0] is the rail item whose children
  // fill column 0, openChain[1] (if a column-0 child itself has children) fills column 1, etc.
  const [openChain, setOpenChain] = useState<NavItem[]>([]);
  const rootRef = useRef<HTMLDivElement>(null);
  const panelRefs = useRef<Array<HTMLDivElement | null>>([]);

  function closeAll() {
    setOpenChain([]);
  }

  // Route changes (including ones not caused by clicking inside a column, e.g. breadcrumb,
  // command palette, browser back/forward) must never leave a stale column open.
  useEffect(() => {
    closeAll();
  }, [location.pathname]);
  // Toggling collapse/expand deliberately does NOT close open columns — `left` below is
  // recomputed from the current `showLabels` on every render, so an open column just slides
  // to its new position next to the rail instead of disappearing.

  useEffect(() => {
    if (openChain.length === 0) return undefined;
    function handleMouseDown(e: MouseEvent) {
      const target = e.target as Node;
      if (rootRef.current?.contains(target)) return;
      if (panelRefs.current.some((el) => el?.contains(target))) return;
      closeAll();
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') closeAll();
    }
    document.addEventListener('mousedown', handleMouseDown);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleMouseDown);
      document.removeEventListener('keydown', handleKey);
    };
  }, [openChain.length]);

  function handleRailOpen(item: NavItem) {
    setOpenChain((chain) => (chain[0]?.path === item.path ? [] : [item]));
  }

  function handleColumnOpen(item: NavItem, depth: number) {
    setOpenChain((chain) =>
      chain[depth + 1]?.path === item.path
        ? chain.slice(0, depth + 1)
        : [...chain.slice(0, depth + 1), item]
    );
  }

  return (
    <div ref={rootRef} className="flex flex-col h-full bg-surface-card border-r border-default">
      {/* Logo row */}
      {showLabels ? (
        <div className="flex items-center gap-2.5 px-4 py-4 border-b border-default">
          <TenantLogo
            className="w-8 h-8 rounded-lg object-cover shrink-0"
            fallback={
              <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center text-primary-fg font-bold text-sm shrink-0">
                N
              </div>
            }
          />
          <span className="font-semibold text-primary text-sm truncate">NEXORAA ERP</span>
          <button
            onClick={onToggleCollapse}
            aria-label={isMobile ? 'Close navigation menu' : 'Collapse sidebar'}
            className="ml-auto p-1.5 rounded-md text-secondary hover:text-primary hover:bg-surface-raised transition-colors shrink-0"
          >
            {isMobile ? <X size={17} /> : <PanelLeftClose size={17} />}
          </button>
        </div>
      ) : (
        <div className="flex items-center justify-center py-4 border-b border-default">
          <button
            onClick={onToggleCollapse}
            aria-label="Expand sidebar"
            title="Expand sidebar"
            className="w-9 h-9 rounded-lg hover:opacity-90 transition-opacity"
          >
            <TenantLogo
              className="w-9 h-9 rounded-lg object-cover"
              fallback={
                <div className="w-9 h-9 rounded-lg bg-primary flex items-center justify-center text-primary-fg font-bold text-sm">
                  N
                </div>
              }
            />
          </button>
        </div>
      )}

      {/* Navigation — column 0 (the rail itself) */}
      <nav className="flex-1 overflow-y-auto px-2.5 py-4 space-y-5">
        {navGroups.map((group, groupIndex) => (
          <div key={group.groupLabel}>
            {showLabels ? (
              <p className="px-2.5 mb-2 text-[10px] font-semibold uppercase tracking-wider text-disabled select-none">
                {group.groupLabel}
              </p>
            ) : groupIndex > 0 ? (
              <div className="mx-2 mb-3 h-px bg-[var(--border-default)]" />
            ) : null}
            <div className="space-y-0.5">
              {group.items.map((item) => (
                <NavRailItem
                  key={item.path}
                  item={item}
                  collapsed={!showLabels}
                  isOpen={openChain[0]?.path === item.path}
                  onOpenChild={handleRailOpen}
                  onNavigate={closeAll}
                />
              ))}
            </div>
          </div>
        ))}
      </nav>

      {/* Flyout columns 1..N — cascade to the right of the rail */}
      {openChain.map((parent, depth) => (
        <ColumnPanel
          key={parent.path}
          parent={parent}
          left={
            (showLabels ? SIDEBAR_EXPANDED_WIDTH : SIDEBAR_COLLAPSED_WIDTH) + depth * COLUMN_WIDTH
          }
          depth={depth}
          openChildPath={openChain[depth + 1]?.path}
          onSelectLeaf={closeAll}
          onOpenChild={handleColumnOpen}
          panelRef={(el) => {
            panelRefs.current[depth] = el;
          }}
        />
      ))}

      {/* Bottom utility area — theme toggle + user + logout */}
      <div className="px-3 py-3 border-t border-default space-y-2">
        {showLabels ? (
          <div className="flex items-center gap-2 px-2 py-1.5 rounded-md text-secondary">
            {isDark ? (
              <Moon size={16} className="shrink-0" />
            ) : (
              <Sun size={16} className="shrink-0" />
            )}
            <Switch
              checked={isDark}
              onChange={(checked) => setMode(checked ? 'dark' : 'light')}
              label={isDark ? 'Dark Mode' : 'Light Mode'}
              size="sm"
            />
          </div>
        ) : (
          <button
            onClick={() => setMode(isDark ? 'light' : 'dark')}
            aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
            title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
            className="w-full flex items-center justify-center px-0 py-2 rounded-md text-secondary hover:text-primary hover:bg-surface-raised transition-colors"
          >
            {isDark ? <Moon size={16} /> : <Sun size={16} />}
          </button>
        )}

        {showLabels && user && (
          <div className="flex items-center gap-2 px-2 py-1.5 text-sm">
            <div className="w-7 h-7 rounded-full bg-primary flex items-center justify-center text-primary-fg font-semibold text-xs shrink-0">
              {userInitial}
            </div>
            <div className="min-w-0">
              <p className="font-medium text-primary truncate">
                {user.firstName} {user.lastName}
              </p>
              <p className="text-xs text-secondary truncate">{user.email}</p>
            </div>
          </div>
        )}

        <button
          onClick={onLogoutClick}
          aria-label="Logout"
          title={showLabels ? undefined : 'Logout'}
          className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-sm text-danger hover:bg-danger-bg transition-colors"
        >
          <LogOut size={16} className="shrink-0" />
          {showLabels && 'Logout'}
        </button>
      </div>
    </div>
  );
}
