import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Check, ChevronDown, CirclePlus, GitBranch, X } from 'lucide-react';
import { branchApi } from '../../api/endpoints';

interface BranchSelectorProps {
  organizationId: number;
  value: number[];
  onChange: (branchIds: number[]) => void;
  onCreate: () => void;
}

export const BranchSelector: React.FC<BranchSelectorProps> = ({
  organizationId,
  value,
  onChange,
  onCreate,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [search, setSearch] = useState('');
  const [isOpen, setIsOpen] = useState(false);
  const branches = useQuery({
    queryKey: ['branches', 'organization', organizationId],
    queryFn: () => branchApi.getByOrganizationId(organizationId),
    enabled: organizationId > 0,
  });
  const rows = branches.data?.data || [];
  const filteredRows = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();
    if (!normalizedSearch) return rows;
    return rows.filter((branch) => branch.branchName.toLowerCase().includes(normalizedSearch) || branch.branchCode.toLowerCase().includes(normalizedSearch));
  }, [rows, search]);
  const selectedBranches = rows.filter((branch) => value.includes(branch.id));

  useEffect(() => {
    setSearch('');
    setIsOpen(false);
  }, [organizationId]);

  useEffect(() => {
    const closeOnOutsideClick = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setIsOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIsOpen(false);
    };

    document.addEventListener('mousedown', closeOnOutsideClick);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('mousedown', closeOnOutsideClick);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, []);

  const toggleBranch = (branchId: number) => {
    onChange(value.includes(branchId) ? value.filter((id) => id !== branchId) : [...value, branchId]);
  };

  const disabled = organizationId <= 0;

  return (
    <div ref={containerRef} className="relative min-w-0 w-full">
      <label className="mb-1 block text-sm text-gray-600">Branches</label>
      <div className="grid w-full min-w-0 grid-cols-[minmax(0,1fr)_40px]">
        <div className="relative min-w-0 flex-1">
          <button
            type="button"
            role="combobox"
            aria-expanded={isOpen}
            disabled={disabled}
            onClick={() => !disabled && setIsOpen((current) => !current)}
            className={`flex h-10 w-full min-w-0 items-center rounded-l border border-r-0 bg-white px-3 pr-10 text-left text-sm text-gray-900 outline-none transition disabled:cursor-not-allowed disabled:bg-gray-50 disabled:text-gray-400 ${
              isOpen
                ? 'border-blue-400 ring-2 ring-blue-100'
                : 'border-gray-300 hover:border-gray-400 focus:border-blue-400 focus:ring-2 focus:ring-blue-100'
            }`}
          >
            {selectedBranches.length ? (
              <span className="flex flex-wrap gap-1 truncate">
                {selectedBranches.map((branch) => (
                  <span key={branch.id} className="inline-flex items-center gap-1 rounded bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700">
                    {branch.branchName}
                    <X
                      size={12}
                      onClick={(event) => {
                        event.stopPropagation();
                        toggleBranch(branch.id);
                      }}
                    />
                  </span>
                ))}
              </span>
            ) : (
              <span className="text-gray-400">{disabled ? 'Select organization first' : 'Select branches'}</span>
            )}
          </button>
          <div className="absolute right-0 top-0 flex h-10 w-10 items-center justify-center text-gray-600">
            <ChevronDown size={18} className={`transition-transform ${isOpen ? 'rotate-180' : ''}`} />
          </div>
        </div>
        <button
          type="button"
          disabled={disabled}
          title={disabled ? 'Select organization first' : 'Create branch'}
          aria-label="Create branch"
          onClick={onCreate}
          className="flex h-10 w-10 items-center justify-center rounded-r border border-blue-400 bg-white text-blue-500 transition hover:bg-blue-50 hover:text-blue-600 focus:z-20 focus:outline-none focus:ring-2 focus:ring-blue-100 disabled:cursor-not-allowed disabled:border-gray-300 disabled:bg-gray-50 disabled:text-gray-300"
        >
          <CirclePlus size={17} strokeWidth={2} />
        </button>
      </div>

      {isOpen && !disabled && (
        <div
          role="listbox"
          aria-multiselectable
          className="absolute z-30 w-[calc(100%-40px)] overflow-hidden rounded-b-lg border border-t-0 border-blue-300 bg-white shadow-xl"
        >
          <div className="border-b p-2">
            <input
              autoFocus
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search branches..."
              className="h-9 w-full rounded border border-gray-200 px-3 text-sm outline-none focus:border-blue-300"
            />
          </div>
          <div className="max-h-56 overflow-y-auto">
            {branches.isLoading ? (
              <p className="px-5 py-4 text-sm text-gray-500">Loading branches...</p>
            ) : filteredRows.length ? (
              filteredRows.map((branch) => {
                const selected = value.includes(branch.id);
                return (
                  <button
                    key={branch.id}
                    type="button"
                    role="option"
                    aria-selected={selected}
                    onClick={() => toggleBranch(branch.id)}
                    className={`flex w-full items-center gap-4 border-t border-gray-100 px-5 py-4 text-left text-base transition first:border-t-0 ${
                      selected
                        ? 'bg-blue-50 font-semibold text-blue-700'
                        : 'text-gray-800 hover:bg-gray-50'
                    }`}
                  >
                    <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded border ${
                      selected ? 'border-blue-200 bg-white text-blue-600' : 'border-gray-200 bg-gray-50 text-gray-500'
                    }`}>
                      <GitBranch size={15} />
                    </span>
                    <span className="min-w-0 flex-1 truncate">{branch.branchName} ({branch.branchCode})</span>
                    {selected && <Check size={17} className="shrink-0" />}
                  </button>
                );
              })
            ) : (
              <p className="px-4 py-4 text-center text-sm text-gray-500">No branches found for this organization</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
