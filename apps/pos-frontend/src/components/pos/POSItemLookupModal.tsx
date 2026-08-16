import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { SearchInput } from '@erp/ui';
import { authFetch } from '../../auth.js';
import { useDebouncedValue } from '../../hooks/useDebouncedValue.js';
import { useItemSearch, type ItemSearchFilters } from '../../hooks/useItemSearch.js';
import POSDialog from './POSDialog.js';
import POSAutocompleteList from './POSAutocompleteList.js';
import type { POSItem, POSSearchResult } from './types.js';

const SALES_API = import.meta.env['VITE_SALES_API_URL'] ?? 'http://localhost:3000/api/sales';
const DEBOUNCE_MS = 180;

interface FilterOption {
  id: number;
  name: string;
}

interface LookupFilterOptions {
  categories: FilterOption[];
  brands: FilterOption[];
  priceLists: FilterOption[];
  warehouses: FilterOption[];
}

interface Props {
  open: boolean;
  onClose: () => void;
  onSelectItem: (item: POSItem) => void;
}

// Phase 3 — the escape hatch from the omnibox for "I don't know the exact name": browse the
// catalog by category/brand/price-list/warehouse-stock, filters combining with an optional
// typed query. Shares GET /pos/items/search with POSOmnibox via useItemSearch.
export function POSItemLookupModal({ open, onClose, onSelectItem }: Props) {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('');
  const [brand, setBrand] = useState('');
  const [priceListId, setPriceListId] = useState('');
  const [warehouseId, setWarehouseId] = useState('');
  const [inStockOnly, setInStockOnly] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const debouncedQuery = useDebouncedValue(query, DEBOUNCE_MS);

  const { data: filterOptions } = useQuery({
    queryKey: ['pos-lookup-filters'],
    queryFn: async () => {
      const res = await authFetch(`${SALES_API}/pos/lookup-filters`);
      if (!res.ok) throw new Error('Failed to load filters');
      return res.json() as Promise<{ data: LookupFilterOptions }>;
    },
    enabled: open,
    staleTime: 5 * 60_000,
  });
  const options = filterOptions?.data;

  const filters: ItemSearchFilters = {
    ...(category ? { category: Number(category) } : {}),
    ...(brand ? { brand: Number(brand) } : {}),
    ...(priceListId ? { priceListId: Number(priceListId) } : {}),
    ...(warehouseId ? { warehouseId: Number(warehouseId) } : {}),
    ...(inStockOnly ? { inStockOnly: true } : {}),
  };

  const { data, fetchNextPage, hasNextPage, isFetchingNextPage, isFetching } = useItemSearch(
    debouncedQuery,
    filters,
    open
  );
  const results = data?.pages.flatMap((p) => p.data) ?? [];

  useEffect(() => {
    setHighlightedIndex(0);
  }, [debouncedQuery, category, brand, priceListId, warehouseId, inStockOnly]);

  // Reset to a blank slate each time the modal is (re)opened, rather than carrying over the
  // previous visit's filters — a cashier reopening Lookup expects to start fresh.
  useEffect(() => {
    if (open) {
      setQuery('');
      setCategory('');
      setBrand('');
      setPriceListId('');
      setWarehouseId('');
      setInStockOnly(false);
    }
  }, [open]);

  const handleSelect = (item: POSSearchResult) => {
    onSelectItem({
      id: item.itemId,
      name: item.name,
      salePrice: String(item.price),
      mrp: item.mrp,
      gstRate: item.gstRate,
      cessRate: item.cessRate,
      ...(item.barcode ? { barcode: item.barcode } : {}),
    });
    onClose();
  };

  const selectClass =
    'rounded-lg border border-default bg-surface-card px-2 py-1.5 text-sm text-primary focus:outline-none focus:border-focus';

  return (
    <POSDialog open={open} onClose={onClose} title="Item Lookup" size="full">
      <div
        className="flex-1 min-h-0 flex flex-col"
        onKeyDown={(e) => {
          // Attached to the whole modal (not just the search input) so Enter adds the
          // highlighted result regardless of which filter control currently has focus.
          // Arrow keys are the exception: a focused <select> needs them for its own native
          // option-cycling, so this only takes over navigation outside of one.
          const onSelect = e.target instanceof HTMLSelectElement;
          if (e.key === 'ArrowDown' && !onSelect) {
            if (results.length === 0) return;
            e.preventDefault();
            setHighlightedIndex((i) => (i + 1) % results.length);
          } else if (e.key === 'ArrowUp' && !onSelect) {
            if (results.length === 0) return;
            e.preventDefault();
            setHighlightedIndex((i) => (i - 1 + results.length) % results.length);
          } else if (e.key === 'Enter') {
            if (results[highlightedIndex]) {
              e.preventDefault();
              handleSelect(results[highlightedIndex]!);
            }
          }
        }}
      >
        <SearchInput
          autoFocus
          size="lg"
          placeholder="Search within these filters (optional) — name, SKU, alias, code…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          wrapperClassName="mb-3 shrink-0"
        />

        <div className="flex flex-wrap gap-2 mb-3 shrink-0">
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className={selectClass}
            aria-label="Category"
          >
            <option value="">All categories</option>
            {options?.categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <select
            value={brand}
            onChange={(e) => setBrand(e.target.value)}
            className={selectClass}
            aria-label="Brand"
          >
            <option value="">All brands</option>
            {options?.brands.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
          <select
            value={priceListId}
            onChange={(e) => setPriceListId(e.target.value)}
            className={selectClass}
            aria-label="Price list"
          >
            <option value="">Default price list</option>
            {options?.priceLists.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <select
            value={warehouseId}
            onChange={(e) => setWarehouseId(e.target.value)}
            className={selectClass}
            aria-label="Warehouse"
          >
            <option value="">All warehouses (overall stock)</option>
            {options?.warehouses.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </select>
          <label className="flex items-center gap-1.5 text-sm text-primary px-1">
            <input
              type="checkbox"
              checked={inStockOnly}
              onChange={(e) => setInStockOnly(e.target.checked)}
              className="w-4 h-4 accent-[var(--brand-primary)]"
            />
            In stock only
          </label>
        </div>

        <div className="flex-1 min-h-0 border border-default rounded-xl overflow-hidden">
          {results.length === 0 ? (
            <div className="flex items-center justify-center h-full text-sm text-secondary">
              {isFetching ? 'Searching…' : 'No items match these filters'}
            </div>
          ) : (
            <POSAutocompleteList
              results={results}
              highlightedIndex={highlightedIndex}
              onSelect={handleSelect}
              onHover={setHighlightedIndex}
              hasNextPage={Boolean(hasNextPage)}
              isFetchingNextPage={isFetchingNextPage}
              onLoadMore={() => void fetchNextPage()}
              fill
              listboxId="pos-lookup-listbox"
            />
          )}
        </div>

        <p className="text-xs text-secondary mt-2 shrink-0">
          ↑ / ↓ navigate · Enter add · Esc close
        </p>
      </div>
    </POSDialog>
  );
}
