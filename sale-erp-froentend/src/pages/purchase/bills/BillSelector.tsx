import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Check, ChevronDown, CirclePlus, FileText } from 'lucide-react';
import { purchaseApi } from '../../../api/endpoints';

interface BillSelectorProps {
  value: number;
  onChange: (purchaseId: number) => void;
  onCreate: () => void;
  supplierId?: number;
  purchaseDate?: string;
  stateId?: number;
}

export const BillSelector: React.FC<BillSelectorProps> = ({ value, onChange, onCreate, supplierId, purchaseDate, stateId }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [search, setSearch] = useState('');
  const [isOpen, setIsOpen] = useState(false);
  const bills = useQuery({
    queryKey: ['purchase-bill-selector', supplierId, purchaseDate, stateId],
    queryFn: () => purchaseApi.getAll({
      status: 'CREATED',
      page: 0,
      size: 100,
      supplierId: supplierId || undefined,
      fromDate: purchaseDate || undefined,
      toDate: purchaseDate || undefined,
      stateId: stateId || undefined,
    }),
  });
  const rows = bills.data?.data?.content || [];
  const label = (purchase: { purchaseNo?: string; purchaseId: number }) => purchase.purchaseNo || `PB/${purchase.purchaseId}`;
  const filteredRows = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();
    if (!normalizedSearch || value) return rows;
    return rows.filter((purchase) =>
      label(purchase).toLowerCase().includes(normalizedSearch)
      || (purchase.supplierName || '').toLowerCase().includes(normalizedSearch)
    );
  }, [rows, search, value]);

  useEffect(() => {
    if (!value || search) return;
    const selected = rows.find((purchase) => purchase.purchaseId === value);
    if (selected) setSearch(label(selected));
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
    <div ref={containerRef} className="relative min-w-0 w-full">
      <label className="mb-1 block text-sm text-gray-600">Select Bill *</label>
      <div className="grid w-full min-w-0 grid-cols-[minmax(0,1fr)_40px]">
        <div className="relative min-w-0 flex-1">
          <input
            role="combobox"
            aria-expanded={isOpen}
            aria-autocomplete="list"
            className={`h-10 w-full min-w-0 rounded-l border border-r-0 bg-white px-3 pr-10 text-sm text-gray-900 outline-none transition ${
              isOpen
                ? 'border-blue-400 ring-2 ring-blue-100'
                : 'border-gray-300 hover:border-gray-400 focus:border-blue-400 focus:ring-2 focus:ring-blue-100'
            }`}
            placeholder="Search bill no. or supplier"
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
            aria-label="Toggle bills"
            onClick={() => setIsOpen((current) => !current)}
            className="absolute right-0 top-0 flex h-10 w-10 items-center justify-center text-gray-600"
          >
            <ChevronDown size={18} className={`transition-transform ${isOpen ? 'rotate-180' : ''}`} />
          </button>
        </div>
        <button
          type="button"
          title="Create bill"
          aria-label="Create bill"
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
          {bills.isLoading ? (
            <p className="px-5 py-4 text-sm text-gray-500">Loading bills...</p>
          ) : filteredRows.length ? (
            filteredRows.map((purchase) => {
              const selected = purchase.purchaseId === value;
              return (
                <button
                  key={purchase.purchaseId}
                  type="button"
                  role="option"
                  aria-selected={selected}
                  onClick={() => {
                    onChange(purchase.purchaseId);
                    setSearch(label(purchase));
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
                    <FileText size={15} />
                  </span>
                  <span className="min-w-0 flex-1 truncate">{label(purchase)} — {purchase.supplierName}</span>
                  {selected && <Check size={17} className="shrink-0" />}
                </button>
              );
            })
          ) : (
            <p className="px-4 py-4 text-center text-sm text-gray-500">No created bills found</p>
          )}
        </div>
      )}
    </div>
  );
};
