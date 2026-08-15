import { useAuthStore } from '../../store/auth.store.js';
import ClassicSidebarContent from './ClassicSidebarContent.js';
import ModernSidebarContent from './ModernSidebarContent.js';
import type { SidebarContentProps } from './sidebar.types.js';

/** Picks the user's preferred sidebar presentation — 'modern' is the default for any user
 * with no saved preference (new users, and existing users who haven't opted into classic). */
export default function SidebarContent(props: SidebarContentProps) {
  const sidebarStyle = useAuthStore((s) => s.user?.preferences?.sidebarStyle ?? 'modern');
  return sidebarStyle === 'classic' ? (
    <ClassicSidebarContent {...props} />
  ) : (
    <ModernSidebarContent {...props} />
  );
}
