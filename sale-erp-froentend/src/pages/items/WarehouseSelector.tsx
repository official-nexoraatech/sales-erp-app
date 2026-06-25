import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, CirclePlus, Warehouse as WarehouseIcon } from 'lucide-react';
import type { Warehouse } from '../../api/endpoints';

interface WarehouseSelectorProps {
  value: number;
  rows: Warehouse[];
  isLoading?: boolean;
  hasError?: boolean;
  onChange: (warehouseId: number) => void;
  onCreate: () => void;
}

export const WarehouseSelector: React.FC<WarehouseSelectorProps> = ({
  value,
  rows,
  isLoading = false,
  hasError = false,
  onChange,
  onCreate,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [search, setSearch] = useState('');
  const [isOpen, setIsOpen] = useState(false);

  const selectedWarehouse = useMemo(
    () => rows.find((warehouse) => warehouse.id === value),
    [rows, value]
  );
  const filteredRows = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();
    if (!normalizedSearch || value) return rows;
    return rows.filter((warehouse) => warehouse.name.toLowerCase().includes(normalizedSearch));
  }, [rows, search, value]);

  useEffect(() => {
    if (!value || search) return;
    if (selectedWarehouse) setSearch(selectedWarehouse.name);
  }, [search, selectedWarehouse, value]);

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
    <div ref={containerRef} className="relative min-w-0 w-full">
      <label className="mb-1 block text-sm text-gray-600">Warehouse</label>
      <div className="grid w-full min-w-0 grid-cols-[minmax(0,1fr)_40px]">
        <div className="relative min-w-0 flex-1">
          <input
            role="combobox"
            aria-expanded={isOpen}
            aria-autocomplete="list"
            className={`h-10 w-full min-w-0 rounded-l border border-r-0 bg-white px-3 pr-10 text-sm text-gray-900 outline-none transition placeholder:text-gray-400 disabled:cursor-not-allowed disabled:bg-gray-50 disabled:text-gray-400 ${
              hasError
                ? 'border-red-400 focus:border-red-400 focus:ring-2 focus:ring-red-100'
                : isOpen
                  ? 'border-blue-400 ring-2 ring-blue-100'
                  : 'border-gray-300 hover:border-gray-400 focus:border-blue-400 focus:ring-2 focus:ring-blue-100'
            }`}
            disabled={isLoading}
            placeholder={isLoading ? 'Loading warehouses...' : 'Search warehouse'}
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
            disabled={isLoading}
            aria-label="Toggle warehouses"
            onClick={() => setIsOpen((current) => !current)}
            className="absolute right-0 top-0 flex h-10 w-10 items-center justify-center text-gray-600 disabled:text-gray-300"
          >
            <ChevronDown size={18} className={`transition-transform ${isOpen ? 'rotate-180' : ''}`} />
          </button>
        </div>
        <button
          type="button"
          title="Create warehouse"
          aria-label="Create warehouse"
          onClick={onCreate}
          className="flex h-10 w-10 items-center justify-center rounded-r border border-blue-400 bg-white text-blue-500 transition hover:bg-blue-50 hover:text-blue-600 focus:z-20 focus:outline-none focus:ring-2 focus:ring-blue-100"
        >
          <CirclePlus size={17} strokeWidth={2} />
        </button>
      </div>

      {isOpen && (
        <div
          role="listbox"
          className="absolute z-30 max-h-64 w-[calc(100%-40px)] overflow-y-auto rounded-b-lg border border-t-0 border-blue-300 bg-white shadow-xl"
        >
          {isLoading ? (
            <p className="px-4 py-4 text-sm text-gray-500">Loading warehouses...</p>
          ) : filteredRows.length ? (
            filteredRows.map((warehouse) => {
              const selected = warehouse.id === value;
              return (
                <button
                  key={warehouse.id}
                  type="button"
                  role="option"
                  aria-selected={selected}
                  onClick={() => {
                    onChange(warehouse.id);
                    setSearch(warehouse.name);
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
                    <WarehouseIcon size={15} />
                  </span>
                  <span className="min-w-0 flex-1 truncate">{warehouse.name}</span>
                  {selected && <Check size={17} className="shrink-0" />}
                </button>
              );
            })
          ) : (
            <div className="px-5 py-5 text-center">
              <p className="text-sm font-medium text-gray-700">No warehouses found</p>
              <button type="button" onClick={onCreate} className="mt-1 text-sm font-semibold text-blue-600 hover:underline">
                Create a new warehouse
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
