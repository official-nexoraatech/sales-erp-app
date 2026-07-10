import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus } from 'lucide-react';
import { useAuthStore } from '../../store/auth.store.js';
import { QUICK_CREATE_ITEMS, filterQuickCreateItems } from '../../lib/quickCreate.js';
import ERPDropdownMenu, { type ERPMenuItem } from './ERPDropdownMenu.js';

/** Header "+ New" — per ERP-PLANNING/02_ERP_NAVIGATION_ARCHITECTURE.md §11. */
export default function QuickCreateMenu() {
  const navigate = useNavigate();
  const { hasPermission } = useAuthStore();

  const items: ERPMenuItem[] = useMemo(
    () =>
      filterQuickCreateItems(QUICK_CREATE_ITEMS, hasPermission).map((item) => ({
        label: item.label,
        icon: item.icon,
        onClick: () => navigate(item.path),
      })),
    [hasPermission, navigate],
  );

  if (items.length === 0) return null;

  return (
    <ERPDropdownMenu
      align="left"
      items={items}
      ariaLabel="Quick create"
      trigger={
        <span className="flex items-center gap-1.5 px-2 text-sm font-medium text-primary">
          <Plus size={16} />
          <span className="hidden sm:inline">New</span>
        </span>
      }
    />
  );
}
