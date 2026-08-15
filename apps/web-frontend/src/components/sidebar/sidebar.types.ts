import type { AuthUser } from '../../store/auth.store.js';
import type { NavGroup } from '../../lib/navigation.js';

/** Shared between ClassicSidebarContent and ModernSidebarContent — both render the same
 * navGroups/user/collapse state, computed once in Layout.tsx, and differ only in
 * presentation. See ERP-PLANNING for the dual-sidebar personalization feature. */
export interface SidebarContentProps {
  navGroups: NavGroup[];
  user: AuthUser | null;
  /** false = icon-only rail (desktop collapsed / tablet default). */
  showLabels: boolean;
  isMobile: boolean;
  onToggleCollapse: () => void;
  onLogoutClick: () => void;
}
