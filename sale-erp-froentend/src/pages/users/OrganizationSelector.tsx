import React, { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Building2, Check, ChevronDown, CirclePlus } from 'lucide-react';
import { organizationApi } from '../../api/endpoints';
import { useDebounce } from '../../hooks/useDebounce';
import { getOrganizationId } from '../organizations/organization.utils';

interface OrganizationSelectorProps {
  value: number;
  onChange: (organizationId: number) => void;
  onCreate: () => void;
}

export const OrganizationSelector: React.FC<OrganizationSelectorProps> = ({
  value,
  onChange,
  onCreate,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [search, setSearch] = useState('');
  const [isOpen, setIsOpen] = useState(false);
  const debouncedSearch = useDebounce(search);
  const organizations = useQuery({
    queryKey: ['organizations', 'user-create', debouncedSearch],
    queryFn: () => organizationApi.getAll(debouncedSearch),
  });
  const rows = organizations.data?.data?.content || [];

  useEffect(() => {
    if (!value || search) return;

    const selected = rows.find((organization) => getOrganizationId(organization) === value);
    if (selected) setSearch(selected.name);
  }, [rows, search, value]);

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

  return (
    <div ref={containerRef} className="relative w-full">
      <label className="mb-2 block text-sm font-medium text-gray-700">Organization *</label>

      <div className="flex">
        <div className="relative min-w-0 flex-1">
          <input
            role="combobox"
            aria-expanded={isOpen}
            aria-autocomplete="list"
            className={`h-14 w-full rounded-l-lg border border-r-0 bg-white px-5 pr-12 text-base text-gray-900 outline-none transition focus:z-10 ${
              isOpen
                ? 'border-blue-400 ring-2 ring-blue-100'
                : 'border-gray-300 hover:border-gray-400 focus:border-blue-400 focus:ring-2 focus:ring-blue-100'
            }`}
            placeholder="Select organization"
            value={search}
            onFocus={() => setIsOpen(true)}
            onChange={(event) => {
              setSearch(event.target.value);
              if (value) onChange(0);
              setIsOpen(true);
            }}
          />
          <button
            type="button"
            tabIndex={-1}
            aria-label="Toggle organizations"
            onClick={() => setIsOpen((current) => !current)}
            className="absolute right-0 top-0 z-20 flex h-14 w-12 items-center justify-center text-gray-600"
          >
            <ChevronDown
              size={19}
              className={`transition-transform ${isOpen ? 'rotate-180' : ''}`}
            />
          </button>
        </div>
        <button
          type="button"
          title="Create organization"
          aria-label="Create organization"
          onClick={onCreate}
          className="flex h-14 w-12 shrink-0 items-center justify-center rounded-r border border-blue-400 bg-white text-blue-500 transition hover:bg-blue-50 hover:text-blue-600 focus:z-20 focus:outline-none focus:ring-2 focus:ring-blue-100"
        >
          <CirclePlus size={17} strokeWidth={2} />
        </button>
      </div>

      {isOpen && (
        <div
          role="listbox"
          className="absolute z-30 mt-0 max-h-72 w-[calc(100%-3rem)] overflow-y-auto rounded-b-lg border border-t-0 border-blue-300 bg-white shadow-xl"
        >
          {organizations.isLoading ? (
            <p className="px-5 py-4 text-sm text-gray-500">Loading organizations...</p>
          ) : rows.length ? (
            rows.map((organization) => {
              const organizationId = getOrganizationId(organization);
              const selected = organizationId === value;
              return (
                <button
                  key={organizationId}
                  type="button"
                  role="option"
                  aria-selected={selected}
                  onClick={() => {
                    onChange(organizationId);
                    setSearch(organization.name);
                    setIsOpen(false);
                  }}
                  className={`flex w-full items-center gap-4 border-t border-gray-100 px-5 py-4 text-left text-base transition first:border-t-0 ${
                    selected
                      ? 'bg-blue-50 font-semibold text-blue-700'
                      : 'text-gray-800 hover:bg-gray-50'
                  }`}
                >
                  <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded border ${
                    selected ? 'border-blue-200 bg-white text-blue-600' : 'border-gray-200 bg-gray-50 text-gray-500'
                  }`}>
                    <Building2 size={15} />
                  </span>
                  <span className="min-w-0 flex-1 truncate">{organization.name}</span>
                  {selected && <Check size={18} className="shrink-0" />}
                </button>
              );
            })
          ) : (
            <div className="px-5 py-5 text-center">
              <p className="text-sm font-medium text-gray-700">No organizations found</p>
              <button type="button" onClick={onCreate} className="mt-1 text-sm font-semibold text-blue-600 hover:underline">
                Create a new organization
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
