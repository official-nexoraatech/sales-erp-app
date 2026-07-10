import { useEffect, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Building2, Check, ChevronDown } from 'lucide-react';
import { branchApi } from '../../api/endpoints.js';
import { useAuthStore } from '../../store/auth.store.js';
import { useBranchStore } from '../../store/branch.store.js';
import { PERMISSIONS } from '../../constants/permissions.js';
import ERPDropdownMenu, { type ERPMenuItem } from './ERPDropdownMenu.js';

interface Branch {
  id: number;
  name: string;
}

/**
 * Header-level branch switcher. Per ERP-PLANNING/02_ERP_NAVIGATION_ARCHITECTURE.md §14:
 * only renders when the user has access to more than one branch. Sets the default branch
 * for create-forms; does not filter list-page query results (no backend support yet).
 */
export default function BranchSwitcher() {
  const { user, hasPermission } = useAuthStore();
  const { currentBranchId, setCurrentBranchId } = useBranchStore();
  const branchIds = user?.branchIds ?? [];

  const { data } = useQuery({
    queryKey: ['branches', 'switcher'],
    queryFn: () => branchApi.list({ size: 100 }),
    enabled: branchIds.length > 1 && hasPermission(PERMISSIONS.BRANCH_VIEW),
  });

  const branches = useMemo(() => {
    const all = ((data as { content?: unknown[] } | undefined)?.content ?? []) as Branch[];
    return all.filter((b) => branchIds.includes(b.id));
  }, [data, branchIds]);

  useEffect(() => {
    if (!currentBranchId && branchIds.length > 0) {
      setCurrentBranchId(branchIds[0]!);
    }
  }, [currentBranchId, branchIds, setCurrentBranchId]);

  if (branchIds.length <= 1) return null;

  const currentBranch = branches.find((b) => b.id === currentBranchId);

  const items: ERPMenuItem[] = branches.map((b) => ({
    label: b.name,
    ...(b.id === currentBranchId ? { icon: Check } : {}),
    onClick: () => setCurrentBranchId(b.id),
  }));

  return (
    <ERPDropdownMenu
      align="left"
      items={items}
      ariaLabel="Switch branch"
      trigger={
        <span className="flex items-center gap-1.5 px-2 text-sm">
          <Building2 size={15} />
          <span className="hidden md:inline max-w-[140px] truncate">{currentBranch?.name ?? 'Select branch'}</span>
          <ChevronDown size={13} />
        </span>
      }
    />
  );
}
