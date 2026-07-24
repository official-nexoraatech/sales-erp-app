import React, { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Check, ChevronDown, GitBranch } from 'lucide-react';
import { branchApi } from '../../api/endpoints';
import { queryClient } from '../../app/queryClient';
import { useAuth } from '../../hooks/useAuth';
import { useBranch } from '../../hooks/useBranch';

export const BranchSwitcher: React.FC = () => {
  const { isAuthenticated } = useAuth();
  const { selectedBranchId, setSelectedBranchId } = useBranch();
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const branches = useQuery({
    queryKey: ['my-branches'],
    queryFn: () => branchApi.getMine(),
    enabled: isAuthenticated,
  });
  const rows = branches.data?.data || [];

  // Default to the first assigned branch until the user picks one explicitly.
  useEffect(() => {
    if (!selectedBranchId && rows.length > 0) {
      setSelectedBranchId(rows[0].id);
    }
  }, [rows, selectedBranchId, setSelectedBranchId]);

  useEffect(() => {
    if (!isOpen) return;

    const closeOnOutsideClick = (event: MouseEvent | TouchEvent) => {
      const target = event.target;
      if (target instanceof Node && !containerRef.current?.contains(target)) {
        setIsOpen(false);
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIsOpen(false);
    };

    document.addEventListener('mousedown', closeOnOutsideClick);
    document.addEventListener('touchstart', closeOnOutsideClick);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('mousedown', closeOnOutsideClick);
      document.removeEventListener('touchstart', closeOnOutsideClick);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [isOpen]);

  const selectBranch = async (branchId: number) => {
    setSelectedBranchId(branchId);
    setIsOpen(false);
    // Branch-scoped data (customers, warehouses, and every future module) must
    // be refetched under the newly selected branch's X-Branch-Id header.
    await queryClient.invalidateQueries();
  };

  if (!isAuthenticated || rows.length === 0) return null;

  const selectedBranch = rows.find((branch) => branch.id === selectedBranchId) || rows[0];

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setIsOpen((current) => !current)}
        className="flex h-8 items-center gap-1.5 rounded-lg border border-indigo-200 bg-indigo-50 px-2.5 text-xs font-semibold text-indigo-700 transition hover:bg-indigo-100 dark:border-indigo-800 dark:bg-indigo-950/40 dark:text-indigo-300 dark:hover:bg-indigo-900/40"
        title="Switch branch"
        aria-haspopup="menu"
        aria-expanded={isOpen}
      >
        <GitBranch size={14} />
        <span className="hidden max-w-28 truncate sm:inline">{selectedBranch?.branchName || 'Select branch'}</span>
        <ChevronDown size={13} className={`transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {isOpen && (
        <div
          role="menu"
          className="absolute left-0 top-10 z-50 w-56 overflow-hidden rounded-xl border border-slate-200 bg-white py-1.5 shadow-xl dark:border-slate-700 dark:bg-slate-800 dark:shadow-slate-900/70"
        >
          {rows.map((branch) => {
            const selected = branch.id === selectedBranch?.id;
            return (
              <button
                key={branch.id}
                type="button"
                role="menuitem"
                onClick={() => selectBranch(branch.id)}
                className={`flex w-full items-center justify-between gap-2 px-4 py-2.5 text-left text-sm transition ${
                  selected
                    ? 'bg-indigo-50 font-semibold text-indigo-700 dark:bg-indigo-900/20 dark:text-indigo-400'
                    : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-700 dark:hover:text-slate-100'
                }`}
              >
                <span className="truncate">{branch.branchName}</span>
                {selected && <Check size={15} className="shrink-0" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};
